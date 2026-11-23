import { describe, expect, it } from 'vitest';
import { breakerAmps, circuitCountText, messageTarget, moved, neighbourAfterDelete, pickCircuit, summarize } from '../src/lib/circuits';

const c = (id: string, name = id) => ({ id, name });

describe('pickCircuit', () => {
  it('uses the wanted id, else the first, else null', () => {
    const list = [c('a'), c('b')];
    expect(pickCircuit(list, 'b')).toBe(list[1]);
    expect(pickCircuit(list, 'zzz')).toBe(list[0]);
    expect(pickCircuit(list, null)).toBe(list[0]);
    expect(pickCircuit([], 'a')).toBeNull();
  });
});

describe('neighbourAfterDelete', () => {
  it('takes the next circuit, else the previous, else nothing', () => {
    const list = [c('a'), c('b'), c('c')];
    expect(neighbourAfterDelete(list, 'b')).toBe('c');
    expect(neighbourAfterDelete(list, 'c')).toBe('b');
    expect(neighbourAfterDelete([c('a')], 'a')).toBeNull();
    expect(neighbourAfterDelete(list, 'x')).toBeNull();
  });
});

describe('moved', () => {
  it('swaps with the neighbour and refuses to leave the list', () => {
    expect(moved(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moved(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
    expect(moved(['a', 'b'], 0, -1)).toBeNull();
    expect(moved(['a', 'b'], 1, 1)).toBeNull();
    expect(moved(['a'], 5, 1)).toBeNull();
  });
  it('does not change its input', () => {
    const ids = ['a', 'b'];
    moved(ids, 0, 1);
    expect(ids).toEqual(['a', 'b']);
  });
});

describe('summarize', () => {
  it('marks custom wiring unverified and says Example when there is no origin', () => {
    expect(summarize({ origin: { kind: 'custom', verified: false } })).toEqual({ kind: 'custom', text: 'Custom wiring — unverified' });
    expect(summarize({ origin: null })).toEqual({ kind: 'example', text: 'Example' });
  });
  it('uses the block summary for blocks origin', () => {
    const origin = {
      kind: 'blocks' as const,
      breakerAmps: 15 as const,
      name: 'Basement',
      blocks: [{ type: 'switch_fan' as const, switchLabel: 'S', switchBoxLabel: 'B', fanLabel: 'F', fanBoxLabel: 'FB' }],
    };
    expect(summarize({ origin })).toEqual({ kind: 'blocks', text: 'switch with exhaust fan' });
  });
});

describe('breakerAmps', () => {
  it('reads the breaker rating, or null without one', () => {
    expect(breakerAmps({ devices: [{ type: 'receptacle' }, { type: 'breaker', amps: 20 }] } as never)).toBe(20);
    expect(breakerAmps({ devices: [{ type: 'receptacle' }] } as never)).toBeNull();
  });
});

describe('messageTarget', () => {
  const circuits = [c('a', 'Living room lights')];
  it('names a circuit that still exists, by its current name', () => {
    expect(messageTarget('a', circuits)).toEqual({ kind: 'circuit', id: 'a', name: 'Living room lights' });
  });
  it('says so when the circuit was deleted or never linked', () => {
    expect(messageTarget('gone', circuits)).toEqual({ kind: 'gone', text: 'a circuit that was later deleted' });
    expect(messageTarget(null, circuits)).toEqual({ kind: 'gone', text: 'a circuit that is no longer in this project' });
  });
});

describe('circuitCountText', () => {
  it('counts', () => {
    expect([0, 1, 3].map(circuitCountText)).toEqual(['No circuits', '1 circuit', '3 circuits']);
  });
});
