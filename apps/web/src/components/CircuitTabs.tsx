import { useRef, type KeyboardEvent } from 'react';
import { TABS, TAB_LABELS, type Tab } from '@/lib/buildplan';
import { cn } from '@/lib/utils';

export const tabId = (t: Tab) => `circuit-tab-${t}`;
export const panelId = (t: Tab) => `circuit-panel-${t}`;

/** Diagram / Materials / Steps. Arrow keys, Home and End move between tabs. */
export function CircuitTabs({ value, onChange }: { value: Tab; onChange: (t: Tab) => void }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKeyDown = (e: KeyboardEvent) => {
    const i = TABS.indexOf(value);
    const next =
      e.key === 'ArrowRight' ? TABS[(i + 1) % TABS.length] : e.key === 'ArrowLeft' ? TABS[(i + TABS.length - 1) % TABS.length] : e.key === 'Home' ? TABS[0] : e.key === 'End' ? TABS[TABS.length - 1] : undefined;
    if (!next) return;
    e.preventDefault();
    onChange(next);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label="Circuit views" onKeyDown={onKeyDown} className="flex shrink-0 gap-1 border-b">
      {TABS.map((t) => {
        const selected = t === value;
        return (
          <button
            key={t}
            ref={(el) => {
              refs.current[t] = el;
            }}
            role="tab"
            id={tabId(t)}
            type="button"
            aria-selected={selected}
            aria-controls={panelId(t)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t)}
            className={cn(
              '-mb-px rounded-t-md border-b-2 px-3.5 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
              selected ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {TAB_LABELS[t]}
          </button>
        );
      })}
    </div>
  );
}
