/** Provider-neutral LLM interface shared by the Claude and local backends (ADR-006). */

export type ProviderErrorCode =
  | 'no_key'
  | 'auth'
  | 'rate_limit'
  | 'timeout'
  | 'unreachable'
  | 'refused'
  | 'truncated'
  | 'bad_json'
  | 'server_error';

export interface ProviderError {
  code: ProviderErrorCode;
  /** Safe to show to the user; never contains an API key. */
  message: string;
  retryable: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompleteInput {
  system: string;
  messages: ChatMessage[];
  /** JSON Schema of the reply (core's replyJsonSchema()). */
  schema: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

export type CompleteResult =
  | { ok: true; reply: unknown; usage?: Usage; model: string }
  | { ok: false; error: ProviderError };

export interface LlmProvider {
  kind: 'anthropic' | 'local';
  /** Model id this provider sends requests to. */
  model: string;
  /** Returns the model's parsed JSON reply (JSON only; not validated) or a typed failure. Never throws for expected failures. */
  complete(input: CompleteInput): Promise<CompleteResult>;
}

export const fault = (code: ProviderErrorCode, message: string, retryable: boolean): { ok: false; error: ProviderError } => ({
  ok: false,
  error: { code, message, retryable },
});

/** JSON Schema without the draft marker some servers reject; everything else is passed through unchanged. */
export function schemaForProvider(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = schema;
  return rest;
}
