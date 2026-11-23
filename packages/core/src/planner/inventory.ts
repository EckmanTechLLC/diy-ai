// Room inventory (ADR-009): what the model lists for a whole-job request. No electrical decisions in here.
import { z } from 'zod';

export const ROOM_TYPES = ['living_area', 'bedroom', 'closet', 'hallway', 'bathroom', 'other'] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

export const MAX_RECEPTACLES_PER_ROOM = 24;
export const MAX_LIGHTS_PER_GROUP = 12;
export const MAX_FANS_PER_ROOM = 2;

const nonBlank = (s: string) => s.trim().length > 0;

export const LightGroupSchema = z.strictObject({
  lights: z
    .number({ error: `lights must be a whole number from 1 to ${MAX_LIGHTS_PER_GROUP}` })
    .int({ error: `lights must be a whole number from 1 to ${MAX_LIGHTS_PER_GROUP}` })
    .min(1, { error: 'lights must be at least 1' })
    .max(MAX_LIGHTS_PER_GROUP, { error: `lights must be at most ${MAX_LIGHTS_PER_GROUP}` }),
  switchLocations: z.literal([1, 2], { error: 'switchLocations must be 1 or 2' }),
});
export type LightGroup = z.output<typeof LightGroupSchema>;

export const RoomSchema = z.strictObject({
  id: z.string().refine(nonBlank, { message: 'must not be blank' }),
  name: z.string().refine(nonBlank, { message: 'must not be blank' }),
  type: z.enum(ROOM_TYPES, { error: `type must be one of ${ROOM_TYPES.join(', ')}` }),
  receptacles: z
    .number({ error: `receptacles must be a whole number from 0 to ${MAX_RECEPTACLES_PER_ROOM}` })
    .int({ error: `receptacles must be a whole number from 0 to ${MAX_RECEPTACLES_PER_ROOM}` })
    .min(0, { error: 'receptacles must be at least 0' })
    .max(MAX_RECEPTACLES_PER_ROOM, { error: `receptacles must be at most ${MAX_RECEPTACLES_PER_ROOM}` }),
  lightGroups: z.array(LightGroupSchema, { error: 'lightGroups must be a list' }),
  fans: z
    .number({ error: `fans must be a whole number from 0 to ${MAX_FANS_PER_ROOM}` })
    .int({ error: `fans must be a whole number from 0 to ${MAX_FANS_PER_ROOM}` })
    .min(0, { error: 'fans must be at least 0' })
    .max(MAX_FANS_PER_ROOM, { error: `fans must be at most ${MAX_FANS_PER_ROOM}` }),
  /** Id of the room this one belongs to (a closet of a bedroom), or empty. */
  attachedTo: z.string().default(''),
});
export type Room = z.output<typeof RoomSchema>;
export type RoomInput = z.input<typeof RoomSchema>;

export const InventorySchema = z.strictObject({
  basement: z.boolean({ error: 'basement must be true or false' }),
  rooms: z.array(RoomSchema, { error: 'rooms must be a list' }),
});
export type Inventory = z.output<typeof InventorySchema>;
export type InventoryInput = z.input<typeof InventorySchema>;

export type InventoryIssueCode =
  | 'SCHEMA'
  | 'NO_ROOMS'
  | 'DUPLICATE_ID'
  | 'UNKNOWN_ATTACHED_TO'
  | 'SELF_ATTACHED'
  | 'EMPTY_ROOM';

export interface InventoryIssue {
  code: InventoryIssueCode;
  /** Plain sentence a model can act on. */
  message: string;
  /** Ids of the rooms involved. */
  ids: string[];
}

/** Returns [] for a usable inventory. Never throws. */
export function validateInventory(input: unknown): InventoryIssue[] {
  const parsed = InventorySchema.safeParse(input);
  if (!parsed.success)
    return parsed.error.issues.map((i) => ({
      code: 'SCHEMA' as const,
      message: `${i.path.join('.') || '(root)'}: ${i.message}`,
      ids: [],
    }));
  const inv = parsed.data;
  const issues: InventoryIssue[] = [];
  if (inv.rooms.length === 0) issues.push({ code: 'NO_ROOMS', message: 'the inventory has no rooms; list at least one room', ids: [] });

  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const r of inv.rooms) (seen.has(r.id) ? dup : seen).add(r.id);
  for (const id of dup) issues.push({ code: 'DUPLICATE_ID', message: `room id "${id}" is used more than once; ids must be unique`, ids: [id] });

  for (const r of inv.rooms) {
    if (r.attachedTo !== '') {
      if (r.attachedTo === r.id) issues.push({ code: 'SELF_ATTACHED', message: `room "${r.id}" is attached to itself`, ids: [r.id] });
      else if (!seen.has(r.attachedTo))
        issues.push({ code: 'UNKNOWN_ATTACHED_TO', message: `room "${r.id}" is attached to "${r.attachedTo}", which is not a room id in the inventory`, ids: [r.id] });
    }
    if (r.receptacles === 0 && r.lightGroups.length === 0 && r.fans === 0)
      issues.push({ code: 'EMPTY_ROOM', message: `room "${r.id}" (${r.name}) has no receptacles, lights or fans; give it something or remove it`, ids: [r.id] });
  }
  return issues;
}
