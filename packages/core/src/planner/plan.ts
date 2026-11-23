// Deterministic circuit splitter (ADR-009): inventory in, plan out. Pure; same input, same output.
import { MAX_BLOCKS, MAX_COUNT, type BlockInput } from '../blocks';
import type { Citation, Severity } from '../rules';
import type { BreakerAmps } from '../templates';
import { validateInventory, type Inventory, type InventoryInput, type Room, type RoomType } from './inventory';
import { getRoomRule } from './rules';


export interface AssumedLoads {
  receptacleVa: number;
  lightVa: number;
  fanVa: number;
}

export interface PlanOptions {
  maxReceptaclesPerCircuit?: number;
  lightingBreakerAmps?: BreakerAmps;
  assumedLoads?: Partial<AssumedLoads>;
}

export const DEFAULT_ASSUMED_LOADS: AssumedLoads = { receptacleVa: 180, lightVa: 60, fanVa: 100 };
export const DEFAULT_MAX_RECEPTACLES = 8;
export const DEFAULT_LIGHTING_AMPS: BreakerAmps = 15;
export const LOAD_LIMIT = 0.8;
const VOLTS = 120;
const AFCI_TYPES: readonly RoomType[] = ['living_area', 'bedroom', 'closet', 'hallway'];

export interface Reason {
  text: string;
  /** `rule`: a room rule (ruleId set). `default`: a design default of this tool, or an override of one. */
  kind: 'rule' | 'default';
  ruleId?: string;
}

export interface ServedRoom {
  id: string;
  name: string;
  receptacles: number;
  lightGroups: number;
  lights: number;
  fans: number;
}

export interface PlannedCircuit {
  name: string;
  breakerAmps: BreakerAmps;
  rooms: ServedRoom[];
  /** Valid `blocks` input for buildCircuit, in power-flow order. */
  blocks: BlockInput[];
  protection: { gfci: 'none' | 'first-receptacle'; afci: boolean };
  plannedLoadVa: number;
  capacityVa: number;
  reasons: Reason[];
}

/** The part of a planned circuit that the circuit model cannot hold; stored with a circuit built from a plan. */
export type CircuitPlanInfo = Pick<PlannedCircuit, 'protection' | 'rooms' | 'reasons' | 'plannedLoadVa' | 'capacityVa'>;

export interface PlanFinding {
  ruleId: string;
  severity: Severity;
  message: string;
  roomIds: string[];
  citation: Citation;
}

export interface NotCoveredRoom {
  roomId: string;
  roomName: string;
  reason: string;
}

export interface PlanAssumptions {
  loads: AssumedLoads;
  maxReceptaclesPerCircuit: number;
  lightingBreakerAmps: BreakerAmps;
  /** Fraction of the breaker rating a circuit may carry. */
  loadLimit: number;
  notes: string[];
}

export interface Plan {
  circuits: PlannedCircuit[];
  findings: PlanFinding[];
  reminders: string[];
  notCovered: NotCoveredRoom[];
  assumptions: PlanAssumptions;
}

export const PLAN_REMINDERS: readonly string[] = [
  'Receptacle spacing along the walls cannot be judged from a count; check the layout of each room against the code.',
  'Smoke and carbon monoxide alarms are not part of this plan; they need their own circuit or interconnect planning.',
  'Box fill is not checked; make sure every box is big enough for the conductors, devices and clamps in it.',
  'Local amendments and permit requirements can differ from the code; check with your local inspector before you start.',
];

// ---------------------------------------------------------------------------------------------------
// Units: the atoms the packer places. A light group is one block, a fan is one block, receptacles are
// counted one by one and become runs of at most MAX_COUNT.

type Unit =
  | { kind: 'lights'; roomId: string; lights: number; switches: 1 | 2 }
  | { kind: 'fan'; roomId: string }
  | { kind: 'receptacle'; roomId: string };

interface Resolved {
  loads: AssumedLoads;
  maxRec: number;
  lightingAmps: BreakerAmps;
}

const capacityOf = (amps: number) => amps * VOLTS * LOAD_LIMIT;

function unitLoad(u: Unit, o: Resolved): number {
  if (u.kind === 'lights') return u.lights * o.loads.lightVa;
  if (u.kind === 'fan') return o.loads.fanVa;
  return o.loads.receptacleVa;
}

const loadOf = (units: Unit[], o: Resolved) => units.reduce((s, u) => s + unitLoad(u, o), 0);
const receptaclesOf = (units: Unit[]) => units.filter((u) => u.kind === 'receptacle').length;
const blockCount = (units: Unit[]) => units.length - receptaclesOf(units) + Math.ceil(receptaclesOf(units) / MAX_COUNT);

function fits(units: Unit[], amps: BreakerAmps, o: Resolved): boolean {
  return loadOf(units, o) <= capacityOf(amps) && receptaclesOf(units) <= o.maxRec && blockCount(units) <= MAX_BLOCKS;
}

