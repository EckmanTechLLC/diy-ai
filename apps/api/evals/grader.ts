/** Deterministic grading of one chat outcome against one expectation. No network, no LLM. */
import { CATALOGUE, analyzeNets, checkCircuit, computeNets, endpointKey, validateCircuit, type Block, type CircuitModel, type Inventory, type PlanOptions, type Room } from '@diy-ai/core';
import type { ChatOutcome } from '../src/chat/loop';
import type { BlockExpect, CustomFact, Expect, InventoryExpect, RoomExpect, TerminalRef } from './cases';

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

/** A room reduced to what is graded: type, counts, light groups (sorted, so a multiset) and the type of the room it is attached to. Names and ids are the model's choice and are left out. */
interface RoomShape {
  type: string;
  receptacles: number;
  lightGroups: string[];
  fans: number;
  attachedToType: string;
}

const lightGroupKey = (g: { lights: number; switchLocations: number }) => `${g.lights}x${g.switchLocations}`;
const shapeOfWant = (r: RoomExpect): RoomShape => ({ type: r.type, receptacles: r.receptacles, lightGroups: r.lightGroups.map(lightGroupKey).sort(), fans: r.fans, attachedToType: r.attachedToType ?? '' });
function shapeOfGot(r: Room, all: readonly Room[]): RoomShape {
  const target = r.attachedTo === '' ? undefined : all.find((x) => x.id === r.attachedTo);
  return { type: r.type, receptacles: r.receptacles, lightGroups: r.lightGroups.map(lightGroupKey).sort(), fans: r.fans, attachedToType: r.attachedTo === '' ? '' : (target?.type ?? 'unknown room') };
}
const shapeKey = (s: RoomShape) => `${s.type}|rec ${s.receptacles}|lights [${s.lightGroups.join(', ')}]|fans ${s.fans}|attached to ${s.attachedToType || '-'}`;

/** Compares an inventory with the expected one. Rooms are matched as a multiset of shapes; null when equal. */
function compareInventory(want: InventoryExpect, got: Inventory, edit: boolean): { pattern: string; reason: string } | null {
  const wantShapes = want.rooms.map(shapeOfWant);
  const gotShapes = got.rooms.map((r) => shapeOfGot(r, got.rooms));
  if (wantShapes.length !== gotShapes.length) {
    const fewer = gotShapes.length < wantShapes.length;
    return {
      pattern: fewer ? (edit ? 'delta instead of full inventory' : 'dropped room') : 'extra room',
      reason: `expected ${wantShapes.length} room(s) [${wantShapes.map(shapeKey).join(' ; ')}], got ${gotShapes.length} [${gotShapes.map(shapeKey).join(' ; ')}]`,
    };
  }
  // Remove exact matches, then pair what is left (same type first) to say what differs.
  const leftWant: RoomShape[] = [];
  const leftGot = [...gotShapes];
  for (const w of wantShapes) {
    const i = leftGot.findIndex((g) => shapeKey(g) === shapeKey(w));
    if (i >= 0) leftGot.splice(i, 1);
    else leftWant.push(w);
  }
  for (const w of leftWant) {
    const i = Math.max(0, leftGot.findIndex((g) => g.type === w.type));
    const g = leftGot.splice(i, 1)[0]!;
    if (g.type !== w.type) return { pattern: 'wrong room type', reason: `expected a ${w.type} room [${shapeKey(w)}], got ${g.type} [${shapeKey(g)}]` };
    const detail = `room ${w.type}: expected [${shapeKey(w)}], got [${shapeKey(g)}]`;
    if (g.receptacles !== w.receptacles || g.fans !== w.fans) return { pattern: 'wrong count', reason: detail };
    if (g.lightGroups.join() !== w.lightGroups.join()) return { pattern: 'wrong light groups', reason: detail };
    return { pattern: 'wrong attachment', reason: detail };
  }
  if (got.basement !== want.basement) return { pattern: 'wrong basement flag', reason: `basement: expected ${want.basement}, got ${got.basement}` };
  return null;
}

/** Compact record of an inventory outcome for the result files. Names are kept for reading only. */
export function summariseInventory(inventory: Inventory, options: PlanOptions) {
  return {
    basement: inventory.basement,
    rooms: inventory.rooms.map((r) => {
      const s = shapeOfGot(r, inventory.rooms);
      return { name: r.name, type: r.type, receptacles: r.receptacles, lightGroups: r.lightGroups.map(lightGroupKey), fans: r.fans, attachedToType: s.attachedToType };
    }),
    options,
  };
}

