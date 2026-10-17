import { z } from 'zod';

/**
 * Environment of the Outlook / Microsoft 365 calendar adapter (BL-035). Read straight from the environment and validated at call time, so a
 * test can point it at a local stand-in for Microsoft between runs (the same approach as `googleCalendarEnv`).
 *
 * The client id, secret and tenant normally come from the console (Microsoft Calendar settings page); the `MICROSOFT_CALENDAR_CLIENT_*`
 * values are the fallback for a deployment that configures them in the environment. A compose file passes an unset variable as an empty
 * string, which must mean "not set".
 */
const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optional = (max = 512) => z.preprocess(blank, z.string().max(max).optional());
const urlOr = (dflt: string) => z.preprocess(blank, z.string().url().default(dflt));

const schema = z.object({
  /** The Microsoft identity platform, without a trailing slash: `<login>/<tenant>/oauth2/v2.0/{authorize,token}`. */
  MICROSOFT_CALENDAR_LOGIN_URL: urlOr('https://login.microsoftonline.com'),
  /** Microsoft Graph, without a trailing slash. */
  MICROSOFT_CALENDAR_GRAPH_URL: urlOr('https://graph.microsoft.com/v1.0'),

  /** Fallback for the console's client id / secret / tenant. */
  MICROSOFT_CALENDAR_CLIENT_ID: optional(200),
  MICROSOFT_CALENDAR_CLIENT_SECRET: optional(400),
  MICROSOFT_CALENDAR_TENANT: optional(100),
  /** Overrides the callback address (default `<APP_URL>/v2/public/appointments/calendar/microsoft/callback`) when no console value is saved. */
  MICROSOFT_CALENDAR_REDIRECT_URI: z.preprocess(blank, z.string().url().optional()),

  /** Ceiling for one call to Microsoft, in ms. A booking never waits longer for a calendar. */
  MICROSOFT_CALENDAR_HTTP_TIMEOUT_MS: z.preprocess(
    blank,
    z.coerce.number().int().min(500).max(60_000).default(8_000),
  ),
  /** Extra attempts after a 429, a 5xx, a timeout or a network error, for the calls that are safe to repeat. Full jitter. */
  MICROSOFT_CALENDAR_RETRIES: z.preprocess(blank, z.coerce.number().int().min(0).max(5).default(2)),
  MICROSOFT_CALENDAR_RETRY_BASE_MS: z.preprocess(
    blank,
    z.coerce.number().int().min(1).max(10_000).default(300),
  ),
  /** A `Retry-After` longer than this is not waited for here: the caller (outbox, worker) tries again later. */
  MICROSOFT_CALENDAR_RETRY_AFTER_CAP_SECONDS: z.preprocess(
    blank,
    z.coerce.number().int().min(0).max(60).default(5),
  ),
  /** How long one busy-time answer is reused, in seconds (0 turns the cache off). */
  MICROSOFT_CALENDAR_BUSY_CACHE_SECONDS: z.preprocess(
    blank,
    z.coerce.number().int().min(0).max(600).default(30),
  ),
  /** After a failed busy-time call, how long to answer "no busy data" at once instead of waiting on Microsoft again. */
  MICROSOFT_CALENDAR_BUSY_BACKOFF_SECONDS: z.preprocess(
    blank,
    z.coerce.number().int().min(0).max(600).default(20),
  ),
});

export type MicrosoftCalendarEnv = z.output<typeof schema>;

export function microsoftCalendarEnv(env: NodeJS.ProcessEnv = process.env): MicrosoftCalendarEnv {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid Microsoft Calendar environment:\n${details}\n`);
  }
  return parsed.data;
}
