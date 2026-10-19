/** Which columns the tasks table shows ("Modify columns"), kept per browser as a list of ids. */
export const COLUMN_IDS = [
  'title',
  'priority',
  'due',
  'assignee',
  'contact',
  'deal',
  'outcome',
  'created',
  'completed',
] as const;
export type ColumnId = (typeof COLUMN_IDS)[number];

/** The title cell is the row's link to the drawer and holds the complete tick: it cannot be hidden. */
export const LOCKED_COLUMNS: readonly ColumnId[] = ['title'];
export const DEFAULT_COLUMNS: readonly ColumnId[] = [
  'title',
  'priority',
  'due',
  'assignee',
  'contact',
  'deal',
  'outcome',
];
export const STORAGE_KEY = 'tasks:columns';

export function parseStoredColumns(raw: string | null): ColumnId[] | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return null;
    return v.filter((x): x is ColumnId => (COLUMN_IDS as readonly unknown[]).includes(x));
  } catch {
    return null;
  }
}

export const serializeColumns = (ids: readonly ColumnId[]): string => JSON.stringify(ids);

/** The columns to draw: stored (or default), in canonical order, locked ones always on. */
export function visibleColumns(stored: readonly ColumnId[] | null): ColumnId[] {
  const chosen = new Set<ColumnId>([...(stored ?? DEFAULT_COLUMNS), ...LOCKED_COLUMNS]);
  return COLUMN_IDS.filter((c) => chosen.has(c));
}

export function toggleColumn(current: readonly ColumnId[], id: ColumnId, on: boolean): ColumnId[] {
  if (LOCKED_COLUMNS.includes(id)) return [...current];
  const rest = current.filter((c) => c !== id);
  return on ? [...rest, id] : rest;
}
