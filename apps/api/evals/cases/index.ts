import type { EvalCase, InventoryExpect, RoomExpect } from './types';

export type { BlockExpect, Category, CustomFact, EvalCase, Expect, InventoryExpect, RoomExpect, Seed, SeedCircuit, Step, TerminalRef } from './types';

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

/** Shorthand for an expected room: type, receptacles, light groups as [lights, switchLocations], fans, attached-to type. */
const room = (type: string, receptacles: number, groups: [number, 1 | 2][], fans = 0, attachedToType?: string): RoomExpect => ({
  type,
  receptacles,
  lightGroups: groups.map(([lights, switchLocations]) => ({ lights, switchLocations })),
  fans,
  ...(attachedToType ? { attachedToType } : {}),
});

// The user's basement description (task 29/30 smoke text) and what a correct inventory for it holds.
const BASEMENT_TEXT =
  'Basement living space: 8 outlets, 8 recessed lights controlled by 2 switches on either side of the space. A bathroom with 3 outlets, 1 switch, 1 light and a fan. A closet with 1 light and 1 switch. A bedroom with 1 switch, 5 outlets and 2 recessed lights. Plan the circuits.';
const BASEMENT_EXPECT: InventoryExpect = {
  basement: true,
  rooms: [room('living_area', 8, [[8, 2]]), room('bathroom', 3, [[1, 1]], 1), room('closet', 0, [[1, 1]]), room('bedroom', 5, [[2, 1]])],
};

