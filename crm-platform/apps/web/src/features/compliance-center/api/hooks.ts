'use client';

import { useQuery } from '@tanstack/react-query';
import { complianceApi } from './service';

export const KEYS = {
  all: ['compliance-center'] as const,
  settings: ['compliance-center', 'settings'] as const,
  checklist: ['compliance-center', 'checklist'] as const,
  subprocessors: ['compliance-center', 'subprocessors'] as const,
  dnc: ['compliance-center', 'dnc'] as const,
  links: ['compliance-center', 'links'] as const,
};

export function useComplianceSettings(enabled: boolean) {
  return useQuery({
    queryKey: KEYS.settings,
    enabled,
    retry: false,
    staleTime: 15_000,
    queryFn: ({ signal }) => complianceApi.settings(signal),
  });
}

/** Re-read on every visit to the tab: the checklist follows the data other screens change. */
export function useComplianceChecklist(enabled: boolean) {
  return useQuery({
    queryKey: KEYS.checklist,
    enabled,
    retry: false,
    staleTime: 0,
    queryFn: ({ signal }) => complianceApi.checklist(signal),
  });
}

/** One page of the Do-Not-Call list; `q` narrows by a part of the number. */
export function useDncList(enabled: boolean, q: string, cursor: string | undefined) {
  return useQuery({
    queryKey: [...KEYS.dnc, q, cursor ?? ''] as const,
    enabled,
    retry: false,
    staleTime: 5_000,
    queryFn: ({ signal }) => complianceApi.dnc({ q: q || undefined, cursor, limit: 50 }, signal),
  });
}

export function useSubprocessors(enabled: boolean) {
  return useQuery({
    queryKey: KEYS.subprocessors,
    enabled,
    retry: false,
    staleTime: 15_000,
    queryFn: ({ signal }) => complianceApi.subprocessors(signal),
  });
}

/** The workspace links and default wording that the form builder and the notice editor offer. Quiet on failure: they work without it. */
export function useComplianceLinks(enabled = true) {
  return useQuery({
    queryKey: KEYS.links,
    enabled,
    retry: false,
    staleTime: 30_000,
    queryFn: ({ signal }) => complianceApi.links(signal),
  });
}
