import type { Server } from 'node:http';
import { readInfraEnv } from '../../../../config/domains/platform-infrastructure.env';
import { startMetricsServer } from './metrics-server';
import { RuntimeMonitor, type RuntimeService } from './runtime-monitor';

let current: { monitor: RuntimeMonitor; server?: Server } | undefined;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

export type ListenerDecision = { listen: true } | { listen: false; reason: string; warn: boolean };

/**
 * Whether the `/metrics` listener may open. Off when no port is set. A host other than loopback means other machines can connect, so
 * it also needs a bearer token: without one the listener stays CLOSED and a warning says why, instead of serving runtime data to
 * anything on the network because a variable was forgotten. (The compose files default the port to 0 and the host to 0.0.0.0, so
 * setting only the port must not open an unauthenticated listener.)
 */
export function metricsListenerDecision(cfg: {
  port: number;
  host: string;
  token?: string | undefined;
}): ListenerDecision {
  if (cfg.port <= 0) return { listen: false, reason: 'OBS_METRICS_PORT is not set', warn: false };
  if (!LOOPBACK_HOSTS.has(cfg.host.toLowerCase()) && !cfg.token) {
    return {
      listen: false,
      reason: `OBS_METRICS_HOST is ${cfg.host}, not loopback, and OBS_METRICS_TOKEN is not set: the metrics listener stays closed rather than serve unauthenticated`,
      warn: true,
    };
  }
  return { listen: true };
}

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
  const log = (line: Record<string, unknown>) =>
    process.stdout.write(`${JSON.stringify({ ...line, service })}\n`);
  const decision = metricsListenerDecision({
    port: cfg.OBS_METRICS_PORT,
    host: cfg.OBS_METRICS_HOST,
    token: cfg.OBS_METRICS_TOKEN,
  });
  if (!decision.listen && decision.warn) log({ level: 40, msg: decision.reason });
  const server = decision.listen
    ? startMetricsServer({
        port: cfg.OBS_METRICS_PORT,
        host: cfg.OBS_METRICS_HOST,
        token: cfg.OBS_METRICS_TOKEN,
        render: () => monitor.render(),
        log,
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
