// The invariants of invariants.test.ts as functions returning their violations (empty = holds), so the scale
// tests and the render script apply the same checks to any layout. Same logic and tolerances as invariants.test.ts.
import { conductorsOf, type CircuitModel } from '@diy-ai/core';
import { CONDUCTOR_ORDER, orderedConductors } from '../src/geometry';
import { countCrossings, layoutCircuit, layoutMetrics, type Layout, type LayoutOptions, type Pt } from '../src/layout';
import { renderSvg, textWidth } from '../src/render';

const EPS = 0.01;
/** The conductors of one cable run side by side: neighbouring conductors are never further apart than this. */
export const MAX_RUN_GAP = 30;

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}
interface TextBox extends Box {
  text: string;
}

function textBoxes(svg: string): TextBox[] {
  const out: TextBox[] = [];
  for (const m of svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)" font-size="(\d+)"([^>]*)>([^<]*)<\/text>/g)) {
    const [, xs, ys, fs, attrs, raw] = m;
    const text = raw.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
    const x = Number(xs);
    const y = Number(ys);
    const size = Number(fs);
    const w = textWidth(text, size, attrs.includes('bold'));
    const anchor = /text-anchor="(\w+)"/.exec(attrs)?.[1] ?? 'start';
    const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
    out.push({ text, x0, x1: x0 + w, y0: y - size * 0.8, y1: y + size * 0.2 });
  }
  return out;
}
const hit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

function groupOf(svg: string, kind: string, id: string): string {
  const start = svg.indexOf(`<g data-${kind}="${id}"`);
  const ends = ['\n<g data-', '\n<g class="wire" data-connection', '\n</svg>'].map((m) => svg.indexOf(m, start + 1)).filter((i) => i > 0);
  return svg.slice(start, Math.min(...ends));
}

interface Seg {
  edge: string;
  net: string;
  a: Pt;
  b: Pt;
}
function segments(layout: Layout): Seg[] {
  const out: Seg[] = [];
  for (const e of layout.edges)
    for (let i = 0; i + 1 < e.points.length; i++) out.push({ edge: e.id, net: e.net, a: e.points[i], b: e.points[i + 1] });
  return out;
}

export const INVARIANTS = [
  'oneEdgePerConnection',
  'orthogonal',
  'noCollinearOverlap',
  'noPassThrough',
  'bounds',
  'endpointsOnPorts',
  'insideBoxes',
  'boxBorderCrossings',
  'conductorOrder',
  'cableRunsAdjacent',
  'noDuplicateLabels',
  'labelsFit',
  'noLabelOverlap',
] as const;
export type InvariantName = (typeof INVARIANTS)[number];

