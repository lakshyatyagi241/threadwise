import {
  contactActivityResponseSchema,
  pageResponseSchema,
  type CreateContactActivityInput,
} from '@crm/contracts';
import type { z } from 'zod';
import { apiFetch } from '@/lib/api';

export const contactActivityPageSchema = pageResponseSchema(contactActivityResponseSchema);
export type ContactActivityPage = z.infer<typeof contactActivityPageSchema>;

/** The paging the API takes (`listContactActivitiesQuerySchema`); newest first is its default order. */
export type ActivityPageParams = { limit: number; cursor?: string };

const activitiesPath = (contactId: string) =>
  `/v2/contacts/${encodeURIComponent(contactId)}/activities`;

/** One page of a contact's timeline, newest first. */
export const listContactActivities = (
  contactId: string,
  params: ActivityPageParams,
  signal?: AbortSignal,
) =>
  apiFetch(activitiesPath(contactId), {
    query: params,
    schema: contactActivityPageSchema,
    signal,
  });

/** Logs a manual entry on the timeline (the API marks its source as `user`). */
export const createContactActivity = (
  contactId: string,
  body: CreateContactActivityInput,
  idempotencyKey?: string,
) =>
  apiFetch(activitiesPath(contactId), {
    method: 'POST',
    body,
    schema: contactActivityResponseSchema,
    idempotencyKey,
  });
