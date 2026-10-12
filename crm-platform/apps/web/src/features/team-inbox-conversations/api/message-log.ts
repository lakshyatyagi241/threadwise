'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateMessageLogExportInput, MessageLogExport } from '@crm/contracts';
import { transientRetry, transientRetryDelay } from '@/lib/api/retry';
import { inboxApi } from './service';

export const LOG_KEYS = {
  message: (id: string) => ['inbox', 'message-log', id] as const,
  exports: ['inbox', 'message-log-exports'] as const,
};

/** The delivery log of one message. Fetched when the dialog opens, and read again each time (a receipt may have arrived since). */
export function useMessageLog(messageId: string | null) {
  return useQuery({
    queryKey: LOG_KEYS.message(messageId ?? ''),
    queryFn: ({ signal }) => inboxApi.messageLog(messageId!, signal),
    enabled: messageId !== null,
    staleTime: 0,
    retry: transientRetry,
    retryDelay: transientRetryDelay,
  });
}

const ACTIVE = new Set<MessageLogExport['status']>(['queued', 'running']);

/** The workspace's latest exports. While one is being prepared the list is read every few seconds, so the page flips to Ready by itself. */
export function useLogExports() {
  return useQuery({
    queryKey: LOG_KEYS.exports,
    queryFn: ({ signal }) => inboxApi.logExports(signal),
    staleTime: 5_000,
    refetchInterval: (q) => (q.state.data?.data.some((e) => ACTIVE.has(e.status)) ? 4_000 : false),
    retry: transientRetry,
    retryDelay: transientRetryDelay,
  });
}

export function useRequestLogExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMessageLogExportInput) => inboxApi.requestLogExport(input),
    onSettled: () => qc.invalidateQueries({ queryKey: LOG_KEYS.exports }),
  });
}
