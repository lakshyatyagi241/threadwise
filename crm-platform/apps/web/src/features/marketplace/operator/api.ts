import type { z } from 'zod';
import {
  createMarketAppSchema,
  marketGrandfatherResultSchema,
  marketKillResultSchema,
  marketOperatorAppDetailSchema,
  marketOperatorAppListSchema,
  marketOperatorAppSchema,
  marketOperatorCategoryListSchema,
  marketOperatorCategorySchema,
  marketOperatorRequestListSchema,
  marketOperatorRequestSchema,
  marketOperatorSubscriptionListSchema,
  marketOperatorSubscriptionSchema,
  marketProrationSchema,
  marketPublishResultSchema,
  marketWithdrawnRefundSchema,
  marketSubscriptionSummarySchema,
  marketUsageSchema,
  type CancelOperatorSubscriptionRequest,
  type CompSubscriptionRequest,
  type CreateMarketCategoryInput,
  type GrandfatherSubscriptionsRequest,
  type MarketAppKind,
  type MarketAppStatus,
  type MarketRequestStatus,
  type MarketSubscriptionSource,
  type MarketSubscriptionStatus,
  type ProrateSubscriptionRequest,
  type RefundWithdrawnAppRequest,
  type SaveMarketVersionInput,
  type SetMarketPricingRequest,
  type UnlockSubscriptionPriceRequest,
  type UpdateMarketAppInput,
  type UpdateMarketCategoryInput,
  type UpdateMarketRequestInput,
} from '@crm/contracts';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';

/**
 * Operator console, Marketplace catalogue: through the same-origin operator proxy (`/api/platform/*` becomes `/v2/platform/*`).
 * Every answer is parsed with its contract schema. The operator API carries no secret and nothing here keeps one.
 */
const ROOT = '/marketplace';

export interface AppListFilters {
  status?: MarketAppStatus;
  kind?: MarketAppKind;
  pricing?: 'free' | 'paid';
  q?: string;
}
export interface RequestListFilters {
  status?: MarketRequestStatus;
  kind?: MarketAppKind;
  q?: string;
}
export interface SubscriptionListFilters {
  /** An app's slug or uuid. */
  app?: string;
  status?: MarketSubscriptionStatus;
  source?: MarketSubscriptionSource;
  /** Part of the workspace's name. */
  q?: string;
}

export const marketKeys = {
  all: ['operator', 'marketplace'] as const,
  apps: (f: AppListFilters) =>
    [
      'operator',
      'marketplace',
      'apps',
      f.status ?? '',
      f.kind ?? '',
      f.q ?? '',
      f.pricing ?? '',
    ] as const,
  appsAll: ['operator', 'marketplace', 'apps'] as const,
  app: (ref: string, versionId?: string) =>
    ['operator', 'marketplace', 'app', ref, versionId ?? 'latest'] as const,
  appAll: (ref: string) => ['operator', 'marketplace', 'app', ref] as const,
  /** Every cached listing page, whether it was opened by slug or by uuid. */
  appDetailsAll: ['operator', 'marketplace', 'app'] as const,
  categories: ['operator', 'marketplace', 'categories'] as const,
  requests: (f: RequestListFilters) =>
    ['operator', 'marketplace', 'requests', f.status ?? '', f.kind ?? '', f.q ?? ''] as const,
  requestsAll: ['operator', 'marketplace', 'requests'] as const,
  usage: ['operator', 'marketplace', 'usage'] as const,
  subscriptions: (f: SubscriptionListFilters) =>
    [
      'operator',
      'marketplace',
      'subscriptions',
      f.app ?? '',
      f.status ?? '',
      f.source ?? '',
      f.q ?? '',
    ] as const,
  subscriptionsAll: ['operator', 'marketplace', 'subscriptions'] as const,
  subscriptionSummary: ['operator', 'marketplace', 'subscription-summary'] as const,
  /** The comp dialog's workspace picker: a name search over the operator's workspace list. */
  workspaces: (search: string) => ['operator', 'marketplace', 'workspaces', search] as const,
};

const seg = encodeURIComponent;

// --- listings --------------------------------------------------------------------------------------------------------------------------

