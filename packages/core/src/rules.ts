// Deterministic electrical rule checks, Batch A: wiring logic (ADR-007). Pure: no I/O.
// Messages are our own wording. Citations are unverified starting points (confirmed: false) until the user checks them.
//
// Model assumptions: one 120 V branch circuit with exactly one breaker, one neutral bar and one ground bar,
// all in the panel. Anything else gets a single "cannot evaluate" finding and no other rule runs.
import { CATALOGUE, findTerminal, internalPaths, type DeviceType } from './catalogue';
import { HOT_ROLES, analyzeNets, type CircuitAnalysis, type NetInfo, type NetRole } from './analysis';
import { cableLabel, type CircuitModel, type Connection, type Device, type WireColor } from './schema';
import { validateCircuit } from './validate';

export type Edition = 'nec-2023';
export type Severity = 'error' | 'warning';

export interface Citation {
  edition: Edition;
  /** Section reference(s) from research; null when no citation has been listed for the rule. */
  section: string | null;
  /** Always false until the user has checked the section against the code book. */
  confirmed: false;
}

export interface Finding {
  ruleId: string;
  severity: Severity;
  message: string;
  /** Ids of the devices, cables, boxes, connections involved. */
  involved: string[];
  citation: Citation;
}

export interface RuleInfo {
  id: string;
  title: string;
  /** One sentence, our own wording. */
  statement: string;
  severity: Severity;
  citation: Citation;
}

export interface CheckOptions {
  edition: Edition;
}

interface Draft {
  message: string;
  involved: string[];
  /** Overrides the rule's severity for this one finding. */
  severity?: Severity;
}

interface Ctx {
  model: CircuitModel;
  analysis: CircuitAnalysis;
  device(id: string): Device;
  /** `Label (id)` */
  dev(id: string): string;
  cable(id: string): string;
}

type Check = (ctx: Ctx) => Draft[];

const cite = (section: string | null): Citation => ({ edition: 'nec-2023', section, confirmed: false });

/**
 * Loads, derived from the catalogue so a new device cannot be missed: a device with a hot and a neutral terminal
 * and no internal current path (the breaker has no neutral; switches and the GFCI have internal paths).
 */
const LOAD_TYPES: readonly DeviceType[] = (Object.keys(CATALOGUE) as DeviceType[]).filter(
  (t) =>
    CATALOGUE[t].terminals.some((x) => x.role === 'hot') &&
    CATALOGUE[t].terminals.some((x) => x.role === 'neutral') &&
    internalPaths(t).length === 0,
);
const SWITCH_TYPES: readonly DeviceType[] = ['switch_sp', 'switch_3way'];

const HOT_LIKE: readonly NetRole[] = [...HOT_ROLES, 'traveler'];
const isNeutralNet = (n: NetInfo) => n.anchors.includes('neutral') || n.role === 'protected_neutral';
const isGroundNet = (n: NetInfo) => n.anchors.includes('ground');
const isHotNet = (n: NetInfo) => HOT_ROLES.includes(n.role);

/** Colours of a wire: its own colour plus the insulation colour of any cable conductor it lands on. */
function wireColours(c: Connection): Set<WireColor> {
  const s = new Set<WireColor>([c.color]);
  for (const e of [c.a, c.b]) if (e.kind === 'conductor') s.add(e.color);
  return s;
}

function wireIds(c: Connection): string[] {
  return [c.id, ...[c.a, c.b].flatMap((e) => (e.kind === 'conductor' ? [e.cable] : []))];
}

function terminalsOf(device: Device, role: string) {
  return CATALOGUE[device.type].terminals.filter((t) => t.role === role);
}

function netDescription(net: NetInfo | undefined): string {
  if (!net) return 'not connected to anything';
  switch (net.role) {
    case 'source_hot':
      return 'on the breaker hot';
    case 'neutral':
      return 'on the neutral';
    case 'ground':
      return 'on the ground';
    case 'switched_hot':
      return 'on a switched hot';
    case 'protected_hot':
      return 'on a GFCI-protected hot';
    case 'protected_neutral':
      return 'on a GFCI-protected neutral';
    case 'traveler':
      return 'on a 3-way traveler';
    case 'floating':
      return 'not connected to the breaker, neutral or ground';
  }
}

