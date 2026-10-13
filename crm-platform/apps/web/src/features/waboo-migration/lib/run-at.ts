import { WMIG_MAX_SCHEDULE_DAYS } from '@crm/contracts';

/** The value of an <input type="datetime-local"> is local time without a zone: turn it into an ISO instant, or null if empty/invalid. */
export function localToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export type RunAtProblem = 'invalid' | 'past' | 'tooFar';

/** Same rule as the API: in the future, at most 90 days ahead. Empty means "start now" (no problem). */
export function runAtProblem(value: string, now: Date): RunAtProblem | null {
  if (!value) return null;
  const iso = localToIso(value);
  if (!iso) return 'invalid';
  const t = new Date(iso).getTime();
  if (t <= now.getTime()) return 'past';
  return t - now.getTime() > WMIG_MAX_SCHEDULE_DAYS * 86_400_000 ? 'tooFar' : null;
}

/** The operator's timezone name, for the label next to the picker. */
export const operatorTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';
  } catch {
    return 'local time';
  }
};
