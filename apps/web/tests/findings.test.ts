import { describe, expect, it } from 'vitest';
import { RULES, type CircuitModel, type Finding } from '@diy-ai/core';
import { FIXTURES } from '@diy-ai/core/fixtures';
import {
  checkForDisplay,
  checkedRules,
  citationText,
  findingHighlight,
  groupFindings,
  isEmptyHighlight,
  statusBadgeText,
  statusLine,
  statusOf,
} from '../src/lib/findings';

const [c1] = FIXTURES;
const clone = (m: CircuitModel): CircuitModel => JSON.parse(JSON.stringify(m));

const cite = (section: string | null) => ({ edition: 'nec-2023' as const, section, confirmed: false as const });
const f = (ruleId: string, severity: Finding['severity'], message: string, involved: string[], section: string | null = null): Finding => ({
  ruleId,
  severity,
  message,
  involved,
  citation: cite(section),
});

/** A black wire put on the neutral: a real seeded fault. */
function blackOnNeutral(): CircuitModel {
  const m = clone(c1!);
  const conn = m.connections.find((c) => c.color === 'white')!;
  conn.color = 'black';
  return m;
}

describe('checkForDisplay', () => {
  it('finds nothing on the known-good fixtures', () => {
    for (const m of FIXTURES) expect(checkForDisplay(m)).toEqual([]);
  });
  it('reports a seeded fault with an error and involved ids that exist in the circuit', () => {
    const m = blackOnNeutral();
    const found = checkForDisplay(m);
    expect(found.length).toBeGreaterThan(0);
    expect(found.some((x) => x.severity === 'error')).toBe(true);
    const h = findingHighlight(m, found.flatMap((x) => x.involved));
    expect(isEmptyHighlight(h)).toBe(false);
  });
});

describe('groupFindings', () => {
  it('merges findings of one rule, de-duplicating messages and ids', () => {
    const groups = groupFindings([f('no-short', 'error', 'A', ['x', 'y']), f('no-short', 'error', 'B', ['y', 'z']), f('no-short', 'error', 'A', ['x'])]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ ruleId: 'no-short', severity: 'error', messages: ['A', 'B'], involved: ['x', 'y', 'z'] });
    expect(groups[0]!.title).toBe(RULES.find((r) => r.id === 'no-short')!.title);
  });
  it('orders errors before warnings, keeping first-seen order within each', () => {
    const groups = groupFindings([
      f('floating-conductors', 'warning', 'w1', ['a']),
      f('no-short', 'error', 'e1', ['b']),
      f('neutral-at-switch-box', 'warning', 'w2', ['c']),
      f('load-fed', 'error', 'e2', ['d']),
    ]);
    expect(groups.map((g) => g.ruleId)).toEqual(['no-short', 'load-fed', 'floating-conductors', 'neutral-at-switch-box']);
  });
  it('treats a rule with any error as an error', () => {
    expect(groupFindings([f('wire-colour-role', 'warning', 'w', []), f('wire-colour-role', 'error', 'e', [])])[0]!.severity).toBe('error');
  });
  it('titles an unknown rule by its id and groups real findings by rule', () => {
    expect(groupFindings([f('mystery', 'warning', 'm', [])])[0]!.title).toBe('mystery');
    const real = checkForDisplay(blackOnNeutral());
    const groups = groupFindings(real);
    expect(new Set(groups.map((g) => g.ruleId)).size).toBe(groups.length);
    expect(new Set(real.map((x) => x.ruleId)).size).toBe(groups.length);
  });
});

describe('statusOf and wording', () => {
  it('passes with no findings', () => {
    const s = statusOf([]);
    expect(s.kind).toBe('passed');
    expect(statusLine(s, 12)).toBe('All 12 wiring-logic checks passed');
    expect(statusBadgeText(s)).toBe('Wiring-logic checks passed');
  });
  it('counts warnings and problems with correct plurals', () => {
    expect(statusBadgeText(statusOf([f('a', 'warning', 'x', [])]))).toBe('Wiring-logic checks: 1 warning');
    expect(statusBadgeText(statusOf([f('a', 'warning', 'x', []), f('b', 'warning', 'y', [])]))).toBe('Wiring-logic checks: 2 warnings');
    const s = statusOf([f('a', 'error', 'x', []), f('b', 'warning', 'y', [])]);
    expect(s).toMatchObject({ kind: 'problems', errors: 1, warnings: 1 });
    expect(statusLine(s, 12)).toBe('1 problem found by the wiring-logic checks, and 1 warning');
  });
  it('says the checks could not run when the checker refuses the circuit', () => {
    const m = clone(c1!);
    m.devices = m.devices.filter((d) => d.type !== 'ground_bar');
    const s = statusOf(checkForDisplay(m));
    expect(s.kind).toBe('not-checked');
    expect(statusBadgeText(s)).toBe('Wiring-logic checks could not run');
  });
  it('lists only real checks, not the meta rules', () => {
    const ids = checkedRules().map((r) => r.id);
    expect(ids).not.toContain('circuit-valid');
    expect(ids).not.toContain('model-assumptions');
    expect(ids.length).toBe(RULES.length - 2);
  });
});

describe('citationText', () => {
  it('always shows the unconfirmed state, or no citation', () => {
    expect(citationText(cite('250.119'))).toBe('NEC 2023 §250.119 (unconfirmed)');
    expect(citationText(cite(null))).toBe('no citation');
    for (const r of RULES) expect(citationText(r.citation)).toMatch(/^(no citation|NEC 2023 §.+ \(unconfirmed\))$/);
  });
});

describe('findingHighlight', () => {
  it('maps each kind of id and ignores unknown ids', () => {
    const m = c1!;
    const conn = m.connections[0]!.id;
    const dev = m.devices[0]!.id;
    const cable = m.cables[0]!.id;
    const box = m.boxes[0]!.id;
    const h = findingHighlight(m, [conn, dev, cable, box, 'nope']);
    expect([...h.connections]).toEqual([conn]);
    expect([...h.devices]).toEqual([dev]);
    expect([...h.cables]).toEqual([cable]);
    expect([...h.boxes]).toEqual([box]);
    expect(h.splices.size).toBe(0);
    expect(isEmptyHighlight(findingHighlight(m, ['nope']))).toBe(true);
  });
  it('maps splice ids', () => {
    const m = FIXTURES.find((x) => x.splices.length > 0)!;
    expect([...findingHighlight(m, [m.splices[0]!.id]).splices]).toEqual([m.splices[0]!.id]);
  });
});
