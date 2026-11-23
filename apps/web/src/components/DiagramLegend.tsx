import { LEGEND, themed } from '@diy-ai/diagram/theme';

/** What each colour in the diagram means. Swatches use the same variables as the diagram, so they follow the theme. */
export function DiagramLegend({ id }: { id: string }) {
  return (
    <div
      id={id}
      role="region"
      aria-label="Diagram legend"
      className="absolute bottom-16 left-3 z-10 max-h-[calc(100%-5rem)] w-80 max-w-[calc(100%-1.5rem)] overflow-y-auto rounded-lg border bg-card/95 px-3 py-2.5 text-card-foreground shadow-lg backdrop-blur"
    >
      {LEGEND.map((group) => (
        <section key={group.title} className="mb-3 last:mb-0">
          <h3 className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{group.title}</h3>
          <ul className="grid gap-1.5">
            {group.entries.map((e) => (
              <li key={e.name} className="grid grid-cols-[1rem_1fr] items-start gap-x-2 text-sm">
                <span
                  aria-hidden
                  className="mt-0.5 size-3.5 rounded-sm"
                  style={{ background: themed(e.name), boxShadow: `0 0 0 1px ${themed(e.edge ?? 'device-stroke')}` }}
                />
                <span>
                  <span className="font-medium">{e.label}.</span> <span className="text-muted-foreground">{e.meaning}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
