import { describe, expect, it } from 'vitest';
import { FIXTURES } from '../src/fixtures';
import {
  BLOCK_FIXTURES,
  BUILDING_BLOCKS,
  CATALOGUE,
  analyzeNets,
  buildCircuit,
  checkCircuit,
  getBlock,
  validateCircuit,
  type BlockInput,
  type CircuitModel,
  type Endpoint,
  type NetRole,
} from '../src/index';

const AMPS = [15, 20] as const;
const COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 12];
const check = (m: CircuitModel) => checkCircuit(m, { edition: 'nec-2023' });
const build = (amps: 15 | 20, blocks: BlockInput[], id = 't') => buildCircuit({ id, title: 'test', breakerAmps: amps, blocks });

/** Structure and every rule: nothing at all may be reported (errors and warnings). */
function expectClean(m: CircuitModel, what: string) {
  expect(validateCircuit(m), `${what}: structure`).toEqual([]);
  expect(check(m), `${what}: findings`).toEqual([]);
}

const RUN = (count: number, gfciFirst = false): BlockInput => ({ type: 'receptacle_run', count, gfciFirst });
const SW = (count: number): BlockInput => ({ type: 'switch_lights', count });
const TW = (count: number): BlockInput => ({ type: 'three_way_lights', count });
const FAN: BlockInput = { type: 'switch_fan' };
const TG = (countA: number, countB: number): BlockInput => ({ type: 'two_gang_switches', countA, countB });
/** Every count pair 1-4, plus 8 and 8. */
const TG_PAIRS: [number, number][] = [...[1, 2, 3, 4].flatMap((a) => [1, 2, 3, 4].map((b) => [a, b] as [number, number])), [8, 8]];

function singles(): [string, BlockInput][] {
  const out: [string, BlockInput][] = [];
  for (const n of COUNTS) {
    out.push([`receptacle_run ${n}`, RUN(n)], [`receptacle_run ${n} gfciFirst`, RUN(n, true)]);
    out.push([`switch_lights ${n}`, SW(n)], [`three_way_lights ${n}`, TW(n)]);
  }
  out.push(['switch_fan', FAN]);
  for (const [a, b] of TG_PAIRS) out.push([`two_gang_switches ${a}+${b}`, TG(a, b)]);
  return out;
}

// ---- equivalence with the verified fixtures ---------------------------------------------------------------
const key = (e: Endpoint, m: Record<string, string>) => {
  const r = (id: string) => m[id] ?? id;
  return e.kind === 'terminal' ? `t:${r(e.device)}.${e.terminal}` : e.kind === 'conductor' ? `c:${r(e.cable)}.${e.color}@${r(e.box)}` : `s:${r(e.splice)}`;
};
/** Topology by endpoints: ids renamed through `m`, labels and connection ids ignored. */
function topology(model: CircuitModel, m: Record<string, string>) {
  const r = (id: string) => m[id] ?? id;
  return {
    boxes: model.boxes.map((b) => `${r(b.id)}:${b.kind}`).sort(),
    devices: model.devices.map((d) => `${r(d.id)}:${r(d.box)}:${d.type}:${d.amps ?? ''}`).sort(),
    cables: model.cables.map((c) => `${r(c.id)}:${c.type}:${r(c.from)}>${r(c.to)}`).sort(),
    splices: model.splices.map((s) => `${r(s.id)}:${r(s.box)}`).sort(),
    connections: model.connections.map((c) => `${[key(c.a, m), key(c.b, m)].sort().join(' -- ')} ${c.color}`).sort(),
  };
}

