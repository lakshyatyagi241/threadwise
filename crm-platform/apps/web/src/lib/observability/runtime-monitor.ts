import {
  instrumentHttpRequests,
  releaseFromEnv,
  startRuntimeMonitorWith,
  type RuntimeMonitorConfig,
} from '@crm/observability';
import { webRouteOf } from './route-of';

/**
 * Event-loop and runtime monitoring for the Next.js server process (EL-B07). The same monitor the API and the worker run
 * (`@crm/observability`), started from `instrumentation.ts` in the Node runtime, with the same `OBS_*` variables and the same
 * defaults and bounds as the API's schema (`apps/api/src/config/domains/platform-infrastructure.env.ts`): off the network unless a
 * port is set, loopback unless a bearer token is set.
 */

type Env = Record<string, string | undefined>;

function int(raw: string | undefined, def: number, min: number, max: number): number {
  const t = raw?.trim();
  if (!t) return def;
  const n = Number(t);
  return Number.isInteger(n) && n >= min && n <= max ? n : def;
}

/** Reads the monitor settings from the environment. A value out of range falls back to its default, never to "off". */
export function readMonitorConfig(env: Env = process.env): RuntimeMonitorConfig {
  const flag = env.OBS_RUNTIME_MONITOR?.trim().toLowerCase();
  const token = env.OBS_METRICS_TOKEN?.trim();
  return {
    enabled: !(flag === 'false' || flag === '0' || flag === 'no' || flag === 'off'),
    intervalSeconds: int(env.OBS_RUNTIME_INTERVAL_SECONDS, 10, 1, 60),
    blockedLogThresholdMs: int(env.OBS_BLOCKED_LOG_THRESHOLD_MS, 250, 10, 60_000),
    metricsPort: int(env.OBS_METRICS_PORT, 0, 0, 65_535),
    metricsHost: env.OBS_METRICS_HOST?.trim() || '127.0.0.1',
    // Shorter than the API accepts is ignored, so a non-loopback listener stays closed instead of opening with a guessable token.
    metricsToken: token && token.length >= 16 ? token : undefined,
    release: releaseFromEnv(env),
  };
}

let stopHttp: (() => void) | undefined;

/** Puts the process's `http.Server.emit` back and forgets the request timer (tests). */
export function stopWebRequestMetrics(): void {
  stopHttp?.();
  stopHttp = undefined;
}

/**
 * Starts the monitor for this process, and times every request the Next.js server answers (`crm_http_request_duration_seconds`, route
 * from `webRouteOf`). Never throws: observability must not stop the server from starting.
 */
export function startWebRuntimeMonitor(env: Env = process.env): void {
  try {
    const monitor = startRuntimeMonitorWith('web', readMonitorConfig(env));
    if (monitor && !stopHttp) stopHttp = instrumentHttpRequests(monitor, webRouteOf);
  } catch (err) {
    process.stdout.write(
      `${JSON.stringify({ level: 40, msg: 'runtime monitor did not start', service: 'web', err: err instanceof Error ? err.message : String(err) })}\n`,
    );
  }
}
