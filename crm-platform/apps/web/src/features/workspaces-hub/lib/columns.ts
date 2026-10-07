import { WORKSPACE_HUB_COLUMNS, type WorkspaceHubColumn } from '@crm/contracts';

/** Which columns the Workspaces table shows, kept per operator in this browser as a list of column ids. */
export const COLUMN_IDS = WORKSPACE_HUB_COLUMNS;
export type ColumnId = WorkspaceHubColumn;

/** The workspace cell is the row's link to its dashboard: it cannot be hidden. */
export const LOCKED_COLUMNS: readonly ColumnId[] = ['workspace'];
export const DEFAULT_COLUMNS: readonly ColumnId[] = COLUMN_IDS;
export const STORAGE_KEY = 'workspaces-hub:columns';

/** The stored list, or null when nothing usable is stored (then the defaults apply). Unknown ids are dropped. */
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
