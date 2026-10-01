/**
 * Row selection and the bulk target (WD-CON-019).
 *
 * The header checkbox selects the rows that are loaded. When more rows match the filter than are loaded, the
 * banner offers to extend the selection to "everything matching": from then on the bulk action is sent as the
 * filter instead of as ids. Unticking any row drops back to explicit ids. WaDesk applied the extension to two of
 * six actions; here every action takes the same target.
 */

export interface Selection {
  ids: ReadonlySet<string>;
  /** Selection stands for every contact matching the active filter, not just `ids`. */
  allMatching: boolean;
}

export const EMPTY_SELECTION: Selection = { ids: new Set(), allMatching: false };

export type SelectionAction =
  | { type: 'toggle'; id: string }
  | { type: 'setMany'; ids: readonly string[]; checked: boolean }
  | { type: 'selectAllMatching' }
  | { type: 'clear' }
  /** Rows left the list (deleted, filtered away): forget them. */
  | { type: 'retain'; ids: readonly string[] };

export function selectionReducer(state: Selection, action: SelectionAction): Selection {
  switch (action.type) {
    case 'toggle': {
      const ids = new Set(state.ids);
      if (!ids.delete(action.id)) ids.add(action.id);
      return { ids, allMatching: false };
    }
    case 'setMany': {
      const ids = new Set(state.ids);
      for (const id of action.ids) {
        if (action.checked) ids.add(id);
        else ids.delete(id);
      }
      return { ids, allMatching: action.checked ? state.allMatching : false };
    }
    case 'selectAllMatching':
      return { ...state, allMatching: true };
    case 'clear':
      return EMPTY_SELECTION;
    case 'retain': {
      const keep = new Set(action.ids);
      const ids = new Set([...state.ids].filter((id) => keep.has(id)));
      return ids.size === state.ids.size ? state : { ids, allMatching: false };
    }
  }
}

export type CheckState = 'none' | 'some' | 'all';

/** State of the header checkbox over the rows currently loaded. */
export function headerState(loaded: readonly string[], selected: ReadonlySet<string>): CheckState {
  if (loaded.length === 0) return 'none';
  const n = loaded.filter((id) => selected.has(id)).length;
  return n === 0 ? 'none' : n === loaded.length ? 'all' : 'some';
}

export interface ContactFilterSnapshot {
  q: string;
  lifecycleStage: string;
  group: string;
  tag: string;
  consent: '' | 'subscribed' | 'unsubscribed';
  imported: boolean;
}

/** What a bulk action acts on: explicit ids, or the filter that defines "all matching". */
export type BulkTarget =
  { kind: 'ids'; ids: string[] } | { kind: 'filter'; filter: ContactFilterSnapshot };

export function bulkTarget(sel: Selection, filter: ContactFilterSnapshot): BulkTarget {
  return sel.allMatching ? { kind: 'filter', filter } : { kind: 'ids', ids: [...sel.ids] };
}

/** The "N selected" count: the loaded rows, or `null` ("all matching", count unknown without a total). */
export function selectedCount(sel: Selection): number | null {
  return sel.allMatching ? null : sel.ids.size;
}
