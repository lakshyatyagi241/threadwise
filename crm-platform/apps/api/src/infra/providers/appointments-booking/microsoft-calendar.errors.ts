/**
 * What can go wrong talking to Microsoft (the identity platform and Graph) for the calendar, reduced to the few cases the adapter treats
 * differently. The adapter never looks at an HTTP status or an error string: it asks `kind`.
 *
 *  - `invalid_grant`: Microsoft refuses the stored refresh token (revoked, expired after 90 days unused, password changed, consent withdrawn,
 *    conditional access wants a fresh sign-in: the `AADSTS` families 50173, 70008, 700082, 65001, 50076, 53003 ...). Only a new consent
 *    helps: the connection is marked `needs_reconnect`.
 *  - `invalid_client`: the platform's client id, secret or tenant is wrong or expired (AADSTS 7000215, 7000222, 700016, 50194, 90002). Not the
 *    workspace's fault, so its connection stays as it is.
 *  - `auth`: an access token was refused by Graph (401): refresh once and try again.
 *  - `rate_limit`, `server`, `network`, `timeout`: try again later (the outbox drain retries a write with backoff).
 *  - `not_found` / `gone`: the calendar or the event does not exist (any more).
 *  - `conflict`: Graph answered 409 (an update raced another change); the caller reads the event again.
 *  - `forbidden`: the account may not do this (a read-only calendar, a tenant policy, or no Exchange Online mailbox behind the account).
 *  - `bad_request`: Graph rejected what we sent: retrying the same request will not help.
 */
export type MicrosoftFailureKind =
  | 'invalid_grant'
  | 'invalid_client'
  | 'auth'
  | 'rate_limit'
  | 'server'
  | 'network'
  | 'timeout'
  | 'not_found'
  | 'gone'
  | 'conflict'
  | 'forbidden'
  | 'bad_request';

export class MicrosoftCalendarError extends Error {
  /** Seconds Microsoft asked us to wait (`Retry-After`) on a 429 or 503; set by the transport, not by the classifier. */
  retryAfterSeconds: number | null = null;

  constructor(
    readonly kind: MicrosoftFailureKind,
    readonly status: number,
    /** Microsoft's own short reason ("ErrorItemNotFound", "invalid_grant", "AADSTS70008"); safe to log. */
    readonly reason: string,
    message?: string,
  ) {
    super(message ?? `Microsoft Calendar ${kind} (${status}${reason ? `, ${reason}` : ''})`);
    this.name = 'MicrosoftCalendarError';
  }

  /** A later attempt may succeed without anyone changing anything. */
  get retryable(): boolean {
    return (
      this.kind === 'rate_limit' ||
      this.kind === 'server' ||
      this.kind === 'network' ||
      this.kind === 'timeout' ||
      this.kind === 'auth'
    );
  }
}

interface TokenErrorBody {
  error?: string;
  error_description?: string;
  error_codes?: number[];
}

interface GraphErrorBody {
  error?: { code?: string; message?: string };
}

/** The `AADSTS` code of a token error, as `AADSTS70008`, from `error_codes` or the description. */
export function aadstsOf(body: unknown): string {
  if (typeof body !== 'object' || body === null) return '';
  const b = body as TokenErrorBody;
  const code = b.error_codes?.[0];
  if (typeof code === 'number') return `AADSTS${code}`;
  return /AADSTS\d+/.exec(b.error_description ?? '')?.[0] ?? '';
}

/** "This client of ours is misconfigured", whatever the OAuth `error` says. */
const CLIENT_CODES = new Set([
  'AADSTS7000215', // wrong secret
  'AADSTS7000222', // secret expired
  'AADSTS7000218', // client_assertion or client_secret missing
  'AADSTS700016', // application not found in the directory
  'AADSTS700025', // public client sent a secret
  'AADSTS50194', // single-tenant app used on /common
  'AADSTS90002', // tenant not found
  'AADSTS900023', // tenant identifier malformed
]);

