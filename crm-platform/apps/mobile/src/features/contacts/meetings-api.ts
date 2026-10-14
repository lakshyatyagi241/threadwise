import { contactMeetingResponseSchema, pageResponseSchema } from '@crm/contracts';
import type { z } from 'zod';
import { apiFetch } from '@/lib/api';

export const contactMeetingPageSchema = pageResponseSchema(contactMeetingResponseSchema);
export type ContactMeetingPage = z.infer<typeof contactMeetingPageSchema>;

/** The paging the API takes (`listContactMeetingsQuerySchema`); newest first is its default order. */
export type MeetingPageParams = { limit: number; cursor?: string };

const meetingsPath = (contactId: string) =>
  `/v2/contacts/${encodeURIComponent(contactId)}/meetings`;

/** One page of a contact's logged meetings, newest first. */
export const listContactMeetings = (
  contactId: string,
  params: MeetingPageParams,
  signal?: AbortSignal,
) => apiFetch(meetingsPath(contactId), { query: params, schema: contactMeetingPageSchema, signal });
