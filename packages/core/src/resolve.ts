// Turns a model reply into a validated circuit, or into issues to send back for a retry. Pure.
import type { z } from 'zod';
import { BLOCK_TYPES, MAX_BLOCKS, blockFields, buildCircuit, getBlock, type Block } from './blocks';
import { COUNT_FIELDS, LABEL_FIELDS, REPLY_KINDS, UNUSED_NUMBER, replyShapeProblem, type ReplyTarget } from './reply';
import { InventorySchema, planCircuits, validateInventory, type Inventory, type Plan, type PlanOptions } from './planner';
import type { CircuitModel } from './schema';
import type { TemplateParams } from './templates';
import { validateCircuit, type Issue, type IssueCode } from './validate';

export type ReplyIssueCode =
  | IssueCode
  | 'BAD_REPLY'
  | 'BAD_BREAKER'
  | 'BAD_BLOCK_LIST'
  | 'UNKNOWN_BLOCK'
  | 'BAD_BLOCK'
  | 'BLOCK_BUG'
  | 'BAD_INVENTORY'
  | 'BAD_PLAN_OPTION'
  | 'PLAN_ERROR';
export interface ReplyIssue {
  code: ReplyIssueCode;
  message: string;
  ids: string[];
}

export type CircuitOrigin =
  /** Built by `buildCircuit` from checked building blocks (ADR-008). `blocks` are the parsed blocks, defaults filled in. */
  | { kind: 'blocks'; breakerAmps: 15 | 20; blocks: Block[]; name: string }
  /** Legacy: whole-circuit templates, no longer produced. Kept so stored origins stay readable and labelled. */
  | { kind: 'template'; templateId: string; params: TemplateParams }
  | { kind: 'custom'; verified: false };

export type Resolution =
  | { kind: 'question'; text: string }
  | { kind: 'unsupported'; message: string }
  | { kind: 'circuit'; circuit: CircuitModel; origin: CircuitOrigin; message: string; /** Add a new circuit, or replace the selected one. */ target: Exclude<ReplyTarget, 'none'> }
  /** A whole-job inventory and the deterministic plan made from it (ADR-009). Creates no circuit. */
  | { kind: 'inventory'; inventory: Inventory; options: PlanOptions; plan: Plan; message: string }
  /** The user asks to build the stored plan (ADR-009). Carries no data: the plan is the one stored on the project. */
  | { kind: 'build'; message: string }
  | { kind: 'invalid'; issues: ReplyIssue[] };

const invalid = (code: ReplyIssueCode, message: string, ids: string[] = []): Resolution => ({
  kind: 'invalid',
  issues: [{ code, message, ids }],
});
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function resolveReply(reply: unknown): Resolution {
  if (!isObject(reply)) return invalid('BAD_REPLY', 'reply must be an object with kind, target, message, breakerAmps, name, blocks and custom keys');
  const kind = reply.kind;
  if (typeof kind !== 'string' || !(REPLY_KINDS as readonly string[]).includes(kind))
    return invalid('BAD_REPLY', `kind must be one of ${REPLY_KINDS.join(', ')}`);
  const problem = replyShapeProblem(reply);
  if (problem) return invalid('BAD_REPLY', `exactly one outcome must be used: ${problem}`);
  const message = reply.message;

  switch (kind) {
    case 'question':
      return typeof message === 'string' && message.trim() ? { kind: 'question', text: message } : invalid('BAD_REPLY', 'message must be a non-empty question');
    case 'unsupported':
      return typeof message === 'string' && message.trim() ? { kind: 'unsupported', message } : invalid('BAD_REPLY', 'message must be a non-empty explanation');
    case 'circuit':
      return resolveBlocks(reply, reply.target as 'new' | 'selected');
    case 'inventory':
      return resolveInventory(reply);
    case 'build':
      return typeof message === 'string' ? { kind: 'build', message } : invalid('BAD_REPLY', 'a build reply needs message (string)');
    default:
      return resolveCustom(reply, reply.target as 'new' | 'selected');
  }
}

const unusedValue = (v: unknown) => v === undefined || v === null || v === UNUSED_NUMBER || v === false || v === '';
const KNOWN_ENTRY_FIELDS = new Set(['type', ...COUNT_FIELDS, 'gfciFirst', ...LABEL_FIELDS]);

const issue = (code: ReplyIssueCode, message: string): ReplyIssue => ({ code, message, ids: [] });

