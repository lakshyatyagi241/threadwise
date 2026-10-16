import { ERROR_CODES, type CalendarOverviewResponse, type CalendarProvider } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/**
 * The pure rules of the calendar cards beyond Google's (BL-035): what Microsoft's redirect leaves in the address and which provider choices are offered. No React and no network, so each can be tested on its own.
 */

/** What Microsoft's callback appends to the settings page: `?outlook=confirm&ticket=...` to be confirmed, or `?outlook=<outcome>`. */
export const OUTLOOK_OUTCOMES = [
  'denied',
  'failed',
  'expired',
  'not_configured',
  'connected',
  'missing_scope',
] as const;
export type OutlookOutcome = (typeof OUTLOOK_OUTCOMES)[number];

export type OutlookReturn =
  { kind: 'confirm'; ticket: string } | { kind: 'outcome'; outcome: OutlookOutcome };

/** The ticket is one-time and about a person's grant: only this shape is accepted from the address. */
const TICKET = /^[A-Za-z0-9_-]{20,4000}\.[A-Za-z0-9_-]{20,200}$/;

/** What the address says about an Outlook connection in progress, or null when there is nothing of ours in it. */
export function readOutlookReturn(search: string): OutlookReturn | null {
  const q = new URLSearchParams(search);
  const v = q.get('outlook');
  if (v === 'confirm') {
    const ticket = q.get('ticket') ?? '';
    return TICKET.test(ticket)
      ? { kind: 'confirm', ticket }
      : { kind: 'outcome', outcome: 'failed' };
  }
  return (OUTLOOK_OUTCOMES as readonly string[]).includes(v ?? '')
    ? { kind: 'outcome', outcome: v as OutlookOutcome }
    : null;
}

/** The same query string without what we read, so a reload (or a shared link) does not carry the one-time ticket along. */
export function withoutOutlookParams(search: string): string {
  const q = new URLSearchParams(search);
  q.delete('outlook');
  q.delete('ticket');
  const s = q.toString();
  return s ? `?${s}` : '';
}

export type OutlookFailure =
  'notConfigured' | 'notConnected' | 'providerFailed' | 'notYours' | 'invalidTicket';

/** The Outlook calls' own failures, by `code` (never by the server's wording); null for anything the generic error line handles. */
export function outlookFailure(error: unknown): OutlookFailure | null {
  if (!(error instanceof ApiError)) return null;
  switch (error.code) {
    case ERROR_CODES.APPT_CALENDAR_NOT_CONFIGURED:
      return 'notConfigured';
    case ERROR_CODES.APPT_CALENDAR_NOT_CONNECTED:
      return 'notConnected';
    case ERROR_CODES.APPT_CALENDAR_PROVIDER_FAILED:
      return 'providerFailed';
    case ERROR_CODES.APPT_CALENDAR_CONFIRM_NOT_YOURS:
      return 'notYours';
    case ERROR_CODES.APPT_CALENDAR_CONFIRM_INVALID:
      return 'invalidTicket';
    default:
      return null;
  }
}

export interface WriteTargetChoice {
  /** `auto` follows the rule (Google when usable, else Outlook); otherwise the provider key. */
  value: 'auto' | CalendarProvider;
  /** Whether it can be picked now (a provider that is not connected cannot be). */
  enabled: boolean;
}

/** The choices of "where bookings are written": always automatic, and each provider that is connected right now. */
export function writeTargetChoices(
  o: Pick<CalendarOverviewResponse, 'providers'>,
): WriteTargetChoice[] {
  return [
    { value: 'auto', enabled: true },
    ...o.providers.map((p) => ({ value: p.provider, enabled: p.status === 'connected' })),
  ];
}

/** What the page selects: the admin's choice, else automatic. */
export function writeTargetValue(
  o: Pick<CalendarOverviewResponse, 'preferredProvider'>,
): 'auto' | CalendarProvider {
  return o.preferredProvider ?? 'auto';
}

/** Whether the card has anything to decide: a workspace with fewer than two connected calendars has no choice to make. */
export function hasWriteChoice(o: Pick<CalendarOverviewResponse, 'providers'>): boolean {
  return o.providers.filter((p) => p.status === 'connected').length >= 2;
}
