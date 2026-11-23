import Anthropic from '@anthropic-ai/sdk';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSystemPrompt, replyJsonSchema } from '@diy-ai/core';
import { createApp } from '../src/app';
import { openDb, type Db } from '../src/db';
import { createClaudeProvider, type ClaudeClient } from '../src/llm/claude';
import { createLocalProvider } from '../src/llm/local';
import { getActiveProvider } from '../src/llm';
import { circuits, llmEndpoints, messages, projects, settings } from '../src/schema';

const TEST_KEY = 'sk-ant-test-SECRETKEY-9f3a';
const schema = replyJsonSchema();
const system = buildSystemPrompt();
const convo = [{ role: 'user' as const, content: 'Wire a light switch' }];

type Res = Omit<Response, 'json'> & { json(): Promise<any> };
const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// ---- stubs (no network anywhere) ------------------------------------------------------------
type Routes = Record<string, () => Response | Promise<Response>>;
function stubFetch(routes: Routes) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const handler = routes[url];
    if (!handler) throw new TypeError(`unexpected fetch ${url}`);
    return handler();
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

function stubClaude(opts: { create?: (params: any, options?: any) => any; models?: { id: string; display_name: string }[] | Error } = {}) {
  const create = vi.fn(opts.create ?? (async () => claudeMessage()));
  const client = {
    beta: { messages: { create } },
    models: {
      list: () => ({
        async *[Symbol.asyncIterator]() {
          if (opts.models instanceof Error) throw opts.models;
          yield* (opts.models ?? []) as any[];
        },
      }),
    },
  } as unknown as ClaudeClient;
  return { client, create };
}

const validReply = {
  kind: 'question', target: 'none', message: 'Which room?', breakerAmps: 0, name: '', blocks: [], custom: [],
  basement: false, rooms: [], maxReceptaclesPerCircuit: 0, lightingBreakerAmps: 0,
};
const toolUse = (input: unknown) => ({ type: 'tool_use', id: 'tu_1', name: 'reply', input });
const textBlock = (text: string) => ({ type: 'text', text });

const claudeMessage = (over: Record<string, unknown> = {}) => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  stop_reason: 'end_turn',
  content: [
    { type: 'thinking', thinking: '', signature: 'x' },
    { type: 'tool_use', id: 'tu_1', name: 'reply', input: validReply },
  ],
  usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 0 },
  ...over,
});

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
});