describe('equivalence with the verified fixtures', () => {
  it('switch_lights N=1 equals fixture 1', () => {
    const m = build(15, [SW(1)]);
    const map = { 'b1-feed': 'feed', 'b1-load': 'load', 'b1-sw': 'swbox', 'b1-l1': 'lightbox', 'b1-switch': 'sw', 'b1-light1': 'fix', 'b1-sw-n': 'wn', 'b1-sw-g': 'gn' };
    expect(topology(m, map)).toEqual(topology(FIXTURES[0], {}));
  });
  it('three_way_lights N=1 equals fixture 2', () => {
    const m = build(15, [TW(1)]);
    const map = {
      'b1-feed': 'feed', 'b1-trav': 'trav', 'b1-load': 'load', 'b1-sw1': 'box1', 'b1-sw2': 'box2', 'b1-l1': 'lightbox',
      'b1-switch1': 'sw1', 'b1-switch2': 'sw2', 'b1-light1': 'fix',
      'b1-sw1-n': 'w1', 'b1-sw1-g': 'g1', 'b1-sw2-n': 'w2', 'b1-sw2-g': 'g2',
    };
    expect(topology(m, map)).toEqual(topology(FIXTURES[1], {}));
  });
  it('receptacle_run N=2 gfciFirst equals fixture 3', () => {
    const m = build(20, [RUN(2, true)]);
    const map = { 'b1-feed': 'feed', 'b1-run1': 'ds', 'b1-r1': 'gfcibox', 'b1-r2': 'rbox', 'b1-rec1': 'gfci', 'b1-rec2': 'rec', 'b1-r1-g': 'g' };
    expect(topology(m, map)).toEqual(topology(FIXTURES[2], {}));
  });
  it('two_gang_switches 1+1 equals fixture 4 (alone, both breaker sizes differ only in gauge)', () => {
    const m = build(15, [TG(1, 1)]);
    const map = {
      'b1-feed': 'feed', 'b1-gang': 'gang', 'b1-swa': 'swa', 'b1-swb': 'swb', 'b1-loada': 'loada', 'b1-loadb': 'loadb',
      'b1-hot': 'hot', 'b1-wh': 'wh', 'b1-gr': 'gr', 'b1-a-l1': 'lightabox', 'b1-b-l1': 'lightbbox', 'b1-a-light1': 'fixa', 'b1-b-light1': 'fixb',
    };
    expect(topology(m, map)).toEqual(topology(FIXTURES[3], {}));
    expect(m.connections.length).toBe(FIXTURES[3].connections.length);
  });
  it('the comparison detects a difference', () => {
    const m = build(15, [SW(1)]);
    const map = { 'b1-feed': 'feed', 'b1-load': 'load', 'b1-sw': 'swbox', 'b1-l1': 'lightbox', 'b1-switch': 'sw', 'b1-light1': 'fix', 'b1-sw-n': 'wn', 'b1-sw-g': 'gn' };
    m.connections[2].color = 'black';
    expect(topology(m, map)).not.toEqual(topology(FIXTURES[0], {}));
  });
});

// ---- exhaustive single blocks ---------------------------------------------------------------------------
describe('single blocks are clean', () => {
  for (const amps of AMPS)
    it.each(singles())(`${amps} A: %s`, (name, block) => {
      expectClean(build(amps, [block]), `${name} @ ${amps} A`);
    });
  it('uses 14 AWG at 15 A and 12 AWG at 20 A, x/3 only for the traveler cable', () => {
    for (const [amps, awg] of [[15, 14], [20, 12]] as const) {
      const m = build(amps, [TW(2), RUN(2)]);
      for (const c of m.cables) expect(c.type).toBe(c.id === 'b1-trav' ? `${awg}/3` : `${awg}/2`);
    }
  });
});

// ---- chains -----------------------------------------------------------------------------------------------
const VARIANTS: [string, BlockInput][] = [
  ['run3', RUN(3)],
  ['run3-gfci', RUN(3, true)],
  ['switch2', SW(2)],
  ['3way2', TW(2)],
  ['fan', FAN],
  ['gang2-3', TG(2, 3)],
];

