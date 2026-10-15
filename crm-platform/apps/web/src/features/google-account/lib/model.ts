import {
  ERROR_CODES,
  GOOGLE_CAPABILITIES,
  googleCapabilityRestricted,
  type GoogleAccountResponse,
  type GoogleCapability,
} from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/**
 * The Google account page's pure rules: what Google's consent screen sends the browser back with, which permissions are offered by
 * default, which buttons each state offers, which address is safe to follow. No React and no network.
 */

/** What the server's callback appends to the page it returns to (`?calendar=<outcome>`; the callback is shared with the calendar card). */
export const OUTCOMES = [
  'connected',
  'denied',
  'failed',
  'expired',
  'not_configured',
  'missing_scope',
  /** The person chose Cancel on the confirmation page. */
  'cancelled',
] as const;
export type Outcome = (typeof OUTCOMES)[number];

export function readOutcome(search: string): Outcome | null {
  const v = new URLSearchParams(search).get('calendar');
  return (OUTCOMES as readonly string[]).includes(v ?? '') ? (v as Outcome) : null;
}

/** The same query string without the outcome, so a reload does not show the message again. */
export function withoutOutcome(search: string): string {
  const q = new URLSearchParams(search);
  q.delete('calendar');
  const s = q.toString();
  return s ? `?${s}` : '';
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

export type View = 'noPermission' | 'loading' | 'error' | 'ready';

export function viewState(input: {
  canRead: boolean;
  isPending: boolean;
  isError: boolean;
  data: GoogleAccountResponse | undefined;
}): View {
  if (!input.canRead) return 'noPermission';
  if (input.data) return 'ready';
  if (input.isError) return 'error';
  return 'loading';
}

/**
 * What is ticked when the page opens: the permissions that need no review by Google, minus what is already allowed. The restricted ones
 * (Docs and Drive, the Drive file list) are left for the admin to choose on purpose.
 */
export function defaultTicks(account: GoogleAccountResponse | undefined): GoogleCapability[] {
  if (!account) return GOOGLE_CAPABILITIES.filter((c) => !googleCapabilityRestricted(c));
  return account.capabilities.filter((c) => !c.granted && !c.restricted).map((c) => c.key);
}

export interface Actions {
  connect: boolean;
  reconnect: boolean;
  /** Ask for the ticked permissions on an account that is connected. */
  add: boolean;
  disconnect: boolean;
}

/** Which buttons a state offers. Only someone who may manage the account gets any; `unavailable` has nothing to press for anyone. */
export function actions(status: GoogleAccountResponse['status'], canManage: boolean): Actions {
  const none = { connect: false, reconnect: false, add: false, disconnect: false };
  if (!canManage) return none;
  switch (status) {
    case 'disconnected':
      return { ...none, connect: true };
    case 'connected':
      return { ...none, add: true, disconnect: true };
    case 'needs_reconnect':
      return { ...none, reconnect: true, disconnect: true };
    default:
      return none;
  }
}

/** The permissions a "Connect", "Reconnect" or "Add permissions" press asks Google for: what is ticked, and on a reconnect what was held. */
export function wanted(
  account: GoogleAccountResponse,
  ticked: readonly GoogleCapability[],
): GoogleCapability[] {
  const held =
    account.status === 'needs_reconnect'
      ? account.capabilities.filter((c) => c.granted).map((c) => c.key)
      : [];
  const set = new Set<GoogleCapability>([...held, ...ticked]);
  return GOOGLE_CAPABILITIES.filter((c) => set.has(c));
}

/** The calendar's display name: its own name, else its id, and nothing for the account's own default calendar. */
export function calendarName(
  c: Pick<GoogleAccountResponse, 'calendarId' | 'calendarName'>,
): string | null {
  if (c.calendarName) return c.calendarName;
  if (!c.calendarId || c.calendarId === 'primary') return null;
  return c.calendarId;
}

/** The message key of the last error's explanation, by its stable code (never by the server's wording). */
export function lastErrorKey(code: string): string {
  switch (code) {
    case 'GOOGLE_ACCOUNT_NEEDS_RECONNECT':
    case 'GOOGLE_ACCOUNT_NOT_CONFIGURED':
    case 'GOOGLE_API_NOT_ENABLED':
    case 'GOOGLE_SCOPE_MISSING':
    case 'GOOGLE_RATE_LIMITED':
    case 'GOOGLE_UNAVAILABLE':
      return code;
    default:
      return 'other';
  }
}

export type Failure = 'notConfigured' | 'generic';

export function failureOf(error: unknown): Failure {
  return error instanceof ApiError && error.code === ERROR_CODES.GOOGLE_ACCOUNT_NOT_CONFIGURED
    ? 'notConfigured'
    : 'generic';
}

/** "3 days ago", "yesterday" in the viewer's language; '' when it is unreadable. */
export function relativeTime(iso: string | null | undefined, now: Date, locale: string): string {
  if (!iso) return '';
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return '';
  const diff = at - now.getTime();
  const steps: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 365 * 86_400_000],
    ['month', 30 * 86_400_000],
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ];
  try {
    const f = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    for (const [unit, ms] of steps) {
      if (Math.abs(diff) >= ms) return f.format(Math.round(diff / ms), unit);
    }
    return f.format(0, 'minute');
  } catch {
    return '';
  }
}

export type ConsentFailure = 'notYours' | 'expired' | 'used' | 'notFound' | 'generic';

/** What a refused confirmation says, chosen by the error's stable code (never by the server's wording). */
export function consentFailureOf(error: unknown): ConsentFailure {
  if (!(error instanceof ApiError)) return 'generic';
  switch (error.code) {
    case ERROR_CODES.GOOGLE_CONSENT_NOT_YOURS:
      return 'notYours';
    case ERROR_CODES.GOOGLE_CONSENT_EXPIRED:
      return 'expired';
    case ERROR_CODES.GOOGLE_CONSENT_USED:
      return 'used';
    case ERROR_CODES.GOOGLE_CONSENT_NOT_FOUND:
      return 'notFound';
    default:
      return 'generic';
  }
}

/** The `request` id of the confirmation address: only a UUID is used, anything else is no request at all. */
export function readConsentId(search: string): string | null {
  const v = new URLSearchParams(search).get('request');
  return v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null;
}

/** Where the confirmation page sends the browser when it ends: the page it came from, with the outcome (the same `?calendar=` the old callback left). */
export function consentReturnAddress(result: { returnTo: string; outcome: string }): string {
  return `${result.returnTo}?calendar=${encodeURIComponent(result.outcome)}`;
}
