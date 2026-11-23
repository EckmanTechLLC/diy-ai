import { describe, expect, it } from 'vitest';
import checklist from '../../../docs/rules/nec-2023-planner-citations.md?raw';
import {
  ROOM_RULES,
  buildCircuit,
  checkCircuit,
  planCircuits,
  plannerCitationChecklistMarkdown,
  validateCircuit,
  validateInventory,
  type InventoryInput,
  type Plan,
  type PlanOptions,
  type RoomInput,
} from '../src';

const room = (r: Partial<RoomInput> & Pick<RoomInput, 'id' | 'type'>): RoomInput => ({
  name: r.id,
  receptacles: 0,
  lightGroups: [],
  fans: 0,
  attachedTo: '',
  ...r,
});
const L = (lights: number, switchLocations: 1 | 2 = 1) => ({ lights, switchLocations });

const living = room({ id: 'living', name: 'Living area', type: 'living_area', receptacles: 8, lightGroups: [L(8, 2)] });
const bath = room({ id: 'bath', name: 'Bathroom', type: 'bathroom', receptacles: 3, lightGroups: [L(1)], fans: 1 });
const closet = room({ id: 'closet', name: 'Closet', type: 'closet', lightGroups: [L(1)] });
const bedroom = room({ id: 'bed', name: 'Bedroom', type: 'bedroom', receptacles: 5, lightGroups: [L(2)] });
const basement = (rooms: RoomInput[], b = true): InventoryInput => ({ basement: b, rooms });
const USER = basement([living, bath, closet, bedroom]);
const USER_ATTACHED = basement([living, bath, { ...closet, attachedTo: 'bed' }, bedroom]);

const find = (p: Plan, name: string) => p.circuits.find((c) => c.name === name)!;
const names = (p: Plan) => p.circuits.map((c) => c.name);

/** Every circuit builds, is structurally valid, and has no rule errors. */
function expectSound(p: Plan) {
  for (const c of p.circuits) {
    const model = buildCircuit({ id: c.name, title: c.name, breakerAmps: c.breakerAmps, blocks: c.blocks });
    expect(validateCircuit(model), c.name).toEqual([]);
    expect(checkCircuit(model, { edition: 'nec-2023' }).filter((f) => f.severity === 'error'), c.name).toEqual([]);
  }
}

describe('inventory validation', () => {
  it('accepts the user basement', () => expect(validateInventory(USER)).toEqual([]));
  it('reports duplicate ids, unknown and self attachedTo, empty rooms, no rooms', () => {
    const codes = (i: unknown) => validateInventory(i).map((x) => x.code);
    expect(codes(basement([living, { ...bath, id: 'living' }]))).toContain('DUPLICATE_ID');
    expect(codes(basement([{ ...closet, attachedTo: 'nope' }]))).toContain('UNKNOWN_ATTACHED_TO');
    expect(codes(basement([{ ...closet, attachedTo: 'closet' }]))).toContain('SELF_ATTACHED');
    expect(codes(basement([room({ id: 'x', type: 'bedroom' })]))).toContain('EMPTY_ROOM');
    expect(codes(basement([]))).toContain('NO_ROOMS');
  });
  it('reports counts out of range with readable messages', () => {
    const msgs = (r: Partial<RoomInput>) => validateInventory(basement([{ ...living, ...r }])).map((x) => x.message).join(' | ');
    expect(msgs({ receptacles: 25 })).toMatch(/receptacles.*at most 24/);
    expect(msgs({ receptacles: -1 })).toMatch(/receptacles.*at least 0/);
    expect(msgs({ receptacles: 1.5 })).toMatch(/receptacles.*whole number/);
    expect(msgs({ lightGroups: [L(13)] })).toMatch(/lights.*at most 12/);
    expect(msgs({ lightGroups: [L(0)] })).toMatch(/lights.*at least 1/);
    expect(msgs({ lightGroups: [{ lights: 2, switchLocations: 3 as 1 }] })).toMatch(/switchLocations must be 1 or 2/);
    expect(msgs({ fans: 3 })).toMatch(/fans.*at most 2/);
    expect(msgs({ type: 'garage' as 'other' })).toMatch(/type must be one of/);
  });
  it('planCircuits throws on an invalid inventory or options', () => {
    expect(() => planCircuits(basement([]))).toThrow(/invalid inventory/);
    expect(() => planCircuits(USER, { maxReceptaclesPerCircuit: 0 })).toThrow(/invalid plan options/);
    expect(() => planCircuits(USER, { lightingBreakerAmps: 30 as 15 })).toThrow(/invalid plan options/);
    expect(() => planCircuits(USER, { assumedLoads: { lightVa: -1 } })).toThrow(/invalid plan options/);
  });
});

