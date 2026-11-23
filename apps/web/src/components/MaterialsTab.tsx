import { useMemo, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { buildMaterials, SAFETY_TEXTS, type CableTotal, type MaterialItem, type MaterialCategory, type MaterialsList } from '@diy-ai/core';
import type { ProjectCircuit } from '@/api/client';
import { useSaveCableLengths } from '@/api/hooks';
import { ErrorNotice } from '@/components/feedback';
import { Input } from '@/components/ui/input';
import { parseAllowance, parseFeet, planOptionsFor, withAllowance, withLength } from '@/lib/buildplan';
import { UNVERIFIED_LABEL } from '@/lib/origin';
import { cn } from '@/lib/utils';

export const GROUPS: { title: string; categories: MaterialCategory[] }[] = [
  { title: 'Breaker', categories: ['breaker'] },
  { title: 'Devices', categories: ['device'] },
  { title: 'Boxes', categories: ['box'] },
  { title: 'Cable', categories: ['cable_run'] },
  { title: 'Wire nuts and pigtails', categories: ['wire_nut', 'pigtail'] },
  { title: 'Cover plates', categories: ['cover_plate'] },
];

/** Custom wiring is marked on every tab. `text` adds the generators' own explanation where the tab does not already show it. */
export function UnverifiedNotice({ text }: { text?: string }) {
  return (
    <div role="note" className="flex gap-2.5 rounded-lg border border-amber-500/60 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-900 dark:text-amber-200">
      <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div>
        <p className="font-medium">{UNVERIFIED_LABEL}</p>
        {text && <p className="mt-0.5">{text}</p>}
      </div>
    </div>
  );
}

/** A number field that saves when the user leaves it or presses Enter, and puts the saved value back on Escape. */
function CommitField({
  value,
  suffix,
  label,
  width,
  describedBy,
  invalid,
  onCommit,
}: {
  value: string;
  suffix: string;
  label: string;
  width: string;
  describedBy?: string;
  invalid: boolean;
  /** Returns whether the text was accepted; a rejected draft stays in the field. */
  onCommit: (text: string) => boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    if (onCommit(draft)) setDraft(null);
  };
  return (
    <span className="inline-flex items-center gap-1.5">
      <Input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={draft ?? value}
        aria-label={label}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape' && draft !== null) {
            e.preventDefault();
            setDraft(null);
            onCommit(value);
          }
        }}
        className={cn('h-8 text-right tabular-nums', width)}
      />
      <span className="w-4 text-xs text-muted-foreground" aria-hidden>
        {suffix}
      </span>
    </span>
  );
}

