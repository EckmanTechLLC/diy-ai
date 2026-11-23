import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatIssuesForModel, resolveReply } from '@diy-ai/core';
import { FIXTURES } from '@diy-ai/core/fixtures';
import { createApp } from '../src/app';
import { FAILURE_MESSAGES } from '../src/chat/errors';
import { MAX_RETRIES, buildContextNote } from '../src/chat/loop';
import { openDb, type Db } from '../src/db';
import type { ActiveProviderResult, CompleteInput, CompleteResult, LlmProvider, ProviderErrorCode } from '../src/llm';
import { circuits, messages, projects } from '../src/schema';

type Res = Omit<Response, 'json'> & { json(): Promise<any> };

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
/** Wire form of a circuit choice: a breaker size, a name and a list of flat block entries. */
const circuitReply = (
  blocks: Record<string, unknown>[] = [{ type: 'switch_lights', count: 1 }],
  breakerAmps = 15,
  message = 'Here is your circuit.',
  target: 'new' | 'selected' = 'new',
  name = 'Hall light',
) => ({
  ...unused,
  kind: 'circuit',
  target,
  message,
  breakerAmps,
  name,
  blocks: blocks.map((b) => entry(b.type as string, b)),
});
const question = (q: string) => ({ ...unused, kind: 'question', message: q });
const blocksReply = () => circuitReply();
const unsupported = (u: string) => ({ ...unused, kind: 'unsupported', message: u });
const badReply = { ...unused, kind: 'question', message: '' }; // blank question -> invalid
const wireEndpoint = (e: Record<string, unknown>) => ({ device: '', terminal: '', cable: '', color: '', box: '', splice: '', ...e });
const customReply = (target: 'new' | 'selected' = 'new') => {
  const m = structuredClone(FIXTURES[0]!);
  const circuit = {
    ...m,
    devices: m.devices.map((d) => ({ ...d, amps: d.amps ?? 0 })),
    connections: m.connections.map((c) => ({ ...c, a: wireEndpoint(c.a), b: wireEndpoint(c.b) })),
  };
  return { ...unused, kind: 'custom', target, message: 'Custom wiring.', custom: [circuit] };
};
const ok = (reply: unknown): CompleteResult => ({ ok: true, reply, model: 'fake' });
const err = (code: ProviderErrorCode): CompleteResult => ({ ok: false, error: { code, message: 'x', retryable: false } });

