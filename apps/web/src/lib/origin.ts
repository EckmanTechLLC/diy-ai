import { getTemplate, type Block, type CircuitOrigin } from '@diy-ai/core';

export type OriginInfo =
  /** Built from checked building blocks; `summary` reads like "3-way pair with 8 lights → run of 8 receptacles". */
  | { kind: 'blocks'; name: string; summary: string }
  /** Legacy: from a hand-verified whole-circuit template; `title` is its display name (the id when the template is no longer known). */
  | { kind: 'template'; title: string }
  /** Wired by the model without blocks. Never verified. */
  | { kind: 'custom' };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One block in plain words. */
export function describeBlock(block: Block): string {
  switch (block.type) {
    case 'receptacle_run':
      return `${block.gfciFirst ? 'GFCI-first run' : 'run'} of ${plural(block.count, 'receptacle', 'receptacles')}`;
    case 'switch_lights':
      return `switch with ${plural(block.count, 'light', 'lights')}`;
    case 'three_way_lights':
      return `3-way pair with ${plural(block.count, 'light', 'lights')}`;
    case 'switch_fan':
      return 'switch with exhaust fan';
    case 'two_gang_switches':
      return `2-gang switches with ${plural(block.countA, 'light', 'lights')} and ${plural(block.countB, 'light', 'lights')}`;
    default:
      return String((block as { type: string }).type);
  }
}

/** What to tell the user about where a circuit came from; null for no origin (examples, manual edits, older messages). */
export function describeOrigin(origin: CircuitOrigin | null | undefined): OriginInfo | null {
  if (!origin) return null;
  if (origin.kind === 'custom') return { kind: 'custom' };
  if (origin.kind === 'blocks') return { kind: 'blocks', name: origin.name, summary: origin.blocks.map(describeBlock).join(' → ') };
  return { kind: 'template', title: getTemplate(origin.templateId)?.title ?? origin.templateId };
}

export const UNVERIFIED_LABEL = 'Unverified wiring — not from checked blocks';
