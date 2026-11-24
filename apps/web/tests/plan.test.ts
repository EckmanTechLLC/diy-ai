import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../src/api/client';
import { buildQuestion, currentPlanMessageId, loadText, proposalIsCurrent, planStatusText, protectionChips, ruleCitation, servedText } from '../src/lib/plan';

const msg = (id: string, kind: ChatMessage['kind'], plan: unknown = null): ChatMessage =>
  ({ id, role: 'assistant', content: '', kind, origin: null, errorCode: null, findings: null, circuitId: null, plan, createdCircuitIds: null, createdAt: 1 }) as ChatMessage;

describe('protectionChips', () => {
  it('lists AFCI breaker and GFCI first receptacle, in that order, only when required', () => {
    expect(protectionChips({ gfci: 'first-receptacle', afci: true }).map((c) => c.label)).toEqual(['AFCI breaker', 'GFCI first receptacle']);
    expect(protectionChips({ gfci: 'none', afci: true }).map((c) => c.key)).toEqual(['afci']);
    expect(protectionChips({ gfci: 'first-receptacle', afci: false }).map((c) => c.key)).toEqual(['gfci']);
    expect(protectionChips({ gfci: 'none', afci: false })).toEqual([]);
  });

  it('says in the AFCI chip that the breaker provides it and the diagram does not draw it', () => {
    expect(protectionChips({ gfci: 'none', afci: true })[0]!.title).toMatch(/breaker.*not drawn/);
  });
});

describe('servedText and loadText', () => {
  const room = { id: 'r', name: 'Bedroom', receptacles: 4, lightGroups: 1, lights: 3, fans: 1 };
  it('counts lights, fans and receptacles with plurals', () => {
    expect(servedText(room)).toBe('Bedroom: 3 lights, 1 fan, 4 receptacles');
    expect(servedText({ ...room, lights: 1, fans: 0, receptacles: 1 })).toBe('Bedroom: 1 light, 1 receptacle');
  });
  it('shows the load against the capacity', () => {
    expect(loadText(720, 1440)).toBe('720 of 1,440 VA');
    expect(loadText(1234.56, 1920)).toBe('1,234.6 of 1,920 VA');
  });
});

describe('ruleCitation', () => {
  it('takes title, section and confirmation from the registry', () => {
    const c = ruleCitation('afci-living-areas')!;
    expect(c.text).toBe('NEC 2023 §210.12');
    expect(c.confirmed).toBe(false);
    expect(c.title).toMatch(/AFCI/);
  });
  it('has no citation text for the planning load limit, and null for unknown ids', () => {
    expect(ruleCitation('planned-load')!.text).toBeNull();
    expect(ruleCitation('nope')).toBeNull();
    expect(ruleCitation(undefined)).toBeNull();
  });
});

describe('currentPlanMessageId', () => {
  it('is the latest plan message that carries a plan', () => {
    const p = { circuits: [] };
    expect(currentPlanMessageId([msg('1', 'plan', p), msg('2', 'question'), msg('3', 'plan', p), msg('4', 'plan_built', p)])).toBe('3');
  });
  it('ignores older text-only plan messages and is null without any', () => {
    expect(currentPlanMessageId([msg('1', 'plan', { circuits: [] }), msg('2', 'plan', null)])).toBe('1');
    expect(currentPlanMessageId([msg('1', 'question')])).toBeNull();
  });
});

describe('planStatusText', () => {
  it('is null without a plan', () => expect(planStatusText({ plan: null, planBuiltAt: null })).toBeNull());
  it('says not built, or when it was built', () => {
    expect(planStatusText({ plan: { circuits: [1, 2, 3, 4] }, planBuiltAt: null })).toBe('Plan: 4 circuits · not built');
    expect(planStatusText({ plan: { circuits: [1] }, planBuiltAt: Date.UTC(2026, 10, 20, 12) })).toMatch(/^Plan: 1 circuit · built .*2026/);
  });
});

describe('proposalIsCurrent', () => {
  const plan = { circuits: [{ name: 'A', breakerAmps: 20 }] };
  const other = { circuits: [{ name: 'A', breakerAmps: 15 }] };
  const project = { plan, planBuiltAt: null as number | null };

  it('is current for the latest proposal while the stored plan is the proposed one and not built', () => {
    const list = [msg('p', 'plan', plan), msg('b', 'build_proposed', plan)];
    expect(proposalIsCurrent(list[1]!, list, project)).toBe(true);
  });
  it('is not current once the plan is built, discarded or changed', () => {
    const list = [msg('b', 'build_proposed', plan)];
    expect(proposalIsCurrent(list[0]!, list, { plan, planBuiltAt: 5 })).toBe(false);
    expect(proposalIsCurrent(list[0]!, list, { plan: null, planBuiltAt: null })).toBe(false);
    expect(proposalIsCurrent(list[0]!, list, { plan: other, planBuiltAt: null })).toBe(false);
  });
  it('is not current when a newer proposal, plan or built message follows', () => {
    const a = msg('a', 'build_proposed', plan);
    expect(proposalIsCurrent(a, [a, msg('b', 'build_proposed', plan)], project)).toBe(false);
    expect(proposalIsCurrent(a, [a, msg('p', 'plan', plan)], project)).toBe(false);
    expect(proposalIsCurrent(a, [a, msg('p', 'plan_built', plan)], project)).toBe(false);
  });
  it('is never current for other kinds or without a plan', () => {
    const q = msg('q', 'question', plan);
    expect(proposalIsCurrent(q, [q], project)).toBe(false);
    const np = msg('n', 'build_proposed', null);
    expect(proposalIsCurrent(np, [np], project)).toBe(false);
  });
  it('words the confirmation question with the circuit count', () => {
    expect(buildQuestion(4)).toBe('Create 4 circuits from this plan?');
    expect(buildQuestion(1)).toBe('Create 1 circuit from this plan?');
  });
});