function makeApp(llm: Parameters<typeof createApp>[1] extends infer O ? (O extends { llm?: infer L } ? L : never) : never) {
  const app = createApp(db, { llm });
  const call = async (method: string, path: string, body?: unknown): Promise<Res> =>
    app.request(path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { app, call };
}

// ---- migration -----------------------------------------------------------------------------
describe('migration 0001', () => {
  it('applies on top of 0000 and cascade-deletes messages', () => {
    db.insert(projects).values({ id: 'p1', ownerId: 'local', name: 'P', description: '', createdAt: 1, updatedAt: 1 }).run();
    db.insert(messages)
      .values([
        { id: 'm1', projectId: 'p1', role: 'user', content: 'hi', kind: null, createdAt: 1 },
        { id: 'm2', projectId: 'p1', role: 'assistant', content: 'q?', kind: 'question', createdAt: 2 },
      ])
      .run();
    expect(db.select().from(messages).all()).toHaveLength(2);
    db.delete(projects).where(eq(projects.id, 'p1')).run();
    expect(db.select().from(messages).all()).toHaveLength(0);
  });

  it('rejects messages for an unknown project', () => {
    expect(() =>
      db.insert(messages).values({ id: 'm', projectId: 'nope', role: 'user', content: 'x', kind: null, createdAt: 1 }).run(),
    ).toThrow();
  });

  it('circuit origin is null for examples and cleared by a manual PUT of the circuit', async () => {
    const { call } = makeApp({});
    const list = await (await call('GET', '/api/examples')).json();
    const created = await (await call('POST', '/api/projects/from-example', { exampleId: list[0].id })).json();
    const c = created.circuits[0];
    expect(c.origin).toBeNull();
    db.update(circuits).set({ origin: { kind: 'custom', verified: false } }).where(eq(circuits.id, c.id)).run();
    const put = await (await call('PUT', `/api/projects/${created.id}/circuits/${c.id}`, { circuit: c.circuit })).json();
    expect(put.project.circuits[0].origin).toBeNull();
  });
});

// ---- settings: key --------------------------------------------------------------------------
describe('GET /api/settings/llm and the key', () => {
  it('starts empty', async () => {
    const { call } = makeApp({ env: {} });
    const res = await call('GET', '/api/settings/llm');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ anthropic: { keySet: false, keySource: null, last4: null }, endpoints: [], active: null });
  });

  it('PUT stores a trimmed key; only keySet and last4 come back; DELETE removes it', async () => {
    const { call } = makeApp({ env: {} });
    const put = await call('PUT', '/api/settings/llm/anthropic-key', { key: `  ${TEST_KEY}  ` });
    expect(put.status).toBe(200);
    expect((await put.json()).anthropic).toEqual({ keySet: true, keySource: 'stored', last4: '9f3a' });
    expect(db.select().from(settings).all().find((s) => s.key === 'anthropic_api_key')?.value).toBe(TEST_KEY);
    const del = await call('DELETE', '/api/settings/llm/anthropic-key');
    expect(del.status).toBe(200);
    expect((await del.json()).anthropic.keySet).toBe(false);
  });

  it('rejects empty, blank, missing and non-JSON keys', async () => {
    const { call, app } = makeApp({ env: {} });
    for (const body of [{ key: '' }, { key: '   ' }, {}, { key: 5 }]) {
      const res = await call('PUT', '/api/settings/llm/anthropic-key', body);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('VALIDATION');
    }
    const bad = await app.request('/api/settings/llm/anthropic-key', { method: 'PUT', body: '{nope' });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as any).error.code).toBe('INVALID_JSON');
  });

  it('the stored key never appears in any response body', async () => {
    const { call } = makeApp({
      env: {},
      createClaudeClient: () => stubClaude({ models: [{ id: 'claude-opus-5-5', display_name: 'Opus 5.5' }] }).client,
      fetch: stubFetch({ 'http://odin:8080/v1/models': () => jsonRes({ data: [{ id: 'qwen' }] }) }).fn,
    });
    await call('PUT', '/api/settings/llm/anthropic-key', { key: TEST_KEY });
    const ep = await (await call('POST', '/api/settings/llm/endpoints', { baseUrl: 'http://odin:8080' })).json();
    const bodies: string[] = [];
    const record = async (p: Promise<Res>) => {
      const res = await p;
      bodies.push(JSON.stringify([...res.headers.entries()]) + (await res.text()));
    };
    await record(call('GET', '/api/settings/llm'));
    await record(call('PUT', '/api/settings/llm/anthropic-key', { key: TEST_KEY }));
    await record(call('PUT', '/api/settings/llm/anthropic-key', { key: '' }));
    await record(call('GET', '/api/settings/llm/anthropic-models'));
    await record(call('PUT', '/api/settings/llm/active', { provider: 'anthropic', model: 'claude-opus-5-5' }));
    await record(call('PUT', '/api/settings/llm/active', { provider: 'local', endpointId: ep.id }));
    await record(call('POST', `/api/settings/llm/endpoints/${ep.id}/refresh`));
    await record(call('DELETE', '/api/settings/llm/anthropic-key'));
    expect(bodies.length).toBe(8);
    for (const b of bodies) expect(b).not.toContain(TEST_KEY);
    expect(bodies[0]).not.toContain('SECRETKEY');
  });

  it('the key never appears in an error message from Claude', async () => {
    const leaky = Anthropic.APIError.generate(400, { type: 'error' }, `bad request for key ${TEST_KEY}`, new Headers());
    const { call } = makeApp({ env: {}, createClaudeClient: () => stubClaude({ models: leaky }).client });
    await call('PUT', '/api/settings/llm/anthropic-key', { key: TEST_KEY });
    const res = await call('GET', '/api/settings/llm/anthropic-models');
    expect(await res.text()).not.toContain(TEST_KEY);
    const p = createClaudeProvider({ apiKey: TEST_KEY, model: 'm', client: stubClaude({ create: async () => { throw leaky; } }).client });
    expect(JSON.stringify(await p.complete({ system, messages: convo, schema }))).not.toContain(TEST_KEY);
  });

  it('ANTHROPIC_API_KEY takes precedence, is reported as env, and cannot be removed via the API', async () => {
    const env = { ANTHROPIC_API_KEY: 'sk-ant-from-env-ZZZZ' };
    const { call } = makeApp({ env });
    expect((await (await call('GET', '/api/settings/llm')).json()).anthropic).toEqual({ keySet: true, keySource: 'env', last4: 'ZZZZ' });
    const del = await call('DELETE', '/api/settings/llm/anthropic-key');
    expect(del.status).toBe(409);
    expect((await del.json()).error.code).toBe('KEY_FROM_ENV');
    // a stored key is shadowed by the env key and can be removed, env stays
    const put = await (await call('PUT', '/api/settings/llm/anthropic-key', { key: TEST_KEY })).json();
    expect(put.anthropic.keySource).toBe('env');
    const del2 = await (await call('DELETE', '/api/settings/llm/anthropic-key')).json();
    expect(del2.anthropic).toEqual({ keySet: true, keySource: 'env', last4: 'ZZZZ' });
    expect(db.select().from(settings).all()).toHaveLength(0);
  });

  it('env key is the one handed to the Claude client', async () => {
    const used: string[] = [];
    const { call } = makeApp({
      env: { ANTHROPIC_API_KEY: 'env-key' },
      createClaudeClient: (k) => {
        used.push(k);
        return stubClaude({ models: [] }).client;
      },
    });
    await call('PUT', '/api/settings/llm/anthropic-key', { key: TEST_KEY });
    await call('GET', '/api/settings/llm/anthropic-models');
    expect(used).toEqual(['env-key']);
  });
});