describe('the user basement', () => {
  const plan = planCircuits(USER);
  it('circuit list and order', () => {
    expect(names(plan)).toEqual(['Bathroom', 'Bedroom', 'Lighting 1', 'Receptacles 1']);
  });
  it('bathroom: 20 A, light, fan, GFCI run, no AFCI', () => {
    const c = find(plan, 'Bathroom');
    expect(c.breakerAmps).toBe(20);
    expect(c.blocks).toEqual([
      { type: 'switch_lights', count: 1 },
      { type: 'switch_fan' },
      { type: 'receptacle_run', count: 3, gfciFirst: true },
    ]);
    expect(c.protection).toEqual({ gfci: 'first-receptacle', afci: false });
    expect(c.plannedLoadVa).toBe(3 * 180 + 60 + 100);
    expect(c.capacityVa).toBe(1920);
    expect(c.rooms).toEqual([{ id: 'bath', name: 'Bathroom', receptacles: 3, lightGroups: 1, lights: 1, fans: 1 }]);
  });
  it('bedroom: 15 A shared by lights and receptacles, GFCI and AFCI', () => {
    const c = find(plan, 'Bedroom');
    expect(c.breakerAmps).toBe(15);
    expect(c.blocks).toEqual([
      { type: 'switch_lights', count: 2 },
      { type: 'receptacle_run', count: 5, gfciFirst: true },
    ]);
    expect(c.protection).toEqual({ gfci: 'first-receptacle', afci: true });
    expect(c.plannedLoadVa).toBe(5 * 180 + 2 * 60);
    expect(c.capacityVa).toBe(1440);
  });
  it('lighting 1: living 3-way group plus closet light on 15 A', () => {
    const c = find(plan, 'Lighting 1');
    expect(c.breakerAmps).toBe(15);
    expect(c.blocks).toEqual([
      { type: 'three_way_lights', count: 8 },
      { type: 'switch_lights', count: 1 },
    ]);
    expect(c.protection).toEqual({ gfci: 'none', afci: true });
    expect(c.plannedLoadVa).toBe(9 * 60);
    expect(c.rooms.map((r) => r.id)).toEqual(['living', 'closet']);
  });
  it('receptacles 1: living 8 receptacles on 20 A', () => {
    const c = find(plan, 'Receptacles 1');
    expect(c.breakerAmps).toBe(20);
    expect(c.blocks).toEqual([{ type: 'receptacle_run', count: 8, gfciFirst: true }]);
    expect(c.protection).toEqual({ gfci: 'first-receptacle', afci: true });
    expect(c.plannedLoadVa).toBe(1440);
  });
  it('no findings, nothing not covered, four reminders, stated assumptions', () => {
    expect(plan.findings).toEqual([]);
    expect(plan.notCovered).toEqual([]);
    expect(plan.reminders).toHaveLength(4);
    expect(plan.assumptions.loads).toEqual({ receptacleVa: 180, lightVa: 60, fanVa: 100 });
    expect(plan.assumptions.maxReceptaclesPerCircuit).toBe(8);
    expect(plan.assumptions.lightingBreakerAmps).toBe(15);
  });
  it('every circuit is sound', () => expectSound(plan));
  it('every decision has a reason, and rule and default reasons are distinguishable', () => {
    for (const c of plan.circuits) {
      const ruleIds = c.reasons.filter((r) => r.kind === 'rule').map((r) => r.ruleId);
      expect(c.reasons.some((r) => r.kind === 'default'), c.name).toBe(true);
      expect(ruleIds, c.name).toContain('planned-load');
      expect(ruleIds, c.name).toContain('afci-living-areas');
      expect(ruleIds.some((id) => id === 'bath-gfci' || id === 'basement-gfci'), c.name).toBe(true);
      for (const r of c.reasons) {
        expect(r.text.length).toBeGreaterThan(10);
        if (r.kind === 'rule') expect(ROOM_RULES.map((x) => x.id)).toContain(r.ruleId);
        else expect(r.ruleId).toBeUndefined();
      }
    }
    expect(find(plan, 'Bathroom').reasons.map((r) => r.ruleId)).toEqual(
      expect.arrayContaining(['bath-receptacle-circuit', 'bath-gfci', 'basement-gfci']),
    );
  });
});

