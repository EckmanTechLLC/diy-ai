// Shared lookups for the build-plan generators (ADR-010): everything a material or step is derived from.
// Pure; no language model, no I/O.
import { CATALOGUE, type DeviceType } from '../catalogue';
import { analyzeNets, type CircuitAnalysis } from '../analysis';
import type { CircuitPlanInfo } from '../planner';
import { cableLabel, type Box, type Cable, type CircuitModel, type Connection, type Device, type Endpoint, type Splice, type WireColor } from '../schema';
import { validateCircuit } from '../validate';

export interface BuildPlanOptions {
  /** Protection the planner chose for this circuit (decides the breaker type). */
  protection?: CircuitPlanInfo['protection'];
  /** Length in feet per cable id, entered by the user. A cable without a length is reported as missing, never estimated. */
  cableLengths?: Readonly<Record<string, number | undefined>>;
  /** Extra length added to the known cable total, in percent. Default 15. */
  allowancePct?: number;
  /** The wiring was not built from checked building blocks; every output says so. */
  unverified?: boolean;
}

export const DEFAULT_ALLOWANCE_PCT = 15;

export const colourName = (c: WireColor): string => (c === 'bare' ? 'bare copper' : c);

export const gaugeOf = (cable: Pick<Cable, 'type'>): number => Number(cable.type.split('/')[0]);

/** A box's contents, as materials and steps both need them. */
export interface BoxInfo {
  box: Box;
  devices: Device[];
  /** Holds a light or a fan. */
  fixture: boolean;
  /** Number of devices in the box (its "gang" count). */
  gang: number;
}

export type ConnKind = 'direct' | 'member' | 'pigtail';

export interface SpliceInfo {
  splice: Splice;
  /** Connections to the cables' conductors. */
  members: Connection[];
  /** Connections to anything that is not a conductor (a device terminal or another splice). */
  pigtails: Connection[];
  /** AWG of the splice: the heaviest conductor on it. */
  gauge: number;
}

export interface Ctx {
  circuit: CircuitModel;
  options: BuildPlanOptions;
  analysis: CircuitAnalysis;
  boxById: Map<string, Box>;
  deviceById: Map<string, Device>;
  cableById: Map<string, Cable>;
  spliceInfo: Map<string, SpliceInfo>;
  /** Non-panel boxes in power-flow order: distance from the panel over cables, ties in discovery order. */
  boxOrder: string[];
  boxInfo(boxId: string): BoxInfo;
  boxOf(e: Endpoint): string;
  boxOfConnection(c: Connection): string;
  kindOf(c: Connection): ConnKind;
  /** AWG of a pigtail connection. */
  pigtailGauge(c: Connection): number;
  /** Name for a cable as it is seen from one of its boxes; adds where it goes when two cables there share a label. */
  cableRef(cableId: string, boxId: string): string;
  deviceName(d: Device): string;
}

