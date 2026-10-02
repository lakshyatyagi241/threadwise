import type { HealthState } from '@crm/contracts';

/** Pending jobs above this make the queue Degraded (TW-DASH-048). */
export const QUEUE_PENDING_WARN = 500;

/** The banner: down if any core probe is down, else degraded if any is, else operational. Idle probes do not count (rule 1). */
export function overallState(states: readonly HealthState[]): 'up' | 'warn' | 'down' {
  if (states.includes('down')) return 'down';
  if (states.includes('warn')) return 'warn';
  return 'up';
}

export function queueState(pending: number, failed: number): HealthState {
  return failed > 0 || pending > QUEUE_PENDING_WARN ? 'warn' : 'up';
}

/** Failure messages are shown on a card, so they are cut at 90 characters. */
export function shortError(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  return m.length > 90 ? `${m.slice(0, 90)}...` : m;
}

/** Host disk bar colour: red above 90%, amber above 75%, else green. */
export function diskTone(usedPct: number): 'danger' | 'warning' | 'success' {
  return usedPct > 90 ? 'danger' : usedPct > 75 ? 'warning' : 'success';
}
