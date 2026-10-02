import { ApiError } from '@/lib/api/errors';
import type { SuppTicketPriority, SuppTicketStatus } from '@crm/contracts';

export const STATUS_TONE: Record<SuppTicketStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  open: 'warning',
  in_progress: 'success',
  pending: 'danger',
  resolved: 'success',
  closed: 'neutral',
};

export const PRIORITY_TONE: Record<
  SuppTicketPriority,
  'neutral' | 'success' | 'warning' | 'danger'
> = { urgent: 'danger', high: 'warning', normal: 'neutral', low: 'neutral' };

/** The error text key (under `platform-support-desk.errors`) for a failed call; branches on the code, never the message. */
export function errorKey(
  error: unknown,
): 'network' | 'forbidden' | 'validation' | 'conflict' | 'closed' | 'notFound' | 'unexpected' {
  if (!(error instanceof ApiError)) return 'network';
  if (error.status === 403) return 'forbidden';
  if (error.status === 404) return 'notFound';
  if (error.isRowVersionConflict) return 'conflict';
  if (error.status === 409) return 'closed';
  if (error.status === 422 || error.status === 400) return 'validation';
  return 'unexpected';
}

export const formatWhen = (iso: string, locale: string): string =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );

export const INBOX_KEY = ['support', 'operator', 'tickets'] as const;
