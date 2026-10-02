import type { HealthCheck, HealthState } from '@crm/contracts';

/** Badge tone of a probe state: Operational green, Degraded amber, Down red, Idle grey. */
export function toneOf(state: HealthState): 'success' | 'warning' | 'danger' | 'neutral' {
  return state === 'up'
    ? 'success'
    : state === 'warn'
      ? 'warning'
      : state === 'down'
        ? 'danger'
        : 'neutral';
}

/** Host disk bar colour: red above 90%, amber above 75%, else green (TW-DASH-050). */
export function diskToneOf(usedPct: number): 'danger' | 'warning' | 'success' {
  return usedPct > 90 ? 'danger' : usedPct > 75 ? 'warning' : 'success';
}

/** Response-time bars (TW-DASH-049): width = max(3, ms / max * 100) percent, only for probes that measured a time. */
export function latencyBars(
  checks: readonly HealthCheck[],
): Array<{ key: HealthCheck['key']; ms: number; state: HealthState; width: number }> {
  const timed = checks.filter(
    (c): c is HealthCheck & { ping: number } =>
      c.ping !== null && (c.key === 'database' || c.key === 'bridge' || c.key === 'storage'),
  );
  const max = Math.max(1, ...timed.map((c) => c.ping));
  return timed.map((c) => ({
    key: c.key,
    ms: c.ping,
    state: c.state,
    width: Math.max(3, Math.min(100, (c.ping / max) * 100)),
  }));
}
