import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RULES, type CircuitModel, type Finding } from '@diy-ai/core';
import { FIXTURES } from '@diy-ai/core/fixtures';

// Lets one test force a rule error on a block-built circuit (which must never happen for real).
const forced: { findings: Finding[] | null } = vi.hoisted(() => ({ findings: null }));
vi.mock('@diy-ai/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@diy-ai/core')>();
  return { ...actual, checkCircuit: ((...args: Parameters<typeof actual.checkCircuit>) => forced.findings ?? actual.checkCircuit(...args)) as typeof actual.checkCircuit };
});

import { createApp } from '../src/app';
import { FAILURE_MESSAGES, rulesFailedText } from '../src/chat/errors';
import { MAX_CORRECTION_FINDINGS, MAX_RETRIES, formatFindingsForModel } from '../src/chat/loop';
import { openDb, type Db } from '../src/db';
import type { ActiveProviderResult, CompleteInput, CompleteResult, LlmProvider } from '../src/llm';
import { circuits, messages } from '../src/schema';

type Res = Omit<Response, 'json'> & { json(): Promise<any> };

const unused = { target: 'none', breakerAmps: 0, name: '', blocks: [] as unknown[], custom: [] as unknown[] };
const ok = (reply: unknown): CompleteResult => ({ ok: true, reply, model: 'fake' });
const entry = (type: string, over: Record<string, unknown> = {}) => ({
  type,
  count: 0,
  countA: 0,
  countB: 0,
  gfciFirst: false,
  receptacleLabel: '', gfciLabel: '', boxLabel: '', switchLabel: '', switchBoxLabel: '', lightLabel: '', lightBoxLabel: '', fanLabel: '', fanBoxLabel: '', gangBoxLabel: '',
  ...over,
});
const blocksReply = () => ({ ...unused, kind: 'circuit', target: 'new', message: 'Here is your circuit.', breakerAmps: 15, name: 'Hall', blocks: [entry('switch_lights', { count: 1 }), entry('switch_fan')] });
const badReply = { ...unused, kind: 'question', message: '' }; // structurally invalid
const wireEndpoint = (e: Record<string, unknown>) => ({ device: '', terminal: '', cable: '', color: '', box: '', splice: '', ...e });
const customReply = (m: CircuitModel, target = 'new') => ({
  ...unused,
  kind: 'custom',
  target,
  message: 'Custom wiring.',
  custom: [
    {
      ...m,
      devices: m.devices.map((d) => ({ ...d, amps: d.amps ?? 0 })),
      connections: m.connections.map((c) => ({ ...c, a: wireEndpoint(c.a), b: wireEndpoint(c.b) })),
    },
  ],
});

const clone = (m: CircuitModel): CircuitModel => JSON.parse(JSON.stringify(m));
const keyOf = (e: CircuitModel['connections'][number]['a']) => (e.kind === 'terminal' ? `t:${e.device}.${e.terminal}` : e.kind === 'conductor' ? `c:${e.cable}.${e.color}@${e.box}` : `s:${e.splice}`);
function recolour(m: CircuitModel, a: string, b: string, color: 'black' | 'white') {
  const w = m.connections.find((x) => [keyOf(x.a), keyOf(x.b)].sort().join('|') === [a, b].sort().join('|'));
  if (!w) throw new Error('no such connection');
  w.color = color;
}
/** c1 with a black wire on the neutral splice: a wire-colour-role error. */
const withError = () => {
  const m = clone(FIXTURES[0]!);
  recolour(m, 'c:load.white@swbox', 's:wn', 'black');
  return m;
};
/** c4 with a white pigtail as the switch hot: a wire-colour-role warning only. */
const withWarning = () => {
  const m = clone(FIXTURES[3]!);
  recolour(m, 's:hot', 't:swb.t1', 'white');
  return m;
};
const WIRE_TITLE = RULES.find((r) => r.id === 'wire-colour-role')!.title;