/** One flat block entry to its block parameters, or the issues that stop it. `where` names the entry for the model, e.g. `block 2 (switch_fan)`. */
function parseBlockEntry(entry: unknown, index: number): { block: Block } | { issues: ReplyIssue[] } {
  const at = `block ${index + 1}`;
  if (!isObject(entry)) return { issues: [issue('BAD_BLOCK', `${at} must be an object`)] };
  const type = entry.type;
  const spec = typeof type === 'string' ? getBlock(type) : undefined;
  if (!spec) return { issues: [issue('UNKNOWN_BLOCK', `${at}: unknown block type ${JSON.stringify(type)}; valid types: ${BLOCK_TYPES.join(', ')}`)] };
  const where = `${at} (${spec.id})`;
  const fields = blockFields(spec);
  const own = new Set([...fields.counts, ...Object.keys(fields.labels), ...(fields.gfciFirst ? ['gfciFirst'] : [])]);
  const issues: ReplyIssue[] = [];
  const params: Record<string, unknown> = { type: spec.id };
  for (const [key, value] of Object.entries(entry)) {
    if (key === 'type') continue;
    if (!KNOWN_ENTRY_FIELDS.has(key)) {
      issues.push(issue('BAD_BLOCK', `${where}: unknown field "${key}"`));
      continue;
    }
    if (!own.has(key)) {
      // Fields the block does not take must hold their unused value: 0, false or "".
      if (!unusedValue(value)) {
        const unused = key.startsWith('count') ? String(UNUSED_NUMBER) : key === 'gfciFirst' ? 'false' : '""';
        issues.push(issue('BAD_BLOCK', `${where}: field "${key}" is not used by ${spec.id}; set it to ${unused}`));
      }
      continue;
    }
    // Blank labels mean "the block's default".
    if (key in fields.labels && (value === '' || value === undefined || value === null || (typeof value === 'string' && value.trim() === ''))) continue;
    if (key === 'gfciFirst' && (value === undefined || value === null)) continue;
    params[key] = value;
  }
  for (const key of fields.counts)
    if (!(key in params)) issues.push(issue('BAD_BLOCK', `${where}: ${key} is missing; give a whole number from 1 to 12`));
  if (issues.length > 0) return { issues };
  const parsed = spec.paramsSchema.safeParse(params);
  if (!parsed.success) return { issues: zodBlockIssues(where, parsed.error) };
  return { block: parsed.data as Block };
}

const zodBlockIssues = (where: string, error: z.ZodError): ReplyIssue[] =>
  error.issues.map((i) => issue('BAD_BLOCK', `${where}: ${i.path.length ? `${i.path.join('.')}: ` : ''}${i.message}`));

function resolveBlocks(reply: Record<string, unknown>, target: 'new' | 'selected'): Resolution {
  if (typeof reply.message !== 'string') return invalid('BAD_REPLY', 'a circuit reply needs message (string), breakerAmps (15 or 20), name (string) and blocks (list)');
  const amps = reply.breakerAmps;
  if (amps !== 15 && amps !== 20) return invalid('BAD_BREAKER', `breakerAmps must be 15 or 20 for a circuit reply (got ${JSON.stringify(amps ?? null)})`);
  const name = typeof reply.name === 'string' ? reply.name.trim() : '';
  if (reply.name !== undefined && reply.name !== null && typeof reply.name !== 'string') return invalid('BAD_REPLY', 'name must be a string');
  const entries = reply.blocks ?? [];
  if (!Array.isArray(entries)) return invalid('BAD_BLOCK_LIST', 'blocks must be a list of block objects');
  if (entries.length === 0) return invalid('BAD_BLOCK_LIST', 'a circuit reply needs at least one block');
  if (entries.length > MAX_BLOCKS) return invalid('BAD_BLOCK_LIST', `a circuit has at most ${MAX_BLOCKS} blocks (got ${entries.length}); use fewer, or ask the user to split the job`);
  const blocks: Block[] = [];
  const issues: ReplyIssue[] = [];
  entries.forEach((e, i) => {
    const r = parseBlockEntry(e, i);
    if ('block' in r) blocks.push(r.block);
    else issues.push(...r.issues);
  });
  if (issues.length > 0) return { kind: 'invalid', issues };
  let circuit: CircuitModel;
  try {
    circuit = buildCircuit({ id: 'circuit', title: name || 'Circuit', breakerAmps: amps, blocks });
  } catch (e) {
    return invalid('BLOCK_BUG', `the blocks could not be built (bug): ${e instanceof Error ? e.message : String(e)}`);
  }
  const structural = validateCircuit(circuit);
  // Any issue here is a bug in a block builder; never swallow it.
  if (structural.length > 0)
    return { kind: 'invalid', issues: structural.map((i) => ({ ...i, code: 'BLOCK_BUG' as const, message: `the blocks produced an invalid circuit (bug): ${i.message}` })) };
  return { kind: 'circuit', circuit, origin: { kind: 'blocks', breakerAmps: amps, blocks, name }, message: reply.message, target };
}

