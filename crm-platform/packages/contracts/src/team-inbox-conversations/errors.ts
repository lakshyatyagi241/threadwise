/**
 * Error codes of the team inbox (the agent-facing API over conversations). Spread into ERROR_CODES (common/errors.ts) so the API and
 * the web branch on one registry. The conversation and message codes (CONVERSATION_NOT_FOUND, MESSAGE_NOT_RETRYABLE, ...) live with
 * the conversation core in `chat-conversations/conversation-errors.ts`; SERVICE_WINDOW_CLOSED, PLAN_LIMIT_REACHED and
 * CHANNEL_DISCONNECTED keep their existing names.
 */
export const INBOX_ERROR_CODES = {
  /** No such SLA policy in this workspace. */
  SLA_POLICY_NOT_FOUND: 'SLA_POLICY_NOT_FOUND',
  /** No such tag in this workspace (a tag of another workspace is the same answer). The code keeps its original name `INBOX_LABEL_*` so clients that branch on it keep working. */
  INBOX_LABEL_NOT_FOUND: 'INBOX_LABEL_NOT_FOUND',
  /** Naming a tag that does not exist yet creates it, which needs `inbox.tag.manage`. */
  INBOX_LABEL_CREATE_FORBIDDEN: 'INBOX_LABEL_CREATE_FORBIDDEN',
  /** The conversation is assigned to another agent: only its assignee sends into it (assign it to yourself first). 403. */
  CONVERSATION_ASSIGNED_TO_OTHER: 'CONVERSATION_ASSIGNED_TO_OTHER',
  /** No such note on this conversation (a note of another conversation or workspace is the same answer). */
  CONVERSATION_NOTE_NOT_FOUND: 'CONVERSATION_NOTE_NOT_FOUND',
  /** A template send was asked for, and the template library (TPL) is not part of this deployment yet. */
  INBOX_TEMPLATES_UNAVAILABLE: 'INBOX_TEMPLATES_UNAVAILABLE',
  /**
   * The template picked cannot be sent into this conversation: it is not approved (or is paused), it belongs to another WhatsApp number,
   * or it needs something the inbox cannot fill in yet (a media header, a link or header variable). `errors[]` names the reason.
   */
  INBOX_TEMPLATE_NOT_SENDABLE: 'INBOX_TEMPLATE_NOT_SENDABLE',
  /** Only the author of a note, or someone who may assign conversations (a manager), deletes it. */
  INBOX_NOTE_NOT_DELETABLE: 'INBOX_NOTE_NOT_DELETABLE',
  /** No such saved reply, or a personal one of somebody else (the two are the same answer). */
  SAVED_REPLY_NOT_FOUND: 'SAVED_REPLY_NOT_FOUND',
  /** The shortcut is already taken by another reply of the same owner (a shared reply, or the same person's personal one). */
  SAVED_REPLY_SHORTCUT_TAKEN: 'SAVED_REPLY_SHORTCUT_TAKEN',
  /** A shared reply needs `inbox.savedreply.manage` to be changed or deleted, a personal one is only its owner's. */
  SAVED_REPLY_NOT_EDITABLE: 'SAVED_REPLY_NOT_EDITABLE',
  /** The reply is restricted to other channel kinds than the conversation's (the picker does not offer it there). */
  SAVED_REPLY_CHANNEL_MISMATCH: 'SAVED_REPLY_CHANNEL_MISMATCH',
  /** The import file cannot be read as saved replies (no file, not text, no shortcut / title / body column, too many rows). 422. */
  SAVED_REPLY_IMPORT_INVALID: 'SAVED_REPLY_IMPORT_INVALID',
} as const;
