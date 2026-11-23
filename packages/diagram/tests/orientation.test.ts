import { describe, expect, it } from 'vitest';
import { FIXTURES } from '@diy-ai/core/fixtures';
import { terminalsOf } from '../src/geometry';
import { layoutCircuit, type Layout } from '../src/layout';

/** Mirrored if any terminal of the device was laid out on the other side from its normal orientation. */
function mirroredByPosition(layout: Layout, id: string, type: Parameters<typeof terminalsOf>[0]): boolean {
  const node = layout.nodes.find((n) => n.id === `dev:${id}`)!;
  const sides = terminalsOf(type).map((t) => {
    const x = layout.ports.get(`dev:${id}.${t.name}`)!.x;
    const side = Math.abs(x - node.x) < 1 ? 'WEST' : Math.abs(x - (node.x + node.width)) < 1 ? 'EAST' : 'OTHER';
    return [t.side, side] as const;
  });
  for (const [, s] of sides) expect(s).not.toBe('OTHER');
  return sides.some(([normal, actual]) => normal !== actual);
}

describe('device orientation from laid-out terminal positions', () => {
  it('3-way fixture: first switch normal, second switch mirrored with common on the load side', async () => {
    const model = FIXTURES[1];
    const layout = await layoutCircuit(model);
    const at = (dev: string, term: string) => {
      const node = layout.nodes.find((n) => n.id === `dev:${dev}`)!;
      const x = layout.ports.get(`dev:${dev}.${term}`)!.x;
      return { node, x };
    };

    // SW1: power arrives on the left, travelers leave on the right
    const c1 = at('sw1', 'common');
    expect(c1.x).toBeCloseTo(c1.node.x, 0);
    for (const t of ['traveler_a', 'traveler_b']) expect(at('sw1', t).x).toBeCloseTo(c1.node.x + c1.node.width, 0);

    // SW2: travelers arrive on the left, common leaves on the right (toward the light)
    const c2 = at('sw2', 'common');
    expect(c2.x).toBeCloseTo(c2.node.x + c2.node.width, 0);
    for (const t of ['traveler_a', 'traveler_b']) expect(at('sw2', t).x).toBeCloseTo(c2.node.x, 0);

    expect(mirroredByPosition(layout, 'sw1', 'switch_3way')).toBe(false);
    expect(mirroredByPosition(layout, 'sw2', 'switch_3way')).toBe(true);
  });

  it('no other fixture device is mirrored', async () => {
    for (const [i, model] of FIXTURES.entries()) {
      const layout = await layoutCircuit(model);
      for (const d of model.devices) {
        const expected = i === 1 && d.id === 'sw2';
        expect(mirroredByPosition(layout, d.id, d.type), `${model.id} ${d.id}`).toBe(expected);
      }
    }
  });
});