describe('GET /api/settings/llm/anthropic-models', () => {
  it('409 NO_KEY without a key', async () => {
    const { call } = makeApp({ env: {} });
    const res = await call('GET', '/api/settings/llm/anthropic-models');
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('NO_KEY');
  });

  it('lists models for a valid key', async () => {
    const { call } = makeApp({
      env: {},
      createClaudeClient: () => stubClaude({ models: [{ id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' }, { id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5' }] }).client,
    });
    await call('PUT', '/api/settings/llm/anthropic-key', { key: TEST_KEY });
    const res = await call('GET', '/api/settings/llm/anthropic-models');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { id: 'claude-opus-5-5', displayName: 'Claude Opus 5.5' },
      { id: 'claude-sonnet-5-5', displayName: 'Claude Sonnet 5.5' },
    ]);
  });

  it('502 KEY_REJECTED when the key is refused, other upstream failures keep their code', async () => {
    const reject = Anthropic.APIError.generate(401, { type: 'error' }, 'invalid x-api-key', new Headers());
    const { call } = makeApp({ env: {}, createClaudeClient: () => stubClaude({ models: reject }).client });
    await call('PUT', '/api/settings/llm/anthropic-key', { key: TEST_KEY });
    const res = await call('GET', '/api/settings/llm/anthropic-models');
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe('KEY_REJECTED');

    const limited = makeApp({
      env: {},
      createClaudeClient: () => stubClaude({ models: Anthropic.APIError.generate(429, {}, 'slow down', new Headers()) }).client,
    });
    await limited.call('PUT', '/api/settings/llm/anthropic-key', { key: TEST_KEY });
    expect((await (await limited.call('GET', '/api/settings/llm/anthropic-models')).json()).error.code).toBe('RATE_LIMIT');
  });
});

