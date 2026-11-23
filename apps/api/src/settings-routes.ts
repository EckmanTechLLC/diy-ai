import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from './db';
import { fail, readBody } from './http';
import { defaultLlmDeps, type LlmDeps } from './llm';
import { mapAnthropicError } from './llm/claude';
import {
  ActiveSchema,
  clearActive,
  clearStoredKey,
  deleteEndpoint,
  findEndpoint,
  getActive,
  getStoredKey,
  listEndpoints,
  resolveKey,
  setActive,
  setStoredKey,
  updateEndpointModel,
} from './llm/store';
import { getOwnerId } from './owner';
import { llmEndpoints, type LlmEndpointRow } from './schema';

const MODELS_TIMEOUT_MS = 5000;

const KeyBody = z.strictObject({ key: z.string().trim().min(1) });
const EndpointBody = z.strictObject({
  label: z.string().trim().min(1).max(120).optional(),
  baseUrl: z.string().trim().min(1),
  model: z.string().trim().min(1).optional(),
});

const toEndpoint = (r: LlmEndpointRow) => ({ id: r.id, label: r.label, baseUrl: r.baseUrl, model: r.model, createdAt: r.createdAt });

/** Validates an http(s) URL and returns it without query, fragment or trailing slashes; null if invalid. */
function normaliseBaseUrl(raw: string): { baseUrl: string; host: string } | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  return { baseUrl: `${url.origin}${url.pathname}`.replace(/\/+$/, ''), host: url.host };
}

type ModelsResult =
  | { ok: true; models: string[] }
  | { ok: false; code: 'ENDPOINT_UNREACHABLE' | 'ENDPOINT_BAD_RESPONSE'; message: string };

/** Asks an OpenAI-style server which models it serves. */
async function queryModels(fetchFn: LlmDeps['fetch'], baseUrl: string): Promise<ModelsResult> {
  let res: Response;
  try {
    res = await fetchFn(`${baseUrl}/v1/models`, { signal: AbortSignal.timeout(MODELS_TIMEOUT_MS) });
  } catch {
    return { ok: false, code: 'ENDPOINT_UNREACHABLE', message: `Could not reach ${baseUrl}/v1/models` };
  }
  if (!res.ok) return { ok: false, code: 'ENDPOINT_BAD_RESPONSE', message: `${baseUrl}/v1/models answered ${res.status}` };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, code: 'ENDPOINT_BAD_RESPONSE', message: `${baseUrl}/v1/models did not return JSON` };
  }
  const obj = (typeof body === 'object' && body !== null ? body : {}) as { data?: unknown; models?: unknown };
  const ids: string[] = [];
  if (Array.isArray(obj.data)) {
    for (const m of obj.data) if (typeof m?.id === 'string' && m.id) ids.push(m.id);
  } else if (Array.isArray(obj.models)) {
    // llama.cpp's own listing shape
    for (const m of obj.models) {
      const id = m?.model ?? m?.name;
      if (typeof id === 'string' && id) ids.push(id);
    }
  }
  if (ids.length === 0) return { ok: false, code: 'ENDPOINT_BAD_RESPONSE', message: `${baseUrl}/v1/models listed no models` };
  return { ok: true, models: [...new Set(ids)] };
}

