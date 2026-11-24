import { useState } from 'react';
import { ClipboardList } from 'lucide-react';
import type { Project } from '@/api/client';
import { useBuildPlan, useDiscardPlan } from '@/api/hooks';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { buildQuestion, planStatusText } from '@/lib/plan';

/** One quiet line about the stored plan with the only plan action that is not a chat message; nothing without a plan. */
export function PlanStatus({
  project,
  disabled,
  build,
  onBuilt,
}: {
  project: Project;
  disabled: boolean;
  /** The page's build action, shared with the proposal card so only one build runs at a time. */
  build: ReturnType<typeof useBuildPlan>;
  /** Called with the ids of the circuits a successful build created. */
  onBuilt: (createdCircuitIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [buildOpen, setBuildOpen] = useState(false);
  const discard = useDiscardPlan(project.id);
  const text = planStatusText(project);
  if (!text) return null;
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <ClipboardList className="size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate" title={text}>
        {text}
      </span>
      {project.planBuiltAt === null && (
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-xs"
          disabled={disabled || build.isPending}
          onClick={() => {
            build.reset();
            setBuildOpen(true);
          }}
        >
          Build
        </Button>
      )}
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
      <ConfirmDialog
        open={buildOpen}
        onOpenChange={setBuildOpen}
        title={buildQuestion(project.plan?.circuits.length ?? 0)}
        description="The circuits of the stored plan are created and added to this project. If any circuit fails the checks, none are created."
        confirmLabel="Build"
        confirmVariant="default"
        pending={build.isPending}
        error={build.error}
        onConfirm={() =>
          build.mutate(undefined, {
            onSuccess: (res) => {
              setBuildOpen(false);
              onBuilt(res.createdCircuitIds);
            },
          })
        }
      />
    </div>
  );
}
