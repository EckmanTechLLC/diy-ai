// Plan storage, adjusting the plan in chat, and building it (ADR-009): stubbed provider, in-memory database.
import { beforeEach, describe, expect, it } from 'vitest';
import { planCircuits } from '@diy-ai/core';
import { createApp } from '../src/app';
import { ALREADY_BUILT_TEXT, NO_PLAN_TEXT, buildContextNote } from '../src/chat/loop';
import { openDb, type Db } from '../src/db';
import type { ActiveProviderResult, CompleteInput, CompleteResult, LlmProvider } from '../src/llm';
import { circuits, messages, projects } from '../src/schema';

const base = { target: 'none', breakerAmps: 0, name: '', blocks: [] as unknown[], custom: [] as unknown[], basement: false, rooms: [] as unknown[], maxReceptaclesPerCircuit: 0, lightingBreakerAmps: 0 };
const room = (over: Record<string, unknown> = {}) => ({ id: 'living', name: 'Living area', type: 'living_area', receptacles: 8, lightGroups: [{ lights: 8, switchLocations: 2 }], fans: 0, attachedTo: '', ...over });
const BASEMENT = [
  room(),
  room({ id: 'bath', name: 'Bathroom', type: 'bathroom', receptacles: 3, lightGroups: [{ lights: 1, switchLocations: 1 }], fans: 1 }),
  room({ id: 'closet', name: 'Closet', type: 'closet', receptacles: 0, lightGroups: [{ lights: 1, switchLocations: 1 }] }),
  room({ id: 'bed', name: 'Bedroom', type: 'bedroom', receptacles: 5, lightGroups: [{ lights: 2, switchLocations: 1 }] }),
];
const CLOSET_ATTACHED = BASEMENT.map((r) => (r.id === 'closet' ? { ...r, attachedTo: 'bed' } : r));
const inventory = (rooms: unknown[] = BASEMENT, over: Record<string, unknown> = {}) => ({ ...base, kind: 'inventory', message: 'Here is the plan.', basement: true, rooms, ...over });
const build = (message = 'Building it.') => ({ ...base, kind: 'build', message });
const question = (q: string) => ({ ...base, kind: 'question', message: q });
const entry = (type: string, over: Record<string, unknown> = {}) => ({
  type, count: 0, countA: 0, countB: 0, gfciFirst: false,
  receptacleLabel: '', gfciLabel: '', boxLabel: '', switchLabel: '', switchBoxLabel: '', lightLabel: '', lightBoxLabel: '', fanLabel: '', fanBoxLabel: '', gangBoxLabel: '',
  ...over,
});
const circuitReply = (target: 'new' | 'selected') => ({ ...base, kind: 'circuit', target, message: 'Replaced.', breakerAmps: 15, name: 'Replaced', blocks: [entry('switch_lights', { count: 2 })] });
const ok = (reply: unknown): CompleteResult => ({ ok: true, reply, model: 'fake' });

function scripted(...script: CompleteResult[]) {
  const calls: CompleteInput[] = [];
  const provider: LlmProvider = {
    kind: 'anthropic',
    model: 'fake',
    async complete(input) {
      calls.push({ ...input, messages: input.messages.map((m) => ({ ...m })) });
      const next = script[calls.length - 1];
      if (!next) throw new Error('script exhausted');
      return next;
    },
  };
  return { provider, calls };
}

let db: Db;
let active: ActiveProviderResult;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDb(':memory:');
  active = { configured: false, reason: 'none' };
  app = createApp(db, { provider: () => active });
});
const use = (provider: LlmProvider) => (active = { configured: true, provider });
const call = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const createProject = async () => (await call('POST', '/api/projects', { name: 'Basement' })).json() as Promise<any>;
const post = async (id: string, content: string, selectedCircuitId?: string) => (await call('POST', `/api/projects/${id}/messages`, { content, selectedCircuitId })).json() as Promise<any>;
const buildRoute = (id: string) => call('POST', `/api/projects/${id}/plan/build`);
const built = async (id: string) => (await buildRoute(id)).json() as Promise<any>;
const getProject = async (id: string) => (await call('GET', `/api/projects/${id}`)).json() as Promise<any>;

