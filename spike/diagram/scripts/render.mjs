import { mkdirSync, writeFileSync } from 'node:fs';
import { FIXTURES } from '../src/fixtures.ts';
import { layoutCircuit, layoutCircuitSingleRun, layoutMetrics } from '../src/layout.ts';
import { renderSvg } from '../src/render.ts';

const outDir = new URL('../out/', import.meta.url);
mkdirSync(new URL('single-run/', outDir), { recursive: true });
for (const [i, model] of FIXTURES.entries()) {
  for (const [dir, label, layout] of [
    ['', 'two-level', layoutCircuit],
    ['single-run/', 'single-run', layoutCircuitSingleRun],
  ]) {
    const l = await layout(model);
    writeFileSync(new URL(`${dir}circuit-${i + 1}.svg`, outDir), renderSvg(model, l));
    const m = layoutMetrics(l);
    console.log(`out/${dir}circuit-${i + 1}.svg ${label} (${model.connections.length} wires) crossings=${m.crossings} length=${m.length} bends=${m.bends}`);
  }
}
