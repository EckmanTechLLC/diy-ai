# ADR-009: Planner — the model lists the rooms, code splits them into circuits

- **Status**: Accepted (2026-11-23) — room rules and design defaults approved by the user as a starting set; citations unconfirmed

## Context
A real job is a set of rooms, not a set of circuits. The user's basement finish is a living area (8 receptacles, 8 recessed lights on two 3-way switches), a bathroom (3 receptacles, light, fan), a closet and a bedroom. Today the user must decide the circuit split and describe each circuit separately. ADR-008 left the planner (step 4) undecided. User decisions 2026-11-23: the model only produces an inventory and deterministic code makes the split; the plan is reviewed in chat, not in an editable table; the room rules the split relies on are built together with the planner.

## Decision
- **Inventory, not circuits.** For a whole-job request the model returns a room-by-room inventory: for each room a name, a room type from a fixed list, the number of receptacles, the light groups (lights per group and whether one or two switch locations control it) and exhaust fans; plus whether the space is a basement. It makes no electrical decision. Anything it cannot determine it asks about, as today.
- **Deterministic splitter** in `packages/core`: inventory in, plan out. A plan is an ordered list of circuits, each with a name, breaker size, the rooms and items it serves, its block list (ADR-008 blocks only), the protection it requires, and the reasons — one plain sentence per decision, each tied to a room rule or a stated design default. The same inventory always gives the same plan.
- **Two kinds of reason, never mixed.** *Room rules* are code-derived requirements with an NEC 2023 citation, `confirmed: false` until the user confirms them (ADR-007 conventions; no code text stored or shown). *Design defaults* are this tool's own conservative choices (how many receptacles per circuit, lighting kept off receptacle circuits, assumed fixture wattage); they are labelled as defaults, cite nothing and can be overridden in chat.
- **First set of room rules** (room types: living area, bedroom, closet, hallway, bathroom; everything else is reported as not covered yet):
  1. Bathroom receptacles are on a 20 A circuit that serves no other room; lights and fan of that same bathroom may share it.
  2. Every bathroom receptacle is GFCI protected.
  3. Every receptacle in a basement is GFCI protected.
  4. Circuits serving living areas, bedrooms, closets and hallways need arc-fault (AFCI) protection.
  5. Each room has at least one switch-controlled light (warning if the inventory has none).
  6. Planned load on a circuit stays within 80 % of the breaker rating, using stated assumed loads.
  Receptacle spacing along walls, smoke alarms and box fill cannot be judged from an inventory; the plan carries them as reminders, not checks.
- **Starting design defaults** (user decision: lights and outlets separate): lighting of living areas, hallways and unattached closets goes on shared 15 A lighting circuits; receptacles go on 20 A circuits with at most 8 per circuit; a bedroom's lights and receptacles share one 15 A circuit when the load allows, together with any closet stated as belonging to it; each bathroom is one 20 A circuit. Assumed loads for the 80 % check are stated in the plan.
- **Protection in the plan.** GFCI is met inside the wiring by a GFCI receptacle first in the run, with lighting blocks ordered before it so a trip does not put the room in the dark. AFCI is a property of the breaker; the plan states it as a requirement on the circuit ("AFCI breaker", or "dual-function breaker" where both apply). The circuit schema and diagrams are unchanged in this step.
- **Review in chat.** The plan is shown as a chat message with its circuits and reasons. The user changes it in words ("put the closet light on the bedroom circuit", "use 15 A for the lights"); changes go back through the model as inventory edits or stated overrides and through the splitter again, never as a model-written plan. "Build it" creates every circuit of the plan through the existing path, so each still passes structural validation and all rule checks (ADR-007) before it is stored; a plan whose circuits do not all pass is not applied.
- **Rule checks on built circuits** gain the location rules that need the room type (bathroom/basement GFCI), so a circuit edited later is still checked. Detailed scope is set in the task.

## Consequences
- The reply contract gains an inventory outcome. The schema is already near Claude's structured-output limit (task 27), so the change must be probed on every provider; if it does not fit, planning uses its own smaller reply schema for that request.
- The project stores its inventory and current plan (database migration; the API must be stopped first — CLAUDE.md, Lessons Learned 1).
- The splitter cannot know the physical route of cables; it chains rooms in the order given and says so. Kitchens, laundry, garages, outdoor, 240 V and extending existing circuits are not planned yet.
- A plan that passes is not a guarantee of code compliance; local amendments and the inspector decide. The UI keeps saying so.
