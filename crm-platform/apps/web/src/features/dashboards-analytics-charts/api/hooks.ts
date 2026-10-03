'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { DashRange } from '@crm/contracts';
import { dashApi, type AnalyticsParams } from './service';

export const useSummary = (range: DashRange) =>
  useQuery({
    queryKey: ['dash', 'summary', range],
    queryFn: ({ signal }) => dashApi.summary(range, signal),
    placeholderData: keepPreviousData,
    retry: false,
  });

export const useThroughput = (range: DashRange) =>
  useQuery({
    queryKey: ['dash', 'throughput', range],
    queryFn: ({ signal }) => dashApi.throughput(range, signal),
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

export const useWidgets = (range: DashRange) =>
  useQuery({
    queryKey: ['dash', 'widgets', range],
    queryFn: ({ signal }) => dashApi.widgets(range, signal),
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
