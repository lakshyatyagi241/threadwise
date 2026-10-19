/**
 * Caller-side latency prober, a separate process (docs/performance/event-loop/event-loop-observability-runbook.md).
 *
 *   node dist/src/tools/event-loop-probe.js
 *
 * Environment (all optional):
 *   PROBE_TARGETS           name=url pairs, default `health=http://api:3000/health,ready=http://api:3000/ready`
 *   PROBE_INTERVAL_SECONDS  default 10
 *   PROBE_TIMEOUT_SECONDS   default 10
 *   OBS_METRICS_PORT        default 9464   (the probe's own /metrics, same variables as the API and worker)
 *   OBS_METRICS_HOST        default 127.0.0.1; anything else needs OBS_METRICS_TOKEN or the listener stays closed
 *   OBS_METRICS_TOKEN       bearer token for /metrics
 *
 * It does not import Nest, the database or Redis: it is an HTTP client and a tiny metrics server.
 */
import { startMetricsServer } from '@crm/observability';
import {
  Prober,
  parseProbeTargets,
} from '../modules/platform-infrastructure/observability/event-loop/probe';
import { metricsListenerDecision } from '@crm/observability';

const log = (line: Record<string, unknown>) =>
  process.stdout.write(`${JSON.stringify({ service: 'probe', ...line })}\n`);

/** A malformed number must stop the probe, not become `setInterval(NaN)`, which fires every millisecond at the API. */
function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > 3600)
    throw new Error(`${name} must be a number of seconds from 1 to 3600, got "${raw}"`);
  return n;
}

function main(): void {
  const targets = parseProbeTargets(
    process.env.PROBE_TARGETS ?? 'health=http://api:3000/health,ready=http://api:3000/ready',
  );
  const prober = new Prober(targets, {
    intervalSeconds: seconds('PROBE_INTERVAL_SECONDS', 10),
    timeoutSeconds: seconds('PROBE_TIMEOUT_SECONDS', 10),
  });
  const port = Number(process.env.OBS_METRICS_PORT ?? 9464);
  const host = process.env.OBS_METRICS_HOST ?? '127.0.0.1';
  const token = process.env.OBS_METRICS_TOKEN || undefined;
  const decision = metricsListenerDecision({ port, host, token });
  if (!decision.listen) {
    log({ level: 50, msg: `probe has nothing to serve: ${decision.reason}` });
    process.exit(1);
  }
  const server = startMetricsServer({ port, host, token, render: () => prober.render(), log });
  prober.start();
  log({ level: 30, msg: 'probe started', targets: targets.map((t) => t.name), port });
  const stop = () => {
    prober.stop();
    server.close();
    process.exit(0);
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  // The metrics server is unref'd, so something must keep the process alive; the probe interval does.
}

main();
