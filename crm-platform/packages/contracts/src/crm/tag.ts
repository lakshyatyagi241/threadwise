import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { paginationQuerySchema } from '../common/pagination';
import { queryBoolean } from '../contacts-attributes-tags/query-helpers';

/** `tags.name` is unique per org ignoring case; WaDesk validated 80 against a 64 character column. */
export const TAG_NAME_MAX = 64;

/** Tags — a flat, org-wide taxonomy attached to contacts (and later companies). */

export const tagResponseSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  color: z.string().nullable(),
  /** Only when the list was asked for `includeCounts`. */
  contactCount: z.number().int().optional(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TagResponse = z.infer<typeof tagResponseSchema>;

export const createTagSchema = z.object({
  name: z.string().trim().min(1).max(TAG_NAME_MAX),
  color: z.string().max(32).optional(),
});
export type CreateTagInput = z.infer<typeof createTagSchema>;

export const updateTagSchema = z.object({
  name: z.string().trim().min(1).max(TAG_NAME_MAX).optional(),
  color: z.string().max(32).nullish(),
  rowVersion: z.number().int().positive(),
});
export type UpdateTagInput = z.infer<typeof updateTagSchema>;

export const listTagsQuerySchema = paginationQuerySchema.extend({
  q: z.string().min(1).max(100).optional(),
  /** Adds `contactCount` to each tag (the bulk tag picker shows "Name (count)"). */
  includeCounts: queryBoolean().default(false),
});
export type ListTagsQuery = z.infer<typeof listTagsQuerySchema>;

/** Attach/detach — a contact can carry many tags, a tag can be on many contacts. */
export const setContactTagsSchema = z.object({
  contactIds: z.array(uuidSchema).min(1),
  tagIds: z.array(uuidSchema).min(1),
});
export type SetContactTagsInput = z.infer<typeof setContactTagsSchema>;

/**
 * Tag one contact by id or by name. A name that matches no tag creates it: the
 * caller then needs the tag-create permission and the plan's tag limit applies, the
 * same rules as POST /tags (WaDesk skipped both on this path).
 */
export const attachContactTagSchema = z
  .object({
    tagId: uuidSchema.optional(),
    name: z.string().trim().min(1).max(TAG_NAME_MAX).optional(),
  })
  .refine((v) => v.tagId || v.name, { message: 'send a tagId or a name', path: ['tagId'] });
export type AttachContactTagInput = z.infer<typeof attachContactTagSchema>;
