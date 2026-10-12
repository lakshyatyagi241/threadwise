/**
 * The provider-neutral shapes every mail driver speaks (Phase 2 seams, docs/threadwise-port/plan/channel-email-build.md). Pure types and
 * constants: no I/O, no framework. A driver turns its provider's message into a {@link NormalisedMail} and an {@link OutgoingMail} into its
 * provider's send call; everything above the driver (sync, ingest, the adapter) sees only these.
 */

export interface MailAddress {
  name: string | null;
  address: string;
}

/** One file of a received mail. The bytes come with it (`data`) or are fetched lazily (`fetch`), so a sync never holds every file in memory. */
export interface NormalisedAttachment {
  /** Stable within the message (a MIME part id, a Graph attachment id, an IMAP part path). */
  partId: string;
  name: string;
  mime: string;
  size: number;
  /** `Content-ID` without brackets: how the HTML body points at an inline image (`cid:`). */
  contentId: string | null;
  /** Shown inside the HTML body rather than offered as a file. */
  inline: boolean;
  /** The bytes, when the provider delivered them with the message. */
  data: Buffer | null;
  /** Downloads the bytes when `data` is null. Null when there is nothing to download (then the file is noted as not stored). */
  fetch: (() => Promise<Buffer>) | null;
}

/** Why a message the provider returned is not stored: a draft, spam, trash, or our own sent mail. */
export type MailSkipReason = 'draft' | 'spam' | 'trash' | 'sent';

/** Header names kept in {@link NormalisedMail.rawHeaders} (lower-cased): the ones that classify a mail or thread it. */
export const RAW_HEADER_KEYS = [
  'message-id',
  'in-reply-to',
  'references',
  'auto-submitted',
  'precedence',
  'list-id',
  'list-unsubscribe',
  'return-path',
  'x-auto-response-suppress',
  'x-failed-recipients',
  'content-type',
  'received-spf',
  'authentication-results',
] as const;

export interface NormalisedMail {
  /** The provider's own id: the ledger key, so a redelivery is a no-op (Gmail message id, Graph id, IMAP `<uidvalidity>:<uid>`). */
  providerMessageId: string;
  /**
   * The stable thread key (<= 128 chars): the conversation's `peer_key` is `t:<threadKey>`. Gmail: its threadId verbatim. IMAP / Graph:
   * from `resolveThreadKey`.
   */
  threadKey: string;
  /** RFC 5322 Message-ID without brackets; a stable synthetic one when the sender wrote none. */
  messageId: string;
  inReplyTo: string | null;
  /** Oldest first, without brackets. */
  references: string[];
  from: MailAddress;
  replyTo: MailAddress | null;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  subject: string;
  /** Plain text part (empty when none; the ingest derives it from the HTML). */
  text: string;
  /** Raw, UNSANITISED html part; the ingest sanitises it. */
  html: string | null;
  attachments: NormalisedAttachment[];
  /** When the mail was sent: the provider's date, else the Date header, else now. */
  sentAt: Date;
  /** Provider labels / folders / categories (Gmail labelIds, IMAP folder name, Graph categories). Free-form, for the driver's own use and debugging. */
  labels: string[];
  /** IMAP flags / Graph isRead & friends, lower-case (`seen`, `answered`, ...). */
  flags: string[];
  /** Auto-reply, bounce, list or no-reply mail: stored with `automated: true`. */
  automated: boolean;
  /** The {@link RAW_HEADER_KEYS} subset that was present, lower-cased names. */
  rawHeaders: Record<string, string>;
  /** Set when the message must be counted but not stored. A driver should drop what it can before returning, but may leave this to the ingest. */
  skip: MailSkipReason | null;
}

/** A file that goes out with a reply. The adapter resolves `objectKey` into `bytes` before it calls the driver, so a driver reads `bytes`. */
export interface OutgoingAttachment {
  name: string;
  mime: string;
  bytes: Buffer | null;
  /** The object-store key of a staged composer upload; resolved by the adapter. */
  objectKey: string | null;
}

/** A reply, complete: the signature is already merged into `text` and `html`. */
export interface OutgoingMail {
  /** The new message's RFC 5322 Message-ID without brackets, derived from the send's idempotency key (so a retry finds what an earlier try sent). */
  messageId: string;
  from: MailAddress;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string;
  /** Null = the driver builds the html twin of `text`. */
  html: string | null;
  inReplyTo: string | null;
  references: string[];
  /** The thread the reply belongs to (Gmail threadId); null on a provider that threads by headers alone. */
  threadKey: string | null;
  attachments: OutgoingAttachment[];
  /** Extra headers (marks our own mail so a retry can recognise it). */
  headers: Record<string, string>;
  /** 1 on the first try; above 1 the driver first checks whether an earlier try reached the provider. */
  attempt: number;
}

/** The provider's account behind a connection. */
export interface MailAccountProfile {
  address: string;
  /** The provider's stable account id; a reconnect by another account is refused. */
  sub: string | null;
  name: string | null;
}

/** What a password provider (IMAP/SMTP) is connected with. Stored sealed in `mail_mailboxes.connection_enc`. */
export type MailTlsSecurity = 'ssl' | 'starttls' | 'none';
export interface MailServerLogin {
  host: string;
  port: number;
  security: MailTlsSecurity;
  username: string;
  password: string;
}
export interface PasswordConnection {
  imap: MailServerLogin;
  smtp: MailServerLogin;
}
