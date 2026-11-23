/** Builds the project context a seeded case starts with, through the same resolver the chat loop uses. */
import { COUNT_FIELDS, LABEL_FIELDS, resolveReply } from '@diy-ai/core';
import type { ContextCircuit } from '../src/chat/loop';
import type { BlockExpect, Seed } from './cases';

/** A flat block entry as the model writes it: every key present, unused ones 0 / false / "". */
function entry(b: BlockExpect): Record<string, unknown> {
  const out: Record<string, unknown> = { type: b.type };
  for (const f of COUNT_FIELDS) out[f] = (b as unknown as Record<string, number | undefined>)[f] ?? 0;
  out.gfciFirst = b.gfciFirst ?? false;
  for (const f of LABEL_FIELDS) out[f] = '';
  return out;
}

export function seedContext(seed: Seed): { circuits: ContextCircuit[]; selectedCircuitId: string | null } {
  const circuits = seed.circuits.map((c, i): ContextCircuit => {
    const reply = { kind: 'circuit', target: 'new', message: 'seed', breakerAmps: c.breakerAmps, name: c.name, blocks: c.blocks.map(entry), custom: [] };
    const res = resolveReply(reply);
    if (res.kind !== 'circuit') throw new Error(`seed circuit ${i + 1} (${c.name}) does not resolve: ${JSON.stringify(res)}`);
    return { id: `seed-${i + 1}`, name: c.name, circuit: res.circuit, origin: res.origin };
  });
  return { circuits, selectedCircuitId: seed.selected === null ? null : (circuits[seed.selected]?.id ?? null) };
}
