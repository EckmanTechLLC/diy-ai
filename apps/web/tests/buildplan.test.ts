import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildMaterials, buildSteps } from '@diy-ai/core';
import { FIXTURES } from '@diy-ai/core/fixtures';
import type { Project, ProjectCircuit } from '../src/api/client';
import {
  loadProgress,
  parseAllowance,
  parseFeet,
  parseProgress,
  parseTab,
  planOptionsFor,
  saveProgress,
  withAllowance,
  withCableLengths,
  withLength,
} from '../src/lib/buildplan';

const circuit = (over: Partial<ProjectCircuit> = {}): ProjectCircuit => ({
  id: 'c1',
  name: 'Basement',
  position: 0,
  circuit: FIXTURES[1]!,
  origin: null,
  findings: [],
  plan: null,
  cableLengths: null,
  updatedAt: 1,
  ...over,
});

describe('parseTab', () => {
  it('accepts the three tabs and falls back to the diagram for anything else', () => {
    expect(parseTab('materials')).toBe('materials');
    expect(parseTab('steps')).toBe('steps');
    expect(parseTab('diagram')).toBe('diagram');
    for (const bad of [null, '', 'Materials', 'print', 'steps ']) expect(parseTab(bad), String(bad)).toBe('diagram');
  });
});

describe('parseFeet', () => {
  it('accepts whole and one-decimal lengths up to 1000 and an empty field as no length', () => {
    for (const [text, value] of [['12', 12], [' 12.5 ', 12.5], ['0.1', 0.1], ['.5', 0.5], ['1000', 1000], ['7.', 7], ['', null], ['   ', null]] as const)
      expect(parseFeet(text), text).toEqual({ ok: true, value });
  });
  it('explains each kind of rejection', () => {
    expect(parseFeet('abc')).toMatchObject({ ok: false, message: expect.stringContaining('number') });
    expect(parseFeet('-3')).toMatchObject({ ok: false });
    expect(parseFeet('1e2')).toMatchObject({ ok: false });
    expect(parseFeet('12,5')).toMatchObject({ ok: false });
    expect(parseFeet('0')).toMatchObject({ ok: false, message: expect.stringContaining('more than 0') });
    expect(parseFeet('0.0')).toMatchObject({ ok: false, message: expect.stringContaining('more than 0') });
    expect(parseFeet('12.25')).toMatchObject({ ok: false, message: expect.stringContaining('one decimal') });
    expect(parseFeet('1000.1')).toMatchObject({ ok: false, message: expect.stringContaining('1000') });
  });
});

describe('parseAllowance', () => {
  it('accepts 0 to 50 and rejects the rest', () => {
    expect(parseAllowance('0')).toEqual({ ok: true, value: 0 });
    expect(parseAllowance(' 15 ')).toEqual({ ok: true, value: 15 });
    expect(parseAllowance('50')).toEqual({ ok: true, value: 50 });
    for (const bad of ['', 'x', '-1', '50.1', '51', '1e1']) expect(parseAllowance(bad).ok, bad).toBe(false);
  });
});

describe('stored lengths', () => {
  it('withLength sets, replaces and removes one run and keeps the rest and the allowance', () => {
    const a = withLength(null, 'feed', 25);
    expect(a).toEqual({ lengths: { feed: 25 }, allowancePct: 15 });
    const b = withLength({ lengths: { feed: 25, load: 8 }, allowancePct: 20 }, 'feed', 30);
    expect(b).toEqual({ lengths: { feed: 30, load: 8 }, allowancePct: 20 });
    expect(withLength(b, 'load', null)).toEqual({ lengths: { feed: 30 }, allowancePct: 20 });
  });
  it('withAllowance keeps the lengths, and neither mutates its input', () => {
    const cur = { lengths: { feed: 25 }, allowancePct: 15 };
    expect(withAllowance(cur, 5)).toEqual({ lengths: { feed: 25 }, allowancePct: 5 });
    expect(withAllowance(null, 5)).toEqual({ lengths: {}, allowancePct: 5 });
    withLength(cur, 'feed', null);
    expect(cur).toEqual({ lengths: { feed: 25 }, allowancePct: 15 });
  });
  it('withCableLengths replaces one circuit and keeps the others as they are', () => {
    const other = circuit({ id: 'c2' });
    const project = { id: 'p', circuits: [circuit(), other] } as unknown as Project;
    const next = withCableLengths(project, 'c1', { lengths: { feed: 5 }, allowancePct: 10 });
    expect(next.circuits[0]!.cableLengths).toEqual({ lengths: { feed: 5 }, allowancePct: 10 });
    expect(next.circuits[1]).toBe(other);
    expect(next.circuits[0]!.circuit).toBe(project.circuits[0]!.circuit);
    expect(withCableLengths(next, 'c1', null).circuits[0]!.cableLengths).toBeNull();
  });
});

