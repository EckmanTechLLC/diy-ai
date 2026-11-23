// Provider-neutral reply contract (ADR-006, ADR-008). The model returns one flat object: a `kind` naming the single
// outcome (question / circuit / custom / inventory / unsupported) plus always-present fields. Fields that do not apply to the
// chosen kind carry an "unused" value: 0 for breakerAmps / counts / amps, an empty array for blocks and custom, an
// empty string for unused text and labels, false for gfciFirst, "none" for target. `target` says whether a circuit
// outcome adds a new circuit to the project or replaces the selected one (ADR-008). A circuit is a breaker size plus an ordered list of
// flat building-block entries (ADR-008). The schema contains no union-typed ("value or null", anyOf) parameter at
// all, because hosted structured outputs cap those at 16. It is flat, non-recursive, every property is required and
// there are no numeric/length bounds, so the generated JSON Schema works for hosted structured outputs and
// grammar-constrained local models.
// "Exactly one outcome", bounds and cross-field rules are enforced by resolveReply / validateCircuit.
import { z } from 'zod';
import { BLOCK_TYPES, BUILDING_BLOCKS, blockFields } from './blocks';
import { DEVICE_TYPES } from './catalogue';
import { ROOM_TYPES } from './planner/inventory';
import { CABLE_TYPES, WIRE_COLORS } from './schema';

const Str = z.string();

export const REPLY_KINDS = ['question', 'circuit', 'custom', 'inventory', 'unsupported'] as const;
/** Where a circuit outcome goes: `new` adds a circuit, `selected` replaces the selected one, `none` for outcomes without a circuit. */
export const REPLY_TARGETS = ['none', 'new', 'selected'] as const;
export type ReplyTarget = (typeof REPLY_TARGETS)[number];
export const TARGET_NONE: ReplyTarget = 'none';
/** breakerAmps / count value meaning "not used". */
export const UNUSED_NUMBER = 0;

/** Count fields of a block entry (`count`, `countA`, `countB`) as used by any block, in registry order. */
export const COUNT_FIELDS: [string, ...string[]] = (() => {
  const names = [...new Set(BUILDING_BLOCKS.flatMap((b) => blockFields(b).counts))];
  return names as [string, ...string[]];
})();

/** Every label field name used by any block, in registry order. A block entry carries all of them; "" means the block's default. */
export const LABEL_FIELDS: [string, ...string[]] = (() => {
  const names = [...new Set(BUILDING_BLOCKS.flatMap((b) => Object.keys(blockFields(b).labels)))];
  return names as [string, ...string[]];
})();

/**
 * Flat endpoint: `kind` picks which of the other fields apply; the rest are "" and ignored.
 * The `id` meta makes the generated JSON Schema define it once under $defs and reference it from both connection ends
 * (inlined twice, the schema exceeds Claude's structured-output grammar limit: task 27).
 */
export const ReplyEndpointSchema = z.strictObject({
  kind: z.enum(['terminal', 'conductor', 'splice']),
  device: Str.describe('terminal endpoints: device id; otherwise "".'),
  terminal: Str.describe('terminal endpoints: terminal name; otherwise "".'),
  cable: Str.describe('conductor endpoints: cable id; otherwise "".'),
  color: z.enum(['', ...WIRE_COLORS]).describe('conductor endpoints: conductor colour; otherwise "".'),
  box: Str.describe('conductor endpoints: box id where this end of the cable is; otherwise "".'),
  splice: Str.describe('splice endpoints: splice id; otherwise "".'),
}).meta({ id: 'ReplyEndpoint' });

/** Wire form of CircuitModel: same fields, but ids are plain strings, a device's amps is a number (0 = not a breaker) and endpoints are flat. */
export const ReplyCircuitSchema = z.strictObject({
  id: Str,
  title: Str,
  boxes: z.array(z.strictObject({ id: Str, label: Str, kind: z.enum(['panel', 'box']) })),
  devices: z.array(
    z.strictObject({
      id: Str,
      box: Str,
      type: z.enum(DEVICE_TYPES),
      label: Str,
      /** Whole number of amps for breakers; 0 for every other device. */
      amps: z.number().describe('Breaker size in whole amps for a breaker; 0 for every other device.'),
    }),
  ),
  cables: z.array(z.strictObject({ id: Str, name: Str, type: z.enum(CABLE_TYPES), from: Str, to: Str })),
  splices: z.array(z.strictObject({ id: Str, box: Str })),
  connections: z.array(z.strictObject({ id: Str, a: ReplyEndpointSchema, b: ReplyEndpointSchema, color: z.enum(WIRE_COLORS) })),
});
export type ReplyCircuit = z.infer<typeof ReplyCircuitSchema>;

const blockEntryShape: Record<string, z.ZodType> = {
  type: z.enum(BLOCK_TYPES).describe('The building block type.'),
};
for (const f of COUNT_FIELDS)
  blockEntryShape[f] = z.number().describe(`How many this block has (see the block's description for what ${f} counts). 0 when the block does not use ${f}.`);
blockEntryShape.gfciFirst = z.boolean().describe('receptacle_run only: true when the first receptacle is a GFCI. false for every other block.');
for (const f of LABEL_FIELDS) blockEntryShape[f] = Str.describe(`Label text for ${f}, or "" to keep the block's default (and always "" for blocks without ${f}).`);

/** One building block of a circuit: flat, with every count and label field present; unused ones hold 0, false or "". */
export const ReplyBlockSchema = z.strictObject(blockEntryShape);
export type ReplyBlock = z.infer<typeof ReplyBlockSchema>;

