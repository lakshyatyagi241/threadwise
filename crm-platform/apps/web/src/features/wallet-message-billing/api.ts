import { z } from 'zod';
import {
  adjustWalletResultSchema,
  creditPackageListSchema,
  creditPackageSchema,
  deleteRateResultSchema,
  importMetaCardResultSchema,
  importRatesResultSchema,
  marginsResponseSchema,
  metaCardDetailSchema,
  metaCardsResponseSchema,
  messagePricingSchema,
  pricePreviewSchema,
  removePlanMarginResultSchema,
  platformWalletDetailSchema,
  platformWalletListSchema,
  platformWalletOverviewSchema,
  ratesResponseSchema,
  reconciliationSchema,
  saveMarginsResultSchema,
  saveRatesResultSchema,
  seedRatesResultSchema,
  setWorkspaceCurrencyResultSchema,
  statementResponseSchema,
  syncMetaResultSchema,
  walletLedgerResponseSchema,
  walletLogListSchema,
  walletSettingsSchema,
  walletSummarySchema,
  type AdjustWalletInput,
  type CreditPackageInput,
  type PricePreviewQuery,
  type SavePlanMarginsInput,
  type SaveWorkspaceMarginsInput,
  type SetWorkspaceCurrencyInput,
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
  metaCards: ['wallet', 'platform', 'meta-cards'] as const,
  metaCard: (currency: string) => ['wallet', 'platform', 'meta-cards', currency] as const,
  workspaces: ['wallet', 'platform', 'workspaces'] as const,
  workspace: (id: string) => ['wallet', 'platform', 'workspace', id] as const,
  logs: ['wallet', 'platform', 'logs'] as const,
  /** `''` = the platform default for every plan. */
  margins: (plan: string) => ['wallet', 'platform', 'margins', plan] as const,
  marginsAll: ['wallet', 'platform', 'margins'] as const,
  workspaceMargins: (id: string) => ['wallet', 'platform', 'workspace-margins', id] as const,
  preview: (q: PricePreviewQuery) => ['wallet', 'platform', 'preview', q] as const,
  workspacePlan: (id: string) => ['wallet', 'platform', 'workspace-plan', id] as const,
  packages: ['wallet', 'platform', 'packages'] as const,
};

/** The workspace's own wallet (`/api/v2/wallet/*`). Each call is permission-gated by the API. */
export const customerApi = {
  summary: (signal?: AbortSignal) =>
    apiFetch('/wallet/summary', { schema: walletSummarySchema, signal }),
  ledger: (cursor: string | undefined, limit: number, signal?: AbortSignal) =>
    apiFetch('/wallet/ledger', {
      query: { limit, cursor },
      schema: walletLedgerResponseSchema,
      signal,
    }),
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

const deletedSchema = z.object({ deleted: z.boolean() });

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
  setWorkspaceCurrency: (id: string, body: SetWorkspaceCurrencyInput) =>
    operatorFetch(`/wallet/workspaces/${encodeURIComponent(id)}/currency`, {
      method: 'PUT',
      body,
      schema: setWorkspaceCurrencyResultSchema,
    }),
  metaCards: (signal?: AbortSignal) =>
    operatorFetch('/wallet/meta-cards', { schema: metaCardsResponseSchema, signal }),
  metaCard: (currency: string, signal?: AbortSignal) =>
    operatorFetch(`/wallet/meta-cards/${encodeURIComponent(currency)}`, {
      schema: metaCardDetailSchema,
      signal,
    }),
  importMetaCard: (file: string, fileName: string, dryRun: boolean) =>
    operatorFetch('/wallet/meta-cards/import', {
      method: 'POST',
      body: { file, fileName, dryRun },
      schema: importMetaCardResultSchema,
    }),
  syncMeta: (dryRun: boolean) =>
    operatorFetch('/wallet/rates/sync-meta', {
      method: 'POST',
      body: { dryRun },
      schema: syncMetaResultSchema,
    }),
  workspaces: (query: { q?: string; lowOnly?: boolean; cursor?: string }, signal?: AbortSignal) =>
    operatorFetch('/wallet/workspaces', {
      // `lowOnly=false` would be read as true by the API's boolean coercion, so it is only sent when on.
      query: {
        q: query.q,
        lowOnly: query.lowOnly ? true : undefined,
        cursor: query.cursor,
        limit: 25,
      },
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
  margins: (plan: string, signal?: AbortSignal) =>
    operatorFetch('/wallet/margins', {
      query: { plan: plan || undefined },
      schema: marginsResponseSchema,
      signal,
    }),
  saveMargins: (body: SavePlanMarginsInput) =>
    operatorFetch('/wallet/margins', { method: 'PUT', body, schema: saveMarginsResultSchema }),
  deleteMargin: (id: string) =>
    operatorFetch(`/wallet/margins/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      schema: removePlanMarginResultSchema,
    }),
  workspaceMargins: (id: string, signal?: AbortSignal) =>
    operatorFetch(`/wallet/workspaces/${encodeURIComponent(id)}/margins`, {
      schema: marginsResponseSchema,
      signal,
    }),
  saveWorkspaceMargins: (id: string, body: SaveWorkspaceMarginsInput) =>
    operatorFetch(`/wallet/workspaces/${encodeURIComponent(id)}/margins`, {
      method: 'PUT',
      body,
      schema: saveMarginsResultSchema,
    }),
  preview: (q: PricePreviewQuery, signal?: AbortSignal) =>
    operatorFetch('/wallet/pricing/preview', {
      query: { workspaceId: q.workspaceId, country: q.country, category: q.category },
      schema: pricePreviewSchema,
      signal,
    }),
  packages: (signal?: AbortSignal) =>
    operatorFetch('/wallet/packages', { schema: creditPackageListSchema, signal }),
  createPackage: (body: CreditPackageInput) =>
    operatorFetch('/wallet/packages', { method: 'POST', body, schema: creditPackageSchema }),
  updatePackage: (id: string, body: CreditPackageInput) =>
    operatorFetch(`/wallet/packages/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body,
      schema: creditPackageSchema,
    }),
  togglePackage: (id: string) =>
    operatorFetch(`/wallet/packages/${encodeURIComponent(id)}/toggle`, {
      method: 'POST',
      schema: creditPackageSchema,
    }),
  deletePackage: (id: string) =>
    operatorFetch(`/wallet/packages/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      schema: deletedSchema,
    }),
};