function ItemList({ items }: { items: MaterialItem[] }) {
  return (
    <ul className="divide-y rounded-lg border bg-card">
      {items.map((i) => (
        <li key={i.id} className="grid grid-cols-[3rem_1fr] gap-x-3 px-3 py-2.5">
          <span className="text-right font-medium tabular-nums">{i.quantity}</span>
          <div className="min-w-0">
            <p className="text-sm">{i.description}</p>
            {i.note && <p className="mt-0.5 text-xs text-muted-foreground">{i.note}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

const runs = (n: number) => `${n} ${n === 1 ? 'run' : 'runs'}`;

function Totals({ totals }: { totals: CableTotal[] }) {
  return (
    <ul className="divide-y rounded-lg border bg-card" aria-label="Cable totals">
      {totals.map((t) => {
        const known = t.runs - t.missing;
        return (
          <li key={t.type} className="grid gap-x-3 gap-y-0.5 px-3 py-2.5 sm:grid-cols-[8rem_1fr_auto] sm:items-baseline">
            <span className="text-sm font-medium">{t.type} cable</span>
            <span className="text-xs text-muted-foreground">
              {runs(t.runs)}
              {known > 0 && ` · ${t.knownFt} ft entered · ${t.allowancePct}% allowance`}
              {t.missing > 0 && (
                <span className="font-medium text-amber-800 dark:text-amber-300">
                  {' · '}
                  {runs(t.missing)} still {t.missing === 1 ? 'needs' : 'need'} a length
                </span>
              )}
            </span>
            <span className="text-sm font-medium tabular-nums sm:text-right">{known === 0 ? 'No lengths yet' : `${t.totalFt} ft${t.missing > 0 ? ' so far' : ''}`}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** The cable runs, each with a field for its length, then totals per cable type and the allowance. */
function CableSection({ circuit, list, projectId }: { circuit: ProjectCircuit; list: MaterialsList; projectId: string }) {
  const save = useSaveCableLengths(projectId);
  const [problem, setProblem] = useState<{ key: string; message: string } | null>(null);
  const runItems = list.items.filter((i) => i.category === 'cable_run');
  const allowance = circuit.cableLengths?.allowancePct ?? list.cableTotals[0]?.allowancePct ?? 0;

  const store = (value: ReturnType<typeof withLength>) => save.mutate({ circuitId: circuit.id, value });
  const accept = (key: string, check: { ok: true } | { ok: false; message: string }) => {
    if (!check.ok) {
      setProblem({ key, message: check.message });
      return false;
    }
    setProblem((p) => (p?.key === key ? null : p));
    return true;
  };
  const messageId = `cable-problem-${circuit.id}`;
  const problemItem = problem ? runItems.find((i) => i.refs[0] === problem.key) : undefined;

  return (
    <div className="grid gap-3">
      {/* one reserved line, so a message never moves the rows */}
      <p id={messageId} role="alert" className="min-h-5 text-xs font-medium text-destructive">
        {problem && (problemItem ? `${problemItem.description}: ${problem.message}` : problem.message)}
      </p>
      {save.isError && <ErrorNotice error={save.error} />}
      <ul className="-mt-2 divide-y rounded-lg border bg-card">
        {runItems.map((i) => {
          const cableId = i.refs[0]!;
          return (
            <li key={i.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0 text-sm">{i.description}</span>
              <CommitField
                value={i.lengthFt === undefined ? '' : String(i.lengthFt)}
                suffix="ft"
                width="w-20"
                label={`Length in feet: ${i.description}`}
                describedBy={problem?.key === cableId ? messageId : undefined}
                invalid={problem?.key === cableId}
                onCommit={(text) => {
                  const parsed = parseFeet(text);
                  if (!accept(cableId, parsed)) return false;
                  if (parsed.ok && parsed.value !== (i.lengthFt ?? null)) store(withLength(circuit.cableLengths, cableId, parsed.value));
                  return true;
                }}
              />
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2">
        <span className="text-sm">Allowance added to the known lengths</span>
        <CommitField
          value={String(allowance)}
          suffix="%"
          width="w-16"
          label="Allowance in percent"
          describedBy={problem?.key === 'allowance' ? messageId : undefined}
          invalid={problem?.key === 'allowance'}
          onCommit={(text) => {
            const parsed = parseAllowance(text);
            if (!accept('allowance', parsed)) return false;
            if (parsed.ok && parsed.value !== allowance) store(withAllowance(circuit.cableLengths, parsed.value));
            return true;
          }}
        />
      </div>
      <Totals totals={list.cableTotals} />
    </div>
  );
}

/** The materials of one circuit, counted by `buildMaterials` from the circuit as stored. */
export function MaterialsTab({ projectId, circuit }: { projectId: string; circuit: ProjectCircuit }) {
  const result = useMemo(() => {
    try {
      return { list: buildMaterials(circuit.circuit, planOptionsFor(circuit)) };
    } catch (e) {
      return { error: e };
    }
  }, [circuit]);

  if (!result.list) return <ErrorNotice error={result.error} className="max-w-3xl" />;
  const list = result.list;
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6 pb-6">
      {list.unverified && <UnverifiedNotice text={SAFETY_TEXTS.unverified} />}
      {GROUPS.map((g) => {
        const items = list.items.filter((i) => g.categories.includes(i.category));
        if (items.length === 0) return null;
        const heading = `materials-${g.title.replace(/\W+/g, '-').toLowerCase()}`;
        return (
          <section key={g.title} aria-labelledby={heading} className="grid gap-2">
            <h2 id={heading} className="text-sm font-semibold tracking-tight">
              {g.title}
            </h2>
            {g.categories[0] === 'cable_run' ? <CableSection circuit={circuit} list={list} projectId={projectId} /> : <ItemList items={items} />}
          </section>
        );
      })}
      <section aria-labelledby="materials-not-included" className="grid gap-2">
        <h2 id="materials-not-included" className="text-sm font-semibold tracking-tight">
          Not included
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {list.notIncluded.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
