import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, SETTINGS_ERROR_CODES } from '../src/api/client';

const stubFetch = (impl: (url: string, init?: RequestInit) => Promise<Response> | Response) => {
  const fn = vi.fn(async (url: string, init?: RequestInit) => impl(url, init));
  vi.stubGlobal('fetch', fn);
  return fn;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const caught = async (p: Promise<unknown>): Promise<ApiError> => {
  try {
    await p;
  } catch (e) {
    return e as ApiError;
  }
  throw new Error('expected rejection');
};

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('parses a successful JSON response and uses a relative /api URL', async () => {
    const list = [{ id: 'a', name: 'A', description: '', circuitCount: 2, createdAt: 1, updatedAt: 2 }];
    const fetchMock = stubFetch(() => json(list));
    await expect(api.listProjects()).resolves.toEqual(list);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/projects');
  });

  it('sends JSON bodies with a content type', async () => {
    const fetchMock = stubFetch(() => json({ id: 'x' }, 201));
    await api.createProject({ name: 'Garage' });
    const init = fetchMock.mock.calls[0]![1]!;
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"name":"Garage"}');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('encodes ids in paths', async () => {
    const fetchMock = stubFetch(() => json({}));
    await api.getProject('a/b');
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/projects/a%2Fb');
  });

  it('resolves undefined for 204', async () => {
    stubFetch(() => new Response(null, { status: 204 }));
    await expect(api.deleteProject('x')).resolves.toBeUndefined();
  });

  it('parses the API error body into a typed ApiError with issues', async () => {
    const issues = [{ path: 'name', message: 'Too small' }];
    stubFetch(() => json({ error: { code: 'VALIDATION', message: 'Invalid request body', issues } }, 400));
    const err = await caught(api.createProject({ name: '' }));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('VALIDATION');
    expect(err.message).toBe('Invalid request body');
    expect(err.status).toBe(400);
    expect(err.issues).toEqual(issues);
  });

  it('parses an error body without issues', async () => {
    stubFetch(() => json({ error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404));
    const err = await caught(api.getProject('nope'));
    expect(err.code).toBe('NOT_FOUND');
    expect(err.issues).toBeUndefined();
  });

  it('turns a non-JSON failure into an HTTP_<status> error', async () => {
    stubFetch(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    const err = await caught(api.listProjects());
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('HTTP_502');
    expect(err.status).toBe(502);
  });

  it('turns a JSON failure without the error shape into an HTTP_<status> error', async () => {
    stubFetch(() => json({ oops: true }, 500));
    expect((await caught(api.listProjects())).code).toBe('HTTP_500');
  });

  it('rejects a successful but non-JSON body', async () => {
    stubFetch(() => new Response('hello', { status: 200 }));
    expect((await caught(api.listProjects())).code).toBe('BAD_RESPONSE');
  });

  it('turns a network failure into a NETWORK error', async () => {
    stubFetch(() => {
      throw new TypeError('fetch failed');
    });
    const err = await caught(api.listProjects());
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('NETWORK');
    expect(err.status).toBe(0);
  });
});

