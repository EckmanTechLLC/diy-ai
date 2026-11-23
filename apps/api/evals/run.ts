/**
 * Eval runner. Usage (from the repo root):
 *   pnpm --filter @diy-ai/api eval -- --provider local --base-url http://host:port [--model id] [--only id,id] [--timeout-ms n]
 *   pnpm --filter @diy-ai/api eval -- --provider anthropic [--model id] [--only id,id]
 * Runs cases strictly one request at a time through the real chat loop; no database.
 */
import Anthropic from '@anthropic-ai/sdk';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChat, type ChatOutcome, type StoredMessage } from '../src/chat/loop';
import { createClaudeProvider, DEFAULT_CLAUDE_MODEL, type ClaudeClient } from '../src/llm/claude';
import { createLocalProvider } from '../src/llm/local';
import type { CompleteInput, CompleteResult, LlmProvider } from '../src/llm/types';
import { CASES, type EvalCase } from './cases';
import { describe, gradeOutcome } from './grader';
import { seedContext } from './seed';

export interface CallRecord {
  ms: number;
  /** The provider's parsed reply, or null on a provider error. */
  reply: unknown;
  errorCode: string | null;
  errorMessage: string | null;
  /** The provider flagged this reply as unreadable or off-schema (hosted Claude only); it was retried, not resolved. */
  malformed?: string[];
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheCreationTokens?: number };
}

export interface StepResult {
  user: string;
  pass: boolean;
  outcomeKind: string;
  outcomeDetail: string;
  /** Where a circuit outcome goes (new / selected); null for other outcomes. */
  target: string | null;
  /** The block list (type, counts, gfciFirst) of a blocks circuit; null otherwise. */
  blocks: Record<string, unknown>[] | null;
  /** Device-type counts of a custom circuit; null otherwise. */
  customSummary: Record<string, number> | null;
  /** Rule warnings on an accepted circuit; null for other outcomes. */
  warnings: unknown[] | null;
  /** Error code of the first provider error among the calls; null when none. */
  providerError: string | null;
  failureCode: string | null;
  /** Rule findings behind a rules_failed outcome; null otherwise. */
  findings: unknown[] | null;
  pattern: string | null;
  reason: string;
  calls: CallRecord[];
  wallMs: number;
  assistantText: string;
}

export interface CaseResult {
  id: string;
  category: string;
  pass: boolean;
  steps: StepResult[];
  calls: number;
  wallMs: number;
}

const args = process.argv.slice(2).filter((a) => a !== '--');
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const die = (msg: string): never => {
  console.error(msg);
  process.exit(2);
};

const providerKind = flag('provider');
const timeoutMs = Number(flag('timeout-ms') ?? 300_000);
const only = flag('only')?.split(',');

/** Counts every outgoing request and refuses anything outside the approved origin and paths. */
const requestLog: { method: string; url: string; status: number | string }[] = [];
function guardedFetch(allowedOrigin: string, allowedPaths: string[] | null): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.origin !== allowedOrigin || (allowedPaths && !allowedPaths.includes(url.pathname))) throw new Error(`blocked request to ${url.origin}${url.pathname}`);
    const res = await fetch(input, init);
    requestLog.push({ method: init?.method ?? 'GET', url: `${url.origin}${url.pathname}`, status: res.status });
    return res;
  };
}

async function buildProvider(): Promise<{ provider: LlmProvider; label: string }> {
  if (providerKind === 'local') {
    const baseUrl = (flag('base-url') ?? die('--base-url required')).replace(/\/+$/, '');
    const origin = new URL(baseUrl).origin;
    const f = guardedFetch(origin, ['/v1/models', '/v1/chat/completions']);
    let model = flag('model');
    if (!model) {
      const res = await f(`${baseUrl}/v1/models`, { signal: AbortSignal.timeout(10_000) });
      const body: any = await res.json();
      const ids: string[] = (body.data ?? body.models ?? []).map((m: any) => m.id ?? m.model ?? m.name).filter(Boolean);
      if (ids.length !== 1) die(`expected exactly one served model, got: ${ids.join(', ')}; pass --model`);
      model = ids[0]!;
    }
    return { provider: createLocalProvider({ baseUrl, model: model!, timeoutMs, fetch: f }), label: model! };
  }
  if (providerKind === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) die('ANTHROPIC_API_KEY is not set');
    const model = flag('model') ?? DEFAULT_CLAUDE_MODEL;
    const client = new Anthropic({ apiKey, fetch: guardedFetch('https://api.anthropic.com', null) }) as unknown as ClaudeClient;
    return { provider: createClaudeProvider({ apiKey: apiKey!, model, client }), label: model };
  }
  return die('--provider must be local or anthropic');
}

