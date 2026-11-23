import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from './db';
import { providerUnavailable, runChat, type ChatOutcome } from './chat/loop';
import { fail, readBody } from './http';
import type { ActiveProviderResult } from './llm';
import { getOwnerId } from './owner';
import { CircuitName, appendCircuit, listCircuits, loadProject, pruneCableLengths, touchProject } from './circuits';
import type { PlanState } from './chat/loop';
import { circuits, messages, projects } from './schema';

export type ProviderResolver = (db: Db, ownerId: string) => ActiveProviderResult;

const PostBody = z.object({ content: z.string().trim().min(1).max(4000), selectedCircuitId: z.string().optional() });

type MessageRow = typeof messages.$inferSelect;

/** Public shape of a message; the raw model reply is deliberately never included. */
const toApi = (m: MessageRow, existingCircuitIds: ReadonlySet<string> = new Set()) => ({
  id: m.id,
  role: m.role,
  content: m.content,
  kind: m.kind,
  origin: m.origin,
  circuitId: m.circuitId,
  errorCode: m.errorCode,
  findings: m.findings ?? null,
  /** `plan` and `plan_built` messages: the plan as shown in the message; null otherwise. */
  plan: m.plan?.plan ?? null,
  /** `plan_built` messages: the circuits it created that still exist; null otherwise. */
  createdCircuitIds: m.kind === 'plan_built' ? (m.plan?.circuitIds ?? []).filter((id) => existingCircuitIds.has(id)) : null,
  createdAt: m.createdAt,
});

