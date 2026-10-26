# Stress test result (QA task 54)

Run: `API_URL=http://localhost:3000 QA_EMAIL=... QA_PASSWORD=... QA_PEAK_RPS=20 QA_STRESS_STEPS=1,2,4,8,12,16,24 pnpm qa 54 -- --stress`
One laptop (API, Postgres 16, Redis and the load generator together), 100,000 contacts / 1,000,000 messages, production mode. The expected peak is an
**assumption of 20 requests/s** for the mixed workload: set `QA_PEAK_RPS` to the real figure and rerun; the multiples mean nothing against a guess.

| Step | Rate | p95 before the guard | p95 after the guard | Shed (503) | Errors |
| ---- | ---- | -------------------- | ------------------- | ---------- | ------ |
| 1x   | 20/s | 29 ms                | 29 ms               | 0          | 0      |
| 4x   | 80/s | 25 ms                | 23 ms               | 0          | 0      |
| 8x   | 160/s| 470 ms               | 30 ms               | 0          | 0      |
| 12x  | 240/s| 8,306 ms, 248 dropped connections, 0 shed | 4,600 ms | 811 | 9 of 3,600 |

- Degradation point: **12x the assumed peak (240 requests/s)**. Recovery after the ramp: p95 back to 32 ms.
- Before: overload showed up as seconds of queueing and dropped connections, with no answer a client could back off from.
- Now: `API_MAX_INFLIGHT` (default 256, 0 = off) caps requests in flight; the next is refused at once with 503 + `Retry-After: 1`
  (`apps/api/src/common/http/overload-guard.ts`). `/health`, `/ready` and `/metrics` are never shed.
- The heavier Message History routes saturate earlier (about 25 to 38 requests/s on this box, see `tools/perf/stress-ramp.mjs`); they queue, they do not fail.
