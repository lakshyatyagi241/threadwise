/**
 * Error codes of the team inbox (the agent-facing API over conversations). Spread into ERROR_CODES (common/errors.ts) so the API and
 * the web branch on one registry. The conversation and message codes (CONVERSATION_NOT_FOUND, MESSAGE_NOT_RETRYABLE, ...) live with
 * the conversation core in `chat-conversations/conversation-errors.ts`; SERVICE_WINDOW_CLOSED, PLAN_LIMIT_REACHED and
 * CHANNEL_DISCONNECTED keep their existing names.
 */
export const INBOX_ERROR_CODES = {
  /** No such note on this conversation (a note of another conversation or workspace is the same answer). */
  CONVERSATION_NOTE_NOT_FOUND: 'CONVERSATION_NOTE_NOT_FOUND',
  /** A template send was asked for, and the template library (TPL) is not part of this deployment yet. */
  INBOX_TEMPLATES_UNAVAILABLE: 'INBOX_TEMPLATES_UNAVAILABLE',
  /** Only the author of a note, or someone who may assign conversations (a manager), deletes it. */
  INBOX_NOTE_NOT_DELETABLE: 'INBOX_NOTE_NOT_DELETABLE',
} as const;
