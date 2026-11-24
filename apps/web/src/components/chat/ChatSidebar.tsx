import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ArrowDown, Eraser, MessageSquare, PanelRightClose, PanelRightOpen, X } from 'lucide-react';
import { type Project } from '@/api/client';
import { isOptimistic, useBuildPlan, useClaudeModels, useClearMessages, useLlmStatus, useMessages, usePendingSince, useSendMessage } from '@/api/hooks';
import { activeModelName } from '@/components/settings/ActiveModelCard';
import { PlanStatus } from '@/components/chat/PlanStatus';
import { Composer } from '@/components/chat/Composer';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ErrorNotice, Spinner } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import { currentPlanMessageId, proposalIsCurrent } from '@/lib/plan';
import { SIDEBAR_MAX, SIDEBAR_MIN, useMediaQuery, useSidebarPrefs } from '@/lib/prefs';
import { cn } from '@/lib/utils';

const PIN_SLACK_PX = 48;

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Seconds since `since`, updated every second while it is set. */
function useElapsed(since: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  return since === null ? 0 : now - since;
}

function Thinking({ since }: { since: number }) {
  const elapsed = useElapsed(since);
  return (
    <div className="flex justify-start">
      <div role="status" className="max-w-[92%] rounded-xl rounded-bl-sm bg-muted px-3 py-2 text-sm">
        <span className="sr-only">Waiting for the model's reply</span>
        <p className="flex items-center gap-2" aria-hidden>
          <Spinner /> Thinking... <span className="tabular-nums text-muted-foreground">{clock(elapsed)}</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">Some models take minutes. You can keep using the rest of the page.</p>
      </div>
    </div>
  );
}

function ResizeHandle({ width, onWidth }: { width: number; onWidth: (w: number) => void }) {
  const drag = useRef<{ x: number; w: number } | null>(null);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = { x: e.clientX, w: width };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current) onWidth(drag.current.w + (drag.current.x - e.clientX));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') onWidth(width + 24);
    else if (e.key === 'ArrowRight') onWidth(width - 24);
    else return;
    e.preventDefault();
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize chat. Arrow keys change the width."
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onKeyDown={onKeyDown}
      className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none transition-colors hover:bg-ring/30 focus-visible:bg-ring/40 focus-visible:outline-none"
    />
  );
}