describe('the user basement with the closet attached to the bedroom', () => {
  const plan = planCircuits(USER_ATTACHED);
  it('closet light joins the bedroom circuit; lighting holds only the living group', () => {
    expect(names(plan)).toEqual(['Bathroom', 'Bedroom', 'Lighting 1', 'Receptacles 1']);
    const bed = find(plan, 'Bedroom');
    expect(bed.blocks).toEqual([
      { type: 'switch_lights', count: 2 },
      { type: 'switch_lights', count: 1 },
      { type: 'receptacle_run', count: 5, gfciFirst: true },
    ]);
    expect(bed.plannedLoadVa).toBe(5 * 180 + 3 * 60);
    expect(bed.rooms.map((r) => r.id)).toEqual(['bed', 'closet']);
    expect(find(plan, 'Lighting 1').blocks).toEqual([{ type: 'three_way_lights', count: 8 }]);
    expect(find(plan, 'Lighting 1').plannedLoadVa).toBe(480);
    expect(find(plan, 'Receptacles 1').blocks).toEqual([{ type: 'receptacle_run', count: 8, gfciFirst: true }]);
    expect(find(plan, 'Bathroom').blocks).toEqual(planCircuits(USER).circuits[0]!.blocks);
    expectSound(plan);
  });
});

describe('each rule and default', () => {
  it('two bathrooms give two circuits', () => {
    const p = planCircuits(basement([bath, { ...bath, id: 'bath2', name: 'Bath 2' }], false));
    expect(names(p)).toEqual(['Bathroom', 'Bath 2']);
    expect(p.circuits.every((c) => c.breakerAmps === 20 && c.rooms.length === 1)).toBe(true);
    expectSound(p);
  });
  it('two rooms with the same name get distinct circuit names', () => {
    const p = planCircuits(basement([bath, { ...bath, id: 'bath2' }], false));
    expect(names(p)).toEqual(['Bathroom', 'Bathroom 2']);
  });
  it('non-basement: GFCI only in the bathroom', () => {
    const p = planCircuits(basement([living, bath, bedroom], false));
    expect(find(p, 'Bathroom').protection.gfci).toBe('first-receptacle');
    for (const n of ['Bedroom', 'Receptacles 1']) {
      expect(find(p, n).protection.gfci).toBe('none');
      expect(JSON.stringify(find(p, n).blocks)).toContain('"gfciFirst":false');
    }
    expectSound(p);
  });
  it('a lights-only circuit in a basement needs no GFCI', () => {
    const p = planCircuits(basement([room({ id: 'h', type: 'hallway', lightGroups: [L(2)] })]));
    expect(p.circuits[0]!.protection).toEqual({ gfci: 'none', afci: true });
  });
  it('AFCI on living, bedroom, closet, hallway; not on a bathroom', () => {
    const p = planCircuits(basement([room({ id: 'h', type: 'hallway', lightGroups: [L(2)] }), bath], false));
    expect(find(p, 'Lighting 1').protection.afci).toBe(true);
    expect(find(p, 'Bathroom').protection.afci).toBe(false);
  });
  it('a bedroom too large to share splits: lights stay 15 A, receptacles go to a 20 A circuit', () => {
    const big = room({ id: 'bed', name: 'Bedroom', type: 'bedroom', receptacles: 9, lightGroups: [L(2)] });
    const p = planCircuits(basement([big], false));
    expect(names(p)).toEqual(['Bedroom', 'Receptacles 1', 'Receptacles 2']);
    expect(find(p, 'Bedroom').blocks).toEqual([{ type: 'switch_lights', count: 2 }]);
    expect(find(p, 'Bedroom').breakerAmps).toBe(15);
    expect(find(p, 'Receptacles 1').breakerAmps).toBe(20);
    expect(find(p, 'Receptacles 1').blocks).toEqual([{ type: 'receptacle_run', count: 8, gfciFirst: false }]);
    expect(find(p, 'Receptacles 2').blocks).toEqual([{ type: 'receptacle_run', count: 1, gfciFirst: false }]);
    expectSound(p);
  });
  it('a bedroom over 80 % of 15 A splits (8 receptacles + lights = 1500 VA)', () => {
    const p = planCircuits(basement([room({ id: 'b', name: 'Bed', type: 'bedroom', receptacles: 8, lightGroups: [L(1)] })], false));
    expect(names(p)).toEqual(['Bed', 'Receptacles 1']);
  });
  it('20 receptacles give three circuits (8, 8, 4)', () => {
    const p = planCircuits(basement([room({ id: 'l', type: 'living_area', receptacles: 20, lightGroups: [L(1)] })], false));
    expect(p.circuits.filter((c) => c.name.startsWith('Receptacles')).map((c) => c.blocks)).toEqual([
      [{ type: 'receptacle_run', count: 8, gfciFirst: false }],
      [{ type: 'receptacle_run', count: 8, gfciFirst: false }],
      [{ type: 'receptacle_run', count: 4, gfciFirst: false }],
    ]);
    expect(p.circuits).toHaveLength(4);
    expectSound(p);
  });
  it('receptacles pack across rooms in inventory order', () => {
    const a = room({ id: 'a', type: 'living_area', receptacles: 5, lightGroups: [L(1)] });
    const b = room({ id: 'b', type: 'hallway', receptacles: 5, lightGroups: [L(1)] });
    const p = planCircuits(basement([a, b], false));
    expect(find(p, 'Receptacles 1').rooms.map((r) => [r.id, r.receptacles])).toEqual([['a', 5], ['b', 3]]);
    expect(find(p, 'Receptacles 2').rooms.map((r) => [r.id, r.receptacles])).toEqual([['b', 2]]);
  });
  it('lighting overflows onto a new circuit at 80 % of 15 A (1440 VA = 24 lights)', () => {
    const rooms = [1, 2, 3].map((i) => room({ id: `r${i}`, type: 'living_area', lightGroups: [L(12), L(12)] }));
    const p = planCircuits(basement(rooms, false));
    expect(names(p)).toEqual(['Lighting 1', 'Lighting 2', 'Lighting 3']);
    expect(p.circuits.map((c) => c.plannedLoadVa)).toEqual([1440, 1440, 1440]);
    expectSound(p);
  });
  it('lighting overflows on the block limit', () => {
    const p = planCircuits(basement([room({ id: 'h', type: 'hallway', lightGroups: Array.from({ length: 7 }, () => L(1)) })], false));
    expect(p.circuits.map((c) => c.blocks.length)).toEqual([6, 1]);
    expectSound(p);
  });
  it('fans in a living area join the lighting circuit after its lights', () => {
    const p = planCircuits(basement([room({ id: 'l', type: 'living_area', lightGroups: [L(2)], fans: 2 })], false));
    expect(p.circuits[0]!.blocks).toEqual([{ type: 'switch_lights', count: 2 }, { type: 'switch_fan' }, { type: 'switch_fan' }]);
  });
  it('a bathroom too large for one circuit continues on a second', () => {
    const p = planCircuits(basement([room({ id: 'b', name: 'Bath', type: 'bathroom', receptacles: 12, lightGroups: [L(1)], fans: 1 })], false));
    expect(names(p)).toEqual(['Bath', 'Bath 2']);
    expect(p.circuits.every((c) => c.breakerAmps === 20)).toBe(true);
    expectSound(p);
  });
  it('other rooms are not covered and left out of every circuit', () => {
    const p = planCircuits(basement([living, room({ id: 'k', name: 'Kitchen', type: 'other', receptacles: 6, lightGroups: [L(2)] })]));
    expect(p.notCovered).toHaveLength(1);
    expect(p.notCovered[0]).toMatchObject({ roomId: 'k', roomName: 'Kitchen' });
    expect(p.notCovered[0]!.reason).toMatch(/not planned yet/);
    expect(p.circuits.flatMap((c) => c.rooms.map((r) => r.id))).not.toContain('k');
    expect(p.findings).toEqual([]);
  });
  it('a room without a switched light gets a warning citing the rule', () => {
    const p = planCircuits(basement([room({ id: 'g', name: 'Gym', type: 'living_area', receptacles: 2 })], false));
    expect(p.findings).toHaveLength(1);
    expect(p.findings[0]).toMatchObject({ ruleId: 'switched-light', severity: 'warning', roomIds: ['g'] });
    expect(p.findings[0]!.citation).toEqual({ edition: 'nec-2023', section: '210.70(A)', confirmed: false });
    expect(find(p, 'Receptacles 1').blocks).toEqual([{ type: 'receptacle_run', count: 2, gfciFirst: false }]);
  });
  it('an attachment other than a closet to a bedroom is ignored and noted', () => {
    const p = planCircuits(basement([living, { ...closet, attachedTo: 'living' }], false));
    expect(p.assumptions.notes.join(' ')).toMatch(/attachment is ignored/);
    expect(find(p, 'Lighting 1').rooms.map((r) => r.id)).toEqual(['living', 'closet']);
  });
});

