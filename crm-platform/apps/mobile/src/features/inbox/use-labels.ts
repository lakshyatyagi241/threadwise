import type { ConversationSummary, InboxConversationDetail } from '@crm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { applyLabel, fetchLabelLibrary, withdrawLabel } from './labels-api';
import { detailKey, listKey } from './use-inbox';

const libraryKey = ['inbox', 'labels'] as const;
const ONE_MINUTE = 60_000;

/** The workspace's labels: the ones that can be chosen. No request until the sheet that needs them is open. */
export const useLabelLibrary = (enabled: boolean) =>
  useQuery({
    queryKey: libraryKey,
    queryFn: ({ signal }) => fetchLabelLibrary(signal),
    enabled,
    staleTime: ONE_MINUTE,
  });

/**
 * Puts a label on the conversation (by id, or by a new name) or takes one off. The answer is the conversation as it is now, so the
 * open thread shows it at once (with the new row version the next status change needs); the list, the thread and the library
 * (which counts conversations per label) are read again either way.
 */
export function useChangeLabels(conversationId: string) {
  const queryClient = useQueryClient();
  const show = (changed: ConversationSummary) => {
    queryClient.setQueryData<InboxConversationDetail>(detailKey(conversationId), (old) =>
      old
        ? {
            ...old,
            labels: changed.labels,
            rowVersion: changed.rowVersion,
            updatedAt: changed.updatedAt,
          }
        : old,
    );
  };
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: listKey }),
      queryClient.invalidateQueries({ queryKey: detailKey(conversationId) }),
      queryClient.invalidateQueries({ queryKey: libraryKey }),
    ]);
  const attach = useMutation({
    mutationFn: (label: { tagId: string } | { name: string }) =>
      applyLabel(conversationId, label, Crypto.randomUUID()),
    onSuccess: show,
    onSettled: refresh,
  });
  const detach = useMutation({
    mutationFn: (tagId: string) => withdrawLabel(conversationId, tagId),
    onSuccess: show,
    onSettled: refresh,
  });
  return { attach, detach };
}
