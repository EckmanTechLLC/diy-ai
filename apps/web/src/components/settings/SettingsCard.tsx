import { useId, type ReactNode } from 'react';

/** A titled block of the settings page. */
export function SettingsCard({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="grid gap-4 rounded-xl border bg-card p-5 text-card-foreground shadow-xs">
      <div className="grid gap-1">
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/** A calm "this needs attention" box (not an error). */
export function Notice({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      role="status"
      className={`rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-900 dark:text-amber-200 ${className}`}
    >
      {children}
    </div>
  );
}
