import type { z } from 'zod';
import {
  createMarketAppSchema,
  marketKillResultSchema,
  marketOperatorAppDetailSchema,
  marketOperatorAppListSchema,
  marketOperatorAppSchema,
  marketOperatorCategoryListSchema,
  marketOperatorCategorySchema,
  marketOperatorRequestListSchema,
  marketOperatorRequestSchema,
  marketPublishResultSchema,
  marketUsageSchema,
  type CreateMarketCategoryInput,
  type MarketAppKind,
  type MarketAppStatus,
  type MarketRequestStatus,
  type SaveMarketVersionInput,
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
  q?: string;
}
export interface RequestListFilters {
  status?: MarketRequestStatus;
  kind?: MarketAppKind;
  q?: string;
}

export const marketKeys = {
  all: ['operator', 'marketplace'] as const,
  apps: (f: AppListFilters) =>
    ['operator', 'marketplace', 'apps', f.status ?? '', f.kind ?? '', f.q ?? ''] as const,
  appsAll: ['operator', 'marketplace', 'apps'] as const,
  app: (ref: string, versionId?: string) =>
    ['operator', 'marketplace', 'app', ref, versionId ?? 'latest'] as const,
  appAll: (ref: string) => ['operator', 'marketplace', 'app', ref] as const,
  categories: ['operator', 'marketplace', 'categories'] as const,
  requests: (f: RequestListFilters) =>
    ['operator', 'marketplace', 'requests', f.status ?? '', f.kind ?? '', f.q ?? ''] as const,
  requestsAll: ['operator', 'marketplace', 'requests'] as const,
  usage: ['operator', 'marketplace', 'usage'] as const,
};

const seg = encodeURIComponent;

// --- listings --------------------------------------------------------------------------------------------------------------------------

export const fetchApps = (f: AppListFilters & { cursor?: string }, signal?: AbortSignal) =>
  operatorFetch(`${ROOT}/apps`, {
    query: { status: f.status, kind: f.kind, q: f.q, limit: 50, cursor: f.cursor },
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
