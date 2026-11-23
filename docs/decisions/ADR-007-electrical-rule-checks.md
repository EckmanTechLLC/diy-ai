# ADR-007: Deterministic electrical rule checks

- **Status**: Accepted (2026-11-15)

## Context
Structural validation only proves a circuit model is well-formed. It does not prove the wiring is electrically sound. The model comparison showed local models guess, and the free-wiring fallback is the weakest path for every model. Accuracy is the project's first priority, and ADR-002 requires deterministic checks on every circuit.

## Decision
- A rule engine in `packages/core` checks a circuit and returns findings. Each finding has a rule id, a severity (`error` or `warning`), a plain-language message naming the devices, terminals and wires involved, and a citation.
- **Batch A (first): wiring logic**, needing no new model data — grounding continuity, nothing but the hot conductor switched, neutrals continuous and unswitched, loads fed from the breaker, no shorts between hot, neutral and ground, 3-way traveler pairing, GFCI line/load orientation, wire colour against role, breaker size against conductor gauge, neutral present in switch boxes.
- **Batch B (later): data-driven** — box fill, GFCI/AFCI by location, voltage drop, receptacle rating. These need new model fields and sourced tables and get their own decision.
- **Edition**: rules target NEC 2023. Every rule and citation carries its edition so other editions can be added as overlays.
- **Citations are unconfirmed by default.** Section numbers come from research and model knowledge, not from the code text. Each citation carries `confirmed: false` until the user confirms it against the code book or with an electrician. No NEC text is stored or shown; messages are our own wording.
- **Behaviour in chat**: rule errors are fed back to the model within its existing bounded retries. If errors remain, the circuit is not applied and the chat explains which rules failed. Warnings do not block; they are stored with the circuit and shown beside the diagram.
- Templates and fixtures must pass every rule with no errors. A rule that flags a verified template is a bug in the rule or the template and must be resolved, never suppressed.

## Consequences
- The device catalogue gains each device's internal current paths (which terminals a switch or GFCI connects), which the rules need to trace power.
- Rules assume a single 120 V branch circuit with one breaker for now; multi-circuit, 240 V and multi-wire branch circuits need rule extensions before templates for them are added.
- Passing the rules is not a guarantee of code compliance. The UI must say so and keep the permit/inspection message.
