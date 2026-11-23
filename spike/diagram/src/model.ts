// Flat, topology-only circuit model (ADR-002). No coordinates anywhere.

export type WireColor = 'black' | 'white' | 'red' | 'bare' | 'green';

export type DeviceType =
  | 'breaker'
  | 'neutral_bar'
  | 'ground_bar'
  | 'switch_sp'
  | 'switch_3way'
  | 'light'
  | 'duplex'
  | 'gfci';

/** Drawing convention: conductors appear in this order, top to bottom, at every cable end in every diagram. */
export const CONDUCTOR_ORDER: WireColor[] = ['black', 'red', 'white', 'bare', 'green'];

export const orderedConductors = (conductors: WireColor[]): WireColor[] =>
  [...conductors].sort((a, b) => CONDUCTOR_ORDER.indexOf(a) - CONDUCTOR_ORDER.indexOf(b));

export interface Box {
  id: string;
  label: string;
  kind: 'panel' | 'box';
}

export interface Device {
  id: string;
  box: string;
  type: DeviceType;
  label: string;
}

export interface Cable {
  id: string;
  label: string; // e.g. "14/2 NM-B"
  /** Upstream box (panel side) and downstream box (load side). */
  from: string;
  to: string;
  conductors: WireColor[];
}

export interface Splice {
  id: string;
  box: string;
}

export type Endpoint =
  | { kind: 'terminal'; device: string; terminal: string }
  | { kind: 'conductor'; cable: string; color: WireColor; box: string }
  | { kind: 'splice'; splice: string };

export interface Connection {
  id: string;
  a: Endpoint;
  b: Endpoint;
  color: WireColor;
}

export interface CircuitModel {
  id: string;
  title: string;
  boxes: Box[];
  devices: Device[];
  cables: Cable[];
  splices: Splice[];
  connections: Connection[];
}

export function endpointKey(e: Endpoint): string {
  switch (e.kind) {
    case 'terminal':
      return `t:${e.device}.${e.terminal}`;
    case 'conductor':
      // both ends of one conductor are the same electrical node
      return `c:${e.cable}.${e.color}`;
    case 'splice':
      return `s:${e.splice}`;
  }
}

/** Electrical nets: union-find over connections. Returns connection id -> net id. */
export function computeNets(model: CircuitModel): Map<string, string> {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  for (const c of model.connections) {
    parent.set(find(endpointKey(c.a)), find(endpointKey(c.b)));
  }
  const names = new Map<string, string>();
  const out = new Map<string, string>();
  for (const c of model.connections) {
    const root = find(endpointKey(c.a));
    if (!names.has(root)) names.set(root, `${model.id}-n${names.size + 1}`);
    out.set(c.id, names.get(root)!);
  }
  return out;
}

/**
 * Direct a connection from the panel side toward the load side. A pigtail between a splice and a
 * terminal follows the terminal's drawn side: a terminal on the WEST side is fed by the splice, one
 * on the EAST side feeds it (so the arrow keeps pointing left to right).
 */
export function orient(
  model: CircuitModel,
  c: Connection,
  sideOf: (device: string, terminal: string) => 'WEST' | 'EAST' = () => 'WEST',
): [Endpoint, Endpoint] {
  const conductor = [c.a, c.b].find((e) => e.kind === 'conductor');
  const other = c.a === conductor ? c.b : c.a;
  if (conductor && conductor.kind === 'conductor') {
    const cable = model.cables.find((k) => k.id === conductor.cable)!;
    // conductor end at the cable's downstream box receives current from the cable
    return conductor.box === cable.to ? [conductor, other] : [other, conductor];
  }
  const splice = [c.a, c.b].find((e) => e.kind === 'splice');
  if (splice) {
    const term = splice === c.a ? c.b : c.a;
    if (term.kind === 'terminal' && sideOf(term.device, term.terminal) === 'EAST') return [term, splice];
    return [splice, term];
  }
  throw new Error(`cannot orient connection ${c.id}`);
}
