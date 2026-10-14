import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { queryBoolean } from './query-helpers';
import {
  contactSelectionShape,
  hasExactlyOneSelector,
  SELECTION_REFINEMENT,
} from './contact-filter';

/**
 * Bulk actions (TW-CON-019..025). Every one of them takes a selection (ids OR
 * "everything matching this filter") and reports what happened per contact, so
 * the bar's "T selected" is true for Export, Tag, Untag and Delete as well as
 * for the group actions.
 */
const withSelection = <S extends z.ZodRawShape>(extra: S) =>
  z
    .object({ ...contactSelectionShape, ...extra })
    .refine(hasExactlyOneSelector, SELECTION_REFINEMENT);

/**
 * `succeeded` and `failed` are the same shape the older bulk endpoints return, so
 * existing clients keep working. A filter-based request would otherwise answer
 * with a hundred thousand uuids: there `succeeded` stays empty and the counts
 * carry the outcome.
 */
export const bulkSelectionResultSchema = z.object({
  /** Contacts the selection resolved to (in the caller's record scope). */
  matched: z.number().int(),
  /** Contacts actually changed: not already in the group, already tagged, ... */
  changed: z.number().int(),
  succeeded: z.array(uuidSchema),
  failed: z.array(z.object({ id: uuidSchema, code: z.string(), message: z.string() })),
  /** failed.length is capped; this is the real count. */
  failedCount: z.number().int(),
});
export type BulkSelectionResult = z.infer<typeof bulkSelectionResultSchema>;

/**
 * `eraseHistory` (BL-143): true (the default when absent) removes the contacts' conversations, messages, media, files and call
 * recordings together with them; false keeps the conversations and call logs without the people's identity (the contact link, name and
 * number are cleared, media is removed). Leads, deals, tasks and financial records stay as business records either way.
 */
export const bulkDeleteContactsSchema = withSelection({ eraseHistory: z.boolean().optional() });
export type BulkDeleteContactsInput = z.infer<typeof bulkDeleteContactsSchema>;

/** `DELETE /contacts/:id?eraseHistory=false`: see `bulkDeleteContactsSchema`. Absent means true. */
export const deleteContactQuerySchema = z.object({ eraseHistory: queryBoolean().optional() });
export type DeleteContactQuery = z.infer<typeof deleteContactQuerySchema>;

export const bulkGroupContactsSchema = withSelection({
  groupId: uuidSchema,
  action: z.enum(['add', 'remove']),
});
export type BulkGroupContactsInput = z.infer<typeof bulkGroupContactsSchema>;

/** Hands the selection to one person, or to nobody with `ownerId: null` (the "Reassign" of an owner's whole book). */
export const bulkOwnerContactsSchema = withSelection({
  ownerId: uuidSchema.nullable(),
});
export type BulkOwnerContactsInput = z.infer<typeof bulkOwnerContactsSchema>;

/**
 * Tag by id or by name. A name that matches no tag creates one, for `add` only
 * (needs the tag-create permission and counts against the plan's tag limit);
 * `remove` never creates anything.
 */
export const bulkTagContactsSchema = withSelection({
  action: z.enum(['add', 'remove']),
  tagId: uuidSchema.optional(),
  name: z.string().trim().min(1).max(64).optional(),
});
export type BulkTagContactsInput = z.infer<typeof bulkTagContactsSchema>;

export const exportContactsSchema = withSelection({
  /** UTF-8 byte-order mark, so spreadsheets decode non-ASCII names. */
  bom: queryBoolean().default(true),
});
export type ExportContactsInput = z.infer<typeof exportContactsSchema>;

/** The tiles and sidebar badges: workspace-wide, they ignore the active filter. */
export const contactStatsSchema = z.object({
  total: z.number().int(),
  groups: z.number().int(),
  subscribed: z.number().int(),
  unsubscribed: z.number().int(),
  noGroup: z.number().int(),
  /** Contacts in at least one group. */
  grouped: z.number().int(),
  imported: z.number().int(),
});
export type ContactStats = z.infer<typeof contactStatsSchema>;

// --- dedupe (TW-CON-025) -------------------------------------------------------------

export const dedupeSetSchema = z.object({
  /** The shared canonical number, "+919812345678". */
  phone: z.string(),
  /** The oldest contact: the one that stays and absorbs the others. */
  survivorId: uuidSchema,
  duplicateIds: z.array(uuidSchema),
});
export type DedupeSet = z.infer<typeof dedupeSetSchema>;

export const dedupePreviewSchema = z.object({
  totalSets: z.number().int(),
  totalDuplicates: z.number().int(),
  /** The first sets, for the confirmation screen. */
  sets: z.array(dedupeSetSchema),
});
export type DedupePreview = z.infer<typeof dedupePreviewSchema>;

export const dedupeContactsSchema = z.object({
  /** Bounds one call; the answer says how many sets are left. */
  maxSets: z.number().int().min(1).max(5000).default(1000),
});
export type DedupeContactsInput = z.infer<typeof dedupeContactsSchema>;

export const dedupeResultSchema = z.object({
  /** Duplicate sets merged in this call. */
  mergedSets: z.number().int(),
  /** Contacts that were folded into a survivor and removed. */
  removed: z.number().int(),
  /** Sets still waiting (call again). */
  remainingSets: z.number().int(),
});
export type DedupeResult = z.infer<typeof dedupeResultSchema>;
