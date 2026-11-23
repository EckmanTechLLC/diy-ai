import { describe, expect, it } from 'vitest';
import checklist from '../../../docs/rules/nec-2023-citations.md?raw';
import { FIXTURES } from '../src/fixtures';
import { Builder, C, S, T, cableTypeFor } from '../src/templates/builder';
import {
  CATALOGUE,
  INTERNAL_PATHS,
  RULES,
  TEMPLATES,
  analyzeNets,
  checkCircuit,
  citationChecklistMarkdown,
  type CircuitModel,
  type Endpoint,
  type Finding,
  type NetRole,
  type Severity,
  type WireColor,
} from '../src/index';

const [c1, c2, c3, c4] = FIXTURES as [CircuitModel, CircuitModel, CircuitModel, CircuitModel];
const check = (m: CircuitModel) => checkCircuit(m, { edition: 'nec-2023' });
const clone = (m: CircuitModel): CircuitModel => JSON.parse(JSON.stringify(m));

// ---- mutation helpers -------------------------------------------------------------------------------
const key = (e: Endpoint) =>
  e.kind === 'terminal' ? `t:${e.device}.${e.terminal}` : e.kind === 'conductor' ? `c:${e.cable}.${e.color}@${e.box}` : `s:${e.splice}`;
const t = (device: string, terminal: string): Endpoint => ({ kind: 'terminal', device, terminal });
const c = (cable: string, color: WireColor, box: string): Endpoint => ({ kind: 'conductor', cable, color, box });
const s = (splice: string): Endpoint => ({ kind: 'splice', splice });

function find(m: CircuitModel, a: Endpoint, b: Endpoint) {
  const hit = m.connections.find((x) => {
    const k = [key(x.a), key(x.b)];
    return k.includes(key(a)) && k.includes(key(b));
  });
  if (!hit) throw new Error(`no connection ${key(a)} - ${key(b)}`);
  return hit;
}
/** Re-point one end of an existing connection. */
function move(m: CircuitModel, a: Endpoint, b: Endpoint, from: Endpoint, to: Endpoint) {
  const x = find(m, a, b);
  if (key(x.a) === key(from)) x.a = to;
  else x.b = to;
}
function drop(m: CircuitModel, a: Endpoint, b: Endpoint) {
  const x = find(m, a, b);
  m.connections.splice(m.connections.indexOf(x), 1);
}
let n = 0;
function add(m: CircuitModel, a: Endpoint, b: Endpoint, color: WireColor) {
  m.connections.push({ id: `x${++n}`, a, b, color });
}
const id = (m: CircuitModel, a: Endpoint, b: Endpoint) => find(m, a, b).id;

// ---- assertion helper -------------------------------------------------------------------------------
interface Expect {
  rule: string;
  severity: Severity;
  /** ids that must all appear in the `involved` of one finding of this rule */
  involved: string[];
  /** number of findings for this rule (default: at least one) */
  count?: number;
}
/** Exactly these rules fire (no others), each with the stated severity and involved ids. */
function expectFindings(findings: Finding[], expected: Expect[]) {
  expect([...new Set(findings.map((f) => f.ruleId))].sort()).toEqual([...new Set(expected.map((e) => e.rule))].sort());
  for (const e of expected) {
    const mine = findings.filter((f) => f.ruleId === e.rule);
    if (e.count !== undefined) expect(mine).toHaveLength(e.count);
    expect(mine.some((f) => f.severity === e.severity && e.involved.every((i) => f.involved.includes(i)))).toBe(true);
    for (const f of mine) {
      expect(f.severity).toBe(e.severity);
      expect(f.citation.confirmed).toBe(false);
    }
  }
}

// ---- verified circuits are clean --------------------------------------------------------------------
describe('verified circuits', () => {
  it.each(FIXTURES.map((m) => [m.id, m] as const))('fixture %s has zero findings', (_n, m) => {
    expect(check(m)).toEqual([]);
  });
  for (const tpl of TEMPLATES) {
    for (const amps of [15, 20] as const) {
      it(`template ${tpl.id} at ${amps} A has zero findings`, () => {
        expect(check(tpl.build({ breakerAmps: amps }))).toEqual([]);
      });
    }
    it(`template ${tpl.id} with custom labels has zero findings`, () => {
      const labels = Object.fromEntries(Object.entries(tpl.params).filter(([, p]) => p.kind === 'label').map(([k]) => [k, `Custom ${k}`]));
      expect(check(tpl.build(labels))).toEqual([]);
    });
  }
});

// ---- catalogue paths and net classification ---------------------------------------------------------
describe('internal paths', () => {
  it('only name real terminals', () => {
    for (const [type, paths] of Object.entries(INTERNAL_PATHS))
      for (const p of paths) {
        const names = CATALOGUE[type as keyof typeof CATALOGUE].terminals.map((x) => x.name);
        expect(names).toContain(p.from);
        expect(names).toContain(p.to);
      }
  });
  it('match the spec', () => {
    const flat = Object.entries(INTERNAL_PATHS).flatMap(([type, ps]) => ps.map((p) => `${type}:${p.from}>${p.to}:${p.kind}`));
    expect(flat).toEqual([
      'switch_sp:t1>t2:switched',
      'switch_3way:common>traveler_a:switched',
      'switch_3way:common>traveler_b:switched',
      'gfci:line_hot>load_hot:protected',
      'gfci:line_neutral>load_neutral:protected',
    ]);
  });
});

