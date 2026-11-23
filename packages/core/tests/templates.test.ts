import { describe, expect, it } from 'vitest';
import { FIXTURES } from '../src/fixtures';
import {
  CATALOGUE,
  DEVICE_TYPES,
  BLOCK_TYPES,
  BUILDING_BLOCKS,
  MAX_BLOCKS,
  ReplySchema,
  TEMPLATES,
  buildSystemPrompt,
  formatIssuesForModel,
  getTemplate,
  replyJsonSchema,
  resolveReply,
  validateCircuit,
  type CircuitModel,
  type Endpoint,
  type ReplyCircuit,
  buildCircuit,
  COUNT_FIELDS,
  LABEL_FIELDS,
} from '../src/index';

const FIXTURE_FOR: Record<string, CircuitModel> = {
  single_pole_switch: FIXTURES[0],
  three_way_switches: FIXTURES[1],
  gfci_downstream_receptacle: FIXTURES[2],
  two_gang_two_switches: FIXTURES[3],
};
const stripIds = (m: CircuitModel) => ({
  ...m,
  id: undefined,
  title: undefined,
  connections: m.connections.map(({ id: _id, ...rest }) => rest),
});
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('templates', () => {
  it('registers the four templates with unique ids', () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(Object.keys(FIXTURE_FOR));
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(4);
  });
  it.each(TEMPLATES.map((t) => [t.id, t] as const))('%s defaults validate and match its fixture', (id, t) => {
    const m = t.build();
    expect(validateCircuit(m)).toEqual([]);
    expect(stripIds(m)).toEqual(stripIds(FIXTURE_FOR[id]));
    expect(t.build({})).toEqual(m);
  });
  it.each(TEMPLATES.map((t) => [t.id, t] as const))('%s: every breakerAmps validates; gauge follows amps', (_id, t) => {
    for (const breakerAmps of [15, 20]) {
      const m = t.build({ breakerAmps });
      expect(validateCircuit(m)).toEqual([]);
      const gauge = breakerAmps === 15 ? '14' : '12';
      expect(m.cables.every((c) => c.type.startsWith(`${gauge}/`))).toBe(true);
      expect(m.devices.find((d) => d.type === 'breaker')?.amps).toBe(breakerAmps);
    }
  });
  it('uses x/3 only for the 3-way travelers', () => {
    expect(getTemplate('three_way_switches')!.build({ breakerAmps: 20 }).cables.map((c) => c.type)).toEqual(['12/2', '12/3', '12/2']);
    expect(getTemplate('three_way_switches')!.build().cables.map((c) => c.type)).toEqual(['14/2', '14/3', '14/2']);
  });
  it.each(TEMPLATES.map((t) => [t.id, t] as const))('%s: parameters never change topology', (_id, t) => {
    const labels = Object.fromEntries(Object.entries(t.params).filter(([, p]) => p.kind === 'label').map(([k]) => [k, `x ${k}`]));
    const topology = (m: CircuitModel) => JSON.stringify([m.boxes.map((b) => [b.id, b.kind]), m.devices.map((d) => [d.id, d.box, d.type]), m.cables.map((c) => [c.id, c.from, c.to]), m.splices, m.connections]);
    const base = t.build({ breakerAmps: 15 });
    expect(topology(t.build({ ...labels, breakerAmps: 15 }))).toBe(topology(base));
    // 20 A changes cable types only
    const m20 = t.build({ breakerAmps: 20 });
    expect(m20.connections).toEqual(base.connections);
    expect(m20.cables.map((c) => [c.id, c.from, c.to])).toEqual(base.cables.map((c) => [c.id, c.from, c.to]));
  });
  it.each(TEMPLATES.map((t) => [t.id, t] as const))('%s: odd labels survive', (_id, t) => {
    const odd = ['He said "hi" & <b>', "O'Brien's \\ back\\slash", 'Ünïcödé 💡 日本語', 'line1\nline2', '  padded  ', '{"a":1}'];
    odd.forEach((label, i) => {
      const labels = Object.fromEntries(Object.entries(t.params).filter(([, p]) => p.kind === 'label').map(([k]) => [k, label]));
      const m = t.build(labels);
      expect(validateCircuit(m)).toEqual([]);
      const round = JSON.parse(JSON.stringify(m));
      expect(round).toEqual(m);
      const used = [...m.boxes.map((b) => b.label), ...m.devices.map((d) => d.label)];
      expect(used).toContain(label);
      void i;
    });
  });
  it('rejects bad params', () => {
    const t = getTemplate('single_pole_switch')!;
    expect(t.paramsSchema.safeParse({ breakerAmps: 30 }).success).toBe(false);
    expect(t.paramsSchema.safeParse({ breakerAmps: '15' }).success).toBe(false);
    expect(t.paramsSchema.safeParse({ switchLabel: '  ' }).success).toBe(false);
    expect(t.paramsSchema.safeParse({ nope: 1 }).success).toBe(false);
    expect(() => t.build({ breakerAmps: 30 })).toThrow();
  });
  it('build does not mutate or share state between calls', () => {
    const t = getTemplate('gfci_downstream_receptacle')!;
    const a = t.build();
    a.devices[0].label = 'changed';
    expect(t.build().devices[0].label).not.toBe('changed');
  });
});

