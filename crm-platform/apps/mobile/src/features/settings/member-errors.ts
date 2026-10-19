import { ERROR_CODES } from '@crm/contracts';
import type { TFunction } from 'i18next';
import { isApiError } from '@/lib/api';
import { messageForError } from '@/lib/api/error-message';

/** The sentence for a refused member action, chosen by the stable error `code`, never by message text. `seatLimit` fills the plan-limit line. */
export function memberErrorText(error: unknown, t: TFunction, seatLimit?: number | null): string {
  if (!isApiError(error)) return t('errors.generic');
  switch (error.code) {
    case ERROR_CODES.FORBIDDEN:
      return t('settings.members.errors.forbidden');
    case ERROR_CODES.NOT_FOUND:
      return t('settings.members.errors.notFound');
    case ERROR_CODES.VALIDATION_FAILED:
      return t('settings.members.errors.validation');
    case ERROR_CODES.ROW_VERSION_CONFLICT:
      return t('settings.members.errors.conflict');
    case ERROR_CODES.PLAN_LIMIT_REACHED:
      return seatLimit
        ? t('settings.members.errors.planLimit', { count: seatLimit })
        : t('settings.members.errors.planLimitUnknown');
    case ERROR_CODES.WSP_ALREADY_MEMBER:
      return t('settings.members.errors.alreadyMember');
    case ERROR_CODES.RBAC_ROLE_GRANT_FORBIDDEN:
      return t('settings.members.errors.cannotGrant');
    case ERROR_CODES.WSP_CANNOT_ACT_ON_HIGHER_RANK:
      return t('settings.members.errors.higherRank');
    case ERROR_CODES.RBAC_SELF_ROLE_CHANGE:
      return t('settings.members.errors.ownRole');
    case ERROR_CODES.WSP_CANNOT_REMOVE_SELF:
      return t('settings.members.errors.removeSelf');
    case ERROR_CODES.WSP_CANNOT_REMOVE_OWNER:
      return t('settings.members.errors.removeOwner');
    case ERROR_CODES.RBAC_LAST_OWNER:
      return t('settings.members.errors.lastOwner');
    case ERROR_CODES.WSP_INVITE_NOT_PENDING:
      return t('settings.members.errors.inviteNotPending');
    case ERROR_CODES.WSP_ORG_SUSPENDED:
      return t('settings.members.errors.orgSuspended');
    default:
      return messageForError(error, t);
  }
}
