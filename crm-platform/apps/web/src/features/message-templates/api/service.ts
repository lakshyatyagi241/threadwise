import {
  listApiKeysResponseSchema,
  lintTemplateResultSchema,
  syncTemplatesResultSchema,
  templateCountsSchema,
  templateDetailSchema,
  templateGalleryResponseSchema,
  templateSubmitResultSchema,
  wabaConnectionListSchema,
  type CreateTemplateInput,
  type LintTemplateInput,
  type SubmitTemplateInput,
  type SyncTemplatesInput,
  type TemplateCountsQuery,
  type TemplateGalleryQuery,
  type UpdateTemplateInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

const base = '/templates';

/** Every message-templates call. Templates are named by uuid; the proxy adds the session token. */
export const templatesApi = {
  /** The default (starter) templates of the platform, by use (every category; the chosen one and the search narrow the list). */
  gallery: (query: TemplateGalleryQuery, signal?: AbortSignal) =>
    apiFetch(`${base}/gallery`, {
      query: { category: query.category, q: query.q || undefined },
      schema: templateGalleryResponseSchema,
      signal,
    }),
  get: (id: string, signal?: AbortSignal) =>
    apiFetch(`${base}/${id}`, { schema: templateDetailSchema, signal }),
  create: (input: CreateTemplateInput, idempotencyKey?: string) =>
    apiFetch(base, {
      method: 'POST',
      body: input,
      schema: templateSubmitResultSchema,
      idempotencyKey,
    }),
  update: (id: string, input: UpdateTemplateInput, idempotencyKey?: string) =>
    apiFetch(`${base}/${id}`, {
      method: 'PUT',
      body: input,
      schema: templateSubmitResultSchema,
      idempotencyKey,
    }),
  remove: (id: string) => apiFetch(`${base}/${id}`, { method: 'DELETE' }),
  submit: (id: string, input: SubmitTemplateInput = {}) =>
    apiFetch(`${base}/${id}/submit`, {
      method: 'POST',
      body: input,
      schema: templateSubmitResultSchema,
    }),
  counts: (query: TemplateCountsQuery, signal?: AbortSignal) =>
    apiFetch(`${base}/counts`, {
      query: {
        status: query.status,
        statusGroup: query.statusGroup,
        category: query.category,
        connectionId: query.connectionId,
        q: query.q || undefined,
      },
      schema: templateCountsSchema,
      signal,
    }),
  refresh: (id: string) =>
    apiFetch(`${base}/${id}/refresh`, { method: 'POST', schema: templateSubmitResultSchema }),
  sync: (input: SyncTemplatesInput) =>
    apiFetch(`${base}/sync`, { method: 'POST', body: input, schema: syncTemplatesResultSchema }),
  lint: (input: LintTemplateInput, signal?: AbortSignal) =>
    apiFetch(`${base}/lint`, {
      method: 'POST',
      body: input,
      schema: lintTemplateResultSchema,
      signal,
    }),
};

/** The WhatsApp numbers a template can be submitted through (the WABA domain owns them). */
export const connectionsApi = {
  list: (signal?: AbortSignal) =>
    apiFetch('/waba/numbers', { schema: wabaConnectionListSchema, signal }),
};

/** Whether the workspace has a live API key (the cURL card tells the person to create one first when it has none). */
export const apiKeysApi = {
  list: (signal?: AbortSignal) =>
    apiFetch('/developer/keys', {
      query: { limit: 100 },
      schema: listApiKeysResponseSchema,
      signal,
    }),
};