export const fetchApps = (f: AppListFilters & { cursor?: string }, signal?: AbortSignal) =>
  operatorFetch(`${ROOT}/apps`, {
    query: {
      status: f.status,
      kind: f.kind,
      pricing: f.pricing,
      q: f.q,
      limit: 50,
      cursor: f.cursor,
    },
    schema: marketOperatorAppListSchema,
    signal,
  });

export const fetchApp = (ref: string, versionId?: string, signal?: AbortSignal) =>
  operatorFetch(`${ROOT}/apps/${seg(ref)}`, {
    query: { versionId },
    schema: marketOperatorAppDetailSchema,
    signal,
  });

/** What the create form sends (defaults are the API's when a field is left out). */
export type CreateAppBody = z.input<typeof createMarketAppSchema>;

export const createApp = (body: CreateAppBody) =>
  operatorFetch(`${ROOT}/apps`, { method: 'POST', body, schema: marketOperatorAppDetailSchema });

export const updateApp = (ref: string, body: UpdateMarketAppInput) =>
  operatorFetch(`${ROOT}/apps/${seg(ref)}`, {
    method: 'PATCH',
    body,
    schema: marketOperatorAppDetailSchema,
  });

export const deleteApp = (ref: string) =>
  operatorFetch(`${ROOT}/apps/${seg(ref)}`, { method: 'DELETE' });

// --- versions and review ---------------------------------------------------------------------------------------------------------------

export const saveVersion = (ref: string, body: SaveMarketVersionInput) =>
  operatorFetch(`${ROOT}/apps/${seg(ref)}/versions`, {
    method: 'POST',
    body,
    schema: marketOperatorAppDetailSchema,
  });

export const updateVersion = (ref: string, versionId: string, body: SaveMarketVersionInput) =>
  operatorFetch(`${ROOT}/apps/${seg(ref)}/versions/${seg(versionId)}`, {
    method: 'PUT',
    body,
    schema: marketOperatorAppDetailSchema,
  });

export const submitVersion = (ref: string, versionId: string) =>
  operatorFetch(`${ROOT}/apps/${seg(ref)}/versions/${seg(versionId)}/submit`, {
    method: 'POST',
    schema: marketOperatorAppDetailSchema,
  });

export const approveVersion = (ref: string, versionId: string, note: string) =>
  operatorFetch(`${ROOT}/apps/${seg(ref)}/versions/${seg(versionId)}/approve`, {
    method: 'POST',
    body: note.trim() ? { note: note.trim() } : {},
    schema: marketOperatorAppDetailSchema,
  });

export const rejectVersion = (ref: string, versionId: string, note: string) =>
  operatorFetch(`${ROOT}/apps/${seg(ref)}/versions/${seg(versionId)}/reject`, {
    method: 'POST',
    body: { note: note.trim() },
    schema: marketOperatorAppDetailSchema,
  });

export const publishApp = (ref: string, versionId: string) =>
  operatorFetch(`${ROOT}/apps/${seg(ref)}/publish`, {
    method: 'POST',
    body: { versionId },
    schema: marketPublishResultSchema,
  });

// --- hide, kill ------------------------------------------------------------------------------------------------------------------------

export type AppStatusAction = 'hide' | 'unhide' | 'unkill';

export const runAppAction = (ref: string, action: AppStatusAction) =>
  operatorFetch(`${ROOT}/apps/${seg(ref)}/${action}`, {
    method: 'POST',
    schema: marketOperatorAppSchema,
  });

export const killApp = (ref: string, reason: string) =>
  operatorFetch(`${ROOT}/apps/${seg(ref)}/kill`, {
    method: 'POST',
    body: { reason: reason.trim() },
    schema: marketKillResultSchema,
  });

// --- categories ------------------------------------------------------------------------------------------------------------------------

export const fetchCategories = (signal?: AbortSignal) =>
  operatorFetch(`${ROOT}/categories`, { schema: marketOperatorCategoryListSchema, signal });

export const createCategory = (body: CreateMarketCategoryInput) =>
  operatorFetch(`${ROOT}/categories`, {
    method: 'POST',
    body,
    schema: marketOperatorCategorySchema,
  });

export const updateCategory = (id: string, body: UpdateMarketCategoryInput) =>
  operatorFetch(`${ROOT}/categories/${seg(id)}`, {
    method: 'PATCH',
    body,
    schema: marketOperatorCategorySchema,
  });

