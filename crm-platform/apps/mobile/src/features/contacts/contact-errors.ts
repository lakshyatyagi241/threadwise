import type { TFunction } from 'i18next';
import { isApiError } from '@/lib/api';
import { messageForError } from '@/lib/api/error-message';
import type { ContactField } from './contact-validation';

export interface ContactFailure {
  /** A message about the whole form, when no single field is to blame. */
  banner: string | null;
  fields: Partial<Record<ContactField, string>>;
  /** Someone else saved the contact first: the screen reloads it and asks the person to look again. */
  conflict: boolean;
}

/**
 * What the form shows when the SERVER refuses a save. The fields the server names (`errors[].path`) get the app's own sentence in
 * the person's language; the server's English text is never shown. Anything else becomes a message about the whole form.
 */
export function describeContactFailure(error: unknown, t: TFunction): ContactFailure {
  if (isApiError(error) && error.isRowVersionConflict) {
    return { banner: null, fields: {}, conflict: true };
  }
  const fields: ContactFailure['fields'] = {};
  if (isApiError(error)) {
    for (const detail of error.fieldErrors) {
      if (detail.path === 'phone') fields.phone = t('contacts.form.phoneInvalid');
      else if (detail.path === 'email') fields.email = t('contacts.form.emailInvalid');
      else if (detail.path === 'name') fields.name = t('contacts.form.nameInvalid');
    }
  }
  const named = Object.keys(fields).length > 0;
  return { banner: named ? null : messageForError(error, t), fields, conflict: false };
}
