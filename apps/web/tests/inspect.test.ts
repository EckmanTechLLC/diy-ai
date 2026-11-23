import { describe, expect, it } from 'vitest';
import { computeNets, endpointKey, type CircuitModel } from '@diy-ai/core';
import { FIXTURES } from '@diy-ai/core/fixtures';
import {
  describe as describeSel,
  describeCable,
  describeDevice,
  describeNet,
  describeSplice,
  highlightOf,
  placesText,
  rolesText,
  sameSelection,
  wireTooltip,
} from '../src/lib/inspect';

const [c1, c2, c3, c4] = FIXTURES;
/** Id of the first connection that has an endpoint with this key (t:device.terminal, c:cable.color, s:splice). */
const wire = (m: CircuitModel, key: string): string =>
  m.connections.find((c) => endpointKey(c.a) === key || endpointKey(c.b) === key)!.id;
const netOf = (m: CircuitModel, key: string) => computeNets(m).get(wire(m, key))!;
const clone = (m: CircuitModel): CircuitModel => JSON.parse(JSON.stringify(m));

describe('describeNet', () => {
  it('lists every landing from panel to load, with colour and roles (circuit 1 feed hot)', () => {
    const d = describeNet(c1, netOf(c1, 't:sw.t1'))!;
    expect(d.title).toBe('Black wire');
    expect(d.colors).toEqual(['black']);
    expect(placesText(d.places)).toBe('15A breaker · out → cable 14/2 "feed" black → Switch · t1');
    expect(d.roles).toEqual(['hot', 'switched']);
    expect(rolesText(d.roles)).toBe('hot, then switched');
    expect(d.places.map((p) => p.ref.kind)).toEqual(['device', 'cable', 'device']);
  });

  it('orders the switched leg from the switch to the light', () => {
    const d = describeNet(c1, netOf(c1, 't:sw.t2'))!;
    expect(placesText(d.places)).toBe('Switch · t2 → cable 14/2 "load" black → Light · hot');
    expect(d.roles).toEqual(['switched', 'hot']);
  });

  it('puts the wire nut between the cables and the pigtail on a ground net (circuit 1)', () => {
    const d = describeNet(c1, netOf(c1, 't:sw.ground'))!; // green pigtail from the ground splice
    expect([...d.colors].sort()).toEqual(['bare', 'green']);
    expect(d.title).toBe('Bare copper / green wire');
    const text = d.places.map((p) => p.text);
    expect(text[0]).toBe('Ground bar · ground_bar');
    expect(text[1]).toBe('cable 14/2 "feed" bare');
    expect(text.indexOf('Wire nut 2 of 2 in Switch box')).toBeGreaterThan(text.indexOf('cable 14/2 "feed" bare'));
    expect(text.indexOf('Switch · ground')).toBeGreaterThan(text.indexOf('Wire nut 2 of 2 in Switch box'));
    expect(text.indexOf('Light · ground')).toBeGreaterThan(text.indexOf('cable 14/2 "load" bare'));
    expect(d.roles).toEqual(['ground']);
  });

  it('works for the 3-way travelers and keeps both ends of a conductor as one place', () => {
    const d = describeNet(c2, netOf(c2, 't:sw1.traveler_b'))!; // trav black at box1 -> sw1.traveler_b
    expect(placesText(d.places)).toBe('SW1 · traveler_b → cable 14/3 "travelers" black → SW2 · traveler_b');
    expect(d.roles).toEqual(['traveler']);
  });

  it('describes a neutral through a GFCI (circuit 3) and a shared hot splice (circuit 4)', () => {
    const n = describeNet(c3, netOf(c3, 't:gfci.line_neutral'))!;
    expect(placesText(n.places)).toBe('Neutral bar · neutral_bar → cable 12/2 "feed" white → GFCI · line_neutral');
    expect(n.roles).toEqual(['neutral']);
    const hot = describeNet(c4, netOf(c4, 's:hot'))!; // feed black -> hot splice -> two switches
    const t = hot.places.map((p) => p.text);
    expect(t.slice(0, 3)).toEqual(['15A breaker · out', 'cable 14/2 "feed" black', 'Wire nut 1 of 3 in 2-gang box']);
    expect(t.slice(3).sort()).toEqual(['SW-A · t1', 'SW-B · t1']);
  });

  it('returns null for an unknown net', () => {
    expect(describeNet(c1, 'nope')).toBeNull();
  });

  it('every net of every fixture has a title, a role set and places that include all its connections', () => {
    for (const m of FIXTURES) {
      const nets = computeNets(m);
      for (const net of new Set(nets.values())) {
        const d = describeNet(m, net)!;
        expect(d.title).toMatch(/ wire$/);
        expect(d.places.length).toBeGreaterThanOrEqual(2);
        expect(new Set(d.places.map((p) => p.text)).size).toBe(d.places.length);
        for (const c of m.connections.filter((c) => nets.get(c.id) === net))
          for (const e of [c.a, c.b]) {
            const ref = e.kind === 'terminal' ? e.device : e.kind === 'conductor' ? e.cable : e.splice;
            expect(d.places.some((p) => 'id' in p.ref && p.ref.id === ref), `${m.id} ${c.id}`).toBe(true);
          }
      }
    }
  });
});