// ---- reply schema ----

// Wire form: a circuit is a breakerAmps number, a name and a list of flat block entries; unused fields hold their unused value.
const unused = { target: 'none', breakerAmps: 0, name: '', blocks: [] as unknown[], custom: [] as unknown[] };
/** A flat block entry as the model writes it: every key present, unused ones 0 / false / "". */
const entry = (type: string, over: Record<string, unknown> = {}) => ({
  type,
  ...Object.fromEntries(COUNT_FIELDS.map((c) => [c, 0])),
  gfciFirst: false,
  ...Object.fromEntries(LABEL_FIELDS.map((l) => [l, ''])),
  ...over,
});
const circuitReply = (blocks: unknown[] = [entry('switch_lights', { count: 1 })], over: Record<string, unknown> = {}) => ({
  ...unused,
  kind: 'circuit',
  target: 'new',
  message: 'ok',
  breakerAmps: 15,
  name: 'Hall light',
  blocks,
  ...over,
});
const toWireEndpoint = (e: Endpoint): ReplyCircuit['connections'][number]['a'] => ({ device: '', terminal: '', cable: '', color: '', box: '', splice: '', ...e });
const toReplyCircuit = (m: CircuitModel): ReplyCircuit =>
  ({
    ...clone(m),
    devices: m.devices.map((d) => ({ ...d, amps: d.amps ?? 0 })),
    connections: m.connections.map((c) => ({ ...c, a: toWireEndpoint(c.a), b: toWireEndpoint(c.b) })),
  }) as ReplyCircuit;
const customReply = (circuit: unknown = toReplyCircuit(FIXTURES[0]), over: Record<string, unknown> = {}) => ({
  ...unused,
  kind: 'custom',
  target: 'new',
  message: 'custom',
  custom: [circuit],
  ...over,
});
const questionReply = { ...unused, kind: 'question', message: 'Which room?' };
const unsupportedReply = { ...unused, kind: 'unsupported', message: 'Service panel work is not DIY.' };
/** One valid entry per block type. */
const SAMPLE_ENTRIES = [
  entry('receptacle_run', { count: 3, gfciFirst: true }),
  entry('switch_lights', { count: 2 }),
  entry('three_way_lights', { count: 2 }),
  entry('switch_fan'),
  entry('two_gang_switches', { countA: 2, countB: 1 }),
];

