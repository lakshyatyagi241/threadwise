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

export const formatWhen = (iso: string, locale: string, timeZone?: string): string =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(
    new Date(iso),
  );

export const INBOX_KEY = ['support', 'operator', 'tickets'] as const;

/** Pill tints for the ticket status and priority, shared by the inbox rows and the ticket panel. */
export const STATUS_PILL: Record<string, string> = {
  open: 'bg-warning/15 text-warning',
  in_progress: 'bg-success/15 text-success',
  pending: 'bg-danger/10 text-danger',
  resolved: 'bg-success/10 text-success',
  closed: 'bg-muted text-muted-foreground',
};
export const PRIORITY_PILL: Record<string, string> = {
  low: 'bg-muted text-muted-foreground',
  normal: 'bg-primary/10 text-primary',
  high: 'bg-warning/15 text-warning',
  urgent: 'bg-danger/10 text-danger',
};
