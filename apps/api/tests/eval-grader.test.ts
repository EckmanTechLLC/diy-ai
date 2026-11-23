import { describe, expect, it } from 'vitest';
import { checkCircuit, resolveReply, validateCircuit, type CircuitModel } from '@diy-ai/core';
import { FIXTURES } from '@diy-ai/core/fixtures';
import { buildContextNote, type ChatOutcome } from '../src/chat/loop';
import { CASES, type Expect } from '../evals/cases';
import { checkFact, gradeOutcome } from '../evals/grader';
import { seedContext } from '../evals/seed';

const unused = { target: 'none', breakerAmps: 0, name: '', blocks: [] as unknown[], custom: [] as unknown[] };
/** A flat block entry as the model writes it: every key present, unused ones 0 / false / "". */
const entry = (type: string, over: Record<string, unknown> = {}) => ({
  type,
  count: 0,
  countA: 0,
  countB: 0,
  gfciFirst: false,
  receptacleLabel: '', gfciLabel: '', boxLabel: '', switchLabel: '', switchBoxLabel: '', lightLabel: '', lightBoxLabel: '', fanLabel: '', fanBoxLabel: '', gangBoxLabel: '',
  ...over,
});
/** Outcome of a circuit reply made of the given block entries. */
const blk = (blocks: Record<string, unknown>[], breakerAmps = 15, target: 'new' | 'selected' = 'new'): ChatOutcome => {
  const reply = { ...unused, kind: 'circuit', target, message: 'm', breakerAmps, name: 'n', blocks: blocks.map((b) => entry(b.type as string, b)) };
  const res = resolveReply(reply);
  if (res.kind !== 'circuit') throw new Error(`bad test blocks: ${JSON.stringify(res)}`);
  return { kind: 'circuit', text: 'm', reply, circuit: res.circuit, origin: res.origin, target, findings: [] };
};
const sp = (amps = 15) => blk([{ type: 'switch_lights', count: 1 }], amps);
const question: ChatOutcome = { kind: 'question', text: 'which?', reply: {} };
const unsupported: ChatOutcome = { kind: 'unsupported', text: 'no', reply: {} };
const failed: ChatOutcome = { kind: 'failed', code: 'timeout', text: 'slow' };

/** Hand-written custom circuit: breaker -> cable -> one box with one duplex; ground and neutral wired. */
function receptacle(over: { amps?: number; hotToBrass?: boolean } = {}): CircuitModel {
  const { amps = 20, hotToBrass = true } = over;
  const t = (device: string, terminal: string) => ({ kind: 'terminal' as const, device, terminal });
  const c = (color: 'black' | 'white' | 'bare', box: string) => ({ kind: 'conductor' as const, cable: 'k', color, box });
  return {
    id: 'r',
    title: 'r',
    boxes: [
      { id: 'panel', label: 'Panel', kind: 'panel' },
      { id: 'b1', label: 'Box', kind: 'box' },
    ],
    devices: [
      { id: 'br', box: 'panel', type: 'breaker', label: 'B', amps },
      { id: 'nb', box: 'panel', type: 'neutral_bar', label: 'N' },
      { id: 'gb', box: 'panel', type: 'ground_bar', label: 'G' },
      { id: 'rc', box: 'b1', type: 'duplex', label: 'R' },
    ],
    cables: [{ id: 'k', name: 'k', type: '12/2', from: 'panel', to: 'b1' }],
    splices: [],
    connections: [
      { id: 'c1', a: t('br', 'out'), b: c('black', 'panel'), color: 'black' },
      { id: 'c2', a: t('nb', 'neutral_bar'), b: c('white', 'panel'), color: 'white' },
      { id: 'c3', a: t('gb', 'ground_bar'), b: c('bare', 'panel'), color: 'bare' },
      { id: 'c4', a: hotToBrass ? t('rc', 'brass') : t('rc', 'silver'), b: c('black', 'b1'), color: 'black' },
      { id: 'c5', a: hotToBrass ? t('rc', 'silver') : t('rc', 'brass'), b: c('white', 'b1'), color: 'white' },
      { id: 'c6', a: t('rc', 'ground'), b: c('bare', 'b1'), color: 'green' },
    ],
  };
}

const custom = (circuit: CircuitModel): ChatOutcome => ({
  kind: 'circuit',
  text: 'm',
  reply: {},
  circuit,
  origin: { kind: 'custom', verified: false },
  target: 'new',
  findings: [],
});

const byId = (id: string) => CASES.find((c) => c.id === id)!;

describe('test set shape', () => {
  it('has the v4 category counts, unique ids, rationales', () => {
    const count = (cat: string) => CASES.filter((c) => c.category === cat).length;
    expect(CASES.length).toBe(61);
    expect(count('blocks')).toBe(11);
    expect(count('multi-block')).toBe(6);
    expect(count('counts')).toBe(4);
    expect(count('target')).toBe(4);
    expect(count('question')).toBe(6);
    expect(count('multi-turn')).toBe(3);
    expect(count('unsupported')).toBe(4);
    expect(count('custom')).toBe(4);
    expect(count('trap')).toBe(1);
    expect(count('inventory')).toBe(6);
    expect(count('inventory-question')).toBe(3);
    expect(count('plan-edit')).toBe(4);
    expect(count('build')).toBe(3);
    expect(count('routing')).toBe(2);
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
    for (const c of CASES) {
      expect(c.rationale.length).toBeGreaterThan(10);
      expect(c.steps.length).toBeGreaterThan(0);
    }
    for (const c of CASES.filter((c) => c.category === 'multi-turn')) {
      expect(c.steps.length).toBeGreaterThanOrEqual(2);
      expect(c.steps[0]!.expect.kind).toBe('question');
    }
  });

  it('the three corrected cases keep their ids and expect block circuits', () => {
    expect(byId('custom-1').steps[0]!.expect).toMatchObject({ kind: 'blocks', breakerAmps: 20, blocks: [{ type: 'receptacle_run', count: 1, gfciFirst: false }] });
    expect(byId('custom-3').steps[0]!.expect).toMatchObject({ kind: 'blocks', breakerAmps: 20, blocks: [{ type: 'receptacle_run', count: 2, gfciFirst: false }] });
    expect(byId('trap-2').steps[0]!.expect).toMatchObject({ kind: 'blocks', blocks: [{ type: 'receptacle_run', count: 4, gfciFirst: true }] });
    for (const id of ['custom-1', 'custom-3', 'trap-2']) expect(byId(id).category).toBe('blocks');
  });

  it('target is graded only in seeded single-step target cases; seeds resolve', () => {
    for (const c of CASES) {
      const wantsTarget = c.steps.some((s) => s.expect.kind === 'blocks' && s.expect.target !== undefined);
      if (wantsTarget) expect(['target', 'build']).toContain(c.category);
      if (c.category === 'target') {
        expect(c.seed).toBeDefined();
        expect(c.steps.length).toBe(1);
      }
      if (c.seed) {
        expect(c.steps.length).toBe(1);
        const ctx = seedContext(c.seed);
        expect(ctx.circuits.length).toBe(c.seed.circuits.length);
        expect(ctx.circuits.every((x) => validateCircuit(x.circuit).length === 0 && x.origin?.kind === 'blocks')).toBe(true);
      }
    }
  });
});