describe('reply schema', () => {
  it('accepts one example of each kind', () => {
    expect(ReplySchema.safeParse(questionReply).success).toBe(true);
    expect(ReplySchema.safeParse(unsupportedReply).success).toBe(true);
    for (const e of SAMPLE_ENTRIES) expect(ReplySchema.safeParse(circuitReply([e])).success, e.type).toBe(true);
    expect(ReplySchema.safeParse(circuitReply(SAMPLE_ENTRIES.slice(0, 2), { breakerAmps: 20 })).success).toBe(true);
    expect(ReplySchema.safeParse(customReply()).success).toBe(true);
  });
  it('has no template fields', () => {
    const props = Object.keys((replyJsonSchema().properties ?? {}) as object);
    expect(props).toEqual(['kind', 'target', 'message', 'breakerAmps', 'name', 'blocks', 'custom']);
    expect(JSON.stringify(replyJsonSchema())).not.toMatch(/template|labels"/i);
  });
  it('rejects malformed replies', () => {
    const bad: unknown[] = [
      null,
      'text',
      {},
      { kind: 'question', message: 'a' },
      { ...questionReply, blocks: [entry('switch_fan')] },
      { ...questionReply, custom: [toReplyCircuit(FIXTURES[0])] },
      { ...questionReply, name: 'x' },
      { ...unsupportedReply, breakerAmps: 15 },
      { ...questionReply, kind: 'maybe' },
      { ...questionReply, kind: 'template' },
      { ...questionReply, extra: 1 },
      circuitReply([entry('four_way', { count: 1 })]),
      circuitReply([entry('switch_lights', { count: 1 })], { breakerAmps: 30 }),
      circuitReply([{ ...entry('switch_lights', { count: 1 }), bogus: 1 }]),
      circuitReply([entry('switch_lights', { count: 1 })], { custom: [toReplyCircuit(FIXTURES[0])] }),
      circuitReply([entry('switch_lights', { count: 1 })], { templateId: 'single_pole_switch' }),
      customReply({ ...toReplyCircuit(FIXTURES[0]), x: 1 }),
      customReply({ ...toReplyCircuit(FIXTURES[0]), boxes: [{ id: 'a', label: 'a', kind: 'room' }] }),
      customReply(toReplyCircuit(FIXTURES[0]), { custom: [] }),
      customReply(toReplyCircuit(FIXTURES[0]), { breakerAmps: 15 }),
      customReply(toReplyCircuit(FIXTURES[0]), { blocks: [entry('switch_fan')] }),
    ];
    for (const b of bad) expect(ReplySchema.safeParse(b).success, JSON.stringify(b)).toBe(false);
  });

  describe('generated JSON Schema satisfies the provider-neutral constraints', () => {
    const FORBIDDEN = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'pattern', 'maxItems', 'format', 'uniqueItems', '$ref', '$defs', 'definitions', 'oneOf', 'allOf', 'not', 'if', 'then', 'else'];
    const schema = replyJsonSchema();
    const visit = (node: unknown, path: string, out: { path: string; node: Record<string, unknown> }[]) => {
      if (Array.isArray(node)) node.forEach((n, i) => visit(n, `${path}[${i}]`, out));
      else if (node && typeof node === 'object') {
        out.push({ path, node: node as Record<string, unknown> });
        for (const [k, v] of Object.entries(node)) if (['properties'].includes(k)) for (const [pk, pv] of Object.entries(v as object)) visit(pv, `${path}.${pk}`, out);
        else if (['items', 'anyOf'].includes(k)) visit(v, `${path}.${k}`, out);
      }
    };
    const nodes: { path: string; node: Record<string, unknown> }[] = [];
    visit(schema, '$', nodes);

    it('walks a non-trivial schema', () => {
      expect(nodes.length).toBeGreaterThan(40);
      expect(schema.type).toBe('object');
    });
    it('every object has additionalProperties false and lists all properties as required', () => {
      const objects = nodes.filter((n) => n.node.type === 'object' || n.node.properties);
      expect(objects.length).toBeGreaterThan(8);
      for (const { path, node } of objects) {
        expect(node.additionalProperties, path).toBe(false);
        expect([...(node.required as string[])].sort(), path).toEqual(Object.keys(node.properties as object).sort());
      }
    });
    it('uses no forbidden keywords anywhere (including no refs or recursion)', () => {
      const text = JSON.stringify(schema);
      for (const key of FORBIDDEN) expect(text.includes(`"${key}":`), key).toBe(false);
      for (const { path, node } of nodes) for (const key of FORBIDDEN) expect(key in node, `${path}.${key}`).toBe(false);
    });
    it('minItems, if present, is at most 1', () => {
      for (const { path, node } of nodes) if ('minItems' in node) expect(node.minItems as number, path).toBeLessThanOrEqual(1);
    });
    it('has no union-typed parameters (Claude structured-output limit is 16)', () => {
      // Claude counts any property whose type is a union: a type array such as ["string","null"], or an anyOf/oneOf.
      const unionCount = (node: unknown): number => {
        if (Array.isArray(node)) return node.reduce<number>((n, v) => n + unionCount(v), 0);
        if (!node || typeof node !== 'object') return 0;
        const o = node as Record<string, unknown>;
        const own = 'anyOf' in o || 'oneOf' in o || Array.isArray(o.type) ? 1 : 0;
        return own + Object.values(o).reduce<number>((n, v) => n + unionCount(v), 0);
      };
      expect(unionCount(schema)).toBe(0);
      // sanity: the counter does detect unions
      expect(unionCount({ properties: { a: { type: ['string', 'null'] }, b: { anyOf: [{ type: 'string' }, { type: 'null' }] } } })).toBe(2);
    });
    it('unions are few and shallow', () => {
      const unions = nodes.filter((n) => 'anyOf' in n.node);
      for (const { path, node } of unions) expect((node.anyOf as unknown[]).length, path).toBeLessThanOrEqual(BUILDING_BLOCKS.length + 1);
      for (const { path, node } of unions) for (const v of node.anyOf as Record<string, unknown>[]) expect('anyOf' in v, path).toBe(false);
    });
    it('is generated from the registries', () => {
      const text = JSON.stringify(schema);
      for (const id of BLOCK_TYPES) expect(text).toContain(`"${id}"`);
      for (const f of [...COUNT_FIELDS, ...LABEL_FIELDS]) expect(text).toContain(`"${f}"`);
      for (const d of DEVICE_TYPES) expect(text).toContain(`"${d}"`);
    });
    it('is deterministic and provider-neutral', () => {
      expect(JSON.stringify(replyJsonSchema())).toBe(JSON.stringify(schema));
      expect(JSON.stringify(schema)).not.toMatch(/claude|anthropic|openai|llama|gpt|qwen/i);
    });
  });
});

