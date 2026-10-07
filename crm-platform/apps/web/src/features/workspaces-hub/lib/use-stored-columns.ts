'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { parseStoredColumns, visibleColumns, type ColumnId } from './columns';
import { readRaw, resetColumns, setColumn, type ColumnStorage } from './columns-store';

const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener('storage', cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', cb);
  };
}

function storage(): ColumnStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const notify = () => {
  for (const l of listeners) l();
};

/**
 * The operator's visible columns, remembered in localStorage. The server render and the first client render use the
 * defaults (everything visible), so hydration matches; blocked storage means the choice lives only until reload.
 */
export function useStoredColumns() {
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(storage()),
    () => null,
  );
  const visible = useMemo(() => visibleColumns(parseStoredColumns(raw)), [raw]);
  const set = useCallback((id: ColumnId, on: boolean) => {
    setColumn(storage(), id, on);
    notify();
  }, []);
  const reset = useCallback(() => {
    resetColumns(storage());
    notify();
  }, []);
  return { visible, set, reset };
}
