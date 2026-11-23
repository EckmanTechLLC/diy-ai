// Shared circuit storage helpers: public shapes, the validation gate every stored circuit passes, and ordered writes.
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { checkCircuit, planCircuits, validateCircuit, type CircuitModel, type CircuitOrigin, type CircuitPlanInfo, type Finding, type Plan } from '@diy-ai/core';
import type { Db } from './db';
import { circuits, projects, type CableLengths, type CircuitRow, type ProjectRow } from './schema';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export const MAX_NAME = 80;
/** Circuit names: trimmed, 1 to 80 characters. */
export const CircuitName = z.string().trim().min(1).max(MAX_NAME);

export const circuitToApi = (row: CircuitRow) => ({
  id: row.id,
  name: row.name,
  position: row.position,
  circuit: row.circuit,
  origin: row.origin,
  findings: row.findings ?? [],
  plan: row.plan ?? null,
  cableLengths: row.cableLengths ?? null,
  updatedAt: row.updatedAt,
});

/** The stored cable lengths without the entries for cables the circuit no longer has; null stays null. */
export function pruneCableLengths(stored: CableLengths | null, circuit: CircuitModel): CableLengths | null {
  if (!stored) return null;
  const ids = new Set(circuit.cables.map((c) => c.id));
  return { ...stored, lengths: Object.fromEntries(Object.entries(stored.lengths).filter(([id]) => ids.has(id))) };
}

type ProjectBase = Pick<ProjectRow, 'id' | 'name' | 'description' | 'createdAt' | 'updatedAt' | 'inventory' | 'planOptions' | 'planBuiltAt'>;

/** The plan of a project: always computed by `planCircuits` from the stored inventory, never stored. Null without an inventory. */
export function computePlan(row: Pick<ProjectRow, 'inventory' | 'planOptions'>): Plan | null {
  if (!row.inventory) return null;
  try {
    return planCircuits(row.inventory, row.planOptions ?? {});
  } catch {
    return null;
  }
}

export const projectToApi = (row: ProjectBase, circuitRows: CircuitRow[]) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  circuits: circuitRows.map(circuitToApi),
  inventory: row.inventory ?? null,
  planOptions: row.inventory ? (row.planOptions ?? {}) : null,
  plan: computePlan(row),
  planBuiltAt: row.planBuiltAt ?? null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const listCircuits = (db: DbOrTx, projectId: string): CircuitRow[] =>
  db.select().from(circuits).where(eq(circuits.projectId, projectId)).orderBy(circuits.position).all();

/** The project (owner-scoped) with its circuits in position order, or null. */
export function loadProject(db: DbOrTx, id: string, ownerId: string) {
  const row = db.select().from(projects).where(and(eq(projects.id, id), eq(projects.ownerId, ownerId))).get();
  return row ? projectToApi(row, listCircuits(db, id)) : null;
}

/** "Circuit N" for the next circuit: N is the new position + 1, moved up while the name is already taken. */
export function defaultName(existing: readonly Pick<CircuitRow, 'name'>[]): string {
  const taken = new Set(existing.map((c) => c.name));
  let n = existing.length + 1;
  while (taken.has(`Circuit ${n}`)) n++;
  return `Circuit ${n}`;
}

export type Checked = { ok: true; circuit: CircuitModel; findings: Finding[] } | { ok: false; code: 'INVALID_CIRCUIT' | 'RULES_FAILED'; message: string; issues: unknown };

/** The gate for a circuit supplied by a client: structural validation, then the rule checks. Warnings come back as findings; errors reject. */
export function checkSupplied(raw: unknown): Checked {
  const issues = validateCircuit(raw);
  if (issues.length > 0) return { ok: false, code: 'INVALID_CIRCUIT', message: 'Circuit model failed validation', issues };
  const findings = checkCircuit(raw as CircuitModel, { edition: 'nec-2023' });
  if (findings.some((f) => f.severity === 'error'))
    return { ok: false, code: 'RULES_FAILED', message: 'Circuit model failed the electrical rule checks', issues: findings };
  return { ok: true, circuit: raw as CircuitModel, findings };
}

/** Only writers of a circuit row: callers pass circuits that already went through validation and the rule checks. */
export function appendCircuit(
  db: DbOrTx,
  projectId: string,
  input: { name?: string; circuit: CircuitModel; origin: CircuitOrigin | null; findings: Finding[]; plan?: CircuitPlanInfo | null },
  now = Date.now(),
): CircuitRow {
  const existing = listCircuits(db, projectId);
  return db
    .insert(circuits)
    .values({
      id: randomUUID(),
      projectId,
      name: input.name ?? defaultName(existing),
      position: existing.length,
      circuit: input.circuit,
      origin: input.origin,
      findings: input.findings,
      plan: input.plan ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
}

export const touchProject = (db: DbOrTx, projectId: string, now = Date.now()) =>
  db.update(projects).set({ updatedAt: now }).where(eq(projects.id, projectId)).run();

/** Rewrites positions 0..n-1 in the given id order. */
export function setOrder(db: DbOrTx, orderedIds: readonly string[]) {
  orderedIds.forEach((id, position) => db.update(circuits).set({ position }).where(eq(circuits.id, id)).run());
}

/** Circuit count of each project row in a `projects` select. */
export const countSql = sql<number>`(select count(*) from circuits where circuits.project_id = projects.id)`;
