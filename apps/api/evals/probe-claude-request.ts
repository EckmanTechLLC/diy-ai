/**
 * Claude request-shape probe (task 30). Sends one real request per variant: the reply schema as a NON-strict tool
 * (or described in the system prompt) instead of an enforced structured-output format.
 * Usage (from apps/api):  ./node_modules/.bin/tsx evals/probe-claude-request.ts <variant>[,<variant>...]   ("list" prints variants)
 * Only https://api.anthropic.com is contacted; the key is read from the environment and never printed. One request per variant, no SDK retries.
 */
import Anthropic from '@anthropic-ai/sdk';
import { ReplySchema, buildSystemPrompt, replyJsonSchema, resolveReply } from '@diy-ai/core';
import { schemaForProvider } from '../src/llm/types';

const BASEMENT =
  'Basement living space: 8 outlets, 8 recessed lights controlled by 2 switches on either side of the space. A bathroom with 3 outlets, 1 switch, 1 light and a fan. A closet with 1 light and 1 switch. A bedroom with 1 switch, 5 outlets and 2 recessed lights. Plan the circuits.';

const schema = () => schemaForProvider(replyJsonSchema());
const tool = (strict?: boolean): any => ({ name: 'reply', description: 'Send your reply to the user in this fixed format.', input_schema: schema(), ...(strict === undefined ? {} : { strict }) });
const common = (): any => ({
  model: 'claude-opus-5-5',
  max_tokens: 16000,
  betas: ['server-side-fallback-2026-07-01'],
  fallbacks: 'default',
  system: [{ type: 'text', text: buildSystemPrompt(), cache_control: { type: 'ephemeral' } }],
  messages: [{ role: 'user', content: BASEMENT }],
});

export const VARIANTS: Record<string, () => any> = {
  'tool-forced-thinking': () => ({ ...common(), thinking: { type: 'adaptive' }, output_config: { effort: 'high' }, tools: [tool()], tool_choice: { type: 'tool', name: 'reply' } }),
  'tool-forced-nothinking': () => ({ ...common(), output_config: { effort: 'high' }, tools: [tool()], tool_choice: { type: 'tool', name: 'reply' } }),
  'tool-any-thinking': () => ({ ...common(), thinking: { type: 'adaptive' }, output_config: { effort: 'high' }, tools: [tool()], tool_choice: { type: 'any' } }),
  'tool-auto-thinking': () => ({ ...common(), thinking: { type: 'adaptive' }, output_config: { effort: 'high' }, tools: [tool()], tool_choice: { type: 'auto' } }),
};

async function main() {
  const arg = process.argv.slice(2).filter((a) => a !== '--')[0];
  if (!arg || arg === 'list') return console.log(Object.keys(VARIANTS).join('\n'));
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  const guarded: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.origin !== 'https://api.anthropic.com') throw new Error(`blocked request to ${url.origin}`);
    return fetch(input, init);
  };
  const client = new Anthropic({ apiKey, fetch: guarded, maxRetries: 0 });
  for (const name of arg.split(',')) {
    const make = VARIANTS[name];
    if (!make) {
      console.log(`${name}: unknown variant`);
      continue;
    }
    const t0 = Date.now();
    try {
      const res: any = await client.beta.messages.create(make());
      const types = res.content.map((b: any) => b.type).join(',');
      const use = res.content.find((b: any) => b.type === 'tool_use');
      const parsed = use ? ReplySchema.safeParse(use.input) : null;
      const resolved = use ? resolveReply(use.input).kind : 'n/a';
      console.log(`${name}: ACCEPTED ${Date.now() - t0} ms stop ${res.stop_reason} blocks [${types}] schemaOk ${parsed?.success ?? 'n/a'} resolves ${resolved} in ${res.usage.input_tokens} out ${res.usage.output_tokens}`);
      if (parsed && !parsed.success) console.log(`  issues: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join(' | ')}`);
    } catch (err) {
      const e = err as { status?: number; message?: string };
      console.log(`${name}: REJECTED HTTP ${e.status ?? '?'}: ${(e.message ?? String(err)).split(apiKey).join('[redacted]').slice(0, 400)}`);
    }
  }
}

if (process.argv[1]?.endsWith('probe-claude-request.ts')) void main();
