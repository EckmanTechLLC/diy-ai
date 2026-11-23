// Display helpers for rule findings. Pure: the checks themselves live in core (`checkCircuit`, `RULES`);
// nothing here decides whether a circuit is right or wrong, it only groups and words what core reported.
import { RULES, checkCircuit, type CircuitModel, type Finding, type RuleInfo, type Severity } from '@diy-ai/core';
import type { Highlight } from '@/lib/inspect';

/** Meta rules report that the checks could not run at all. */
export const META_RULE_IDS: readonly string[] = ['circuit-valid', 'model-assumptions'];

/** The checks run for display, always against the one supported edition. */
export const checkForDisplay = (circuit: CircuitModel): Finding[] => checkCircuit(circuit, { edition: 'nec-2023' });

/** The rules that actually check wiring (the registry without the meta rules). */
export const checkedRules = (rules: readonly RuleInfo[] = RULES): RuleInfo[] => rules.filter((r) => !META_RULE_IDS.includes(r.id));

export interface FindingGroup {
  /** Stable key, the rule id. */
  ruleId: string;
  title: string;
  /** `error` when any finding of the rule is an error. */
  severity: Severity;
  messages: string[];
  /** Unique involved ids of all findings of the rule, in first-seen order. */
  involved: string[];
  citation: Finding['citation'];
}

/**
 * One group per rule, merging its findings; errors first, then warnings, each in the order the rule first
 * appeared. A rule id missing from `rules` is titled with the id.
 */
export function groupFindings(findings: readonly Finding[], rules: readonly RuleInfo[] = RULES): FindingGroup[] {
  const groups = new Map<string, FindingGroup>();
  for (const f of findings) {
    let g = groups.get(f.ruleId);
    if (!g) {
      g = {
        ruleId: f.ruleId,
        title: rules.find((r) => r.id === f.ruleId)?.title ?? f.ruleId,
        severity: f.severity,
        messages: [],
        involved: [],
        citation: f.citation,
      };
      groups.set(f.ruleId, g);
    }
    if (f.severity === 'error') g.severity = 'error';
    if (!g.messages.includes(f.message)) g.messages.push(f.message);
    for (const id of f.involved) if (!g.involved.includes(id)) g.involved.push(id);
  }
  const all = [...groups.values()];
  return [...all.filter((g) => g.severity === 'error'), ...all.filter((g) => g.severity === 'warning')];
}

export type CheckStatus =
  /** No findings. */
  | { kind: 'passed'; errors: 0; warnings: 0 }
  | { kind: 'warnings'; errors: 0; warnings: number }
  | { kind: 'problems'; errors: number; warnings: number }
  /** The checker refused the circuit (invalid or outside its assumptions), so nothing was checked. */
  | { kind: 'not-checked'; errors: number; warnings: number };

export function statusOf(findings: readonly Finding[]): CheckStatus {
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.length - errors;
  if (findings.some((f) => META_RULE_IDS.includes(f.ruleId))) return { kind: 'not-checked', errors, warnings };
  if (errors > 0) return { kind: 'problems', errors, warnings };
  if (warnings > 0) return { kind: 'warnings', errors: 0, warnings };
  return { kind: 'passed', errors: 0, warnings: 0 };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The one-line status inside the panel. */
export function statusLine(s: CheckStatus, checkCount: number): string {
  switch (s.kind) {
    case 'passed':
      return `All ${checkCount} wiring-logic checks passed`;
    case 'warnings':
      return `${plural(s.warnings, 'warning', 'warnings')} from the wiring-logic checks`;
    case 'problems':
      return `${plural(s.errors, 'problem', 'problems')} found by the wiring-logic checks${s.warnings > 0 ? `, and ${plural(s.warnings, 'warning', 'warnings')}` : ''}`;
    case 'not-checked':
      return 'The wiring-logic checks could not be run on this circuit';
  }
}

/** The compact indicator next to the origin badge. */
export function statusBadgeText(s: CheckStatus): string {
  switch (s.kind) {
    case 'passed':
      return 'Wiring-logic checks passed';
    case 'warnings':
      return `Wiring-logic checks: ${plural(s.warnings, 'warning', 'warnings')}`;
    case 'problems':
      return `Wiring-logic checks: ${plural(s.errors, 'problem', 'problems')}`;
    case 'not-checked':
      return 'Wiring-logic checks could not run';
  }
}

/** "NEC 2023 §250.119 (unconfirmed)", or "no citation". */
export function citationText(c: Finding['citation']): string {
  if (!c.section) return 'no citation';
  return `NEC 2023 §${c.section}${c.confirmed ? '' : ' (unconfirmed)'}`;
}

/**
 * What to light up for a finding group. Ids may be connection, device, cable, splice or box ids; each is
 * matched against the circuit by kind (an id is added under every kind that has it) and unknown ids are ignored.
 */
export function findingHighlight(circuit: CircuitModel, ids: readonly string[]): Highlight & { boxes: Set<string> } {
  const h = { net: null, connections: new Set<string>(), devices: new Set<string>(), cables: new Set<string>(), splices: new Set<string>(), boxes: new Set<string>() };
  const kinds: [Set<string>, { id: string }[]][] = [
    [h.connections, circuit.connections],
    [h.devices, circuit.devices],
    [h.cables, circuit.cables],
    [h.splices, circuit.splices],
    [h.boxes, circuit.boxes],
  ];
  for (const id of ids) for (const [set, items] of kinds) if (items.some((x) => x.id === id)) set.add(id);
  return h;
}

export const isEmptyHighlight = (h: Highlight & { boxes?: Set<string> }): boolean =>
  h.connections.size + h.devices.size + h.cables.size + h.splices.size + (h.boxes?.size ?? 0) === 0;