// ---------------------------------------------------------------------------------------------------
// Rules

const groundContinuity: Check = (ctx) => {
  const out: Draft[] = [];
  for (const d of ctx.model.devices) {
    if (d.type === 'ground_bar') continue;
    for (const t of terminalsOf(d, 'ground')) {
      const net = ctx.analysis.netOfTerminal(d.id, t.name);
      if (!net || !isGroundNet(net))
        out.push({
          message: `${ctx.dev(d.id)} terminal ${t.name} is not connected to the ground bar (it is ${netDescription(net)}). Connect it to the bare ground conductors.`,
          involved: [d.id],
        });
    }
  }
  for (const cable of ctx.model.cables) {
    const net = ctx.analysis.netOfConductor(cable.id, 'bare');
    if (!net || !isGroundNet(net))
      out.push({
        message: `The bare ground conductor of ${ctx.cable(cable.id)} does not reach the ground bar (it is ${netDescription(net)}).`,
        involved: [cable.id],
      });
  }
  return out;
};

const groundConductorsOnly: Check = (ctx) => {
  const out: Draft[] = [];
  for (const c of ctx.model.connections) {
    const net = ctx.analysis.netOfConnection(c.id)!;
    const colours = wireColours(c);
    if (isGroundNet(net)) {
      const bad = [...colours].filter((x) => x !== 'bare' && x !== 'green');
      if (bad.length > 0)
        out.push({
          message: `Wire ${c.id} (${[...colours].join('/')}) is on the ground net but is not bare or green. Only bare or green conductors may carry ground.`,
          involved: wireIds(c),
        });
    } else {
      const bad = [...colours].filter((x) => x === 'bare' || x === 'green');
      if (bad.length > 0)
        out.push({
          message: `Wire ${c.id} (${bad.join('/')}) is bare or green but is ${netDescription(net)}, not on the ground net. Bare and green conductors may only be used for ground.`,
          involved: wireIds(c),
        });
    }
  }
  return out;
};

const noShort: Check = (ctx) => {
  const out: Draft[] = [];
  const names = { source_hot: 'the breaker hot', neutral: 'the neutral bar', ground: 'the ground bar' } as const;
  for (const net of ctx.analysis.nets) {
    if (net.anchors.length < 2) continue;
    const devs = [...new Set(net.terminals.map((t) => t.device))].filter((id) =>
      ['breaker', 'neutral_bar', 'ground_bar'].includes(ctx.device(id).type),
    );
    out.push({
      message: `Short circuit: ${net.anchors.map((a) => names[a]).join(' and ')} are joined on the same net.`,
      involved: devs,
    });
  }
  for (const d of ctx.model.devices) {
    for (const path of internalPaths(d.type)) {
      if (path.kind !== 'switched') continue;
      const a = ctx.analysis.netOfTerminal(d.id, path.from);
      const b = ctx.analysis.netOfTerminal(d.id, path.to);
      if (!a || !b || a === b) continue;
      for (const [hot, other] of [[a, b], [b, a]] as const) {
        const hotSide = hot.live && !isNeutralNet(hot) && !isGroundNet(hot);
        if (hotSide && !other.anchors.includes('source_hot') && (other.anchors.includes('neutral') || other.anchors.includes('ground'))) {
          const which = other.anchors.includes('neutral') ? 'neutral' : 'ground';
          const hotT = hot === a ? path.from : path.to;
          const otherT = hot === a ? path.to : path.from;
          out.push({
            message: `${ctx.dev(d.id)} joins a hot (terminal ${hotT}) directly to the ${which} (terminal ${otherT}); closing it would short the circuit.`,
            involved: [d.id],
          });
        }
      }
    }
  }
  return out;
};

