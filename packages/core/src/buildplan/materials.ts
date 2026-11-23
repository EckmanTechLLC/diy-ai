// Materials list counted from the circuit model (ADR-010). Every item lists the ids it was counted from.
import { CABLE_TYPES, cableLabel, type CableType, type CircuitModel, type Connection, type WireColor } from '../schema';
import type { DeviceType } from '../catalogue';
import { colourName, DEFAULT_ALLOWANCE_PCT, deviceTypeName, gaugeOf, makeCtx, type BuildPlanOptions } from './shared';
import type { Ctx } from './shared';

export type MaterialCategory = 'breaker' | 'device' | 'box' | 'cable_run' | 'wire_nut' | 'pigtail' | 'cover_plate';

export interface MaterialItem {
  /** Stable for the same circuit. */
  id: string;
  category: MaterialCategory;
  description: string;
  quantity: number;
  unit: 'each' | 'run';
  note?: string;
  /** Ids of the circuit elements this item was counted from. */
  refs: string[];
  /** Cable runs only: the length the user entered, in feet; undefined when not entered. */
  lengthFt?: number;
}

export interface CableTotal {
  type: CableType;
  runs: number;
  /** Sum of the entered lengths. */
  knownFt: number;
  allowancePct: number;
  /** Known length plus the allowance, rounded up to whole feet. Covers only runs that have a length. */
  totalFt: number;
  /** Runs without a length. Their length is never estimated. */
  missing: number;
}

export interface MaterialsList {
  circuitId: string;
  title: string;
  unverified: boolean;
  items: MaterialItem[];
  cableTotals: CableTotal[];
  /** Fixed texts for what this list does not cover. */
  notIncluded: string[];
}

export const NOT_INCLUDED: readonly string[] = [
  'Cable staples and cable connectors (clamps) for the boxes.',
  'Box mounting hardware (screws, brackets, nails).',
  'Tools, a voltage tester and a receptacle tester.',
  'Receptacle rating: choose 15 A or 20 A receptacles to suit the circuit yourself.',
  'Tamper-resistant and weather-resistant variants of devices, where your location needs them.',
  'Wire connectors for fixture and fan leads, if the fixture or fan does not supply them.',
];

const BOX_NOTE = 'Box volume is not calculated; check that each box is large enough for its wires, devices and clamps.';
const round2 = (n: number) => Math.round(n * 100) / 100;

const gangWord = (n: number) => `${n}-gang`;

function plateKind(types: DeviceType[]): string {
  const kinds = [...new Set(types.map((t) => (t === 'switch_sp' || t === 'switch_3way' ? 'switch' : t === 'gfci' ? 'GFCI receptacle' : t === 'duplex' ? 'receptacle' : 'other')))].sort();
  return kinds.length === 1 ? kinds[0]! : `combination (${kinds.join(' + ')})`;
}

function validateOptions(options: BuildPlanOptions): { allowance: number } {
  const allowance = options.allowancePct ?? DEFAULT_ALLOWANCE_PCT;
  if (typeof allowance !== 'number' || !Number.isFinite(allowance) || allowance < 0)
    throw new Error('invalid options: allowancePct must be a number of 0 or more');
  for (const [id, len] of Object.entries(options.cableLengths ?? {}))
    if (len !== undefined && (typeof len !== 'number' || !Number.isFinite(len) || len <= 0))
      throw new Error(`invalid options: cable length for "${id}" must be a number of feet above 0`);
  return { allowance };
}

export function buildMaterials(circuit: CircuitModel, options: BuildPlanOptions = {}): MaterialsList {
  const { allowance } = validateOptions(options);
  const ctx = makeCtx(circuit, options);
  const items: MaterialItem[] = [
    ...breakers(ctx),
    ...devices(ctx),
    ...boxes(ctx),
    ...cableRuns(ctx),
    ...wireNuts(ctx),
    ...pigtails(ctx),
    ...coverPlates(ctx),
  ];
  return {
    circuitId: circuit.id,
    title: circuit.title,
    unverified: options.unverified === true,
    items,
    cableTotals: cableTotals(ctx, allowance),
    notIncluded: [...NOT_INCLUDED],
  };
}

function breakers(ctx: Ctx): MaterialItem[] {
  const prot = ctx.options.protection;
  return ctx.circuit.devices
    .filter((d) => d.type === 'breaker' && ctx.boxById.get(d.box)!.kind === 'panel')
    .map((d) => {
      const type = prot === undefined ? '' : prot.afci ? 'AFCI ' : 'standard ';
      return {
        id: `breaker:${d.id}`,
        category: 'breaker' as const,
        description: `${d.amps} A ${type}breaker, single-pole`,
        quantity: 1,
        unit: 'each' as const,
        note:
          (prot === undefined ? 'The breaker type (standard or AFCI) was not specified for this circuit. ' : '') +
          'It must be the make and series that fits your panel.',
        refs: [d.id],
      };
    });
}

function devices(ctx: Ctx): MaterialItem[] {
  const byType = new Map<DeviceType, string[]>();
  for (const d of ctx.circuit.devices) {
    if (ctx.boxById.get(d.box)!.kind === 'panel') continue;
    byType.set(d.type, [...(byType.get(d.type) ?? []), d.id]);
  }
  return [...byType.entries()].map(([type, ids]) => ({
    id: `device:${type}`,
    category: 'device' as const,
    description: deviceTypeName(type),
    quantity: ids.length,
    unit: 'each' as const,
    refs: ids,
  }));
}

