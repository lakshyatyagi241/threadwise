import {
  auditLogDetailSchema,
  auditLogExportListSchema,
  auditLogExportSchema,
  auditLogFacetsSchema,
  auditLogListResponseSchema,
  auditLogSettingsSchema,
  type AuditLogDetail,
  type AuditLogExport,
  type AuditLogExportList,
  type AuditLogFacets,
  type AuditLogFilters,
  type AuditLogListResponse,
  type AuditLogSettings,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

const BASE = '/audit-log';
const enc = encodeURIComponent;

/** Only the filters the API understands, as a flat query. */
const query = (f: AuditLogFilters): Record<string, string | number | boolean | undefined> => ({
  from: f.from,
  to: f.to,
  actorId: f.actorId,
  actorType: f.actorType,
  module: f.module,
  action: f.action,
  recordId: f.recordId,
  requestId: f.requestId,
  q: f.q,
  actAs: f.actAs ? true : undefined,
});

export const auditLogApi = {
  list(
    filters: AuditLogFilters,
    cursor: string | undefined,
    signal?: AbortSignal,
  ): Promise<AuditLogListResponse> {
    return apiFetch(BASE, {
      query: { ...query(filters), cursor, limit: 50 },
      schema: auditLogListResponseSchema,
      signal,
    });
  },
  /** Opening an entry is audited by the server (who looked at which entry). */
  detail(id: string, signal?: AbortSignal): Promise<AuditLogDetail> {
    return apiFetch(`${BASE}/${enc(id)}`, { schema: auditLogDetailSchema, signal });
  },
  facets(
    range: Pick<AuditLogFilters, 'from' | 'to'>,
    signal?: AbortSignal,
  ): Promise<AuditLogFacets> {
    return apiFetch(`${BASE}/facets`, {
      query: { from: range.from, to: range.to },
      schema: auditLogFacetsSchema,
      signal,
    });
  },
  settings(signal?: AbortSignal): Promise<AuditLogSettings> {
    return apiFetch(`${BASE}/settings`, { schema: auditLogSettingsSchema, signal });
  },
  exports(signal?: AbortSignal): Promise<AuditLogExportList> {
    return apiFetch(`${BASE}/exports`, { schema: auditLogExportListSchema, signal });
  },
  requestExport(filters: AuditLogFilters): Promise<AuditLogExport> {
    return apiFetch(`${BASE}/exports`, {
      method: 'POST',
      body: filters,
      schema: auditLogExportSchema,
    });
  },
};

/** The finished export, as a same-origin download link (the proxy attaches the session). */
export const auditLogExportFileUrl = (exportId: string): string =>
  `/api/v2${BASE}/exports/${enc(exportId)}/download`;