describe('overrides', () => {
  it('maxReceptaclesPerCircuit changes the packing and is reported as a changed default', () => {
    const p = planCircuits(basement([room({ id: 'l', type: 'living_area', receptacles: 10, lightGroups: [L(1)] })], false), { maxReceptaclesPerCircuit: 5 });
    expect(p.circuits.filter((c) => c.name.startsWith('Receptacles'))).toHaveLength(2);
    expect(find(p, 'Receptacles 1').reasons.some((r) => r.kind === 'default' && /changed the default of 8/.test(r.text))).toBe(true);
    expect(p.assumptions.maxReceptaclesPerCircuit).toBe(5);
  });
  it('lightingBreakerAmps 20 gives 20 A lighting circuits with 1920 VA capacity', () => {
    const p = planCircuits(basement([room({ id: 'l', type: 'living_area', lightGroups: [L(12), L(12), L(8)] })], false), { lightingBreakerAmps: 20 });
    expect(p.circuits).toHaveLength(1);
    expect(p.circuits[0]).toMatchObject({ breakerAmps: 20, capacityVa: 1920, plannedLoadVa: 1920 });
    expect(p.circuits[0]!.reasons.some((r) => r.kind === 'default' && /changed the default of 15/.test(r.text))).toBe(true);
    expectSound(p);
  });
  it('assumed loads change loads and are reported; a run over 12 splits into runs', () => {
    const opts: PlanOptions = { maxReceptaclesPerCircuit: 24, assumedLoads: { receptacleVa: 100 } };
    const p = planCircuits(basement([room({ id: 'l', type: 'living_area', receptacles: 24, lightGroups: [L(1)] })]), opts);
    const c = find(p, 'Receptacles 1');
    expect(c.blocks).toEqual([
      { type: 'receptacle_run', count: 12, gfciFirst: true },
      { type: 'receptacle_run', count: 7, gfciFirst: false },
    ]);
    expect(c.plannedLoadVa).toBe(1900);
    expect(c.reasons.some((r) => r.kind === 'default' && /receptacle 100 VA \(default 180\)/.test(r.text))).toBe(true);
    expect(p.assumptions.loads.receptacleVa).toBe(100);
    expectSound(p);
  });
  it('an item that alone exceeds capacity is placed alone and reported as an error finding', () => {
    const p = planCircuits(basement([room({ id: 'l', type: 'living_area', lightGroups: [L(12)] })], false), { assumedLoads: { lightVa: 200 } });
    expect(p.circuits[0]!.plannedLoadVa).toBe(2400);
    expect(p.findings.map((f) => [f.ruleId, f.severity])).toEqual([['planned-load', 'error']]);
  });
});