const CHAINS: [string, BlockInput[]][] = [
  ['receptacle run 8', [RUN(8)]],
  ['3-way with 8 lights then receptacle run 8', [TW(8), RUN(8)]],
  ['GFCI-first run of 3, switch + light, switch + fan', [RUN(3, true), SW(1), FAN]],
  ['switch with 2 lights, receptacle run 5', [SW(2), RUN(5)]],
  ['GFCI-first run of 12, 3-way with 12 lights', [RUN(12, true), TW(12)]],
  ['run 1, run 1 GFCI, run 1', [RUN(1), RUN(1, true), RUN(1)]],
  ['3-way 3, switch 4, fan, run 6 GFCI', [TW(3), SW(4), FAN, RUN(6, true)]],
  ['fan, 3-way 1, switch 1, run 1', [FAN, TW(1), SW(1), RUN(1)]],
  ['six blocks', [RUN(2, true), SW(2), TW(2), FAN, RUN(3), SW(1)]],
  ['3-way then 3-way', [TW(2), TW(3)]],
  ['switch then switch', [SW(3), SW(5)]],
  ['2-gang 8+8 then run 8, 3-way 4, fan', [TG(8, 8), RUN(8), TW(4), FAN]],
  ['GFCI run 4, 2-gang 12+12', [RUN(4, true), TG(12, 12)]],
  ['2-gang then 2-gang', [TG(2, 1), TG(1, 3)]],
];

describe('chains are clean', () => {
  for (const amps of AMPS) {
    const pairs = VARIANTS.flatMap(([na, a]) => VARIANTS.map(([nb, b]) => [`${na} + ${nb}`, [a, b]] as [string, BlockInput[]]));
    it.each([...pairs, ...CHAINS])(`${amps} A: %s`, (name, blocks) => {
      expectClean(build(amps, blocks), `${name} @ ${amps} A`);
    });
  }
});

describe('two_gang_switches chained before and after every other block', () => {
  const OTHERS: BlockInput[] = [RUN(3), RUN(3, true), SW(2), TW(2), FAN, TG(2, 2)];
  for (const amps of AMPS)
    it(`${amps} A: every count pair, first, last and in the middle`, () => {
      for (const [a, b] of TG_PAIRS)
        for (const [i, other] of OTHERS.entries()) {
          expectClean(build(amps, [TG(a, b), other]), `gang ${a}+${b} then other ${i} @ ${amps} A`);
          expectClean(build(amps, [other, TG(a, b)]), `other ${i} then gang ${a}+${b} @ ${amps} A`);
          expectClean(build(amps, [other, TG(a, b), other]), `other ${i}, gang ${a}+${b}, other ${i} @ ${amps} A`);
        }
    });
  it('switched lights are on switched_hot, the onward feed is unswitched, grounds bonded', () => {
    const m = build(15, [TG(2, 3), RUN(2)]);
    const a = analyzeNets(m);
    for (const k of [1, 2]) expect(a.netOfTerminal(`b1-a-light${k}`, 'hot')!.role).toBe('switched_hot');
    for (const k of [1, 2, 3]) expect(a.netOfTerminal(`b1-b-light${k}`, 'hot')!.role).toBe('switched_hot');
    expect(a.netOfConductor('b2-feed', 'black')!.role).toBe('source_hot');
    expect(a.netOfTerminal('b2-rec1', 'brass')!.role).toBe('source_hot');
    expect(m.cables.find((c) => c.id === 'b2-feed')!.from).toBe('b1-gang');
    for (const sw of ['b1-swa', 'b1-swb']) expect(a.netOfTerminal(sw, 'ground')!.role).toBe('ground');
  });
  it('seeded fault: the two switch outputs crossed between the load cables is not clean for the lights', () => {
    const m: CircuitModel = JSON.parse(JSON.stringify(build(15, [TG(1, 1)])));
    for (const c of m.connections)
      for (const e of [c.a, c.b]) if (e.kind === 'terminal' && e.device === 'b1-swb' && e.terminal === 't1') e.terminal = 't2';
    expect(validateCircuit(m).length + check(m).length).toBeGreaterThan(0);
  });
});

// ---- structure --------------------------------------------------------------------------------------------
interface Shape { boxes: number; devices: number; cables: number; splices: number; connections: number }
const shapeOf = (m: CircuitModel): Shape => ({
  boxes: m.boxes.length, devices: m.devices.length, cables: m.cables.length, splices: m.splices.length, connections: m.connections.length,
});
const add = (a: Shape, b: Shape): Shape => ({ boxes: a.boxes + b.boxes, devices: a.devices + b.devices, cables: a.cables + b.cables, splices: a.splices + b.splices, connections: a.connections + b.connections });
const PANEL: Shape = { boxes: 1, devices: 3, cables: 0, splices: 0, connections: 3 };
const sub = (a: Shape, b: Shape): Shape => ({ boxes: a.boxes - b.boxes, devices: a.devices - b.devices, cables: a.cables - b.cables, splices: a.splices - b.splices, connections: a.connections - b.connections });

