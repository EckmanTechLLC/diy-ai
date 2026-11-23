// Installation steps derived mechanically from the circuit's connections (ADR-010). Fixed texts are our own wording.
import type { DeviceType } from '../catalogue';
import type { NetRole } from '../analysis';
import { cableLabel, type Connection, type CircuitModel, type Device, type Endpoint, type WireColor } from '../schema';
import { terminalPhrase } from './phrases';
import { colourName, makeCtx, type BuildPlanOptions, type Ctx } from './shared';

export interface BuildStep {
  /** Stable for the same circuit. */
  id: string;
  text: string;
  /** Box the step happens in; null for steps that are not in one box. */
  box: string | null;
  /** Ids of every device, cable, splice, connection and box the step covers. */
  refs: string[];
  note?: string;
}

export interface StepPhase {
  id: PhaseId;
  title: string;
  steps: BuildStep[];
}

export type PhaseId = 'before' | 'rough-in' | 'make-up' | 'devices' | 'panel' | 'testing';

export interface StepsPlan {
  circuitId: string;
  title: string;
  unverified: boolean;
  phases: StepPhase[];
}

export const PHASE_TITLES: Record<PhaseId, string> = {
  before: 'Before you start',
  'rough-in': 'Rough-in: mount the boxes and pull the cables',
  'make-up': 'Make-up: connect the wires, box by box',
  devices: 'Devices and cover plates',
  panel: 'At the panel, last',
  testing: 'Power-up and testing',
};

export const SAFETY_TEXTS = {
  unverified:
    'This wiring was not built from checked building blocks, so its topology is unverified. Compare every step with the diagram and have a qualified electrician review the wiring before you switch it on.',
  powerOff:
    'Turn off power before you touch the panel or any existing wiring: switch off the main breaker, then use a voltage tester to confirm that every wire you will touch is dead. Test the tester on a known live source first.',
  permit: 'Ask your local building department whether this work needs a permit and an inspection, and arrange them before you start.',
  electrician: 'If a step is unclear, or what you find in the walls differs from this plan, stop and hire a licensed electrician.',
} as const;

export const TESTING_TEXTS = {
  restore: 'Check that every device is mounted and every cover plate is on, then switch the main breaker and this circuit\'s breaker on.',
  receptacles: 'Test every receptacle with a plug-in receptacle tester and confirm that it shows correct wiring.',
  gfciWithLoad: 'Press TEST on the GFCI: it must click and its own slots must lose power, and so must the receptacles after it (check them with the tester). Press RESET to restore power.',
  gfciAlone: 'Press TEST on the GFCI: it must click and its own slots must lose power. Press RESET to restore power.',
  switchOne: 'Operate the switch several times and confirm that the light or fan it controls turns on and off each time.',
  threeWay:
    'Test the pair in all four positions (both up, first up and second down, both down, first down and second up): the load must be on in two of the four positions and off in the other two, and flipping either switch alone must always change it.',
  failure: 'If anything does not behave as described, switch the circuit breaker off again, check the wiring against the diagram, and hire an electrician if you cannot find the cause.',
} as const;

const ROUGH_IN_INSPECTION =
  'If your permit requires a rough-in inspection, have it done now: before the walls are closed and before any device is connected.';
const NOTE_GFCI_LINE = 'LINE terminals take the wires that come from the panel side. Never swap LINE and LOAD.';
const NOTE_GFCI_LOAD = 'LOAD terminals take the wires that go on to the receptacles after this one. Never swap LINE and LOAD.';
const NOTE_3WAY = 'On a 3-way switch the common screw is the dark (black) one; the two brass screws are the travelers. Do not mix them up.';
const NOTE_FIXTURE = 'Fixtures and fans differ; follow the manufacturer\'s instructions for how their connections are made.';
const NOTE_REMARK =
  'This white wire carries a hot or switched current here. Mark it black or red with tape or a marker at both ends, in every box it appears in, so nobody takes it for a neutral.';
