import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { BLOCK_FIXTURES } from '@diy-ai/core';
import { FIXTURES } from '@diy-ai/core/fixtures';
import { createApp } from '../src/app';
import { openDb, type Db } from '../src/db';
import { circuits, projects } from '../src/schema';

let db: Db;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  db = openDb(':memory:');
  app = createApp(db);
});

type Res = Omit<Response, 'json'> & { json(): Promise<any> };
const call = async (method: string, path: string, body?: unknown): Promise<Res> =>
  app.request(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const create = async (name = 'Kitchen') => (await call('POST', '/api/projects', { name })).json();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function insertForeign(): string {
  const id = 'foreign-1';
  db.insert(projects)
    .values({ id, ownerId: 'someone-else', name: 'Theirs', description: '', createdAt: 1, updatedAt: 1 })
    .run();
  db.insert(circuits).values({ id: 'foreign-c1', projectId: id, name: 'Theirs 1', position: 0, circuit: FIXTURES[0]!, createdAt: 1, updatedAt: 1 }).run();
  return id;
}

describe('health and examples', () => {
  it('GET /api/health', async () => {
    const res = await call('GET', '/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('GET /api/examples lists the four fixtures, then the four block circuits as "Large example"', async () => {
    const res = await call('GET', '/api/examples');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      ...FIXTURES.map((f) => ({ id: f.id, title: f.title })),
      ...BLOCK_FIXTURES.map((f) => ({ id: f.circuit.id, title: `Large example: ${f.circuit.title}` })),
    ]);
    expect(FIXTURES).toHaveLength(4);
    expect(BLOCK_FIXTURES).toHaveLength(4);
  });

  it('unknown route returns a JSON 404', async () => {
    const res = await call('GET', '/api/nope');
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
  });
});

