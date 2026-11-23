import { useCallback, useSyncExternalStore } from 'react';

type Theme = 'light' | 'dark';

let override: Theme | null = null; // used when storage is unavailable

const media = () => matchMedia('(prefers-color-scheme: dark)');

function stored(): Theme | null {
  if (override) return override;
  try {
    const v = localStorage.getItem('theme');
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

function apply(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
}

const current = (): Theme => stored() ?? (media().matches ? 'dark' : 'light');

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function subscribe(cb: () => void) {
  listeners.add(cb);
  const mq = media();
  // Follow the OS setting until the user has made an explicit choice.
  const onOs = () => {
    if (!stored()) {
      apply(current());
      cb();
    }
  };
  mq.addEventListener('change', onOs);
  return () => {
    listeners.delete(cb);
    mq.removeEventListener('change', onOs);
  };
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const theme = useSyncExternalStore(subscribe, current, () => 'light' as Theme);
  const toggle = useCallback(() => {
    const next: Theme = current() === 'dark' ? 'light' : 'dark';
    override = next;
    try {
      localStorage.setItem('theme', next);
    } catch {
      // storage unavailable: the choice applies for this session only
    }
    apply(next);
    emit();
  }, []);
  return { theme, toggle };
}
