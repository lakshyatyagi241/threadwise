import {
  attributeListResponseSchema,
  attributePickerFeedSchema,
  attributeResponseSchema,
  bulkResultSchema,
  bulkSelectionResultSchema,
  contactGroupRefSchema,
  contactGroupResponseSchema,
  contactImportJobSchema,
  contactImportPreviewSchema,
  contactResponseSchema,
  contactStatsSchema,
  createContactGroupResponseSchema,
  dedupePreviewSchema,
  dedupeResultSchema,
  fieldResponseSchema,
  pageResponseSchema,
  statusOptionResponseSchema,
  tagResponseSchema,
  type AttributeResponse,
  type BulkSelectionResult,
  type ContactGroupRef,
  type ContactGroupResponse,
  type ContactImportJob,
  type ContactImportPreview,
  type ContactResponse,
  type ContactStats,
  type CreateContactGroupResponse,
  type DedupePreview,
  type DedupeResult,
  type TagResponse,
} from '@crm/contracts';
import { z } from 'zod';

/**
 * Everything the screens parse with comes from `@crm/contracts`; this file only gathers the names the feature uses
 * and adds the two envelopes the contracts leave to the caller (a contact page with `meta.total`, a tag with a count).
 */

export {
  attributeListResponseSchema,
  attributePickerFeedSchema,
  attributeResponseSchema,
  bulkResultSchema,
  bulkSelectionResultSchema,
  contactGroupRefSchema,
  contactGroupResponseSchema,
  contactImportJobSchema,
  contactImportPreviewSchema,
  contactResponseSchema,
  contactStatsSchema,
  createContactGroupResponseSchema,
  dedupePreviewSchema,
  dedupeResultSchema,
  fieldResponseSchema,
  statusOptionResponseSchema,
  tagResponseSchema,
};
export type {
  AttributeResponse,
  BulkSelectionResult,
  ContactGroupRef,
  ContactGroupResponse,
  ContactImportJob,
  ContactImportPreview,
  ContactResponse,
  ContactStats,
  CreateContactGroupResponse,
  DedupePreview,
  DedupeResult,
  TagResponse,
};

/** A contact row as the list, the detail page and the form handle it. */
export type ContactRow = ContactResponse;

/** `GET /contacts`: the cursor envelope, plus `meta.total` when the request asked for `includeTotal`. */
export const contactPageSchema = pageResponseSchema(contactResponseSchema).extend({
  /** `approximate`: the total of a segment's contacts could not be counted in time and is an estimate. */
  meta: z
    .object({ total: z.number().int().nonnegative(), approximate: z.boolean().optional() })
    .optional(),
  /** Only when the request filtered by a segment: its conditions that match nothing because something was deleted. */
  segment: z.object({ id: z.string(), invalidConditions: z.array(z.unknown()) }).optional(),
});

export type ContactPage = z.infer<typeof contactPageSchema>;

/** A contact's tags: the endpoint answers a plain array, not the cursor envelope. */
export const contactTagsSchema = z.array(tagResponseSchema);

/** A contact's groups: also a plain array, of the small reference shape. */
export const contactGroupsSchema = z.array(contactGroupRefSchema);

export const GROUP_COLORS = ['#7C3AED', '#22C55E', '#E87A5D', '#E5A04E', '#13478A'] as const;

export type RowTag = NonNullable<ContactResponse['tags']>[number];
export type ContactGroup = ContactGroupResponse;