describe('projects CRUD', () => {
  it('creates a project (201), trims the name, defaults description', async () => {
    const res = await call('POST', '/api/projects', { name: '  Garage  ' });
    expect(res.status).toBe(201);
    const p = await res.json();
    expect(p).toMatchObject({ name: 'Garage', description: '', circuits: [] });
    expect(typeof p.id).toBe('string');
    expect(p.createdAt).toBe(p.updatedAt);
    expect(p.ownerId).toBeUndefined();
  });

  it('rejects invalid create bodies with 400', async () => {
    for (const body of [{}, { name: '   ' }, { name: 'x'.repeat(121) }, { name: 5 }, { name: 'ok', description: 1 }]) {
      const res = await call('POST', '/api/projects', body);
      expect(res.status).toBe(400);
      const err = (await res.json()).error;
      expect(err.code).toBe('VALIDATION');
      expect(Array.isArray(err.issues)).toBe(true);
    }
    const bad = await app.request('/api/projects', { method: 'POST', body: '{nope' });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as any).error.code).toBe('INVALID_JSON');
  });

  it('gets a project by id', async () => {
    const p = await create();
    const res = await call('GET', `/api/projects/${p.id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(p);
  });

  it('returns 404 for an unknown id on every id route', async () => {
    const id = 'does-not-exist';
    const cases: [string, string, unknown?][] = [
      ['GET', `/api/projects/${id}`],
      ['PATCH', `/api/projects/${id}`, { name: 'x' }],
      ['DELETE', `/api/projects/${id}`],
      ['POST', `/api/projects/${id}/circuits`, { circuit: FIXTURES[0] }],
      ['PUT', `/api/projects/${id}/circuits/order`, { ids: [] }],
      ['PUT', `/api/projects/${id}/circuits/x`, { name: 'x' }],
      ['DELETE', `/api/projects/${id}/circuits/x`],
      ['GET', `/api/projects/${id}/messages`],
    ];
    for (const [m, path, body] of cases) {
      const res = await call(m, path, body);
      expect(res.status, `${m} ${path}`).toBe(404);
      expect((await res.json()).error.code).toBe('NOT_FOUND');
    }
  });

  it('patches name and description and bumps updated_at', async () => {
    const p = await create();
    await sleep(5);
    const res = await call('PATCH', `/api/projects/${p.id}`, { name: ' Renamed ', description: 'notes' });
    expect(res.status).toBe(200);
    const u = await res.json();
    expect(u).toMatchObject({ id: p.id, name: 'Renamed', description: 'notes', createdAt: p.createdAt });
    expect(u.updatedAt).toBeGreaterThan(p.updatedAt);
  });

  it('rejects invalid patch bodies with 400', async () => {
    const p = await create();
    for (const body of [{}, { name: '' }, { name: 'x'.repeat(121) }]) {
      const res = await call('PATCH', `/api/projects/${p.id}`, body);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('VALIDATION');
    }
  });

  it('deletes a project (204)', async () => {
    const p = await create();
    const res = await call('DELETE', `/api/projects/${p.id}`);
    expect(res.status).toBe(204);
    expect((await call('GET', `/api/projects/${p.id}`)).status).toBe(404);
  });

  it('lists newest updated first, with circuitCount and without circuit data', async () => {
    const a = await create('A');
    await sleep(5);
    const b = await create('B');
    await sleep(5);
    await call('POST', `/api/projects/${a.id}/circuits`, { circuit: FIXTURES[0] });
    await call('POST', `/api/projects/${a.id}/circuits`, { circuit: FIXTURES[1] });
    const res = await call('GET', '/api/projects');
    expect(res.status).toBe(200);
    const list = await res.json();
    expect(list.map((p: any) => p.id)).toEqual([a.id, b.id]);
    expect(list.map((p: any) => p.circuitCount)).toEqual([2, 0]);
    for (const p of list) expect(Object.keys(p).sort()).toEqual(['circuitCount', 'createdAt', 'description', 'id', 'name', 'updatedAt']);
  });
});

describe('circuits', () => {
  const add = (pid: string, body: unknown) => call('POST', `/api/projects/${pid}/circuits`, body);
  const addFixtures = async (pid: string, ...i: number[]) => {
    for (const n of i) await add(pid, { circuit: FIXTURES[n] });
    return (await (await call('GET', `/api/projects/${pid}`)).json()).circuits as any[];
  };
  const stored = (pid: string) => db.select().from(circuits).where(eq(circuits.projectId, pid)).orderBy(circuits.position).all();

  it('POST adds circuits in order, round-trips every valid fixture, default names', async () => {
    const p = await create();
    for (const [i, fixture] of FIXTURES.entries()) {
      const res = await add(p.id, { circuit: fixture });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.project.circuits).toHaveLength(i + 1);
      expect(body.affectedCircuitId).toBe(body.project.circuits[i].id);
    }
    const got = await (await call('GET', `/api/projects/${p.id}`)).json();
    expect(got.circuits.map((c: any) => c.name)).toEqual(['Circuit 1', 'Circuit 2', 'Circuit 3', 'Circuit 4']);
    expect(got.circuits.map((c: any) => c.position)).toEqual([0, 1, 2, 3]);
    expect(got.circuits.map((c: any) => c.circuit)).toEqual(FIXTURES);
    expect(Object.keys(got.circuits[0]).sort()).toEqual(['circuit', 'findings', 'id', 'name', 'origin', 'position', 'updatedAt']);
    expect(got.circuits[0]).toMatchObject({ origin: null, findings: [] });
  });

  it('names are trimmed, 1 to 80 characters, and a default skips taken names', async () => {
    const p = await create();
    const ok = await (await add(p.id, { name: '  Garage lights  ', circuit: FIXTURES[0] })).json();
    expect(ok.project.circuits[0].name).toBe('Garage lights');
    expect((await add(p.id, { name: 'x'.repeat(80), circuit: FIXTURES[0] })).status).toBe(201);
    for (const name of ['', '   ', 'x'.repeat(81), 5]) {
      const res = await add(p.id, { name, circuit: FIXTURES[0] });
      expect(res.status, String(name)).toBe(400);
      expect((await res.json()).error.code).toBe('VALIDATION');
    }
    await add(p.id, { name: 'Circuit 4', circuit: FIXTURES[0] });
    const next = await (await add(p.id, { circuit: FIXTURES[0] })).json();
    expect(next.project.circuits.at(-1).name).toBe('Circuit 5');
  });

  it('POST: missing circuit is 400, structurally invalid is 422 and stores nothing, bad JSON is 400', async () => {
    const p = await create();
    expect((await add(p.id, {})).status).toBe(400);
    expect((await add(p.id, { name: 'x' })).status).toBe(400);
    const bad = structuredClone(FIXTURES[0]!);
    bad.connections.pop();
    const res = await add(p.id, { circuit: bad });
    expect(res.status).toBe(422);
    const err = (await res.json()).error;
    expect(err.code).toBe('INVALID_CIRCUIT');
    expect(err.issues[0]).toHaveProperty('code');
    expect((await add(p.id, { circuit: { nonsense: true } })).status).toBe(422);
    expect(stored(p.id)).toHaveLength(0);
    expect((await app.request(`/api/projects/${p.id}/circuits`, { method: 'POST', body: 'nope' })).status).toBe(400);
  });

  it('PUT replaces the circuit (origin cleared, findings recomputed) and/or renames; unknown circuit 404', async () => {
    const p = await create();
    const [c] = await addFixtures(p.id, 0);
    db.update(circuits).set({ origin: { kind: 'custom', verified: false } }).where(eq(circuits.id, c.id)).run();
    await sleep(5);
    const renamed = await (await call('PUT', `/api/projects/${p.id}/circuits/${c.id}`, { name: ' Kitchen ' })).json();
    expect(renamed.affectedCircuitId).toBe(c.id);
    expect(renamed.project.circuits[0]).toMatchObject({ name: 'Kitchen', circuit: FIXTURES[0], origin: { kind: 'custom', verified: false } });
    expect(renamed.project.updatedAt).toBeGreaterThan(p.updatedAt);
    const replaced = await (await call('PUT', `/api/projects/${p.id}/circuits/${c.id}`, { circuit: FIXTURES[1], name: 'Both' })).json();
    expect(replaced.project.circuits[0]).toMatchObject({ id: c.id, name: 'Both', circuit: FIXTURES[1], origin: null, position: 0 });
    const missing = await call('PUT', `/api/projects/${p.id}/circuits/nope`, { name: 'x' });
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe('CIRCUIT_NOT_FOUND');
  });

  it('PUT: empty body 400; invalid circuit 422 keeps the stored one', async () => {
    const p = await create();
    const [c] = await addFixtures(p.id, 1);
    expect((await call('PUT', `/api/projects/${p.id}/circuits/${c.id}`, {})).status).toBe(400);
    expect((await call('PUT', `/api/projects/${p.id}/circuits/${c.id}`, { name: '' })).status).toBe(400);
    const res = await call('PUT', `/api/projects/${p.id}/circuits/${c.id}`, { name: 'changed', circuit: { nonsense: true } });
    expect(res.status).toBe(422);
    expect((await res.json()).error.issues[0].code).toBe('SCHEMA');
    expect(stored(p.id)[0]).toMatchObject({ name: 'Circuit 1', circuit: FIXTURES[1] });
  });

  it('PUT cannot reach a circuit of another project', async () => {
    const a = await create('A');
    const b = await create('B');
    const [ca] = await addFixtures(a.id, 0);
    expect((await call('PUT', `/api/projects/${b.id}/circuits/${ca.id}`, { name: 'x' })).status).toBe(404);
    expect((await call('DELETE', `/api/projects/${b.id}/circuits/${ca.id}`)).status).toBe(404);
    expect(stored(a.id)[0]!.name).toBe('Circuit 1');
  });

  it('DELETE removes the circuit and keeps positions contiguous', async () => {
    const p = await create();
    const [c0, c1, c2] = await addFixtures(p.id, 0, 1, 2);
    const res = await call('DELETE', `/api/projects/${p.id}/circuits/${c1.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.affectedCircuitId).toBeNull();
    expect(body.project.circuits.map((c: any) => [c.id, c.position])).toEqual([[c0.id, 0], [c2.id, 1]]);
    expect(stored(p.id).map((r) => r.position)).toEqual([0, 1]);
    const again = await call('DELETE', `/api/projects/${p.id}/circuits/${c1.id}`);
    expect(again.status).toBe(404);
    expect((await again.json()).error.code).toBe('CIRCUIT_NOT_FOUND');
    await call('DELETE', `/api/projects/${p.id}/circuits/${c0.id}`);
    await call('DELETE', `/api/projects/${p.id}/circuits/${c2.id}`);
    expect(stored(p.id)).toHaveLength(0);
  });

  it('order reorders, validates the id list, and "order" is not read as a circuit id', async () => {
    const p = await create();
    const [c0, c1, c2] = await addFixtures(p.id, 0, 1, 2);
    const res = await call('PUT', `/api/projects/${p.id}/circuits/order`, { ids: [c2.id, c0.id, c1.id] });
    expect(res.status).toBe(200);
    expect((await res.json()).project.circuits.map((c: any) => [c.id, c.position])).toEqual([[c2.id, 0], [c0.id, 1], [c1.id, 2]]);
    expect(stored(p.id).map((r) => r.id)).toEqual([c2.id, c0.id, c1.id]);
    for (const ids of [[c0.id, c1.id], [c0.id, c1.id, c1.id], [c0.id, c1.id, 'zzz'], [c0.id, c1.id, c2.id, c2.id], []]) {
      const bad = await call('PUT', `/api/projects/${p.id}/circuits/order`, { ids });
      expect(bad.status, JSON.stringify(ids)).toBe(400);
      expect((await bad.json()).error.code).toBe('VALIDATION');
    }
    expect((await call('PUT', `/api/projects/${p.id}/circuits/order`, {})).status).toBe(400);
    expect(stored(p.id).map((r) => r.id)).toEqual([c2.id, c0.id, c1.id]);
    // positions stay contiguous when a circuit is added after a reorder
    const added = await (await add(p.id, { circuit: FIXTURES[3] })).json();
    expect(added.project.circuits.map((c: any) => c.position)).toEqual([0, 1, 2, 3]);
  });

  it('circuit changes bump the project updated_at', async () => {
    const p = await create();
    await sleep(5);
    const u = await (await add(p.id, { circuit: FIXTURES[0] })).json();
    expect(u.project.updatedAt).toBeGreaterThan(p.updatedAt);
  });

  it('deleting a project cascades to its circuits', async () => {
    const p = await create();
    await addFixtures(p.id, 0, 1);
    await call('DELETE', `/api/projects/${p.id}`);
    expect(db.select().from(circuits).all()).toHaveLength(0);
  });

  it('the old single-circuit routes are gone', async () => {
    const p = await create();
    expect((await call('PUT', `/api/projects/${p.id}/circuit`, FIXTURES[0])).status).toBe(404);
    expect((await call('DELETE', `/api/projects/${p.id}/circuit`)).status).toBe(404);
  });
});

