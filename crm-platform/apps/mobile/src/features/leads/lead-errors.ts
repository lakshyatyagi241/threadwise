import { ERROR_CODES } from '@crm/contracts';
import type { TFunction } from 'i18next';
import { isApiError } from '@/lib/api';
import { messageForError } from '@/lib/api/error-message';

/** The workspace's plan has no lead sources (422 PLAN_FEATURE_LOCKED): every lead route answers this, reads included. */
export const isPlanLocked = (error: unknown): boolean =>
  isApiError(error) && error.code === ERROR_CODES.PLAN_FEATURE_LOCKED;

/** The source (or lead) is gone or out of the person's reach. */
export const isNotFound = (error: unknown): boolean =>
  isApiError(error) && error.code === ERROR_CODES.NOT_FOUND;

/**
 * What to tell the person when a retry is refused, chosen by the error code (never the server's English text): the lead is not
 * waiting any more, its stored data was deleted, or its source is paused.
 */
export function retryMessage(error: unknown, t: TFunction): string {
  if (isApiError(error)) {
    if (error.code === ERROR_CODES.LEAD_EVENT_NOT_RETRYABLE) return t('leads.errors.notRetryable');
    if (error.code === ERROR_CODES.LEAD_PAYLOAD_PURGED) return t('leads.errors.payloadPurged');
    if (error.code === ERROR_CODES.LEAD_SOURCE_PAUSED) return t('leads.errors.sourcePaused');
    if (error.code === ERROR_CODES.NOT_FOUND) return t('leads.errors.notFound');
  }
  return messageForError(error, t);
}
