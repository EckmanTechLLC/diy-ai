# ADR-004: ELK with two-level layout as the diagram engine

- **Status**: Accepted (2026-11-13)

## Context
eai and aib both failed on hand-rolled placement and wire routing. A three-round spike (`spike/diagram/`, tasks 01–03) tested `elkjs` 0.12 (`layered`, orthogonal routing, fixed-position ports) on four hand-written circuits: single-pole switch, 3-way, GFCI with downstream receptacle, and a 2-gang box. The user judged the output clear and easy to follow.

Spike findings:
- All geometric invariants held with no custom routing: orthogonal segments, no overlapping wires of different nets, nothing outside the canvas, wires ending exactly on terminals.
- In a single hierarchical run ELK ignores ordering inputs inside a box and can route a wire outside its box.
- Laying out each box interior in its own ELK run, then arranging boxes and cables in a top-level run, guarantees conductor order and keeps wires inside their box, at the cost of diagrams about a quarter wider. Crossing counts were the same for both approaches (1, 2, 0, 6).
- ELK option tuning did not reduce crossings further; the remaining ones appear inherent to left-to-right flow (a device's ground pigtail crossing pass-through conductors).

## Decision
- `elkjs` does all node placement and wire routing. No hand-written placement or routing, and no editing of ELK's bend points.
- Two-level layout: one flat ELK run per box, with nodes assigned to columns by a deterministic slot rule (incoming conductors, splices feeding device inputs, devices, other splices, outgoing conductors); one top-level run placing boxes and cables. Box interiors are translated as a whole into place.
- Conductor order inside every cable is fixed: black, red, white, bare.
- Device orientation (normal or mirrored) is computed from the topology, never supplied by the model or by Claude.
- Rendering is our own SVG, drawing ELK geometry verbatim, with every wire tagged by net for hover-highlight.
- The spike's invariant tests (including crossing counts, conductor order, label fit) carry over to the real diagram module as regression tests.

## Consequences
- Terminal positions and order in the device catalogue directly affect diagram quality and must be designed per device.
- Unproven and to be tested inside the real module: 4-way switches, multi-wire branch circuits, 240V circuits, switched half-hot receptacles, runs of 8+ boxes, cables entering a box from both sides, boxes with three or more devices, several wires on one terminal, and layout time on large graphs.
- Long runs grow wide; wrapping or an alternative flow direction is undecided.
- Fallback if ELK fails on harder circuits: keep ELK for placement and route with `libavoid-js` (LGPL-2.1, WASM, kept as a separate file).
- `spike/diagram/` is kept as reference and is not part of the app.