/** Expected counts of a block alone on a circuit, as formulas in N (see the task summary). */
function soloShape(b: BlockInput): Shape {
  const n = 'count' in b ? b.count : 1;
  switch (b.type) {
    case 'two_gang_switches': {
      // gang box + one box per light; hot, neutral and ground splices + 3 per non-last light box of each chain
      const [a, c] = [b.countA, b.countB];
      return { boxes: 2 + a + c, devices: 5 + a + c, cables: 1 + a + c, splices: 3 + 3 * (a - 1) + 3 * (c - 1), connections: 9 * (a + c) + 4 };
    }
    case 'receptacle_run':
      if (b.gfciFirst)
        return n === 1
          ? { boxes: 2, devices: 4, cables: 1, splices: 0, connections: 6 }
          : { boxes: 1 + n, devices: 3 + n, cables: n, splices: 3 * (n - 2) + 1, connections: 9 * n - 5 };
      return { boxes: 1 + n, devices: 3 + n, cables: n, splices: 3 * (n - 1), connections: 9 * n - 3 };
    case 'switch_lights':
      return { boxes: 2 + n, devices: 4 + n, cables: n + 1, splices: 3 * n - 1, connections: 9 * n + 4 };
    case 'three_way_lights':
      return { boxes: 3 + n, devices: 5 + n, cables: n + 2, splices: 3 * n + 1, connections: 9 * n + 13 };
    case 'switch_fan':
      return { boxes: 3, devices: 5, cables: 2, splices: 2, connections: 13 };
  }
}
/** What a block gains when another block follows it (its feed-through box takes a splice and pigtail). */
function onwardDelta(b: BlockInput): Shape {
  const z = { boxes: 0, devices: 0, cables: 0 };
  // the onward black, white and bare join the existing splices of the 2-gang box: three connections, no new splice
  if (b.type === 'two_gang_switches') return { ...z, splices: 0, connections: 3 };
  if (b.type === 'receptacle_run') {
    if (b.gfciFirst && b.count === 1) return { ...z, splices: 1, connections: 4 };
    return { ...z, splices: 3, connections: 6 };
  }
  return { ...z, splices: 1, connections: 4 };
}

