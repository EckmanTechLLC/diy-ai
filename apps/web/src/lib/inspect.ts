// Plain-language descriptions of what is selected in the diagram. Pure functions of the circuit model and
// core's catalogue: nothing here knows about a particular circuit, the DOM or the layout.
import {
  CATALOGUE,
  cableLabel,
  computeNets,
  conductorsOf,
  endpointKey,
  findTerminal,
  orient,
  type CircuitModel,
  type Connection,
  type Endpoint,
  type ScrewColor,
  type TerminalRole,
  type WireColor,
} from '@diy-ai/core';

export type Selection =
  | { kind: 'net'; net: string }
  | { kind: 'device'; id: string }
  | { kind: 'cable'; id: string }
  | { kind: 'splice'; id: string };

export const sameSelection = (a: Selection | null, b: Selection | null): boolean =>
  a === b ||
  (!!a && !!b && a.kind === b.kind && (a.kind === 'net' ? a.net === (b as typeof a).net : a.id === (b as { id: string }).id));

/** A place a wire lands: text for people, and what clicking it should select. */
export interface Place {
  text: string;
  ref: Selection;
}

export interface WireLink {
  color: WireColor;
  to: Place;
}

export interface NetDescription {
  kind: 'net';
  net: string;
  title: string;
  colors: WireColor[];
  /** Roles of the terminals on the net, in order from panel to load, without repeats. */
  roles: TerminalRole[];
  /** Every place the net lands, in order from panel to load. */
  places: Place[];
}
export interface DeviceDescription {
  kind: 'device';
  id: string;
  name: string;
  type: string;
  box: string;
  amps?: number;
  terminals: { name: string; screw: ScrewColor; role: TerminalRole; connections: (WireLink & { net: string })[] }[];
}
export interface CableDescription {
  kind: 'cable';
  id: string;
  name: string;
  type: string;
  from: string;
  to: string;
  conductors: { color: WireColor; net: string | null; ends: { box: string; to: Place | null }[] }[];
}
export interface SpliceDescription {
  kind: 'splice';
  id: string;
  name: string;
  box: string;
  wires: (WireLink & { net: string })[];
}
export type Description = NetDescription | DeviceDescription | CableDescription | SpliceDescription;

export const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export const colorName = (c: WireColor): string => (c === 'bare' ? 'bare copper' : c);

const boxLabel = (m: CircuitModel, id: string): string => m.boxes.find((b) => b.id === id)?.label ?? id;

export function spliceName(m: CircuitModel, id: string): string {
  const s = m.splices.find((x) => x.id === id);
  if (!s) return 'Wire nut';
  const inBox = m.splices.filter((x) => x.box === s.box);
  const where = `Wire nut${inBox.length > 1 ? ` ${inBox.indexOf(s) + 1} of ${inBox.length}` : ''} in ${boxLabel(m, s.box)}`;
  return where;
}

/** Where an endpoint is, e.g. `Switch · t1`, `cable 14/2 "feed" black`, `Wire nut in Switch box`. */
export function placeOf(m: CircuitModel, e: Endpoint): Place {
  switch (e.kind) {
    case 'terminal': {
      const d = m.devices.find((x) => x.id === e.device);
      // devices may share a label (two lights): say which box when the label alone is ambiguous
      const shared = d && m.devices.some((x) => x !== d && x.label === d.label);
      const name = d ? (shared ? `${d.label} in ${boxLabel(m, d.box)}` : d.label) : e.device;
      return { text: `${name} · ${e.terminal}`, ref: { kind: 'device', id: e.device } };
    }
    case 'conductor': {
      const k = m.cables.find((x) => x.id === e.cable);
      return { text: `cable ${k ? `${k.type} "${k.name}"` : e.cable} ${e.color}`, ref: { kind: 'cable', id: e.cable } };
    }
    case 'splice':
      return { text: spliceName(m, e.splice), ref: { kind: 'splice', id: e.splice } };
  }
}

