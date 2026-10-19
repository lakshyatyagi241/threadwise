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

const FAILURE_MAX = 160;

/** A failed job's reason as one short line for the console: the first line only (a query's parameters follow it and can hold phone numbers or ids). */
export function failureLine(reason: unknown): string | null {
  if (typeof reason !== 'string') return null;
  const line = reason.split('\n')[0]?.trim() ?? '';
  if (!line) return null;
  return line.length > FAILURE_MAX ? `${line.slice(0, FAILURE_MAX)}...` : line;
}