export function ChatSidebar({
  project,
  selected,
  onSelectCircuit,
  focusSignal,
  autoFocusComposer,
  onShowChecks,
}: {
  project: Project;
  /** The circuit shown on the page; sent with every message so the model knows what "this one" is. */
  selected: { id: string; name: string } | null;
  onSelectCircuit: (id: string) => void;
  focusSignal: number;
  autoFocusComposer: boolean;
  /** Opens the page's wiring checks panel. */
  onShowChecks?: () => void;
}) {
  const wide = useMediaQuery('(min-width: 1024px)');
  const prefs = useSidebarPrefs();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [clearOpen, setClearOpen] = useState(false);
  const [wantFocus, setWantFocus] = useState(() => autoFocusComposer && window.matchMedia('(min-width: 1024px)').matches);
  const [pinned, setPinned] = useState(true);

  const status = useLlmStatus();
  const claudeModels = useClaudeModels(false); // cache only: names are shown when the settings page loaded them
  const messages = useMessages(project.id);
  const send = useSendMessage(project.id);
  const build = useBuildPlan(project.id);
  // Proposals the user dismissed with "Not now": for this visit only, no server call.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const clear = useClearMessages(project.id);
  const since = usePendingSince(project.id);
  const pending = since !== null;

  const visible = wide ? !prefs.collapsed : drawerOpen;
  const noModel = status.data ? activeModelName(status.data) === null : false;
  const modelName = status.data
    ? activeModelName(status.data, new Map((claudeModels.data ?? []).map((m) => [m.id, m.displayName])))
    : null;

  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  const lastSent = useRef('');

  // "Describe the job in the chat" from the empty state
  const firstSignal = useRef(focusSignal);
  useEffect(() => {
    if (focusSignal === firstSignal.current) return;
    prefs.setCollapsed(false);
    setDrawerOpen(true);
    setWantFocus(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSignal]);
  useEffect(() => {
    if (!wantFocus || !visible) return;
    const el = textarea.current;
    if (el && !el.disabled) el.focus({ preventScroll: true });
    setWantFocus(false);
  }, [wantFocus, visible, noModel, status.isPending]);

  // close the drawer with Escape
  useEffect(() => {
    if (wide || !drawerOpen) return;
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [wide, drawerOpen]);

  const list = messages.data ?? [];
  const currentPlanId = currentPlanMessageId(list);

  // stay on the newest message unless the user has scrolled up
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [list.length, pending, visible, messages.isPending]);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < PIN_SLACK_PX;
    pinnedRef.current = atBottom;
    setPinned(atBottom);
  };
  const jumpToLatest = () => {
    const el = scroller.current;
    if (!el) return;
    pinnedRef.current = true;
    setPinned(true);
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  const submit = (text: string) => {
    lastSent.current = text;
    pinnedRef.current = true;
    setPinned(true);
    setDraft('');
    // the text comes back into the box if sending fails, so nothing typed is lost
    send.mutate(
      { content: text, selectedCircuitId: selected?.id },
      {
        onError: () => setDraft((d) => d || text),
        // the circuit the reply added or replaced, or the first one a plan build created, becomes the selected one
        onSuccess: (res) => {
          const next = res.affectedCircuitId ?? res.assistantMessage.createdCircuitIds?.[0] ?? null;
          if (next) onSelectCircuit(next);
        },
      },
    );
  };
  const onBuilt = (ids: string[]) => {
    // the first circuit the build created becomes the selected one
    const first = ids[0];
    if (first) onSelectCircuit(first);
  };
  const buildFromCard = () => {
    build.reset();
    build.mutate(undefined, { onSuccess: (res) => onBuilt(res.createdCircuitIds) });
  };
  const retry = () => {
    const text = lastSent.current;
    if (!text) return;
    setDraft((d) => (d === text ? '' : d));
    submit(text);
  };

  if (!visible && wide) {
    return (
      <aside aria-label="Chat" className="flex w-11 shrink-0 flex-col items-center border-l bg-sidebar py-2">
        <Button variant="ghost" size="icon" onClick={() => prefs.setCollapsed(false)} aria-label="Open chat" title="Open chat">
          <PanelRightOpen />
        </Button>
        {pending && <Spinner className="mt-3 text-muted-foreground" />}
      </aside>
    );
  }

  const panel = (
    <aside
      aria-label="Chat"
      className={cn(
        'relative flex min-h-0 flex-col border-l bg-sidebar',
        wide ? 'shrink-0' : 'fixed inset-y-0 right-0 z-40 w-[min(26rem,100vw)] shadow-xl',
        !visible && 'hidden',
      )}
      style={wide ? { width: prefs.width } : undefined}
    >
      {wide && <ResizeHandle width={prefs.width} onWidth={prefs.setWidth} />}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
        <MessageSquare className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm leading-tight font-semibold">Chat</h2>
          {modelName && (
            <p className="truncate text-xs text-muted-foreground" title={`Model: ${modelName}`}>
              {modelName}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => {
            clear.reset();
            setClearOpen(true);
          }}
          disabled={list.length === 0 || pending}
          aria-label="Clear conversation"
          title="Clear conversation"
        >
          <Eraser />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => (wide ? prefs.setCollapsed(true) : setDrawerOpen(false))}
          aria-label="Close chat"
          title="Close chat"
        >
          {wide ? <PanelRightClose /> : <X />}
        </Button>
      </header>

      <div className="relative min-h-0 flex-1">
        <div ref={scroller} onScroll={onScroll} className="absolute inset-0 overflow-y-auto overscroll-contain" role="log" aria-label="Conversation" aria-live="polite">
          <div className="grid gap-3 p-3">
            {messages.isPending ? (
              <div className="grid gap-3" aria-busy="true" aria-label="Loading conversation">
                <div className="ml-auto h-9 w-2/3 animate-pulse rounded-xl bg-muted" />
                <div className="h-14 w-3/4 animate-pulse rounded-xl bg-muted" />
              </div>
            ) : messages.isError ? (
              <div className="grid gap-2">
                <ErrorNotice error={messages.error} />
                <div>
                  <Button variant="outline" size="sm" onClick={() => messages.refetch()} disabled={messages.isFetching}>
                    Try again
                  </Button>
                </div>
              </div>
            ) : list.length === 0 && !pending ? (
              <p className="px-1 py-6 text-center text-sm text-muted-foreground">
                Describe the wiring job in your own words. The assistant may ask questions before it draws the diagram.
              </p>
            ) : (
              list.map((m) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  pending={isOptimistic(m)}
                  planState={m.id !== currentPlanId ? 'superseded' : project.plan ? 'current' : 'discarded'}
                  proposal={
                    m.kind === 'build_proposed'
                      ? {
                          state: dismissed.has(m.id) ? 'dismissed' : proposalIsCurrent(m, list, project) ? 'current' : 'stale',
                          pending: build.isPending,
                          error: build.error,
                          onBuild: buildFromCard,
                          onDismiss: () => setDismissed((d) => new Set(d).add(m.id)),
                        }
                      : undefined
                  }
                  circuits={project.circuits}
                  onSelectCircuit={(id) => {
                    if (!wide) setDrawerOpen(false);
                    onSelectCircuit(id);
                  }}
                  onShowChecks={
                    onShowChecks &&
                    (() => {
                      if (!wide) setDrawerOpen(false);
                      onShowChecks();
                    })
                  }
                />
              ))
            )}
            {pending && <Thinking since={since} />}
          </div>
        </div>
        {!pinned && (
          <Button size="sm" variant="outline" className="absolute right-3 bottom-2 rounded-full shadow-md" onClick={jumpToLatest}>
            <ArrowDown /> Latest
          </Button>
        )}
      </div>

      <div className="grid shrink-0 gap-2 border-t p-3">
        <PlanStatus project={project} disabled={pending} build={build} onBuilt={onBuilt} />
        {send.isError && !pending && (
          <div className="grid gap-1.5">
            <ErrorNotice error={send.error} />
            <div>
              <Button variant="outline" size="sm" onClick={retry}>
                Send again
              </Button>
            </div>
          </div>
        )}
        {!noModel && (
          <p
            className="truncate text-xs text-muted-foreground"
            title="New wiring is added as another circuit. The selected circuit is changed only when you ask for that."
          >
            Adding to this project
            {selected && (
              <>
                {' · '}selected: <span className="font-medium text-foreground">{selected.name}</span>
              </>
            )}
          </p>
        )}
        <Composer textareaRef={textarea} draft={draft} onDraft={setDraft} onSend={submit} pending={pending} noModel={noModel} />
      </div>

      <ConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title="Clear this conversation?"
        description="The messages are deleted. The circuits stay as they are."
        confirmLabel="Clear conversation"
        pending={clear.isPending}
        error={clear.error}
        onConfirm={() => clear.mutate(undefined, { onSuccess: () => setClearOpen(false) })}
      />
    </aside>
  );

  if (wide) return panel;
  return (
    <>
      {drawerOpen && (
        <button type="button" tabIndex={-1} aria-label="Close chat" className="fixed inset-0 z-30 bg-black/50" onClick={() => setDrawerOpen(false)} />
      )}
      {panel}
      {!drawerOpen && (
        <Button className="fixed right-4 bottom-4 z-20 rounded-full shadow-lg" onClick={() => { setDrawerOpen(true); setWantFocus(true); }} aria-label="Open chat">
          {pending ? <Spinner /> : <MessageSquare />} Chat
        </Button>
      )}
    </>
  );
}