describe('settings routes', () => {
  const status = {
    anthropic: { keySet: true, keySource: 'stored', last4: 'wxyz' },
    endpoints: [],
    active: null,
  };

  it('sends the key in the body only, never in the URL', async () => {
    const fetchMock = stubFetch(() => json(status));
    await expect(api.setAnthropicKey('sk-secret-wxyz')).resolves.toEqual(status);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/settings/llm/anthropic-key');
    expect(url).not.toContain('secret');
    expect(init!.method).toBe('PUT');
    expect(init!.body).toBe('{"key":"sk-secret-wxyz"}');
  });

  it('removes the key and surfaces KEY_FROM_ENV', async () => {
    const fetchMock = stubFetch(() => json({ error: { code: 'KEY_FROM_ENV', message: 'From the environment' } }, 409));
    const err = await caught(api.removeAnthropicKey());
    expect(fetchMock.mock.calls[0]![1]!.method).toBe('DELETE');
    expect(err.code).toBe('KEY_FROM_ENV');
    expect(err.status).toBe(409);
  });

  it('lists Claude models and reports upstream failures with their code', async () => {
    stubFetch(() => json([{ id: 'claude-x', displayName: 'Claude X' }]));
    await expect(api.listClaudeModels()).resolves.toEqual([{ id: 'claude-x', displayName: 'Claude X' }]);
    stubFetch(() => json({ error: { code: 'KEY_REJECTED', message: 'Rejected' } }, 502));
    expect((await caught(api.listClaudeModels())).code).toBe('KEY_REJECTED');
    stubFetch(() => json({ error: { code: 'NO_KEY', message: 'No key' } }, 409));
    expect((await caught(api.listClaudeModels())).code).toBe('NO_KEY');
  });

  it('adds an endpoint and exposes the served models of MODEL_REQUIRED', async () => {
    const fetchMock = stubFetch(() => json({ id: 'e1', label: 'box', baseUrl: 'http://h:1', model: 'm', createdAt: 1 }, 201));
    await api.addEndpoint({ baseUrl: 'http://h:1', label: 'box' });
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/settings/llm/endpoints');
    expect(fetchMock.mock.calls[0]![1]!.body).toBe('{"baseUrl":"http://h:1","label":"box"}');

    stubFetch(() => json({ error: { code: 'MODEL_REQUIRED', message: 'Name one', issues: { models: ['a', 'b'] } } }, 400));
    const err = await caught(api.addEndpoint({ baseUrl: 'http://h:1' }));
    expect(err.code).toBe('MODEL_REQUIRED');
    expect(err.models).toEqual(['a', 'b']);
    expect(err.issues).toBeUndefined();
  });

  it('reports an unreachable endpoint', async () => {
    stubFetch(() => json({ error: { code: 'ENDPOINT_UNREACHABLE', message: 'Could not reach it' } }, 502));
    const err = await caught(api.addEndpoint({ baseUrl: 'http://h:1' }));
    expect(err.code).toBe('ENDPOINT_UNREACHABLE');
    expect(err.models).toBeUndefined();
  });

  it('refreshes and deletes endpoints with encoded ids', async () => {
    const fetchMock = stubFetch((url) =>
      url.endsWith('/refresh') ? json({ id: 'a/b', label: 'l', baseUrl: 'u', model: 'm', createdAt: 1 }) : new Response(null, { status: 204 }),
    );
    await api.refreshEndpoint('a/b');
    await expect(api.deleteEndpoint('a/b')).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/settings/llm/endpoints/a%2Fb/refresh');
    expect(fetchMock.mock.calls[0]![1]!.method).toBe('POST');
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/settings/llm/endpoints/a%2Fb');
    stubFetch(() => json({ error: { code: 'MODEL_CHANGED', message: 'Changed', issues: { models: ['x', 'y'] } } }, 409));
    expect((await caught(api.refreshEndpoint('a'))).models).toEqual(['x', 'y']);
  });

  it('sets the active model and reports NO_KEY', async () => {
    const fetchMock = stubFetch(() => json(status));
    await api.setActive({ provider: 'local', endpointId: 'e1' });
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/settings/llm/active');
    expect(fetchMock.mock.calls[0]![1]!.body).toBe('{"provider":"local","endpointId":"e1"}');
    stubFetch(() => json({ error: { code: 'NO_KEY', message: 'Set a key first' } }, 409));
    expect((await caught(api.setActive({ provider: 'anthropic', model: 'm' }))).code).toBe('NO_KEY');
  });
});

