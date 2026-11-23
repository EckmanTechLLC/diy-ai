/**
 * Claude schema-acceptance probe (task 27). Sends one minimal real request per variant to Claude with that variant of
 * the reply JSON Schema as the structured-output format, and records accepted / rejected with the error text.
 * Usage (from apps/api):  ./node_modules/.bin/tsx evals/probe-schema.ts <variant>[,<variant>...]   ("list" prints the variants)
 * Only https://api.anthropic.com is contacted; the key is read from the environment and never printed.
 * Each variant sends exactly one request (SDK retries are off), so the request count equals the variant count.
 */
import Anthropic from '@anthropic-ai/sdk';
import { replyJsonSchema } from '@diy-ai/core';
import { schemaForProvider } from '../src/llm/types';

type Schema = Record<string, any>;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** Hoists every object sub-schema that occurs two or more times (identical JSON) into $defs and replaces the copies by $ref. */
export function hoistRepeats(schema: Schema): Schema {
  const out = clone(schema);
  const counts = new Map<string, number>();
  const key = (n: unknown) => JSON.stringify(n);
  const walk = (n: any, visit: (n: any) => void) => {
    if (Array.isArray(n)) n.forEach((x) => walk(x, visit));
    else if (n && typeof n === 'object') {
      visit(n);
      Object.values(n).forEach((x) => walk(x, visit));
    }
  };
  walk(out, (n) => {
    if (n.type === 'object' && n.properties) counts.set(key(n), (counts.get(key(n)) ?? 0) + 1);
  });
  const defs: Schema = {};
  let i = 0;
  const names = new Map<string, string>();
  for (const [k, c] of counts) if (c >= 2) names.set(k, `def${i++}`);
  const replace = (n: any): any => {
    if (Array.isArray(n)) return n.map(replace);
    if (n && typeof n === 'object') {
      const k = n.type === 'object' && n.properties ? key(n) : null;
      if (k && names.has(k)) {
        const name = names.get(k)!;
        if (!defs[name]) defs[name] = Object.fromEntries(Object.entries(n).map(([a, b]) => [a, replace(b)]));
        return { $ref: `#/$defs/${name}` };
      }
      return Object.fromEntries(Object.entries(n).map(([a, b]) => [a, replace(b)]));
    }
    return n;
  };
  const res = replace(out);
  if (Object.keys(defs).length) res.$defs = defs;
  return res;
}

function stripDescriptions(schema: Schema): Schema {
  const s = clone(schema);
  const walk = (n: any) => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === 'object') {
      delete n.description;
      Object.values(n).forEach(walk);
    }
  };
  walk(s);
  return s;
}

const base = (): Schema => schemaForProvider(replyJsonSchema());

function dropFromRequired(s: Schema, names: string[]) {
  for (const n of names) delete s.properties[n];
  s.required = s.required.filter((r: string) => !names.includes(r));
}

export const VARIANTS: Record<string, () => Schema> = {
  current: base,
  refs: () => hoistRepeats(base()),
  // Representational variants (c):
  'refs-nodesc': () => stripDescriptions(hoistRepeats(base())),
  'nodesc': () => stripDescriptions(base()),
  'refs-colorfree': () => {
    const s = hoistRepeats(base());
    for (const d of Object.values<any>(s.$defs ?? {})) if (d.properties?.color?.enum?.[0] === '') d.properties.color = { type: 'string', description: d.properties.color.description };
    return s;
  },
  'refs-intcounts': () => {
    const s = hoistRepeats(base());
    for (const p of Object.values<any>(s.properties.blocks.items.properties)) if (p.type === 'number') p.type = 'integer';
    return s;
  },
  // Informational only (lossy, never applied):
  'info-nolabels': () => {
    const s = base();
    const props = s.properties.blocks.items.properties;
    const labelNames = Object.keys(props).filter((k) => k.endsWith('Label') || k.toLowerCase().includes('label'));
    dropFromRequired(s.properties.blocks.items, labelNames);
    return s;
  },
  'info-nocustom': () => {
    const s = base();
    dropFromRequired(s, ['custom']);
    return s;
  },
  'info-nocustom-nolabels': () => {
    const s = VARIANTS['info-nolabels']!();
    dropFromRequired(s, ['custom']);
    return s;
  },
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
    const schema = make();
    const size = JSON.stringify(schema).length;
    try {
      const res = await client.beta.messages.create({
        model: 'claude-opus-5-5',
        max_tokens: 300,
        output_config: { format: { type: 'json_schema', schema } },
        system: 'Reply with kind "question", target "none", a one-sentence clarifying question about which room, and every other field at its unused value (0, "", empty list).',
        messages: [{ role: 'user', content: 'I need some lights wired.' }],
      });
      const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('');
      let parsed = false;
      try {
        JSON.parse(text);
        parsed = true;
      } catch {}
      console.log(`${name}: ACCEPTED (schema ${size} bytes, stop ${res.stop_reason}, json ${parsed}, in ${res.usage.input_tokens} out ${res.usage.output_tokens})`);
    } catch (err) {
      const e = err as { status?: number; message?: string };
      const msg = (e.message ?? String(err)).split(apiKey).join('[redacted]').slice(0, 400);
      console.log(`${name}: REJECTED (schema ${size} bytes, HTTP ${e.status ?? '?'}): ${msg}`);
    }
  }
}

if (process.argv[1]?.endsWith('probe-schema.ts')) void main();
