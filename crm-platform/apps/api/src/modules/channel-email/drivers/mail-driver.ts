import type { MailAuthKind, MailProvider } from '@crm/contracts';
import type {
  MailAccountProfile,
  NormalisedMail,
  OutgoingMail,
  PasswordConnection,
} from '../../../infra/providers/channel-email';
import type { MailboxRow } from '../mailboxes.repository';

/**
 * The provider port of the Email channel (Phase 2 seams). Everything provider-specific lives behind a `MailDriver`; the sync, the ingest,
 * the send adapter and the connect flow talk only to this interface through the {@link MailDriverRegistry} and never branch on a provider
 * name. A driver holds no tenant and no database: it is handed the mailbox row, the opened credentials and what it may ask the platform
 * (`MailSyncOptions`), and it answers with provider-neutral shapes.
 */

/** What a driver was handed to talk to the provider with: the access the token service opened for this mailbox. */
export type MailAccess =
  { kind: 'oauth'; accessToken: string } | { kind: 'password'; connection: PasswordConnection };

export interface MailDriverContext {
  orgId: number;
  mailbox: MailboxRow;
  access: MailAccess;
}

/** A sync position, provider-defined and JSON-serialisable (`mail_mailboxes.sync_cursor`). Gmail: `{ historyId }`. */
export type MailCursor = Record<string, unknown>;

export interface MailSyncOptions {
  /** The most NEW messages to return; the rest wait for the next run. */
  maxMessages: number;
  /** The most provider pages to read in one run. */
  maxPages: number;
  /** How many days back a first sync (and a repair) reads. */
  backfillDays: number;
  /** True when the provider message id is already stored on this mailbox's channel: such a message is never downloaded again. */
  isKnown(providerMessageId: string): Promise<boolean>;
  /** The thread key already stored for each of these Message-IDs (for header-based thread resolution: `resolveThreadKey(..., known)`). */
  knownThreadKeys(messageIds: string[]): Promise<Map<string, string>>;
}

export type MailSyncMode =
  /** No cursor yet: the last days were read, stored quietly. */
  | 'backfill'
  /** The cursor was lost or invalidated: the last days were read again, stored quietly. */
  | 'repair'
  /** The normal run: what arrived since the cursor, stored as live mail. */
  | 'history';

export interface MailSyncBatch {
  /** NEW messages only (the driver filtered what `isKnown` said it had), OLDEST FIRST, at most `maxMessages`. */
  messages: NormalisedMail[];
  /**
   * Where the next run starts once every returned message was dealt with. NULL = leave the stored cursor where it is (a run that has more
   * waiting, or a provider with no cursor yet). A message that could not be stored never holds the cursor back.
   */
  nextCursor: MailCursor | null;
  /** More new mail is waiting than this run returned. */
  hasMore: boolean;
  mode: MailSyncMode;
  /** Backfilled and repaired mail is history (no unread, no notification, no automation); only live mail alerts. */
  quiet: boolean;
  /** Messages the provider listed that were already stored. */
  duplicates: number;
  /** Messages the provider listed that were not worth storing (spam, trash, drafts, vanished). */
  skipped: number;
  /** Messages the driver could not read or parse (a bug, a hostile mail): left behind, counted, never blocking the cursor. */
  failed: number;
}

export interface MailSendResult {
  /** The provider's id of the sent message (stored as the outbound message's provider id). */
  providerMessageId: string;
  /** The provider's own thread id of the sent message, when it has one. */
  threadKey?: string | null;
}

export interface MailHealthResult {
  /** The account name or address the provider reports, shown in the channel health card. */
  displayName: string | null;
}

/** A push registration with the provider (Gmail watch, Graph subscription), stored in `mail_mailboxes.push_state`. */
export interface MailPushState {
  /** `gmail_watch` | `graph_subscription` | ... */
  kind: string;
  /** The provider's id of the registration, when it has one (a Graph subscription id). */
  id: string | null;
  /** ISO time after which the registration is dead and must be renewed. */
  expiresAt: string;
  [extra: string]: unknown;
}

/** Optional: providers that can tell us about new mail instead of being polled. A driver without it is polled by the sweep only. */
export interface MailPushSupport {
  /** True when the platform has what push needs (a Pub/Sub topic, a public notification URL). */
  available(): Promise<boolean>;
  /** Registers (or renews) the push; returns the state to store, or null when push is not possible right now. */
  start(ctx: MailDriverContext): Promise<MailPushState | null>;
  /** Withdraws the registration (a disconnect). Never throws for an already-gone one. */
  stop(ctx: MailDriverContext): Promise<void>;
}

