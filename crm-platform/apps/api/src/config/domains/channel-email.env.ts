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

  /**
   * Microsoft 365 / Outlook through Microsoft Graph (TW-MAIL-034). The identity platform and Graph hosts (a test aims them at a local
   * stand-in; `{tenant}` is replaced in the login address), and the fallbacks for the console's `microsoftMail` group.
   */
  MICROSOFT_LOGIN_URL: urlOr('https://login.microsoftonline.com'),
  MICROSOFT_GRAPH_URL: urlOr('https://graph.microsoft.com/v1.0'),
  MICROSOFT_MAIL_CLIENT_ID: optional(200),
  MICROSOFT_MAIL_CLIENT_SECRET: optional(300),
  /** `common` (work, school and personal accounts), `organizations`, `consumers`, or one directory's id. */
  MICROSOFT_MAIL_TENANT: optional(100),
  MICROSOFT_MAIL_REDIRECT_URI: z.preprocess(blank, z.string().url().optional()),
  /** Ceiling for one call to Microsoft, in ms. */
  MICROSOFT_MAIL_HTTP_TIMEOUT_MS: int(1_000, 120_000, 20_000),

  /**
   * Gmail push (TW-MAIL-033). Fallbacks for the console's pubsubTopic / pushAudience / pushServiceAccount: the Pub/Sub topic the Gmail
   * watch publishes to (`projects/<p>/topics/<t>`), the audience the push subscription's OIDC token is minted for (empty: the push
   * endpoint's own address), and the service account that signs that token. Without a topic and a service account push is off and
   * the mailboxes are polled.
   */
  GOOGLE_MAIL_PUBSUB_TOPIC: optional(300),
  GOOGLE_MAIL_PUSH_AUDIENCE: optional(500),
  GOOGLE_MAIL_PUSH_SERVICE_ACCOUNT: optional(300),
  /** Google's signing keys for the push token (a test aims it at a local stand-in). */
  GOOGLE_OIDC_JWKS_URL: urlOr('https://www.googleapis.com/oauth2/v3/certs'),
  /** A push-active mailbox is still synced by polling at least this often (minutes): the safety net behind a lost notification. */
  MAIL_PUSH_RECONCILE_MINUTES: int(1, 10, 10),
  /** A Gmail watch (valid 7 days) is renewed when it has less than this left (hours). */
  MAIL_PUSH_RENEW_BEFORE_HOURS: int(1, 72, 24),

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

  /**
   * IMAP / SMTP (TW-MAIL-031). A server on a private, loopback or link-local address (or the cloud metadata address) is refused, so a
   * workspace admin cannot aim the platform at its own network. Turn this on only for a self-hosted install whose mail server is on the
   * private network, or in a test against a local mail server.
   */
  MAIL_IMAP_ALLOW_PRIVATE_HOSTS: flag(false),
  /** Ceiling to reach, greet and answer one IMAP or SMTP server, in ms. */
  MAIL_IMAP_TIMEOUT_MS: int(1_000, 120_000, 20_000),
  /** A received message larger than this is not downloaded (counted as failed), in bytes. */
  MAIL_IMAP_MAX_MESSAGE_BYTES: int(1_024, 200 * 1024 * 1024, 40 * 1024 * 1024),

  /**
   * Composer uploads (TW-MAIL-027). Per file, per reply and count caps (the contract's numbers are the defaults), how long a staged file
   * waits to be sent, and the mime allow / deny lists (comma separated, `type/*` wildcards; an empty allow list = whatever the media
   * upload policy accepts; the deny list wins).
   */
  MAIL_OUTBOUND_ATTACHMENT_MAX_BYTES: int(1, 50 * 1024 * 1024, 10 * 1024 * 1024),
  MAIL_OUTBOUND_ATTACHMENTS_TOTAL_MAX_BYTES: int(1, 100 * 1024 * 1024, 20 * 1024 * 1024),
  MAIL_OUTBOUND_ATTACHMENTS_MAX_COUNT: int(1, 50, 10),
  MAIL_OUTBOUND_ATTACHMENT_TTL_HOURS: int(1, 168, 24),
  MAIL_OUTBOUND_ATTACHMENT_ALLOW_MIME: z.preprocess(blank, z.string().max(2_000).default('')),
  MAIL_OUTBOUND_ATTACHMENT_DENY_MIME: z.preprocess(blank, z.string().max(2_000).default('')),

  /**
   * Send and receive limits (TW-MAIL-032). The hourly cap of a mailbox that has none of its own (`mail_mailboxes.send_limit_per_hour`);
   * the most mails to one address from one mailbox inside the burst window; the most mails one sender address may send a mailbox inside the
   * flood window before the rest are stored quietly; and how long an address that hard-bounced is refused.
   */
  MAIL_SEND_LIMIT_PER_HOUR: int(1, 10_000, 100),
  MAIL_RECIPIENT_BURST_MAX: int(1, 1_000, 5),
  MAIL_RECIPIENT_BURST_WINDOW_S: int(1, 3_600, 60),
  MAIL_INBOUND_FLOOD_MAX: int(1, 10_000, 30),
  MAIL_INBOUND_FLOOD_WINDOW_S: int(10, 86_400, 600),
  MAIL_BOUNCE_BLOCK_DAYS: int(1, 365, 7),
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

/**
 * Microsoft Graph delegated scopes (TW-MAIL-034): sign in, the account address, read and send mail, the profile, and a refresh token.
 * Nothing that can modify or delete mail.
 */
export const MICROSOFT_MAIL_SCOPES = [
  'openid',
  'email',
  'offline_access',
  'Mail.Read',
  'Mail.Send',
  'User.Read',
] as const;

/** A person can untick permissions on the consent screen (or an admin can restrict them): a grant without these cannot do the work. */
export const MICROSOFT_MAIL_REQUIRED_SCOPES = ['Mail.Read', 'Mail.Send'] as const;