/** Project with the basement inventory stored (one chat turn). */
async function withPlan(rooms: unknown[] = BASEMENT) {
  const p = await createProject();
  const s = scripted(ok(inventory(rooms)));
  use(s.provider);
  await post(p.id, 'plan my basement');
  return p;
}

describe('inventory is stored', () => {
  it('stores inventory and options, clears built-at, stores a plan message with the computed plan, changes no circuit', async () => {
    const p = await createProject();
    use(scripted(ok(inventory(BASEMENT, { maxReceptaclesPerCircuit: 6, lightingBreakerAmps: 20 }))).provider);
    const body = await post(p.id, 'plan my basement');
    const row = db.select().from(projects).all()[0]!;
    expect(row.inventory).toEqual({ basement: true, rooms: BASEMENT });
    expect(row.planOptions).toEqual({ maxReceptaclesPerCircuit: 6, lightingBreakerAmps: 20 });
    expect(row.planBuiltAt).toBeNull();
    const expected = planCircuits({ basement: true, rooms: BASEMENT as any }, { maxReceptaclesPerCircuit: 6, lightingBreakerAmps: 20 });
    expect(body.assistantMessage.kind).toBe('plan');
    expect(body.assistantMessage.plan).toEqual(JSON.parse(JSON.stringify(expected)));
    expect(body.assistantMessage.createdCircuitIds).toBeNull();
    expect(body.userMessage.plan).toBeNull();
    expect(body.project.circuits).toEqual([]);
    expect(body.project.inventory).toEqual({ basement: true, rooms: BASEMENT });
    expect(body.project.planOptions).toEqual({ maxReceptaclesPerCircuit: 6, lightingBreakerAmps: 20 });
    expect(body.project.plan).toEqual(JSON.parse(JSON.stringify(expected)));
    expect(body.project.planBuiltAt).toBeNull();
    expect(db.select().from(circuits).all()).toHaveLength(0);
    const stored = db.select().from(messages).all().find((m) => m.role === 'assistant')!;
    expect(stored.plan).toEqual({ plan: JSON.parse(JSON.stringify(expected)) });
    expect(body.assistantMessage).not.toHaveProperty('reply');
  });

  it('a second inventory replaces the first completely', async () => {
    const p = await withPlan();
    use(scripted(ok(inventory(CLOSET_ATTACHED))).provider);
    const body = await post(p.id, 'the closet belongs to the bedroom');
    expect(db.select().from(projects).all()[0]!.inventory).toEqual({ basement: true, rooms: CLOSET_ATTACHED });
    expect(db.select().from(projects).all()[0]!.planOptions).toEqual({});
    expect(body.project.plan).toEqual(JSON.parse(JSON.stringify(planCircuits({ basement: true, rooms: CLOSET_ATTACHED as any }))));
    expect(db.select().from(messages).all().filter((m) => m.kind === 'plan')).toHaveLength(2);
  });

  it('an invalid inventory stores nothing', async () => {
    const p = await createProject();
    use(scripted(ok(inventory([room({ attachedTo: 'ghost' })])), ok(inventory([room({ attachedTo: 'ghost' })])), ok(inventory([room({ attachedTo: 'ghost' })]))).provider);
    const body = await post(p.id, 'plan');
    expect(body.assistantMessage.kind).toBe('error');
    expect(db.select().from(projects).all()[0]!.inventory).toBeNull();
  });
});

