import { mirroredDevices, terminalsOf } from './catalogue';
import { CABLE_JACKET_INSET } from './toElk';
import type { Layout, LNode } from './layout';
import type { CircuitModel, WireColor } from './model';

const WIRE: Record<WireColor, { fill: string; outline: string }> = {
  black: { fill: '#1b1b1b', outline: '#000' },
  white: { fill: '#ffffff', outline: '#4a4a4a' },
  red: { fill: '#d62828', outline: '#7a1010' },
  bare: { fill: '#c77d3a', outline: '#7a4a1c' },
  green: { fill: '#2e9e44', outline: '#17602a' },
};
const SCREW = { brass: '#d4a72c', silver: '#c9ced3', green: '#2e9e44', black: '#2b2b2b' };

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

export const DEVICE_FONT = 12;
export const TERMINAL_FONT = 8;
export const CABLE_LABEL_FONT = 10;
export const CABLE_LABEL_CHARS = 12;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** Draws ELK's node positions and edge points verbatim. */
export function renderSvg(model: CircuitModel, layout: Layout): string {
  const W = layout.width;
  const H = layout.height + 26; // title strip above
  const node = (id: string): LNode => layout.nodes.find((n) => n.id === id)!;
  const nets = [...new Set(layout.edges.map((e) => e.net))];
  const css =
    `text{font-family:sans-serif}` +
    `.wire path{pointer-events:stroke}` +
    nets
      .map((n) => `svg:has([data-net="${n}"]:hover) [data-net="${n}"]{filter:drop-shadow(0 0 3px #ff9d00) drop-shadow(0 0 3px #ff9d00)}`)
      .join('');

  const p: string[] = [];
  p.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 -26 ${W} ${H}" data-circuit="${model.id}">`,
    `<style>${css}</style>`,
    `<rect x="0" y="-26" width="${W}" height="${H}" fill="#fafafa"/>`,
    `<text x="8" y="-8" font-size="14" font-weight="bold" fill="#222">${esc(model.title)}</text>`,
  );

  // boxes
  for (const b of model.boxes) {
    const n = node(`box:${b.id}`);
    p.push(
      `<g data-box="${b.id}"><rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="8" fill="${b.kind === 'panel' ? '#e6e9ee' : '#eef3e6'}" stroke="#6b7480" stroke-width="2"/>`,
      `<text x="${n.x + 10}" y="${n.y + 20}" font-size="13" font-weight="bold" fill="#333">${esc(b.label)}</text></g>`,
    );
  }

  // cables: conductors run into a jacket that is drawn over their inner ends, so they emerge from it at both ends
  for (const k of model.cables) {
    const n = node(`cab:${k.id}`);
    const jx = n.x + CABLE_JACKET_INSET;
    const jw = n.width - 2 * CABLE_JACKET_INSET;
    const stubs: string[] = [];
    for (const col of k.conductors) {
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
          `<g class="wire" data-cable-conductor="${k.id}.${col}"><path data-net="${net}" d="${d}" stroke="${w.outline}" stroke-width="5" fill="none"/>`,
          `<path data-net="${net}" d="${d}" stroke="${w.fill}" stroke-width="3" fill="none"/></g>`,
        );
      }
    }
    const lines = wrapLabel(k.label, CABLE_LABEL_CHARS);
    const lh = CABLE_LABEL_FONT + 2;
    const y0 = n.y + n.height / 2 - ((lines.length - 1) * lh) / 2 + CABLE_LABEL_FONT * 0.35;
    p.push(
      `<g data-cable="${k.id}">`,
      ...stubs,
      `<rect x="${jx}" y="${n.y}" width="${jw}" height="${n.height}" rx="6" fill="#d9d4c3" stroke="#8a8368" stroke-width="2"/>`,
      ...lines.map(
        (l, i) =>
          `<text x="${jx + jw / 2}" y="${y0 + i * lh}" font-size="${CABLE_LABEL_FONT}" text-anchor="middle" fill="#3a3626">${esc(l)}</text>`,
      ),
      '</g>',
    );
  }

  // devices
  const mirrored = mirroredDevices(model);
  for (const d of model.devices) {
    const n = node(`dev:${d.id}`);
    const terms = terminalsOf(d.type, mirrored.has(d.id));
    // a lone terminal needs no name, and then the title can sit mid-height
    const titleY = terms.length > 1 ? n.y + 16 : n.y + n.height / 2 + 4;
    p.push(
      `<g data-device="${d.id}"><rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="6" fill="#f4f1ea" stroke="#444" stroke-width="2"/>`,
      `<text x="${n.x + n.width / 2}" y="${titleY}" font-size="${DEVICE_FONT}" text-anchor="middle" font-weight="bold" fill="#222">${esc(d.label)}</text>`,
    );
    for (const t of terms) {
      const port = layout.ports.get(`dev:${d.id}.${t.name}`)!;
      p.push(`<circle data-terminal="${d.id}.${t.name}" cx="${port.x}" cy="${port.y}" r="5" fill="${SCREW[t.screw]}" stroke="#333" stroke-width="1"/>`);
      // the name sits inside the device, level with its screw
      if (terms.length > 1)
        p.push(
          `<text x="${port.x + (t.side === 'WEST' ? 10 : -10)}" y="${port.y + 3}" font-size="${TERMINAL_FONT}" fill="#444" text-anchor="${t.side === 'WEST' ? 'start' : 'end'}">${esc(t.name)}</text>`,
        );
    }
    p.push('</g>');
  }

  // splices (wire connectors)
  for (const s of model.splices) {
    const n = node(`spl:${s.id}`);
    p.push(
      `<g data-splice="${s.id}"><rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="9" fill="#f08a24" stroke="#8a4a00" stroke-width="2"/>`,
      `<text x="${n.x + n.width / 2}" y="${n.y + n.height / 2 + 3}" font-size="8" text-anchor="middle" fill="#3a1f00">nut</text></g>`,
    );
  }

  // wires: ELK edge points verbatim
  for (const e of layout.edges) {
    const d = 'M' + e.points.map((q) => `${q.x} ${q.y}`).join('L');
    const w = WIRE[e.color];
    p.push(
      `<g class="wire" data-conn="${e.id}" data-color="${e.color}"><path data-net="${e.net}" d="${d}" stroke="${w.outline}" stroke-width="5" stroke-linejoin="round" fill="none"/>`,
      `<path data-net="${e.net}" d="${d}" stroke="${w.fill}" stroke-width="3" stroke-linejoin="round" fill="none"/></g>`,
    );
  }

  p.push('</svg>');
  return p.join('\n');
}
