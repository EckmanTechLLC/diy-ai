import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { CircuitModel, CircuitOrigin, CircuitPlanInfo, Finding, Inventory, Plan, PlanOptions } from '@diy-ai/core';

/** The plan stored with a chat message; `circuitIds` only on a `plan_built` message. */
export interface MessagePlan {
  plan: Plan;
  circuitIds?: string[];
}

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    /** The room inventory of the project's plan (ADR-009); null when there is no plan. The plan itself is always computed from it. */
    inventory: text('inventory', { mode: 'json' }).$type<Inventory>(),
    /** The plan options stated with the inventory; null when there is no plan. */
    planOptions: text('plan_options', { mode: 'json' }).$type<PlanOptions>(),
    /** When the plan was built into circuits; null while it has not been built. */
    planBuiltAt: integer('plan_built_at'),
  },
  (t) => [index('projects_owner_id_idx').on(t.ownerId)],
);

export type ProjectRow = typeof projects.$inferSelect;

/** Lengths the user entered for the cable runs of a circuit, in feet per cable id, and the allowance in percent added to the known total. */
export interface CableLengths {
  lengths: Record<string, number>;
  allowancePct: number;
}

/** The circuits of a project, ordered by `position` (contiguous from 0). */
export const circuits = sqliteTable(
  'circuits',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: integer('position').notNull(),
    circuit: text('circuit', { mode: 'json' }).$type<CircuitModel>().notNull(),
    origin: text('origin', { mode: 'json' }).$type<CircuitOrigin>(),
    /** Rule warnings for the stored circuit (errors never reach storage); null when none were recorded. */
    findings: text('findings', { mode: 'json' }).$type<Finding[]>(),
    /** What the plan said about this circuit (protection, rooms, reasons); null for circuits not built from a plan. */
    plan: text('plan', { mode: 'json' }).$type<CircuitPlanInfo>(),
    /** What the user entered for the circuit's cable runs (ADR-010); null until they enter something. */
    cableLengths: text('cable_lengths', { mode: 'json' }).$type<CableLengths>(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('circuits_project_id_position_idx').on(t.projectId, t.position)],
);

export type CircuitRow = typeof circuits.$inferSelect;

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['user', 'assistant'] }).notNull(),
    content: text('content').notNull(),
    kind: text('kind', { enum: ['question', 'circuit', 'unsupported', 'error', 'plan', 'plan_built'] }),
    /** The model's raw structured reply (assistant messages only); never returned by the API. */
    reply: text('reply', { mode: 'json' }).$type<unknown>(),
    /** Where the circuit of a `circuit` message came from; null for other messages and for rows stored before it was recorded. */
    origin: text('origin', { mode: 'json' }).$type<CircuitOrigin>(),
    /** The circuit a `circuit` message created or replaced; null for other messages, and after that circuit is deleted. */
    circuitId: text('circuit_id').references(() => circuits.id, { onDelete: 'set null' }),
    /** The failure code of an `error` message; null otherwise. */
    errorCode: text('error_code'),
    /** Rule findings: those that caused a rejected attempt (error messages) or the warnings accepted with a circuit; null otherwise. */
    findings: text('findings', { mode: 'json' }).$type<Finding[]>(),
    /** `plan` messages: `{ plan }`, the plan as shown in the message. `plan_built` messages: `{ plan, circuitIds }`, with the ids of the circuits created. Null otherwise. */
    plan: text('plan', { mode: 'json' }).$type<MessagePlan>(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('messages_project_id_created_at_idx').on(t.projectId, t.createdAt)],
);

/** Local OpenAI-style (llama.cpp) endpoints registered by the owner. */
export const llmEndpoints = sqliteTable(
  'llm_endpoints',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    label: text('label').notNull(),
    baseUrl: text('base_url').notNull(),
    model: text('model').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('llm_endpoints_owner_id_idx').on(t.ownerId)],
);

/** Per-owner key/value settings: the stored Claude API key and the active-model selection. */
export const settings = sqliteTable(
  'settings',
  {
    ownerId: text('owner_id').notNull(),
    key: text('key').notNull(),
    value: text('value').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.key] })],
);

export type LlmEndpointRow = typeof llmEndpoints.$inferSelect;