interface MailDriverBase {
  readonly provider: MailProvider;
  readonly authKind: MailAuthKind;
  /** The provider's name as the hub shows it. */
  readonly label: string;
  /** Platform-level readiness: is the provider set up (credentials, switched on)? Password providers are always ready. */
  readiness(): Promise<{ ready: boolean; notReadyReason: string | null }>;
  /**
   * Reads what is new since `cursor` (null = first run). Throws {@link MailDriverError}; never a provider-specific error. Messages whose
   * attachments are not inline come with a lazy `fetch`.
   */
  sync(
    ctx: MailDriverContext,
    cursor: MailCursor | null,
    opts: MailSyncOptions,
  ): Promise<MailSyncBatch>;
  /**
   * Sends a complete reply (signature merged, attachments resolved to bytes). When `mail.attempt > 1` the driver first looks for a message
   * with `mail.messageId` (an earlier try may have reached the provider) and answers with that one instead of sending twice.
   */
  send(ctx: MailDriverContext, mail: OutgoingMail): Promise<MailSendResult>;
  /** A cheap authenticated call that proves the connection works. Throws {@link MailDriverError}. */
  health(ctx: MailDriverContext): Promise<MailHealthResult>;
  /** Present when the provider can push (see {@link MailPushSupport}). */
  readonly push?: MailPushSupport;
}

/** A provider that signs in through a popup (Google, Microsoft). */
export interface OAuthMailDriver extends MailDriverBase {
  readonly authKind: 'oauth';
  /** Scopes the connection must have been granted; the connect flow refuses a grant missing one (`missing_scope`). */
  readonly requiredScopes: readonly string[];
  /** The consent URL carrying our signed `state`. Throws `MailDriverError('not_configured')` without platform credentials. */
  authorizeUrl(input: { state: string; loginHint: string | null }): Promise<string>;
  /** Trades the callback `code` for tokens. */
  exchange(code: string): Promise<MailOAuthGrant>;
  /** A new access token from the refresh token. Throws `MailDriverError('reauth')` when the grant is dead. */
  refresh(refreshToken: string): Promise<MailOAuthRefreshed>;
  /** Withdraws the grant at the provider. Never throws for an already-revoked token. */
  revoke(token: string): Promise<void>;
  /** The account behind an access token (its address, stable id and name). */
  profile(accessToken: string): Promise<MailAccountProfile>;
}

export interface MailOAuthGrant {
  accessToken: string;
  /** Only when the provider issued one. */
  refreshToken: string | null;
  expiresInSeconds: number;
  /** The scopes actually granted. */
  scopes: string[];
  /** Provider extras to keep sealed in `connection_enc` (a Graph tenant id, ...). */
  extras?: Record<string, unknown>;
}

export interface MailOAuthRefreshed {
  accessToken: string;
  expiresInSeconds: number;
}

/** A provider that is connected with the account's own settings and password (IMAP/SMTP). */
export interface PasswordMailDriver extends MailDriverBase {
  readonly authKind: 'password';
  /**
   * Proves both logins (IMAP read and SMTP send) before anything is stored. Throws `MailDriverError('auth_failed')` with `providerCode`
   * `imap` or `smtp` for a refused password, `unreachable` for a server that does not answer or fails TLS.
   */
  verify(connection: PasswordConnection): Promise<MailAccountProfile>;
}

export type MailDriver = OAuthMailDriver | PasswordMailDriver;

export const isOAuthDriver = (d: MailDriver): d is OAuthMailDriver => d.authKind === 'oauth';
export const isPasswordDriver = (d: MailDriver): d is PasswordMailDriver =>
  d.authKind === 'password';

/** The few failures the callers treat differently, whatever the provider. */
export type MailDriverErrorKind =
  /** The grant is dead (revoked, expired): only a new sign-in helps. The mailbox becomes `needs_reauth`. */
  | 'reauth'
  /** The login was refused (a password provider; or the account). The mailbox becomes `needs_reauth`. */
  | 'auth_failed'
  /** An access token was refused: refresh once and call again. */
  | 'token_rejected'
  /** The platform has no (or wrong) credentials for this provider: nothing the workspace can fix. */
  | 'not_configured'
  /** Not allowed (a scope missing, the API disabled). */
  | 'forbidden'
  | 'missing_scope'
  | 'rate_limit'
  /** The provider or the network failed; a later try may work. */
  | 'transient'
  /** The server could not be reached or its TLS failed (a password provider). */
  | 'unreachable'
  | 'bad_request'
  | 'too_large'
  | 'not_found';

/**
 * What every driver throws. `message` is safe for the hub (never provider text, never a password or host detail); `providerCode` is the
 * provider's short reason, safe to log.
 */
export class MailDriverError extends Error {
  constructor(
    readonly kind: MailDriverErrorKind,
    message: string,
    readonly opts: {
      retryable?: boolean;
      providerCode?: string | null;
      status?: number | null;
      /** The send is refused because the mailbox may no longer send (a missing permission): the hub should say "Reconnect". */
      needsReauth?: boolean;
    } = {},
  ) {
    super(message);
    this.name = 'MailDriverError';
  }

  /** A later attempt may succeed without anyone changing anything. */
  get retryable(): boolean {
    return (
      this.opts.retryable ??
      (this.kind === 'rate_limit' || this.kind === 'transient' || this.kind === 'token_rejected')
    );
  }
  get providerCode(): string {
    return this.opts.providerCode ?? '';
  }
  get status(): number | null {
    return this.opts.status ?? null;
  }
  get needsReauth(): boolean {
    return this.opts.needsReauth ?? (this.kind === 'reauth' || this.kind === 'auth_failed');
  }
}