describe('gradeOutcome', () => {
  it('question and unsupported', () => {
    expect(gradeOutcome({ kind: 'question' }, question).pass).toBe(true);
    expect(gradeOutcome({ kind: 'question' }, sp())).toMatchObject({ pass: false, pattern: 'guessed instead of asking' });
    expect(gradeOutcome({ kind: 'unsupported' }, unsupported).pass).toBe(true);
    expect(gradeOutcome({ kind: 'unsupported' }, question).pass).toBe(false);
  });

  it('provider/loop failures never pass', () => {
    for (const e of [{ kind: 'question' }, { kind: 'unsupported' }, { kind: 'not_blocks', forbidden: [{ type: 'x' }] }] as const)
      expect(gradeOutcome(e, failed)).toMatchObject({ pass: false, pattern: 'failed:timeout' });
  });

  it('block list, in order, and only the specified fields', () => {
    const e = byId('template-sp-1').steps[0]!.expect;
    expect(gradeOutcome(e, sp(20)).pass).toBe(true);
    expect(gradeOutcome(e, blk([{ type: 'switch_lights', count: 1, switchLabel: 'Wall switch' }], 20)).pass).toBe(true);
    expect(gradeOutcome(e, sp(15))).toMatchObject({ pass: false, pattern: 'wrong parameter' });
    expect(gradeOutcome(e, blk([{ type: 'switch_lights', count: 2 }], 20))).toMatchObject({ pass: false, pattern: 'wrong parameter' });
    expect(gradeOutcome(e, blk([{ type: 'three_way_lights', count: 1 }], 20))).toMatchObject({ pass: false, pattern: 'wrong blocks' });
    expect(gradeOutcome(e, blk([{ type: 'switch_lights', count: 1 }, { type: 'switch_fan' }], 20))).toMatchObject({ pass: false, pattern: 'wrong blocks' });
    expect(gradeOutcome(e, question)).toMatchObject({ pass: false, pattern: 'asked instead of choosing' });
    expect(gradeOutcome(e, unsupported)).toMatchObject({ pass: false, pattern: 'declined a supported job' });
    // no breaker size specified: any size passes
    expect(gradeOutcome({ kind: 'blocks', blocks: [{ type: 'switch_lights', count: 1 }] }, sp(20)).pass).toBe(true);
  });

  it('flags, counts of a 2-gang block and order are compared', () => {
    const gf = { kind: 'blocks', blocks: [{ type: 'receptacle_run', count: 2, gfciFirst: true }] } as const;
    expect(gradeOutcome(gf, blk([{ type: 'receptacle_run', count: 2, gfciFirst: true }])).pass).toBe(true);
    expect(gradeOutcome(gf, blk([{ type: 'receptacle_run', count: 2 }]))).toMatchObject({ pass: false, pattern: 'wrong parameter' });
    expect(gradeOutcome(gf, blk([{ type: 'receptacle_run', count: 3, gfciFirst: true }]))).toMatchObject({ pass: false, pattern: 'wrong parameter' });
    const tg = { kind: 'blocks', blocks: [{ type: 'two_gang_switches', countA: 1, countB: 1 }] } as const;
    expect(gradeOutcome(tg, blk([{ type: 'two_gang_switches', countA: 1, countB: 1 }])).pass).toBe(true);
    expect(gradeOutcome(tg, blk([{ type: 'two_gang_switches', countA: 1, countB: 2 }]))).toMatchObject({ pass: false, pattern: 'wrong parameter' });
    const two = { kind: 'blocks', blocks: [{ type: 'switch_fan' }, { type: 'receptacle_run', count: 2 }] } as const;
    expect(gradeOutcome(two, blk([{ type: 'switch_fan' }, { type: 'receptacle_run', count: 2 }])).pass).toBe(true);
    expect(gradeOutcome(two, blk([{ type: 'receptacle_run', count: 2 }, { type: 'switch_fan' }]))).toMatchObject({ pass: false, pattern: 'wrong blocks' });
  });

  it('trap: only exactly the forbidden block list fails', () => {
    const e = byId('trap-1').steps[0]!.expect;
    expect(gradeOutcome(e, sp())).toMatchObject({ pass: false, pattern: 'fell for trap' });
    expect(gradeOutcome(e, blk([{ type: 'switch_lights', count: 2 }])).pass).toBe(true);
    expect(gradeOutcome(e, blk([{ type: 'three_way_lights', count: 1 }])).pass).toBe(true);
    expect(gradeOutcome(e, question).pass).toBe(true);
    expect(gradeOutcome(e, unsupported).pass).toBe(true);
  });

  describe('custom', () => {
    /** A dedicated 20 A duplex: hot reaches brass, ground bonded, one breaker and one duplex, nothing else. */
    const e: Expect = {
      kind: 'custom',
      facts: [{ kind: 'connected', a: { type: 'breaker', terminal: 'out' }, b: { type: 'duplex', terminal: 'brass' } }, { kind: 'groundsBonded' }],
      deviceCounts: { breaker: 1, duplex: 1, gfci: 0, switch_sp: 0, switch_3way: 0, light: 0 },
      breakerAmps: 20,
    };
    it('passes a correct circuit, with or without rule warnings', () => {
      expect(gradeOutcome(e, custom(receptacle()))).toMatchObject({ pass: true });
      const warned = { ...custom(receptacle()), findings: [{ ruleId: 'floating-conductors', severity: 'warning', message: 'w', involved: [], citation: { rule: null } }] } as unknown as ChatOutcome;
      expect(gradeOutcome(e, warned)).toMatchObject({ pass: true });
    });
    it('fails blocks for a custom case', () => {
      expect(gradeOutcome(e, blk([{ type: 'receptacle_run', count: 1 }], 20))).toMatchObject({ pass: false, pattern: 'blocks instead of custom' });
    });
    it('fails an invalid circuit', () => {
      const c = receptacle();
      c.connections.pop();
      expect(gradeOutcome(e, custom(c))).toMatchObject({ pass: false, pattern: 'invalid circuit' });
    });
    it('fails wrong breaker size', () => {
      expect(gradeOutcome(e, custom(receptacle({ amps: 15 })))).toMatchObject({ pass: false, pattern: 'wrong breaker size' });
    });
    it('fails a structurally valid circuit that has a rule error, and names the rule', () => {
      const c = receptacle({ hotToBrass: false }); // hot on the silver terminal, neutral on brass
      expect(validateCircuit(c)).toEqual([]);
      expect(checkCircuit(c, { edition: 'nec-2023' }).some((f) => f.severity === 'error')).toBe(true);
      const g = gradeOutcome(e, custom(c));
      expect(g).toMatchObject({ pass: false, pattern: 'custom circuit failed rules' });
      expect(g.reason).toMatch(/wire-colour-role|load-fed|neutral-continuity/);
    });
    it('fails an unbonded device ground (rule error; the fact itself is also violated)', () => {
      const c = receptacle();
      // device ground rides the bare conductor, which is moved from the ground bar to the neutral bar: structurally valid, electrically wrong
      c.connections = c.connections.map((x) => (x.id === 'c3' ? { ...x, a: { kind: 'terminal' as const, device: 'nb', terminal: 'neutral_bar' } } : x));
      expect(validateCircuit(c)).toEqual([]);
      expect(checkFact(c, { kind: 'groundsBonded' })).not.toBeNull();
      expect(gradeOutcome(e, custom(c))).toMatchObject({ pass: false, pattern: 'custom circuit failed rules' });
    });
    it('fails a connectivity fact on a rule-clean circuit', () => {
      const wrongFact: Expect = { ...e, facts: [{ kind: 'connected', a: { type: 'breaker', terminal: 'out' }, b: { type: 'duplex', terminal: 'silver' } }] } as Expect;
      expect(gradeOutcome(wrongFact, custom(receptacle()))).toMatchObject({ pass: false, pattern: 'connectivity fact violated' });
    });
    it('fails a wrong device count', () => {
      const two: Expect = { ...e, deviceCounts: { duplex: 2 } } as Expect;
      expect(gradeOutcome(two, custom(receptacle()))).toMatchObject({ pass: false, pattern: 'wrong device count' });
    });
    it('a custom reply is not accepted by a blocks case, and a question is not accepted by a custom case', () => {
      expect(gradeOutcome(byId('mb-2').steps[0]!.expect, custom(receptacle()))).toMatchObject({ pass: false, pattern: 'custom instead of blocks' });
      expect(gradeOutcome(e, question)).toMatchObject({ pass: false, pattern: 'asked instead of building' });
      expect(gradeOutcome(e, unsupported)).toMatchObject({ pass: false, pattern: 'declined a supported job' });
      expect(gradeOutcome(e, failed)).toMatchObject({ pass: false, pattern: 'failed:timeout' });
    });
  });

  describe('netRoles fact (analyzeNets)', () => {
    /** breaker -> switch box (switch_sp) -> receptacle box; the duplex hot is switched. */
    const switched = (): CircuitModel => {
      const t = (device: string, terminal: string) => ({ kind: 'terminal' as const, device, terminal });
      const c = (cable: string, color: 'black' | 'white' | 'bare', box: string) => ({ kind: 'conductor' as const, cable, color, box });
      const s = (splice: string) => ({ kind: 'splice' as const, splice });
      return {
        id: 's',
        title: 's',
        boxes: [
          { id: 'panel', label: 'Panel', kind: 'panel' },
          { id: 'sb', label: 'Switch box', kind: 'box' },
          { id: 'rb', label: 'Receptacle box', kind: 'box' },
        ],
        devices: [
          { id: 'br', box: 'panel', type: 'breaker', label: 'B', amps: 15 },
          { id: 'nb', box: 'panel', type: 'neutral_bar', label: 'N' },
          { id: 'gb', box: 'panel', type: 'ground_bar', label: 'G' },
          { id: 'sw', box: 'sb', type: 'switch_sp', label: 'S' },
          { id: 'rc', box: 'rb', type: 'duplex', label: 'R' },
        ],
        cables: [
          { id: 'k1', name: 'k1', type: '14/2', from: 'panel', to: 'sb' },
          { id: 'k2', name: 'k2', type: '14/2', from: 'sb', to: 'rb' },
        ],
        splices: [
          { id: 'sn', box: 'sb' },
          { id: 'sg', box: 'sb' },
        ],
        connections: [
          { id: 'c1', a: t('br', 'out'), b: c('k1', 'black', 'panel'), color: 'black' },
          { id: 'c2', a: t('nb', 'neutral_bar'), b: c('k1', 'white', 'panel'), color: 'white' },
          { id: 'c3', a: t('gb', 'ground_bar'), b: c('k1', 'bare', 'panel'), color: 'bare' },
          { id: 'c4', a: c('k1', 'black', 'sb'), b: t('sw', 't1'), color: 'black' },
          { id: 'c5', a: t('sw', 't2'), b: c('k2', 'black', 'sb'), color: 'black' },
          { id: 'c6', a: c('k1', 'white', 'sb'), b: s('sn'), color: 'white' },
          { id: 'c7', a: c('k2', 'white', 'sb'), b: s('sn'), color: 'white' },
          { id: 'c8', a: c('k1', 'bare', 'sb'), b: s('sg'), color: 'bare' },
          { id: 'c9', a: c('k2', 'bare', 'sb'), b: s('sg'), color: 'bare' },
          { id: 'c10', a: t('sw', 'ground'), b: s('sg'), color: 'green' },
          { id: 'c11', a: c('k2', 'black', 'rb'), b: t('rc', 'brass'), color: 'black' },
          { id: 'c12', a: c('k2', 'white', 'rb'), b: t('rc', 'silver'), color: 'white' },
          { id: 'c13', a: c('k2', 'bare', 'rb'), b: t('rc', 'ground'), color: 'green' },
        ],
      };
    };
    const want = byId('custom-6').steps[0]!.expect;
    it('passes a rule-clean switched receptacle against custom-6', () => {
      const m = switched();
      expect(validateCircuit(m)).toEqual([]);
      expect(gradeOutcome(want, custom(m))).toMatchObject({ pass: true });
    });
    it('the role multiset is compared', () => {
      const m = switched();
      expect(checkFact(m, { kind: 'netRoles', at: { type: 'duplex', terminal: 'brass' }, roles: { switched_hot: 1 } })).toBeNull();
      expect(checkFact(m, { kind: 'netRoles', at: { type: 'duplex', terminal: 'brass' }, roles: { source_hot: 1 } })).toMatch(/expected source_hot x1, got switched_hot x1/);
      expect(checkFact(m, { kind: 'netRoles', at: { type: 'duplex', terminal: 'brass' }, roles: { switched_hot: 2 } })).not.toBeNull();
      expect(checkFact(m, { kind: 'netRoles', at: { type: 'light', terminal: 'hot' }, roles: { switched_hot: 1 } })).toMatch(/device missing/);
    });
    it('an unswitched receptacle fails custom-6 on the role fact', () => {
      const m = switched();
      // bypass the switch: feed cable k2 black at the switch box straight from k1 black instead of the switch output
      m.devices = m.devices.filter((d) => d.id !== 'sw');
      m.connections = m.connections.filter((x) => !['c4', 'c5', 'c10'].includes(x.id));
      m.connections.push({ id: 'cx', a: { kind: 'conductor', cable: 'k1', color: 'black', box: 'sb' }, b: { kind: 'conductor', cable: 'k2', color: 'black', box: 'sb' }, color: 'black' });
      expect(validateCircuit(m)).toEqual([]);
      expect(checkFact(m, { kind: 'netRoles', at: { type: 'duplex', terminal: 'brass' }, roles: { switched_hot: 1 } })).toMatch(/got source_hot x1/);
    });
    it('fedFromPanel: where power arrives first', () => {
      const m = switched();
      expect(checkFact(m, { kind: 'fedFromPanel', type: 'switch_sp' })).toBeNull();
      expect(checkFact(m, { kind: 'fedFromPanel', type: 'duplex' })).toMatch(/not fed directly from the panel/);
      expect(checkFact(m, { kind: 'fedFromPanel', type: 'light' })).toMatch(/device missing/);
      // custom-5 (power at the light box first) is not met by a circuit with power at the switch box
      expect(byId('custom-5').steps[0]!.expect).toMatchObject({ facts: expect.arrayContaining([{ kind: 'fedFromPanel', type: 'light' }]) });
    });
    it('custom-5 is satisfiable: a switch loop with power at the light box passes, with rule warnings only', () => {
      const t = (device: string, terminal: string) => ({ kind: 'terminal' as const, device, terminal });
      const c = (cable: string, color: 'black' | 'white' | 'bare', box: string) => ({ kind: 'conductor' as const, cable, color, box });
      const loop: CircuitModel = {
        id: 'l',
        title: 'l',
        boxes: [
          { id: 'panel', label: 'Panel', kind: 'panel' },
          { id: 'lb', label: 'Light box', kind: 'box' },
          { id: 'sb', label: 'Switch box', kind: 'box' },
        ],
        devices: [
          { id: 'br', box: 'panel', type: 'breaker', label: 'B', amps: 15 },
          { id: 'nb', box: 'panel', type: 'neutral_bar', label: 'N' },
          { id: 'gb', box: 'panel', type: 'ground_bar', label: 'G' },
          { id: 'li', box: 'lb', type: 'light', label: 'L' },
          { id: 'sw', box: 'sb', type: 'switch_sp', label: 'S' },
        ],
        cables: [
          { id: 'k1', name: 'k1', type: '14/2', from: 'panel', to: 'lb' },
          { id: 'k2', name: 'k2', type: '14/2', from: 'lb', to: 'sb' },
        ],
        splices: [{ id: 'sg', box: 'lb' }],
        connections: [
          { id: 'c1', a: t('br', 'out'), b: c('k1', 'black', 'panel'), color: 'black' },
          { id: 'c2', a: t('nb', 'neutral_bar'), b: c('k1', 'white', 'panel'), color: 'white' },
          { id: 'c3', a: t('gb', 'ground_bar'), b: c('k1', 'bare', 'panel'), color: 'bare' },
          { id: 'c4', a: c('k1', 'black', 'lb'), b: c('k2', 'black', 'lb'), color: 'black' },
          { id: 'c5', a: c('k1', 'white', 'lb'), b: t('li', 'neutral'), color: 'white' },
          { id: 'c6', a: t('li', 'hot'), b: c('k2', 'white', 'lb'), color: 'black' },
          { id: 'c7', a: c('k1', 'bare', 'lb'), b: { kind: 'splice' as const, splice: 'sg' }, color: 'bare' },
          { id: 'c8', a: c('k2', 'bare', 'lb'), b: { kind: 'splice' as const, splice: 'sg' }, color: 'bare' },
          { id: 'c9', a: t('li', 'ground'), b: { kind: 'splice' as const, splice: 'sg' }, color: 'green' },
          { id: 'c10', a: c('k2', 'black', 'sb'), b: t('sw', 't1'), color: 'black' },
          { id: 'c11', a: c('k2', 'white', 'sb'), b: t('sw', 't2'), color: 'black' },
          { id: 'c12', a: c('k2', 'bare', 'sb'), b: t('sw', 'ground'), color: 'green' },
        ],
      };
      expect(validateCircuit(loop)).toEqual([]);
      const findings = checkCircuit(loop, { edition: 'nec-2023' });
      expect(findings.filter((f) => f.severity === 'error')).toEqual([]);
      expect(findings.length).toBeGreaterThan(0); // the neutral-at-switch-box warning
      expect(gradeOutcome(byId('custom-5').steps[0]!.expect, custom(loop))).toMatchObject({ pass: true });
    });
    it('custom-4 is satisfiable: GFCI third protects only the receptacle after it', () => {
      const t = (device: string, terminal: string) => ({ kind: 'terminal' as const, device, terminal });
      const c = (cable: string, color: 'black' | 'white' | 'bare', box: string) => ({ kind: 'conductor' as const, cable, color, box });
      const sp = (splice: string) => ({ kind: 'splice' as const, splice });
      const m: CircuitModel = {
        id: 'g',
        title: 'g',
        boxes: [{ id: 'panel', label: 'Panel', kind: 'panel' }, ...[1, 2, 3, 4].map((i) => ({ id: `b${i}`, label: `Box ${i}`, kind: 'box' as const }))],
        devices: [
          { id: 'br', box: 'panel', type: 'breaker', label: 'B', amps: 20 },
          { id: 'nb', box: 'panel', type: 'neutral_bar', label: 'N' },
          { id: 'gb', box: 'panel', type: 'ground_bar', label: 'G' },
          { id: 'd1', box: 'b1', type: 'duplex', label: 'R1' },
          { id: 'd2', box: 'b2', type: 'duplex', label: 'R2' },
          { id: 'g3', box: 'b3', type: 'gfci', label: 'GF' },
          { id: 'd4', box: 'b4', type: 'duplex', label: 'R4' },
        ],
        cables: [1, 2, 3, 4].map((i) => ({ id: `k${i}`, name: `k${i}`, type: '12/2' as const, from: i === 1 ? 'panel' : `b${i - 1}`, to: `b${i}` })),
        splices: [1, 2].flatMap((i) => ['h', 'n', 'g'].map((k) => ({ id: `${k}${i}`, box: `b${i}` }))).concat([{ id: 'g3s', box: 'b3' }]),
        connections: [
          { id: 'p1', a: t('br', 'out'), b: c('k1', 'black', 'panel'), color: 'black' },
          { id: 'p2', a: t('nb', 'neutral_bar'), b: c('k1', 'white', 'panel'), color: 'white' },
          { id: 'p3', a: t('gb', 'ground_bar'), b: c('k1', 'bare', 'panel'), color: 'bare' },
          // boxes 1 and 2: incoming and outgoing spliced with a pigtail to the receptacle
          ...[1, 2].flatMap((i) => {
            const d = `d${i}`;
            const inc = `k${i}`;
            const out = `k${i + 1}`;
            const box = `b${i}`;
            return [
              { id: `h${i}a`, a: c(inc, 'black', box), b: sp(`h${i}`), color: 'black' as const },
              { id: `h${i}b`, a: c(out, 'black', box), b: sp(`h${i}`), color: 'black' as const },
              { id: `h${i}c`, a: t(d, 'brass'), b: sp(`h${i}`), color: 'black' as const },
              { id: `n${i}a`, a: c(inc, 'white', box), b: sp(`n${i}`), color: 'white' as const },
              { id: `n${i}b`, a: c(out, 'white', box), b: sp(`n${i}`), color: 'white' as const },
              { id: `n${i}c`, a: t(d, 'silver'), b: sp(`n${i}`), color: 'white' as const },
              { id: `g${i}a`, a: c(inc, 'bare', box), b: sp(`g${i}`), color: 'bare' as const },
              { id: `g${i}b`, a: c(out, 'bare', box), b: sp(`g${i}`), color: 'bare' as const },
              { id: `g${i}c`, a: t(d, 'ground'), b: sp(`g${i}`), color: 'green' as const },
            ];
          }),
          // box 3: GFCI, line from k3, load to k4
          { id: 'l1', a: c('k3', 'black', 'b3'), b: t('g3', 'line_hot'), color: 'black' },
          { id: 'l2', a: c('k3', 'white', 'b3'), b: t('g3', 'line_neutral'), color: 'white' },
          { id: 'l3', a: c('k4', 'black', 'b3'), b: t('g3', 'load_hot'), color: 'black' },
          { id: 'l4', a: c('k4', 'white', 'b3'), b: t('g3', 'load_neutral'), color: 'white' },
          { id: 'l5', a: c('k3', 'bare', 'b3'), b: sp('g3s'), color: 'bare' },
          { id: 'l6', a: c('k4', 'bare', 'b3'), b: sp('g3s'), color: 'bare' },
          { id: 'l7', a: t('g3', 'ground'), b: sp('g3s'), color: 'green' },
          // box 4: last receptacle, wired directly
          { id: 'r1', a: c('k4', 'black', 'b4'), b: t('d4', 'brass'), color: 'black' },
          { id: 'r2', a: c('k4', 'white', 'b4'), b: t('d4', 'silver'), color: 'white' },
          { id: 'r3', a: c('k4', 'bare', 'b4'), b: t('d4', 'ground'), color: 'green' },
        ],
      };
      expect(validateCircuit(m)).toEqual([]);
      expect(checkCircuit(m, { edition: 'nec-2023' }).filter((f) => f.severity === 'error')).toEqual([]);
      expect(gradeOutcome(byId('custom-4').steps[0]!.expect, custom(m))).toMatchObject({ pass: true });
      // a GFCI first (protecting all three receptacles) is a different net-role multiset
      expect(checkFact(m, { kind: 'netRoles', at: { type: 'duplex', terminal: 'brass' }, roles: { protected_hot: 3 } })).not.toBeNull();
    });
    it('GFCI-third roles: protected hot only downstream of the GFCI (checked on a hand-built outcome)', () => {
      const e = byId('custom-4').steps[0]!.expect;
      // fixtures contain a GFCI circuit; its downstream receptacle is protected_hot, the GFCI line side source_hot
      const gf = structuredClone(FIXTURES.find((f) => f.devices.some((d) => d.type === 'gfci'))!);
      expect(checkFact(gf, { kind: 'netRoles', at: { type: 'gfci', terminal: 'line_hot' }, roles: { source_hot: 1 } })).toBeNull();
      expect(checkFact(gf, { kind: 'netRoles', at: { type: 'duplex', terminal: 'brass' }, roles: { protected_hot: 1 } })).toBeNull();
      expect(gradeOutcome(e, custom(gf)).pass).toBe(false);
    });
  });

  describe('multi-block and counts cases', () => {
    it('mb-3: GFCI-first run of 3, switch with one light, switch with a fan, in order, 20 A', () => {
      const e = byId('mb-3').steps[0]!.expect;
      const good = [{ type: 'receptacle_run', count: 3, gfciFirst: true }, { type: 'switch_lights', count: 1 }, { type: 'switch_fan' }];
      expect(gradeOutcome(e, blk(good, 20)).pass).toBe(true);
      expect(gradeOutcome(e, blk(good, 15))).toMatchObject({ pass: false, pattern: 'wrong parameter' });
      expect(gradeOutcome(e, blk([good[0]!, good[2]!, good[1]!], 20))).toMatchObject({ pass: false, pattern: 'wrong blocks' });
      expect(gradeOutcome(e, blk([{ ...good[0]!, gfciFirst: false }, good[1]!, good[2]!], 20))).toMatchObject({ pass: false, pattern: 'wrong parameter' });
      expect(gradeOutcome(e, blk([{ ...good[0]!, count: 2 }, good[1]!, good[2]!], 20))).toMatchObject({ pass: false, pattern: 'wrong parameter' });
      expect(gradeOutcome(e, blk(good.slice(0, 2), 20))).toMatchObject({ pass: false, pattern: 'wrong blocks' });
    });
    it('mb-4 and counts-3 compare each count the case names', () => {
      const e4 = byId('mb-4').steps[0]!.expect;
      expect(gradeOutcome(e4, blk([{ type: 'switch_lights', count: 2 }, { type: 'receptacle_run', count: 5 }])).pass).toBe(true);
      expect(gradeOutcome(e4, blk([{ type: 'switch_lights', count: 2 }, { type: 'receptacle_run', count: 4 }]))).toMatchObject({ pass: false, pattern: 'wrong parameter' });
      const e3 = byId('counts-3').steps[0]!.expect;
      expect(gradeOutcome(e3, blk([{ type: 'two_gang_switches', countA: 3, countB: 1 }])).pass).toBe(true);
      expect(gradeOutcome(e3, blk([{ type: 'two_gang_switches', countA: 1, countB: 3 }]))).toMatchObject({ pass: false, pattern: 'wrong parameter' });
    });
    it('counts-2: twelve receptacles, not GFCI-first, 20 A; asking instead is a failure', () => {
      const e = byId('counts-2').steps[0]!.expect;
      expect(gradeOutcome(e, blk([{ type: 'receptacle_run', count: 12 }], 20)).pass).toBe(true);
      expect(gradeOutcome(e, blk([{ type: 'receptacle_run', count: 12, gfciFirst: true }], 20))).toMatchObject({ pass: false, pattern: 'wrong parameter' });
      expect(gradeOutcome(e, question)).toMatchObject({ pass: false, pattern: 'asked instead of choosing' });
    });
    it('corrected cases: receptacle_run counts and GFCI flag', () => {
      expect(gradeOutcome(byId('custom-1').steps[0]!.expect, blk([{ type: 'receptacle_run', count: 1 }], 20)).pass).toBe(true);
      expect(gradeOutcome(byId('custom-1').steps[0]!.expect, custom(receptacle()))).toMatchObject({ pass: false, pattern: 'custom instead of blocks' });
      expect(gradeOutcome(byId('custom-3').steps[0]!.expect, blk([{ type: 'receptacle_run', count: 2 }], 20)).pass).toBe(true);
      expect(gradeOutcome(byId('custom-3').steps[0]!.expect, blk([{ type: 'receptacle_run', count: 2, gfciFirst: true }], 20))).toMatchObject({ pass: false, pattern: 'wrong parameter' });
      const t2 = byId('trap-2').steps[0]!.expect;
      expect(gradeOutcome(t2, blk([{ type: 'receptacle_run', count: 4, gfciFirst: true }], 20)).pass).toBe(true);
      expect(gradeOutcome(t2, blk([{ type: 'receptacle_run', count: 2, gfciFirst: true }], 20))).toMatchObject({ pass: false, pattern: 'wrong parameter' });
    });
  });

  describe('target', () => {
    const t1 = byId('target-1').steps[0]!.expect;
    const t2 = byId('target-2').steps[0]!.expect;
    const t4 = byId('target-4').steps[0]!.expect;
    const run8 = [{ type: 'receptacle_run', count: 8 }];
    const six = [{ type: 'switch_lights', count: 6 }];
    it('new vs selected is graded when the case states it', () => {
      expect(gradeOutcome(t1, blk(run8, 20, 'new')).pass).toBe(true);
      expect(gradeOutcome(t1, blk(run8, 20, 'selected'))).toMatchObject({ pass: false, pattern: 'wrong target' });
      expect(gradeOutcome(t2, blk(six, 15, 'selected')).pass).toBe(true);
      expect(gradeOutcome(t2, blk(six, 15, 'new'))).toMatchObject({ pass: false, pattern: 'wrong target' });
      expect(gradeOutcome(byId('target-3').steps[0]!.expect, blk([{ type: 'receptacle_run', count: 4, gfciFirst: true }], 20, 'selected'))).toMatchObject({ pass: false, pattern: 'wrong target' });
    });
    it('the block list is still compared, before the target', () => {
      expect(gradeOutcome(t2, blk([{ type: 'switch_lights', count: 5 }], 15, 'selected'))).toMatchObject({ pass: false, pattern: 'wrong parameter' });
      expect(gradeOutcome(t2, blk([{ type: 'switch_lights', count: 5 }], 15, 'new'))).toMatchObject({ pass: false, pattern: 'wrong parameter' });
    });
    it('target is ignored by cases that do not state it', () => {
      const sp2 = { kind: 'blocks', blocks: [{ type: 'switch_lights', count: 1 }] } as const;
      expect(gradeOutcome(sp2, blk([{ type: 'switch_lights', count: 1 }], 15, 'selected')).pass).toBe(true);
      expect(gradeOutcome(sp2, blk([{ type: 'switch_lights', count: 1 }], 15, 'new')).pass).toBe(true);
    });
    it('an ambiguous reference needs a question', () => {
      expect(gradeOutcome(t4, question).pass).toBe(true);
      expect(gradeOutcome(t4, blk([{ type: 'receptacle_run', count: 10 }], 20, 'selected'))).toMatchObject({ pass: false, pattern: 'guessed instead of asking' });
      expect(gradeOutcome(t4, unsupported)).toMatchObject({ pass: false, pattern: 'declined instead of asking' });
    });
    it('the seed becomes the circuits note the model sees, with the selection marked', () => {
      const ctx = seedContext(byId('target-2').seed!);
      expect(ctx.selectedCircuitId).toBe('seed-1');
      const note = buildContextNote(ctx.circuits, ctx.selectedCircuitId)!;
      expect(note).toContain('1. "Basement lights" - 15 A - Single-pole switch with lights (count 4) [selected]');
      const none = seedContext(byId('target-1').seed!);
      expect(none.selectedCircuitId).toBeNull();
      expect(buildContextNote(none.circuits, none.selectedCircuitId)).toContain('No circuit is selected.');
      expect(seedContext(byId('target-4').seed!).circuits.length).toBe(2);
    });
  });

  describe('task 37 corrections', () => {
    it('the four breaker-size cases expect a question; mb-6 does not grade the GFCI flag', () => {
      for (const id of ['template-sp-2', 'template-3w-2', 'template-gfci-2', 'template-tg-2']) {
        expect(byId(id).category).toBe('blocks');
        expect(byId(id).steps[0]!.expect).toEqual({ kind: 'question' });
        expect(byId(id).rationale).toContain('Corrected in task 37');
        expect(gradeOutcome(byId(id).steps[0]!.expect, sp()).pass).toBe(false);
        expect(gradeOutcome(byId(id).steps[0]!.expect, question).pass).toBe(true);
      }
      const e = byId('mb-6').steps[0]!.expect;
      expect(byId('mb-6').rationale).toContain('Corrected in task 37');
      expect(gradeOutcome(e, blk([{ type: 'receptacle_run', count: 1 }], 20)).pass).toBe(true);
      expect(gradeOutcome(e, blk([{ type: 'receptacle_run', count: 1, gfciFirst: true }], 20)).pass).toBe(true);
      expect(gradeOutcome(e, blk([{ type: 'receptacle_run', count: 1 }], 15))).toMatchObject({ pass: false, pattern: 'wrong parameter' });
    });
  });

  describe('inventory grading', () => {
    /** Outcome of an inventory reply built through the real resolver; rooms are [id, type, receptacles, groups, fans, attachedTo]. */
    type R = [string, string, number, [number, number][], number?, string?];
    const inv = (rooms: R[], basement: boolean, over: { max?: number; light?: number } = {}): ChatOutcome => {
      const reply = {
        ...unused,
        kind: 'inventory',
        target: 'none',
        message: 'm',
        basement,
        rooms: rooms.map(([id, type, receptacles, groups, fans = 0, attachedTo = '']) => ({
          id, name: `Name ${id}`, type, receptacles, lightGroups: groups.map(([lights, switchLocations]) => ({ lights, switchLocations })), fans, attachedTo,
        })),
        maxReceptaclesPerCircuit: over.max ?? 0,
        lightingBreakerAmps: over.light ?? 0,
      };
      const res = resolveReply(reply);
      if (res.kind !== 'inventory') throw new Error(`bad test inventory: ${JSON.stringify(res)}`);
      return { kind: 'inventory', text: 'm', reply, inventory: res.inventory, options: res.options, plan: res.plan };
    };
    const basement: R[] = [
      ['living', 'living_area', 8, [[8, 2]]],
      ['bath', 'bathroom', 3, [[1, 1]], 1],
      ['closet', 'closet', 0, [[1, 1]]],
      ['bed', 'bedroom', 5, [[2, 1]]],
    ];
    const e1 = byId('inv-1').steps[0]!.expect;

    it('inv-1: the user basement description matches regardless of ids, names and room order', () => {
      expect(gradeOutcome(e1, inv(basement, true)).pass).toBe(true);
      expect(gradeOutcome(e1, inv([...basement].reverse().map(([id, ...rest]) => [`x-${id}`, ...rest] as R), true)).pass).toBe(true);
    });
    it('room count: dropped and extra rooms', () => {
      expect(gradeOutcome(e1, inv(basement.slice(0, 3), true))).toMatchObject({ pass: false, pattern: 'dropped room' });
      expect(gradeOutcome(e1, inv([...basement, ['hall', 'hallway', 1, [[1, 1]]]], true))).toMatchObject({ pass: false, pattern: 'extra room' });
    });
    it('wrong counts, room type, light groups and basement flag', () => {
      const change = (i: number, patch: Record<number, unknown>): R[] => basement.map((r, j) => (j === i ? (Object.assign([...r], patch) as unknown as R) : r));
      expect(gradeOutcome(e1, inv(change(0, { 2: 6 }), true))).toMatchObject({ pass: false, pattern: 'wrong count' });
      expect(gradeOutcome(e1, inv(change(1, { 4: 0 }), true))).toMatchObject({ pass: false, pattern: 'wrong count' });
      expect(gradeOutcome(e1, inv(change(3, { 1: 'other' }), true))).toMatchObject({ pass: false, pattern: 'wrong room type' });
      expect(gradeOutcome(e1, inv(change(0, { 3: [[8, 1]] }), true))).toMatchObject({ pass: false, pattern: 'wrong light groups' });
      expect(gradeOutcome(e1, inv(change(0, { 3: [[4, 2], [4, 2]] }), true))).toMatchObject({ pass: false, pattern: 'wrong light groups' });
      expect(gradeOutcome(e1, inv(basement, false))).toMatchObject({ pass: false, pattern: 'wrong basement flag' });
    });
    it('attachedTo is resolved by room type, not by the model id; a wrong attachment is reported', () => {
      expect(gradeOutcome(e1, inv(basement.map((r) => (r[0] === 'closet' ? ([r[0], r[1], r[2], r[3], 0, 'bed'] as R) : r)), true))).toMatchObject({ pass: false, pattern: 'wrong attachment' });
      const e6 = byId('inv-6').steps[0]!.expect;
      const attached = (bedId: string): R[] => [[bedId, 'bedroom', 4, [[1, 1]]], ['cl', 'closet', 0, [[1, 1]], 0, bedId]];
      expect(gradeOutcome(e6, inv(attached('b1'), false)).pass).toBe(true);
      expect(gradeOutcome(e6, inv(attached('zzz'), false)).pass).toBe(true);
      expect(gradeOutcome(e6, inv([['b', 'bedroom', 4, [[1, 1]]], ['cl', 'closet', 0, [[1, 1]]]], false))).toMatchObject({ pass: false, pattern: 'wrong attachment' });
      // attached to the wrong type of room
      expect(gradeOutcome(e6, inv([['b', 'bedroom', 4, [[1, 1]]], ['h', 'hallway', 1, [[1, 1]]], ['cl', 'closet', 0, [[1, 1]], 0, 'h']], false))).toMatchObject({ pass: false });
    });
    it('light groups are a multiset: order does not matter, two groups differ from one', () => {
      const e4 = byId('inv-4').steps[0]!.expect;
      expect(gradeOutcome(e4, inv([['l', 'living_area', 6, [[4, 1], [2, 1]]]], false)).pass).toBe(true);
      expect(gradeOutcome(e4, inv([['l', 'living_area', 6, [[2, 1], [4, 1]]]], false)).pass).toBe(true);
      expect(gradeOutcome(e4, inv([['l', 'living_area', 6, [[6, 1]]]], false))).toMatchObject({ pass: false, pattern: 'wrong light groups' });
    });
    it('two rooms of one type are matched as a multiset (inv-2, inv-3)', () => {
      const e2 = byId('inv-2').steps[0]!.expect;
      const rooms: R[] = [['a', 'bedroom', 6, [[1, 1]]], ['b', 'bedroom', 5, [[1, 1]]], ['h', 'hallway', 1, [[2, 1]]]];
      expect(gradeOutcome(e2, inv(rooms, false)).pass).toBe(true);
      expect(gradeOutcome(e2, inv([rooms[1]!, rooms[0]!, rooms[2]!], false)).pass).toBe(true);
      expect(gradeOutcome(e2, inv([['a', 'bedroom', 6, [[1, 1]]], ['b', 'bedroom', 6, [[1, 1]]], rooms[2]!], false))).toMatchObject({ pass: false, pattern: 'wrong count' });
      const e3 = byId('inv-3').steps[0]!.expect;
      expect(gradeOutcome(e3, inv([['m', 'bathroom', 2, [[1, 1]], 1], ['h', 'bathroom', 1, [[1, 1]]]], false)).pass).toBe(true);
      expect(gradeOutcome(e3, inv([['m', 'bathroom', 3, [[1, 1]], 1]], false))).toMatchObject({ pass: false, pattern: 'dropped room' });
    });
    it('inv-5: a garage must be type other and must not be dropped', () => {
      const e5 = byId('inv-5').steps[0]!.expect;
      expect(gradeOutcome(e5, inv([['l', 'living_area', 6, [[4, 1]]], ['g', 'other', 4, [[2, 1]]]], false)).pass).toBe(true);
      expect(gradeOutcome(e5, inv([['l', 'living_area', 6, [[4, 1]]]], false))).toMatchObject({ pass: false, pattern: 'dropped room' });
      expect(gradeOutcome(e5, inv([['l', 'living_area', 6, [[4, 1]]], ['g', 'hallway', 4, [[2, 1]]]], false))).toMatchObject({ pass: false, pattern: 'wrong room type' });
    });
    it('inventory-question cases pass on a question and fail on an inventory (guessing)', () => {
      for (const id of ['invq-1', 'invq-2', 'invq-3']) {
        const e = byId(id).steps[0]!.expect;
        expect(e).toEqual({ kind: 'question' });
        expect(gradeOutcome(e, question).pass).toBe(true);
        expect(gradeOutcome(e, inv([['b', 'bedroom', 4, [[1, 1]]]], false))).toMatchObject({ pass: false, pattern: 'guessed instead of asking' });
      }
    });
    it('options are graded only where a case names them', () => {
      const e = byId('edit-3').steps[0]!.expect;
      const same: R[] = [
        ['bedroom', 'bedroom', 4, [[1, 1]]], ['closet', 'closet', 0, [[1, 1]]], ['hall', 'hallway', 1, [[2, 1]]], ['bath', 'bathroom', 2, [[1, 1]], 1],
      ];
      expect(gradeOutcome(e, inv(same, false, { max: 6 })).pass).toBe(true);
      expect(gradeOutcome(e, inv(same, false))).toMatchObject({ pass: false, pattern: 'wrong option' });
      expect(gradeOutcome(e, inv(same, false, { max: 4 }))).toMatchObject({ pass: false, pattern: 'wrong option' });
      // a case that names no option accepts any
      expect(gradeOutcome(byId('edit-2').steps[0]!.expect, inv(same.map((r) => (r[0] === 'hall' ? ['hall', 'hallway', 3, [[2, 1]]] as R : r)), false, { max: 6, light: 20 })).pass).toBe(true);
      expect(gradeOutcome({ kind: 'inventory', inventory: { basement: false, rooms: [{ type: 'bedroom', receptacles: 4, lightGroups: [{ lights: 1, switchLocations: 1 }], fans: 0 }] }, options: { lightingBreakerAmps: 20 } }, inv([['b', 'bedroom', 4, [[1, 1]]]], false, { light: 20 })).pass).toBe(true);
      expect(gradeOutcome({ kind: 'inventory', inventory: { basement: false, rooms: [{ type: 'bedroom', receptacles: 4, lightGroups: [{ lights: 1, switchLocations: 1 }], fans: 0 }] }, options: { lightingBreakerAmps: 20 } }, inv([['b', 'bedroom', 4, [[1, 1]]]], false))).toMatchObject({ pass: false, pattern: 'wrong option' });
    });
    it('plan-edit: complete revised inventory passes; a delta, the wrong change or an unchanged inventory fails', () => {
      const seed: R[] = [
        ['bedroom', 'bedroom', 4, [[1, 1]]], ['closet', 'closet', 0, [[1, 1]]], ['hall', 'hallway', 1, [[2, 1]]], ['bath', 'bathroom', 2, [[1, 1]], 1],
      ];
      const e1 = byId('edit-1').steps[0]!.expect;
      const attached = seed.map((r) => (r[0] === 'closet' ? ['closet', 'closet', 0, [[1, 1]], 0, 'bedroom'] as R : r));
      expect(gradeOutcome(e1, inv(attached, false)).pass).toBe(true);
      expect(gradeOutcome(e1, inv(seed, false))).toMatchObject({ pass: false, pattern: 'wrong attachment' });
      expect(gradeOutcome(e1, inv(attached.slice(0, 2), false))).toMatchObject({ pass: false, pattern: 'delta instead of full inventory' });
      expect(gradeOutcome(e1, inv([seed[1]!], false))).toMatchObject({ pass: false, pattern: 'delta instead of full inventory' });
      const e2 = byId('edit-2').steps[0]!.expect;
      expect(gradeOutcome(e2, inv(seed.map((r) => (r[0] === 'hall' ? ['hall', 'hallway', 3, [[2, 1]]] as R : r)), false)).pass).toBe(true);
      expect(gradeOutcome(e2, inv(seed, false))).toMatchObject({ pass: false, pattern: 'wrong count' });
      expect(gradeOutcome(e2, inv([['hall', 'hallway', 3, [[2, 1]]]], false))).toMatchObject({ pass: false, pattern: 'delta instead of full inventory' });
      const e4 = byId('edit-4').steps[0]!.expect;
      expect(gradeOutcome(e4, inv(seed.filter((r) => r[0] !== 'closet'), false)).pass).toBe(true);
      expect(gradeOutcome(e4, inv(seed, false))).toMatchObject({ pass: false, pattern: 'extra room' });
      expect(gradeOutcome(e4, inv(seed.filter((r) => r[0] !== 'closet' && r[0] !== 'bath'), false))).toMatchObject({ pass: false, pattern: 'delta instead of full inventory' });
      // a circuit instead of an inventory is a routing failure
      expect(gradeOutcome(e2, sp())).toMatchObject({ pass: false, pattern: 'wrong routing' });
      expect(gradeOutcome(e2, question)).toMatchObject({ pass: false, pattern: 'asked instead of planning' });
      expect(gradeOutcome(e2, unsupported)).toMatchObject({ pass: false, pattern: 'declined a supported job' });
    });
    it('stored-plan seeds resolve to the plan state the context note shows', () => {
      const ctx = seedContext(byId('edit-1').seed!);
      expect(ctx.circuits).toEqual([]);
      expect(ctx.selectedCircuitId).toBeNull();
      expect(ctx.plan).toMatchObject({ options: {}, builtAt: null });
      expect(ctx.plan!.inventory.rooms.map((r) => r.id)).toEqual(['bedroom', 'closet', 'hall', 'bath']);
      const note = buildContextNote(ctx.circuits, ctx.selectedCircuitId, ctx.plan)!;
      expect(note).toContain('stored plan, not yet built');
      expect(note).toContain('"id":"closet"');
      expect(seedContext({ circuits: [], selected: null, plan: { inventory: byId('edit-1').seed!.plan!.inventory, built: true } }).plan!.builtAt).not.toBeNull();
      expect(() => seedContext({ circuits: [], selected: null, plan: { inventory: { basement: false, rooms: [] } } })).toThrow(/not valid/);
      expect(seedContext({ circuits: [], selected: null }).plan).toBeNull();
    });
  });

  describe('build and routing grading', () => {
    const inventoryOutcome = (): ChatOutcome => {
      const reply = {
        ...unused, kind: 'inventory', target: 'none', message: 'm', basement: false, maxReceptaclesPerCircuit: 0, lightingBreakerAmps: 0,
        rooms: [{ id: 'b', name: 'B', type: 'bedroom', receptacles: 4, lightGroups: [{ lights: 1, switchLocations: 1 }], fans: 0, attachedTo: '' }],
      };
      const res = resolveReply(reply);
      if (res.kind !== 'inventory') throw new Error('bad test inventory');
      return { kind: 'inventory', text: 'm', reply, inventory: res.inventory, options: res.options, plan: res.plan };
    };
    const blocked: ChatOutcome = { kind: 'build_blocked', text: 'no plan', reply: {} };
    const built = (): ChatOutcome => ({ kind: 'build', text: 'built', reply: {}, plan: (inventoryOutcome() as Extract<ChatOutcome, { kind: 'inventory' }>).plan, circuits: [] });

    it('build-1: the loop built the stored plan passes; anything else fails with a pattern', () => {
      const e = byId('build-1').steps[0]!.expect;
      expect(gradeOutcome(e, built()).pass).toBe(true);
      expect(gradeOutcome(e, question)).toMatchObject({ pass: false, pattern: 'asked instead of building' });
      expect(gradeOutcome(e, inventoryOutcome())).toMatchObject({ pass: false, pattern: 'revised inventory instead of building' });
      expect(gradeOutcome(e, blocked)).toMatchObject({ pass: false, pattern: 'build blocked' });
      expect(gradeOutcome(e, sp())).toMatchObject({ pass: false, pattern: 'wrong routing' });
      expect(gradeOutcome(e, failed)).toMatchObject({ pass: false, pattern: 'failed:timeout' });
    });
    it('build-2: with no plan a question passes; a build reply (blocked by the loop) fails as built without a plan', () => {
      const e = byId('build-2').steps[0]!.expect;
      expect(byId('build-2').seed).toBeUndefined();
      expect(gradeOutcome(e, question).pass).toBe(true);
      expect(gradeOutcome(e, blocked)).toMatchObject({ pass: false, pattern: 'built without a plan' });
      expect(gradeOutcome(e, built())).toMatchObject({ pass: false, pattern: 'built without a plan' });
      expect(gradeOutcome(e, inventoryOutcome())).toMatchObject({ pass: false, pattern: 'wrong routing' });
      expect(gradeOutcome(e, unsupported)).toMatchObject({ pass: false, pattern: 'wrong routing' });
    });
    it('build-3 and route-1: a single circuit; an inventory or build instead is wrong routing; target is graded', () => {
      const e = byId('build-3').steps[0]!.expect;
      const run4 = [{ type: 'receptacle_run', count: 4 }];
      expect(gradeOutcome(e, blk(run4, 20, 'new')).pass).toBe(true);
      expect(gradeOutcome(e, blk(run4, 20, 'selected'))).toMatchObject({ pass: false, pattern: 'wrong target' });
      expect(gradeOutcome(e, blk([{ type: 'receptacle_run', count: 4, gfciFirst: true }], 20, 'new'))).toMatchObject({ pass: false, pattern: 'wrong parameter' });
      expect(gradeOutcome(e, inventoryOutcome())).toMatchObject({ pass: false, pattern: 'wrong routing' });
      expect(gradeOutcome(e, built())).toMatchObject({ pass: false, pattern: 'wrong routing' });
      expect(gradeOutcome(e, blocked)).toMatchObject({ pass: false, pattern: 'wrong routing' });
      expect(gradeOutcome(e, question)).toMatchObject({ pass: false, pattern: 'asked instead of choosing' });
      const r1 = byId('route-1').steps[0]!.expect;
      expect(gradeOutcome(r1, blk([{ type: 'switch_lights', count: 4 }], 15)).pass).toBe(true);
      expect(gradeOutcome(r1, inventoryOutcome())).toMatchObject({ pass: false, pattern: 'wrong routing' });
      expect(gradeOutcome(byId('route-2').steps[0]!.expect, sp())).toMatchObject({ pass: false, pattern: 'wrong routing' });
    });
    it('only build-3 grades a target among the new cases, and every seed with a plan resolves', () => {
      for (const id of ['edit-1', 'edit-2', 'edit-3', 'edit-4', 'build-1', 'build-3']) {
        const c = byId(id);
        expect(c.steps.length).toBe(1);
        expect(seedContext(c.seed!).plan).not.toBeNull();
      }
    });
  });

  it('fixtures are not mistaken for custom circuits that satisfy the cases', () => {
    const asCustom = custom(structuredClone(FIXTURES[0]!));
    for (const id of ['custom-2', 'custom-4', 'custom-5', 'custom-6']) expect(gradeOutcome(byId(id).steps[0]!.expect, asCustom).pass).toBe(false);
  });
});