const neutralContinuity: Check = (ctx) => {
  const out: Draft[] = [];
  for (const d of ctx.model.devices) {
    if (d.type === 'neutral_bar') continue;
    for (const t of terminalsOf(d, 'neutral')) {
      const net = ctx.analysis.netOfTerminal(d.id, t.name);
      // a GFCI load terminal may be left unused; gfci-orientation checks the load pair
      if (d.type === 'gfci' && t.name.startsWith('load_') && !net) continue;
      if (!net || !isNeutralNet(net))
        out.push({
          message: `${ctx.dev(d.id)} neutral terminal ${t.name} does not reach the neutral bar (it is ${netDescription(net)}).`,
          involved: [d.id],
        });
    }
  }
  return out;
};

const neutralNotSwitched: Check = (ctx) => {
  const out: Draft[] = [];
  for (const d of ctx.model.devices) {
    if (!SWITCH_TYPES.includes(d.type)) continue;
    const bad = CATALOGUE[d.type].terminals
      .filter((t) => t.role !== 'ground')
      .filter((t) => {
        const net = ctx.analysis.netOfTerminal(d.id, t.name);
        return net !== undefined && isNeutralNet(net);
      })
      .map((t) => t.name);
    if (bad.length > 0)
      out.push({
        message: `${ctx.dev(d.id)} is wired into the neutral (terminal ${bad.join(', ')}). Only the hot conductor may go through a switch; the neutral must run through unbroken.`,
        involved: [d.id],
      });
  }
  return out;
};

const loadFed: Check = (ctx) => {
  const out: Draft[] = [];
  for (const d of ctx.model.devices) {
    if (!LOAD_TYPES.includes(d.type)) continue;
    for (const t of terminalsOf(d, 'hot')) {
      const net = ctx.analysis.netOfTerminal(d.id, t.name);
      if (!net || !isHotNet(net))
        out.push({
          message: `${ctx.dev(d.id)} hot terminal ${t.name} is not fed from the breaker (it is ${netDescription(net)}).`,
          involved: [d.id],
        });
    }
  }
  return out;
};

const threeWayPairing: Check = (ctx) => {
  const out: Draft[] = [];
  const partner = new Map<string, string>();
  const threeWays = ctx.model.devices.filter((d) => d.type === 'switch_3way');
  for (const d of threeWays) {
    const others = new Set<string>();
    const problems: string[] = [];
    for (const t of ['traveler_a', 'traveler_b']) {
      const net = ctx.analysis.netOfTerminal(d.id, t);
      if (!net) {
        problems.push(`${t} is not connected`);
        continue;
      }
      const rest = net.terminals.filter((x) => !(x.device === d.id && x.terminal === t));
      if (net.terminals.length !== 2 || rest.length !== 1) {
        problems.push(`${t} shares its net with ${net.terminals.length - 1} other device terminal(s); it must go to exactly one other 3-way traveler and nothing else`);
        continue;
      }
      const o = rest[0]!;
      const od = ctx.device(o.device);
      if (od.id === d.id) problems.push(`${t} is connected to the other traveler of the same switch`);
      else if (od.type !== 'switch_3way' || findTerminal(od.type, o.terminal)?.role !== 'traveler')
        problems.push(`${t} goes to ${ctx.dev(od.id)} terminal ${o.terminal}, which is not a 3-way traveler`);
      else others.add(od.id);
    }
    if (problems.length === 0 && others.size > 1)
      problems.push(`its travelers go to different switches (${[...others].map((o) => ctx.dev(o)).join(', ')})`);
    if (problems.length > 0)
      out.push({
        message: `${ctx.dev(d.id)}: the two travelers must connect one-to-one to the two travelers of one other 3-way switch. ${problems.join('; ')}.`,
        involved: [d.id, ...others],
      });
    else partner.set(d.id, [...others][0]!);
  }

  const checked = new Set<string>();
  for (const d of threeWays) {
    const e = partner.get(d.id);
    if (!e || checked.has(d.id) || partner.get(e) !== d.id) continue;
    checked.add(d.id);
    checked.add(e);
    const dc = ctx.analysis.netOfTerminal(d.id, 'common');
    const ec = ctx.analysis.netOfTerminal(e, 'common');
    const pairName = `${ctx.dev(d.id)} and ${ctx.dev(e)}`;
    if (!dc || !ec) {
      out.push({
        message: `${pairName}: each 3-way's common terminal must be connected (one to the breaker side, one toward the load).`,
        involved: [d.id, e],
      });
      continue;
    }
    // is each common fed from the breaker without help from this pair's own switch paths?
    const excl = analyzeNets(ctx.model, { ignoreDevices: new Set([d.id, e]) });
    const fedD = excl.netOfTerminal(d.id, 'common')!.live;
    const fedE = excl.netOfTerminal(e, 'common')!.live;
    if (fedD === fedE) {
      out.push({
        message: fedD
          ? `${pairName}: both common terminals are fed from the breaker. One common must be the feed and the other must lead to the load.`
          : `${pairName}: neither common terminal is fed from the breaker. One common must be on the feed hot.`,
        involved: [d.id, e],
      });
      continue;
    }
    const [loadSide, loadNet] = fedD ? [e, ec] : [d.id, dc];
    const leadsOn = loadNet.terminals.some((t) => {
      if (t.device === d.id || t.device === e) return false;
      const td = ctx.device(t.device);
      const role = findTerminal(td.type, t.terminal)?.role;
      return (
        (LOAD_TYPES.includes(td.type) && role === 'hot') ||
        (SWITCH_TYPES.includes(td.type) && role !== 'ground') ||
        (td.type === 'gfci' && t.terminal === 'line_hot')
      );
    });
    if (!leadsOn)
      out.push({
        message: `${pairName}: the common terminal of ${ctx.dev(loadSide)} does not lead to a load.`,
        involved: [d.id, e],
      });
  }
  return out;
};

