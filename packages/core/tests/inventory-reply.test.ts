import { describe, expect, it } from 'vitest';
import { PLAN_TEXT_CLOSING, REPLY_KINDS, ReplySchema, buildSystemPrompt, formatPlanText, planCircuits, replyJsonSchema, replyShapeProblem, resolveReply, ROOM_TYPES } from '../src';

const base = { target: 'none', breakerAmps: 0, name: '', blocks: [] as unknown[], custom: [] as unknown[], basement: false, rooms: [] as unknown[], maxReceptaclesPerCircuit: 0, lightingBreakerAmps: 0 };
const room = (over: Record<string, unknown> = {}) => ({ id: 'living', name: 'Living area', type: 'living_area', receptacles: 8, lightGroups: [{ lights: 8, switchLocations: 2 }], fans: 0, attachedTo: '', ...over });
const BASEMENT_ROOMS = [
  room(),
  room({ id: 'bath', name: 'Bathroom', type: 'bathroom', receptacles: 3, lightGroups: [{ lights: 1, switchLocations: 1 }], fans: 1 }),
  room({ id: 'bed', name: 'Bedroom', type: 'bedroom', receptacles: 5, lightGroups: [{ lights: 2, switchLocations: 1 }] }),
  room({ id: 'closet', name: 'Closet', type: 'closet', receptacles: 0, lightGroups: [{ lights: 1, switchLocations: 1 }], attachedTo: 'bed' }),
];
const inv = (rooms: unknown[] = BASEMENT_ROOMS, over: Record<string, unknown> = {}) => ({ ...base, kind: 'inventory', message: 'Listed.', basement: true, rooms, ...over });

