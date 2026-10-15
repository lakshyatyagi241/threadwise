'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  REALTIME_EVENT,
  cancelHistoryImportResultSchema,
  historyImportResponseSchema,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { useRealtimeEvent } from '@/lib/realtime';
import { historyPollMs } from '../lib/history-model';
import { KEYS } from './devices';

const historyKey = (id: string) => ['wadev', 'history', id] as const;

/** The import of existing chats. Devices are named by uuid; the cancel carries an Idempotency-Key through `apiFetch`. */
export const historyApi = {
  status: (id: string, signal?: AbortSignal) =>
    apiFetch(`/devices/${id}/history-import`, { schema: historyImportResponseSchema, signal }),
  cancel: (id: string) =>
    apiFetch(`/devices/${id}/history-import/cancel`, {
      method: 'POST',
      schema: cancelHistoryImportResultSchema,
    }),
};

/** Re-reads every 3 s while the run can still change, then stops: a finished import is read once. */
export function useHistoryImport(id: string, enabled = true) {
  const qc = useQueryClient();
  // The run ended (one hint per run): read the card again at once instead of waiting for the next poll.
  useRealtimeEvent(REALTIME_EVENT.historyImported, (e) => {
    if (e.payload.deviceId !== id) return;
    void qc.invalidateQueries({ queryKey: historyKey(id) });
    void qc.invalidateQueries({ queryKey: KEYS.detail(id) });
  });
  return useQuery({
    queryKey: historyKey(id),
    queryFn: ({ signal }) => historyApi.status(id, signal),
    enabled,
    refetchInterval: (q) => (q.state.data ? historyPollMs(q.state.data.status.state) : false),
    refetchIntervalInBackground: false,
    retry: false,
  });
}

export function useCancelHistoryImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => historyApi.cancel(id),
    onSuccess: (_r, id) => {
      void qc.invalidateQueries({ queryKey: historyKey(id) });
      void qc.invalidateQueries({ queryKey: KEYS.detail(id) });
      void qc.invalidateQueries({ queryKey: KEYS.list });
    },
  });
}
