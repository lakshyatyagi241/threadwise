# critical-path-drill

Proves the CRITICAL path of the Google Chat alerting from real conditions, not hand-built alert JSON:

fault -> API/worker/probe metrics -> Prometheus v2.55.0 (repo `deploy/observability/*.rules.yml`) -> Alertmanager v0.27.0
(`alertmanager.gchat.yml`) -> `tools/chat-bridge/index.mjs` -> `tools/chat-bridge/fake-chat.mjs` (three distinct space URLs).

Run: `bash script-testing/critical-path-drill/run.sh [--quick] [--out DIR]` (exit 0 PASS, 1 FAIL, 2 ERROR). Result: `result.json`
(checks) and `drill.json` (per-fault latency, card text, thread contents, resolver steps, Alertmanager inhibition).

Shortened for the drill (a copy, the repo files are never edited): every rule `for:` becomes 20 s; the critical and slow `group_interval`
of the Alertmanager config becomes 15 s (real: 2 m). Real latency is therefore larger by up to the real `for:` plus the real group_interval.

Faults: pg-hang (TCP black hole in front of Postgres, pool max 2, 8 callers), warning-only (API metrics target repointed to a dead port:
`CacheMetricsMissing` is warning and must not post), redis-down (TCP proxy refuses), probe-dead-port. `--quick` runs pg-hang and warning-only.

Safety: own throwaway database, private containers with random names (Redis, Prometheus, Alertmanager; removed at exit), random free
ports, the shared Postgres/Redis/Mailpit are never stopped. No remote host is contacted; the bridge URL guard is opened only for the
local fake (`CHAT_ALLOW_ANY_HOST=1`).
