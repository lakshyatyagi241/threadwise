import { z } from 'zod';

/**
 * Environment of the Email (Gmail) channel (TW-MAIL-020 to 022, 029). Read straight from the environment (the central schema belongs to
 * the kernel) and validated at call time, so a test can point it at a local stand-in for Google between runs.
 *
 * The client id and secret normally come from the console (the `googleMail` settings group); the three `GOOGLE_MAIL_*` values are the
 * fallback for a deployment that configures them in the environment. They are a different Google OAuth client from Google Calendar's: the
 * Gmail scopes are "restricted" and the client needs Google's verification, which a calendar-only client does not. A compose file passes
 * an unset variable as an empty string, which must mean "not set".
 *
 * The OAuth endpoint variables carry the same names as the Calendar ones on purpose: they are Google's, and one override aims both.
 */
const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optional = (max = 512) => z.preprocess(blank, z.string().max(max).optional());
const urlOr = (dflt: string) => z.preprocess(blank, z.string().url().default(dflt));
const int = (min: number, max: number, dflt: number) =>
  z.preprocess(blank, z.coerce.number().int().min(min).max(max).default(dflt));
const flag = (dflt: boolean) =>
  z.preprocess(
    (v) =>
      typeof v === 'string' && v.trim() !== ''
        ? !['0', 'false', 'off', 'no'].includes(v.trim().toLowerCase())
        : undefined,
    z.boolean().default(dflt),
  );

const schema = z.object({
  GOOGLE_OAUTH_AUTH_URL: urlOr('https://accounts.google.com/o/oauth2/v2/auth'),
  GOOGLE_OAUTH_TOKEN_URL: urlOr('https://oauth2.googleapis.com/token'),
  GOOGLE_OAUTH_REVOKE_URL: urlOr('https://oauth2.googleapis.com/revoke'),
  GOOGLE_USERINFO_URL: urlOr('https://openidconnect.googleapis.com/v1/userinfo'),
  /** The Gmail REST API, without a trailing slash. */
  GMAIL_API_URL: urlOr('https://gmail.googleapis.com/gmail/v1'),

  /** Fallback for the console's client id / secret / redirect address. */
  GOOGLE_MAIL_CLIENT_ID: optional(200),
  GOOGLE_MAIL_CLIENT_SECRET: optional(200),
  GOOGLE_MAIL_REDIRECT_URI: z.preprocess(blank, z.string().url().optional()),

  /** Ceiling for one call to Google, in ms. */
  GOOGLE_MAIL_HTTP_TIMEOUT_MS: int(1_000, 120_000, 20_000),

  /** How many days back the first sync (and the repair after a lost history cursor) reads. */
  MAIL_BACKFILL_DAYS: int(1, 30, 7),
  /** The most messages one sync run stores; the rest wait for the next run (a mailbox with a huge backlog never holds a worker). */
  MAIL_SYNC_MAX_MESSAGES: int(1, 1_000, 100),
  /** The most history pages one run reads. */
  MAIL_SYNC_MAX_PAGES: int(1, 100, 10),

  /** One attachment above this is not stored (shown as a note), in bytes. */
  MAIL_ATTACHMENT_MAX_BYTES: int(1_024, 50 * 1024 * 1024, 10 * 1024 * 1024),
  /** All attachments of one message together; the ones past it are not stored. */
  MAIL_ATTACHMENTS_TOTAL_MAX_BYTES: int(1_024, 100 * 1024 * 1024, 25 * 1024 * 1024),
  /** The largest HTML body read into the sanitiser, in characters (a bigger one is cut first, so a hostile mail cannot burn the worker). */
  MAIL_HTML_INPUT_MAX_CHARS: int(1_024, 5_000_000, 1_000_000),
  /** Remote images in a mail are not loaded until an agent asks: their address is kept in `data-remote-src`. */
  MAIL_BLOCK_REMOTE_IMAGES: flag(true),
});

export type ChannelEmailEnv = z.output<typeof schema>;

export function channelEmailEnv(env: NodeJS.ProcessEnv = process.env): ChannelEmailEnv {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid email channel environment:\n${details}\n`);
  }
  return parsed.data;
}

/** The scopes asked for: sign in (the account address), read mail, send mail. Nothing that can delete or modify. */
export const GOOGLE_MAIL_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
] as const;

/** Google lets a person untick scopes on the consent screen: a grant without these cannot do the work. */
export const GOOGLE_MAIL_REQUIRED_SCOPES = GOOGLE_MAIL_SCOPES.filter((s) =>
  s.startsWith('https://'),
);
