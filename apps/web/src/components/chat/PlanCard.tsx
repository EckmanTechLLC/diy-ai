import { AlertTriangle, ClipboardList, OctagonAlert } from 'lucide-react';
import type { Plan } from '@diy-ai/core';
import { PlanReasonsDisclosure } from '@/components/chat/PlanReasonsDisclosure';
import { ProtectionChips } from '@/components/PlanParts';
import { citationText } from '@/lib/findings';
import { loadText, servedText } from '@/lib/plan';
import { cn } from '@/lib/utils';

export type PlanCardState = 'current' | 'superseded' | 'discarded';

const STATE_NOTE: Record<Exclude<PlanCardState, 'current'>, string> = {
  superseded: 'Superseded: a newer plan below replaces this one.',
  discarded: 'Discarded: this plan is no longer stored.',
};

/** A plan as a structured card, rendered from the plan data the server computed (never from message text). */
export function PlanCard({ plan, state }: { plan: Plan; state: PlanCardState }) {
  const n = plan.circuits.length;
  const { loads } = plan.assumptions;
  return (
    <article
      aria-label={`Plan with ${n} ${n === 1 ? 'circuit' : 'circuits'}${state === 'current' ? '' : `, ${state}`}`}
      className={cn('grid min-w-0 gap-3 rounded-xl rounded-bl-sm border bg-card p-3 text-sm text-card-foreground shadow-xs', state !== 'current' && 'border-dashed')}
    >
      <header className="grid gap-1">
        <h3 className="flex items-center gap-1.5 font-semibold">
          <ClipboardList className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          Plan: {n} {n === 1 ? 'circuit' : 'circuits'}
        </h3>
        {state !== 'current' && (
          <p className="w-fit rounded border border-amber-500/60 bg-amber-500/10 px-1.5 py-0.5 text-xs font-medium text-amber-900 dark:text-amber-200">{STATE_NOTE[state]}</p>
        )}
      </header>

      <div className={cn('grid gap-3', state !== 'current' && 'opacity-70')}>
        {n > 0 && (
          <ol className="grid gap-2" aria-label="Planned circuits">
            {plan.circuits.map((c, i) => (
              <li key={i} className="grid gap-1.5 rounded-lg border bg-background/60 p-2">
                <p className="flex min-w-0 items-baseline gap-2">
                  <span className="min-w-0 flex-1 font-medium break-words">{c.name}</span>
                  <span className="shrink-0 rounded bg-muted px-1.5 text-xs font-medium tabular-nums">{c.breakerAmps} A</span>
                </p>
                <ul className="grid gap-0.5 text-xs text-foreground/90">
                  {c.rooms.map((r) => (
                    <li key={r.id}>{servedText(r)}</li>
                  ))}
                </ul>
                <ProtectionChips protection={c.protection} />
                <p
                  className="text-[11px] text-muted-foreground tabular-nums"
                  title="Planned load against what this breaker may carry (80 % of its rating), using the assumed loads below."
                >
                  Load {loadText(c.plannedLoadVa, c.capacityVa)}
                </p>
                <PlanReasonsDisclosure reasons={c.reasons} />
              </li>
            ))}
          </ol>
        )}

        {plan.notCovered.length > 0 && (
          <section className="grid gap-1">
            <h4 className="text-xs font-semibold">Not covered</h4>
            <ul className="grid gap-1 text-xs">
              {plan.notCovered.map((r) => (
                <li key={r.roomId}>
                  <span className="font-medium">{r.roomName}.</span> <span className="text-muted-foreground">{r.reason}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {plan.findings.length > 0 && (
          <section className="grid gap-1">
            <h4 className="text-xs font-semibold">Notes from the rule checks</h4>
            <ul className="grid gap-1.5 text-xs">
              {plan.findings.map((f, i) => {
                const Icon = f.severity === 'error' ? OctagonAlert : AlertTriangle;
                return (
                  <li key={i} className="flex items-start gap-1.5">
                    <Icon className={cn('mt-0.5 size-3.5 shrink-0', f.severity === 'error' ? 'text-destructive' : 'text-amber-700 dark:text-amber-300')} aria-hidden />
                    <span>
                      <span className="sr-only">{f.severity === 'error' ? 'Problem: ' : 'Warning: '}</span>
                      {f.message} <span className="text-muted-foreground">{citationText(f.citation)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="grid gap-1">
          <h4 className="text-xs font-semibold">Assumed loads</h4>
          <p className="text-xs text-muted-foreground tabular-nums">
            Receptacle {loads.receptacleVa} VA · light {loads.lightVa} VA · fan {loads.fanVa} VA. A circuit carries at most {Math.round(plan.assumptions.loadLimit * 100)} % of its
            breaker rating.
          </p>
          {plan.assumptions.notes.map((note, i) => (
            <p key={i} className="text-xs text-muted-foreground">
              {note}
            </p>
          ))}
        </section>

        {plan.reminders.length > 0 && (
          <section className="grid gap-1">
            <h4 className="text-xs font-semibold">Reminders</h4>
            <ul className="grid list-disc gap-0.5 pl-4 text-xs text-muted-foreground">
              {plan.reminders.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <footer className="grid gap-0.5 border-t pt-2 text-xs text-muted-foreground">
        {state === 'current' ? (
          <p>
            Ask me to change anything in this plan, or press <span className="font-medium text-foreground">Build</span> to create these circuits.
          </p>
        ) : null}
        <p>This plan is not a guarantee of code compliance.</p>
      </footer>
    </article>
  );
}
