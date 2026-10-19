/**
 * The automatic retry of failed recipients (TW-BCAST-039). Pure.
 *
 * Reference: up to `attempts` extra sends per broadcast, the wait before attempt n being min(3600, base x 2^(n-1)) seconds
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
 * Prefix of the error text of a recipient whose send may have reached the customer although we never got a usable answer (a timeout, a
 * reset, a crash after the provider call). Sending it again could deliver it twice, so the automatic retry leaves it for a person
 * (the manual "retry failed" still resends it).
 */
export const OUTCOME_UNKNOWN_PREFIX = 'Outcome unknown: ';

/**
 * Meta codes the send table (`meta-errors.ts`) marks as not retryable: an expired or under-permissioned token, a restricted or unregistered
 * account, a missing, paused or refused template, a malformed request, a media file Meta cannot use, an undeliverable or refused number.
 * Left out on purpose: 131049 (the wizard retries it itself, a day apart) and the rate limits, which are worth another try.
 * A unit test checks every code here against that table.
 */
export const PERMANENT_META_CODES = [
  190, 102, 10, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 299, 131005, 131047, 131026,
  131021, 131030, 368, 131031, 131045, 133010, 133004, 133005, 133006, 133008, 133009, 133015,
  133016, 33, 100, 132000, 132001, 132005, 132007, 132012, 132015, 132016, 132068, 132069, 131051,
  131052, 131053, 131008, 131009, 135000,
];
// The reason text ends `(code <n>[/<sub>][, trace <id>])` (the port's own errors) or `(#<n>...)` (the Reference's); the code is followed by `)`, `/` or `,`.
const metaCodeSource = `\\((?:#|code )(?:${PERMANENT_META_CODES.join('|')})[,/)]`;

/**
 * Failures a retry cannot fix: a recipient without a number, or one Meta says cannot be reached. Reference retried these like
 * any other, up to three extra sends to a bad number per recipient; the port leaves them for manual review. A send whose outcome
 * is unknown is held back the same way, and so is the recipient of a send a dead worker left half done (legacy wording kept).
 */
const PERMANENT = [
  /^No usable phone number$/i,
  new RegExp(metaCodeSource),
  /^Outcome unknown: /,
  /^Send was interrupted before it finished$/,
];
export const isPermanentFailure = (error: string | null | undefined) =>
  PERMANENT.some((r) => r.test((error ?? '').trim()));

/** The same list as a Postgres regular expression, for the statements that skip permanent failures. */
export const PERMANENT_FAILURE_SQL_REGEX = `^No usable phone number$|${metaCodeSource}|^Outcome unknown: |^Send was interrupted before it finished$`;

/** True when the error says the call may have been accepted: a send that failed this way is never repeated by itself. */
export function isOutcomeUnknown(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { outcomeMayHaveCommitted?: unknown }).outcomeMayHaveCommitted === true
  );
}
