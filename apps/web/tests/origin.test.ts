import { describe, expect, it } from 'vitest';
import { TEMPLATES, type Block } from '@diy-ai/core';
import { describeBlock, describeOrigin, UNVERIFIED_LABEL } from '../src/lib/origin';

const blocksOrigin = (blocks: Block[], name = 'Basement') => ({ kind: 'blocks' as const, breakerAmps: 15 as const, blocks, name });

describe('describeOrigin', () => {
  it('summarises a block-built circuit in plain words', () => {
    const origin = blocksOrigin([
      { type: 'three_way_lights', count: 8, switchLabel: 'S', switchBoxLabel: 'B', lightLabel: 'L', lightBoxLabel: 'LB' },
      { type: 'receptacle_run', count: 8, gfciFirst: false, receptacleLabel: 'R', gfciLabel: 'G', boxLabel: 'B' },
    ]);
    expect(describeOrigin(origin)).toEqual({ kind: 'blocks', name: 'Basement', summary: '3-way pair with 8 lights → run of 8 receptacles' });
  });

  it('describes every block type, singular and plural', () => {
    const labels = { switchLabel: 'S', switchBoxLabel: 'B', lightLabel: 'L', lightBoxLabel: 'LB' };
    expect(describeBlock({ type: 'receptacle_run', count: 1, gfciFirst: true, receptacleLabel: 'R', gfciLabel: 'G', boxLabel: 'B' })).toBe('GFCI-first run of 1 receptacle');
    expect(describeBlock({ type: 'switch_lights', count: 1, ...labels })).toBe('switch with 1 light');
    expect(describeBlock({ type: 'switch_lights', count: 4, ...labels })).toBe('switch with 4 lights');
    expect(describeBlock({ type: 'switch_fan', switchLabel: 'S', switchBoxLabel: 'B', fanLabel: 'F', fanBoxLabel: 'FB' })).toBe('switch with exhaust fan');
    expect(describeBlock({ type: 'two_gang_switches', countA: 1, countB: 3, gangBoxLabel: 'G', switchLabel: 'S', lightLabel: 'L', lightBoxLabel: 'LB' })).toBe('2-gang switches with 1 light and 3 lights');
  });

  it('still names the template of a legacy template circuit', () => {
    const t = TEMPLATES[0]!;
    expect(describeOrigin({ kind: 'template', templateId: t.id, params: {} })).toEqual({ kind: 'template', title: t.title });
  });

  it('falls back to the id for an unknown template', () => {
    expect(describeOrigin({ kind: 'template', templateId: 'gone', params: {} })).toEqual({ kind: 'template', title: 'gone' });
  });

  it('marks every custom circuit as custom (unverified)', () => {
    expect(describeOrigin({ kind: 'custom', verified: false })).toEqual({ kind: 'custom' });
    expect(UNVERIFIED_LABEL).toMatch(/Unverified wiring/);
  });

  it('says nothing for examples and manual circuits', () => {
    expect(describeOrigin(null)).toBeNull();
    expect(describeOrigin(undefined)).toBeNull();
  });
});