describe('message routes', () => {
  it('lists messages and sends content to the project path', async () => {
    const fetchMock = stubFetch((url, init) =>
      init?.method === 'POST'
        ? json({ userMessage: { id: 'u' }, assistantMessage: { id: 'a', kind: 'question' }, project: null })
        : json([{ id: 'u', role: 'user', content: 'hi', kind: null, createdAt: 1 }]),
    );
    await expect(api.listMessages('p/1')).resolves.toHaveLength(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/projects/p%2F1/messages');
    const res = await api.sendMessage('p/1', 'wire a switch');
    expect(res.assistantMessage.kind).toBe('question');
    expect(fetchMock.mock.calls[1]![1]!.body).toBe('{"content":"wire a switch"}');
  });

  it('sends the selected circuit id only when there is one, and returns the affected circuit', async () => {
    const fetchMock = stubFetch(() =>
      json({ userMessage: { id: 'u' }, assistantMessage: { id: 'a', kind: 'circuit', circuitId: 'c2' }, project: { id: 'p', circuits: [] }, affectedCircuitId: 'c2' }),
    );
    const res = await api.sendMessage('p', 'add a fan', 'c/1');
    expect(fetchMock.mock.calls[0]![1]!.body).toBe('{"content":"add a fan","selectedCircuitId":"c/1"}');
    expect(res.affectedCircuitId).toBe('c2');
    expect(res.assistantMessage.circuitId).toBe('c2');
    await api.sendMessage('p', 'hello');
    expect(fetchMock.mock.calls[1]![1]!.body).toBe('{"content":"hello"}');
  });

  it('reports an unknown selected circuit as a validation error', async () => {
    stubFetch(() => json({ error: { code: 'VALIDATION', message: 'selectedCircuitId must be a circuit of this project', issues: [{ path: 'selectedCircuitId', message: 'unknown circuit' }] } }, 400));
    const err = await caught(api.sendMessage('p', 'x', 'gone'));
    expect(err.code).toBe('VALIDATION');
    expect(err.issues).toEqual([{ path: 'selectedCircuitId', message: 'unknown circuit' }]);
  });

  it('passes the circuit link of a message through', async () => {
    stubFetch(() => json([{ id: 'a', role: 'assistant', content: 'x', kind: 'circuit', circuitId: 'c1', createdAt: 1 }, { id: 'b', role: 'assistant', content: 'y', kind: 'circuit', circuitId: null, createdAt: 2 }]));
    const list = await api.listMessages('p');
    expect(list.map((m) => m.circuitId)).toEqual(['c1', null]);
  });

  it('passes origin and errorCode through unchanged', async () => {
    const origin = { kind: 'custom', verified: false };
    stubFetch(() =>
      json([
        { id: 'a', role: 'assistant', content: 'x', kind: 'circuit', origin, errorCode: null, createdAt: 1 },
        { id: 'b', role: 'assistant', content: 'y', kind: 'error', origin: null, errorCode: 'auth', createdAt: 2 },
      ]),
    );
    const list = await api.listMessages('p');
    expect(list[0]!.origin).toEqual(origin);
    expect(list[1]!.errorCode).toBe('auth');
  });

  it('passes message findings and per-circuit findings through unchanged, and does not treat rules_failed as a settings error', async () => {
    const finding = {
      ruleId: 'no-short',
      severity: 'error',
      message: 'Breaker joined to neutral.',
      involved: ['c1-w1'],
      citation: { edition: 'nec-2023', section: null, confirmed: false },
    };
    stubFetch((url) =>
      url.endsWith('/messages')
        ? json([{ id: 'a', role: 'assistant', content: 'x', kind: 'error', origin: null, errorCode: 'rules_failed', findings: [finding], createdAt: 1 }])
        : json({ id: 'p', name: 'P', description: '', createdAt: 1, updatedAt: 2, circuits: [{ id: 'c1', name: 'Lights', position: 0, circuit: {}, origin: null, findings: [finding], updatedAt: 2 }] }),
    );
    const list = await api.listMessages('p');
    expect(list[0]!.findings).toEqual([finding]);
    expect((await api.getProject('p')).circuits[0]!.findings).toEqual([finding]);
    expect(SETTINGS_ERROR_CODES).not.toContain('rules_failed');
  });

  it('links to Settings only for configuration error codes', () => {
    expect([...SETTINGS_ERROR_CODES].sort()).toEqual(['auth', 'endpoint_missing', 'no_key', 'not_configured', 'unreachable']);
    expect(SETTINGS_ERROR_CODES).not.toContain('timeout');
    expect(SETTINGS_ERROR_CODES).not.toContain('invalid_reply');
  });

  it('surfaces 409 BUSY while a reply is in flight', async () => {
    stubFetch(() => json({ error: { code: 'BUSY', message: 'A reply is still being written for this project.' } }, 409));
    const err = await caught(api.sendMessage('p', 'again'));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('BUSY');
    expect(err.status).toBe(409);
    expect((await caught(api.clearMessages('p'))).code).toBe('BUSY');
  });

  it('clears the conversation (204)', async () => {
    const fetchMock = stubFetch(() => new Response(null, { status: 204 }));
    await expect(api.clearMessages('p')).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]![1]!.method).toBe('DELETE');
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/projects/p/messages');
  });

  it('reports validation and not-found errors', async () => {
    stubFetch(() => json({ error: { code: 'VALIDATION', message: 'Invalid request body', issues: [{ path: 'content', message: 'Too small' }] } }, 400));
    expect((await caught(api.sendMessage('p', ''))).issues).toEqual([{ path: 'content', message: 'Too small' }]);
    stubFetch(() => json({ error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404));
    expect((await caught(api.listMessages('p'))).code).toBe('NOT_FOUND');
  });
});

