// Helpers for the Materials and Steps tabs (ADR-010). Pure apart from the progress storage, which tolerates a missing browser store.
// Nothing here writes an instruction or a quantity: those come only from `buildMaterials` and `buildSteps`.
import { DEFAULT_ALLOWANCE_PCT, type BuildPlanOptions } from '@diy-ai/core';
import type { CableLengths, Project, ProjectCircuit } from '@/api/client';

// ---- tabs ----

export const TABS = ['diagram', 'materials', 'steps'] as const;
export type Tab = (typeof TABS)[number];
export const TAB_LABELS: Record<Tab, string> = { diagram: 'Diagram', materials: 'Materials', steps: 'Steps' };

export const isTab = (raw: string | null): raw is Tab => raw !== null && (TABS as readonly string[]).includes(raw);
/** The tab named in the URL; a missing or unknown value shows the diagram. */
export const parseTab = (raw: string | null): Tab => (isTab(raw) ? raw : 'diagram');

// ---- what the generators are given ----

/** The options `buildMaterials` and `buildSteps` take for a stored circuit. */
export function planOptionsFor(c: Pick<ProjectCircuit, 'origin' | 'plan' | 'cableLengths'>): BuildPlanOptions {
  return {
    ...(c.plan ? { protection: c.plan.protection } : {}),
    cableLengths: c.cableLengths?.lengths ?? {},
    allowancePct: c.cableLengths?.allowancePct ?? DEFAULT_ALLOWANCE_PCT,
    unverified: c.origin?.kind === 'custom',
  };
}

// ---- typed lengths and allowance ----

export const MAX_FEET = 1000;
export const MAX_ALLOWANCE_PCT = 50;

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

/** A length typed in feet. An empty field means "no length" (null). */
export function parseFeet(text: string): Parsed<number | null> {
  const t = text.trim();
  if (t === '') return { ok: true, value: null };
  if (!/^\d+(\.\d*)?$/.test(t) && !/^\.\d+$/.test(t)) return { ok: false, message: 'Enter feet as a number, such as 12 or 12.5.' };
  if (/\.\d{2,}/.test(t)) return { ok: false, message: 'Use at most one decimal place.' };
  const n = Number(t);
  if (n <= 0) return { ok: false, message: 'The length must be more than 0 feet.' };
  if (n > MAX_FEET) return { ok: false, message: `The length must be ${MAX_FEET} feet or less.` };
  return { ok: true, value: n };
}

/** The allowance typed in percent. */
export function parseAllowance(text: string): Parsed<number> {
  const t = text.trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return { ok: false, message: `Enter a percentage from 0 to ${MAX_ALLOWANCE_PCT}.` };
  const n = Number(t);
  if (n > MAX_ALLOWANCE_PCT) return { ok: false, message: `The allowance must be ${MAX_ALLOWANCE_PCT}% or less.` };
  return { ok: true, value: n };
}

/** The stored value after one run's length changes (null removes it). Other runs and the allowance stay. */
export function withLength(current: CableLengths | null, cableId: string, feet: number | null): CableLengths {
  const lengths = { ...(current?.lengths ?? {}) };
  if (feet === null) delete lengths[cableId];
  else lengths[cableId] = feet;
  return { lengths, allowancePct: current?.allowancePct ?? DEFAULT_ALLOWANCE_PCT };
}

/** The stored value after the allowance changes. */
export const withAllowance = (current: CableLengths | null, allowancePct: number): CableLengths => ({ lengths: { ...(current?.lengths ?? {}) }, allowancePct });

/** The project with one circuit's lengths replaced (for the optimistic update). Everything else keeps its identity. */
export function withCableLengths(project: Project, circuitId: string, cableLengths: CableLengths | null): Project {
  return { ...project, circuits: project.circuits.map((c) => (c.id === circuitId ? { ...c, cableLengths } : c)) };
}

// ---- step progress (browser storage only) ----

const progressKey = (projectId: string, circuitId: string) => `diy-ai.steps.${projectId}.${circuitId}`;

/** Ticked step ids from stored text; anything that is not a known step id is dropped. */
export function parseProgress(raw: string | null, valid: ReadonlySet<string>): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === 'string' && valid.has(id)));
  } catch {
    return new Set();
  }
}

export function loadProgress(projectId: string, circuitId: string, valid: ReadonlySet<string>): Set<string> {
  try {
    return parseProgress(localStorage.getItem(progressKey(projectId, circuitId)), valid);
  } catch {
    return new Set();
  }
}

export function saveProgress(projectId: string, circuitId: string, ticked: ReadonlySet<string>): void {
  try {
    const key = progressKey(projectId, circuitId);
    if (ticked.size === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify([...ticked]));
  } catch {
    // storage unavailable: progress lasts for this visit only
  }
}
