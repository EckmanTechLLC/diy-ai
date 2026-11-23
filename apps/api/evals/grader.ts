/** Deterministic grading of one chat outcome against one expectation. No network, no LLM. */
import { CATALOGUE, analyzeNets, checkCircuit, computeNets, endpointKey, validateCircuit, type Block, type CircuitModel } from '@diy-ai/core';
import type { ChatOutcome } from '../src/chat/loop';
import type { BlockExpect, CustomFact, Expect, TerminalRef } from './cases';

export interface Grade {
  pass: boolean;
  /** Why it failed, or a short note for a pass. */
  reason: string;
  /** Short failure pattern label; null on pass. */
  pattern: string | null;
}

const ok = (reason: string): Grade => ({ pass: true, reason, pattern: null });
const bad = (pattern: string, reason: string): Grade => ({ pass: false, reason, pattern });

/** Net of every endpoint that appears in a connection. */
function endpointNets(model: CircuitModel): Map<string, string> {
  const nets = computeNets(model);
  const out = new Map<string, string>();
  for (const c of model.connections) {
    const net = nets.get(c.id)!;
    out.set(endpointKey(c.a), net);
    out.set(endpointKey(c.b), net);
  }
  return out;
}

const terminalKeys = (model: CircuitModel, ref: TerminalRef) =>
  model.devices.filter((d) => d.type === ref.type).map((d) => `t:${d.id}.${ref.terminal}`);

/** Returns a failure message, or null when the fact holds. */
export function checkFact(model: CircuitModel, fact: CustomFact): string | null {
  const nets = endpointNets(model);
  if (fact.kind === 'connected') {
    const keys = [...terminalKeys(model, fact.a), ...terminalKeys(model, fact.b)];
    const label = `${fact.a.type}.${fact.a.terminal} and ${fact.b.type}.${fact.b.terminal}`;
    if (terminalKeys(model, fact.a).length === 0 || terminalKeys(model, fact.b).length === 0) return `${label}: device missing`;
    const seen = new Set(keys.map((k) => nets.get(k) ?? `unconnected:${k}`));
    return seen.size === 1 ? null : `${label} are not all on one net`;
  }
  if (fact.kind === 'fedFromPanel') {
    const devices = model.devices.filter((d) => d.type === fact.type);
    if (devices.length === 0) return `${fact.type}: device missing`;
    const panels = new Set(model.boxes.filter((b) => b.kind === 'panel').map((b) => b.id));
    const stray = devices.filter((d) => !model.cables.some((c) => c.to === d.box && panels.has(c.from)));
    return stray.length === 0 ? null : `${fact.type} box is not fed directly from the panel by a cable (${stray.map((d) => d.id).join(', ')})`;
  }
  if (fact.kind === 'netRoles') {
    const devices = model.devices.filter((d) => d.type === fact.at.type);
    const label = `${fact.at.type}.${fact.at.terminal}`;
    if (devices.length === 0) return `${label}: device missing`;
    const analysis = analyzeNets(model);
    const got: Record<string, number> = {};
    for (const d of devices) {
      const role = analysis.netOfTerminal(d.id, fact.at.terminal)?.role ?? 'unconnected';
      got[role] = (got[role] ?? 0) + 1;
    }
    const want = Object.fromEntries(Object.entries(fact.roles).filter(([, n]) => n));
    const fmt = (o: Record<string, number>) => Object.entries(o).sort().map(([k, n]) => `${k} x${n}`).join(', ');
    return fmt(got) === fmt(want) ? null : `${label} net roles: expected ${fmt(want)}, got ${fmt(got)}`;
  }
  const bars = model.devices.filter((d) => d.type === 'ground_bar');
  if (bars.length === 0) return 'no ground bar';
  const barNets = new Set(bars.map((d) => nets.get(`t:${d.id}.ground_bar`)));
  const stray: string[] = [];
  for (const d of model.devices) {
    if (d.type === 'ground_bar') continue;
    const def = CATALOGUE[d.type as keyof typeof CATALOGUE];
    for (const t of def?.terminals ?? []) {
      if (t.role !== 'ground') continue;
      const n = nets.get(`t:${d.id}.${t.name}`);
      if (!n || !barNets.has(n)) stray.push(`${d.id}.${t.name}`);
    }
  }
  return stray.length === 0 && barNets.size === 1 && !barNets.has(undefined) ? null : `ground terminals not bonded to the ground bar: ${stray.join(', ') || 'bar itself unconnected or split'}`;
}

const blockTypes = (blocks: readonly { type: string }[]) => blocks.map((b) => b.type).join(' + ') || '(none)';

