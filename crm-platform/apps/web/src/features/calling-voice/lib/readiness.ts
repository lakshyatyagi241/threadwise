import {
  CALL_ERROR_CODES,
  CALLING_META_REASONS,
  type CallingCheck,
  type CallingMetaReason,
  type CallingReadiness,
  type CallingReadinessStatus,
} from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/** Pure helpers of the readiness card: which reason Meta gave, how old a check is, which tone a status has. */

/**
 * The stable reason of a refusal by Meta (`CALL_META_REFUSED` carries it as the problem's `reason` detail): never read from the
 * message. `null` when there is none or Meta's own words are the best there is (`unknown`).
 */
export function metaReasonOf(error: unknown): CallingMetaReason | null {
  if (!(error instanceof ApiError) || error.code !== CALL_ERROR_CODES.CALL_META_REFUSED)
    return null;
  const found = error.fieldErrors.find((e) => e.path === 'reason')?.message;
  const known = (CALLING_META_REASONS as readonly string[]).includes(found ?? '');
  return known && found !== 'unknown' ? (found as CallingMetaReason) : null;
}

/** A check older than this is run again when someone who may change calling opens the card. */
export const STALE_CHECK_MS = 15 * 60_000;

export function isStale(checkedAt: string | null, now: number = Date.now()): boolean {
  if (!checkedAt) return true;
  const at = Date.parse(checkedAt);
  return !Number.isFinite(at) || now - at > STALE_CHECK_MS;
}

export type StatusTone = 'success' | 'warning' | 'danger' | 'neutral';

export const STATUS_TONE: Record<CallingReadinessStatus, StatusTone> = {
  ready: 'success',
  ready_to_enable: 'neutral',
  attention: 'warning',
  blocked: 'danger',
  never_checked: 'neutral',
};

/** The rows that need a person's attention, worst first (fails, then warnings). */
export function needsAction(checks: readonly CallingCheck[]): CallingCheck[] {
  return [...checks.filter((c) => c.state === 'fail'), ...checks.filter((c) => c.state === 'warn')];
}

/** Digits of a phone as typed (no plus, spaces or dashes); Meta wants the international number without them. */
export const digitsOnly = (v: string): string => v.replace(/\D+/g, '');

/** A test call needs a plausible international number (the same bounds the dial endpoint applies to the digits). */
export const isDialable = (v: string): boolean => {
  const d = digitsOnly(v);
  return d.length >= 6 && d.length <= 15;
};

/** The card can offer a test call when calling is on and nothing blocks the number. */
export const canTestCall = (r: Pick<CallingReadiness, 'status' | 'callingEnabled'>): boolean =>
  r.callingEnabled && (r.status === 'ready' || r.status === 'attention');
