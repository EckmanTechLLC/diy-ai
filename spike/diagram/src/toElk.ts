import type { ElkNode, ElkPort, ElkExtendedEdge } from 'elkjs/lib/elk-api';
import { terminalsOf, mirroredDevices, CATALOGUE } from './catalogue';
import { orient, orderedConductors, type CircuitModel, type Endpoint } from './model';

export const ROOT_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  'elk.edgeRouting': 'ORTHOGONAL',
  // report all coordinates in the root coordinate system
  'elk.json.shapeCoords': 'ROOT',
  'elk.json.edgeCoords': 'ROOT',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.layered.spacing.nodeNodeBetweenLayers': '60',
  'elk.layered.spacing.edgeNodeBetweenLayers': '16',
  'elk.layered.spacing.edgeEdgeBetweenLayers': '12',
  'elk.spacing.nodeNode': '28',
  'elk.spacing.edgeNode': '16',
  'elk.spacing.edgeEdge': '12',
  'elk.padding': '[top=20,left=20,bottom=20,right=20]',
};

const BOX_OPTIONS: Record<string, string> = {
  'elk.padding': '[top=34,left=24,bottom=24,right=24]',
};

export const CABLE_W = 112;
/** Conductors run from the node edge to the jacket edge; the jacket is inset by this much on both ends. */
export const CABLE_JACKET_INSET = 16;
export const CABLE_PITCH = 18;
export const CABLE_TOP = 6;
export const SPLICE_W = 30;
export const SPLICE_PITCH = 14;

const keyOf = (e: Endpoint): string => {
  switch (e.kind) {
    case 'terminal':
      return `dev:${e.device}.${e.terminal}`;
    default:
      return '';
  }
};

export const cablePortY = (i: number): number => CABLE_TOP + i * CABLE_PITCH + CABLE_PITCH / 2;

export function cableHeight(n: number): number {
  return CABLE_TOP + n * CABLE_PITCH + 6;
}

/** Pure: topology model -> ELK graph. Node sizes and fixed terminal positions come from the catalogue. */
export function toElkGraph(model: CircuitModel): ElkNode {
  const edges: ElkExtendedEdge[] = [];
  const spliceIn = new Map<string, string[]>();
  const feedsInput = new Set<string>(); // splices that feed a terminal drawn on a device's WEST side
  const spliceOut = new Map<string, string[]>();

  const portOf = (e: Endpoint, connId: string, role: 'source' | 'target'): string => {
    if (e.kind === 'terminal') return keyOf(e);
    if (e.kind === 'conductor') {
      const cable = model.cables.find((c) => c.id === e.cable)!;
      return `cab:${e.cable}.${e.color}.${e.box === cable.from ? 'a' : 'b'}`;
    }
    const id = `spl:${e.splice}.${connId}`;
    const m = role === 'target' ? spliceIn : spliceOut; // splice receives when it is the target
    if (!m.has(e.splice)) m.set(e.splice, []);
    m.get(e.splice)!.push(id);
    return id;
  };

  const mirrored = mirroredDevices(model);
  const deviceType = new Map(model.devices.map((d) => [d.id, d.type]));
  const sideOf = (device: string, terminal: string) =>
    terminalsOf(deviceType.get(device)!, mirrored.has(device)).find((t) => t.name === terminal)!.side;

  for (const c of model.connections) {
    const [src, tgt] = orient(model, c, sideOf);
    if (src.kind === 'splice' && tgt.kind === 'terminal') feedsInput.add(src.splice);
    edges.push({
      id: c.id,
      sources: [portOf(src, c.id, 'source')],
      targets: [portOf(tgt, c.id, 'target')],
    });
  }

  const boxChildren = new Map<string, ElkNode[]>();
  for (const b of model.boxes) boxChildren.set(b.id, []);

  for (const d of model.devices) {
    const def = CATALOGUE[d.type];
    const ports: ElkPort[] = terminalsOf(d.type, mirrored.has(d.id)).map((t) => ({
      id: `dev:${d.id}.${t.name}`,
      x: t.x,
      y: t.y,
      width: 0,
      height: 0,
      layoutOptions: { 'elk.port.side': t.side },
    }));
    boxChildren.get(d.box)!.push({
      id: `dev:${d.id}`,
      width: def.width,
      height: def.height,
      ports,
      layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
    });
  }

  for (const s of model.splices) {
    const ins = spliceIn.get(s.id) ?? [];
    const outs = spliceOut.get(s.id) ?? [];
    const ports: ElkPort[] = [
      ...ins.map((id) => ({ id, width: 0, height: 0, layoutOptions: { 'elk.port.side': 'WEST' } })),
      ...outs.map((id) => ({ id, width: 0, height: 0, layoutOptions: { 'elk.port.side': 'EAST' } })),
    ];
    boxChildren.get(s.box)!.push({
      id: `spl:${s.id}`,
      width: SPLICE_W,
      height: Math.max(ins.length, outs.length, 1) * SPLICE_PITCH + 10,
      ports,
      layoutOptions: {
        'elk.portConstraints': 'FIXED_SIDE',
        // A splice that feeds no device input only passes wires on towards the load: keep it in the box's last layer.
        ...(feedsInput.has(s.id) ? {} : { 'elk.layered.layering.layerConstraint': 'LAST' }),
      },
    });
  }

  const boxes: ElkNode[] = model.boxes.map((b) => ({
    id: `box:${b.id}`,
    layoutOptions: BOX_OPTIONS,
    children: boxChildren.get(b.id)!,
  }));

  const cables: ElkNode[] = model.cables.map((k) => {
    const ports: ElkPort[] = [];
    orderedConductors(k.conductors).forEach((col, i) => {
      const y = cablePortY(i);
      ports.push({ id: `cab:${k.id}.${col}.a`, x: 0, y, width: 0, height: 0, layoutOptions: { 'elk.port.side': 'WEST' } });
      ports.push({ id: `cab:${k.id}.${col}.b`, x: CABLE_W, y, width: 0, height: 0, layoutOptions: { 'elk.port.side': 'EAST' } });
    });
    return {
      id: `cab:${k.id}`,
      width: CABLE_W,
      height: cableHeight(k.conductors.length),
      ports,
      layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
    };
  });

  return { id: 'root', layoutOptions: ROOT_OPTIONS, children: [...boxes, ...cables], edges };
}
