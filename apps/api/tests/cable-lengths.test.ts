import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
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

/** A project with FIXTURES[1] (cables feed, trav, load) as its only circuit. */
async function setup() {
  const p = await (await call('POST', '/api/projects', { name: 'Basement' })).json();
  const added = await (await call('POST', `/api/projects/${p.id}/circuits`, { circuit: FIXTURES[1] })).json();
  return { pid: p.id as string, cid: added.affectedCircuitId as string };
}
const put = (pid: string, cid: string, body: unknown) => call('PUT', `/api/projects/${pid}/circuits/${cid}/cable-lengths`, body);
const row = (cid: string) => db.select().from(circuits).where(eq(circuits.id, cid)).get()!;

describe('PUT cable-lengths', () => {
  it('a new circuit has no lengths; saving stores them and returns the project', async () => {
    const { pid, cid } = await setup();
    expect(row(cid).cableLengths).toBeNull();
    const res = await put(pid, cid, { lengths: { feed: 25, load: 12.5 }, allowancePct: 10 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.affectedCircuitId).toBe(cid);
    expect(body.project.circuits[0].cableLengths).toEqual({ lengths: { feed: 25, load: 12.5 }, allowancePct: 10 });
    expect(row(cid).cableLengths).toEqual({ lengths: { feed: 25, load: 12.5 }, allowancePct: 10 });
    expect(row(cid).circuit).toEqual(FIXTURES[1]);
  });

  it('is a full replacement: an omitted or null length removes the entry', async () => {
    const { pid, cid } = await setup();
    await put(pid, cid, { lengths: { feed: 25, trav: 8, load: 12 }, allowancePct: 15 });
    await put(pid, cid, { lengths: { feed: 30, trav: null }, allowancePct: 20 });
    expect(row(cid).cableLengths).toEqual({ lengths: { feed: 30 }, allowancePct: 20 });
    await put(pid, cid, { lengths: {}, allowancePct: 0 });
    expect(row(cid).cableLengths).toEqual({ lengths: {}, allowancePct: 0 });
  });

  it('accepts the limits: 0.1 and 1000 feet, 0 and 50 percent', async () => {
    const { pid, cid } = await setup();
    expect((await put(pid, cid, { lengths: { feed: 0.1, load: 1000 }, allowancePct: 50 })).status).toBe(200);
    expect((await put(pid, cid, { lengths: {}, allowancePct: 0 })).status).toBe(200);
  });

  it('rejects bad lengths and allowances with 400 VALIDATION and stores nothing', async () => {
    const { pid, cid } = await setup();
    await put(pid, cid, { lengths: { feed: 5 }, allowancePct: 15 });
    const bad: unknown[] = [
      { lengths: { feed: 0 }, allowancePct: 15 },
      { lengths: { feed: -3 }, allowancePct: 15 },
      { lengths: { feed: 1000.1 }, allowancePct: 15 },
      { lengths: { feed: 12.25 }, allowancePct: 15 },
      { lengths: { feed: '12' }, allowancePct: 15 },
      { lengths: { feed: 5 }, allowancePct: -1 },
      { lengths: { feed: 5 }, allowancePct: 50.5 },
      { lengths: { feed: 5 }, allowancePct: '10' },
      { lengths: { feed: 5 } },
      { allowancePct: 15 },
      { lengths: [1], allowancePct: 15 },
      {},
    ];
    for (const b of bad) {
      const res = await put(pid, cid, b);
      expect(res.status, JSON.stringify(b)).toBe(400);
      expect((await res.json()).error.code).toBe('VALIDATION');
    }
    expect(row(cid).cableLengths).toEqual({ lengths: { feed: 5 }, allowancePct: 15 });
  });

  it('bad JSON is 400 INVALID_JSON', async () => {
    const { pid, cid } = await setup();
    const res = (await app.request(`/api/projects/${pid}/circuits/${cid}/cable-lengths`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{nope' })) as Res;
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_JSON');
  });

  it('unknown cable ids are 400 and named, and nothing is stored', async () => {
    const { pid, cid } = await setup();
    const res = await put(pid, cid, { lengths: { feed: 5, ghost: 3, other: null }, allowancePct: 15 });
    expect(res.status).toBe(400);
    const err = (await res.json()).error;
    expect(err.code).toBe('VALIDATION');
    expect(err.message).toContain('ghost');
    expect(err.message).toContain('other');
    expect(err.message).not.toContain('feed');
    expect(row(cid).cableLengths).toBeNull();
  });

  it('unknown project or circuit is 404; a circuit of another project is 404', async () => {
    const { pid, cid } = await setup();
    const other = await (await call('POST', '/api/projects', { name: 'Other' })).json();
    const body = { lengths: {}, allowancePct: 15 };
    expect((await put('nope', cid, body)).status).toBe(404);
    const missing = await put(pid, 'nope', body);
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe('CIRCUIT_NOT_FOUND');
    expect((await put(other.id, cid, body)).status).toBe(404);
  });

  it("another owner's circuit is 404 and unchanged", async () => {
    db.insert(projects).values({ id: 'f1', ownerId: 'someone-else', name: 'Theirs', description: '', createdAt: 1, updatedAt: 1 }).run();
    db.insert(circuits).values({ id: 'f1c', projectId: 'f1', name: 'T', position: 0, circuit: FIXTURES[1]!, createdAt: 1, updatedAt: 1 }).run();
    expect((await put('f1', 'f1c', { lengths: { feed: 5 }, allowancePct: 15 })).status).toBe(404);
    expect(row('f1c').cableLengths).toBeNull();
  });

  it('bumps the circuit and project update times', async () => {
    const { pid, cid } = await setup();
    db.update(circuits).set({ updatedAt: 1 }).run();
    db.update(projects).set({ updatedAt: 1 }).run();
    await put(pid, cid, { lengths: { feed: 5 }, allowancePct: 15 });
    expect(row(cid).updatedAt).toBeGreaterThan(1);
    expect(db.select().from(projects).get()!.updatedAt).toBeGreaterThan(1);
  });
});

describe('cable lengths when a circuit is replaced by hand', () => {
  it('keeps entries for cables that still exist and drops the rest', async () => {
    const { pid, cid } = await setup();
    await put(pid, cid, { lengths: { feed: 25, trav: 8, load: 12 }, allowancePct: 20 });
    // FIXTURES[3] has cables feed, loada, loadb
    const res = await call('PUT', `/api/projects/${pid}/circuits/${cid}`, { circuit: FIXTURES[3] });
    expect(res.status).toBe(200);
    expect((await res.json()).project.circuits[0].cableLengths).toEqual({ lengths: { feed: 25 }, allowancePct: 20 });
    expect(row(cid).cableLengths).toEqual({ lengths: { feed: 25 }, allowancePct: 20 });
  });

  it('a rename leaves the lengths alone; a circuit without lengths stays null', async () => {
    const { pid, cid } = await setup();
    await put(pid, cid, { lengths: { feed: 25 }, allowancePct: 20 });
    await call('PUT', `/api/projects/${pid}/circuits/${cid}`, { name: 'Renamed' });
    expect(row(cid).cableLengths).toEqual({ lengths: { feed: 25 }, allowancePct: 20 });
    const two = await setup();
    await call('PUT', `/api/projects/${two.pid}/circuits/${two.cid}`, { circuit: FIXTURES[3] });
    expect(row(two.cid).cableLengths).toBeNull();
  });
});
