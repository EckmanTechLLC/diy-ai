// Plain-text renderings for places where structured rendering is not available.
import type { MaterialsList } from './materials';
import type { StepsPlan } from './steps';

export function formatMaterialsText(m: MaterialsList): string {
  const out: string[] = [`Materials: ${m.title}`];
  if (m.unverified) out.push('UNVERIFIED TOPOLOGY: this wiring was not built from checked building blocks.');
  out.push('');
  for (const i of m.items) {
    if (i.category === 'cable_run') {
      out.push(`- ${i.description}: ${i.lengthFt === undefined ? 'length not entered' : `${i.lengthFt} ft`}`);
    } else {
      out.push(`- ${i.quantity} x ${i.description}${i.note ? ` (${i.note})` : ''}`);
    }
  }
  if (m.cableTotals.length > 0) {
    out.push('', 'Cable totals:');
    for (const t of m.cableTotals) {
      const known = t.runs - t.missing;
      const head = `- ${t.type}: ${t.runs} ${t.runs === 1 ? 'run' : 'runs'}, `;
      if (known === 0) out.push(`${head}no length entered yet`);
      else
        out.push(
          `${head}${t.knownFt} ft entered, ${t.totalFt} ft with ${t.allowancePct}% allowance` +
            (t.missing > 0 ? `; ${t.missing} ${t.missing === 1 ? 'run has' : 'runs have'} no length yet, so this total is incomplete` : ''),
        );
    }
  }
  out.push('', 'Not included:');
  for (const n of m.notIncluded) out.push(`- ${n}`);
  return out.join('\n');
}

export function formatStepsText(s: StepsPlan): string {
  const out: string[] = [`Steps: ${s.title}`];
  if (s.unverified) out.push('UNVERIFIED TOPOLOGY: this wiring was not built from checked building blocks.');
  s.phases.forEach((p, pi) => {
    out.push('', `${pi + 1}. ${p.title}`);
    p.steps.forEach((st, si) => {
      out.push(`${pi + 1}.${si + 1} ${st.text}`);
      if (st.note) out.push(`    Note: ${st.note}`);
    });
  });
  return out.join('\n');
}
