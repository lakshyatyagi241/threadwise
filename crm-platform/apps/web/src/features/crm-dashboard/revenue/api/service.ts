import {
  revenueExportListSchema,
  revenueExportSchema,
  revenueReportResponseSchema,
  type RequestRevenueExport,
  type RevenueExport,
  type RevenueExportList,
  type RevenueReportResponse,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

const BASE = '/crm/revenue';
const enc = encodeURIComponent;

export const revenueApi = {
  report(
    query: Record<string, string | undefined>,
    signal?: AbortSignal,
  ): Promise<RevenueReportResponse> {
    return apiFetch(BASE, { query, schema: revenueReportResponseSchema, signal });
  },
  exports(signal?: AbortSignal): Promise<RevenueExportList> {
    return apiFetch(`${BASE}/exports`, { schema: revenueExportListSchema, signal });
  },
  requestExport(body: RequestRevenueExport): Promise<RevenueExport> {
    return apiFetch(`${BASE}/exports`, { method: 'POST', body, schema: revenueExportSchema });
  },
};

/** The finished file, as a same-origin download link (the proxy attaches the session). */
export const revenueExportFileUrl = (exportId: string): string =>
  `/api/v2${BASE}/exports/${enc(exportId)}/download`;
