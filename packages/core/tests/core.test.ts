import { describe, expect, it } from 'vitest';
import { FIXTURES } from '../src/fixtures';
import {
  CATALOGUE,
  DEVICE_TYPES,
  cableLabel,
  computeNets,
  conductorsOf,
  deviceTerminalPairs,
  orient,
  validateCircuit,
  type CircuitModel,
  type Endpoint,
  type IssueCode,
} from '../src/index';

const T = (device: string, terminal: string): Endpoint => ({ kind: 'terminal', device, terminal });
const C = (cable: string, color: 'black' | 'white' | 'red' | 'bare' | 'green', box: string): Endpoint => ({ kind: 'conductor', cable, color, box });
const S = (splice: string): Endpoint => ({ kind: 'splice', splice });

const [c1, c2, c3, c4] = FIXTURES;
const clone = (m: CircuitModel): CircuitModel => JSON.parse(JSON.stringify(m));
const codes = (m: unknown): IssueCode[] => [...new Set(validateCircuit(m).map((i) => i.code))].sort();
let n = 0;
const wire = (m: CircuitModel, a: Endpoint, b: Endpoint) =>
  m.connections.push({ id: `x${++n}`, a, b, color: 'black' });

describe('fixtures', () => {
  it('have the expected connection counts', () => {
    expect(FIXTURES.map((m) => m.connections.length)).toEqual([13, 22, 13, 22]);
  });
  it.each(FIXTURES.map((m) => [m.id, m] as const))('%s validates with zero issues', (_id, m) => {
    expect(validateCircuit(m)).toEqual([]);
  });
  it('have stable net counts', () => {
    const counts = FIXTURES.map((m) => new Set(computeNets(m).values()).size);
    expect(counts).toEqual([4, 6, 5, 5]);
  });
  it('orient directs conductor connections panel to load', () => {
    const w = c1.connections[3]; // feed black at swbox -> switch t1
    const [from, to] = orient(c1, w);
    expect(from.kind).toBe('conductor'); // the cable feeds the terminal
    expect(to).toEqual(T('sw', 't1'));
  });
});

describe('catalogue and cables', () => {
  it('derives conductors from cable type', () => {
    expect(conductorsOf('12/2')).toEqual(['black', 'white', 'bare']);
    expect(conductorsOf('10/3')).toEqual(['black', 'red', 'white', 'bare']);
  });
  it('labels cables', () => {
    expect(cableLabel({ type: '14/2', name: 'feed' })).toBe('14/2 NM-B "feed"');
  });
  it('lists every device terminal pair', () => {
    const pairs = deviceTerminalPairs();
    expect(pairs).toHaveLength(DEVICE_TYPES.reduce((s, t) => s + CATALOGUE[t].terminals.length, 0));
    expect(pairs).toContainEqual({ deviceType: 'gfci', terminal: 'load_neutral' });
  });
});

