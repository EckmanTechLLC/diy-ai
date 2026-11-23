// Flat, topology-only circuit model (ADR-002). No coordinates, sizes or layout hints anywhere.
import { z } from 'zod';
import { DEVICE_TYPES } from './catalogue';

export const WIRE_COLORS = ['black', 'white', 'red', 'bare', 'green'] as const;
export const WireColorSchema = z.enum(WIRE_COLORS);
export type WireColor = z.infer<typeof WireColorSchema>;

export const CABLE_TYPES = ['14/2', '14/3', '12/2', '12/3', '10/2', '10/3'] as const;
export const CableTypeSchema = z.enum(CABLE_TYPES);
export type CableType = z.infer<typeof CableTypeSchema>;

const Id = z.string().min(1);

export const BoxSchema = z.strictObject({
  id: Id,
  label: z.string(),
  kind: z.enum(['panel', 'box']),
});
export type Box = z.infer<typeof BoxSchema>;

export const DeviceSchema = z.strictObject({
  id: Id,
  box: Id,
  type: z.enum(DEVICE_TYPES),
  label: z.string(),
  /** Required for breakers, forbidden otherwise (checked by validateCircuit). */
  amps: z.number().int().positive().optional(),
});
export type Device = z.infer<typeof DeviceSchema>;

export const CableSchema = z.strictObject({
  id: Id,
  name: z.string(),
  type: CableTypeSchema,
  /** Upstream box (panel side) and downstream box (load side). */
  from: Id,
  to: Id,
});
export type Cable = z.infer<typeof CableSchema>;

export const SpliceSchema = z.strictObject({ id: Id, box: Id });
export type Splice = z.infer<typeof SpliceSchema>;

export const EndpointSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('terminal'), device: Id, terminal: Id }),
  z.strictObject({ kind: z.literal('conductor'), cable: Id, color: WireColorSchema, box: Id }),
  z.strictObject({ kind: z.literal('splice'), splice: Id }),
]);
export type Endpoint = z.infer<typeof EndpointSchema>;

export const ConnectionSchema = z.strictObject({
  id: Id,
  a: EndpointSchema,
  b: EndpointSchema,
  color: WireColorSchema,
});
export type Connection = z.infer<typeof ConnectionSchema>;

export const CircuitModelSchema = z.strictObject({
  id: Id,
  title: z.string(),
  boxes: z.array(BoxSchema),
  devices: z.array(DeviceSchema),
  cables: z.array(CableSchema),
  splices: z.array(SpliceSchema),
  connections: z.array(ConnectionSchema),
});
export type CircuitModel = z.infer<typeof CircuitModelSchema>;

/** Conductors of a cable type, derived: x/2 -> black, white, bare; x/3 -> black, red, white, bare. */
export function conductorsOf(type: CableType): WireColor[] {
  return type.endsWith('/3') ? ['black', 'red', 'white', 'bare'] : ['black', 'white', 'bare'];
}

/** Display label, e.g. `14/2 NM-B "feed"`. */
export function cableLabel(cable: Pick<Cable, 'type' | 'name'>): string {
  return `${cable.type} NM-B "${cable.name}"`;
}
