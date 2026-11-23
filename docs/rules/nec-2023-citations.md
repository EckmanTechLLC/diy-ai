# NEC 2023 citation checklist

Generated from the rule registry in `packages/core/src/rules.ts` (a test keeps this file in sync). Edition: NEC 2023.

"Confirmed" means you have checked that the cited section really supports the rule, in the code book or with an electrician. Until then every citation is an unverified starting point from research. No code text is reproduced here or in the app: the statements are our own wording.

| Rule | What it checks | Severity | Cited section | Confirmed |
| --- | --- | --- | --- | --- |
| `circuit-valid` | The circuit passes structural validation before any electrical rule runs. | error | none listed | no |
| `model-assumptions` | The circuit has exactly one breaker, one neutral bar and one ground bar, all in the panel. | error | none listed | no |
| `ground-continuity` | Every device ground terminal and every cable bare conductor is connected to the ground bar. | error | 250.4(A)(5) / 250.148 / 404.9(B) / 406.4(A) | no |
| `ground-conductors-only` | Only bare or green wires are on the ground net, and bare or green wires are on no other net. | error | 250.119 | no |
| `no-short` | The breaker hot, neutral bar and ground bar are never joined, and no switch joins a hot directly to the neutral or ground. | error | none listed | no |
| `neutral-continuity` | Every neutral terminal reaches the neutral bar, directly or through the neutral side of a correctly fed GFCI. | error | none listed | no |
| `neutral-not-switched` | No switch terminal is on the neutral; only the hot conductor is switched. | error | 404.2(B) | no |
| `load-fed` | Every light and receptacle hot terminal can be reached from the breaker, directly or through switches or a GFCI. | error | none listed | no |
| `three-way-pairing` | Each 3-way switch has its two travelers wired one-to-one to the two travelers of one other 3-way, with one common on the feed and the other leading to the load. | error | 404.2(A) | no |
| `gfci-orientation` | The GFCI feed is on its LINE terminals, the LOAD terminals are both used or both unused, and LOAD never connects back to the feed or neutral. | error | 110.3(B) | no |
| `breaker-conductor-match` | The breaker rating does not exceed the limit for the smallest conductor on the circuit (14 AWG: 15 A, 12 AWG: 20 A, 10 AWG: 30 A), and is a known rating. | error | 240.4(D) | no |
| `wire-colour-role` | Black and red wires are never on the neutral (error); a white wire used as a hot, switched or traveler conductor needs re-marking (reported as a warning). | error | 200.6 / 200.7(C) | no |
| `neutral-at-switch-box` | Every box that contains a switch has a neutral conductor present. | warning | 404.2(C) | no |
| `floating-conductors` | No device terminal sits on a net that is connected to none of the breaker, neutral or ground. | warning | none listed | no |