describe('net classification', () => {
  const roleOf = (m: CircuitModel, device: string, terminal: string): NetRole | undefined =>
    analyzeNets(m).netOfTerminal(device, terminal)?.role;
  const expectRoles = (m: CircuitModel, table: Record<string, NetRole>) => {
    for (const [k, role] of Object.entries(table)) {
      const [d, term] = k.split('.') as [string, string];
      expect(roleOf(m, d, term), k).toBe(role);
    }
  };
  it('c1', () =>
    expectRoles(c1, {
      'breaker.out': 'source_hot',
      'nbar.neutral_bar': 'neutral',
      'gbar.ground_bar': 'ground',
      'sw.t1': 'source_hot',
      'sw.t2': 'switched_hot',
      'sw.ground': 'ground',
      'fix.hot': 'switched_hot',
      'fix.neutral': 'neutral',
      'fix.ground': 'ground',
    }));
  it('c2', () =>
    expectRoles(c2, {
      'sw1.common': 'source_hot',
      'sw1.traveler_a': 'traveler',
      'sw1.traveler_b': 'traveler',
      'sw2.traveler_a': 'traveler',
      'sw2.traveler_b': 'traveler',
      'sw2.common': 'switched_hot',
      'fix.hot': 'switched_hot',
      'fix.neutral': 'neutral',
      'sw1.ground': 'ground',
      'sw2.ground': 'ground',
    }));
  it('c3', () =>
    expectRoles(c3, {
      'gfci.line_hot': 'source_hot',
      'gfci.line_neutral': 'neutral',
      'gfci.load_hot': 'protected_hot',
      'gfci.load_neutral': 'protected_neutral',
      'rec.brass': 'protected_hot',
      'rec.silver': 'protected_neutral',
      'rec.ground': 'ground',
      'gfci.ground': 'ground',
    }));
  it('c4', () =>
    expectRoles(c4, {
      'swa.t1': 'source_hot',
      'swb.t1': 'source_hot',
      'swa.t2': 'switched_hot',
      'swb.t2': 'switched_hot',
      'fixa.hot': 'switched_hot',
      'fixb.hot': 'switched_hot',
      'fixa.neutral': 'neutral',
      'fixb.neutral': 'neutral',
    }));
  it('fixtures have no floating nets and every connection has a net', () => {
    for (const m of FIXTURES) {
      const a = analyzeNets(m);
      expect(a.nets.some((x) => x.role === 'floating')).toBe(false);
      for (const conn of m.connections) expect(a.netOfConnection(conn.id)).toBeDefined();
    }
  });
  it('a switch not fed leaves its far side floating', () => {
    const m = clone(c4);
    drop(m, s('hot'), t('swa', 't1'));
    expect(roleOf(m, 'swa', 't2')).toBe('floating');
    expect(roleOf(m, 'swb', 't2')).toBe('switched_hot');
  });
  it('a GFCI whose line is not fed does not protect its load side', () => {
    const m = clone(c3);
    // swap line and load at the GFCI
    move(m, c('feed', 'black', 'gfcibox'), t('gfci', 'line_hot'), t('gfci', 'line_hot'), t('gfci', 'load_hot'));
    move(m, c('ds', 'black', 'gfcibox'), t('gfci', 'load_hot'), t('gfci', 'load_hot'), t('gfci', 'line_hot'));
    expect(roleOf(m, 'gfci', 'load_hot')).toBe('source_hot');
    expect(roleOf(m, 'rec', 'brass')).toBe('floating');
  });
});

// ---- seeded-bad circuits ----------------------------------------------------------------------------
describe('ground-continuity', () => {
  it('drop the switch ground pigtail (c1)', () => {
    const m = clone(c1);
    drop(m, s('gn'), t('sw', 'ground'));
    expectFindings(check(m), [{ rule: 'ground-continuity', severity: 'error', involved: ['sw'], count: 1 }]);
  });
  it('drop one switch ground pigtail (c4)', () => {
    const m = clone(c4);
    drop(m, s('gr'), t('swb', 'ground'));
    expectFindings(check(m), [{ rule: 'ground-continuity', severity: 'error', involved: ['swb'], count: 1 }]);
  });
  it('drop the GFCI ground pigtail (c3)', () => {
    const m = clone(c3);
    drop(m, s('g'), t('gfci', 'ground'));
    expectFindings(check(m), [{ rule: 'ground-continuity', severity: 'error', involved: ['gfci'], count: 1 }]);
  });
  it('a cable bare conductor that ends on the neutral instead of ground', () => {
    const m = clone(c1);
    // bare conductor of the load cable lands on the neutral splice instead of the ground splice
    move(m, c('load', 'bare', 'swbox'), s('gn'), s('gn'), s('wn'));
    const f = check(m);
    expectFindings(f, [
      { rule: 'ground-continuity', severity: 'error', involved: ['load'] },
      { rule: 'ground-conductors-only', severity: 'error', involved: ['load'] },
    ]);
    // the light ground (via the same conductor) is also cut off from the ground bar
    expect(f.filter((x) => x.ruleId === 'ground-continuity').flatMap((x) => x.involved)).toContain('fix');
  });
});