export function checkInvariants(layout: Layout, model: CircuitModel): Record<InvariantName, string[]> {
  const svg = renderSvg(layout, model);
  const r = {} as Record<InvariantName, string[]>;

  r.oneEdgePerConnection = [];
  for (const c of model.connections) if (layout.edges.filter((e) => e.id === c.id).length !== 1) r.oneEdgePerConnection.push(c.id);
  if (layout.edges.length !== model.connections.length) r.oneEdgePerConnection.push(`edge count ${layout.edges.length} != ${model.connections.length}`);

  r.orthogonal = segments(layout).filter((s) => Math.abs(s.a.x - s.b.x) > EPS && Math.abs(s.a.y - s.b.y) > EPS).map((s) => s.edge);

  const segs = segments(layout);
  r.noCollinearOverlap = [];
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i];
      const t = segs[j];
      if (s.net === t.net) continue;
      const sh = Math.abs(s.a.y - s.b.y) <= EPS;
      const th = Math.abs(t.a.y - t.b.y) <= EPS;
      const sv = Math.abs(s.a.x - s.b.x) <= EPS;
      const tv = Math.abs(t.a.x - t.b.x) <= EPS;
      let overlap = 0;
      if (sh && th && Math.abs(s.a.y - t.a.y) <= EPS)
        overlap = Math.min(Math.max(s.a.x, s.b.x), Math.max(t.a.x, t.b.x)) - Math.max(Math.min(s.a.x, s.b.x), Math.min(t.a.x, t.b.x));
      else if (sv && tv && Math.abs(s.a.x - t.a.x) <= EPS)
        overlap = Math.min(Math.max(s.a.y, s.b.y), Math.max(t.a.y, t.b.y)) - Math.max(Math.min(s.a.y, s.b.y), Math.min(t.a.y, t.b.y));
      if (overlap > EPS) r.noCollinearOverlap.push(`${s.edge} x ${t.edge}`);
    }

  r.noPassThrough = [];
  const leaves = layout.nodes.filter((n) => n.kind !== 'box');
  for (const e of layout.edges) {
    const ends = new Set([layout.ports.get(e.source)!.node, layout.ports.get(e.target)!.node]);
    for (let i = 0; i + 1 < e.points.length; i++) {
      const a = e.points[i];
      const b = e.points[i + 1];
      const x0 = Math.min(a.x, b.x);
      const x1 = Math.max(a.x, b.x);
      const y0 = Math.min(a.y, b.y);
      const y1 = Math.max(a.y, b.y);
      for (const n of leaves) {
        if (ends.has(n.id)) continue;
        if (x1 > n.x + EPS && x0 < n.x + n.width - EPS && y1 > n.y + EPS && y0 < n.y + n.height - EPS) r.noPassThrough.push(`${e.id} through ${n.id}`);
      }
    }
  }

  const inside = (x: number, y: number) => x >= -EPS && y >= -EPS && x <= layout.width + EPS && y <= layout.height + EPS;
  r.bounds = [];
  for (const n of layout.nodes) if (!inside(n.x, n.y) || !inside(n.x + n.width, n.y + n.height)) r.bounds.push(n.id);
  for (const p of layout.ports.values()) if (!inside(p.x, p.y)) r.bounds.push(p.id);
  for (const e of layout.edges) for (const q of e.points) if (!inside(q.x, q.y)) r.bounds.push(`${e.id}@${q.x},${q.y}`);

  r.endpointsOnPorts = [];
  for (const e of layout.edges) {
    const s = layout.ports.get(e.source)!;
    const t = layout.ports.get(e.target)!;
    const f = e.points[0];
    const l = e.points[e.points.length - 1];
    if (Math.abs(f.x - s.x) > EPS || Math.abs(f.y - s.y) > EPS) r.endpointsOnPorts.push(`${e.id} start`);
    if (Math.abs(l.x - t.x) > EPS || Math.abs(l.y - t.y) > EPS) r.endpointsOnPorts.push(`${e.id} end`);
  }

  r.boxBorderCrossings = [];
  for (const b of model.boxes) {
    const n = layout.nodes.find((q) => q.id === `box:${b.id}`)!;
    const x0 = n.x;
    const x1 = n.x + n.width;
    const y0 = n.y;
    const y1 = n.y + n.height;
    const ports = [...layout.boundary.values()].filter((p) => p.node === n.id);
    const isPort = (x: number, y: number) => ports.some((p) => Math.abs(p.x - x) <= EPS && Math.abs(p.y - y) <= EPS);
    const inBox = (q: Pt) => q.x >= x0 - EPS && q.x <= x1 + EPS && q.y >= y0 - EPS && q.y <= y1 + EPS;
    for (const e of layout.edges)
      for (let i = 0; i + 1 < e.points.length; i++) {
        const a = e.points[i];
        const c = e.points[i + 1];
        const lo = { x: Math.max(Math.min(a.x, c.x), x0), y: Math.max(Math.min(a.y, c.y), y0) };
        const hi = { x: Math.min(Math.max(a.x, c.x), x1), y: Math.min(Math.max(a.y, c.y), y1) };
        if (lo.x > hi.x + EPS || lo.y > hi.y + EPS) continue;
        for (const end of [a, c]) {
          if (inBox(end)) continue;
          const nearer = Math.abs(lo.x - end.x) + Math.abs(lo.y - end.y) < Math.abs(hi.x - end.x) + Math.abs(hi.y - end.y) ? lo : hi;
          if (!isPort(nearer.x, nearer.y)) r.boxBorderCrossings.push(`${e.id} meets box ${b.id} at ${nearer.x},${nearer.y}`);
        }
      }
  }

  r.insideBoxes = [];
  for (const n of layout.nodes.filter((q) => q.parent)) {
    const b = layout.nodes.find((q) => q.id === n.parent)!;
    if (n.x < b.x - EPS || n.y < b.y - EPS || n.x + n.width > b.x + b.width + EPS || n.y + n.height > b.y + b.height + EPS) r.insideBoxes.push(n.id);
  }

  const rank = (c: string) => CONDUCTOR_ORDER.indexOf(c as (typeof CONDUCTOR_ORDER)[number]);
  r.conductorOrder = [];
  const ordered = (label: string, items: { color: string; y: number }[]) => {
    const sorted = [...items].sort((a, b) => a.y - b.y).map((i) => i.color);
    const want = [...items].map((i) => i.color).sort((a, b) => rank(a) - rank(b));
    if (sorted.join() !== want.join() || new Set(items.map((i) => i.y)).size !== items.length) r.conductorOrder.push(`${label}: ${sorted.join()}`);
  };
  for (const k of model.cables) {
    for (const end of ['a', 'b']) ordered(`cable ${k.id} end ${end}`, conductorsOf(k.type).map((color) => ({ color, y: layout.ports.get(`cab:${k.id}.${color}.${end}`)!.y })));
    for (const box of [k.from, k.to]) {
      const items = conductorsOf(k.type)
        .map((color) => ({ color, p: layout.boundary.get(`bnd:${box}.${k.id}.${color}`) }))
        .filter((i) => i.p)
        .map((i) => ({ color: i.color, y: i.p!.y }));
      if (items.length === 0) r.conductorOrder.push(`box ${box} has no border ports of cable ${k.id}`);
      ordered(`box ${box} cable ${k.id}`, items);
    }
  }

  // The top-level run of each cable end (cable port to box border port) of every conductor: same number of
  // segments, and between neighbouring conductors the perpendicular offset keeps one sign (order never flips,
  // also along a wrap-back run) and stays within MAX_RUN_GAP (they stay adjacent).
  r.cableRunsAdjacent = [];
  for (const k of model.cables)
    for (const end of ['a', 'b']) {
      const parts = orderedConductors(conductorsOf(k.type)).map((color) => {
        const id = `cab:${k.id}.${color}.${end}`;
        const e = layout.edges.find((q) => q.source === id || q.target === id)!;
        const pts = e.source === id ? e.points : [...e.points].reverse();
        const border = [...layout.boundary.values()].filter((p) => p.id.endsWith(`.${k.id}.${color}`));
        const run = [pts[0]];
        for (let i = 1; i < pts.length; i++) {
          run.push(pts[i]);
          if (border.some((p) => Math.abs(p.x - pts[i].x) <= EPS && Math.abs(p.y - pts[i].y) <= EPS)) break;
        }
        return run.filter((q, i, a) => i === 0 || Math.abs(q.x - a[i - 1].x) > EPS || Math.abs(q.y - a[i - 1].y) > EPS);
      });
      const label = `cable ${k.id} end ${end}`;
      if (new Set(parts.map((p) => p.length)).size > 1) {
        r.cableRunsAdjacent.push(`${label}: conductors have different segment counts ${parts.map((p) => p.length).join()}`);
        continue;
      }
      for (let s = 0; s + 1 < parts[0].length; s++) {
        const horizontal = Math.abs(parts[0][s].y - parts[0][s + 1].y) <= EPS;
        const offsets: number[] = [];
        for (let c = 0; c + 1 < parts.length; c++) offsets.push(horizontal ? parts[c + 1][s].y - parts[c][s].y : parts[c + 1][s].x - parts[c][s].x);
        if (new Set(offsets.map(Math.sign)).size > 1 || offsets.some((o) => Math.abs(o) <= EPS)) r.cableRunsAdjacent.push(`${label} segment ${s}: order not kept`);
        else if (offsets.some((o) => Math.abs(o) > MAX_RUN_GAP)) r.cableRunsAdjacent.push(`${label} segment ${s}: gap ${Math.max(...offsets.map(Math.abs))}`);
      }
    }

  r.noDuplicateLabels = [];
  for (const d of model.devices) {
    const texts = textBoxes(groupOf(svg, 'device', d.id)).map((t) => t.text);
    if (texts.length !== new Set(texts).size) r.noDuplicateLabels.push(d.id);
  }

  r.labelsFit = [];
  const fit = (kind: string, id: string, nodeId: string, pad: number) => {
    const n = layout.nodes.find((q) => q.id === nodeId)!;
    for (const t of textBoxes(groupOf(svg, kind, id)))
      if (t.x0 < n.x + pad - EPS || t.x1 > n.x + n.width - pad + EPS || t.y0 < n.y - EPS || t.y1 > n.y + n.height + EPS) r.labelsFit.push(`${kind} ${id}: "${t.text}"`);
  };
  for (const d of model.devices) fit('device', d.id, `dev:${d.id}`, 0);
  for (const k of model.cables) fit('cable', k.id, `cab:${k.id}`, 16);
  for (const s of model.splices) fit('splice', s.id, `spl:${s.id}`, 0);
  for (const b of model.boxes) fit('box', b.id, `box:${b.id}`, 0);

  r.noLabelOverlap = [];
  for (const d of model.devices) {
    const g = groupOf(svg, 'device', d.id);
    const texts = textBoxes(g);
    const screws = [...g.matchAll(/<circle [^>]*cx="([\d.-]+)" cy="([\d.-]+)" r="([\d.]+)"/g)].map((m) => ({
      x0: Number(m[1]) - Number(m[3]),
      x1: Number(m[1]) + Number(m[3]),
      y0: Number(m[2]) - Number(m[3]),
      y1: Number(m[2]) + Number(m[3]),
    }));
    texts.forEach((t, i) => {
      texts.slice(i + 1).forEach((u) => hit(t, u) && r.noLabelOverlap.push(`${d.id}: "${t.text}" x "${u.text}"`));
      screws.forEach((c) => hit(t, c) && r.noLabelOverlap.push(`${d.id}: "${t.text}" x screw`));
    });
  }
  return r;
}

export interface Measurement {
  layout: Layout;
  svg: string;
  width: number;
  height: number;
  crossings: number;
  length: number;
  bends: number;
  /** Median of `runs` full layoutCircuit calls, ms. */
  ms: number;
  invariants: Record<InvariantName, string[]>;
}

export async function measure(model: CircuitModel, options?: LayoutOptions, runs = 5): Promise<Measurement> {
  const times: number[] = [];
  let layout!: Layout;
  for (let i = 0; i < runs; i++) {
    const t0 = Date.now();
    layout = await layoutCircuit(model, options);
    times.push(Date.now() - t0);
  }
  times.sort((a, b) => a - b);
  const m = layoutMetrics(layout);
  return {
    layout,
    svg: renderSvg(layout, model),
    width: Math.round(layout.width),
    height: Math.round(layout.height),
    crossings: countCrossings(layout),
    length: m.length,
    bends: m.bends,
    ms: Math.round(times[Math.floor(runs / 2)]),
    invariants: checkInvariants(layout, model),
  };
}
