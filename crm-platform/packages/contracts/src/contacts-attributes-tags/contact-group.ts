import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { paginationQuerySchema } from '../common/pagination';

/**
 * Contact groups (TW-CON-033..037): named lists a contact can belong to. The
 * membership is a join table, not Reference's encrypted JSON array on the contact,
 * so counts, filters and audience expansion are SQL.
 */
export const GROUP_NAME_MAX = 191;
export const GROUP_NOTE_MAX = 500;

/** `#RRGGBB`. Reference accepted any 32 character string. */
export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'colour must be a hex value like #7C3AED');

export const contactGroupResponseSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  note: z.string().nullable(),
  color: z.string().nullable(),
  /** Contacts in the group, workspace-wide; filters do not change it. */
  memberCount: z.number().int(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ContactGroupResponse = z.infer<typeof contactGroupResponseSchema>;

/** A group as it appears on a contact. */
export const contactGroupRefSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  color: z.string().nullable(),
});
export type ContactGroupRef = z.infer<typeof contactGroupRefSchema>;

export const createContactGroupSchema = z.object({
  name: z.string().trim().min(1).max(GROUP_NAME_MAX),
  note: z.string().trim().max(GROUP_NOTE_MAX).nullish(),
  color: hexColorSchema.nullish(),
});
export type CreateContactGroupInput = z.infer<typeof createContactGroupSchema>;

/**
 * `existing` is true when the name matched a group already there (compared
 * case-insensitively): that group comes back untouched, with 200 instead of
 * 201, which is how a double-clicked Save stays harmless.
 */
export const createContactGroupResponseSchema = contactGroupResponseSchema.extend({
  existing: z.boolean(),
});
export type CreateContactGroupResponse = z.infer<typeof createContactGroupResponseSchema>;

/**
 * Absent keeps, null clears. (Reference wiped the note whenever the request did not
 * mention it.)
 */
export const updateContactGroupSchema = z.object({
  name: z.string().trim().min(1).max(GROUP_NAME_MAX).optional(),
  note: z.string().trim().max(GROUP_NOTE_MAX).nullish(),
  color: hexColorSchema.nullish(),
  rowVersion: z.number().int().positive(),
});
export type UpdateContactGroupInput = z.infer<typeof updateContactGroupSchema>;

export const listContactGroupsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(100).optional(),
});
export type ListContactGroupsQuery = z.infer<typeof listContactGroupsQuerySchema>;

/** Replace one contact's whole set of groups (an explicit array, so the last group can be removed). */
export const setContactGroupsSchema = z.object({
  groupIds: z.array(uuidSchema).max(200),
});
export type SetContactGroupsInput = z.infer<typeof setContactGroupsSchema>;
