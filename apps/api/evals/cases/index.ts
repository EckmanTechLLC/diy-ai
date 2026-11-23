import type { EvalCase } from './types';

export type { BlockExpect, Category, CustomFact, EvalCase, Expect, Seed, SeedCircuit, Step, TerminalRef } from './types';

// Former whole-circuit templates as the equivalent block lists (verified equal to the old fixtures in packages/core tests).
const SP = [{ type: 'switch_lights', count: 1 }]; // single_pole_switch: one switch, one light
const TW = [{ type: 'three_way_lights', count: 1 }]; // three_way_switches: 3-way pair, one light
const GF = [{ type: 'receptacle_run', count: 2, gfciFirst: true }]; // gfci_downstream_receptacle: GFCI + one downstream receptacle
const TG = [{ type: 'two_gang_switches', countA: 1, countB: 1 }]; // two_gang_two_switches: 2-gang box, one light per switch

const groundedCustom = (hotTo: { type: string; terminal: string }[], counts: Record<string, number>, breakerAmps?: number) => ({
  kind: 'custom' as const,
  facts: [
    ...hotTo.map((b) => ({ kind: 'connected' as const, a: { type: 'breaker', terminal: 'out' }, b })),
    { kind: 'groundsBonded' as const },
  ],
  deviceCounts: counts,
  ...(breakerAmps ? { breakerAmps } : {}),
});

