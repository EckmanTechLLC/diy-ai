import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { FolderPlus, Plus } from 'lucide-react';
import { useCreateFromExample, useExamples, useProjects } from '@/api/hooks';
import { useOpenCreateDialog } from '@/components/AppShell';
import { ErrorNotice, Spinner } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import { circuitCountText } from '@/lib/circuits';
import { relativeTime } from '@/lib/time';

function Examples() {
  const examples = useExamples();
  const navigate = useNavigate();
  const create = useCreateFromExample();
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (examples.isPending) {
    return <div className="h-10 w-64 animate-pulse rounded-md bg-muted" aria-busy="true" aria-label="Loading examples" />;
  }
  if (examples.isError) {
    return (
      <div className="grid max-w-xl gap-2">
        <ErrorNotice error={examples.error} />
        <div>
          <Button variant="outline" size="sm" onClick={() => examples.refetch()} disabled={examples.isFetching}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
  if (examples.data.length === 0) return null;

  return (
    <div className="grid gap-3">
      <ul className="flex flex-wrap gap-2">
        {examples.data.map((ex) => (
          <li key={ex.id}>
            <Button
              variant="outline"
              disabled={create.isPending}
              onClick={async () => {
                setPendingId(ex.id);
                try {
                  const project = await create.mutateAsync(ex.id);
                  navigate(`/projects/${project.id}`);
                } catch {
                  // shown below via create.error
                }
              }}
            >
              {create.isPending && pendingId === ex.id && <Spinner />}
              {ex.title}
            </Button>
          </li>
        ))}
      </ul>
      {create.error ? <ErrorNotice error={create.error} className="max-w-xl" /> : null}
    </div>
  );
}

export function HomePage() {
  const projects = useProjects();
  const openCreate = useOpenCreateDialog();
  const hasProjects = !!projects.data && projects.data.length > 0;

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-8">
      <header className="mb-8 flex items-center gap-4">
        <h1 className="flex-1 text-2xl font-semibold tracking-tight">{hasProjects ? 'Your projects' : 'Welcome'}</h1>
        <Button onClick={openCreate} className="max-md:hidden">
          <Plus /> New project
        </Button>
      </header>

      {projects.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2" aria-busy="true" aria-label="Loading projects">
          {[0, 1].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : projects.isError ? (
        <div className="grid max-w-xl gap-2">
          <ErrorNotice error={projects.error} />
          <div>
            <Button variant="outline" onClick={() => projects.refetch()} disabled={projects.isFetching}>
              Try again
            </Button>
          </div>
        </div>
      ) : hasProjects ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {projects.data.map((p) => (
            <li key={p.id}>
              <Link
                to={`/projects/${p.id}`}
                className="block h-full rounded-xl border bg-card p-4 shadow-xs transition-colors hover:border-ring/60 hover:bg-accent/40"
              >
                <span className="block truncate font-medium">{p.name}</span>
                {p.description && <span className="mt-1 line-clamp-2 block text-sm text-muted-foreground">{p.description}</span>}
                <span className="mt-2 block text-xs text-muted-foreground">
                  {circuitCountText(p.circuitCount)} · Updated {relativeTime(p.updatedAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <section className="grid justify-items-center gap-2 rounded-xl border border-dashed px-6 py-14 text-center">
          <div className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
            <FolderPlus className="size-6" />
          </div>
          <h2 className="text-lg font-medium">No projects yet</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Create a project to start planning a build, or begin from one of the examples below.
          </p>
          <Button onClick={openCreate} className="mt-2">
            <Plus /> New project
          </Button>
        </section>
      )}

      <section className="mt-10 grid gap-3" aria-labelledby="examples-heading">
        <div>
          <h2 id="examples-heading" className="text-base font-medium">
            Start from an example
          </h2>
          <p className="text-sm text-muted-foreground">Creates a new project with a ready-made wiring diagram.</p>
        </div>
        <Examples />
      </section>
    </div>
  );
}
