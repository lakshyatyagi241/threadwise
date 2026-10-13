import type { LscRun, LscRunStatus } from '@crm/contracts';

/** The reasons the API writes in a run's `error`; any other text is shown as "Other". */
export const RUN_REASONS = [
  'no_key',
  'token_allowance',
  'hourly_limit',
  'manual_score',
  'platform_off',
  'not_enabled',
  'auth',
  'rate_limited',
  'provider',
  'timeout',
  'bad_response',
] as const;
export type RunReason = (typeof RUN_REASONS)[number] | 'other';

export function reasonOf(error: string | null): RunReason | null {
  if (!error) return null;
  return (RUN_REASONS as readonly string[]).includes(error) ? (error as RunReason) : 'other';
}

/** A status of a run that the person may want to look into. */
export const isProblem = (s: LscRunStatus): boolean => s === 'failed' || s === 'skipped';

/** Whether the run spent tokens or money (a failed answer was still paid for). */
export const hasSpend = (r: Pick<LscRun, 'costSource'>): boolean => r.costSource !== 'none';

/** How the score moved: "40 → 72", "72" for a first score, null when the run wrote nothing. */
export function scoreChange(r: Pick<LscRun, 'score' | 'previousScore' | 'status'>): string | null {
  if (r.status !== 'ok' || r.score === null) return null;
  return r.previousScore === null || r.previousScore === r.score
    ? String(r.score)
    : `${r.previousScore} → ${r.score}`;
}
