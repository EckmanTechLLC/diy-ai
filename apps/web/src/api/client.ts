import type { CircuitModel, CircuitOrigin, CircuitPlanInfo, Finding, Inventory, Plan, PlanOptions } from '@diy-ai/core';

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  circuitCount: number;
  createdAt: number;
  updatedAt: number;
}

/** What the user entered for the cable runs of a circuit: feet per cable id, and the allowance in percent added to the known totals. */
export interface CableLengths {
  lengths: Record<string, number>;
  allowancePct: number;
}

/** One circuit of a project. Circuits come in the project's order (`position`). */
export interface ProjectCircuit {
  id: string;
  name: string;
  position: number;
  circuit: CircuitModel;
  /** How the circuit came about; null for examples and manual edits. */
  origin: CircuitOrigin | null;
  /** Rule findings the server stored with the circuit (warnings only, since a circuit with errors is never stored). Not the display source: the page re-checks. */
  findings: Finding[];
  /** What the plan required of a circuit built from a plan and the diagram cannot show (AFCI, GFCI); null for other circuits. */
  plan: CircuitPlanInfo | null;
  /** Lengths and allowance the user entered for the cable runs; null until they enter something. */
  cableLengths: CableLengths | null;
  updatedAt: number;
}

export interface Project extends Omit<ProjectSummary, 'circuitCount'> {
  circuits: ProjectCircuit[];
  /** The stored room inventory; null when the project has no plan. */
  inventory: Inventory | null;
  planOptions: PlanOptions | null;
  /** The plan the planner makes from the inventory and options; null without an inventory. Never stored, always computed. */
  plan: Plan | null;
  /** When the plan was built into circuits (epoch ms); null while it is not built. */
  planBuiltAt: number | null;
}

/** Result of a circuit write: the whole project afterwards, and the circuit the write created or changed (null for delete and reorder). */
export interface ProjectChange {
  project: Project;
  affectedCircuitId: string | null;
}

export interface Example {
  id: string;
  title: string;
}

export interface ApiIssue {
  path?: string;
  message: string;
  [key: string]: unknown;
}

/** Error from the API (`code` from the error body) or from the transport (`NETWORK`, `BAD_RESPONSE`, `HTTP_<status>`). */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly issues?: ApiIssue[],
    /** Models a local server serves, sent with MODEL_REQUIRED, MODEL_NOT_SERVED and MODEL_CHANGED. */
    readonly models?: string[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('NETWORK', 'Could not reach the server. Check that the API is running.', 0);
  }

  const text = await res.text().catch(() => '');
  let json: unknown;
  let isJson = false;
  if (text) {
    try {
      json = JSON.parse(text);
      isJson = true;
    } catch {
      // handled below
    }
  }

  if (!res.ok) {
    const err = (json as { error?: { code?: unknown; message?: unknown; issues?: unknown } } | undefined)?.error;
    if (isJson && err && typeof err.code === 'string' && typeof err.message === 'string') {
      const listed = (err.issues as { models?: unknown } | null | undefined)?.models;
      throw new ApiError(
        err.code,
        err.message,
        res.status,
        Array.isArray(err.issues) ? (err.issues as ApiIssue[]) : undefined,
        Array.isArray(listed) ? listed.filter((m): m is string => typeof m === 'string') : undefined,
      );
    }
    throw new ApiError(`HTTP_${res.status}`, `The server returned an unexpected response (${res.status}).`, res.status);
  }

  if (res.status === 204) return undefined as T;
  if (!isJson) throw new ApiError('BAD_RESPONSE', 'The server returned a response that is not valid JSON.', res.status);
  return json as T;
}

export interface ProjectInput {
  name: string;
  description?: string;
}

export type ActiveModel = { provider: 'anthropic'; model: string } | { provider: 'local'; endpointId: string };

export interface LocalEndpoint {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  createdAt: number;
}

export interface LlmStatus {
  anthropic: { keySet: boolean; keySource: 'env' | 'stored' | null; last4: string | null };
  endpoints: LocalEndpoint[];
  active: ActiveModel | null;
}

export interface ClaudeModel {
  id: string;
  displayName: string;
}

export interface EndpointInput {
  baseUrl: string;
  label?: string;
  model?: string;
}

export type MessageKind = 'question' | 'circuit' | 'unsupported' | 'error' | 'plan' | 'plan_built';

/** Why an assistant message is an error; mirrors the API's failure codes. */
export type MessageErrorCode =
  | 'no_key'
  | 'not_configured'
  | 'endpoint_missing'
  | 'auth'
  | 'rate_limit'
  | 'timeout'
  | 'unreachable'
  | 'refused'
  | 'truncated'
  | 'bad_json'
  | 'server_error'
  | 'invalid_reply'
  | 'rules_failed'
  | 'block_rule_bug'
  | 'plan_build_failed'
  /** Legacy: stored by earlier versions. */
  | 'template_rule_bug';

