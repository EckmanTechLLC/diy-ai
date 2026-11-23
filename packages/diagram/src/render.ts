import { cableLabel, conductorsOf, type CircuitModel, type ScrewColor, type WireColor } from '@diy-ai/core';
import { CABLE_JACKET_INSET, mirroredDevices, terminalsOf } from './geometry';
import type { Layout, LNode } from './layout';
import { themed } from './theme';

const WIRE: Record<WireColor, { fill: string; outline: string }> = {
  black: { fill: themed('wire-black'), outline: themed('wire-black-edge') },
  white: { fill: themed('wire-white'), outline: themed('wire-white-edge') },
  red: { fill: themed('wire-red'), outline: themed('wire-red-edge') },
  bare: { fill: themed('wire-bare'), outline: themed('wire-bare-edge') },
  green: { fill: themed('wire-green'), outline: themed('wire-green-edge') },
};
const SCREW: Record<ScrewColor, string> = {
  brass: themed('screw-brass'),
  silver: themed('screw-silver'),
  green: themed('screw-green'),
  black: themed('screw-black'),
};

/** Conductor stroke widths: the casing (edge colour) under the core (fill colour). The dark palette draws both wider. */
const EDGE_W = themed('wire-edge-width');
const CORE_W = themed('wire-core-width');

/** Text width estimate used for layout checks and tests: characters x font size x 0.6 (0.66 when bold). */
export const textWidth = (text: string, fontSize: number, bold = false): number =>
  text.length * fontSize * (bold ? 0.66 : 0.6);