describe('wireTooltip', () => {
  it('names colour, role and ends', () => {
    expect(wireTooltip(c1, netOf(c1, 't:sw.t1'))).toEqual({
      title: 'Black wire (hot, then switched)',
      detail: '15A breaker · out → Switch · t1',
    });
    expect(wireTooltip(c1, 'nope')).toBeNull();
  });
});

describe('describeDevice', () => {
  it('gives name, type, box and each terminal with screw colour and what is connected', () => {
    const d = describeDevice(c1, 'sw')!;
    expect(d).toMatchObject({ name: 'Switch', type: 'Switch', box: 'Switch box' });
    expect(d.terminals.map((t) => [t.name, t.screw, t.role])).toEqual([
      ['t1', 'brass', 'switched'],
      ['t2', 'brass', 'switched'],
      ['ground', 'green', 'ground'],
    ]);
    const t1 = d.terminals[0].connections;
    expect(t1).toHaveLength(1);
    expect(t1[0]).toMatchObject({ color: 'black', to: { text: 'cable 14/2 "feed" black', ref: { kind: 'cable', id: 'feed' } } });
    expect(d.terminals[2].connections[0].to.text).toBe('Wire nut 2 of 2 in Switch box');
  });

  it('carries amps for a breaker and lists every wire on a bus bar', () => {
    expect(describeDevice(c1, 'breaker')!.amps).toBe(15);
    expect(describeDevice(c1, 'sw')!.amps).toBeUndefined();
    const bar = describeDevice(c4, 'gbar')!;
    expect(bar.terminals[0].connections).toHaveLength(1);
  });

  it('says what is on both sides of a GFCI', () => {
    const d = describeDevice(c3, 'gfci')!;
    expect(d.terminals.map((t) => t.name)).toEqual(['line_hot', 'line_neutral', 'ground', 'load_hot', 'load_neutral']);
    expect(d.terminals[3].connections[0].to.text).toBe('cable 12/2 "downstream" black');
  });

  it('reports a terminal with nothing connected as an empty list', () => {
    const m = clone(c1);
    m.connections = m.connections.filter((c) => !(c.b.kind === 'terminal' && c.b.device === 'fix' && c.b.terminal === 'ground'));
    const d = describeDevice(m, 'fix')!;
    expect(d.terminals.find((t) => t.name === 'ground')!.connections).toEqual([]);
  });

  it('every terminal of every device is described, and unknown ids give null', () => {
    for (const m of FIXTURES) for (const dev of m.devices) expect(describeDevice(m, dev.id)!.terminals.length).toBeGreaterThan(0);
    expect(describeDevice(c1, 'nope')).toBeNull();
  });
});

