// Display helpers for the circuits of a project. Pure; nothing here decides whether wiring is right.
import type { CircuitModel } from '@diy-ai/core';
import type { ProjectCircuit } from '@/api/client';
import { describeOrigin } from '@/lib/origin';

/** The breaker rating of a circuit, from its breaker device; null when it has none. */
export const breakerAmps = (circuit: CircuitModel): number | null =>
  circuit.devices.find((d) => d.type === 'breaker' && d.amps !== undefined)?.amps ?? null;

export type CircuitSummary =
  /** Built from checked blocks: a plain-words list of them. */
  | { kind: 'blocks'; text: string }
  /** Wired by the model without blocks; always unverified. */
  | { kind: 'custom'; text: string }
  | { kind: 'template'; text: string }
  /** No origin: an example or a manual edit. */
  | { kind: 'example'; text: string };

/** The one line under a circuit's name in the list. */
export function summarize(c: Pick<ProjectCircuit, 'origin'>): CircuitSummary {
  const info = describeOrigin(c.origin);
  if (!info) return { kind: 'example', text: 'Example' };
  if (info.kind === 'custom') return { kind: 'custom', text: 'Custom wiring — unverified' };
  if (info.kind === 'blocks') return { kind: 'blocks', text: info.summary };
  return { kind: 'template', text: `Template: ${info.title}` };
}

/** The circuit the page shows: the one named in the URL, else the first; null for a project without circuits. */
export function pickCircuit<T extends { id: string }>(circuits: readonly T[], wantedId: string | null): T | null {
  return circuits.find((c) => c.id === wantedId) ?? circuits[0] ?? null;
}

/** The circuit to show after `id` is removed from the list: the one now in its place, else the one before it. */
export function neighbourAfterDelete(circuits: readonly { id: string }[], id: string): string | null {
  const i = circuits.findIndex((c) => c.id === id);
  if (i < 0) return null;
  return circuits[i + 1]?.id ?? circuits[i - 1]?.id ?? null;
}

/** The ids with the circuit at `index` moved by `delta` places; null when it would leave the list. */
export function moved(ids: readonly string[], index: number, delta: -1 | 1): string[] | null {
  const to = index + delta;
  if (index < 0 || index >= ids.length || to < 0 || to >= ids.length) return null;
  const next = [...ids];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}

/** What a `circuit` chat message points at, from the project's circuits. */
export type MessageTarget = { kind: 'circuit'; id: string; name: string } | { kind: 'gone'; text: string };

export function messageTarget(circuitId: string | null, circuits: readonly { id: string; name: string }[]): MessageTarget {
  if (circuitId === null) return { kind: 'gone', text: 'a circuit that is no longer in this project' };
  const found = circuits.find((c) => c.id === circuitId);
  return found ? { kind: 'circuit', id: found.id, name: found.name } : { kind: 'gone', text: 'a circuit that was later deleted' };
}

/** "No circuits", "1 circuit", "3 circuits". */
export const circuitCountText = (n: number): string => (n === 0 ? 'No circuits' : `${n} ${n === 1 ? 'circuit' : 'circuits'}`);
