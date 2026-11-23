import { useState, type FormEvent } from 'react';
import { CheckCircle2, KeyRound } from 'lucide-react';
import { ApiError, type LlmStatus } from '@/api/client';
import { useClaudeModels, useRemoveAnthropicKey, useSetActive, useSetAnthropicKey } from '@/api/hooks';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ErrorNotice, Spinner } from '@/components/feedback';
import { SettingsCard } from '@/components/settings/SettingsCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

/** Text for a failed model list; says what to do about it. */
export function claudeModelsProblem(error: unknown): string {
  const code = error instanceof ApiError ? error.code : '';
  switch (code) {
    case 'NO_KEY':
      return 'No Claude API key is set. Add one above to see the models.';
    case 'KEY_REJECTED':
      return 'Claude rejected this API key. Check it at the Anthropic console and replace it above.';
    case 'RATE_LIMIT':
      return 'Claude is rate limiting requests. Wait a minute, then try again.';
    case 'TIMEOUT':
    case 'UNREACHABLE':
      return 'Could not reach Claude. Check this server\'s network connection, then try again.';
    default:
      return error instanceof Error ? `${error.message} Try again in a moment.` : 'The model list could not be loaded. Try again in a moment.';
  }
}

function KeyForm({ status }: { status: LlmStatus['anthropic'] }) {
  const [value, setValue] = useState('');
  const set = useSetAnthropicKey();
  const remove = useRemoveAnthropicKey();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const key = value.trim();
    if (!key || set.isPending) return;
    setValue(''); // the key is never kept in the page after it is sent
    setSaved(false);
    set.mutate(key, { onSuccess: () => setSaved(true) });
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {status.keySet ? (
          <>
            <span className="flex items-center gap-1.5 font-medium">
              <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden /> API key set
            </span>
            <span className="text-muted-foreground">
              {status.keySource === 'env' ? 'From the server environment (ANTHROPIC_API_KEY)' : 'Stored on this server'}
              {status.last4 && (
                <>
                  , ends in <span className="font-mono">{status.last4}</span>
                </>
              )}
            </span>
          </>
        ) : (
          <span className="flex items-center gap-1.5 font-medium">
            <KeyRound className="size-4 text-muted-foreground" aria-hidden /> No API key set
          </span>
        )}
      </div>

      <form onSubmit={submit} className="grid gap-1.5" autoComplete="off">
        <Label htmlFor="claude-key">{status.keySet ? 'Replace the API key' : 'Claude API key'}</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="claude-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={set.isPending}
            placeholder="Paste a key"
            className="min-w-48 flex-1 font-mono"
            aria-describedby="claude-key-help"
          />
          <Button type="submit" disabled={set.isPending || value.trim() === ''}>
            {set.isPending && <Spinner />}
            {status.keySet ? 'Replace key' : 'Save key'}
          </Button>
          {status.keySource === 'stored' && (
            <Button type="button" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setConfirmOpen(true)}>
              Remove key
            </Button>
          )}
        </div>
        <p id="claude-key-help" className="text-sm text-muted-foreground">
          The key is stored on this server and is never shown again, only its last four characters. It is not kept in your browser.
        </p>
      </form>
      {set.isError && <ErrorNotice error={set.error} />}
      {saved && !set.isPending && (
        <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
          Key saved.
        </p>
      )}
      {status.keySource === 'env' && (
        <p className="text-sm text-muted-foreground">
          The server environment provides a key, which is used first. A key saved here is only used when the environment has none.
        </p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(o) => {
          setConfirmOpen(o);
          if (o) remove.reset();
        }}
        title="Remove the stored API key?"
        description="Claude models will stop working until you add a key again."
        confirmLabel="Remove key"
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => remove.mutate(undefined, { onSuccess: () => setConfirmOpen(false) })}
      />
    </div>
  );
}

function ModelPicker({ status }: { status: LlmStatus }) {
  const models = useClaudeModels(status.anthropic.keySet);
  const setActive = useSetActive();
  const active = status.active?.provider === 'anthropic' ? status.active.model : '';

  if (!status.anthropic.keySet) return <p className="text-sm text-muted-foreground">Add an API key to choose a Claude model.</p>;
  if (models.isPending) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Loading Claude models...
      </p>
    );
  }
  if (models.isError) {
    return (
      <div className="grid gap-2">
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm font-medium text-destructive">
          {claudeModelsProblem(models.error)}
        </div>
        <div>
          <Button variant="outline" size="sm" onClick={() => models.refetch()} disabled={models.isFetching}>
            {models.isFetching && <Spinner />}
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const list = models.data;
  const known = list.some((m) => m.id === active);
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="claude-model">Claude model</Label>
      <Select
        id="claude-model"
        value={active}
        disabled={setActive.isPending}
        onChange={(e) => e.target.value && setActive.mutate({ provider: 'anthropic', model: e.target.value })}
      >
        {active === '' && <option value="">Choose a model to use for chat...</option>}
        {active !== '' && !known && <option value={active}>{active} (not in the current list)</option>}
        {list.map((m) => (
          <option key={m.id} value={m.id}>
            {m.displayName}
          </option>
        ))}
      </Select>
      {setActive.isError && <ErrorNotice error={setActive.error} />}
      {list.length === 0 && <p className="text-sm text-muted-foreground">Claude reported no models for this key.</p>}
    </div>
  );
}

export function ClaudeCard({ status }: { status: LlmStatus }) {
  return (
    <SettingsCard title="Claude" description="Use Claude through the Anthropic API. Requests are sent from this server, so the key never reaches the browser.">
      <KeyForm status={status.anthropic} />
      <div className="border-t pt-4">
        <ModelPicker status={status} />
      </div>
    </SettingsCard>
  );
}
