import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, CircleSlash, OctagonAlert } from 'lucide-react';
import { RULES, type Finding } from '@diy-ai/core';
import { cn } from '@/lib/utils';
import { checkedRules, citationText, groupFindings, statusLine, type CheckStatus, type FindingGroup } from '@/lib/findings';

/** What the checks do not cover yet. Plain wording; the rule list itself comes from core. */
const NOT_CHECKED = [
  'Box fill (how many wires and devices fit in each box).',
  'Where GFCI and AFCI protection is required (kitchens, bathrooms, garages, bedrooms and so on).',
  'Voltage drop on long runs.',
  'Whether a receptacle is rated for the breaker.',
  'Anything beyond one 120 V branch circuit with one breaker (240 V, multiwire, 4-way switches). Each circuit is checked on its own, not how circuits share boxes or the panel.',
];

export const STANDING_NOTE =
  'These checks catch wiring-logic mistakes. They are not a code-compliance review. Local code may differ from the model code, so get a permit and an inspection where your area requires them.';

export function StatusIcon({ status, className }: { status: CheckStatus['kind']; className?: string }) {
  const Icon = status === 'passed' ? CheckCircle2 : status === 'warnings' ? AlertTriangle : status === 'problems' ? OctagonAlert : CircleSlash;
  return <Icon className={cn('size-4 shrink-0', className)} aria-hidden />;
}

export const statusTone = (k: CheckStatus['kind']): string =>
  k === 'passed'
    ? 'text-muted-foreground'
    : k === 'warnings'
      ? 'text-amber-900 dark:text-amber-200'
      : 'text-destructive';

function GroupCard({ group, active, onToggle }: { group: FindingGroup; active: boolean; onToggle: () => void }) {
  const isError = group.severity === 'error';
  const Icon = isError ? OctagonAlert : AlertTriangle;
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={active}
        className={cn(
          'grid w-full gap-1 rounded-lg border p-2.5 text-left text-sm transition-colors hover:bg-accent/60',
          isError ? 'border-destructive/40 bg-destructive/5' : 'border-amber-500/50 bg-amber-500/5',
          active && 'ring-2 ring-ring',
        )}
        title={active ? 'Click to clear the highlight' : 'Click to show where this is in the diagram'}
      >
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <Icon className={cn('size-4 shrink-0', isError ? 'text-destructive' : 'text-amber-700 dark:text-amber-300')} aria-hidden />
          <span className="font-medium">{group.title}</span>
          <span className={cn('rounded px-1.5 text-xs font-medium', isError ? 'bg-destructive/15 text-destructive' : 'bg-amber-500/20 text-amber-900 dark:text-amber-200')}>
            {isError ? 'Problem' : 'Warning'}
          </span>
        </span>
        {group.messages.map((m, i) => (
          <span key={i} className="pl-6 text-foreground/90">
            {m}
          </span>
        ))}
        <span className="pl-6 text-xs text-muted-foreground">
          {citationText(group.citation)}
          {group.involved.length > 0 && <> · {active ? 'shown in the diagram' : 'click to show in the diagram'}</>}
        </span>
      </button>
    </li>
  );
}

export function ChecksPanel({
  findings,
  status,
  open,
  onOpenChange,
  activeRule,
  onPick,
  revealSignal,
}: {
  findings: Finding[];
  status: CheckStatus;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Rule id of the group currently highlighted in the diagram. */
  activeRule: string | null;
  /** Toggle the highlight of a group (null clears it). */
  onPick: (group: FindingGroup | null) => void;
  /** Bumped when something outside asks to look at the checks. */
  revealSignal: number;
}) {
  const bodyId = useId();
  const root = useRef<HTMLElement>(null);
  const [showRules, setShowRules] = useState(false);
  const groups = useMemo(() => groupFindings(findings), [findings]);
  const rules = useMemo(() => checkedRules(RULES), []);

  useEffect(() => {
    if (revealSignal > 0) root.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [revealSignal]);

  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section
      ref={root}
      aria-label="Wiring checks"
      className="shrink-0 rounded-xl border bg-card text-card-foreground shadow-xs"
      onKeyDown={(e) => e.key === 'Escape' && onPick(null)}
    >
      <h2 className="m-0">
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm"
        >
          <Chevron className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="font-semibold">Wiring checks</span>
          <span role="status" className={cn('flex min-w-0 items-center gap-1.5 font-medium', statusTone(status.kind))}>
            <StatusIcon status={status.kind} />
            <span className="truncate">{statusLine(status, rules.length)}</span>
          </span>
        </button>
      </h2>

      {open && (
        <div id={bodyId} className="grid max-h-[40vh] gap-3 overflow-y-auto border-t px-3 py-3 text-sm">
          {groups.length > 0 && (
            <ul className="grid gap-2">
              {groups.map((g) => (
                <GroupCard key={g.ruleId} group={g} active={activeRule === g.ruleId} onToggle={() => onPick(activeRule === g.ruleId ? null : g)} />
              ))}
            </ul>
          )}

          <p className="rounded-lg border bg-muted/50 p-2.5">{STANDING_NOTE}</p>

          <div>
            <h3 className="font-medium">Not checked yet</h3>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
              {NOT_CHECKED.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setShowRules((v) => !v)}
              aria-expanded={showRules}
              className="flex items-center gap-1 font-medium underline-offset-2 hover:underline"
            >
              {showRules ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
              What was checked ({rules.length} checks)
            </button>
            {showRules && (
              <ul className="mt-1.5 grid gap-1.5">
                {rules.map((r) => (
                  <li key={r.id} className="rounded-md border px-2.5 py-1.5">
                    <p className="font-medium">{r.title}</p>
                    <p className="text-muted-foreground">{r.statement}</p>
                    <p className="text-xs text-muted-foreground">{citationText(r.citation)}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