/** Wraps a provider to time each call, apply the per-call timeout and keep the raw reply. */
function recording(inner: LlmProvider): { provider: LlmProvider; take(): CallRecord[] } {
  let calls: CallRecord[] = [];
  return {
    provider: {
      kind: inner.kind,
      model: inner.model,
      async complete(input: CompleteInput): Promise<CompleteResult> {
        const t0 = Date.now();
        const timeout = AbortSignal.timeout(timeoutMs);
        const res = await inner.complete({ ...input, signal: input.signal ? AbortSignal.any([input.signal, timeout]) : timeout });
        calls.push({
          ms: Date.now() - t0,
          reply: res.ok ? res.reply : null,
          errorCode: res.ok ? null : res.error.code,
          errorMessage: res.ok ? null : res.error.message,
          ...(res.ok && res.invalidReply?.length ? { malformed: res.invalidReply } : {}),
          ...(res.ok && res.usage ? { usage: res.usage } : {}),
        });
        return res;
      },
    },
    take() {
      const c = calls;
      calls = [];
      return c;
    },
  };
}

async function runCase(c: EvalCase, rec: ReturnType<typeof recording>): Promise<CaseResult> {
  const stored: StoredMessage[] = [];
  // Seeded cases start with the seed's circuits and selection (single step); other cases carry the one circuit built so far, always selected.
  const seeded = c.seed ? seedContext(c.seed) : null;
  let circuits: Parameters<typeof runChat>[1]['circuits'] = seeded?.circuits ?? [];
  const steps: StepResult[] = [];
  const t0 = Date.now();
  for (const step of c.steps) {
    stored.push({ role: 'user', content: step.user, kind: null, reply: null });
    const s0 = Date.now();
    let outcome: ChatOutcome;
    try {
      outcome = await runChat(rec.provider, { messages: stored, circuits, selectedCircuitId: seeded ? seeded.selectedCircuitId : (circuits[0]?.id ?? null) });
    } catch (err) {
      outcome = { kind: 'failed', code: 'server_error', text: `exception: ${(err as Error).message}` };
    }
    const wallMs = Date.now() - s0;
    const grade = gradeOutcome(step.expect, outcome);
    const calls = rec.take();
    const circuitOutcome = outcome.kind === 'circuit' ? outcome : null;
    const counts: Record<string, number> = {};
    if (circuitOutcome?.origin.kind === 'custom') for (const d of circuitOutcome.circuit.devices) counts[d.type] = (counts[d.type] ?? 0) + 1;
    steps.push({
      user: step.user,
      pass: grade.pass,
      outcomeKind: outcome.kind,
      outcomeDetail: describe(outcome),
      target: circuitOutcome?.target ?? null,
      blocks: circuitOutcome?.origin.kind === 'blocks' ? circuitOutcome.origin.blocks.map((b) => {
        const { type, ...rest } = b as Record<string, unknown>;
        const keep: Record<string, unknown> = { type };
        for (const k of ['count', 'countA', 'countB', 'gfciFirst']) if (k in rest) keep[k] = rest[k];
        return keep;
      }) : null,
      customSummary: circuitOutcome?.origin.kind === 'custom' ? counts : null,
      warnings: circuitOutcome ? circuitOutcome.findings : null,
      providerError: calls.find((x) => x.errorCode)?.errorCode ?? null,
      failureCode: outcome.kind === 'failed' ? outcome.code : null,
      findings: outcome.kind === 'failed' ? (outcome.findings ?? null) : null,
      pattern: grade.pattern,
      reason: grade.reason,
      calls,
      wallMs,
      assistantText: outcome.text,
    });
    if (!grade.pass) break;
    if (outcome.kind === 'failed') break;
    stored.push({ role: 'assistant', content: outcome.text, kind: outcome.kind === 'inventory' ? 'question' : outcome.kind, reply: outcome.reply });
    if (!seeded) circuits = outcome.kind === 'circuit' ? [{ id: 'eval', name: 'Circuit 1', circuit: outcome.circuit, origin: outcome.origin }] : [];
  }
  const calls = steps.reduce((n, s) => n + s.calls.length, 0);
  return { id: c.id, category: c.category, pass: steps.length === c.steps.length && steps.every((s) => s.pass), steps, calls, wallMs: Date.now() - t0 };
}