describe('structure', () => {
  it.each(singles())('%s: counts match the formulas', (_n, block) => {
    expect(shapeOf(build(15, [block]))).toEqual(add(soloShape(block), { boxes: 0, devices: 0, cables: 0, splices: 0, connections: 0 }));
  });

  it('chain counts are the sum of the blocks plus the onward splices', () => {
    for (const chain of [[RUN(8)], ...CHAINS.map(([, c]) => c)]) {
      let want: Shape = PANEL;
      chain.forEach((b, i) => {
        let s = sub(soloShape(b), PANEL);
        if (i < chain.length - 1) s = add(s, onwardDelta(b));
        want = add(want, s);
      });
      expect(shapeOf(build(20, chain))).toEqual(want);
    }
  });

  const roles = (m: CircuitModel, device: string, terminal: string): NetRole | undefined => analyzeNets(m).netOfTerminal(device, terminal)?.role;

  it('every receptacle after a GFCI-first is protected, including later blocks; the GFCI line side is not', () => {
    const m = build(20, [RUN(5, true), SW(2), RUN(3)]);
    const a = analyzeNets(m);
    expect(a.netOfTerminal('b1-rec1', 'line_hot')!.role).toBe('source_hot');
    for (let k = 2; k <= 5; k++) {
      expect(roles(m, `b1-rec${k}`, 'brass')).toBe('protected_hot');
      expect(roles(m, `b1-rec${k}`, 'silver')).toBe('protected_neutral');
    }
    for (let k = 1; k <= 3; k++) expect(roles(m, `b3-rec${k}`, 'brass')).toBe('protected_hot');
    expect(roles(m, 'b2-switch', 't1')).toBe('protected_hot');
    // a switched light behind a GFCI is classed protected_hot (the analysis ranks protected above switched)
    expect(roles(m, 'b2-light1', 'hot')).toBe('protected_hot');
  });

  it('without gfciFirst every receptacle is on the unswitched source hot', () => {
    const m = build(15, [RUN(6)]);
    for (let k = 1; k <= 6; k++) expect(roles(m, `b1-rec${k}`, 'brass')).toBe('source_hot');
  });

  it('switched lights and fans are on switched_hot; onward feeds are never switched', () => {
    const m = build(15, [SW(4), TW(3), FAN, RUN(3)]);
    for (let k = 1; k <= 4; k++) expect(roles(m, `b1-light${k}`, 'hot')).toBe('switched_hot');
    for (let k = 1; k <= 3; k++) expect(roles(m, `b2-light${k}`, 'hot')).toBe('switched_hot');
    expect(roles(m, 'b3-fan-dev', 'hot')).toBe('switched_hot');
    for (let k = 1; k <= 3; k++) expect(roles(m, `b4-rec${k}`, 'brass')).toBe('source_hot');
    // the onward feed leaves each switch box on the same net as the incoming hot, not on a switch terminal
    for (const [cable, from] of [['b2-feed', 'b1-sw'], ['b3-feed', 'b2-sw1'], ['b4-feed', 'b3-sw']] as const) {
      expect(m.cables.find((c) => c.id === cable)!.from).toBe(from);
      expect(analyzeNets(m).netOfConductor(cable, 'black')!.role).toBe('source_hot');
    }
  });

  it('every device ground and every neutral terminal reaches the panel bars', () => {
    const m = build(20, [RUN(3, true), SW(3), TW(3), FAN]);
    const a = analyzeNets(m);
    for (const d of m.devices)
      for (const t of CATALOGUE[d.type].terminals) {
        const net = a.netOfTerminal(d.id, t.name);
        if (!net) continue; // unwired GFCI load terminals do not occur here
        if (t.role === 'ground') expect(net.role, `${d.id}.${t.name}`).toBe('ground');
        if (t.role === 'neutral') expect(['neutral', 'protected_neutral'], `${d.id}.${t.name}`).toContain(net.role);
      }
  });

  it('ids are unique and readable, the block index is in them, labels are numbered across the circuit', () => {
    const m = build(15, [RUN(2), SW(2), RUN(1, true), TW(2), FAN]);
    expect(new Set(m.devices.map((d) => d.id)).size).toBe(m.devices.length);
    expect(m.devices.filter((d) => d.id.startsWith('b1-')).map((d) => d.id)).toEqual(['b1-rec1', 'b1-rec2']);
    expect(m.devices.map((d) => d.label)).toEqual([
      '15A breaker', 'Neutral bar', 'Ground bar',
      'Receptacle 1', 'Receptacle 2', 'Switch 1', 'Light 1', 'Light 2', 'GFCI 3',
      '3-way switch 2', '3-way switch 3', 'Light 3', 'Light 4', 'Switch 4', 'Fan 1',
    ]);
    expect(m.boxes.map((b) => b.label)).toEqual([
      'Panel', 'Receptacle box 1', 'Receptacle box 2', 'Switch box 1', 'Light box 1', 'Light box 2',
      'Receptacle box 3', '3-way box 2', '3-way box 3', 'Light box 3', 'Light box 4', 'Switch box 4', 'Fan box 1',
    ]);
  });

  it('labels never change topology', () => {
    const plain = build(15, [RUN(3, true), SW(2), TW(2), FAN]);
    const named = build(15, [
      { type: 'receptacle_run', count: 3, gfciFirst: true, receptacleLabel: 'Outlet', gfciLabel: 'GF', boxLabel: 'Box' },
      { type: 'switch_lights', count: 2, switchLabel: 'S', switchBoxLabel: 'SB', lightLabel: 'L', lightBoxLabel: 'LB' },
      { type: 'three_way_lights', count: 2, switchLabel: 'S3', switchBoxLabel: 'B3', lightLabel: 'L', lightBoxLabel: 'LB' },
      { type: 'switch_fan', switchLabel: 'S', switchBoxLabel: 'SB', fanLabel: 'F', fanBoxLabel: 'FB' },
    ]);
    expect(topology(named, {})).toEqual(topology(plain, {}));
    expect(named.devices.some((d) => d.label === 'Outlet 2')).toBe(true);
  });

  it('is deterministic', () => {
    expect(build(20, [RUN(4, true), TW(3)])).toEqual(build(20, [RUN(4, true), TW(3)]));
  });
});

