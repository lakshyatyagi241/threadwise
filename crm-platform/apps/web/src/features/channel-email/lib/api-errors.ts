import { ERROR_CODES } from '@crm/contracts';

/**
 * Branch on the stable code, never on the message text. Returns the message key (under `email.errors`) for the codes this screen
 * words itself, so they are translated; any other error shows the server's own sentence.
 */
export function mailErrorKey(code: string): string | null {
  switch (code) {
    case ERROR_CODES.MAIL_NOT_CONFIGURED:
      return 'notConfigured';
    case ERROR_CODES.MAIL_MAILBOX_LIMIT:
    case ERROR_CODES.PLAN_LIMIT_REACHED:
      return 'limit';
    case ERROR_CODES.MAIL_MAILBOX_UNAVAILABLE:
      return 'unavailable';
    case ERROR_CODES.MAIL_SEND_REFUSED:
      return 'sendRefused';
    case ERROR_CODES.MAIL_WRONG_ACCOUNT:
      return 'wrongAccount';
    case ERROR_CODES.PLAN_FEATURE_LOCKED:
      return 'locked';
    case 'ROW_VERSION_CONFLICT':
      return 'changed';
    default:
      return null;
  }
}
