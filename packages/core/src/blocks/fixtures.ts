// Block-built circuits at realistic scale, for checking diagrams and chat flows (ADR-008 step 2).
import type { CircuitModel } from '../schema';
import { buildCircuit } from './build';
import type { CircuitSpecInput } from './schema';

export interface BlockFixture {
  name: string;
  spec: CircuitSpecInput;
  circuit: CircuitModel;
}

const fixture = (name: string, spec: CircuitSpecInput): BlockFixture => ({ name, spec, circuit: buildCircuit(spec) });

export const BLOCK_FIXTURES: readonly BlockFixture[] = [
  fixture('receptacle-run-8', {
    id: 'receptacle-run-8',
    title: 'Run of 8 receptacles (20 A)',
    breakerAmps: 20,
    blocks: [{ type: 'receptacle_run', count: 8 }],
  }),
  fixture('three-way-8-lights', {
    id: 'three-way-8-lights',
    title: '3-way pair with 8 lights (15 A)',
    breakerAmps: 15,
    blocks: [{ type: 'three_way_lights', count: 8 }],
  }),
  fixture('bathroom', {
    id: 'bathroom',
    title: 'Bathroom: GFCI-first run of 3, light, fan (20 A)',
    breakerAmps: 20,
    blocks: [
      { type: 'receptacle_run', count: 3, gfciFirst: true },
      { type: 'switch_lights', count: 1 },
      { type: 'switch_fan' },
    ],
  }),
  fixture('bedroom', {
    id: 'bedroom',
    title: 'Bedroom: switch with 2 lights, run of 5 receptacles (15 A)',
    breakerAmps: 15,
    blocks: [
      { type: 'switch_lights', count: 2 },
      { type: 'receptacle_run', count: 5 },
    ],
  }),
];
