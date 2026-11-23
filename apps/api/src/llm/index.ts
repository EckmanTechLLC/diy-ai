import type { Db } from '../db';
import { createClaudeProvider, defaultClaudeClientFactory, type ClaudeClientFactory } from './claude';
import { createLocalProvider, localTimeoutMs, type FetchFn } from './local';
import { findEndpoint, getActive, resolveKey } from './store';
import type { LlmProvider } from './types';

export * from './types';
export { DEFAULT_CLAUDE_MODEL } from './claude';

/** Everything that touches the environment or network, injectable so tests never go online. */
export interface LlmDeps {
  env: NodeJS.ProcessEnv;
  fetch: FetchFn;
  createClaudeClient: ClaudeClientFactory;
}

export const defaultLlmDeps = (): LlmDeps => ({
  env: process.env,
  fetch: (input, init) => fetch(input, init),
  createClaudeClient: defaultClaudeClientFactory,
});

export type ActiveProviderResult =
  | { configured: true; provider: LlmProvider }
  | { configured: false; reason: 'none' | 'no_key' | 'endpoint_missing' };

/** Builds the backend selected in settings, or says why none can be built. */
export function getActiveProvider(db: Db, ownerId: string, overrides: Partial<LlmDeps> = {}): ActiveProviderResult {
  const deps = { ...defaultLlmDeps(), ...overrides };
  const active = getActive(db, ownerId);
  if (!active) return { configured: false, reason: 'none' };
  if (active.provider === 'anthropic') {
    const key = resolveKey(db, ownerId, deps.env);
    if (!key) return { configured: false, reason: 'no_key' };
    return {
      configured: true,
      provider: createClaudeProvider({ apiKey: key.key, model: active.model, client: deps.createClaudeClient(key.key) }),
    };
  }
  const endpoint = findEndpoint(db, ownerId, active.endpointId);
  if (!endpoint) return { configured: false, reason: 'endpoint_missing' };
  return {
    configured: true,
    provider: createLocalProvider({
      baseUrl: endpoint.baseUrl,
      model: endpoint.model,
      timeoutMs: localTimeoutMs(deps.env),
      fetch: deps.fetch,
    }),
  };
}
