import type { TFunction } from 'i18next';
import { CLIENT_ERROR_CODES, isApiError } from './errors';

/**
 * The text a person sees for a failed call, chosen by the stable error `code` (never by the server's title/detail text, which
 * is English and may change). A screen with a more specific message for one of its own codes handles that code first and
 * falls back to this.
 */
export function messageForError(error: unknown, t: TFunction): string {
  if (!isApiError(error)) return t('errors.generic');
  switch (error.code) {
    case CLIENT_ERROR_CODES.NETWORK:
      return t('errors.network');
    case CLIENT_ERROR_CODES.TIMEOUT:
      return t('errors.timeout');
    case CLIENT_ERROR_CODES.CONTRACT_MISMATCH:
      return t('errors.outdatedApp');
    default:
      return error.status === 429 ? t('errors.tooManyRequests') : t('errors.generic');
  }
}