// ---- settings: endpoints --------------------------------------------------------------------
describe('local endpoints', () => {
  it('registers an endpoint serving one model, normalising the URL', async () => {
    const f = stubFetch({ 'http://192.0.2.1:8080/v1/models': () => jsonRes({ data: [{ id: 'qwen3.6-coder' }] }) });
    const { call } = makeApp({ env: {}, fetch: f.fn });
    const res = await call('POST', '/api/settings/llm/endpoints', { baseUrl: ' http://192.0.2.1:8080/ ' });
    expect(res.status).toBe(201);
    const ep = await res.json();
    expect(ep).toMatchObject({ label: '192.0.2.1:8080', baseUrl: 'http://192.0.2.1:8080', model: 'qwen3.6-coder' });
    expect(f.calls[0]!.url).toBe('http://192.0.2.1:8080/v1/models');
    expect(f.calls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
    expect((await (await call('GET', '/api/settings/llm')).json()).endpoints).toEqual([ep]);
  });

  it('uses the given label', async () => {
    const f = stubFetch({ 'https://odin/v1/models': () => jsonRes({ data: [{ id: 'm' }] }) });
    const { call } = makeApp({ env: {}, fetch: f.fn });
    expect((await (await call('POST', '/api/settings/llm/endpoints', { baseUrl: 'https://odin', label: 'Odin' })).json()).label).toBe('Odin');
  });

  it('several models: requires "model", validates it, accepts a served one', async () => {
    const f = stubFetch({ 'http://odin/v1/models': () => jsonRes({ data: [{ id: 'a' }, { id: 'b' }] }) });
    const { call } = makeApp({ env: {}, fetch: f.fn });
    const none = await call('POST', '/api/settings/llm/endpoints', { baseUrl: 'http://odin' });
    expect(none.status).toBe(400);
    const e1 = (await none.json()).error;
    expect(e1.code).toBe('MODEL_REQUIRED');
    expect(e1.issues.models).toEqual(['a', 'b']);
    const wrong = await call('POST', '/api/settings/llm/endpoints', { baseUrl: 'http://odin', model: 'zzz' });
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).error.code).toBe('MODEL_NOT_SERVED');
    const ok = await call('POST', '/api/settings/llm/endpoints', { baseUrl: 'http://odin', model: 'b' });
    expect(ok.status).toBe(201);
    expect((await ok.json()).model).toBe('b');
  });

  it('understands the llama.cpp "models" listing shape', async () => {
    const f = stubFetch({ 'http://odin/v1/models': () => jsonRes({ models: [{ name: 'x', model: 'gpt-oss-120b' }] }) });
    const { call } = makeApp({ env: {}, fetch: f.fn });
    expect((await (await call('POST', '/api/settings/llm/endpoints', { baseUrl: 'http://odin' })).json()).model).toBe('gpt-oss-120b');
  });

  it('rejects invalid URLs and non-http schemes without fetching', async () => {
    const f = stubFetch({});
    const { call } = makeApp({ env: {}, fetch: f.fn });
    for (const baseUrl of ['not a url', 'ftp://odin', 'file:///etc/passwd', 'http://user:pw@odin']) {
      const res = await call('POST', '/api/settings/llm/endpoints', { baseUrl });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('VALIDATION');
    }
    expect((await call('POST', '/api/settings/llm/endpoints', {})).status).toBe(400);
    expect(f.calls).toHaveLength(0);
  });

  it('502 ENDPOINT_UNREACHABLE when the fetch fails, ENDPOINT_BAD_RESPONSE for non-JSON, HTTP errors and empty lists', async () => {
    const cases: [Routes[string], string][] = [
      [() => { throw new TypeError('fetch failed'); }, 'ENDPOINT_UNREACHABLE'],
      [() => new Response('<html>hi</html>', { status: 200 }), 'ENDPOINT_BAD_RESPONSE'],
      [() => jsonRes({}, 404), 'ENDPOINT_BAD_RESPONSE'],
      [() => jsonRes({ data: [] }), 'ENDPOINT_BAD_RESPONSE'],
      [() => jsonRes({ nope: true }), 'ENDPOINT_BAD_RESPONSE'],
    ];
    for (const [handler, code] of cases) {
      const { call } = makeApp({ env: {}, fetch: stubFetch({ 'http://odin/v1/models': handler }).fn });
      const res = await call('POST', '/api/settings/llm/endpoints', { baseUrl: 'http://odin' });
      expect(res.status).toBe(502);
      expect((await res.json()).error.code).toBe(code);
    }
    expect(db.select().from(llmEndpoints).all()).toHaveLength(0);
  });

  it('refresh: unchanged, single replacement, ambiguous, unreachable, unknown id', async () => {
    let served: string[] = ['a'];
    const f = stubFetch({ 'http://odin/v1/models': () => jsonRes({ data: served.map((id) => ({ id })) }) });
    const { call } = makeApp({ env: {}, fetch: f.fn });
    const ep = await (await call('POST', '/api/settings/llm/endpoints', { baseUrl: 'http://odin' })).json();
    expect((await (await call('POST', `/api/settings/llm/endpoints/${ep.id}/refresh`)).json()).model).toBe('a');
    served = ['b'];
    expect((await (await call('POST', `/api/settings/llm/endpoints/${ep.id}/refresh`)).json()).model).toBe('b');
    expect((await (await call('GET', '/api/settings/llm')).json()).endpoints[0].model).toBe('b');
    served = ['x', 'y'];
    const amb = await call('POST', `/api/settings/llm/endpoints/${ep.id}/refresh`);
    expect(amb.status).toBe(409);
    expect((await amb.json()).error.code).toBe('MODEL_CHANGED');
    served = ['b', 'y'];
    expect((await call('POST', `/api/settings/llm/endpoints/${ep.id}/refresh`)).status).toBe(200);
    expect((await call('POST', '/api/settings/llm/endpoints/nope/refresh')).status).toBe(404);
    const down = makeApp({ env: {}, fetch: stubFetch({}).fn });
    db.update(llmEndpoints).set({ baseUrl: 'http://gone' }).run();
    expect((await down.call('POST', `/api/settings/llm/endpoints/${ep.id}/refresh`)).status).toBe(502);
  });

  it('DELETE removes the endpoint and clears active when it pointed there; 404 for unknown', async () => {
    const f = stubFetch({ 'http://odin/v1/models': () => jsonRes({ data: [{ id: 'a' }] }) });
    const { call } = makeApp({ env: {}, fetch: f.fn });
    const ep = await (await call('POST', '/api/settings/llm/endpoints', { baseUrl: 'http://odin' })).json();
    await call('PUT', '/api/settings/llm/active', { provider: 'local', endpointId: ep.id });
    expect((await (await call('GET', '/api/settings/llm')).json()).active).toEqual({ provider: 'local', endpointId: ep.id });
    expect((await call('DELETE', `/api/settings/llm/endpoints/${ep.id}`)).status).toBe(204);
    const after = await (await call('GET', '/api/settings/llm')).json();
    expect(after.endpoints).toEqual([]);
    expect(after.active).toBeNull();
    expect((await call('DELETE', `/api/settings/llm/endpoints/${ep.id}`)).status).toBe(404);
  });

  it('DELETE keeps active when it pointed elsewhere', async () => {
    const f = stubFetch({
      'http://a/v1/models': () => jsonRes({ data: [{ id: 'm' }] }),
      'http://b/v1/models': () => jsonRes({ data: [{ id: 'm' }] }),
    });
    const { call } = makeApp({ env: {}, fetch: f.fn });
    const a = await (await call('POST', '/api/settings/llm/endpoints', { baseUrl: 'http://a' })).json();
    const b = await (await call('POST', '/api/settings/llm/endpoints', { baseUrl: 'http://b' })).json();
    await call('PUT', '/api/settings/llm/active', { provider: 'local', endpointId: a.id });
    await call('DELETE', `/api/settings/llm/endpoints/${b.id}`);
    expect((await (await call('GET', '/api/settings/llm')).json()).active).toEqual({ provider: 'local', endpointId: a.id });
  });

  it('is owner-scoped: another owner cannot see, refresh, delete or select the endpoint', async () => {
    db.insert(llmEndpoints).values({ id: 'theirs', ownerId: 'someone-else', label: 'x', baseUrl: 'http://x', model: 'm', createdAt: 1 }).run();
    const { call } = makeApp({ env: {}, fetch: stubFetch({ 'http://x/v1/models': () => jsonRes({ data: [{ id: 'm' }] }) }).fn });
    expect((await (await call('GET', '/api/settings/llm')).json()).endpoints).toEqual([]);
    expect((await call('POST', '/api/settings/llm/endpoints/theirs/refresh')).status).toBe(404);
    expect((await call('DELETE', '/api/settings/llm/endpoints/theirs')).status).toBe(404);
    expect((await call('PUT', '/api/settings/llm/active', { provider: 'local', endpointId: 'theirs' })).status).toBe(404);
    expect(db.select().from(llmEndpoints).all()).toHaveLength(1);
  });

  it('settings of another owner are invisible (key and active)', async () => {
    const now = Date.now();
    db.insert(settings).values([
      { ownerId: 'someone-else', key: 'anthropic_api_key', value: TEST_KEY, updatedAt: now },
      { ownerId: 'someone-else', key: 'llm_active', value: JSON.stringify({ provider: 'anthropic', model: 'm' }), updatedAt: now },
    ]).run();
    const { call } = makeApp({ env: {} });
    expect(await (await call('GET', '/api/settings/llm')).json()).toEqual({ anthropic: { keySet: false, keySource: null, last4: null }, endpoints: [], active: null });
  });
});

