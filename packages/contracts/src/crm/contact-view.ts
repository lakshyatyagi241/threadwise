import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { paginationQuerySchema } from '../common/pagination';

/**
 * Saved contact list views ("All Contacts", "My Contacts", custom...).
 *
 * `filter` is an AND/OR condition tree over contacts columns and Tier-2
 * fields — like `customFields` on Contact, its shape depends on the org's
 * field definitions, so it stays a validated-at-runtime record here rather
 * than a typed union of every possible condition.
 */
export const contactViewResponseSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  filter: z.record(z.unknown()),
  position: z.number().int(),
  isShared: z.boolean(),
  createdBy: uuidSchema.nullable(),
  /** Whether the calling user has favorited this view. */
  isFavorite: z.boolean(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ContactViewResponse = z.infer<typeof contactViewResponseSchema>;

export const createContactViewSchema = z.object({
  name: z.string().min(1).max(255),
  filter: z.record(z.unknown()).default({}),
  isShared: z.boolean().default(false),
  position: z.number().int().optional(),
});
export type CreateContactViewInput = z.infer<typeof createContactViewSchema>;

export const updateContactViewSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  filter: z.record(z.unknown()).optional(),
  isShared: z.boolean().optional(),
  rowVersion: z.number().int().positive(),
});
export type UpdateContactViewInput = z.infer<typeof updateContactViewSchema>;

export const listContactViewsQuerySchema = paginationQuerySchema;
export type ListContactViewsQuery = z.infer<typeof listContactViewsQuerySchema>;

export const reorderContactViewsSchema = z.object({
  orderedIds: z.array(uuidSchema).min(1),
});
export type ReorderContactViewsInput = z.infer<typeof reorderContactViewsSchema>;
