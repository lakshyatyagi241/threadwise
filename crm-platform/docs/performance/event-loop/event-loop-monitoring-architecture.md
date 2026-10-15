# Event-loop monitoring: architecture

Status: first slice implemented (API + worker instrumentation, alert rules, static scan gate, monitor benchmark). Load/soak
certification, dashboards and queue-job wiring are **not done**; see `event-loop-release-certification.json` for what is verified.

## What it is

A shared module in every Node.js process that handles consequential work. Not a service.

```
apps/api/src/modules/platform-infrastructure/observability/event-loop/
  event-loop-sampler.ts      perf_hooks histogram + interval ELU -> one EventLoopSnapshot per window
  runtime-monitor.ts         owns the timer; adds CPU, heap, RSS, GC, cgroup throttling, HTTP + job latency; logs blocked windows
  prometheus-text.ts         ~150-line Prometheus text registry (no metrics library existed in the repo)
  metrics-server.ts          GET /metrics on its own listener (OBS_METRICS_PORT), optional bearer token
  http-metrics.middleware.ts times every response by route template
  start-runtime-monitor.ts   startRuntimeMonitor(service) for main.ts / worker.ts
```

`main.ts` and `worker.ts` call `startRuntimeMonitor('api' | 'worker')` first, next to `installProcessHandlers`, so a slow boot is
measured too. The API also installs `httpMetricsMiddleware` before the routes.

## Decisions

| Decision                                                                            | Why                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node:perf_hooks` directly, hand-rolled exposition                                  | The repo had no OpenTelemetry or Prometheus client (only Sentry), so nothing is duplicated. ~20 series do not justify a dependency. If OTel runtime instrumentation is adopted later, replace `prometheus-text.ts` and keep the sampler.                                     |
| Metrics on a separate listener, not an API route                                    | The worker has no HTTP server. A separate port bypasses guards, throttle and tenant context, and is not reachable through the public ingress. Off unless `OBS_METRICS_PORT` is set; loopback unless `OBS_METRICS_HOST` says otherwise; bearer token via `OBS_METRICS_TOKEN`. |
| 10 s window, histogram reset per window, ELU as an interval delta                   | The standard asks for it. `sample()` is the only reader, so windows cannot overlap or double count.                                                                                                                                                                          |
| An unmeasurable window publishes nothing for the loop series                        | Zeros would claim a healthy loop that was too starved to be measured. A stale `crm_runtime_last_report_timestamp_seconds` raises `RuntimeMetricsStale`.                                                                                                                      |
| Labels: `service`, `instance`, route template, method, status class, queue, GC kind | No tenant, user, contact or request id. Histogram label sets are capped at 500 with an `overflow` fallback; unmatched URLs are `unmatched`.                                                                                                                                  |
| Blocked windows log one JSON line with the three slowest route templates            | Evidence for an incident without payloads, tokens or PII.                                                                                                                                                                                                                    |
| cgroup throttling read asynchronously from `/sys/fs/cgroup/cpu.stat`                | Absent (not zero) off Linux or cgroup v1.                                                                                                                                                                                                                                    |

## Configuration (`INFRA` env, parsed at boot; bad values stop the process)

| Variable                       | Default     | Meaning                                                               |
| ------------------------------ | ----------- | --------------------------------------------------------------------- |
| `OBS_RUNTIME_MONITOR`          | `true`      | Master switch                                                         |
| `OBS_RUNTIME_INTERVAL_SECONDS` | `10`        | Reporting window                                                      |
| `OBS_METRICS_PORT`             | `0`         | `0` collects but does not listen                                      |
| `OBS_METRICS_HOST`             | `127.0.0.1` | Bind address                                                          |
| `OBS_METRICS_TOKEN`            | unset       | Bearer token (min 16 chars); set it whenever the host is not loopback |
| `OBS_BLOCKED_LOG_THRESHOLD_MS` | `250`       | Worst delay in a window that triggers the evidence log                |

## Known limits of the measurement (measured on Node 22.17, win32)

1. **Resolution floor.** The histogram records the time between its own ticks, so a healthy loop reads about the resolution (10 ms) at p50
   (about 15 ms on Windows timer granularity). The p95 > 20 ms warning is therefore "10 ms of real delay", not 20.
2. **`reset()` discards the next tick.** A stall that starts before the first tick after a reset is not recorded: spinning 400 ms
   immediately after `reset()` showed 17-21 ms, with 40 ms between reset and stall it showed 416 ms. Exposure is about one resolution
   step per 10 s window (0.1 to 0.2 %). Accepted and documented; the unit tests leave a tick between reset and stall.
3. **Blocks inside an HTTP handler are detected**: a 400 ms synchronous handler read 410 ms on the histogram and 400 ms on an
   independent drift sampler.

## Process inventory (summary; machine-readable in `event-loop-runtime-inventory.json`)

| Process                                                            | Instrumented                                                                                                               | How                                            |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `apps/api` HTTP + WebSocket (`dist/src/main.js`)                   | yes                                                                                                                        | `startRuntimeMonitor('api')` + HTTP middleware |
| `apps/api` worker (`dist/src/worker.js`, BullMQ + outbox)          | yes for loop, CPU, memory, GC, and job wait/duration/outcome per queue (one `JobMetricsModule` hook on every `WorkerHost`) | `startRuntimeMonitor('worker')`                |
| `apps/web` Next.js server                                          | **no**                                                                                                                     | needs `instrumentation.ts`; see backlog        |
| CLIs (`seed:*`, `secrets:reencrypt`, offsite backup, key rotation) | no, by design                                                                                                              | short-lived                                    |
| Worker threads                                                     | no, by design: one short-lived thread per flow Code-node run (`infra/sandbox/code-sandbox.ts`), hard-killed on timeout     | its cost appears in the caller's job duration  |
