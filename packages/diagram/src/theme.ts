// Diagram colours. Every colour in the SVG is `var(--dg-<name>, <light value>)`, so a standalone SVG file
// looks the same everywhere and a host page restyles it by defining the custom properties (see paletteCss).

export const PALETTE_NAMES = [
  'bg',
  'title',
  'box-panel',
  'box',
  'box-stroke',
  'box-label',
  'sheath',
  'sheath-stroke',
  'sheath-text',
  'device',
  'device-stroke',
  'device-text',
  'terminal-text',
  'screw-stroke',
  'screw-brass',
  'screw-silver',
  'screw-green',
  'screw-black',
  'wire-black',
  'wire-black-edge',
  'wire-white',
  'wire-white-edge',
  'wire-red',
  'wire-red-edge',
  'wire-bare',
  'wire-bare-edge',
  'wire-green',
  'wire-green-edge',
  'splice',
  'splice-stroke',
  'splice-text',
  'highlight',
  'wire-edge-width',
  'wire-core-width',
] as const;
export type PaletteName = (typeof PALETTE_NAMES)[number];
export type Palette = Record<PaletteName, string>;

/** The values the SVG falls back to when a host defines nothing. */
export const LIGHT_PALETTE: Palette = {
  bg: '#fafafa',
  title: '#222',
  'box-panel': '#e6e9ee',
  box: '#eef3e6',
  'box-stroke': '#6b7480',
  'box-label': '#333',
  sheath: '#d9d4c3',
  'sheath-stroke': '#8a8368',
  'sheath-text': '#3a3626',
  device: '#f4f1ea',
  'device-stroke': '#444',
  'device-text': '#222',
  'terminal-text': '#444',
  'screw-stroke': '#333',
  'screw-brass': '#d4a72c',
  'screw-silver': '#c9ced3',
  'screw-green': '#2e9e44',
  'screw-black': '#2b2b2b',
  'wire-black': '#1b1b1b',
  'wire-black-edge': '#000',
  'wire-white': '#ffffff',
  'wire-white-edge': '#4a4a4a',
  'wire-red': '#d62828',
  'wire-red-edge': '#7a1010',
  'wire-bare': '#c77d3a',
  'wire-bare-edge': '#7a4a1c',
  'wire-green': '#2e9e44',
  'wire-green-edge': '#17602a',
  splice: '#f08a24',
  'splice-stroke': '#8a4a00',
  'splice-text': '#3a1f00',
  highlight: '#ff9d00',
  'wire-edge-width': '5',
  'wire-core-width': '3',
};

/**
 * Dark canvas (about #1a1d21). Every conductor is drawn as a casing (edge colour) under a core (fill colour), and in
 * the dark palette both are wider (8 and 5 against 5 and 3) so all five colours carry the same weight, also when the
 * diagram is scaled down. Earlier palettes drew black as a light outline round a dark core, which read as a thin
 * light-grey line; black is now a solid band:
 * - black: charcoal core, clearly lighter than the canvas, in a near-black casing (the core is the visible band);
 * - white: near-white core with a mid-grey casing (the only light core without a hue);
 * - red, green: brighter cores with dark casings of the same hue;
 * - bare copper: light copper core with a darker copper casing (distinct from red by hue and from white by tint).
 * Screws: the black screw gets a light rim; devices and boxes are lighter than the canvas so their edges show.
 */
