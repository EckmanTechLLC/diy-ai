import { useEffect } from 'react';
import { useLlmStatus } from '@/api/hooks';
import { ErrorNotice } from '@/components/feedback';
import { ActiveModelCard } from '@/components/settings/ActiveModelCard';
import { ClaudeCard } from '@/components/settings/ClaudeCard';
import { LocalModelsCard } from '@/components/settings/LocalModelsCard';
import { Button } from '@/components/ui/button';

export function SettingsPage() {
  const status = useLlmStatus();
  useEffect(() => {
    document.title = 'Settings - DIY AI';
    return () => {
      document.title = 'DIY AI';
    };
  }, []);

  return (
    <div className="mx-auto grid max-w-3xl gap-5 p-4 sm:p-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1.5 text-muted-foreground">Choose which model writes your wiring plans.</p>
      </header>
      {status.isPending ? (
        <div className="grid gap-5" aria-busy="true" aria-label="Loading settings">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : status.isError ? (
        <div className="grid gap-3">
          <ErrorNotice error={status.error} />
          <div>
            <Button variant="outline" onClick={() => status.refetch()} disabled={status.isFetching}>
              Try again
            </Button>
          </div>
        </div>
      ) : (
        <>
          <ActiveModelCard status={status.data} />
          <ClaudeCard status={status.data} />
          <LocalModelsCard status={status.data} />
        </>
      )}
    </div>
  );
}