const gfciOrientation: Check = (ctx) => {
  const out: Draft[] = [];
  for (const g of ctx.model.devices) {
    if (g.type !== 'gfci') continue;
    const excl = analyzeNets(ctx.model, { ignoreDevices: new Set([g.id]) });
    const here = (msg: string): Draft => ({ message: `${ctx.dev(g.id)}: ${msg}`, involved: [g.id] });
    const lineHot = excl.netOfTerminal(g.id, 'line_hot');
    const lineNeutral = excl.netOfTerminal(g.id, 'line_neutral');
    if (!lineHot?.live || isNeutralNet(lineHot) || isGroundNet(lineHot))
      out.push(here(`LINE hot terminal is not fed from the breaker (it is ${netDescription(lineHot)}). The feed must go on the LINE terminals.`));
    if (!lineNeutral || !isNeutralNet(lineNeutral))
      out.push(here(`LINE neutral terminal is not on the neutral (it is ${netDescription(lineNeutral)}).`));

    const loadHot = ctx.analysis.netOfTerminal(g.id, 'load_hot');
    const loadNeutral = ctx.analysis.netOfTerminal(g.id, 'load_neutral');
    if (!loadHot !== !loadNeutral)
      out.push(here(`only one of the LOAD terminals is used (${loadHot ? 'load_hot' : 'load_neutral'}); use both LOAD terminals or neither.`));
    const realHot = ctx.analysis.netOfTerminal(g.id, 'line_hot');
    const realNeutral = ctx.analysis.netOfTerminal(g.id, 'line_neutral');
    if (loadHot && (loadHot === realHot || loadHot.anchors.length > 0))
      out.push(here(`LOAD hot terminal is tied back to the line side (it is ${netDescription(loadHot)}). LOAD terminals must only feed downstream devices.`));
    if (loadNeutral && (loadNeutral === realNeutral || loadNeutral.anchors.length > 0))
      out.push(here(`LOAD neutral terminal is tied back to the neutral bus (it is ${netDescription(loadNeutral)}). LOAD terminals must only feed downstream devices.`));
  }
  return out;
};

/** Smallest-conductor limits for small conductors: AWG -> max breaker amps. */
const MAX_AMPS_FOR_AWG: Record<number, number> = { 14: 15, 12: 20, 10: 30 };
const STANDARD_AMPS = [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100];

