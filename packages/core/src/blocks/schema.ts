// Parameter schemas of the building blocks (ADR-008). Flat, strict, with defaults; counts change topology, labels never do.
import { z } from 'zod';

export const MIN_COUNT = 1;
export const MAX_COUNT = 12;
export const MAX_BLOCKS = 6;

const nonBlank = (s: string) => s.trim().length > 0;
const label = (def: string) => z.string().refine(nonBlank, { message: 'must not be blank' }).default(def);
const count = (what: string) =>
  z
    .number({ error: `${what} count must be a whole number from ${MIN_COUNT} to ${MAX_COUNT}` })
    .int({ error: `${what} count must be a whole number from ${MIN_COUNT} to ${MAX_COUNT}` })
    .min(MIN_COUNT, { error: `${what} count must be at least ${MIN_COUNT}` })
    .max(MAX_COUNT, { error: `${what} count must be at most ${MAX_COUNT}` });

export const ReceptacleRunSchema = z.strictObject({
  type: z.literal('receptacle_run'),
  count: count('receptacle'),
  gfciFirst: z.boolean().default(false),
  receptacleLabel: label('Receptacle'),
  gfciLabel: label('GFCI'),
  boxLabel: label('Receptacle box'),
});

export const SwitchLightsSchema = z.strictObject({
  type: z.literal('switch_lights'),
  count: count('light'),
  switchLabel: label('Switch'),
  switchBoxLabel: label('Switch box'),
  lightLabel: label('Light'),
  lightBoxLabel: label('Light box'),
});

export const ThreeWayLightsSchema = z.strictObject({
  type: z.literal('three_way_lights'),
  count: count('light'),
  switchLabel: label('3-way switch'),
  switchBoxLabel: label('3-way box'),
  lightLabel: label('Light'),
  lightBoxLabel: label('Light box'),
});

export const SwitchFanSchema = z.strictObject({
  type: z.literal('switch_fan'),
  switchLabel: label('Switch'),
  switchBoxLabel: label('Switch box'),
  fanLabel: label('Fan'),
  fanBoxLabel: label('Fan box'),
});

export const TwoGangSwitchesSchema = z.strictObject({
  type: z.literal('two_gang_switches'),
  /** Lights on switch A. */
  countA: count('switch A light'),
  /** Lights on switch B. */
  countB: count('switch B light'),
  gangBoxLabel: label('2-gang box'),
  switchLabel: label('Switch'),
  lightLabel: label('Light'),
  lightBoxLabel: label('Light box'),
});

export const BlockSchema = z.discriminatedUnion('type', [
  ReceptacleRunSchema,
  SwitchLightsSchema,
  ThreeWayLightsSchema,
  SwitchFanSchema,
  TwoGangSwitchesSchema,
]);
/** A block as parsed (all defaults filled in). */
export type Block = z.output<typeof BlockSchema>;
/** A block as a caller writes it (labels and `gfciFirst` optional). */
export type BlockInput = z.input<typeof BlockSchema>;
export type BlockType = Block['type'];

export const CircuitSpecSchema = z.strictObject({
  id: z.string().refine(nonBlank, { message: 'must not be blank' }),
  title: z.string(),
  breakerAmps: z.literal([15, 20], { error: 'breakerAmps must be 15 or 20' }),
  blocks: z
    .array(BlockSchema, { error: 'blocks must be a list' })
    .min(1, { error: 'at least one block is required' })
    .max(MAX_BLOCKS, { error: `at most ${MAX_BLOCKS} blocks are supported` }),
});
export type CircuitSpec = z.output<typeof CircuitSpecSchema>;
export type CircuitSpecInput = z.input<typeof CircuitSpecSchema>;
