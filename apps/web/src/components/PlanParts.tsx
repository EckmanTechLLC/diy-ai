import { BookOpenCheck, Settings2, ShieldCheck } from 'lucide-react';
import type { Reason } from '@diy-ai/core';
import { protectionChips, ruleCitation } from '@/lib/plan';
import { cn } from '@/lib/utils';

/** Required protection as small labelled chips; nothing is rendered when none is required. */
export function ProtectionChips({ protection, className }: { protection: { gfci: 'none' | 'first-receptacle'; afci: boolean }; className?: string }) {
  const chips = protectionChips(protection);
  if (chips.length === 0) return null;
  return (
    // spans with list roles, so the chips are valid inside a button (the circuit list row)
    <span role="list" className={cn('flex flex-wrap gap-1', className)} aria-label="Required protection">
      {chips.map((c) => (
        <span
          role="listitem"
          key={c.key}
          title={c.title}
          className="inline-flex items-center gap-1 rounded-full border border-sky-600/40 bg-sky-500/10 px-2 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap text-sky-900 dark:text-sky-200"
        >
          <ShieldCheck className="size-3 shrink-0" aria-hidden />
          {c.label}
        </span>
      ))}
    </span>
  );
}

/**
 * Why a circuit is planned the way it is. Reasons that come from a room rule (checked in code, with a citation)
 * are set apart from the planner's own design defaults, so the two are never mistaken for each other.
 */
export function ReasonList({ reasons, className }: { reasons: readonly Reason[]; className?: string }) {
  return (
    <ul className={cn('grid gap-2', className)}>
      {reasons.map((r, i) => {
        const isRule = r.kind === 'rule';
        const cite = isRule ? ruleCitation(r.ruleId) : null;
        return (
          <li key={i} className={cn('grid gap-0.5 border-l-2 pl-2 text-xs', isRule ? 'border-primary' : 'border-dashed border-muted-foreground/50')}>
            <span className={cn('flex items-center gap-1 font-medium', isRule ? 'text-foreground' : 'text-muted-foreground')}>
              {isRule ? <BookOpenCheck className="size-3 shrink-0" aria-hidden /> : <Settings2 className="size-3 shrink-0" aria-hidden />}
              {isRule ? 'Code rule' : 'Planning default'}
            </span>
            <span className="text-foreground/90">{r.text}</span>
            {cite && (
              <span className="flex flex-wrap items-center gap-x-1.5 text-muted-foreground">
                <span>{cite.title}.</span>
                <span>{cite.text ?? 'A planning limit of this tool, not a cited code rule.'}</span>
                {cite.text && !cite.confirmed && (
                  <span className="rounded border border-amber-500/60 bg-amber-500/10 px-1 font-medium text-amber-900 dark:text-amber-200">unconfirmed</span>
                )}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
