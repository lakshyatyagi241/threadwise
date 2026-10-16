import type {
  MailConnectionTestResponse,
  MailTestReason,
  MailTestSide,
  MailTestStep,
} from '@crm/contracts';

// Pure rules of "Test credentials" for an IMAP/SMTP mailbox (E-08): how a failure is worded and which step it belongs to. No I/O.

/** The part of a driver failure these rules read (a `MailDriverError` has all of it). */
export interface TestFailure {
  kind: string;
  /** The driver's short reason (`imap`, `smtp`, `blocked_address`, `imap_tls`, `smtp_econnrefused`, ...). */
  providerCode: string;
  /** The driver's sentence: our words, never the server's text, a host or a password. */
  message: string;
}

/** A failure as one of the few reasons the screen words. */
export function reasonOf(f: TestFailure): MailTestReason {
  if (f.kind === 'auth_failed') return 'auth_failed';
  if (f.providerCode === 'blocked_address') return 'blocked_address';
  if (/_tls$/.test(f.providerCode)) return 'tls';
  if (f.kind === 'unreachable') return 'unreachable';
  if (f.kind === 'bad_request' || f.kind === 'forbidden') return 'rejected';
  return 'unknown';
}

export const okSide = (inboxMessages: number | null = null): MailTestSide => ({
  ok: true,
  failedStep: null,
  reason: null,
  message: null,
  inboxMessages,
});

export const failedSide = (step: MailTestStep, f: TestFailure): MailTestSide => ({
  ok: false,
  failedStep: step,
  reason: reasonOf(f),
  message: f.message,
  inboxMessages: null,
});

/** The IMAP step a failure belongs to: a refused password is the login; anything else before the INBOX opened is the connection. */
export const imapStepOf = (f: TestFailure, reachedInbox: boolean): MailTestStep =>
  reachedInbox ? 'inbox' : f.kind === 'auth_failed' ? 'login' : 'connect';

/** The SMTP step: a refused password is the sign-in; anything else (reach, TLS, the greeting) is the connection. */
export const smtpStepOf = (f: TestFailure): MailTestStep =>
  f.kind === 'auth_failed' ? 'auth' : 'connect';

/** Opening the INBOX failed after a good sign-in (no INBOX, no right to it): said in our words, not the server's. */
export const INBOX_FAILED = 'The IMAP server signed you in but would not open the INBOX.';

export const testResult = (imap: MailTestSide, smtp: MailTestSide): MailConnectionTestResponse => ({
  ok: imap.ok && smtp.ok,
  imap,
  smtp,
});

/** Tests one workspace may start per minute: each one opens real connections to a server the caller named. */
export const TEST_LIMIT_PER_MINUTE = 6;
export const TEST_WINDOW_MS = 60_000;