function boxes(ctx: Ctx): MaterialItem[] {
  const groups = new Map<string, { description: string; gang: number; ids: string[] }>();
  for (const id of ctx.boxOrder) {
    const info = ctx.boxInfo(id);
    const description = info.fixture
      ? 'Fixture box (holds a light or fan)'
      : info.gang === 0
        ? 'Junction box (holds no device)'
        : `${gangWord(info.gang)} device box`;
    const key = description;
    const g = groups.get(key) ?? { description, gang: info.gang, ids: [] };
    g.ids.push(id);
    groups.set(key, g);
  }
  return [...groups.entries()]
    .sort(([, a], [, b]) => Number(a.description.startsWith('Fixture')) - Number(b.description.startsWith('Fixture')) || a.gang - b.gang)
    .map(([key, g]) => ({
      id: `box:${key}`,
      category: 'box' as const,
      description: g.description,
      quantity: g.ids.length,
      unit: 'each' as const,
      note: BOX_NOTE,
      refs: g.ids,
    }));
}

function cableRuns(ctx: Ctx): MaterialItem[] {
  return ctx.circuit.cables.map((k) => {
    const lengthFt = ctx.options.cableLengths?.[k.id];
    const item: MaterialItem = {
      id: `cable:${k.id}`,
      category: 'cable_run',
      description: `${cableLabel(k)} from ${ctx.boxById.get(k.from)!.label} to ${ctx.boxById.get(k.to)!.label}`,
      quantity: 1,
      unit: 'run',
      refs: [k.id],
    };
    if (lengthFt !== undefined) item.lengthFt = lengthFt;
    return item;
  });
}

function cableTotals(ctx: Ctx, allowancePct: number): CableTotal[] {
  return CABLE_TYPES.filter((t) => ctx.circuit.cables.some((k) => k.type === t)).map((type) => {
    const runs = ctx.circuit.cables.filter((k) => k.type === type);
    const lengths = runs.map((k) => ctx.options.cableLengths?.[k.id]).filter((l): l is number => l !== undefined);
    const knownFt = round2(lengths.reduce((s, l) => s + l, 0));
    return {
      type,
      runs: runs.length,
      knownFt,
      allowancePct,
      totalFt: Math.ceil(round2(knownFt * (1 + allowancePct / 100))),
      missing: runs.length - lengths.length,
    };
  });
}

function wireNuts(ctx: Ctx): MaterialItem[] {
  const groups = new Map<string, { description: string; ids: string[] }>();
  for (const s of ctx.circuit.splices) {
    const info = ctx.spliceInfo.get(s.id)!;
    const perGauge = new Map<number, number>();
    for (const c of info.members) {
      const e = [c.a, c.b].find((x) => x.kind === 'conductor')!;
      if (e.kind !== 'conductor') continue;
      const g = gaugeOf(ctx.cableById.get(e.cable)!);
      perGauge.set(g, (perGauge.get(g) ?? 0) + 1);
    }
    perGauge.set(info.gauge, (perGauge.get(info.gauge) ?? 0) + info.pigtails.length);
    const total = [...perGauge.values()].reduce((a, b) => a + b, 0);
    const detail = [...perGauge.entries()]
      .filter(([, n]) => n > 0)
      .sort(([a], [b]) => a - b)
      .map(([g, n]) => `${n} × ${g} AWG`)
      .join(' + ');
    const description = `Wire nut for ${total} conductors (${detail})`;
    const g = groups.get(description) ?? { description, ids: [] };
    g.ids.push(s.id);
    groups.set(description, g);
  }
  return [...groups.values()].map((g) => ({
    id: `wirenut:${g.description}`,
    category: 'wire_nut' as const,
    description: g.description,
    quantity: g.ids.length,
    unit: 'each' as const,
    note: 'Check the package for the wire sizes and counts the nut is rated for.',
    refs: g.ids,
  }));
}

/** Connections that are not cable conductors: a short wire from a wire nut (or another terminal) to a screw. */
function pigtails(ctx: Ctx): MaterialItem[] {
  const groups = new Map<string, { color: WireColor; gauge: number; ids: string[] }>();
  for (const c of ctx.circuit.connections as Connection[]) {
    if (ctx.kindOf(c) !== 'pigtail') continue;
    const gauge = ctx.pigtailGauge(c);
    const key = `${c.color}:${gauge}`;
    const g = groups.get(key) ?? { color: c.color, gauge, ids: [] };
    g.ids.push(c.id);
    groups.set(key, g);
  }
  return [...groups.entries()]
    .sort(([, a], [, b]) => a.gauge - b.gauge || a.color.localeCompare(b.color))
    .map(([key, g]) => ({
      id: `pigtail:${key}`,
      category: 'pigtail' as const,
      description: `Pigtail wire, ${colourName(g.color)}, ${g.gauge} AWG`,
      quantity: g.ids.length,
      unit: 'each' as const,
      note: 'Cut from spare wire of the same size, long enough to reach from the wire nut to the screw.',
      refs: g.ids,
    }));
}

function coverPlates(ctx: Ctx): MaterialItem[] {
  const groups = new Map<string, { description: string; gang: number; ids: string[] }>();
  for (const id of ctx.boxOrder) {
    const info = ctx.boxInfo(id);
    if (info.fixture || info.gang === 0) continue;
    const description = `Cover plate, ${gangWord(info.gang)}, ${plateKind(info.devices.map((d) => d.type))}`;
    const g = groups.get(description) ?? { description, gang: info.gang, ids: [] };
    g.ids.push(id);
    groups.set(description, g);
  }
  return [...groups.values()]
    .sort((a, b) => a.gang - b.gang || a.description.localeCompare(b.description))
    .map((g) => ({
      id: `plate:${g.description}`,
      category: 'cover_plate' as const,
      description: g.description,
      quantity: g.ids.length,
      unit: 'each' as const,
      refs: g.ids,
    }));
}
