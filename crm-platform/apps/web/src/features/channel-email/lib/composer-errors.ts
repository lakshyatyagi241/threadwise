import { ERROR_CODES } from '@crm/contracts';

/**
 * The composer's own problems (a send, an upload), by stable code. Returns the key under `email.composer.error`, or null when the
 * inbox's general wording applies. Never branch on message text.
 */
export function composerErrorKey(code: string): string | null {
  switch (code) {
    case ERROR_CODES.MAIL_RATE_LIMITED:
      return 'rateLimited';
    case ERROR_CODES.MAIL_ATTACHMENT_TOO_LARGE:
    case 'PAYLOAD_TOO_LARGE':
      return 'attachmentTooLarge';
    case ERROR_CODES.MAIL_TOO_MANY_ATTACHMENTS:
      return 'tooManyAttachments';
    case ERROR_CODES.MAIL_ATTACHMENT_NOT_FOUND:
      return 'attachmentGone';
    case ERROR_CODES.MAIL_SIGNATURE_NOT_FOUND:
      return 'signatureGone';
    case ERROR_CODES.MAIL_SEND_REFUSED:
      return 'sendRefused';
    case ERROR_CODES.MAIL_MAILBOX_UNAVAILABLE:
      return 'unavailable';
    case 'UNSUPPORTED_MEDIA_TYPE':
      return 'attachmentBlocked';
    default:
      return null;
  }
}

/** Codes that belong to email sending: the thread shows them next to the composer in the email wording. */
export const isMailSendCode = (code: string): boolean =>
  code.startsWith('MAIL_') && composerErrorKey(code) !== null;

/** The newest refused email send among the unsent ones, for the line above the composer (null when none was refused for a mail reason). */
export function emailSendProblem(
  pending: ReadonlyArray<{ status: string; error: string | null; retryAfterS?: number }>,
): { code: string; retryAfterS?: number } | null {
  for (let i = pending.length - 1; i >= 0; i--) {
    const p = pending[i];
    if (p?.status === 'failed' && p.error && composerErrorKey(p.error) !== null) {
      return {
        code: p.error,
        ...(p.retryAfterS !== undefined ? { retryAfterS: p.retryAfterS } : {}),
      };
    }
  }
  return null;
}
