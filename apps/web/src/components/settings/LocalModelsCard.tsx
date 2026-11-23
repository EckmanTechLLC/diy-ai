import { useState, type FormEvent } from 'react';
import { RefreshCw, Trash2 } from 'lucide-react';
import { ApiError, type LlmStatus, type LocalEndpoint } from '@/api/client';
import { useAddEndpoint, useDeleteEndpoint, useRefreshEndpoint, useSetActive } from '@/api/hooks';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ErrorNotice, Spinner } from '@/components/feedback';
import { SettingsCard } from '@/components/settings/SettingsCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

/** What the user can do about a failed endpoint request, added to the server's own message. */
function endpointHint(error: unknown): string | null {
  switch (error instanceof ApiError ? error.code : '') {
    case 'ENDPOINT_UNREACHABLE':
      return 'Check the address and port, and that the model server is running and reachable from this server.';
    case 'ENDPOINT_BAD_RESPONSE':
      return 'The address answered, but not like an OpenAI-compatible server. Use the base address without /v1.';
    case 'VALIDATION':
      return 'Enter an address such as http://host:port.';
    case 'MODEL_CHANGED':
      return 'Delete this endpoint and add it again, choosing the model to use.';
    default:
      return null;
  }
}

function ProblemNotice({ error }: { error: unknown }) {
  const hint = endpointHint(error);
  return (
    <div className="grid gap-1">
      <ErrorNotice error={error} />
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}

function EndpointRow({ endpoint, isActive }: { endpoint: LocalEndpoint; isActive: boolean }) {
  const refresh = useRefreshEndpoint();
  const del = useDeleteEndpoint();
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <li className="grid gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            <span className="truncate" title={endpoint.label}>
              {endpoint.label}
            </span>
            {isActive && <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">In use</span>}
          </p>
          <p className="truncate font-mono text-xs text-muted-foreground" title={endpoint.baseUrl}>
            {endpoint.baseUrl}
          </p>
          <p className="truncate text-sm" title={endpoint.model}>
            Model: <span className="font-mono text-xs">{endpoint.model}</span>
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refresh.mutate(endpoint.id)}
            disabled={refresh.isPending}
            aria-label={`Check ${endpoint.label} again`}
            title="Ask the server which model it serves now"
          >
            {refresh.isPending ? <Spinner /> : <RefreshCw />} Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => {
              del.reset();
              setConfirmOpen(true);
            }}
            aria-label={`Delete ${endpoint.label}`}
          >
            <Trash2 /> Delete
          </Button>
        </div>
      </div>
      {refresh.isError && <ProblemNotice error={refresh.error} />}
      {refresh.isSuccess && !refresh.isPending && (
        <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
          Reachable, serving <span className="font-mono text-xs">{refresh.data.model}</span>.
        </p>
      )}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete this local model?"
        description={`${endpoint.label} (${endpoint.baseUrl}) will be removed from this app. The model server itself is not touched.${
          isActive ? ' It is the model in use for chat, so chat will have no model until you pick another.' : ''
        }`}
        confirmLabel="Delete"
        pending={del.isPending}
        error={del.error}
        onConfirm={() => del.mutate(endpoint.id, { onSuccess: () => setConfirmOpen(false) })}
      />
    </li>
  );
}

function AddForm({ hasActive }: { hasActive: boolean }) {
  const [baseUrl, setBaseUrl] = useState('');
  const [label, setLabel] = useState('');
  const [model, setModel] = useState('');
  const add = useAddEndpoint();
  const setActive = useSetActive();

  // MODEL_REQUIRED and MODEL_NOT_SERVED come with the models the server does serve
  const choices = add.error instanceof ApiError ? add.error.models : undefined;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const url = baseUrl.trim();
    if (!url || add.isPending) return;
    const name = label.trim();
    add.mutate(
      { baseUrl: url, ...(name ? { label: name } : {}), ...(choices && model ? { model } : {}) },
      {
        onSuccess: () => {
          setBaseUrl('');
          setLabel('');
          setModel('');
        },
      },
    );
  };

  return (
    <form onSubmit={submit} className="grid gap-3" noValidate>
      <h3 className="text-sm font-medium">Add a local model</h3>
      <div className="flex flex-wrap gap-3">
        <div className="grid min-w-56 flex-[2] gap-1.5">
          <Label htmlFor="endpoint-url">Address</Label>
          <Input
            id="endpoint-url"
            value={baseUrl}
            onChange={(e) => {
              setBaseUrl(e.target.value);
              setModel('');
              if (add.isError || add.isSuccess) add.reset();
            }}
            disabled={add.isPending}
            placeholder="http://host:port"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            aria-describedby="endpoint-url-help"
          />
        </div>
        <div className="grid min-w-40 flex-1 gap-1.5">
          <Label htmlFor="endpoint-label">
            Label <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input id="endpoint-label" value={label} onChange={(e) => setLabel(e.target.value)} disabled={add.isPending} autoComplete="off" />
        </div>
      </div>
      <p id="endpoint-url-help" className="-mt-1 text-sm text-muted-foreground">
        The address of an OpenAI-compatible server such as llama.cpp, without /v1. This server asks it which model it serves.
      </p>

      {choices && choices.length > 0 && (
        <div className="grid gap-1.5">
          <Label htmlFor="endpoint-model">This server offers several models. Choose one</Label>
          <Select id="endpoint-model" value={model} onChange={(e) => setModel(e.target.value)} disabled={add.isPending}>
            <option value="">Choose a model...</option>
            {choices.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={add.isPending || baseUrl.trim() === '' || (!!choices && choices.length > 0 && model === '')}>
          {add.isPending && <Spinner />}
          {add.isPending ? 'Contacting the server...' : 'Add model'}
        </Button>
      </div>

      <div aria-live="polite" className="grid gap-2">
        {add.isError && !(choices && add.error instanceof ApiError && add.error.code === 'MODEL_REQUIRED') && <ProblemNotice error={add.error} />}
        {add.isSuccess && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
            <p className="text-emerald-700 dark:text-emerald-400">
              Added {add.data.label}. It serves <span className="font-mono text-xs">{add.data.model}</span>.
            </p>
            {!hasActive && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={setActive.isPending}
                onClick={() => setActive.mutate({ provider: 'local', endpointId: add.data.id })}
              >
                Use it for chat
              </Button>
            )}
          </div>
        )}
        {setActive.isError && <ErrorNotice error={setActive.error} />}
      </div>
    </form>
  );
}

export function LocalModelsCard({ status }: { status: LlmStatus }) {
  const activeId = status.active?.provider === 'local' ? status.active.endpointId : null;
  return (
    <SettingsCard
      title="Local models"
      description="Models you run yourself. Local models can be slow, so a reply may take minutes."
    >
      {status.endpoints.length === 0 ? (
        <p className="text-sm text-muted-foreground">No local models yet.</p>
      ) : (
        <ul className="divide-y">
          {status.endpoints.map((e) => (
            <EndpointRow key={e.id} endpoint={e} isActive={e.id === activeId} />
          ))}
        </ul>
      )}
      <div className="border-t pt-4">
        <AddForm hasActive={status.active !== null} />
      </div>
    </SettingsCard>
  );
}
