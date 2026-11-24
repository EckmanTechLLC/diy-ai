import {
  RULES,
  blockFields,
  buildSystemPrompt,
  checkCircuit,
  buildCircuit,
  formatPlanText,
  formatIssuesForModel,
  getBlock,
  planCircuits,
  replyJsonSchema,
  resolveReply,
  validateCircuit,
  type CircuitModel,
  type Block,
  type CircuitOrigin,
  type CircuitPlanInfo,
  type Finding,
  type Inventory,
  type Plan,
  type PlanOptions,
  type PlannedCircuit,
  type ReplyTarget,
} from '@diy-ai/core';
import type { ActiveProviderResult, ChatMessage, LlmProvider } from '../llm';
import { FAILURE_MESSAGES, rulesFailedText, type ChatFailureCode } from './errors';

/** Retries after an invalid reply; the model is called at most 1 + MAX_RETRIES times per user message. */
export const MAX_RETRIES = 2;

/** Most distinct rule failures listed in one correction, so a cascade does not flood the turn. */
export const MAX_CORRECTION_FINDINGS = 8;

export interface StoredMessage {
  role: 'user' | 'assistant';
  content: string;
  kind: 'question' | 'circuit' | 'unsupported' | 'error' | 'plan' | 'plan_built' | 'build_proposed' | null;
  /** The model's raw structured reply (assistant messages). */
  reply: unknown;
}

export type ChatOutcome =
  | { kind: 'question'; text: string; reply: unknown }
  | { kind: 'unsupported'; text: string; reply: unknown }
  /** A whole-job inventory with its deterministic plan, rendered as text. To be stored on the project; creates no circuit. */
  | { kind: 'inventory'; text: string; reply: unknown; inventory: Inventory; options: PlanOptions; plan: Plan }
  /** The user asked to build, but there is nothing to build (no plan, or already built). Changes nothing. */
  | { kind: 'build_blocked'; text: string; reply: unknown }
  /** The model asked to build the stored plan. Only a proposal: creates nothing; circuits are made by the explicit build route. */
  | { kind: 'build_proposed'; text: string; reply: unknown; plan: Plan }
  | { kind: 'circuit'; text: string; reply: unknown; circuit: CircuitModel; origin: CircuitOrigin; /** Add a new circuit, or replace the selected one. */ target: Exclude<ReplyTarget, 'none'>; /** Rule warnings; possibly empty. */ findings: Finding[] }
  | { kind: 'failed'; code: ChatFailureCode; text: string; /** Rule errors behind a rules_failed / block_rule_bug outcome. */ findings?: Finding[] };

/** One circuit of a built plan, ready to be stored. */
export interface BuiltPlanCircuit {
  name: string;
  circuit: CircuitModel;
  origin: Extract<CircuitOrigin, { kind: 'blocks' }>;
  /** Rule warnings; possibly empty. */
  findings: Finding[];
  plan: CircuitPlanInfo;
}

/** The project's stored plan as the chat sees it. */
export interface PlanState {
  inventory: Inventory;
  options: PlanOptions;
  /** Null while the plan has not been built. */
  builtAt: number | null;
}

export const NO_PLAN_TEXT = 'There is no plan to build yet. Describe the rooms and what is in them and I will make a plan first.';
export const ALREADY_BUILT_TEXT =
  'This plan is already built. To make a different plan, ask me for the changes (the circuits already built stay as they are), or delete those circuits and discard the plan first.';

const failed = (code: ChatFailureCode): ChatOutcome => ({ kind: 'failed', code, text: FAILURE_MESSAGES[code] });

const ruleTitle = (ruleId: string) => RULES.find((r) => r.id === ruleId)?.title ?? ruleId;

/**
 * The correction sent to the model after a circuit fails the rule checks: each failed rule's title and message,
 * deduplicated by rule and involved ids and capped at MAX_CORRECTION_FINDINGS.
 */