export function makeCtx(circuit: CircuitModel, options: BuildPlanOptions = {}): Ctx {
  const issues = validateCircuit(circuit);
  if (issues.length > 0) throw new Error(`cannot build a plan from an invalid circuit: ${issues.map((i) => i.message).join('; ')}`);
  const boxById = new Map(circuit.boxes.map((b) => [b.id, b]));
  const deviceById = new Map(circuit.devices.map((d) => [d.id, d]));
  const cableById = new Map(circuit.cables.map((c) => [c.id, c]));
  const spliceById = new Map(circuit.splices.map((s) => [s.id, s]));
  const analysis = analyzeNets(circuit);

  const boxOf = (e: Endpoint): string =>
    e.kind === 'terminal' ? deviceById.get(e.device)!.box : e.kind === 'conductor' ? e.box : spliceById.get(e.splice)!.box;
  const boxOfConnection = (c: Connection): string => boxOf(c.a);
  const kindOf = (c: Connection): ConnKind => {
    const conductors = [c.a, c.b].filter((e) => e.kind === 'conductor').length;
    if (conductors === 2)
      throw new Error(`connection "${c.id}" joins two cable conductors directly; the model has no wire nut for it, so no plan can be built`);
    if (conductors === 0) return 'pigtail';
    return [c.a, c.b].some((e) => e.kind === 'splice') ? 'member' : 'direct';
  };

  // Box gauge fallbacks: heaviest cable touching a box, else heaviest in the circuit.
  const heaviest = (cables: Cable[]): number | undefined => (cables.length === 0 ? undefined : Math.min(...cables.map(gaugeOf)));
  const boxGauge = (boxId: string): number =>
    heaviest(circuit.cables.filter((k) => k.from === boxId || k.to === boxId)) ?? heaviest(circuit.cables) ?? 14;

  const spliceInfo = new Map<string, SpliceInfo>();
  for (const s of circuit.splices) spliceInfo.set(s.id, { splice: s, members: [], pigtails: [], gauge: 0 });
  for (const c of circuit.connections) {
    const k = kindOf(c);
    for (const e of [c.a, c.b]) {
      if (e.kind !== 'splice') continue;
      (k === 'member' ? spliceInfo.get(e.splice)!.members : spliceInfo.get(e.splice)!.pigtails).push(c);
    }
  }
  for (const info of spliceInfo.values()) {
    const gauges = info.members.flatMap((c) => [c.a, c.b]).filter((e) => e.kind === 'conductor').map((e) => gaugeOf(cableById.get(e.cable)!));
    info.gauge = gauges.length > 0 ? Math.min(...gauges) : boxGauge(info.splice.box);
  }
  const pigtailGauge = (c: Connection): number => {
    const gs = [c.a, c.b].filter((e) => e.kind === 'splice').map((e) => spliceInfo.get(e.splice)!.gauge);
    return gs.length > 0 ? Math.min(...gs) : boxGauge(boxOfConnection(c));
  };

  // Power-flow order: breadth-first over cables from every panel box.
  const adjacency = new Map<string, string[]>();
  for (const k of circuit.cables) {
    adjacency.set(k.from, [...(adjacency.get(k.from) ?? []), k.to]);
    adjacency.set(k.to, [...(adjacency.get(k.to) ?? []), k.from]);
  }
  const seen = new Set<string>();
  const queue: string[] = [];
  for (const b of circuit.boxes) if (b.kind === 'panel') (seen.add(b.id), queue.push(b.id));
  const order: string[] = [];
  for (let i = 0; i < queue.length; i++) {
    for (const n of adjacency.get(queue[i]!) ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      queue.push(n);
    }
  }
  order.push(...queue, ...circuit.boxes.map((b) => b.id).filter((id) => !seen.has(id)));
  const boxOrder = order.filter((id) => boxById.get(id)!.kind !== 'panel');

  const boxInfo = (boxId: string): BoxInfo => {
    const devices = circuit.devices.filter((d) => d.box === boxId);
    return { box: boxById.get(boxId)!, devices, fixture: devices.some((d) => d.type === 'light' || d.type === 'fan'), gang: devices.length };
  };

  const cableRef = (cableId: string, boxId: string): string => {
    const cable = cableById.get(cableId)!;
    const label = cableLabel(cable);
    const here = circuit.cables.filter((k) => k.from === boxId || k.to === boxId);
    if (here.filter((k) => cableLabel(k) === label).length < 2) return label;
    const qual = (k: Cable) => (k.to === boxId ? `coming from ${boxById.get(k.from)!.label}` : `going to ${boxById.get(k.to)!.label}`);
    const q = qual(cable);
    const same = here.filter((k) => cableLabel(k) === label && qual(k) === q);
    return same.length < 2 ? `${label} (${q})` : `${label} (${q}, number ${same.indexOf(cable) + 1} of ${same.length})`;
  };

  return {
    circuit,
    options,
    analysis,
    boxById,
    deviceById,
    cableById,
    spliceInfo,
    boxOrder,
    boxInfo,
    boxOf,
    boxOfConnection,
    kindOf,
    pigtailGauge,
    cableRef,
    deviceName: (d) => d.label,
  };
}

/** Device types counted as things to buy for a non-panel box, with plain names. */
export const DEVICE_NAMES: Partial<Record<DeviceType, string>> = {
  switch_sp: 'Switch, single-pole',
  switch_3way: 'Switch, 3-way',
  duplex: 'Receptacle, duplex',
  gfci: 'Receptacle, GFCI',
  light: 'Light fixture of your choice',
  fan: 'Fan of your choice',
};

export const deviceTypeName = (t: DeviceType): string => DEVICE_NAMES[t] ?? CATALOGUE[t].label;
