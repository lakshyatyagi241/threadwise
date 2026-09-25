import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { paginationQuerySchema } from '../common/pagination';

/** A meeting logged against a contact — the detail page's Meetings sub-tab. */
export const contactMeetingResponseSchema = z.object({
  id: uuidSchema,
  contactId: uuidSchema,
  title: z.string(),
  startsAt: z.string().datetime().nullable(),
  endsAt: z.string().datetime().nullable(),
  location: z.string().nullable(),
  createdBy: uuidSchema.nullable(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ContactMeetingResponse = z.infer<typeof contactMeetingResponseSchema>;

export const createContactMeetingSchema = z.object({
  title: z.string().min(1).max(255),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  location: z.string().max(255).optional(),
});
export type CreateContactMeetingInput = z.infer<typeof createContactMeetingSchema>;

export const updateContactMeetingSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  startsAt: z.string().datetime().nullish(),
  endsAt: z.string().datetime().nullish(),
  location: z.string().max(255).nullish(),
  rowVersion: z.number().int().positive(),
});
export type UpdateContactMeetingInput = z.infer<typeof updateContactMeetingSchema>;

export const listContactMeetingsQuerySchema = paginationQuerySchema;
export type ListContactMeetingsQuery = z.infer<typeof listContactMeetingsQuerySchema>;
