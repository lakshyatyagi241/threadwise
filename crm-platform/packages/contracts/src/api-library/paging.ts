import { z } from 'zod';
import { pageInfoSchema } from '../common/pagination';

/** The page sizes the screens offer. Any `limit` from 1 to 200 is accepted; these are the ones the UI shows. */
export const API_LIBRARY_PAGE_SIZES = [10, 25, 50, 100] as const;

/**
 * The list envelope of the API Library: `{ data, page }` as everywhere (cursor mode), and, when the request carried `page`, the totals of
 * numbered pages. `page` here is the existing page-info OBJECT, so the number of the page being shown is `page.page`; `total`,
 * `pageSize` and `totalPages` are in `page` and repeated at the top level for convenience. In cursor mode none of them is present.
 */
export const numberedPageInfoSchema = pageInfoSchema.extend({
  /** Rows matching the filters (every page). */
  total: z.number().int().min(0).optional(),
  /** The page returned (1-based). */
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).optional(),
  /** ceil(total / pageSize), at least 1. */
  totalPages: z.number().int().min(1).optional(),
});
export type NumberedPageInfo = z.infer<typeof numberedPageInfoSchema>;

export function numberedPageResponseSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    data: z.array(item),
    page: numberedPageInfoSchema,
    total: z.number().int().min(0).optional(),
    pageSize: z.number().int().min(1).optional(),
    totalPages: z.number().int().min(1).optional(),
  });
}
