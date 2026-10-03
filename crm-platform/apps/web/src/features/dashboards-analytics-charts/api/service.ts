import {
  analyticsResponseSchema,
  dashWidgetsSchema,
  type DashWidgets,
  dashSummaryResponseSchema,
  dashThroughputResponseSchema,
  type AnalyticsResponse,
  type DashRange,
  type DashSummaryResponse,
  type DashThroughputResponse,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

export interface AnalyticsParams {
  range: '7d' | '30d' | '90d' | 'custom';
  from?: string;
  to?: string;
}

/** Every dashboard call, parsed with the shared contracts. */
export const dashApi = {
  summary(range: DashRange, signal?: AbortSignal): Promise<DashSummaryResponse> {
    return apiFetch('/dashboard/summary', {
      query: { range },
      schema: dashSummaryResponseSchema,
      signal,
    });
  },
  widgets(range: DashRange, signal?: AbortSignal): Promise<DashWidgets> {
    return apiFetch('/dashboard/widgets', {
      query: { range },
      schema: dashWidgetsSchema,
      signal,
    });
  },
  throughput(range: DashRange, signal?: AbortSignal): Promise<DashThroughputResponse> {
    return apiFetch('/dashboard/throughput', {
      query: { range },
      schema: dashThroughputResponseSchema,
      signal,
    });
  },
  analytics(p: AnalyticsParams, signal?: AbortSignal): Promise<AnalyticsResponse> {
    return apiFetch('/analytics/overview', {
      query: {
        range: p.range,
        from: p.range === 'custom' ? p.from : undefined,
        to: p.range === 'custom' ? p.to : undefined,
      },
      schema: analyticsResponseSchema,
      signal,
    });
  },
  /** The CSV download address; the browser fetches it with the session cookie through the same-origin proxy. */
  exportUrl(p: AnalyticsParams): string {
    const q = new URLSearchParams({ range: p.range });
    if (p.range === 'custom') {
      if (p.from) q.set('from', p.from);
      if (p.to) q.set('to', p.to);
    }
    return `/api/v2/analytics/export?${q.toString()}`;
  },
};
