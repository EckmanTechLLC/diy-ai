import { CATALOGUE, findTerminal, type CircuitModel, type DeviceType, type ScrewColor, type WireColor } from '@diy-ai/core';

export type Side = 'WEST' | 'EAST';

/** Drawing convention: conductors appear in this order, top to bottom, at every cable end in every diagram. */
export const CONDUCTOR_ORDER: readonly WireColor[] = ['black', 'red', 'white', 'bare', 'green'];

export const orderedConductors = (conductors: readonly WireColor[]): WireColor[] =>
  [...conductors].sort((a, b) => CONDUCTOR_ORDER.indexOf(a) - CONDUCTOR_ORDER.indexOf(b));

export const CABLE_W = 112;
/** Conductors run from the node edge to the jacket edge; the jacket is inset by this much on both ends. */
export const CABLE_JACKET_INSET = 16;
export const CABLE_PITCH = 18;
export const CABLE_TOP = 6;
export const SPLICE_W = 30;
export const SPLICE_PITCH = 14;

export const cablePortY = (i: number): number => CABLE_TOP + i * CABLE_PITCH + CABLE_PITCH / 2;

export function cableHeight(n: number): number {
  return CABLE_TOP + n * CABLE_PITCH + 6;
}

export interface TerminalGeometry {
  side: Side;
  /** Side when the device is mirrored (defaults to side). */
  mirrorSide?: Side;
  y: number;
}

export interface DeviceGeometry {
  width: number;
  height: number;
  /** Keyed by core's terminal names. Names, roles and screw colours come from core. */
  terminals: Record<string, TerminalGeometry>;
}

export const GEOMETRY: Record<DeviceType, DeviceGeometry> = {
  breaker: { width: 110, height: 44, terminals: { out: { side: 'EAST', y: 22 } } },
  neutral_bar: { width: 110, height: 34, terminals: { neutral_bar: { side: 'EAST', y: 17 } } },
  ground_bar: { width: 110, height: 34, terminals: { ground_bar: { side: 'EAST', y: 17 } } },
  switch_sp: {
    width: 96,
    height: 100,
    terminals: { t1: { side: 'WEST', y: 30 }, t2: { side: 'EAST', y: 30 }, ground: { side: 'EAST', y: 80 } },
  },
  switch_3way: {
    width: 96,
    height: 120,
    terminals: {
      common: { side: 'WEST', mirrorSide: 'EAST', y: 60 },
      // traveler_b sits above traveler_a so cable order black, red maps without crossing
      traveler_b: { side: 'EAST', mirrorSide: 'WEST', y: 30 },
      traveler_a: { side: 'EAST', mirrorSide: 'WEST', y: 90 },
      ground: { side: 'EAST', y: 108 },
    },
  },
  light: {
    width: 110,
    height: 84,
    terminals: { hot: { side: 'WEST', y: 22 }, neutral: { side: 'WEST', y: 46 }, ground: { side: 'WEST', y: 70 } },
  },
  fan: {
    width: 110,
    height: 84,
    terminals: { hot: { side: 'WEST', y: 22 }, neutral: { side: 'WEST', y: 46 }, ground: { side: 'WEST', y: 70 } },
  },
  duplex: {
    width: 110,
    height: 84,
    terminals: { brass: { side: 'WEST', y: 22 }, silver: { side: 'WEST', y: 46 }, ground: { side: 'WEST', y: 70 } },
  },
  gfci: {
    width: 150,
    height: 120,
    terminals: {
      line_hot: { side: 'WEST', y: 26 },
      line_neutral: { side: 'WEST', y: 52 },
      ground: { side: 'WEST', y: 96 },
      load_hot: { side: 'EAST', y: 26 },
      load_neutral: { side: 'EAST', y: 52 },
    },
  },
};

export interface PlacedTerminal {
  name: string;
  side: Side;
  x: number;
  y: number;
  screw: ScrewColor;
}

/** Terminals of a device type in core's catalogue order, placed on the device (relative coordinates). */
export function terminalsOf(type: DeviceType, mirrored = false): PlacedTerminal[] {
  const geo = GEOMETRY[type];
  return CATALOGUE[type].terminals.map((def) => {
    const g = geo.terminals[def.name];
    const side = mirrored ? (g.mirrorSide ?? g.side) : g.side;
    return { name: def.name, side, x: side === 'WEST' ? 0 : geo.width, y: g.y, screw: findTerminal(type, def.name)!.screw };
  });
}

/**
 * Orientation rule. Current flows panel -> load, left to right. A terminal wired straight to a cable
 * conductor tells us which way its wire arrives: a conductor whose cable ends in the device's box
 * brings current in (the terminal wants the WEST side); one whose cable starts there takes it away
 * (EAST). The device is mirrored when the mirrored terminal sides agree with more of those wires
 * than the normal sides do; ties stay normal. Terminals wired only to splices give no vote.
 */
export function mirroredDevices(model: CircuitModel): Set<string> {
  const out = new Set<string>();
  for (const d of model.devices) {
    const want = new Map<string, Side>();
    for (const c of model.connections)
      for (const [t, o] of [[c.a, c.b], [c.b, c.a]] as const)
        if (t.kind === 'terminal' && t.device === d.id && o.kind === 'conductor') {
          const cable = model.cables.find((k) => k.id === o.cable)!;
          want.set(t.terminal, o.box === cable.to ? 'WEST' : 'EAST');
        }
    let normal = 0;
    let mirrored = 0;
    for (const [name, g] of Object.entries(GEOMETRY[d.type].terminals)) {
      const w = want.get(name);
      if (!w) continue;
      if (g.side === w) normal++;
      if ((g.mirrorSide ?? g.side) === w) mirrored++;
    }
    if (mirrored > normal) out.add(d.id);
  }
  return out;
}