/** The stored inventory the plan-edit and build cases start from (not built): a bedroom, its closet (not attached), a hallway and a bathroom. */
const EDIT_SEED = {
  basement: false,
  rooms: [
    { id: 'bedroom', name: 'Bedroom', type: 'bedroom' as const, receptacles: 4, lightGroups: [{ lights: 1, switchLocations: 1 as const }], fans: 0, attachedTo: '' },
    { id: 'closet', name: 'Closet', type: 'closet' as const, receptacles: 0, lightGroups: [{ lights: 1, switchLocations: 1 as const }], fans: 0, attachedTo: '' },
    { id: 'hall', name: 'Hallway', type: 'hallway' as const, receptacles: 1, lightGroups: [{ lights: 2, switchLocations: 1 as const }], fans: 0, attachedTo: '' },
    { id: 'bath', name: 'Bathroom', type: 'bathroom' as const, receptacles: 2, lightGroups: [{ lights: 1, switchLocations: 1 as const }], fans: 1, attachedTo: '' },
  ],
};
/** The seed as an expected inventory, with a change applied to each room. */
const editExpect = (change: (r: RoomExpect) => RoomExpect): InventoryExpect => ({
  basement: EDIT_SEED.basement,
  rooms: EDIT_SEED.rooms.map((r) => change(room(r.type, r.receptacles, r.lightGroups.map((g) => [g.lights, g.switchLocations]), r.fans))),
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
        expect: { kind: 'question' },
      },
    ],
    rationale: 'Breaker size is not stated and the prompt says to always ask for it for a single circuit. Corrected in task 37 (user decision 2026-11-16): was blocks switch_lights x1 with no breaker graded; now a question.',
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
        expect: { kind: 'question' },
      },
    ],
    rationale: 'Breaker size is not stated and the prompt says to always ask for it for a single circuit. Corrected in task 37 (user decision 2026-11-16): was blocks three_way_lights x1 with no breaker graded; now a question.',
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
        expect: { kind: 'question' },
      },
    ],
    rationale: 'Breaker size is not stated and the prompt says to always ask for it for a single circuit. Corrected in task 37 (user decision 2026-11-16): was blocks receptacle_run x2 GFCI-first with no breaker graded; now a question.',
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
        expect: { kind: 'question' },
      },
    ],
    rationale: 'Breaker size is not stated and the prompt says to always ask for it for a single circuit. Corrected in task 37 (user decision 2026-11-16): was blocks two_gang_switches A1/B1 with no breaker graded; now a question.',
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
        expect: { kind: 'blocks', blocks: [{ type: 'receptacle_run', count: 1 }], breakerAmps: 20 },
      },
    ],
    rationale: 'receptacle_run count 1 covers a single receptacle on its own circuit; 20 A. Corrected in task 37 (user decision 2026-11-16): was graded receptacle_run x1 with gfciFirst false; now the GFCI flag is not graded (a dishwasher receptacle may need GFCI under the code, so the case does not judge it).',
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

  // ---- inventory (6): a whole job in, a room inventory out (task 37). The model lists; the split is deterministic and not graded here.
  {
    id: 'inv-1',
    category: 'inventory',
    steps: [{ user: BASEMENT_TEXT, expect: { kind: 'inventory', inventory: BASEMENT_EXPECT } }],
    rationale: 'Several rooms and "plan the circuits": the prompt says to reply inventory; the space is stated to be a basement, the living lights have two switch locations, the closet is not stated to belong to the bedroom.',
  },
  {
    id: 'inv-2',
    category: 'inventory',
    steps: [
      {
        user: 'Plan the circuits for the upstairs of my house (not a basement): two bedrooms and the hallway between them. Bedroom 1 has 6 outlets and 1 ceiling light on one switch. Bedroom 2 has 5 outlets and 1 ceiling light on one switch. The hallway has 1 outlet and 2 ceiling lights on one switch.',
        expect: {
          kind: 'inventory',
          inventory: {
            basement: false,
            rooms: [
              room('bedroom', 6, [[1, 1]]),
              room('bedroom', 5, [[1, 1]]),
              room('hallway', 1, [[2, 1]]),
            ],
          },
        },
      },
    ],
    rationale: 'Several rooms and "plan the circuits": inventory; the text says it is not a basement; each room is listed once with its stated counts.',
  },
  {
    id: 'inv-3',
    category: 'inventory',
    steps: [
      {
        user: 'Plan the circuits for two bathrooms on the second floor (not a basement). The master bathroom has 2 outlets, 1 light on one switch and 1 exhaust fan. The hall bathroom has 1 outlet, 1 light on one switch and no fan.',
        expect: {
          kind: 'inventory',
          inventory: { basement: false, rooms: [room('bathroom', 2, [[1, 1]], 1), room('bathroom', 1, [[1, 1]])] },
        },
      },
    ],
    rationale: 'Two rooms of the same type must both appear, each with its own counts; the prompt says every room is listed once.',
  },
  {
    id: 'inv-4',
    category: 'inventory',
    steps: [
      {
        user: 'Plan the circuits for my living room on the main floor (not a basement): 6 outlets, 4 recessed ceiling lights on one switch by the door, and 2 wall sconces on their own separate switch, also by the door.',
        expect: { kind: 'inventory', inventory: { basement: false, rooms: [room('living_area', 6, [[4, 1], [2, 1]])] } },
      },
    ],
    rationale: 'The prompt says lightGroups has one entry per set of lights switched together: two separately switched sets are two groups.',
  },
  {
    id: 'inv-5',
    category: 'inventory',
    steps: [
      {
        user: 'Plan the circuits for the main floor of my house (not a basement): a living room with 6 outlets and 4 ceiling lights on one switch, and a garage with 4 outlets and 2 ceiling lights on one switch.',
        expect: { kind: 'inventory', inventory: { basement: false, rooms: [room('living_area', 6, [[4, 1]]), room('other', 4, [[2, 1]])] } },
      },
    ],
    rationale: 'The prompt says to use type "other" for a room outside the list; a garage is not in the list and the room must not be dropped.',
  },
  {
    id: 'inv-6',
    category: 'inventory',
    steps: [
      {
        user: 'Plan the circuits for the upstairs (not a basement): a bedroom with 4 outlets and 1 ceiling light on one switch, and the walk-in closet that is part of that bedroom, with 1 light on its own switch.',
        expect: { kind: 'inventory', inventory: { basement: false, rooms: [room('bedroom', 4, [[1, 1]]), room('closet', 0, [[1, 1]], 0, 'bedroom')] } },
      },
    ],
    rationale: 'The prompt says to set attachedTo when the user says a room is part of another: the closet is stated to belong to the bedroom.',
  },

  // ---- inventory-question (3): a fact the inventory depends on cannot be determined, so the model must ask and give no inventory
  {
    id: 'invq-1',
    category: 'inventory-question',
    steps: [
      {
        user: 'Plan the circuits for the main floor (not a basement): a bedroom with some outlets and 1 ceiling light on one switch, and a hallway with 1 outlet and 2 ceiling lights on one switch.',
        expect: { kind: 'question' },
      },
    ],
    rationale: 'The prompt says to ask when a count cannot be determined and never to guess a number; "some outlets" gives no number.',
  },
  {
    id: 'invq-2',
    category: 'inventory-question',
    steps: [
      {
        user: 'Plan the circuits for a bedroom with 4 outlets and 1 ceiling light on one switch, and a bathroom with 2 outlets, 1 light on one switch and 1 fan. I have not decided yet whether this goes in the basement or on the ground floor.',
        expect: { kind: 'question' },
      },
    ],
    rationale: 'The prompt says to ask when it cannot be determined whether the space is a basement; the text says it is undecided.',
  },
  {
    id: 'invq-3',
    category: 'inventory-question',
    steps: [
      {
        user: 'Plan the circuits for the main floor (not a basement): a living room with 6 outlets and 4 recessed lights, which I may switch from one end or from both ends, I have not decided, and a bedroom with 4 outlets and 1 ceiling light on one switch.',
        expect: { kind: 'question' },
      },
    ],
    rationale: 'The prompt says to ask when the number of switch locations for a light group cannot be determined; the text says it is undecided.',
  },

  // ---- plan-edit (4): a stored inventory is seeded; the reply must be the complete revised inventory, not a delta or a circuit
  {
    id: 'edit-1',
    category: 'plan-edit',
    seed: { circuits: [], selected: null, plan: { inventory: EDIT_SEED } },
    steps: [
      {
        user: 'The closet is part of the bedroom. Put it with the bedroom.',
        expect: { kind: 'inventory', edit: true, inventory: editExpect((r) => (r.type === 'closet' ? { ...r, attachedToType: 'bedroom' } : r)) },
      },
    ],
    rationale: 'The prompt says to attach a closet to a bedroom by replying a complete revised inventory with attachedTo set; all other rooms unchanged.',
  },
  {
    id: 'edit-2',
    category: 'plan-edit',
    seed: { circuits: [], selected: null, plan: { inventory: EDIT_SEED } },
    steps: [
      {
        user: 'Add two more outlets to the hallway.',
        expect: { kind: 'inventory', edit: true, inventory: editExpect((r) => (r.type === 'hallway' ? { ...r, receptacles: r.receptacles + 2 } : r)) },
      },
    ],
    rationale: 'The prompt says a count change is a complete revised inventory: the hallway goes from 1 to 3 receptacles, everything else as stored.',
  },
  {
    id: 'edit-3',
    category: 'plan-edit',
    seed: { circuits: [], selected: null, plan: { inventory: EDIT_SEED } },
    steps: [
      {
        user: 'Use at most 6 outlets per circuit.',
        expect: { kind: 'inventory', edit: true, inventory: editExpect((r) => r), options: { maxReceptaclesPerCircuit: 6 } },
      },
    ],
    rationale: 'The prompt lists a receptacle limit as a plan change: complete inventory unchanged, maxReceptaclesPerCircuit 6.',
  },
  {
    id: 'edit-4',
    category: 'plan-edit',
    seed: { circuits: [], selected: null, plan: { inventory: EDIT_SEED } },
    steps: [
      {
        user: 'Remove the closet, I am not doing that room any more.',
        expect: { kind: 'inventory', edit: true, inventory: { basement: false, rooms: editExpect((r) => r).rooms.filter((r) => r.type !== 'closet') } },
      },
    ],
    rationale: 'The prompt lists removing a room as a plan change: the complete inventory without the closet.',
  },

  // ---- build (3): "build it" is only valid when a stored plan is shown as not built
  {
    id: 'build-1',
    category: 'build',
    seed: { circuits: [], selected: null, plan: { inventory: EDIT_SEED } },
    steps: [{ user: 'Looks good, build it.', expect: { kind: 'build' } }],
    rationale: 'The prompt says to reply build when a plan is shown as not built and the user clearly asks to build it.',
  },
  {
    id: 'build-2',
    category: 'build',
    steps: [{ user: 'Looks good, build it.', expect: { kind: 'not_build' } }],
    rationale: 'The prompt says never to use build when no plan is shown; with nothing to build the model has to ask or explain.',
  },
  {
    id: 'build-3',
    category: 'build',
    seed: { circuits: [], selected: null, plan: { inventory: EDIT_SEED } },
    steps: [
      {
        user: 'Separately from the plan, I want one more circuit in the workshop: a row of 4 ordinary receptacles on a 20 amp breaker, fed from the panel. No GFCI, no switches.',
        expect: { kind: 'blocks', blocks: [{ type: 'receptacle_run', count: 4, gfciFirst: false }], breakerAmps: 20, target: 'new' },
      },
    ],
    rationale: 'A single specific circuit with a stated breaker size is a circuit reply even when a plan is stored, and with no circuit selected it is a new circuit.',
  },

  // ---- routing (2): one request, the right reply kind
  {
    id: 'route-1',
    category: 'routing',
    steps: [
      {
        user: 'In the hallway I want 4 ceiling lights controlled by one wall switch. The power cable from the 15 amp breaker comes into the switch box first.',
        expect: { kind: 'blocks', blocks: [{ type: 'switch_lights', count: 4 }], breakerAmps: 15 },
      },
    ],
    rationale: 'One specific circuit with a stated breaker size: the prompt says to use the circuit kinds, not an inventory.',
  },
  {
    id: 'route-2',
    category: 'routing',
    steps: [
      {
        user: 'Plan the circuits for my bedroom upstairs (not a basement): 5 outlets and 2 ceiling lights on one switch.',
        expect: { kind: 'inventory', inventory: { basement: false, rooms: [room('bedroom', 5, [[2, 1]])] } },
      },
    ],
    rationale: 'The prompt says to reply inventory when the user asks to plan the circuits, even for one room.',
  },
];
