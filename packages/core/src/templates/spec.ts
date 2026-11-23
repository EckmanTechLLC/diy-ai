// Template parameters are declared once as a spec; the Zod schemas (strict, with defaults, and the
// all-required nullable "wire" form used in the reply schema) and the prompt text are all derived from it.
import { z } from 'zod';
import type { CircuitModel } from '../schema';
import type { BreakerAmps } from './builder';

export type ParamSpec =
  | { kind: 'amps'; default: BreakerAmps; description: string }
  | { kind: 'label'; default: string; description: string };
export type ParamSpecs = Record<string, ParamSpec>;
export type TemplateParams = Record<string, string | number>;
export type Resolved<S extends ParamSpecs> = { [K in keyof S]: S[K] extends { kind: 'amps' } ? BreakerAmps : string };

export interface WiringTemplate {
  /** Stable id; stored with projects. */
  id: string;
  title: string;
  /** Exactly what is wired. */
  description: string;
  appliesWhen: string;
  notFor: string;
  params: ParamSpecs;
  /** Strict; missing keys take their defaults. Labels and amps never change topology. */
  paramsSchema: z.ZodType<TemplateParams>;
  /** Pure. Throws if params are invalid; use paramsSchema.safeParse first for untrusted input. */
  build(params?: Partial<TemplateParams>): CircuitModel;
}

const nonBlank = (s: string) => s.trim().length > 0;

function baseSchema(spec: ParamSpec): z.ZodType<string | number> {
  return spec.kind === 'amps'
    ? z.literal([15, 20])
    : z.string().refine(nonBlank, { message: 'must not be blank' });
}

export function defineTemplate<S extends ParamSpecs>(def: {
  id: string;
  title: string;
  description: string;
  appliesWhen: string;
  notFor: string;
  params: S;
  build: (p: Resolved<S>) => CircuitModel;
}): WiringTemplate {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, spec] of Object.entries(def.params))
    shape[key] = baseSchema(spec).default(spec.default as never).describe(spec.description);
  const paramsSchema = z.strictObject(shape) as unknown as z.ZodType<TemplateParams>;
  return {
    id: def.id,
    title: def.title,
    description: def.description,
    appliesWhen: def.appliesWhen,
    notFor: def.notFor,
    params: def.params,
    paramsSchema,
    build: (params = {}) => def.build(paramsSchema.parse(params) as Resolved<S>),
  };
}

/** Wire form of a template's parameters: every key required, null meaning "use the default". */
export function wireParamsSchema(t: WiringTemplate) {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, spec] of Object.entries(t.params))
    shape[key] = (spec.kind === 'amps' ? z.literal([15, 20]) : z.string()).nullable().describe(`${spec.description} Default: ${spec.default}. null = default.`);
  return z.strictObject(shape);
}