/** Connections of a net id (see computeNets), in model order. */
const connectionsOfNet = (m: CircuitModel, net: string, nets = computeNets(m)): Connection[] =>
  m.connections.filter((c) => nets.get(c.id) === net);

/**
 * Endpoints of one net ordered from panel to load: connections are directed with core's `orient`, and an
 * endpoint is placed after everything that feeds it (longest path from a source). Ties keep model order.
 */
function orderedEndpoints(m: CircuitModel, conns: Connection[]): Endpoint[] {
  const byKey = new Map<string, Endpoint>();
  const edges: [string, string][] = [];
  for (const c of conns) {
    const [from, to] = orient(m, c);
    for (const e of [from, to]) if (!byKey.has(endpointKey(e))) byKey.set(endpointKey(e), e);
    edges.push([endpointKey(from), endpointKey(to)]);
  }
  const keys = [...byKey.keys()];
  const depth = new Map(keys.map((k) => [k, 0]));
  // Bellman-Ford style relaxation; bounded so a (invalid) loop cannot hang it
  for (let pass = 0; pass < keys.length; pass++) {
    let changed = false;
    for (const [a, b] of edges) {
      if (depth.get(b)! < depth.get(a)! + 1 && depth.get(a)! < keys.length) {
        depth.set(b, depth.get(a)! + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return keys
    .map((k, i) => ({ k, i }))
    .sort((x, y) => depth.get(x.k)! - depth.get(y.k)! || x.i - y.i)
    .map((x) => byKey.get(x.k)!);
}

const unique = <T>(xs: T[]): T[] => [...new Set(xs)];

const wireTitle = (colors: WireColor[]): string =>
  colors.length === 0 ? 'Wire' : `${capitalize(colors.map(colorName).join(' / '))} wire`;

export function describeNet(m: CircuitModel, net: string): NetDescription | null {
  const nets = computeNets(m);
  const conns = connectionsOfNet(m, net, nets);
  if (conns.length === 0) return null;
  const ends = orderedEndpoints(m, conns);
  const colors = unique(conns.map((c) => c.color));
  const roles = unique(
    ends.flatMap((e) => {
      if (e.kind !== 'terminal') return [];
      const dev = m.devices.find((d) => d.id === e.device);
      const role = dev && findTerminal(dev.type, e.terminal)?.role;
      return role ? [role] : [];
    }),
  );
  return { kind: 'net', net, title: wireTitle(colors), colors, roles, places: ends.map((e) => placeOf(m, e)) };
}

/** "hot", or "hot, then switched" when the terminals on the net have different roles. */
export const rolesText = (roles: TerminalRole[]): string => (roles.length === 0 ? 'not set by any device' : roles.join(', then '));

/** The places of a net as one line, e.g. `Breaker 15A · out → cable 14/2 "feed" black → Switch · t1`. */
export const placesText = (places: Place[]): string => places.map((p) => p.text).join(' → ');

function linksOf(m: CircuitModel, match: (e: Endpoint) => boolean, nets: Map<string, string>): (WireLink & { net: string })[] {
  const out: (WireLink & { net: string })[] = [];
  for (const c of m.connections) {
    const other = match(c.a) ? c.b : match(c.b) ? c.a : null;
    if (other) out.push({ color: c.color, to: placeOf(m, other), net: nets.get(c.id)! });
  }
  return out;
}

export function describeDevice(m: CircuitModel, id: string): DeviceDescription | null {
  const d = m.devices.find((x) => x.id === id);
  if (!d) return null;
  const nets = computeNets(m);
  return {
    kind: 'device',
    id,
    name: d.label,
    type: CATALOGUE[d.type].label,
    box: boxLabel(m, d.box),
    ...(d.amps === undefined ? {} : { amps: d.amps }),
    terminals: CATALOGUE[d.type].terminals.map((t) => ({
      name: t.name,
      screw: t.screw,
      role: t.role,
      connections: linksOf(m, (e) => e.kind === 'terminal' && e.device === id && e.terminal === t.name, nets),
    })),
  };
}

export function describeCable(m: CircuitModel, id: string): CableDescription | null {
  const k = m.cables.find((x) => x.id === id);
  if (!k) return null;
  const nets = computeNets(m);
  return {
    kind: 'cable',
    id,
    name: cableLabel(k),
    type: k.type,
    from: boxLabel(m, k.from),
    to: boxLabel(m, k.to),
    conductors: conductorsOf(k.type).map((color) => {
      const mine = (e: Endpoint, box?: string) =>
        e.kind === 'conductor' && e.cable === id && e.color === color && (box === undefined || e.box === box);
      const any = m.connections.find((c) => mine(c.a) || mine(c.b));
      return {
        color,
        net: any ? (nets.get(any.id) ?? null) : null,
        ends: [k.from, k.to].map((box) => {
          const c = m.connections.find((x) => mine(x.a, box) || mine(x.b, box));
          return { box: boxLabel(m, box), to: c ? placeOf(m, mine(c.a, box) ? c.b : c.a) : null };
        }),
      };
    }),
  };
}

export function describeSplice(m: CircuitModel, id: string): SpliceDescription | null {
  const s = m.splices.find((x) => x.id === id);
  if (!s) return null;
  return {
    kind: 'splice',
    id,
    name: spliceName(m, id),
    box: boxLabel(m, s.box),
    wires: linksOf(m, (e) => e.kind === 'splice' && e.splice === id, computeNets(m)),
  };
}

export function describe(m: CircuitModel, sel: Selection): Description | null {
  switch (sel.kind) {
    case 'net':
      return describeNet(m, sel.net);
    case 'device':
      return describeDevice(m, sel.id);
    case 'cable':
      return describeCable(m, sel.id);
    case 'splice':
      return describeSplice(m, sel.id);
  }
}

/** Short text for a hover tooltip over a wire: what it is and where it runs. */
export function wireTooltip(m: CircuitModel, net: string): { title: string; detail: string } | null {
  const d = describeNet(m, net);
  if (!d) return null;
  const first = d.places[0]?.text;
  const last = d.places[d.places.length - 1]?.text;
  const roles = d.roles.length > 0 ? ` (${d.roles.join(', then ')})` : '';
  return { title: `${d.title}${roles}`, detail: first && last && first !== last ? `${first} → ${last}` : (first ?? '') };
}

/** What to light up on the canvas for a selection: wires by connection id (and net), and item groups by id. */
export interface Highlight {
  net: string | null;
  connections: Set<string>;
  devices: Set<string>;
  cables: Set<string>;
  splices: Set<string>;
  /** Only set by finding highlights. */
  boxes?: Set<string>;
}

export function highlightOf(m: CircuitModel, sel: Selection): Highlight {
  const h: Highlight = { net: null, connections: new Set(), devices: new Set(), cables: new Set(), splices: new Set() };
  const nets = computeNets(m);
  switch (sel.kind) {
    case 'net':
      h.net = sel.net;
      for (const c of connectionsOfNet(m, sel.net, nets)) h.connections.add(c.id);
      break;
    case 'device':
      h.devices.add(sel.id);
      for (const c of m.connections) if ([c.a, c.b].some((e) => e.kind === 'terminal' && e.device === sel.id)) h.connections.add(c.id);
      break;
    case 'cable':
      h.cables.add(sel.id);
      for (const c of m.connections) if ([c.a, c.b].some((e) => e.kind === 'conductor' && e.cable === sel.id)) h.connections.add(c.id);
      break;
    case 'splice':
      h.splices.add(sel.id);
      for (const c of m.connections) if ([c.a, c.b].some((e) => e.kind === 'splice' && e.splice === sel.id)) h.connections.add(c.id);
      break;
  }
  return h;
}
