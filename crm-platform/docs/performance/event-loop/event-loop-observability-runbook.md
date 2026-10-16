# Event-loop observability runbook

Rules (permanent):

1. No unexplained event-loop p99 regression in a critical API or worker benchmark.
2. No new unbounded synchronous processing of user-controlled or high-volume data.
3. No performance optimization without measured evidence that it preserves behavior and improves the bottleneck.

## Turn it on in an environment

Set on the `api` and `worker` containers:

```
OBS_METRICS_PORT=9464
OBS_METRICS_HOST=0.0.0.0        # only on the private container network; never publish this port
OBS_METRICS_TOKEN=<random, 16+ chars>
```

Scrape `http://<container>:9464/metrics` with `Authorization: Bearer <token>`, jobs named `crm-api` and `crm-worker`
(`deploy/observability/prometheus.yml` is the template, token read from a file). Load `deploy/observability/event-loop.rules.yml`
into Prometheus. Without `OBS_METRICS_PORT` the process still measures and still logs `event loop blocked`, but nothing scrapes it.

### Production (Hostinger stack): one command, opt-in

```bash
cd /opt/desk && ./deploy/hostinger/observability-up.sh   # next to docker-compose.yml and .env
```

It makes `OBS_METRICS_TOKEN`, asks for the URL alerts go to (a webhook that accepts Alertmanager's JSON; hidden input), pulls
`prom/prometheus:v2.55.0` and `prom/alertmanager:v0.27.0`, and starts `api`, `worker`, a `probe` and the two collectors with
`deploy/hostinger/observability.compose.yml`. Nothing is published to the internet or routed through Traefik; look with
`docker compose -f docker-compose.yml -f observability.compose.yml exec prometheus wget -qO- http://localhost:9090/api/v1/alerts`
or an SSH tunnel. It restarts `api` and `worker`, so run it in a quiet minute. Without the overlay the base compose file keeps the
metrics listener off (`OBS_METRICS_PORT` defaults to 0), exactly as before. Memory added: Prometheus 384m, Alertmanager 128m, probe 128m.

The listener refuses to start on a non-loopback address without `OBS_METRICS_TOKEN` and logs why; an unauthenticated `/metrics`
would be reachable by anything on the network.

**Not yet done on any real server.** The files are validated (`docker compose config`, bash syntax) and the same three processes and
the same Prometheus and Alertmanager config files run in the demo, but no host has been changed.

### What pages whom

| Alert                                                                   | Severity | Meaning                                                                                 |
| ----------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------- |
| `EventLoopBlockingWithImpact`, `WorkerEventLoopBlockingWithQueueImpact` | critical | Sustained loop degradation plus callers or the queue visibly hurting                    |
| `ApiCallerLatencyHigh`, `ApiProbeFailing`                               | critical | A client outside the API process sees p95 over 1 s, or the probe fails                  |
| `EventLoopLongStallCritical`                                            | critical | One window with the loop blocked over 10 s (no hold; a single block pages)              |
| `RuntimeMetricsTargetDown`                                              | critical | A scrape target has been down for 2 minutes (process dead, or blocked longer than that) |
| `EventLoopLongStallWarning`, delay and utilization warnings             | warning  | Over 2 s once; sustained delay or utilization. Not for waking people                    |

The 2 s and 10 s long-stall thresholds are judgement calls, not measured limits: change them in `event-loop.rules.yml` and in
`event-loop.rules.test.yml` together. `alertmanager.yml` has a single webhook receiver and no per-severity routing, so warnings and criticals go to the same place; split
them there when the destination is chosen (its comments show Slack and PagerDuty receivers). One inhibit rule keeps a warning quiet
while a critical with the same `service` and `instance` is firing. Slack and Discord webhooks do not accept Alertmanager's JSON as it is.

**Verified end to end, locally:** `node tools/event-loop-audit/scrape-demo.mjs [--stall]` runs the BUILT API, worker and probe as
real processes, a real `prom/prometheus` and `prom/alertmanager` with the files from `deploy/observability` (addresses and
intervals only are rewritten), and a small HTTP server standing in for the alert destination. It checks: all three targets up and
labelled as the rules expect, the series present, all 15 rules loaded and evaluating, a real job visible, nothing firing when idle;
with `--stall` also a 1.5 s API stall (`EventLoopBlockingWithImpact` and `ApiCallerLatencyHigh` fire; callers and the probe see
over a second, the server's request histogram sees 7 ms), a 600 ms worker stall with 20,000 queued jobs
(`WorkerEventLoopBlockingWithQueueImpact` fires), one 12 s block (`EventLoopLongStallCritical` fires), the killed worker
(`RuntimeMetricsTargetDown`), and that firing and resolved notifications reach the receiver. Needs Docker and the built API
(`pnpm --filter @crm/api build`); about 10 minutes, 35 with `--stall`. `--phases=api,worker,long` picks phases. Results of the last
run: `evidence/scrape-demo.json`.

Two things that differ from what the code emits, seen in the real scrape:

- `instance` is the **scrape address** (`api:9464`), Prometheus's default; the process's own `host:pid` id arrives as
  `exported_instance`. Keep it that way: a pid in `instance` would make every restart a new series. Rules join on `service, instance`,
  which agree because both sides come from one target.
- A target that cannot answer is `up == 0`, and its series vanish after the staleness window. `RuntimeMetricsStale` therefore does **not**
  fire for a dead process; `RuntimeMetricsTargetDown` does (after its 2 minute hold).

### Check the alert rules (no Prometheus needed)

```bash
docker run --rm -v "$PWD/deploy/observability:/rules" --entrypoint promtool prom/prometheus:v2.55.0 check rules /rules/event-loop.rules.yml
docker run --rm -v "$PWD/deploy/observability:/rules" --entrypoint promtool prom/prometheus:v2.55.0 test rules /rules/event-loop.rules.test.yml
```

`check` validates syntax and PromQL (15 rules). `test` feeds synthetic series and asserts which alerts fire at which time, including the
near-misses that must not page: high utilization alone, high delay with fast requests or a fast queue, a live heartbeat, a scrape
target that is not ours. Both run in the `event-loop` job of `quality.yml`. Mutation-checked: loosening the API impact threshold, the
worker queue threshold or the stale threshold makes the matching case fail.

What this does not prove: that a real Prometheus scraping a real process produces these series with these labels and the same
timing, and that anyone gets paged. Change a threshold or add an alert only together with a case in `event-loop.rules.test.yml`.

## Reading the signals

| You see                          | It usually means                                       | Check                                                                                      |
| -------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Delay p95/p99 up **and** CPU up  | Synchronous CPU work                                   | CPU profile (below); the `slowestRequests` in the log line                                 |
| API latency up, delay low        | Slow DB / network / dependency                         | Traces, query timings. Not a loop problem                                                  |
| Delay up, request histogram flat | A blocked loop: requests queue BEFORE the handler runs | Trust the loop delay; callers see it, the histogram cannot                                 |
| Delay up with GC pause max up    | Allocation pressure                                    | Heap trend, large temporary arrays/strings                                                 |
| ELU high, delay low              | Busy but responsive                                    | Capacity headroom, not a defect. Do not "fix" it                                           |
| Low host CPU, severe delay       | One core blocked, sync I/O or cgroup throttling        | `crm_container_cpu_throttled_*`, per-instance panel                                        |
| Delay creeping up over hours     | Leak or buildup                                        | Heap/RSS, `crm_process_active_resources`, queue depth                                      |
| One instance bad, others fine    | Bad pod or a hot tenant routed to it                   | Compare by `instance` label                                                                |
| `RuntimeMetricsStale`            | The scrape answers but the report is old (loop stuck)  | Process state first, scrape second. A dead process is `RuntimeMetricsTargetDown`, not this |
| `ApiCallerLatencyHigh`           | Callers wait over 1 s, as timed by the probe process   | Loop delay (blocked loop) vs DB/network (loop quiet); the probe's own `crm_probe_up`       |
| `EventLoopLongStallCritical`     | One window with the loop blocked over 10 s             | The `event loop blocked` log line for that minute; the profile steps below                 |

Healthy reading: a 10 ms-resolution histogram reports about 10 ms at p50 (about 15 ms on Windows). That is the resolution floor, not delay.

## Capture evidence before restarting

On the affected instance, while it is still degraded:

```bash
# 30-second CPU profile of the running process (writes a .cpuprofile in the cwd)
node --cpu-prof --cpu-prof-dir=/tmp/prof --cpu-prof-interval 1000 ...      # at start, when you can restart into it
# or attach to a running one:
kill -USR1 <pid>   # opens the inspector; connect Chrome DevTools to the forwarded port and record a CPU profile
```

Attach to the incident: the `event loop blocked` log lines (route templates, window max, GC max), the `crm_http_request_duration_seconds`
panel for the same minutes, the profile, the commit SHA and `instance` id. Profile only in a controlled or explicitly configured
environment; a profile can contain code paths but not request data.

## Static gate

```bash
node tools/event-loop-audit/scan.mjs            # report -> reports/event-loop/blocking-hotspots.json
node tools/event-loop-audit/scan.mjs --check    # exits 1 on a NEW runtime-path suspect
```

A finding is a suspect from syntax alone. Before changing code: reproduce or profile, record the before number, make the smallest
change, record the after number. `--write-baseline` accepts a finding only with a reason in the PR.

## Benchmark the monitor itself

```bash
node tools/event-loop-audit/bench.mjs --seconds 15 --rounds 3
```

Writes `reports/event-loop/bench-monitor.json` with machine, Node version and commit. Compare only runs from the same environment.

## Load baselines of the real application

```bash
pnpm --filter @crm/db --filter @crm/contracts --filter @crm/config --filter @crm/tax build
pnpm --filter @crm/api build
node tools/event-loop-audit/load/run-load.mjs                                   # idle, normal, peak, spike, 10 min soak: ~35 minutes
node tools/event-loop-audit/load/run-load.mjs --profiles=idle,normal --seconds=60 --contacts=1000   # a quick look
```

Needs Docker (throwaway Postgres and Redis, and `grafana/k6:0.49.0`). It starts the BUILT API and worker as separate processes, seeds
one workspace and N contacts through the real create route, runs a k6 mix (contact list/search/get/create/update, inbox list/counts,
a `/health` control) at a fixed arrival rate, and reads the processes' own `/metrics` every 2 s plus `pg_stat_activity`. It writes
`reports/event-loop/load-baseline.json` with the commit, Node version, machine, workload and rates, and, for each profile, loop delay,
utilization, CPU, heap, RSS, blocked windows, the server-side request quantiles, what Postgres was doing, the k6 client latency per
route, and host-to-container round-trip times measured before and after the profile. Run it only against its own stack.

How to read it: client latency (k6) is what a caller waited; `serverRequestMs` excludes time queued behind a blocked loop; loop delay
says whether the process itself was the delay. Callers waiting seconds while loop delay p99 stays at tens of milliseconds means the
wait is somewhere else (database, Redis, the network path), not a blocked loop. Compare two runs only if their round-trip
calibration is similar. The rates are chosen, not taken from production, and the soak is minutes, not 12 or 24 hours.

## Check the job metrics against a real BullMQ worker

Needs Docker (a throwaway Redis; no data of the app is touched):

```bash
docker run -d --rm --name el-job-redis -p 56379:6379 redis:7-alpine
cd apps/api && node node_modules/tsx/dist/cli.mjs ../../tools/event-loop-audit/verify-job-metrics.ts
docker stop el-job-redis
```

It runs a success, a failure, a retried job and a delayed job, and exits 1 if the recorded wait, duration or outcome counts are off.
Limits worth knowing: BullMQ reports a job only when it reaches a final state, so retried attempts are invisible, and a job that
needed a retry has no wait recorded.

## Alert hygiene

- Critical needs sustained loop degradation **and** impact. A single spike is recorded, not paged.
- Never add a tenant, user, contact or request id as a label. New label values must come from a small fixed set (route templates, queue names).
- Thresholds are initial targets. Re-derive them from `event-loop-performance-baseline.json` once real peak baselines exist.
