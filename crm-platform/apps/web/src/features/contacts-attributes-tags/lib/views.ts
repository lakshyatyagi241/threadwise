import type { ContactViewResponse } from '@crm/contracts';
import { DEFAULT_FILTERS, type ContactFilters, type PageSize } from '../api/contacts';
import { filtersToSearch, parseFilters } from './filters';

/**
 * Saved views of the Contact Hub (Reference's "views" tabs). A view stores the list filters as the URL parameters they are written as
 * (`{ v: 1, params: { q, stage, rules, sort ... } }`), so applying one is the same path as opening a filtered link: the values go through
 * `parseFilters`, which drops anything malformed. The page and the page size are never part of a view.
 */
export const VIEW_PARAM = 'view';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The view id of a `?view=` parameter; empty when absent or not an id. */
export function viewIdOf(params: Pick<URLSearchParams, 'get'>): string {
  const v = params.get(VIEW_PARAM) ?? '';
  return UUID.test(v) ? v : '';
}

/** What a view remembers of the current filters, and the columns when it keeps them (`columns` is the ordered list of column ids). */
export function viewFilterOf(
  f: ContactFilters,
  columns?: readonly string[] | null,
): Record<string, unknown> {
  const p = new URLSearchParams(
    filtersToSearch({ ...f, page: 1, limit: DEFAULT_FILTERS.limit }, DEFAULT_FILTERS.limit),
  );
  return {
    v: 1,
    params: Object.fromEntries(p.entries()),
    ...(columns && columns.length > 0 ? { columns: [...columns] } : {}),
  };
}

/** The columns a view saved, in order; null when it keeps none (the person's own columns then apply). */
export function viewColumnsOf(filter: Record<string, unknown>): string[] | null {
  const c = filter.columns;
  if (!Array.isArray(c)) return null;
  const ids = c.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length < 100);
  return ids.length > 0 ? ids : null;
}

/** The ad-hoc rules (JSON text) a view saved, empty for none. */
export function viewRulesOf(filter: Record<string, unknown>): string {
  const raw = filter.params;
  const rules = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).rules : undefined;
  return typeof rules === 'string' ? rules : '';
}

/**
 * The `filter` a view is saved with from the editor page: the view's other saved parameters stay as they were, the rules and the
 * columns are replaced by what the form holds.
 */
export function composeViewFilter(
  base: Record<string, unknown> | null,
  rules: string,
  columns: readonly string[],
): Record<string, unknown> {
  const raw = base?.params;
  const params: Record<string, string> = {};
  if (raw && typeof raw === 'object')
    for (const [k, v] of Object.entries(raw))
      if (typeof v === 'string' && k !== 'rules') params[k] = v;
  if (rules) params.rules = rules;
  return { v: 1, params, ...(columns.length > 0 ? { columns: [...columns] } : {}) };
}

/** True when the list no longer shows what the view saved: other filters, or other columns for a view that keeps columns. */
export function viewChanged(
  view: ContactViewResponse,
  filters: ContactFilters,
  columnIds: readonly string[],
  defaultLimit: PageSize = DEFAULT_FILTERS.limit,
): boolean {
  if (!sameFilters(filtersOfView(view.filter, defaultLimit), filters)) return true;
  const saved = viewColumnsOf(view.filter);
  return saved !== null && JSON.stringify(saved) !== JSON.stringify(columnIds);
}

/** The filters a saved view stands for, on page 1, keeping the person's own page size. */
export function filtersOfView(
  filter: Record<string, unknown>,
  defaultLimit: PageSize = DEFAULT_FILTERS.limit,
): ContactFilters {
  const raw = filter.params;
  const p = new URLSearchParams();
  if (raw && typeof raw === 'object')
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') p.set(k, v);
  return { ...parseFilters(p, defaultLimit), page: 1 };
}

/** Adds, replaces or removes `view=` on a `?a=b` search string. */
export function withView(search: string, viewId: string): string {
  const p = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (viewId) p.set(VIEW_PARAM, viewId);
  else p.delete(VIEW_PARAM);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** True while the list shows what the view saved (the dot on a tab says "changed" when this is false). */
export function sameFilters(a: ContactFilters, b: ContactFilters): boolean {
  return JSON.stringify(viewFilterOf(a)) === JSON.stringify(viewFilterOf(b));
}

export type ViewKind = 'all' | 'pinned' | 'shared';

/** The views a search box and the All / Pinned / Shared chips leave in the picker. */
export function pickerViews(
  views: readonly ContactViewResponse[],
  query: string,
  kind: ViewKind,
): ContactViewResponse[] {
  const q = query.trim().toLowerCase();
  return views.filter(
    (v) =>
      (!q || v.name.toLowerCase().includes(q)) &&
      (kind === 'all' || (kind === 'pinned' ? v.isFavorite : v.isShared)),
  );
}

/** Tabs in the bar: the pinned views by position, and the open view too when it is not pinned (so the open view always has a tab). */
export function tabViews(
  views: readonly ContactViewResponse[],
  activeId: string,
): ContactViewResponse[] {
  const byOrder = (a: ContactViewResponse, b: ContactViewResponse) =>
    a.position - b.position || a.name.localeCompare(b.name);
  const pinned = views.filter((v) => v.isFavorite).sort(byOrder);
  const open = views.find((v) => v.id === activeId);
  return open && !open.isFavorite ? [...pinned, open] : pinned;
}
