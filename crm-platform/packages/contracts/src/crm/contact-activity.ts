import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { paginationQuerySchema } from '../common/pagination';

/** Append-only timeline entry — the detail page's Activity Timeline sub-tab. */
export const activitySourceSchema = z.enum(['system', 'user', 'bot']);
export type ActivitySource = z.infer<typeof activitySourceSchema>;

export const contactActivityResponseSchema = z.object({
  id: uuidSchema,
  contactId: uuidSchema,
  activityType: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  source: activitySourceSchema,
  actorId: uuidSchema.nullable(),
  occurredAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});
export type ContactActivityResponse = z.infer<typeof contactActivityResponseSchema>;

/** Manual entries only — 'source' is always 'user' here; system/bot entries are internal-only. */
export const createContactActivitySchema = z.object({
  activityType: z.string().min(1).max(100),
  title: z.string().min(1).max(255),
  body: z.string().max(10_000).optional(),
  occurredAt: z.string().datetime().optional(),
});
export type CreateContactActivityInput = z.infer<typeof createContactActivitySchema>;

export const listContactActivitiesQuerySchema = paginationQuerySchema;
export type ListContactActivitiesQuery = z.infer<typeof listContactActivitiesQuerySchema>;
