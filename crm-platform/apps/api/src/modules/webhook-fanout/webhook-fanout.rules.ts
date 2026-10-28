import { createHash } from 'node:crypto';

/** Hard cap on a forwarded body held in Redis. Meta's own limit is far smaller; this only stops a bad sender. */
export const MAX_FORWARD_BYTES = 1024 * 1024;

export interface ForwardJob {
  targetId: number;
  /** The raw body, base64: bytes are never re-serialised, so the signature stays valid for the target. */
  body: string;
  signatureHeader: string | null;
  contentType: string | null;
}

/** A target with an empty filter takes everything; otherwise at least one change field must match. */
export function matchesFilter(filter: string[] | null | undefined, fields: string[]): boolean {
  if (!filter || filter.length === 0) return true;
  return fields.some((f) => filter.includes(f));
}

/**
 * A target with an empty phone number filter takes every number; otherwise at least one phone number id the body names must be
 * listed. The body is forwarded whole (the signature covers all of it), so one listed number is enough. A body that names no number
 * (an account-level event) is not for any one number and is not forwarded to a target that asked for specific numbers.
 */
export function matchesPhoneNumberFilter(
  filter: string[] | null | undefined,
  phoneNumberIds: string[],
): boolean {
  if (!filter || filter.length === 0) return true;
  return phoneNumberIds.some((p) => filter.includes(p));
}

/** Same body to the same target is the same job, so a Meta retry of a payload we already queued is absorbed. */
export function forwardJobId(targetId: number, body: Buffer): string {
  return `${targetId}-${createHash('sha256').update(body).digest('hex')}`;
}

/** Backoff: 2s, 4s, 8s... capped by the queue default's exponential type. */
export const FORWARD_BACKOFF = { type: 'exponential' as const, delay: 2_000, jitter: 0.5 };