describe('ground-conductors-only', () => {
  it('a black wire on the ground splice (c1)', () => {
    const m = clone(c1);
    const w = find(m, s('gn'), t('sw', 'ground'));
    w.color = 'black';
    expectFindings(check(m), [{ rule: 'ground-conductors-only', severity: 'error', involved: [w.id], count: 1 }]);
  });
  it('a green wire on the neutral (c3)', () => {
    const m = clone(c3);
    const w = find(m, c('feed', 'white', 'gfcibox'), t('gfci', 'line_neutral'));
    w.color = 'green';
    expectFindings(check(m), [{ rule: 'ground-conductors-only', severity: 'error', involved: [w.id], count: 1 }]);
  });
  it('a bare wire on the hot (c4)', () => {
    const m = clone(c4);
    const w = find(m, s('hot'), t('swa', 't1'));
    w.color = 'bare';
    expectFindings(check(m), [{ rule: 'ground-conductors-only', severity: 'error', involved: [w.id], count: 1 }]);
  });
});

describe('no-short', () => {
  it('breaker output joined to the neutral bar (c1)', () => {
    const m = clone(c1);
    m.splices.push({ id: 'x', box: 'panel' });
    move(m, c('feed', 'black', 'panel'), t('breaker', 'out'), t('breaker', 'out'), s('x'));
    add(m, s('x'), t('breaker', 'out'), 'black');
    add(m, s('x'), t('nbar', 'neutral_bar'), 'black');
    const f = check(m);
    expectFindings(f, [
      { rule: 'no-short', severity: 'error', involved: ['breaker', 'nbar'], count: 1 },
      { rule: 'neutral-not-switched', severity: 'error', involved: ['sw'] },
      { rule: 'wire-colour-role', severity: 'error', involved: ['feed'] },
    ]);
  });
  it('ground bar joined to the neutral bar (c3)', () => {
    const m = clone(c3);
    m.splices.push({ id: 'x', box: 'panel' });
    move(m, c('feed', 'white', 'panel'), t('nbar', 'neutral_bar'), t('nbar', 'neutral_bar'), s('x'));
    add(m, s('x'), t('nbar', 'neutral_bar'), 'white');
    add(m, s('x'), t('gbar', 'ground_bar'), 'white');
    const f = check(m);
    expect(f.filter((x) => x.ruleId === 'no-short')).toHaveLength(1);
    expect(f.find((x) => x.ruleId === 'no-short')!.involved.sort()).toEqual(['gbar', 'nbar']);
    expect(f.find((x) => x.ruleId === 'no-short')!.severity).toBe('error');
  });
  it('switch joins the hot to the neutral (c1)', () => {
    const m = clone(c1);
    // the switch output goes to the neutral splice while the load cable black is also on it
    move(m, c('load', 'black', 'swbox'), t('sw', 't2'), t('sw', 't2'), s('wn'));
    add(m, t('sw', 't2'), s('wn'), 'black');
    const f = check(m);
    const shorts = f.filter((x) => x.ruleId === 'no-short');
    expect(shorts).toHaveLength(1);
    expect(shorts[0]!.involved).toEqual(['sw']);
    expect(shorts[0]!.severity).toBe('error');
    expect(f.some((x) => x.ruleId === 'neutral-not-switched')).toBe(true);
  });
});

describe('neutral-continuity', () => {
  it('swap receptacle brass and silver (c3)', () => {
    const m = clone(c3);
    move(m, c('ds', 'black', 'rbox'), t('rec', 'brass'), t('rec', 'brass'), t('rec', 'silver'));
    move(m, c('ds', 'white', 'rbox'), t('rec', 'silver'), t('rec', 'silver'), t('rec', 'brass'));
    expectFindings(check(m), [
      { rule: 'neutral-continuity', severity: 'error', involved: ['rec'], count: 1 },
      { rule: 'load-fed', severity: 'error', involved: ['rec'], count: 1 },
    ]);
  });
  it('swap light hot and neutral (c1)', () => {
    const m = clone(c1);
    move(m, c('load', 'black', 'lightbox'), t('fix', 'hot'), t('fix', 'hot'), t('fix', 'neutral'));
    move(m, c('load', 'white', 'lightbox'), t('fix', 'neutral'), t('fix', 'neutral'), t('fix', 'hot'));
    expectFindings(check(m), [
      { rule: 'neutral-continuity', severity: 'error', involved: ['fix'], count: 1 },
      { rule: 'load-fed', severity: 'error', involved: ['fix'], count: 1 },
    ]);
  });
  it('light neutral landed on the ground (c1)', () => {
    const m = clone(c1);
    // neutral and ground conductors swapped at the light
    move(m, c('load', 'white', 'lightbox'), t('fix', 'neutral'), t('fix', 'neutral'), t('fix', 'ground'));
    move(m, c('load', 'bare', 'lightbox'), t('fix', 'ground'), t('fix', 'ground'), t('fix', 'neutral'));
    const f = check(m);
    expectFindings(f, [
      { rule: 'neutral-continuity', severity: 'error', involved: ['fix'], count: 1 },
      { rule: 'ground-continuity', severity: 'error', involved: ['fix'], count: 1 },
    ]);
  });
});

