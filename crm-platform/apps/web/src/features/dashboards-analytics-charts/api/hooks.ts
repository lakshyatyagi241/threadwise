'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DashRange, QuickAccessItem } from '@crm/contracts';
import { dashApi, type AnalyticsParams, type CustomDates } from './service';

export const useSummary = (range: DashRange, custom: CustomDates = {}) =>
  useQuery({
    queryKey: ['dash', 'summary', range, custom.from ?? '', custom.to ?? ''],
    queryFn: ({ signal }) => dashApi.summary(range, custom, signal),
    placeholderData: keepPreviousData,
    retry: false,
  });

export const useThroughput = (range: DashRange, custom: CustomDates = {}) =>
  useQuery({
    queryKey: ['dash', 'throughput', range, custom.from ?? '', custom.to ?? ''],
    queryFn: ({ signal }) => dashApi.throughput(range, custom, signal),
    placeholderData: keepPreviousData,
    retry: false,
  });

export const useAnalytics = (p: AnalyticsParams) =>
  useQuery({
    queryKey: ['dash', 'analytics', p.range, p.from ?? '', p.to ?? ''],
    queryFn: ({ signal }) => dashApi.analytics(p, signal),
    placeholderData: keepPreviousData,
    retry: false,
  });

export const useWidgets = (range: DashRange, custom: CustomDates = {}) =>
  useQuery({
    queryKey: ['dash', 'widgets', range, custom.from ?? '', custom.to ?? ''],
    queryFn: ({ signal }) => dashApi.widgets(range, custom, signal),
    placeholderData: keepPreviousData,
    retry: false,
  });

export const usePanels = (p: AnalyticsParams) =>
  useQuery({
    queryKey: ['dash', 'panels', p.range, p.from ?? '', p.to ?? ''],
    queryFn: ({ signal }) => dashApi.panels(p, signal),
    placeholderData: keepPreviousData,
    retry: false,
  });

export const useQuickAccess = () =>
  useQuery({
    queryKey: ['dash', 'quick-access'],
    queryFn: ({ signal }) => dashApi.quickAccess(signal),
    retry: false,
  });

export const useSaveQuickAccess = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: QuickAccessItem[]) => dashApi.saveQuickAccess(items),
    onSuccess: (data) => qc.setQueryData(['dash', 'quick-access'], data),
  });
};
