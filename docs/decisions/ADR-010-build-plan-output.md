# ADR-010: Build-plan output — materials and steps derived from the circuit by code

- **Status**: Accepted (2026-11-23)

## Context
A diagram shows how a circuit is wired; a build plan also has to say what to buy and what to do, in order. The two predecessor projects let a language model write this and produced plausible but unverifiable plans. User decisions 2026-11-23: code writes both the materials list and the steps from the circuit; cable lengths are entered by the user per run; each circuit gets Diagram / Materials / Steps tabs and the project gets one printable document.

## Decision
- **Materials are counted from the circuit model**, never written by a model: devices by type, boxes by the number of devices they hold, cable runs by type, wire nuts (one per splice, with the conductors it joins), pigtails by colour and gauge, cover plates, and the breaker with its rating and — for circuits built from a plan — its required type (standard, AFCI, dual-function). Items the tool cannot determine are listed as such, not guessed: box volume (box fill is not calculated yet), receptacle rating, fixtures and fans of the user's choosing, panel brand, staples, connectors and other consumables.
- **Cable lengths come from the user.** Every cable run is listed with its endpoints and type; the user may enter a length per run. Totals per cable type include a stated, adjustable allowance and are shown only for runs that have a length; missing lengths are shown as missing, never estimated.
- **Steps are derived mechanically from the circuit's connections**, so they always agree with the diagram: fixed phases (before you start; rough-in — mount boxes and pull each cable; make-up — box by box in power-flow order, grounds first, then neutrals, then hots/switched/travelers, each step naming the exact conductors, wire nut or terminal screw; devices and cover plates; panel connection last; power-up and testing), with short hand-written notes per device type (for example GFCI LINE versus LOAD, the 3-way common screw). The same generator serves block-built and free-wired circuits; free-wired circuits keep their "unverified" marking on every output.
- **Our own wording only.** No code text; safety, permit and inspection notes are fixed texts written for this tool. Steps describe the wiring in the model; they do not claim compliance.
- **Presentation**: per-circuit tabs (Diagram, Materials, Steps); a project-level print view producing one document — plan summary, combined shopping list, then each circuit's diagram, materials and steps — printed or saved as PDF through the browser.

## Consequences
- Cable lengths are stored per circuit (database change in the API task).
- The generators are pure functions in `packages/core`, tested against every block and fixture; a step or material that references something not in the circuit is a test failure.
- Instruction text reads uniform rather than conversational; that is the accepted cost of always matching the diagram.
- Box sizing, receptacle rating and conduit work remain open until the corresponding rules exist.
