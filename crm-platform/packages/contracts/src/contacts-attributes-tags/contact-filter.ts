import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { queryBoolean, queryList } from './query-helpers';

/**
 * The contact list filter (WD-CON-002..006), as ONE shape used by three
 * callers: the list query string, the saved-filter half of a bulk selection
 * ("select all matching"), and the export. Sharing it is what guarantees that
 * "select all 40 matching this filter" processes exactly the 40 rows the
 * screen showed. WaDesk implemented the filter three times and the bulk bar
 * only honoured it for two of the six actions.
 */
export const contactFilterShape = {
  /**
   * Free text. Split on whitespace; every word must match the name, email or
   * the digits of the phone ("Sharma Aarav" finds "Aarav Sharma", "9812"
   * finds "+91 98123 45678").
   */
  q: z.string().trim().min(1).max(200).optional(),
  ownerId: uuidSchema.optional(),
  lifecycleStage: z.string().optional(),
  includeArchived: queryBoolean().default(false),
  /** Members of one group. */
  groupId: uuidSchema.optional(),
  /** Contacts in no group at all. */
  noGroup: queryBoolean().optional(),
  /** `a,b` in a query string or an array. */
  tagIds: queryList(uuidSchema).optional(),
  /** `any`: carries at least one of tagIds. `all`: carries every one. */
  tagMode: z.enum(['any', 'all']).default('any'),
  /** Created by a CSV import (WaDesk's "Imported" quick filter, which never matched anything). */
  imported: queryBoolean().optional(),
  /** true: opted out. false: subscribed. */
  unsubscribed: queryBoolean().optional(),
  source: z.string().max(128).optional(),
  status: z.string().max(64).optional(),
} as const;

export const contactFilterSchema = z
  .object(contactFilterShape)
  .refine((v) => !(v.groupId && v.noGroup), {
    message: 'groupId and noGroup cannot be combined',
    path: ['noGroup'],
  });
export type ContactFilter = z.infer<typeof contactFilterSchema>;

/** Largest explicit id list a single bulk request carries. A filter has no such cap. */
export const BULK_IDS_MAX = 5000;
/** Largest number of contacts one filter-based bulk request will change. */
export const BULK_FILTER_MAX = 50_000;
/** Largest number of rows one export call returns. */
export const EXPORT_MAX_ROWS = 200_000;

/**
 * Which contacts a bulk action applies to: explicit `ids`, OR every contact
 * matching `filter` (minus `excludeIds`, the rows the user un-ticked after
 * choosing "select all matching"). Exactly one of the two.
 */
export const contactSelectionShape = {
  ids: z.array(uuidSchema).min(1).max(BULK_IDS_MAX).optional(),
  filter: z.object(contactFilterShape).optional(),
  excludeIds: z.array(uuidSchema).max(BULK_IDS_MAX).optional(),
} as const;

export const hasExactlyOneSelector = (v: { ids?: unknown; filter?: unknown }): boolean =>
  (v.ids !== undefined) !== (v.filter !== undefined);

export const SELECTION_REFINEMENT: { message: string; path: string[] } = {
  message: 'send either ids or filter, not both and not neither',
  path: ['ids'],
};

export const contactSelectionSchema = z
  .object(contactSelectionShape)
  .refine(hasExactlyOneSelector, SELECTION_REFINEMENT);
export type ContactSelection = z.infer<typeof contactSelectionSchema>;