describe('context note', () => {
  it('shows the stored inventory, options, a plan summary and not-built state to the next turn', async () => {
    const p = await withPlan();
    const s = scripted(ok(question('Which room?')));
    use(s.provider);
    await post(p.id, 'add a light');
    const last = s.calls[0]!.messages.at(-1)!.content;
    expect(last).toContain('stored plan, not yet built');
    expect(last).toContain(JSON.stringify({ basement: true, rooms: BASEMENT }));
    expect(last).toContain('Plan options (empty means defaults):\n{}');
    const plan = planCircuits({ basement: true, rooms: BASEMENT as any });
    for (const c of plan.circuits) expect(last).toContain(`"${c.name}" - ${c.breakerAmps} A`);
    expect(last).toContain('GFCI at the first receptacle');
    expect(last).toContain('AFCI');
    expect(last.endsWith('add a light')).toBe(true);
    // the model sees its own earlier inventory reply as the previous assistant turn
    expect(s.calls[0]!.messages.some((m) => m.role === 'assistant' && m.content.includes('"kind":"inventory"'))).toBe(true);
  });

  it('says so when the plan is built and sits beside the circuits note', async () => {
    const p = await withPlan();
    await built(p.id);
    const s = scripted(ok(question('?')));
    use(s.provider);
    await post(p.id, 'hello');
    const last = s.calls[0]!.messages.at(-1)!.content;
    expect(last).toContain('already built into circuits');
    expect(last).toContain('this project has 4 circuits');
    expect(last.indexOf('this project has 4 circuits')).toBeLessThan(last.indexOf('stored plan'));
  });

  it('no inventory and no circuits: no note', () => {
    expect(buildContextNote([], null, null)).toBeNull();
  });
});

