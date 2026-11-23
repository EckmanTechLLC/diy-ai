import { describe, expect, it } from 'vitest';
import type { CableTotal, MaterialItem, MaterialsList } from '@diy-ai/core';
import { mergeMaterials } from '../src/lib/shopping';
import { ALL_PARTS, parsePrintParts } from '../src/lib/printdoc';

const item = (over: Partial<MaterialItem> & Pick<MaterialItem, 'id' | 'category' | 'description'>): MaterialItem => ({
  quantity: 1,
  unit: 'each',
  refs: [],
  ...over,
});
const total = (over: Partial<CableTotal> = {}): CableTotal => ({ type: '14/2', runs: 1, knownFt: 0, allowancePct: 10, totalFt: 0, missing: 1, ...over });
const list = (items: MaterialItem[], cableTotals: CableTotal[] = [], notIncluded: string[] = ['Staples.']): MaterialsList => ({
  circuitId: 'x',
  title: 'x',
  unverified: false,
  items,
  cableTotals,
  notIncluded,
});

describe('mergeMaterials', () => {
  it('sums identical items and names each circuit once', () => {
    const a = list([item({ id: 'a1', category: 'device', description: 'Duplex receptacle', quantity: 3 }), item({ id: 'a2', category: 'box', description: '1-gang box', quantity: 2 })]);
    const b = list([item({ id: 'b1', category: 'device', description: 'Duplex receptacle', quantity: 4 }), item({ id: 'b2', category: 'device', description: 'Duplex receptacle', quantity: 1 })]);
    const r = mergeMaterials([
      { name: 'Kitchen', list: a },
      { name: 'Den', list: b },
    ]);
    const duplex = r.items.find((i) => i.description === 'Duplex receptacle')!;
    expect(duplex.quantity).toBe(8);
    expect(duplex.usedIn).toEqual(['Kitchen', 'Den']);
    expect(r.items.map((i) => i.category)).toEqual(['device', 'box']);
  });

  it('does not merge items that differ in description or unit', () => {
    const a = list([item({ id: '1', category: 'wire_nut', description: 'Wire nut, 3 x 14 AWG' }), item({ id: '2', category: 'wire_nut', description: 'Wire nut, 2 x 14 AWG' })]);
    expect(mergeMaterials([{ name: 'A', list: a }]).items).toHaveLength(2);
  });

  it('keeps distinct notes once each', () => {
    const n1 = item({ id: '1', category: 'box', description: 'Box', note: 'Check the volume.' });
    const n2 = item({ id: '2', category: 'box', description: 'Box', note: 'Check the volume.' });
    const n3 = item({ id: '3', category: 'box', description: 'Box', note: 'Deep box.' });
    const none = item({ id: '4', category: 'box', description: 'Box' });
    const r = mergeMaterials([
      { name: 'A', list: list([n1]) },
      { name: 'B', list: list([n2, n3, none]) },
    ]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.notes).toEqual(['Check the volume.', 'Deep box.']);
  });

  it('lists breakers individually with their type', () => {
    const br = (id: string, d: string) => item({ id, category: 'breaker', description: d });
    const r = mergeMaterials([
      { name: 'A', list: list([br('b1', '20 A AFCI breaker, single-pole')]) },
      { name: 'B', list: list([br('b2', '20 A AFCI breaker, single-pole')]) },
    ]);
    expect(r.items.map((i) => [i.description, i.quantity, i.usedIn])).toEqual([
      ['20 A AFCI breaker, single-pole', 1, ['A']],
      ['20 A AFCI breaker, single-pole', 1, ['B']],
    ]);
  });

  it('leaves cable runs out of the items and sums cable per type from entered lengths', () => {
    const run = item({ id: 'cable:1', category: 'cable_run', description: 'run', unit: 'run' });
    const a = list([run], [total({ runs: 2, knownFt: 20, allowancePct: 10, totalFt: 22, missing: 0 })]);
    const b = list([run], [total({ runs: 3, knownFt: 30, allowancePct: 10, totalFt: 33, missing: 0 }), total({ type: '12/2', runs: 1, knownFt: 5, totalFt: 6, missing: 0 })]);
    const r = mergeMaterials([
      { name: 'A', list: a },
      { name: 'B', list: b },
    ]);
    expect(r.items).toEqual([]);
    expect(r.cable.map((c) => [c.type, c.runs, c.knownFt, c.totalFt, c.missing, c.allowancePcts, c.usedIn])).toEqual([
      ['14/2', 5, 50, 55, 0, [10], ['A', 'B']],
      ['12/2', 1, 5, 6, 0, [10], ['B']],
    ]);
    expect(r.missingRuns).toBe(0);
  });

  it('counts runs without a length and never estimates them', () => {
    const a = list([], [total({ runs: 3, knownFt: 10, totalFt: 11, missing: 2 })]);
    const b = list([], [total({ runs: 2, knownFt: 0, totalFt: 0, missing: 2, allowancePct: 25 })]);
    const r = mergeMaterials([
      { name: 'A', list: a },
      { name: 'B', list: b },
    ]);
    expect(r.cable[0]).toMatchObject({ runs: 5, missing: 4, knownFt: 10, totalFt: 11, allowancePcts: [10] });
    expect(r.missingRuns).toBe(4);
  });

  it('uses each circuit its own allowance and reports mixed ones', () => {
    const a = list([], [total({ runs: 1, knownFt: 10, allowancePct: 10, totalFt: 11, missing: 0 })]);
    const b = list([], [total({ runs: 1, knownFt: 10, allowancePct: 25, totalFt: 13, missing: 0 })]);
    const r = mergeMaterials([
      { name: 'A', list: a },
      { name: 'B', list: b },
    ]);
    expect(r.cable[0]).toMatchObject({ knownFt: 20, totalFt: 24, allowancePcts: [10, 25] });
  });

  it('merges the fixed not-included texts without repeats and handles no circuits', () => {
    const r = mergeMaterials([
      { name: 'A', list: list([], [], ['x', 'y']) },
      { name: 'B', list: list([], [], ['y', 'z']) },
    ]);
    expect(r.notIncluded).toEqual(['x', 'y', 'z']);
    expect(mergeMaterials([])).toEqual({ items: [], cable: [], missingRuns: 0, notIncluded: [] });
  });
});

describe('parsePrintParts', () => {
  it('includes everything by default and for malformed text', () => {
    for (const raw of [null, '', 'nope', '[]', '5', 'null']) expect(parsePrintParts(raw), String(raw)).toEqual(ALL_PARTS);
  });
  it('turns off only what is stored as false', () => {
    expect(parsePrintParts('{"steps":false,"shopping":"no","extra":false}')).toEqual({ shopping: true, diagrams: true, materials: true, steps: false });
  });
});
