import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { BLOCK_FIXTURES, RULES, checkCircuit, type CircuitModel } from '@diy-ai/core';
import { FIXTURES } from '@diy-ai/core/fixtures';
import type { Db } from './db';
import { MAX_NAME, appendCircuit, countSql, listCircuits, loadProject, projectToApi } from './circuits';
import { circuitRoutes } from './circuit-routes';
import { fail, readBody } from './http';
import { chatRoutes, type ProviderResolver } from './chat-routes';
import { getActiveProvider, type LlmDeps } from './llm';
import { settingsRoutes } from './settings-routes';
import { getOwnerId } from './owner';
import { projects } from './schema';

export interface AppOptions {
  webOrigin?: string;
  /** Overridable network and environment access for the LLM settings routes (tests stub these). */
  llm?: Partial<LlmDeps>;
  /** Picks the model provider for chat; tests inject a fake. Defaults to the provider active in settings. */
  provider?: ProviderResolver;
}

const NameSchema = z.string().trim().min(1).max(120);
const DescriptionSchema = z.string().max(5000);

const CreateBody = z.object({ name: NameSchema, description: DescriptionSchema.optional() });
const PatchBody = z
  .object({ name: NameSchema.optional(), description: DescriptionSchema.optional() })
  .refine((b) => b.name !== undefined || b.description !== undefined, { message: 'Provide name or description' });
/** Fixed fixtures plus the realistic-size block-built circuits (clearly titled). */
const EXAMPLES: { id: string; title: string; circuit: CircuitModel }[] = [
  ...FIXTURES.map((f) => ({ id: f.id, title: f.title, circuit: f })),
  ...BLOCK_FIXTURES.map((f) => ({ id: f.circuit.id, title: `Large example: ${f.circuit.title}`, circuit: f.circuit })),
];

const FromExampleBody = z.object({ exampleId: z.string() });

/** Safe log line: name/code and a short, key-redacted message only; never the error object, request or conversation. */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return 'Unhandled non-Error thrown';
  const code = (err as { code?: unknown }).code;
  const label = typeof code === 'string' ? `${err.name} (${code})` : err.name;
  // SyntaxError messages quote the text being parsed, which could be conversation text.
  if (err instanceof SyntaxError) return label;
  return `${label}: ${err.message.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 200)}`;
}

export function createApp(db: Db, options: AppOptions = {}) {
  const app = new Hono();
  const api = new Hono();

  if (options.webOrigin) app.use('/api/*', cors({ origin: options.webOrigin }));

  const owned = (id: string, ownerId: string) => and(eq(projects.id, id), eq(projects.ownerId, ownerId));
  const notFound = (c: Context) => fail(c, 404, 'NOT_FOUND', 'Project not found');

  const insertProject = (ownerId: string, name: string, description: string, circuit: { name: string; circuit: CircuitModel } | null) =>
    db.transaction((tx) => {
      const now = Date.now();
      const row = tx.insert(projects).values({ id: randomUUID(), ownerId, name, description, createdAt: now, updatedAt: now }).returning().get();
      const rows = circuit
        ? [
            appendCircuit(
              tx,
              row.id,
              {
                name: circuit.name.trim().slice(0, MAX_NAME),
                circuit: circuit.circuit,
                origin: null,
                findings: checkCircuit(circuit.circuit, { edition: 'nec-2023' }).filter((f) => f.severity === 'warning'),
              },
              now,
            ),
          ]
        : [];
      return projectToApi(row, rows);
    });

  api.get('/health', (c) => c.json({ ok: true }));

  api.get('/rules', (c) => c.json(RULES));

  api.get('/examples', (c) => c.json(EXAMPLES.map((e) => ({ id: e.id, title: e.title }))));

  api.get('/projects', (c) => {
    const rows = db
      .select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        circuitCount: countSql,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .where(eq(projects.ownerId, getOwnerId()))
      .orderBy(desc(projects.updatedAt))
      .all();
    return c.json(rows);
  });

  api.post('/projects', async (c) => {
    const body = await readBody(c, CreateBody);
    if ('res' in body) return body.res;
    return c.json(insertProject(getOwnerId(), body.data.name, body.data.description ?? '', null), 201);
  });

  api.post('/projects/from-example', async (c) => {
    const body = await readBody(c, FromExampleBody);
    if ('res' in body) return body.res;
    const example = EXAMPLES.find((e) => e.id === body.data.exampleId);
    if (!example) return fail(c, 404, 'EXAMPLE_NOT_FOUND', `Unknown example "${body.data.exampleId}"`);
    return c.json(insertProject(getOwnerId(), example.title, '', { name: example.title, circuit: example.circuit }), 201);
  });

  api.get('/projects/:id', (c) => {
    const project = loadProject(db, c.req.param('id'), getOwnerId());
    return project ? c.json(project) : notFound(c);
  });

  api.patch('/projects/:id', async (c) => {
    const ownerId = getOwnerId();
    const id = c.req.param('id');
    const body = await readBody(c, PatchBody);
    if ('res' in body) return body.res;
    const row = db
      .update(projects)
      .set({ ...body.data, updatedAt: Date.now() })
      .where(owned(id, ownerId))
      .returning()
      .get();
    return row ? c.json(projectToApi(row, listCircuits(db, id))) : notFound(c);
  });

  api.delete('/projects/:id', (c) => {
    const row = db.delete(projects).where(owned(c.req.param('id'), getOwnerId())).returning({ id: projects.id }).get();
    return row ? c.body(null, 204) : notFound(c);
  });

  api.route('/', circuitRoutes(db));
  api.route('/settings', settingsRoutes(db, options.llm));
  api.route('/', chatRoutes(db, options.provider ?? ((d, ownerId) => getActiveProvider(d, ownerId, options.llm))));

  app.route('/api', api);
  app.notFound((c) => fail(c, 404, 'NOT_FOUND', 'Route not found'));
  app.onError((err, c) => {
    console.error(describeError(err));
    return fail(c, 500, 'INTERNAL', 'Internal server error');
  });
  return app;
}
