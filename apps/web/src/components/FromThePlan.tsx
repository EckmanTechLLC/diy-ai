import { useId, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { CircuitPlanInfo } from '@diy-ai/core';
import { ProtectionChips, ReasonList } from '@/components/PlanParts';
import { loadText, servedText } from '@/lib/plan';

/** What the plan required of this circuit and the diagram cannot show. Only for circuits built from a plan. */
export function FromThePlan({ info }: { info: CircuitPlanInfo }) {
  const bodyId = useId();
  const [open, setOpen] = useState(true);
  const Chevron = open ? ChevronDown : ChevronRight;
  const { afci, gfci } = info.protection;
  return (
    <section aria-label="From the plan" className="shrink-0 rounded-xl border bg-card text-card-foreground shadow-xs">
      <h2 className="m-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm"
        >
          <Chevron className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="font-semibold">From the plan</span>
          <ProtectionChips protection={info.protection} />
        </button>
      </h2>
      {open && (
        <div id={bodyId} className="grid max-h-[40vh] gap-3 overflow-y-auto border-t px-3 py-3 text-sm">
          <div>
            <h3 className="font-medium">Rooms served</h3>
            <ul className="mt-1 grid gap-0.5 text-muted-foreground">
              {info.rooms.map((r) => (
                <li key={r.id}>{servedText(r)}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-medium">Required protection</h3>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
              <li>{afci ? 'AFCI: arc-fault protection is provided by the breaker, so it is not drawn in the diagram. Use an AFCI breaker.' : 'No AFCI breaker is planned for this circuit.'}</li>
              <li>{gfci === 'first-receptacle' ? 'GFCI: make the first receptacle in the run a GFCI receptacle; it protects the receptacles after it.' : 'No GFCI is planned for this circuit.'}</li>
            </ul>
          </div>
          <p className="tabular-nums">
            <span className="font-medium">Planned load</span> <span className="text-muted-foreground">{loadText(info.plannedLoadVa, info.capacityVa)} (80 % of the breaker rating)</span>
          </p>
          <div>
            <h3 className="font-medium">Why</h3>
            <ReasonList reasons={info.reasons} className="mt-1.5" />
          </div>
          <p className="rounded-lg border bg-muted/50 p-2.5 text-xs">This plan is not a guarantee of code compliance.</p>
        </div>
      )}
    </section>
  );
}
