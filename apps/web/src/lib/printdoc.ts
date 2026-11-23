// Which parts of the project build-plan document are included (ADR-010). Pure; the browser store is handled in prefs.ts.

export const PRINT_PARTS = ['shopping', 'diagrams', 'materials', 'steps'] as const;
export type PrintPart = (typeof PRINT_PARTS)[number];
export type PrintParts = Record<PrintPart, boolean>;

export const PRINT_PART_LABELS: Record<PrintPart, string> = {
  shopping: 'Shopping list',
  diagrams: 'Diagrams',
  materials: 'Materials',
  steps: 'Steps',
};

export const ALL_PARTS: PrintParts = { shopping: true, diagrams: true, materials: true, steps: true };

/** Stored text to the parts to include. Anything missing or malformed counts as included. */
export function parsePrintParts(raw: string | null): PrintParts {
  if (!raw) return { ...ALL_PARTS };
  try {
    const parsed: unknown = JSON.parse(raw);
    const obj = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    return Object.fromEntries(PRINT_PARTS.map((p) => [p, obj[p] !== false])) as PrintParts;
  } catch {
    return { ...ALL_PARTS };
  }
}
