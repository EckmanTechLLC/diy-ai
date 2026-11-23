import { BUS_BAR_TYPES, findTerminal } from './catalogue';
import { CircuitModelSchema, conductorsOf, type CircuitModel, type Endpoint } from './schema';

export type IssueCode =
  | 'SCHEMA'
  | 'DUPLICATE_ID'
  | 'AMPS_REQUIRED'
  | 'AMPS_FORBIDDEN'
  | 'UNKNOWN_BOX'
  | 'UNKNOWN_DEVICE'
  | 'UNKNOWN_TERMINAL'
  | 'UNKNOWN_CABLE'
  | 'UNKNOWN_SPLICE'
  | 'BAD_CONDUCTOR_COLOR'
  | 'CONDUCTOR_BOX_MISMATCH'
  | 'BOX_MISMATCH'
  | 'CONDUCTOR_END_UNCONNECTED'
  | 'CONDUCTOR_END_MULTIPLE'
  | 'TERMINAL_MULTIPLE'
  | 'SPLICE_TOO_FEW'
  | 'SELF_CONNECTION'
  | 'DUPLICATE_CONNECTION';

export interface Issue {
  code: IssueCode;
  message: string;
  /** Ids of the model objects involved (boxes, devices, cables, splices, connections). */
  ids: string[];
}

