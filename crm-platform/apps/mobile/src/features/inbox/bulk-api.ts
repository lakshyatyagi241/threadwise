import { bulkConversationsResponseSchema, type BulkConversationAction } from '@crm/contracts';
import { apiFetch } from '@/lib/api';

/**
 * Applies one action to several conversations at once (`inbox.conversation.bulk` and the right of the action itself). Each
 * conversation is checked on its own; the answer says, for every one, whether it was done, unchanged or failed (and why), and one
 * failure never undoes the others. The key makes a repeat of the same press one run.
 */
export const runBulkAction = (
  ids: readonly string[],
  action: BulkConversationAction,
  idempotencyKey: string,
) =>
  apiFetch('/v2/inbox/conversations/bulk', {
    method: 'POST',
    body: { ids, action },
    schema: bulkConversationsResponseSchema,
    idempotencyKey,
  });
