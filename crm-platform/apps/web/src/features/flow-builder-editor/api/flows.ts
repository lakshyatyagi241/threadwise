'use client';

import {
  flbBuilderContextSchema,
  flbCommerceProductsResponseSchema,
  flowDetailSchema,
  flowExportSchema,
  flowsOverviewSchema,
  flbGoogleFilesResponseSchema,
  googleAccountSummarySchema,
  listFlowsResponseSchema,
  flbTestWebhookResponseSchema,
  toggleFlowResponseSchema,
  flbAiGenerateResponseSchema,
  adminFlowTemplateDetailSchema,
  adminFlowTemplateSchema,
  adminFlowTemplatesResponseSchema,
  type FlbAiGenerateRequest,
  type FlbAiGenerateResponse,
  type FlbCommerceProductsQuery,
  type CreateAdminFlowTemplateInput,
  type ListFlowsQuery,
  type SaveFlowRequest,
  type SetBuilderModeRequest,
  type FlbTestWebhookRequest,
  type UpdateAdminFlowTemplateInput,
  type UpdateFlowRequest,
} from '@crm/contracts';
import { z } from 'zod';
import { apiFetch } from '@/lib/api/client';
import { ApiError, toApiError } from '@/lib/api/errors';

/**
 * Typed calls to the flows API through the same-origin proxy. Every response is parsed with its contract schema at the
 * boundary; every error is a problem+json `ApiError` the callers branch on by `code`.
 */
type Query = Record<string, string | number | boolean | undefined>;

export const flowsApi = {
  list: (q: Partial<ListFlowsQuery>, signal?: AbortSignal) =>
    apiFetch('/flows', { query: q as Query, schema: listFlowsResponseSchema, signal }),
  overview: (signal?: AbortSignal) =>
    apiFetch('/flows/overview', { schema: flowsOverviewSchema, signal }),
  setBuilderMode: (body: SetBuilderModeRequest) =>
    apiFetch('/flows/builder-mode', { method: 'PUT', body, schema: flowsOverviewSchema }),
  get: (id: string, signal?: AbortSignal) =>
    apiFetch(`/flows/${id}`, { schema: flowDetailSchema, signal }),
  create: (body: SaveFlowRequest) =>
    apiFetch('/flows', { method: 'POST', body, schema: flowDetailSchema }),
  save: (id: string, body: UpdateFlowRequest) =>
    apiFetch(`/flows/${id}`, { method: 'PUT', body, schema: flowDetailSchema }),
  rename: (id: string, name: string) =>
    apiFetch(`/flows/${id}/rename`, { method: 'PATCH', body: { name }, schema: flowDetailSchema }),
  toggle: (id: string) =>
    apiFetch(`/flows/${id}/toggle`, { method: 'POST', schema: toggleFlowResponseSchema }),
  duplicate: (id: string) =>
    apiFetch(`/flows/${id}/duplicate`, { method: 'POST', schema: flowDetailSchema }),
  remove: (id: string) => apiFetch(`/flows/${id}`, { method: 'DELETE' }),
  publish: (id: string) =>
    apiFetch(`/flows/${id}/publish`, { method: 'POST', schema: flowDetailSchema }),
  unpublish: (id: string) =>
    apiFetch(`/flows/${id}/unpublish`, { method: 'POST', schema: flowDetailSchema }),
  exportFlow: (id: string) => apiFetch(`/flows/${id}/export`, { schema: flowExportSchema }),
  importFlow: (payload: Record<string, unknown>) =>
    apiFetch('/flows/import', { method: 'POST', body: { payload }, schema: flowDetailSchema }),
  cloneTemplate: (id: string) =>
    apiFetch(`/flows/templates/${id}/clone`, { method: 'POST', schema: flowDetailSchema }),
  builderContext: (signal?: AbortSignal) =>
    apiFetch('/flows/builder-context', { schema: flbBuilderContextSchema, signal }),
  commerceProducts: (q: FlbCommerceProductsQuery, signal?: AbortSignal) =>
    apiFetch('/flows/builder-context/commerce-products', {
      query: q as Query,
      schema: flbCommerceProductsResponseSchema,
      signal,
    }),
  googleStatus: (signal?: AbortSignal) =>
    apiFetch('/flows/builder-context/google/status', {
      schema: googleAccountSummarySchema,
      signal,
    }),
  googleFiles: (kind: 'sheets' | 'docs' | 'forms', signal?: AbortSignal) =>
    apiFetch(`/flows/builder-context/google/${kind}`, {
      schema: flbGoogleFilesResponseSchema,
      signal,
    }),
  testWebhook: (body: FlbTestWebhookRequest) =>
    apiFetch('/flows/test-webhook', { method: 'POST', body, schema: flbTestWebhookResponseSchema }),
  aiGenerate,
};

/**
 * "Generate with AI". Not through `apiFetch`: a gateway timeout or proxy error answers HTML, and the modal must then say
 * `Generation failed (<status>)` like Reference's does, not a JSON parse error. Problem+json bodies keep their own message.
 */
async function aiGenerate(body: FlbAiGenerateRequest): Promise<FlbAiGenerateResponse> {
  const res = await fetch('/api/v2/flows/ai-generate', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Request-Id': crypto.randomUUID(),
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify(body),
    credentials: 'same-origin',
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok) {
    const err = toApiError(
      res.status,
      json,
      res.headers.get('x-request-id'),
      res.headers.get('retry-after'),
    );
    throw err.code === 'UNKNOWN' || err.code === 'INTERNAL'
      ? new ApiError(res.status, err.code, `Generation failed (${res.status})`, err.requestId)
      : err;
  }
  const parsed = flbAiGenerateResponseSchema.safeParse(json);
  if (!parsed.success)
    throw new ApiError(res.status, 'INTERNAL', `Generation failed (${res.status})`);
  return parsed.data;
}

/** Platform operator calls (the admin template gallery) go through the operator proxy, `/api/platform/*`. */
async function platformFetch<T>(
  path: string,
  init: { method?: string; body?: unknown; schema?: z.ZodType<T>; query?: Query } = {},
): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(init.query ?? {}))
    if (v !== undefined && v !== '') qs.set(k, String(v));
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['Idempotency-Key'] = crypto.randomUUID();
  const res = await fetch(`/api/platform${path}${qs.size ? `?${qs}` : ''}`, {
    method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: 'same-origin',
  });
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const { toApiError } = await import('@/lib/api/errors');
    throw toApiError(res.status, json, res.headers.get('x-request-id'));
  }
  return (init.schema ? init.schema.parse(json) : undefined) as T;
}

export const adminTemplatesApi = {
  list: (q: { limit?: number; cursor?: string } = {}) =>
    platformFetch('/flow-templates', { query: q, schema: adminFlowTemplatesResponseSchema }),
  get: (id: string) =>
    platformFetch(`/flow-templates/${id}`, { schema: adminFlowTemplateDetailSchema }),
  create: (body: CreateAdminFlowTemplateInput) =>
    platformFetch('/flow-templates', {
      method: 'POST',
      body,
      schema: adminFlowTemplateDetailSchema,
    }),
  update: (id: string, body: UpdateAdminFlowTemplateInput) =>
    platformFetch(`/flow-templates/${id}`, {
      method: 'PUT',
      body,
      schema: adminFlowTemplateDetailSchema,
    }),
  toggle: (id: string) =>
    platformFetch(`/flow-templates/${id}/toggle`, {
      method: 'POST',
      schema: adminFlowTemplateSchema,
    }),
  remove: (id: string) => platformFetch(`/flow-templates/${id}`, { method: 'DELETE' }),
};