// ---- settings: active ------------------------------------------------------------------------
describe('PUT /api/settings/llm/active', () => {
  it('anthropic: needs a key and a model', async () => {
    const { call } = makeApp({ env: {} });
    const noKey = await call('PUT', '/api/settings/llm/active', { provider: 'anthropic', model: 'claude-opus-5-5' });
    expect(noKey.status).toBe(409);
    expect((await noKey.json()).error.code).toBe('NO_KEY');
    await call('PUT', '/api/settings/llm/anthropic-key', { key: TEST_KEY });
    for (const body of [{ provider: 'anthropic' }, { provider: 'anthropic', model: '  ' }, { provider: 'nope' }, { provider: 'local' }, {}]) {
      const res = await call('PUT', '/api/settings/llm/active', body);
      expect(res.status).toBe(400);
    }
    const ok = await call('PUT', '/api/settings/llm/active', { provider: 'anthropic', model: ' claude-sonnet-5-5 ' });
    expect(ok.status).toBe(200);
    expect((await ok.json()).active).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5-5' });
  });

  it('local: endpoint must exist; switching replaces the selection', async () => {
    const { call } = makeApp({ env: {}, fetch: stubFetch({ 'http://odin/v1/models': () => jsonRes({ data: [{ id: 'a' }] }) }).fn });
    const missing = await call('PUT', '/api/settings/llm/active', { provider: 'local', endpointId: 'nope' });
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe('ENDPOINT_NOT_FOUND');
    const ep = await (await call('POST', '/api/settings/llm/endpoints', { baseUrl: 'http://odin' })).json();
    const ok = await (await call('PUT', '/api/settings/llm/active', { provider: 'local', endpointId: ep.id })).json();
    expect(ok.active).toEqual({ provider: 'local', endpointId: ep.id });
    await call('PUT', '/api/settings/llm/anthropic-key', { key: TEST_KEY });
    const sw = await (await call('PUT', '/api/settings/llm/active', { provider: 'anthropic', model: 'claude-opus-5-5' })).json();
    expect(sw.active).toEqual({ provider: 'anthropic', model: 'claude-opus-5-5' });
  });
});

