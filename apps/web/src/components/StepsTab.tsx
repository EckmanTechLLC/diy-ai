import { useEffect, useMemo, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { buildSteps, type BuildStep, type StepPhase, type StepsPlan } from '@diy-ai/core';
import type { ProjectCircuit } from '@/api/client';
import { ErrorNotice } from '@/components/feedback';
import { UnverifiedNotice } from '@/components/MaterialsTab';
import { Button } from '@/components/ui/button';
import { loadProgress, planOptionsFor, saveProgress } from '@/lib/buildplan';
import { cn } from '@/lib/utils';

/** The safety phase: always shown, never ticked, never collapsed. */
function SafetyPhase({ phase }: { phase: StepPhase }) {
  return (
    <section aria-labelledby={`phase-${phase.id}`} className="rounded-xl border-2 border-amber-500/70 bg-amber-500/10 px-4 py-3">
      <h2 id={`phase-${phase.id}`} className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
        <ShieldAlert className="size-4 shrink-0" aria-hidden />
        {phase.title}
      </h2>
      <ul className="mt-2 grid gap-2.5 text-sm">
        {phase.steps.map((s) => (
          <li key={s.id} className="flex gap-2">
            <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-amber-600 dark:bg-amber-400" />
            <span>{s.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StepRow({ step, number, boxLabel, done, onToggle }: { step: BuildStep; number: string; boxLabel: string | null; done: boolean; onToggle: () => void }) {
  return (
    <li>
      <label className="grid cursor-pointer grid-cols-[1.25rem_2.5rem_1fr] items-start gap-x-2 rounded-md px-1 py-2 hover:bg-accent/50 has-focus-visible:outline-2 has-focus-visible:outline-ring">
        <input type="checkbox" checked={done} onChange={onToggle} className="mt-0.5 size-4 accent-primary" />
        <span className="pt-px text-xs text-muted-foreground tabular-nums">{number}</span>
        <span className="min-w-0">
          {boxLabel && <span className="mb-1 mr-2 inline-block rounded border bg-muted px-1.5 py-px align-middle text-[11px] leading-4 font-medium text-muted-foreground">{boxLabel}</span>}
          <span className={cn('text-sm', done && 'text-muted-foreground line-through decoration-muted-foreground/50')}>{step.text}</span>
          {step.note && <span className="mt-1 block text-xs text-muted-foreground">{step.note}</span>}
        </span>
      </label>
    </li>
  );
}

function Checklist({ projectId, circuit, plan }: { projectId: string; circuit: ProjectCircuit; plan: StepsPlan }) {
  const boxLabels = useMemo(() => new Map(circuit.circuit.boxes.map((b) => [b.id, b.label])), [circuit.circuit]);
  const checkable = useMemo(() => plan.phases.filter((p) => p.id !== 'before'), [plan]);
  const validIds = useMemo(() => new Set(checkable.flatMap((p) => p.steps.map((s) => s.id))), [checkable]);
  const [ticked, setTicked] = useState(() => loadProgress(projectId, circuit.id, validIds));

  // Ticks of steps that no longer exist (the circuit changed) are dropped, in the page and in storage.
  const shown = useMemo(() => new Set([...ticked].filter((id) => validIds.has(id))), [ticked, validIds]);
  useEffect(() => saveProgress(projectId, circuit.id, shown), [projectId, circuit.id, shown]);

  const toggle = (id: string) =>
    setTicked((prev) => {
      const next = new Set([...prev].filter((x) => validIds.has(x)));
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const total = validIds.size;

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {shown.size} of {total} steps done
        </p>
        <Button variant="outline" size="sm" disabled={shown.size === 0} onClick={() => setTicked(new Set())}>
          Clear progress
        </Button>
      </div>
      {checkable.map((phase) => {
        const index = plan.phases.indexOf(phase) + 1;
        return (
          <section key={phase.id} aria-labelledby={`phase-${phase.id}`}>
            <h2 id={`phase-${phase.id}`} className="text-sm font-semibold tracking-tight">
              {index}. {phase.title}
            </h2>
            <ol className="mt-1 grid">
              {phase.steps.map((s, i) => (
                <StepRow key={s.id} step={s} number={`${index}.${i + 1}`} boxLabel={s.box ? (boxLabels.get(s.box) ?? null) : null} done={shown.has(s.id)} onToggle={() => toggle(s.id)} />
              ))}
            </ol>
          </section>
        );
      })}
    </>
  );
}

/** The installation steps of one circuit, written by `buildSteps` from the circuit as stored. Progress ticks stay in this browser. */
export function StepsTab({ projectId, circuit }: { projectId: string; circuit: ProjectCircuit }) {
  const result = useMemo(() => {
    try {
      return { plan: buildSteps(circuit.circuit, planOptionsFor(circuit)) };
    } catch (e) {
      return { error: e };
    }
  }, [circuit]);

  if (!result.plan) return <ErrorNotice error={result.error} className="max-w-3xl" />;
  const plan = result.plan;
  const safety = plan.phases.find((p) => p.id === 'before');
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-5 pb-6">
      {plan.unverified && <UnverifiedNotice />}
      <p className="text-sm text-muted-foreground">These steps describe the wiring in the diagram. They are not a guarantee of code compliance.</p>
      {safety && <SafetyPhase phase={safety} />}
      <Checklist projectId={projectId} circuit={circuit} plan={plan} />
    </div>
  );
}
