import { useEffect, useId, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import type { Project } from '@/api/client';
import { useCreateProject, useDeleteProject, useUpdateProject } from '@/api/hooks';
import { ErrorNotice, Spinner } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const NAME_MAX = 120;
const DESCRIPTION_MAX = 5000;

interface Values {
  name: string;
  description: string;
}

function validate(v: Values): { name?: string; description?: string } {
  const errors: { name?: string; description?: string } = {};
  const name = v.name.trim();
  if (name.length === 0) errors.name = 'Enter a name.';
  else if (name.length > NAME_MAX) errors.name = `Use at most ${NAME_MAX} characters (currently ${name.length}).`;
  if (v.description.length > DESCRIPTION_MAX) errors.description = `Use at most ${DESCRIPTION_MAX} characters.`;
  return errors;
}

interface FormProps {
  initial: Values;
  submitLabel: string;
  pending: boolean;
  error: unknown;
  onSubmit: (values: Values) => void;
  onCancel: () => void;
}

/** Name and description form. Enter in the name field submits; the description keeps Enter for new lines. */
function ProjectForm({ initial, submitLabel, pending, error, onSubmit, onCancel }: FormProps) {
  const id = useId();
  const [values, setValues] = useState(initial);
  const [attempted, setAttempted] = useState(false);
  const errors = validate(values);
  const show = attempted ? errors : {};

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setAttempted(true);
    if (errors.name || errors.description) return;
    onSubmit({ name: values.name.trim(), description: values.description });
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-name`}>Name</Label>
        <Input
          id={`${id}-name`}
          value={values.name}
          onChange={(e) => setValues({ ...values, name: e.target.value })}
          disabled={pending}
          aria-invalid={!!show.name}
          aria-describedby={show.name ? `${id}-name-err` : undefined}
          placeholder="e.g. Garage lighting"
          autoComplete="off"
          autoFocus
        />
        {show.name && (
          <p id={`${id}-name-err`} className="text-sm text-destructive">
            {show.name}
          </p>
        )}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-desc`}>
          Description <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id={`${id}-desc`}
          value={values.description}
          onChange={(e) => setValues({ ...values, description: e.target.value })}
          disabled={pending}
          aria-invalid={!!show.description}
          aria-describedby={show.description ? `${id}-desc-err` : undefined}
          rows={3}
        />
        {show.description && (
          <p id={`${id}-desc-err`} className="text-sm text-destructive">
            {show.description}
          </p>
        )}
      </div>
      {error ? <ErrorNotice error={error} /> : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Spinner />}
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Closing is blocked while a request is in flight so its outcome is never lost. */
function guarded(pending: boolean, onOpenChange: (open: boolean) => void) {
  return {
    onOpenChange: (open: boolean) => {
      if (!pending) onOpenChange(open);
    },
    onEscapeKeyDown: (e: KeyboardEvent) => pending && e.preventDefault(),
    onInteractOutside: (e: Event) => pending && e.preventDefault(),
  };
}

export function CreateProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const create = useCreateProject();
  const { reset } = create;
  useEffect(() => {
    if (open) reset();
  }, [open, reset]);
  const g = guarded(create.isPending, onOpenChange);

  return (
    <Dialog open={open} onOpenChange={g.onOpenChange}>
      <DialogContent onEscapeKeyDown={g.onEscapeKeyDown} onInteractOutside={g.onInteractOutside}>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>Give the project a name. You can change it later.</DialogDescription>
        </DialogHeader>
        <ProjectForm
          initial={{ name: '', description: '' }}
          submitLabel="Create project"
          pending={create.isPending}
          error={create.error}
          onCancel={() => onOpenChange(false)}
          onSubmit={async (v) => {
            try {
              const project = await create.mutateAsync({ name: v.name, ...(v.description ? { description: v.description } : {}) });
              onOpenChange(false);
              navigate(`/projects/${project.id}`);
            } catch {
              // shown in place via create.error
            }
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

export function EditProjectDialog({
  project,
  open,
  onOpenChange,
}: {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const update = useUpdateProject(project.id);
  const { reset } = update;
  useEffect(() => {
    if (open) reset();
  }, [open, reset]);
  const g = guarded(update.isPending, onOpenChange);

  return (
    <Dialog open={open} onOpenChange={g.onOpenChange}>
      <DialogContent onEscapeKeyDown={g.onEscapeKeyDown} onInteractOutside={g.onInteractOutside}>
        <DialogHeader>
          <DialogTitle>Edit project</DialogTitle>
          <DialogDescription>Change the name or description.</DialogDescription>
        </DialogHeader>
        <ProjectForm
          initial={{ name: project.name, description: project.description }}
          submitLabel="Save changes"
          pending={update.isPending}
          error={update.error}
          onCancel={() => onOpenChange(false)}
          onSubmit={async (v) => {
            const patch: Partial<Values> = {};
            if (v.name !== project.name) patch.name = v.name;
            if (v.description !== project.description) patch.description = v.description;
            if (Object.keys(patch).length === 0) return onOpenChange(false);
            try {
              await update.mutateAsync(patch);
              onOpenChange(false);
            } catch {
              // shown in place via update.error
            }
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

export function DeleteProjectDialog({
  project,
  open,
  onOpenChange,
}: {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const del = useDeleteProject();
  const { reset } = del;
  useEffect(() => {
    if (open) reset();
  }, [open, reset]);
  const g = guarded(del.isPending, onOpenChange);

  return (
    <Dialog open={open} onOpenChange={g.onOpenChange}>
      <DialogContent onEscapeKeyDown={g.onEscapeKeyDown} onInteractOutside={g.onInteractOutside}>
        <DialogHeader>
          <DialogTitle>Delete this project?</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{project.name}</span> and its wiring diagram will be permanently deleted.
            This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {del.error ? <ErrorNotice error={del.error} /> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={del.isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={del.isPending}
            onClick={async () => {
              try {
                await del.mutateAsync(project.id);
                navigate('/');
              } catch {
                // shown in place via del.error
              }
            }}
          >
            {del.isPending && <Spinner />}
            Delete project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