describe('neutral-not-switched', () => {
  it('switch put in the neutral (c1)', () => {
    const m = clone(c1);
    m.splices = m.splices.filter((x) => x.id !== 'wn');
    m.splices.push({ id: 'h', box: 'swbox' });
    drop(m, c('feed', 'white', 'swbox'), s('wn'));
    drop(m, c('load', 'white', 'swbox'), s('wn'));
    // neutrals now run through the switch; the hots are spliced together instead
    const w1 = find(m, c('feed', 'black', 'swbox'), t('sw', 't1'));
    w1.a = c('feed', 'white', 'swbox');
    w1.color = 'white';
    const w2 = find(m, c('load', 'black', 'swbox'), t('sw', 't2'));
    w2.a = c('load', 'white', 'swbox');
    w2.color = 'white';
    add(m, c('feed', 'black', 'swbox'), s('h'), 'black');
    add(m, c('load', 'black', 'swbox'), s('h'), 'black');
    expectFindings(check(m), [
      { rule: 'neutral-not-switched', severity: 'error', involved: ['sw'], count: 1 },
      { rule: 'neutral-continuity', severity: 'error', involved: ['fix'], count: 1 },
      { rule: 'floating-conductors', severity: 'warning', involved: ['sw', 'fix'], count: 1 },
    ]);
  });
  it('switch input taken from the neutral splice (c4)', () => {
    const m = clone(c4);
    const w = find(m, s('hot'), t('swa', 't1'));
    w.a = s('wh');
    w.color = 'white';
    expectFindings(check(m), [
      { rule: 'neutral-not-switched', severity: 'error', involved: ['swa'], count: 1 },
      { rule: 'load-fed', severity: 'error', involved: ['fixa'], count: 1 },
      { rule: 'floating-conductors', severity: 'warning', involved: ['swa', 'fixa'], count: 1 },
    ]);
  });
});

describe('load-fed', () => {
  it('switch input disconnected (c4)', () => {
    const m = clone(c4);
    drop(m, s('hot'), t('swa', 't1'));
    expectFindings(check(m), [
      { rule: 'load-fed', severity: 'error', involved: ['fixa'], count: 1 },
      { rule: 'floating-conductors', severity: 'warning', involved: ['swa', 'fixa'], count: 1 },
    ]);
  });
  it('other switch input disconnected (c4)', () => {
    const m = clone(c4);
    drop(m, s('hot'), t('swb', 't1'));
    expectFindings(check(m), [
      { rule: 'load-fed', severity: 'error', involved: ['fixb'], count: 1 },
      { rule: 'floating-conductors', severity: 'warning', involved: ['swb', 'fixb'], count: 1 },
    ]);
  });
  it('light hot wired to the neutral conductor (c1)', () => {
    const m = clone(c1);
    // hot and neutral landed on each other's terminals at the light, hot also unfed from the neutral side
    move(m, c('load', 'black', 'lightbox'), t('fix', 'hot'), t('fix', 'hot'), t('fix', 'neutral'));
    move(m, c('load', 'white', 'lightbox'), t('fix', 'neutral'), t('fix', 'neutral'), t('fix', 'hot'));
    const f = check(m);
    const lf = f.find((x) => x.ruleId === 'load-fed')!;
    expect(lf.involved).toEqual(['fix']);
    expect(lf.message).toContain('neutral');
  });
  it('receptacle behind a GFCI whose line is unfed (c3 crossed)', () => {
    const m = clone(c3);
    move(m, c('feed', 'black', 'gfcibox'), t('gfci', 'line_hot'), t('gfci', 'line_hot'), t('gfci', 'load_hot'));
    move(m, c('ds', 'black', 'gfcibox'), t('gfci', 'load_hot'), t('gfci', 'load_hot'), t('gfci', 'line_hot'));
    const f = check(m);
    expect(f.some((x) => x.ruleId === 'load-fed' && x.involved.includes('rec') && x.severity === 'error')).toBe(true);
  });
});