export const DARK_PALETTE: Palette = {
  bg: '#1a1d21',
  title: '#eceff3',
  'box-panel': '#2a3039',
  box: '#2b3328',
  'box-stroke': '#8b95a3',
  'box-label': '#e3e7ec',
  sheath: '#4d4838',
  'sheath-stroke': '#b0a782',
  'sheath-text': '#f1ecd6',
  device: '#383a3f',
  'device-stroke': '#aeb4bc',
  'device-text': '#f2f2f2',
  'terminal-text': '#c9ced6',
  'screw-stroke': '#d5d9de',
  'screw-brass': '#d4a72c',
  'screw-silver': '#c9ced3',
  'screw-green': '#3fbf5a',
  'screw-black': '#0b0b0b',
  'wire-black': '#525964',
  'wire-black-edge': '#0b0c0e',
  'wire-white': '#f6f6f6',
  'wire-white-edge': '#5b616a',
  'wire-red': '#f2493f',
  'wire-red-edge': '#7d1a14',
  'wire-bare': '#e6a15c',
  'wire-bare-edge': '#8a5524',
  'wire-green': '#3fbf5a',
  'wire-green-edge': '#17602a',
  splice: '#f59b3c',
  'splice-stroke': '#ffc58a',
  'splice-text': '#2e1700',
  highlight: '#ffb020',
  'wire-edge-width': '8',
  'wire-core-width': '5',
};

/** `var(--dg-name, light value)`. */
export const themed = (name: PaletteName): string => `var(--dg-${name}, ${LIGHT_PALETTE[name]})`;

/** A CSS rule defining every palette property on `selector`. */
export const paletteCss = (selector: string, palette: Palette): string =>
  `${selector}{${PALETTE_NAMES.map((n) => `--dg-${n}:${palette[n]}`).join(';')}}`;

/**
 * Replace every `var(--dg-name, fallback)` in an SVG string by the palette's value, for renderers that
 * ignore custom properties (e.g. rsvg-convert) or to save a standalone dark SVG.
 */
export const resolvePalette = (svg: string, palette: Palette): string =>
  svg.replace(/var\(--dg-([a-z-]+), *[^)]*\)/g, (m, n: string) => palette[n as PaletteName] ?? m);

export interface LegendEntry {
  name: PaletteName;
  /** Optional second colour (the wire edge). */
  edge?: PaletteName;
  label: string;
  meaning: string;
}

export const LEGEND: { title: string; entries: LegendEntry[] }[] = [
  {
    title: 'Wire insulation',
    entries: [
      { name: 'wire-black', edge: 'wire-black-edge', label: 'Black', meaning: 'Hot conductor (also switched or traveler legs). Drawn charcoal on the dark canvas.' },
      { name: 'wire-white', edge: 'wire-white-edge', label: 'White', meaning: 'Neutral, unless the inspector says it carries a switched or hot leg.' },
      { name: 'wire-red', edge: 'wire-red-edge', label: 'Red', meaning: 'Second hot: traveler or switched conductor.' },
      { name: 'wire-bare', edge: 'wire-bare-edge', label: 'Bare copper', meaning: 'Equipment ground inside the cable.' },
      { name: 'wire-green', edge: 'wire-green-edge', label: 'Green', meaning: 'Equipment ground pigtail to a device.' },
    ],
  },
  {
    title: 'Terminal screws',
    entries: [
      { name: 'screw-brass', label: 'Brass', meaning: 'Hot terminal (or switch / traveler terminal).' },
      { name: 'screw-silver', label: 'Silver', meaning: 'Neutral terminal.' },
      { name: 'screw-green', label: 'Green', meaning: 'Ground terminal.' },
      { name: 'screw-black', label: 'Black', meaning: 'Dark screw: 3-way common, or a light fixture hot lead.' },
    ],
  },
  {
    title: 'Objects',
    entries: [
      { name: 'box-panel', label: 'Panel', meaning: 'Service panel (large blue-grey outline).' },
      { name: 'box', label: 'Box', meaning: 'Electrical box (green-grey outline).' },
      { name: 'sheath', label: 'Cable sheath', meaning: 'Outer jacket of a cable; its conductors emerge at both ends.' },
      { name: 'splice', label: 'Wire nut', meaning: 'Connector joining the wires that enter it.' },
      { name: 'highlight', label: 'Glow', meaning: 'Hovered or selected item.' },
    ],
  },
];