function resolveInventory(reply: Record<string, unknown>): Resolution {
  if (typeof reply.message !== 'string') return invalid('BAD_REPLY', 'an inventory reply needs message (string), basement (true or false), rooms (list), maxReceptaclesPerCircuit and lightingBreakerAmps');
  const input = { basement: reply.basement ?? false, rooms: reply.rooms ?? [] };
  const found = validateInventory(input);
  const issues: ReplyIssue[] = found.map((i) => ({ code: 'BAD_INVENTORY', message: i.message, ids: i.ids }));

  // 0 means "use the default".
  const options: PlanOptions = {};
  const maxRec = reply.maxReceptaclesPerCircuit;
  if (maxRec !== undefined && maxRec !== null && maxRec !== UNUSED_NUMBER) {
    if (typeof maxRec === 'number' && Number.isInteger(maxRec) && maxRec >= 1 && maxRec <= 24) options.maxReceptaclesPerCircuit = maxRec;
    else issues.push(issue('BAD_PLAN_OPTION', `maxReceptaclesPerCircuit must be 0 (default) or a whole number from 1 to 24 (got ${JSON.stringify(maxRec)})`));
  }
  const lightAmps = reply.lightingBreakerAmps;
  if (lightAmps !== undefined && lightAmps !== null && lightAmps !== UNUSED_NUMBER) {
    if (lightAmps === 15 || lightAmps === 20) options.lightingBreakerAmps = lightAmps;
    else issues.push(issue('BAD_PLAN_OPTION', `lightingBreakerAmps must be 0 (default), 15 or 20 (got ${JSON.stringify(lightAmps)})`));
  }
  if (issues.length > 0) return { kind: 'invalid', issues };

  const inventory = InventorySchema.parse(input);
  let plan: Plan;
  try {
    plan = planCircuits(inventory, options);
  } catch (e) {
    return invalid('PLAN_ERROR', `the plan could not be made: ${e instanceof Error ? e.message : String(e)}`);
  }
  const errors = plan.findings.filter((f) => f.severity === 'error');
  if (errors.length > 0) return { kind: 'invalid', issues: errors.map((f) => ({ code: 'PLAN_ERROR' as const, message: f.message, ids: f.roomIds })) };
  return { kind: 'inventory', inventory, options, plan, message: reply.message };
}

const ENDPOINT_FIELDS: Record<string, readonly string[]> = {
  terminal: ['device', 'terminal'],
  conductor: ['cable', 'color', 'box'],
  splice: ['splice'],
};
const ALL_ENDPOINT_FIELDS = new Set(['kind', ...Object.values(ENDPOINT_FIELDS).flat()]);

/** Flat wire endpoint to the model's tagged endpoint: keeps the fields its kind uses, drops the "" ones. Anything else is left for validateCircuit to reject. */
function normaliseEndpoint(e: unknown): unknown {
  if (!isObject(e) || typeof e.kind !== 'string' || !(e.kind in ENDPOINT_FIELDS)) return e;
  const out: Record<string, unknown> = { kind: e.kind };
  for (const f of ENDPOINT_FIELDS[e.kind]!) if (f in e) out[f] = e[f];
  for (const [k, v] of Object.entries(e)) if (!ALL_ENDPOINT_FIELDS.has(k)) out[k] = v; // unknown keys stay so the checker flags them
  return out;
}

function resolveCustom(reply: Record<string, unknown>, target: 'new' | 'selected'): Resolution {
  const [raw] = reply.custom as unknown[]; // length 1, checked by replyShapeProblem
  if (typeof reply.message !== 'string' || !isObject(raw))
    return invalid('BAD_REPLY', 'a custom reply needs message (string) and a custom list holding one circuit (object)');
  // The wire form carries amps 0 on non-breakers and flat endpoints; the model has no "absent" value to emit.
  const devices = Array.isArray(raw.devices)
    ? raw.devices.map((d) => (isObject(d) && (d.amps === UNUSED_NUMBER || d.amps === null) ? Object.fromEntries(Object.entries(d).filter(([k]) => k !== 'amps')) : d))
    : raw.devices;
  const connections = Array.isArray(raw.connections)
    ? raw.connections.map((c) => (isObject(c) ? { ...c, a: normaliseEndpoint(c.a), b: normaliseEndpoint(c.b) } : c))
    : raw.connections;
  const circuit = { ...raw, devices, connections };
  const issues: Issue[] = validateCircuit(circuit);
  if (issues.length > 0) return { kind: 'invalid', issues };
  return { kind: 'circuit', circuit: circuit as unknown as CircuitModel, origin: { kind: 'custom', verified: false }, message: reply.message, target };
}

const MAX_ISSUES = 20;

/** Terse feedback for a retry turn: one line per issue, with the ids involved. */
export function formatIssuesForModel(issues: readonly ReplyIssue[]): string {
  const lines = issues.slice(0, MAX_ISSUES).map((i) => `- ${i.code}: ${i.message}${i.ids.length ? ` [${i.ids.join(', ')}]` : ''}`);
  if (issues.length > MAX_ISSUES) lines.push(`- ... and ${issues.length - MAX_ISSUES} more`);
  return `Your reply was rejected. Fix these problems and reply again with the complete corrected reply:\n${lines.join('\n')}`;
}
