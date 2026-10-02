import {
  currencyItemSchema,
  currencyListResponseSchema,
  fetchRatesResponseSchema,
  workspaceCurrencyResponseSchema,
  type SetDefaultCurrencyRequest,
} from '@crm/contracts';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { apiFetch } from '@/lib/api/client';
import type { CreateBody, UpdateBody } from './lib/form';

export const CURRENCY_KEYS = {
  all: ['currencies'] as const,
  list: (q: string, cursor: string | undefined) =>
    ['currencies', 'list', q, cursor ?? 'first'] as const,
  workspace: ['workspace', 'currency'] as const,
};

/** The operator console's calls (`/api/platform/*` becomes `/v2/platform/*`). */
export const currencyApi = {
  list: (query: { q: string; cursor: string | undefined; limit: number }, signal?: AbortSignal) =>
    operatorFetch('/currencies', {
      query: { q: query.q || undefined, limit: query.limit, cursor: query.cursor },
      schema: currencyListResponseSchema,
      signal,
    }),
  create: (body: CreateBody) =>
    operatorFetch('/currencies', { method: 'POST', body, schema: currencyItemSchema }),
  update: (id: string, body: UpdateBody) =>
    operatorFetch(`/currencies/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body,
      schema: currencyItemSchema,
    }),
  setActive: (id: string, value: boolean) =>
    operatorFetch(`/currencies/${encodeURIComponent(id)}/active`, {
      method: 'PUT',
      body: { value },
      schema: currencyItemSchema,
    }),
  remove: (id: string) =>
    operatorFetch(`/currencies/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  setDefault: (code: SetDefaultCurrencyRequest['code']) =>
    operatorFetch('/currencies/default', { method: 'PUT', body: { code } }),
  fetchRates: () =>
    operatorFetch('/currencies/fetch-rates', { method: 'POST', schema: fetchRatesResponseSchema }),
};

/** The workspace's own display currency (`/api/v2/workspace/currency`). */
export const workspaceCurrencyApi = {
  get: (signal?: AbortSignal) =>
    apiFetch('/workspace/currency', { schema: workspaceCurrencyResponseSchema, signal }),
  set: (body: { currency: string | null }) =>
    apiFetch('/workspace/currency', {
      method: 'PUT',
      body,
      schema: workspaceCurrencyResponseSchema,
    }),
};
