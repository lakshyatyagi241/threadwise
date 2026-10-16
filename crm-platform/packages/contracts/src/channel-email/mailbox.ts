import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * Email mailboxes (TW-MAIL-019 to 023, 028, 031, 034, 035). A mailbox is a Gmail / Google Workspace or Microsoft 365 account connected
 * with a sign-in popup, or any IMAP/SMTP account connected with its settings and password. Mail flows into the team inbox, one inbox
 * channel per mailbox. A mailbox is `shared` (the company's) or `personal` (one person's own). Tokens and passwords are never returned.
 */

export const MAIL_PROVIDERS = ['google', 'microsoft', 'imap'] as const;
export const mailProviderSchema = z.enum(MAIL_PROVIDERS);
export type MailProvider = z.infer<typeof mailProviderSchema>;

/** How the user proves they own the mailbox: a sign-in popup (`oauth`) or the account's settings and password (`password`). */
export const MAIL_AUTH_KINDS = ['oauth', 'password'] as const;
export const mailAuthKindSchema = z.enum(MAIL_AUTH_KINDS);
export type MailAuthKind = z.infer<typeof mailAuthKindSchema>;

export const MAIL_SCOPES = ['shared', 'personal'] as const;
export const mailScopeSchema = z.enum(MAIL_SCOPES);
export type MailScope = z.infer<typeof mailScopeSchema>;

export const MAIL_TLS_MODES = ['ssl', 'starttls', 'none'] as const;
export const mailTlsModeSchema = z.enum(MAIL_TLS_MODES);
export type MailTlsMode = z.infer<typeof mailTlsModeSchema>;

export const MAILBOX_STATUSES = ['connected', 'needs_reauth', 'error', 'disconnected'] as const;
export const mailboxStatusSchema = z.enum(MAILBOX_STATUSES);
export type MailboxStatus = z.infer<typeof mailboxStatusSchema>;

/** How many mailboxes a workspace may connect when its plan does not say (plan limit `email_mailboxes`; 0 = unlimited). */
export const DEFAULT_EMAIL_MAILBOXES = 3;

/** What the hub shows of an IMAP/SMTP connection. The password is never part of it. */
export const imapSummarySchema = z.object({
  host: z.string(),
  port: z.number().int(),
  security: mailTlsModeSchema,
  username: z.string(),
  smtpHost: z.string(),
  smtpPort: z.number().int(),
  smtpSecurity: mailTlsModeSchema,
});
export type ImapSummary = z.infer<typeof imapSummarySchema>;

export const mailboxResponseSchema = z.object({
  id: uuidSchema,
  provider: mailProviderSchema,
  /** The mailbox address, e.g. support@acme.com. */
  address: z.string(),
  /** The name replies go out under. */
  displayName: z.string(),
  status: mailboxStatusSchema,
  scope: mailScopeSchema,
  /** Personal mailboxes: the owner (a user id) and their name; null on a shared mailbox. */
  ownerUserId: uuidSchema.nullable(),
  ownerName: z.string().nullable(),
  /** At least one signature belongs to this mailbox (the composer will add the default one). */
  hasSignature: z.boolean(),
  /** Mail arrives by provider push (Gmail Pub/Sub, Graph subscription) rather than by polling alone. */
  pushActive: z.boolean(),
  /** Messages this mailbox may send per hour; null = the platform default. */
  sendLimitPerHour: z.number().int().nullable(),
  /** Only on an `imap` mailbox. */
  imap: imapSummarySchema.nullable(),
  /** The inbox channel this mailbox feeds (filter the inbox by it). Null until the first sync created it. */
  channelId: uuidSchema.nullable(),
  connectedAt: z.string().datetime().nullable(),
  lastSyncedAt: z.string().datetime().nullable(),
  /** Why the last sync or send failed; null when healthy. */
  lastError: z.string().nullable(),
  /**
   * Seconds since the last successful sync of a connected mailbox: how far behind the inbox may be (the sweep syncs about once a minute,
   * push within seconds). Null when never synced or not connected. Absent on a summary row.
   */
  syncLagSeconds: z.number().int().nullable().optional(),
  /** Conversations from this mailbox. */
  conversationCount: z.number().int(),
  rowVersion: z.number().int(),
  /**
   * True on another person's personal mailbox that the viewer (an admin) may see exists but not read: the row is a summary (no conversation
   * count, no error text, no server settings, no inbox filter) and offers no actions but Disconnect. Absent / false otherwise.
   */
  contentHidden: z.boolean().optional(),
});
export type MailboxResponse = z.infer<typeof mailboxResponseSchema>;