// ---- Claude backend --------------------------------------------------------------------------
describe('Claude backend', () => {
  it('sends the expected request and returns the parsed reply', async () => {
    const s = stubClaude();
    const p = createClaudeProvider({ apiKey: TEST_KEY, model: 'claude-opus-5-5', client: s.client });
    const ctl = new AbortController();
    const out = await p.complete({ system, messages: convo, schema, signal: ctl.signal });
    expect(out).toEqual({
      ok: true,
      reply: validReply,
      model: 'claude-opus-5-5',
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 3, cacheCreationTokens: 0 },
    });
    const [params, options] = s.create.mock.calls[0]!;
    expect(params.model).toBe('claude-opus-5-5');
    expect(params.max_tokens).toBe(16000);
    expect(params.thinking).toEqual({ type: 'adaptive' });
    expect(params.output_config.effort).toBe('high');
    // Not an enforced structured-output format: the reply schema is a non-strict tool (task 30).
    expect(params.output_config).toEqual({ effort: 'high' });
    expect(params.tools).toHaveLength(1);
    expect(params.tools[0].name).toBe('reply');
    expect(params.tools[0].strict).toBeUndefined();
    expect(params.tools[0].input_schema.properties.kind).toBeDefined();
    expect(params.tools[0].input_schema.$schema).toBeUndefined();
    expect(params.tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: true });
    expect(params.system).toHaveLength(1);
    expect(params.system[0].text.startsWith(system)).toBe(true);
    expect(params.system[0].text).toContain('"reply" tool');
    expect(params.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(params.messages).toEqual(convo);
    expect(options.signal).toBe(ctl.signal);
    for (const banned of ['budget_tokens', 'temperature', 'output_format', 'json_schema']) {
      expect(JSON.stringify(params)).not.toContain(banned);
    }
    // refusal fallback: verified against the real API to combine with structured output (task 14)
    expect(params.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(params.fallbacks).toBe('default');
    expect(params.messages.at(-1).role).toBe('user'); // no prefill
  });

  it('uses the model it was given', async () => {
    const s = stubClaude();
    await createClaudeProvider({ apiKey: 'k', model: 'claude-sonnet-5-5', client: s.client }).complete({ system, messages: convo, schema });
    expect(s.create.mock.calls[0]![0].model).toBe('claude-sonnet-5-5');
  });

  const run = (create: (...a: any[]) => any) =>
    createClaudeProvider({ apiKey: TEST_KEY, model: 'm', client: stubClaude({ create }).client }).complete({ system, messages: convo, schema });
  const gen = (status: number) => Anthropic.APIError.generate(status, { type: 'error' }, 'boom', new Headers());

  it('stop_reason refusal -> refused (content not read), max_tokens -> truncated', async () => {
    expect(await run(async () => claudeMessage({ stop_reason: 'refusal', content: [] }))).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'refused', retryable: false }),
    });
    expect(await run(async () => claudeMessage({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"question":"x' }] }))).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'truncated' }),
    });
  });

  it('a text reply holding one JSON reply object is accepted', async () => {
    const out: any = await run(async () => claudeMessage({ content: [textBlock(JSON.stringify(validReply))] }));
    expect(out.ok).toBe(true);
    expect(out.reply).toEqual(validReply);
    expect(out.invalidReply).toBeUndefined();
  });

  it('a tool input that does not match ReplySchema is flagged for retry with actionable problems, never passed as valid', async () => {
    const wrongShape: any = await run(async () => claudeMessage({ content: [toolUse({ ...validReply, kind: 'maybe', extra: 1 })] }));
    expect(wrongShape.ok).toBe(true);
    expect(wrongShape.invalidReply.length).toBeGreaterThan(0);
    expect(wrongShape.invalidReply.join(' ')).toMatch(/kind/);
    const missing: any = await run(async () => claudeMessage({ content: [toolUse({ kind: 'question', message: 'x' })] }));
    expect(missing.invalidReply.join(' ')).toMatch(/target|breakerAmps|rooms/);
    const unusedField: any = await run(async () => claudeMessage({ content: [toolUse({ ...validReply, breakerAmps: 15 })] }));
    expect(unusedField.invalidReply.join(' ')).toContain('must leave breakerAmps unused');
  });

  it('malformed JSON text or no tool call -> flagged for retry, not a crash and not a silent pass', async () => {
    for (const content of [[textBlock('not json')], [], [textBlock('{"kind":')]]) {
      const out: any = await run(async () => claudeMessage({ content }));
      expect(out.ok).toBe(true);
      expect(out.invalidReply[0]).toContain('"reply" tool');
    }
  });

  it.each([
    ['401', () => gen(401), 'auth', false],
    ['403', () => gen(403), 'auth', false],
    ['429', () => gen(429), 'rate_limit', true],
    ['408', () => gen(408), 'timeout', true],
    ['500', () => gen(500), 'server_error', true],
    ['529', () => gen(529), 'server_error', true],
    ['400', () => gen(400), 'server_error', false],
    ['404', () => gen(404), 'server_error', false],
    ['connection', () => new Anthropic.APIConnectionError({ message: 'down' }), 'unreachable', true],
    ['conn timeout', () => new Anthropic.APIConnectionTimeoutError(), 'timeout', true],
    ['abort', () => new Anthropic.APIUserAbortError(), 'timeout', false],
  ])('SDK error %s -> %s', async (_n, make, code, retryable) => {
    const out = await run(async () => {
      throw (make as () => Error)();
    });
    expect(out).toEqual({ ok: false, error: { code, message: expect.any(String), retryable } });
  });

  it('rethrows unexpected non-SDK errors', async () => {
    await expect(run(async () => { throw new RangeError('bug'); })).rejects.toThrow('bug');
  });
});

