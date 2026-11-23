// Room rules the planner relies on (ADR-009). Same conventions as the Batch A rules in ../rules.ts:
// our own wording, NEC 2023 candidate citations, confirmed: false until the user checks them. No code text.
import type { Citation, Severity } from '../rules';

export interface RoomRuleInfo {
  id: string;
  title: string;
  /** One sentence, our own wording. */
  statement: string;
  severity: Severity;
  citation: Citation;
}

const cite = (section: string | null): Citation => ({ edition: 'nec-2023', section, confirmed: false });

export const ROOM_RULES: readonly RoomRuleInfo[] = [
  {
    id: 'bath-receptacle-circuit',
    title: 'Bathroom receptacles have their own 20 A circuit',
    statement: 'Bathroom receptacles are on a 20 A circuit that serves no other room; the lights and fan of that same bathroom may share it.',
    severity: 'error',
    citation: cite('210.11(C)(3)'),
  },
  {
    id: 'bath-gfci',
    title: 'Bathroom receptacles are GFCI protected',
    statement: 'Every bathroom receptacle is GFCI protected.',
    severity: 'error',
    citation: cite('210.8(A)(1)'),
  },
  {
    id: 'basement-gfci',
    title: 'Basement receptacles are GFCI protected',
    statement: 'Every receptacle in a basement is GFCI protected.',
    severity: 'error',
    citation: cite('210.8(A)(5)'),
  },
  {
    id: 'afci-living-areas',
    title: 'Living areas, bedrooms, closets and hallways need AFCI',
    statement: 'Circuits serving living areas, bedrooms, closets and hallways need arc-fault (AFCI) protection.',
    severity: 'error',
    citation: cite('210.12'),
  },
  {
    id: 'switched-light',
    title: 'Each room has a switch-controlled light',
    statement: 'Each room has at least one light controlled by a wall switch.',
    severity: 'warning',
    citation: cite('210.70(A)'),
  },
  {
    id: 'planned-load',
    title: 'Planned load stays within 80 % of the breaker',
    statement: 'The planned load on a circuit stays within 80 % of its breaker rating, using the stated assumed loads (a planning limit of this tool, not a cited rule).',
    severity: 'error',
    citation: cite(null),
  },
];

export const getRoomRule = (id: string): RoomRuleInfo => {
  const r = ROOM_RULES.find((x) => x.id === id);
  if (!r) throw new Error(`unknown room rule: ${id}`);
  return r;
};

/** The planner citation checklist (docs/rules/nec-2023-planner-citations.md), generated from the registry. */
export function plannerCitationChecklistMarkdown(): string {
  const cell = (t: string) => t.replace(/\|/g, '\\|');
  const rows = ROOM_RULES.map(
    (r) => `| \`${r.id}\` | ${cell(r.statement)} | ${r.severity} | ${r.citation.section ?? 'none listed'} | ${r.citation.confirmed ? 'yes' : 'no'} |`,
  );
  return [
    '# NEC 2023 planner citation checklist',
    '',
    'Generated from the room rule registry in `packages/core/src/planner/rules.ts` (a test keeps this file in sync). Edition: NEC 2023.',
    '',
    '"Confirmed" means you have checked that the cited section really supports the rule, in the code book or with an electrician. Until then every citation is an unverified starting point from research. No code text is reproduced here or in the app: the statements are our own wording.',
    '',
    '| Rule | What it requires | Severity | Cited section | Confirmed |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}
