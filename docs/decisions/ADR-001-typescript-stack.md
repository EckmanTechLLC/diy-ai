# ADR-001: All-TypeScript stack with React

- **Status**: Accepted (2026-11-13)

## Context
The predecessors used Flask + vanilla JS (eai) and FastAPI + Postgres + React (aib). Both stalled on hand-rolled Python diagram engines. Research on 2026-11-13 found that the usable open-source layout/routing engines are all JavaScript: `elkjs`, `libavoid-js`, and `tscircuit` (for the later electronics phase, with a React schematic viewer).

## Decision
- One language: TypeScript, Node 20, pnpm.
- Frontend: React + Vite.
- Backend: Node API with SQLite behind an ORM, so a later move to Postgres is configuration.
- One shared package holds the circuit schema, rule checker and layout code, used by both frontend and backend.

## Consequences
- The circuit schema is defined once and drives Claude's structured output, the rule checks and the renderer.
- No Python code from eai/aib is reused.
- Backend framework, ORM and UI component library are still open and need their own decisions.
- Dependencies must be permissively licensed (MIT/Apache/ISC/EPL/MPL acceptable; GPL, AGPL and CC-BY-SA are not) because the tool may be made public.