describe('circuit routes', () => {
  const change = { project: { id: 'p', name: 'P', description: '', circuits: [], createdAt: 1, updatedAt: 2 }, affectedCircuitId: 'c1' };

  it('creates a circuit with POST to the circuits path', async () => {
    const fetchMock = stubFetch(() => json(change, 201));
    const res = await api.createCircuit('p/1', { name: 'Garage', circuit: { title: 't' } as never });
    expect(res.affectedCircuitId).toBe('c1');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/projects/p%2F1/circuits');
    expect(init!.method).toBe('POST');
    expect(init!.body).toBe('{"name":"Garage","circuit":{"title":"t"}}');
  });

  it('renames a circuit with PUT and only the fields given', async () => {
    const fetchMock = stubFetch(() => json(change));
    await api.updateCircuit('p', 'c/1', { name: 'Kitchen' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/projects/p/circuits/c%2F1');
    expect(init!.method).toBe('PUT');
    expect(init!.body).toBe('{"name":"Kitchen"}');
  });

  it('deletes a circuit and returns the project without it', async () => {
    const fetchMock = stubFetch(() => json({ ...change, affectedCircuitId: null }));
    const res = await api.deleteCircuit('p', 'c1');
    expect(res.affectedCircuitId).toBeNull();
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/projects/p/circuits/c1');
    expect(fetchMock.mock.calls[0]![1]!.method).toBe('DELETE');
    expect(fetchMock.mock.calls[0]![1]!.body).toBeUndefined();
  });

  it('reorders with the full id list, on the order path', async () => {
    const fetchMock = stubFetch(() => json({ ...change, affectedCircuitId: null }));
    await api.reorderCircuits('p', ['b', 'a']);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/projects/p/circuits/order');
    expect(init!.method).toBe('PUT');
    expect(init!.body).toBe('{"ids":["b","a"]}');
  });

  it('surfaces CIRCUIT_NOT_FOUND and NOT_FOUND from every circuit call', async () => {
    stubFetch(() => json({ error: { code: 'CIRCUIT_NOT_FOUND', message: 'Circuit not found' } }, 404));
    for (const call of [
      () => api.updateCircuit('p', 'c', { name: 'x' }),
      () => api.deleteCircuit('p', 'c'),
    ]) {
      const err = await caught(call());
      expect(err).toBeInstanceOf(ApiError);
      expect(err.code).toBe('CIRCUIT_NOT_FOUND');
      expect(err.status).toBe(404);
    }
    stubFetch(() => json({ error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404));
    expect((await caught(api.reorderCircuits('nope', []))).code).toBe('NOT_FOUND');
    expect((await caught(api.createCircuit('nope', { circuit: {} as never }))).code).toBe('NOT_FOUND');
  });

  it('surfaces validation, invalid-circuit and rules-failed bodies with their issues', async () => {
    stubFetch(() => json({ error: { code: 'VALIDATION', message: 'ids must list every circuit', issues: [{ path: 'ids', message: 'must be a permutation of the project circuit ids' }] } }, 400));
    expect((await caught(api.reorderCircuits('p', ['a']))).issues).toEqual([{ path: 'ids', message: 'must be a permutation of the project circuit ids' }]);
    stubFetch(() => json({ error: { code: 'INVALID_CIRCUIT', message: 'Circuit is not valid', issues: [{ message: 'dangling', path: 'connections.0' }] } }, 422));
    const invalid = await caught(api.updateCircuit('p', 'c', { circuit: {} as never }));
    expect(invalid.code).toBe('INVALID_CIRCUIT');
    expect(invalid.status).toBe(422);
    stubFetch(() => json({ error: { code: 'RULES_FAILED', message: 'Rules failed', issues: [{ message: 'short' }] } }, 422));
    expect((await caught(api.createCircuit('p', { circuit: {} as never }))).code).toBe('RULES_FAILED');
  });

  it('no longer has the single-circuit calls', () => {
    expect('setCircuit' in api).toBe(false);
    expect('clearCircuit' in api).toBe(false);
  });
});
