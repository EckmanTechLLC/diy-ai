# ADR-003: Pictorial residential wiring diagrams

- **Status**: Accepted (2026-11-13)

## Context
The diagram must be easy for a layperson to follow at the electrical box. eai drew a schematic-style line diagram with junction dots and crossing arcs, both of which were chronic bug sources.

## Decision
- Devices are drawn as they look, with brass, silver and green terminal screws at fixed positions.
- Each electrical box is a container holding its devices and splices.
- Each cable is drawn as a sheath (labelled e.g. "14/2 NM-B") that fans out into individually coloured conductors at each end.
- Every splice is drawn as an object (wire nut / lever connector). There are no free-floating junction dots.
- A schematic line view is not part of v1.

## Consequences
- About 15 device drawings must be produced by us; no reusable permissively licensed art was found.
- Terminal positions in the layout must match the screw positions in the device art exactly.
- Every drawn conductor carries conductor, net and step identifiers so hover-highlight and per-step highlighting are style toggles.
- The layout/routing engine choice is made by the task-01 spike and recorded in a later ADR.
