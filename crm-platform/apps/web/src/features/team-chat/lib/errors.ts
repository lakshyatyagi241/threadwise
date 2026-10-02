import { ERROR_CODES } from '@crm/contracts';

/** What the person is told about a failed call, chosen by the API's error `code`, never by its wording. */
export const ERROR_KINDS = [
  'network',
  'forbidden',
  'signedOut',
  'notFound',
  'validation',
  'conflict',
  'tooLarge',
  'rateLimited',
  'emptyMessage',
  'replyOtherChannel',
  'attachmentRejected',
  'editExpired',
  'nameTaken',
  'channelProtected',
  'alreadyMember',
  'alreadyDecided',
  'notMember',
  'notAuthor',
  'kindInvalid',
  'unexpected',
] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

const BY_CODE: Record<string, ErrorKind> = {
  network: 'network',
  PAYLOAD_TOO_LARGE: 'tooLarge',
  [ERROR_CODES.FORBIDDEN]: 'forbidden',
  [ERROR_CODES.UNAUTHENTICATED]: 'signedOut',
  [ERROR_CODES.NOT_FOUND]: 'notFound',
  [ERROR_CODES.VALIDATION_FAILED]: 'validation',
  [ERROR_CODES.ROW_VERSION_CONFLICT]: 'conflict',
  [ERROR_CODES.RATE_LIMITED]: 'rateLimited',
  [ERROR_CODES.TCHAT_EMPTY_MESSAGE]: 'emptyMessage',
  [ERROR_CODES.TCHAT_REPLY_OTHER_CHANNEL]: 'replyOtherChannel',
  [ERROR_CODES.TCHAT_ATTACHMENT_REJECTED]: 'attachmentRejected',
  [ERROR_CODES.TCHAT_EDIT_WINDOW_EXPIRED]: 'editExpired',
  [ERROR_CODES.TCHAT_CHANNEL_NAME_TAKEN]: 'nameTaken',
  [ERROR_CODES.TCHAT_CHANNEL_PROTECTED]: 'channelProtected',
  [ERROR_CODES.TCHAT_ALREADY_MEMBER]: 'alreadyMember',
  [ERROR_CODES.TCHAT_INVITATION_DECIDED]: 'alreadyDecided',
  [ERROR_CODES.TCHAT_NOT_CHANNEL_MEMBER]: 'notMember',
  [ERROR_CODES.TCHAT_NOT_MESSAGE_AUTHOR]: 'notAuthor',
  [ERROR_CODES.TCHAT_CHANNEL_KIND_INVALID]: 'kindInvalid',
};

export function errorKind(code: string): ErrorKind {
  return BY_CODE[code] ?? 'unexpected';
}
