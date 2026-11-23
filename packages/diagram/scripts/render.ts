import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { FIXTURES } from '@diy-ai/core/fixtures';
import { DARK_PALETTE, LIGHT_PALETTE, layoutCircuit, layoutMetrics, renderSvg, resolvePalette } from '../src/index.ts';

const outDir = new URL('../out/', import.meta.url);
mkdirSync(outDir, { recursive: true });
for (const [i, model] of FIXTURES.entries()) {
  const layout = await layoutCircuit(model);
  const svg = renderSvg(layout, model);
  // rsvg-convert ignores custom properties, so the previews have the palette values written in (the light SVG is
  // the same drawing as the unresolved one in a browser)
  writeFileSync(new URL(`circuit-${i + 1}.svg`, outDir), resolvePalette(svg, LIGHT_PALETTE));
  writeFileSync(new URL(`circuit-${i + 1}-dark.svg`, outDir), resolvePalette(svg, DARK_PALETTE));
  const m = layoutMetrics(layout);
  console.log(`out/circuit-${i + 1}.svg (${model.connections.length} wires) crossings=${m.crossings} length=${m.length} bends=${m.bends}`);
}

// ---- realistic-size circuits: out/scale/<name>[-strip][-dark].svg + png --------------------------------------------
// <name> is the default layout (wrapped for all four), <name>-strip the single strip. Every PNG is at 1 px per SVG
// unit; the wrapped ones also get <name>[-dark]-1400.png, the drawing fitted to a 1400 px wide view.
import { execFileSync } from 'node:child_process';
import { BLOCK_FIXTURES } from '@diy-ai/core';
import { INVARIANTS, measure } from '../tests/checks.ts';

function png(svgPath: URL, pngPath: URL, width?: number) {
  execFileSync('rsvg-convert', [...(width ? ['-w', String(width)] : []), svgPath.pathname, '-o', pngPath.pathname]);
}

const scaleDir = new URL('../out/scale/', import.meta.url);
rmSync(scaleDir, { recursive: true, force: true });
mkdirSync(scaleDir, { recursive: true });
const report: Record<string, unknown> = {};
for (const f of BLOCK_FIXTURES) {
  for (const mode of ['strip', 'wrapped'] as const) {
    const m = await measure(f.circuit, { mode }, 5);
    const stem = mode === 'strip' ? `${f.name}-strip` : f.name;
    for (const [suffix, palette] of [['', LIGHT_PALETTE], ['-dark', DARK_PALETTE]] as const) {
      writeFileSync(new URL(`${stem}${suffix}.svg`, scaleDir), resolvePalette(m.svg, palette));
      png(new URL(`${stem}${suffix}.svg`, scaleDir), new URL(`${stem}${suffix}.png`, scaleDir));
      if (mode === 'wrapped') png(new URL(`${stem}${suffix}.svg`, scaleDir), new URL(`${stem}${suffix}-1400.png`, scaleDir), 1400);
    }
    const failed = INVARIANTS.filter((i) => m.invariants[i].length > 0).map((i) => `${i}(${m.invariants[i].length})`);
    report[`${mode}/${f.name}`] = { wires: f.circuit.connections.length, width: m.width, height: m.height, crossings: m.crossings, length: m.length, bends: m.bends, ms: m.ms, failedInvariants: m.invariants };
    console.log(`out/scale/${stem}.svg ${m.width}x${m.height} wires=${f.circuit.connections.length} crossings=${m.crossings} length=${m.length} bends=${m.bends} ${m.ms}ms invariants: ${failed.join(' ') || 'all hold'}`);
  }
}
writeFileSync(new URL('metrics.json', scaleDir), JSON.stringify(report, null, 1));
