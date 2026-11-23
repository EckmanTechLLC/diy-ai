# ADR-002: Claude emits topology only, composed from verified templates

- **Status**: Accepted (2026-11-13)

## Context
Accuracy is the top requirement. Published LLM-to-circuit work (SchGen, CircuitLM, PCBSchemaGen, 2026) reports far higher validity when the model emits topology addressed by pin names from a component database than when it emits coordinates, wire segments or raw files, and shows that static rule checks alone overstate correctness. No independent benchmark of LLMs on NEC topology (travelers, switched neutrals, multi-wire branch circuits) was found.

## Decision
- Claude outputs a flat circuit model: boxes, devices, cables, conductors, splices and connections. Every connection endpoint is a named terminal from a device catalogue we own. Claude never outputs coordinates or wire paths.
- Claude selects and parameterises from a library of hand-verified wiring templates (target 15–20: single-pole, 3-way/4-way variants, GFCI line/load, multi-wire branch circuit, 240V appliance, switched receptacle, etc.).
- If no template fits, Claude may generate topology freely. That plan is visibly marked "unverified topology".
- Deterministic rule checks run on every model, template-derived or not, and return terminal-level errors that feed a retry loop.

## Consequences
- The template library and a regression set of known-good and seeded-bad circuits must be authored by us; no licensed catalogue exists.
- The schema must be flat (no recursion) and numeric ranges must be validated in our code, because Claude's structured outputs cannot express either.
- Web-search or citation calls must be separate from the structured circuit-model call (the two features cannot be combined in one request).
- NEC edition is a parameter of every rule. Rule data is our own tables with section citations and provenance, with no NEC text.
