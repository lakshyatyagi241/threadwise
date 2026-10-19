'use client';

import { useQuery } from '@tanstack/react-query';
import { callLogListSchema, contactMessageStatsSchema, taskPageResponseSchema } from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { callSearchTerm, callsOfContact, dayBefore } from '../lib/contact-data';

/** How far back the calls of a contact are looked for (the call log refuses a custom range wider than 366 days). */
export const CALL_LOOKBACK_DAYS = 365;
const CALL_PAGE_SIZE = 100;
const TASK_LIMIT = 100;

export const contactCallsKey = (contact: {
  id: string;
  phone: string | null;
  name: string | null;
}) => ['cat', 'contact-calls', contact.id, callSearchTerm(contact)] as const;
export const contactMessageStatsKey = (contactId: string) =>
  ['cat', 'contact-message-stats', contactId] as const;
export const contactOpenTasksKey = (contactId: string) =>
  ['cat', 'contact-open-tasks', contactId] as const;

/**
 * The calls of one contact.
 *
 * LIMIT OF THE API: `GET /calling/call-logs` has no contact filter. This asks for the last year with `q` = the contact's phone
 * digits (else the name) and keeps only rows whose `contactId` is this contact. It reads one page of `CALL_PAGE_SIZE` rows;
 * `partial` is true when the search matched more than that, so the figures may be short. The log's own `kpis` are for the
 * whole search and are not used. A plan without calling (or a role without `call.logs.read`) answers 402/403/422: the caller
 * hides the call tiles then.
 */
export function useContactCalls(
  contact: { id: string; phone: string | null; name: string | null },
  enabled: boolean,
) {
  const term = callSearchTerm(contact);
  const q = useQuery({
    queryKey: contactCallsKey(contact),
    enabled: enabled && term !== null,
    retry: false,
    queryFn: async ({ signal }) => {
      const res = await apiFetch('/calling/call-logs', {
        query: {
          q: term ?? undefined,
          from: dayBefore(new Date(), CALL_LOOKBACK_DAYS),
          pageSize: CALL_PAGE_SIZE,
          page: 1,
        },
        schema: callLogListSchema,
        signal,
      });
      return { rows: callsOfContact(res.rows, contact.id), partial: res.total > res.rows.length };
    },
  });
  return {
    rows: q.data?.rows ?? [],
    partial: q.data?.partial ?? false,
    isPending: enabled && term !== null && q.isPending,
    isError: q.isError,
    error: q.error,
    isSuccess: q.isSuccess,
  };
}

/**
 * How many open tasks a contact has (`GET /contacts/:id/tasks?status=open`). Reads one page of `TASK_LIMIT`; `more` is true
 * when there are further pages, so the tile reads "100+". Needs `record.tasks.read` and the sales-pipeline plan (tasks sit
 * behind the same plan gate as deals).
 */
export function useContactOpenTaskCount(contactId: string, enabled: boolean) {
  const q = useQuery({
    queryKey: contactOpenTasksKey(contactId),
    enabled,
    retry: false,
    queryFn: async ({ signal }) => {
      const res = await apiFetch(`/contacts/${contactId}/tasks`, {
        query: { status: 'open', limit: TASK_LIMIT },
        schema: taskPageResponseSchema,
        signal,
      });
      return { count: res.data.length, more: res.page.hasMore };
    },
  });
  return {
    count: q.data?.count ?? 0,
    more: q.data?.more ?? false,
    isPending: enabled && q.isPending,
    isError: q.isError,
    error: q.error,
    isSuccess: q.isSuccess,
  };
}

/**
 * The WhatsApp summary of one contact (`GET /contacts/:id/message-stats/whatsapp`): sent, delivered, seen, received, failed and
 * replied, counted by the API from the contact's WhatsApp conversations. Needs `inbox.conversation.read`; a refusal or an error just
 * leaves the card out.
 */
export function useContactMessageStats(contactId: string, enabled: boolean) {
  const q = useQuery({
    queryKey: contactMessageStatsKey(contactId),
    enabled,
    retry: false,
    queryFn: ({ signal }) =>
      apiFetch(`/contacts/${contactId}/message-stats/whatsapp`, {
        schema: contactMessageStatsSchema,
        signal,
      }),
    staleTime: 30_000,
  });
  return {
    stats: q.data ?? null,
    isPending: enabled && q.isPending,
    isSuccess: q.isSuccess,
    isError: q.isError,
  };
}