describe('determinism and ordering', () => {
  it('same input twice gives deep-equal output, and the input is not mutated', () => {
    const input: InventoryInput = JSON.parse(JSON.stringify(USER_ATTACHED));
    expect(planCircuits(input)).toEqual(planCircuits(USER_ATTACHED));
    expect(input).toEqual(USER_ATTACHED);
  });
  it('input with attachedTo omitted behaves as empty', () => {
    const rooms = USER.rooms.map(({ attachedTo: _a, ...r }) => r) as RoomInput[];
    expect(planCircuits({ basement: true, rooms })).toEqual(planCircuits(USER));
  });
  it('reordering rooms changes only the order the policy says', () => {
    const a = planCircuits(basement([living, bath, closet, bedroom]));
    const b = planCircuits(basement([bedroom, closet, bath, living]));
    expect(names(b)).toEqual(['Bedroom', 'Bathroom', 'Lighting 1', 'Receptacles 1']);
    expect(find(b, 'Bathroom')).toEqual(find(a, 'Bathroom'));
    expect(find(b, 'Bedroom')).toEqual(find(a, 'Bedroom'));
    expect(find(b, 'Lighting 1').blocks).toEqual([...find(a, 'Lighting 1').blocks].reverse());
    expect(find(b, 'Receptacles 1')).toEqual(find(a, 'Receptacles 1'));
  });
});

