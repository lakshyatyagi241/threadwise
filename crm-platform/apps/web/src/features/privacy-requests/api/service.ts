import type { z } from 'zod';
import type {
  ErasePrivacyRequestInput,
  HoldPrivacyRequestInput,
  ListPrivacyRequestsQuery,
  RejectPrivacyRequestInput,
  VerifyPrivacyRequestInput,
} from '@crm/contracts';
import {
  createPrivacyRequestSchema,
  privacyErasureReportSchema,
  privacyExportSchema,
  privacyRequestDetailSchema,
  privacyRequestListSchema,
  privacyRequestSchema,
  privacyRequestsSettingsSchema,
  privacySubjectSearchResultSchema,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

/** What a screen sends to create a request: the channel and the history choice have server defaults. */
export type CreatePrivacyRequestBody = z.input<typeof createPrivacyRequestSchema>;

const BASE = '/privacy';
const enc = encodeURIComponent;

/** The list filters the screen sends (the page size and cursor are the hook's). */
export type RequestFilters = Pick<ListPrivacyRequestsQuery, 'status' | 'requestType'> & {
  overdue?: boolean;
};

export const privacyApi = {
  settings: (signal?: AbortSignal) =>
    apiFetch(`${BASE}/settings`, { schema: privacyRequestsSettingsSchema, signal }),
  saveSettings: (slaDays: number) =>
    apiFetch(`${BASE}/settings`, {
      method: 'PATCH',
      body: { slaDays },
      schema: privacyRequestsSettingsSchema,
    }),
  searchSubjects: (q: string, signal?: AbortSignal) =>
    apiFetch(`${BASE}/subjects`, {
      query: { q },
      schema: privacySubjectSearchResultSchema,
      signal,
    }),
  list: (filters: RequestFilters, cursor?: string, signal?: AbortSignal) =>
    apiFetch(`${BASE}/requests`, {
      query: {
        status: filters.status,
        requestType: filters.requestType,
        overdue: filters.overdue ? true : undefined,
        limit: 25,
        cursor,
      },
      schema: privacyRequestListSchema,
      signal,
    }),
  detail: (id: string, signal?: AbortSignal) =>
    apiFetch(`${BASE}/requests/${enc(id)}`, { schema: privacyRequestDetailSchema, signal }),
  create: (input: CreatePrivacyRequestBody) =>
    apiFetch(`${BASE}/requests`, { method: 'POST', body: input, schema: privacyRequestSchema }),
  verify: (id: string, input: VerifyPrivacyRequestInput) =>
    apiFetch(`${BASE}/requests/${enc(id)}/verify`, {
      method: 'POST',
      body: input,
      schema: privacyRequestSchema,
    }),
  hold: (id: string, input: HoldPrivacyRequestInput) =>
    apiFetch(`${BASE}/requests/${enc(id)}/hold`, {
      method: 'POST',
      body: input,
      schema: privacyRequestSchema,
    }),
  reject: (id: string, input: RejectPrivacyRequestInput) =>
    apiFetch(`${BASE}/requests/${enc(id)}/reject`, {
      method: 'POST',
      body: input,
      schema: privacyRequestSchema,
    }),
  complete: (id: string) =>
    apiFetch(`${BASE}/requests/${enc(id)}/complete`, {
      method: 'POST',
      body: {},
      schema: privacyRequestSchema,
    }),
  requestExport: (id: string) =>
    apiFetch(`${BASE}/requests/${enc(id)}/export`, {
      method: 'POST',
      body: {},
      schema: privacyExportSchema,
    }),
  erase: (id: string, input: ErasePrivacyRequestInput) =>
    apiFetch(`${BASE}/requests/${enc(id)}/erase`, {
      method: 'POST',
      body: input,
      schema: privacyErasureReportSchema,
    }),
};

/** A built export as a same-origin download link (the proxy attaches the session). */
export const privacyExportFileUrl = (requestId: string, exportId: string) =>
  `/api/v2${BASE}/requests/${enc(requestId)}/exports/${enc(exportId)}/download`;
