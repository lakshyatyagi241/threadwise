import { ERROR_CODES } from '@crm/contracts';
import type { TFunction } from 'i18next';
import { isApiError } from '@/lib/api';
import { messageForError } from '@/lib/api/error-message';

/** The words for a failed send, chosen by the error `code` (never the server's text). Unknown codes get the app-wide message. */
export function sendErrorMessage(error: unknown, t: TFunction): string {
  if (isApiError(error)) {
    switch (error.code) {
      case ERROR_CODES.SERVICE_WINDOW_CLOSED:
        return t('inbox.thread.windowClosed');
      case ERROR_CODES.CHANNEL_DISCONNECTED:
        return t('inbox.errors.channelDisconnected');
      case ERROR_CODES.PLAN_LIMIT_REACHED:
        return t('inbox.errors.planLimit');
      case ERROR_CODES.FORBIDDEN:
        return t('inbox.errors.forbidden');
      case ERROR_CODES.CONVERSATION_NOT_FOUND:
        return t('inbox.errors.notFound');
      case ERROR_CODES.ROW_VERSION_CONFLICT:
        return t('inbox.thread.conflict');
      case ERROR_CODES.CONVERSATION_STATUS_INVALID:
        return t('inbox.thread.statusInvalid');
    }
  }
  return messageForError(error, t);
}

/**
 * The words for a failed attachment: the upload's own refusals (a file type that is not allowed, a file too big for the server, an
 * upload that expired before it was sent) first, then whatever a failed send says.
 */
export function attachErrorMessage(error: unknown, t: TFunction): string {
  if (isApiError(error)) {
    if (error.code === ERROR_CODES.AUTH_UPLOAD_REJECTED) return t('inbox.attach.rejected');
    if (error.code === ERROR_CODES.MESSAGE_MEDIA_NOT_FOUND) return t('inbox.attach.expired');
    if (error.status === 413) return t('inbox.attach.serverTooLarge');
  }
  return sendErrorMessage(error, t);
}