describe('planner rule registry and checklist', () => {
  it('every rule is NEC 2023, unconfirmed, with a citation or an explicit none', () => {
    expect(ROOM_RULES.map((r) => r.id)).toEqual([
      'bath-receptacle-circuit',
      'bath-gfci',
      'basement-gfci',
      'afci-living-areas',
      'switched-light',
      'planned-load',
    ]);
    for (const r of ROOM_RULES) {
      expect(r.citation.edition).toBe('nec-2023');
      expect(r.citation.confirmed).toBe(false);
      expect(r.citation.section === null || /^210\.\d+(\([A-Z0-9]+\))*$/.test(r.citation.section)).toBe(true);
    }
    expect(ROOM_RULES.find((r) => r.id === 'planned-load')!.citation.section).toBeNull();
    expect(ROOM_RULES.find((r) => r.id === 'switched-light')!.severity).toBe('warning');
  });
  it('the checklist document matches the registry', () => {
    expect(checklist).toBe(plannerCitationChecklistMarkdown());
    expect(checklist.split('\n').filter((l) => l.startsWith('| `')).every((l) => l.endsWith('| no |'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('property sweep over generated inventories', () => {
  function rng(seed: number) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const TYPES = ['living_area', 'bedroom', 'closet', 'hallway', 'bathroom', 'other'] as const;

  it('150 seeded inventories: conservation, limits, build, validate, rules', () => {
    const rand = rng(28);
    const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
    for (let n = 0; n < 150; n++) {
      const count = int(1, 6);
      const rooms: RoomInput[] = [];
      for (let i = 0; i < count; i++) {
        const type = TYPES[int(0, TYPES.length - 1)]!;
        let r = room({
          id: `r${i}`,
          type,
          receptacles: int(0, 14),
          lightGroups: Array.from({ length: int(0, 3) }, () => L(int(1, 12), int(1, 2) as 1 | 2)),
          fans: int(0, 2),
        });
        if (r.receptacles === 0 && r.lightGroups!.length === 0 && r.fans === 0) r = { ...r, receptacles: 1 };
        const beds = rooms.filter((x) => x.type === 'bedroom');
        if (type === 'closet' && beds.length > 0 && rand() < 0.7) r = { ...r, attachedTo: beds[int(0, beds.length - 1)]!.id };
        rooms.push(r);
      }
      const inv = basement(rooms, rand() < 0.5);
      const options: PlanOptions = {
        maxReceptaclesPerCircuit: rand() < 0.5 ? undefined : int(2, 10),
        lightingBreakerAmps: rand() < 0.5 ? 15 : 20,
      };
      expect(validateInventory(inv), `case ${n}`).toEqual([]);
      const p = planCircuits(inv, options);

      // conservation: every item of every covered room appears exactly once
      for (const r of rooms) {
        const served = p.circuits.flatMap((c) => c.rooms.filter((s) => s.id === r.id));
        const sum = (k: 'receptacles' | 'lightGroups' | 'lights' | 'fans') => served.reduce((s, x) => s + x[k], 0);
        if (r.type === 'other') {
          expect(served, `case ${n} ${r.id}`).toEqual([]);
          expect(p.notCovered.map((x) => x.roomId)).toContain(r.id);
          continue;
        }
        expect(sum('receptacles'), `case ${n} ${r.id}`).toBe(r.receptacles);
        expect(sum('lightGroups'), `case ${n} ${r.id}`).toBe(r.lightGroups!.length);
        expect(sum('lights'), `case ${n} ${r.id}`).toBe(r.lightGroups!.reduce((s, g) => s + g.lights, 0));
        expect(sum('fans'), `case ${n} ${r.id}`).toBe(r.fans);
      }
      // bathroom receptacles only on circuits serving that bathroom alone
      for (const c of p.circuits)
        if (c.rooms.some((s) => rooms.find((r) => r.id === s.id)!.type === 'bathroom')) expect(c.rooms).toHaveLength(1);
      // block counts match the room items
      for (const c of p.circuits) {
        expect(c.blocks.length, `case ${n} ${c.name}`).toBeLessThanOrEqual(6);
        expect(c.plannedLoadVa, `case ${n} ${c.name}`).toBeLessThanOrEqual(c.capacityVa);
        const recs = c.blocks.reduce((s, b) => s + (b.type === 'receptacle_run' ? b.count : 0), 0);
        expect(recs).toBe(c.rooms.reduce((s, x) => s + x.receptacles, 0));
        expect(c.reasons.length).toBeGreaterThanOrEqual(4);
        expect(new Set(names(p)).size).toBe(p.circuits.length);
      }
      expect(p.findings.filter((f) => f.severity === 'error')).toEqual([]);
      expectSound(p);
    }
  }, 120_000);
});
