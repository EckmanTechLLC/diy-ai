// Electrical side of the device catalogue. Geometry (sizes, terminal positions) belongs to the diagram package.

export const DEVICE_TYPES = [
  'breaker',
  'neutral_bar',
  'ground_bar',
  'switch_sp',
  'switch_3way',
  'light',
  'duplex',
  'gfci',
  'fan',
] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

/**
 * Terminal role: what a terminal is for, electrically. Closed set:
 * - hot: carries the supplied hot conductor (breaker output, line/load hot, light hot, receptacle brass)
 * - neutral: neutral conductor (neutral bar, line/load neutral, light neutral, receptacle silver)
 * - ground: equipment grounding conductor
 * - traveler: 3-way switch traveler terminal
 * - switched: a terminal on the switched leg of a switch (single-pole terminals, 3-way common)
 */
export const TERMINAL_ROLES = ['hot', 'neutral', 'ground', 'traveler', 'switched'] as const;
export type TerminalRole = (typeof TERMINAL_ROLES)[number];

export type ScrewColor = 'brass' | 'silver' | 'green' | 'black';

export interface TerminalDef {
  name: string;
  role: TerminalRole;
  screw: ScrewColor;
}

export interface DeviceDef {
  /** Display name. */
  label: string;
  terminals: TerminalDef[];
}

export const CATALOGUE: Record<DeviceType, DeviceDef> = {
  breaker: {
    label: 'Breaker',
    terminals: [{ name: 'out', role: 'hot', screw: 'brass' }],
  },
  neutral_bar: {
    label: 'Neutral bar',
    terminals: [{ name: 'neutral_bar', role: 'neutral', screw: 'silver' }],
  },
  ground_bar: {
    label: 'Ground bar',
    terminals: [{ name: 'ground_bar', role: 'ground', screw: 'green' }],
  },
  switch_sp: {
    label: 'Switch',
    terminals: [
      { name: 't1', role: 'switched', screw: 'brass' },
      { name: 't2', role: 'switched', screw: 'brass' },
      { name: 'ground', role: 'ground', screw: 'green' },
    ],
  },
  switch_3way: {
    label: '3-way',
    terminals: [
      { name: 'common', role: 'switched', screw: 'black' },
      { name: 'traveler_b', role: 'traveler', screw: 'brass' },
      { name: 'traveler_a', role: 'traveler', screw: 'brass' },
      { name: 'ground', role: 'ground', screw: 'green' },
    ],
  },
  light: {
    label: 'Light',
    terminals: [
      { name: 'hot', role: 'hot', screw: 'black' },
      { name: 'neutral', role: 'neutral', screw: 'silver' },
      { name: 'ground', role: 'ground', screw: 'green' },
    ],
  },
  duplex: {
    label: 'Receptacle',
    terminals: [
      { name: 'brass', role: 'hot', screw: 'brass' },
      { name: 'silver', role: 'neutral', screw: 'silver' },
      { name: 'ground', role: 'ground', screw: 'green' },
    ],
  },
  fan: {
    label: 'Fan',
    terminals: [
      { name: 'hot', role: 'hot', screw: 'black' },
      { name: 'neutral', role: 'neutral', screw: 'silver' },
      { name: 'ground', role: 'ground', screw: 'green' },
    ],
  },
  gfci: {
    label: 'GFCI',
    terminals: [
      { name: 'line_hot', role: 'hot', screw: 'brass' },
      { name: 'line_neutral', role: 'neutral', screw: 'silver' },
      { name: 'ground', role: 'ground', screw: 'green' },
      { name: 'load_hot', role: 'hot', screw: 'brass' },
      { name: 'load_neutral', role: 'neutral', screw: 'silver' },
    ],
  },
};

/** Device types whose terminals may take any number of connections (bus bars). */
export const BUS_BAR_TYPES: readonly DeviceType[] = ['neutral_bar', 'ground_bar'];

export function findTerminal(type: DeviceType, terminal: string): TerminalDef | undefined {
  return CATALOGUE[type].terminals.find((t) => t.name === terminal);
}

/** Every valid (deviceType, terminal) pair, e.g. to build an enum for structured LLM output. */
export function deviceTerminalPairs(): { deviceType: DeviceType; terminal: string }[] {
  return DEVICE_TYPES.flatMap((deviceType) =>
    CATALOGUE[deviceType].terminals.map((t) => ({ deviceType, terminal: t.name })),
  );
}

/**
 * Current paths inside a device, between two of its terminals (used to trace power for rule checks).
 * - switched: the switch connects the two terminals when closed (a 3-way connects its common to one traveler at a time)
 * - protected: GFCI pass-through; the load terminal is fed from the line terminal and is ground-fault protected
 * Devices not listed have no internal paths for tracing purposes (loads, bus bars, the breaker).
 */
export type InternalPathKind = 'switched' | 'protected';

export interface InternalPath {
  /** Source side first: for a switch either end may feed the other; for 'protected' the line side feeds the load side. */
  from: string;
  to: string;
  kind: InternalPathKind;
  /** Which kind of net the path carries. */
  conductor: 'hot' | 'neutral';
}

export const INTERNAL_PATHS: Partial<Record<DeviceType, readonly InternalPath[]>> = {
  switch_sp: [{ from: 't1', to: 't2', kind: 'switched', conductor: 'hot' }],
  switch_3way: [
    { from: 'common', to: 'traveler_a', kind: 'switched', conductor: 'hot' },
    { from: 'common', to: 'traveler_b', kind: 'switched', conductor: 'hot' },
  ],
  gfci: [
    { from: 'line_hot', to: 'load_hot', kind: 'protected', conductor: 'hot' },
    { from: 'line_neutral', to: 'load_neutral', kind: 'protected', conductor: 'neutral' },
  ],
};

export function internalPaths(type: DeviceType): readonly InternalPath[] {
  return INTERNAL_PATHS[type] ?? [];
}
