import { ApiError } from '@/lib/api/errors';

/** The problems a person is told about in their own words. Everything else is `generic` with the request id. */
export const ERROR_KINDS = [
  'conflict',
  'windowClosed',
  'planLimit',
  'channelDisconnected',
  'sendHalted',
  'notFound',
  'notRetryable',
  'mediaNotFound',
  'statusInvalid',
  'assigneeInvalid',
  'forbidden',
  'rateLimited',
  'simulatorDisabled',
  'channelInUse',
  'validation',
  'tooLarge',
  'unsupported',
  'templateNotSendable',
  'groupSendUnavailable',
  'logRange',
  'logBusy',
  'logNotReady',
  'network',
  'generic',
] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

const BY_CODE: Record<string, ErrorKind> = {
  ROW_VERSION_CONFLICT: 'conflict',
  SERVICE_WINDOW_CLOSED: 'windowClosed',
  PLAN_LIMIT_REACHED: 'planLimit',
  CHANNEL_DISCONNECTED: 'channelDisconnected',
  AUTH_SEND_HALTED: 'sendHalted',
  CONVERSATION_NOT_FOUND: 'notFound',
  CONVERSATION_NOTE_NOT_FOUND: 'notFound',
  INBOX_NOTE_NOT_DELETABLE: 'forbidden',
  INBOX_TEMPLATES_UNAVAILABLE: 'unsupported',
  INBOX_TEMPLATE_NOT_SENDABLE: 'templateNotSendable',
  MESSAGE_NOT_FOUND: 'notFound',
  MESSAGE_NOT_RETRYABLE: 'notRetryable',
  MESSAGE_MEDIA_NOT_FOUND: 'mediaNotFound',
  CONVERSATION_STATUS_INVALID: 'statusInvalid',
  CONVERSATION_ASSIGNEE_INVALID: 'assigneeInvalid',
  FORBIDDEN: 'forbidden',
  RATE_LIMITED: 'rateLimited',
  CHANNEL_SIMULATOR_DISABLED: 'simulatorDisabled',
  CHANNEL_IN_USE: 'channelInUse',
  VALIDATION_FAILED: 'validation',
  PAYLOAD_TOO_LARGE: 'tooLarge',
  CHANNEL_CAPABILITY_UNSUPPORTED: 'unsupported',
  WABA_GROUP_SEND_UNAVAILABLE: 'groupSendUnavailable',
  MESSAGE_LOG_EXPORT_RANGE_INVALID: 'logRange',
  MESSAGE_LOG_EXPORT_IN_PROGRESS: 'logBusy',
  MESSAGE_LOG_EXPORT_NOT_FOUND: 'notFound',
  MESSAGE_LOG_EXPORT_NOT_READY: 'logNotReady',
  UNSUPPORTED_MEDIA_TYPE: 'unsupported',
  NETWORK: 'network',
};

/** The code of a thrown error: the API's problem code, `PAYLOAD_TOO_LARGE` for a 413, `NETWORK` when nothing answered. */
export function errorCode(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 413) return 'PAYLOAD_TOO_LARGE';
    if (e.status === 415) return 'UNSUPPORTED_MEDIA_TYPE';
    return e.code;
  }
  return 'NETWORK';
}

export function errorKind(code: string): ErrorKind {
  return BY_CODE[code] ?? 'generic';
}

/** The request id of an API error, shown beside a generic failure so support can find it in the logs. */
export function requestIdOf(e: unknown): string | undefined {
  return e instanceof ApiError ? e.requestId : undefined;
}

/**
 * A send that never reached the server (or was refused before a message existed) is worth offering "retry" for; one the server
 * refused for a reason that will not change by itself (window closed, plan cap, disconnected channel) is not.
 */
export function isRetryableSend(code: string): boolean {
  return errorKind(code) === 'network' || errorKind(code) === 'generic' || code === 'RATE_LIMITED';
}