describe('three-way-pairing', () => {
  it('common and traveler swapped at the second switch (c2)', () => {
    const m = clone(c2);
    move(m, c('trav', 'red', 'box2'), t('sw2', 'traveler_a'), t('sw2', 'traveler_a'), t('sw2', 'common'));
    move(m, c('load', 'black', 'box2'), t('sw2', 'common'), t('sw2', 'common'), t('sw2', 'traveler_a'));
    expectFindings(check(m), [
      { rule: 'three-way-pairing', severity: 'error', involved: ['sw1'], count: 2 },
      { rule: 'load-fed', severity: 'error', involved: ['fix'], count: 1 },
    ]);
  });
  it('feed on a traveler, traveler on the common (c2)', () => {
    const m = clone(c2);
    move(m, c('feed', 'black', 'box1'), t('sw1', 'common'), t('sw1', 'common'), t('sw1', 'traveler_a'));
    move(m, c('trav', 'red', 'box1'), t('sw1', 'traveler_a'), t('sw1', 'traveler_a'), t('sw1', 'common'));
    expectFindings(check(m), [{ rule: 'three-way-pairing', severity: 'error', involved: ['sw1', 'sw2'], count: 2 }]);
  });
  it('travelers wired crossed is still valid (c2)', () => {
    const m = clone(c2);
    move(m, c('trav', 'red', 'box2'), t('sw2', 'traveler_a'), t('sw2', 'traveler_a'), t('sw2', 'traveler_b'));
    move(m, c('trav', 'black', 'box2'), t('sw2', 'traveler_b'), t('sw2', 'traveler_b'), t('sw2', 'traveler_a'));
    expect(check(m)).toEqual([]);
  });
  // two 3-way switches in one box: exercises the common-terminal checks
  function pair(mutate?: (b: Builder) => void): CircuitModel {
    const b = new Builder('pair', 'two 3-ways in one box');
    b.panel(15, 'feed');
    b.box('gang', 'Gang box');
    b.device('sw1', 'gang', 'switch_3way', 'SW1');
    b.device('sw2', 'gang', 'switch_3way', 'SW2');
    b.cable('feed', '14/2', 'panel', 'gang', 'feed');
    b.cable('load', '14/2', 'gang', 'lightbox', 'load');
    for (const sp of ['ta', 'tb', 'wh', 'gr']) b.splice(sp, 'gang');
    b.wire(C('feed', 'black', 'gang'), T('sw1', 'common'), 'black');
    b.wire(T('sw1', 'traveler_a'), S('ta'), 'red');
    b.wire(T('sw2', 'traveler_a'), S('ta'), 'red');
    b.wire(T('sw1', 'traveler_b'), S('tb'), 'black');
    b.wire(T('sw2', 'traveler_b'), S('tb'), 'black');
    b.wire(C('load', 'black', 'gang'), T('sw2', 'common'), 'black');
    b.wire(C('feed', 'white', 'gang'), S('wh'), 'white');
    b.wire(C('load', 'white', 'gang'), S('wh'), 'white');
    b.wire(C('feed', 'bare', 'gang'), S('gr'), 'bare');
    b.wire(C('load', 'bare', 'gang'), S('gr'), 'bare');
    b.wire(S('gr'), T('sw1', 'ground'), 'green');
    b.wire(S('gr'), T('sw2', 'ground'), 'green');
    b.lightBox('lightbox', 'Light box', 'load', 'fix', 'Light');
    mutate?.(b);
    return b.build();
  }
  it('the one-box pair is itself clean', () => {
    expect(check(pair())).toEqual([]);
  });
  it('both commons fed from the breaker', () => {
    const m = pair();
    m.splices.push({ id: 'h', box: 'gang' });
    move(m, c('feed', 'black', 'gang'), t('sw1', 'common'), t('sw1', 'common'), s('h'));
    add(m, s('h'), t('sw1', 'common'), 'black');
    add(m, s('h'), t('sw2', 'common'), 'black');
    // the feed, both commons and the load conductor are all spliced together
    move(m, c('load', 'black', 'gang'), t('sw2', 'common'), t('sw2', 'common'), s('h'));
    expectFindings(check(m), [{ rule: 'three-way-pairing', severity: 'error', involved: ['sw1', 'sw2'], count: 1 }]);
  });
  it('a common left unconnected', () => {
    const m = pair();
    m.splices.push({ id: 'h', box: 'gang' });
    move(m, c('feed', 'black', 'gang'), t('sw1', 'common'), t('sw1', 'common'), s('h'));
    add(m, s('h'), t('sw1', 'common'), 'black');
    move(m, c('load', 'black', 'gang'), t('sw2', 'common'), t('sw2', 'common'), s('h'));
    expectFindings(check(m), [{ rule: 'three-way-pairing', severity: 'error', involved: ['sw1', 'sw2'], count: 1 }]);
  });
  it('the unfed common leads only to the light neutral terminal (c2)', () => {
    const m = clone(c2);
    move(m, c('load', 'black', 'lightbox'), t('fix', 'hot'), t('fix', 'hot'), t('fix', 'neutral'));
    move(m, c('load', 'white', 'lightbox'), t('fix', 'neutral'), t('fix', 'neutral'), t('fix', 'hot'));
    expectFindings(check(m), [
      { rule: 'three-way-pairing', severity: 'error', involved: ['sw1', 'sw2'], count: 1 },
      { rule: 'load-fed', severity: 'error', involved: ['fix'], count: 1 },
      { rule: 'neutral-continuity', severity: 'error', involved: ['fix'], count: 1 },
    ]);
  });
});