/** Scripted provider: each call takes the next script entry (a result or a function returning one). */
function scripted(...script: (CompleteResult | (() => Promise<CompleteResult>))[]) {
  const calls: CompleteInput[] = [];
  const provider: LlmProvider = {
    kind: 'local',
    model: 'fake',
    async complete(input) {
      // snapshot: the loop mutates its turns array between calls
      calls.push({ ...input, messages: input.messages.map((m) => ({ ...m })) });
      const next = script[calls.length - 1];
      if (!next) throw new Error('script exhausted');
      return typeof next === 'function' ? next() : next;
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

const use = (provider: LlmProvider) => {
  active = { configured: true, provider };
};
const call = async (method: string, path: string, body?: unknown): Promise<Res> =>
  app.request(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const createProject = async () => (await call('POST', '/api/projects', { name: 'Kitchen' })).json();
const post = (id: string, content: string, selectedCircuitId?: string) => call('POST', `/api/projects/${id}/messages`, { content, selectedCircuitId });
const stored = () => db.select().from(messages).all();

describe('POST messages outcomes', () => {
  it('question: stored, circuit untouched', async () => {
    const p = await createProject();
    use(scripted(ok(question('Which room?'))).provider);
    const res = await post(p.id, '  wire a light  ');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userMessage).toMatchObject({ role: 'user', content: 'wire a light', kind: null });
    expect(body.assistantMessage).toMatchObject({ role: 'assistant', content: 'Which room?', kind: 'question' });
    expect(body.project.circuits).toEqual([]);
    expect(stored()).toHaveLength(2);
  });

  it('block circuit: project updated with blocks origin', async () => {
    const p = await createProject();
    use(scripted(ok(blocksReply())).provider);
    const body = await (await post(p.id, 'one switch one light')).json();
    expect(body.assistantMessage).toMatchObject({ kind: 'circuit', content: 'Here is your circuit.' });
    expect(body.project.circuits).toHaveLength(1);
    expect(body.project.circuits[0]).toMatchObject({ name: 'Hall light', position: 0 });
    expect(body.project.circuits[0].origin).toMatchObject({ kind: 'blocks', breakerAmps: 15, name: 'Hall light', blocks: [{ type: 'switch_lights', count: 1 }] });
    expect(body.affectedCircuitId).toBe(body.project.circuits[0].id);
    const row = db.select().from(circuits).get()!;
    expect(row.circuit).toEqual(body.project.circuits[0].circuit);
    expect(db.select().from(projects).get()!.updatedAt).toBeGreaterThanOrEqual(p.updatedAt);
  });

  it('custom circuit: stored with unverified origin', async () => {
    const p = await createProject();
    use(scripted(ok(customReply())).provider);
    const body = await (await post(p.id, 'something odd')).json();
    expect(body.assistantMessage.kind).toBe('circuit');
    expect(body.project.circuits[0].origin).toEqual({ kind: 'custom', verified: false });
  });

  it('unsupported: message stored, circuit untouched', async () => {
    const p = await createProject();
    use(scripted(ok(unsupported('Not residential wiring.'))).provider);
    const body = await (await post(p.id, 'wire a substation')).json();
    expect(body.assistantMessage).toMatchObject({ kind: 'unsupported', content: 'Not residential wiring.' });
    expect(body.project.circuits).toEqual([]);
  });
});

describe('message origin and error code', () => {
  const get = async (id: string) => (await call('GET', `/api/projects/${id}/messages`)).json();

  it('block circuit: blocks origin stored and returned, survives a fresh GET', async () => {
    const p = await createProject();
    use(scripted(ok(blocksReply())).provider);
    const body = await (await post(p.id, 'one switch one light')).json();
    expect(body.assistantMessage.origin).toMatchObject({ kind: 'blocks', breakerAmps: 15, blocks: [{ type: 'switch_lights', count: 1 }] });
    expect(body.assistantMessage.errorCode).toBeNull();
    expect(body.userMessage).toMatchObject({ origin: null, errorCode: null });
    const list = await get(p.id);
    expect(list[1].origin).toEqual(body.assistantMessage.origin);
    expect(list[1].errorCode).toBeNull();
  });

  it('custom circuit: unverified origin', async () => {
    const p = await createProject();
    use(scripted(ok(customReply())).provider);
    const body = await (await post(p.id, 'something odd')).json();
    expect(body.assistantMessage.origin).toEqual({ kind: 'custom', verified: false });
    expect((await get(p.id))[1].origin).toEqual({ kind: 'custom', verified: false });
  });

  it('error outcomes store their code', async () => {
    const p = await createProject();
    use(scripted(err('auth')).provider);
    expect((await (await post(p.id, 'hi')).json()).assistantMessage).toMatchObject({ kind: 'error', errorCode: 'auth', origin: null });
    active = { configured: false, reason: 'none' };
    expect((await (await post(p.id, 'hi')).json()).assistantMessage.errorCode).toBe('not_configured');
    use(scripted(ok(badReply), ok(badReply), ok(badReply)).provider);
    expect((await (await post(p.id, 'hi')).json()).assistantMessage.errorCode).toBe('invalid_reply');
    const codes = (await get(p.id)).filter((m: any) => m.role === 'assistant').map((m: any) => m.errorCode);
    expect(codes).toEqual(['auth', 'not_configured', 'invalid_reply']);
  });

  it('question and unsupported: both null', async () => {
    const p = await createProject();
    use(scripted(ok(question('Which room?')), ok(unsupported('No.'))).provider);
    await post(p.id, 'a');
    await post(p.id, 'b');
    for (const m of await get(p.id)) expect(m).toMatchObject({ origin: null, errorCode: null });
  });
});

describe('retries', () => {
  it('invalid then valid: one retry, issues sent, one assistant message', async () => {
    const p = await createProject();
    const s = scripted(ok(badReply), ok(question('Which room?')));
    use(s.provider);
    const body = await (await post(p.id, 'hi')).json();
    expect(body.assistantMessage.kind).toBe('question');
    expect(s.calls).toHaveLength(2);
    const issues = (resolveReply(badReply) as any).issues;
    const second = s.calls[1]!.messages;
    expect(second.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(second[1]!.content).toBe(JSON.stringify(badReply));
    expect(second[2]!.content).toBe(formatIssuesForModel(issues));
    expect(stored().filter((m) => m.role === 'assistant')).toHaveLength(1);
    expect(stored()).toHaveLength(2);
  });

  it('invalid every time: error message, existing circuit unchanged, 1 + MAX_RETRIES calls', async () => {
    const res0 = await call('POST', '/api/projects/from-example', { exampleId: FIXTURES[0]!.id });
    const p = await res0.json();
    const s = scripted(...Array.from({ length: MAX_RETRIES + 1 }, () => ok(badReply)));
    use(s.provider);
    const res = await post(p.id, 'break it');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(s.calls).toHaveLength(MAX_RETRIES + 1);
    expect(MAX_RETRIES).toBe(2);
    expect(body.assistantMessage).toMatchObject({ kind: 'error', content: FAILURE_MESSAGES.invalid_reply });
    expect(body.project.circuits).toEqual(p.circuits);
    expect(body.affectedCircuitId).toBeNull();
    expect(db.select().from(circuits).all().map((r) => r.circuit)).toEqual([p.circuits[0].circuit]);
    expect(stored().filter((m) => m.role === 'assistant')).toHaveLength(1);
  });
});

describe('provider failures', () => {
  const codes = Object.keys(FAILURE_MESSAGES).filter((c) => !['not_configured', 'endpoint_missing', 'invalid_reply', 'rules_failed', 'block_rule_bug'].includes(c));
  it.each(codes)('%s maps to its message', async (code) => {
    const p = await createProject();
    use(scripted(err(code as ProviderErrorCode)).provider);
    const res = await post(p.id, 'hi');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.assistantMessage).toMatchObject({ kind: 'error', content: FAILURE_MESSAGES[code as keyof typeof FAILURE_MESSAGES] });
    expect(body.assistantMessage.content).not.toBe('x');
  });

  it.each([
    ['none', 'not_configured'],
    ['no_key', 'no_key'],
    ['endpoint_missing', 'endpoint_missing'],
  ] as const)('not configured (%s)', async (reason, code) => {
    const p = await createProject();
    active = { configured: false, reason };
    const body = await (await post(p.id, 'hi')).json();
    expect(body.assistantMessage).toMatchObject({ kind: 'error', content: FAILURE_MESSAGES[code] });
    expect(FAILURE_MESSAGES.no_key).toContain('Add a Claude API key or a local model in Settings');
    expect(stored()).toHaveLength(2);
  });
});

describe('history sent to the model', () => {
  it('second turn contains first raw reply JSON and excludes error messages', async () => {
    const p = await createProject();
    const first = question('Which room?');
    const s = scripted(err('timeout'), ok(first), ok(question('Anything else?')));
    use(s.provider);
    await post(p.id, 'one'); // error turn
    await post(p.id, 'two'); // question turn
    await post(p.id, 'three');
    // turn 2 after the error: error excluded, adjacent user turns merged
    expect(s.calls[1]!.messages).toEqual([{ role: 'user', content: 'one\n\ntwo' }]);
    expect(s.calls[2]!.messages).toEqual([
      { role: 'user', content: 'one\n\ntwo' },
      { role: 'assistant', content: JSON.stringify(first) },
      { role: 'user', content: 'three' },
    ]);
    for (const c of s.calls) expect(JSON.stringify(c.messages)).not.toContain(FAILURE_MESSAGES.timeout);
  });

  it('replays stored replies in both earlier shapes as plain text without crashing', async () => {
    const res0 = await call('POST', '/api/projects/from-example', { exampleId: FIXTURES[0]!.id });
    const p = await res0.json();
    const oldQuestion = { question: 'Which room?', template: null, custom: null, unsupported: null };
    const oldCircuit = { question: null, template: { templateId: 'single_pole_switch', params: { breakerAmps: null }, message: 'old' }, custom: null, unsupported: null };
    // task 14 shape: flat, kind "template"
    const flatTemplate = { kind: 'template', message: 'older', templateId: 'single_pole_switch', breakerAmps: 20, labels: [{ param: 'lightLabel', value: 'x' }], custom: [] };
    db.insert(messages).values({ id: 'o1', projectId: p.id, role: 'user', content: 'wire a light', kind: null, createdAt: 1 }).run();
    db.insert(messages).values({ id: 'o2', projectId: p.id, role: 'assistant', content: 'Which room?', kind: 'question', reply: oldQuestion, createdAt: 2 }).run();
    db.insert(messages).values({ id: 'o3', projectId: p.id, role: 'user', content: 'hall', kind: null, createdAt: 3 }).run();
    db.insert(messages).values({ id: 'o4', projectId: p.id, role: 'assistant', content: 'old', kind: 'circuit', reply: oldCircuit, createdAt: 4 }).run();
    db.insert(messages).values({ id: 'o5', projectId: p.id, role: 'user', content: 'again', kind: null, createdAt: 5 }).run();
    db.insert(messages).values({ id: 'o6', projectId: p.id, role: 'assistant', content: 'older', kind: 'circuit', reply: flatTemplate, createdAt: 6 }).run();
    const s = scripted(ok(question('Anything else?')));
    use(s.provider);
    const res = await post(p.id, 'and now');
    expect(res.status).toBe(200);
    const sent = s.calls[0]!.messages;
    expect(sent.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user']);
    expect(sent[1]!.content).toBe(JSON.stringify(oldQuestion));
    expect(sent[3]!.content).toBe(JSON.stringify(oldCircuit));
    expect(sent[5]!.content).toBe(JSON.stringify(flatTemplate));
    // the project's circuit is described in the note before the newest user message
    expect(sent[6]!.content).toContain('this project has 1 circuit');
  });

  it('circuits note: present on every turn once the project has a circuit, never stored', async () => {
    const res0 = await call('POST', '/api/projects/from-example', { exampleId: FIXTURES[0]!.id });
    const p = await res0.json();
    const s = scripted(ok(blocksReply()), ok(question('q')));
    use(s.provider);
    await post(p.id, 'make it');
    const first = s.calls[0]!.messages;
    expect(first).toHaveLength(1);
    expect(first[0]!.content).toContain('this project has 1 circuit');
    expect(first[0]!.content).toContain('No circuit is selected.');
    expect(first[0]!.content.endsWith('\n\nmake it')).toBe(true);
    await post(p.id, 'and then');
    const next = s.calls[1]!.messages;
    expect(next[next.length - 1]!.content).toContain('this project has 2 circuits');
    expect(next[0]!.content).toBe('make it'); // earlier turns carry no note
    expect(stored().filter((m) => m.role === 'user').map((m) => m.content)).toEqual(['make it', 'and then']);
  });

  it('no note when the project has no circuit', async () => {
    const p = await createProject();
    const s = scripted(ok(question('q')));
    use(s.provider);
    await post(p.id, 'hello');
    expect(s.calls[0]!.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });
});

describe('concurrency, validation, scoping', () => {
  it('409 for a concurrent post, then succeeds after', async () => {
    const p = await createProject();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    use(scripted(async () => (await gate, ok(question('slow'))), ok(question('fast'))).provider);
    const first = post(p.id, 'first');
    await vi.waitFor(() => expect(stored()).toHaveLength(1));
    const second = await post(p.id, 'second');
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe('BUSY');
    release();
    expect((await first).status).toBe(200);
    expect((await post(p.id, 'third')).status).toBe(200);
    expect(stored().filter((m) => m.content === 'second')).toHaveLength(0);
  });

  it('input validation', async () => {
    const p = await createProject();
    use(scripted(ok(question('q'))).provider);
    for (const content of ['', '   ', 'x'.repeat(4001), 5 as unknown as string]) {
      const res = await post(p.id, content);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('VALIDATION');
    }
    const bad = await app.request(`/api/projects/${p.id}/messages`, { method: 'POST', body: 'nope' });
    expect(bad.status).toBe(400);
    expect((await post(p.id, 'x'.repeat(4000))).status).toBe(200);
  });

  it('unknown project and other owner -> 404 on all routes', async () => {
    db.insert(projects)
      .values({ id: 'foreign', ownerId: 'someone-else', name: 'T', description: '', createdAt: 1, updatedAt: 1 })
      .run();
    db.insert(messages).values({ id: 'm1', projectId: 'foreign', role: 'user', content: 'secret', kind: null, createdAt: 1 }).run();
    const s = scripted();
    use(s.provider);
    for (const id of ['foreign', 'missing']) {
      expect((await call('GET', `/api/projects/${id}/messages`)).status).toBe(404);
      const r = await post(id, 'hi');
      expect(r.status).toBe(404);
      expect((await r.json()).error.code).toBe('NOT_FOUND');
      expect((await call('DELETE', `/api/projects/${id}/messages`)).status).toBe(404);
    }
    expect(s.calls).toHaveLength(0);
    expect(stored()).toHaveLength(1);
  });

  it('DELETE clears messages only', async () => {
    const res0 = await call('POST', '/api/projects/from-example', { exampleId: FIXTURES[0]!.id });
    const p = await res0.json();
    use(scripted(ok(question('q'))).provider);
    await post(p.id, 'hi');
    expect(stored()).toHaveLength(2);
    expect((await call('DELETE', `/api/projects/${p.id}/messages`)).status).toBe(204);
    expect(stored()).toHaveLength(0);
    const after = await (await call('GET', `/api/projects/${p.id}`)).json();
    expect(after.circuits).toEqual(p.circuits);
    expect(await (await call('GET', `/api/projects/${p.id}/messages`)).json()).toEqual([]);
  });

  it('GET lists messages in order with the public fields only', async () => {
    const p = await createProject();
    use(scripted(ok(question('a')), ok(question('b'))).provider);
    await post(p.id, 'one');
    await post(p.id, 'two');
    const list = await (await call('GET', `/api/projects/${p.id}/messages`)).json();
    expect(list.map((m: any) => m.content)).toEqual(['one', 'a', 'two', 'b']);
    for (const m of list) expect(Object.keys(m).sort()).toEqual(['circuitId', 'content', 'createdAt', 'createdCircuitIds', 'errorCode', 'findings', 'id', 'kind', 'origin', 'plan', 'role']);
  });

  it('raw reply never appears in any response body', async () => {
    const p = await createProject();
    const reply = blocksReply();
    use(scripted(ok(reply), ok(question('q'))).provider);
    const bodies = [
      await (await post(p.id, 'make it')).text(),
      await (await post(p.id, 'more')).text(),
      await (await call('GET', `/api/projects/${p.id}/messages`)).text(),
      await (await call('GET', `/api/projects/${p.id}`)).text(),
    ];
    for (const b of bodies) {
      expect(b).not.toContain('"reply"');
      expect(b).not.toContain('"gfciFirst"'); // a key of the raw reply object's block entries
    }
  });
});

describe('error logging', () => {
  it('logs name and message only, never the error object or request content', async () => {
    const p = await createProject();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    use({
      kind: 'local',
      model: 'fake',
      complete: async () => {
        throw new Error('boom sk-ant-SECRET123');
      },
    });
    const res = await post(p.id, 'my private wiring text');
    expect(res.status).toBe(500);
    const logged = log.mock.calls.map((a) => a.map(String).join(' ')).join('\n');
    log.mockRestore();
    expect(logged).toContain('Error: boom');
    expect(logged).not.toContain('SECRET123');
    expect(logged).not.toContain('private wiring');
    expect(logged).not.toContain('at '); // no stack
  });
});

describe('several circuits', () => {
  const addCircuit = async (pid: string, circuit: unknown, name?: string) =>
    (await (await call('POST', `/api/projects/${pid}/circuits`, { circuit, name })).json()).affectedCircuitId as string;
  const rows = () => db.select().from(circuits).orderBy(circuits.position).all();
  const fixtureReply = (i: number, target: 'new' | 'selected' = 'new') => {
    const m = structuredClone(FIXTURES[i]!);
    const circuit = {
      ...m,
      devices: m.devices.map((d) => ({ ...d, amps: d.amps ?? 0 })),
      connections: m.connections.map((c) => ({ ...c, a: wireEndpoint(c.a), b: wireEndpoint(c.b) })),
    };
    return { ...unused, kind: 'custom', target, message: 'Custom wiring.', custom: [circuit] };
  };

  it('adds the first circuit, then a second with none selected', async () => {
    const p = await createProject();
    use(scripted(ok(circuitReply(undefined, 15, 'one', 'new', 'Hall')), ok(circuitReply([{ type: 'switch_fan' }], 20, 'two', 'new', 'Bath fan'))).provider);
    const a = await (await post(p.id, 'hall light')).json();
    expect(a.project.circuits.map((c: any) => [c.name, c.position])).toEqual([['Hall', 0]]);
    const b = await (await post(p.id, 'bath fan')).json();
    expect(b.project.circuits.map((c: any) => [c.name, c.position])).toEqual([['Hall', 0], ['Bath fan', 1]]);
    expect(b.affectedCircuitId).toBe(b.project.circuits[1].id);
    expect(b.project.circuits[0]).toEqual(a.project.circuits[0]);
    expect(b.assistantMessage.circuitId).toBe(b.affectedCircuitId);
  });

  it('target selected replaces the selected circuit, keeping id, position and (without a name) the name', async () => {
    const p = await createProject();
    const c0 = await addCircuit(p.id, FIXTURES[0], 'First');
    const c1 = await addCircuit(p.id, FIXTURES[1], 'Second');
    use(scripted(ok(circuitReply([{ type: 'switch_fan' }], 20, 'bigger', 'selected', 'Renamed')), ok(fixtureReply(3, 'selected'))).provider);
    const a = await (await post(p.id, 'make the first bigger', c0)).json();
    expect(a.affectedCircuitId).toBe(c0);
    expect(a.project.circuits.map((c: any) => [c.id, c.name, c.position])).toEqual([[c0, 'Renamed', 0], [c1, 'Second', 1]]);
    expect(a.project.circuits[0].origin).toMatchObject({ kind: 'blocks', breakerAmps: 20 });
    expect(a.project.circuits[1].circuit).toEqual(FIXTURES[1]); // untouched
    expect(a.assistantMessage.circuitId).toBe(c0);
    // custom reply carries no name: the circuit keeps its own, and its origin becomes custom
    const b = await (await post(p.id, 'rewire the second', c1)).json();
    expect(b.project.circuits[1]).toMatchObject({ id: c1, name: 'Second', position: 1, origin: { kind: 'custom', verified: false } });
    expect(b.project.circuits[1].circuit).toEqual(FIXTURES[3]);
    expect(rows()).toHaveLength(2);
  });

  it('target selected replaces findings too', async () => {
    const p = await createProject();
    const c0 = await addCircuit(p.id, FIXTURES[0]);
    db.update(circuits).set({ findings: [{ ruleId: 'x', severity: 'warning', message: 'm', involved: [], citation: { edition: 'nec-2023', section: null, confirmed: false } }] }).run();
    use(scripted(ok(circuitReply(undefined, 15, 'm', 'selected'))).provider);
    const body = await (await post(p.id, 'change it', c0)).json();
    expect(body.project.circuits[0].findings).toEqual([]);
  });

  it('target selected with no selection, or a selection deleted meanwhile, falls back to new', async () => {
    const p = await createProject();
    const c0 = await addCircuit(p.id, FIXTURES[0], 'First');
    use(scripted(ok(circuitReply(undefined, 15, 'm', 'selected', 'Added'))).provider);
    const a = await (await post(p.id, 'change it')).json();
    expect(a.project.circuits.map((c: any) => c.name)).toEqual(['First', 'Added']);
    expect(a.project.circuits[0].id).toBe(c0);

    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    use(scripted(async () => (await gate, ok(circuitReply(undefined, 15, 'm', 'selected', 'Late')))).provider);
    const pending = post(p.id, 'change the added one', a.affectedCircuitId);
    await vi.waitFor(() => expect(stored().filter((m) => m.content === 'change the added one')).toHaveLength(1));
    await call('DELETE', `/api/projects/${p.id}/circuits/${a.affectedCircuitId}`);
    release();
    const b = await (await pending).json();
    expect(b.project.circuits.map((c: any) => [c.name, c.position])).toEqual([['First', 0], ['Late', 1]]);
    expect(b.assistantMessage.circuitId).toBe(b.affectedCircuitId);
  });

  it('a new circuit without a name from the reply gets "Circuit N"', async () => {
    const p = await createProject();
    await addCircuit(p.id, FIXTURES[0], 'First');
    use(scripted(ok(fixtureReply(1))).provider);
    const body = await (await post(p.id, 'something odd')).json();
    expect(body.project.circuits[1]).toMatchObject({ name: 'Circuit 2', origin: { kind: 'custom', verified: false } });
  });

  it('selectedCircuitId must belong to the project: 400, nothing stored, model not called', async () => {
    const a = await createProject();
    const b = await createProject();
    const other = await addCircuit(b.id, FIXTURES[0]);
    const s = scripted();
    use(s.provider);
    for (const id of ['nope', other]) {
      const res = await post(a.id, 'hi', id);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('VALIDATION');
    }
    expect(s.calls).toHaveLength(0);
    expect(stored()).toHaveLength(0);
  });

  it('a rule-failed attempt leaves every circuit unchanged', async () => {
    const p = await createProject();
    const c0 = await addCircuit(p.id, FIXTURES[0]);
    await addCircuit(p.id, FIXTURES[1]);
    const before = rows();
    const bad = fixtureReply(2, 'selected') as any;
    // a black wire on the neutral splice: a wire-colour-role error (same break as rules.test.ts)
    const w = bad.custom[0].connections.find((c: any) => c.color === 'white');
    w.color = 'black';
    use(scripted(ok(bad), ok(bad), ok(bad)).provider);
    const body = await (await post(p.id, 'rewire', c0)).json();
    expect(body.assistantMessage.kind).toBe('error');
    expect(body.affectedCircuitId).toBeNull();
    expect(body.assistantMessage.circuitId).toBeNull();
    expect(rows()).toEqual(before);
  });

  it('question and unsupported leave circuits alone and have no circuit id', async () => {
    const p = await createProject();
    await addCircuit(p.id, FIXTURES[0]);
    const before = rows();
    use(scripted(ok(question('which?')), ok(unsupported('no'))).provider);
    for (const text of ['a', 'b']) {
      const body = await (await post(p.id, text)).json();
      expect(body.affectedCircuitId).toBeNull();
      expect(body.assistantMessage.circuitId).toBeNull();
    }
    expect(rows()).toEqual(before);
  });

  it('messages carry circuit_id, which is set to null when the circuit is deleted; messages survive', async () => {
    const p = await createProject();
    use(scripted(ok(circuitReply())).provider);
    const body = await (await post(p.id, 'light')).json();
    const cid = body.affectedCircuitId;
    const list = await (await call('GET', `/api/projects/${p.id}/messages`)).json();
    expect(list.map((m: any) => m.circuitId)).toEqual([null, cid]);
    expect((await call('DELETE', `/api/projects/${p.id}/circuits/${cid}`)).status).toBe(200);
    const after = await (await call('GET', `/api/projects/${p.id}/messages`)).json();
    expect(after.map((m: any) => m.circuitId)).toEqual([null, null]);
    expect(after[1].content).toBe('Here is your circuit.');
  });

  it('DELETE messages leaves circuits untouched', async () => {
    const p = await createProject();
    use(scripted(ok(circuitReply())).provider);
    await post(p.id, 'light');
    const before = rows();
    expect((await call('DELETE', `/api/projects/${p.id}/messages`)).status).toBe(204);
    expect(rows()).toEqual(before);
    expect(stored()).toHaveLength(0);
  });

  it('payloads never include the raw reply', async () => {
    const p = await createProject();
    use(scripted(ok(circuitReply([{ type: 'receptacle_run', count: 2 }])), ok(question('q'))).provider);
    const bodies = [
      await (await post(p.id, 'make it')).text(),
      await (await post(p.id, 'more')).text(),
      await (await call('GET', `/api/projects/${p.id}`)).text(),
      await (await call('GET', `/api/projects/${p.id}/messages`)).text(),
    ];
    for (const b of bodies) {
      expect(b).not.toContain('"reply"');
      expect(b).not.toContain('"countA"'); // a key of the raw reply's block entries
      expect(b).not.toContain('"target"');
    }
  });

  it('the model receives the context note with the selected circuit, and the note is not stored', async () => {
    const p = await createProject();
    const c0 = await addCircuit(p.id, FIXTURES[0], 'First');
    await addCircuit(p.id, FIXTURES[1], 'Second');
    const s = scripted(ok(question('q')));
    use(s.provider);
    await post(p.id, 'tweak', c0);
    const sent = s.calls[0]!.messages;
    expect(sent).toHaveLength(1);
    expect(sent[0]!.content).toContain('this project has 2 circuits');
    expect(sent[0]!.content).toContain(`"First" - 15 A - example/manual [selected]`);
    expect(sent[0]!.content).toContain(JSON.stringify(FIXTURES[0]));
    expect(sent[0]!.content).not.toContain(JSON.stringify(FIXTURES[1]));
    expect(sent[0]!.content.endsWith('\n\ntweak')).toBe(true);
    expect(stored()[0]!.content).toBe('tweak');
  });
});

describe('buildContextNote', () => {
  const blocksOrigin = (blocks: any[], name = 'Hall') => ({ kind: 'blocks' as const, breakerAmps: 15 as const, name, blocks });
  const mk = (id: string, name: string, circuit: any, origin: any) => ({ id, name, circuit, origin });
  const sw = { type: 'switch_lights', count: 3, switchLabel: 'Switch', switchBoxLabel: 'Switch box', lightLabel: 'Light', lightBoxLabel: 'Light box' };
  const rr = { type: 'receptacle_run', count: 4, gfciFirst: true, receptacleLabel: 'Receptacle', gfciLabel: 'GFCI', boxLabel: 'Receptacle box' };

  it('no circuits: no note', () => {
    expect(buildContextNote([], null)).toBeNull();
    expect(buildContextNote([], 'x')).toBeNull();
  });

  it('one circuit, nothing selected: listed, with no definition', () => {
    const note = buildContextNote([mk('a', 'First', FIXTURES[0], null)], null)!;
    expect(note).toBe('Note: this project has 1 circuit, in order:\n1. "First" - 15 A - example/manual\n\nNo circuit is selected.');
  });

  it('three circuits, one of each origin kind: summaries, breaker sizes, the selected one marked', () => {
    const c20 = structuredClone(FIXTURES[0]!);
    c20.devices.find((d) => d.type === 'breaker')!.amps = 20;
    const note = buildContextNote(
      [
        mk('a', 'Basement lights', FIXTURES[0], blocksOrigin([sw, rr])),
        mk('b', 'Odd one', c20, { kind: 'custom', verified: false }),
        mk('c', 'Example', FIXTURES[1], null),
      ],
      'a',
    )!;
    const lines = note.split('\n');
    expect(lines[0]).toBe('Note: this project has 3 circuits, in order:');
    expect(lines[1]).toBe('1. "Basement lights" - 15 A - Single-pole switch with lights (count 3); Run of receptacles (count 4, GFCI first) [selected]');
    expect(lines[2]).toBe('2. "Odd one" - 20 A - custom wiring');
    expect(lines[3]).toBe('3. "Example" - 15 A - example/manual');
    expect(note).toContain('The selected circuit is "Basement lights". Its block list:');
    expect(note).toContain(JSON.stringify({ name: 'Basement lights', breakerAmps: 15, blocks: [sw, rr] }));
    expect(note).not.toContain(JSON.stringify(FIXTURES[0]));
  });

  it('selected custom or example circuit: its circuit JSON; a stale selection counts as none', () => {
    const list = [mk('a', 'A', FIXTURES[0], { kind: 'custom', verified: false }), mk('b', 'B', FIXTURES[1], null)];
    const custom = buildContextNote(list, 'a')!;
    expect(custom).toContain('Its circuit definition:');
    expect(custom).toContain(JSON.stringify(FIXTURES[0]));
    expect(custom).not.toContain(JSON.stringify(FIXTURES[1]));
    expect(buildContextNote(list, 'b')).toContain(JSON.stringify(FIXTURES[1]));
    expect(buildContextNote(list, 'zzz')).toContain('No circuit is selected.');
  });
});