describe('validateCircuit', () => {
  it('SCHEMA: bad shape (and never throws)', () => {
    const m = clone(c1) as any;
    m.boxes[0].kind = 'shed';
    expect(codes(m)).toEqual(['SCHEMA']);
    expect(codes(null)).toEqual(['SCHEMA']);
  });
  it('SCHEMA: rejects extra keys such as coordinates', () => {
    const m = clone(c1) as any;
    m.boxes[0].x = 10;
    expect(codes(m)).toEqual(['SCHEMA']);
  });
  it('DUPLICATE_ID in every collection', () => {
    const boxes = clone(c1);
    boxes.boxes.push({ ...boxes.boxes[0] });
    const devices = clone(c1);
    devices.devices.push({ ...devices.devices[3] });
    const cables = clone(c1);
    cables.cables.push({ ...cables.cables[0] });
    const splices = clone(c1);
    splices.splices.push({ ...splices.splices[0] });
    const conns = clone(c1);
    conns.connections[12].id = conns.connections[11].id;
    for (const m of [boxes, devices, cables, splices, conns]) expect(codes(m)).toEqual(['DUPLICATE_ID']);
  });
  it('AMPS_REQUIRED / AMPS_FORBIDDEN', () => {
    const a = clone(c1);
    delete a.devices.find((d) => d.type === 'breaker')!.amps;
    expect(codes(a)).toEqual(['AMPS_REQUIRED']);
    const b = clone(c1);
    b.devices.find((d) => d.type === 'light')!.amps = 15;
    expect(codes(b)).toEqual(['AMPS_FORBIDDEN']);
  });
  it('UNKNOWN_BOX: device, cable and splice', () => {
    const d = clone(c1);
    d.devices.push({ id: 'z', box: 'nowhere', type: 'light', label: 'Z' });
    const c = clone(c1);
    c.cables[0].to = 'nowhere';
    const s = clone(c1);
    s.splices.push({ id: 'sz', box: 'nowhere' });
    expect(codes(d)).toEqual(['UNKNOWN_BOX']);
    expect(codes(s)).toEqual(['SPLICE_TOO_FEW', 'UNKNOWN_BOX']); // splice with no wiring also flagged
    expect(codes(c)).toContain('UNKNOWN_BOX');
  });
  it('UNKNOWN_DEVICE', () => {
    const m = clone(c1);
    m.connections[9].b = T('ghost', 'ground');
    expect(codes(m)).toEqual(['UNKNOWN_DEVICE']);
  });
  it('UNKNOWN_TERMINAL', () => {
    const m = clone(c1);
    m.connections[9].b = T('sw', 'earth');
    expect(codes(m)).toEqual(['UNKNOWN_TERMINAL']);
  });
  it('UNKNOWN_CABLE', () => {
    const m = clone(c1);
    m.splices.push({ id: 'sx', box: 'swbox' });
    wire(m, C('nope', 'black', 'swbox'), S('sx'));
    wire(m, S('sx'), S('wn'));
    expect(codes(m)).toEqual(['UNKNOWN_CABLE']);
  });
  it('UNKNOWN_SPLICE', () => {
    const m = clone(c1);
    wire(m, S('wn'), S('ghost'));
    expect(codes(m)).toEqual(['UNKNOWN_SPLICE']);
  });
  it('BAD_CONDUCTOR_COLOR: red on a 2-conductor cable', () => {
    const m = clone(c1);
    m.splices.push({ id: 'sx', box: 'swbox' });
    wire(m, C('feed', 'red', 'swbox'), S('sx'));
    wire(m, S('sx'), S('wn'));
    expect(codes(m)).toEqual(['BAD_CONDUCTOR_COLOR']);
  });
  it('CONDUCTOR_BOX_MISMATCH: conductor end at a box the cable does not reach', () => {
    const m = clone(c1);
    m.splices.push({ id: 'sx', box: 'lightbox' }, { id: 'sy', box: 'lightbox' });
    wire(m, C('feed', 'black', 'lightbox'), S('sx'));
    wire(m, S('sx'), S('sy'));
    wire(m, S('sy'), C('feed', 'white', 'lightbox'));
    expect(codes(m)).toEqual(['CONDUCTOR_BOX_MISMATCH']);
  });
  it('BOX_MISMATCH: endpoints in different boxes', () => {
    const m = clone(c1);
    m.devices.push({ id: 'dev2', box: 'lightbox', type: 'light', label: 'Light 2' });
    wire(m, S('wn'), T('dev2', 'hot'));
    expect(codes(m)).toEqual(['BOX_MISMATCH']);
  });
  it('CONDUCTOR_END_UNCONNECTED', () => {
    const m = clone(c1);
    m.connections.splice(7, 1); // feed bare at swbox
    expect(codes(m)).toEqual(['CONDUCTOR_END_UNCONNECTED']);
  });
  it('CONDUCTOR_END_MULTIPLE', () => {
    const m = clone(c1);
    wire(m, C('feed', 'black', 'swbox'), S('wn'));
    expect(codes(m)).toEqual(['CONDUCTOR_END_MULTIPLE']);
  });
  it('TERMINAL_MULTIPLE', () => {
    const m = clone(c1);
    wire(m, S('wn'), T('sw', 't1'));
    expect(codes(m)).toEqual(['TERMINAL_MULTIPLE']);
  });
  it('bus bar terminals may be connected many times', () => {
    const m = clone(c1);
    m.splices.push({ id: 'sp', box: 'panel' });
    wire(m, S('sp'), T('nbar', 'neutral_bar'));
    wire(m, S('sp'), T('gbar', 'ground_bar'));
    expect(codes(m)).toEqual([]);
  });
  it('SPLICE_TOO_FEW', () => {
    const m = clone(c1);
    m.splices.push({ id: 'sz', box: 'swbox' });
    expect(codes(m)).toEqual(['SPLICE_TOO_FEW']);
    const one = clone(c1);
    one.devices.push({ id: 'dev2', box: 'swbox', type: 'light', label: 'Light 2' });
    one.splices.push({ id: 'sz', box: 'swbox' });
    wire(one, S('sz'), T('dev2', 'hot'));
    expect(codes(one)).toEqual(['SPLICE_TOO_FEW']);
  });
  it('SELF_CONNECTION', () => {
    const m = clone(c1);
    wire(m, S('wn'), S('wn'));
    expect(codes(m)).toEqual(['SELF_CONNECTION']);
  });
  it('DUPLICATE_CONNECTION (either direction)', () => {
    const m = clone(c1);
    const w = m.connections[9];
    m.connections.push({ id: 'dup', a: w.b, b: w.a, color: w.color });
    expect(codes(m)).toEqual(['DUPLICATE_CONNECTION']);
  });
  it('issues carry ids and a message', () => {
    const m = clone(c4);
    m.connections.splice(0, 1);
    const [issue] = validateCircuit(m);
    expect(issue.message).toBeTruthy();
    expect(issue.ids.length).toBeGreaterThan(0);
  });
});
