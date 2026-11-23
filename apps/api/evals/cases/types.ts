/** Test-set types. Cases are data; grading lives in ../grader.ts. */
import type { NetRole } from '@diy-ai/core';

export type Category = 'blocks' | 'multi-block' | 'counts' | 'target' | 'question' | 'multi-turn' | 'unsupported' | 'custom' | 'trap';

/** A device terminal addressed by catalogue type, e.g. { type: 'breaker', terminal: 'out' }. Ids are the model's choice, so facts never use them. */
export interface TerminalRef {
  type: string;
  terminal: string;
}

export type CustomFact =
  /** Every terminal of type a and every terminal of type b (at least one of each) share one electrical net. */
  | { kind: 'connected'; a: TerminalRef; b: TerminalRef }
  /** Every device ground terminal (not the ground bar itself) is on the ground bar's net. */
  | { kind: 'groundsBonded' }
  /** Every device of this type sits in a box that a cable runs to directly from the panel box (power arrives there first). */
  | { kind: 'fedFromPanel'; type: string }
  /** Net roles (from analyzeNets) of the given terminal on every device of its type, as a multiset, e.g. { source_hot: 2, protected_hot: 1 }. */
  | { kind: 'netRoles'; at: TerminalRef; roles: Partial<Record<NetRole, number>> };

/**
 * One expected building block. Only the fields a case names are compared (resolved values, so a count the model
 * omitted never matches). `count` is the single count of most blocks; `countA` / `countB` are the two lights counts of a 2-gang block.
 */
export interface BlockExpect {
  type: string;
  count?: number;
  countA?: number;
  countB?: number;
  gfciFirst?: boolean;
}

export type Expect =
  | { kind: 'question' }
  | { kind: 'unsupported' }
  /** Exactly this block list, in this order (each block compared on the fields it names); breakerAmps only when the case states one. */
  | { kind: 'blocks'; blocks: readonly BlockExpect[]; breakerAmps?: 15 | 20; /** Graded only when stated (target cases). */ target?: 'new' | 'selected' }
  /** A custom (unverified) circuit that validates and satisfies the facts and counts. Types not listed in deviceCounts are unconstrained. */
  | { kind: 'custom'; facts: CustomFact[]; deviceCounts: Record<string, number>; breakerAmps?: number }
  /** Anything except exactly this block list: a question, an unsupported reply, a custom circuit or any other block list all pass. */
  | { kind: 'not_blocks'; forbidden: readonly BlockExpect[] };

export interface Step {
  /** User message sent at this step. */
  user: string;
  /** Expected outcome of the model's reply to this message. */
  expect: Expect;
}

/** An existing circuit of the project, built from blocks, as the model's context note shows it. */
export interface SeedCircuit {
  name: string;
  breakerAmps: 15 | 20;
  blocks: readonly BlockExpect[];
}

/** Project context a case starts with: existing circuits in order and which one (0-based index) is selected, if any. */
export interface Seed {
  circuits: readonly SeedCircuit[];
  selected: number | null;
}

export interface EvalCase {
  id: string;
  category: Category;
  /** One step for single-turn cases; for multi-turn cases later steps run only if the earlier ones passed. */
  steps: Step[];
  /** One line tying the expectation to a block's stated applicability or the prompt's scope rules. */
  rationale: string;
  /** Existing circuits and selection the first step starts with; single-step cases only. */
  seed?: Seed;
}
