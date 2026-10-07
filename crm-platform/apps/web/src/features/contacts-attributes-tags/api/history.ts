'use client';

import { useQuery } from '@tanstack/react-query';
import { exportHistoryResponseSchema, pageResponseSchema } from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { contactImportJobSchema } from './schemas';

/** How many past imports and exports the history shows. */
export const HISTORY_LIMIT = 50;

/** Recent imports, newest first; polls while one is still queued or running. */
export function useImportJobs(enabled: boolean) {
  return useQuery({
    queryKey: ['cat', 'history', 'imports'],
    enabled,
    retry: false,
    queryFn: ({ signal }) =>
      apiFetch('/contacts/import/jobs', {
        query: { limit: HISTORY_LIMIT },
        schema: pageResponseSchema(contactImportJobSchema),
        signal,
      }),
    refetchInterval: (q) =>
      q.state.data?.data.some((j) => j.status === 'queued' || j.status === 'running')
        ? 3000
        : false,
  });
}

/** Recent exports of contacts, newest first (from the audit trail: who, when, how many rows). */
export function useExportHistory(enabled: boolean) {
  return useQuery({
    queryKey: ['cat', 'history', 'exports'],
    enabled,
    retry: false,
    queryFn: ({ signal }) =>
      apiFetch('/contacts/exports', {
        query: { limit: HISTORY_LIMIT },
        schema: exportHistoryResponseSchema,
        signal,
      }),
  });
}
