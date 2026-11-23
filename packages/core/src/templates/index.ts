import { gfciDownstreamReceptacle } from './gfci';
import { singlePoleSwitch } from './single-pole';
import type { WiringTemplate } from './spec';
import { threeWaySwitches } from './three-way';
import { twoGangTwoSwitches } from './two-gang';

export type { BreakerAmps } from './builder';
export { cableTypeFor } from './builder';
export type { ParamSpec, ParamSpecs, TemplateParams, WiringTemplate } from './spec';
export { wireParamsSchema } from './spec';

/**
 * LEGACY (ADR-008, task 22): whole-circuit templates are no longer offered to the model and nothing produces a
 * `template` origin. The registry and builders stay so stored template origins can still be labelled, and as
 * the verified fixtures the building blocks are compared against.
 */
export const TEMPLATES: readonly WiringTemplate[] = [
  singlePoleSwitch,
  threeWaySwitches,
  gfciDownstreamReceptacle,
  twoGangTwoSwitches,
];

export function getTemplate(id: string): WiringTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
