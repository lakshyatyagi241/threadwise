import {
  dashSummaryResponseSchema,
  inboxCountsSchema,
  taskCountsResponseSchema,
  dashThroughputResponseSchema,
  dashWidgetsSchema,
  entitlementsResponseSchema,
  walletSummarySchema,
} from '@crm/contracts';
import { z } from 'zod';
import { apiFetch } from '@/lib/api';
import { windowQuery, type DashWindow } from './ranges';

/** Every dashboard call, parsed with the shared contracts (TW-DASH-002). */
export const fetchSummary = (win: DashWindow, signal?: AbortSignal) =>
  apiFetch('/v2/dashboard/summary', {
    query: windowQuery(win),
    schema: dashSummaryResponseSchema,
    signal,
  });

export const fetchThroughput = (win: DashWindow, signal?: AbortSignal) =>
  apiFetch('/v2/dashboard/throughput', {
    query: windowQuery(win),
    schema: dashThroughputResponseSchema,
    signal,
  });

export const fetchWidgets = (win: DashWindow, signal?: AbortSignal) =>
  apiFetch('/v2/dashboard/widgets', {
    query: windowQuery(win),
    schema: dashWidgetsSchema,
    signal,
  });

/** The wallet card (TW-DASH-007): only asked for by people who may see the balance. */
export const fetchWalletSummary = (signal?: AbortSignal) =>
  apiFetch('/v2/wallet/summary', { schema: walletSummarySchema, signal });

/** The plan's feature keys; one of them says whether the platform has the personal-number engine on (the Devices card). */
export const fetchEntitlements = (signal?: AbortSignal) =>
  apiFetch('/v2/billing/entitlements', { schema: entitlementsResponseSchema, signal });

/**
 * How many contacts were created in the window: a one-row page of the contact list with its total asked for. The two days are
 * read as UTC calendar days by the contact list (the dashboard's other numbers use the workspace's zone, so a contact made in the
 * hours around midnight can fall on the neighbouring day here).
 */
const contactTotalSchema = z.object({
  data: z.array(z.unknown()),
  meta: z.object({ total: z.number() }).optional(),
});
export const fetchNewContacts = async (win: DashWindow, signal?: AbortSignal): Promise<number> => {
  const page = await apiFetch('/v2/contacts', {
    query: { createdFrom: win.from, createdTo: win.to, includeTotal: true, limit: 1 },
    schema: contactTotalSchema,
    signal,
  });
  return page.meta?.total ?? page.data.length;
};

/** Open and done tasks right now (a snapshot: the API does not count tasks by date). Plan-gated, like every task route. */
export const fetchTaskCounts = (signal?: AbortSignal) =>
  apiFetch('/v2/tasks/counts', { schema: taskCountsResponseSchema, signal });

/** The live inbox counts (all, mine, unassigned, unread, archived): no dates, the API counts what is open now. */
export const fetchInboxCounts = (signal?: AbortSignal) =>
  apiFetch('/v2/inbox/counts', { schema: inboxCountsSchema, signal });
