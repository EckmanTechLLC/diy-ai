import type { ElkNode, ElkPort, ElkExtendedEdge } from 'elkjs/lib/elk-api';
import { CATALOGUE, mirroredDevices, terminalsOf, type Side } from './catalogue';
import { orient, orderedConductors, type CircuitModel, type Endpoint, type WireColor } from './model';
import { CABLE_W, SPLICE_PITCH, SPLICE_W, cableHeight, cablePortY } from './toElk';

/**
 * Two-level layout, graph construction.
 *
 * Level 1 (one flat ELK `layered` run per box): the box interior. Every cable that enters or leaves the
 * box becomes one boundary stub node (width 0) whose ports are the cable's conductors in the fixed
 * conductor order, so the order cannot be changed by ELK. Stubs sit in their own first / last column, so
 * their ports lie exactly on the box's left / right border. ELK routes the interior wires.
 *
 * Level 2 (one flat ELK run): each box is a fixed-size node whose ports are the stub ports at the
 * positions level 1 produced (FIXED_POS); cable nodes as in the single run. ELK places boxes and
 * cables and routes the cable-to-box wires.
 *
 * SLOT RULE (same for every circuit, no per-circuit cases). A box interior has five columns, left to
 * right, enforced with ELK layout partitioning (a node only ever lands in a layer after every node of a
 * lower partition):
 *   0 incoming stubs   one per cable whose downstream end (`cable.to`) is this box
 *   1 feeder splices   splices that feed a terminal drawn on a device's WEST side (hot junctions)
 *   2 devices          all devices of the box
 *   3 pass splices     all other splices (neutral and ground nuts: they join cables, or take a pigtail
 *                      from an EAST-side terminal such as a switch ground screw)
 *   4 outgoing stubs   one per cable whose upstream end (`cable.from`) is this box
 * The order of nodes inside a column is left to ELK's crossing minimisation (model order is passed as
 * input; ELK may ignore it). Which side a terminal is drawn on comes from `mirroredDevices`.
 */
export const SLOT = { stubIn: 0, spliceFeed: 1, device: 2, splicePass: 3, stubOut: 4 } as const;

/** Options shared by both levels. */
const BASE: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.edgeRouting': 'ORTHOGONAL',
  // report all coordinates in the coordinate system of the graph being laid out
  'elk.json.shapeCoords': 'ROOT',
  'elk.json.edgeCoords': 'ROOT',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.layered.spacing.nodeNodeBetweenLayers': '60',
  'elk.layered.spacing.edgeNodeBetweenLayers': '16',
  'elk.layered.spacing.edgeEdgeBetweenLayers': '12',
  'elk.spacing.nodeNode': '28',
  'elk.spacing.edgeNode': '16',
  'elk.spacing.edgeEdge': '12',
};

export const BOX_RUN_OPTIONS: Record<string, string> = {
  ...BASE,
  'elk.partitioning.activate': 'true',
  // no side padding: the stub columns then sit exactly on the box border; the label strip is at the top
  'elk.padding': '[top=34,left=0,bottom=24,right=0]',
};

export const TOP_RUN_OPTIONS: Record<string, string> = {
  ...BASE,
  'elk.padding': '[top=20,left=20,bottom=20,right=20]',
};

export const stubId = (box: string, cable: string, side: 'in' | 'out') => `stub:${box}.${cable}.${side}`;
export const boundaryId = (box: string, cable: string, color: WireColor) => `bnd:${box}.${cable}.${color}`;
export const topEdgeId = (cable: string, color: WireColor, end: 'a' | 'b') => `top:${cable}.${color}.${end}`;
export const cablePortId = (cable: string, color: WireColor, end: 'a' | 'b') => `cab:${cable}.${color}.${end}`;

function boxOfEndpoint(model: CircuitModel, e: Endpoint): string {
  if (e.kind === 'conductor') return e.box;
  if (e.kind === 'splice') return model.splices.find((s) => s.id === e.splice)!.box;
  return model.devices.find((d) => d.id === e.device)!.box;
}