export const mailboxListResponseSchema = z.object({
  data: z.array(mailboxResponseSchema),
  /** The plan's `email_mailboxes` limit; 0 = unlimited. */
  limit: z.number().int(),
  used: z.number().int(),
  /** False while the platform operator has not entered the Google credentials: Connect shows who must set it up. */
  providerReady: z.boolean(),
});
export type MailboxListResponse = z.infer<typeof mailboxListResponseSchema>;

/** The outcome of `GET /v2/email/providers`: which providers the workspace can connect, and why one cannot be yet. */
export const mailProviderInfoSchema = z.object({
  provider: mailProviderSchema,
  label: z.string(),
  kind: mailAuthKindSchema,
  /** False while the platform operator has not set the provider up (IMAP is always ready). */
  ready: z.boolean(),
  /** Short text for the operator-facing reason when not ready; null when ready. */
  notReadyReason: z.string().nullable(),
});
export type MailProviderInfo = z.infer<typeof mailProviderInfoSchema>;
export const mailProviderListResponseSchema = z.object({ data: z.array(mailProviderInfoSchema) });
export type MailProviderListResponse = z.infer<typeof mailProviderListResponseSchema>;

export const startMailboxConnectSchema = z.object({
  /** Which provider's sign-in to start (an `oauth` provider; IMAP uses {@link connectImapMailboxSchema}). */
  provider: mailProviderSchema.default('google'),
  /** `personal` needs the workspace policy and `mail.mailboxes.manage_personal`; the mailbox then belongs to the caller. */
  scope: mailScopeSchema.default('shared'),
  /** Where the browser goes after Google answers (a same-site path). */
  returnTo: z
    .string()
    .trim()
    .max(200)
    .regex(/^\/(?!\/)/)
    .default('/email'),
  /** Reconnect an existing mailbox instead of adding one. */
  mailboxId: uuidSchema.optional(),
});
export type StartMailboxConnectInput = z.infer<typeof startMailboxConnectSchema>;

const hostSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^[A-Za-z0-9.-]+$/, 'host must be a host name or an address');
const portSchema = z.number().int().min(1).max(65535);

/** Connects an IMAP/SMTP mailbox (TW-MAIL-031). The server verifies both logins before storing anything. */
export const connectImapMailboxSchema = z.object({
  scope: mailScopeSchema.default('shared'),
  /** The mailbox address replies go out from. */
  address: z.string().trim().toLowerCase().email().max(320),
  displayName: z.string().trim().min(1).max(80),
  imap: z.object({
    host: hostSchema,
    port: portSchema.default(993),
    security: mailTlsModeSchema.default('ssl'),
    username: z.string().trim().min(1).max(320),
    password: z.string().min(1).max(1024),
  }),
  smtp: z.object({
    host: hostSchema,
    port: portSchema.default(465),
    security: mailTlsModeSchema.default('ssl'),
    /** Defaults to the IMAP user name and password when left out. */
    username: z.string().trim().min(1).max(320).optional(),
    password: z.string().min(1).max(1024).optional(),
  }),
  /** Reconnect (new password / settings) an existing IMAP mailbox instead of adding one. */
  mailboxId: uuidSchema.optional(),
});
export type ConnectImapMailboxInput = z.infer<typeof connectImapMailboxSchema>;

/**
 * "Test credentials" (IMAP/SMTP): the same settings as {@link connectImapMailboxSchema} without the mailbox identity. Nothing is stored and
 * nothing is sent: the server only connects, signs in, opens the INBOX and says hello to the SMTP server.
 */