function scripted(...script: CompleteResult[]) {
  const calls: CompleteInput[] = [];
  const provider: LlmProvider = {
    kind: 'local',
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
  forced.findings = null;
  db = openDb(':memory:');
  active = { configured: false, reason: 'none' };
  app = createApp(db, { provider: () => active });
});
const use = (provider: LlmProvider) => {
  active = { configured: true, provider };
};
const call = async (method: string, path: string, body?: unknown): Promise<Res> =>
  app.request(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const createProject = async () => (await call('POST', '/api/projects', { name: 'Kitchen' })).json();
const fromExample = async (i = 0) => (await call('POST', '/api/projects/from-example', { exampleId: FIXTURES[i]!.id })).json();
const post = (id: string, content: string) => call('POST', `/api/projects/${id}/messages`, { content });
/** The project's first circuit and its stored warnings (these tests use one circuit per project). */
const circ = (p: any) => p.circuits[0]?.circuit ?? null;
const fnd = (p: any) => p.circuits[0]?.findings ?? [];
const getProject = async (id: string) => (await call('GET', `/api/projects/${id}`)).json();

const finding = (ruleId: string, involved: string[], message = `${ruleId} broke`): Finding => ({
  ruleId,
  severity: 'error',
  message,
  involved,
  citation: { edition: 'nec-2023', section: null, confirmed: false },
});

describe('formatFindingsForModel', () => {
  it('lists title, message and ids per finding', () => {
    const text = formatFindingsForModel([finding('wire-colour-role', ['w1', 'load'], 'Black on neutral')]);
    expect(text).toContain(`- ${WIRE_TITLE}: Black on neutral [w1, load]`);
    expect(text).toContain('complete corrected reply');
  });
  it('deduplicates by rule and involved ids regardless of order', () => {
    const text = formatFindingsForModel([finding('no-short', ['a', 'b']), finding('no-short', ['b', 'a']), finding('no-short', ['a', 'c'])]);
    expect(text.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(2);
  });
  it('caps a cascade and says how many were left out', () => {
    const many = Array.from({ length: MAX_CORRECTION_FINDINGS + 5 }, (_, i) => finding('no-short', [`d${i}`]));
    const lines = formatFindingsForModel(many).split('\n').filter((l) => l.startsWith('- '));
    expect(lines).toHaveLength(MAX_CORRECTION_FINDINGS + 1);
    expect(lines[lines.length - 1]).toBe('- ... and 5 more');
  });
});

describe('rulesFailedText', () => {
  it('names each failed rule once and says nothing was applied', () => {
    const text = rulesFailedText([finding('wire-colour-role', ['a']), finding('wire-colour-role', ['b']), finding('no-short', ['c'])]);
    expect(text.split(WIRE_TITLE)).toHaveLength(2);
    expect(text).toContain('was not applied');
    expect(text).toContain('project is unchanged');
  });
});

describe('chat: rule errors', () => {
  it('error then corrected: one retry, correction names the rule, circuit applied', async () => {
    const p = await createProject();
    const s = scripted(ok(customReply(withError())), ok(customReply(FIXTURES[0]!)));
    use(s.provider);
    const body = await (await post(p.id, 'wire it')).json();
    expect(s.calls).toHaveLength(2);
    const second = s.calls[1]!.messages;
    expect(second.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(second[2]!.content).toContain(WIRE_TITLE);
    expect(second[2]!.content).toContain('Your circuit was rejected by the electrical rule checks');
    expect(body.assistantMessage.kind).toBe('circuit');
    expect(body.assistantMessage.findings).toEqual([]);
    expect(circ(body.project)).toEqual(FIXTURES[0]);
    expect(fnd(body.project)).toEqual([]);
    expect(await db.select().from(messages).all()).toHaveLength(2);
  });

  it('errors on every attempt: rules_failed, nothing applied, findings on the message', async () => {
    const p = await fromExample(1);
    const s = scripted(...Array.from({ length: MAX_RETRIES + 1 }, () => ok(customReply(withError()))));
    use(s.provider);
    const body = await (await post(p.id, 'wire it')).json();
    expect(s.calls).toHaveLength(MAX_RETRIES + 1);
    expect(body.assistantMessage).toMatchObject({ kind: 'error', errorCode: 'rules_failed' });
    expect(body.assistantMessage.content).toContain(WIRE_TITLE);
    expect(body.assistantMessage.content).toContain('not applied');
    expect(body.assistantMessage.findings.length).toBeGreaterThan(0);
    expect(body.assistantMessage.findings.every((f: Finding) => f.severity === 'error')).toBe(true);
    expect(circ(body.project)).toEqual(FIXTURES[1]);
    expect(fnd(body.project)).toEqual(fnd(p));
    expect(body.affectedCircuitId).toBeNull();
    const row = db.select().from(circuits).get()!;
    expect(row.circuit).toEqual(FIXTURES[1]);
    expect(row.findings).toEqual(fnd(p));
    expect(db.select().from(circuits).all()).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain('"reply"');
    const list = await (await call('GET', `/api/projects/${p.id}/messages`)).json();
    expect(list[1].findings).toEqual(body.assistantMessage.findings);
    expect(list[0].findings).toBeNull();
  });

  it('warning only: applied, stored, returned by GET and on the message', async () => {
    const p = await createProject();
    use(scripted(ok(customReply(withWarning()))).provider);
    const body = await (await post(p.id, 'wire it')).json();
    expect(body.assistantMessage.kind).toBe('circuit');
    expect(fnd(body.project)).toHaveLength(1);
    expect(fnd(body.project)[0]).toMatchObject({ ruleId: 'wire-colour-role', severity: 'warning' });
    expect(body.assistantMessage.findings).toEqual(fnd(body.project));
    expect(fnd(await getProject(p.id))).toEqual(fnd(body.project));
    expect(db.select().from(circuits).get()!.findings).toEqual(fnd(body.project));
  });

  it('a later clean circuit replacing the selected one replaces the stored warnings', async () => {
    const p = await createProject();
    use(scripted(ok(customReply(withWarning())), ok(customReply(FIXTURES[3]!, 'selected'))).provider);
    const first = await (await post(p.id, 'a')).json();
    expect(fnd(first.project)).toHaveLength(1);
    const second = await (await call('POST', `/api/projects/${p.id}/messages`, { content: 'b', selectedCircuitId: first.affectedCircuitId })).json();
    expect(second.project.circuits).toHaveLength(1);
    expect(fnd(second.project)).toEqual([]);
  });

  it('structural, rule, then valid share one retry budget', async () => {
    const p = await createProject();
    const s = scripted(ok(badReply), ok(customReply(withError())), ok(customReply(FIXTURES[0]!)));
    use(s.provider);
    const body = await (await post(p.id, 'wire it')).json();
    expect(s.calls).toHaveLength(MAX_RETRIES + 1);
    expect(s.calls[2]!.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    expect(s.calls[2]!.messages[4]!.content).toContain(WIRE_TITLE);
    expect(body.assistantMessage.kind).toBe('circuit');
  });

  it('structural, rule, rule: budget exhausted with rules_failed (no fourth call)', async () => {
    const p = await createProject();
    const s = scripted(ok(badReply), ok(customReply(withError())), ok(customReply(withError())));
    use(s.provider);
    const body = await (await post(p.id, 'wire it')).json();
    expect(s.calls).toHaveLength(3);
    expect(body.assistantMessage.errorCode).toBe('rules_failed');
    expect(body.project.circuits).toEqual([]);
  });

  it('rule, structural, structural: ends as invalid_reply', async () => {
    const p = await createProject();
    use(scripted(ok(customReply(withError())), ok(badReply), ok(badReply)).provider);
    expect((await (await post(p.id, 'wire it')).json()).assistantMessage.errorCode).toBe('invalid_reply');
  });

  it('block circuit path carries no findings and a blocks origin', async () => {
    const p = await createProject();
    use(scripted(ok(blocksReply())).provider);
    const body = await (await post(p.id, 'one switch')).json();
    expect(body.assistantMessage).toMatchObject({ kind: 'circuit', findings: [] });
    expect(body.project.circuits[0].origin).toMatchObject({ kind: 'blocks', breakerAmps: 15 });
    expect(fnd(body.project)).toEqual([]);
  });

  it('rule error on a block circuit: block_rule_bug, no retry, ids-only log, nothing applied', async () => {
    const p = await createProject();
    const s = scripted(ok(blocksReply()));
    use(s.provider);
    forced.findings = [finding('no-short', ['x'])];
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const body = await (await post(p.id, 'my private wiring text')).json();
    const logged = log.mock.calls.map((a) => a.map(String).join(' ')).join('\n');
    log.mockRestore();
    expect(s.calls).toHaveLength(1);
    expect(body.assistantMessage).toMatchObject({ kind: 'error', errorCode: 'block_rule_bug', content: FAILURE_MESSAGES.block_rule_bug });
    expect(body.project.circuits).toEqual([]);
    expect(logged).toContain('switch_lights, switch_fan');
    expect(logged).not.toContain('private wiring');
    expect(logged.trim().split('\n')).toHaveLength(1);
  });
});

describe('circuit routes: rule checks', () => {
  const put = (pid: string, cid: string, circuit: unknown) => call('PUT', `/api/projects/${pid}/circuits/${cid}`, { circuit });

  it('POST with a rule error: 422 with findings, nothing stored', async () => {
    const p = await createProject();
    const res = await call('POST', `/api/projects/${p.id}/circuits`, { circuit: withError() });
    expect(res.status).toBe(422);
    const err = (await res.json()).error;
    expect(err.code).toBe('RULES_FAILED');
    expect(err.issues.some((f: Finding) => f.ruleId === 'wire-colour-role' && f.severity === 'error')).toBe(true);
    expect(db.select().from(circuits).all()).toHaveLength(0);
    expect((await getProject(p.id)).updatedAt).toBe(p.updatedAt);
  });

  it('PUT with a rule error: 422, the stored circuit and project timestamp are unchanged', async () => {
    const p = await fromExample(1);
    const res = await put(p.id, p.circuits[0].id, withError());
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('RULES_FAILED');
    const after = await getProject(p.id);
    expect(circ(after)).toEqual(FIXTURES[1]);
    expect(after.updatedAt).toBe(p.updatedAt);
  });

  it('a warning-only circuit is stored with its findings; a clean one with an empty list', async () => {
    const p = await createProject();
    const warned = await (await call('POST', `/api/projects/${p.id}/circuits`, { circuit: withWarning() })).json();
    expect(warned.project.circuits[0].findings).toHaveLength(1);
    expect(db.select().from(circuits).get()!.findings![0]).toMatchObject({ ruleId: 'wire-colour-role', severity: 'warning' });
    const clean = await (await call('POST', `/api/projects/${p.id}/circuits`, { circuit: FIXTURES[2] })).json();
    expect(clean.project.circuits[1].findings).toEqual([]);
  });

  it('from-example stores empty findings; new projects have no circuits; list has no circuit data', async () => {
    for (let i = 0; i < FIXTURES.length; i++) expect(fnd(await fromExample(i))).toEqual([]);
    expect((await createProject()).circuits).toEqual([]);
    const list = await (await call('GET', '/api/projects')).json();
    for (const row of list) expect(Object.keys(row).sort()).toEqual(['circuitCount', 'createdAt', 'description', 'id', 'name', 'updatedAt']);
  });
});

describe('GET /api/rules', () => {
  it('returns every registry entry, none confirmed', async () => {
    const res = await call('GET', '/api/rules');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(RULES.length);
    expect(body.map((r: any) => r.id)).toEqual(RULES.map((r) => r.id));
    for (const r of body) {
      expect(Object.keys(r).sort()).toEqual(['citation', 'id', 'severity', 'statement', 'title']);
      expect(r.citation.confirmed).toBe(false);
    }
  });
});
