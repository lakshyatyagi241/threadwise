import type { Server } from 'node:http';
import { readInfraEnv } from '../../../../config/domains/platform-infrastructure.env';
import { startMetricsServer } from './metrics-server';
import { RuntimeMonitor, type RuntimeService } from './runtime-monitor';

let current: { monitor: RuntimeMonitor; server?: Server } | undefined;

/** The process's monitor, or undefined when none was started (tests, CLIs). */
export function getRuntimeMonitor(): RuntimeMonitor | undefined {
  return current?.monitor;
}

/**
 * Starts event-loop and runtime monitoring for this process. Call first in `main.ts` and `worker.ts`, next to the process
 * handlers. `OBS_RUNTIME_MONITOR=false` turns the whole thing off; without `OBS_METRICS_PORT` the metrics are collected (and
 * the blocked-loop log still works) but nothing listens. A second call returns the first monitor.
 */
export function startRuntimeMonitor(
  service: RuntimeService,
  env: NodeJS.ProcessEnv = process.env,
): RuntimeMonitor | undefined {
  if (current) return current.monitor;
  const cfg = readInfraEnv(env);
  if (!cfg.OBS_RUNTIME_MONITOR) return undefined;
  const monitor = new RuntimeMonitor({
    service,
    intervalMs: cfg.OBS_RUNTIME_INTERVAL_SECONDS * 1000,
    blockedLogThresholdMs: cfg.OBS_BLOCKED_LOG_THRESHOLD_MS,
  });
  monitor.start();
  const server =
    cfg.OBS_METRICS_PORT > 0
      ? startMetricsServer({
          port: cfg.OBS_METRICS_PORT,
          host: cfg.OBS_METRICS_HOST,
          token: cfg.OBS_METRICS_TOKEN,
          render: () => monitor.render(),
          log: (line) => process.stdout.write(`${JSON.stringify({ ...line, service })}\n`),
        })
      : undefined;
  current = { monitor, server };
  return monitor;
}

/** Test and shutdown helper. */
export function stopRuntimeMonitor(): void {
  current?.monitor.stop();
  current?.server?.close();
  current = undefined;
}
