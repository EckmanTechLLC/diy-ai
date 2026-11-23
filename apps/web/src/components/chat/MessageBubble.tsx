import { Link } from 'react-router';
import { AlertCircle, AlertTriangle, Ban, HelpCircle } from 'lucide-react';
import { SETTINGS_ERROR_CODES, type ChatMessage } from '@/api/client';
import { RULES } from '@diy-ai/core';
import { OriginBadge } from '@/components/OriginBadge';
import { groupFindings } from '@/lib/findings';
import { messageTarget } from '@/lib/circuits';
import { describeOrigin } from '@/lib/origin';
import { cn } from '@/lib/utils';

const base = 'max-w-[92%] min-w-0 rounded-xl px-3 py-2 text-sm break-words whitespace-pre-wrap';

/** One chat message, rendered from its own stored `origin` and `errorCode`. */
export function MessageBubble({
  message,
  pending,
  circuits,
  onSelectCircuit,
  onShowChecks,
}: {
  message: ChatMessage;
  pending: boolean;
  /** The project's circuits now, to name the one a message created or changed. */
  circuits: readonly { id: string; name: string }[];
  /** Selects a circuit on the page (and closes the chat drawer on narrow screens). */
  onSelectCircuit: (id: string) => void;
  onShowChecks?: () => void;
}) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <p className={cn(base, 'rounded-br-sm bg-primary text-primary-foreground', pending && 'opacity-70')}>{message.content}</p>
      </div>
    );
  }

  if (message.kind === 'error') {
    const configCause = message.errorCode !== null && SETTINGS_ERROR_CODES.includes(message.errorCode);
    return (
      <div className="flex justify-start">
        <div role="alert" className={cn(base, 'grid gap-1.5 rounded-bl-sm border border-destructive/40 bg-destructive/10')}>
          <p className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
            <span>{message.content}</span>
          </p>
          {message.errorCode === 'rules_failed' && message.findings && message.findings.length > 0 && (
            <div className="ml-6 grid gap-1">
              <p className="text-xs font-medium">Failed checks:</p>
              <ul className="grid list-disc gap-1 pl-4 text-xs">
                {groupFindings(message.findings, RULES).map((g) => (
                  <li key={g.ruleId}>
                    <span className="font-medium">{g.title}.</span> {g.messages.join(' ')}
                  </li>
                ))}
              </ul>
              <p className="text-xs">The project was not changed.</p>
            </div>
          )}
          {configCause && (
            <Link to="/settings" className="ml-6 w-fit font-medium text-primary underline underline-offset-2">
              Open Settings
            </Link>
          )}
        </div>
      </div>
    );
  }

  if (message.kind === 'unsupported') {
    return (
      <div className="flex justify-start">
        <div className={cn(base, 'grid gap-1 rounded-bl-sm border border-dashed bg-muted/50')}>
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Ban className="size-3.5" aria-hidden /> Not supported
          </p>
          <p>{message.content}</p>
        </div>
      </div>
    );
  }

  if (message.kind === 'circuit') {
    const info = describeOrigin(message.origin);
    const warnings = message.findings?.filter((f) => f.severity === 'warning').length ?? 0;
    const target = messageTarget(message.circuitId, circuits);
    return (
      <div className="flex justify-start">
        <div className={cn(base, 'grid gap-2 rounded-bl-sm bg-muted')}>
          <p>{message.content}</p>
          <p className="text-xs text-muted-foreground">
            Circuit:{' '}
            {target.kind === 'circuit' ? (
              <button
                type="button"
                onClick={() => onSelectCircuit(target.id)}
                className="font-medium text-primary underline underline-offset-2"
                title="Show this circuit"
              >
                {target.name}
              </button>
            ) : (
              <span>{target.text}</span>
            )}
          </p>
          {info ? (
            <OriginBadge info={info} />
          ) : (
            <p className="text-xs text-muted-foreground">Origin not recorded for this message.</p>
          )}
          {warnings > 0 && (
            <p className="flex items-center gap-1.5 text-xs">
              <AlertTriangle className="size-3.5 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />
              {warnings} {warnings === 1 ? 'warning' : 'warnings'}
              {onShowChecks && (
                <>
                  {' '}
                  <button type="button" onClick={onShowChecks} className="font-medium text-primary underline underline-offset-2">
                    see Checks
                  </button>
                </>
              )}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className={cn(base, 'grid gap-1 rounded-bl-sm bg-muted')}>
        {message.kind === 'question' && (
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <HelpCircle className="size-3.5" aria-hidden /> Question
          </p>
        )}
        <p>{message.content}</p>
      </div>
    </div>
  );
}
