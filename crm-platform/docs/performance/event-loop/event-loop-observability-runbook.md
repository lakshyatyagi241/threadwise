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

**Verified end to end, locally:** `node tools/event-loop-audit/scrape-demo.mjs [--stall]` runs the BUILT API and worker as real
processes, a real `prom/prometheus` container with these files, and asks Prometheus what it sees: both targets up, the series present
with the expected labels, all 11 rules loaded and evaluating, a real job visible, `RuntimeMetricsTargetDown` firing when the worker is
killed and, with `--stall`, `EventLoopBlockingWithImpact` firing from a stall injected into the live API through its inspector.
Needs Docker and the built API (`pnpm --filter @crm/api build`); about 10 minutes, 25 with `--stall`.

**Not wired into `deploy/hostinger/docker-compose.yml`:** that stack has no Prometheus or Grafana service and the `OBS_*` variables are
not set on `api`/`worker`. Adding them is a deployment decision (a new service and memory on the VPS, where the metrics are kept), not
something the repo has settled; until then production emits the metrics and logs the blocked-loop line, and nothing stores them.

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

`check` validates syntax and PromQL (11 rules). `test` feeds synthetic series and asserts which alerts fire at which time, including the
near-misses that must not page: high utilization alone, high delay with fast requests or a fast queue, a live heartbeat, a scrape
target that is not ours. Both run in the `event-loop` job of `quality.yml`. Mutation-checked: loosening the API impact threshold, the
worker queue threshold or the stale threshold makes the matching case fail.

What this does not prove: that a real Prometheus scraping a real process produces these series with these labels and the same
timing, and that anyone gets paged. Change a threshold or add an alert only together with a case in `event-loop.rules.test.yml`.

## Reading the signals

| You see                          | It usually means                                       | Check                                                      |
| -------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------- |
| Delay p95/p99 up **and** CPU up  | Synchronous CPU work                                   | CPU profile (below); the `slowestRequests` in the log line |
| API latency up, delay low        | Slow DB / network / dependency                         | Traces, query timings. Not a loop problem                  |
| Delay up, request histogram flat | A blocked loop: requests queue BEFORE the handler runs | Trust the loop delay; callers see it, the histogram cannot |
| Delay up with GC pause max up    | Allocation pressure                                    | Heap trend, large temporary arrays/strings                 |
| ELU high, delay low              | Busy but responsive                                    | Capacity headroom, not a defect. Do not "fix" it           |
| Low host CPU, severe delay       | One core blocked, sync I/O or cgroup throttling        | `crm_container_cpu_throttled_*`, per-instance panel        |
| Delay creeping up over hours     | Leak or buildup                                        | Heap/RSS, `crm_process_active_resources`, queue depth      |
| One instance bad, others fine    | Bad pod or a hot tenant routed to it                   | Compare by `instance` label                                |
| `RuntimeMetricsStale`            | Loop blocked for over a minute, or the process is gone | Process state first, scrape second                         |

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
