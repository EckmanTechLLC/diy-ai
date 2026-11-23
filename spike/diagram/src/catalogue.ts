import type { CircuitModel, DeviceType } from './model';

export type ScrewColor = 'brass' | 'silver' | 'green' | 'black';
export type Side = 'WEST' | 'EAST';

export interface TerminalDef {
  name: string;
  side: Side;
  /** Side when the device is mirrored (defaults to side). */
  mirrorSide?: Side;
  y: number;
  screw: ScrewColor;
}

export interface DeviceDef {
  label: string;
  width: number;
  height: number;
  terminals: TerminalDef[];
}

export const CATALOGUE: Record<DeviceType, DeviceDef> = {
  breaker: {
    label: 'Breaker',
    width: 110,
    height: 44,
    terminals: [{ name: 'out', side: 'EAST', y: 22, screw: 'brass' }],
  },
  neutral_bar: {
    label: 'Neutral bar',
    width: 110,
    height: 34,
    terminals: [{ name: 'neutral_bar', side: 'EAST', y: 17, screw: 'silver' }],
  },
  ground_bar: {
    label: 'Ground bar',
    width: 110,
    height: 34,
    terminals: [{ name: 'ground_bar', side: 'EAST', y: 17, screw: 'green' }],
  },
  switch_sp: {
    label: 'Switch',
    width: 96,
    height: 100,
    terminals: [
      { name: 't1', side: 'WEST', y: 30, screw: 'brass' },
      { name: 't2', side: 'EAST', y: 30, screw: 'brass' },
      { name: 'ground', side: 'EAST', y: 80, screw: 'green' },
    ],
  },
  switch_3way: {
    label: '3-way',
    width: 96,
    height: 120,
    terminals: [
      { name: 'common', side: 'WEST', mirrorSide: 'EAST', y: 60, screw: 'black' },
      // traveler_b sits above traveler_a so cable order black, red maps without crossing
      { name: 'traveler_b', side: 'EAST', mirrorSide: 'WEST', y: 30, screw: 'brass' },
      { name: 'traveler_a', side: 'EAST', mirrorSide: 'WEST', y: 90, screw: 'brass' },
      { name: 'ground', side: 'EAST', y: 108, screw: 'green' },
    ],
  },
  light: {
    label: 'Light',
    width: 110,
    height: 84,
    terminals: [
      { name: 'hot', side: 'WEST', y: 22, screw: 'black' },
      { name: 'neutral', side: 'WEST', y: 46, screw: 'silver' },
      { name: 'ground', side: 'WEST', y: 70, screw: 'green' },
    ],
  },
  duplex: {
    label: 'Receptacle',
    width: 110,
    height: 84,
    terminals: [
      { name: 'brass', side: 'WEST', y: 22, screw: 'brass' },
      { name: 'silver', side: 'WEST', y: 46, screw: 'silver' },
      { name: 'ground', side: 'WEST', y: 70, screw: 'green' },
    ],
  },
  gfci: {
    label: 'GFCI',
    width: 150,
    height: 120,
    terminals: [
      { name: 'line_hot', side: 'WEST', y: 26, screw: 'brass' },
      { name: 'line_neutral', side: 'WEST', y: 52, screw: 'silver' },
      { name: 'ground', side: 'WEST', y: 96, screw: 'green' },
      { name: 'load_hot', side: 'EAST', y: 26, screw: 'brass' },
      { name: 'load_neutral', side: 'EAST', y: 52, screw: 'silver' },
    ],
  },
};

export interface PlacedTerminal {
  name: string;
  side: Side;
  x: number;
  y: number;
  screw: ScrewColor;
}

export function terminalsOf(type: DeviceType, mirrored = false): PlacedTerminal[] {
  const def = CATALOGUE[type];
  return def.terminals.map((t) => {
    const side = mirrored ? (t.mirrorSide ?? t.side) : t.side;
    return { name: t.name, side, x: side === 'WEST' ? 0 : def.width, y: t.y, screw: t.screw };
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
    for (const t of CATALOGUE[d.type].terminals) {
      const w = want.get(t.name);
      if (!w) continue;
      if (t.side === w) normal++;
      if ((t.mirrorSide ?? t.side) === w) mirrored++;
    }
    if (mirrored > normal) out.add(d.id);
  }
  return out;
}
