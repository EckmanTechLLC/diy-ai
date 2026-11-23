// Net analysis for rule checks: groups the circuit into electrical nets and classifies each one by what
// feeds it. Pure; assumes a structurally valid model (see validateCircuit).
import { findTerminal, internalPaths, type DeviceType } from './catalogue';
import { computeNets, endpointKey } from './nets';
import type { CircuitModel, Endpoint, WireColor } from './schema';

/**
 * What a net is, electrically:
 * - source_hot: contains the breaker output
 * - neutral / ground: contains the neutral bar / ground bar
 * - switched_hot: reachable from a hot net through a switch (single-pole, or 3-way common to traveler)
 * - traveler: holds a 3-way traveler terminal (and is not one of the panel nets)
 * - protected_hot / protected_neutral: on the load side of a correctly fed GFCI
 * - floating: connected to none of the above
 * A net holding more than one panel terminal (a short) takes the first of ground, neutral, source_hot;
 * `anchors` always lists all of them.
 */
export const NET_ROLES = [
  'source_hot',
  'neutral',
  'ground',
  'switched_hot',
  'traveler',
  'protected_hot',
  'protected_neutral',
  'floating',
] as const;
export type NetRole = (typeof NET_ROLES)[number];

/** Roles that carry the breaker's hot conductor, directly or through switches and GFCIs. */
export const HOT_ROLES: readonly NetRole[] = ['source_hot', 'switched_hot', 'protected_hot'];

export type Anchor = 'source_hot' | 'neutral' | 'ground';

export interface TerminalRef {
  device: string;
  terminal: string;
}

export interface NetInfo {
  /** Same id as `computeNets` gives the net's connections. */
  id: string;
  role: NetRole;
  /** Panel terminals on this net: breaker output, neutral bar, ground bar. More than one means a short. */
  anchors: Anchor[];
  /** True when power from the breaker can reach the net (through switch paths and GFCI pass-through). */
  live: boolean;
  terminals: TerminalRef[];
  conductors: { cable: string; color: WireColor }[];
  splices: string[];
  /** Connection ids, in model order. */
  connections: string[];
}

export interface CircuitAnalysis {
  /** In order of first appearance in `model.connections`. */
  nets: NetInfo[];
  /** Undefined when the terminal has no connection. */
  netOfTerminal(device: string, terminal: string): NetInfo | undefined;
  netOfConnection(connection: string): NetInfo | undefined;
  netOfConductor(cable: string, color: WireColor): NetInfo | undefined;
}

const ANCHOR_OF: Partial<Record<DeviceType, Anchor>> = {
  breaker: 'source_hot',
  neutral_bar: 'neutral',
  ground_bar: 'ground',
};

export interface AnalyzeOptions {
  /** Devices whose internal paths are not followed (used to ask "is this fed from somewhere else?"). */
  ignoreDevices?: ReadonlySet<string>;
}

export function analyzeNets(model: CircuitModel, options: AnalyzeOptions = {}): CircuitAnalysis {
  const ignore = options.ignoreDevices ?? new Set<string>();
  const deviceType = new Map(model.devices.map((d) => [d.id, d.type]));
  const netIdOfConnection = computeNets(model);

  const nets = new Map<string, NetInfo>();
  const byTerminal = new Map<string, NetInfo>();
  const byConductor = new Map<string, NetInfo>();
  const seen = new Set<string>();
  for (const c of model.connections) {
    const id = netIdOfConnection.get(c.id)!;
    let net = nets.get(id);
    if (!net) {
      net = { id, role: 'floating', anchors: [], live: false, terminals: [], conductors: [], splices: [], connections: [] };
      nets.set(id, net);
    }
    net.connections.push(c.id);
    for (const e of [c.a, c.b] as Endpoint[]) {
      const key = endpointKey(e);
      if (seen.has(key)) continue;
      seen.add(key);
      if (e.kind === 'terminal') {
        net.terminals.push({ device: e.device, terminal: e.terminal });
        byTerminal.set(`${e.device}.${e.terminal}`, net);
        const anchor = ANCHOR_OF[deviceType.get(e.device)!];
        if (anchor && !net.anchors.includes(anchor)) net.anchors.push(anchor);
      } else if (e.kind === 'conductor') {
        net.conductors.push({ cable: e.cable, color: e.color });
        byConductor.set(`${e.cable}.${e.color}`, net);
      } else net.splices.push(e.splice);
    }
  }

  const lookup = (device: string, terminal: string) => byTerminal.get(`${device}.${terminal}`);
  const isTerminalRole = (device: string, terminal: string, role: string) => {
    const type = deviceType.get(device);
    return type !== undefined && findTerminal(type, terminal)?.role === role;
  };

  // Propagate power from the breaker. `via` records how a live net was reached; protected sticks.
  const via = new Map<string, 'source' | 'switched' | 'protected'>();
  const protectedNeutral = new Set<string>();
  for (const net of nets.values()) if (net.anchors.includes('source_hot')) via.set(net.id, 'source');
  const open = (n: NetInfo) => !n.anchors.includes('neutral') && !n.anchors.includes('ground');

  let changed = true;
  while (changed) {
    changed = false;
    for (const d of model.devices) {
      if (ignore.has(d.id)) continue;
      for (const path of internalPaths(d.type)) {
        const a = lookup(d.id, path.from);
        const b = lookup(d.id, path.to);
        if (!a || !b) continue;
        if (path.kind === 'switched') {
          for (const [x, y] of [[a, b], [b, a]] as const) {
            const how = via.get(x.id);
            if (how && !via.has(y.id) && open(y)) {
              via.set(y.id, how === 'protected' ? 'protected' : 'switched');
              changed = true;
            }
          }
        } else if (path.conductor === 'hot') {
          if (via.has(a.id) && !via.has(b.id) && open(b)) {
            via.set(b.id, 'protected');
            changed = true;
          }
        } else {
          // neutral pass-through counts only when the same device's hot pass-through is fed
          const hotPath = internalPaths(d.type).find((p) => p.kind === 'protected' && p.conductor === 'hot');
          const lineHot = hotPath && lookup(d.id, hotPath.from);
          const neutralSide = a.anchors.includes('neutral') || protectedNeutral.has(a.id);
          if (lineHot && via.has(lineHot.id) && neutralSide && b.anchors.length === 0 && !protectedNeutral.has(b.id)) {
            protectedNeutral.add(b.id);
            changed = true;
          }
        }
      }
    }
  }

  for (const net of nets.values()) {
    net.live = via.has(net.id);
    const hasTraveler = net.terminals.some((t) => isTerminalRole(t.device, t.terminal, 'traveler'));
    const how = via.get(net.id);
    if (net.anchors.includes('ground')) net.role = 'ground';
    else if (net.anchors.includes('neutral')) net.role = 'neutral';
    else if (net.anchors.includes('source_hot')) net.role = 'source_hot';
    else if (hasTraveler) net.role = 'traveler';
    else if (how === 'protected') net.role = 'protected_hot';
    else if (how === 'switched') net.role = 'switched_hot';
    else if (protectedNeutral.has(net.id)) net.role = 'protected_neutral';
    else net.role = 'floating';
  }

  return {
    nets: [...nets.values()],
    netOfTerminal: lookup,
    netOfConnection: (id) => {
      const nid = netIdOfConnection.get(id);
      return nid === undefined ? undefined : nets.get(nid);
    },
    netOfConductor: (cable, color) => byConductor.get(`${cable}.${color}`),
  };
}
