# ADR-008: Circuits composed from building blocks; projects with several circuits

- **Status**: Accepted in part (2026-11-15) — steps 1 and 2 approved; steps 3 and 4 need further decisions

## Context
The user's real projects do not fit whole-circuit templates. A basement finish needs runs of eight receptacles, eight recessed lights on a pair of 3-way switches, a bathroom with fan, a closet and a bedroom — several circuits, each a chain of familiar pieces with varying counts. ADR-002's goal (the model composes verified wiring instead of inventing it) still holds; the unit of verification has to become smaller than a whole circuit.

## Decision
- **Building blocks** in `packages/core`: parameterised builders that each add a verified piece of wiring to a circuit and can pass unswitched power on to the next block. First set: panel feed; run of N receptacles (optionally GFCI first, protecting the rest); single-pole switch with N lights; 3-way pair with N lights; switch with exhaust fan. A circuit is a breaker size plus an ordered list of blocks.
- **Wiring conventions** (user decisions): receptacles in a run are pigtailed — incoming and outgoing conductors are spliced in each box with a pigtail to the device; lights on one switch are daisy-chained light to light with splices in each fixture box; the last device in a chain is wired directly.
- Every block combination must pass structural validation and every rule check with no findings, for every count in the supported range. Counts change topology by design; that is what the tests are for.
- The four whole-circuit templates remain valid and unchanged for now.
- **Diagram scale is verified before anything is built on blocks** (step 2): realistic 8-device circuits go through the existing diagram package and the user reviews the result.
- **Planned, not yet decided in detail** — step 3: a project holds several circuits, and the model's reply lists blocks instead of picking a template; step 4: a planner that turns rooms and their contents into a proposed circuit split, checked by location-based rules (Batch B).

## Consequences
- The device catalogue gains an exhaust fan (and its diagram geometry).
- Long chains produce wide diagrams; wrapping or another layout answer may be needed after step 2.
- Step 3 changes the database schema and the reply contract and requires re-running the model comparison.
- Out of scope for these blocks: extending an existing circuit, conduit with individual conductors, metal boxes, 240 V, multi-wire branch circuits, combination fan/light units, smoke alarms.
