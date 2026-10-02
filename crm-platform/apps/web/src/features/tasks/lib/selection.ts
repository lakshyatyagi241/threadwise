/**
 * Row selection for the bulk bar. Bulk calls take explicit ids (at most 200, the API's limit), so there is no "select all
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
  /** Rows left the list (completed, deleted, filtered away): forget them. */
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

/** The API takes at most this many ids in one bulk call; larger selections go out in chunks. */
export const BULK_CHUNK = 200;

export function chunk<T>(items: readonly T[], size = BULK_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
