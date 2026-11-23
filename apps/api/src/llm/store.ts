import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db';
import { llmEndpoints, settings, type LlmEndpointRow } from '../schema';

const KEY_ANTHROPIC = 'anthropic_api_key';
const KEY_ACTIVE = 'llm_active';

export const ActiveSchema = z.discriminatedUnion('provider', [
  z.strictObject({ provider: z.literal('anthropic'), model: z.string() }),
  z.strictObject({ provider: z.literal('local'), endpointId: z.string() }),
]);
export type Active = z.infer<typeof ActiveSchema>;

const own = (ownerId: string, key: string) => and(eq(settings.ownerId, ownerId), eq(settings.key, key));

function getSetting(db: Db, ownerId: string, key: string): string | undefined {
  return db.select({ value: settings.value }).from(settings).where(own(ownerId, key)).get()?.value;
}

function putSetting(db: Db, ownerId: string, key: string, value: string) {
  db.insert(settings)
    .values({ ownerId, key, value, updatedAt: Date.now() })
    .onConflictDoUpdate({ target: [settings.ownerId, settings.key], set: { value, updatedAt: Date.now() } })
    .run();
}

const removeSetting = (db: Db, ownerId: string, key: string) => db.delete(settings).where(own(ownerId, key)).run();

export const getStoredKey = (db: Db, ownerId: string) => getSetting(db, ownerId, KEY_ANTHROPIC);
export const setStoredKey = (db: Db, ownerId: string, key: string) => putSetting(db, ownerId, KEY_ANTHROPIC, key);
export const clearStoredKey = (db: Db, ownerId: string) => removeSetting(db, ownerId, KEY_ANTHROPIC);

/** The key in effect: ANTHROPIC_API_KEY from the environment wins over the stored one. */
export function resolveKey(db: Db, ownerId: string, env: NodeJS.ProcessEnv): { key: string; source: 'env' | 'stored' } | null {
  const fromEnv = env.ANTHROPIC_API_KEY?.trim();
  if (fromEnv) return { key: fromEnv, source: 'env' };
  const stored = getStoredKey(db, ownerId);
  return stored ? { key: stored, source: 'stored' } : null;
}

export function getActive(db: Db, ownerId: string): Active | null {
  const raw = getSetting(db, ownerId, KEY_ACTIVE);
  if (raw === undefined) return null;
  try {
    const parsed = ActiveSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
export const setActive = (db: Db, ownerId: string, active: Active) => putSetting(db, ownerId, KEY_ACTIVE, JSON.stringify(active));
export const clearActive = (db: Db, ownerId: string) => removeSetting(db, ownerId, KEY_ACTIVE);

const ownEndpoint = (ownerId: string, id: string) => and(eq(llmEndpoints.id, id), eq(llmEndpoints.ownerId, ownerId));
export const listEndpoints = (db: Db, ownerId: string): LlmEndpointRow[] =>
  db.select().from(llmEndpoints).where(eq(llmEndpoints.ownerId, ownerId)).orderBy(llmEndpoints.createdAt).all();
export const findEndpoint = (db: Db, ownerId: string, id: string) => db.select().from(llmEndpoints).where(ownEndpoint(ownerId, id)).get();
export const deleteEndpoint = (db: Db, ownerId: string, id: string) =>
  db.delete(llmEndpoints).where(ownEndpoint(ownerId, id)).returning({ id: llmEndpoints.id }).get();
export const updateEndpointModel = (db: Db, ownerId: string, id: string, model: string) =>
  db.update(llmEndpoints).set({ model }).where(ownEndpoint(ownerId, id)).returning().get();