// ---- local backend ---------------------------------------------------------------------------
describe('local backend', () => {
  const okBody = (content: unknown, extra: Record<string, unknown> = {}) => ({
    model: 'qwen3.6-coder',
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(content), reasoning_content: 'thinking...' } }],
    usage: { prompt_tokens: 7, completion_tokens: 3 },
    ...extra,
  });
  const URL_ = 'http://odin:8080/v1/chat/completions';
  const make = (handler: Routes[string], timeoutMs?: number) => {
    const f = stubFetch({ [URL_]: handler });
    return { f, p: createLocalProvider({ baseUrl: 'http://odin:8080', model: 'qwen3.6-coder', fetch: f.fn, timeoutMs }) };
  };

  it('sends the expected request and ignores the reasoning field', async () => {
    const { f, p } = make(() => jsonRes(okBody({ unsupported: 'no' })));
    const ctl = new AbortController();
    const out = await p.complete({ system, messages: [...convo, { role: 'assistant', content: 'Which?' }, { role: 'user', content: 'Kitchen' }], schema, signal: ctl.signal });
    expect(out).toEqual({ ok: true, reply: { unsupported: 'no' }, model: 'qwen3.6-coder', usage: { inputTokens: 7, outputTokens: 3 } });
    const call = f.calls[0]!;
    expect(call.url).toBe(URL_);
    expect(call.init?.method).toBe('POST');
    const body = JSON.parse(String(call.init?.body));
    expect(body.model).toBe('qwen3.6-coder');
    expect(body.temperature).toBe(0);
    expect(body.stream).toBe(false);
    expect(body.messages[0]).toEqual({ role: 'system', content: system });
    expect(body.messages.slice(1).map((m: any) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.schema.properties.blocks).toBeDefined();
    expect(body.response_format.json_schema.schema.$schema).toBeUndefined();
    expect(call.init?.signal).toBeInstanceOf(AbortSignal);
  });

  const err = async (handler: Routes[string], timeoutMs?: number) => {
    const out = await make(handler, timeoutMs).p.complete({ system, messages: convo, schema });
    expect(out.ok).toBe(false);
    return out.ok ? undefined! : out.error;
  };

  it.each([
    [401, 'auth', false],
    [403, 'auth', false],
    [429, 'rate_limit', true],
    [500, 'server_error', true],
    [503, 'server_error', true],
    [400, 'server_error', false],
  ])('HTTP %i -> %s', async (status, code, retryable) => {
    expect(await err(() => jsonRes({ error: 'x' }, status))).toEqual({ code, message: expect.any(String), retryable });
  });

  it('network failure -> unreachable', async () => {
    expect(await err(() => { throw new TypeError('fetch failed'); })).toMatchObject({ code: 'unreachable', retryable: true });
  });

  it('timeout -> timeout (real AbortSignal.timeout, 20 ms, stubbed fetch honours the signal)', async () => {
    const f = vi.fn((_url: any, init?: RequestInit) => new Promise<Response>((_res, rej) => {
      init!.signal!.addEventListener('abort', () => rej(init!.signal!.reason));
    }));
    const p = createLocalProvider({ baseUrl: 'http://odin:8080', model: 'm', fetch: f as unknown as typeof fetch, timeoutMs: 20 });
    const out = await p.complete({ system, messages: convo, schema });
    expect(out).toEqual({ ok: false, error: { code: 'timeout', message: expect.any(String), retryable: true } });
  });

  it('caller abort -> timeout, not retryable', async () => {
    const f = vi.fn((_url: any, init?: RequestInit) => new Promise<Response>((_res, rej) => {
      init!.signal!.addEventListener('abort', () => rej(init!.signal!.reason));
    }));
    const ctl = new AbortController();
    const p = createLocalProvider({ baseUrl: 'http://odin:8080', model: 'm', fetch: f as unknown as typeof fetch });
    const pending = p.complete({ system, messages: convo, schema, signal: ctl.signal });
    ctl.abort();
    expect(await pending).toEqual({ ok: false, error: { code: 'timeout', message: expect.any(String), retryable: false } });
  });

  it('finish_reason length -> truncated; non-JSON body, missing choices, bad content -> bad_json', async () => {
    expect(await err(() => jsonRes({ choices: [{ finish_reason: 'length', message: { content: '{"qu' } }] }))).toMatchObject({ code: 'truncated' });
    expect(await err(() => new Response('<html>', { status: 200 }))).toMatchObject({ code: 'bad_json' });
    expect(await err(() => jsonRes({ choices: [] }))).toMatchObject({ code: 'bad_json' });
    expect(await err(() => jsonRes({ choices: [{ finish_reason: 'stop', message: { content: 'plain words' } }] }))).toMatchObject({ code: 'bad_json' });
    expect(await err(() => jsonRes({ choices: [{ finish_reason: 'stop', message: { content: null, reasoning_content: '{"question":"x"}' } }] }))).toMatchObject({ code: 'bad_json' });
  });
});

