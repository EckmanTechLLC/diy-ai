import { ShieldAlert, ShieldCheck } from 'lucide-react';
import type { OriginInfo } from '@/lib/origin';
import { UNVERIFIED_LABEL } from '@/lib/origin';
import { cn } from '@/lib/utils';

/** Where a circuit came from. Custom wiring is always marked unverified. */
export function OriginBadge({ info, className }: { info: OriginInfo; className?: string }) {
  if (info.kind === 'custom') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border border-amber-500/60 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-900 dark:text-amber-200',
          className,
        )}
        title="The model wired this circuit itself. Check every connection before building."
      >
        <ShieldAlert className="size-3.5 shrink-0" aria-hidden />
        {UNVERIFIED_LABEL}
      </span>
    );
  }
  if (info.kind === 'blocks') {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-xs text-muted-foreground', className)} title="Built from hand-verified wiring blocks">
        <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
        <span>
          Built from checked blocks: {info.summary}
        </span>
      </span>
    );
  }
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs text-muted-foreground', className)} title="Built from a hand-verified wiring template">
      <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
      Template: {info.title}
    </span>
  );
}