const breakerConductorMatch: Check = (ctx) => {
  const out: Draft[] = [];
  const awg = (c: { type: string }) => Number(c.type.split('/')[0]);
  if (ctx.model.cables.length === 0) return out;
  const smallest = Math.max(...ctx.model.cables.map(awg)); // larger AWG number = smaller conductor
  const smallCables = ctx.model.cables.filter((c) => awg(c) === smallest);
  const limit = MAX_AMPS_FOR_AWG[smallest];
  for (const d of ctx.model.devices) {
    if (d.type !== 'breaker' || d.amps === undefined) continue;
    if (!STANDARD_AMPS.includes(d.amps))
      out.push({
        message: `${ctx.dev(d.id)} has a rating (${d.amps} A) that is not a standard breaker size this checker knows.`,
        involved: [d.id],
      });
    if (limit === undefined)
      out.push({
        message: `The smallest conductor on the circuit is ${smallest} AWG (${smallCables.map((c) => ctx.cable(c.id)).join(', ')}), which this checker has no breaker limit for.`,
        involved: [d.id, ...smallCables.map((c) => c.id)],
      });
    else if (d.amps > limit)
      out.push({
        message: `${ctx.dev(d.id)} is rated ${d.amps} A but the smallest conductor on the circuit is ${smallest} AWG (${smallCables.map((c) => ctx.cable(c.id)).join(', ')}), which allows at most ${limit} A.`,
        involved: [d.id, ...smallCables.map((c) => c.id)],
      });
  }
  return out;
};

const wireColourRole: Check = (ctx) => {
  const out: Draft[] = [];
  for (const c of ctx.model.connections) {
    const net = ctx.analysis.netOfConnection(c.id)!;
    const colours = wireColours(c);
    if (isNeutralNet(net) && (colours.has('black') || colours.has('red')))
      out.push({
        message: `Wire ${c.id} is ${colours.has('black') ? 'black' : 'red'} but is on the neutral. Black and red conductors are for hot; the neutral must be white.`,
        involved: wireIds(c),
      });
    else if (!isNeutralNet(net) && colours.has('white') && HOT_LIKE.includes(net.role))
      out.push({
        message: `Wire ${c.id} is white but is used as a hot, switched or traveler conductor (${netDescription(net)}). A white conductor used this way must be re-marked (for example with black tape) at both ends.`,
        involved: wireIds(c),
        severity: 'warning',
      });
  }
  return out;
};

const neutralAtSwitchBox: Check = (ctx) => {
  const out: Draft[] = [];
  for (const box of ctx.model.boxes) {
    const switches = ctx.model.devices.filter((d) => d.box === box.id && SWITCH_TYPES.includes(d.type));
    if (switches.length === 0) continue;
    const present = ctx.model.connections.some((c) => {
      const net = ctx.analysis.netOfConnection(c.id)!;
      return isNeutralNet(net) && [c.a, c.b].some((e) => e.kind === 'conductor' && e.box === box.id);
    });
    if (!present)
      out.push({
        message: `${box.label} (${box.id}) holds ${switches.map((s) => ctx.dev(s.id)).join(', ')} but no neutral conductor reaches the box.`,
        involved: [box.id, ...switches.map((s) => s.id)],
      });
  }
  return out;
};

const floatingConductors: Check = (ctx) => {
  const out: Draft[] = [];
  for (const net of ctx.analysis.nets) {
    if (net.role !== 'floating' || net.terminals.length === 0) continue;
    const devs = [...new Set(net.terminals.map((t) => t.device))];
    out.push({
      message: `Conductors connected to ${devs.map((id) => ctx.dev(id)).join(', ')} are not connected to the breaker, neutral or ground, so they carry nothing.`,
      involved: devs,
    });
  }
  return out;
};

// ---------------------------------------------------------------------------------------------------
// Registry

interface RuleDef extends RuleInfo {
  check: Check;
}

