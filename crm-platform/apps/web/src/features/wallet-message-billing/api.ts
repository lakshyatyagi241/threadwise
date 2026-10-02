import {
  adjustWalletResultSchema,
  deleteRateResultSchema,
  importRatesResultSchema,
  messagePricingSchema,
  platformWalletDetailSchema,
  platformWalletListSchema,
  platformWalletOverviewSchema,
  ratesResponseSchema,
  reconciliationSchema,
  saveRatesResultSchema,
  seedRatesResultSchema,
  statementResponseSchema,
  syncMetaResultSchema,
  walletLedgerResponseSchema,
  walletLogListSchema,
  walletSettingsSchema,
  walletSummarySchema,
  type AdjustWalletInput,
  type UpdateSwitchesInput,
  type UpdateWalletSettingsInput,
  type UpsertRateInput,
  type WalletLogQuery,
} from '@crm/contracts';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { apiFetch } from '@/lib/api/client';
import { toApiError } from '@/lib/api/errors';
import { fileNameFromDisposition } from './lib/download';
import { toApiQuery, type StatementFilters } from './lib/statement-filters';

export const KEYS = {
  summary: ['wallet', 'summary'] as const,
  ledger: (cursor: string | undefined) => ['wallet', 'ledger', cursor ?? 'first'] as const,
  statement: (filters: StatementFilters, cursor: string | undefined) =>
    ['wallet', 'statement', filters, cursor ?? 'first'] as const,
  pricing: (country: string | undefined) => ['wallet', 'pricing', country ?? 'any'] as const,
  overview: ['wallet', 'platform', 'overview'] as const,
  settings: ['wallet', 'platform', 'settings'] as const,
  rates: ['wallet', 'platform', 'rates'] as const,
  workspaces: ['wallet', 'platform', 'workspaces'] as const,
  workspace: (id: string) => ['wallet', 'platform', 'workspace', id] as const,
  logs: ['wallet', 'platform', 'logs'] as const,
};

/** The workspace's own wallet (`/api/v2/wallet/*`). Each call is permission-gated by the API. */
export const customerApi = {
  summary: (signal?: AbortSignal) =>
    apiFetch('/wallet/summary', { schema: walletSummarySchema, signal }),
  ledger: (cursor: string | undefined, limit: number, signal?: AbortSignal) =>
    apiFetch('/wallet/ledger', { query: { limit, cursor }, schema: walletLedgerResponseSchema, signal }),
  statement: (
    filters: StatementFilters,
    cursor: string | undefined,
    limit: number,
    signal?: AbortSignal,
  ) =>
    apiFetch('/wallet/statement', {
      query: { ...toApiQuery(filters), limit, cursor },
      schema: statementResponseSchema,
      signal,
    }),
  pricing: (country: string | undefined, signal?: AbortSignal) =>
    apiFetch('/wallet/pricing', { query: { country }, schema: messagePricingSchema, signal }),
};

/**
 * The statement as CSV. It needs the session, so it is fetched (a bare link would carry no auth header) and the body is
 * handed to the browser as a file. The same filters as the page are sent.
 */
export async function downloadStatementCsv(
  filters: StatementFilters,
  today = new Date(),
): Promise<{ blob: Blob; fileName: string }> {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(toApiQuery(filters))) if (v) p.set(k, v);
  const qs = p.toString();
  const res = await fetch(`/api/v2/wallet/statement.csv${qs ? `?${qs}` : ''}`, {
    headers: { Accept: 'text/csv', 'X-Request-Id': crypto.randomUUID() },
    credentials: 'same-origin',
  });
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    throw toApiError(res.status, body, res.headers.get('x-request-id'));
  }
  return {
    blob: await res.blob(),
    fileName: fileNameFromDisposition(
      res.headers.get('content-disposition'),
      `wallet-statement-${today.toISOString().slice(0, 10)}.csv`,
    ),
  };
}

/** The operator console's calls (`/api/platform/*` becomes `/v2/platform/*`; the browser never sees a token). */
export const operatorApi = {
  overview: (signal?: AbortSignal) =>
    operatorFetch('/wallet/overview', { schema: platformWalletOverviewSchema, signal }),
  settings: (signal?: AbortSignal) =>
    operatorFetch('/wallet/settings', { schema: walletSettingsSchema, signal }),
  saveSettings: (body: UpdateWalletSettingsInput) =>
    operatorFetch('/wallet/settings', { method: 'PUT', body, schema: walletSettingsSchema }),
  saveSwitches: (body: UpdateSwitchesInput) =>
    operatorFetch('/wallet/switches', { method: 'PUT', body, schema: walletSettingsSchema }),
  rates: (signal?: AbortSignal) =>
    operatorFetch('/wallet/rates', { schema: ratesResponseSchema, signal }),
  saveRates: (rows: UpsertRateInput[]) =>
    operatorFetch('/wallet/rates', {
      method: 'PUT',
      body: { rows },
      schema: saveRatesResultSchema,
    }),
  deleteRate: (id: string) =>
    operatorFetch(`/wallet/rates/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      schema: deleteRateResultSchema,
    }),
  seedRates: () =>
    operatorFetch('/wallet/rates/seed', { method: 'POST', schema: seedRatesResultSchema }),
  importRates: (csv: string, dryRun: boolean) =>
    operatorFetch('/wallet/rates/import', {
      method: 'POST',
      body: { csv, dryRun },
      schema: importRatesResultSchema,
    }),
  syncMeta: (dryRun: boolean) =>
    operatorFetch('/wallet/rates/sync-meta', {
      method: 'POST',
      body: { dryRun },
      schema: syncMetaResultSchema,
    }),
  workspaces: (
    query: { q?: string; lowOnly?: boolean; cursor?: string },
    signal?: AbortSignal,
  ) =>
    operatorFetch('/wallet/workspaces', {
      // `lowOnly=false` would be read as true by the API's boolean coercion, so it is only sent when on.
      query: { q: query.q, lowOnly: query.lowOnly ? true : undefined, cursor: query.cursor, limit: 25 },
      schema: platformWalletListSchema,
      signal,
    }),
  workspace: (id: string, signal?: AbortSignal) =>
    operatorFetch(`/wallet/workspaces/${encodeURIComponent(id)}`, {
      schema: platformWalletDetailSchema,
      signal,
    }),
  adjust: (id: string, body: AdjustWalletInput, idempotencyKey: string) =>
    operatorFetch(`/wallet/workspaces/${encodeURIComponent(id)}/adjust`, {
      method: 'POST',
      body,
      idempotencyKey,
      schema: adjustWalletResultSchema,
    }),
  logs: (query: Partial<WalletLogQuery>, signal?: AbortSignal) =>
    operatorFetch('/wallet/logs', {
      query: { ...query, limit: 50 },
      schema: walletLogListSchema,
      signal,
    }),
  reconcile: () =>
    operatorFetch('/wallet/reconciliation', { method: 'POST', schema: reconciliationSchema }),
};

