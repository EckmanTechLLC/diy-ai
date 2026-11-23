import type { Context } from 'hono';
import { z } from 'zod';

export type ErrorStatus = 400 | 404 | 409 | 422 | 500 | 502;

export function fail(c: Context, status: ErrorStatus, code: string, message: string, issues?: unknown) {
  return c.json({ error: { code, message, ...(issues === undefined ? {} : { issues }) } }, status);
}

/** Parses the JSON body with a Zod schema; returns a ready error response on failure. */
export async function readBody<S extends z.ZodType>(c: Context, schema: S): Promise<{ data: z.infer<S> } | { res: Response }> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { res: fail(c, 400, 'INVALID_JSON', 'Request body must be valid JSON') };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return { res: fail(c, 400, 'VALIDATION', 'Invalid request body', issues) };
  }
  return { data: parsed.data };
}
