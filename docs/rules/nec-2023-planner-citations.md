# NEC 2023 planner citation checklist

Generated from the room rule registry in `packages/core/src/planner/rules.ts` (a test keeps this file in sync). Edition: NEC 2023.

"Confirmed" means you have checked that the cited section really supports the rule, in the code book or with an electrician. Until then every citation is an unverified starting point from research. No code text is reproduced here or in the app: the statements are our own wording.

| Rule | What it requires | Severity | Cited section | Confirmed |
| --- | --- | --- | --- | --- |
| `bath-receptacle-circuit` | Bathroom receptacles are on a 20 A circuit that serves no other room; the lights and fan of that same bathroom may share it. | error | 210.11(C)(3) | no |
| `bath-gfci` | Every bathroom receptacle is GFCI protected. | error | 210.8(A)(1) | no |
| `basement-gfci` | Every receptacle in a basement is GFCI protected. | error | 210.8(A)(5) | no |
| `afci-living-areas` | Circuits serving living areas, bedrooms, closets and hallways need arc-fault (AFCI) protection. | error | 210.12 | no |
| `switched-light` | Each room has at least one light controlled by a wall switch. | warning | 210.70(A) | no |
| `planned-load` | The planned load on a circuit stays within 80 % of its breaker rating, using the stated assumed loads (a planning limit of this tool, not a cited rule). | error | none listed | no |
