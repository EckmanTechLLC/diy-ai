import { X } from 'lucide-react';
import { themed, type PaletteName } from '@diy-ai/diagram/theme';
import type { CircuitModel, ScrewColor, WireColor } from '@diy-ai/core';
import { Button } from '@/components/ui/button';
import {
  capitalize,
  colorName,
  describe,
  placesText,
  rolesText,
  type Description,
  type Place,
  type Selection,
} from '@/lib/inspect';
import { cn } from '@/lib/utils';

/** A small disc in a diagram colour (the CSS variables are defined by the canvas around it). */
function Swatch({ fill, edge, className }: { fill: PaletteName; edge: PaletteName; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-3 shrink-0 rounded-full align-[-1px]', className)}
      style={{ background: themed(fill), boxShadow: `0 0 0 1px ${themed(edge)}` }}
    />
  );
}
const WireSwatch = ({ color }: { color: WireColor }) => (
  <Swatch fill={`wire-${color}` as PaletteName} edge={`wire-${color}-edge` as PaletteName} />
);
const ScrewSwatch = ({ screw }: { screw: ScrewColor }) => <Swatch fill={`screw-${screw}` as PaletteName} edge="screw-stroke" />;

function PlaceButton({ place, onSelect }: { place: Place; onSelect: (s: Selection) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(place.ref)}
      className="rounded-sm text-left underline decoration-border underline-offset-2 hover:bg-accent hover:text-accent-foreground hover:decoration-transparent"
    >
      {place.text}
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-x-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function Body({ d, onSelect }: { d: Description; onSelect: (s: Selection) => void }) {
  switch (d.kind) {
    case 'net':
      return (
        <>
          <dl className="grid gap-1">
            <Row label="Insulation">
              <span className="inline-flex flex-wrap items-center gap-x-2">
                {d.colors.map((c) => (
                  <span key={c} className="inline-flex items-center gap-1.5">
                    <WireSwatch color={c} /> {colorName(c)}
                  </span>
                ))}
              </span>
            </Row>
            <Row label="Role">{rolesText(d.roles)}</Row>
          </dl>
          <h3 className="mt-3 mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Lands on, panel to load
          </h3>
          <ol className="grid gap-1 text-sm" aria-label={placesText(d.places)}>
            {d.places.map((p, i) => (
              <li key={i} className="flex gap-2">
                <span className="w-4 shrink-0 text-right text-muted-foreground tabular-nums">{i + 1}.</span>
                <PlaceButton place={p} onSelect={onSelect} />
              </li>
            ))}
          </ol>
        </>
      );
    case 'device':
      return (
        <>
          <dl className="grid gap-1">
            <Row label="Type">
              {d.type}
              {d.amps !== undefined ? `, ${d.amps} A` : ''}
            </Row>
            <Row label="In">{d.box}</Row>
          </dl>
          <h3 className="mt-3 mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Terminals</h3>
          <ul className="grid gap-2.5">
            {d.terminals.map((t) => (
              <li key={t.name} className="text-sm">
                <div className="flex items-center gap-1.5 font-medium">
                  <ScrewSwatch screw={t.screw} />
                  <span className="font-mono text-xs">{t.name}</span>
                  <span className="font-normal text-muted-foreground">
                    {t.screw} screw, {t.role}
                  </span>
                </div>
                {t.connections.length === 0 ? (
                  <p className="pl-[1.125rem] text-muted-foreground">nothing connected</p>
                ) : (
                  <ul className="grid gap-0.5 pl-[1.125rem]">
                    {t.connections.map((c, i) => (
                      <li key={i} className="flex items-center gap-1.5">
                        <WireSwatch color={c.color} />
                        <PlaceButton place={c.to} onSelect={onSelect} />
                        <button
                          type="button"
                          onClick={() => onSelect({ kind: 'net', net: c.net })}
                          className="ml-auto shrink-0 rounded-sm px-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                          title="Select this wire"
                        >
                          wire
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </>
      );
    case 'cable':
      return (
        <>
          <dl className="grid gap-1">
            <Row label="Type">{d.type} NM-B cable</Row>
            <Row label="Runs from">{d.from}</Row>
            <Row label="Runs to">{d.to}</Row>
          </dl>
          <h3 className="mt-3 mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Conductors</h3>
          <ul className="grid gap-2">
            {d.conductors.map((c) => (
              <li key={c.color} className="text-sm">
                <div className="flex items-center gap-1.5 font-medium">
                  <WireSwatch color={c.color} /> {capitalize(colorName(c.color))}
                  {c.net && (
                    <button
                      type="button"
                      onClick={() => onSelect({ kind: 'net', net: c.net! })}
                      className="ml-auto rounded-sm px-1 text-xs font-normal text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      title="Select this wire"
                    >
                      wire
                    </button>
                  )}
                </div>
                <ul className="grid gap-0.5 pl-[1.125rem]">
                  {c.ends.map((e, i) => (
                    <li key={i}>
                      <span className="text-muted-foreground">{e.box}: </span>
                      {e.to ? <PlaceButton place={e.to} onSelect={onSelect} /> : <span className="text-muted-foreground">not connected</span>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      );
    case 'splice':
      return (
        <>
          <dl className="grid gap-1">
            <Row label="In">{d.box}</Row>
          </dl>
          <h3 className="mt-3 mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Wires joined</h3>
          {d.wires.length === 0 ? (
            <p className="text-sm text-muted-foreground">nothing connected</p>
          ) : (
            <ul className="grid gap-1 text-sm">
              {d.wires.map((w, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  <WireSwatch color={w.color} />
                  <PlaceButton place={w.to} onSelect={onSelect} />
                  <button
                    type="button"
                    onClick={() => onSelect({ kind: 'net', net: w.net })}
                    className="ml-auto shrink-0 rounded-sm px-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    title="Select this wire"
                  >
                    wire
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      );
  }
}

const KIND_LABEL: Record<Description['kind'], string> = { net: 'Wire', device: 'Device', cable: 'Cable', splice: 'Wire nut' };
const titleOf = (d: Description): string => (d.kind === 'net' ? d.title : d.name);

/** Describes the selected item. Renders nothing when there is no selection. */
export function DiagramInspector({
  model,
  selection,
  onSelect,
  onClose,
}: {
  model: CircuitModel;
  selection: Selection | null;
  onSelect: (s: Selection) => void;
  onClose: () => void;
}) {
  const d = selection ? describe(model, selection) : null;
  if (!d) return null;
  return (
    <aside
      aria-label="Selection details"
      className="absolute top-3 right-3 z-10 flex max-h-[calc(100%-1.5rem)] w-80 max-w-[calc(100%-1.5rem)] flex-col rounded-lg border bg-card/95 text-card-foreground shadow-lg backdrop-blur max-sm:inset-x-3 max-sm:top-auto max-sm:bottom-16 max-sm:w-auto max-sm:max-h-[50%]"
    >
      <div className="flex items-start gap-2 border-b px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{KIND_LABEL[d.kind]}</p>
          <h2 className="text-sm font-semibold break-words">{titleOf(d)}</h2>
        </div>
        <Button variant="ghost" size="icon" className="-mr-1 size-7" onClick={onClose} aria-label="Clear selection" title="Clear selection (Esc)">
          <X />
        </Button>
      </div>
      <div className="min-h-0 overflow-y-auto px-3 py-2.5" aria-live="polite">
        <Body d={d} onSelect={onSelect} />
      </div>
    </aside>
  );
}
