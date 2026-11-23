import { type LlmStatus } from '@/api/client';
import { useClaudeModels, useSetActive } from '@/api/hooks';
import { ErrorNotice } from '@/components/feedback';
import { Notice, SettingsCard } from '@/components/settings/SettingsCard';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

export const encodeActive = (a: LlmStatus['active']) => (a === null ? '' : a.provider === 'anthropic' ? `anthropic:${a.model}` : `local:${a.endpointId}`);

/** A display name for the model chat uses, or null when none is selected. */
export function activeModelName(status: LlmStatus, claudeNames?: Map<string, string>): string | null {
  const a = status.active;
  if (!a) return null;
  if (a.provider === 'anthropic') return claudeNames?.get(a.model) ?? a.model;
  const e = status.endpoints.find((x) => x.id === a.endpointId);
  return e ? `${e.label} (${e.model})` : null;
}

export function ActiveModelCard({ status }: { status: LlmStatus }) {
  const models = useClaudeModels(status.anthropic.keySet);
  const setActive = useSetActive();
  const current = encodeActive(status.active);
  const claude = models.data ?? [];
  const activeClaude = status.active?.provider === 'anthropic' ? status.active.model : null;
  const activeLocal = status.active?.provider === 'local' ? status.active.endpointId : null;
  const activeMissing = activeLocal !== null && !status.endpoints.some((e) => e.id === activeLocal);
  const empty = !status.anthropic.keySet && status.endpoints.length === 0;

  return (
    <SettingsCard title="Model used for chat" description="The one model that answers in the chat of every project.">
      {status.active === null || activeMissing ? (
        <Notice>
          <strong className="font-semibold">No model is selected.</strong>{' '}
          {empty
            ? 'Add a Claude API key or a local model below, then choose it here. Chat stays off until then.'
            : 'Choose one below. Chat stays off until then.'}
        </Notice>
      ) : null}
      <div className="grid gap-1.5">
        <Label htmlFor="active-model">Active model</Label>
        <Select
          id="active-model"
          value={current}
          disabled={setActive.isPending || empty}
          onChange={(e) => {
            const v = e.target.value;
            if (v.startsWith('anthropic:')) setActive.mutate({ provider: 'anthropic', model: v.slice('anthropic:'.length) });
            else if (v.startsWith('local:')) setActive.mutate({ provider: 'local', endpointId: v.slice('local:'.length) });
          }}
        >
          {(status.active === null || activeMissing) && <option value="">None selected</option>}
          {status.anthropic.keySet && (
            <optgroup label="Claude">
              {activeClaude && !claude.some((m) => m.id === activeClaude) && <option value={`anthropic:${activeClaude}`}>{activeClaude}</option>}
              {claude.map((m) => (
                <option key={m.id} value={`anthropic:${m.id}`}>
                  {m.displayName}
                </option>
              ))}
            </optgroup>
          )}
          {status.endpoints.length > 0 && (
            <optgroup label="Local">
              {status.endpoints.map((e) => (
                <option key={e.id} value={`local:${e.id}`}>
                  {e.label} ({e.model})
                </option>
              ))}
            </optgroup>
          )}
        </Select>
        {status.anthropic.keySet && models.isError && (
          <p className="text-sm text-muted-foreground">The Claude model list could not be loaded, see the Claude section below.</p>
        )}
      </div>
      {setActive.isError && <ErrorNotice error={setActive.error} />}
    </SettingsCard>
  );
}