export const CASES: EvalCase[] = [
  // ---- blocks (8 from the former templates, plus custom-1, custom-3 and trap-2 re-categorised in task 25); some state the breaker size
  {
    id: 'template-sp-1',
    category: 'blocks',
    steps: [
      {
        user: 'I am adding a wall switch for the new ceiling light in my garage. The cable from the panel comes into the switch box first, and then a cable goes up to the light. It is on a 20 amp breaker.',
        expect: { kind: 'blocks', blocks: SP, breakerAmps: 20 },
      },
    ],
    rationale: 'One switch, one light, power arrives at the switch box first: single-pole template applies; stated 20 A breaker.',
  },
  {
    id: 'template-sp-2',
    category: 'blocks',
    steps: [
      {
        user: 'One switch should control one light in my hallway. Power comes into the switch box, and from there a cable runs to the light fixture.',
        expect: { kind: 'blocks', blocks: SP },
      },
    ],
    rationale: 'One switch, one light, power at the switch box first: single-pole template applies; breaker size not stated so no parameter is checked.',
  },
  {
    id: 'template-3w-1',
    category: 'blocks',
    steps: [
      {
        user: 'I want to control my stairwell light from the top and the bottom of the stairs. The power from the panel, on a 15 amp breaker, comes into the bottom switch box, and the light is fed from the top switch box.',
        expect: { kind: 'blocks', blocks: TW, breakerAmps: 15 },
      },
    ],
    rationale: 'One light from two places, power at one switch box and the light beyond the other: 3-way template applies; stated 15 A breaker.',
  },
  {
    id: 'template-3w-2',
    category: 'blocks',
    steps: [
      {
        user: 'My hallway light needs a switch at each end. The power cable arrives at the first switch box, and the light is wired from the second switch box.',
        expect: { kind: 'blocks', blocks: TW },
      },
    ],
    rationale: 'One light from two places, power at the first switch box, light beyond the second: 3-way template applies.',
  },
  {
    id: 'template-gfci-1',
    category: 'blocks',
    steps: [
      {
        user: 'In the garage I want a GFCI outlet with exactly one regular outlet after it that gets its GFCI protection from it. It is on a 20 amp breaker.',
        expect: { kind: 'blocks', blocks: GF, breakerAmps: 20 },
      },
    ],
    rationale: 'A GFCI receptacle with exactly one standard receptacle downstream: GFCI template applies; stated 20 A breaker.',
  },
  {
    id: 'template-gfci-2',
    category: 'blocks',
    steps: [
      {
        user: 'Next to my bathroom sink I want a GFCI receptacle, and one ordinary outlet on the same wall that is protected through it.',
        expect: { kind: 'blocks', blocks: GF },
      },
    ],
    rationale: 'A GFCI receptacle with exactly one standard receptacle downstream: GFCI template applies; breaker size not stated.',
  },
  {
    id: 'template-tg-1',
    category: 'blocks',
    steps: [
      {
        user: 'In the kitchen I have a double switch plate in one box: one switch for the ceiling light and one for the pantry light, and each light has its own cable from that box. The power comes into that switch box from a 15 amp breaker.',
        expect: { kind: 'blocks', blocks: TG, breakerAmps: 15 },
      },
    ],
    rationale: 'Two switches in one 2-gang box, each controlling its own light, power at the switch box: 2-gang template applies; stated 15 A breaker.',
  },
  {
    id: 'template-tg-2',
    category: 'blocks',
    steps: [
      {
        user: 'My bedroom has two switches side by side in one double box. The left one turns on the ceiling light and the right one turns on a closet light, each light on its own cable. The power cable comes into the double box.',
        expect: { kind: 'blocks', blocks: TG },
      },
    ],
    rationale: 'Two switches in one 2-gang box, each controlling a separate light, power at the switch box: 2-gang template applies.',
  },

  // ---- question (4): a fact a template depends on is missing
  {
    id: 'question-1',
    category: 'question',
    steps: [{ user: 'I want to control a light from two switches.', expect: { kind: 'question' } }],
    rationale: '3-way template needs power at one switch box and the light beyond the other; where power enters is not stated.',
  },
  {
    id: 'question-2',
    category: 'question',
    steps: [{ user: 'I need a wall switch to turn on my new light.', expect: { kind: 'question' } }],
    rationale: 'Single-pole template applies only when power arrives at the switch box first; where power enters is not stated.',
  },
  {
    id: 'question-3',
    category: 'question',
    steps: [
      {
        user: 'I am putting a GFCI outlet and some regular outlets on the same circuit in my workshop.',
        expect: { kind: 'question' },
      },
    ],
    rationale: 'GFCI template needs exactly one downstream receptacle; "some regular outlets" leaves the count open.',
  },
  {
    id: 'question-4',
    category: 'question',
    steps: [{ user: 'I want switches for the two lights in my laundry room.', expect: { kind: 'question' } }],
    rationale: '2-gang template needs both switches in one box with power arriving there; box layout and power entry are not stated.',
  },

  {
    id: 'question-5',
    category: 'question',
    steps: [
      {
        user: 'In the basement bedroom I want a wall switch for the ceiling lights, and then some outlets on the same circuit. The power cable comes into the switch box first.',
        expect: { kind: 'question' },
      },
    ],
    rationale: 'Prompt: ask how many of each thing; the number of lights, the number of outlets and the breaker size are all missing.',
  },
  {
    id: 'question-6',
    category: 'question',
    steps: [
      {
        user: 'In the workshop I want a wall switch that controls 3 ceiling lights, and after the switch box a row of 4 receptacles that are always on. The power cable from the panel comes into the switch box first.',
        expect: { kind: 'question' },
      },
    ],
    rationale: 'Prompt: "You need to know ... the breaker size (15 or 20 A)"; every count is given but the breaker size is missing.',
  },

  // ---- multi-turn (3): question, then the answer
  {
    id: 'multi-1',
    category: 'multi-turn',
    steps: [
      { user: 'I need a wall switch to turn on my new porch light.', expect: { kind: 'question' } },
      {
        user: 'The power cable from the panel comes into the switch box, and a second cable goes from there out to the porch light. It is a 15 amp breaker.',
        expect: { kind: 'blocks', blocks: SP, breakerAmps: 15 },
      },
    ],
    rationale: 'Power entry is missing at first; the answer places power at the switch box first, so single-pole applies.',
  },
  {
    id: 'multi-2',
    category: 'multi-turn',
    steps: [
      { user: 'I want to turn one basement light on and off from two different spots.', expect: { kind: 'question' } },
      {
        user: 'Power comes in at the first switch box and the light is past the second switch box. It is on a 20 amp breaker.',
        expect: { kind: 'blocks', blocks: TW, breakerAmps: 20 },
      },
    ],
    rationale: 'Power entry is missing at first; the answer puts power at one switch box and the light beyond the other, so 3-way applies.',
  },
  {
    id: 'multi-3',
    category: 'multi-turn',
    steps: [
      { user: 'I want a GFCI outlet in the garage that also protects the other outlets on the wall.', expect: { kind: 'question' } },
      {
        user: 'Just one regular outlet after the GFCI. It is a 20 amp circuit.',
        expect: { kind: 'blocks', blocks: GF, breakerAmps: 20 },
      },
    ],
    rationale: 'Downstream receptacle count is missing at first; the answer gives exactly one, so the GFCI template applies.',
  },

  // ---- unsupported (4)
  {
    id: 'unsupported-1',
    category: 'unsupported',
    steps: [{ user: 'I need to replace my main service panel and upgrade the service entrance to 200 amps. Can you plan the wiring?', expect: { kind: 'unsupported' } }],
    rationale: 'Prompt scope: service panel or service-entrance work is declined.',
  },
  {
    id: 'unsupported-2',
    category: 'unsupported',
    steps: [
      {
        user: 'My house has aluminum branch wiring in the bedrooms. Show me how to wire a new switch and light on those circuits.',
        expect: { kind: 'unsupported' },
      },
    ],
    rationale: 'Prompt scope: aluminium branch wiring is declined.',
  },
  {
    id: 'unsupported-3',
    category: 'unsupported',
    steps: [
      {
        user: 'The attic still has the old knob-and-tube wiring. I want to add a light with a switch up there on that wiring.',
        expect: { kind: 'unsupported' },
      },
    ],
    rationale: 'Prompt scope: knob-and-tube wiring is declined.',
  },
  {
    id: 'unsupported-4',
    category: 'unsupported',
    steps: [{ user: 'How do I plumb a new sink in my bathroom, with the drain and supply lines?', expect: { kind: 'unsupported' } }],
    rationale: 'Prompt scope: US residential electrical wiring only; plumbing is not wiring.',
  },

  // ---- blocks, corrected in task 25 (ids kept, expectations changed because receptacle_run now covers them)
  {
    id: 'custom-1',
    category: 'blocks',
    steps: [
      {
        user: 'I need one single receptacle on its own 20 amp circuit in the workshop, straight from the panel.',
        expect: { kind: 'blocks', blocks: [{ type: 'receptacle_run', count: 1, gfciFirst: false }], breakerAmps: 20 },
      },
    ],
    rationale:
      'receptacle_run covers one to 12 standard receptacles in a row. Task 25: was a custom circuit (one breaker, one duplex, 20 A, facts) from before receptacle_run existed; now a block circuit, 20 A, count 1, not GFCI-first.',
  },
  {
    id: 'custom-3',
    category: 'blocks',
    steps: [
      {
        user: 'I want two ordinary receptacles in two separate boxes along one wall, both on one 20 amp circuit from the panel. No GFCI, no switches.',
        expect: { kind: 'blocks', blocks: [{ type: 'receptacle_run', count: 2, gfciFirst: false }], breakerAmps: 20 },
      },
    ],
    rationale:
      'receptacle_run covers a row of standard receptacles, each in its own box. Task 25: was a custom circuit (two duplex, no GFCI, 20 A, facts); now a block circuit, 20 A, count 2, not GFCI-first.',
  },
  {
    id: 'trap-2',
    category: 'blocks',
    steps: [
      {
        user: 'I want one GFCI receptacle in the garage and three regular outlets after it that all get protection from it, on a 20 amp breaker.',
        expect: { kind: 'blocks', blocks: [{ type: 'receptacle_run', count: 4, gfciFirst: true }] },
      },
    ],
    rationale:
      'receptacle_run with gfciFirst protects every receptacle after the GFCI. Task 25: was a trap (anything except the one-downstream GFCI list); now a block circuit, receptacle_run count 4 with GFCI first (breaker size not graded).',
  },

  // ---- multi-block (6): jobs from the user's basement project; every count, flag and breaker size is stated in the text
  {
    id: 'mb-1',
    category: 'multi-block',
    steps: [
      {
        user: 'In my basement I want 8 recessed ceiling lights that I can switch on and off from two places, using a pair of 3-way switches. The power cable from the 15 amp breaker comes into the first switch box, and the lights are fed from the second switch box.',
        expect: { kind: 'blocks', blocks: [{ type: 'three_way_lights', count: 8 }], breakerAmps: 15 },
      },
    ],
    rationale: 'three_way_lights: one to 12 lights from two places, power at one switch box and the lights beyond the other; here 8 lights, 15 A.',
  },
  {
    id: 'mb-2',
    category: 'multi-block',
    steps: [
      {
        user: 'In the basement family room I want 8 ordinary receptacles in a row, each in its own box, all on one 20 amp circuit fed from the panel. No GFCI, no switches.',
        expect: { kind: 'blocks', blocks: [{ type: 'receptacle_run', count: 8, gfciFirst: false }], breakerAmps: 20 },
      },
    ],
    rationale: 'receptacle_run: one to 12 standard receptacles in a row on one circuit; here 8, not GFCI-first, 20 A.',
  },
  {
    id: 'mb-3',
    category: 'multi-block',
    steps: [
      {
        user: 'Basement bathroom, all on one 20 amp circuit, in this order starting from the panel: first a row of 3 receptacles where the first one is a GFCI that protects the other two, then a wall switch box with one light, then a second switch box with one exhaust fan. Each switch controls only its own light or fan.',
        expect: {
          kind: 'blocks',
          blocks: [{ type: 'receptacle_run', count: 3, gfciFirst: true }, { type: 'switch_lights', count: 1 }, { type: 'switch_fan' }],
          breakerAmps: 20,
        },
      },
    ],
    rationale:
      'Blocks chain: receptacle_run (GFCI first, protects the rest), then switch_lights with one light, then switch_fan (one fan on its own switch); order given in the text, 20 A.',
  },
  {
    id: 'mb-4',
    category: 'multi-block',
    steps: [
      {
        user: 'Basement bedroom on one 15 amp circuit: the power cable from the panel comes into a switch box. The switch controls 2 ceiling lights. After the switch box the circuit continues, not switched, to a row of 5 ordinary receptacles that are always on. No GFCI.',
        expect: {
          kind: 'blocks',
          blocks: [{ type: 'switch_lights', count: 2 }, { type: 'receptacle_run', count: 5, gfciFirst: false }],
          breakerAmps: 15,
        },
      },
    ],
    rationale: 'Blocks chain: switch_lights (2 lights, power at the switch box) then receptacle_run of 5 fed unswitched from the switch box (stated), not GFCI-first, 15 A.',
  },
  {
    id: 'mb-5',
    category: 'multi-block',
    steps: [
      {
        user: 'Closet: one wall switch and one ceiling light, on a 15 amp breaker. The power cable from the panel comes into the switch box first and a cable goes from there to the light.',
        expect: { kind: 'blocks', blocks: [{ type: 'switch_lights', count: 1 }], breakerAmps: 15 },
      },
    ],
    rationale: 'switch_lights: one light controlled by one switch with power arriving at the switch box; 15 A.',
  },
  {
    id: 'mb-6',
    category: 'multi-block',
    steps: [
      {
        user: 'I need a dedicated 20 amp circuit for the dishwasher in the kitchen: one single regular receptacle (not GFCI), fed straight from the panel.',
        expect: { kind: 'blocks', blocks: [{ type: 'receptacle_run', count: 1, gfciFirst: false }], breakerAmps: 20 },
      },
    ],
    rationale: 'receptacle_run count 1 without GFCI covers a single standard receptacle on its own circuit; 20 A. The text says "not GFCI" so the flag is not a code judgement.',
  },

  // ---- counts (4): the only thing to get right is a number or flag
  {
    id: 'counts-1',
    category: 'counts',
    steps: [
      {
        user: 'In the garage I want 6 ceiling lights all controlled by one wall switch. The power cable from the 15 amp breaker comes into the switch box first.',
        expect: { kind: 'blocks', blocks: [{ type: 'switch_lights', count: 6 }], breakerAmps: 15 },
      },
    ],
    rationale: 'switch_lights takes one to 12 lights on one switch; count must be 6.',
  },
  {
    id: 'counts-2',
    category: 'counts',
    steps: [
      {
        user: 'In the workshop I want 12 ordinary receptacles in a row on one 20 amp circuit fed from the panel. No GFCI, no switches.',
        expect: { kind: 'blocks', blocks: [{ type: 'receptacle_run', count: 12, gfciFirst: false }], breakerAmps: 20 },
      },
    ],
    rationale: 'receptacle_run takes one to 12 receptacles (12 is the maximum); count must be 12 and not GFCI-first.',
  },
  {
    id: 'counts-3',
    category: 'counts',
    steps: [
      {
        user: 'I have a double switch box in the hallway, fed by the 15 amp breaker, with two single-pole switches. The first switch controls 3 ceiling lights and the second switch controls 1 light, each switch with its own cable run of lights. Power comes into the double box.',
        expect: { kind: 'blocks', blocks: [{ type: 'two_gang_switches', countA: 3, countB: 1 }], breakerAmps: 15 },
      },
    ],
    rationale: 'two_gang_switches: two switches in one box, each with its own group of lights; countA is the first switch (3 lights), countB the second (1 light).',
  },
  {
    id: 'counts-4',
    category: 'counts',
    steps: [
      {
        user: 'In the laundry room I want a row of 5 receptacles on a 20 amp circuit, where the first one is a GFCI that protects the other four. Fed from the panel.',
        expect: { kind: 'blocks', blocks: [{ type: 'receptacle_run', count: 5, gfciFirst: true }], breakerAmps: 20 },
      },
    ],
    rationale: 'receptacle_run with gfciFirst true: the GFCI is the first of the 5 receptacles and protects the rest.',
  },

  // ---- target (4): seeded project context; the first two seeds have one circuit
  {
    id: 'target-1',
    category: 'target',
    seed: { circuits: [{ name: 'Basement lights', breakerAmps: 15, blocks: [{ type: 'switch_lights', count: 3 }] }], selected: null },
    steps: [
      {
        user: 'Add another circuit for the basement receptacles: 8 ordinary receptacles in a row on a 20 amp breaker, no GFCI.',
        expect: { kind: 'blocks', blocks: [{ type: 'receptacle_run', count: 8, gfciFirst: false }], breakerAmps: 20, target: 'new' },
      },
    ],
    rationale: 'Prompt "Several circuits": the user describes an additional circuit and none is selected, so target is "new".',
  },
  {
    id: 'target-2',
    category: 'target',
    seed: { circuits: [{ name: 'Basement lights', breakerAmps: 15, blocks: [{ type: 'switch_lights', count: 4 }] }], selected: 0 },
    steps: [
      {
        user: 'Change this one to 6 lights.',
        expect: { kind: 'blocks', blocks: [{ type: 'switch_lights', count: 6 }], target: 'selected' },
      },
    ],
    rationale: 'Prompt "Several circuits": the user clearly changes the selected circuit, so target is "selected" with the full updated block list (switch_lights count 6).',
  },
  {
    id: 'target-3',
    category: 'target',
    seed: { circuits: [{ name: 'Basement lights', breakerAmps: 15, blocks: [{ type: 'switch_lights', count: 4 }] }], selected: 0 },
    steps: [
      {
        user: 'Separately from that, I also want a new circuit for the garage: a row of 4 receptacles on a 20 amp breaker where the first is a GFCI that protects the other three.',
        expect: { kind: 'blocks', blocks: [{ type: 'receptacle_run', count: 4, gfciFirst: true }], breakerAmps: 20, target: 'new' },
      },
    ],
    rationale: 'Prompt "Several circuits": a clearly separate additional circuit is "new" even though another circuit is selected; the selected circuit must not be replaced.',
  },
  {
    id: 'target-4',
    category: 'target',
    seed: {
      circuits: [
        { name: 'Garage outlets', breakerAmps: 20, blocks: [{ type: 'receptacle_run', count: 6, gfciFirst: false }] },
        { name: 'Workshop outlets', breakerAmps: 20, blocks: [{ type: 'receptacle_run', count: 4, gfciFirst: false }] },
      ],
      selected: null,
    },
    steps: [{ user: 'Make it 10 outlets instead.', expect: { kind: 'question' } }],
    rationale: 'Prompt "Several circuits": it is unclear which of two receptacle circuits "it" means and none is selected, so ask one clarifying question.',
  },

  // ---- custom (4): no block combination covers it, the catalogue can model it; must be valid with no rule errors (warnings allowed)
  {
    id: 'custom-2',
    category: 'custom',
    steps: [
      {
        user: 'I want one ceiling light in the shed on its own 15 amp circuit, with no switch. The cable from the panel goes straight to the light.',
        expect: groundedCustom([{ type: 'light', terminal: 'hot' }], { breaker: 1, light: 1, switch_sp: 0, switch_3way: 0, duplex: 0, gfci: 0 }, 15),
      },
    ],
    rationale: 'No block covers an unswitched light (switch_lights requires a switch); the catalogue can model it. Unchanged since v2.',
  },
  {
    id: 'custom-4',
    category: 'custom',
    steps: [
      {
        user: 'Garage wall on one 20 amp circuit, fed from the panel: three receptacles in a row where the third one is the GFCI, with one more ordinary receptacle after the GFCI. The GFCI protects only the one after it, not the first two.',
        expect: {
          kind: 'custom',
          facts: [
            { kind: 'netRoles', at: { type: 'duplex', terminal: 'brass' }, roles: { source_hot: 2, protected_hot: 1 } },
            { kind: 'groundsBonded' },
          ],
          deviceCounts: { breaker: 1, duplex: 3, gfci: 1, switch_sp: 0, light: 0 },
          breakerAmps: 20,
        },
      },
    ],
    rationale: 'receptacle_run allows a GFCI only first (notFor: a GFCI that is not first); a GFCI third protecting only what follows needs a custom circuit built from duplex and gfci devices.',
  },
  {
    id: 'custom-5',
    category: 'custom',
    steps: [
      {
        user: 'In the hallway the power cable from the 15 amp breaker comes into the ceiling light box first. From the light box a cable runs down to a single wall switch that turns that one light on and off. One light, one switch.',
        expect: {
          kind: 'custom',
          facts: [
            { kind: 'fedFromPanel', type: 'light' },
            { kind: 'netRoles', at: { type: 'light', terminal: 'hot' }, roles: { switched_hot: 1 } },
            { kind: 'connected', a: { type: 'neutral_bar', terminal: 'neutral_bar' }, b: { type: 'light', terminal: 'neutral' } },
            { kind: 'groundsBonded' },
          ],
          deviceCounts: { breaker: 1, light: 1, switch_sp: 1, duplex: 0, gfci: 0 },
          breakerAmps: 15,
        },
      },
    ],
    rationale: 'switch_lights notFor: power arriving at a light box first (switch loop); the catalogue can model it. The light box is fed from the panel, the light hot must be switched and its neutral on the neutral bar.',
  },
  {
    id: 'custom-6',
    category: 'custom',
    steps: [
      {
        user: 'In the living room I want one wall switch that turns a receptacle on and off, for a floor lamp. The power cable from the 15 amp breaker comes into the switch box first, and a cable goes from the switch box to the receptacle box. One switch, one ordinary receptacle.',
        expect: {
          kind: 'custom',
          facts: [
            { kind: 'fedFromPanel', type: 'switch_sp' },
            { kind: 'netRoles', at: { type: 'duplex', terminal: 'brass' }, roles: { switched_hot: 1 } },
            { kind: 'connected', a: { type: 'neutral_bar', terminal: 'neutral_bar' }, b: { type: 'duplex', terminal: 'silver' } },
            { kind: 'groundsBonded' },
          ],
          deviceCounts: { breaker: 1, duplex: 1, switch_sp: 1, light: 0, gfci: 0 },
          breakerAmps: 15,
        },
      },
    ],
    rationale: 'receptacle_run and switch_lights both list switch-controlled receptacles under "do not use for"; duplex fed from a switch output is expressible in the catalogue.',
  },

  // ---- trap (1): resembles a block but violates its applicability
  {
    id: 'trap-1',
    category: 'trap',
    steps: [
      {
        user: 'The power cable comes into the ceiling light box first, and a second cable runs from the light box down to a wall switch that controls that light. One switch, one light.',
        expect: { kind: 'not_blocks', forbidden: SP },
      },
    ],
    rationale: 'Single-pole switch block is not for power arriving at the light box first (switch loop).',
  },
];
