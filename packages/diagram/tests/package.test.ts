import { describe, expect, it } from 'vitest';
import { CATALOGUE, DEVICE_TYPES, type CircuitModel } from '@diy-ai/core';
import { FIXTURES } from '@diy-ai/core/fixtures';
import { GEOMETRY, terminalsOf } from '../src/geometry';
import { InvalidCircuitError, layoutCircuit } from '../src/layout';
import { renderSvg } from '../src/render';

const clone = (m: CircuitModel): CircuitModel => JSON.parse(JSON.stringify(m));

describe('device geometry', () => {
  it('has geometry for exactly the device types of core', () => {
    expect(Object.keys(GEOMETRY).sort()).toEqual([...DEVICE_TYPES].sort());
  });

  it('has geometry for exactly the terminals of core, per device type', () => {
    for (const type of DEVICE_TYPES) {
      expect(Object.keys(GEOMETRY[type].terminals).sort(), type).toEqual(CATALOGUE[type].terminals.map((t) => t.name).sort());
      for (const t of terminalsOf(type)) {
        expect(t.screw).toBe(CATALOGUE[type].terminals.find((d) => d.name === t.name)!.screw);
        expect(t.y).toBeGreaterThan(0);
        expect(t.y).toBeLessThan(GEOMETRY[type].height);
      }
    }
  });
});

describe('layoutCircuit input validation', () => {
  it('rejects an invalid model with the validation issues', async () => {
    const bad = clone(FIXTURES[0]);
    bad.connections[0].a = { kind: 'terminal', device: 'nope', terminal: 'x' };
    const err = await layoutCircuit(bad).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(InvalidCircuitError);
    expect((err as InvalidCircuitError).issues.length).toBeGreaterThan(0);
    expect((err as InvalidCircuitError).issues.map((i) => i.code)).toContain('UNKNOWN_DEVICE');
  });

  it('rejects a model with a layout hint key', async () => {
    const bad = { ...clone(FIXTURES[0]), x: 3 };
    await expect(layoutCircuit(bad as unknown as CircuitModel)).rejects.toBeInstanceOf(InvalidCircuitError);
  });
});

describe('renderSvg', () => {
  it('escapes <, & and " in all model text', async () => {
    const evil = 'a<b & "c"';
    const m = clone(FIXTURES[0]);
    m.title = evil;
    m.boxes[0].label = evil;
    m.devices[0].label = evil;
    m.cables[0].name = evil;
    m.id = evil;
    const svg = renderSvg(await layoutCircuit(m), m);
    const esc = 'a&lt;b &amp; &quot;c&quot;';
    expect(svg).not.toContain(evil);
    expect(svg).toContain(esc);
    expect(svg).toContain(`data-circuit="${esc}"`);
    expect(svg).not.toMatch(/<\/style>[^]*<\/style>/);
  });

  it('tags devices, splices, cables, connections and every wire path with model ids and nets', async () => {
    for (const m of FIXTURES) {
      const svg = renderSvg(await layoutCircuit(m), m);
      for (const d of m.devices) expect(svg).toContain(`data-device="${d.id}"`);
      for (const s of m.splices) expect(svg).toContain(`data-splice="${s.id}"`);
      for (const k of m.cables) expect(svg).toContain(`data-cable="${k.id}"`);
      for (const c of m.connections) expect(svg).toContain(`data-connection="${c.id}"`);
      expect(svg).toContain(':hover)');
      const paths = [...svg.matchAll(/<path ([^>]*)>/g)].map((x) => x[1]);
      expect(paths.length).toBeGreaterThan(0);
      for (const p of paths) expect(p).toContain('data-net="');
    }
  });
});
