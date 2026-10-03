import { z } from 'zod';

/**
 * Environment of the Google Calendar adapter (TW-APPT-028, 029). Read straight from the environment (the central schema belongs to the
 * kernel) and validated at call time, so a test can point it at a local stand-in for Google between runs.
 *
 * The client id and secret normally come from the console (Google Calendar settings page); the two `GOOGLE_CALENDAR_CLIENT_*` values
 * are the fallback for a deployment that configures them in the environment. A compose file passes an unset variable as an empty
 * string, which must mean "not set".
 */
const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optional = (max = 512) => z.preprocess(blank, z.string().max(max).optional());
const urlOr = (dflt: string) => z.preprocess(blank, z.string().url().default(dflt));

const schema = z.object({
  /** Where the browser is sent for consent. */
  GOOGLE_OAUTH_AUTH_URL: urlOr('https://accounts.google.com/o/oauth2/v2/auth'),
  /** Code exchange and refresh. */
  GOOGLE_OAUTH_TOKEN_URL: urlOr('https://oauth2.googleapis.com/token'),
  GOOGLE_OAUTH_REVOKE_URL: urlOr('https://oauth2.googleapis.com/revoke'),
  /** The connected account's email (needs the `openid` and `email` scopes). */
  GOOGLE_USERINFO_URL: urlOr('https://openidconnect.googleapis.com/v1/userinfo'),
  /** The Calendar REST API, without a trailing slash. */
  GOOGLE_CALENDAR_API_URL: urlOr('https://www.googleapis.com/calendar/v3'),

  /** Fallback for the console's client id / secret. */
  GOOGLE_CALENDAR_CLIENT_ID: optional(200),
  GOOGLE_CALENDAR_CLIENT_SECRET: optional(200),
  /** Overrides the callback address (default `<APP_URL>/v2/public/appointments/calendar/google/callback`) when no console value is saved. */
  GOOGLE_CALENDAR_REDIRECT_URI: z.preprocess(blank, z.string().url().optional()),

  /** Ceiling for one call to Google, in ms. A booking never waits longer for a calendar. */
  GOOGLE_HTTP_TIMEOUT_MS: z.preprocess(
    blank,
    z.coerce.number().int().min(500).max(60_000).default(8_000),
  ),
  /** How long one busy-time answer is reused, in seconds (0 turns the cache off). */
  GOOGLE_BUSY_CACHE_SECONDS: z.preprocess(
    blank,
    z.coerce.number().int().min(0).max(600).default(30),
  ),
  /** After a failed busy-time call, how long to answer "no busy data" at once instead of waiting on Google again, in seconds. */
  GOOGLE_BUSY_BACKOFF_SECONDS: z.preprocess(
    blank,
    z.coerce.number().int().min(0).max(600).default(20),
  ),
});

export type GoogleCalendarEnv = z.output<typeof schema>;

export function googleCalendarEnv(env: NodeJS.ProcessEnv = process.env): GoogleCalendarEnv {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid Google Calendar environment:\n${details}\n`);
  }
  return parsed.data;
}

/** The scopes asked for: send events, read free/busy and the calendar list, and the account email. No more than that. */
export const GOOGLE_CALENDAR_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
] as const;

/** Google lets a person untick scopes on the consent screen: a grant without these cannot do the work. */
export const GOOGLE_CALENDAR_REQUIRED_SCOPES = GOOGLE_CALENDAR_SCOPES.filter((s) =>
  s.startsWith('https://'),
);
