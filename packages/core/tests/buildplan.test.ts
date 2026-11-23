import { describe, expect, it } from 'vitest';
import {
  BLOCK_FIXTURES,
  CABLE_TYPES,
  buildCircuit,
  buildMaterials,
  buildSteps,
  formatMaterialsText,
  formatStepsText,
  planCircuits,
  type BlockInput,
  type BuildPlanOptions,
  type CircuitModel,
  type InventoryInput,
  type RoomInput,
} from '../src';
import { FIXTURES } from '../src/fixtures';

// ---- circuits under test -------------------------------------------------------------------------

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
const basement = (rooms: RoomInput[]): InventoryInput => ({ basement: true, rooms });
const USER = basement([living, bath, closet, bedroom]);
const USER_ATTACHED = basement([living, bath, { ...closet, attachedTo: 'bed' }, bedroom]);

interface Case {
  name: string;
  circuit: CircuitModel;
  options: BuildPlanOptions;
}

const cases: Case[] = [];
const add = (name: string, circuit: CircuitModel, options: BuildPlanOptions = {}) => cases.push({ name, circuit, options });

FIXTURES.forEach((c) => add(`fixture ${c.id}`, c));
BLOCK_FIXTURES.forEach((f) => add(`block fixture ${f.name}`, f.circuit));
for (const [variant, inv] of [['closet separate', USER], ['closet attached', USER_ATTACHED]] as const)
  for (const c of planCircuits(inv).circuits)
    add(`basement (${variant}): ${c.name}`, buildCircuit({ id: c.name, title: c.name, breakerAmps: c.breakerAmps, blocks: c.blocks }), { protection: c.protection });

const spec = (id: string, amps: 15 | 20, blocks: BlockInput[]) => buildCircuit({ id, title: id, breakerAmps: amps, blocks });
const COUNTS = [1, 2, 3, 5, 12];
for (const amps of [15, 20] as const) {
  for (const n of COUNTS) {
    add(`sweep run ${n} @${amps}`, spec(`run${n}`, amps, [{ type: 'receptacle_run', count: n }]));
    add(`sweep gfci run ${n} @${amps}`, spec(`grun${n}`, amps, [{ type: 'receptacle_run', count: n, gfciFirst: true }]));
    add(`sweep switch lights ${n} @${amps}`, spec(`sl${n}`, amps, [{ type: 'switch_lights', count: n }]));
    add(`sweep 3-way lights ${n} @${amps}`, spec(`tw${n}`, amps, [{ type: 'three_way_lights', count: n }]));
  }
  add(`sweep fan @${amps}`, spec('fan', amps, [{ type: 'switch_fan' }]));
  for (const [a, b] of [[1, 1], [1, 3], [3, 2]] as const)
    add(`sweep two-gang ${a}/${b} @${amps}`, spec(`gang${a}${b}`, amps, [{ type: 'two_gang_switches', countA: a, countB: b }]));
  const V: [string, BlockInput][] = [
    ['run3', { type: 'receptacle_run', count: 3 }],
    ['grun3', { type: 'receptacle_run', count: 3, gfciFirst: true }],
    ['sw2', { type: 'switch_lights', count: 2 }],
    ['3w2', { type: 'three_way_lights', count: 2 }],
    ['fan', { type: 'switch_fan' }],
    ['gang', { type: 'two_gang_switches', countA: 1, countB: 2 }],
  ];
  for (const [na, a] of V) for (const [nb, b] of V) add(`sweep pair ${na}+${nb} @${amps}`, spec(`${na}-${nb}`, amps, [a, b]));
  add(`sweep chain six @${amps}`, spec('six', amps, [
    { type: 'receptacle_run', count: 2, gfciFirst: true },
    { type: 'switch_lights', count: 2 },
    { type: 'three_way_lights', count: 2 },
    { type: 'switch_fan' },
    { type: 'two_gang_switches', countA: 2, countB: 1 },
    { type: 'receptacle_run', count: 3 },
  ]));
}

// ---- helpers -------------------------------------------------------------------------------------

const idsOf = (c: CircuitModel) =>
  new Set([...c.boxes, ...c.devices, ...c.cables, ...c.splices, ...c.connections].map((x) => x.id));
const hasConductor = (c: CircuitModel['connections'][number]) => [c.a, c.b].some((e) => e.kind === 'conductor');
const touches = (c: CircuitModel['connections'][number], splice: string) =>
  [c.a, c.b].filter((e) => e.kind === 'splice' && e.splice === splice).length;

