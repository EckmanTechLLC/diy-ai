import { useCallback, useEffect, useState } from 'react';

const KEY = 'diy-ai.chat-sidebar';
export const SIDEBAR_MIN = 300;
export const SIDEBAR_MAX = 640;
const SIDEBAR_DEFAULT = 384;

interface Prefs {
  collapsed: boolean;
  width: number;
}

const clamp = (w: number) => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(w)));

function load(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>;
    return { collapsed: raw.collapsed === true, width: typeof raw.width === 'number' ? clamp(raw.width) : SIDEBAR_DEFAULT };
  } catch {
    return { collapsed: false, width: SIDEBAR_DEFAULT };
  }
}

/** Chat sidebar width and collapsed state, remembered per browser (layout only; nothing sensitive). */
export function useSidebarPrefs() {
  const [prefs, setPrefs] = useState<Prefs>(load);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      // storage unavailable: the preference just lasts for this visit
    }
  }, [prefs]);
  const setCollapsed = useCallback((collapsed: boolean) => setPrefs((p) => ({ ...p, collapsed })), []);
  const setWidth = useCallback((width: number) => setPrefs((p) => ({ ...p, width: clamp(width) })), []);
  return { ...prefs, setCollapsed, setWidth };
}

/** Whether a media query matches, kept current. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

const CHECKS_KEY = 'diy-ai.checks-panel';

/** Whether the wiring checks panel is open, remembered per browser (layout only). Open by default. */
export function useChecksPanelOpen() {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(CHECKS_KEY) !== 'closed';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(CHECKS_KEY, open ? 'open' : 'closed');
    } catch {
      // storage unavailable: the preference just lasts for this visit
    }
  }, [open]);
  return [open, setOpen] as const;
}