const NOTE_PANEL = 'Even with the main breaker off, the service wires in the panel stay live. If you are not experienced, hire an electrician for the panel work.';
const NOTE_FAN_BOX =
  'An exhaust fan\'s housing usually serves as its own box and needs a duct to the outside; follow the fan\'s instructions for mounting it and for the duct.';
const FIXTURE_TYPES: readonly DeviceType[] = ['light', 'fan'];

const HOT_LIKE: readonly NetRole[] = ['source_hot', 'switched_hot', 'protected_hot', 'traveler'];

/** Order of make-up: grounds, then neutrals, then hot, switched, traveler connections. */
function rank(role: NetRole): number {
  switch (role) {
    case 'ground':
      return 0;
    case 'neutral':
    case 'protected_neutral':
      return 1;
    case 'source_hot':
    case 'protected_hot':
      return 2;
    case 'switched_hot':
      return 3;
    case 'traveler':
      return 4;
    default:
      return 5;
  }
}

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? `a ${one}` : `${n} ${many}`);

function list(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const nutKind = (role: NetRole): string =>
  role === 'ground' ? 'ground' : role === 'neutral' || role === 'protected_neutral' ? 'neutral' : role === 'switched_hot' ? 'switched' : role === 'traveler' ? 'traveler' : role === 'floating' ? 'unconnected' : 'hot';

class Writer {
  constructor(private ctx: Ctx) {}

  private role(c: Connection): NetRole {
    return this.ctx.analysis.netOfConnection(c.id)!.role;
  }

  /** "the black wire of 14/2 NM-B "feed"" */
  private conductor(e: Extract<Endpoint, { kind: 'conductor' }>): string {
    return `the ${colourName(e.color)} wire of ${this.ctx.cableRef(e.cable, e.box)}`;
  }

  /** Wire-nut names within a box: "neutral wire nut", numbered when a box has several of one kind. */
  private nutNames = new Map<string, string>();
  nutName(spliceId: string): string {
    if (this.nutNames.size === 0) {
      const perBox = new Map<string, string[]>();
      for (const s of this.ctx.circuit.splices) {
        const first = this.ctx.circuit.connections.find((c) => [c.a, c.b].some((e) => e.kind === 'splice' && e.splice === s.id));
        const kind = first ? nutKind(this.role(first)) : 'unconnected';
        perBox.set(`${s.box}|${kind}`, [...(perBox.get(`${s.box}|${kind}`) ?? []), s.id]);
      }
      for (const [key, ids] of perBox) {
        const kind = key.split('|')[1]!;
        ids.forEach((id, i) => this.nutNames.set(id, ids.length > 1 ? `${kind} wire nut ${i + 1}` : `${kind} wire nut`));
      }
    }
    return this.nutNames.get(spliceId)!;
  }

  private terminalPhrase(d: Device, terminal: string): string {
    return terminalPhrase(d.type, terminal, d.label);
  }

  private terminalNote(d: Device, terminal: string): string | undefined {
    if (d.type === 'gfci') return terminal.startsWith('line_') ? NOTE_GFCI_LINE : terminal.startsWith('load_') ? NOTE_GFCI_LOAD : undefined;
    if (d.type === 'switch_3way' && terminal !== 'ground') return NOTE_3WAY;
    if (d.type === 'breaker') {
      const p = this.ctx.options.protection;
      return `${p === undefined ? '' : p.afci ? 'Use an AFCI breaker for this circuit. ' : 'A standard breaker is enough for this circuit. '}Snap the breaker into an open space in the panel, make sure it fits your panel, and leave it switched off until the testing phase.`;
    }
    return undefined;
  }

  private notes(c: Connection, extra: (string | undefined)[]): string | undefined {
    const parts = extra.filter((x): x is string => x !== undefined);
    const whites = [c.a, c.b].some((e) => (e.kind === 'conductor' && e.color === 'white')) || c.color === 'white';
    if (whites && HOT_LIKE.includes(this.role(c)) && !parts.includes(NOTE_REMARK)) parts.push(NOTE_REMARK);
    return parts.length > 0 ? parts.join(' ') : undefined;
  }

  /** The step for one splice: one wire nut, exactly the conductors joined. */
  spliceStep(spliceId: string): BuildStep {
    const info = this.ctx.spliceInfo.get(spliceId)!;
    const box = this.ctx.boxById.get(info.splice.box)!;
    const conductors = info.members.map((c) => [c.a, c.b].find((e) => e.kind === 'conductor')!).filter((e) => e.kind === 'conductor');
    const colours = new Set(conductors.map((e) => e.color));
    const refsOfWires = conductors.map((e) => `${this.ctx.cableRef(e.cable, e.box)}`);
    const wires =
      colours.size === 1
        ? `the ${colourName([...colours][0]!)} wires of ${list(refsOfWires)}`
        : list(conductors.map((e) => this.conductor(e)));
    const pig = new Map<WireColor, number>();
    for (const c of info.pigtails) pig.set(c.color, (pig.get(c.color) ?? 0) + 1);
    const pigtails = [...pig.entries()].map(([color, n]) => `${plural(n, `${colourName(color)} pigtail`)}`);
    const joined = [...(conductors.length > 0 ? [wires] : []), ...pigtails];
    const total = conductors.length + info.pigtails.length;
    const refs = [
      info.splice.id,
      ...info.members.map((c) => c.id),
      ...conductors.map((e) => e.cable),
    ];
    const first = info.members[0] ?? info.pigtails[0];
    return {
      id: `makeup-${info.splice.id}`,
      text: `${box.label}: join ${list(joined)} with the ${this.nutName(info.splice.id)} (${total} conductors, ${info.gauge} AWG). Hold the stripped ends together, push the wire nut on and twist it clockwise until it is tight.`,
      box: box.id,
      refs: [...new Set(refs)],
      ...(first ? this.noteOf(this.notes(first, [])) : {}),
    };
  }

  private noteOf(note: string | undefined): { note: string } | Record<string, never> {
    return note === undefined ? {} : { note };
  }

  /** The step for one connection that is made at a screw, bar or breaker (a cable conductor or a pigtail). */
  connectionStep(c: Connection): BuildStep {
    const ctx = this.ctx;
    const box = ctx.boxById.get(ctx.boxOfConnection(c))!;
    const term = [c.a, c.b].filter((e): e is Extract<Endpoint, { kind: 'terminal' }> => e.kind === 'terminal');
    const kind = ctx.kindOf(c);
    const devices = term.map((e) => ctx.deviceById.get(e.device)!);
    const refs: string[] = [c.id, ...devices.map((d) => d.id)];
    let text: string;
    if (kind === 'direct') {
      const cond = [c.a, c.b].find((e) => e.kind === 'conductor') as Extract<Endpoint, { kind: 'conductor' }>;
      refs.push(cond.cable);
      text = `${box.label}: connect ${this.conductor(cond)} to ${this.terminalPhrase(devices[0]!, term[0]!.terminal)}.`;
    } else {
      const splices = [c.a, c.b].filter((e): e is Extract<Endpoint, { kind: 'splice' }> => e.kind === 'splice');
      const color = colourName(c.color);
      const ends = [
        ...splices.map((s) => `the ${this.nutName(s.splice)}`),
        ...term.map((e, i) => this.terminalPhrase(devices[i]!, e.terminal)),
      ];
      text =
        splices.length > 0 && term.length > 0
          ? `${box.label}: connect the ${color} pigtail from ${ends[0]} to ${ends[1]}.`
          : `${box.label}: connect a ${color} pigtail between ${ends[0]} and ${ends[1]}.`;
    }
    const noteParts = term.map((e, i) => this.terminalNote(devices[i]!, e.terminal));
    const note = this.notes(c, [...new Set(noteParts.filter((x): x is string => x !== undefined))]);
    return { id: `makeup-${c.id}`, text, box: box.id, refs: [...new Set(refs)], ...this.noteOf(note) };
  }

  /** All make-up steps of one box in order: grounds, neutrals, hots; within a rank wire nuts before the screws they feed. */
  makeUp(boxId: string): BuildStep[] {
    const ctx = this.ctx;
    const items: { rank: number; kind: number; idx: number; step: () => BuildStep }[] = [];
    ctx.circuit.splices.forEach((s) => {
      if (s.box !== boxId) return;
      const info = ctx.spliceInfo.get(s.id)!;
      const first = info.members[0] ?? info.pigtails[0];
      if (!first) return;
      items.push({ rank: rank(this.role(first)), kind: 0, idx: ctx.circuit.connections.indexOf(first), step: () => this.spliceStep(s.id) });
    });
    ctx.circuit.connections.forEach((c, idx) => {
      if (ctx.boxOfConnection(c) !== boxId || ctx.kindOf(c) === 'member') return;
      items.push({ rank: rank(this.role(c)), kind: 1, idx, step: () => this.connectionStep(c) });
    });
    const steps = items.sort((a, b) => a.rank - b.rank || a.kind - b.kind || a.idx - b.idx).map((i) => i.step());
    // The manufacturer note is given once per box, on the first step that touches a light or fan.
    const first = steps.findIndex((st) => st.refs.some((r) => FIXTURE_TYPES.includes(ctx.deviceById.get(r)?.type as DeviceType)));
    if (first >= 0) steps[first] = { ...steps[first]!, note: [NOTE_FIXTURE, steps[first]!.note].filter(Boolean).join(' ') };
    return steps;
  }
}

const cableTouchesPanel = (ctx: Ctx, from: string, to: string) => [from, to].some((b) => ctx.boxById.get(b)!.kind === 'panel');

export function buildSteps(circuit: CircuitModel, options: BuildPlanOptions = {}): StepsPlan {
  const ctx = makeCtx(circuit, options);
  const w = new Writer(ctx);
  const phase = (id: PhaseId, steps: BuildStep[]): StepPhase => ({ id, title: PHASE_TITLES[id], steps });
  const panelBoxes = circuit.boxes.filter((b) => b.kind === 'panel').map((b) => b.id);

  // 1. Before you start
  const before: BuildStep[] = [];
  const fixed = (id: string, text: string) => before.push({ id, text, box: null, refs: [] });
  if (options.unverified) fixed('before-unverified', SAFETY_TEXTS.unverified);
  fixed('before-power-off', SAFETY_TEXTS.powerOff);
  fixed('before-permit', SAFETY_TEXTS.permit);
  fixed('before-electrician', SAFETY_TEXTS.electrician);

  // 2. Rough-in
  const rough: BuildStep[] = [];
  for (const id of ctx.boxOrder) {
    const info = ctx.boxInfo(id);
    const what = info.fixture ? 'fixture box' : info.gang === 0 ? 'junction box' : `${info.gang}-gang device box`;
    const hasFan = info.devices.some((d) => d.type === 'fan');
    rough.push({
      id: `rough-box-${id}`,
      text: `${info.box.label}: mount the ${what} firmly to the framing at the position you chose.`,
      box: id,
      refs: [id],
      ...(hasFan ? { note: NOTE_FAN_BOX } : {}),
    });
  }
  const orderIdx = new Map(ctx.boxOrder.map((id, i) => [id, i]));
  const cablesInOrder = circuit.cables
    .map((k, i) => ({ k, i }))
    .sort((a, b) => (orderIdx.get(a.k.to) ?? -1) - (orderIdx.get(b.k.to) ?? -1) || a.i - b.i)
    .map((x) => x.k);
  for (const k of cablesInOrder) {
    const from = ctx.boxById.get(k.from)!;
    const to = ctx.boxById.get(k.to)!;
    rough.push({
      id: `rough-cable-${k.id}`,
      text: `Pull ${cableLabel(k)} from ${from.label} to ${to.label}. Leave enough free wire in each box to reach every connection there, and secure the cable at each box with a cable connector and along its run with staples.`,
      box: null,
      refs: [k.id],
      ...(cableTouchesPanel(ctx, k.from, k.to) ? { note: 'Leave the panel end unconnected until the panel phase.' } : {}),
    });
  }

  rough.push({ id: 'rough-inspection', text: ROUGH_IN_INSPECTION, box: null, refs: [] });

  // 3. Make-up, non-panel boxes in power-flow order
  const makeUp: BuildStep[] = ctx.boxOrder.flatMap((id) => w.makeUp(id));

  // 4. Devices and cover plates
  const devs: BuildStep[] = [];
  for (const id of ctx.boxOrder) {
    const info = ctx.boxInfo(id);
    for (const d of info.devices) {
      devs.push(
        d.type === 'light' || d.type === 'fan'
          ? {
              id: `device-${d.id}`,
              text: `${info.box.label}: mount ${d.label} following the instructions that come with it.`,
              box: id,
              refs: [d.id, id],
            }
          : {
              id: `device-${d.id}`,
              text: `${info.box.label}: fold the wires carefully back into the box and fasten ${d.label} to the box with its mounting screws.`,
              box: id,
              refs: [d.id, id],
            },
      );
    }
    if (!info.fixture && info.gang > 0)
      devs.push({
        id: `plate-${id}`,
        text: `${info.box.label}: fit the ${info.gang}-gang cover plate over ${list(info.devices.map((d) => d.label))}.`,
        box: id,
        refs: [id, ...info.devices.map((d) => d.id)],
      });
  }

  // 5. At the panel
  const panel: BuildStep[] = panelBoxes.flatMap((id) => w.makeUp(id));
  if (panel.length > 0) panel[0] = { ...panel[0]!, note: [panel[0]!.note, NOTE_PANEL].filter(Boolean).join(' ') };

  // 6. Power-up and testing
  const testing: BuildStep[] = [{ id: 'test-restore', text: TESTING_TEXTS.restore, box: null, refs: [] }];
  const nonPanel = circuit.devices.filter((d) => ctx.boxById.get(d.box)!.kind !== 'panel');
  const ofType = (t: DeviceType) => nonPanel.filter((d) => d.type === t);
  const duplex = nonPanel.filter((d) => d.type === 'duplex' || d.type === 'gfci');
  if (duplex.length > 0)
    testing.push({ id: 'test-receptacles', text: `${TESTING_TEXTS.receptacles} Receptacles: ${list(duplex.map((d) => d.label))}.`, box: null, refs: duplex.map((d) => d.id) });
  for (const g of ofType('gfci')) {
    const hasLoad = ctx.analysis.netOfTerminal(g.id, 'load_hot') !== undefined;
    testing.push({ id: `test-gfci-${g.id}`, text: `${g.label}: ${hasLoad ? TESTING_TEXTS.gfciWithLoad : TESTING_TEXTS.gfciAlone}`, box: null, refs: [g.id] });
  }
  // 3-way pairs: switches whose traveler terminals share a net.
  const threeWay = ofType('switch_3way');
  const pairOf = new Map<string, Device>();
  const pairs: [Device, Device][] = [];
  for (const a of threeWay) {
    if (pairOf.has(a.id)) continue;
    const net = ctx.analysis.netOfTerminal(a.id, 'traveler_a');
    const b = threeWay.find((x) => x.id !== a.id && !pairOf.has(x.id) && net !== undefined && ctx.analysis.netOfTerminal(x.id, 'traveler_a') === net);
    if (b) {
      pairOf.set(a.id, b);
      pairOf.set(b.id, a);
      pairs.push([a, b]);
    }
  }
  for (const s of nonPanel.filter((d) => d.type === 'switch_sp' || (d.type === 'switch_3way' && !pairOf.has(d.id))))
    testing.push({ id: `test-switch-${s.id}`, text: `${s.label}: ${TESTING_TEXTS.switchOne}`, box: null, refs: [s.id] });
  for (const [a, b] of pairs)
    testing.push({ id: `test-pair-${a.id}`, text: `${a.label} and ${b.label}: ${TESTING_TEXTS.threeWay}`, box: null, refs: [a.id, b.id] });
  testing.push({ id: 'test-failure', text: TESTING_TEXTS.failure, box: null, refs: [] });

  return {
    circuitId: circuit.id,
    title: circuit.title,
    unverified: options.unverified === true,
    phases: [
      phase('before', before),
      phase('rough-in', rough),
      phase('make-up', makeUp),
      phase('devices', devs),
      phase('panel', panel),
      phase('testing', testing),
    ],
  };
}
