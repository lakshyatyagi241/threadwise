import {
  apiLibraryContactPropertiesResponseSchema,
  apiLibraryDetailSchema,
  apiLibraryLogDetailSchema,
  apiLibraryOptionsResponseSchema,
  apiLibraryUsageResponseSchema,
  listApiLibraryApisResponseSchema,
  listApiLibraryLogsResponseSchema,
  testApiLibraryApiResponseSchema,
  testApiLibraryFunctionResponseSchema,
  type CreateApiLibraryApiInput,
  type ApiLibraryMethod,
  type ListApiLibraryLogsQuery,
  type TestApiLibraryApiInput,
  type TestApiLibraryFunctionInput,
  type UpdateApiLibraryApiInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { normalizePage } from '../lib/pagination';

/** Every list route is asked for a numbered page (`page` present: the API answers the totals; cursors are not used here). */
export interface PageQuery {
  page: number;
  limit: number;
}
export type ApisQuery = PageQuery & { search?: string; method?: ApiLibraryMethod };
export type LogsQuery = PageQuery &
  Partial<
    Pick<ListApiLibraryLogsQuery, 'status' | 'statusCode' | 'source' | 'from' | 'to' | 'search'>
  >;

const BASE = '/api-library';
const enc = encodeURIComponent;

/** Query values the api client accepts: it drops undefined and empty strings. */
type Query = Record<string, string | number | boolean | undefined>;
const asQuery = (q: object): Query => q as Query;

/** Every call of the API Library screens. Lists are cursor pages (no total, no page numbers). */
export const apiLibraryApi = {
  list: (query: ApisQuery, signal?: AbortSignal) =>
    apiFetch(`${BASE}/apis`, {
      query: asQuery(query),
      schema: listApiLibraryApisResponseSchema,
      signal,
    }).then((r) => normalizePage(r, query)),
  options: (signal?: AbortSignal) =>
    apiFetch(`${BASE}/apis/options`, { schema: apiLibraryOptionsResponseSchema, signal }),
  get: (id: string, signal?: AbortSignal) =>
    apiFetch(`${BASE}/apis/${enc(id)}`, { schema: apiLibraryDetailSchema, signal }),
  create: (input: CreateApiLibraryApiInput) =>
    apiFetch(`${BASE}/apis`, { method: 'POST', body: input, schema: apiLibraryDetailSchema }),
  update: (id: string, input: UpdateApiLibraryApiInput) =>
    apiFetch(`${BASE}/apis/${enc(id)}`, {
      method: 'PATCH',
      body: input,
      schema: apiLibraryDetailSchema,
    }),
  remove: (id: string, force = false) =>
    apiFetch(`${BASE}/apis/${enc(id)}`, { method: 'DELETE', query: force ? { force: true } : {} }),
  usage: (id: string, signal?: AbortSignal) =>
    apiFetch(`${BASE}/apis/${enc(id)}/usage`, {
      schema: apiLibraryUsageResponseSchema,
      signal,
    }),
  test: (input: TestApiLibraryApiInput) =>
    apiFetch(`${BASE}/apis/test`, {
      method: 'POST',
      body: input,
      schema: testApiLibraryApiResponseSchema,
    }),
  testFunction: (input: TestApiLibraryFunctionInput) =>
    apiFetch(`${BASE}/apis/test-function`, {
      method: 'POST',
      body: input,
      schema: testApiLibraryFunctionResponseSchema,
    }),
  contactProperties: (signal?: AbortSignal) =>
    apiFetch(`${BASE}/contact-properties`, {
      schema: apiLibraryContactPropertiesResponseSchema,
      signal,
    }),
  apiLogs: (id: string, query: LogsQuery, signal?: AbortSignal) =>
    apiFetch(`${BASE}/apis/${enc(id)}/logs`, {
      query: asQuery(query),
      schema: listApiLibraryLogsResponseSchema,
      signal,
    }).then((r) => normalizePage(r, query)),
  logs: (query: LogsQuery & { apiId?: string }, signal?: AbortSignal) =>
    apiFetch(`${BASE}/logs`, {
      query: asQuery(query),
      schema: listApiLibraryLogsResponseSchema,
      signal,
    }).then((r) => normalizePage(r, query)),
  log: (id: string, signal?: AbortSignal) =>
    apiFetch(`${BASE}/logs/${enc(id)}`, { schema: apiLibraryLogDetailSchema, signal }),
};
