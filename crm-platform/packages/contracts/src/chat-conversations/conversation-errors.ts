/**
 * Error codes of conversations and messages. Spread into ERROR_CODES (common/errors.ts) so the API and the web branch on one registry.
 * Codes shared with other domains keep their existing names: SERVICE_WINDOW_CLOSED, PLAN_LIMIT_REACHED, AUTH_SEND_HALTED,
 * IDEMPOTENCY_KEY_REUSED, ROW_VERSION_CONFLICT.
 */
export const CONVERSATION_ERROR_CODES = {
  /** No such conversation in this workspace, or one the caller's scope does not let them see (the two are not told apart). */
  CONVERSATION_NOT_FOUND: 'CONVERSATION_NOT_FOUND',
  MESSAGE_NOT_FOUND: 'MESSAGE_NOT_FOUND',
  /** The requested status change is not allowed from the thread's current status (e.g. resolving a spam thread). */
  CONVERSATION_STATUS_INVALID: 'CONVERSATION_STATUS_INVALID',
  /** The user to assign is not an active member of the workspace, or the caller may only claim for themselves. */
  CONVERSATION_ASSIGNEE_INVALID: 'CONVERSATION_ASSIGNEE_INVALID',
  /** Only a `failed` outbound message can be retried. */
  MESSAGE_NOT_RETRYABLE: 'MESSAGE_NOT_RETRYABLE',
  /** The send names a media upload that does not exist, belongs to another workspace, or already expired. */
  MESSAGE_MEDIA_NOT_FOUND: 'MESSAGE_MEDIA_NOT_FOUND',
  /** The export's dates are not a range inside the log's retention (from after to, in the future, or older than a year). */
  MESSAGE_LOG_EXPORT_RANGE_INVALID: 'MESSAGE_LOG_EXPORT_RANGE_INVALID',
  /** One export per workspace at a time: the last one is still queued or running. */
  MESSAGE_LOG_EXPORT_IN_PROGRESS: 'MESSAGE_LOG_EXPORT_IN_PROGRESS',
  MESSAGE_LOG_EXPORT_NOT_FOUND: 'MESSAGE_LOG_EXPORT_NOT_FOUND',
  /** The file is not ready yet, or it has expired. */
  MESSAGE_LOG_EXPORT_NOT_READY: 'MESSAGE_LOG_EXPORT_NOT_READY',
} as const;
