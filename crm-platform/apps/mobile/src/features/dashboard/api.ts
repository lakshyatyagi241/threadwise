import {
  dashSummaryResponseSchema,
  dashThroughputResponseSchema,
  dashWidgetsSchema,
  entitlementsResponseSchema,
  walletSummarySchema,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api';
import type { Range } from './ranges';

/** Every dashboard call, parsed with the shared contracts (TW-DASH-002). */
export const fetchSummary = (range: Range, signal?: AbortSignal) =>
  apiFetch('/v2/dashboard/summary', {
    query: { range },
    schema: dashSummaryResponseSchema,
    signal,
  });

export const fetchThroughput = (range: Range, signal?: AbortSignal) =>
  apiFetch('/v2/dashboard/throughput', {
    query: { range },
    schema: dashThroughputResponseSchema,
    signal,
  });

export const fetchWidgets = (range: Range, signal?: AbortSignal) =>
  apiFetch('/v2/dashboard/widgets', { query: { range }, schema: dashWidgetsSchema, signal });

/** The wallet card (TW-DASH-007): only asked for by people who may see the balance. */
export const fetchWalletSummary = (signal?: AbortSignal) =>
  apiFetch('/v2/wallet/summary', { schema: walletSummarySchema, signal });

/** The plan's feature keys; one of them says whether the platform has the personal-number engine on (the Devices card). */
export const fetchEntitlements = (signal?: AbortSignal) =>
  apiFetch('/v2/billing/entitlements', { schema: entitlementsResponseSchema, signal });
