import {
  aiModelsResponseSchema,
  inboxRewriteResponseSchema,
  type InboxRewriteInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api';

/** The Smart AI Assistant of the message box: the agent's draft rewritten by the workspace's AI. Nothing is stored or sent. */

/** The text models this workspace may use (the model picker of every AI editor). Needs `aiadm.models.read`. */
export const fetchAiModels = (signal?: AbortSignal) =>
  apiFetch('/v2/ai/models', { schema: aiModelsResponseSchema, signal });

/**
 * Condense, fix grammar, positive tone or translate (which needs `language`, the English name of the language). The answer is the
 * new text for the box; the person reads and edits it before sending. Needs `inbox.conversation.reply`.
 */
export const rewriteText = (input: InboxRewriteInput) =>
  apiFetch('/v2/inbox/ai/rewrite', {
    method: 'POST',
    body: input,
    schema: inboxRewriteResponseSchema,
  });
