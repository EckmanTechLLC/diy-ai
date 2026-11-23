import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessage, MessageCreateParamsNonStreaming as BetaCreateParams } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { ModelInfo } from '@anthropic-ai/sdk/resources/models';
import { fault, schemaForProvider, type CompleteInput, type CompleteResult, type LlmProvider, type ProviderError } from './types';

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';
const MAX_TOKENS = 16000;

/** The slice of the Anthropic client this app uses; tests stub it. */
export interface ClaudeClient {
  beta: {
    messages: {
      create(params: BetaCreateParams, options?: { signal?: AbortSignal }): Promise<BetaMessage>;
    };
  };
  models: {
    list(): AsyncIterable<ModelInfo>;
  };
}

export type ClaudeClientFactory = (apiKey: string) => ClaudeClient;

export const defaultClaudeClientFactory: ClaudeClientFactory = (apiKey) => new Anthropic({ apiKey });

const redact = (text: string, secret: string) => (secret ? text.split(secret).join('[redacted]') : text);

/** Maps SDK typed errors to provider errors, most specific class first. Unknown (non-SDK) errors are rethrown. */
export function mapAnthropicError(err: unknown, apiKey: string): ProviderError {
  const detail = (e: InstanceType<typeof Anthropic.APIError>) => redact(e.message, apiKey).slice(0, 300);
  if (err instanceof Anthropic.APIUserAbortError) return { code: 'timeout', message: 'Request to Claude was aborted', retryable: false };
  if (err instanceof Anthropic.APIConnectionTimeoutError) return { code: 'timeout', message: 'Request to Claude timed out', retryable: true };
  if (err instanceof Anthropic.APIConnectionError) return { code: 'unreachable', message: 'Could not reach the Claude API', retryable: true };
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return { code: 'auth', message: 'The Claude API key was rejected', retryable: false };
  }
  if (err instanceof Anthropic.RateLimitError) return { code: 'rate_limit', message: 'Claude rate limit reached', retryable: true };
  if (err instanceof Anthropic.RequestTimeoutError) return { code: 'timeout', message: 'Claude timed out the request', retryable: true };
  if (err instanceof Anthropic.OverloadedError) return { code: 'server_error', message: 'Claude is overloaded', retryable: true };
  if (err instanceof Anthropic.InternalServerError) {
    return { code: 'server_error', message: `Claude server error (${err.status})`, retryable: true };
  }
  if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.NotFoundError) {
    return { code: 'server_error', message: `Claude rejected the request (${err.status}): ${detail(err)}`, retryable: false };
  }
  if (err instanceof Anthropic.APIError) {
    return { code: 'server_error', message: `Claude API error (${err.status ?? 'unknown'}): ${detail(err)}`, retryable: false };
  }
  throw err;
}

export function createClaudeProvider(opts: { apiKey: string; model: string; client?: ClaudeClient }): LlmProvider {
  const { apiKey, model } = opts;
  const client = opts.client ?? defaultClaudeClientFactory(apiKey);

  return {
    kind: 'anthropic',
    model,
    async complete({ system, messages, schema, signal }: CompleteInput): Promise<CompleteResult> {
      let response: BetaMessage;
      try {
        response = await client.beta.messages.create(
          {
            model,
            max_tokens: MAX_TOKENS,
            // Server-side refusal fallback; verified to combine with output_config.format on claude-opus-5-5 (task 14).
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            thinking: { type: 'adaptive' },
            output_config: { effort: 'high', format: { type: 'json_schema', schema: schemaForProvider(schema) } },
            system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
            messages: messages.map((m) => ({ role: m.role, content: m.content })),
          },
          signal ? { signal } : undefined,
        );
      } catch (err) {
        return { ok: false, error: mapAnthropicError(err, apiKey) };
      }

      // Check stop_reason before reading content.
      if (response.stop_reason === 'refusal') return fault('refused', 'Claude declined to answer this request', false);
      if (response.stop_reason === 'max_tokens') return fault('truncated', 'Claude reply was cut off at the token limit', false);

      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      let reply: unknown;
      try {
        reply = JSON.parse(text);
      } catch {
        return fault('bad_json', 'Claude reply was not valid JSON', true);
      }
      const u = response.usage;
      return {
        ok: true,
        reply,
        model: response.model,
        usage: {
          inputTokens: u.input_tokens,
          outputTokens: u.output_tokens,
          ...(u.cache_read_input_tokens != null ? { cacheReadTokens: u.cache_read_input_tokens } : {}),
          ...(u.cache_creation_input_tokens != null ? { cacheCreationTokens: u.cache_creation_input_tokens } : {}),
        },
      };
    },
  };
}
