import {
  STORAGE_KEY,
  parseStoredColumns,
  serializeColumns,
  toggleColumn,
  visibleColumns,
  type ColumnId,
} from './columns';

/** The slice of `Storage` the column choice needs (so tests can pass a plain map). */
export interface ColumnStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The stored raw text, or null when nothing is stored or storage is blocked (private mode). */
export function readRaw(storage: ColumnStorage | null): string | null {
  try {
    return storage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Shows or hides one column and saves the whole choice; a locked column is left alone. */
export function setColumn(storage: ColumnStorage | null, id: ColumnId, on: boolean): void {
  try {
    const next = toggleColumn(visibleColumns(parseStoredColumns(readRaw(storage))), id, on);
    storage?.setItem(STORAGE_KEY, serializeColumns(next));
  } catch {
    /* not remembered */
  }
}

/** Forgets the choice: every column shows again. */
export function resetColumns(storage: ColumnStorage | null): void {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    /* not remembered */
  }
}