describe('build', () => {
  it('the build route builds every circuit of the basement plan, in plan order, with the plan information, in one step', async () => {
    const p = await withPlan();
    const plan = planCircuits({ basement: true, rooms: BASEMENT as any });
    expect(plan.circuits).toHaveLength(4);
    const res = await buildRoute(p.id);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.project.circuits).toHaveLength(4);
    expect(body.createdCircuitIds).toEqual(body.project.circuits.map((c: any) => c.id));
    expect(body.project.circuits.map((c: any) => c.name)).toEqual(plan.circuits.map((c) => c.name));
    expect(body.project.circuits.map((c: any) => c.position)).toEqual([0, 1, 2, 3]);
    expect(body.project.planBuiltAt).toEqual(expect.any(Number));
    body.project.circuits.forEach((c: any, i: number) => {
      const planned = plan.circuits[i]!;
      expect(c.origin).toMatchObject({ kind: 'blocks', breakerAmps: planned.breakerAmps, name: planned.name });
      expect(c.plan).toEqual(JSON.parse(JSON.stringify({ protection: planned.protection, rooms: planned.rooms, reasons: planned.reasons, plannedLoadVa: planned.plannedLoadVa, capacityVa: planned.capacityVa })));
      expect(c.findings.every((f: any) => f.severity === 'warning')).toBe(true);
    });
    expect(body.project.circuits.some((c: any) => c.plan.protection.gfci === 'first-receptacle')).toBe(true);
    expect(body.project.circuits.some((c: any) => c.plan.protection.afci)).toBe(true);
    expect(db.select().from(circuits).all()).toHaveLength(4);
    // a plan_built message with the plan and created ids is stored
    const list = (await (await call('GET', `/api/projects/${p.id}/messages`)).json()) as any[];
    const msg = list.at(-1);
    expect(msg).toMatchObject({ role: 'assistant', kind: 'plan_built', plan: JSON.parse(JSON.stringify(plan)), createdCircuitIds: body.createdCircuitIds });
    expect(msg.content).toContain('Built 4 circuits');
    // the plan is still stored, and it is the stored inventory's plan
    expect((await getProject(p.id)).plan).toEqual(JSON.parse(JSON.stringify(plan)));
  });

  it('a model build reply is only a proposal: a build_proposed message with the plan, no circuit created, built-at untouched', async () => {
    const p = await withPlan();
    const plan = planCircuits({ basement: true, rooms: BASEMENT as any });
    const s = scripted(ok(build('Building the circuits.')));
    use(s.provider);
    const before = db.select().from(projects).all()[0]!;
    const body = await post(p.id, 'Use at most 6 outlets per circuit.');
    expect(s.calls).toHaveLength(1);
    expect(body.assistantMessage).toMatchObject({ kind: 'build_proposed', content: 'Building the circuits.', plan: JSON.parse(JSON.stringify(plan)), createdCircuitIds: null });
    expect(body.affectedCircuitId).toBeNull();
    expect(body.project.circuits).toEqual([]);
    expect(body.project.planBuiltAt).toBeNull();
    expect(db.select().from(circuits).all()).toHaveLength(0);
    const after = db.select().from(projects).all()[0]!;
    expect(after).toEqual({ ...before, updatedAt: after.updatedAt });
    expect(after.planBuiltAt).toBeNull();
    expect(db.select().from(messages).all().filter((m) => m.kind === 'plan_built')).toHaveLength(0);
    expect(db.select().from(messages).all().find((m) => m.kind === 'build_proposed')!.plan).toEqual({ plan: JSON.parse(JSON.stringify(plan)) });
  });

  it('a model build reply cannot change or delete existing circuits either', async () => {
    const p = await withPlan();
    const done = await built(p.id);
    const snapshot = JSON.stringify(db.select().from(circuits).all());
    use(scripted(ok(build())).provider);
    const body = await post(p.id, 'build it');
    expect(body.assistantMessage.content).toBe(ALREADY_BUILT_TEXT);
    expect(JSON.stringify(db.select().from(circuits).all())).toBe(snapshot);
    expect(done.project.circuits).toHaveLength(4);
  });

  it('a build reply with no stored plan: a message saying so, no retry, nothing changes', async () => {
    const p = await createProject();
    const s = scripted(ok(build()));
    use(s.provider);
    const body = await post(p.id, 'build it');
    expect(s.calls).toHaveLength(1);
    expect(body.assistantMessage.content).toBe(NO_PLAN_TEXT);
    expect(body.assistantMessage.kind).toBe('question');
    expect(db.select().from(circuits).all()).toHaveLength(0);
    expect(db.select().from(projects).all()[0]!.planBuiltAt).toBeNull();
  });

  it('a build reply when the plan is already built: says so and adds nothing', async () => {
    const p = await withPlan();
    await built(p.id);
    const builtAt = db.select().from(projects).all()[0]!.planBuiltAt;
    const s = scripted(ok(build()));
    use(s.provider);
    const body = await post(p.id, 'build it again');
    expect(s.calls).toHaveLength(1);
    expect(body.assistantMessage.content).toBe(ALREADY_BUILT_TEXT);
    expect(db.select().from(circuits).all()).toHaveLength(4);
    expect(db.select().from(projects).all()[0]!.planBuiltAt).toBe(builtAt);
  });

  it('the build route without a plan: 409 NO_PLAN, nothing stored', async () => {
    const p = await createProject();
    const res = await buildRoute(p.id);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'NO_PLAN' } });
    expect(db.select().from(messages).all()).toHaveLength(0);
  });

  it('the build route when already built: 409 PLAN_ALREADY_BUILT, nothing added', async () => {
    const p = await withPlan();
    await built(p.id);
    const messageCount = db.select().from(messages).all().length;
    const res = await buildRoute(p.id);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'PLAN_ALREADY_BUILT' } });
    expect(db.select().from(circuits).all()).toHaveLength(4);
    expect(db.select().from(messages).all()).toHaveLength(messageCount);
  });

  it('a changed plan after building clears built-at so it can be built again', async () => {
    const p = await withPlan();
    await built(p.id);
    use(scripted(ok(inventory(CLOSET_ATTACHED))).provider);
    const body = await post(p.id, 'closet belongs to the bedroom');
    expect(body.project.planBuiltAt).toBeNull();
    expect(body.project.circuits).toHaveLength(4); // existing circuits are untouched
  });

  it('a reply that carries a plan of its own is ignored: it is an invalid reply and builds nothing', async () => {
    const p = await withPlan();
    const bad = ok({ ...build(), rooms: [room()], basement: true });
    use(scripted(bad, bad, bad).provider);
    const body = await post(p.id, 'build it');
    expect(body.assistantMessage.kind).toBe('error');
    expect(db.select().from(circuits).all()).toHaveLength(0);
  });
});

