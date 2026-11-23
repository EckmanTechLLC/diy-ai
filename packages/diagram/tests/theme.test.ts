import { describe, expect, it } from 'vitest';
import { FIXTURES } from '@diy-ai/core/fixtures';
import { layoutCircuit } from '../src/layout';
import { renderSvg } from '../src/render';
import {
  DARK_PALETTE,
  LEGEND,
  LIGHT_PALETTE,
  PALETTE_NAMES,
  paletteCss,
  resolvePalette,
  type PaletteName,
} from '../src/theme';

// Every colour the renderer drew before it became themeable.
const OLD_COLOURS = new Set(
  [
    '#fafafa', '#222', '#e6e9ee', '#eef3e6', '#6b7480', '#333', '#d9d4c3', '#8a8368', '#3a3626', '#f4f1ea', '#444',
    '#d4a72c', '#c9ced3', '#2e9e44', '#2b2b2b', '#f08a24', '#8a4a00', '#3a1f00', '#ff9d00', '#1b1b1b', '#000',
    '#ffffff', '#4a4a4a', '#d62828', '#7a1010', '#c77d3a', '#7a4a1c', '#17602a',
  ].map((c) => c.toLowerCase()),
);
const WIDTH_NAMES = new Set<string>(['wire-edge-width', 'wire-core-width']);
const COLOUR_ATTR = /(?:fill|stroke)="([^"]*)"/g;
const HEX = /#[0-9a-fA-F]{3,8}\b/g;

describe('themeable diagram colours', () => {
  it('light and dark palettes define the same names, all as hex', () => {
    expect(Object.keys(LIGHT_PALETTE).sort()).toEqual([...PALETTE_NAMES].sort());
    expect(Object.keys(DARK_PALETTE).sort()).toEqual([...PALETTE_NAMES].sort());
    for (const [n, v] of [...Object.entries(LIGHT_PALETTE), ...Object.entries(DARK_PALETTE)])
      expect(v).toMatch(WIDTH_NAMES.has(n) ? /^\d+$/ : /^#[0-9a-f]{3,6}$/i);
  });

  it('default output uses only the previous colours, each as a variable with its light fallback', async () => {
    const all = new Set<string>();
    for (const m of FIXTURES) {
      const svg = renderSvg(await layoutCircuit(m), m);
      const used = new Set<string>();
      for (const [, name, fb] of svg.matchAll(/var\(--dg-([a-z-]+), *([^)]*)\)/g)) {
        expect(fb).toBe(LIGHT_PALETTE[name as PaletteName]);
        if (!WIDTH_NAMES.has(name)) used.add(fb.toLowerCase());
      }
      for (const c of used) {
        expect(OLD_COLOURS.has(c), c).toBe(true);
        all.add(c);
      }
    }
    // the renderer used to draw all of these somewhere in the four fixtures
    for (const c of ['#fafafa', '#1b1b1b', '#ffffff', '#d62828', '#c77d3a', '#2e9e44', '#d9d4c3', '#f4f1ea', '#f08a24', '#ff9d00']) expect(all.has(c), c).toBe(true);
  });

  it('resolving with the light palette leaves no variables and no colour outside the old set', async () => {
    for (const m of FIXTURES) {
      const svg = resolvePalette(renderSvg(await layoutCircuit(m), m), LIGHT_PALETTE);
      expect(svg).not.toContain('var(');
      for (const c of svg.match(HEX) ?? []) expect(OLD_COLOURS.has(c.toLowerCase()), c).toBe(true);
    }
  });

  it('has no hard-coded colour outside the variable fallbacks', async () => {
    for (const m of FIXTURES) {
      const svg = renderSvg(await layoutCircuit(m), m);
      const stripped = svg.replace(/var\(--dg-[a-z-]+, *[^)]*\)/g, 'VAR');
      expect(stripped.match(HEX) ?? []).toEqual([]);
      for (const [, v] of stripped.matchAll(COLOUR_ATTR)) expect(['VAR', 'none', 'transparent']).toContain(v);
      expect(stripped).not.toMatch(/rgba?\(|hsla?\(/);
    }
  });

  it('dark palette: the five conductors are distinct from each other', () => {
    const d = DARK_PALETTE;
    const colours = ['black', 'white', 'red', 'bare', 'green'] as const;
    const pairs = colours.map((c) => `${d[`wire-${c}` as PaletteName]}/${d[`wire-${c}-edge` as PaletteName]}`);
    expect(new Set(pairs).size).toBe(5);
    expect(new Set(colours.map((c) => d[`wire-${c}` as PaletteName])).size).toBe(5);
  });

  it('dark palette: the black wire is a solid band lighter than the canvas, and every wire core stands out from it', () => {
    const lum = (hex: string) => {
      const n = parseInt(hex.slice(1).length === 3 ? hex.slice(1).replace(/./g, '$&$&') : hex.slice(1), 16);
      const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
    };
    const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    const d = DARK_PALETTE;
    // the black core is a visible band against the canvas (not an outline round a hole), and far from the white core
    expect(ratio(d['wire-black'], d.bg)).toBeGreaterThan(2);
    expect(ratio(d['wire-white'], d['wire-black'])).toBeGreaterThan(5);
    // its casing is darker than its core, so the visible width is the core's width, like every other colour
    expect(lum(d['wire-black-edge'])).toBeLessThan(lum(d['wire-black']));
    for (const c of ['white', 'red', 'bare', 'green'] as const) expect(ratio(d[`wire-${c}` as PaletteName], d.bg), c).toBeGreaterThan(3);
    // black screw has a rim, boxes and devices differ from the canvas
    expect(ratio(d['screw-stroke'], d['screw-black'])).toBeGreaterThan(4);
    expect(ratio(d['box-stroke'], d.bg)).toBeGreaterThan(3);
    expect(ratio(d['device-stroke'], d.device)).toBeGreaterThan(3);
  });

  it('dark palette: black and white conductors are drawn with the same stroke widths, and wider than in the light palette', async () => {
    const widths = (svg: string, colour: string) => {
      const g = [...svg.matchAll(/<g class="wire" data-connection="[^"]*" data-color="(\w+)">([^]*?)<\/g>/g)].find((m) => m[1] === colour)!;
      return [...g[2].matchAll(/<path [^>]*stroke="(?!transparent)[^"]*"[^>]*stroke-width="([\d.]+)"/g)].map((m) => Number(m[1]));
    };
    for (const m of FIXTURES) {
      const raw = renderSvg(await layoutCircuit(m), m);
      const dark = resolvePalette(raw, DARK_PALETTE);
      const light = resolvePalette(raw, LIGHT_PALETTE);
      expect(widths(dark, 'black')).toEqual([8, 5]);
      expect(widths(dark, 'white')).toEqual([8, 5]);
      expect(widths(light, 'black')).toEqual([5, 3]);
    }
  });

  it('paletteCss defines every variable; the legend only uses palette names', () => {
    const css = paletteCss('.dark .x', DARK_PALETTE);
    for (const n of PALETTE_NAMES) expect(css).toContain(`--dg-${n}:${DARK_PALETTE[n]}`);
    for (const g of LEGEND)
      for (const e of g.entries) {
        expect(PALETTE_NAMES).toContain(e.name);
        if (e.edge) expect(PALETTE_NAMES).toContain(e.edge);
        expect(e.meaning.length).toBeGreaterThan(5);
      }
  });
});