/** One room of an inventory reply (the planner's room, ADR-009): counts only, no electrical decisions. */
export const ReplyRoomSchema = z.strictObject({
  id: Str.describe('A short unique id for the room, lowercase, no spaces.'),
  name: Str.describe('The room as the user calls it, such as "Bathroom".'),
  type: z.enum(ROOM_TYPES).describe('The room type; use "other" for any room not in the list.'),
  receptacles: z.number().describe('How many receptacles (outlets) the room has.'),
  lightGroups: z
    .array(z.strictObject({ lights: z.number().describe('How many lights are controlled together.'), switchLocations: z.number().describe('How many switch locations control this group: 1, or 2 when switches are at both ends.') }))
    .describe('The lights of the room, one entry per set of lights that are switched together. Empty list when the room has no lights.'),
  fans: z.number().describe('How many ceiling or exhaust fans the room has.'),
  attachedTo: Str.describe('The id of the room this one belongs to, such as the bedroom a closet is part of; otherwise "".'),
});

export const ReplySchema = z
  .strictObject({
    kind: z.enum(REPLY_KINDS).describe('The single outcome of this reply.'),
    target: z
      .enum(REPLY_TARGETS)
      .describe('kind circuit or custom: "new" to add an additional circuit to the project, "selected" to replace the circuit marked as selected. Every other kind: "none".'),
    message: Str.describe('question: the clarifying question. unsupported: why the job cannot be done. circuit or custom: a short note to the user.'),
    breakerAmps: z.literal([UNUSED_NUMBER, 15, 20]).describe('kind circuit: the breaker size, 15 or 20. Every other kind: 0.'),
    name: Str.describe('kind circuit: a short name for the circuit, such as "Basement lights". Every other kind: "".'),
    blocks: z.array(ReplyBlockSchema).describe('kind circuit: the building blocks in the order power flows from the panel. Every other kind: empty list.'),
    custom: z.array(ReplyCircuitSchema).describe('kind custom: a list with exactly one full circuit. Every other kind: empty list.'),
    basement: z.boolean().describe('kind inventory: true when the space being planned is a basement. Every other kind: false.'),
    rooms: z.array(ReplyRoomSchema).describe('kind inventory: every room of the job, listed once each. Every other kind: empty list.'),
    maxReceptaclesPerCircuit: z.number().describe('kind inventory: the most receptacles per circuit the user asked for, or 0 for the default. Every other kind: 0.'),
    lightingBreakerAmps: z.literal([UNUSED_NUMBER, 15, 20]).describe('kind inventory: the lighting breaker size the user asked for, 15 or 20, or 0 for the default. Every other kind: 0.'),
  })
  .refine((r) => replyShapeProblem(r) === null, { message: 'fields not used by kind must hold their unused value; kind custom needs one circuit' });
export type Reply = z.infer<typeof ReplySchema>;

/**
 * "Exactly one outcome": fields belonging to other kinds must hold their unused value.
 * Missing/null fields count as unused. Returns a description of the first problem, or null.
 */
export function replyShapeProblem(r: Record<string, unknown>): string | null {
  const kind = r.kind;
  const target = r.target;
  const unusedAmps = r.breakerAmps === undefined || r.breakerAmps === null || r.breakerAmps === UNUSED_NUMBER;
  const unusedName = r.name === undefined || r.name === null || r.name === '';
  const unusedBlocks = r.blocks === undefined || r.blocks === null || (Array.isArray(r.blocks) && r.blocks.length === 0);
  const unusedCustom = r.custom === undefined || r.custom === null || (Array.isArray(r.custom) && r.custom.length === 0);
  const targetUnused = target === undefined || target === null || target === TARGET_NONE;
  const inventoryUnused = (['basement', 'rooms', 'maxReceptaclesPerCircuit', 'lightingBreakerAmps'] as const).filter((k) => {
    const v = r[k];
    return !(v === undefined || v === null || v === false || v === UNUSED_NUMBER || (Array.isArray(v) && v.length === 0));
  });
  if (kind === 'inventory') {
    if (!targetUnused || !unusedAmps || !unusedName || !unusedBlocks || !unusedCustom)
      return `kind inventory must leave target, breakerAmps, name, blocks and custom unused (target "none", breakerAmps ${UNUSED_NUMBER}, empty name, empty blocks and custom lists)`;
    return null;
  }
  if (inventoryUnused.length > 0) return `kind ${String(kind)} must leave ${inventoryUnused.join(', ')} unused (basement false, empty rooms list, 0 for the two plan options)`;
  if (kind === 'circuit' || kind === 'custom') {
    if (target !== 'new' && target !== 'selected') return `kind ${String(kind)} needs target "new" or "selected"`;
  }
  if (kind === 'circuit') {
    if (!unusedCustom) return 'kind circuit must have an empty custom list';
    return null;
  }
  if (kind === 'custom') {
    if (!Array.isArray(r.custom) || r.custom.length !== 1) return 'kind custom needs a custom list with exactly one circuit';
    if (!unusedAmps || !unusedName || !unusedBlocks) return `kind custom must have breakerAmps ${UNUSED_NUMBER}, an empty name and an empty blocks list`;
    return null;
  }
  const others = [!targetUnused && 'target', !unusedAmps && 'breakerAmps', !unusedName && 'name', !unusedBlocks && 'blocks', !unusedCustom && 'custom'].filter(Boolean);
  return others.length === 0 ? null : `kind ${String(kind)} must leave ${others.join(', ')} unused (target "none", breakerAmps ${UNUSED_NUMBER}, empty name, empty blocks and custom lists)`;
}

/** JSON Schema (draft 2020-12) of the reply, generated from ReplySchema. */
export function replyJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(ReplySchema, { io: 'output', reused: 'inline', cycles: 'throw', unrepresentable: 'throw' }) as Record<string, unknown>;
}