/** Compares the model's block list with the expected one: same length and order, same type, and every field the case names. Null when equal. */
function compareBlocks(want: readonly BlockExpect[], got: readonly Block[]): { pattern: string; reason: string } | null {
  if (want.length !== got.length) return { pattern: 'wrong blocks', reason: `expected ${blockTypes(want)}, got ${blockTypes(got)}` };
  for (const [i, w] of want.entries()) {
    const g = got[i] as Record<string, unknown>;
    if (g.type !== w.type) return { pattern: 'wrong blocks', reason: `block ${i + 1}: expected ${w.type}, got ${String(g.type)}` };
    for (const key of ['count', 'countA', 'countB', 'gfciFirst'] as const) {
      if (w[key] === undefined) continue;
      if (g[key] !== w[key]) return { pattern: 'wrong parameter', reason: `block ${i + 1} (${w.type}) ${key}: expected ${JSON.stringify(w[key])}, got ${JSON.stringify(g[key])}` };
    }
  }
  return null;
}

export function gradeOutcome(expect: Expect, outcome: ChatOutcome): Grade {
  if (outcome.kind === 'failed') {
    const rules = outcome.findings ? ` (${[...new Set(outcome.findings.map((f) => f.ruleId))].join(', ')})` : '';
    return bad(`failed:${outcome.code}`, `loop failed with ${outcome.code}${rules}`);
  }

  switch (expect.kind) {
    case 'question':
      return outcome.kind === 'question' ? ok('asked') : bad(outcome.kind === 'unsupported' ? 'declined instead of asking' : 'guessed instead of asking', `got ${describe(outcome)}`);
    case 'unsupported':
      return outcome.kind === 'unsupported' ? ok('declined') : bad(outcome.kind === 'question' ? 'asked instead of declining' : 'built a circuit for unsupported work', `got ${describe(outcome)}`);
    case 'not_blocks': {
      if (outcome.kind === 'circuit' && outcome.origin.kind === 'blocks' && compareBlocks(expect.forbidden, outcome.origin.blocks) === null)
        return bad('fell for trap', `used forbidden blocks ${blockTypes(expect.forbidden)}`);
      return ok(`not ${blockTypes(expect.forbidden)} (${describe(outcome)})`);
    }
    case 'blocks': {
      if (outcome.kind !== 'circuit') return bad(outcome.kind === 'question' ? 'asked instead of choosing' : 'declined a supported job', `got ${describe(outcome)}`);
      if (outcome.origin.kind !== 'blocks') return bad('custom instead of blocks', 'used a custom circuit');
      const diff = compareBlocks(expect.blocks, outcome.origin.blocks);
      if (diff) return bad(diff.pattern, diff.reason);
      if (expect.breakerAmps !== undefined && outcome.origin.breakerAmps !== expect.breakerAmps)
        return bad('wrong parameter', `breakerAmps: expected ${expect.breakerAmps}, got ${outcome.origin.breakerAmps}`);
      if (expect.target !== undefined && outcome.target !== expect.target) return bad('wrong target', `target: expected ${expect.target}, got ${outcome.target}`);
      return ok(`blocks ${blockTypes(expect.blocks)}`);
    }
    case 'custom': {
      if (outcome.kind !== 'circuit') return bad(outcome.kind === 'question' ? 'asked instead of building' : 'declined a supported job', `got ${describe(outcome)}`);
      if (outcome.origin.kind !== 'custom') return bad('blocks instead of custom', `used blocks ${outcome.origin.kind === 'blocks' ? blockTypes(outcome.origin.blocks) : outcome.origin.kind}`);
      const issues = validateCircuit(outcome.circuit);
      if (issues.length > 0) return bad('invalid circuit', `${issues.length} validation issue(s), first: ${issues[0]!.message}`);
      const errors = checkCircuit(outcome.circuit, { edition: 'nec-2023' }).filter((f) => f.severity === 'error');
      if (errors.length > 0) return bad('custom circuit failed rules', `rule error(s): ${[...new Set(errors.map((f) => f.ruleId))].join(', ')}`);
      for (const [type, n] of Object.entries(expect.deviceCounts)) {
        const have = outcome.circuit.devices.filter((d) => d.type === type).length;
        if (have !== n) return bad('wrong device count', `${type}: expected ${n}, got ${have}`);
      }
      if (expect.breakerAmps !== undefined) {
        const amps = outcome.circuit.devices.find((d) => d.type === 'breaker')?.amps;
        if (amps !== expect.breakerAmps) return bad('wrong breaker size', `expected ${expect.breakerAmps}, got ${amps}`);
      }
      for (const fact of expect.facts) {
        const msg = checkFact(outcome.circuit, fact);
        if (msg) return bad('connectivity fact violated', msg);
      }
      return ok('custom circuit valid and facts hold');
    }
  }
}

export function describe(outcome: ChatOutcome): string {
  switch (outcome.kind) {
    case 'circuit':
      return outcome.origin.kind === 'blocks' ? `blocks ${blockTypes(outcome.origin.blocks)}` : outcome.origin.kind === 'template' ? `template ${outcome.origin.templateId}` : 'custom circuit';
    case 'failed':
      return `failed (${outcome.code})`;
    default:
      return outcome.kind;
  }
}