describe('gfci-orientation', () => {
  it('line and load crossed (c3)', () => {
    const m = clone(c3);
    move(m, c('feed', 'black', 'gfcibox'), t('gfci', 'line_hot'), t('gfci', 'line_hot'), t('gfci', 'load_hot'));
    move(m, c('ds', 'black', 'gfcibox'), t('gfci', 'load_hot'), t('gfci', 'load_hot'), t('gfci', 'line_hot'));
    move(m, c('feed', 'white', 'gfcibox'), t('gfci', 'line_neutral'), t('gfci', 'line_neutral'), t('gfci', 'load_neutral'));
    move(m, c('ds', 'white', 'gfcibox'), t('gfci', 'load_neutral'), t('gfci', 'load_neutral'), t('gfci', 'line_neutral'));
    const f = check(m);
    expectFindings(f, [
      { rule: 'gfci-orientation', severity: 'error', involved: ['gfci'], count: 4 },
      { rule: 'load-fed', severity: 'error', involved: ['rec'], count: 1 },
      { rule: 'neutral-continuity', severity: 'error', involved: ['gfci'], count: 2 },
      { rule: 'floating-conductors', severity: 'warning', involved: ['gfci', 'rec'], count: 2 },
    ]);
  });
  it('only LOAD neutral used, hot fed straight to LINE (c3)', () => {
    const m = clone(c3);
    m.splices.push({ id: 'hh', box: 'gfcibox' });
    move(m, c('feed', 'black', 'gfcibox'), t('gfci', 'line_hot'), t('gfci', 'line_hot'), s('hh'));
    move(m, c('ds', 'black', 'gfcibox'), t('gfci', 'load_hot'), t('gfci', 'load_hot'), s('hh'));
    add(m, s('hh'), t('gfci', 'line_hot'), 'black');
    expectFindings(check(m), [{ rule: 'gfci-orientation', severity: 'error', involved: ['gfci'], count: 1 }]);
  });
  it('only LOAD hot used (c3)', () => {
    const m = clone(c3);
    m.splices.push({ id: 'nn', box: 'gfcibox' });
    move(m, c('feed', 'white', 'gfcibox'), t('gfci', 'line_neutral'), t('gfci', 'line_neutral'), s('nn'));
    move(m, c('ds', 'white', 'gfcibox'), t('gfci', 'load_neutral'), t('gfci', 'load_neutral'), s('nn'));
    add(m, s('nn'), t('gfci', 'line_neutral'), 'white');
    expectFindings(check(m), [{ rule: 'gfci-orientation', severity: 'error', involved: ['gfci'], count: 1 }]);
  });
  it('LOAD hot tied back to the feed hot (c3)', () => {
    const m = clone(c3);
    m.splices.push({ id: 'hh', box: 'gfcibox' });
    move(m, c('feed', 'black', 'gfcibox'), t('gfci', 'line_hot'), t('gfci', 'line_hot'), s('hh'));
    move(m, c('ds', 'black', 'gfcibox'), t('gfci', 'load_hot'), t('gfci', 'load_hot'), s('hh'));
    add(m, s('hh'), t('gfci', 'line_hot'), 'black');
    add(m, s('hh'), t('gfci', 'load_hot'), 'black');
    expectFindings(check(m), [{ rule: 'gfci-orientation', severity: 'error', involved: ['gfci'], count: 1 }]);
  });
  it('a GFCI at the end of the run with LOAD unused is fine', () => {
    // downstream cable removed: template c3 reduced to GFCI alone
    const b = new Builder('end', 'GFCI alone');
    b.panel(20, 'feed');
    b.box('gb', 'GFCI box');
    b.device('gfci', 'gb', 'gfci', 'GFCI');
    b.cable('feed', '12/2', 'panel', 'gb', 'feed');
    b.splice('g', 'gb');
    b.wire(C('feed', 'black', 'gb'), T('gfci', 'line_hot'), 'black');
    b.wire(C('feed', 'white', 'gb'), T('gfci', 'line_neutral'), 'white');
    b.wire(C('feed', 'bare', 'gb'), S('g'), 'bare');
    b.wire(S('g'), T('gfci', 'ground'), 'green');
    expect(check(b.build())).toEqual([]);
  });
});

