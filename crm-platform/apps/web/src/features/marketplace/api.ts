import type { QueryClient } from '@tanstack/react-query';
import {
  marketAppDetailSchema,
  marketCategoryListSchema,
  marketInstallResultSchema,
  marketInstallationListSchema,
  marketInstallationSchema,
  marketRequestResultSchema,
  marketRequestSchema,
  marketSampleLeadResultSchema,
  marketShelvesSchema,
  marketSubscribeResultSchema,
  marketSubscriptionStateAnswerSchema,
  marketSyncResultSchema,
  marketTestResultSchema,
  marketWorkspaceSubscriptionListSchema,
  type ConfigureInstallationInput,
  type ConsentInstallationInput,
  type CreateMarketRequestInput,
  type InstallAppRequest,
  type MarketAppDetail,
  type MarketAppKind,
  type MarketInstallStatus,
  type MarketInstallation,
  type MarketSubscription,
  type SendSampleLeadInput,
  type SubscribeAppRequest,
  type UninstallAppInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

/**
 * Workspace side of the Marketplace, through the staff proxy (`/api/v2/marketplace/*`). Every answer is parsed with its contract
 * schema. Secrets are write-only: the two answers that carry one (`install`, `rotateSecret`) are returned to the caller and are
 * never put in a query or mutation cache by anything in this file.
 */
const ROOT = '/marketplace';

export const mktKeys = {
  all: ['marketplace'] as const,
  categories: (kind: MarketAppKind) => ['marketplace', 'categories', kind] as const,
  shelves: (kind: MarketAppKind) => ['marketplace', 'shelves', kind] as const,
  /** The infinite list adds the query to this key (`useCursorList`). */
  apps: (kind: MarketAppKind) => ['marketplace', 'apps', kind] as const,
  appsAll: ['marketplace', 'apps'] as const,
  app: (ref: string) => ['marketplace', 'app', ref] as const,
  installations: (kind: MarketAppKind | 'all', status: MarketInstallStatus | 'all') =>
    ['marketplace', 'installations', kind, status] as const,
  installationsAll: ['marketplace', 'installations'] as const,
  installation: (id: string) => ['marketplace', 'installation', id] as const,
  /** Every cached installation (the singular prefix; `installationsAll` is the lists). */
  installationAny: ['marketplace', 'installation'] as const,
  /** The workspace's own subscriptions (paid, trial and comp), newest first. */
  subscriptions: ['marketplace', 'subscriptions'] as const,
  events: (id: string) => ['marketplace', 'events', id] as const,
  /** The infinite list adds the query to this key. */
  requests: ['marketplace', 'requests'] as const,
};

// --- browse ----------------------------------------------------------------------------------------------------------------------

export const fetchCategories = (kind: MarketAppKind, signal?: AbortSignal) =>
  apiFetch(`${ROOT}/categories`, { query: { kind }, schema: marketCategoryListSchema, signal });

export const fetchShelves = (kind: MarketAppKind, signal?: AbortSignal) =>
  apiFetch(`${ROOT}/shelves`, { query: { kind }, schema: marketShelvesSchema, signal });

/** `ref` is the app's slug or its uuid. */
export const fetchApp = (ref: string, signal?: AbortSignal) =>
  apiFetch(`${ROOT}/apps/${encodeURIComponent(ref)}`, { schema: marketAppDetailSchema, signal });

// --- installations ---------------------------------------------------------------------------------------------------------------

export const fetchInstallations = (
  q: { kind?: MarketAppKind; status?: MarketInstallStatus },
  signal?: AbortSignal,
) =>
  apiFetch(`${ROOT}/installations`, {
    query: { kind: q.kind, status: q.status },
    schema: marketInstallationListSchema,
    signal,
  });

export const fetchInstallation = (id: string, signal?: AbortSignal) =>
  apiFetch(`${ROOT}/installations/${id}`, { schema: marketInstallationSchema, signal });

/**
 * Install after consent. The answer carries `inboundSecret` once: the caller keeps it in component state only. This is a plain
 * function (not a mutation) so no cache holds the result.
 */
export const installApp = (ref: string, body: InstallAppRequest) =>
  apiFetch(`${ROOT}/apps/${encodeURIComponent(ref)}/install`, {
    method: 'POST',
    body,
    schema: marketInstallResultSchema,
  });

export const acceptNewPermissions = (id: string, body: ConsentInstallationInput) =>
  apiFetch(`${ROOT}/installations/${id}/consent`, {
    method: 'POST',
    body,
    schema: marketInstallationSchema,
  });

export const configureInstallation = (id: string, body: ConfigureInstallationInput) =>
  apiFetch(`${ROOT}/installations/${id}`, {
    method: 'PATCH',
    body,
    schema: marketInstallationSchema,
  });

export const setInstallationEnabled = (id: string, enabled: boolean, rowVersion: number) =>
  apiFetch(`${ROOT}/installations/${id}/${enabled ? 'enable' : 'disable'}`, {
    method: 'POST',
    body: { rowVersion },
    schema: marketInstallationSchema,
  });

export const testInstallation = (id: string) =>
  apiFetch(`${ROOT}/installations/${id}/test`, { method: 'POST', schema: marketTestResultSchema });

export const sendSampleLead = (id: string, body: SendSampleLeadInput = {}) =>
  apiFetch(`${ROOT}/installations/${id}/sample`, {
    method: 'POST',
    body,
    schema: marketSampleLeadResultSchema,
  });

/**
 * "Sync now" for a connection the platform polls: the next poll is brought forward, never faster than the portal allows (`runAt` can be a
 * few minutes away), and a connection that stopped on an error starts again. No body.
 */
export const syncInstallation = (id: string) =>
  apiFetch(`${ROOT}/installations/${id}/sync`, { method: 'POST', schema: marketSyncResultSchema });

/** Answers the installation and the NEW secret, once. Same rule as `installApp`: the caller keeps the secret in state only. */
export const rotateSecret = (id: string, rowVersion: number) =>
  apiFetch(`${ROOT}/installations/${id}/rotate-secret`, {
    method: 'POST',
    body: { rowVersion },
    schema: marketInstallResultSchema,
  });

export const uninstallApp = (id: string, body: UninstallAppInput) =>
  apiFetch(`${ROOT}/installations/${id}/uninstall`, { method: 'POST', body });

// --- paid apps: subscribe, cancel, resume ----------------------------------------------------------------------------------------

/**
 * Subscribe to a paid app. `startTrial` starts the free trial the listing offers; otherwise the answer says where to pay
 * (`checkout.path`, the existing add-on checkout page). Plain POSTs: a retried one changes nothing, the server answers the same.
 */
export const subscribeToApp = (ref: string, body: SubscribeAppRequest) =>
  apiFetch(`${ROOT}/apps/${encodeURIComponent(ref)}/subscribe`, {
    method: 'POST',
    body,
    schema: marketSubscribeResultSchema,
  });

/** Stop renewing: the period already paid for runs to its end, then the installation is paused (data and settings kept). */
export const cancelSubscription = (ref: string) =>
  apiFetch(`${ROOT}/apps/${encodeURIComponent(ref)}/subscription/cancel`, {
    method: 'POST',
    schema: marketSubscriptionStateAnswerSchema,
  });

/** Take a cancellation back while the period still runs. */
export const resumeSubscription = (ref: string) =>
  apiFetch(`${ROOT}/apps/${encodeURIComponent(ref)}/subscription/resume`, {
    method: 'POST',
    schema: marketSubscriptionStateAnswerSchema,
  });

export const fetchSubscriptions = (signal?: AbortSignal) =>
  apiFetch(`${ROOT}/subscriptions`, { schema: marketWorkspaceSubscriptionListSchema, signal });

/**
 * A subscription answer replaces the one inside the cached app page and installations at once (the screens stop showing the old
 * state), then everything that derives from it (price line, access, pause) is read again.
 */
export function syncSubscription(qc: QueryClient, slug: string, next: MarketSubscription | null) {
  qc.setQueryData<MarketAppDetail>(mktKeys.app(slug), (old) => {
    if (!old || !next) return old;
    // A subscription that is in force entitles the workspace at once; the re-read below confirms what the server says.
    const entitles = old.pricing.access === 'subscription_required' && next.status !== 'ended';
    return {
      ...old,
      subscription: next,
      pricing: entitles
        ? { ...old.pricing, access: 'entitled', trialAvailable: false }
        : old.pricing,
    };
  });
  qc.setQueriesData<MarketInstallation>({ queryKey: mktKeys.installationAny }, (old) =>
    old && next && old.app.slug === slug ? { ...old, subscription: next } : old,
  );
  refreshAfterSubscription(qc, slug);
}

/** What a subscription change (or a trial, or a payment's return) can have changed on screen. */
export function refreshAfterSubscription(qc: QueryClient, slug: string) {
  void qc.invalidateQueries({ queryKey: mktKeys.app(slug) });
  void qc.invalidateQueries({ queryKey: mktKeys.installationAny });
  void qc.invalidateQueries({ queryKey: mktKeys.installationsAll });
  void qc.invalidateQueries({ queryKey: mktKeys.appsAll });
  void qc.invalidateQueries({ queryKey: ['marketplace', 'shelves'] });
  void qc.invalidateQueries({ queryKey: mktKeys.subscriptions });
}

// --- requests --------------------------------------------------------------------------------------------------------------------

export const askForApp = (body: CreateMarketRequestInput) =>
  apiFetch(`${ROOT}/requests`, { method: 'POST', body, schema: marketRequestResultSchema });

export const voteForRequest = (id: string) =>
  apiFetch(`${ROOT}/requests/${id}/vote`, { method: 'POST', schema: marketRequestSchema });

export const unvoteRequest = (id: string) =>
  apiFetch(`${ROOT}/requests/${id}/vote`, { method: 'DELETE', schema: marketRequestSchema });