// ---- getActiveProvider -------------------------------------------------------------------------
describe('getActiveProvider', () => {
  it('nothing configured', () => {
    expect(getActiveProvider(db, 'local', { env: {} })).toEqual({ configured: false, reason: 'none' });
  });

  it('anthropic: builds a Claude provider with the stored (or env) key and chosen model', async () => {
    const keys: string[] = [];
    const s = stubClaude();
    const deps = { env: {}, createClaudeClient: (k: string) => (keys.push(k), s.client) };
    const { call } = makeApp(deps);
    await call('PUT', '/api/settings/llm/anthropic-key', { key: TEST_KEY });
    await call('PUT', '/api/settings/llm/active', { provider: 'anthropic', model: 'claude-sonnet-5-5' });
    const r = getActiveProvider(db, 'local', deps);
    expect(r.configured && r.provider.kind).toBe('anthropic');
    if (!r.configured) throw new Error('unreachable');
    expect(r.provider.model).toBe('claude-sonnet-5-5');
    await r.provider.complete({ system, messages: convo, schema });
    expect(keys).toEqual([TEST_KEY]);
    expect(s.create.mock.calls[0]![0].model).toBe('claude-sonnet-5-5');
    const viaEnv = getActiveProvider(db, 'local', { ...deps, env: { ANTHROPIC_API_KEY: 'envkey' } });
    expect(viaEnv.configured).toBe(true);
    expect(keys.at(-1)).toBe('envkey');
  });

  it('anthropic selected but key gone -> no_key', async () => {
    const { call } = makeApp({ env: {} });
    await call('PUT', '/api/settings/llm/anthropic-key', { key: TEST_KEY });
    await call('PUT', '/api/settings/llm/active', { provider: 'anthropic', model: 'm' });
    await call('DELETE', '/api/settings/llm/anthropic-key');
    expect(getActiveProvider(db, 'local', { env: {} })).toEqual({ configured: false, reason: 'no_key' });
  });

  it('local: builds a local provider that posts to the endpoint, honouring LOCAL_LLM_TIMEOUT_MS', async () => {
    const f = stubFetch({
      'http://odin:8080/v1/models': () => jsonRes({ data: [{ id: 'gpt-oss-120b' }] }),
      'http://odin:8080/v1/chat/completions': () =>
        jsonRes({ choices: [{ finish_reason: 'stop', message: { content: '{"question":"Where?"}' } }] }),
    });
    const deps = { env: { LOCAL_LLM_TIMEOUT_MS: '1234' }, fetch: f.fn };
    const { call } = makeApp(deps);
    const ep = await (await call('POST', '/api/settings/llm/endpoints', { baseUrl: 'http://odin:8080' })).json();
    await call('PUT', '/api/settings/llm/active', { provider: 'local', endpointId: ep.id });
    const spy = vi.spyOn(AbortSignal, 'timeout');
    const r = getActiveProvider(db, 'local', deps);
    if (!r.configured) throw new Error('not configured');
    expect(r.provider.kind).toBe('local');
    expect(r.provider.model).toBe('gpt-oss-120b');
    const out = await r.provider.complete({ system, messages: convo, schema });
    expect(out).toMatchObject({ ok: true, reply: { question: 'Where?' } });
    expect(spy).toHaveBeenCalledWith(1234);
    spy.mockRestore();
  });

  it('local selected but endpoint row missing -> endpoint_missing; other owners get none', () => {
    db.insert(settings).values({ ownerId: 'local', key: 'llm_active', value: JSON.stringify({ provider: 'local', endpointId: 'gone' }), updatedAt: 1 }).run();
    expect(getActiveProvider(db, 'local', { env: {} })).toEqual({ configured: false, reason: 'endpoint_missing' });
    expect(getActiveProvider(db, 'other', { env: {} })).toEqual({ configured: false, reason: 'none' });
  });
});
