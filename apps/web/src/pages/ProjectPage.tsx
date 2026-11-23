import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CircuitModel } from '@diy-ai/core';
import { Link, useParams, useSearchParams } from 'react-router';
import { Pencil, Trash2, CircuitBoard, MessageSquare, Printer } from 'lucide-react';
import { useProject } from '@/api/hooks';
import { ChatSidebar } from '@/components/chat/ChatSidebar';
import { CircuitList } from '@/components/CircuitList';
import { CircuitTabs, panelId, tabId } from '@/components/CircuitTabs';
import { ChecksPanel, StatusIcon, statusTone } from '@/components/ChecksPanel';
import type { FindingFocus } from '@/components/DiagramCanvas';
import { DiagramView } from '@/components/DiagramView';
import { ErrorNotice } from '@/components/feedback';
import { NotFound } from '@/components/NotFound';
import { FromThePlan } from '@/components/FromThePlan';
import { MaterialsTab } from '@/components/MaterialsTab';
import { StepsTab } from '@/components/StepsTab';
import { OriginBadge } from '@/components/OriginBadge';
import { ProtectionChips } from '@/components/PlanParts';
import { DeleteProjectDialog, EditProjectDialog } from '@/components/ProjectDialogs';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { checkForDisplay, findingHighlight, isEmptyHighlight, statusBadgeText, statusOf, type FindingGroup } from '@/lib/findings';
import { isTab, parseTab, type Tab } from '@/lib/buildplan';
import { pickCircuit } from '@/lib/circuits';
import { describeOrigin } from '@/lib/origin';
import { useChecksPanelOpen } from '@/lib/prefs';
import { fullDate, relativeTime } from '@/lib/time';

