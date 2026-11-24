// Display helpers for plans (ADR-009). Pure; the planner and its rules live in core, nothing here decides anything.
import { ROOM_RULES, type ServedRoom } from '@diy-ai/core';
import type { ChatMessage } from '@/api/client';
import { fullDate } from '@/lib/time';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export interface ProtectionChip {
  key: 'afci' | 'gfci';
  label: string;
  /** What it means for the person building the circuit. */
  title: string;
}

/** The protection a circuit needs that the diagram cannot show, as small labels. Empty when none is required. */
export function protectionChips(p: { gfci: 'none' | 'first-receptacle'; afci: boolean }): ProtectionChip[] {
  const chips: ProtectionChip[] = [];
  if (p.afci) chips.push({ key: 'afci', label: 'AFCI breaker', title: 'Arc-fault protection is provided by the breaker, so it is not drawn in the diagram.' });
  if (p.gfci === 'first-receptacle')
    chips.push({ key: 'gfci', label: 'GFCI first receptacle', title: 'The first receptacle in the run is a GFCI receptacle and protects the receptacles after it.' });
  return chips;
}

/** What a circuit serves in one room: "Bedroom: 3 lights, 1 fan, 4 receptacles". */
export function servedText(r: ServedRoom): string {
  const parts = [r.lights > 0 && plural(r.lights, 'light'), r.fans > 0 && plural(r.fans, 'fan'), r.receptacles > 0 && plural(r.receptacles, 'receptacle')].filter(Boolean);
  return `${r.name}: ${parts.length > 0 ? parts.join(', ') : 'nothing'}`;
}

/** "720 of 1,440 VA", the planned load against what the breaker may carry (80 %). */
export function loadText(plannedVa: number, capacityVa: number): string {
  const n = (v: number) => (Math.round(v * 10) / 10).toLocaleString('en-US');
  return `${n(plannedVa)} of ${n(capacityVa)} VA`;
}

export interface RuleCitation {
  title: string;
  /** "NEC 2023 §210.12", or null when the rule has no code citation (a planning limit of this tool). */
  text: string | null;
  confirmed: boolean;
}

/** Title and citation of a planner room rule from the registry; null for an id the registry does not know. */
export function ruleCitation(ruleId: string | undefined): RuleCitation | null {
  const rule = ROOM_RULES.find((r) => r.id === ruleId);
  if (!rule) return null;
  const { edition, section, confirmed } = rule.citation;
  return { title: rule.title, text: section ? `${edition === 'nec-2023' ? 'NEC 2023' : edition} §${section}` : null, confirmed };
}

/** The id of the plan message that counts as the current plan: the latest one that carries a plan. */
export function currentPlanMessageId(messages: readonly ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.kind === 'plan' && m.plan) return m.id;
  }
  return null;
}

/**
 * Whether a `build_proposed` message can still be acted on: it is the latest proposal, the project has a stored plan that is
 * not built, and that plan is the one the proposal showed. Anything else is "no longer current".
 */
export function proposalIsCurrent(
  message: ChatMessage,
  messages: readonly ChatMessage[],
  project: { plan: unknown; planBuiltAt: number | null },
): boolean {
  if (message.kind !== 'build_proposed' || !message.plan || !project.plan || project.planBuiltAt !== null) return false;
  const latest = [...messages].reverse().find((m) => m.kind === 'build_proposed');
  if (latest?.id !== message.id) return false;
  // A later plan or build message means the plan moved on, even if the numbers came out the same.
  const after = messages.slice(messages.findIndex((m) => m.id === message.id) + 1);
  if (after.some((m) => m.kind === 'plan' || m.kind === 'plan_built')) return false;
  return JSON.stringify(message.plan) === JSON.stringify(project.plan);
}

/** "Create 4 circuits from this plan?" */
export const buildQuestion = (n: number) => `Create ${plural(n, 'circuit')} from this plan?`;

/** The small status line near the chat; null when the project has no plan. */
export function planStatusText(project: { plan: { circuits: unknown[] } | null; planBuiltAt: number | null }): string | null {
  if (!project.plan) return null;
  const n = plural(project.plan.circuits.length, 'circuit');
  return `Plan: ${n} · ${project.planBuiltAt === null ? 'not built' : `built ${fullDate(project.planBuiltAt)}`}`;
}
