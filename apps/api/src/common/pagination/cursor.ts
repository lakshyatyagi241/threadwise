import { ERROR_CODES, type PageInfo } from '@crm/contracts';
import { AppError } from '../errors/app-error';

/**
 * Keyset cursor over the (created_at, id) tuple.
 *
 * `id` is the tiebreaker: two rows can share a timestamp, and without it a
 * page boundary that lands mid-tie silently drops or repeats rows.
 *
 * The cursor is opaque base64url — not encrypted and not authenticated. It
 * leaks nothing but a timestamp and an internal id, and it is only ever used
 * as a WHERE bound, never as an authorisation input.
 */
export interface Cursor {
  createdAt: Date;
  id: number;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}|${cursor.id}`, 'utf8').toString(
    'base64url',
  );
}

export function decodeCursor(raw: string): Cursor {
  try {
    const [iso, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
    if (!iso || !id) throw new Error('malformed');
    const createdAt = new Date(iso);
    const parsedId = Number.parseInt(id, 10);
    if (Number.isNaN(createdAt.getTime()) || Number.isNaN(parsedId)) throw new Error('malformed');
    return { createdAt, id: parsedId };
  } catch {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid pagination cursor', 400);
  }
}

/**
 * Turns `limit + 1` rows into a page.
 *
 * Fetching one extra row is how `hasMore` is answered without a COUNT — and a
 * COUNT over a partitioned table is exactly the query that turns a 20ms list
 * endpoint into a 2s one.
 */
export function buildPage<T extends { createdAt: Date; id: number }>(
  rows: T[],
  limit: number,
): { items: T[]; page: PageInfo } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];

  return {
    items,
    page: {
      nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
      hasMore,
      limit,
    },
  };
}
