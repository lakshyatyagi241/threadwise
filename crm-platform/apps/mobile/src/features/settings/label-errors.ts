import { ERROR_CODES } from '@crm/contracts';
import type { TFunction } from 'i18next';
import { isApiError } from '@/lib/api';
import { messageForError } from '@/lib/api/error-message';
import type { LabelField } from './label-draft';

/** What the label form shows when the SERVER refuses a save: chosen by the stable error `code`, never by message text. */
export interface LabelFailure {
  banner: string | null;
  fields: Partial<Record<LabelField, string>>;
  /** Someone else changed the label first: the form reloads it and asks the person to review. */
  conflict: boolean;
}

export function describeLabelFailure(error: unknown, t: TFunction): LabelFailure {
  const none: LabelFailure = { banner: null, fields: {}, conflict: false };
  if (!isApiError(error)) return { ...none, banner: t('errors.generic') };
  switch (error.code) {
    case ERROR_CODES.ROW_VERSION_CONFLICT:
      return { ...none, conflict: true, banner: t('settings.labels.conflict') };
    case ERROR_CODES.CON_TAG_NAME_TAKEN:
      return { ...none, fields: { name: t('settings.labels.nameTaken') } };
    case ERROR_CODES.PLAN_LIMIT_REACHED:
      return { ...none, banner: t('settings.labels.planLimit') };
    case ERROR_CODES.VALIDATION_FAILED: {
      const fields: LabelFailure['fields'] = {};
      for (const detail of error.fieldErrors) {
        const field = detail.path.split('.')[0];
        if (field === 'name') fields.name = t('settings.labels.nameEmpty');
        if (field === 'color') fields.color = t('settings.labels.colorInvalid');
      }
      return Object.keys(fields).length > 0
        ? { ...none, fields }
        : { ...none, banner: t('errors.generic') };
    }
    default:
      return { ...none, banner: messageForError(error, t) };
  }
}

/** True when the label no longer exists (deleted by someone else while the form or list was open). */
export const isLabelGone = (error: unknown): boolean => isApiError(error) && error.status === 404;
