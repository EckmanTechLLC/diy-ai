import { useQuery } from '@tanstack/react-query';
import type { CircuitModel } from '@diy-ai/core';
import { LIGHT_PALETTE } from '@diy-ai/diagram/theme';
import { DiagramCanvas, type FindingFocus } from '@/components/DiagramCanvas';
import { ErrorNotice, Spinner } from '@/components/feedback';

interface Rendered {
  /** Distinguishes one layout from the next, so a new diagram starts fitted with a clean selection. */
  rev: number;
  /** The circuit this layout was made from; the canvas works on it, so the picture and the model never disagree. */
  circuit: CircuitModel;
  svg: string;
  width: number;
  height: number;
}

let revision = 0;

async function render(circuit: CircuitModel): Promise<Rendered> {
  // Loaded on demand: the layout engine is large and only needed on a project page with a circuit.
  const { layoutCircuit, renderSvg, TITLE_STRIP } = await import('@diy-ai/diagram');
  const layout = await layoutCircuit(circuit);
  return { rev: ++revision, circuit, svg: renderSvg(layout, circuit), width: layout.width, height: layout.height + TITLE_STRIP };
}

function LayoutError({ error }: { error: unknown }) {
  const issues = (error as { name?: string; issues?: { code: string; message: string }[] }).issues;
  if ((error as { name?: string }).name === 'InvalidCircuitError' && issues) {
    return (
      <div role="alert" className="grid gap-2 p-6">
        <p className="font-medium text-destructive">This wiring diagram cannot be drawn because the circuit is invalid.</p>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {issues.map((issue, i) => (
            <li key={i}>
              <span className="font-mono text-xs text-muted-foreground">{issue.code}</span> {issue.message}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return <ErrorNotice className="m-6" error={error} />;
}

export function DiagramView({
  projectId,
  circuitId,
  circuit,
  focus,
  onFocusChange,
}: {
  projectId: string;
  circuitId: string;
  circuit: CircuitModel;
  focus: FindingFocus | null;
  onFocusChange: (f: null) => void;
}) {
  // Keyed by the circuit itself, so renaming the project or the circuit does not redo the layout.
  const diagram = useQuery({
    queryKey: ['diagram', projectId, circuitId, circuit],
    queryFn: () => render(circuit),
    retry: false,
    staleTime: Infinity,
    // while a replaced circuit is laid out, keep showing its previous diagram instead of a blank; another circuit never borrows it
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === projectId && prevQuery.queryKey[2] === circuitId ? prev : undefined),
  });

  return (
    <section
      aria-label="Wiring diagram"
      // always a light sheet of paper with the light palette, in both app themes; the border keeps it a document in dark mode
      className="dg-canvas paper relative min-h-80 flex-1 overflow-hidden rounded-xl border border-neutral-300 shadow-sm dark:shadow-lg dark:shadow-black/40"
      style={{ background: LIGHT_PALETTE.bg }}
    >
      {diagram.isPending ? (
        <div role="status" className="grid h-full min-h-72 place-items-center text-sm text-muted-foreground">
          <span className="flex items-center gap-2">
            <Spinner /> Laying out the wiring diagram...
          </span>
        </div>
      ) : diagram.isError ? (
        <div className="h-full overflow-y-auto">
          <LayoutError error={diagram.error} />
        </div>
      ) : (
        <DiagramCanvas
          // a different circuit starts with a fresh fit, selection and legend state
          key={`${projectId}:${diagram.data.rev}`}
          circuit={diagram.data.circuit}
          focus={focus}
          onFocusChange={onFocusChange}
          svg={diagram.data.svg}
          width={diagram.data.width}
          height={diagram.data.height}
        />
      )}
    </section>
  );
}
