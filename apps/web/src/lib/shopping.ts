// The combined shopping list of a project (ADR-010). Pure: it only adds up what `buildMaterials` counted per circuit.
// Nothing here estimates a length or a quantity.
import { CABLE_TYPES, type CableTotal, type MaterialCategory, type MaterialsList } from '@diy-ai/core';

export interface ShoppingInput {
  name: string;
  list: MaterialsList;
}

export interface ShoppingItem {
  category: MaterialCategory;
  description: string;
  unit: 'each' | 'run';
  quantity: number;
  /** The distinct notes of the merged items, in the order met. */
  notes: string[];
  /** Names of the circuits the item is used in, in project order. */
  usedIn: string[];
}

export interface ShoppingCable {
  type: CableTotal['type'];
  runs: number;
  /** Runs without an entered length, over all circuits. Never estimated. */
  missing: number;
  /** Sum of the entered lengths. */
  knownFt: number;
  /** Sum of each circuit's own total (its known length plus its own allowance, rounded up per circuit); covers only runs with a length. */
  totalFt: number;
  /** The distinct allowances of the circuits that have entered lengths of this type, ascending. */
  allowancePcts: number[];
  usedIn: string[];
}

export interface ShoppingList {
  items: ShoppingItem[];
  cable: ShoppingCable[];
  /** Cable runs, over all types and circuits, that still have no length. */
  missingRuns: number;
  /** The distinct fixed "not included" texts of the circuits. */
  notIncluded: string[];
}

/** Order of the categories in the merged list. Cable runs are not items here: cable is listed per type in `cable`. */
export const SHOPPING_CATEGORIES: readonly MaterialCategory[] = ['breaker', 'device', 'box', 'wire_nut', 'pigtail', 'cover_plate'];

const round2 = (n: number) => Math.round(n * 100) / 100;

function addUnique<T>(list: T[], value: T) {
  if (!list.includes(value)) list.push(value);
}

/**
 * Merges the materials of several circuits.
 * - Items of the same category, description and unit are summed; their distinct notes are kept and each circuit is named once.
 * - Breakers are never merged: each stays its own row with its type and its circuit.
 * - Cable is summed per type from the entered lengths, using each circuit's own allowance; runs without a length are only counted.
 */
export function mergeMaterials(inputs: readonly ShoppingInput[]): ShoppingList {
  const merged = new Map<string, ShoppingItem>();
  const cable = new Map<CableTotal['type'], ShoppingCable>();
  const notIncluded: string[] = [];
  let seq = 0;

  for (const { name, list } of inputs) {
    for (const item of list.items) {
      if (item.category === 'cable_run') continue;
      // a breaker row is unique by construction
      const key = item.category === 'breaker' ? `breaker#${seq++}` : JSON.stringify([item.category, item.description, item.unit]);
      let entry = merged.get(key);
      if (!entry) {
        entry = { category: item.category, description: item.description, unit: item.unit, quantity: 0, notes: [], usedIn: [] };
        merged.set(key, entry);
      }
      entry.quantity += item.quantity;
      if (item.note) addUnique(entry.notes, item.note);
      addUnique(entry.usedIn, name);
    }
    for (const t of list.cableTotals) {
      let c = cable.get(t.type);
      if (!c) {
        c = { type: t.type, runs: 0, missing: 0, knownFt: 0, totalFt: 0, allowancePcts: [], usedIn: [] };
        cable.set(t.type, c);
      }
      c.runs += t.runs;
      c.missing += t.missing;
      c.knownFt = round2(c.knownFt + t.knownFt);
      c.totalFt += t.totalFt;
      if (t.runs - t.missing > 0) addUnique(c.allowancePcts, t.allowancePct);
      addUnique(c.usedIn, name);
    }
    for (const n of list.notIncluded) addUnique(notIncluded, n);
  }

  const rank = (c: MaterialCategory) => SHOPPING_CATEGORIES.indexOf(c);
  const items = [...merged.values()]
    .map((item, i) => ({ item, i }))
    .sort((a, b) => rank(a.item.category) - rank(b.item.category) || a.i - b.i)
    .map((x) => x.item);
  const cables = [...cable.values()]
    .sort((a, b) => CABLE_TYPES.indexOf(a.type) - CABLE_TYPES.indexOf(b.type))
    .map((c) => ({ ...c, allowancePcts: [...c.allowancePcts].sort((a, b) => a - b) }));
  return { items, cable: cables, missingRuns: cables.reduce((s, c) => s + c.missing, 0), notIncluded };
}