// ---- seeded faults ----------------------------------------------------------------------------------------
describe('breaking one wire of a block-built circuit is caught', () => {
  const clone = (m: CircuitModel): CircuitModel => JSON.parse(JSON.stringify(m));
  const ruleIds = (m: CircuitModel) => new Set(check(m).map((f) => f.ruleId));
  const connection = (m: CircuitModel, pred: (a: Endpoint, b: Endpoint) => boolean) => {
    const c = m.connections.find((x) => pred(x.a, x.b) || pred(x.b, x.a));
    if (!c) throw new Error('no such connection');
    return c;
  };
  const isTerm = (e: Endpoint, device: string, terminal: string) => e.kind === 'terminal' && e.device === device && e.terminal === terminal;

  it('a pigtail ground removed from a receptacle', () => {
    const m = clone(build(15, [RUN(3), SW(1)]));
    const c = connection(m, (a, b) => isTerm(b, 'b1-rec2', 'ground') && a.kind === 'splice');
    m.connections.splice(m.connections.indexOf(c), 1);
    expect(ruleIds(m)).toContain('ground-continuity');
  });

  it('hot and neutral pigtails swapped on a receptacle', () => {
    const m = clone(build(20, [RUN(3)]));
    for (const c of m.connections)
      for (const e of [c.a, c.b])
        if (e.kind === 'terminal' && e.device === 'b1-rec2' && (e.terminal === 'brass' || e.terminal === 'silver')) e.terminal = e.terminal === 'brass' ? 'silver' : 'brass';
    const ids = ruleIds(m);
    expect(ids.has('load-fed') || ids.has('neutral-continuity')).toBe(true);
  });

  it('the GFCI feed swapped onto LOAD', () => {
    const m = clone(build(20, [RUN(3, true)]));
    for (const c of m.connections)
      for (const e of [c.a, c.b]) if (e.kind === 'terminal' && e.device === 'b1-rec1') e.terminal = { line_hot: 'load_hot', line_neutral: 'load_neutral', load_hot: 'line_hot', load_neutral: 'line_neutral' }[e.terminal] ?? e.terminal;
    expect(ruleIds(m)).toContain('gfci-orientation');
  });

  it('a 3-way common and traveler crossed at the second switch', () => {
    const m = clone(build(15, [TW(3)]));
    for (const c of m.connections)
      for (const e of [c.a, c.b])
        if (e.kind === 'terminal' && e.device === 'b1-switch2' && (e.terminal === 'common' || e.terminal === 'traveler_a')) e.terminal = e.terminal === 'common' ? 'traveler_a' : 'common';
    expect(ruleIds(m)).toContain('three-way-pairing');
  });

  it('hot and neutral swapped on the last light', () => {
    const m = clone(build(15, [SW(2)]));
    for (const c of m.connections)
      for (const e of [c.a, c.b])
        if (e.kind === 'terminal' && e.device === 'b1-light2' && (e.terminal === 'hot' || e.terminal === 'neutral')) e.terminal = e.terminal === 'hot' ? 'neutral' : 'hot';
    expect(ruleIds(m).has('load-fed')).toBe(true);
  });

  it('hot and neutral reversed on the fan is reported by load-fed', () => {
    const m = clone(build(15, [FAN]));
    for (const c of m.connections)
      for (const e of [c.a, c.b])
        if (e.kind === 'terminal' && e.device === 'b1-fan-dev' && (e.terminal === 'hot' || e.terminal === 'neutral')) e.terminal = e.terminal === 'hot' ? 'neutral' : 'hot';
    const f = check(m).filter((x) => x.ruleId === 'load-fed');
    expect(f).toHaveLength(1);
    expect(f[0]!.involved).toEqual(['b1-fan-dev']);
  });

  it('a fan whose hot is not fed from the breaker is reported by load-fed', () => {
    // Simply dropping the fan's hot wire is a structural fault (the rules do not run), so the fan's cable is
    // landed on the wrong screws at the switch end: the fan's hot conductor then rides on the neutral.
    const m = clone(build(15, [FAN]));
    for (const c of m.connections)
      for (const e of [c.a, c.b])
        if (e.kind === 'conductor' && e.cable === 'b1-load' && e.box === 'b1-sw' && (e.color === 'black' || e.color === 'white')) e.color = e.color === 'black' ? 'white' : 'black';
    expect(validateCircuit(m)).toEqual([]);
    const f = check(m).filter((x) => x.ruleId === 'load-fed');
    expect(f).toHaveLength(1);
    expect(f[0]!.involved).toEqual(['b1-fan-dev']);
  });

  it('a 20 A breaker on 14 AWG cable', () => {
    const m = clone(build(15, [RUN(2)]));
    m.devices.find((d) => d.type === 'breaker')!.amps = 20;
    expect(ruleIds(m)).toContain('breaker-conductor-match');
  });
});

