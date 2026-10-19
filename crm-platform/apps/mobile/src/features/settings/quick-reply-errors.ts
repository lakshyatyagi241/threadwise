import { ERROR_CODES } from '@crm/contracts';
import type { TFunction } from 'i18next';
import { isApiError } from '@/lib/api';
import { messageForError } from '@/lib/api/error-message';
import type { DraftField } from './quick-reply-draft';

/** What the form shows when the SERVER refuses a save: chosen by the stable error `code` and the field path, never by message text. */
export interface ReplyFailure {
  banner: string | null;
  fields: Partial<Record<DraftField, string>>;
  /** Someone else changed the reply first: the form reloads it and asks the person to review. */
  conflict: boolean;
  /** The plan's limit of replies was reached. */
  planLimit: boolean;
}

const FIELD_PROBLEM = {
  shortcut: 'settings.quickReplies.form.shortcutEmpty',
  title: 'settings.quickReplies.form.titleEmpty',
  body: 'settings.quickReplies.form.bodyEmpty',
  language: 'settings.quickReplies.form.languageFormat',
} as const satisfies Record<DraftField, string>;

const isField = (value: string): value is DraftField => Object.hasOwn(FIELD_PROBLEM, value);

export function describeFailure(error: unknown, t: TFunction, shortcut: string): ReplyFailure {
  const none: ReplyFailure = { banner: null, fields: {}, conflict: false, planLimit: false };
  if (!isApiError(error)) return { ...none, banner: t('errors.generic') };
  switch (error.code) {
    case ERROR_CODES.ROW_VERSION_CONFLICT:
      return { ...none, conflict: true, banner: t('settings.quickReplies.form.conflict') };
    case ERROR_CODES.PLAN_LIMIT_REACHED:
      return { ...none, planLimit: true, banner: t('settings.quickReplies.form.planLimit') };
    case ERROR_CODES.SAVED_REPLY_SHORTCUT_TAKEN:
      return {
        ...none,
        fields: { shortcut: t('settings.quickReplies.form.shortcutTaken', { shortcut }) },
      };
    case ERROR_CODES.SAVED_REPLY_NOT_EDITABLE:
      return { ...none, banner: t('settings.quickReplies.readOnly') };
    case ERROR_CODES.VALIDATION_FAILED: {
      const fields: ReplyFailure['fields'] = {};
      for (const detail of error.fieldErrors) {
        const field = detail.path.split('.')[0] ?? '';
        if (isField(field) && !fields[field]) fields[field] = t(FIELD_PROBLEM[field]);
      }
      return Object.keys(fields).length > 0
        ? { ...none, fields }
        : { ...none, banner: t('settings.quickReplies.form.invalid') };
    }
    default:
      return { ...none, banner: messageForError(error, t) };
  }
}

/** True when the reply no longer exists (deleted by someone else while the form or list was open). */
export const isReplyGone = (error: unknown): boolean =>
  isApiError(error) && error.code === ERROR_CODES.SAVED_REPLY_NOT_FOUND;
