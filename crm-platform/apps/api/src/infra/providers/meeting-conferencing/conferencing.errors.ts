import {
  aadstsOf,
  classifyMicrosoftTokenError,
} from '../appointments-booking/microsoft-calendar.errors';

/**
 * What can go wrong talking to a video provider (Zoom, Microsoft Graph), reduced to the few cases the caller treats differently. The
 * service never looks at an HTTP status or an error string: it asks `kind`.
 *
 *  - `invalid_grant`: the provider refuses the stored refresh token (revoked, expired, password changed, consent withdrawn). Only a new
 *    consent helps: the connection is marked `needs_reconnect`.
 *  - `invalid_client`: the platform's own client id or secret is wrong or expired. Not the person's fault; their connection stays as it is.
 *  - `auth`: an access token was refused (401): refresh once and try again.
 *  - `rate_limit`, `server`, `network`, `timeout`: try again later.
 *  - `not_found`: the meeting does not exist (any more). On a delete that is success.
 *  - `forbidden`: the account may not do this (a plan without the feature, a tenant policy, a missing scope).
 *  - `bad_request`: the provider rejected what was sent; retrying the same request will not help.
 */
export type ConferencingFailureKind =
  | 'invalid_grant'
  | 'invalid_client'
  | 'auth'
  | 'rate_limit'
  | 'server'
  | 'network'
  | 'timeout'
  | 'not_found'
  | 'forbidden'
  | 'bad_request';

export class ConferencingError extends Error {
  /** Seconds the provider asked us to wait (`Retry-After`) on a 429 or 503; set by the transport, not by the classifier. */
  retryAfterSeconds: number | null = null;

  constructor(
    readonly kind: ConferencingFailureKind,
    readonly status: number,
    /** The provider's own short reason ("invalid_grant", "3001", "AADSTS70008"); safe to log. */
    readonly reason: string,
    message?: string,
  ) {
    super(message ?? `Video provider ${kind} (${status}${reason ? `, ${reason}` : ''})`);
    this.name = 'ConferencingError';
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

interface ZoomErrorBody {
  /** The token endpoint's OAuth error. */
  error?: string;
  reason?: string;
  /** The REST API's numeric code (`124` invalid access token, `3001` meeting does not exist, `1001` user does not exist). */
  code?: number;
  message?: string;
}

const bodyOf = (body: unknown): ZoomErrorBody =>
  (typeof body === 'object' && body !== null ? body : {}) as ZoomErrorBody;

const byStatus = (status: number, reason: string): ConferencingError => {
  if (status === 429) return new ConferencingError('rate_limit', status, reason);
  if (status >= 500) return new ConferencingError('server', status, reason);
  if (status === 404 || status === 410) return new ConferencingError('not_found', status, reason);
  if (status === 401) return new ConferencingError('auth', status, reason);
  if (status === 403) return new ConferencingError('forbidden', status, reason);
  return new ConferencingError('bad_request', status, reason);
};

/** A failed answer from Zoom's token endpoint (`/oauth/token`). */
export function classifyZoomTokenError(status: number, body: unknown): ConferencingError {
  const b = bodyOf(body);
  const reason = b.error ?? b.reason ?? '';
  if (b.error === 'invalid_client' || b.error === 'unauthorized_client') {
    return new ConferencingError('invalid_client', status, reason);
  }
  if (b.error === 'invalid_grant' || b.error === 'invalid_request') {
    return new ConferencingError('invalid_grant', status, reason);
  }
  if (status === 429) return new ConferencingError('rate_limit', status, reason);
  if (status >= 500) return new ConferencingError('server', status, reason);
  return new ConferencingError('bad_request', status, reason);
}

/** A failed answer from Zoom's REST API. */
export function classifyZoomApiError(status: number, body: unknown): ConferencingError {
  const b = bodyOf(body);
  // 124 is Zoom's "invalid access token" (also sent with a 401): refresh and repeat.
  if (b.code === 124) return new ConferencingError('auth', status, '124');
  // 3001: the meeting does not exist or has expired. 1001: the user does not exist.
  if (b.code === 3001 || b.code === 1001) {
    return new ConferencingError('not_found', status, String(b.code));
  }
  return byStatus(status, b.code !== undefined ? String(b.code) : '');
}

/** A failed answer from the Microsoft identity platform's token endpoint, in this module's error type. */
export function classifyTeamsTokenError(status: number, body: unknown): ConferencingError {
  const ms = classifyMicrosoftTokenError(status, body);
  const reason = ms.reason || aadstsOf(body);
  switch (ms.kind) {
    case 'invalid_grant':
      return new ConferencingError('invalid_grant', status, reason);
    case 'invalid_client':
      return new ConferencingError('invalid_client', status, reason);
    case 'rate_limit':
      return new ConferencingError('rate_limit', status, reason);
    case 'server':
      return new ConferencingError('server', status, reason);
    default:
      return new ConferencingError('bad_request', status, reason);
  }
}

interface GraphErrorBody {
  error?: { code?: string; message?: string };
}

/** A failed answer from Microsoft Graph (online meetings, the profile). */
export function classifyGraphError(status: number, body: unknown): ConferencingError {
  const b = (typeof body === 'object' && body !== null ? body : {}) as GraphErrorBody;
  const code = b.error?.code ?? '';
  if (code === 'InvalidAuthenticationToken' || status === 401) {
    return new ConferencingError('auth', status, code);
  }
  if (
    code === 'ApplicationThrottled' ||
    code === 'TooManyRequests' ||
    code === 'activityLimitReached'
  ) {
    return new ConferencingError('rate_limit', status, code);
  }
  // A 405 or 404 on the delete of an online meeting means the tenant or API version does not offer it: handled by the caller as "left".
  return byStatus(status, code);
}
