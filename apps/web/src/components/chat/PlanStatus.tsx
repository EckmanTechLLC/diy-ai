import { useState } from 'react';
import { ClipboardList } from 'lucide-react';
import type { Project } from '@/api/client';
import { useDiscardPlan } from '@/api/hooks';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { planStatusText } from '@/lib/plan';

/** One quiet line about the stored plan with the only plan action that is not a chat message; nothing without a plan. */
export function PlanStatus({ project, disabled }: { project: Project; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const discard = useDiscardPlan(project.id);
  const text = planStatusText(project);
  if (!text) return null;
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <ClipboardList className="size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate" title={text}>
        {text}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-1.5 text-xs"
        disabled={disabled}
        onClick={() => {
          discard.reset();
          setOpen(true);
        }}
      >
        Discard plan
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Discard this plan?"
        description="The stored room inventory and plan are forgotten. Circuits already built from the plan are not deleted. The chat messages stay."
        confirmLabel="Discard plan"
        pending={discard.isPending}
        error={discard.error}
        onConfirm={() => discard.mutate(undefined, { onSuccess: () => setOpen(false) })}
      />
    </div>
  );
}
