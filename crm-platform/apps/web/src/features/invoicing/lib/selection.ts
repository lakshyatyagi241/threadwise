/**
 * Row selection for the bulk bar. A bulk action is one API call per invoice (there is no bulk route), so there is no "select all
 * matching": the header box selects the rows that are loaded.
 */
export interface Selection {
  ids: ReadonlySet<string>;
}

export const EMPTY_SELECTION: Selection = { ids: new Set() };

export type SelectionAction =
  | { type: 'toggle'; id: string }
  | { type: 'setMany'; ids: readonly string[]; checked: boolean }
  | { type: 'clear' }
  /** Rows left the list (changed, deleted, filtered away): forget them. */
  | { type: 'retain'; ids: readonly string[] };

export function selectionReducer(state: Selection, action: SelectionAction): Selection {
  switch (action.type) {
    case 'toggle': {
      const ids = new Set(state.ids);
      if (!ids.delete(action.id)) ids.add(action.id);
      return { ids };
    }
    case 'setMany': {
      const ids = new Set(state.ids);
      for (const id of action.ids) {
        if (action.checked) ids.add(id);
        else ids.delete(id);
      }
      return { ids };
    }
    case 'clear':
      return state.ids.size === 0 ? state : EMPTY_SELECTION;
    case 'retain': {
      const keep = new Set(action.ids);
      const ids = new Set([...state.ids].filter((id) => keep.has(id)));
      return ids.size === state.ids.size ? state : { ids };
    }
  }
}

export type CheckState = 'none' | 'some' | 'all';

export function headerState(loaded: readonly string[], selected: ReadonlySet<string>): CheckState {
  if (loaded.length === 0) return 'none';
  const n = loaded.filter((id) => selected.has(id)).length;
  return n === 0 ? 'none' : n === loaded.length ? 'all' : 'some';
}