export function ProjectPage() {
  const { id = '' } = useParams();
  const project = useProject(id);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // bumped to ask the chat sidebar to open and focus its composer
  const [focusSignal, setFocusSignal] = useState(0);

  const [checksOpen, setChecksOpen] = useChecksPanelOpen();
  const [revealChecks, setRevealChecks] = useState(0);

  // The selected circuit lives in the URL (?circuit=<id>) so a reload or a link keeps it; the first circuit is the default.
  const [params, setParams] = useSearchParams();
  const selectedCircuit = pickCircuit(project.data?.circuits ?? [], params.get('circuit'));
  const circuit = selectedCircuit?.circuit ?? null;
  const selectCircuit = useCallback(
    (circuitId: string) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('circuit', circuitId);
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  // The tab lives in the URL too (?tab=materials|steps); the diagram is the default, and an unknown value falls back to it.
  const tabParam = params.get('tab');
  const tab = parseTab(tabParam);
  const selectTab = useCallback(
    (next: Tab) =>
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next === 'diagram') p.delete('tab');
          else p.set('tab', next);
          return p;
        },
        { replace: true },
      ),
    [setParams],
  );
  useEffect(() => {
    if (tabParam !== null && !isTab(tabParam)) selectTab('diagram');
  }, [tabParam, selectTab]);
  // Checked in the browser so the panel is current for any stored circuit; memoised per circuit object.
  const findings = useMemo(() => (circuit ? checkForDisplay(circuit) : []), [circuit]);
  const status = useMemo(() => statusOf(findings), [findings]);
  // A highlight belongs to one circuit object: after another circuit is selected, or this one is replaced, it no longer counts.
  const [focusState, setFocus] = useState<(FindingFocus & { ruleId: string; circuit: CircuitModel }) | null>(null);
  const focus = focusState && focusState.circuit === circuit ? focusState : null;
  // and it is dropped for good, so coming back to a circuit later does not light up an old finding
  useEffect(() => setFocus(null), [circuit]);

  const pick = useCallback(
    (g: FindingGroup | null) => {
      if (!g || !circuit) return setFocus(null);
      const highlight = findingHighlight(circuit, g.involved);
      setFocus(isEmptyHighlight(highlight) ? null : { ruleId: g.ruleId, key: g.ruleId, highlight, circuit });
    },
    [circuit],
  );
  const showChecks = useCallback(() => {
    // the checks panel belongs to the Diagram tab
    selectTab('diagram');
    setChecksOpen(true);
    setRevealChecks((n) => n + 1);
  }, [setChecksOpen, selectTab]);

  const name = project.data?.name;
  useEffect(() => {
    document.title = name ? `${name} - DIY AI` : 'DIY AI';
    return () => {
      document.title = 'DIY AI';
    };
  }, [name]);

  if (project.isPending) {
    return (
      <div className="mx-auto max-w-6xl p-4 sm:p-8" aria-busy="true" aria-label="Loading project">
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="mt-3 h-4 w-96 max-w-full animate-pulse rounded bg-muted" />
        <div className="mt-8 h-96 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }
  if (project.isError) {
    if ((project.error as { code?: string }).code === 'NOT_FOUND') {
      return <NotFound title="Project not found" message="It may have been deleted, or the link is wrong." />;
    }
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
  const actions = (
    <div className="flex shrink-0 gap-2">
      {p.circuits.length > 0 && (
        <Button asChild variant="outline" size="sm">
          <Link to={`/projects/${p.id}/print`} aria-label="Build plan: print or save as PDF">
            <Printer /> <span className="max-sm:sr-only">Build plan</span>
          </Link>
        </Button>
      )}
      <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} aria-label="Edit project">
        <Pencil /> <span className="max-sm:sr-only">Edit</span>
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setDeleteOpen(true)}
        className="text-destructive hover:text-destructive"
        aria-label="Delete project"
      >
        <Trash2 /> <span className="max-sm:sr-only">Delete</span>
      </Button>
    </div>
  );
  const dialogs = (
    <>
      <EditProjectDialog project={p} open={editOpen} onOpenChange={setEditOpen} />
      <DeleteProjectDialog project={p} open={deleteOpen} onOpenChange={setDeleteOpen} />
    </>
  );

  const origin = selectedCircuit ? describeOrigin(selectedCircuit.origin) : null;
  const withChat = (content: React.ReactNode) => (
    <div className="flex h-full min-h-0">
      <div className="h-full min-w-0 flex-1 overflow-y-auto">{content}</div>
      <ChatSidebar
        project={p}
        selected={selectedCircuit ? { id: selectedCircuit.id, name: selectedCircuit.name } : null}
        onSelectCircuit={selectCircuit}
        focusSignal={focusSignal}
        autoFocusComposer={!selectedCircuit}
        onShowChecks={showChecks}
      />
    </div>
  );

  if (selectedCircuit) {
    // The diagram is the page: a compact header, then a canvas that takes all the remaining space.
    return withChat(
      <div className="flex h-full min-h-0 flex-col gap-3 p-3 sm:p-4">
        <header className="flex shrink-0 items-center gap-x-4">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg leading-tight font-semibold tracking-tight" title={p.name}>
              {p.name}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              {origin && <OriginBadge info={origin} />}
              {selectedCircuit.plan && <ProtectionChips protection={selectedCircuit.plan.protection} />}
              <button
                type="button"
                onClick={showChecks}
                className={cn('inline-flex items-center gap-1.5 rounded-md text-xs font-medium underline-offset-2 hover:underline', statusTone(status.kind))}
                title="Wiring-logic checks only. This is not a code-compliance review. Click to see the checks."
              >
                <StatusIcon status={status.kind} className="size-3.5" />
                {statusBadgeText(status)}
              </button>
            </div>
            <p className="flex gap-1.5 text-xs text-muted-foreground">
              <span className="shrink-0" title={fullDate(p.updatedAt)}>
                Updated {relativeTime(p.updatedAt)}
              </span>
              {p.description && (
                <span className="truncate" title={p.description}>
                  · {p.description}
                </span>
              )}
            </p>
          </div>
          {actions}
        </header>
        <CircuitList projectId={p.id} circuits={p.circuits} selectedId={selectedCircuit.id} onSelect={selectCircuit} />
        <CircuitTabs value={tab} onChange={selectTab} />
        <div role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)} className={cn('flex min-h-0 flex-1 flex-col', tab === 'diagram' ? 'gap-3' : 'overflow-y-auto pt-1')}>
          {tab === 'diagram' && (
            <>
              <DiagramView projectId={p.id} circuitId={selectedCircuit.id} circuit={selectedCircuit.circuit} focus={focus} onFocusChange={() => setFocus(null)} />
              {selectedCircuit.plan && <FromThePlan info={selectedCircuit.plan} />}
              <ChecksPanel
                findings={findings}
                status={status}
                open={checksOpen}
                onOpenChange={setChecksOpen}
                activeRule={focus?.ruleId ?? null}
                onPick={pick}
                revealSignal={revealChecks}
              />
            </>
          )}
          {tab === 'materials' && <MaterialsTab key={selectedCircuit.id} projectId={p.id} circuit={selectedCircuit} />}
          {tab === 'steps' && <StepsTab key={selectedCircuit.id} projectId={p.id} circuit={selectedCircuit} />}
        </div>
        {dialogs}
      </div>,
    );
  }

  return withChat(
    <div className="mx-auto max-w-6xl p-4 sm:p-8">
      <header className="mb-6 flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="text-2xl font-semibold tracking-tight break-words">{p.name}</h1>
          {p.description && <p className="mt-1.5 max-w-prose whitespace-pre-wrap text-muted-foreground">{p.description}</p>}
          <p className="mt-2 text-xs text-muted-foreground" title={fullDate(p.updatedAt)}>
            Updated {relativeTime(p.updatedAt)}
          </p>
        </div>
        {actions}
      </header>

      <section className="grid justify-items-center gap-2 rounded-xl border border-dashed px-6 py-20 text-center">
        <div className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
          <CircuitBoard className="size-6" />
        </div>
        <h2 className="text-lg font-medium">No wiring has been designed yet</h2>
        <p className="max-w-sm text-sm text-muted-foreground">Describe the job in the chat and the assistant will draw the wiring diagram here.</p>
        <Button className="mt-2" onClick={() => setFocusSignal((n) => n + 1)}>
          <MessageSquare /> Describe the job in chat
        </Button>
      </section>

      {dialogs}
    </div>,
  );
}