describe('from-example', () => {
  it('creates a project named after the example with its circuit', async () => {
    const fixture = FIXTURES[3]!;
    const res = await call('POST', '/api/projects/from-example', { exampleId: fixture.id });
    expect(res.status).toBe(201);
    const p = await res.json();
    expect(p.name).toBe(fixture.title);
    expect(p.circuits).toHaveLength(1);
    expect(p.circuits[0]).toMatchObject({ name: fixture.title, position: 0, circuit: fixture, origin: null, findings: [] });
  });

  it.each(BLOCK_FIXTURES.map((f) => [f.name, f] as const))('creates a project from the block circuit %s', async (_n, f) => {
    const res = await call('POST', '/api/projects/from-example', { exampleId: f.circuit.id });
    expect(res.status).toBe(201);
    const p = await res.json();
    expect(p.name).toBe(`Large example: ${f.circuit.title}`);
    expect(p.circuits).toHaveLength(1);
    expect(p.circuits[0]).toMatchObject({ name: `Large example: ${f.circuit.title}`, circuit: f.circuit });
  });

  it('404 for an unknown example, 400 for a bad body', async () => {
    const unknown = await call('POST', '/api/projects/from-example', { exampleId: 'zzz' });
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).error.code).toBe('EXAMPLE_NOT_FOUND');
    const bad = await call('POST', '/api/projects/from-example', {});
    expect(bad.status).toBe(400);
  });
});

