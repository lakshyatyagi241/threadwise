/**
 * The automatic retry of failed recipients (WD-BCAST-039). Pure.
 *
 * WaDesk: up to `attempts` extra sends per broadcast, the wait before attempt n being min(3600, base x 2^(n-1)) seconds
 * (base 0 means at once), defaults 3 attempts and 60 seconds, overridable per organization.
 */
export interface RetryPolicy {
  attempts: number;
  backoffSeconds: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = { attempts: 3, backoffSeconds: 60 };
const BACKOFF_CAP_SECONDS = 3600;

/** A stored or typed policy value to a usable one: attempts is at least 1, the backoff at least 0. */
export function resolvePolicy(
  raw: { attempts?: unknown; backoffSeconds?: unknown } | null | undefined,
): RetryPolicy {
  // A missing value (a null from a JSON lookup, an empty string) means "use the default", not zero.
  const num = (v: unknown) => (v === null || v === undefined || v === '' ? Number.NaN : Number(v));
  const attempts = num(raw?.attempts);
  const backoff = num(raw?.backoffSeconds);
  return {
    attempts: Number.isFinite(attempts)
      ? Math.max(1, Math.trunc(attempts))
      : DEFAULT_RETRY_POLICY.attempts,
    backoffSeconds: Number.isFinite(backoff)
      ? Math.max(0, Math.trunc(backoff))
      : DEFAULT_RETRY_POLICY.backoffSeconds,
  };
}

/** Seconds to wait before attempt number `attempt` (1 is the first retry). */
export function retryDelaySeconds(attempt: number, backoffSeconds: number): number {
  if (backoffSeconds <= 0) return 0;
  return Math.min(BACKOFF_CAP_SECONDS, backoffSeconds * 2 ** Math.max(0, attempt - 1));
}

/**
 * Failures a retry cannot fix: a recipient without a number, or one Meta says cannot be reached. WaDesk retried these like
 * any other, up to three extra sends to a bad number per recipient; the port leaves them for manual review.
 */
const PERMANENT = [/^No usable phone number$/i, /\(#131026\)/, /\(#131021\)/, /\(#131051\)/];
export const isPermanentFailure = (error: string | null | undefined) =>
  PERMANENT.some((r) => r.test((error ?? '').trim()));

/** The same list as a Postgres regular expression, for the statements that skip permanent failures. */
export const PERMANENT_FAILURE_SQL_REGEX =
  '^No usable phone number$|\\(#131026\\)|\\(#131021\\)|\\(#131051\\)';
