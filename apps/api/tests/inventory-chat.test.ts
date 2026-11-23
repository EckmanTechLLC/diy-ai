import { beforeEach, describe, expect, it } from 'vitest';
import { PLAN_TEXT_CLOSING } from '@diy-ai/core';
import { createApp } from '../src/app';
import { FAILURE_MESSAGES } from '../src/chat/errors';
import { MAX_RETRIES } from '../src/chat/loop';
import { openDb, type Db } from '../src/db';
import type { ActiveProviderResult, CompleteInput, CompleteResult, LlmProvider } from '../src/llm';
import { circuits, messages } from '../src/schema';

const base = { target: 'none', breakerAmps: 0, name: '', blocks: [], custom: [], basement: false, rooms: [], maxReceptaclesPerCircuit: 0, lightingBreakerAmps: 0 };
const room = (over: Record<string, unknown> = {}) => ({ id: 'living', name: 'Living area', type: 'living_area', receptacles: 8, lightGroups: [{ lights: 8, switchLocations: 2 }], fans: 0, attachedTo: '', ...over });
const inventory = (rooms: unknown[] = [room()], over: Record<string, unknown> = {}) => ({ ...base, kind: 'inventory', message: 'Here is what I listed.', basement: true, rooms, ...over });
const question = (q: string) => ({ ...base, kind: 'question', message: q });
const ok = (reply: unknown, extra: Partial<Extract<CompleteResult, { ok: true }>> = {}): CompleteResult => ({ ok: true, reply, model: 'fake', ...extra });

function scripted(...script: CompleteResult[]) {
  const calls: CompleteInput[] = [];
  const provider: LlmProvider = {
    kind: 'anthropic',
    model: 'fake',
    async complete(input) {
      calls.push({ ...input, messages: input.messages.map((m) => ({ ...m })) });
      const next = script[calls.length - 1];
      if (!next) throw new Error('script exhausted');
      return next;
    },
  };
  return { provider, calls };
}

let db: Db;
let active: ActiveProviderResult;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDb(':memory:');
  active = { configured: false, reason: 'none' };
  app = createApp(db, { provider: () => active });
});
const use = (provider: LlmProvider) => (active = { configured: true, provider });
const call = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const createProject = async () => (await call('POST', '/api/projects', { name: 'Basement' })).json() as Promise<any>;
const post = (id: string, content: string) => call('POST', `/api/projects/${id}/messages`, { content });

describe('inventory outcome', () => {
  it('valid inventory: plan text stored as a plan message, no circuit created', async () => {
    const p = await createProject();
    const s = scripted(ok(inventory([room(), room({ id: 'bath', name: 'Bathroom', type: 'bathroom', receptacles: 3, lightGroups: [{ lights: 1, switchLocations: 1 }], fans: 1 })])));
    use(s.provider);
    const body: any = await (await post(p.id, 'finish my basement')).json();
    expect(s.calls).toHaveLength(1);
    expect(body.assistantMessage.kind).toBe('plan');
    expect(body.assistantMessage.content).toContain('Here is what I listed.');
    expect(body.assistantMessage.content).toContain('Bathroom');
    expect(body.assistantMessage.content).toContain('20 A breaker');
    expect(body.assistantMessage.content).toContain('GFCI');
    expect(body.assistantMessage.content.endsWith(PLAN_TEXT_CLOSING)).toBe(true);
    expect(body.project.circuits).toEqual([]);
    expect(body.affectedCircuitId).toBeNull();
    expect(db.select().from(circuits).all()).toHaveLength(0);
    expect(db.select().from(messages).all()).toHaveLength(2);
  });

  it('invalid inventory then corrected: issue sent back, one assistant message', async () => {
    const p = await createProject();
    const bad = inventory([room({ attachedTo: 'ghost' })]);
    const s = scripted(ok(bad), ok(inventory()));
    use(s.provider);
    const body: any = await (await post(p.id, 'plan it')).json();
    expect(s.calls).toHaveLength(2);
    expect(s.calls[1]!.messages.at(-1)!.content).toContain('BAD_INVENTORY');
    expect(s.calls[1]!.messages.at(-1)!.content).toContain('ghost');
    expect(body.assistantMessage.content).toContain('Planned');
    expect(db.select().from(circuits).all()).toHaveLength(0);
  });

  it('invalid after retries: error message, nothing created', async () => {
    const p = await createProject();
    const s = scripted(...Array.from({ length: MAX_RETRIES + 1 }, () => ok(inventory([]))));
    use(s.provider);
    const body: any = await (await post(p.id, 'plan it')).json();
    expect(s.calls).toHaveLength(MAX_RETRIES + 1);
    expect(body.assistantMessage).toMatchObject({ kind: 'error', content: FAILURE_MESSAGES.invalid_reply });
    expect(db.select().from(circuits).all()).toHaveLength(0);
  });
});

describe('provider-flagged invalid replies', () => {
  it('a flagged reply is never resolved: it is retried with the problems, then the corrected reply is used', async () => {
    const p = await createProject();
    // The flagged reply would resolve as a valid question if it were passed on; it must not be.
    const flagged = ok(question('Which room?'), { invalidReply: ['kind: not allowed here'] });
    const s = scripted(flagged, ok(question('Which room, exactly?')));
    use(s.provider);
    const body: any = await (await post(p.id, 'hi')).json();
    expect(s.calls).toHaveLength(2);
    expect(s.calls[1]!.messages.at(-1)!.content).toContain('kind: not allowed here');
    expect(body.assistantMessage.content).toBe('Which room, exactly?');
  });

  it('still flagged after retries: invalid_reply error', async () => {
    const p = await createProject();
    const s = scripted(...Array.from({ length: MAX_RETRIES + 1 }, () => ok('garbage', { invalidReply: ['did not call the tool'] })));
    use(s.provider);
    const body: any = await (await post(p.id, 'hi')).json();
    expect(s.calls).toHaveLength(MAX_RETRIES + 1);
    expect(body.assistantMessage).toMatchObject({ kind: 'error', content: FAILURE_MESSAGES.invalid_reply });
  });
});
