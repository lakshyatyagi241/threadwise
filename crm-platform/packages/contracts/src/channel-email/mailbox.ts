import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * Email mailboxes (TW-MAIL-019 to 023, 028). A mailbox is a Google (Gmail / Workspace) account a workspace admin connected with
 * a sign-in popup. Mail flows into the team inbox, one inbox channel per mailbox. Tokens are never returned.
 */

export const MAIL_PROVIDERS = ['google'] as const;
export const mailProviderSchema = z.enum(MAIL_PROVIDERS);
export type MailProvider = z.infer<typeof mailProviderSchema>;

export const MAILBOX_STATUSES = ['connected', 'needs_reauth', 'error', 'disconnected'] as const;
export const mailboxStatusSchema = z.enum(MAILBOX_STATUSES);
export type MailboxStatus = z.infer<typeof mailboxStatusSchema>;

/** How many mailboxes a workspace may connect when its plan does not say (plan limit `email_mailboxes`; 0 = unlimited). */
export const DEFAULT_EMAIL_MAILBOXES = 3;

export const mailboxResponseSchema = z.object({
  id: uuidSchema,
  provider: mailProviderSchema,
  /** The mailbox address, e.g. support@acme.com. */
  address: z.string(),
  /** The name replies go out under. */
  displayName: z.string(),
  status: mailboxStatusSchema,
  /** The inbox channel this mailbox feeds (filter the inbox by it). Null until the first sync created it. */
  channelId: uuidSchema.nullable(),
  connectedAt: z.string().datetime().nullable(),
  lastSyncedAt: z.string().datetime().nullable(),
  /** Why the last sync or send failed; null when healthy. */
  lastError: z.string().nullable(),
  /** Conversations from this mailbox. */
  conversationCount: z.number().int(),
  rowVersion: z.number().int(),
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

export const startMailboxConnectSchema = z.object({
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

export const startMailboxConnectResponseSchema = z.object({ authorizeUrl: z.string().url() });
export type StartMailboxConnectResponse = z.infer<typeof startMailboxConnectResponseSchema>;

export const updateMailboxSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
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
