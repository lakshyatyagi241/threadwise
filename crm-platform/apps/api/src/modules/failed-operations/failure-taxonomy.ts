/**
 * The failure taxonomy of background work (versioned: bump {@link TAXONOMY_VERSION} when a code's meaning changes).
 *
 * A category answers "what kind of problem is this" and decides the first status of the record; a code is the stable name of the
 * cause that dashboards and runbooks use. Codes never depend on the wording of an exception, so a provider rewording its error does
 * not move a failure from one bucket to another. An error that matches nothing is TRANSIENT/RETRY_EXHAUSTED, and nothing in this
 * module ever retries it by itself: only an operator redrives, through the eligibility check.
 */
export const TAXONOMY_VERSION = 'dlq-taxonomy-1';

export const FAILURE_CATEGORIES = [
  'TRANSIENT',
  'PERMANENT',
  'RATE_LIMITED',
  'AMBIGUOUS',
  'INFRASTRUCTURE',
  'VALIDATION',
  'AUTHORIZATION',
  'POISON_MESSAGE',
] as const;
export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

export const FAILURE_CODES = [
  'PAYLOAD_INVALID',
  'UNRECOVERABLE',
  'JOB_STALLED',
  'DEPENDENCY_UNAVAILABLE',
  'RATE_LIMITED',
  'CREDENTIALS_REJECTED',
  'RETRY_EXHAUSTED',
] as const;
export type FailureCode = (typeof FAILURE_CODES)[number];

export interface FailureFacts {
  errorMessage: string;
  /** BullMQ marked the job to skip its remaining attempts (an `UnrecoverableError`). */
  unrecoverable: boolean;
  attemptsMade: number;
  maxAttempts: number;
}

export interface Classified {
  category: FailureCategory;
  code: FailureCode;
}

const POISON =
  /malformed|could not be opened|unreadable|unknown job|no webhook retry handler|invalid payload/i;
const STALLED = /stalled more than allowable limit/i;
const INFRA =
  /econn|etimedout|timed? ?out|eai_again|enotfound|socket hang up|connection (?:terminated|refused|closed|reset)|redis|deadlock|too many clients|database|unavailable|\b50[234]\b/i;
const RATE = /\b429\b|rate.?limit|too many requests|throttl/i;
const AUTH =
  /\b40[13]\b|unauthori[sz]ed|forbidden|invalid (?:access )?token|token (?:expired|revoked)|credentials?/i;

/** The order matters: the most specific cause wins, and "unrecoverable" is read before the wording of its message. */
export function classifyFailure(f: FailureFacts): Classified {
  if (f.unrecoverable) {
    if (POISON.test(f.errorMessage)) return { category: 'POISON_MESSAGE', code: 'PAYLOAD_INVALID' };
    return { category: 'PERMANENT', code: 'UNRECOVERABLE' };
  }
  // A stalled job lost its lock mid-run: how far it got is not known, so it is AMBIGUOUS, not "infrastructure".
  if (STALLED.test(f.errorMessage)) return { category: 'AMBIGUOUS', code: 'JOB_STALLED' };
  if (RATE.test(f.errorMessage)) return { category: 'RATE_LIMITED', code: 'RATE_LIMITED' };
  if (AUTH.test(f.errorMessage)) return { category: 'AUTHORIZATION', code: 'CREDENTIALS_REJECTED' };
  if (INFRA.test(f.errorMessage))
    return { category: 'INFRASTRUCTURE', code: 'DEPENDENCY_UNAVAILABLE' };
  return { category: 'TRANSIENT', code: 'RETRY_EXHAUSTED' };
}

export type FailedOperationStatus =
  | 'OPEN'
  | 'BLOCKED'
  | 'RECONCILIATION_REQUIRED'
  | 'READY_FOR_REDRIVE'
  | 'REDRIVING'
  | 'RESOLVED'
  | 'TERMINAL'
  | 'ESCALATED';

/**
 * The status a record starts in. What a retry cannot fix starts BLOCKED (the operator must say the cause is repaired); an outcome
 * that may have half happened starts RECONCILIATION_REQUIRED unless the queue's consumers are idempotent (the policy says so).
 */
export function initialStatus(
  category: FailureCategory,
  ambiguousReplaySafe: boolean,
): FailedOperationStatus {
  switch (category) {
    case 'PERMANENT':
    case 'VALIDATION':
    case 'AUTHORIZATION':
    case 'POISON_MESSAGE':
      return 'BLOCKED';
    case 'AMBIGUOUS':
      return ambiguousReplaySafe ? 'OPEN' : 'RECONCILIATION_REQUIRED';
    default:
      return 'OPEN';
  }
}