export const testImapMailboxSchema = z.object({
  imap: connectImapMailboxSchema.shape.imap,
  smtp: connectImapMailboxSchema.shape.smtp,
});
export type TestImapMailboxInput = z.infer<typeof testImapMailboxSchema>;

/** The step of a test that failed: IMAP connect, login and opening the INBOX; SMTP connect (with the greeting) and sign-in. */
export const MAIL_TEST_STEPS = ['connect', 'login', 'inbox', 'auth'] as const;
export const mailTestStepSchema = z.enum(MAIL_TEST_STEPS);
export type MailTestStep = z.infer<typeof mailTestStepSchema>;

/** Why a test failed, as a short code the screen can word (our own words also come in `message`). */
export const MAIL_TEST_REASONS = [
  'auth_failed',
  'tls',
  'unreachable',
  'blocked_address',
  'rejected',
  'unknown',
] as const;
export const mailTestReasonSchema = z.enum(MAIL_TEST_REASONS);
export type MailTestReason = z.infer<typeof mailTestReasonSchema>;

export const mailTestSideSchema = z.object({
  ok: z.boolean(),
  /** The step that failed; null when `ok`. */
  failedStep: mailTestStepSchema.nullable(),
  reason: mailTestReasonSchema.nullable(),
  /** One sentence in our words (never the server's text, a host or a password); null when `ok`. */
  message: z.string().nullable(),
  /** IMAP only, when `ok`: how many messages the INBOX holds. */
  inboxMessages: z.number().int().nullable(),
});
export type MailTestSide = z.infer<typeof mailTestSideSchema>;

/** Both sides are always tested, so one run tells the person everything that is wrong. */
export const mailConnectionTestResponseSchema = z.object({
  ok: z.boolean(),
  imap: mailTestSideSchema,
  smtp: mailTestSideSchema,
});
export type MailConnectionTestResponse = z.infer<typeof mailConnectionTestResponseSchema>;

/** What the hub can change on a mailbox besides its name: the hourly send cap (null = platform default). */
export const MAIL_SEND_LIMIT_MAX = 10_000;
export const startMailboxConnectResponseSchema = z.object({ authorizeUrl: z.string().url() });
export type StartMailboxConnectResponse = z.infer<typeof startMailboxConnectResponseSchema>;

export const updateMailboxSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  /** Omit to leave as it is; `null` = the platform default (TW-MAIL-032). */
  sendLimitPerHour: z.number().int().min(1).max(MAIL_SEND_LIMIT_MAX).nullable().optional(),
  rowVersion: z.number().int(),
});
export type UpdateMailboxInput = z.infer<typeof updateMailboxSchema>;

/** The `?email=<outcome>` the callback redirect carries back to the screen. */
export const MAIL_CONNECT_OUTCOMES = [
  'connected',
  'denied',
  'missing_scope',
  'limit',
  'not_configured',
  'wrong_account',
  'failed',
] as const;
export type MailConnectOutcome = (typeof MAIL_CONNECT_OUTCOMES)[number];

/** The public OAuth callbacks (registered as redirect URIs at the provider's console). */
export const MAIL_MICROSOFT_CALLBACK_PATH = '/v2/public/email/microsoft/callback';
/** Gmail push (Pub/Sub) and Graph change notifications arrive here, authenticated by the provider's own token. */
export const MAIL_GOOGLE_PUSH_PATH = '/v2/public/email/google/push';
export const MAIL_MICROSOFT_PUSH_PATH = '/v2/public/email/microsoft/push';

/** The public OAuth callback Google redirects to (registered as the redirect URI in the Google Cloud console). */
export const MAIL_GOOGLE_CALLBACK_PATH = '/v2/public/email/google/callback';

/** What Google puts on the callback address: the code (or an `error` such as `access_denied`), the signed state we issued, the granted scopes. */
export const mailCallbackQuerySchema = z.object({
  code: z.string().max(2048).optional(),
  state: z.string().max(2048).optional(),
  error: z.string().max(200).optional(),
  scope: z.string().max(2048).optional(),
});
export type MailCallbackQuery = z.infer<typeof mailCallbackQuerySchema>;