describe('materials and steps: coverage guarantees', () => {
  it('has the circuits the task names', () => {
    expect(cases.length).toBeGreaterThan(120);
    expect(cases.filter((c) => c.name.startsWith('basement')).length).toBe(8);
  });

  it.each(cases)('$name', ({ circuit, options }) => {
    const ids = idsOf(circuit);
    const m = buildMaterials(circuit, options);
    const s = buildSteps(circuit, options);
    const panelBoxes = new Set(circuit.boxes.filter((b) => b.kind === 'panel').map((b) => b.id));
    const nonPanelBoxes = circuit.boxes.filter((b) => b.kind === 'box');
    const nonPanelDevices = circuit.devices.filter((d) => !panelBoxes.has(d.box));
    const items = (cat: string) => m.items.filter((i) => i.category === cat);
    const sum = (cat: string) => items(cat).reduce((n, i) => n + i.quantity, 0);

    // ids and refs
    expect(new Set(m.items.map((i) => i.id)).size).toBe(m.items.length);
    const steps = s.phases.flatMap((p) => p.steps);
    expect(new Set(steps.map((x) => x.id)).size).toBe(steps.length);
    for (const i of m.items) for (const r of i.refs) expect(ids.has(r), `${i.id} -> ${r}`).toBe(true);
    for (const x of steps) {
      for (const r of x.refs) expect(ids.has(r), `${x.id} -> ${r}`).toBe(true);
      if (x.box !== null) expect(ids.has(x.box)).toBe(true);
    }
    expect(s.phases.map((p) => p.id)).toEqual(['before', 'rough-in', 'make-up', 'devices', 'panel', 'testing']);

    // materials: independent counts
    expect(sum('breaker')).toBe(circuit.devices.filter((d) => d.type === 'breaker').length);
    expect(sum('device')).toBe(nonPanelDevices.length);
    for (const i of items('device')) {
      expect(new Set(i.refs.map((r) => circuit.devices.find((d) => d.id === r)!.type)).size).toBe(1);
      expect(i.refs.length).toBe(i.quantity);
    }
    expect(sum('box')).toBe(nonPanelBoxes.length);
    const boxKey = (id: string) => {
      const ds = circuit.devices.filter((d) => d.box === id);
      return ds.some((d) => d.type === 'light' || d.type === 'fan') ? 'fixture' : `gang${ds.length}`;
    };
    const keys = new Set(nonPanelBoxes.map((b) => boxKey(b.id)));
    expect(items('box').length).toBe(keys.size);
    for (const i of items('box')) expect(new Set(i.refs.map(boxKey)).size).toBe(1);
    expect(items('cable_run').length).toBe(circuit.cables.length);
    expect(items('cable_run').flatMap((i) => i.refs).sort()).toEqual(circuit.cables.map((k) => k.id).sort());
    expect(sum('wire_nut')).toBe(circuit.splices.length);
    expect(items('wire_nut').flatMap((i) => i.refs).sort()).toEqual(circuit.splices.map((x) => x.id).sort());
    for (const i of items('wire_nut'))
      for (const r of i.refs) {
        const n = circuit.connections.reduce((t, c) => t + touches(c, r), 0);
        expect(i.description).toContain(`for ${n} conductors`);
      }
    const pig = circuit.connections.filter((c) => !hasConductor(c));
    expect(sum('pigtail')).toBe(pig.length);
    expect(items('pigtail').flatMap((i) => i.refs).sort()).toEqual(pig.map((c) => c.id).sort());
    const plated = nonPanelBoxes.filter((b) => circuit.devices.some((d) => d.box === b.id) && boxKey(b.id) !== 'fixture');
    expect(sum('cover_plate')).toBe(plated.length);
    expect(items('cover_plate').flatMap((i) => i.refs).sort()).toEqual(plated.map((b) => b.id).sort());
    expect(m.notIncluded.length).toBe(6);

    // every non-panel device, box and cable is in the materials and in the steps
    const matRefs = new Set(m.items.flatMap((i) => i.refs));
    const stepRefs = new Set(steps.flatMap((x) => x.refs));
    for (const d of nonPanelDevices) {
      expect(matRefs.has(d.id), d.id).toBe(true);
      expect(stepRefs.has(d.id), d.id).toBe(true);
    }
    for (const b of nonPanelBoxes) {
      expect(matRefs.has(b.id), b.id).toBe(true);
      expect(stepRefs.has(b.id), b.id).toBe(true);
    }
    for (const k of circuit.cables) {
      expect(matRefs.has(k.id), k.id).toBe(true);
      expect(stepRefs.has(k.id), k.id).toBe(true);
    }

    // every connection is covered by exactly one make-up or panel step; every splice by exactly one wire-nut step
    const makeSteps = [...s.phases.find((p) => p.id === 'make-up')!.steps, ...s.phases.find((p) => p.id === 'panel')!.steps];
    for (const c of circuit.connections)
      expect(makeSteps.filter((x) => x.refs.includes(c.id)).length, c.id).toBe(1);
    for (const sp of circuit.splices) {
      expect(makeSteps.filter((x) => x.refs.includes(sp.id)).length, sp.id).toBe(1);
      expect(makeSteps.filter((x) => x.id === `makeup-${sp.id}`).length).toBe(1);
    }
    // no other phase touches connections or splices
    for (const p of s.phases.filter((p) => p.id !== 'make-up' && p.id !== 'panel'))
      for (const x of p.steps) for (const r of x.refs) expect(circuit.connections.some((c) => c.id === r) || circuit.splices.some((sp) => sp.id === r)).toBe(false);

    // panel steps are the panel's connections only; the panel phase comes after the make-up phase
    for (const x of s.phases.find((p) => p.id === 'panel')!.steps) expect(panelBoxes.has(x.box!)).toBe(true);
    for (const x of s.phases.find((p) => p.id === 'make-up')!.steps) expect(panelBoxes.has(x.box!)).toBe(false);

    // within a box: grounds, then neutrals, then the rest
    const net = (id: string) => buildNetRole(circuit, id);
    for (const box of nonPanelBoxes) {
      const ranks = s.phases
        .find((p) => p.id === 'make-up')!
        .steps.filter((x) => x.box === box.id)
        .map((x) => {
          const first = x.refs.find((r) => circuit.connections.some((c) => c.id === r))!;
          return net(first);
        });
      const order = (r: string) => (r === 'ground' ? 0 : r === 'neutral' || r === 'protected_neutral' ? 1 : 2);
      expect(ranks.map(order)).toEqual([...ranks.map(order)].sort((a, b) => a - b));
    }

    // power-flow order: mount order never goes back toward the panel
    const dist = bfs(circuit);
    const mount = s.phases.find((p) => p.id === 'rough-in')!.steps.filter((x) => x.id.startsWith('rough-box-')).map((x) => dist.get(x.box!)!);
    expect(mount).toEqual([...mount].sort((a, b) => a - b));
    expect(mount.length).toBe(nonPanelBoxes.length);

    // no code text, wording hygiene, determinism
    const text = formatMaterialsText(m) + '\n' + formatStepsText(s);
    expect(text).not.toMatch(/\bNEC\b|§|Article \d|Section \d/);
    expect(text).not.toMatch(/undefined|NaN|\[object/);
    expect(buildMaterials(circuit, options)).toEqual(m);
    expect(buildSteps(circuit, options)).toEqual(s);
  });
});

import { analyzeNets } from '../src';
function buildNetRole(circuit: CircuitModel, connectionId: string): string {
  return analyzeNets(circuit).netOfConnection(connectionId)!.role;
}
function bfs(circuit: CircuitModel): Map<string, number> {
  const dist = new Map<string, number>();
  const queue = circuit.boxes.filter((b) => b.kind === 'panel').map((b) => b.id);
  queue.forEach((q) => dist.set(q, 0));
  for (let i = 0; i < queue.length; i++)
    for (const k of circuit.cables)
      for (const [x, y] of [[k.from, k.to], [k.to, k.from]] as const)
        if (x === queue[i] && !dist.has(y)) (dist.set(y, dist.get(x)! + 1), queue.push(y));
  return dist;
}

// ---- readable snapshots ---------------------------------------------------------------------------

const lines = (s: string) => s.split('\n');
const c1 = FIXTURES[0]!;
const gfciRun3 = () =>
  buildCircuit({ id: 'run3', title: 'GFCI run of 3', breakerAmps: 20, blocks: [{ type: 'receptacle_run', count: 3, gfciFirst: true }] });

describe('readable snapshots (wording changes must be deliberate)', () => {
  it('single-pole switch with one light: materials', () => {
    expect(lines(formatMaterialsText(buildMaterials(c1)))).toEqual(lines(`Materials: Circuit 1: single-pole switch, power at switch

- 1 x 15 A breaker, single-pole (The breaker type (standard or AFCI) was not specified for this circuit. It must be the make and series that fits your panel.)
- 1 x Switch, single-pole
- 1 x Light fixture of your choice
- 1 x 1-gang device box (Box volume is not calculated; check that each box is large enough for its wires, devices and clamps.)
- 1 x Fixture box (holds a light or fan) (Box volume is not calculated; check that each box is large enough for its wires, devices and clamps.)
- 14/2 NM-B "feed" from Panel to Switch box: length not entered
- 14/2 NM-B "load" from Switch box to Light box: length not entered
- 1 x Wire nut for 2 conductors (2 × 14 AWG) (Check the package for the wire sizes and counts the nut is rated for.)
- 1 x Wire nut for 3 conductors (3 × 14 AWG) (Check the package for the wire sizes and counts the nut is rated for.)
- 1 x Pigtail wire, green, 14 AWG (Cut from spare wire of the same size, long enough to reach from the wire nut to the screw.)
- 1 x Cover plate, 1-gang, switch

Cable totals:
- 14/2: 2 runs, no length entered yet

Not included:
- Cable staples and cable connectors (clamps) for the boxes.
- Box mounting hardware (screws, brackets, nails).
- Tools, a voltage tester and a receptacle tester.
- Receptacle rating: choose 15 A or 20 A receptacles to suit the circuit yourself.
- Tamper-resistant and weather-resistant variants of devices, where your location needs them.
- Wire connectors for fixture and fan leads, if the fixture or fan does not supply them.`));
  });
  it('single-pole switch with one light: steps', () => {
    expect(lines(formatStepsText(buildSteps(c1)))).toEqual(lines(`Steps: Circuit 1: single-pole switch, power at switch

1. Before you start
1.1 Turn off power before you touch the panel or any existing wiring: switch off the main breaker, then use a voltage tester to confirm that every wire you will touch is dead. Test the tester on a known live source first.
1.2 Ask your local building department whether this work needs a permit and an inspection, and arrange them before you start.
1.3 If a step is unclear, or what you find in the walls differs from this plan, stop and hire a licensed electrician.

2. Rough-in: mount the boxes and pull the cables
2.1 Switch box: mount the 1-gang device box firmly to the framing at the position you chose.
2.2 Light box: mount the fixture box firmly to the framing at the position you chose.
2.3 Pull 14/2 NM-B "feed" from Panel to Switch box. Leave enough free wire in each box to reach every connection there, and secure the cable at each box with a cable connector and along its run with staples.
    Note: Leave the panel end unconnected until the panel phase.
2.4 Pull 14/2 NM-B "load" from Switch box to Light box. Leave enough free wire in each box to reach every connection there, and secure the cable at each box with a cable connector and along its run with staples.
2.5 If your permit requires a rough-in inspection, have it done now: before the walls are closed and before any device is connected.

3. Make-up: connect the wires, box by box
3.1 Switch box: join the bare copper wires of 14/2 NM-B "feed" and 14/2 NM-B "load" and a green pigtail with the ground wire nut (3 conductors, 14 AWG). Hold the stripped ends together, push the wire nut on and twist it clockwise until it is tight.
3.2 Switch box: connect the green pigtail from the ground wire nut to the green ground screw of Switch.
3.3 Switch box: join the white wires of 14/2 NM-B "feed" and 14/2 NM-B "load" with the neutral wire nut (2 conductors, 14 AWG). Hold the stripped ends together, push the wire nut on and twist it clockwise until it is tight.
3.4 Switch box: connect the black wire of 14/2 NM-B "feed" to one of the two brass screws of Switch.
3.5 Switch box: connect the black wire of 14/2 NM-B "load" to the other brass screw of Switch.
3.6 Light box: connect the bare copper wire of 14/2 NM-B "load" to the fixture's ground lead or green screw.
    Note: Fixtures and fans differ; follow the manufacturer's instructions for how their connections are made.
3.7 Light box: connect the white wire of 14/2 NM-B "load" to the fixture's white (neutral) lead or terminal.
3.8 Light box: connect the black wire of 14/2 NM-B "load" to the fixture's black (hot) lead or terminal.

4. Devices and cover plates
4.1 Switch box: fold the wires carefully back into the box and fasten Switch to the box with its mounting screws.
4.2 Switch box: fit the 1-gang cover plate over Switch.
4.3 Light box: mount Light following the instructions that come with it.

5. At the panel, last
5.1 Panel: connect the bare copper wire of 14/2 NM-B "feed" to the Ground bar.
    Note: Even with the main breaker off, the service wires in the panel stay live. If you are not experienced, hire an electrician for the panel work.
5.2 Panel: connect the white wire of 14/2 NM-B "feed" to the Neutral bar.
5.3 Panel: connect the black wire of 14/2 NM-B "feed" to the output terminal of the 15A breaker.
    Note: Snap the breaker into an open space in the panel, make sure it fits your panel, and leave it switched off until the testing phase.

6. Power-up and testing
6.1 Check that every device is mounted and every cover plate is on, then switch the main breaker and this circuit's breaker on.
6.2 Switch: Operate the switch several times and confirm that the light or fan it controls turns on and off each time.
6.3 If anything does not behave as described, switch the circuit breaker off again, check the wiring against the diagram, and hire an electrician if you cannot find the cause.`));
  });
  it('GFCI-first run of 3: materials', () => {
    expect(lines(formatMaterialsText(buildMaterials(gfciRun3())))).toEqual(lines(`Materials: GFCI run of 3

- 1 x 20 A breaker, single-pole (The breaker type (standard or AFCI) was not specified for this circuit. It must be the make and series that fits your panel.)
- 1 x Receptacle, GFCI
- 2 x Receptacle, duplex
- 3 x 1-gang device box (Box volume is not calculated; check that each box is large enough for its wires, devices and clamps.)
- 12/2 NM-B "feed" from Panel to Receptacle box 1: length not entered
- 12/2 NM-B "run 1-2" from Receptacle box 1 to Receptacle box 2: length not entered
- 12/2 NM-B "run 2-3" from Receptacle box 2 to Receptacle box 3: length not entered
- 4 x Wire nut for 3 conductors (3 × 12 AWG) (Check the package for the wire sizes and counts the nut is rated for.)
- 1 x Pigtail wire, black, 12 AWG (Cut from spare wire of the same size, long enough to reach from the wire nut to the screw.)
- 2 x Pigtail wire, green, 12 AWG (Cut from spare wire of the same size, long enough to reach from the wire nut to the screw.)
- 1 x Pigtail wire, white, 12 AWG (Cut from spare wire of the same size, long enough to reach from the wire nut to the screw.)
- 1 x Cover plate, 1-gang, GFCI receptacle
- 2 x Cover plate, 1-gang, receptacle

Cable totals:
- 12/2: 3 runs, no length entered yet

Not included:
- Cable staples and cable connectors (clamps) for the boxes.
- Box mounting hardware (screws, brackets, nails).
- Tools, a voltage tester and a receptacle tester.
- Receptacle rating: choose 15 A or 20 A receptacles to suit the circuit yourself.
- Tamper-resistant and weather-resistant variants of devices, where your location needs them.
- Wire connectors for fixture and fan leads, if the fixture or fan does not supply them.`));
  });
  it('GFCI-first run of 3: steps', () => {
    expect(lines(formatStepsText(buildSteps(gfciRun3())))).toEqual(lines(`Steps: GFCI run of 3

1. Before you start
1.1 Turn off power before you touch the panel or any existing wiring: switch off the main breaker, then use a voltage tester to confirm that every wire you will touch is dead. Test the tester on a known live source first.
1.2 Ask your local building department whether this work needs a permit and an inspection, and arrange them before you start.
1.3 If a step is unclear, or what you find in the walls differs from this plan, stop and hire a licensed electrician.

2. Rough-in: mount the boxes and pull the cables
2.1 Receptacle box 1: mount the 1-gang device box firmly to the framing at the position you chose.
2.2 Receptacle box 2: mount the 1-gang device box firmly to the framing at the position you chose.
2.3 Receptacle box 3: mount the 1-gang device box firmly to the framing at the position you chose.
2.4 Pull 12/2 NM-B "feed" from Panel to Receptacle box 1. Leave enough free wire in each box to reach every connection there, and secure the cable at each box with a cable connector and along its run with staples.
    Note: Leave the panel end unconnected until the panel phase.
2.5 Pull 12/2 NM-B "run 1-2" from Receptacle box 1 to Receptacle box 2. Leave enough free wire in each box to reach every connection there, and secure the cable at each box with a cable connector and along its run with staples.
2.6 Pull 12/2 NM-B "run 2-3" from Receptacle box 2 to Receptacle box 3. Leave enough free wire in each box to reach every connection there, and secure the cable at each box with a cable connector and along its run with staples.
2.7 If your permit requires a rough-in inspection, have it done now: before the walls are closed and before any device is connected.

3. Make-up: connect the wires, box by box
3.1 Receptacle box 1: join the bare copper wires of 12/2 NM-B "feed" and 12/2 NM-B "run 1-2" and a green pigtail with the ground wire nut (3 conductors, 12 AWG). Hold the stripped ends together, push the wire nut on and twist it clockwise until it is tight.
3.2 Receptacle box 1: connect the green pigtail from the ground wire nut to the green ground screw of GFCI 1.
3.3 Receptacle box 1: connect the white wire of 12/2 NM-B "feed" to the silver LINE screw of GFCI 1.
    Note: LINE terminals take the wires that come from the panel side. Never swap LINE and LOAD.
3.4 Receptacle box 1: connect the white wire of 12/2 NM-B "run 1-2" to the silver LOAD screw of GFCI 1.
    Note: LOAD terminals take the wires that go on to the receptacles after this one. Never swap LINE and LOAD.
3.5 Receptacle box 1: connect the black wire of 12/2 NM-B "feed" to the brass LINE screw of GFCI 1.
    Note: LINE terminals take the wires that come from the panel side. Never swap LINE and LOAD.
3.6 Receptacle box 1: connect the black wire of 12/2 NM-B "run 1-2" to the brass LOAD screw of GFCI 1.
    Note: LOAD terminals take the wires that go on to the receptacles after this one. Never swap LINE and LOAD.
3.7 Receptacle box 2: join the bare copper wires of 12/2 NM-B "run 1-2" and 12/2 NM-B "run 2-3" and a green pigtail with the ground wire nut (3 conductors, 12 AWG). Hold the stripped ends together, push the wire nut on and twist it clockwise until it is tight.
3.8 Receptacle box 2: connect the green pigtail from the ground wire nut to the green ground screw of Receptacle 2.
3.9 Receptacle box 2: join the white wires of 12/2 NM-B "run 1-2" and 12/2 NM-B "run 2-3" and a white pigtail with the neutral wire nut (3 conductors, 12 AWG). Hold the stripped ends together, push the wire nut on and twist it clockwise until it is tight.
3.10 Receptacle box 2: connect the white pigtail from the neutral wire nut to a silver screw (neutral side) of Receptacle 2.
3.11 Receptacle box 2: join the black wires of 12/2 NM-B "run 1-2" and 12/2 NM-B "run 2-3" and a black pigtail with the hot wire nut (3 conductors, 12 AWG). Hold the stripped ends together, push the wire nut on and twist it clockwise until it is tight.
3.12 Receptacle box 2: connect the black pigtail from the hot wire nut to a brass screw (hot side) of Receptacle 2.
3.13 Receptacle box 3: connect the bare copper wire of 12/2 NM-B "run 2-3" to the green ground screw of Receptacle 3.
3.14 Receptacle box 3: connect the white wire of 12/2 NM-B "run 2-3" to a silver screw (neutral side) of Receptacle 3.
3.15 Receptacle box 3: connect the black wire of 12/2 NM-B "run 2-3" to a brass screw (hot side) of Receptacle 3.

4. Devices and cover plates
4.1 Receptacle box 1: fold the wires carefully back into the box and fasten GFCI 1 to the box with its mounting screws.
4.2 Receptacle box 1: fit the 1-gang cover plate over GFCI 1.
4.3 Receptacle box 2: fold the wires carefully back into the box and fasten Receptacle 2 to the box with its mounting screws.
4.4 Receptacle box 2: fit the 1-gang cover plate over Receptacle 2.
4.5 Receptacle box 3: fold the wires carefully back into the box and fasten Receptacle 3 to the box with its mounting screws.
4.6 Receptacle box 3: fit the 1-gang cover plate over Receptacle 3.

5. At the panel, last
5.1 Panel: connect the bare copper wire of 12/2 NM-B "feed" to the Ground bar.
    Note: Even with the main breaker off, the service wires in the panel stay live. If you are not experienced, hire an electrician for the panel work.
5.2 Panel: connect the white wire of 12/2 NM-B "feed" to the Neutral bar.
5.3 Panel: connect the black wire of 12/2 NM-B "feed" to the output terminal of the 20A breaker.
    Note: Snap the breaker into an open space in the panel, make sure it fits your panel, and leave it switched off until the testing phase.

6. Power-up and testing
6.1 Check that every device is mounted and every cover plate is on, then switch the main breaker and this circuit's breaker on.
6.2 Test every receptacle with a plug-in receptacle tester and confirm that it shows correct wiring. Receptacles: GFCI 1, Receptacle 2 and Receptacle 3.
6.3 GFCI 1: Press TEST on the GFCI: it must click and its own slots must lose power, and so must the receptacles after it (check them with the tester). Press RESET to restore power.
6.4 If anything does not behave as described, switch the circuit breaker off again, check the wiring against the diagram, and hire an electrician if you cannot find the cause.`));
  });
});

// ---- options and behaviour ------------------------------------------------------------------------

describe('options', () => {
  const run = gfciRun3();
  const [feed, run12, run23] = run.cables.map((k) => k.id) as [string, string, string];

  it('takes cable lengths per run, totals them with the default 15 % allowance, and counts missing runs', () => {
    const m = buildMaterials(run, { cableLengths: { [feed]: 10, [run12]: 12.5 } });
    const runs = m.items.filter((i) => i.category === 'cable_run');
    expect(runs.map((i) => i.lengthFt)).toEqual([10, 12.5, undefined]);
    expect(m.cableTotals).toEqual([{ type: '12/2', runs: 3, knownFt: 22.5, allowancePct: 15, totalFt: 26, missing: 1 }]);
    expect(formatMaterialsText(m)).toContain('12/2: 3 runs, 22.5 ft entered, 26 ft with 15% allowance; 1 run has no length yet');
  });
  it('never estimates a missing length', () => {
    const m = buildMaterials(run);
    expect(m.cableTotals).toEqual([{ type: '12/2', runs: 3, knownFt: 0, allowancePct: 15, totalFt: 0, missing: 3 }]);
    expect(m.items.filter((i) => i.category === 'cable_run').every((i) => i.lengthFt === undefined)).toBe(true);
  });
  it('allowance is overridable and totals are per cable type', () => {
    const mixed = FIXTURES[1]!; // 14/2 feed and load, 14/3 travelers
    const lengths = Object.fromEntries(mixed.cables.map((k) => [k.id, 10]));
    const m = buildMaterials(mixed, { cableLengths: lengths, allowancePct: 0 });
    expect(m.cableTotals.map((t) => [t.type, t.runs, t.knownFt, t.totalFt, t.missing])).toEqual([
      ['14/2', 2, 20, 20, 0],
      ['14/3', 1, 10, 10, 0],
    ]);
    expect(m.cableTotals.map((t) => t.type)).toEqual(CABLE_TYPES.filter((t) => t === '14/2' || t === '14/3'));
    expect(buildMaterials(mixed, { cableLengths: lengths, allowancePct: 50 }).cableTotals.map((t) => t.totalFt)).toEqual([30, 15]);
  });
  it('ignores lengths for cables that are not in the circuit and rejects bad numbers', () => {
    expect(buildMaterials(run, { cableLengths: { nope: 5 } })).toEqual(buildMaterials(run));
    for (const bad of [0, -3, NaN, Infinity]) expect(() => buildMaterials(run, { cableLengths: { [feed]: bad } })).toThrow(/length/);
    expect(() => buildMaterials(run, { allowancePct: -1 })).toThrow(/allowancePct/);
    expect(() => buildMaterials(run, { allowancePct: NaN })).toThrow(/allowancePct/);
    void run23;
  });
  it('breaker type follows the planned protection', () => {
    const desc = (o?: BuildPlanOptions['protection']) => buildMaterials(run, o ? { protection: o } : {}).items.find((i) => i.category === 'breaker')!;
    expect(desc({ gfci: 'first-receptacle', afci: true }).description).toBe('20 A AFCI breaker, single-pole');
    expect(desc({ gfci: 'first-receptacle', afci: false }).description).toBe('20 A standard breaker, single-pole');
    expect(desc().description).toBe('20 A breaker, single-pole');
    expect(desc().note).toContain('not specified');
    expect(desc({ gfci: 'none', afci: true }).note).toContain('fits your panel');
    const step = (afci: boolean) =>
      buildSteps(run, { protection: { gfci: 'none', afci } }).phases.find((p) => p.id === 'panel')!.steps.at(-1)!.note!;
    expect(step(true)).toContain('Use an AFCI breaker');
    expect(step(false)).toContain('standard breaker');
  });
  it('marks unverified circuits on every output', () => {
    const s = buildSteps(run, { unverified: true });
    expect(s.unverified).toBe(true);
    expect(s.phases[0]!.steps[0]!.id).toBe('before-unverified');
    expect(s.phases[0]!.steps[0]!.text).toContain('unverified');
    expect(formatStepsText(s)).toContain('UNVERIFIED TOPOLOGY');
    const m = buildMaterials(run, { unverified: true });
    expect(m.unverified).toBe(true);
    expect(formatMaterialsText(m)).toContain('UNVERIFIED TOPOLOGY');
    expect(buildSteps(run).unverified).toBe(false);
    expect(buildSteps(run).phases[0]!.steps.some((x) => x.id === 'before-unverified')).toBe(false);
    expect(formatMaterialsText(buildMaterials(run))).not.toContain('UNVERIFIED');
  });
});

describe('behaviour', () => {
  it('refuses an invalid circuit and a direct conductor-to-conductor join', () => {
    const bad = { ...c1, connections: c1.connections.slice(1) };
    expect(() => buildMaterials(bad)).toThrow(/invalid circuit/);
    expect(() => buildSteps(bad)).toThrow(/invalid circuit/);
    const joined: CircuitModel = {
      ...c1,
      splices: c1.splices.filter((x) => x.id !== 'wn'),
      connections: [
        ...c1.connections.filter((c) => !(c.b.kind === 'splice' && c.b.splice === 'wn')),
        { id: 'direct', a: { kind: 'conductor', cable: 'feed', color: 'white', box: 'swbox' }, b: { kind: 'conductor', cable: 'load', color: 'white', box: 'swbox' }, color: 'white' },
      ],
    };
    expect(() => buildSteps(joined)).toThrow(/directly/);
    expect(() => buildMaterials(joined)).toThrow(/directly/);
  });

  it('orders boxes by distance from the panel, not by array order', () => {
    const c = BLOCK_FIXTURES.find((f) => f.name === 'bathroom')!.circuit;
    const reversed: CircuitModel = { ...c, boxes: [...c.boxes].reverse(), devices: [...c.devices].reverse() };
    const mount = (x: CircuitModel) =>
      buildSteps(x).phases.find((p) => p.id === 'rough-in')!.steps.filter((s) => s.id.startsWith('rough-box-')).map((s) => s.box);
    expect(mount(reversed)).toEqual(mount(c));
    expect(mount(c)).toEqual(['b1-r1', 'b1-r2', 'b1-r3', 'b2-sw', 'b2-l1', 'b3-sw', 'b3-fan']);
    const boxesInMakeUp = buildSteps(c).phases.find((p) => p.id === 'make-up')!.steps.map((s) => s.box);
    expect([...new Set(boxesInMakeUp)]).toEqual(mount(c));
  });

  it('puts a boxed cable name apart when two cables in a box share a label', () => {
    const c = spec('gang', 15, [{ type: 'two_gang_switches', countA: 1, countB: 1 }]);
    const makeUp = buildSteps(c).phases.find((p) => p.id === 'make-up')!.steps.filter((s) => s.box === 'b1-gang');
    const texts = makeUp.map((s) => s.text).join('\n');
    expect(texts).toContain('"load" (going to Light box 1)');
    expect(texts).toContain('"load" (going to Light box 2)');
    expect(texts).not.toMatch(/"load"(?! \()/);
  });

  it('adds the re-marking note only when a white wire is hot, switched or a traveler', () => {
    const noteRe = /Mark it black or red/;
    for (const f of FIXTURES) expect(formatStepsText(buildSteps(f))).not.toMatch(noteRe);
    const flip = (cable: string, color: string) => (cable === 'load' ? (color === 'white' ? 'black' : color === 'black' ? 'white' : color) : color);
    const flipped: CircuitModel = {
      ...c1,
      connections: c1.connections.map((c) => {
        const f = (e: typeof c.a) => (e.kind === 'conductor' ? { ...e, color: flip(e.cable, e.color) as typeof e.color } : e);
        const a = f(c.a);
        const b = f(c.b);
        const loadEnd = [c.a, c.b].find((e) => e.kind === 'conductor' && e.cable === 'load');
        return { ...c, a, b, color: loadEnd && loadEnd.kind === 'conductor' ? (flip('load', c.color) as typeof c.color) : c.color };
      }),
    };
    const s = buildSteps(flipped);
    const marked = s.phases.flatMap((p) => p.steps).filter((x) => x.note && noteRe.test(x.note));
    expect(marked.length).toBe(2);
    expect(marked.map((x) => x.box).sort()).toEqual(['lightbox', 'swbox']);
    for (const x of marked) expect(x.text).toContain('white wire');
  });

  it('writes the 3-way, GFCI and switch tests from the circuit', () => {
    const tests = (c: CircuitModel) => buildSteps(c).phases.find((p) => p.id === 'testing')!.steps;
    const tw = tests(FIXTURES[1]!);
    expect(tw.filter((x) => x.id.startsWith('test-pair-')).length).toBe(1);
    expect(tw.some((x) => x.id.startsWith('test-switch-'))).toBe(false);
    expect(tw.find((x) => x.id.startsWith('test-pair-'))!.refs.sort()).toEqual(['sw1', 'sw2']);
    expect(tests(FIXTURES[2]!).find((x) => x.id === 'test-gfci-gfci')!.text).toContain('receptacles after it');
    const alone = tests(spec('alone', 20, [{ type: 'receptacle_run', count: 1, gfciFirst: true }]));
    expect(alone.find((x) => x.id.startsWith('test-gfci-'))!.text).not.toContain('receptacles after it');
    expect(tests(FIXTURES[3]!).filter((x) => x.id.startsWith('test-switch-')).length).toBe(2);
    expect(tests(FIXTURES[0]!).some((x) => x.id === 'test-receptacles')).toBe(false);
  });

  it('describes wire nuts by conductors, pigtails by colour and gauge', () => {
    const m = buildMaterials(FIXTURES[3]!);
    expect(m.items.filter((i) => i.category === 'wire_nut').map((i) => [i.description, i.quantity])).toEqual([
      ['Wire nut for 3 conductors (3 × 14 AWG)', 2],
      ['Wire nut for 5 conductors (5 × 14 AWG)', 1],
    ]);
    expect(m.items.filter((i) => i.category === 'pigtail').map((i) => [i.description, i.quantity])).toEqual([
      ['Pigtail wire, black, 14 AWG', 2],
      ['Pigtail wire, green, 14 AWG', 2],
    ]);
  });
});

// ---- wording fixes (task 34) ----------------------------------------------------------------------

import { CATALOGUE, TERMINAL_PHRASES, terminalPhrase, type DeviceType } from '../src';

describe('terminal wording', () => {
  it('has a phrase for every catalogue terminal of every device type, and no others', () => {
    for (const type of Object.keys(CATALOGUE) as DeviceType[]) {
      const names = CATALOGUE[type].terminals.map((t) => t.name).sort();
      expect(Object.keys(TERMINAL_PHRASES[type]).sort(), type).toEqual(names);
      for (const n of names) expect(terminalPhrase(type, n, 'X').length, `${type}.${n}`).toBeGreaterThan(0);
    }
  });
  it.each(cases)('no raw terminal name in quotes in any step: $name', ({ circuit, options }) => {
    const text = formatStepsText(buildSteps(circuit, options));
    const raw = new Set(Object.values(CATALOGUE).flatMap((d) => d.terminals.map((t) => t.name)));
    for (const n of raw) expect(text, n).not.toContain(`"${n}"`);
  });
});

const bathroom = () =>
  buildCircuit({
    id: 'bath',
    title: 'Bathroom',
    breakerAmps: 20,
    blocks: [{ type: 'switch_lights', count: 1 }, { type: 'switch_fan' }, { type: 'receptacle_run', count: 3, gfciFirst: true }],
  });

describe('fixtures, fans, testing', () => {
  const FIXTURE_NOTE = /manufacturer/;
  it('gives the manufacturer note once per fixture or fan box, on its first connection step', () => {
    for (const c of [bathroom(), ...cases.map((x) => x.circuit)]) {
      const make = buildSteps(c).phases.find((p) => p.id === 'make-up')!.steps;
      for (const box of c.boxes) {
        const fixtureDev = c.devices.filter((d) => d.box === box.id && (d.type === 'light' || d.type === 'fan'));
        const noted = make.filter((x) => x.box === box.id && x.note !== undefined && FIXTURE_NOTE.test(x.note));
        expect(noted.length, `${c.id}/${box.id}`).toBe(fixtureDev.length > 0 ? 1 : 0);
        if (noted.length === 1) expect(make.filter((x) => x.box === box.id && x.refs.some((r) => fixtureDev.some((d) => d.id === r)))[0]).toBe(noted[0]);
      }
    }
  });
  it('words light and fan connections as leads, and adds the connector line', () => {
    const text = formatStepsText(buildSteps(bathroom()));
    expect(text).toContain("to the fixture's black (hot) lead or terminal");
    expect(text).toContain("to the fan's white (neutral) lead or terminal");
    expect(text).toContain("to the fan's ground lead or green screw");
    expect(buildMaterials(bathroom()).notIncluded.some((n) => /fixture and fan leads/.test(n))).toBe(true);
  });
  it('has no ceiling-fan note; the fan box step has the exhaust-fan rough-in note', () => {
    const s = buildSteps(bathroom());
    expect(formatStepsText(s)).not.toMatch(/ceiling fan/i);
    const fanBox = s.phases.find((p) => p.id === 'rough-in')!.steps.filter((x) => x.note && /exhaust fan/.test(x.note));
    expect(fanBox.length).toBe(1);
    expect(fanBox[0]!.id).toMatch(/^rough-box-/);
  });
  it('the receptacle tester step lists every receptacle including GFCI receptacles', () => {
    const c = bathroom();
    const step = buildSteps(c).phases.find((p) => p.id === 'testing')!.steps.find((x) => x.id === 'test-receptacles')!;
    const recs = c.devices.filter((d) => d.type === 'duplex' || d.type === 'gfci');
    expect(recs.length).toBe(3);
    for (const d of recs) {
      expect(step.text).toContain(d.label);
      expect(step.refs).toContain(d.id);
    }
  });
  it('ends the rough-in phase with the inspection reminder', () => {
    const rough = buildSteps(bathroom()).phases.find((p) => p.id === 'rough-in')!.steps;
    expect(rough.at(-1)!.id).toBe('rough-inspection');
    expect(rough.at(-1)!.text).toMatch(/rough-in inspection/);
  });
});