export function chatRoutes(db: Db, resolveProvider: ProviderResolver) {
  const routes = new Hono();
  const inFlight = new Set<string>();

  const owned = (id: string, ownerId: string) => and(eq(projects.id, id), eq(projects.ownerId, ownerId));
  const find = (id: string, ownerId: string) => db.select().from(projects).where(owned(id, ownerId)).get();
  const list = (projectId: string) =>
    db.select().from(messages).where(eq(messages.projectId, projectId)).orderBy(messages.createdAt, sql`rowid`).all();

  const circuitIds = (projectId: string): ReadonlySet<string> => new Set(listCircuits(db, projectId).map((r) => r.id));

  routes.get('/projects/:id/messages', (c) => {
    const project = find(c.req.param('id'), getOwnerId());
    if (!project) return fail(c, 404, 'NOT_FOUND', 'Project not found');
    const ids = circuitIds(project.id);
    return c.json(list(project.id).map((m) => toApi(m, ids)));
  });

  // Discards the stored plan (inventory and options); circuits already built from it stay.
  routes.delete('/projects/:id/plan', (c) => {
    const ownerId = getOwnerId();
    const project = find(c.req.param('id'), ownerId);
    if (!project) return fail(c, 404, 'NOT_FOUND', 'Project not found');
    if (inFlight.has(project.id)) return fail(c, 409, 'BUSY', 'A reply is still being written for this project. Try again when it finishes.');
    db.update(projects).set({ inventory: null, planOptions: null, planBuiltAt: null, updatedAt: Date.now() }).where(eq(projects.id, project.id)).run();
    return c.json({ project: loadProject(db, project.id, ownerId), affectedCircuitId: null });
  });

  routes.delete('/projects/:id/messages', (c) => {
    const project = find(c.req.param('id'), getOwnerId());
    if (!project) return fail(c, 404, 'NOT_FOUND', 'Project not found');
    if (inFlight.has(project.id)) return fail(c, 409, 'BUSY', 'A reply is still being written for this project. Try again when it finishes.');
    db.delete(messages).where(eq(messages.projectId, project.id)).run();
    return c.body(null, 204);
  });

  routes.post('/projects/:id/messages', async (c) => {
    const ownerId = getOwnerId();
    const id = c.req.param('id');
    const body = await readBody(c, PostBody);
    if ('res' in body) return body.res;
    const project = find(id, ownerId);
    if (!project) return fail(c, 404, 'NOT_FOUND', 'Project not found');
    const selectedId = body.data.selectedCircuitId ?? null;
    if (selectedId !== null && !listCircuits(db, id).some((r) => r.id === selectedId))
      return fail(c, 400, 'VALIDATION', 'selectedCircuitId must be a circuit of this project', [{ path: 'selectedCircuitId', message: 'unknown circuit' }]);
    if (inFlight.has(id)) return fail(c, 409, 'BUSY', 'A reply is still being written for this project. Try again when it finishes.');
    inFlight.add(id);
    try {
      const now = Date.now();
      const userRow = db
        .insert(messages)
        .values({ id: randomUUID(), projectId: id, role: 'user', content: body.data.content, kind: null, createdAt: now })
        .returning()
        .get();

      const planState: PlanState | null = project.inventory ? { inventory: project.inventory, options: project.planOptions ?? {}, builtAt: project.planBuiltAt } : null;
      const active = resolveProvider(db, ownerId);
      const outcome: ChatOutcome = active.configured
        ? await runChat(active.provider, {
            messages: list(id).map((m) => ({ role: m.role, content: m.content, kind: m.kind, reply: m.reply })),
            circuits: listCircuits(db, id).map((r) => ({ id: r.id, name: r.name, circuit: r.circuit, origin: r.origin })),
            selectedCircuitId: selectedId,
            plan: planState,
          })
        : providerUnavailable(active);

      const { assistantRow, affectedCircuitId } = db.transaction((tx) => {
        const at = Date.now();
        // The only write of a chat-derived circuit: a resolveReply circuit that passed the rule checks (outcome kind 'circuit').
        let affectedCircuitId: string | null = null;
        let createdIds: string[] | null = null;
        if (outcome.kind === 'inventory') {
          tx.update(projects).set({ inventory: outcome.inventory, planOptions: outcome.options, planBuiltAt: null, updatedAt: at }).where(eq(projects.id, id)).run();
        } else if (outcome.kind === 'build') {
          // All circuits of the plan in one transaction: each passed validateCircuit and checkCircuit with no rule errors in runChat.
          createdIds = outcome.circuits.map((b) => appendCircuit(tx, id, { name: CircuitName.safeParse(b.name).data, circuit: b.circuit, origin: b.origin, findings: b.findings, plan: b.plan }, at).id);
          tx.update(projects).set({ planBuiltAt: at, updatedAt: at }).where(eq(projects.id, id)).run();
        } else if (outcome.kind === 'circuit') {
          const replyName = outcome.origin.kind === 'blocks' ? CircuitName.safeParse(outcome.origin.name) : null;
          const name = replyName?.success ? replyName.data : undefined;
          // Re-read inside the transaction: the selected circuit may have been deleted while the model was answering.
          const target =
            outcome.target === 'selected' && selectedId
              ? tx.select().from(circuits).where(and(eq(circuits.id, selectedId), eq(circuits.projectId, id))).get()
              : undefined;
          if (target) {
            tx.update(circuits)
              .set({ circuit: outcome.circuit, origin: outcome.origin, findings: outcome.findings, plan: null, cableLengths: pruneCableLengths(target.cableLengths, outcome.circuit), ...(name ? { name } : {}), updatedAt: at })
              .where(eq(circuits.id, target.id))
              .run();
            affectedCircuitId = target.id;
          } else {
            affectedCircuitId = appendCircuit(tx, id, { name, circuit: outcome.circuit, origin: outcome.origin, findings: outcome.findings }, at).id;
          }
          touchProject(tx, id, at);
        }
        const assistantRow = tx
          .insert(messages)
          .values({
            id: randomUUID(),
            projectId: id,
            role: 'assistant',
            content: outcome.text,
            // A build that had nothing to build is shown as a plain assistant message.
            kind: outcome.kind === 'failed' ? 'error' : outcome.kind === 'inventory' ? 'plan' : outcome.kind === 'build' ? 'plan_built' : outcome.kind === 'build_blocked' ? 'question' : outcome.kind,
            reply: outcome.kind === 'failed' ? null : outcome.reply,
            origin: outcome.kind === 'circuit' ? outcome.origin : null,
            circuitId: affectedCircuitId,
            plan: outcome.kind === 'inventory' ? { plan: outcome.plan } : outcome.kind === 'build' && createdIds ? { plan: outcome.plan, circuitIds: createdIds } : null,
            errorCode: outcome.kind === 'failed' ? outcome.code : null,
            findings: outcome.kind === 'circuit' ? outcome.findings : outcome.kind === 'failed' ? (outcome.findings ?? null) : null,
            createdAt: Math.max(at, userRow.createdAt),
          })
          .returning()
          .get();
        return { assistantRow, affectedCircuitId };
      });

      const existing = circuitIds(id);
      return c.json({ userMessage: toApi(userRow, existing), assistantMessage: toApi(assistantRow, existing), project: loadProject(db, id, ownerId), affectedCircuitId });
    } finally {
      inFlight.delete(id);
    }
  });

  return routes;
}
