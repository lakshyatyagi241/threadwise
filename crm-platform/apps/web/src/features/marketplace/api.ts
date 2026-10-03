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
  marketTestResultSchema,
  type ConfigureInstallationInput,
  type ConsentInstallationInput,
  type CreateMarketRequestInput,
  type InstallAppRequest,
  type MarketAppKind,
  type MarketInstallStatus,
  type SendSampleLeadInput,
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

/** Answers the installation and the NEW secret, once. Same rule as `installApp`: the caller keeps the secret in state only. */
export const rotateSecret = (id: string, rowVersion: number) =>
  apiFetch(`${ROOT}/installations/${id}/rotate-secret`, {
    method: 'POST',
    body: { rowVersion },
    schema: marketInstallResultSchema,
  });

export const uninstallApp = (id: string, body: UninstallAppInput) =>
  apiFetch(`${ROOT}/installations/${id}/uninstall`, { method: 'POST', body });

// --- requests --------------------------------------------------------------------------------------------------------------------

export const askForApp = (body: CreateMarketRequestInput) =>
  apiFetch(`${ROOT}/requests`, { method: 'POST', body, schema: marketRequestResultSchema });

export const voteForRequest = (id: string) =>
  apiFetch(`${ROOT}/requests/${id}/vote`, { method: 'POST', schema: marketRequestSchema });

export const unvoteRequest = (id: string) =>
  apiFetch(`${ROOT}/requests/${id}/vote`, { method: 'DELETE', schema: marketRequestSchema });
