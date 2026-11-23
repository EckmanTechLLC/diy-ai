import { beforeAll, describe, expect, it } from 'vitest';
import { conductorsOf, type CircuitModel } from '@diy-ai/core';
import { FIXTURES } from '@diy-ai/core/fixtures';
import { CONDUCTOR_ORDER } from '../src/geometry';
import { countCrossings, InvalidCircuitError, layoutCircuit, layoutMetrics, type Layout, type Pt } from '../src/layout';
import { CABLE_LABEL_FONT, DEVICE_FONT, renderSvg, textWidth } from '../src/render';

const EPS = 0.01;

interface TextBox {
  text: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Visible <text> elements of an SVG fragment as estimated boxes (width from textWidth, height = font size). */
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

const hit = (a: { x0: number; x1: number; y0: number; y1: number }, b: { x0: number; x1: number; y0: number; y1: number }) =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** The SVG text of the <g data-KIND="id"> group, up to the next top-level group (cable groups nest conductor groups). */
function groupOf(svg: string, kind: string, id: string): string {
  const start = svg.indexOf(`<g data-${kind}="${id}"`);
  const ends = ['\n<g data-', '\n<g class="wire" data-connection', '\n</svg>'].map((m) => svg.indexOf(m, start + 1)).filter((i) => i > 0);
  return svg.slice(start, Math.min(...ends));
}
const expectedEdges = [13, 22, 13, 22];
// Crossings between wires of different nets, with the same conductor order (black, red, white, bare) at every
// cable end: what the two-level path achieves on the four fixtures.
const maxCrossings = [1, 2, 0, 6];

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

describe.each(FIXTURES.map((m, i) => [m, i] as const))('two-level layout, circuit fixture %#', (model, idx) => {
  let layout: Layout;
  beforeAll(async () => {
    layout = await layoutCircuit(model);
  });

  it(`fixture has ${expectedEdges[idx]} wire segments`, () => {
    expect(model.connections.length).toBe(expectedEdges[idx]);
  });

  it('every connection has exactly one routed edge', () => {
    for (const c of model.connections) expect(layout.edges.filter((e) => e.id === c.id)).toHaveLength(1);
    expect(layout.edges).toHaveLength(model.connections.length);
  });

  it('every edge segment is horizontal or vertical', () => {
    const bad = segments(layout).filter((s) => Math.abs(s.a.x - s.b.x) > EPS && Math.abs(s.a.y - s.b.y) > EPS);
    expect(bad.map((s) => s.edge)).toEqual([]);
  });

  it('no two segments of different nets are collinear and overlapping', () => {
    const segs = segments(layout);
    const bad: string[] = [];
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
        if (sh && th && Math.abs(s.a.y - t.a.y) <= EPS) {
          overlap = Math.min(Math.max(s.a.x, s.b.x), Math.max(t.a.x, t.b.x)) - Math.max(Math.min(s.a.x, s.b.x), Math.min(t.a.x, t.b.x));
        } else if (sv && tv && Math.abs(s.a.x - t.a.x) <= EPS) {
          overlap = Math.min(Math.max(s.a.y, s.b.y), Math.max(t.a.y, t.b.y)) - Math.max(Math.min(s.a.y, s.b.y), Math.min(t.a.y, t.b.y));
        }
        if (overlap > EPS) bad.push(`${s.edge} x ${t.edge}`);
      }
    expect(bad).toEqual([]);
  });

  it('no edge passes through a device, splice or cable that is not one of its endpoints', () => {
    const bad: string[] = [];
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
          if (x1 > n.x + EPS && x0 < n.x + n.width - EPS && y1 > n.y + EPS && y0 < n.y + n.height - EPS) bad.push(`${e.id} through ${n.id}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('every node, port and bend point lies inside the diagram bounds', () => {
    const inside = (x: number, y: number) => x >= -EPS && y >= -EPS && x <= layout.width + EPS && y <= layout.height + EPS;
    const bad: string[] = [];
    for (const n of layout.nodes)
      if (!inside(n.x, n.y) || !inside(n.x + n.width, n.y + n.height)) bad.push(n.id);
    for (const p of layout.ports.values()) if (!inside(p.x, p.y)) bad.push(p.id);
    for (const e of layout.edges) for (const q of e.points) if (!inside(q.x, q.y)) bad.push(`${e.id}@${q.x},${q.y}`);
    expect(bad).toEqual([]);
  });

  it("each edge's first and last point coincide with its source and target port", () => {
    const bad: string[] = [];
    for (const e of layout.edges) {
      const s = layout.ports.get(e.source)!;
      const t = layout.ports.get(e.target)!;
      const f = e.points[0];
      const l = e.points[e.points.length - 1];
      if (Math.abs(f.x - s.x) > EPS || Math.abs(f.y - s.y) > EPS) bad.push(`${e.id} start`);
      if (Math.abs(l.x - t.x) > EPS || Math.abs(l.y - t.y) > EPS) bad.push(`${e.id} end`);
    }
    expect(bad).toEqual([]);
  });

  it('crossings between different nets stay within the per-circuit maximum', () => {
    const n = countCrossings(layout);
    expect(n).toBeLessThanOrEqual(maxCrossings[idx]);
    expect(layoutMetrics(layout).crossings).toBe(n);
  });

  it('no label text is repeated within one device', () => {
    const svg = renderSvg(layout, model);
    for (const d of model.devices) {
      const texts = textBoxes(groupOf(svg, 'device', d.id)).map((t) => t.text);
      expect(texts, `device ${d.id}`).toEqual([...new Set(texts)]);
    }
  });

  it('device, cable, splice and box labels fit inside their shape (width estimate: chars x font size x 0.6, bold x 0.66)', () => {
    const svg = renderSvg(layout, model);
    const bad: string[] = [];
    const check = (kind: string, id: string, nodeId: string, pad: number) => {
      const n = layout.nodes.find((q) => q.id === nodeId)!;
      for (const t of textBoxes(groupOf(svg, kind, id)))
        if (t.x0 < n.x + pad - EPS || t.x1 > n.x + n.width - pad + EPS || t.y0 < n.y - EPS || t.y1 > n.y + n.height + EPS)
          bad.push(`${kind} ${id}: "${t.text}"`);
    };
    for (const d of model.devices) check('device', d.id, `dev:${d.id}`, 0);
    for (const k of model.cables) check('cable', k.id, `cab:${k.id}`, 16); // text must sit inside the jacket
    for (const s of model.splices) check('splice', s.id, `spl:${s.id}`, 0);
    for (const b of model.boxes) check('box', b.id, `box:${b.id}`, 0);
    expect(bad).toEqual([]);
    expect(DEVICE_FONT).toBeGreaterThan(0);
    expect(CABLE_LABEL_FONT).toBeGreaterThan(0);
  });

  it('no label overlaps another label or a terminal screw in the same device', () => {
    const svg = renderSvg(layout, model);
    const bad: string[] = [];
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
        texts.slice(i + 1).forEach((u) => hit(t, u) && bad.push(`${d.id}: "${t.text}" x "${u.text}"`));
        screws.forEach((c) => hit(t, c) && bad.push(`${d.id}: "${t.text}" x screw`));
      });
    }
    expect(bad).toEqual([]);
  });

  it('conductors appear black, red, white, bare (top to bottom) at every cable end, on the cable and on the box border', () => {
    const rank = (c: string) => CONDUCTOR_ORDER.indexOf(c as (typeof CONDUCTOR_ORDER)[number]);
    const bad: string[] = [];
    const ordered = (label: string, items: { color: string; y: number }[]) => {
      const sorted = [...items].sort((a, b) => a.y - b.y).map((i) => i.color);
      const want = [...items].map((i) => i.color).sort((a, b) => rank(a) - rank(b));
      if (sorted.join() !== want.join() || new Set(items.map((i) => i.y)).size !== items.length) bad.push(`${label}: ${sorted.join()}`);
    };
    for (const k of model.cables) {
      for (const end of ['a', 'b']) {
        const items = conductorsOf(k.type).map((color) => ({ color, y: layout.ports.get(`cab:${k.id}.${color}.${end}`)!.y }));
        ordered(`cable ${k.id} end ${end}`, items);
      }
      for (const box of [k.from, k.to]) {
        const items = conductorsOf(k.type)
          .map((color) => ({ color, p: layout.boundary.get(`bnd:${box}.${k.id}.${color}`) }))
          .filter((i) => i.p)
          .map((i) => ({ color: i.color, y: i.p!.y }));
        expect(items.length, `box ${box} border ports of cable ${k.id}`).toBeGreaterThan(0);
        ordered(`box ${box} cable ${k.id}`, items);
      }
    }
    expect(bad).toEqual([]);
  });

  it('no wire crosses a box border except at a boundary port, and none runs through a box it does not belong to', () => {
    const bad: string[] = [];
    for (const b of model.boxes) {
      const n = layout.nodes.find((q) => q.id === `box:${b.id}`)!;
      const x0 = n.x;
      const x1 = n.x + n.width;
      const y0 = n.y;
      const y1 = n.y + n.height;
      const ports = [...layout.boundary.values()].filter((p) => p.node === n.id);
      const isPort = (x: number, y: number) => ports.some((p) => Math.abs(p.x - x) <= EPS && Math.abs(p.y - y) <= EPS);
      const inside = (q: Pt) => q.x >= x0 - EPS && q.x <= x1 + EPS && q.y >= y0 - EPS && q.y <= y1 + EPS;
      for (const e of layout.edges)
        for (let i = 0; i + 1 < e.points.length; i++) {
          const a = e.points[i];
          const c = e.points[i + 1];
          // orthogonal segment clipped to the box rectangle
          const lo = { x: Math.max(Math.min(a.x, c.x), x0), y: Math.max(Math.min(a.y, c.y), y0) };
          const hi = { x: Math.min(Math.max(a.x, c.x), x1), y: Math.min(Math.max(a.y, c.y), y1) };
          if (lo.x > hi.x + EPS || lo.y > hi.y + EPS) continue;
          for (const end of [a, c]) {
            if (inside(end)) continue;
            // this end is outside; the clipped segment's nearer end lies on the border
            const nearer = Math.abs(lo.x - end.x) + Math.abs(lo.y - end.y) < Math.abs(hi.x - end.x) + Math.abs(hi.y - end.y) ? lo : hi;
            if (!isPort(nearer.x, nearer.y)) bad.push(`${e.id} meets box ${b.id} at ${nearer.x},${nearer.y}`);
          }
        }
    }
    expect(bad).toEqual([]);
  });

  it('every device and splice lies inside the box it belongs to', () => {
    const bad: string[] = [];
    for (const n of layout.nodes.filter((q) => q.parent)) {
      const b = layout.nodes.find((q) => q.id === n.parent)!;
      if (n.x < b.x - EPS || n.y < b.y - EPS || n.x + n.width > b.x + b.width + EPS || n.y + n.height > b.y + b.height + EPS) bad.push(n.id);
    }
    expect(bad).toEqual([]);
  });

  it('SVG contains every device, cable, splice and connection by model id', () => {
    const svg = renderSvg(layout, model);
    for (const d of model.devices) expect(svg).toContain(`data-device="${d.id}"`);
    for (const k of model.cables) expect(svg).toContain(`data-cable="${k.id}"`);
    for (const s of model.splices) expect(svg).toContain(`data-splice="${s.id}"`);
    for (const c of model.connections) expect(svg).toContain(`data-connection="${c.id}"`);
  });
});
