import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Pencil, ShieldAlert, Trash2, X } from 'lucide-react';
import type { ProjectCircuit } from '@/api/client';
import { useDeleteCircuit, useRenameCircuit, useReorderCircuits } from '@/api/hooks';
import { StatusIcon, statusTone } from '@/components/ChecksPanel';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ErrorNotice } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { breakerAmps, moved, neighbourAfterDelete, summarize } from '@/lib/circuits';
import { checkForDisplay, statusBadgeText, statusOf } from '@/lib/findings';
import { cn } from '@/lib/utils';

const iconButton = 'size-7';

function RenameForm({
  circuit,
  pending,
  onSave,
  onCancel,
}: {
  circuit: ProjectCircuit;
  pending: boolean;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(circuit.name);
  const name = draft.trim();
  const valid = name.length >= 1 && name.length <= 80;
  return (
    <form
      className="flex min-w-0 flex-1 items-center gap-1 px-2 py-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid || pending) return;
        if (name === circuit.name) onCancel();
        else onSave(name);
      }}
    >
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
        onFocus={(e) => e.currentTarget.select()}
        maxLength={80}
        disabled={pending}
        aria-label={`Name of ${circuit.name}`}
        aria-invalid={!valid}
        className="h-8 min-w-0 flex-1"
      />
      <Button type="submit" variant="ghost" size="icon" className={iconButton} disabled={!valid || pending} aria-label="Save name" title="Save name (Enter)">
        <Check />
      </Button>
      <Button type="button" variant="ghost" size="icon" className={iconButton} onClick={onCancel} disabled={pending} aria-label="Cancel renaming" title="Cancel (Esc)">
        <X />
      </Button>
    </form>
  );
}

function Row({
  circuit,
  index,
  count,
  selected,
  editing,
  renaming,
  busy,
  onSelect,
  onEdit,
  onSave,
  onCancel,
  onMove,
  onDelete,
  registerMove,
}: {
  circuit: ProjectCircuit;
  index: number;
  count: number;
  selected: boolean;
  editing: boolean;
  renaming: boolean;
  /** A write is running, so the buttons that start another one wait. */
  busy: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onSave: (name: string) => void;
  onCancel: () => void;
  onMove: (delta: -1 | 1) => void;
  onDelete: () => void;
  registerMove: (key: string, el: HTMLButtonElement | null) => void;
}) {
  // checked in the browser, memoised per circuit object
  const status = useMemo(() => statusOf(checkForDisplay(circuit.circuit)), [circuit.circuit]);
  const summary = summarize(circuit);
  const amps = breakerAmps(circuit.circuit);

  return (
    <li className={cn('flex items-center gap-0.5 pr-1', selected && 'bg-accent text-accent-foreground')}>
      {editing ? (
        <RenameForm circuit={circuit} pending={renaming} onSave={onSave} onCancel={onCancel} />
      ) : (
        <button
          type="button"
          onClick={onSelect}
          aria-current={selected ? 'true' : undefined}
          className="grid min-w-0 flex-1 gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent/60"
          title={`${circuit.name}. ${statusBadgeText(status)}.`}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className={cn('flex shrink-0', statusTone(status.kind))}>
              <StatusIcon status={status.kind} className="size-3.5" />
              <span className="sr-only">{statusBadgeText(status)}</span>
            </span>
            <span className="min-w-0 truncate text-sm font-medium">{circuit.name}</span>
            {amps !== null && <span className="shrink-0 text-xs text-muted-foreground">{amps} A</span>}
          </span>
          <span
            className={cn(
              'flex min-w-0 items-center gap-1.5 pl-[1.375rem] text-xs',
              summary.kind === 'custom' ? 'font-medium text-amber-900 dark:text-amber-200' : 'text-muted-foreground',
            )}
          >
            {summary.kind === 'custom' && <ShieldAlert className="size-3.5 shrink-0" aria-hidden />}
            <span className="truncate">{summary.text}</span>
          </span>
        </button>
      )}
      {!editing && (
        <div className="flex shrink-0 items-center">
          <Button variant="ghost" size="icon" className={iconButton} onClick={onEdit} disabled={busy} aria-label={`Rename ${circuit.name}`} title="Rename">
            <Pencil />
          </Button>
          <Button
            ref={(el: HTMLButtonElement | null) => registerMove(`${circuit.id}:-1`, el)}
            variant="ghost"
            size="icon"
            className={iconButton}
            onClick={() => onMove(-1)}
            disabled={busy || index === 0}
            aria-label={`Move ${circuit.name} up`}
            title="Move up"
          >
            <ArrowUp />
          </Button>
          <Button
            ref={(el: HTMLButtonElement | null) => registerMove(`${circuit.id}:1`, el)}
            variant="ghost"
            size="icon"
            className={iconButton}
            onClick={() => onMove(1)}
            disabled={busy || index === count - 1}
            aria-label={`Move ${circuit.name} down`}
            title="Move down"
          >
            <ArrowDown />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn(iconButton, 'text-destructive hover:text-destructive')}
            onClick={onDelete}
            disabled={busy}
            aria-label={`Delete ${circuit.name}`}
            title="Delete"
          >
            <Trash2 />
          </Button>
        </div>
      )}
    </li>
  );
}

