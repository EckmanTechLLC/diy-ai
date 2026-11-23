import { ChevronRight } from 'lucide-react';
import type { Reason } from '@diy-ai/core';
import { ReasonList } from '@/components/PlanParts';

/** "Why" behind a native disclosure: closed by default, keyboard accessible without any script. */
export function PlanReasonsDisclosure({ reasons }: { reasons: readonly Reason[] }) {
  if (reasons.length === 0) return null;
  return (
    <details className="group">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 shrink-0 transition-transform group-open:rotate-90" aria-hidden />
        Why
      </summary>
      <ReasonList reasons={reasons} className="mt-1.5" />
    </details>
  );
}
