import {
  startRuntimeMonitorWith,
  type RuntimeMonitor,
  type RuntimeService,
} from '@crm/observability';
import { readInfraEnv } from '../../../../config/domains/platform-infrastructure.env';

/**
 * Starts event-loop and runtime monitoring for this process. Call first in `main.ts` and `worker.ts`, next to the process
 * handlers. `OBS_RUNTIME_MONITOR=false` turns the whole thing off; without `OBS_METRICS_PORT` the metrics are collected (and
 * the blocked-loop log still works) but nothing listens. A second call returns the first monitor. The monitor itself is in
 * packages/observability (the web server starts it the same way, from its own environment).
 */
export function startRuntimeMonitor(
  service: RuntimeService,
  env: NodeJS.ProcessEnv = process.env,
): RuntimeMonitor | undefined {
  const cfg = readInfraEnv(env);
  return startRuntimeMonitorWith(service, {
    enabled: cfg.OBS_RUNTIME_MONITOR,
    intervalSeconds: cfg.OBS_RUNTIME_INTERVAL_SECONDS,
    blockedLogThresholdMs: cfg.OBS_BLOCKED_LOG_THRESHOLD_MS,
    metricsPort: cfg.OBS_METRICS_PORT,
    metricsHost: cfg.OBS_METRICS_HOST,
    metricsToken: cfg.OBS_METRICS_TOKEN,
  });
}
