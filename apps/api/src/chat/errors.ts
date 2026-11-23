import { RULES, type Finding } from '@diy-ai/core';
import type { ProviderErrorCode } from '../llm';

export type ChatFailureCode = ProviderErrorCode | 'not_configured' | 'endpoint_missing' | 'invalid_reply' | 'rules_failed' | 'block_rule_bug' | 'plan_build_failed';

/** The one place provider and loop failures become text the user sees; each says what they can do. */
export const FAILURE_MESSAGES: Record<ChatFailureCode, string> = {
  no_key: 'Add a Claude API key or a local model in Settings, then send your message again.',
  not_configured: 'No model is selected. Add a Claude API key or a local model in Settings, then send your message again.',
  endpoint_missing: 'The selected local model no longer exists. Choose another model in Settings, then send your message again.',
  auth: 'The model provider rejected the credentials. Check the Claude API key in Settings, then send your message again.',
  rate_limit: 'The model provider is rate limiting requests. Wait a minute and send your message again.',
  timeout: 'The model took too long to answer. Send your message again, or pick a faster model in Settings.',
  unreachable: 'Could not reach the model. Check your network connection or that the local model server is running, then send your message again.',
  refused: 'The model declined to answer that request. Rephrase it and send it again.',
  truncated: 'The model ran out of room before finishing its answer. Ask for something smaller, or pick another model in Settings.',
  bad_json: 'The model returned an answer that could not be read. Send your message again, or pick another model in Settings.',
  server_error: 'The model provider had an error. Send your message again in a moment, or pick another model in Settings.',
  invalid_reply:
    'The model could not produce a valid circuit for that request after several attempts, so nothing was changed. Rephrase the request with more detail, or pick another model in Settings.',
  rules_failed:
    'The wiring was not applied because it failed the electrical checks, and your project is unchanged. Rephrase the request with more detail, or pick another model in Settings.',
  block_rule_bug:
    'The wiring blocks produced a circuit that fails our own electrical checks. This is a bug in the blocks, not in your request, and your project is unchanged.',
  plan_build_failed: 'The plan could not be built. This is a bug in the planner, not in your request, and your project is unchanged.',
};

const ruleTitle = (ruleId: string) => RULES.find((r) => r.id === ruleId)?.title ?? ruleId;

/** User-facing text for a `rules_failed` outcome: names each failed rule once, in plain language. */
export function rulesFailedText(findings: readonly Finding[]): string {
  const titles = [...new Set(findings.map((f) => ruleTitle(f.ruleId)))];
  return (
    `The wiring was not applied because it failed these electrical checks: ${titles.join('; ')}. ` +
    'Your project is unchanged. Rephrase the request with more detail, or pick another model in Settings.'
  );
}

/** User-facing text for a `plan_build_failed` outcome: names the circuit and the failed rules; nothing was stored. */
export function planBuildFailedText(circuitName: string, problem: string, findings: readonly Finding[]): string {
  const titles = [...new Set(findings.map((f) => ruleTitle(f.ruleId)))];
  return (
    `The plan was not built: circuit "${circuitName}" was rejected because ${problem}${titles.length ? `: ${titles.join('; ')}` : ''}. ` +
    'This is a bug in the planner, not in your request. No circuits were created and your project is unchanged.'
  );
}