const RULE_DEFS: RuleDef[] = [
  {
    id: 'ground-continuity',
    title: 'Ground continuity',
    statement: 'Every device ground terminal and every cable bare conductor is connected to the ground bar.',
    severity: 'error',
    citation: cite('250.4(A)(5) / 250.148 / 404.9(B) / 406.4(A)'),
    check: groundContinuity,
  },
  {
    id: 'ground-conductors-only',
    title: 'Ground conductors only',
    statement: 'Only bare or green wires are on the ground net, and bare or green wires are on no other net.',
    severity: 'error',
    citation: cite('250.119'),
    check: groundConductorsOnly,
  },
  {
    id: 'no-short',
    title: 'No short circuits',
    statement: 'The breaker hot, neutral bar and ground bar are never joined, and no switch joins a hot directly to the neutral or ground.',
    severity: 'error',
    citation: cite(null),
    check: noShort,
  },
  {
    id: 'neutral-continuity',
    title: 'Neutral continuity',
    statement: 'Every neutral terminal reaches the neutral bar, directly or through the neutral side of a correctly fed GFCI.',
    severity: 'error',
    citation: cite(null),
    check: neutralContinuity,
  },
  {
    id: 'neutral-not-switched',
    title: 'Neutral not switched',
    statement: 'No switch terminal is on the neutral; only the hot conductor is switched.',
    severity: 'error',
    citation: cite('404.2(B)'),
    check: neutralNotSwitched,
  },
  {
    id: 'load-fed',
    title: 'Loads are fed',
    statement: 'Every light and receptacle hot terminal can be reached from the breaker, directly or through switches or a GFCI.',
    severity: 'error',
    citation: cite(null),
    check: loadFed,
  },
  {
    id: 'three-way-pairing',
    title: '3-way switch pairing',
    statement: 'Each 3-way switch has its two travelers wired one-to-one to the two travelers of one other 3-way, with one common on the feed and the other leading to the load.',
    severity: 'error',
    citation: cite('404.2(A)'),
    check: threeWayPairing,
  },
  {
    id: 'gfci-orientation',
    title: 'GFCI line and load',
    statement: 'The GFCI feed is on its LINE terminals, the LOAD terminals are both used or both unused, and LOAD never connects back to the feed or neutral.',
    severity: 'error',
    citation: cite('110.3(B)'),
    check: gfciOrientation,
  },
  {
    id: 'breaker-conductor-match',
    title: 'Breaker size matches conductor size',
    statement: 'The breaker rating does not exceed the limit for the smallest conductor on the circuit (14 AWG: 15 A, 12 AWG: 20 A, 10 AWG: 30 A), and is a known rating.',
    severity: 'error',
    citation: cite('240.4(D)'),
    check: breakerConductorMatch,
  },
  {
    id: 'wire-colour-role',
    title: 'Wire colour matches role',
    statement: 'Black and red wires are never on the neutral (error); a white wire used as a hot, switched or traveler conductor needs re-marking (reported as a warning).',
    severity: 'error',
    citation: cite('200.6 / 200.7(C)'),
    check: wireColourRole,
  },
  {
    id: 'neutral-at-switch-box',
    title: 'Neutral at switch boxes',
    statement: 'Every box that contains a switch has a neutral conductor present.',
    severity: 'warning',
    citation: cite('404.2(C)'),
    check: neutralAtSwitchBox,
  },
  {
    id: 'floating-conductors',
    title: 'Floating conductors',
    statement: 'No device terminal sits on a net that is connected to none of the breaker, neutral or ground.',
    severity: 'warning',
    citation: cite(null),
    check: floatingConductors,
  },
];

/** Meta findings (not wiring rules); listed so every finding's rule id is in the registry. */
const META_RULES: RuleInfo[] = [
  {
    id: 'circuit-valid',
    title: 'Circuit is structurally valid',
    statement: 'The circuit passes structural validation before any electrical rule runs.',
    severity: 'error',
    citation: cite(null),
  },
  {
    id: 'model-assumptions',
    title: 'Circuit is within the checker assumptions',
    statement: 'The circuit has exactly one breaker, one neutral bar and one ground bar, all in the panel.',
    severity: 'error',
    citation: cite(null),
  },
];

