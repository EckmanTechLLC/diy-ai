// A plan circuit that cannot be built or fails the checks leaves the database unchanged (all or nothing).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mode = vi.hoisted(() => ({ breakIndex: -1, how: 'amps' as 'amps' | 'rule' }));
vi.mock('@diy-ai/core', async (importOriginal) => {
  const core = await importOriginal<typeof import('@diy-ai/core')>();
  return {
    ...core,
    planCircuits: (...args: Parameters<typeof core.planCircuits>) => {
      const plan = core.planCircuits(...args);
      if (mode.breakIndex < 0) return plan;
      // Corrupt one circuit of the plan: an impossible breaker size cannot be built.
      return { ...plan, circuits: plan.circuits.map((c, i) => (i === mode.breakIndex ? { ...c, breakerAmps: 25 as never } : c)) };
    },
  };
});

import { createApp } from '../src/app';
import { FAILURE_MESSAGES } from '../src/chat/errors';
import { openDb } from '../src/db';
import type { CompleteResult, LlmProvider } from '../src/llm';
import { circuits, messages, projects } from '../src/schema';

const base = { target: 'none', breakerAmps: 0, name: '', blocks: [] as unknown[], custom: [] as unknown[], basement: false, rooms: [] as unknown[], maxReceptaclesPerCircuit: 0, lightingBreakerAmps: 0 };
const rooms = [
  { id: 'living', name: 'Living area', type: 'living_area', receptacles: 8, lightGroups: [{ lights: 8, switchLocations: 2 }], fans: 0, attachedTo: '' },
  { id: 'bath', name: 'Bathroom', type: 'bathroom', receptacles: 3, lightGroups: [{ lights: 1, switchLocations: 1 }], fans: 1, attachedTo: '' },
];
const ok = (reply: unknown): CompleteResult => ({ ok: true, reply, model: 'fake' });

beforeEach(() => {
  mode.breakIndex = -1;
});

describe('build failure', () => {
  it('the second circuit fails: nothing is stored, built-at stays null, the error names the circuit', async () => {
    const db = openDb(':memory:');
    const script = [ok({ ...base, kind: 'inventory', message: 'Plan.', basement: true, rooms })];
    let n = 0;
    const provider: LlmProvider = { kind: 'anthropic', model: 'fake', complete: async () => script[n++]! };
    const app = createApp(db, { provider: () => ({ configured: true, provider }) });
    const send = (method: string, path: string, body?: unknown) => app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const p: any = await (await send('POST', '/api/projects', { name: 'x' })).json();
    await send('POST', `/api/projects/${p.id}/messages`, { content: 'plan' });

    mode.breakIndex = 1;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const messageCount = db.select().from(messages).all().length;
    const res = await send('POST', `/api/projects/${p.id}/plan/build`);
    expect(res.status).toBe(500);
    const body: any = await res.json();
    expect(body.error.code).toBe('PLAN_BUILD_FAILED');
    expect(body.error.message).toContain('was not built');
    expect(body.error.message).toContain('No circuits were created');
    expect(db.select().from(circuits).all()).toHaveLength(0);
    expect(db.select().from(projects).all()[0]!.planBuiltAt).toBeNull();
    expect(db.select().from(projects).all()[0]!.inventory).not.toBeNull();
    expect(db.select().from(messages).all()).toHaveLength(messageCount);
    expect(db.select().from(messages).all().filter((m) => m.kind === 'plan_built')).toHaveLength(0);
    expect(FAILURE_MESSAGES.plan_build_failed).toContain('bug in the planner');
  });
});
