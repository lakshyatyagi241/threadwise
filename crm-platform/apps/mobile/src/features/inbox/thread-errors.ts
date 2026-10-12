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
