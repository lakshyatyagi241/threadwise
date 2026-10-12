import { ERROR_CODES } from '@crm/contracts';
import type { TFunction } from 'i18next';
import { isApiError } from '@/lib/api';
import { messageForError } from '@/lib/api/error-message';
import type { TaskField } from './task-validation';

/** The workspace's plan has no tasks (422 PLAN_FEATURE_LOCKED): every task route answers this, reads included. */
export const isPlanLocked = (error: unknown): boolean =>
  isApiError(error) && error.code === ERROR_CODES.PLAN_FEATURE_LOCKED;

/** The task (or contact) is gone or out of the person's reach. */
export const isNotFound = (error: unknown): boolean =>
  isApiError(error) && error.code === ERROR_CODES.NOT_FOUND;

export interface TaskFailure {
  /** A message about the whole form, when no single field is to blame. */
  banner: string | null;
  fields: Partial<Record<TaskField, string>>;
  /** Someone else saved the task first: the screen reloads it and asks the person to look again. */
  conflict: boolean;
}

/**
 * What the form shows when the SERVER refuses a save, chosen by the error code and the field paths (never the server's English
 * text). A wrong assignee, a missing task and a plan without tasks each have their own sentence; anything else is a message
 * about the whole form.
 */
export function describeTaskFailure(error: unknown, t: TFunction): TaskFailure {
  if (isApiError(error) && error.isRowVersionConflict) {
    return { banner: null, fields: {}, conflict: true };
  }
  if (isPlanLocked(error)) {
    return { banner: t('tasks.planLocked.title'), fields: {}, conflict: false };
  }
  if (isNotFound(error)) return { banner: t('tasks.notFound'), fields: {}, conflict: false };
  if (isApiError(error) && error.code === ERROR_CODES.TASK_ASSIGNEE_INVALID) {
    return { banner: t('tasks.form.errors.assigneeInvalid'), fields: {}, conflict: false };
  }
  const fields: TaskFailure['fields'] = {};
  if (isApiError(error)) {
    for (const detail of error.fieldErrors) {
      if (detail.path === 'title') fields.title = t('tasks.form.errors.titleRequired');
      else if (detail.path === 'notes') fields.notes = t('tasks.form.errors.notesTooLong');
      else if (detail.path === 'dueAt') fields.date = t('tasks.form.errors.dueInvalid');
      else if (detail.path === 'contactId') fields.contact = t('tasks.form.errors.contactInvalid');
    }
  }
  const named = Object.keys(fields).length > 0;
  return { banner: named ? null : messageForError(error, t), fields, conflict: false };
}