describe('owner scoping', () => {
  it('another owner project is invisible and unmodifiable to local', async () => {
    const id = insertForeign();
    const mine = await create();

    const list = await (await call('GET', '/api/projects')).json();
    expect(list.map((p: any) => p.id)).toEqual([mine.id]);

    expect((await call('GET', `/api/projects/${id}`)).status).toBe(404);
    expect((await call('PATCH', `/api/projects/${id}`, { name: 'hacked' })).status).toBe(404);
    expect((await call('POST', `/api/projects/${id}/circuits`, { circuit: FIXTURES[1] })).status).toBe(404);
    expect((await call('PUT', `/api/projects/${id}/circuits/foreign-c1`, { name: 'hacked' })).status).toBe(404);
    expect((await call('PUT', `/api/projects/${id}/circuits/order`, { ids: ['foreign-c1'] })).status).toBe(404);
    expect((await call('DELETE', `/api/projects/${id}/circuits/foreign-c1`)).status).toBe(404);
    expect((await call('DELETE', `/api/projects/${id}`)).status).toBe(404);

    const row = db.select().from(projects).all().find((r) => r.id === id)!;
    expect(row).toMatchObject({ name: 'Theirs', ownerId: 'someone-else', updatedAt: 1 });
    expect(db.select().from(circuits).all()).toEqual([
      { id: 'foreign-c1', projectId: id, name: 'Theirs 1', position: 0, circuit: FIXTURES[0], origin: null, findings: null, createdAt: 1, updatedAt: 1 },
    ]);
  });
});
