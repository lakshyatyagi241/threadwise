import {
  waFormListSchema,
  waFormSchema,
  waFormSubmissionListSchema,
  type SaveWaFormInput,
  type WaFormListQuery,
  type WaFormSubmissionListQuery,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

const base = '/wa-forms';

export const waFormsApi = {
  list: (query: WaFormListQuery = { limit: 20 }, signal?: AbortSignal) =>
    apiFetch(base, { schema: waFormListSchema, query, signal }),
  get: (id: string, signal?: AbortSignal) =>
    apiFetch(`${base}/${id}`, { schema: waFormSchema, signal }),
  create: (input: SaveWaFormInput, idempotencyKey?: string) =>
    apiFetch(base, { method: 'POST', body: input, schema: waFormSchema, idempotencyKey }),
  update: (id: string, input: SaveWaFormInput) =>
    apiFetch(`${base}/${id}`, { method: 'PATCH', body: input, schema: waFormSchema }),
  publish: (id: string) =>
    apiFetch(`${base}/${id}/publish`, { method: 'POST', schema: waFormSchema }),
  duplicate: (id: string) =>
    apiFetch(`${base}/${id}/duplicate`, { method: 'POST', schema: waFormSchema }),
  remove: (id: string) => apiFetch(`${base}/${id}`, { method: 'DELETE' }),
  submissions: (
    id: string,
    query: WaFormSubmissionListQuery = { limit: 25 },
    signal?: AbortSignal,
  ) => apiFetch(`${base}/${id}/submissions`, { schema: waFormSubmissionListSchema, query, signal }),
  exportUrl: (id: string) => `/api/v2${base}/${id}/submissions/export`,
};