// ---- resolver ----

describe('resolveReply', () => {
  it('passes question and unsupported through', () => {
    expect(resolveReply(questionReply)).toEqual({ kind: 'question', text: 'Which room?' });
    expect(resolveReply(unsupportedReply)).toEqual({ kind: 'unsupported', message: 'Service panel work is not DIY.' });
  });
  it('builds a circuit from blocks with a blocks origin', () => {
    const r = resolveReply(circuitReply([entry('three_way_lights', { count: 8 }), entry('receptacle_run', { count: 8 })], { message: 'hello', name: 'Basement' }));
    expect(r.kind).toBe('circuit');
    if (r.kind !== 'circuit') return;
    expect(r.message).toBe('hello');
    expect(r.circuit).toEqual(buildCircuit({ id: 'circuit', title: 'Basement', breakerAmps: 15, blocks: [{ type: 'three_way_lights', count: 8 }, { type: 'receptacle_run', count: 8 }] }));
    expect(r.origin).toMatchObject({ kind: 'blocks', breakerAmps: 15, name: 'Basement' });
    expect((r.origin as { blocks: unknown[] }).blocks).toHaveLength(2);
    expect((r.origin as { blocks: unknown[] }).blocks[0]).toMatchObject({ type: 'three_way_lights', count: 8, switchLabel: '3-way switch' });
    expect(validateCircuit(r.circuit)).toEqual([]);
  });
  it.each(SAMPLE_ENTRIES.map((e) => [e.type, e] as const))('every block type resolves alone (%s), at both breaker sizes', (_t, e) => {
    for (const breakerAmps of [15, 20]) {
      const r = resolveReply(circuitReply([e], { breakerAmps }));
      expect(r.kind, JSON.stringify(r)).toBe('circuit');
      if (r.kind === 'circuit') expect(r.origin.kind).toBe('blocks');
    }
  });
  it('applies labels, and blank labels mean the default', () => {
    const r = resolveReply(circuitReply([entry('switch_lights', { count: 1, lightLabel: 'Hall light', switchLabel: '   ' })], { name: '  ' }));
    expect(r.kind).toBe('circuit');
    if (r.kind !== 'circuit') return;
    expect(r.circuit.devices.find((d) => d.type === 'light')?.label).toBe('Hall light 1');
    expect(r.circuit.devices.find((d) => d.type === 'switch_sp')?.label).toBe('Switch 1');
    expect(r.circuit.title).toBe('Circuit');
    expect(r.origin).toMatchObject({ kind: 'blocks', name: '', blocks: [{ type: 'switch_lights', count: 1, lightLabel: 'Hall light', switchLabel: 'Switch' }] });
    expect(r.circuit.boxes.concat(r.circuit.devices as never).every((x) => x.label !== '')).toBe(true);
  });
  it('a two-gang entry carries countA and countB', () => {
    const r = resolveReply(circuitReply([entry('two_gang_switches', { countA: 3, countB: 2 })]));
    expect(r.kind).toBe('circuit');
    if (r.kind === 'circuit') expect(r.circuit.devices.filter((d) => d.type === 'light')).toHaveLength(5);
  });
  it('missing or null unused fields count as unused', () => {
    const { breakerAmps: _b, name: _n, blocks: _bl, custom: _c, ...bare } = questionReply;
    expect(resolveReply(bare)).toEqual({ kind: 'question', text: 'Which room?' });
    expect(resolveReply({ ...questionReply, custom: null, blocks: null, name: null })).toEqual({ kind: 'question', text: 'Which room?' });
    const slim = { type: 'switch_lights', count: 2 }; // only the used fields
    expect(resolveReply(circuitReply([slim])).kind).toBe('circuit');
  });

  describe('bad block lists come back as issues the model can act on', () => {
    const issuesOf = (reply: unknown) => {
      const r = resolveReply(reply);
      expect(r.kind, JSON.stringify(reply)).toBe('invalid');
      return r.kind === 'invalid' ? r.issues : [];
    };
    it('unknown block type lists the valid ones', () => {
      const [i] = issuesOf(circuitReply([entry('four_way', { count: 1 })]));
      expect(i.code).toBe('UNKNOWN_BLOCK');
      expect(i.message).toContain('four_way');
      for (const id of BLOCK_TYPES) expect(i.message).toContain(id);
    });
    it('counts out of range or not whole', () => {
      for (const [over, text] of [
        [{ count: 0 }, /count must be at least 1/],
        [{ count: 13 }, /count must be at most 12/],
        [{ count: 2.5 }, /whole number/],
        [{ count: -1 }, /at least 1/],
      ] as const) {
        const [i] = issuesOf(circuitReply([entry('switch_lights', over)]));
        expect(i.code).toBe('BAD_BLOCK');
        expect(i.message).toMatch(/block 1 \(switch_lights\)/);
        expect(i.message).toMatch(text);
      }
      expect(issuesOf(circuitReply([entry('two_gang_switches', { countA: 2, countB: 0 })]))[0]!.message).toMatch(/countB must be at least 1|switch B light count/);
    });
    it('a used count that is missing', () => {
      const [i] = issuesOf(circuitReply([{ type: 'receptacle_run' }]));
      expect(i).toMatchObject({ code: 'BAD_BLOCK' });
      expect(i.message).toContain('count is missing');
    });
    it('wrong sentinel use: a field the block does not take must be unused', () => {
      const cases: [Record<string, unknown>, string, string][] = [
        [{ type: 'switch_fan', count: 2 }, 'count', 'set it to 0'],
        [{ type: 'switch_lights', count: 2, gfciFirst: true }, 'gfciFirst', 'set it to false'],
        [{ type: 'receptacle_run', count: 2, countA: 1 }, 'countA', 'set it to 0'],
        [{ type: 'two_gang_switches', countA: 1, countB: 1, count: 3 }, 'count', 'set it to 0'],
        [{ type: 'receptacle_run', count: 2, lightLabel: 'x' }, 'lightLabel', 'set it to ""'],
        [{ type: 'switch_fan', fanLabel: 'F', gangBoxLabel: 'G' }, 'gangBoxLabel', 'set it to ""'],
      ];
      for (const [e, field, hint] of cases) {
        const [i] = issuesOf(circuitReply([entry(e.type as string, e)]));
        expect(i.code).toBe('BAD_BLOCK');
        expect(i.message).toContain(`"${field}" is not used by ${e.type}`);
        expect(i.message).toContain(hint);
      }
    });
    it('unknown keys in an entry', () => {
      expect(issuesOf(circuitReply([{ ...entry('switch_fan'), bogus: 1 }]))[0]).toMatchObject({ code: 'BAD_BLOCK' });
    });
    it('blocks that are not objects', () => {
      expect(issuesOf(circuitReply(['switch_fan']))[0]).toMatchObject({ code: 'BAD_BLOCK' });
      expect(issuesOf(circuitReply([null]))[0]).toMatchObject({ code: 'BAD_BLOCK' });
    });
    it('too many blocks and no blocks', () => {
      const many = Array.from({ length: MAX_BLOCKS + 1 }, () => entry('switch_fan'));
      expect(issuesOf(circuitReply(many))[0]).toMatchObject({ code: 'BAD_BLOCK_LIST' });
      expect(resolveReply(circuitReply(many.slice(0, MAX_BLOCKS))).kind).toBe('circuit');
      expect(issuesOf(circuitReply([]))[0]).toMatchObject({ code: 'BAD_BLOCK_LIST' });
      expect(issuesOf(circuitReply('text' as never))[0]).toMatchObject({ code: 'BAD_BLOCK_LIST' });
    });
    it('breaker size missing or wrong', () => {
      for (const breakerAmps of [0, 30, '15', undefined]) expect(issuesOf(circuitReply([entry('switch_fan')], { breakerAmps }))[0]).toMatchObject({ code: 'BAD_BREAKER' });
    });
    it('every bad entry is reported, one issue per problem, and nothing is built', () => {
      const issues = issuesOf(circuitReply([entry('switch_lights', { count: 0 }), entry('switch_fan', { count: 1 }), entry('nope')]));
      expect(issues.map((i) => i.code)).toEqual(['BAD_BLOCK', 'BAD_BLOCK', 'UNKNOWN_BLOCK']);
      expect(issues[1]!.message).toContain('block 2');
      expect(issues[2]!.message).toContain('block 3');
    });
  });

  it('flat endpoints and amps 0 resolve to the model form, ignoring "" fields', () => {
    const r = resolveReply(customReply());
    expect(r.kind === 'circuit' && r.circuit).toEqual(FIXTURES[0]);
    const c = toReplyCircuit(FIXTURES[0]);
    const term = c.connections.find((x) => x.b.kind === 'terminal')!;
    term.b.cable = 'ignored'; // unused field on a terminal endpoint: ignored
    const r2 = resolveReply(customReply(c));
    expect(r2.kind === 'circuit' && r2.circuit).toEqual(FIXTURES[0]);
  });
  it('rejects zero or several outcomes and non-objects', () => {
    const bad = [
      null,
      5,
      [],
      {},
      { ...unused, message: 'x' }, // no kind
      { ...questionReply, kind: 'maybe' },
      { ...questionReply, blocks: [entry('switch_fan')] }, // two outcomes
      { ...questionReply, custom: [toReplyCircuit(FIXTURES[0])] },
      { ...unsupportedReply, breakerAmps: 20 },
      { ...questionReply, message: '  ' },
      { ...unsupportedReply, message: '' },
      circuitReply([entry('switch_fan')], { custom: [toReplyCircuit(FIXTURES[0])] }),
      customReply(toReplyCircuit(FIXTURES[0]), { custom: [] }),
      customReply(toReplyCircuit(FIXTURES[0]), { custom: [toReplyCircuit(FIXTURES[0]), toReplyCircuit(FIXTURES[0])] }),
      customReply(toReplyCircuit(FIXTURES[0]), { blocks: [entry('switch_fan')] }),
      customReply(toReplyCircuit(FIXTURES[0]), { breakerAmps: 15 }),
      { ...questionReply, target: 'new' },
      { ...unsupportedReply, target: 'selected' },
      circuitReply([entry('switch_fan')], { target: 'none' }),
      circuitReply([entry('switch_fan')], { target: 'both' }),
      customReply(toReplyCircuit(FIXTURES[0]), { target: 'none' }),
      (({ target: _t, ...rest }) => rest)(circuitReply([entry('switch_fan')])),
    ];
    for (const b of bad) {
      const r = resolveReply(b);
      expect(r.kind, JSON.stringify(b)).toBe('invalid');
      if (r.kind === 'invalid') expect(r.issues[0].code).toBe('BAD_REPLY');
    }
    expect(resolveReply({ ...unused, kind: 'circuit', message: 5, breakerAmps: 15, blocks: [entry('switch_fan')] }).kind).toBe('invalid');
  });
  it('replays old stored replies (both earlier shapes) as invalid, never throwing', () => {
    for (const old of [
      // task 14 flat shape with kind "template"
      { kind: 'template', message: 'old', templateId: 'single_pole_switch', breakerAmps: 20, labels: [{ param: 'lightLabel', value: 'x' }], custom: [] },
      { kind: 'question', message: 'Which room?', templateId: 'none', breakerAmps: 0, labels: [], custom: [] },
      { kind: 'custom', message: 'm', templateId: 'none', breakerAmps: 0, labels: [], custom: [toReplyCircuit(FIXTURES[0])] },
      // task 9 four-key shape
      { question: 'Which room?', template: null, custom: null, unsupported: null },
      { question: null, template: { templateId: 'single_pole_switch', params: { breakerAmps: null }, message: 'm' }, custom: null, unsupported: null },
      { question: null, template: null, custom: { circuit: FIXTURES[0], message: 'm' }, unsupported: null },
    ]) {
      let r: ReturnType<typeof resolveReply> | undefined;
      expect(() => (r = resolveReply(old)), JSON.stringify(old)).not.toThrow();
      // a stored template-era reply no longer resolves; it is replayed to the model as plain text by the api
      if ('template' in old || old.kind === 'template') {
        expect(r!.kind).toBe('invalid');
        if (r!.kind === 'invalid') expect(r!.issues[0].code).toBe('BAD_REPLY');
      }
    }
  });
  it('returns the target with circuit results, for blocks and custom', () => {
    for (const target of ['new', 'selected'] as const) {
      const b = resolveReply(circuitReply([entry('switch_fan')], { target }));
      expect(b.kind === 'circuit' && b.target).toBe(target);
      const c = resolveReply(customReply(toReplyCircuit(FIXTURES[0]), { target }));
      expect(c.kind === 'circuit' && c.target).toBe(target);
    }
  });
  it('target is a required enum of none, new and selected', () => {
    const t = (replyJsonSchema().properties as Record<string, { enum?: string[] }>).target!;
    expect(t.enum).toEqual(['none', 'new', 'selected']);
    expect((replyJsonSchema().required as string[]).includes('target')).toBe(true);
  });
  it('accepts a valid custom circuit as unverified', () => {
    const r = resolveReply(customReply());
    expect(r.kind).toBe('circuit');
    if (r.kind !== 'circuit') return;
    expect(r.origin).toEqual({ kind: 'custom', verified: false });
    expect(r.circuit).toEqual(FIXTURES[0]);
    expect(r.message).toBe('custom');
  });
  it('returns issues for an invalid custom circuit', () => {
    const c = toReplyCircuit(FIXTURES[0]);
    c.connections.pop();
    c.connections[0] = { ...c.connections[0], b: toWireEndpoint({ kind: 'terminal', device: 'sw', terminal: 'nope' }) };
    const r = resolveReply(customReply(c));
    expect(r.kind).toBe('invalid');
    if (r.kind !== 'invalid') return;
    const codes = r.issues.map((i) => i.code);
    expect(codes).toContain('UNKNOWN_TERMINAL');
    expect(codes).toContain('CONDUCTOR_END_UNCONNECTED');
  });
  it('rejects custom circuits with coordinates or a non-breaker with amps', () => {
    const c = toReplyCircuit(FIXTURES[0]);
    (c.boxes[0] as Record<string, unknown>).x = 10;
    const r = resolveReply(customReply(c));
    expect(r.kind === 'invalid' && r.issues.every((i) => i.code === 'SCHEMA')).toBe(true);
    const d = toReplyCircuit(FIXTURES[0]);
    d.devices[3].amps = 15; // switch
    const r2 = resolveReply(customReply(d));
    expect(r2.kind === 'invalid' && r2.issues.map((i) => i.code)).toContain('AMPS_FORBIDDEN');
  });
  it('rejects a malformed custom payload', () => {
    expect(resolveReply(customReply('x' as unknown)).kind).toBe('invalid');
    expect(resolveReply(customReply(null)).kind).toBe('invalid');
    expect(resolveReply({ ...customReply(), message: 5 }).kind).toBe('invalid');
  });
  it('does not mutate its input', () => {
    for (const input of [customReply(), circuitReply(SAMPLE_ENTRIES)]) {
      const before = JSON.stringify(input);
      resolveReply(input);
      expect(JSON.stringify(input)).toBe(before);
    }
  });
});

