import { ERROR_CODES } from '@crm/contracts';
import type { TFunction } from 'i18next';
import { isApiError } from '@/lib/api';
import { messageForError } from '@/lib/api/error-message';

/** The workspace's plan has no sales pipeline (422 PLAN_FEATURE_LOCKED): every deals route answers this, reads included. */
export const isPlanLocked = (error: unknown): boolean =>
  isApiError(error) && error.code === ERROR_CODES.PLAN_FEATURE_LOCKED;

/** The deal (or its pipeline, or its stage) is gone or out of the person's reach. */
export const isNotFound = (error: unknown): boolean =>
  isApiError(error) && error.code === ERROR_CODES.NOT_FOUND;

/** Someone else saved the deal first: the screen reloads it and asks the person to look again. */
export const isConflict = (error: unknown): boolean =>
  isApiError(error) && error.isRowVersionConflict;

/** The workspace requires a reason for a lost deal and none was sent (422 DEAL_LOST_REASON_REQUIRED). */
export const isLostReasonRequired = (error: unknown): boolean =>
  isApiError(error) && error.code === ERROR_CODES.DEAL_LOST_REASON_REQUIRED;

/**
 * What the person is told about a refused deal call, chosen by the error code (never by the server's English text). Codes this
 * screen has a sentence for are named; anything else falls back to the app-wide message for the failure.
 */
export function describeDealFailure(error: unknown, t: TFunction): string {
  if (isApiError(error)) {
    switch (error.code) {
      case ERROR_CODES.ROW_VERSION_CONFLICT:
        return t('deals.errors.conflict');
      case ERROR_CODES.NOT_FOUND:
      case ERROR_CODES.DEAL_TASK_NOT_FOUND:
        return t('deals.errors.notFound');
      case ERROR_CODES.PLAN_FEATURE_LOCKED:
        return t('deals.planLocked.title');
      case ERROR_CODES.FORBIDDEN:
        return t('deals.errors.forbidden');
      case ERROR_CODES.DEAL_LOST_REASON_REQUIRED:
        return t('deals.errors.lostReasonRequired');
      case ERROR_CODES.DEAL_OWNER_INVALID:
        return t('deals.errors.ownerInvalid');
      case ERROR_CODES.DEAL_STAGE_MISMATCH:
        return t('deals.errors.stageMismatch');
      case ERROR_CODES.DEAL_NO_WON_STAGE:
        return t('deals.errors.noWonStage');
      case ERROR_CODES.DEAL_NO_LOST_STAGE:
        return t('deals.errors.noLostStage');
      case ERROR_CODES.DEAL_NO_OPEN_STAGE:
        return t('deals.errors.noOpenStage');
      case ERROR_CODES.DEAL_VALUE_INVALID:
        return t('deals.form.errors.valueInvalid');
    }
  }
  return messageForError(error, t);
}

/** The fields of the deal form a server answer can sit under. */
export type DealField = 'title' | 'value' | 'currency' | 'owner' | 'contact' | 'close' | 'notes';

/**
 * What the form shows when the SERVER refuses a save: the sentence for a field the answer names, else one about the whole form.
 * A stale version (`conflict`) is returned separately, because the screen reloads the deal instead of showing a message.
 */
export function describeDealFormFailure(
  error: unknown,
  t: TFunction,
): { banner: string | null; fields: Partial<Record<DealField, string>>; conflict: boolean } {
  if (isConflict(error)) return { banner: null, fields: {}, conflict: true };
  const fields: Partial<Record<DealField, string>> = {};
  if (isApiError(error)) {
    for (const detail of error.fieldErrors) {
      if (detail.path === 'title') fields.title = t('deals.form.errors.titleRequired');
      else if (detail.path === 'value' || detail.path === 'currency')
        fields.value = t('deals.form.errors.valueInvalid');
      else if (detail.path === 'expectedCloseDate')
        fields.close = t('deals.form.errors.closeInvalid');
      else if (detail.path === 'notes') fields.notes = t('deals.form.errors.notesTooLong');
    }
  }
  const named = Object.keys(fields).length > 0;
  return { banner: named ? null : describeDealFailure(error, t), fields, conflict: false };
}