export function formatFindingsForModel(findings: readonly Finding[]): string {
  const seen = new Set<string>();
  const unique: Finding[] = [];
  for (const f of findings) {
    const key = `${f.ruleId}|${[...f.involved].sort().join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(f);
  }
  const lines = unique
    .slice(0, MAX_CORRECTION_FINDINGS)
    .map((f) => `- ${ruleTitle(f.ruleId)}: ${f.message}${f.involved.length ? ` [${f.involved.join(', ')}]` : ''}`);
  if (unique.length > MAX_CORRECTION_FINDINGS) lines.push(`- ... and ${unique.length - MAX_CORRECTION_FINDINGS} more`);
  return `Your circuit was rejected by the electrical rule checks. Fix these problems and reply again with the complete corrected reply:\n${lines.join('\n')}`;
}

/** A stored circuit as the model's context note sees it. */
export interface ContextCircuit {
  id: string;
  name: string;
  circuit: CircuitModel;
  origin: CircuitOrigin | null;
}

/** One block as text, e.g. "Run of receptacles (count 4, GFCI first)". Titles and count names come from the registry. */
function describeBlock(b: Block): string {
  const spec = getBlock(b.type);
  if (!spec) return b.type;
  const details = blockFields(spec).counts.map((k) => `${k} ${(b as Record<string, unknown>)[k]}`);
  if ('gfciFirst' in b && b.gfciFirst) details.push('GFCI first');
  return details.length ? `${spec.title} (${details.join(', ')})` : spec.title;
}

/** One-line summary of how a circuit was made. */
export function summariseOrigin(origin: CircuitOrigin | null): string {
  if (origin?.kind === 'blocks') return origin.blocks.map(describeBlock).join('; ');
  if (origin?.kind === 'custom') return 'custom wiring';
  return 'example/manual';
}

const breakerSize = (c: CircuitModel) => {
  const amps = c.devices.find((d) => d.type === 'breaker')?.amps;
  return amps ? `${amps} A` : 'breaker size unknown';
};

/** One circuit of a plan on one line: name, breaker, what it serves and its protection. */
function summarisePlanned(c: PlannedCircuit, i: number): string {
  const rooms = c.rooms.map((r) => r.name).join(', ');
  const gfci = c.protection.gfci === 'first-receptacle' ? 'GFCI at the first receptacle' : 'no GFCI';
  return `${i + 1}. "${c.name}" - ${c.breakerAmps} A - serves ${rooms} - ${gfci}, ${c.protection.afci ? 'AFCI' : 'no AFCI'}`;
}

/** The stored plan part of the context note: inventory and options as JSON, a compact summary of the plan, and whether it was built. */
function planNote(state: PlanState): string {
  let summary: string[];
  try {
    summary = planCircuits(state.inventory, state.options).circuits.map(summarisePlanned);
  } catch {
    summary = ['(the plan could not be computed)'];
  }
  return [
    `Note: this project has a stored plan, ${state.builtAt === null ? 'not yet built' : 'already built into circuits'}.`,
    'Room inventory:',
    JSON.stringify(state.inventory),
    'Plan options (empty means defaults):',
    JSON.stringify(state.options),
    'The plan software made from them:',
    ...summary,
  ].join('\n');
}

/**
 * The note put before the newest user message: the project's circuits in order (name, breaker, summary), the selected
 * one marked, and the selected circuit's definition (its block list for blocks origin, else its circuit JSON); then,
 * when the project has a stored plan, the plan note. Returns null when there is neither.
 */
export function buildContextNote(circuits: readonly ContextCircuit[], selectedCircuitId: string | null, plan: PlanState | null = null): string | null {
  const parts: string[] = [];
  if (circuits.length > 0) {
    const selected = circuits.find((c) => c.id === selectedCircuitId) ?? null;
    const lines = circuits.map((c, i) => `${i + 1}. "${c.name}" - ${breakerSize(c.circuit)} - ${summariseOrigin(c.origin)}${c === selected ? ' [selected]' : ''}`);
    const out = [`Note: this project has ${circuits.length} circuit${circuits.length === 1 ? '' : 's'}, in order:`, ...lines, ''];
    if (!selected) out.push('No circuit is selected.');
    else {
      const o = selected.origin;
      const definition = o?.kind === 'blocks' ? { name: selected.name, breakerAmps: o.breakerAmps, blocks: o.blocks } : selected.circuit;
      out.push(`The selected circuit is "${selected.name}". Its ${o?.kind === 'blocks' ? 'block list' : 'circuit definition'}:`, JSON.stringify(definition));
    }
    parts.push(out.join('\n'));
  }
  if (plan) parts.push(planNote(plan));
  return parts.length > 0 ? parts.join('\n\n') : null;
}

/**
 * Model conversation from stored messages (oldest first, newest is the user turn being answered).
 * Error messages are dropped; adjacent same-role turns (left behind by dropped errors) are merged.
 * The circuits and plan note, when there is one, goes before the newest user turn.
 */
export function buildModelMessages(stored: StoredMessage[], circuits: readonly ContextCircuit[] = [], selectedCircuitId: string | null = null, plan: PlanState | null = null): ChatMessage[] {
  const turns: ChatMessage[] = [];
  for (const m of stored) {
    if (m.kind === 'error') continue;
    const content = m.role === 'user' ? m.content : m.reply == null ? null : JSON.stringify(m.reply);
    if (content === null) continue;
    const prev = turns[turns.length - 1];
    if (prev && prev.role === m.role) prev.content += `\n\n${content}`;
    else turns.push({ role: m.role, content });
  }
  const note = buildContextNote(circuits, selectedCircuitId, plan);
  const newest = turns[turns.length - 1];
  if (note && newest && newest.role === 'user') newest.content = `${note}\n\n${newest.content}`;
  return turns;
}

export interface ChatInput {
  /** All stored messages including the newest user message. */
  messages: StoredMessage[];
  /** The project's circuits in order. */
  circuits: readonly ContextCircuit[];
  /** The circuit the user has selected, if any. */
  selectedCircuitId: string | null;
  /** The project's stored plan, if any. */
  plan?: PlanState | null;
}

/**
 * Builds every circuit of the plan through the same path as a chat circuit: buildCircuit, validateCircuit, checkCircuit.
 * All or nothing: the first circuit that fails structural validation or has a rule error stops the build. Pure.
 */
export function buildPlanCircuits(plan: Plan): { ok: true; circuits: BuiltPlanCircuit[] } | { ok: false; name: string; findings: Finding[]; problem: string } {
  const built: BuiltPlanCircuit[] = [];
  for (const planned of plan.circuits) {
    let circuit: CircuitModel;
    let blocks: Block[];
    try {
      blocks = planned.blocks.map((b) => getBlock(b.type)!.paramsSchema.parse(b) as Block);
      circuit = buildCircuit({ id: 'circuit', title: planned.name, breakerAmps: planned.breakerAmps, blocks });
    } catch (e) {
      return { ok: false, name: planned.name, findings: [], problem: `it could not be built (${e instanceof Error ? e.message : String(e)})` };
    }
    const structural = validateCircuit(circuit);
    if (structural.length > 0) return { ok: false, name: planned.name, findings: [], problem: `it is not a valid circuit (${structural.map((i) => i.message).join('; ')})` };
    const findings = checkCircuit(circuit, { edition: 'nec-2023' });
    const errors = findings.filter((f) => f.severity === 'error');
    if (errors.length > 0) return { ok: false, name: planned.name, findings: errors, problem: 'it fails the electrical checks' };
    const { protection, rooms, reasons, plannedLoadVa, capacityVa } = planned;
    built.push({
      name: planned.name,
      circuit,
      origin: { kind: 'blocks', breakerAmps: planned.breakerAmps, blocks, name: planned.name },
      findings: findings.filter((f) => f.severity === 'warning'),
      plan: { protection, rooms, reasons, plannedLoadVa, capacityVa },
    });
  }
  return { ok: true, circuits: built };
}

/** Runs one user turn against the provider, retrying invalid replies. Persists nothing. */
export async function runChat(provider: LlmProvider, input: ChatInput): Promise<ChatOutcome> {
  const system = buildSystemPrompt();
  const schema = replyJsonSchema();
  const turns = buildModelMessages(input.messages, input.circuits, input.selectedCircuitId, input.plan ?? null);

  /** Rule errors of the most recent attempt when it was rejected by the rules; null when it failed structurally. */
  let lastRuleErrors: Finding[] | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const result = await provider.complete({ system, messages: turns, schema });
    if (!result.ok) return failed(result.error.code);
    if (result.invalidReply?.length) {
      // Unreadable or off-schema reply from a provider without grammar-constrained output: never resolved, always retried.
      lastRuleErrors = null;
      turns.push({ role: 'assistant', content: JSON.stringify(result.reply) });
      turns.push({ role: 'user', content: formatIssuesForModel(result.invalidReply.map((message) => ({ code: 'BAD_REPLY' as const, message, ids: [] }))) });
      continue;
    }
    const res = resolveReply(result.reply);
    switch (res.kind) {
      case 'question':
        return { kind: 'question', text: res.text, reply: result.reply };
      case 'unsupported':
        return { kind: 'unsupported', text: res.message, reply: result.reply };
      case 'inventory':
        return { kind: 'inventory', text: `${res.message.trim()}\n\n${formatPlanText(res.plan)}`, reply: result.reply, inventory: res.inventory, options: res.options, plan: res.plan };
      case 'build': {
        if (!input.plan) return { kind: 'build_blocked', text: NO_PLAN_TEXT, reply: result.reply };
        if (input.plan.builtAt !== null) return { kind: 'build_blocked', text: ALREADY_BUILT_TEXT, reply: result.reply };
        // The plan is always computed here from the stored inventory, never taken from the model's reply.
        let plan: Plan;
        try {
          plan = planCircuits(input.plan.inventory, input.plan.options);
        } catch (e) {
          console.error(`Plan build bug: the stored plan could not be computed (${e instanceof Error ? e.name : 'error'})`);
          return failed('plan_build_failed');
        }
        return { kind: 'build_proposed', text: res.message.trim(), reply: result.reply, plan };
      }
      case 'circuit': {
        const findings = checkCircuit(res.circuit, { edition: 'nec-2023' });
        const errors = findings.filter((f) => f.severity === 'error');
        if (errors.length === 0) {
          return {
            kind: 'circuit',
            text: res.message,
            reply: result.reply,
            circuit: res.circuit,
            origin: res.origin,
            target: res.target,
            findings: findings.filter((f) => f.severity === 'warning'),
          };
        }
        if (res.origin.kind === 'blocks') {
          // Checked building blocks must never fail our own rules: a bug, so no retry. Logs ids only, no conversation text.
          console.error(
            `Block rule bug: blocks ${res.origin.blocks.map((b) => b.type).join(', ')} fail ${[...new Set(errors.map((f) => f.ruleId))].join(', ')}`,
          );
          return { kind: 'failed', code: 'block_rule_bug', text: FAILURE_MESSAGES.block_rule_bug, findings: errors };
        }
        lastRuleErrors = errors;
        turns.push({ role: 'assistant', content: JSON.stringify(result.reply) });
        turns.push({ role: 'user', content: formatFindingsForModel(errors) });
        break;
      }
      case 'invalid':
        lastRuleErrors = null;
        // Retry turns live only in this local array; they are never stored.
        turns.push({ role: 'assistant', content: JSON.stringify(result.reply) });
        turns.push({ role: 'user', content: formatIssuesForModel(res.issues) });
    }
  }
  if (lastRuleErrors) return { kind: 'failed', code: 'rules_failed', text: rulesFailedText(lastRuleErrors), findings: lastRuleErrors };
  return failed('invalid_reply');
}

export function providerUnavailable(active: Extract<ActiveProviderResult, { configured: false }>): ChatOutcome {
  return failed(active.reason === 'none' ? 'not_configured' : active.reason === 'no_key' ? 'no_key' : 'endpoint_missing');
}
