import { z } from 'zod';

/**
 * Environment of the Zoom and Microsoft Teams connectors for meeting video links (BL-360). Read straight from the environment and validated
 * at call time, so a test can point it at a local stand-in between runs (the same approach as `googleCalendarEnv`).
 *
 * Zoom has its own OAuth app: `ZOOM_CLIENT_ID` and `ZOOM_CLIENT_SECRET` come from the Zoom App Marketplace (a General app with the
 * meeting scopes). Teams reuses the Microsoft Entra app the operator already saved for the calendar (console, Microsoft Calendar page; its
 * environment fallback is `MICROSOFT_CALENDAR_CLIENT_*`), with the delegated `OnlineMeetings.ReadWrite` permission added and the Teams
 * redirect address registered next to the calendar's. `TEAMS_CLIENT_*` override that app when a deployment wants a separate one.
 * A compose file passes an unset variable as an empty string, which must mean "not set".
 */
const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optional = (max = 512) => z.preprocess(blank, z.string().max(max).optional());
const urlOr = (dflt: string) => z.preprocess(blank, z.string().url().default(dflt));

const schema = z.object({
  /** Where the browser is sent for Zoom consent, and the code exchange and refresh. */
  ZOOM_OAUTH_AUTH_URL: urlOr('https://zoom.us/oauth/authorize'),
  ZOOM_OAUTH_TOKEN_URL: urlOr('https://zoom.us/oauth/token'),
  /** The Zoom REST API, without a trailing slash. */
  ZOOM_API_URL: urlOr('https://api.zoom.us/v2'),
  ZOOM_CLIENT_ID: optional(200),
  ZOOM_CLIENT_SECRET: optional(400),
  /** Overrides the callback address (default `<APP_URL>/v2/public/conferencing/zoom/callback`). */
  ZOOM_REDIRECT_URI: z.preprocess(blank, z.string().url().optional()),

  /** A separate Entra app for Teams, instead of the calendar's. */
  TEAMS_CLIENT_ID: optional(200),
  TEAMS_CLIENT_SECRET: optional(400),
  TEAMS_TENANT: optional(100),
  /** Overrides the callback address (default `<APP_URL>/v2/public/conferencing/teams/callback`). */
  TEAMS_REDIRECT_URI: z.preprocess(blank, z.string().url().optional()),

  /** Ceiling for one call to a video provider, in ms. A meeting is saved before this is spent; the link follows. */
  CONFERENCING_HTTP_TIMEOUT_MS: z.preprocess(
    blank,
    z.coerce.number().int().min(500).max(60_000).default(8_000),
  ),
  /** Extra attempts after a 429, a 5xx, a timeout or a network error, for calls that are safe to repeat (not the create of a Zoom meeting). */
  CONFERENCING_RETRIES: z.preprocess(blank, z.coerce.number().int().min(0).max(5).default(2)),
  CONFERENCING_RETRY_BASE_MS: z.preprocess(
    blank,
    z.coerce.number().int().min(1).max(10_000).default(300),
  ),
  CONFERENCING_RETRY_AFTER_CAP_SECONDS: z.preprocess(
    blank,
    z.coerce.number().int().min(0).max(60).default(5),
  ),
  /**
   * `1` binds the in-memory fake Zoom and Teams adapters instead of the real ones: for a development stack and the end-to-end browser pass,
   * where no Zoom or Microsoft account exists. Never set in production; the fake makes up links that do not open a call.
   */
  CONFERENCING_FAKE: z.preprocess(blank, z.enum(['0', '1']).default('0')),
});

export type MeetingConferencingEnv = z.output<typeof schema>;

export function meetingConferencingEnv(env: NodeJS.ProcessEnv = process.env): MeetingConferencingEnv {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid meeting conferencing environment:\n${details}\n`);
  }
  return parsed.data;
}
