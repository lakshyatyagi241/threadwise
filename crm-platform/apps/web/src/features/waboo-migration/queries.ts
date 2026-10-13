import { useQuery } from '@tanstack/react-query';
import {
  wabooMigrationBatchDetailSchema,
  wabooMigrationBatchesResponseSchema,
  wabooMigrationReadinessSchema,
  wabooMigrationRunSchema,
  wabooMigrationRunsResponseSchema,
  type WabooMigrationBatch,
  type WabooMigrationRun,
} from '@crm/contracts';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';

export const RUNS_QUERY_KEY = ['operator', 'waboo-migration', 'runs'] as const;
export const BATCHES_QUERY_KEY = ['operator', 'waboo-migration', 'batches'] as const;
export const runQueryKey = (id: string) => ['operator', 'waboo-migration', 'run', id] as const;
export const batchQueryKey = (id: string) => ['operator', 'waboo-migration', 'batch', id] as const;
export const READINESS_KEY = ['operator', 'waboo-migration', 'readiness'] as const;

/** How often an active run is re-read: the verifier result is shown live. */
export const POLL_MS = 3000;

export const isActive = (r: Pick<WabooMigrationRun, 'status'> | undefined): boolean =>
  r?.status === 'queued' || r?.status === 'running';
export const isBatchActive = (b: Pick<WabooMigrationBatch, 'status'> | undefined): boolean =>
  b?.status === 'queued' || b?.status === 'running';

/** The runs list; re-read every few seconds while any run is queued or running. */
export function useRuns() {
  return useQuery({
    queryKey: RUNS_QUERY_KEY,
    queryFn: ({ signal }) =>
      operatorFetch('/waboo-migration/runs', {
        query: { limit: 30 },
        schema: wabooMigrationRunsResponseSchema,
        signal,
      }),
    refetchInterval: (q) => (q.state.data?.data.some(isActive) ? POLL_MS : false),
    refetchOnWindowFocus: false,
  });
}

/** One run; re-read every few seconds while it is queued or running. */
export function useRun(id: string | null) {
  return useQuery({
    queryKey: runQueryKey(id ?? ''),
    enabled: id !== null,
    queryFn: ({ signal }) =>
      operatorFetch(`/waboo-migration/runs/${id}`, { schema: wabooMigrationRunSchema, signal }),
    refetchInterval: (q) => (isActive(q.state.data) ? POLL_MS : false),
    refetchOnWindowFocus: false,
  });
}

export function useBatches() {
  return useQuery({
    queryKey: BATCHES_QUERY_KEY,
    queryFn: ({ signal }) =>
      operatorFetch('/waboo-migration/batches', {
        query: { limit: 30 },
        schema: wabooMigrationBatchesResponseSchema,
        signal,
      }),
    refetchInterval: (q) => (q.state.data?.data.some(isBatchActive) ? POLL_MS : false),
    refetchOnWindowFocus: false,
  });
}

/** One batch with every organization's steps and verdict; re-read while it is queued or running. */
export function useBatch(id: string | null) {
  return useQuery({
    queryKey: batchQueryKey(id ?? ''),
    enabled: id !== null,
    queryFn: ({ signal }) =>
      operatorFetch(`/waboo-migration/batches/${id}`, {
        schema: wabooMigrationBatchDetailSchema,
        signal,
      }),
    refetchInterval: (q) => (isBatchActive(q.state.data) ? POLL_MS : false),
    refetchOnWindowFocus: false,
  });
}

/**
 * Is the latest dry run of each organization green and fresh? The Migrate buttons stay disabled until it is. Re-read every few
 * seconds so a dry run that just finished unlocks the button without a reload.
 */
export function useReadiness(organizationIds: string[]) {
  return useQuery({
    queryKey: [...READINESS_KEY, organizationIds.join(',')],
    enabled: organizationIds.length > 0,
    queryFn: ({ signal }) =>
      operatorFetch('/waboo-migration/readiness', {
        method: 'POST',
        body: { organizationIds },
        schema: wabooMigrationReadinessSchema,
        signal,
      }),
    refetchInterval: 5000,
    refetchOnWindowFocus: false,
  });
}
