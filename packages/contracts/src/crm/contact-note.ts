import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { paginationQuerySchema } from '../common/pagination';

/** A note logged against a contact — the detail page's Notes tab. */
export const contactNoteResponseSchema = z.object({
  id: uuidSchema,
  contactId: uuidSchema,
  body: z.string(),
  createdBy: uuidSchema.nullable(),
  updatedBy: uuidSchema.nullable(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ContactNoteResponse = z.infer<typeof contactNoteResponseSchema>;

export const createContactNoteSchema = z.object({
  body: z.string().min(1).max(10_000),
});
export type CreateContactNoteInput = z.infer<typeof createContactNoteSchema>;

export const updateContactNoteSchema = z.object({
  body: z.string().min(1).max(10_000),
  rowVersion: z.number().int().positive(),
});
export type UpdateContactNoteInput = z.infer<typeof updateContactNoteSchema>;

export const listContactNotesQuerySchema = paginationQuerySchema;
export type ListContactNotesQuery = z.infer<typeof listContactNotesQuerySchema>;