/** Next-fit packing in the given order: a unit that does not fit starts a new circuit. A unit that does not fit an empty circuit goes alone. */
function pack(units: Unit[], amps: BreakerAmps, o: Resolved): Unit[][] {
  const chunks: Unit[][] = [];
  for (const u of units) {
    const last = chunks[chunks.length - 1];
    if (last && fits([...last, u], amps, o)) last.push(u);
    else chunks.push([u]);
  }
  return chunks;
}

// ---------------------------------------------------------------------------------------------------

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const va = (n: number) => `${Math.round(n * 100) / 100} VA`;

function validateOptions(options: PlanOptions): Resolved {
  const loads = { ...DEFAULT_ASSUMED_LOADS, ...options.assumedLoads };
  for (const [k, v] of Object.entries(loads))
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) throw new Error(`invalid plan options: assumed load ${k} must be a positive number`);
  const maxRec = options.maxReceptaclesPerCircuit ?? DEFAULT_MAX_RECEPTACLES;
  if (!Number.isInteger(maxRec) || maxRec < 1 || maxRec > 24)
    throw new Error('invalid plan options: maxReceptaclesPerCircuit must be a whole number from 1 to 24');
  const lightingAmps = options.lightingBreakerAmps ?? DEFAULT_LIGHTING_AMPS;
  if (lightingAmps !== 15 && lightingAmps !== 20) throw new Error('invalid plan options: lightingBreakerAmps must be 15 or 20');
  return { loads, maxRec, lightingAmps };
}

type CircuitKind = 'bathroom' | 'bedroom-shared' | 'bedroom-lights' | 'lighting' | 'receptacles';

interface Chunk {
  kind: CircuitKind;
  name: string;
  amps: BreakerAmps;
  units: Unit[];
  /** 0 for the first circuit of its group. */
  part: number;
}

/**
 * Turn an inventory into a plan. Throws on an invalid inventory or invalid options (use validateInventory first
 * to get issues). Circuit order: bathroom and bedroom circuits in inventory order, then lighting circuits, then
 * receptacle circuits.
 */
export function planCircuits(input: InventoryInput | Inventory, options: PlanOptions = {}): Plan {
  const issues = validateInventory(input);
  if (issues.length > 0) throw new Error(`invalid inventory: ${issues.map((i) => i.message).join('; ')}`);
  const o = validateOptions(options);
  const inv = input as Inventory;
  const rooms: Room[] = inv.rooms.map((r) => ({ ...r, attachedTo: r.attachedTo ?? '' }));
  const byId = new Map(rooms.map((r) => [r.id, r]));

  const notes: string[] = ['Rooms are chained in the order given; the real cable route is not known to the planner.'];
  const notCovered: NotCoveredRoom[] = [];
  const findings: PlanFinding[] = [];

  // Which rooms are attached to which bedroom (closets only; other attachments are ignored and noted).
  const attached = new Map<string, Room[]>();
  const attachedIds = new Set<string>();
  for (const r of rooms) {
    if (r.attachedTo === '' || r.type === 'other') continue;
    const parent = byId.get(r.attachedTo)!;
    if (r.type === 'closet' && parent.type === 'bedroom') {
      attached.set(parent.id, [...(attached.get(parent.id) ?? []), r]);
      attachedIds.add(r.id);
    } else notes.push(`${r.name} is attached to ${parent.name}; only a closet attached to a bedroom shares that bedroom's circuit, so the attachment is ignored.`);
  }

  const lightingUnits = (r: Room): Unit[] => [
    ...r.lightGroups.map((g): Unit => ({ kind: 'lights', roomId: r.id, lights: g.lights, switches: g.switchLocations })),
    ...Array.from({ length: r.fans }, (): Unit => ({ kind: 'fan', roomId: r.id })),
  ];
  const receptacleUnits = (r: Room): Unit[] => Array.from({ length: r.receptacles }, (): Unit => ({ kind: 'receptacle', roomId: r.id }));

  const taken = new Set<string>();
  const unique = (base: string) => {
    let n = 1;
    let name = base;
    while (taken.has(name)) name = `${base} ${++n}`;
    taken.add(name);
    return name;
  };

  const dedicated: Chunk[] = [];
  const lightingPool: Unit[] = [];
  const receptaclePool: Unit[] = [];

  for (const r of rooms) {
    if (r.type === 'other') {
      notCovered.push({
        roomId: r.id,
        roomName: r.name,
        reason: `Rooms of type "other" are not planned yet (kitchens, laundry, garages, outdoor and special-purpose rooms need their own rules); ${r.name} is left out of every circuit.`,
      });
      continue;
    }
    if (r.lightGroups.length === 0)
      findings.push({
        ruleId: 'switched-light',
        severity: 'warning',
        message: `${r.name} has no switch-controlled light in the inventory; the room rules expect at least one.`,
        roomIds: [r.id],
        citation: getRoomRule('switched-light').citation,
      });
    if (attachedIds.has(r.id)) continue; // planned with its bedroom

    if (r.type === 'bathroom') {
      const units = [...lightingUnits(r), ...receptacleUnits(r)];
      pack(units, 20, o).forEach((u, part) => dedicated.push({ kind: 'bathroom', name: unique(r.name), amps: 20, units: u, part }));
    } else if (r.type === 'bedroom') {
      const closets = attached.get(r.id) ?? [];
      const lights = [r, ...closets].flatMap(lightingUnits);
      const recs = [r, ...closets].flatMap(receptacleUnits);
      const all = [...lights, ...recs];
      const shared = pack(all, 15, o);
      if (shared.length === 1) dedicated.push({ kind: 'bedroom-shared', name: unique(r.name), amps: 15, units: shared[0]!, part: 0 });
      else {
        pack(lights, 15, o).forEach((u, part) => dedicated.push({ kind: 'bedroom-lights', name: unique(r.name), amps: 15, units: u, part }));
        receptaclePool.push(...recs);
      }
    } else {
      lightingPool.push(...lightingUnits(r));
      receptaclePool.push(...receptacleUnits(r));
    }
  }

  const chunks: Chunk[] = [...dedicated];
  pack(lightingPool, o.lightingAmps, o).forEach((u, part) => chunks.push({ kind: 'lighting', name: unique(`Lighting ${part + 1}`), amps: o.lightingAmps, units: u, part }));
  pack(receptaclePool, 20, o).forEach((u, part) => chunks.push({ kind: 'receptacles', name: unique(`Receptacles ${part + 1}`), amps: 20, units: u, part }));

  const circuits = chunks.map((c) => toCircuit(c, o, inv.basement, byId, findings));
  const assumptions: PlanAssumptions = {
    loads: o.loads,
    maxReceptaclesPerCircuit: o.maxRec,
    lightingBreakerAmps: o.lightingAmps,
    loadLimit: LOAD_LIMIT,
    notes,
  };
  return { circuits, findings, reminders: [...PLAN_REMINDERS], notCovered, assumptions };
}

