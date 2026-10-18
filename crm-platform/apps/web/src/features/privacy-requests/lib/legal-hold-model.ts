import { ERROR_CODES, type LegalHold, type LegalHoldStatus } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

export type HoldTone = 'neutral' | 'success' | 'warning' | 'danger';

export function holdStatusTone(h: Pick<LegalHold, 'status' | 'reviewDue'>): HoldTone {
  if (h.status === 'active') return h.reviewDue ? 'danger' : 'warning';
  return 'neutral';
}

export const isActive = (h: { status: LegalHoldStatus }) => h.status === 'active';

/** A date picked in a form (`2026-11-30`) as the instant the hold uses: the end of that day in the person's own time zone. */
export function endOfDayIso(date: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const d = new Date(`${date}T23:59:59`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** An instant as the value of a date input (`YYYY-MM-DD`, local), or an empty string. */
export function dateInputValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Today as a date input value, the earliest a review or end date can be. */
export const todayInputValue = () => dateInputValue(new Date().toISOString());

/**
 * A refused rights erasure that the server recorded as a restricted case (409 LEGAL_HOLD_ACTIVE with `restricted`): that is a result,
 * not a failure: the confirmation is kept and the erasure runs when the hold ends.
 */
export function isRestrictedRecorded(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.code === ERROR_CODES.LEGAL_HOLD_ACTIVE &&
    error.fieldErrors.some((e) => e.path === 'restricted' && e.message === 'true')
  );
}