/** Greedy word wrap on spaces so each line is at most `maxChars` characters. */
export function wrapLabel(label: string, maxChars: number): string[] {
  const lines: string[] = [];
  for (const word of label.split(' ')) {
    const last = lines[lines.length - 1];
    if (last !== undefined && last.length + 1 + word.length <= maxChars) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

/** A label fitted to a width: one or two lines at a font size, truncated (with the full text kept) when even two lines are too long. */
export interface FittedLabel {
  lines: string[];
  fontSize: number;
  /** The original text when it was cut short, for a <title>. */
  full?: string;
}

/**
 * Fit a label to `maxWidth` using the textWidth estimate. A label that fits is returned untouched. Otherwise
 * (when `maxLines` is 2) it wraps onto two lines at the same size; a label that does not fit in two lines is cut
 * with an ellipsis at the last character that fits, and `full` carries the original text.
 */
export function fitLabel(label: string, maxWidth: number, fontSize: number, bold: boolean, maxLines: 1 | 2): FittedLabel {
  if (textWidth(label, fontSize, bold) <= maxWidth) return { lines: [label], fontSize };
  const perChar = fontSize * (bold ? 0.66 : 0.6);
  const chars = Math.max(1, Math.floor(maxWidth / perChar));
  if (maxLines === 2) {
    // the most even split at a space
    const words = label.split(' ');
    let best: string[] | undefined;
    for (let k = 1; k < words.length; k++) {
      const lines = [words.slice(0, k).join(' '), words.slice(k).join(' ')];
      if (Math.max(...lines.map((l) => l.length)) <= chars && (!best || Math.max(...lines.map((l) => l.length)) < Math.max(...best.map((l) => l.length)))) best = lines;
    }
    if (best) return { lines: best, fontSize };
  }
  const cut = (t: string) => (t.length <= chars ? t : `${t.slice(0, Math.max(0, chars - 1)).trimEnd()}\u2026`);
  if (maxLines === 2) {
    const [first, ...rest] = wrapLabel(label, chars);
    // everything after the first line goes into the (cut) second line
    return { lines: rest.length > 0 ? [cut(first), cut(rest.join(' '))] : [cut(first)], fontSize, full: label };
  }
  return { lines: [cut(label)], fontSize, full: label };
}

/** Height of the title strip above the circuit. */
export const TITLE_STRIP = 26;

export const DEVICE_FONT = 12;
/** Baseline distance of a two-line device title. */
export const DEVICE_LINE = 12;
export const TERMINAL_FONT = 8;
export const CABLE_LABEL_FONT = 10;
export const CABLE_LABEL_CHARS = 12;

/** Escape a value for a double-quoted CSS string inside <style> (no raw <, &, " or backslash). */
const cssStr = (s: string) => s.replace(/[\\"<&>]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Invisible, wider copy of a wire so thin wires are easy to hover and click. Does not change how wires look. */
const HIT_WIDTH = 10;
const hitPath = (net: string, d: string, tail = ''): string =>
  `<path class="hit" data-net="${esc(net)}" d="${d}" stroke="transparent" stroke-width="${HIT_WIDTH}" stroke-linejoin="round" fill="none"/>${tail}`;

/** SVG for a fitted label: one <text> per line; a cut label also gets a <title> with the full text (inside a group). */
function labelSvg(l: FittedLabel, x: number, y: number, lineHeight: number, attrs: string): string[] {
  const texts = l.lines.map((t, i) => `<text x="${x}" y="${y + i * lineHeight}" font-size="${l.fontSize}" ${attrs}>${esc(t)}</text>`);
  return l.full === undefined ? texts : [`<g><title>${esc(l.full)}</title>`, ...texts, '</g>'];
}

/** Draws ELK's node positions and edge points verbatim. */
export function renderSvg(layout: Layout, model: CircuitModel): string {
  const W = layout.width;
  const H = layout.height + TITLE_STRIP;
  const node = (id: string): LNode => layout.nodes.find((n) => n.id === id)!;
  const nets = [...new Set(layout.edges.map((e) => e.net))];
  const css =
    `text{font-family:sans-serif}` +
    `.wire path{pointer-events:stroke}` +
    nets
      .map((n) => `svg:has([data-net="${cssStr(n)}"]:hover) [data-net="${cssStr(n)}"]{filter:drop-shadow(0 0 3px ${themed('highlight')}) drop-shadow(0 0 3px ${themed('highlight')})}`)
      .join('');

  const p: string[] = [];
  p.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 -${TITLE_STRIP} ${W} ${H}" data-circuit="${esc(model.id)}">`,
    `<style>${css}</style>`,
    `<rect x="0" y="-${TITLE_STRIP}" width="${W}" height="${H}" fill="${themed('bg')}"/>`,
    `<text x="8" y="-8" font-size="14" font-weight="bold" fill="${themed('title')}">${esc(model.title)}</text>`,
  );

  // boxes
  for (const b of model.boxes) {
    const n = node(`box:${b.id}`);
    p.push(
      `<g data-box="${esc(b.id)}"><rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="8" fill="${b.kind === 'panel' ? themed('box-panel') : themed('box')}" stroke="${themed('box-stroke')}" stroke-width="2"/>`,
      ...labelSvg(fitLabel(b.label, n.width - 20, 13, true, 1), n.x + 10, n.y + 20, 0, `font-weight="bold" fill="${themed('box-label')}"`),
      '</g>',
    );
  }

  // cables: conductors run into a jacket that is drawn over their inner ends, so they emerge from it at both ends
  for (const k of model.cables) {
    const n = node(`cab:${k.id}`);
    const jx = n.x + CABLE_JACKET_INSET;
    const jw = n.width - 2 * CABLE_JACKET_INSET;
    const stubs: string[] = [];
    for (const col of conductorsOf(k.type)) {
      const a = layout.ports.get(`cab:${k.id}.${col}.a`)!;
      const b = layout.ports.get(`cab:${k.id}.${col}.b`)!;
      const net = layout.edges.find((e) => e.source === a.id || e.target === a.id)?.net;
      const w = WIRE[col];
      for (const [from, to] of [
        [a.x, jx + 6],
        [b.x, jx + jw - 6],
      ]) {
        const d = `M${from} ${a.y}L${to} ${a.y}`;
        stubs.push(
          `<g class="wire" data-cable-conductor="${esc(k.id)}.${col}"><path data-net="${esc(net ?? '')}" d="${d}" stroke="${w.outline}" stroke-width="${EDGE_W}" fill="none"/>`,
          `<path data-net="${esc(net ?? '')}" d="${d}" stroke="${w.fill}" stroke-width="${CORE_W}" fill="none"/>`,
          hitPath(net ?? '', d, '</g>'),
        );
      }
    }
    const fitted = wrapLabel(cableLabel(k), CABLE_LABEL_CHARS).map((l) => fitLabel(l, jw, CABLE_LABEL_FONT, false, 1));
    const lines = fitted.map((f) => f.lines[0]);
    const lh = CABLE_LABEL_FONT + 2;
    const y0 = n.y + n.height / 2 - ((lines.length - 1) * lh) / 2 + CABLE_LABEL_FONT * 0.35;
    p.push(
      `<g data-cable="${esc(k.id)}">`,
      ...stubs,
      `<rect x="${jx}" y="${n.y}" width="${jw}" height="${n.height}" rx="6" fill="${themed('sheath')}" stroke="${themed('sheath-stroke')}" stroke-width="2"/>`,
      ...fitted.flatMap((f, i) => labelSvg(f, jx + jw / 2, y0 + i * lh, 0, `text-anchor="middle" fill="${themed('sheath-text')}"`)),
      '</g>',
    );
  }

  // devices
  const mirrored = mirroredDevices(model);
  for (const d of model.devices) {
    const n = node(`dev:${d.id}`);
    const terms = terminalsOf(d.type, mirrored.has(d.id));
    // a lone terminal needs no name, and then the title can sit mid-height
    // a second title line is only allowed above the first terminal name (its text starts about 3.4 below the screw's y)
    const twoLines = terms.length > 1 && Math.min(...terms.map((t) => t.y)) - 3.4 >= 2 * DEVICE_LINE + 2.4;
    const title = fitLabel(d.label, n.width, DEVICE_FONT, true, twoLines ? 2 : 1);
    const titleY = terms.length > 1 ? (title.lines.length > 1 ? n.y + DEVICE_LINE : n.y + 16) : n.y + n.height / 2 + 4;
    p.push(
      `<g data-device="${esc(d.id)}"><rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="6" fill="${themed('device')}" stroke="${themed('device-stroke')}" stroke-width="2"/>`,
      ...labelSvg(title, n.x + n.width / 2, titleY, DEVICE_LINE, `text-anchor="middle" font-weight="bold" fill="${themed('device-text')}"`),
    );
    for (const t of terms) {
      const port = layout.ports.get(`dev:${d.id}.${t.name}`)!;
      p.push(`<circle data-terminal="${esc(d.id)}.${t.name}" cx="${port.x}" cy="${port.y}" r="5" fill="${SCREW[t.screw]}" stroke="${themed('screw-stroke')}" stroke-width="1"/>`);
      // the name sits inside the device, level with its screw
      if (terms.length > 1)
        p.push(
          `<text x="${port.x + (t.side === 'WEST' ? 10 : -10)}" y="${port.y + 3}" font-size="${TERMINAL_FONT}" fill="${themed('terminal-text')}" text-anchor="${t.side === 'WEST' ? 'start' : 'end'}">${esc(t.name)}</text>`,
        );
    }
    p.push('</g>');
  }

  // splices (wire connectors)
  for (const s of model.splices) {
    const n = node(`spl:${s.id}`);
    p.push(
      `<g data-splice="${esc(s.id)}"><rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="9" fill="${themed('splice')}" stroke="${themed('splice-stroke')}" stroke-width="2"/>`,
      `<text x="${n.x + n.width / 2}" y="${n.y + n.height / 2 + 3}" font-size="8" text-anchor="middle" fill="${themed('splice-text')}">nut</text></g>`,
    );
  }

  // wires: ELK edge points verbatim
  for (const e of layout.edges) {
    const d = 'M' + e.points.map((q) => `${q.x} ${q.y}`).join('L');
    const w = WIRE[e.color];
    p.push(
      `<g class="wire" data-connection="${esc(e.id)}" data-color="${e.color}"><path data-net="${esc(e.net)}" d="${d}" stroke="${w.outline}" stroke-width="${EDGE_W}" stroke-linejoin="round" fill="none"/>`,
      `<path data-net="${esc(e.net)}" d="${d}" stroke="${w.fill}" stroke-width="${CORE_W}" stroke-linejoin="round" fill="none"/>`,
      hitPath(e.net, d, '</g>'),
    );
  }

  p.push('</svg>');
  return p.join('\n');
}