// ---------------------------------------------------------------------------------------------------

function toCircuit(c: Chunk, o: Resolved, basement: boolean, byId: Map<string, Room>, findings: PlanFinding[]): PlannedCircuit {
  const served: ServedRoom[] = [];
  for (const u of c.units) {
    let s = served.find((x) => x.id === u.roomId);
    if (!s) {
      s = { id: u.roomId, name: byId.get(u.roomId)!.name, receptacles: 0, lightGroups: 0, lights: 0, fans: 0 };
      served.push(s);
    }
    if (u.kind === 'receptacle') s.receptacles++;
    else if (u.kind === 'fan') s.fans++;
    else {
      s.lightGroups++;
      s.lights += u.lights;
    }
  }
  const types = new Set(served.map((s) => byId.get(s.id)!.type));
  const recCount = receptaclesOf(c.units);
  const lightingCount = c.units.length - recCount;
  const gfciRequired = recCount > 0 && (c.kind === 'bathroom' || basement);
  const afci = [...types].some((t) => AFCI_TYPES.includes(t));

  // Blocks: lighting and fans first (arrival order), then the receptacle run(s); GFCI first receptacle only on the first run.
  const blocks: BlockInput[] = [];
  for (const u of c.units) {
    if (u.kind === 'lights') blocks.push({ type: u.switches === 1 ? 'switch_lights' : 'three_way_lights', count: u.lights });
    else if (u.kind === 'fan') blocks.push({ type: 'switch_fan' });
  }
  const runs = Math.ceil(recCount / MAX_COUNT);
  for (let i = 0; i < runs; i++) {
    const count = i < runs - 1 ? MAX_COUNT : recCount - MAX_COUNT * (runs - 1);
    blocks.push({ type: 'receptacle_run', count, gfciFirst: gfciRequired && i === 0 });
  }

  const plannedLoadVa = loadOf(c.units, o);
  const capacityVa = capacityOf(c.amps);
  const names = served.map((s) => s.name).join(', ');

  const reasons: Reason[] = [];
  const rule = (ruleId: string, text: string) => reasons.push({ kind: 'rule', ruleId, text });
  const def = (text: string) => reasons.push({ kind: 'default', text });

  switch (c.kind) {
    case 'bathroom':
      def(`${names} is planned as its own 20 A circuit carrying its own lights, fans and receptacles (planning default).`);
      if (recCount > 0)
        rule('bath-receptacle-circuit', `Bathroom receptacles go on a 20 A circuit that serves no other room; only ${names}'s own lights and fan share it.`);
      break;
    case 'bedroom-shared':
      def(
        `The lights and receptacles of ${names} share one 15 A circuit because the load and the block and receptacle limits allow it (planning default).`,
      );
      break;
    case 'bedroom-lights':
      def(
        `${names} is too large to put its lights and receptacles on one 15 A circuit, so its lights stay on this 15 A circuit and its receptacles move to a 20 A receptacle circuit (planning default).`,
      );
      break;
    case 'lighting':
      def(`Lights of living areas, hallways and closets are kept off receptacle circuits and packed in room order onto ${o.lightingAmps} A lighting circuits (planning default).`);
      if (o.lightingAmps !== DEFAULT_LIGHTING_AMPS)
        def(`Lighting circuits use ${o.lightingAmps} A breakers because you changed the default of ${DEFAULT_LIGHTING_AMPS} A.`);
      break;
    case 'receptacles':
      def(`Receptacles outside bathrooms and bedroom circuits are packed in room order onto 20 A circuits, at most ${o.maxRec} per circuit (planning default).`);
      if (o.maxRec !== DEFAULT_MAX_RECEPTACLES)
        def(`The limit is ${o.maxRec} receptacles per circuit because you changed the default of ${DEFAULT_MAX_RECEPTACLES}.`);
      break;
  }
  if (c.part > 0)
    def(`This is a further circuit for the same group because adding more would pass the 80 % load limit, the block limit or the receptacle limit of the previous one.`);
  if (lightingCount > 0 && recCount > 0) def('Lights and fans come before the receptacle run, so a trip of the receptacle protection does not leave the room dark.');
  if (runs > 1) def(`The ${plural(recCount, 'receptacle')} are split into ${runs} runs because one run holds at most ${MAX_COUNT}.`);

  if (gfciRequired) {
    if (c.kind === 'bathroom') rule('bath-gfci', 'Every bathroom receptacle is GFCI protected: the first receptacle in the run is a GFCI and protects the rest.');
    if (basement) rule('basement-gfci', 'Every receptacle in a basement is GFCI protected: the first receptacle in the run is a GFCI and protects the rest.');
  } else if (recCount > 0) {
    rule('basement-gfci', `${names} is neither a bathroom nor in a basement, so no GFCI is planned for these receptacles.`);
  } else {
    rule(c.kind === 'bathroom' ? 'bath-gfci' : 'basement-gfci', 'This circuit has no receptacles, so no GFCI is needed.');
  }

  if (afci) {
    const afciNames = served.filter((s) => AFCI_TYPES.includes(byId.get(s.id)!.type)).map((s) => s.name).join(', ');
    rule('afci-living-areas', `This circuit serves ${afciNames}, so it needs arc-fault (AFCI) protection at the breaker.`);
  } else {
    rule('afci-living-areas', `${names} is not a room type the AFCI rule lists, so no AFCI is planned; check local rules.`);
  }

  const assumed = [
    o.loads.receptacleVa !== DEFAULT_ASSUMED_LOADS.receptacleVa && `receptacle ${o.loads.receptacleVa} VA (default ${DEFAULT_ASSUMED_LOADS.receptacleVa})`,
    o.loads.lightVa !== DEFAULT_ASSUMED_LOADS.lightVa && `light ${o.loads.lightVa} VA (default ${DEFAULT_ASSUMED_LOADS.lightVa})`,
    o.loads.fanVa !== DEFAULT_ASSUMED_LOADS.fanVa && `fan ${o.loads.fanVa} VA (default ${DEFAULT_ASSUMED_LOADS.fanVa})`,
  ].filter(Boolean);
  const over = plannedLoadVa > capacityVa;
  rule(
    'planned-load',
    over
      ? `Planned load ${va(plannedLoadVa)} is MORE than the 80 % planning limit of ${va(capacityVa)} for a ${c.amps} A breaker.`
      : `Planned load ${va(plannedLoadVa)} is within the 80 % planning limit of ${va(capacityVa)} for a ${c.amps} A breaker.`,
  );
  if (assumed.length > 0) def(`Assumed loads changed by you: ${assumed.join(', ')}.`);

  if (over)
    findings.push({
      ruleId: 'planned-load',
      severity: 'error',
      message: `${c.name}: a single item (${va(plannedLoadVa)}) is more than the 80 % planning limit (${va(capacityVa)}) of a ${c.amps} A circuit; it cannot be split further. Reduce it or use different assumed loads.`,
      roomIds: served.map((s) => s.id),
      citation: getRoomRule('planned-load').citation,
    });

  return {
    name: c.name,
    breakerAmps: c.amps,
    rooms: served,
    blocks,
    protection: { gfci: gfciRequired ? 'first-receptacle' : 'none', afci },
    plannedLoadVa,
    capacityVa,
    reasons,
  };
}