/** Every rule the engine can report, in evaluation order (meta rules first). */
export const RULES: readonly RuleInfo[] = [
  ...META_RULES,
  ...RULE_DEFS.map(({ id, title, statement, severity, citation }) => ({ id, title, statement, severity, citation })),
];

const info = (id: string): RuleInfo => RULES.find((r) => r.id === id)!;

function finding(ruleId: string, severity: Severity, draft: Draft): Finding {
  return {
    ruleId,
    severity: draft.severity ?? severity,
    message: draft.message,
    involved: [...new Set(draft.involved)],
    citation: { ...info(ruleId).citation },
  };
}

function modelProblems(model: CircuitModel): Draft | undefined {
  const panelBoxes = new Set(model.boxes.filter((b) => b.kind === 'panel').map((b) => b.id));
  const problems: string[] = [];
  const involved: string[] = [];
  for (const [type, name] of [['breaker', 'breaker'], ['neutral_bar', 'neutral bar'], ['ground_bar', 'ground bar']] as const) {
    const ds = model.devices.filter((d) => d.type === type);
    if (ds.length !== 1) problems.push(`it has ${ds.length} ${name}s, the checker needs exactly 1`);
    for (const d of ds) {
      involved.push(d.id);
      if (!panelBoxes.has(d.box)) problems.push(`${name} "${d.id}" is not in a panel box`);
    }
  }
  return problems.length === 0
    ? undefined
    : {
        message: `The electrical rules cannot evaluate this circuit: it must be one 120 V branch circuit with one breaker, one neutral bar and one ground bar, all in the panel, but ${problems.join('; ')}.`,
        involved,
      };
}

/**
 * Check a circuit against the Batch A rules. Findings come in registry order, then model order within a rule.
 * Refuses (one finding) if the circuit is structurally invalid or outside the model assumptions.
 */
export function checkCircuit(model: CircuitModel, options: CheckOptions): Finding[] {
  if (options.edition !== 'nec-2023') throw new Error(`unsupported edition: ${String(options.edition)}`);
  const issues = validateCircuit(model);
  if (issues.length > 0)
    return [
      finding('circuit-valid', 'error', {
        message: `The electrical rules cannot evaluate this circuit because it is structurally invalid (${issues.length} problem(s)): ${issues
          .slice(0, 3)
          .map((i) => i.message)
          .join('; ')}${issues.length > 3 ? '; ...' : ''}.`,
        involved: issues.flatMap((i) => i.ids),
      }),
    ];
  const problem = modelProblems(model);
  if (problem) return [finding('model-assumptions', 'error', problem)];

  const devices = new Map(model.devices.map((d) => [d.id, d]));
  const cables = new Map(model.cables.map((c) => [c.id, c]));
  const ctx: Ctx = {
    model,
    analysis: analyzeNets(model),
    device: (id) => devices.get(id)!,
    dev: (id) => `${devices.get(id)!.label} (${id})`,
    cable: (id) => `${cableLabel(cables.get(id)!)} (${id})`,
  };
  return RULE_DEFS.flatMap((r) => r.check(ctx).map((d) => finding(r.id, r.severity, d)));
}

/** The user's citation checklist (docs/rules/nec-2023-citations.md), generated from the registry. */
export function citationChecklistMarkdown(): string {
  const cell = (t: string) => t.replace(/\|/g, '\\|');
  const rows = RULES.map(
    (r) => `| \`${r.id}\` | ${cell(r.statement)} | ${r.severity} | ${r.citation.section ?? 'none listed'} | ${r.citation.confirmed ? 'yes' : 'no'} |`,
  );
  return [
    '# NEC 2023 citation checklist',
    '',
    'Generated from the rule registry in `packages/core/src/rules.ts` (a test keeps this file in sync). Edition: NEC 2023.',
    '',
    '"Confirmed" means you have checked that the cited section really supports the rule, in the code book or with an electrician. Until then every citation is an unverified starting point from research. No code text is reproduced here or in the app: the statements are our own wording.',
    '',
    '| Rule | What it checks | Severity | Cited section | Confirmed |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}
