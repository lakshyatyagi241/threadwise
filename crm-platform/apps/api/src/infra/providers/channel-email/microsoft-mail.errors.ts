/**
 * What can go wrong talking to Microsoft (the identity platform and Graph) for the Email channel, reduced to the few cases the callers treat
 * differently. Callers never look at an HTTP status or an error string: they ask `kind`.
 *
 *  - `invalid_grant`: Microsoft refuses the stored refresh token (revoked, expired after 90 days unused, password changed, consent withdrawn,
 *    conditional access needs a fresh sign-in: the `AADSTS` families 50173, 70008, 700082, 65001, 50076, 53003, ...). Only a new consent
 *    helps: the mailbox is marked `needs_reauth`.
 *  - `invalid_client`: the platform's client id, secret or tenant is wrong or expired (AADSTS 7000215, 7000222, 700016, 50194, 90002).
 *    Not the workspace's fault: its mailbox stays as it is.
 *  - `auth`: an access token was refused by Graph (401): refresh once and try again.
 *  - `rate_limit`, `server`, `network`, `timeout`: try again later (`retryAfterSeconds` when Microsoft said how long).
 *  - `gone`: a delta token Graph no longer keeps (410): the sync starts over.
 *  - `not_found`: the message or attachment does not exist (any more).
 *  - `forbidden`: the account may not do this (a permission was not granted, the mailbox has no Exchange Online licence, a tenant policy).
 *  - `too_large`: Graph refused the message size.
 *  - `bad_request`: Graph rejected what we sent: retrying the same request will not help.
 */
export type MicrosoftMailFailureKind =
  | 'invalid_grant'
  | 'invalid_client'
  | 'auth'
  | 'rate_limit'
  | 'server'
  | 'network'
  | 'timeout'
  | 'gone'
  | 'not_found'
  | 'forbidden'
  | 'too_large'
  | 'bad_request';

export class MicrosoftMailError extends Error {
  constructor(
    readonly kind: MicrosoftMailFailureKind,
    readonly status: number,
    /** Microsoft's own short reason (`ErrorItemNotFound`, `invalid_grant`, `AADSTS70008`); safe to log. */
    readonly reason: string,
    /** From the `Retry-After` header, in seconds. */
    readonly retryAfterSeconds: number | null = null,
    message?: string,
  ) {
    super(message ?? `Microsoft mail ${kind} (${status}${reason ? `, ${reason}` : ''})`);
    this.name = 'MicrosoftMailError';
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

/** `Retry-After`: delta seconds or an HTTP date; clamped to something a queue can wait for. */
export function parseRetryAfter(
  value: string | null | undefined,
  nowMs = Date.now(),
): number | null {
  if (!value) return null;
  const v = value.trim();
  let seconds: number;
  if (/^\d+$/.test(v)) seconds = Number(v);
  else {
    const at = Date.parse(v);
    if (Number.isNaN(at)) return null;
    seconds = Math.ceil((at - nowMs) / 1000);
  }
  return Math.min(Math.max(seconds, 0), 3600);
}

interface TokenErrorBody {
  error?: string;
  error_description?: string;
  error_codes?: number[];
}

interface GraphErrorBody {
  error?: { code?: string; message?: string; innerError?: { code?: string } };
}

/** The `AADSTS` code of a token error, as `AADSTS70008`, from `error_codes` or the description. */
export function microsoftAadsts(body: unknown): string {
  if (typeof body !== 'object' || body === null) return '';
  const b = body as TokenErrorBody;
  const code = b.error_codes?.[0];
  if (typeof code === 'number') return `AADSTS${code}`;
  return /AADSTS\d+/.exec(b.error_description ?? '')?.[0] ?? '';
}

/** Codes that mean "this client of ours is misconfigured" whatever the OAuth `error` says. */
const CLIENT_CODES = new Set([
  'AADSTS7000215', // wrong secret
  'AADSTS7000222', // secret expired
  'AADSTS7000218', // client_assertion or client_secret missing
  'AADSTS700016', // application not found in the directory
  'AADSTS700025', // public client sent a secret
  'AADSTS50194', // single-tenant app used on /common
  'AADSTS90002', // tenant not found
  'AADSTS900023', // tenant identifier malformed
  'AADSTS700054', // response_type id_token not enabled
]);

/** Codes that mean "the person has to sign in again" even when `error` is something vaguer. */
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
  'AADSTS500011', // resource principal not found
  'AADSTS54005', // code already redeemed
  'AADSTS70011', // scope invalid
]);

/** A response from the token endpoint (`/oauth2/v2.0/token`): OAuth error codes plus AADSTS codes. */
export function classifyMicrosoftTokenError(
  status: number,
  body: unknown,
  retryAfter: number | null = null,
): MicrosoftMailError {
  const b = (typeof body === 'object' && body !== null ? body : {}) as TokenErrorBody;
  const aadsts = microsoftAadsts(body);
  const reason = aadsts || b.error || '';
  if (
    CLIENT_CODES.has(aadsts) ||
    b.error === 'invalid_client' ||
    b.error === 'unauthorized_client'
  ) {
    return new MicrosoftMailError('invalid_client', status, reason);
  }
  if (
    b.error === 'invalid_grant' ||
    b.error === 'interaction_required' ||
    b.error === 'consent_required' ||
    b.error === 'login_required' ||
    REAUTH_CODES.has(aadsts)
  ) {
    return new MicrosoftMailError('invalid_grant', status, reason);
  }
  if (status === 429) return new MicrosoftMailError('rate_limit', status, reason, retryAfter);
  if (status >= 500) return new MicrosoftMailError('server', status, reason, retryAfter);
  return new MicrosoftMailError('bad_request', status, reason);
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
/** The mailbox has no Exchange Online mailbox behind it (no licence, an on-premises or a guest account). */
const NO_MAILBOX_CODES = new Set([
  'MailboxNotEnabledForRESTAPI',
  'MailboxNotSupportedForRESTAPI',
  'ErrorInvalidUser',
]);

/** Microsoft's short reason of a Graph error body: `error.code`. */
export function graphErrorReason(body: unknown): string {
  if (typeof body !== 'object' || body === null) return '';
  return (body as GraphErrorBody).error?.code ?? '';
}

/** A response from Graph. */
export function classifyGraphError(
  status: number,
  body: unknown,
  retryAfter: number | null = null,
): MicrosoftMailError {
  const reason = graphErrorReason(body);
  if (status === 401) return new MicrosoftMailError('auth', status, reason);
  if (status === 410 || reason === 'syncStateNotFound' || reason === 'resyncRequired') {
    return new MicrosoftMailError('gone', status, reason);
  }
  if (status === 429 || THROTTLE_CODES.has(reason)) {
    return new MicrosoftMailError('rate_limit', status, reason, retryAfter);
  }
  if (NO_MAILBOX_CODES.has(reason)) {
    return new MicrosoftMailError('forbidden', status, reason);
  }
  if (status === 403) return new MicrosoftMailError('forbidden', status, reason);
  if (status === 404) return new MicrosoftMailError('not_found', status, reason);
  if (status === 413 || reason === 'ErrorMessageSizeExceeded' || reason === 'ErrorMessageTooBig') {
    return new MicrosoftMailError('too_large', status, reason);
  }
  if (status >= 500) return new MicrosoftMailError('server', status, reason, retryAfter);
  return new MicrosoftMailError('bad_request', status, reason);
}
