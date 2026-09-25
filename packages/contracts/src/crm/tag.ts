import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { paginationQuerySchema } from '../common/pagination';

/** Tags — a flat, org-wide taxonomy attached to contacts (and later companies). */

export const tagResponseSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  color: z.string().nullable(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TagResponse = z.infer<typeof tagResponseSchema>;

export const createTagSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().max(32).optional(),
});
export type CreateTagInput = z.infer<typeof createTagSchema>;

export const updateTagSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().max(32).nullish(),
  rowVersion: z.number().int().positive(),
});
export type UpdateTagInput = z.infer<typeof updateTagSchema>;

export const listTagsQuerySchema = paginationQuerySchema.extend({
  q: z.string().min(1).max(100).optional(),
});
export type ListTagsQuery = z.infer<typeof listTagsQuerySchema>;

/** Attach/detach — a contact can carry many tags, a tag can be on many contacts. */
export const setContactTagsSchema = z.object({
  contactIds: z.array(uuidSchema).min(1),
  tagIds: z.array(uuidSchema).min(1),
});
export type SetContactTagsInput = z.infer<typeof setContactTagsSchema>;