describe('inventory reply kind', () => {
  it('is a reply kind and the example parses against ReplySchema', () => {
    expect(REPLY_KINDS).toContain('inventory');
    expect(ReplySchema.safeParse(inv()).success).toBe(true);
  });

  it('schema stays free of unions, keeps every property required, adds the new fields and removes none', () => {
    const schema: any = replyJsonSchema();
    expect(JSON.stringify(schema)).not.toMatch(/anyOf|oneOf|"type":\[/);
    for (const f of ['kind', 'target', 'message', 'breakerAmps', 'name', 'blocks', 'custom', 'basement', 'rooms', 'maxReceptaclesPerCircuit', 'lightingBreakerAmps']) {
      expect(schema.properties[f], f).toBeDefined();
      expect(schema.required).toContain(f);
    }
    expect(Object.keys(schema.properties.rooms.items.properties)).toEqual(['id', 'name', 'type', 'receptacles', 'lightGroups', 'fans', 'attachedTo']);
    expect(schema.properties.rooms.items.properties.type.enum).toEqual([...ROOM_TYPES]);
  });

  it('shape rules: inventory leaves circuit fields unused; other kinds leave inventory fields unused', () => {
    expect(replyShapeProblem(inv())).toBeNull();
    expect(replyShapeProblem(inv(BASEMENT_ROOMS, { breakerAmps: 15 }))).toMatch(/inventory must leave/);
    expect(replyShapeProblem(inv(BASEMENT_ROOMS, { target: 'new' }))).toMatch(/inventory must leave/);
    expect(replyShapeProblem(inv(BASEMENT_ROOMS, { name: 'x' }))).toMatch(/inventory must leave/);
    expect(replyShapeProblem({ ...base, kind: 'question', message: 'q', rooms: [room()] })).toMatch(/must leave rooms unused/);
    expect(replyShapeProblem({ ...base, kind: 'question', message: 'q', basement: true })).toMatch(/basement/);
    expect(replyShapeProblem({ ...base, kind: 'circuit', target: 'new', lightingBreakerAmps: 15 })).toMatch(/lightingBreakerAmps/);
    expect(replyShapeProblem({ kind: 'question', message: 'q' })).toBeNull(); // earlier stored shapes
  });
});

describe('resolveReply inventory', () => {
  it('valid inventory resolves to the plan from planCircuits; no circuit is produced', () => {
    const r = resolveReply(inv());
    expect(r.kind).toBe('inventory');
    if (r.kind !== 'inventory') return;
    expect(r.plan).toEqual(planCircuits({ basement: true, rooms: BASEMENT_ROOMS as any }, {}));
    expect(r.options).toEqual({});
    expect(r.plan.circuits.length).toBeGreaterThan(0);
    expect(r.message).toBe('Listed.');
  });

  it('0 options mean defaults; stated options are passed to the planner', () => {
    const r = resolveReply(inv(BASEMENT_ROOMS, { maxReceptaclesPerCircuit: 4, lightingBreakerAmps: 20 }));
    expect(r.kind === 'inventory' && r.options).toEqual({ maxReceptaclesPerCircuit: 4, lightingBreakerAmps: 20 });
  });

  it('bad options and bad inventories come back as issues the model can act on', () => {
    const bad = (reply: unknown) => {
      const r = resolveReply(reply);
      expect(r.kind).toBe('invalid');
      return r.kind === 'invalid' ? r.issues : [];
    };
    expect(bad(inv(BASEMENT_ROOMS, { maxReceptaclesPerCircuit: 99 }))[0]!.code).toBe('BAD_PLAN_OPTION');
    expect(bad(inv(BASEMENT_ROOMS, { lightingBreakerAmps: 30 }))[0]!.code).toBe('BAD_PLAN_OPTION');
    expect(bad(inv([]))[0]).toMatchObject({ code: 'BAD_INVENTORY' });
    expect(bad(inv([room({ attachedTo: 'ghost' })]))[0]!.message).toContain('ghost');
    expect(bad(inv([room({ lightGroups: [{ lights: 2, switchLocations: 3 }] })]))[0]!.message).toContain('switchLocations');
    expect(bad(inv([room(), room()]))[0]!.message).toContain('more than once');
  });

  it('existing kinds are unchanged and earlier stored replies (no inventory fields) still resolve', () => {
    expect(resolveReply({ kind: 'question', target: 'none', message: 'Which room?', breakerAmps: 0, name: '', blocks: [], custom: [] })).toEqual({ kind: 'question', text: 'Which room?' });
    expect(resolveReply({ kind: 'unsupported', message: 'No.' }).kind).toBe('unsupported');
  });
});

describe('formatPlanText', () => {
  it('names circuits, breakers, rooms, protection, reasons, reminders, not-covered rooms and ends with the closing line', () => {
    const plan = planCircuits({ basement: true, rooms: [...BASEMENT_ROOMS, room({ id: 'k', name: 'Kitchen', type: 'other', receptacles: 2, lightGroups: [] })] as any });
    const text = formatPlanText(plan);
    for (const c of plan.circuits) expect(text).toContain(`${c.name} - ${c.breakerAmps} A breaker`);
    expect(text).toContain('GFCI at the first receptacle');
    expect(text).toContain('AFCI breaker');
    expect(text).toContain('Not covered:');
    expect(text).toContain('Kitchen');
    expect(text).toContain('Reminders:');
    for (const r of plan.reminders) expect(text).toContain(r);
    for (const c of plan.circuits) for (const reason of c.reasons) expect(text).toContain(reason.text);
    expect(text.endsWith(PLAN_TEXT_CLOSING)).toBe(true);
    expect(text).not.toContain('not available yet');
    expect(formatPlanText(plan)).toBe(text);
  });
});

describe('prompt: inventory section', () => {
  const p = buildSystemPrompt();
  it('lists the room types and rules from the planner registry and the key instructions', () => {
    for (const t of ROOM_TYPES) expect(p).toContain(t);
    for (const s of ['Whole jobs: room inventories', 'Bathroom receptacles are GFCI protected', 'Never choose breaker sizes', 'switchLocations', 'basement', 'single-circuit requests only', '"other"']) expect(p).toContain(s);
  });
  it('stays deterministic and provider-neutral', () => {
    expect(buildSystemPrompt()).toBe(p);
    expect(p).not.toMatch(/claude|anthropic|openai|llama|gpt|qwen|gemini/i);
  });
});

describe('build reply kind', () => {
  const build = (over: Record<string, unknown> = {}) => ({ ...base, kind: 'build', message: 'Building it.', ...over });
  it('is a reply kind, parses against ReplySchema and resolves to a build result carrying the message', () => {
    expect(REPLY_KINDS).toContain('build');
    expect(ReplySchema.safeParse(build()).success).toBe(true);
    expect(resolveReply(build())).toEqual({ kind: 'build', message: 'Building it.' });
    expect(resolveReply({ kind: 'build', message: 'ok' })).toEqual({ kind: 'build', message: 'ok' }); // omitted fields count as unused
  });
  it('every other field must be unused', () => {
    expect(replyShapeProblem(build())).toBeNull();
    for (const over of [{ target: 'new' }, { breakerAmps: 15 }, { name: 'x' }, { basement: true }, { rooms: [room()] }, { maxReceptaclesPerCircuit: 4 }, { lightingBreakerAmps: 20 }, { blocks: [{}] }, { custom: [{}] }])
      expect(resolveReply(build(over)).kind, JSON.stringify(over)).toBe('invalid');
  });
  it('the schema has the same properties as before and the prompt explains when to build and that inventories are complete', () => {
    const schema: any = replyJsonSchema();
    expect(schema.properties.kind.enum).toContain('build');
    expect(JSON.stringify(schema)).not.toMatch(/anyOf|oneOf|"type":\[/);
    const p = buildSystemPrompt();
    for (const s of ['"build"', 'complete', 'not yet built', 'Never send only the changed room']) expect(p).toContain(s);
  });
});
