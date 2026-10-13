import { ERROR_CODES } from '@crm/contracts';

/**
 * Branch on the stable code, never on the message text. Returns the message key (under `sms`) for the codes this screen words
 * itself, so they are translated; any other error shows the server's own sentence (a provider's reason is only known there).
 */
export function smsErrorKey(code: string): string | null {
  switch (code) {
    case ERROR_CODES.SMS_NOT_AVAILABLE:
    case ERROR_CODES.SMS_QUOTA_EXCEEDED:
      return 'connect.api.notAvailable';
    case ERROR_CODES.SMS_SENDER_UNAVAILABLE:
      return 'connect.api.unavailable';
    case 'ROW_VERSION_CONFLICT':
      return 'card.changed';
    default:
      return null;
  }
}
