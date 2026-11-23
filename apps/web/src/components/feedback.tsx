import { AlertCircle, Loader2 } from 'lucide-react';
import { ApiError } from '@/api/client';
import { cn } from '@/lib/utils';

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin', className)} aria-hidden />;
}

/** Shows an error from the API client in place, with its issues listed when present. */
export function ErrorNotice({ error, className }: { error: unknown; className?: string }) {
  const message = error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Something went wrong.';
  const issues = error instanceof ApiError ? error.issues : undefined;
  return (
    <div
      role="alert"
      className={cn('flex gap-2.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm', className)}
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
      <div className="min-w-0">
        <p className="font-medium text-destructive">{message}</p>
        {issues && issues.length > 0 && (
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-foreground/80">
            {issues.map((issue, i) => (
              <li key={i}>
                {issue.path ? <span className="font-mono text-xs">{issue.path}: </span> : null}
                {issue.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
