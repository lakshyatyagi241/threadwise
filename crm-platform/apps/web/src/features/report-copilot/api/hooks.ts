'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationOptions,
} from '@tanstack/react-query';
import {
  adminAnalyticsSchema,
  adminOverviewSchema,
  type AdminOverviewWindow,
  type ReportDocument,
  type ReportDocumentListResponse,
  type ReportScope,
} from '@crm/contracts';
import { dashApi } from '@/features/dashboards-analytics-charts/api/service';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { reportCopilotApi } from './service';

export const reportDocumentsKey = (scope: ReportScope) =>
  ['report-copilot', scope, 'documents'] as const;

/** The library read, as options so a test (or a prefetch) can run it without a component. */
export const documentsQuery = (scope: ReportScope) => ({
  queryKey: reportDocumentsKey(scope),
  queryFn: ({ signal }: { signal?: AbortSignal }): Promise<ReportDocumentListResponse> =>
    reportCopilotApi.list(scope, signal),
  retry: false as const,
});

/** Adds a file. The library is read again on success and on failure (a file that cannot be read is stored as a `failed` row). */
export const uploadMutation = (
  scope: ReportScope,
  qc: QueryClient,
): UseMutationOptions<ReportDocument, Error, File> => ({
  mutationFn: (file) => reportCopilotApi.upload(scope, file),
  onSettled: () => qc.invalidateQueries({ queryKey: reportDocumentsKey(scope) }),
});

export const deleteMutation = (
  scope: ReportScope,
  qc: QueryClient,
): UseMutationOptions<void, Error, string> => ({
  mutationFn: (id) => reportCopilotApi.remove(scope, id),
  onSuccess: () => qc.invalidateQueries({ queryKey: reportDocumentsKey(scope) }),
});

/** The document library the assistant reads. */
export const useReportDocuments = (scope: ReportScope) => useQuery(documentsQuery(scope));

export const useUploadReportDocument = (scope: ReportScope) =>
  useMutation(uploadMutation(scope, useQueryClient()));

export const useDeleteReportDocument = (scope: ReportScope) =>
  useMutation(deleteMutation(scope, useQueryClient()));

/*
 * The responses behind live-bound figures. Each uses the key of the Dashboard's (or the console's) own query, so a report and the
 * screen share one cache entry. A hook is idle (no request) when `args` is null: the report has no matching range, or the figure
 * belongs to the other scope.
 */
export const useLiveSummary = (range: '7d' | '30d' | null) =>
  useQuery({
    queryKey: ['dash', 'summary', range ?? 'none', '', ''],
    queryFn: ({ signal }) => dashApi.summary(range ?? '7d', {}, signal),
    enabled: range !== null,
    retry: false,
    staleTime: 30_000,
    refetchInterval: range === null ? false : 60_000,
  });

export const useLiveWidgets = (on: boolean) =>
  useQuery({
    queryKey: ['dash', 'widgets', '7d', '', ''],
    queryFn: ({ signal }) => dashApi.widgets('7d', {}, signal),
    enabled: on,
    retry: false,
    staleTime: 30_000,
    refetchInterval: on ? 60_000 : false,
  });

export const useLiveOverview = (window: AdminOverviewWindow | null) =>
  useQuery({
    queryKey: ['operator', 'dash', 'overview', window ?? 'none'],
    queryFn: ({ signal }) =>
      operatorFetch('/dashboard/overview', {
        query: { window: window ?? '7d' },
        schema: adminOverviewSchema,
        signal,
      }),
    enabled: window !== null,
    retry: false,
    staleTime: 30_000,
    refetchInterval: window === null ? false : 60_000,
  });

export const useLiveAnalytics = (days: number | null) =>
  useQuery({
    queryKey: ['operator', 'dash', 'analytics', days ?? 0],
    queryFn: ({ signal }) =>
      operatorFetch('/dashboard/analytics', {
        query: { days: days ?? 30 },
        schema: adminAnalyticsSchema,
        signal,
      }),
    enabled: days !== null,
    retry: false,
    staleTime: 30_000,
    refetchInterval: days === null ? false : 60_000,
  });
