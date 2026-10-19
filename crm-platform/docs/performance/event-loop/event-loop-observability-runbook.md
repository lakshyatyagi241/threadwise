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
cd /opt/desk && ./observability-up.sh   # next to docker-compose.yml and .env
```

It makes `OBS_METRICS_TOKEN`, sets `OBS_METRICS_PORT=9464`, asks where alerts go (a webhook that takes Alertmanager's JSON, Slack or
Discord, or PagerDuty; the URL or key is typed hidden), pulls `prom/prometheus:v2.55.0` and `prom/alertmanager:v0.27.0`, and starts
Prometheus, Alertmanager and a `probe` with `deploy/hostinger/observability.compose.yml`. Nothing is published to the internet or routed
through Traefik; look with
`docker compose -f docker-compose.yml -f observability.compose.yml exec prometheus wget -qO- http://localhost:9090/api/v1/targets`
or an SSH tunnel. Memory added: Prometheus 384m, Alertmanager 128m, probe 128m.

**It does not restart the app.** Releases are blue-green (`ci-entry.sh`): the metrics settings live in the base `docker-compose.yml`
(`OBS_METRICS_*`, default off), so the idle slot a release creates, and the worker it recreates, start serving `/metrics`; Prometheus
finds each slot by the network alias `api` / `web` that both slots carry (DNS discovery), so a slot that is stopped is absent rather
than a failed scrape. Until the first release after the script, the api, web and worker targets are simply missing. To not wait: out of
hours, `docker compose --env-file .env up -d --no-deps <the live slot's api and web, and worker>`, which costs the connections of that slot
the way any restart does. **Decision:** do not run it unattended and do not do it during working hours; whoever owns the host chooses the minute.

The listener refuses to start on a non-loopback address without `OBS_METRICS_TOKEN` and logs why; an unauthenticated `/metrics`
would be reachable by anything on the network.

**Test the destination before relying on it (EL-B14).** On the host Alertmanager is not published, so post to it from inside its container (no
timestamps needed: it starts the alert now and resolves it after `resolve_timeout`, 5 minutes):

```bash
docker compose -f docker-compose.yml -f observability.compose.yml exec -T alertmanager wget -qO-   --header 'Content-Type: application/json' http://localhost:9093/api/v2/alerts   --post-data '[{"labels":{"alertname":"EventLoopTestAlert","severity":"warning","service":"test"},"annotations":{"summary":"Test alert: nothing is wrong, this checks the alert path."}}]'
```

With Alertmanager reachable (a tunnel, or a local one) `node tools/event-loop-audit/send-test-alert.mjs --url=http://localhost:9093` sends the
same alert with a 90 s life, and `--resolve` ends it at once. A "firing" message must arrive after about 30 s (`group_wait`) and a
"resolved" one after the alert ends. Only then is the destination proven: `tools/event-loop-audit/rehearse-alert-receivers.mjs` proves the
shipped Slack and PagerDuty configs and the payload shape against a stand-in for each, not that your Slack or PagerDuty account accepts it
(last run: `evidence/alert-receivers.json`).

**Probe through the ingress (EL-B15):** `observability-up.sh` sets `PROBE_EXTRA_TARGETS` to `https://<DOMAIN>/health` and `/login`, so the probe
also times a request that leaves the stack and returns through Traefik; `ApiCallerLatencyHigh` covers every probe target. From the host
this includes the ingress, not the internet. For the internet, run the same probe image on a second host with only the public URLs in
`PROBE_TARGETS` and add it as a Prometheus job. **Not verified:** that the public path shows ingress queueing (needs a deployed stack),
and the 1 s `ApiCallerLatencyHigh` threshold has not been re-derived for the public target (it needs a week of real probe data). The
heaviest customer-facing routes need a login, and the probe carries no credential on purpose.

