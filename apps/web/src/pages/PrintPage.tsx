import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { buildMaterials, buildSteps, SAFETY_TEXTS, type CableTotal, type CircuitModel, type MaterialsList, type StepsPlan } from '@diy-ai/core';
import { LIGHT_PALETTE } from '@diy-ai/diagram/theme';
import type { Project, ProjectCircuit } from '@/api/client';
import { useProject } from '@/api/hooks';
import { ErrorNotice, Spinner } from '@/components/feedback';
import { GROUPS } from '@/components/MaterialsTab';
import { NotFound } from '@/components/NotFound';
import { Button } from '@/components/ui/button';
import { planOptionsFor } from '@/lib/buildplan';
import { breakerAmps, circuitCountText } from '@/lib/circuits';
import { describeOrigin, UNVERIFIED_LABEL } from '@/lib/origin';
import { protectionChips, planStatusText, servedText } from '@/lib/plan';
import { PRINT_PARTS, PRINT_PART_LABELS } from '@/lib/printdoc';
import { usePrintParts } from '@/lib/prefs';
import { mergeMaterials, type ShoppingCable, type ShoppingInput } from '@/lib/shopping';
import { cn } from '@/lib/utils';

// ---- diagram layout (the same call and layout mode as the viewer: `auto`, which wraps long circuits) ----

async function renderDiagram(circuit: CircuitModel): Promise<string> {
  const { layoutCircuit, renderSvg } = await import('@diy-ai/diagram');
  const layout = await layoutCircuit(circuit);
  return renderSvg(layout, circuit);
}

function layoutMessage(error: unknown): string {
  const issues = (error as { name?: string; issues?: { code: string; message: string }[] }).issues;
  if ((error as { name?: string }).name === 'InvalidCircuitError' && issues) return `This wiring diagram cannot be drawn because the circuit is invalid: ${issues.map((i) => i.message).join('; ')}`;
  return error instanceof Error ? error.message : 'The diagram could not be laid out.';
}

// ---- small pieces ----

const runs = (n: number) => `${n} ${n === 1 ? 'run' : 'runs'}`;
const allowanceText = (pcts: number[]) => (pcts.length === 1 ? `${pcts[0]}% allowance` : `allowances of ${pcts.map((p) => `${p}%`).join(' and ')}`);

/** Custom wiring is marked in a way that survives black-and-white printing. */
function Unverified({ text }: { text?: string }) {
  return (
    <div className="unverified" role="note">
      <p className="font-bold">{UNVERIFIED_LABEL}</p>
      {text && <p className="mt-0.5">{text}</p>}
    </div>
  );
}

function Missing({ n }: { n: number }) {
  return (
    <span className="font-semibold">
      {runs(n)} still {n === 1 ? 'needs' : 'need'} a length
    </span>
  );
}

interface CableLineData {
  type: string;
  runs: number;
  missing: number;
  knownFt: number;
  totalFt: number;
  pcts: number[];
}
const fromTotal = (t: CableTotal): CableLineData => ({ ...t, pcts: [t.allowancePct] });
const fromMerged = (c: ShoppingCable): CableLineData => ({ ...c, pcts: c.allowancePcts });

function CableLine({ c }: { c: CableLineData }) {
  const known = c.runs - c.missing;
  const pcts = c.pcts;
  return (
    <li className="cable-line">
      <span className="font-semibold">{c.type} cable</span>
      <span>
        {runs(c.runs)}
        {known > 0 && ` · ${c.knownFt} ft entered · ${allowanceText(pcts)}`}
        {c.missing > 0 && (
          <>
            {' · '}
            <Missing n={c.missing} />
          </>
        )}
      </span>
      <span className="font-semibold tabular-nums">{known === 0 ? 'No lengths yet' : `${c.totalFt} ft${c.missing > 0 ? ' so far' : ''}`}</span>
    </li>
  );
}

// ---- front matter ----

