// Realistic-size circuits (BLOCK_FIXTURES, 52-85 wires): the strip and the wrapped layout, each with every invariant.
// Crossing maxima are the measured values.
import { beforeAll, describe, expect, it } from 'vitest';
import { BLOCK_FIXTURES } from '@diy-ai/core';
import { FIXTURES } from '@diy-ai/core/fixtures';
import { layoutCircuit, WRAP_THRESHOLD, type LayoutMode } from '../src/layout';
import { INVARIANTS, measure, type InvariantName, type Measurement } from './checks';

const WIRES = [69, 85, 52, 65];
// Measured for both modes (the crossings come from the box interiors, which the top-level layout does not change).
const MAX_CROSSINGS = [7, 9, 7, 9];

/** Known failures, kept as real assertions (it.fails): none. */
const KNOWN_FAILURES = new Set<string>();

const modes: LayoutMode[] = ['strip', 'wrapped'];

describe.each(modes)('layout at scale: %s', (mode) => {
  describe.each(BLOCK_FIXTURES.map((f, i) => [f.name, f, i] as const))('%s', (_name, f, i) => {
    let m: Measurement;
    beforeAll(async () => {
      m = await measure(f.circuit, { mode }, 1);
    }, 60_000);

    it(`is laid out as a ${mode}`, () => {
      expect(m.layout.mode).toBe(mode);
      if (mode === 'strip') expect(m.width).toBeGreaterThan(WRAP_THRESHOLD);
    });

    it(`has ${WIRES[i]} wires`, () => {
      expect(f.circuit.connections.length).toBe(WIRES[i]);
    });

    it('records size, length, bends and layout time', () => {
      expect(m.width).toBeGreaterThan(0);
      expect(m.height).toBeGreaterThan(0);
      expect(m.length).toBeGreaterThan(0);
      expect(m.bends).toBeGreaterThan(0);
      expect(m.ms).toBeGreaterThanOrEqual(0);
    });

    it('crossings between different nets stay within the measured maximum', () => {
      expect(m.crossings).toBeLessThanOrEqual(MAX_CROSSINGS[i]);
    });

    for (const name of INVARIANTS) {
      const run = KNOWN_FAILURES.has(`${f.name}:${name}`) ? it.fails : it;
      run(`invariant ${name}`, () => {
        expect(m.invariants[name as InvariantName]).toEqual([]);
      });
    }
  });
});

describe('wrapping by default', () => {
  it.each(BLOCK_FIXTURES.map((f) => [f.name, f] as const))('%s is wrapped, and equals the forced wrapped layout', async (_n, f) => {
    const auto = await layoutCircuit(f.circuit);
    const wrapped = await layoutCircuit(f.circuit, { mode: 'wrapped' });
    expect(auto.mode).toBe('wrapped');
    expect([auto.width, auto.height]).toEqual([wrapped.width, wrapped.height]);
  }, 60_000);

  it('keeps the four original fixtures as strips below the threshold', async () => {
    for (const m of FIXTURES) {
      const l = await layoutCircuit(m);
      expect(l.mode).toBe('strip');
      expect(l.width).toBeLessThan(WRAP_THRESHOLD);
    }
  });
});
