import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import type { CalendarConnection } from '../api/schemas';

/**
 * The Google Calendar card's pure rules (settings screen): what comes back from Google's consent screen, which buttons each state
 * offers, and which address is safe to send the browser to. No React and no network, so each can be tested on its own.
 */

/** What the server's callback appends to the page it returns to (`?calendar=<outcome>`). */
export const CALENDAR_OUTCOMES = [
  'connected',
  'denied',
  'failed',
  'expired',
  'not_configured',
  'missing_scope',
] as const;
export type CalendarOutcome = (typeof CALENDAR_OUTCOMES)[number];

/** The outcome in a query string, or null when there is none or it is not one of ours (anything else in the address is ignored). */
export function readOutcome(search: string): CalendarOutcome | null {
  const v = new URLSearchParams(search).get('calendar');
  return (CALENDAR_OUTCOMES as readonly string[]).includes(v ?? '') ? (v as CalendarOutcome) : null;
}

/** The same query string without the outcome, so a reload does not show the message again. */
export function withoutOutcome(search: string): string {
  const q = new URLSearchParams(search);
  q.delete('calendar');
  const s = q.toString();
  return s ? `?${s}` : '';
}

export interface CalendarActions {
  /** Start the Google consent (nothing is connected yet). */
  connect: boolean;
  /** Start it again: Google stopped honouring the earlier consent. */
  reconnect: boolean;
  /** Pick which calendar bookings are written to. */
  choose: boolean;
  disconnect: boolean;
}

/** Which buttons a state offers. Only someone who may edit booking configuration gets any; `unavailable` has nothing to press for anyone. */
export function calendarActions(
  c: Pick<CalendarConnection, 'status'>,
  canEdit: boolean,
): CalendarActions {
  const none = { connect: false, reconnect: false, choose: false, disconnect: false };
  if (!canEdit) return none;
  switch (c.status) {
    case 'disconnected':
      return { ...none, connect: true };
    case 'connected':
      return { ...none, choose: true, disconnect: true };
    case 'needs_reconnect':
      return { ...none, reconnect: true, disconnect: true };
    default:
      return none;
  }
}

/** The calendar's display name: its own name, else its id, and nothing for the account's own default calendar. */
export function calendarName(
  c: Pick<CalendarConnection, 'calendarId' | 'calendarName'>,
): string | null {
  if (c.calendarName) return c.calendarName;
  if (!c.calendarId || c.calendarId === 'primary') return null;
  return c.calendarId;
}

/** Only an http(s) address is followed (a response must never be able to send the browser to a `javascript:` address). */
export function safeConsentUrl(url: string, base = 'http://localhost'): string | null {
  try {
    const u = new URL(url, base);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export type CalendarFailure = 'notConfigured' | 'notConnected' | 'providerFailed';

/** The calendar calls' own failures, by `code` (never by the server's wording); null for anything the generic error line handles. */
export function calendarFailure(error: unknown): CalendarFailure | null {
  if (!(error instanceof ApiError)) return null;
  switch (error.code) {
    case ERROR_CODES.APPT_CALENDAR_NOT_CONFIGURED:
      return 'notConfigured';
    case ERROR_CODES.APPT_CALENDAR_NOT_CONNECTED:
      return 'notConnected';
    case ERROR_CODES.APPT_CALENDAR_PROVIDER_FAILED:
      return 'providerFailed';
    default:
      return null;
  }
}
