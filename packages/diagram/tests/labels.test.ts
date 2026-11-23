import { describe, expect, it } from 'vitest';
import { BLOCK_FIXTURES, type CircuitModel } from '@diy-ai/core';
import { FIXTURES } from '@diy-ai/core/fixtures';
import { GEOMETRY } from '../src/geometry';
import { layoutCircuit } from '../src/layout';
import { DEVICE_FONT, fitLabel, renderSvg, textWidth } from '../src/render';

const clone = (m: CircuitModel): CircuitModel => JSON.parse(JSON.stringify(m));
const group = (svg: string, id: string) => {
  const start = svg.indexOf(`<g data-device="${id}"`);
  return svg.slice(start, svg.indexOf('\n<g data-', start + 1));
};

describe('fitLabel', () => {
  it('returns a label that fits untouched', () => {
    expect(fitLabel('Light 1', 110, 12, true, 2)).toEqual({ lines: ['Light 1'], fontSize: 12 });
  });
  it('wraps a label that is too wide onto two lines at the same size', () => {
    const f = fitLabel('3-way switch 1', 96, 12, true, 2);
    expect(f.lines).toEqual(['3-way', 'switch 1']);
    expect(f.full).toBeUndefined();
    for (const l of f.lines) expect(textWidth(l, 12, true)).toBeLessThanOrEqual(96);
  });
  it('cuts a label too long for two lines with an ellipsis and keeps the full text', () => {
    const f = fitLabel('Upstairs hallway three-way switch number 1', 96, 12, true, 2);
    expect(f.lines).toHaveLength(2);
    expect(f.lines[1].endsWith('…')).toBe(true);
    expect(f.full).toBe('Upstairs hallway three-way switch number 1');
    for (const l of f.lines) expect(textWidth(l, 12, true)).toBeLessThanOrEqual(96);
  });
  it('cuts to a single line when only one is allowed', () => {
    const f = fitLabel('3-way switch 1', 96, 12, true, 1);
    expect(f.lines).toHaveLength(1);
    expect(f.lines[0].endsWith('…')).toBe(true);
    expect(f.full).toBe('3-way switch 1');
  });
});

describe('long labels in the diagram', () => {
  it('3-way switch 1 and 2 are drawn on two lines inside the device, above the terminal names', async () => {
    const f = BLOCK_FIXTURES.find((b) => b.name === 'three-way-8-lights')!;
    const svg = renderSvg(await layoutCircuit(f.circuit), f.circuit);
    for (const d of f.circuit.devices.filter((q) => q.type === 'switch_3way').slice(0, 2)) {
      expect(textWidth(d.label, DEVICE_FONT, true)).toBeGreaterThan(GEOMETRY.switch_3way.width);
      const g = group(svg, d.id);
      const titles = [...g.matchAll(/<text [^>]*font-weight="bold"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
      expect(titles.join(' ')).toBe(d.label);
      expect(titles).toHaveLength(2);
      expect(g).not.toContain('<title>');
    }
  });

  it('a label too long even for two lines is cut with an ellipsis and carries its full text in a <title>', async () => {
    const m = clone(FIXTURES[0]);
    const long = 'Master bedroom ceiling light with dimmer and remote';
    m.devices.find((d) => d.type === 'light')!.label = long;
    const svg = renderSvg(await layoutCircuit(m), m);
    const d = m.devices.find((q) => q.type === 'light')!;
    const g = group(svg, d.id);
    expect(g).toContain(`<title>${long}</title>`);
    expect(g).toContain('…</text>');
  });

  it('labels that fit are drawn as a single plain text element, as before', async () => {
    for (const m of FIXTURES) {
      const svg = renderSvg(await layoutCircuit(m), m);
      expect(svg).not.toContain('<title>');
      for (const d of m.devices) expect(group(svg, d.id)).toContain(`>${d.label.replace(/&/g, '&amp;')}</text>`);
    }
  });
});
