import type { FaqEntrySummary, FaqStatus } from '@crm/contracts';

export interface ListFilters {
  search: string;
  status: '' | FaqStatus;
  category: string;
  indexing: '' | 'pending' | 'failed';
}

export const EMPTY_FILTERS: ListFilters = { search: '', status: '', category: '', indexing: '' };

export const hasFilters = (f: ListFilters): boolean =>
  f.search.trim() !== '' || f.status !== '' || f.category !== '' || f.indexing !== '';

/** The query string of the list call: only what is set (the API client also drops empty values). */
export function toListQuery(f: ListFilters, searchOverride?: string) {
  const search = (searchOverride ?? f.search).trim();
  return {
    search: search === '' ? undefined : search,
    status: f.status === '' ? undefined : f.status,
    category: f.category === '' ? undefined : f.category,
    indexing: f.indexing === '' ? undefined : f.indexing,
  };
}

/** How many of a FAQ's variations are live, waiting, or gave up; widths are whole percents that add to 100. */
export function indexingShares(
  e: Pick<FaqEntrySummary, 'readyCount' | 'pendingCount' | 'failedCount'>,
) {
  const total = e.readyCount + e.pendingCount + e.failedCount;
  if (total === 0) return { total, ready: 0, pending: 0, failed: 0 };
  const ready = Math.round((e.readyCount / total) * 100);
  const failed = Math.round((e.failedCount / total) * 100);
  return { total, ready, failed, pending: Math.max(0, 100 - ready - failed) };
}

/** A flow FAQ whose flow was deleted can never answer. */
export const flowMissing = (e: Pick<FaqEntrySummary, 'answerType' | 'flowName'>): boolean =>
  e.answerType === 'flow' && e.flowName === null;

export type BulkAction = 'pause' | 'activate' | 'delete';

/** Bulk update needs `faq.entries.update`; delete needs `faq.entries.delete` as well (the controller checks both). */
export function bulkAllowed(can: {
  update: boolean;
  delete: boolean;
}): Record<BulkAction, boolean> {
  return { pause: can.update, activate: can.update, delete: can.update && can.delete };
}

/** Selection survives paging; ids that left the list (deleted, filtered out) are dropped. */
export function pruneSelection(
  selected: ReadonlySet<string>,
  visible: readonly { id: string }[],
): Set<string> {
  const ids = new Set(visible.map((v) => v.id));
  return new Set([...selected].filter((id) => ids.has(id)));
}

export function toggleAll(
  selected: ReadonlySet<string>,
  visible: readonly { id: string }[],
): Set<string> {
  const all = visible.length > 0 && visible.every((v) => selected.has(v.id));
  return all ? new Set() : new Set(visible.map((v) => v.id));
}
