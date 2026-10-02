import { problemSchema } from '@crm/contracts';

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

  /**
   * The API ended the session for inactivity (WD-AUTH-033): a 401 whose details carry `reason: idle`, and the
   * configured limit as `idleMinutes`. Not the same as a session that simply lapsed.
   */
  get isIdleTimeout(): boolean {
    return (
      this.status === 401 &&
      this.fieldErrors.some((e) => e.path === 'reason' && e.message === 'idle')
    );
  }

  /** The inactivity limit in minutes that came with an idle timeout, when it was sent. */
  get idleMinutes(): number | undefined {
    if (!this.isIdleTimeout) return undefined;
    const n = Number(this.fieldErrors.find((e) => e.path === 'idleMinutes')?.message);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
  }
}

/**
 * Whole seconds from a `Retry-After` header: a number of seconds, or an HTTP date. Null when absent, zero or unreadable.
 */
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
 * A 429 that carries `Retry-After` but no `retryAfterSeconds` detail in its body still tells the screen how long to
 * wait (the header is the standard place for it, and a proxy may keep one and drop the other).
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
