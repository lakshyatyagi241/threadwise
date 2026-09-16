import { z } from 'zod';

/**
 * Keyset (cursor) pagination, everywhere. OFFSET is banned: on a 10M+ row
 * partitioned table `OFFSET 100000` makes Postgres walk and discard 100k rows
 * on every page, and pages shift under concurrent inserts.
 *
 * The cursor encodes the sort tuple (created_at, id) — always a unique,
 * monotonic pair, so it is a stable resume point.
 */
export const cursorSchema = z.string().min(1).max(512);

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: cursorSchema.optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const pageInfoSchema = z.object({
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
  limit: z.number().int(),
});
export type PageInfo = z.infer<typeof pageInfoSchema>;

/** Standard list envelope: `{ data: [...], page: {...} }`. */
export function pageResponseSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({ data: z.array(item), page: pageInfoSchema });
}

export type PageResponse<T> = { data: T[]; page: PageInfo };
