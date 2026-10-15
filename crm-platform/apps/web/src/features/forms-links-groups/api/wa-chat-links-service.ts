import {
  waChatLinkListSchema,
  waChatLinkSchema,
  type SaveWaChatLinkInput,
  type WaChatLinkListQuery,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

const base = '/wa-links';

export const waChatLinksApi = {
  list: (query: WaChatLinkListQuery = { limit: 20, status: 'all' }, signal?: AbortSignal) =>
    apiFetch(base, { schema: waChatLinkListSchema, query, signal }),
  get: (id: string, signal?: AbortSignal) =>
    apiFetch(`${base}/${id}`, { schema: waChatLinkSchema, signal }),
  create: (input: SaveWaChatLinkInput, idempotencyKey?: string) =>
    apiFetch(base, { method: 'POST', body: input, schema: waChatLinkSchema, idempotencyKey }),
  update: (id: string, input: SaveWaChatLinkInput) =>
    apiFetch(`${base}/${id}`, { method: 'PATCH', body: input, schema: waChatLinkSchema }),
  duplicate: (id: string) =>
    apiFetch(`${base}/${id}/duplicate`, { method: 'POST', schema: waChatLinkSchema }),
  remove: (id: string) => apiFetch(`${base}/${id}`, { method: 'DELETE' }),
};