/** The circuits of a project in order: pick one, rename it, move it, delete it. */
export function CircuitList({
  projectId,
  circuits,
  selectedId,
  onSelect,
}: {
  projectId: string;
  circuits: ProjectCircuit[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const rename = useRenameCircuit(projectId);
  const reorder = useReorderCircuits(projectId);
  const remove = useDeleteCircuit(projectId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ProjectCircuit | null>(null);
  const moveButtons = useRef(new Map<string, HTMLButtonElement>());
  // after a move the button is put back in focus (the browser drops focus when the row's node moves)
  const refocus = useRef<{ id: string; delta: -1 | 1 } | null>(null);

  const busy = rename.isPending || reorder.isPending || remove.isPending;

  useEffect(() => {
    const target = refocus.current;
    if (!target) return;
    refocus.current = null;
    const same = moveButtons.current.get(`${target.id}:${target.delta}`);
    const other = moveButtons.current.get(`${target.id}:${-target.delta}`);
    (same && !same.disabled ? same : other)?.focus();
  }, [circuits]);

  // a circuit that is gone cannot stay in edit mode
  useEffect(() => {
    if (editingId && !circuits.some((c) => c.id === editingId)) setEditingId(null);
  }, [circuits, editingId]);

  const move = (index: number, delta: -1 | 1) => {
    const ids = moved(
      circuits.map((c) => c.id),
      index,
      delta,
    );
    if (!ids) return;
    rename.reset();
    remove.reset();
    refocus.current = { id: circuits[index]!.id, delta };
    reorder.mutate(ids, { onError: () => (refocus.current = null) });
  };

  const error = rename.error ?? reorder.error;

  return (
    <section aria-label="Circuits" className="shrink-0 rounded-xl border bg-card text-card-foreground shadow-xs">
      <h2 className="flex items-baseline gap-2 border-b px-3 py-1.5 text-sm font-semibold">
        Circuits <span className="text-xs font-normal text-muted-foreground">{circuits.length}</span>
      </h2>
      <ul className="max-h-48 divide-y overflow-y-auto overscroll-contain rounded-b-xl" aria-label="Circuits in this project">
        {circuits.map((c, i) => (
          <Row
            key={c.id}
            circuit={c}
            index={i}
            count={circuits.length}
            selected={c.id === selectedId}
            editing={editingId === c.id}
            renaming={rename.isPending}
            busy={busy}
            onSelect={() => onSelect(c.id)}
            onEdit={() => {
              rename.reset();
              reorder.reset();
              setEditingId(c.id);
            }}
            onSave={(name) => rename.mutate({ circuitId: c.id, name }, { onSuccess: () => setEditingId(null) })}
            onCancel={() => {
              rename.reset();
              setEditingId(null);
            }}
            onMove={(delta) => move(i, delta)}
            onDelete={() => {
              remove.reset();
              setDeleting(c);
            }}
            registerMove={(key, el) => {
              if (el) moveButtons.current.set(key, el);
              else moveButtons.current.delete(key);
            }}
          />
        ))}
      </ul>
      {error ? <ErrorNotice error={error} className="m-2" /> : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={deleting ? `Delete "${deleting.name}"?` : 'Delete circuit?'}
        description="This circuit and its wiring diagram are removed from the project. Chat messages that created it stay, marked as deleted. This cannot be undone."
        confirmLabel="Delete circuit"
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => {
          if (!deleting) return;
          const gone = deleting.id;
          const next = gone === selectedId ? neighbourAfterDelete(circuits, gone) : null;
          remove.mutate(gone, {
            onSuccess: () => {
              setDeleting(null);
              if (next) onSelect(next);
            },
          });
        }}
      />
    </section>
  );
}
