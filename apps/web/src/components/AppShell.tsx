import { createContext, useContext, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { Menu, Plus, Settings, Zap } from 'lucide-react';
import { useProjects } from '@/api/hooks';
import { ErrorNotice } from '@/components/feedback';
import { CreateProjectDialog } from '@/components/ProjectDialogs';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import { circuitCountText } from '@/lib/circuits';
import { relativeTime, fullDate } from '@/lib/time';
import { cn } from '@/lib/utils';

const CreateDialogContext = createContext<() => void>(() => {});
export const useOpenCreateDialog = () => useContext(CreateDialogContext);

/** Re-renders every minute so relative times stay current. */
function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function ProjectList() {
  const projects = useProjects();
  const now = useNow();

  if (projects.isPending) {
    return (
      <div className="grid gap-1 px-2" aria-busy="true" aria-label="Loading projects">
        {[0, 1, 2].map((i) => (
          <div key={i} className="grid gap-1.5 rounded-md px-3 py-2">
            <div className="h-3.5 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    );
  }
  if (projects.isError) {
    return (
      <div className="grid gap-2 px-3">
        <ErrorNotice error={projects.error} />
        <Button variant="outline" size="sm" onClick={() => projects.refetch()} disabled={projects.isFetching}>
          Try again
        </Button>
      </div>
    );
  }
  if (projects.data.length === 0) {
    return <p className="px-5 text-sm text-muted-foreground">No projects yet.</p>;
  }
  return (
    <ul className="grid gap-0.5 px-2">
      {projects.data.map((p) => (
        <li key={p.id}>
          <NavLink
            to={`/projects/${p.id}`}
            className={({ isActive }) =>
              cn(
                'block rounded-md px-3 py-2 transition-colors hover:bg-accent/70',
                isActive && 'bg-accent text-accent-foreground',
              )
            }
          >
            <span className="block truncate text-sm font-medium">{p.name}</span>
            <time className="block text-xs text-muted-foreground" dateTime={new Date(p.updatedAt).toISOString()} title={fullDate(p.updatedAt)}>
              {circuitCountText(p.circuitCount)} · Updated {relativeTime(p.updatedAt, now)}
            </time>
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

export function AppShell() {
  const [createOpen, setCreateOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();

  // Close the narrow-screen drawer after navigating.
  useEffect(() => setNavOpen(false), [location.pathname]);
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setNavOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  const openCreate = () => {
    setNavOpen(false);
    setCreateOpen(true);
  };

  return (
    <CreateDialogContext.Provider value={openCreate}>
      <div className="flex h-dvh flex-col md:flex-row">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-sidebar px-2 md:hidden">
          <Button variant="ghost" size="icon" onClick={() => setNavOpen(true)} aria-label="Open projects" aria-expanded={navOpen}>
            <Menu />
          </Button>
          <span className="font-semibold">DIY AI</span>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </header>

        {navOpen && (
          <button
            type="button"
            tabIndex={-1}
            aria-label="Close projects"
            className="fixed inset-0 z-30 bg-black/50 md:hidden"
            onClick={() => setNavOpen(false)}
          />
        )}

        <aside
          id="project-sidebar"
          aria-label="Projects"
          className={cn(
            'z-40 flex w-72 shrink-0 flex-col border-r bg-sidebar transition-transform duration-200',
            'max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:max-w-[85vw] max-md:shadow-xl',
            navOpen ? 'max-md:translate-x-0' : 'max-md:invisible max-md:-translate-x-full',
          )}
        >
          <div className="flex h-14 shrink-0 items-center gap-2.5 px-4">
            <NavLink to="/" className="flex items-center gap-2.5 rounded-md font-semibold" aria-label="DIY AI home">
              <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
                <Zap className="size-4" />
              </span>
              DIY AI
            </NavLink>
            <div className="ml-auto max-md:hidden">
              <ThemeToggle />
            </div>
          </div>
          <div className="px-3 pb-3">
            <Button className="w-full justify-start" onClick={openCreate}>
              <Plus /> New project
            </Button>
          </div>
          <div className="px-5 pb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">Projects</div>
          <nav className="min-h-0 flex-1 overflow-y-auto pb-4" aria-label="Projects">
            <ProjectList />
          </nav>
          <div className="border-t p-2">
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent/70',
                  isActive && 'bg-accent text-accent-foreground',
                )
              }
            >
              <Settings className="size-4" aria-hidden /> Settings
            </NavLink>
          </div>
        </aside>

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
    </CreateDialogContext.Provider>
  );
}
