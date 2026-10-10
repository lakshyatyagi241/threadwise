import { problemSchema } from '@crm/contracts';

/** Codes that never come from the server: they describe what happened on the phone. */
export const CLIENT_ERROR_CODES = {
  /** No answer at all: offline, DNS, TLS, connection reset. */
  NETWORK: 'CLIENT_NETWORK',
  /** The request outlived its time limit. */
  TIMEOUT: 'CLIENT_TIMEOUT',
  /** The answer was 2xx but not the shape this build of the app expects (the API is a different version). */
  CONTRACT_MISMATCH: 'CLIENT_CONTRACT_MISMATCH',
  /** The caller cancelled it. */
  ABORTED: 'CLIENT_ABORTED',
} as const;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly fieldErrors: Array<{ path: string; message: string }> = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isRowVersionConflict(): boolean {
    return this.status === 409 && this.code === 'ROW_VERSION_CONFLICT';
  }

  /** The server never answered (offline, timeout, reset): worth retrying, and never a reason to sign out. */
  get isConnectivity(): boolean {
    return this.code === CLIENT_ERROR_CODES.NETWORK || this.code === CLIENT_ERROR_CODES.TIMEOUT;
  }

  /** The API ended the session for inactivity: a 401 whose details carry `reason: idle`. */
  get isIdleTimeout(): boolean {
    return (
      this.status === 401 &&
      this.fieldErrors.some((e) => e.path === 'reason' && e.message === 'idle')
    );
  }

  /** Seconds to wait before trying again, from a 429's `Retry-After`, when it was sent. */
  get retryAfterSeconds(): number | undefined {
    const n = Number(this.fieldErrors.find((e) => e.path === 'retryAfterSeconds')?.message);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

/** Whole seconds from a `Retry-After` header: a number of seconds, or an HTTP date. Null when absent, zero or unreadable. */
export function retryAfterFromHeader(
  value: string | null | undefined,
  now = Date.now(),
): number | null {
  const v = value?.trim();
  if (!v) return null;
  const seconds = /^\d+$/.test(v) ? Number(v) : (Date.parse(v) - now) / 1000;
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null;
}

/**
 * Branch on `code`, never on the title/detail text. Falls back to a generic error for non-problem bodies.
 * A 429 with `Retry-After` but no `retryAfterSeconds` detail still tells the screen how long to wait.
 */
export function toApiError(
  status: number,
  body: unknown,
  headerRequestId?: string | null,
  retryAfterHeader?: string | null,
): ApiError {
  const parsed = problemSchema.safeParse(body);
  const wait = status === 429 ? retryAfterFromHeader(retryAfterHeader) : null;
  const withWait = (errors: Array<{ path: string; message: string }>) =>
    wait !== null && !errors.some((e) => e.path === 'retryAfterSeconds')
      ? [...errors, { path: 'retryAfterSeconds', message: String(wait) }]
      : errors;
  if (parsed.success) {
    const p = parsed.data;
    return new ApiError(
      status,
      p.code,
      p.detail ?? p.title,
      p.requestId ?? headerRequestId ?? undefined,
      withWait(p.errors ?? []),
    );
  }
  return new ApiError(
    status,
    status >= 500 ? 'INTERNAL' : 'UNKNOWN',
    `Request failed with status ${status}`,
    headerRequestId ?? undefined,
    withWait([]),
  );
}