/** Failure for an outcome that is not a circuit when the case wanted a circuit: asked, declined, or routed to the wrong kind. */
function notACircuit(outcome: ChatOutcome, question: string): Grade {
  if (outcome.kind === 'question') return bad(question, `got ${describe(outcome)}`);
  if (outcome.kind === 'inventory') return bad('wrong routing', `got an inventory (${describe(outcome)}) instead of a circuit`);
  if (outcome.kind === 'build' || outcome.kind === 'build_blocked') return bad('wrong routing', `got ${describe(outcome)} instead of a circuit`);
  return bad('declined a supported job', `got ${describe(outcome)}`);
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
      if (outcome.kind !== 'circuit') return notACircuit(outcome, 'asked instead of choosing');
      if (outcome.origin.kind !== 'blocks') return bad('custom instead of blocks', 'used a custom circuit');
      const diff = compareBlocks(expect.blocks, outcome.origin.blocks);
      if (diff) return bad(diff.pattern, diff.reason);
      if (expect.breakerAmps !== undefined && outcome.origin.breakerAmps !== expect.breakerAmps)
        return bad('wrong parameter', `breakerAmps: expected ${expect.breakerAmps}, got ${outcome.origin.breakerAmps}`);
      if (expect.target !== undefined && outcome.target !== expect.target) return bad('wrong target', `target: expected ${expect.target}, got ${outcome.target}`);
      return ok(`blocks ${blockTypes(expect.blocks)}`);
    }
    case 'inventory': {
      if (outcome.kind !== 'inventory') {
        if (outcome.kind === 'question') return bad('asked instead of planning', `got ${describe(outcome)}`);
        if (outcome.kind === 'circuit' || outcome.kind === 'build' || outcome.kind === 'build_blocked') return bad('wrong routing', `got ${describe(outcome)} instead of an inventory`);
        return bad('declined a supported job', `got ${describe(outcome)}`);
      }
      const diff = compareInventory(expect.inventory, outcome.inventory, expect.edit ?? false);
      if (diff) return bad(diff.pattern, diff.reason);
      const o = expect.options;
      if (o?.maxReceptaclesPerCircuit !== undefined && (outcome.options.maxReceptaclesPerCircuit ?? 0) !== o.maxReceptaclesPerCircuit)
        return bad('wrong option', `maxReceptaclesPerCircuit: expected ${o.maxReceptaclesPerCircuit}, got ${outcome.options.maxReceptaclesPerCircuit ?? 'default'}`);
      if (o?.lightingBreakerAmps !== undefined && outcome.options.lightingBreakerAmps !== o.lightingBreakerAmps)
        return bad('wrong option', `lightingBreakerAmps: expected ${o.lightingBreakerAmps}, got ${outcome.options.lightingBreakerAmps ?? 'default'}`);
      return ok(`inventory of ${outcome.inventory.rooms.length} room(s)`);
    }
    case 'build':
      if (outcome.kind === 'build') return ok(`built ${outcome.circuits.length} circuit(s)`);
      if (outcome.kind === 'question') return bad('asked instead of building', `got ${describe(outcome)}`);
      if (outcome.kind === 'inventory') return bad('revised inventory instead of building', `got ${describe(outcome)}`);
      if (outcome.kind === 'build_blocked') return bad('build blocked', `the loop refused the build: ${outcome.text}`);
      return bad('wrong routing', `got ${describe(outcome)}`);
    case 'not_build':
      if (outcome.kind === 'question') return ok('asked');
      if (outcome.kind === 'build_blocked') return bad('built without a plan', `model replied build with nothing to build (${describe(outcome)})`);
      if (outcome.kind === 'build') return bad('built without a plan', `got ${describe(outcome)}`);
      return bad('wrong routing', `got ${describe(outcome)}`);
    case 'custom': {
      if (outcome.kind !== 'circuit') return notACircuit(outcome, 'asked instead of building');
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
    case 'inventory':
      return `inventory ${outcome.inventory.rooms.length} room(s)`;
    case 'build':
      return `build ${outcome.circuits.length} circuit(s)`;
    case 'failed':
      return `failed (${outcome.code})`;
    default:
      return outcome.kind;
  }
}
