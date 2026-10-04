'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  adminAnalyticsSchema,
  adminOverviewSchema,
  type AdminOverviewWindow,
} from '@crm/contracts';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';

/** The operator dashboards' calls, through the same-origin operator proxy and parsed with the shared contracts. */
export const useAdminOverview = (window: AdminOverviewWindow) =>
  useQuery({
    queryKey: ['operator', 'dash', 'overview', window],
    queryFn: ({ signal }) =>
      operatorFetch('/dashboard/overview', {
        query: { window },
        schema: adminOverviewSchema,
        signal,
      }),
    placeholderData: keepPreviousData,
    retry: false,
  });

export const useAdminAnalytics = (days: number) =>
  useQuery({
    queryKey: ['operator', 'dash', 'analytics', days],
    queryFn: ({ signal }) =>
      operatorFetch('/dashboard/analytics', {
        query: { days },
        schema: adminAnalyticsSchema,
        signal,
      }),
    placeholderData: keepPreviousData,
    retry: false,
  });

/** The CSV download address; the browser sends the operator cookie through the proxy. */
export const adminExportUrl = (days: number) =>
  `/api/platform/dashboard/analytics/export?days=${days}`;