/** Structural checks only; never throws on bad wiring. Returns [] for a valid model. */
export function validateCircuit(input: unknown): Issue[] {
  const parsed = CircuitModelSchema.safeParse(input);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => ({
      code: 'SCHEMA' as const,
      message: `${i.path.join('.') || '(root)'}: ${i.message}`,
      ids: [],
    }));
  }
  const model: CircuitModel = parsed.data;
  const issues: Issue[] = [];
  const add = (code: IssueCode, message: string, ids: string[]) => issues.push({ code, message, ids });

  // unique ids per collection
  for (const name of ['boxes', 'devices', 'cables', 'splices', 'connections'] as const) {
    const seen = new Set<string>();
    for (const item of model[name]) {
      if (seen.has(item.id)) add('DUPLICATE_ID', `duplicate id "${item.id}" in ${name}`, [item.id]);
      seen.add(item.id);
    }
  }

  const boxes = new Set(model.boxes.map((b) => b.id));
  const devices = new Map(model.devices.map((d) => [d.id, d]));
  const cables = new Map(model.cables.map((c) => [c.id, c]));
  const splices = new Map(model.splices.map((s) => [s.id, s]));

  for (const d of model.devices) {
    if (!boxes.has(d.box)) add('UNKNOWN_BOX', `device "${d.id}" is in unknown box "${d.box}"`, [d.id, d.box]);
    if (d.type === 'breaker' && d.amps === undefined) add('AMPS_REQUIRED', `breaker "${d.id}" needs amps`, [d.id]);
    if (d.type !== 'breaker' && d.amps !== undefined) add('AMPS_FORBIDDEN', `${d.type} "${d.id}" must not have amps`, [d.id]);
  }
  for (const c of model.cables)
    for (const b of [c.from, c.to])
      if (!boxes.has(b)) add('UNKNOWN_BOX', `cable "${c.id}" refers to unknown box "${b}"`, [c.id, b]);
  for (const s of model.splices)
    if (!boxes.has(s.box)) add('UNKNOWN_BOX', `splice "${s.id}" is in unknown box "${s.box}"`, [s.id, s.box]);

  // connections: key every endpoint (including its box) to detect self/duplicate connections
  const keyOf = (e: Endpoint): string =>
    e.kind === 'terminal' ? `t:${e.device}.${e.terminal}` : e.kind === 'conductor' ? `c:${e.cable}.${e.color}@${e.box}` : `s:${e.splice}`;
  const seenPairs = new Set<string>();
  const effective = model.connections.filter((c) => {
    const ka = keyOf(c.a);
    const kb = keyOf(c.b);
    if (ka === kb) {
      add('SELF_CONNECTION', `connection "${c.id}" joins an endpoint to itself`, [c.id]);
      return false;
    }
    const pair = [ka, kb].sort().join('|');
    if (seenPairs.has(pair)) {
      add('DUPLICATE_CONNECTION', `connection "${c.id}" duplicates an earlier connection`, [c.id]);
      return false;
    }
    seenPairs.add(pair);
    return true;
  });

  /** Resolve an endpoint's box; reports reference problems and returns undefined if unresolved. */
  const resolve = (connId: string, e: Endpoint): string | undefined => {
    switch (e.kind) {
      case 'terminal': {
        const d = devices.get(e.device);
        if (!d) {
          add('UNKNOWN_DEVICE', `connection "${connId}" refers to unknown device "${e.device}"`, [connId, e.device]);
          return undefined;
        }
        if (!findTerminal(d.type, e.terminal)) {
          add('UNKNOWN_TERMINAL', `${d.type} "${d.id}" has no terminal "${e.terminal}"`, [connId, d.id]);
          return undefined;
        }
        return d.box;
      }
      case 'conductor': {
        const cable = cables.get(e.cable);
        if (!cable) {
          add('UNKNOWN_CABLE', `connection "${connId}" refers to unknown cable "${e.cable}"`, [connId, e.cable]);
          return undefined;
        }
        let ok = true;
        if (!conductorsOf(cable.type).includes(e.color)) {
          add('BAD_CONDUCTOR_COLOR', `cable "${cable.id}" (${cable.type}) has no ${e.color} conductor`, [connId, cable.id]);
          ok = false;
        }
        if (e.box !== cable.from && e.box !== cable.to) {
          add('CONDUCTOR_BOX_MISMATCH', `cable "${cable.id}" does not end in box "${e.box}"`, [connId, cable.id, e.box]);
          ok = false;
        }
        return ok ? e.box : undefined;
      }
      case 'splice': {
        const s = splices.get(e.splice);
        if (!s) {
          add('UNKNOWN_SPLICE', `connection "${connId}" refers to unknown splice "${e.splice}"`, [connId, e.splice]);
          return undefined;
        }
        return s.box;
      }
    }
  };

  const terminalUse = new Map<string, string[]>();
  const spliceUse = new Map<string, string[]>();
  const conductorUse = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, id: string) => m.set(k, [...(m.get(k) ?? []), id]);

  for (const c of effective) {
    const ba = resolve(c.id, c.a);
    const bb = resolve(c.id, c.b);
    if (ba !== undefined && bb !== undefined && ba !== bb)
      add('BOX_MISMATCH', `connection "${c.id}" joins endpoints in different boxes ("${ba}" and "${bb}")`, [c.id]);
    for (const e of [c.a, c.b]) {
      if (e.kind === 'terminal') push(terminalUse, `${e.device}.${e.terminal}`, c.id);
      else if (e.kind === 'splice') push(spliceUse, e.splice, c.id);
      else push(conductorUse, `${e.cable}.${e.color}@${e.box}`, c.id);
    }
  }

  for (const [key, ids] of terminalUse) {
    const [device, terminal] = [key.slice(0, key.indexOf('.')), key.slice(key.indexOf('.') + 1)];
    const d = devices.get(device);
    if (!d || !findTerminal(d.type, terminal) || BUS_BAR_TYPES.includes(d.type)) continue;
    if (ids.length > 1) add('TERMINAL_MULTIPLE', `terminal ${key} is connected ${ids.length} times`, [device, ...ids]);
  }

  for (const s of model.splices) {
    const n = spliceUse.get(s.id)?.length ?? 0;
    if (n < 2) add('SPLICE_TOO_FEW', `splice "${s.id}" has ${n} connection(s), needs at least 2`, [s.id, ...(spliceUse.get(s.id) ?? [])]);
  }

  for (const cable of model.cables) {
    for (const box of new Set([cable.from, cable.to])) {
      for (const color of conductorsOf(cable.type)) {
        const ids = conductorUse.get(`${cable.id}.${color}@${box}`) ?? [];
        if (ids.length === 0)
          add('CONDUCTOR_END_UNCONNECTED', `${color} conductor of cable "${cable.id}" is not connected in box "${box}"`, [cable.id, box]);
        else if (ids.length > 1)
          add('CONDUCTOR_END_MULTIPLE', `${color} conductor of cable "${cable.id}" is connected ${ids.length} times in box "${box}"`, [cable.id, box, ...ids]);
      }
    }
  }

  return issues;
}
