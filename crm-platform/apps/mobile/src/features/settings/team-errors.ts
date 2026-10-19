import { ERROR_CODES } from '@crm/contracts';
import type { TFunction } from 'i18next';
import { isApiError } from '@/lib/api';
import { messageForError } from '@/lib/api/error-message';

/** The sentence for a refused team action, chosen by the stable error `code`, never by message text. */
export function teamErrorText(error: unknown, t: TFunction): string {
  if (!isApiError(error)) return t('errors.generic');
  switch (error.code) {
    case ERROR_CODES.FORBIDDEN:
      return t('settings.teams.errors.forbidden');
    case ERROR_CODES.NOT_FOUND:
      return t('settings.teams.errors.notFound');
    case ERROR_CODES.VALIDATION_FAILED:
      return t('settings.teams.errors.validation');
    case ERROR_CODES.ROW_VERSION_CONFLICT:
      return t('settings.teams.errors.conflict');
    case ERROR_CODES.WSP_TEAM_NAME_TAKEN:
      return t('settings.teams.errors.nameTaken');
    case ERROR_CODES.WSP_TEAM_MEMBER_UNKNOWN:
      return t('settings.teams.errors.memberUnknown');
    case ERROR_CODES.WSP_ORG_SUSPENDED:
      return t('settings.teams.errors.orgSuspended');
    default:
      return messageForError(error, t);
  }
}
