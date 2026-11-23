# diy-ai

## Project Details
- **Purpose**: Generate accurate, easy-to-follow build plans for DIY projects (requirements, BOM, tools, safety, wiring diagram, step-by-step instructions). v1 covers US residential electrical wiring; electronics schematics and breadboard layouts come later. Successor to the unfinished `eai` and `aib` projects (`~/backups/eai_260424`, `~/backups/aib_260424`) — reference only, no code is carried over.
- **Phase**: PoC — milestone 1, LLM vertical slice (see `.odin/tasks/`)
- **Created**: 2026-11-13
- **Users**: single local user now; may be made public later, so avoid GPL/AGPL/CC-BY-SA dependencies and never ship NEC text.
- **Priorities**: accuracy first, then ease of use. UI/UX must be exceptional.

## Technology Stack
- All TypeScript (ADR-001). Node 20, pnpm.
- Frontend: React + Vite, Tailwind, shadcn/ui (ADR-005).
- Backend: Hono, Drizzle ORM over SQLite (better-sqlite3) (ADR-005).
- Schema: Zod, defined once in `packages/core`.
- Diagrams: `elkjs` two-level layout and orthogonal routing, own SVG renderer (ADR-004).
- LLM: Claude API, structured outputs; key stays server-side.

## Project Structure
```
diy-ai/
  packages/core/     — circuit schema, device catalogue, validation (later: rules, templates)
  packages/diagram/  — ELK layout + SVG rendering, ported from the spike
  apps/api/          — Hono API, Drizzle/SQLite, Claude calls
  apps/web/          — React app
  spike/diagram/     — diagram engine spike (tasks 01–03); reference only, not part of the app
  docs/decisions/    — ADRs
```

## Architecture
- A persistent project document (plan sections + diagram) is the main surface; a chat sidebar asks clarifying questions and applies edits to it.
- Claude emits wiring **topology only**, addressed by named terminals from a device catalogue we own — never coordinates or wire paths (ADR-002).
- Claude composes from hand-verified wiring templates; free generation is a fallback and is marked "unverified topology" (ADR-002).
- Deterministic code, not the LLM, checks the circuit model against electrical rules; every check cites its rule and NEC edition.
- One shared circuit schema drives LLM output, rule checks and the diagram.
- Diagrams are pictorial (ADR-003): devices with terminal screws, cables as sheaths fanning out into coloured conductors, wire nuts drawn as objects (no junction dots).
- No hand-rolled layout or routing — that is what sank eai and aib.

---

## Mandatory Workflow

For **EVERY** change, task, or request:

1. **STOP** — Do not implement yet
2. **READ** — Read existing related files first
3. **VERIFY** — Check schemas, signatures, callers, dependencies
4. **PROPOSE** — Propose changes that fit existing architecture
5. **WAIT** — Do NOT implement until explicitly approved
6. **IMPLEMENT** — After approval, implement exactly what was approved

**No exceptions. No shortcuts.**

## Forbidden Actions
- No implementing without approval
- No skipping ahead to "the next logical step"
- No assumptions about what might be needed
- No adding libraries or dependencies without approval
- No creating placeholder/mock/fake data
- No running the application — user runs all services (no dev servers, no long-running processes, nothing that binds a port)

## What agents may run (approved 2026-11-13)
Implementation agents may, inside this project directory only: `pnpm install` for dependencies an approved task lists, type checks, tests, and one-off scripts.

**This machine is a shared dev server hosting many other projects. Do not break them:**
- Touch nothing outside `/home/etl/projects/diy-ai` (no other projects, no home-directory config, no `~/backups`).
- No global installs (`pnpm add -g`, `npm i -g`, `corepack enable`, `pip`, `apt`), no `sudo`, no changes to global pnpm/npm/git config or to the Node version.
- Do not start, stop, restart or kill any process or service, and do not bind ports.
- Do not delete or prune shared caches or stores (`pnpm store prune`, `docker` commands, etc.).
- If a task seems to need any of the above, stop and report instead.
- No committing or pushing to git unless explicitly requested

## Conventions
- Follow existing patterns and style
- No over-engineering — minimum complexity for the task
- Small incremental changes
- Be concise and direct — no verbose responses
- Always read files before modifying — never rely on memory
- Challenge incorrect assumptions

## Documentation Structure
```
docs/
  decisions/     — ADRs for major architectural decisions
.odin/
  tasks/         — Task prompts from foundation sessions
  sessions/      — Implementation session summaries (canonical write location)
  project-index.md — Code intelligence index (auto-generated)
CLAUDE.md        — This file (rules + project context)
```

## Lessons Learned
_(Add corrections and recurring mistakes here as they occur)_

1. **Migrations and the watch-mode dev server (2026-11-15).** The API dev server (`tsx watch`) restarts on every source change and applies pending migrations on start. During task 23 it applied a half-written migration to the user's live database (`apps/api/data/`) and five projects' circuits were dropped (recovered from the write-ahead log). Rules from now on:
   - Before dispatching any task that adds or edits a migration, the foundation session asks the user to stop the API dev server and waits for confirmation.
   - An implementation agent that finds the API dev server running when its task involves a migration stops and reports instead of proceeding.
   - Never write a migration file into `apps/api/drizzle/` until it is complete, including any data-copy statements; build it elsewhere first.
   - `apps/api/data/` is the user's data. Agents never read, copy, migrate or modify it.
2. **Reply-schema changes must be proven against every provider (2026-11-16).** Task 22's block-based reply schema was only tested with stubs; Claude's API rejects it ("compiled grammar is too large"). Any task that changes `packages/core/src/reply.ts` must include a real smoke request to each configured provider, or be followed immediately by a task that does.

## Known Issues
- **Claude is broken in the app (since task 22).** The reply schema is too large for Claude structured outputs. User decision 2026-11-16: leave it for now; local models work. Likely fix when wanted: drop the per-block label fields and trim the custom-circuit section, verified with real requests.
- **Eval cases to correct before the next run** (user decision 2026-11-16: the model always asks for the breaker size when it is not stated): `template-sp-2`, `template-3w-2`, `template-gfci-2`, `template-tg-2` should expect a question; `mb-6` (dishwasher) should not say "not GFCI" and should not grade the GFCI flag.

## Current Decisions (quick reference)
- Preferred local model: `gpt-oss-120b` (Odin box, port 8004); `qwen3.6-coder` (port 8002) is faster but declines supported jobs.
- Diagram is always drawn on a light "paper" sheet, in both app themes.
- Long circuits wrap (ELK wrapping) above a width threshold; short ones stay a strip.
- Receptacle runs are pigtailed; lights on one switch are daisy-chained.

---

See `docs/decisions/` for ADRs and `.odin/tasks/` for implementation tasks.
