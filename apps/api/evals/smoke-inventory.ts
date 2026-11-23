/**
 * Inventory smoke test (tasks 29/30). Runs three requests through the real chat loop on one provider:
 *   a) the basement description (expect inventory), b) a single circuit with a stated breaker size (expect circuit),
 *   c) a whole job missing a count (expect question).
 * Usage (from apps/api):  ./node_modules/.bin/tsx evals/smoke-inventory.ts anthropic [a,b,c]
 *                         ./node_modules/.bin/tsx evals/smoke-inventory.ts local http://<host>:<port> <model> [a,b,c]
 * Only the approved origin/paths are contacted; the key is read from the environment and never printed.
 */
import Anthropic from '@anthropic-ai/sdk';
import { runChat } from '../src/chat/loop';
import { createClaudeProvider, DEFAULT_CLAUDE_MODEL, type ClaudeClient } from '../src/llm/claude';
import { createLocalProvider } from '../src/llm/local';
import type { LlmProvider } from '../src/llm/types';

const CASES: Record<string, { expect: string; text: string }> = {
  a: {
    expect: 'inventory',
    text: 'Basement living space: 8 outlets, 8 recessed lights controlled by 2 switches on either side of the space. A bathroom with 3 outlets, 1 switch, 1 light and a fan. A closet with 1 light and 1 switch. A bedroom with 1 switch, 5 outlets and 2 recessed lights. Plan the circuits.',
  },
  b: { expect: 'circuit', text: 'Wire one 15 A circuit for a hallway: 3 recessed lights on a single switch, with power arriving at the switch box.' },
  c: { expect: 'question', text: 'Plan the circuits for my finished basement: a living area with some outlets and 6 recessed lights on one switch, and a bathroom with a light and an outlet.' },
};

const requests: string[] = [];
const guarded = (origin: string, paths: string[] | null): typeof fetch => async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.origin !== origin || (paths && !paths.includes(url.pathname))) throw new Error(`blocked request to ${url.origin}${url.pathname}`);
  requests.push(`${url.origin}${url.pathname}`);
  return fetch(input, init);
};

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  let provider: LlmProvider;
  let which = (args[1] ?? 'a,b,c').split(',');
  if (args[0] === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
    const client = new Anthropic({ apiKey, fetch: guarded('https://api.anthropic.com', null) }) as unknown as ClaudeClient;
    provider = createClaudeProvider({ apiKey, model: DEFAULT_CLAUDE_MODEL, client });
  } else if (args[0] === 'local') {
    const baseUrl = args[1]!.replace(/\/+$/, '');
    provider = createLocalProvider({ baseUrl, model: args[2]!, timeoutMs: 600_000, fetch: guarded(new URL(baseUrl).origin, ['/v1/chat/completions']) });
    which = (args[3] ?? 'a,b,c').split(',');
  } else throw new Error('usage: anthropic | local <baseUrl> <model>');

  const calls: { ms: number; malformed: boolean }[] = [];
  const recording: LlmProvider = {
    kind: provider.kind,
    model: provider.model,
    async complete(input) {
      const t0 = Date.now();
      const res = await provider.complete(input);
      const raw = res.ok ? JSON.stringify(res.reply) : '';
      calls.push({ ms: Date.now() - t0, malformed: Boolean(res.ok && res.invalidReply?.length) });
      if (res.ok && res.invalidReply?.length) console.log(`  flagged: ${res.invalidReply.join(' | ').slice(0, 400)}`);
      if (process.env.SMOKE_VERBOSE) console.log(`  raw reply: ${res.ok ? raw.slice(0, 1500) : res.error.code}`);
      return res;
    },
  };
  for (const id of which) {
    const c = CASES[id]!;
    calls.length = 0;
    const outcome = await runChat(recording, { messages: [{ role: 'user', content: c.text, kind: null, reply: null }], circuits: [], selectedCircuitId: null });
    const detail = outcome.kind === 'circuit' ? `${outcome.origin.kind} ${JSON.stringify(outcome.origin)}`.slice(0, 300) : outcome.kind === 'failed' ? outcome.code : outcome.text;
    console.log(`[${id}] expected ${c.expect}, got ${outcome.kind}${outcome.kind === c.expect ? ' (OK)' : ' (MISMATCH)'}; model calls ${calls.length}, malformed ${calls.filter((x) => x.malformed).length}, ms ${calls.map((x) => x.ms).join('/')}`);
    console.log(`${detail}\n`);
  }
  console.log(`HTTP requests: ${requests.length} (${[...new Set(requests)].join(', ')})`);
}

void main();