function FrontMatter({ project, generated, unverified }: { project: Project; generated: string; unverified: string[] }) {
  const plan = project.plan;
  const status = planStatusText(project);
  return (
    <>
      <header>
        <p className="kicker">Build plan</p>
        <h1 className="doc-title">{project.name}</h1>
        {project.description && <p className="mt-1 whitespace-pre-wrap">{project.description}</p>}
        <p className="meta">
          Generated {generated} · {circuitCountText(project.circuits.length)}
          {status && ` · ${status}`}
        </p>
      </header>

      <section aria-labelledby="print-safety" className="mt-5">
        <h2 id="print-safety">Safety, permits and limits</h2>
        <ul className="plain-list">
          <li>{SAFETY_TEXTS.powerOff}</li>
          <li>{SAFETY_TEXTS.permit}</li>
          <li>{SAFETY_TEXTS.electrician}</li>
          <li>The steps describe the wiring in the diagrams. They are not a guarantee of code compliance.</li>
        </ul>
      </section>

      {unverified.length > 0 && (
        <section className="mt-5">
          <Unverified text={SAFETY_TEXTS.unverified} />
          <p className="mt-1.5 text-sm">
            Unverified circuits: <span className="font-semibold">{unverified.join(', ')}</span>
          </p>
        </section>
      )}

      {plan && plan.circuits.length > 0 && (
        <section aria-labelledby="print-plan" className="mt-5">
          <h2 id="print-plan">The plan</h2>
          <table className="doc-table">
            <thead>
              <tr>
                <th>Circuit</th>
                <th>Breaker</th>
                <th>Rooms served</th>
                <th>Required protection</th>
              </tr>
            </thead>
            <tbody>
              {plan.circuits.map((c, i) => (
                <tr key={i}>
                  <td className="font-semibold">{c.name}</td>
                  <td className="whitespace-nowrap">{c.breakerAmps} A</td>
                  <td>
                    {c.rooms.map((r) => (
                      <div key={r.id}>{servedText(r)}</div>
                    ))}
                  </td>
                  <td>{protectionChips(c.protection).map((x) => x.label).join(', ') || 'None planned'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {plan.reminders.length > 0 && (
            <>
              <h3 className="mt-3">Reminders</h3>
              <ul className="plain-list">
                {plan.reminders.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </>
  );
}

// ---- shopping list ----

function ShoppingSection({ inputs, failed }: { inputs: ShoppingInput[]; failed: string[] }) {
  const list = useMemo(() => mergeMaterials(inputs), [inputs]);
  return (
    <section aria-labelledby="print-shopping" className="print-section">
      <h2 id="print-shopping">Shopping list</h2>
      <p className="meta">All circuits together. Quantities are counted from the wiring in the diagrams.</p>
      {failed.length > 0 && (
        <p role="alert" className="problem">
          Not included, because their materials could not be counted: {failed.join(', ')}.
        </p>
      )}
      {GROUPS.filter((g) => !g.categories.includes('cable_run')).map((g) => {
        const items = list.items.filter((i) => g.categories.includes(i.category));
        if (items.length === 0) return null;
        return (
          <div key={g.title} className="mt-3">
            <h3>{g.title}</h3>
            <table className="doc-table">
              <thead>
                <tr>
                  <th className="w-12 text-right">Qty</th>
                  <th>Item</th>
                  <th className="w-1/4">Used in</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i, n) => (
                  <tr key={n}>
                    <td className="text-right font-semibold tabular-nums">{i.quantity}</td>
                    <td>
                      {i.description}
                      {i.notes.map((note) => (
                        <div key={note} className="note">
                          {note}
                        </div>
                      ))}
                    </td>
                    <td>{i.usedIn.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      {list.cable.length > 0 && (
        <div className="mt-3">
          <h3>Cable</h3>
          <ul className="cable-list">
            {list.cable.map((c) => (
              <CableLine key={c.type} c={fromMerged(c)} />
            ))}
          </ul>
          <p className="note">
            Totals use the lengths you entered, each circuit with its own allowance. Runs without a length are not estimated
            {list.missingRuns > 0 && (
              <>
                : <Missing n={list.missingRuns} /> in all
              </>
            )}
            .
          </p>
        </div>
      )}
      {list.notIncluded.length > 0 && (
        <div className="mt-3">
          <h3>Not included</h3>
          <ul className="plain-list">
            {list.notIncluded.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// ---- one circuit ----

function MaterialsBlock({ list }: { list: MaterialsList }) {
  return (
    <div className="print-block">
      <h3 className="block-title">Materials</h3>
      {GROUPS.map((g) => {
        const items = list.items.filter((i) => g.categories.includes(i.category));
        if (items.length === 0) return null;
        const isCable = g.categories[0] === 'cable_run';
        return (
          <div key={g.title} className="mt-2">
            <h4>{g.title}</h4>
            <table className="doc-table">
              <thead>
                <tr>
                  <th className={isCable ? undefined : 'w-12 text-right'}>{isCable ? 'Run' : 'Qty'}</th>
                  <th className={isCable ? 'w-24 text-right' : undefined}>{isCable ? 'Length' : 'Item'}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) =>
                  isCable ? (
                    <tr key={i.id}>
                      <td>{i.description}</td>
                      <td className="text-right tabular-nums">{i.lengthFt === undefined ? 'not entered' : `${i.lengthFt} ft`}</td>
                    </tr>
                  ) : (
                    <tr key={i.id}>
                      <td className="text-right font-semibold tabular-nums">{i.quantity}</td>
                      <td>
                        {i.description}
                        {i.note && <div className="note">{i.note}</div>}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
            {isCable && (
              <ul className="cable-list">
                {list.cableTotals.map((t) => (
                  <CableLine key={t.type} c={fromTotal(t)} />
                ))}
              </ul>
            )}
          </div>
        );
      })}
      <h4 className="mt-2">Not included</h4>
      <ul className="plain-list">
        {list.notIncluded.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  );
}

function StepsBlock({ plan, circuit }: { plan: StepsPlan; circuit: CircuitModel }) {
  const boxLabels = new Map(circuit.boxes.map((b) => [b.id, b.label]));
  return (
    <div className="print-block">
      <h3 className="block-title">Steps</h3>
      {plan.phases.map((phase, pi) => {
        if (phase.id === 'before')
          return (
            <section key={phase.id} className="safety-phase">
              <h4>{phase.title}</h4>
              <ul className="plain-list">
                {phase.steps.map((s) => (
                  <li key={s.id}>{s.text}</li>
                ))}
              </ul>
            </section>
          );
        return (
          <section key={phase.id} className="mt-3">
            <h4>
              {pi + 1}. {phase.title}
            </h4>
            <ol className="steps">
              {phase.steps.map((s, i) => (
                <li key={s.id} className="step">
                  <span className="tick" aria-hidden />
                  <span className="step-no tabular-nums">
                    {pi + 1}.{i + 1}
                  </span>
                  <span>
                    {s.box && boxLabels.get(s.box) && <span className="box-chip">{boxLabels.get(s.box)}</span>}
                    {s.text}
                    {s.note && <span className="note block">{s.note}</span>}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

function DiagramBlock({ query }: { query: UseQueryResult<string> }) {
  return (
    <div className="print-block diagram-block">
      {query.isPending ? (
        <p role="status" className="diagram-wait">
          <Spinner /> Laying out the wiring diagram...
        </p>
      ) : query.isError ? (
        <p role="alert" className="problem">
          The diagram for this circuit could not be drawn. {layoutMessage(query.error)}
        </p>
      ) : (
        <div className="print-diagram" style={{ background: LIGHT_PALETTE.bg }} dangerouslySetInnerHTML={{ __html: query.data }} />
      )}
    </div>
  );
}

interface Built {
  materials: MaterialsList | null;
  steps: StepsPlan | null;
  error: unknown;
}

function CircuitSection({ c, built, parts, diagram }: { c: ProjectCircuit; built: Built; parts: Record<string, boolean>; diagram: UseQueryResult<string> | null }) {
  const origin = describeOrigin(c.origin);
  const amps = breakerAmps(c.circuit);
  const unverified = c.origin?.kind === 'custom';
  const chips = c.plan ? protectionChips(c.plan.protection).map((x) => x.label) : [];
  return (
    <section className="print-section circuit-section" aria-label={c.name}>
      <div className="print-block heading-block">
        <h2>{c.name}</h2>
        <p className="meta">
          {[amps !== null && `${amps} A breaker`, origin?.kind === 'blocks' && `Built from checked blocks: ${origin.summary}`, origin?.kind === 'template' && `Template: ${origin.title}`, chips.length > 0 && chips.join(', ')]
            .filter(Boolean)
            .join(' · ') || ' '}
        </p>
        {unverified && <Unverified text={SAFETY_TEXTS.unverified} />}
        {parts.diagrams && diagram && <DiagramBlock query={diagram} />}
      </div>
      {built.error !== null && <ErrorNotice error={built.error} className="mt-3" />}
      {parts.materials && built.materials && <MaterialsBlock list={built.materials} />}
      {parts.steps && built.steps && <StepsBlock plan={built.steps} circuit={c.circuit} />}
    </section>
  );
}

// ---- page ----

export function PrintPage() {
  const { id = '' } = useParams();
  const project = useProject(id);
  const [parts, toggle] = usePrintParts();
  const [generated] = useState(() => new Date().toLocaleDateString(undefined, { dateStyle: 'long' }));

  const name = project.data?.name;
  useEffect(() => {
    document.title = name ? `${name} - build plan` : 'Build plan';
    return () => {
      document.title = 'DIY AI';
    };
  }, [name]);

  const circuits = useMemo(() => project.data?.circuits ?? [], [project.data]);
  const diagrams = useQueries({
    queries: circuits.map((c) => ({
      queryKey: ['print-diagram', id, c.id, c.circuit],
      queryFn: () => renderDiagram(c.circuit),
      enabled: parts.diagrams,
      retry: false,
      staleTime: Infinity,
    })),
  });

  const built = useMemo(
    () =>
      circuits.map((c): Built => {
        try {
          const o = planOptionsFor(c);
          return { materials: buildMaterials(c.circuit, o), steps: buildSteps(c.circuit, o), error: null };
        } catch (e) {
          return { materials: null, steps: null, error: e };
        }
      }),
    [circuits],
  );
  const inputs = useMemo(() => circuits.flatMap((c, i) => (built[i]!.materials ? [{ name: c.name, list: built[i]!.materials! }] : [])), [circuits, built]);
  const failed = circuits.filter((_, i) => !built[i]!.materials).map((c) => c.name);

  const toolbar = (ready: boolean, waiting: boolean) => (
    <div className="print-toolbar print:hidden">
      <div className="mx-auto flex max-w-[8.5in] flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5">
        <Button asChild variant="outline" size="sm">
          <Link to={`/projects/${id}`}>
            <ArrowLeft /> Back to project
          </Link>
        </Button>
        <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <legend className="sr-only">Include in the document</legend>
          <span className="text-muted-foreground" aria-hidden>
            Include:
          </span>
          {PRINT_PARTS.map((p) => (
            <label key={p} className="inline-flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={parts[p]} onChange={() => toggle(p)} className="size-4 accent-primary" />
              {PRINT_PART_LABELS[p]}
            </label>
          ))}
        </fieldset>
        <div className="ml-auto flex items-center gap-3">
          {waiting && (
            <span role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Spinner /> Laying out diagrams...
            </span>
          )}
          <Button size="sm" disabled={!ready} onClick={() => window.print()}>
            <Printer /> Print / save as PDF
          </Button>
        </div>
      </div>
    </div>
  );

  if (project.isPending) {
    return (
      <div className="print-root">
        {toolbar(false, false)}
        <p role="status" className="p-8 text-center text-sm text-muted-foreground">
          <Spinner className="mr-2 inline" /> Loading the project...
        </p>
      </div>
    );
  }
  if (project.isError) {
    if ((project.error as { code?: string }).code === 'NOT_FOUND') return <NotFound title="Project not found" message="It may have been deleted, or the link is wrong." />;
    return (
      <div className="mx-auto grid max-w-xl gap-3 p-8">
        <ErrorNotice error={project.error} />
        <div>
          <Button variant="outline" onClick={() => project.refetch()} disabled={project.isFetching}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const p = project.data;
  const waiting = parts.diagrams && diagrams.some((q) => q.isPending);
  const ready = p.circuits.length > 0 && !waiting;
  const unverifiedNames = p.circuits.filter((c) => c.origin?.kind === 'custom').map((c) => c.name);

  return (
    <div className={cn('print-root')}>
      {toolbar(ready, waiting)}
      <main className="print-doc">
        <div className="paper sheet">
          <FrontMatter project={p} generated={generated} unverified={unverifiedNames} />
          {p.circuits.length === 0 && <p className="problem mt-5">This project has no circuits yet, so there is nothing to print.</p>}
          {parts.shopping && inputs.length > 0 && <ShoppingSection inputs={inputs} failed={failed} />}
          {parts.shopping && inputs.length === 0 && p.circuits.length > 0 && (
            <p role="alert" className="problem mt-5">
              The shopping list is empty because the materials of no circuit could be counted.
            </p>
          )}
        </div>
        {p.circuits.map((c, i) => (
          <div key={c.id} className="paper sheet">
            <CircuitSection c={c} built={built[i]!} parts={parts} diagram={diagrams[i] ?? null} />
          </div>
        ))}
      </main>
    </div>
  );
}