export interface BoxPlan {
  box: string;
  graph: ElkNode;
  /** Boundary ports in stub order: id, cable, colour, side of the box they sit on. */
  boundary: { id: string; cable: string; color: WireColor; side: Side }[];
}

export function buildBoxGraph(model: CircuitModel, boxId: string): BoxPlan {
  const mirrored = mirroredDevices(model);
  const deviceType = new Map(model.devices.map((d) => [d.id, d.type]));
  const sideOf = (device: string, terminal: string): Side =>
    terminalsOf(deviceType.get(device)!, mirrored.has(device)).find((t) => t.name === terminal)!.side;

  const conns = model.connections.filter((c) => boxOfEndpoint(model, c.a) === boxId && boxOfEndpoint(model, c.b) === boxId);

  const portOf = (e: Endpoint, connId: string): string => {
    if (e.kind === 'terminal') return `dev:${e.device}.${e.terminal}`;
    if (e.kind === 'conductor') return boundaryId(boxId, e.cable, e.color);
    return `spl:${e.splice}.${connId}`;
  };

  const spliceIn = new Map<string, string[]>();
  const spliceOut = new Map<string, string[]>();
  const feeds = new Set<string>();
  const used = new Map<string, Set<WireColor>>(); // stub id -> conductors that have a wire in this box
  const edges: ElkExtendedEdge[] = [];
  for (const c of conns) {
    const [src, tgt] = orient(model, c, sideOf);
    if (src.kind === 'splice' && tgt.kind === 'terminal') feeds.add(src.splice);
    for (const [e, m] of [[src, spliceOut], [tgt, spliceIn]] as const) {
      if (e.kind === 'splice') m.set(e.splice, [...(m.get(e.splice) ?? []), portOf(e, c.id)]);
      if (e.kind === 'conductor') {
        const cable = model.cables.find((k) => k.id === e.cable)!;
        const id = stubId(boxId, e.cable, cable.to === boxId ? 'in' : 'out');
        used.set(id, (used.get(id) ?? new Set()).add(e.color));
      }
    }
    edges.push({ id: c.id, sources: [portOf(src, c.id)], targets: [portOf(tgt, c.id)] });
  }

  const children: ElkNode[] = [];
  const boundary: BoxPlan['boundary'] = [];
  const part = (n: number) => ({ 'elk.partitioning.partition': String(n) });

  const stub = (cableId: string, side: 'in' | 'out') => {
    const cable = model.cables.find((k) => k.id === cableId)!;
    const cols = orderedConductors(cable.conductors);
    const id = stubId(boxId, cableId, side);
    const on = used.get(id);
    if (!on) return;
    const ports: ElkPort[] = cols
      .map((col, i) => ({ col, i }))
      .filter(({ col }) => on.has(col))
      .map(({ col, i }) => {
        boundary.push({ id: boundaryId(boxId, cableId, col), cable: cableId, color: col, side: side === 'in' ? 'WEST' : 'EAST' });
        return {
          id: boundaryId(boxId, cableId, col),
          x: 0,
          y: cablePortY(i),
          width: 0,
          height: 0,
          layoutOptions: { 'elk.port.side': side === 'in' ? 'EAST' : 'WEST' },
        };
      });
    children.push({
      id,
      width: 0,
      height: cableHeight(cols.length),
      ports,
      layoutOptions: { 'elk.portConstraints': 'FIXED_POS', ...part(side === 'in' ? SLOT.stubIn : SLOT.stubOut) },
    });
  };
  for (const k of model.cables) if (k.to === boxId) stub(k.id, 'in');
  for (const s of model.splices.filter((s) => s.box === boxId && feeds.has(s.id))) children.push(spliceNode(s.id, spliceIn, spliceOut, SLOT.spliceFeed));
  for (const d of model.devices.filter((d) => d.box === boxId)) {
    const def = CATALOGUE[d.type];
    children.push({
      id: `dev:${d.id}`,
      width: def.width,
      height: def.height,
      ports: terminalsOf(d.type, mirrored.has(d.id)).map((t) => ({
        id: `dev:${d.id}.${t.name}`,
        x: t.x,
        y: t.y,
        width: 0,
        height: 0,
        layoutOptions: { 'elk.port.side': t.side },
      })),
      layoutOptions: { 'elk.portConstraints': 'FIXED_POS', ...part(SLOT.device) },
    });
  }
  for (const s of model.splices.filter((s) => s.box === boxId && !feeds.has(s.id))) children.push(spliceNode(s.id, spliceIn, spliceOut, SLOT.splicePass));
  for (const k of model.cables) if (k.from === boxId) stub(k.id, 'out');

  return { box: boxId, boundary, graph: { id: `boxrun:${boxId}`, layoutOptions: BOX_RUN_OPTIONS, children, edges } };
}

