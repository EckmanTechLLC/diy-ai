// Plain-text rendering of a plan (ADR-009), for places that cannot show the structured plan yet. Pure.
import type { Plan, PlannedCircuit, ServedRoom } from './plan';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function served(r: ServedRoom): string {
  const parts = [
    r.lightGroups > 0 && `${plural(r.lights, 'light')} in ${plural(r.lightGroups, 'switched group')}`,
    r.fans > 0 && plural(r.fans, 'fan'),
    r.receptacles > 0 && plural(r.receptacles, 'receptacle'),
  ].filter(Boolean);
  return `${r.name}: ${parts.join(', ')}`;
}

function protection(c: PlannedCircuit): string {
  const gfci = c.protection.gfci === 'first-receptacle' ? 'GFCI at the first receptacle' : 'no GFCI';
  return `${gfci}; ${c.protection.afci ? 'AFCI breaker' : 'no AFCI'}`;
}

export const PLAN_TEXT_CLOSING = 'Ask me to change anything in this plan, or say "build it" to create these circuits.';

/** Circuit names, breaker sizes, what each serves, protection, reasons, findings, reminders and rooms not covered. */
export function formatPlanText(plan: Plan): string {
  const out: string[] = [`Planned ${plural(plan.circuits.length, 'circuit')}:`];
  plan.circuits.forEach((c, i) => {
    out.push('', `${i + 1}. ${c.name} - ${c.breakerAmps} A breaker`);
    out.push(`   Serves: ${c.rooms.map(served).join('; ')}`);
    out.push(`   Protection: ${protection(c)}`);
    out.push('   Why:');
    for (const r of c.reasons) out.push(`   - ${r.text}`);
  });
  if (plan.notCovered.length > 0) {
    out.push('', 'Not covered:');
    for (const n of plan.notCovered) out.push(`- ${n.roomName}: ${n.reason}`);
  }
  if (plan.findings.length > 0) {
    out.push('', 'Notes from the rule checks:');
    for (const f of plan.findings) out.push(`- ${f.severity}: ${f.message}`);
  }
  if (plan.assumptions.notes.length > 0) {
    out.push('', 'Assumptions:');
    for (const n of plan.assumptions.notes) out.push(`- ${n}`);
  }
  out.push('', 'Reminders:');
  for (const r of plan.reminders) out.push(`- ${r}`);
  out.push('', PLAN_TEXT_CLOSING);
  return out.join('\n');
}
