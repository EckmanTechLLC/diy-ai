import { Hammer } from 'lucide-react';
import type { Plan } from '@diy-ai/core';
import { ErrorNotice, Spinner } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type ProposalState = 'current' | 'stale' | 'dismissed';

/** The model asked to build the plan; nothing is built until the user presses Build. Rendered from the plan data, not message text. */
export function BuildProposalCard({
  plan,
  state,
  pending,
  error,
  onBuild,
  onDismiss,
}: {
  plan: Plan;
  state: ProposalState;
  pending: boolean;
  error: unknown;
  onBuild: () => void;
  onDismiss: () => void;
}) {
  const n = plan.circuits.length;
  const title = `Build these ${n} ${n === 1 ? 'circuit' : 'circuits'}?`;
  return (
    <article
      aria-label={state === 'current' ? title : `${title} (${state === 'stale' ? 'no longer current' : 'dismissed'})`}
      className={cn('grid min-w-0 gap-2 rounded-xl rounded-bl-sm border bg-card p-3 text-sm text-card-foreground shadow-xs', state !== 'current' && 'border-dashed')}
    >
      <h3 className="flex items-center gap-1.5 font-semibold">
        <Hammer className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        {title}
      </h3>
      <ol className={cn('grid gap-1 text-xs', state !== 'current' && 'opacity-70')} aria-label="Circuits to build">
        {plan.circuits.map((c, i) => (
          <li key={i} className="flex min-w-0 items-baseline gap-2">
            <span className="min-w-0 flex-1 break-words">{c.name}</span>
            <span className="shrink-0 rounded bg-muted px-1.5 font-medium tabular-nums">{c.breakerAmps} A</span>
          </li>
        ))}
      </ol>
      {state === 'current' ? (
        <>
          {error ? <ErrorNotice error={error} /> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={onBuild} disabled={pending}>
              {pending ? <Spinner /> : null}
              Build
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onDismiss} disabled={pending}>
              Not now
            </Button>
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">{state === 'stale' ? 'No longer current.' : 'Dismissed.'}</p>
      )}
    </article>
  );
}