/** "The person has to sign in again", even when `error` is something vaguer. */
const REAUTH_CODES = new Set([
  'AADSTS50173', // grant expired: password changed
  'AADSTS70000', // consent / scope problem
  'AADSTS70008', // code or refresh token expired
  'AADSTS70043', // refresh token expired by sign-in frequency policy
  'AADSTS700082', // refresh token expired for inactivity
  'AADSTS65001', // consent missing
  'AADSTS50076', // MFA required
  'AADSTS50079', // MFA enrolment required
  'AADSTS50132', // session revoked
  'AADSTS50133', // session expired
  'AADSTS53003', // blocked by conditional access
  'AADSTS54005', // code already redeemed
  'AADSTS70011', // scope invalid
]);

/** A response from the token endpoint (`/oauth2/v2.0/token`): OAuth error codes plus AADSTS codes. */
export function classifyMicrosoftTokenError(status: number, body: unknown): MicrosoftCalendarError {
  const b = (typeof body === 'object' && body !== null ? body : {}) as TokenErrorBody;
  const aadsts = aadstsOf(body);
  const reason = aadsts || b.error || '';
  if (
    CLIENT_CODES.has(aadsts) ||
    b.error === 'invalid_client' ||
    b.error === 'unauthorized_client'
  ) {
    return new MicrosoftCalendarError('invalid_client', status, reason);
  }
  if (
    b.error === 'invalid_grant' ||
    b.error === 'interaction_required' ||
    b.error === 'consent_required' ||
    b.error === 'login_required' ||
    REAUTH_CODES.has(aadsts)
  ) {
    return new MicrosoftCalendarError('invalid_grant', status, reason);
  }
  if (status === 429) return new MicrosoftCalendarError('rate_limit', status, reason);
  if (status >= 500) return new MicrosoftCalendarError('server', status, reason);
  return new MicrosoftCalendarError('bad_request', status, reason);
}

const THROTTLE_CODES = new Set([
  'ApplicationThrottled',
  'TooManyRequests',
  'ErrorServerBusy',
  'MailboxConcurrency',
  'ErrorExceededMessageLimit',
  'ErrorQuotaExceeded',
  'activityLimitReached',
]);
/** The account has no Exchange Online mailbox behind it (no licence, an on-premises or a guest account): it has no calendar to use. */
const NO_MAILBOX_CODES = new Set([
  'MailboxNotEnabledForRESTAPI',
  'MailboxNotSupportedForRESTAPI',
  'ErrorInvalidUser',
]);

/** Microsoft's short reason of a Graph error body: `error.code`. */
export function graphReason(body: unknown): string {
  if (typeof body !== 'object' || body === null) return '';
  const code = (body as GraphErrorBody).error?.code;
  return typeof code === 'string' ? code.slice(0, 100) : '';
}

/** A response from Graph. */
export function classifyGraphError(status: number, body: unknown): MicrosoftCalendarError {
  const reason = graphReason(body);
  if (status === 401) return new MicrosoftCalendarError('auth', status, reason);
  if (status === 410) return new MicrosoftCalendarError('gone', status, reason);
  if (status === 429 || THROTTLE_CODES.has(reason)) {
    return new MicrosoftCalendarError('rate_limit', status, reason);
  }
  if (NO_MAILBOX_CODES.has(reason)) return new MicrosoftCalendarError('forbidden', status, reason);
  if (status === 403) return new MicrosoftCalendarError('forbidden', status, reason);
  if (status === 404) return new MicrosoftCalendarError('not_found', status, reason);
  if (status === 409 || reason === 'ErrorIrresolvableConflict') {
    return new MicrosoftCalendarError('conflict', status, reason);
  }
  if (status >= 500) return new MicrosoftCalendarError('server', status, reason);
  return new MicrosoftCalendarError('bad_request', status, reason);
}

/** The code an account-level failure is recorded under for the settings card (never Microsoft's own text). */
export type MicrosoftHealthCode =
  'MICROSOFT_RATE_LIMITED' | 'MICROSOFT_ACCESS_DENIED' | 'MICROSOFT_UNAVAILABLE';

/** Account-level failures worth showing; a single event's 404 or 400 says nothing about the account. */
export function microsoftHealthCode(err: MicrosoftCalendarError): MicrosoftHealthCode | undefined {
  switch (err.kind) {
    case 'rate_limit':
      return 'MICROSOFT_RATE_LIMITED';
    case 'forbidden':
      return 'MICROSOFT_ACCESS_DENIED';
    case 'server':
    case 'network':
    case 'timeout':
      return 'MICROSOFT_UNAVAILABLE';
    default:
      return undefined;
  }
}
