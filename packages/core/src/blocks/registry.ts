// Registry of verified building blocks (ADR-008). The reply contract, resolver and system prompt are generated from it.
import type { z } from 'zod';
import {
  ReceptacleRunSchema,
  SwitchFanSchema,
  SwitchLightsSchema,
  ThreeWayLightsSchema,
  TwoGangSwitchesSchema,
  type BlockType,
} from './schema';

export interface BuildingBlock {
  /** Stable id; equals the `type` of the block parameters. */
  id: BlockType;
  title: string;
  /** Exactly what is wired. */
  description: string;
  appliesWhen: string;
  notFor: string;
  /** Strict; labels and `gfciFirst` default. */
  paramsSchema: z.ZodType;
}

export const BUILDING_BLOCKS: readonly BuildingBlock[] = [
  {
    id: 'receptacle_run',
    paramsSchema: ReceptacleRunSchema,
    title: 'Run of receptacles',
    description:
      'A line of boxes with one duplex receptacle each, fed from the previous block or the panel. Every box that has a cable going on (to the next receptacle, or because another block follows) splices the incoming and outgoing hot, neutral and ground together with a pigtail to the receptacle; the last box of a circuit wires the receptacle directly. With gfciFirst the first receptacle is a GFCI with the incoming cable on LINE and the onward cable on LOAD, so everything after it, including later blocks, is protected. The onward feed leaves the last receptacle box.',
    appliesWhen: 'One to 12 standard receptacles in a row on one circuit, optionally with a GFCI receptacle first that protects the rest.',
    notFor:
      'Switched receptacles, split-wired receptacles, a GFCI that is not first, feed-through wiring on the receptacle terminals, or a GFCI breaker.',
  },
  {
    id: 'switch_lights',
    paramsSchema: SwitchLightsSchema,
    title: 'Single-pole switch with lights',
    description:
      'A switch box fed from the previous block or the panel, with the hot switched to a load cable that runs to the first of N light boxes; the lights are daisy-chained, each box except the last splicing the incoming and outgoing cable with a pigtail to its light. When another block follows, the unswitched feed continues from the switch box (hot spliced with a pigtail to the switch), so the following block is never switched. Neutrals and grounds are spliced through the switch box; the switch is grounded.',
    appliesWhen: 'One to 12 lights controlled together by one switch, with power arriving at the switch box.',
    notFor: 'Power arriving at a light box first, several switches, dimmers, switches without a neutral (switch loops), or switch-controlled receptacles.',
  },
  {
    id: 'three_way_lights',
    paramsSchema: ThreeWayLightsSchema,
    title: '3-way switch pair with lights',
    description:
      'Power arrives at the first 3-way switch box (common on the feed hot). A 3-wire cable carries the two travelers to the second switch box, whose common leads over a 2-wire load cable to the first of N daisy-chained light boxes. When another block follows, the unswitched feed continues from the first switch box (hot spliced with a pigtail to the common), so the following block is never switched. Neutrals and grounds are spliced through both boxes; both switches are grounded.',
    appliesWhen: 'One to 12 lights controlled from two places, with power arriving at one of the two switch boxes and the lights beyond the other.',
    notFor: 'Power arriving at a light box first, three or more switch locations (4-way), dimmers, or switch loops without a neutral.',
  },
  {
    id: 'switch_fan',
    paramsSchema: SwitchFanSchema,
    title: 'Switch with exhaust fan',
    description:
      'The same wiring as a single-pole switch with one light, with an exhaust fan in place of the light. Power arrives at the switch box; the load cable runs to the fan box. When another block follows, the unswitched feed continues from the switch box.',
    appliesWhen: 'One exhaust fan controlled by its own single-pole switch, with power arriving at the switch box.',
    notFor: 'Combination fan/light units, fans with a separate light circuit, timers or humidity controls, or power arriving at the fan first.',
  },
  {
    id: 'two_gang_switches',
    paramsSchema: TwoGangSwitchesSchema,
    title: '2-gang box with two single-pole switches, each with its own lights',
    description:
      'One 2-gang switch box fed from the previous block or the panel, holding two single-pole switches, A and B. The feed hot is spliced to the input of both switches. Switch A sends its output down its own load cable to a daisy-chain of countA lights; switch B does the same for countB lights (each chain wired as in the single-pole switch block). Neutrals are spliced together and grounds are spliced together in the 2-gang box, and both switches are grounded. When another block follows, the unswitched feed continues from the 2-gang box (its hot, neutral and ground join the same splices), so the following block is never switched.',
    appliesWhen:
      'Two switches in one 2-gang box, each controlling its own separate group of one to 12 lights, with power arriving at the switch box.',
    notFor:
      'Two switches controlling one light, 3-way switches, a switch with a receptacle, dimmers, a fan or fan/light combination, or power arriving at a light box first.',
  },
];

export const BLOCK_TYPES = BUILDING_BLOCKS.map((b) => b.id) as [BlockType, ...BlockType[]];

/** The parameters a block takes, read from its schema: count fields, whether it has gfciFirst, and label fields with their defaults. */
export interface BlockFields {
  counts: string[];
  gfciFirst: boolean;
  labels: Record<string, string>;
}

export function blockFields(block: BuildingBlock): BlockFields {
  const keys = Object.keys((block.paramsSchema as z.ZodObject).shape).filter((k) => k !== 'type');
  const counts = keys.filter((k) => k.startsWith('count'));
  const minimal: Record<string, unknown> = { type: block.id };
  for (const k of counts) minimal[k] = 1;
  const defaults = block.paramsSchema.parse(minimal) as Record<string, unknown>;
  const labels: Record<string, string> = {};
  for (const k of keys) if (k.endsWith('Label')) labels[k] = String(defaults[k]);
  return { counts, gfciFirst: keys.includes('gfciFirst'), labels };
}

export function getBlock(id: string): BuildingBlock | undefined {
  return BUILDING_BLOCKS.find((b) => b.id === id);
}