**Not yet done on any real server.** The files are validated (`docker compose config`, bash syntax, `amtool check-config` and
`promtool check config` in CI) and the same Prometheus and Alertmanager files run in the demo. `tools/event-loop-audit/rehearse-slot-discovery.mjs`
runs the shipped `prometheus.yml` against two containers sharing the alias `api` and checks the release behaviour: both slots are two
targets, a stopped slot disappears (`up == 0` for a few seconds at most, far under the rule's 2 minute hold), a returning slot is found
(last run: `evidence/slot-discovery.json`).

### What pages whom

| Alert                                                                   | Severity | Meaning                                                                                 |
| ----------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------- |
| `EventLoopBlockingWithImpact`, `WorkerEventLoopBlockingWithQueueImpact` | critical | Sustained loop degradation plus callers or the queue visibly hurting                    |
| `ApiCallerLatencyHigh`, `ApiProbeFailing`                               | critical | A client outside the API process sees p95 over 1 s, or the probe fails                  |
| `EventLoopLongStallCritical`                                            | critical | One window with the loop blocked over 10 s (no hold; a single block pages)              |
| `RuntimeMetricsTargetDown`                                              | critical | A scrape target has been down for 2 minutes (process dead, or blocked longer than that) |
| `EventLoopLongStallWarning`, delay and utilization warnings             | warning  | Over 2 s once; sustained delay or utilization. Not for waking people                    |

The 2 s and 10 s long-stall thresholds are judgement calls, not measured limits: change them in `event-loop.rules.yml` and in
`event-loop.rules.test.yml` together. Three Alertmanager files ship, chosen by `observability-up.sh` (`ALERTMANAGER_FILE`): `alertmanager.yml` (a webhook that takes Alertmanager's JSON), `alertmanager.slack.yml` (Slack's native receiver; Discord works with `/slack` appended to its webhook URL) and `alertmanager.pagerduty.yml` (Events API v2 with the integration key). All send warnings and criticals to the same place (PagerDuty's own routing decides who is woken; the severity is passed on). One inhibit rule keeps a warning quiet while a critical with the same `service` and `instance` is firing.

**Verified end to end, locally:** `node tools/event-loop-audit/scrape-demo.mjs [--stall]` runs the BUILT API, worker and probe as
real processes, a real `prom/prometheus` and `prom/alertmanager` with the files from `deploy/observability` (addresses and
intervals only are rewritten), and a small HTTP server standing in for the alert destination. It checks: all three targets up and
labelled as the rules expect, the series present, all 16 rules loaded and evaluating, a real job visible, nothing firing when idle;
with `--stall` also a 1.5 s API stall (`EventLoopBlockingWithImpact` and `ApiCallerLatencyHigh` fire; callers and the probe see
over a second, the server's request histogram sees 7 ms), a 600 ms worker stall with 20,000 queued jobs
(`WorkerEventLoopBlockingWithQueueImpact` fires), one 12 s block (`EventLoopLongStallCritical` fires), the killed worker
(`RuntimeMetricsTargetDown`), and that firing and resolved notifications reach the receiver. Needs Docker and the built API
(`pnpm --filter @crm/api build`); about 10 minutes, 35 with `--stall`. `--phases=api,worker,long` picks phases. Results of the last
run: `evidence/scrape-demo.json`.

**Dashboards:** `deploy/observability/grafana/` (API, workers, realtime, release comparison; see its README for what each answers and does not show). `scrape-demo.mjs --grafana` starts a real Grafana next to the demo Prometheus, checks that it provisions the four dashboards and runs every panel query through Grafana's own API (last run: `evidence/scrape-demo-grafana.json`, 54 of 54). Edit `tools/event-loop-audit/dashboards/build.mjs`, never the JSON.

**The release label:** every series carries `release` (the image tag; `OBS_RELEASE`, else `GIT_SHA`, else `IMAGE_TAG`). The release-comparison dashboard groups its last section by it, so during a rollout the old and the new release show side by side. A process started without any of the three has no label (its release name is empty on the graphs).

**The web server:** `scrape-demo.mjs --web` (after `pnpm --filter @crm/web build`) runs the built Next.js server as a fourth target; `web-metrics-check.mjs` starts it five times with different `OBS_*` settings and asks its own `/metrics`. `WebEventLoopBlockingWithImpact` is the web counterpart of the API rule (16 rules in all).

**Regression gate:** `bash tools/event-loop-audit/ci-regression.sh` (or the manual `event-loop-regression` job in the Quality workflow) runs one load of the built API and compares it with `docs/performance/event-loop/ci-baseline.json` through `tools/event-loop-audit/regression-check.mjs`. Exit 0 no regression found, 1 regression, 2 cannot decide. **A 2 is not a pass:** no baseline, a baseline from another kind of machine, an aborted run, or a failure on a host whose round trips are far from the baseline's (rerun it on a quiet machine). Record a baseline with three separate runs (`--record`, header of the script). Do not record one on a laptop that is busy: the recorded spread is the tolerance. `run-load.mjs --inject-block-ms=300` proves the gate still trips. Evidence and its limits: `evidence/regression-gate-local.json`.

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

### A slow request with a quiet event loop: where did it wait?

```bash
node tools/event-loop-audit/load/run-load.mjs --trace --profiles=normal,peak --seconds=90 --contacts=1500
node tools/event-loop-audit/load/rtt-drift.mjs        # the host's container round trips with no application, ~5 minutes
```

`--trace` loads `trace-preload.cjs` into the API (`node -r`, no code change). Per route it reports requests, statements,
transactions, connections taken, Redis commands, and how long each request spent waiting for a pooled connection, inside statements,
inside Redis commands and holding a transaction open between statements, plus the individual statements and commands ranked by time
(`roundTrips`). Read `meanMsPerRequest` against `handlerMs.mean`: what remains is JS work and event-loop queueing. If the sum of
round trips times the round-trip time explains the handler time, the request is waiting on the network path, and the lever is fewer
sequential round trips (EL-B17) or a faster path. `roundTripsDuringProfile` is the host's own `SELECT 1` and `PING` while the profile
ran, with the highest container CPU seen. The tracer adds a little overhead of its own: do not leave it on in production.

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
