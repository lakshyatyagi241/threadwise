import {
  savedReplyListResponseSchema,
  useSavedReplyResponseSchema,
  type ChannelKind,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api';

/** Saved (quick) replies: the workspace's library of reusable answers an agent puts into the message box. */

/** How many replies the picker asks for at once; typing narrows the list on the server. */
export const SAVED_REPLIES_PAGE = 20;

/**
 * The replies the person may use on this channel kind (a reply restricted to other channels is left out), most used first.
 * Needs `inbox.conversation.reply`.
 */
export const fetchSavedReplies = (
  q: string,
  channelKind: ChannelKind | undefined,
  signal?: AbortSignal,
) =>
  apiFetch('/v2/inbox/saved-replies', {
    query: { q: q.trim() || undefined, channelKind, limit: SAVED_REPLIES_PAGE },
    schema: savedReplyListResponseSchema,
    signal,
  });

/**
 * Fills a reply in for this conversation (`{{first_name}}`, the agent's name...) and counts the use. It sends nothing: the text goes
 * into the message box for the person to read and send. `issues` names the variables that could not be filled.
 */
export const fillSavedReply = (id: string, conversationId: string) =>
  apiFetch(`/v2/inbox/saved-replies/${id}/use`, {
    method: 'POST',
    body: { conversationId },
    schema: useSavedReplyResponseSchema,
  });
