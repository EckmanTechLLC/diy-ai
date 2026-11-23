import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode, ElkExtendedEdge } from 'elkjs/lib/elk-api';
import { computeNets, validateCircuit, type CircuitModel, type Issue, type WireColor } from '@diy-ai/core';
import { WRAP_RUN_OPTIONS, buildBoxGraph, buildTopGraph, cablePortId, topEdgeId, type BoxPlan } from './twoLevel';

export interface Pt {
  x: number;
  y: number;
}
export type NodeKind = 'box' | 'device' | 'cable' | 'splice';

/** ELK geometry, only re-keyed and flattened. Nothing is moved or rerouted. */
export interface LNode {
  id: string; // elk id, e.g. "dev:sw"
  kind: NodeKind;
  modelId: string;
  parent?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface LPort {
  id: string;
  node: string;
  x: number; // absolute (ELK reports ports in root coords too when shapeCoords=ROOT)
  y: number;
}
export interface LEdge {
  id: string; // = connection id
  net: string;
  color: WireColor;
  source: string; // port id
  target: string;
  points: Pt[];
}
export type LayoutMode = 'strip' | 'wrapped';

export interface Layout {
  /** Which top-level layout this is: one left-to-right strip, or ELK's wrapping of the strip into rows. */
  mode: LayoutMode;
  width: number;
  height: number;
  nodes: LNode[];
  ports: Map<string, LPort>;
  /** Ports on box borders where wires pass between box interior and the outside (node = box). */
  boundary: Map<string, LPort>;
  edges: LEdge[];
}

const elk = new ELK();

/** Thrown (as a rejection) by layoutCircuit when the model fails validateCircuit. */
export class InvalidCircuitError extends Error {
  constructor(readonly issues: Issue[]) {
    super(`invalid circuit model: ${issues.map((i) => `${i.code} ${i.message}`).join('; ')}`);
    this.name = 'InvalidCircuitError';
  }
}

const kindOf = (id: string): NodeKind =>
  id.startsWith('box:') ? 'box' : id.startsWith('dev:') ? 'device' : id.startsWith('cab:') ? 'cable' : 'splice';

/**
 * Crossings between routed segments of different nets: a horizontal segment and a vertical
 * segment that intersect strictly inside both. Shared endpoints and T-touches do not count.
 */
export function countCrossings(layout: Layout, eps = 0.01): number {
  const segs: { net: string; a: Pt; b: Pt }[] = [];
  for (const e of layout.edges)
    for (let i = 0; i + 1 < e.points.length; i++) segs.push({ net: e.net, a: e.points[i], b: e.points[i + 1] });
  const horiz = segs.filter((s) => Math.abs(s.a.y - s.b.y) <= eps && Math.abs(s.a.x - s.b.x) > eps);
  const vert = segs.filter((s) => Math.abs(s.a.x - s.b.x) <= eps && Math.abs(s.a.y - s.b.y) > eps);
  let n = 0;
  for (const h of horiz)
    for (const v of vert) {
      if (h.net === v.net) continue;
      const x = v.a.x;
      const y = h.a.y;
      if (
        x > Math.min(h.a.x, h.b.x) + eps &&
        x < Math.max(h.a.x, h.b.x) - eps &&
        y > Math.min(v.a.y, v.b.y) + eps &&
        y < Math.max(v.a.y, v.b.y) - eps
      )
        n++;
    }
  return n;
}

const pts = (e: ElkExtendedEdge): Pt[] => {
  const s = e.sections![0];
  return [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((p) => ({ x: p.x, y: p.y }));
};
const shift = (ps: Pt[], dx: number, dy: number): Pt[] => ps.map((p) => ({ x: p.x + dx, y: p.y + dy }));

/** A strip wider than this (diagram units, about px at 100%) is laid out again with ELK's wrapping. */
export const WRAP_THRESHOLD = 2400;

export interface LayoutOptions {
  /** `auto` (default): the strip, or the wrapped layout when the strip is wider than WRAP_THRESHOLD. `strip` / `wrapped` force one. */
  mode?: 'auto' | LayoutMode;
}

/**
 * Two-level path: per-box ELK runs for the interiors, then one ELK run for boxes and cables. The final
 * wires are the interior routes translated by the box's top-level position, joined to the top-level
 * routes at the boundary port. Nothing else is moved, and no point is edited. In `auto` mode the top-level
 * run is repeated with ELK's wrapping when the strip comes out wider than WRAP_THRESHOLD.
 */
export async function layoutCircuit(model: CircuitModel, options: LayoutOptions = {}): Promise<Layout> {
  const issues = validateCircuit(model);
  if (issues.length > 0) throw new InvalidCircuitError(issues);
  const plans = new Map<string, BoxPlan>();
  const runs = new Map<string, ElkNode>();
  for (const b of model.boxes) {
    const plan = buildBoxGraph(model, b.id);
    plans.set(b.id, plan);
    runs.set(b.id, await elk.layout(plan.graph));
  }
  const sizes = new Map<string, { width: number; height: number; ports: { id: string; side: 'WEST' | 'EAST'; x: number; y: number }[] }>();
  for (const [id, plan] of plans) {
    const run = runs.get(id)!;
    const stubPorts = new Map<string, { x: number; y: number }>();
    for (const c of run.children ?? []) for (const p of c.ports ?? []) stubPorts.set(p.id, { x: p.x ?? 0, y: p.y ?? 0 });
    sizes.set(id, {
      width: run.width ?? 0,
      height: run.height ?? 0,
      ports: plan.boundary.map((b) => ({ id: b.id, side: b.side, ...stubPorts.get(b.id)! })),
    });
  }
  const mode = options.mode ?? 'auto';
  let wrapped = mode === 'wrapped';
  let top = await elk.layout(buildTopGraph(model, sizes, plans, wrapped ? WRAP_RUN_OPTIONS : undefined));
  if (mode === 'auto' && (top.width ?? 0) > WRAP_THRESHOLD) {
    top = await elk.layout(buildTopGraph(model, sizes, plans, WRAP_RUN_OPTIONS));
    wrapped = true;
  }

  const nodes: LNode[] = [];
  const ports = new Map<string, LPort>();
  const boundary = new Map<string, LPort>();
  const offset = new Map<string, Pt>();
  for (const c of top.children ?? []) {
    nodes.push({
      id: c.id,
      kind: kindOf(c.id),
      modelId: c.id.slice(c.id.indexOf(':') + 1),
      x: c.x ?? 0,
      y: c.y ?? 0,
      width: c.width ?? 0,
      height: c.height ?? 0,
    });
    for (const p of c.ports ?? []) (c.id.startsWith('box:') ? boundary : ports).set(p.id, { id: p.id, node: c.id, x: p.x ?? 0, y: p.y ?? 0 });
    if (c.id.startsWith('box:')) offset.set(c.id.slice(4), { x: c.x ?? 0, y: c.y ?? 0 });
  }
  const topEdges = new Map((top.edges as ElkExtendedEdge[]).map((e) => [e.id, pts(e)]));

  const inner = new Map<string, Pt[]>();
  const innerEdges = new Map<string, ElkExtendedEdge>();
  for (const b of model.boxes) {
    const o = offset.get(b.id)!;
    for (const c of runs.get(b.id)!.children ?? []) {
      if (c.id.startsWith('stub:')) continue;
      nodes.push({
        id: c.id,
        kind: kindOf(c.id),
        modelId: c.id.slice(c.id.indexOf(':') + 1),
        parent: `box:${b.id}`,
        x: (c.x ?? 0) + o.x,
        y: (c.y ?? 0) + o.y,
        width: c.width ?? 0,
        height: c.height ?? 0,
      });
      for (const p of c.ports ?? []) ports.set(p.id, { id: p.id, node: c.id, x: (p.x ?? 0) + o.x, y: (p.y ?? 0) + o.y });
    }
    for (const e of (runs.get(b.id)!.edges ?? []) as ElkExtendedEdge[]) {
      inner.set(e.id, shift(pts(e), o.x, o.y));
      innerEdges.set(e.id, e);
    }
  }

  const nets = computeNets(model);
  const edges: LEdge[] = model.connections.map((c) => {
    const e = innerEdges.get(c.id)!;
    let points = inner.get(c.id)!;
    let source = e.sources[0];
    let target = e.targets[0];
    // a boundary port stands for a cable conductor: the wire continues outside the box to the cable's port
    for (const end of ['source', 'target'] as const) {
      const id = end === 'source' ? source : target;
      const m = /^bnd:[^.]+\.([^.]+)\.(.+)$/.exec(id);
      if (!m) continue;
      const cable = model.cables.find((k) => k.id === m[1])!;
      const box = id.slice(4, id.indexOf('.'));
      const side = cable.to === box ? 'b' : 'a';
      const t = topEdges.get(topEdgeId(m[1], m[2] as WireColor, side))!;
      const cab = cablePortId(m[1], m[2] as WireColor, side);
      if (end === 'source') {
        points = [...t, ...points.slice(1)];
        source = cab;
      } else {
        points = [...points.slice(0, -1), ...t];
        target = cab;
      }
    }
    return { id: c.id, net: nets.get(c.id)!, color: c.color, source, target, points };
  });
  return { mode: wrapped ? 'wrapped' : 'strip', width: top.width ?? 0, height: top.height ?? 0, nodes, ports, boundary, edges };
}

export interface Metrics {
  crossings: number;
  /** Sum of all wire polyline lengths. */
  length: number;
  /** Direction changes along wires (collinear joints and zero-length steps do not count). */
  bends: number;
}

export function layoutMetrics(layout: Layout, eps = 0.01): Metrics {
  let length = 0;
  let bends = 0;
  for (const e of layout.edges) {
    const p = e.points.filter((q, i) => i === 0 || Math.abs(q.x - e.points[i - 1].x) > eps || Math.abs(q.y - e.points[i - 1].y) > eps);
    for (let i = 0; i + 1 < p.length; i++) {
      length += Math.abs(p[i + 1].x - p[i].x) + Math.abs(p[i + 1].y - p[i].y);
      if (i + 2 < p.length) {
        const h1 = Math.abs(p[i + 1].y - p[i].y) <= eps;
        const h2 = Math.abs(p[i + 2].y - p[i + 1].y) <= eps;
        if (h1 !== h2) bends++;
      }
    }
  }
  return { crossings: countCrossings(layout, eps), length: Math.round(length), bends };
}