describe('breaker-conductor-match', () => {
  const breaker = (m: CircuitModel, amps: number) => (m.devices.find((d) => d.type === 'breaker')!.amps = amps);
  it('20 A on 14 AWG (c1)', () => {
    const m = clone(c1);
    breaker(m, 20);
    expectFindings(check(m), [{ rule: 'breaker-conductor-match', severity: 'error', involved: ['breaker', 'feed', 'load'], count: 1 }]);
  });
  it('30 A on 12 AWG (c3)', () => {
    const m = clone(c3);
    breaker(m, 30);
    expectFindings(check(m), [{ rule: 'breaker-conductor-match', severity: 'error', involved: ['breaker', 'feed', 'ds'], count: 1 }]);
  });
  it('20 A with one 14 AWG cable in a 12 AWG run (c3)', () => {
    const m = clone(c3);
    m.cables.find((x) => x.id === 'ds')!.type = '14/2';
    expectFindings(check(m), [{ rule: 'breaker-conductor-match', severity: 'error', involved: ['breaker', 'ds'], count: 1 }]);
  });
  it('unknown rating is reported (17 A on 14 AWG gives two findings)', () => {
    const m = clone(c1);
    breaker(m, 17);
    expectFindings(check(m), [{ rule: 'breaker-conductor-match', severity: 'error', involved: ['breaker'], count: 2 }]);
  });
  it('15 A on 12 AWG and 30 A on 10 AWG are within the limit', () => {
    const a = clone(c3);
    breaker(a, 15);
    expect(check(a)).toEqual([]);
    const b = clone(c3);
    for (const k of b.cables) k.type = '10/2';
    breaker(b, 30);
    expect(check(b)).toEqual([]);
  });
});

describe('wire-colour-role', () => {
  it('black pigtail on the neutral splice (c1)', () => {
    const m = clone(c1);
    const w = find(m, c('load', 'white', 'swbox'), s('wn'));
    w.color = 'black';
    expectFindings(check(m), [{ rule: 'wire-colour-role', severity: 'error', involved: [w.id, 'load'], count: 1 }]);
  });
  it('red wire on the GFCI neutral (c3)', () => {
    const m = clone(c3);
    const w = find(m, c('feed', 'white', 'gfcibox'), t('gfci', 'line_neutral'));
    w.color = 'red';
    expectFindings(check(m), [{ rule: 'wire-colour-role', severity: 'error', involved: [w.id, 'feed'], count: 1 }]);
  });
  it('white pigtail used as the switch hot (c4) is a warning', () => {
    const m = clone(c4);
    const w = find(m, s('hot'), t('swb', 't1'));
    w.color = 'white';
    expectFindings(check(m), [{ rule: 'wire-colour-role', severity: 'warning', involved: [w.id], count: 1 }]);
  });
  it('white wire on a traveler (c2) is a warning', () => {
    const m = clone(c2);
    const w = find(m, c('trav', 'black', 'box1'), t('sw1', 'traveler_b'));
    w.color = 'white';
    expectFindings(check(m), [{ rule: 'wire-colour-role', severity: 'warning', involved: [w.id], count: 1 }]);
  });
});

/** Power arrives at the light first; a 2-wire loop goes to the switch with its white re-identified as hot. */
function switchLoop(amps: 15 | 20): CircuitModel {
  const b = new Builder('loop', 'switch loop');
  const two = cableTypeFor(amps, 2);
  b.panel(amps, 'feed');
  b.box('lightbox', 'Light box');
  b.box('swbox', 'Switch box');
  b.device('fix', 'lightbox', 'light', 'Light');
  b.device('sw', 'swbox', 'switch_sp', 'Switch');
  b.cable('feed', two, 'panel', 'lightbox', 'feed');
  b.cable('loop', two, 'lightbox', 'swbox', 'loop');
  b.splice('h', 'lightbox');
  b.splice('n', 'lightbox');
  b.splice('g', 'lightbox');
  b.wire(C('feed', 'black', 'lightbox'), S('h'), 'black');
  b.wire(C('loop', 'white', 'lightbox'), S('h'), 'white');
  b.wire(C('loop', 'black', 'lightbox'), T('fix', 'hot'), 'black');
  b.wire(C('feed', 'white', 'lightbox'), S('n'), 'white');
  b.wire(T('fix', 'neutral'), S('n'), 'white');
  b.wire(C('feed', 'bare', 'lightbox'), S('g'), 'bare');
  b.wire(C('loop', 'bare', 'lightbox'), S('g'), 'bare');
  b.wire(T('fix', 'ground'), S('g'), 'green');
  b.wire(C('loop', 'white', 'swbox'), T('sw', 't1'), 'white');
  b.wire(C('loop', 'black', 'swbox'), T('sw', 't2'), 'black');
  b.wire(C('loop', 'bare', 'swbox'), T('sw', 'ground'), 'bare');
  return b.build();
}

describe('neutral-at-switch-box', () => {
  it.each([15, 20] as const)('switch loop at %i A has no neutral in the switch box', (amps) => {
    const f = check(switchLoop(amps));
    expectFindings(f, [
      { rule: 'neutral-at-switch-box', severity: 'warning', involved: ['swbox', 'sw'], count: 1 },
      { rule: 'wire-colour-role', severity: 'warning', involved: ['loop'], count: 2 },
    ]);
  });
  it('a switch box with a neutral through the feed is fine (c1)', () => {
    expect(check(c1).some((x) => x.ruleId === 'neutral-at-switch-box')).toBe(false);
  });
});

