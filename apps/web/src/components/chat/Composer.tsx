import { useEffect, useRef, type KeyboardEvent, type Ref } from 'react';
import { Link } from 'react-router';
import { SendHorizontal } from 'lucide-react';
import { Spinner } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export const MAX_LENGTH = 4000;

export function Composer({
  textareaRef,
  draft,
  onDraft,
  onSend,
  pending,
  noModel,
}: {
  textareaRef: Ref<HTMLTextAreaElement>;
  draft: string;
  onDraft: (v: string) => void;
  onSend: (text: string) => void;
  pending: boolean;
  /** True when no model is active: the composer is replaced by an explanation. */
  noModel: boolean;
}) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const trimmed = draft.trim();
  const tooLong = trimmed.length > MAX_LENGTH;
  const canSend = trimmed.length > 0 && !tooLong && !pending;

  // grow with the text, up to about eight lines
  useEffect(() => {
    const el = inner.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, [draft, noModel]);

  if (noModel) {
    return (
      <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-3 text-sm text-amber-900 dark:text-amber-200">
        <p className="font-medium">No model is selected, so chat is off.</p>
        <p className="mt-1">
          <Link to="/settings" className="font-medium underline underline-offset-2">
            Open Settings
          </Link>{' '}
          to add a Claude API key or a local model and choose it.
        </p>
      </div>
    );
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (canSend) onSend(trimmed);
    }
  };

  return (
    <form
      className="grid gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSend(trimmed);
      }}
    >
      <div className="flex items-end gap-2">
        <Textarea
          ref={(el) => {
            inner.current = el;
            if (typeof textareaRef === 'function') textareaRef(el);
            else if (textareaRef) textareaRef.current = el;
          }}
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={pending}
          rows={2}
          aria-label="Message"
          aria-invalid={tooLong}
          placeholder={pending ? 'Waiting for the reply...' : 'Describe the wiring job'}
          className="min-h-[3.25rem] flex-1 resize-none"
        />
        <Button type="submit" size="icon" disabled={!canSend} aria-label="Send message" title="Send (Enter)">
          {pending ? <Spinner /> : <SendHorizontal />}
        </Button>
      </div>
      <p className="flex justify-between gap-2 text-xs text-muted-foreground">
        <span>Enter sends, Shift+Enter adds a line.</span>
        {tooLong && <span className="font-medium text-destructive">{trimmed.length}/{MAX_LENGTH}, too long</span>}
      </p>
    </form>
  );
}