describe('describeCable', () => {
  it('gives type, name, the boxes it runs between and its conductors with both ends', () => {
    const d = describeCable(c2, 'trav')!;
    expect(d).toMatchObject({ name: '14/3 NM-B "travelers"', type: '14/3', from: 'Box 1 (SW1)', to: 'Box 2 (SW2)' });
    expect(d.conductors.map((c) => c.color)).toEqual(['black', 'red', 'white', 'bare']);
    const red = d.conductors.find((c) => c.color === 'red')!;
    expect(red.net).toBe(netOf(c2, 't:sw1.traveler_a'));
    expect(red.ends).toEqual([
      { box: 'Box 1 (SW1)', to: { text: 'SW1 · traveler_a', ref: { kind: 'device', id: 'sw1' } } },
      { box: 'Box 2 (SW2)', to: { text: 'SW2 · traveler_a', ref: { kind: 'device', id: 'sw2' } } },
    ]);
    const white = d.conductors.find((c) => c.color === 'white')!;
    expect(white.ends.map((e) => e.to?.text)).toEqual(['Wire nut 1 of 2 in Box 1 (SW1)', 'Wire nut 1 of 2 in Box 2 (SW2)']);
  });

  it('marks an end that is not connected', () => {
    const m = clone(c1);
    m.connections = m.connections.filter((c) => ![c.a, c.b].some((e) => endpointKey(e) === 'c:feed.black'));
    const d = describeCable(m, 'feed')!;
    expect(d.conductors[0].ends[1].to).toBeNull();
    expect(d.conductors[0].ends[0].to).toBeNull();
    expect(d.conductors[0].net).toBeNull();
  });

  it('describes every cable of every fixture and gives null for an unknown one', () => {
    for (const m of FIXTURES) for (const k of m.cables) expect(describeCable(m, k.id)!.conductors.length).toBeGreaterThanOrEqual(3);
    expect(describeCable(c1, 'nope')).toBeNull();
  });
});

describe('describeSplice', () => {
  it('lists the wires joined in the nut', () => {
    const d = describeSplice(c4, 'wh')!;
    expect(d.name).toBe('Wire nut 2 of 3 in 2-gang box');
    expect(d.box).toBe('2-gang box');
    expect(d.wires.map((w) => [w.color, w.to.text])).toEqual([
      ['white', 'cable 14/2 "feed" white'],
      ['white', 'cable 14/2 "load A" white'],
      ['white', 'cable 14/2 "load B" white'],
    ]);
    expect(describeSplice(c1, 'gn')!.wires.map((w) => w.to.text)).toContain('Switch · ground');
    expect(describeNet(c4, netOf(c4, 't:fixa.ground'))!.places.map((p) => p.text)).toContain('Light in Light A box · ground');
    expect(describeSplice(c1, 'nope')).toBeNull();
  });

  it('a lone nut in its box is not numbered', () => {
    expect(describeSplice(c3, 'g')!.name).toBe('Wire nut in GFCI box');
  });
});

describe('describe / highlightOf / sameSelection', () => {
  it('dispatches on the selection kind', () => {
    expect(describeSel(c1, { kind: 'device', id: 'sw' })!.kind).toBe('device');
    expect(describeSel(c1, { kind: 'cable', id: 'feed' })!.kind).toBe('cable');
    expect(describeSel(c1, { kind: 'splice', id: 'wn' })!.kind).toBe('splice');
    expect(describeSel(c1, { kind: 'net', net: netOf(c1, 't:sw.t1') })!.kind).toBe('net');
  });

  it('highlights the wires of a net, or the item and the wires touching it', () => {
    const net = netOf(c1, 't:sw.t1');
    const h = highlightOf(c1, { kind: 'net', net });
    expect(h.net).toBe(net);
    expect(h.connections.has(wire(c1, 't:sw.t1'))).toBe(true);
    expect(h.connections.has(wire(c1, 't:sw.t2'))).toBe(false);
    const d = highlightOf(c1, { kind: 'device', id: 'sw' });
    expect(d.devices.has('sw')).toBe(true);
    expect(d.connections.size).toBe(3); // t1, t2 and ground
    expect(highlightOf(c1, { kind: 'splice', id: 'wn' }).connections.size).toBe(2);
    expect(highlightOf(c1, { kind: 'cable', id: 'load' }).cables.has('load')).toBe(true);
  });

  it('compares selections by kind and id', () => {
    expect(sameSelection({ kind: 'device', id: 'a' }, { kind: 'device', id: 'a' })).toBe(true);
    expect(sameSelection({ kind: 'device', id: 'a' }, { kind: 'cable', id: 'a' })).toBe(false);
    expect(sameSelection({ kind: 'net', net: 'n' }, { kind: 'net', net: 'm' })).toBe(false);
    expect(sameSelection(null, null)).toBe(true);
    expect(sameSelection(null, { kind: 'splice', id: 'a' })).toBe(false);
  });
});