describe('floating-conductors', () => {
  it('disconnected switch input (c4, swa)', () => {
    const m = clone(c4);
    drop(m, s('hot'), t('swa', 't1'));
    const fl = check(m).filter((x) => x.ruleId === 'floating-conductors');
    expect(fl).toHaveLength(1);
    expect(fl[0]!.severity).toBe('warning');
    expect(fl[0]!.involved).toEqual(['swa', 'fixa']);
  });
  it('disconnected switch input (c4, swb)', () => {
    const m = clone(c4);
    drop(m, s('hot'), t('swb', 't1'));
    const fl = check(m).filter((x) => x.ruleId === 'floating-conductors');
    expect(fl).toHaveLength(1);
    expect(fl[0]!.severity).toBe('warning');
    expect(fl[0]!.involved).toEqual(['swb', 'fixb']);
  });
});

describe('engine', () => {
  it('two breakers: a single cannot-evaluate finding', () => {
    const m = clone(c1);
    m.devices.push({ id: 'b2', box: 'panel', type: 'breaker', label: '15A breaker', amps: 15 });
    const f = check(m);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ ruleId: 'model-assumptions', severity: 'error' });
    expect(f[0]!.involved).toContain('b2');
  });
  it('a panel device outside a panel box: a single cannot-evaluate finding', () => {
    const m = clone(c1);
    m.boxes.find((b) => b.id === 'panel')!.kind = 'box';
    const f = check(m);
    expect(f.map((x) => x.ruleId)).toEqual(['model-assumptions']);
  });
  it('two neutral bars: a single cannot-evaluate finding', () => {
    const m = clone(c1);
    m.devices.push({ id: 'n2', box: 'panel', type: 'neutral_bar', label: 'Neutral bar 2' });
    expect(check(m).map((x) => x.ruleId)).toEqual(['model-assumptions']);
  });
  it('structurally invalid circuit: a single refusal finding', () => {
    const m = clone(c1);
    m.connections[0]!.a = t('nope', 'out');
    const f = check(m);
    expect(f.map((x) => x.ruleId)).toEqual(['circuit-valid']);
    expect(f[0]!.severity).toBe('error');
    expect(check({ nonsense: true } as unknown as CircuitModel).map((x) => x.ruleId)).toEqual(['circuit-valid']);
  });
  it('rejects an unknown edition', () => {
    expect(() => checkCircuit(c1, { edition: 'nec-2020' as 'nec-2023' })).toThrow();
  });
  it('is deterministic and ordered by registry, then model order', () => {
    const m = clone(c1);
    drop(m, s('gn'), t('sw', 'ground'));
    m.devices.find((d) => d.type === 'breaker')!.amps = 20;
    m.connections.find((x) => x.id === id(c1, s('wn'), c('load', 'white', 'swbox')))!.color = 'black';
    const a = check(m);
    expect(check(clone(m))).toEqual(a);
    const order = RULES.map((r) => r.id);
    const idx = a.map((x) => order.indexOf(x.ruleId));
    expect(idx).toEqual([...idx].sort((x, y) => x - y));
    expect(new Set(a.map((x) => x.ruleId)).size).toBeGreaterThanOrEqual(3);
  });
});

describe('registry and citations', () => {
  const LISTED = [
    '250.4(A)(5)', '250.148', '404.9(B)', '406.4(A)', '250.119', '200.6', '200.7(C)', '404.2(B)', '404.2(A)', '404.2(C)', '240.4(D)', '110.3(B)',
  ];
  it('lists every Batch A rule with unique ids', () => {
    const ids = RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of [
      'ground-continuity', 'ground-conductors-only', 'no-short', 'neutral-continuity', 'neutral-not-switched', 'load-fed',
      'three-way-pairing', 'gfci-orientation', 'breaker-conductor-match', 'wire-colour-role', 'neutral-at-switch-box', 'floating-conductors',
    ])
      expect(ids).toContain(id);
  });
  it('every citation is unconfirmed NEC 2023 and uses only the listed sections', () => {
    for (const r of RULES) {
      expect(r.citation.edition).toBe('nec-2023');
      expect(r.citation.confirmed).toBe(false);
      if (r.citation.section !== null)
        for (const sec of r.citation.section.split(' / ')) expect(LISTED).toContain(sec);
    }
    const used = new Set(RULES.flatMap((r) => r.citation.section?.split(' / ') ?? []));
    expect([...used].sort()).toEqual([...LISTED].sort());
  });
  it('every finding carries its rule citation', () => {
    const m = clone(c1);
    drop(m, s('gn'), t('sw', 'ground'));
    for (const f of check(m)) expect(f.citation).toEqual(RULES.find((r) => r.id === f.ruleId)!.citation);
  });
  it('the checklist document matches the registry', () => {
    expect(checklist).toBe(citationChecklistMarkdown());
    expect(checklist.split('\n').filter((l) => l.startsWith('| `')).every((l) => l.endsWith('| no |'))).toBe(true);
  });
});
