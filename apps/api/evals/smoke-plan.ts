/**
 * Plan smoke test (task 31). One project in an in-memory database, three real turns through the chat API:
 *   1) the basement description (expect a plan), 2) the closet belongs to the bedroom (expect a revised inventory with
 *   the closet attached and a changed plan), 3) "Looks good, build it." (expect circuits created).
 * Usage (from apps/api):  ./node_modules/.bin/tsx evals/smoke-plan.ts anthropic
 *                         ./node_modules/.bin/tsx evals/smoke-plan.ts local http://<host>:<port> <model>
 * Only the approved origin/paths are contacted; the key is read from the environment and never printed.
 */
import Anthropic from '@anthropic-ai/sdk';
import { createApp } from '../src/app';
import { openDb } from '../src/db';
import { createClaudeProvider, DEFAULT_CLAUDE_MODEL, type ClaudeClient } from '../src/llm/claude';
import { createLocalProvider } from '../src/llm/local';
import type { LlmProvider } from '../src/llm/types';

const STEPS = [
  {
    expect: 'plan',
    text: 'Basement living space: 8 outlets, 8 recessed lights controlled by 2 switches on either side of the space. A bathroom with 3 outlets, 1 switch, 1 light and a fan. A closet with 1 light and 1 switch. A bedroom with 1 switch, 5 outlets and 2 recessed lights. Plan the circuits.',
  },
  { expect: 'plan', text: 'The closet belongs to the bedroom — put its light on the bedroom circuit.' },
  { expect: 'build_proposed', text: 'Looks good, build it.' },
];

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
  if (args[0] === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
    const client = new Anthropic({ apiKey, fetch: guarded('https://api.anthropic.com', null) }) as unknown as ClaudeClient;
    provider = createClaudeProvider({ apiKey, model: DEFAULT_CLAUDE_MODEL, client });
  } else if (args[0] === 'local') {
    const baseUrl = args[1]!.replace(/\/+$/, '');
    provider = createLocalProvider({ baseUrl, model: args[2]!, timeoutMs: 600_000, fetch: guarded(new URL(baseUrl).origin, ['/v1/chat/completions']) });
  } else throw new Error('usage: anthropic | local <baseUrl> <model>');

  let calls = 0;
  const counting: LlmProvider = {
    kind: provider.kind,
    model: provider.model,
    async complete(input) {
      calls++;
      return provider.complete(input);
    },
  };
  const db = openDb(':memory:');
  const app = createApp(db, { provider: () => ({ configured: true, provider: counting }) });
  const send = (method: string, path: string, body?: unknown) =>
    app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const project: any = await (await send('POST', '/api/projects', { name: 'Smoke' })).json();

  for (const [i, step] of STEPS.entries()) {
    calls = 0;
    const t0 = Date.now();
    const res: any = await (await send('POST', `/api/projects/${project.id}/messages`, { content: step.text })).json();
    const m = res.assistantMessage;
    const p = res.project;
    const got = m.kind === 'error' ? `error ${m.errorCode}` : m.kind;
    console.log(`[${i + 1}] expected ${step.expect}, got ${got}${m.kind === step.expect ? ' (OK)' : ' (MISMATCH)'}; model calls ${calls}, ms ${Date.now() - t0}`);
    console.log(`    circuits ${p.circuits.length}, planned ${p.plan ? p.plan.circuits.length : 'none'}, built ${p.planBuiltAt !== null}`);
    if (p.inventory) {
      const closet = p.inventory.rooms.find((r: any) => /closet/i.test(r.name));
      console.log(`    rooms ${p.inventory.rooms.map((r: any) => r.id).join(',')}; closet attachedTo ${JSON.stringify(closet?.attachedTo ?? null)}`);
    }
    if (p.plan) console.log(`    plan: ${p.plan.circuits.map((c: any) => `${c.name} ${c.breakerAmps}A [${c.rooms.map((r: any) => r.name).join('+')}]`).join(' | ')}`);
    if (m.kind !== step.expect) console.log(`    message: ${String(m.content).slice(0, 400)}`);
    if (m.kind === 'build_proposed') console.log(`    proposal shows ${m.plan.circuits.length} circuits; circuits created ${p.circuits.length}`);
  }
  console.log(`HTTP requests: ${requests.length} (${[...new Set(requests)].join(', ')})`);
}

void main();
