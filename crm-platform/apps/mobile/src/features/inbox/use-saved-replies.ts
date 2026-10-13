import type { ChannelKind } from '@crm/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { fetchSavedReplies, fillSavedReply } from './saved-replies-api';

/** The saved replies for the picker. Only asked for while the sheet is open; the library changes rarely, so a minute is kept. */
export const useSavedReplies = (
  q: string,
  channelKind: ChannelKind | undefined,
  enabled: boolean,
) =>
  useQuery({
    queryKey: ['inbox', 'saved-replies', channelKind ?? '', q.trim()],
    queryFn: ({ signal }) => fetchSavedReplies(q, channelKind, signal),
    staleTime: 60_000,
    enabled,
  });

/** Fills one reply in for the open conversation. */
export const useFillSavedReply = (conversationId: string) =>
  useMutation({ mutationFn: (replyId: string) => fillSavedReply(replyId, conversationId) });
