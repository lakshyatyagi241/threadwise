import {
  lintTemplateResultSchema,
  syncTemplatesResultSchema,
  templateDetailSchema,
  templateSubmitResultSchema,
  wabaConnectionListSchema,
  type CreateTemplateInput,
  type LintTemplateInput,
  type SyncTemplatesInput,
  type UpdateTemplateInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

const base = '/templates';

/** Every message-templates call. Templates are named by uuid; the proxy adds the session token. */
export const templatesApi = {
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
  submit: (id: string) =>
    apiFetch(`${base}/${id}/submit`, { method: 'POST', schema: templateSubmitResultSchema }),
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
