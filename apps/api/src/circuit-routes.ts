import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from './db';
import { CircuitName, appendCircuit, checkSupplied, listCircuits, loadProject, pruneCableLengths, setOrder, touchProject } from './circuits';
import { fail, readBody } from './http';
import { getOwnerId } from './owner';
import { circuits, projects } from './schema';

const hasCircuit = (b: { circuit?: unknown }) => b.circuit !== undefined;
const CreateBody = z.object({ name: CircuitName.optional(), circuit: z.unknown() }).refine(hasCircuit, { message: 'circuit is required', path: ['circuit'] });
const UpdateBody = z
  .object({ name: CircuitName.optional(), circuit: z.unknown().optional() })
  .refine((b) => b.name !== undefined || hasCircuit(b), { message: 'Provide name or circuit' });
const MAX_FEET = 1000;
const MAX_ALLOWANCE_PCT = 50;
/** A length in feet: above 0, at most 1000, one decimal at most. */
const Feet = z
  .number()
  .gt(0, 'must be more than 0 feet')
  .max(MAX_FEET, `must be ${MAX_FEET} feet or less`)
  .refine((n) => Math.abs(n * 10 - Math.round(n * 10)) < 1e-9, { message: 'must have at most one decimal' });
/** The complete set of lengths of a circuit: a null length removes that entry, as does leaving a cable out. */
const CableLengthsBody = z.object({
  lengths: z.record(z.string(), Feet.nullable()),
  allowancePct: z.number().min(0, 'must be 0 or more').max(MAX_ALLOWANCE_PCT, `must be ${MAX_ALLOWANCE_PCT} or less`),
});
const OrderBody = z.object({ ids: z.array(z.string()) });

/** Routes for the circuits of a project; every route is scoped to the owner through the project. */
export function circuitRoutes(db: Db) {
  const routes = new Hono();

  const ownedProject = (id: string) => db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, id), eq(projects.ownerId, getOwnerId()))).get();
  const result = (projectId: string, affectedCircuitId: string | null) => ({ project: loadProject(db, projectId, getOwnerId()), affectedCircuitId });

  routes.post('/projects/:id/circuits', async (c) => {
    const id = c.req.param('id');
    if (!ownedProject(id)) return fail(c, 404, 'NOT_FOUND', 'Project not found');
    const body = await readBody(c, CreateBody);
    if ('res' in body) return body.res;
    const checked = checkSupplied(body.data.circuit);
    if (!checked.ok) return fail(c, 422, checked.code, checked.message, checked.issues);
    const row = db.transaction((tx) => {
      const created = appendCircuit(tx, id, { name: body.data.name, circuit: checked.circuit, origin: null, findings: checked.findings });
      touchProject(tx, id);
      return created;
    });
    return c.json(result(id, row.id), 201);
  });

  // Registered before `:circuitId` so "order" is never read as a circuit id.
  routes.put('/projects/:id/circuits/order', async (c) => {
    const id = c.req.param('id');
    if (!ownedProject(id)) return fail(c, 404, 'NOT_FOUND', 'Project not found');
    const body = await readBody(c, OrderBody);
    if ('res' in body) return body.res;
    const current = listCircuits(db, id).map((r) => r.id);
    const given = body.data.ids;
    if (given.length !== current.length || new Set(given).size !== given.length || !given.every((g) => current.includes(g)))
      return fail(c, 400, 'VALIDATION', 'ids must list every circuit of the project exactly once', [{ path: 'ids', message: 'must be a permutation of the project circuit ids' }]);
    db.transaction((tx) => {
      setOrder(tx, given);
      touchProject(tx, id);
    });
    return c.json(result(id, null));
  });

  routes.put('/projects/:id/circuits/:circuitId', async (c) => {
    const id = c.req.param('id');
    const circuitId = c.req.param('circuitId');
    if (!ownedProject(id)) return fail(c, 404, 'NOT_FOUND', 'Project not found');
    const existing = db.select().from(circuits).where(and(eq(circuits.id, circuitId), eq(circuits.projectId, id))).get();
    if (!existing) return fail(c, 404, 'CIRCUIT_NOT_FOUND', 'Circuit not found');
    const body = await readBody(c, UpdateBody);
    if ('res' in body) return body.res;
    const set: Partial<typeof circuits.$inferInsert> = {};
    if (body.data.name !== undefined) set.name = body.data.name;
    if (body.data.circuit !== undefined) {
      const checked = checkSupplied(body.data.circuit);
      if (!checked.ok) return fail(c, 422, checked.code, checked.message, checked.issues);
      set.circuit = checked.circuit;
      set.origin = null;
      set.findings = checked.findings;
      set.cableLengths = pruneCableLengths(existing.cableLengths, checked.circuit);
    }
    const now = Date.now();
    db.transaction((tx) => {
      tx.update(circuits).set({ ...set, updatedAt: now }).where(eq(circuits.id, circuitId)).run();
      touchProject(tx, id, now);
    });
    return c.json(result(id, circuitId));
  });

  routes.put('/projects/:id/circuits/:circuitId/cable-lengths', async (c) => {
    const id = c.req.param('id');
    const circuitId = c.req.param('circuitId');
    if (!ownedProject(id)) return fail(c, 404, 'NOT_FOUND', 'Project not found');
    const existing = db.select().from(circuits).where(and(eq(circuits.id, circuitId), eq(circuits.projectId, id))).get();
    if (!existing) return fail(c, 404, 'CIRCUIT_NOT_FOUND', 'Circuit not found');
    const body = await readBody(c, CableLengthsBody);
    if ('res' in body) return body.res;
    const known = new Set(existing.circuit.cables.map((k) => k.id));
    const unknown = Object.keys(body.data.lengths).filter((k) => !known.has(k));
    if (unknown.length > 0)
      return fail(c, 400, 'VALIDATION', `Not cables of this circuit: ${unknown.join(', ')}`, unknown.map((k) => ({ path: `lengths.${k}`, message: 'not a cable of this circuit' })));
    const lengths: Record<string, number> = {};
    for (const [cableId, feet] of Object.entries(body.data.lengths)) if (feet !== null) lengths[cableId] = feet;
    const now = Date.now();
    db.transaction((tx) => {
      tx.update(circuits).set({ cableLengths: { lengths, allowancePct: body.data.allowancePct }, updatedAt: now }).where(eq(circuits.id, circuitId)).run();
      touchProject(tx, id, now);
    });
    return c.json(result(id, circuitId));
  });

  routes.delete('/projects/:id/circuits/:circuitId', (c) => {
    const id = c.req.param('id');
    const circuitId = c.req.param('circuitId');
    if (!ownedProject(id)) return fail(c, 404, 'NOT_FOUND', 'Project not found');
    const found = db.transaction((tx) => {
      const gone = tx.delete(circuits).where(and(eq(circuits.id, circuitId), eq(circuits.projectId, id))).returning({ id: circuits.id }).get();
      if (!gone) return false;
      setOrder(tx, listCircuits(tx, id).map((r) => r.id));
      touchProject(tx, id);
      return true;
    });
    return found ? c.json(result(id, null)) : fail(c, 404, 'CIRCUIT_NOT_FOUND', 'Circuit not found');
  });

  return routes;
}
