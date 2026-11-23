import { fault, schemaForProvider, type CompleteInput, type CompleteResult, type LlmProvider } from './types';

export const DEFAULT_LOCAL_TIMEOUT_MS = 300_000;

export type FetchFn = typeof fetch;

export function localTimeoutMs(env: NodeJS.ProcessEnv): number {
  const n = Number(env.LOCAL_LLM_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LOCAL_TIMEOUT_MS;
}

const isObject = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null;

/** Local llama.cpp-style server via its OpenAI-compatible /v1/chat/completions endpoint, using global fetch only. */
export function createLocalProvider(opts: {
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  fetch?: FetchFn;
}): LlmProvider {
  const { baseUrl, model } = opts;
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_LOCAL_TIMEOUT_MS;

  return {
    kind: 'local',
    model,
    async complete({ system, messages, schema, signal }: CompleteInput): Promise<CompleteResult> {
      const timeout = AbortSignal.timeout(timeoutMs);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      let res: Response;
      try {
        res = await doFetch(`${baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal: combined,
          body: JSON.stringify({
            model,
            messages: [{ role: 'system', content: system }, ...messages.map((m) => ({ role: m.role, content: m.content }))],
            temperature: 0,
            stream: false,
            response_format: { type: 'json_schema', json_schema: { name: 'reply', strict: true, schema: schemaForProvider(schema) } },
          }),
        });
      } catch (err) {
        if (isObject(err) && err.name === 'TimeoutError') return fault('timeout', 'Local model timed out', true);
        if (isObject(err) && err.name === 'AbortError') return fault('timeout', 'Request to local model was aborted', false);
        return fault('unreachable', 'Could not reach the local model endpoint', true);
      }

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) return fault('auth', 'The local endpoint rejected the request', false);
        if (res.status === 429) return fault('rate_limit', 'Local endpoint is busy', true);
        if (res.status >= 500) return fault('server_error', `Local endpoint error (${res.status})`, true);
        return fault('server_error', `Local endpoint rejected the request (${res.status})`, false);
      }

      let body: unknown;
      try {
        body = await res.json();
      } catch (err) {
        if (isObject(err) && err.name === 'TimeoutError') return fault('timeout', 'Local model timed out', true);
        return fault('bad_json', 'Local endpoint response was not valid JSON', true);
      }
      if (!isObject(body)) return fault('bad_json', 'Local endpoint response was not a JSON object', true);
      const choice = Array.isArray(body.choices) ? body.choices[0] : undefined;
      if (!isObject(choice)) return fault('bad_json', 'Local endpoint response had no choices', true);
      if (choice.finish_reason === 'length') return fault('truncated', 'Local model reply was cut off at the token limit', false);
      // Only the final message content; any separate reasoning field is ignored.
      const content = isObject(choice.message) ? choice.message.content : undefined;
      if (typeof content !== 'string') return fault('bad_json', 'Local model reply had no content', true);
      let reply: unknown;
      try {
        reply = JSON.parse(content);
      } catch {
        return fault('bad_json', 'Local model reply was not valid JSON', true);
      }
      const usage = isObject(body.usage) ? body.usage : undefined;
      return {
        ok: true,
        reply,
        model: typeof body.model === 'string' ? body.model : model,
        ...(usage && typeof usage.prompt_tokens === 'number' && typeof usage.completion_tokens === 'number'
          ? { usage: { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens } }
          : {}),
      };
    },
  };
}
