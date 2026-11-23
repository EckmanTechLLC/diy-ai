import { layoutCircuit, layoutCircuitSingleRun } from './layout';
import { renderSvg } from './render';
import type { CircuitModel } from './model';

export async function renderCircuit(model: CircuitModel): Promise<string> {
  return renderSvg(model, await layoutCircuit(model));
}

/** Round-2 single hierarchical run, for comparison. */
export async function renderCircuitSingleRun(model: CircuitModel): Promise<string> {
  return renderSvg(model, await layoutCircuitSingleRun(model));
}