describe('formatIssuesForModel', () => {
  it('lists codes, messages and ids tersely', () => {
    const text = formatIssuesForModel([
      { code: 'UNKNOWN_TERMINAL', message: 'switch_sp "sw" has no terminal "x"', ids: ['c1', 'sw'] },
      { code: 'BAD_BLOCK', message: 'bad', ids: [] },
    ]);
    expect(text).toContain('- UNKNOWN_TERMINAL: switch_sp "sw" has no terminal "x" [c1, sw]');
    expect(text).toContain('- BAD_BLOCK: bad');
    expect(text.split('\n')).toHaveLength(3);
  });
  it('caps long lists', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ code: 'SCHEMA' as const, message: `m${i}`, ids: [] }));
    const lines = formatIssuesForModel(many).split('\n');
    expect(lines).toHaveLength(22);
    expect(lines.at(-1)).toBe('- ... and 30 more');
  });
});

// ---- prompt ----

describe('buildSystemPrompt', () => {
  const p = buildSystemPrompt();
  it('is byte-identical across calls', () => {
    expect(buildSystemPrompt()).toBe(p);
  });
  it('contains every block type, count and label field, device type and terminal name', () => {
    for (const b of BUILDING_BLOCKS) {
      expect(p).toContain(b.id);
      expect(p).toContain(b.title);
      expect(p).toContain(b.appliesWhen);
      expect(p).toContain(b.notFor);
    }
    for (const f of [...COUNT_FIELDS, ...LABEL_FIELDS, 'gfciFirst', 'breakerAmps', 'blocks', 'name']) expect(p).toContain(f);
    for (const type of DEVICE_TYPES) {
      expect(p).toContain(type);
      for (const term of CATALOGUE[type].terminals) expect(p).toContain(term.name);
    }
  });
  it('no longer offers templates', () => {
    for (const t of TEMPLATES) expect(p).not.toContain(t.id);
    expect(p).not.toMatch(/templateId|template/i);
  });
  it('states the composition rules', () => {
    for (const s of ['order power flows from the panel', "previous block's feed-through box", 'One breaker per circuit', 'breaker size', 'switch locations', 'Always prefer blocks over a custom circuit']) expect(p).toContain(s);
  });
  it('explains several circuits and the target values', () => {
    for (const s of ['# Several circuits', 'target "selected"', 'target "new"', 'marked as selected', 'own breaker', 'unclear', 'exactly these seven keys']) expect(p).toContain(s);
  });
  it('states the limits', () => {
    for (const s of ['US residential', 'coordinates', 'unsupported', 'service panel', 'aluminium', 'knob-and-tube', 'clarifying question', 'unverified']) expect(p).toContain(s);
  });
  it('is deterministic text with nothing provider-specific', () => {
    expect(p).not.toMatch(/claude|anthropic|openai|llama|gpt|qwen|gemini/i);
    expect(p).not.toMatch(/\d{4}-\d{2}-\d{2}|[0-9a-f]{8}-[0-9a-f]{4}/);
  });
});