// ---- invalid parameters -------------------------------------------------------------------------------------
describe('invalid parameters are rejected with clear errors', () => {
  const spec = (blocks: unknown, breakerAmps: unknown = 15) => ({ id: 't', title: 't', breakerAmps, blocks }) as never;
  it.each([
    ['count 0', [{ type: 'receptacle_run', count: 0 }], /count must be at least 1/],
    ['count 13', [{ type: 'switch_lights', count: 13 }], /count must be at most 12/],
    ['count 1.5', [{ type: 'three_way_lights', count: 1.5 }], /whole number/],
    ['missing count', [{ type: 'receptacle_run' }], /count/],
    ['empty block list', [], /at least one block is required/],
    ['unknown type', [{ type: 'four_way', count: 1 }], /blocks\.0/],
    ['blank label', [{ type: 'switch_fan', fanLabel: '  ' }], /must not be blank/],
    ['unknown key', [{ type: 'switch_fan', count: 2 }], /count/],
    ['7 blocks', Array.from({ length: 7 }, () => ({ type: 'switch_fan' })), /at most 6 blocks/],
  ])('%s', (_n, blocks, message) => {
    expect(() => buildCircuit(spec(blocks))).toThrow(message);
  });
  it('bad breaker size', () => {
    expect(() => buildCircuit(spec([{ type: 'switch_fan' }], 30))).toThrow(/breakerAmps must be 15 or 20/);
  });
  it('error text says it is an invalid circuit specification', () => {
    expect(() => buildCircuit(spec([]))).toThrow(/^invalid circuit specification:/);
  });
});

// ---- registry and fixtures ------------------------------------------------------------------------------------
describe('registry', () => {
  it('lists each block with text, and its schema accepts a minimal block', () => {
    expect(BUILDING_BLOCKS.map((b) => b.id)).toEqual(['receptacle_run', 'switch_lights', 'three_way_lights', 'switch_fan', 'two_gang_switches']);
    for (const b of BUILDING_BLOCKS) {
      for (const f of [b.title, b.description, b.appliesWhen, b.notFor]) expect(f.trim().length).toBeGreaterThan(10);
      expect(getBlock(b.id)).toBe(b);
      const minimal = b.id === 'two_gang_switches' ? { type: b.id, countA: 1, countB: 1 } : { type: b.id, count: 1 };
      expect(b.paramsSchema.safeParse(minimal).success || b.id === 'switch_fan').toBe(true);
    }
    expect(getBlock('nope')).toBeUndefined();
  });
});

describe('BLOCK_FIXTURES', () => {
  it('has the four named circuits, all clean', () => {
    expect(BLOCK_FIXTURES.map((f) => f.name)).toEqual(['receptacle-run-8', 'three-way-8-lights', 'bathroom', 'bedroom']);
    for (const f of BLOCK_FIXTURES) expectClean(f.circuit, f.name);
    const amps = (name: string) => BLOCK_FIXTURES.find((f) => f.name === name)!.circuit.devices.find((d) => d.type === 'breaker')!.amps;
    expect([amps('receptacle-run-8'), amps('three-way-8-lights'), amps('bathroom'), amps('bedroom')]).toEqual([20, 15, 20, 15]);
  });
});