export function settingsRoutes(db: Db, overrides: Partial<LlmDeps> = {}) {
  const deps: LlmDeps = { ...defaultLlmDeps(), ...overrides };
  const r = new Hono();

  const status = (ownerId: string) => {
    const key = resolveKey(db, ownerId, deps.env);
    return {
      anthropic: { keySet: key !== null, keySource: key?.source ?? null, last4: key ? key.key.slice(-4) : null },
      endpoints: listEndpoints(db, ownerId).map(toEndpoint),
      active: getActive(db, ownerId),
    };
  };

  r.get('/llm', (c) => c.json(status(getOwnerId())));

  r.put('/llm/anthropic-key', async (c) => {
    const body = await readBody(c, KeyBody);
    if ('res' in body) return body.res;
    const ownerId = getOwnerId();
    setStoredKey(db, ownerId, body.data.key);
    return c.json(status(ownerId));
  });

  r.delete('/llm/anthropic-key', (c) => {
    const ownerId = getOwnerId();
    if (getStoredKey(db, ownerId) === undefined && deps.env.ANTHROPIC_API_KEY?.trim()) {
      return fail(c, 409, 'KEY_FROM_ENV', 'The key comes from the ANTHROPIC_API_KEY environment variable and cannot be removed here');
    }
    clearStoredKey(db, ownerId);
    return c.json(status(ownerId));
  });

  r.get('/llm/anthropic-models', async (c) => {
    const key = resolveKey(db, getOwnerId(), deps.env);
    if (!key) return fail(c, 409, 'NO_KEY', 'No Claude API key is set');
    try {
      const models: { id: string; displayName: string }[] = [];
      for await (const m of deps.createClaudeClient(key.key).models.list()) models.push({ id: m.id, displayName: m.display_name });
      return c.json(models);
    } catch (err) {
      const e = mapAnthropicError(err, key.key);
      return fail(c, 502, e.code === 'auth' ? 'KEY_REJECTED' : e.code.toUpperCase(), e.message);
    }
  });

  r.post('/llm/endpoints', async (c) => {
    const body = await readBody(c, EndpointBody);
    if ('res' in body) return body.res;
    const url = normaliseBaseUrl(body.data.baseUrl);
    if (!url) return fail(c, 400, 'VALIDATION', 'baseUrl must be an http or https URL without credentials');
    const found = await queryModels(deps.fetch, url.baseUrl);
    if (!found.ok) return fail(c, 502, found.code, found.message);
    let model: string;
    if (body.data.model !== undefined) {
      if (!found.models.includes(body.data.model)) {
        return fail(c, 400, 'MODEL_NOT_SERVED', `Endpoint does not serve "${body.data.model}"`, { models: found.models });
      }
      model = body.data.model;
    } else if (found.models.length === 1) {
      model = found.models[0]!;
    } else {
      return fail(c, 400, 'MODEL_REQUIRED', 'Endpoint serves several models; name one in "model"', { models: found.models });
    }
    const row = db
      .insert(llmEndpoints)
      .values({ id: randomUUID(), ownerId: getOwnerId(), label: body.data.label ?? url.host, baseUrl: url.baseUrl, model, createdAt: Date.now() })
      .returning()
      .get();
    return c.json(toEndpoint(row), 201);
  });

  r.delete('/llm/endpoints/:id', (c) => {
    const ownerId = getOwnerId();
    const id = c.req.param('id');
    if (!deleteEndpoint(db, ownerId, id)) return fail(c, 404, 'NOT_FOUND', 'Endpoint not found');
    const active = getActive(db, ownerId);
    if (active?.provider === 'local' && active.endpointId === id) clearActive(db, ownerId);
    return c.body(null, 204);
  });

  r.post('/llm/endpoints/:id/refresh', async (c) => {
    const ownerId = getOwnerId();
    const row = findEndpoint(db, ownerId, c.req.param('id'));
    if (!row) return fail(c, 404, 'NOT_FOUND', 'Endpoint not found');
    const found = await queryModels(deps.fetch, row.baseUrl);
    if (!found.ok) return fail(c, 502, found.code, found.message);
    if (found.models.includes(row.model)) return c.json(toEndpoint(row));
    if (found.models.length === 1) return c.json(toEndpoint(updateEndpointModel(db, ownerId, row.id, found.models[0]!)!));
    return fail(c, 409, 'MODEL_CHANGED', `Endpoint no longer serves "${row.model}"; remove it and add it again naming a model`, {
      models: found.models,
    });
  });

  r.put('/llm/active', async (c) => {
    const body = await readBody(c, ActiveSchema);
    if ('res' in body) return body.res;
    const ownerId = getOwnerId();
    const active = body.data;
    if (active.provider === 'anthropic') {
      if (!active.model.trim()) return fail(c, 400, 'VALIDATION', 'model must not be empty');
      if (!resolveKey(db, ownerId, deps.env)) return fail(c, 409, 'NO_KEY', 'Set a Claude API key before selecting a Claude model');
      setActive(db, ownerId, { provider: 'anthropic', model: active.model.trim() });
    } else {
      if (!findEndpoint(db, ownerId, active.endpointId)) return fail(c, 404, 'ENDPOINT_NOT_FOUND', 'Endpoint not found');
      setActive(db, ownerId, active);
    }
    return c.json(status(ownerId));
  });

  return r;
}