export const deleteCategory = (id: string) =>
  operatorFetch(`${ROOT}/categories/${seg(id)}`, { method: 'DELETE' });

// --- requests and usage ----------------------------------------------------------------------------------------------------------------

export const fetchRequests = (f: RequestListFilters & { cursor?: string }, signal?: AbortSignal) =>
  operatorFetch(`${ROOT}/requests`, {
    query: { status: f.status, kind: f.kind, q: f.q, limit: 50, cursor: f.cursor },
    schema: marketOperatorRequestListSchema,
    signal,
  });

export const updateRequest = (id: string, body: UpdateMarketRequestInput) =>
  operatorFetch(`${ROOT}/requests/${seg(id)}`, {
    method: 'PATCH',
    body,
    schema: marketOperatorRequestSchema,
  });

export const fetchUsage = (signal?: AbortSignal) =>
  operatorFetch(`${ROOT}/usage`, { schema: marketUsageSchema, signal });

// --- pricing and subscriptions (platform.market.pricing) --------------------------------------------------------------------------------

/** The app's new pricing, saved with the `rowVersion` the operator read; the answer is the listing as it is now. */
export const setPricing = (ref: string, body: SetMarketPricingRequest) =>
  operatorFetch(`${ROOT}/apps/${seg(ref)}/pricing`, {
    method: 'PUT',
    body,
    schema: marketOperatorAppSchema,
  });

export const fetchSubscriptions = (
  f: SubscriptionListFilters & { cursor?: string },
  signal?: AbortSignal,
) =>
  operatorFetch(`${ROOT}/subscriptions`, {
    query: { app: f.app, status: f.status, source: f.source, q: f.q, limit: 50, cursor: f.cursor },
    schema: marketOperatorSubscriptionListSchema,
    signal,
  });

export const fetchSubscriptionSummary = (signal?: AbortSignal) =>
  operatorFetch(`${ROOT}/subscriptions/summary`, {
    schema: marketSubscriptionSummarySchema,
    signal,
  });

/** Gives a workspace a paid app free. `ref` is the app's slug or uuid. */
export const compSubscription = (ref: string, body: CompSubscriptionRequest) =>
  operatorFetch(`${ROOT}/apps/${seg(ref)}/subscriptions/comp`, {
    method: 'POST',
    body,
    schema: marketOperatorSubscriptionSchema,
  });

/** "Comp existing users": a dry run (the default) says who would be comped; `dryRun: false` does it. */
export const grandfatherSubscriptions = (ref: string, body: GrandfatherSubscriptionsRequest) =>
  operatorFetch(`${ROOT}/apps/${seg(ref)}/subscriptions/grandfather`, {
    method: 'POST',
    body,
    schema: marketGrandfatherResultSchema,
  });

/** The unused share of the last payment of one subscription: `dryRun: true` (the default) works the amount out, `false` returns it. */
export const prorateSubscription = (id: string, body: ProrateSubscriptionRequest) =>
  operatorFetch(`${ROOT}/subscriptions/${seg(id)}/prorate`, {
    method: 'POST',
    body,
    schema: marketProrationSchema,
  });

/** The unused share from the moment a killed app was withdrawn, for every subscriber (200 per call). */
export const refundWithdrawnApp = (ref: string, body: RefundWithdrawnAppRequest) =>
  operatorFetch(`${ROOT}/apps/${seg(ref)}/refund-unused`, {
    method: 'POST',
    body,
    schema: marketWithdrawnRefundSchema,
  });

/** Releases one subscriber from their locked price; the next payment is the listing's price. */
export const unlockSubscriptionPrice = (id: string, body: UnlockSubscriptionPriceRequest) =>
  operatorFetch(`${ROOT}/subscriptions/${seg(id)}/unlock-price`, {
    method: 'POST',
    body,
    schema: marketOperatorSubscriptionSchema,
  });

export const cancelSubscription = (id: string, body: CancelOperatorSubscriptionRequest) =>
  operatorFetch(`${ROOT}/subscriptions/${seg(id)}/cancel`, {
    method: 'POST',
    body,
    schema: marketOperatorSubscriptionSchema,
  });