/** Error codes the user fixes in Settings (credentials, model selection, reachability). */
export const SETTINGS_ERROR_CODES: readonly MessageErrorCode[] = ['no_key', 'not_configured', 'endpoint_missing', 'auth', 'unreachable'];

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  kind: MessageKind | null;
  /** Where the circuit of a `circuit` message came from; null when none or not recorded (older messages). */
  origin: CircuitOrigin | null;
  /** Failure code of an `error` message; null otherwise. */
  errorCode: MessageErrorCode | null;
  /** Warnings of a `circuit` message, or the failed checks of a `rules_failed` error; null for other messages. */
  findings: Finding[] | null;
  /** The circuit a `circuit` message created or replaced; null when none, or when that circuit was deleted later. */
  circuitId: string | null;
  /** The plan shown by a `plan` message, or the plan that was built by a `plan_built` message; null for other messages and for older ones. */
  plan: Plan | null;
  /** The circuits a `plan_built` message created that still exist, in plan order; null for other messages. */
  createdCircuitIds: string[] | null;
  createdAt: number;
}

export interface SendMessageResult {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  project: Project;
  /** The circuit the reply added or replaced; null when the reply changed no circuit. */
  affectedCircuitId: string | null;
}

const enc = encodeURIComponent;

export const api = {
  health: () => request<{ ok: boolean }>('GET', '/health'),
  listExamples: () => request<Example[]>('GET', '/examples'),
  listProjects: () => request<ProjectSummary[]>('GET', '/projects'),
  getProject: (id: string) => request<Project>('GET', `/projects/${encodeURIComponent(id)}`),
  createProject: (input: ProjectInput) => request<Project>('POST', '/projects', input),
  createFromExample: (exampleId: string) => request<Project>('POST', '/projects/from-example', { exampleId }),
  updateProject: (id: string, patch: Partial<ProjectInput>) =>
    request<Project>('PATCH', `/projects/${encodeURIComponent(id)}`, patch),
  deleteProject: (id: string) => request<void>('DELETE', `/projects/${encodeURIComponent(id)}`),
  createCircuit: (projectId: string, input: { name?: string; circuit: CircuitModel }) =>
    request<ProjectChange>('POST', `/projects/${enc(projectId)}/circuits`, input),
  /** Rename and/or replace the wiring; at least one of `name` and `circuit` is required by the server. */
  updateCircuit: (projectId: string, circuitId: string, patch: { name?: string; circuit?: CircuitModel }) =>
    request<ProjectChange>('PUT', `/projects/${enc(projectId)}/circuits/${enc(circuitId)}`, patch),
  /** Replaces the circuit's lengths and allowance: a cable left out of `lengths` has no length. */
  saveCableLengths: (projectId: string, circuitId: string, body: CableLengths) =>
    request<ProjectChange>('PUT', `/projects/${enc(projectId)}/circuits/${enc(circuitId)}/cable-lengths`, body),
  deleteCircuit: (projectId: string, circuitId: string) =>
    request<ProjectChange>('DELETE', `/projects/${enc(projectId)}/circuits/${enc(circuitId)}`),
  /** `ids` must list every circuit of the project exactly once, in the new order. */
  reorderCircuits: (projectId: string, ids: string[]) =>
    request<ProjectChange>('PUT', `/projects/${enc(projectId)}/circuits/order`, { ids }),
  getLlmStatus: () => request<LlmStatus>('GET', '/settings/llm'),
  setAnthropicKey: (key: string) => request<LlmStatus>('PUT', '/settings/llm/anthropic-key', { key }),
  removeAnthropicKey: () => request<LlmStatus>('DELETE', '/settings/llm/anthropic-key'),
  listClaudeModels: () => request<ClaudeModel[]>('GET', '/settings/llm/anthropic-models'),
  addEndpoint: (input: EndpointInput) => request<LocalEndpoint>('POST', '/settings/llm/endpoints', input),
  deleteEndpoint: (id: string) => request<void>('DELETE', `/settings/llm/endpoints/${enc(id)}`),
  refreshEndpoint: (id: string) => request<LocalEndpoint>('POST', `/settings/llm/endpoints/${enc(id)}/refresh`),
  setActive: (active: ActiveModel) => request<LlmStatus>('PUT', '/settings/llm/active', active),
  listMessages: (projectId: string) => request<ChatMessage[]>('GET', `/projects/${enc(projectId)}/messages`),
  sendMessage: (projectId: string, content: string, selectedCircuitId?: string) =>
    request<SendMessageResult>('POST', `/projects/${enc(projectId)}/messages`, selectedCircuitId ? { content, selectedCircuitId } : { content }),
  /** Forgets the stored plan (inventory and options). Circuits already built from it stay. */
  discardPlan: (projectId: string) => request<ProjectChange>('DELETE', `/projects/${enc(projectId)}/plan`),
  clearMessages: (projectId: string) => request<void>('DELETE', `/projects/${enc(projectId)}/messages`),
};
