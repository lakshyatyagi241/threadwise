import type { PageInfo, V1PageMeta } from '@crm/contracts';

/** `{ data }` with an optional `meta`, WaDesk's success envelope. `meta` is left out when there is nothing to say. */
export function ok<T>(
  data: T,
  meta?: Record<string, unknown>,
): { data: T; meta?: Record<string, unknown> } {
  return meta && Object.keys(meta).length > 0 ? { data, meta } : { data };
}

/** The platform's page info in WaDesk's snake_case `meta`. */
export function pageMeta(page: PageInfo): V1PageMeta {
  return { limit: page.limit, next_cursor: page.nextCursor, has_more: page.hasMore };
}

/** A list that is not paged (groups, webhooks): WaDesk's `meta.count`. */
export function countMeta(count: number): { count: number } {
  return { count };
}