describe('circuits.plan through edits', () => {
  it('manual edits keep it; a chat circuit reply replacing the circuit clears it', async () => {
    const p = await withPlan();
    const done = await built(p.id);
    const [c0, c1] = done.project.circuits;
    const renamed = await (await call('PUT', `/api/projects/${p.id}/circuits/${c0.id}`, { name: 'Renamed' })).json() as any;
    expect(renamed.project.circuits[0].plan).toEqual(c0.plan);
    const reordered = await (await call('PUT', `/api/projects/${p.id}/circuits/${c0.id}`, { circuit: c0.circuit })).json() as any;
    expect(reordered.project.circuits[0].plan).toEqual(c0.plan);
    use(scripted(ok(circuitReply('selected'))).provider);
    const replaced = await post(p.id, 'make it two lights', c1.id);
    const after = replaced.project.circuits;
    expect(after[1].plan).toBeNull();
    expect(after[1].name).toBe('Replaced');
    expect(after[0].plan).toEqual(c0.plan);
    expect(after[2].plan).not.toBeNull();
  });

  it('a new circuit from chat has no plan information', async () => {
    const p = await createProject();
    use(scripted(ok(circuitReply('new'))).provider);
    const body = await post(p.id, 'one circuit');
    expect(body.project.circuits[0].plan).toBeNull();
  });
});

describe('discard route, payloads and owner scoping', () => {
  it('DELETE /plan clears inventory, options and built-at and leaves circuits', async () => {
    const p = await withPlan();
    await built(p.id);
    const res = await call('DELETE', `/api/projects/${p.id}/plan`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.affectedCircuitId).toBeNull();
    expect(body.project).toMatchObject({ inventory: null, planOptions: null, plan: null, planBuiltAt: null });
    expect(body.project.circuits).toHaveLength(4);
    const row = db.select().from(projects).all()[0]!;
    expect([row.inventory, row.planOptions, row.planBuiltAt]).toEqual([null, null, null]);
    // the next build now says there is no plan
    use(scripted(ok(build())).provider);
    expect((await post(p.id, 'build it')).assistantMessage.content).toBe(NO_PLAN_TEXT);
  });

  it('GET project: plan fields are null for a project without a plan, filled for one with', async () => {
    const p = await createProject();
    expect(await getProject(p.id)).toMatchObject({ inventory: null, planOptions: null, plan: null, planBuiltAt: null });
    expect(p).toMatchObject({ inventory: null, plan: null, planBuiltAt: null });
    const q = await withPlan();
    const got = await getProject(q.id);
    expect(Object.keys(got).sort()).toEqual(['circuits', 'createdAt', 'description', 'id', 'inventory', 'name', 'plan', 'planBuiltAt', 'planOptions', 'updatedAt']);
    expect(got.plan.circuits).toHaveLength(4);
    expect(got.planOptions).toEqual({});
  });

  it('message list carries plan and createdCircuitIds; ids of deleted circuits drop out; the raw reply is never returned', async () => {
    const p = await withPlan();
    const done = await built(p.id);
    const gone = done.project.circuits[0].id;
    await call('DELETE', `/api/projects/${p.id}/circuits/${gone}`);
    const list = (await (await call('GET', `/api/projects/${p.id}/messages`)).json()) as any[];
    expect(list.map((m) => m.kind)).toEqual([null, 'plan', 'plan_built']);
    expect(list[1].plan.circuits).toHaveLength(4);
    expect(list[2].createdCircuitIds).toEqual(done.project.circuits.slice(1).map((c: any) => c.id));
    expect(list[0]).toMatchObject({ plan: null, createdCircuitIds: null });
    expect(JSON.stringify(list)).not.toContain('"reply"');
  });

  it("another owner's project: plan routes and chat are 404 and nothing changes", async () => {
    const id = 'foreign';
    db.insert(projects).values({ id, ownerId: 'someone-else', name: 'Theirs', description: '', createdAt: 1, updatedAt: 1, inventory: { basement: true, rooms: BASEMENT as any }, planOptions: {} }).run();
    expect((await call('DELETE', `/api/projects/${id}/plan`)).status).toBe(404);
    expect((await call('POST', `/api/projects/${id}/messages`, { content: 'build it' })).status).toBe(404);
    expect((await call('GET', `/api/projects/${id}`)).status).toBe(404);
    expect((await buildRoute(id)).status).toBe(404);
    expect(db.select().from(circuits).all()).toHaveLength(0);
    expect(db.select().from(projects).all()[0]!.inventory).not.toBeNull();
    expect(db.select().from(projects).all()[0]!.planBuiltAt).toBeNull();
    const body = await (await call('DELETE', `/api/projects/nope/plan`)).json();
    expect(body).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});