const pct = (n: number, d: number) => (d === 0 ? 'n/a' : `${n}/${d} (${Math.round((100 * n) / d)}%)`);

function markdown(label: string, started: string, results: CaseResult[], total: number): string {
  const cats = [...new Set(results.map((r) => r.category))];
  const lat = results.flatMap((r) => r.steps.flatMap((s) => s.calls.map((c) => c.ms)));
  const lines = [
    `# Eval run: ${label}`,
    '',
    `Started ${started}. Provider ${providerKind}. Cases run: ${results.length} of ${total}. Per-call timeout ${timeoutMs} ms.`,
    '',
    `Overall: ${pct(results.filter((r) => r.pass).length, results.length)}`,
    '',
    ...cats.map((c) => `- ${c}: ${pct(results.filter((r) => r.category === c && r.pass).length, results.filter((r) => r.category === c).length)}`),
    '',
    `Model calls: ${lat.length}; avg ${lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : 0} ms, max ${lat.length ? Math.max(...lat) : 0} ms.`,
    `HTTP requests sent: ${requestLog.length} (${[...new Set(requestLog.map((r) => r.url))].join(', ')}).`,
    '',
    '| case | category | result | outcome | calls | wall ms | detail |',
    '|---|---|---|---|---|---|---|',
    ...results.map((r) => {
      const last = r.steps[r.steps.length - 1]!;
      return `| ${r.id} | ${r.category} | ${r.pass ? 'PASS' : 'FAIL'} | ${last.outcomeDetail}${last.target ? ` (target ${last.target})` : ''} | ${r.calls} | ${r.wallMs} | ${last.pass ? '' : `${last.pattern}: ${last.reason}`.replace(/\|/g, '/')} |`;
    }),
    '',
  ];
  return lines.join('\n');
}

async function main() {
  const { provider, label } = await buildProvider();
  const rec = recording(provider);
  const selected = only ? CASES.filter((c) => only.includes(c.id)) : CASES;
  if (selected.length === 0) die('no cases selected');
  const started = new Date().toISOString();
  const results: CaseResult[] = [];
  for (const c of selected) {
    const r = await runCase(c, rec);
    results.push(r);
    console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.id} (${r.calls} call(s), ${r.wallMs} ms)${r.pass ? '' : ` ${r.steps[r.steps.length - 1]!.reason}`}`);
  }
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'results');
  mkdirSync(dir, { recursive: true });
  const base = `${label.replace(/[^A-Za-z0-9._-]+/g, '-')}-${started.replace(/[:.]/g, '-')}${only ? '-partial' : ''}`;
  const json = { model: label, provider: providerKind, started, finished: new Date().toISOString(), timeoutMs, partial: Boolean(only), requests: requestLog, results };
  writeFileSync(join(dir, `${base}.json`), JSON.stringify(json, null, 2));
  writeFileSync(join(dir, `${base}.md`), markdown(label, started, results, CASES.length));
  console.log(`wrote results/${base}.json and .md; ${requestLog.length} HTTP request(s)`);
}

void main();
