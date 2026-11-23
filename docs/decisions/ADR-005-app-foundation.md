# ADR-005: App foundation — monorepo, Hono, Drizzle, shadcn/ui

- **Status**: Accepted (2026-11-13)

## Context
ADR-001 fixed an all-TypeScript stack with a shared circuit schema. The backend framework, data layer, UI foundation and multi-user groundwork were left open.

## Decision
- **Repository**: one pnpm workspace.
  - `packages/core` — circuit schema, device catalogue, model validation; later the rule checker and wiring templates.
  - `packages/diagram` — two-level ELK layout and SVG rendering (ADR-004), ported from the spike with its tests.
  - `apps/api` — Hono HTTP API, Drizzle ORM over SQLite (better-sqlite3), Claude calls.
  - `apps/web` — React + Vite, Tailwind, shadcn/ui components.
- **Schema definition**: Zod in `packages/core`, used for Claude structured output, API validation and TypeScript types.
- **Multi-user groundwork**: every project row carries an owner id; one fixed local owner exists. No login, sessions or accounts.
- **First milestone**: an LLM vertical slice — describe a simple job in chat, get a validated circuit model and its diagram in a persistent project.

## Consequences
- The Claude API key lives only in the API's environment and never reaches the browser.
- Moving to Postgres later is a Drizzle driver and migration change.
- shadcn/ui components are copied into `apps/web` and maintained by us.
- Real authentication, if the tool goes public, is added on top of the owner column without a data migration.