describe('planOptionsFor', () => {
  it('uses the default allowance and no lengths for a fresh circuit, and marks only custom wiring unverified', () => {
    expect(planOptionsFor(circuit())).toEqual({ cableLengths: {}, allowancePct: 15, unverified: false });
    expect(planOptionsFor(circuit({ origin: { kind: 'custom', verified: false } })).unverified).toBe(true);
    expect(planOptionsFor(circuit({ origin: { kind: 'template', templateId: 'x', params: {} } as never })).unverified).toBe(false);
  });
  it('passes stored lengths, allowance and the plan protection to the generators', () => {
    const protection = { gfci: 'none' as const, afci: true };
    const c = circuit({ plan: { protection } as never, cableLengths: { lengths: { feed: 20, load: 10 }, allowancePct: 10 } });
    const options = planOptionsFor(c);
    expect(options).toMatchObject({ protection, cableLengths: { feed: 20, load: 10 }, allowancePct: 10 });
    const list = buildMaterials(c.circuit, options);
    expect(list.items.find((i) => i.category === 'breaker')!.description).toContain('AFCI');
    const total = list.cableTotals.find((t) => t.type === '14/2')!;
    expect(total).toMatchObject({ knownFt: 30, allowancePct: 10, totalFt: 33, missing: 0 });
    // the travelers cable has no length: it is reported missing, never estimated
    expect(list.cableTotals.find((t) => t.type === '14/3')).toMatchObject({ knownFt: 0, missing: 1 });
    expect(() => buildSteps(c.circuit, options)).not.toThrow();
  });
});

describe('step progress', () => {
  const valid = new Set(['a', 'b', 'c']);
  it('keeps only known step ids and tolerates damaged text', () => {
    expect(parseProgress('["a","x","c"]', valid)).toEqual(new Set(['a', 'c']));
    expect(parseProgress('["a",1,null]', valid)).toEqual(new Set(['a']));
    for (const bad of [null, '', '{', '{"a":1}', '"a"', '5']) expect(parseProgress(bad, valid).size, String(bad)).toBe(0);
  });

  describe('browser storage', () => {
    afterEach(() => vi.unstubAllGlobals());
    const memory = () => {
      const m = new Map<string, string>();
      vi.stubGlobal('localStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) });
      return m;
    };
    it('saves per project and circuit, drops unknown ids on load, and removes the entry when nothing is ticked', () => {
      const m = memory();
      saveProgress('p', 'c1', new Set(['a', 'x']));
      saveProgress('p', 'c2', new Set(['b']));
      expect(m.size).toBe(2);
      expect(loadProgress('p', 'c1', valid)).toEqual(new Set(['a']));
      expect(loadProgress('p', 'c2', valid)).toEqual(new Set(['b']));
      expect(loadProgress('q', 'c1', valid).size).toBe(0);
      saveProgress('p', 'c1', new Set());
      expect(m.size).toBe(1);
    });
    it('works when storage throws', () => {
      const boom = () => {
        throw new Error('denied');
      };
      vi.stubGlobal('localStorage', { getItem: boom, setItem: boom, removeItem: boom });
      expect(() => saveProgress('p', 'c', new Set(['a']))).not.toThrow();
      expect(loadProgress('p', 'c', valid).size).toBe(0);
    });
  });
});