function spliceNode(id: string, ins: Map<string, string[]>, outs: Map<string, string[]>, slot: number): ElkNode {
  const i = ins.get(id) ?? [];
  const o = outs.get(id) ?? [];
  return {
    id: `spl:${id}`,
    width: SPLICE_W,
    height: Math.max(i.length, o.length, 1) * SPLICE_PITCH + 10,
    ports: [
      ...i.map((p) => ({ id: p, width: 0, height: 0, layoutOptions: { 'elk.port.side': 'WEST' } })),
      ...o.map((p) => ({ id: p, width: 0, height: 0, layoutOptions: { 'elk.port.side': 'EAST' } })),
    ],
    layoutOptions: { 'elk.portConstraints': 'FIXED_SIDE', 'elk.partitioning.partition': String(slot) },
  };
}

/** Top level: boxes (fixed size, boundary ports at the level-1 positions) and cables; one edge per conductor end. */
export function buildTopGraph(
  model: CircuitModel,
  boxes: Map<string, { width: number; height: number; ports: { id: string; side: Side; x: number; y: number }[] }>,
  plans: Map<string, BoxPlan>,
): ElkNode {
  const children: ElkNode[] = [];
  const edges: ElkExtendedEdge[] = [];
  for (const b of model.boxes) {
    const g = boxes.get(b.id)!;
    children.push({
      id: `box:${b.id}`,
      width: g.width,
      height: g.height,
      ports: g.ports.map((p) => ({
        id: p.id,
        x: p.x,
        y: p.y,
        width: 0,
        height: 0,
        layoutOptions: { 'elk.port.side': p.side },
      })),
      layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
    });
  }
  for (const k of model.cables) {
    const ports: ElkPort[] = [];
    orderedConductors(k.conductors).forEach((col, i) => {
      const y = cablePortY(i);
      ports.push({ id: cablePortId(k.id, col, 'a'), x: 0, y, width: 0, height: 0, layoutOptions: { 'elk.port.side': 'WEST' } });
      ports.push({ id: cablePortId(k.id, col, 'b'), x: CABLE_W, y, width: 0, height: 0, layoutOptions: { 'elk.port.side': 'EAST' } });
    });
    children.push({
      id: `cab:${k.id}`,
      width: CABLE_W,
      height: cableHeight(k.conductors.length),
      ports,
      layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
    });
  }
  for (const plan of plans.values())
    for (const p of plan.boundary) {
      const upstream = p.side === 'WEST'; // box receives current from the cable
      const cab = cablePortId(p.cable, p.color, upstream ? 'b' : 'a');
      edges.push({
        id: topEdgeId(p.cable, p.color, upstream ? 'b' : 'a'),
        sources: [upstream ? cab : p.id],
        targets: [upstream ? p.id : cab],
      });
    }
  return { id: 'root', layoutOptions: TOP_RUN_OPTIONS, children, edges };
}
