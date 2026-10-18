# Worker concurrency recommendations

Source: `worker-throughput-benchmarks.json` (commit in the file). **Synthetic handlers on one machine; these are mechanism results, not settings to apply.** Real processors were not benchmarked, so no `concurrency` value in the code is changed by this work.

| Job shape | Knee | Safe default (30% headroom) | Peak jobs/s | Note |
| --- | --- | --- | --- | --- |
| io 20 ms (provider / HTTP wait) | 100 (at edge of the swept range) | 70 | ~4,500 | Throughput scales almost linearly to c=100; the ceiling is not found. The one Node process, not the queue, set the peak (47% CPU). Real limit will be the provider or Postgres |
| db 5 ms, pool of 10 | 20 | 14 | ~1,840 | Throughput stops at the pool size: concurrency above the pool only queues on the pool. Set worker concurrency near the pool share |
| cpu 3 ms (sync) | 5 | 3 | ~320 | One event loop is the ceiling; c=20 raises event-loop lag p99 from 12 ms to 63 ms with no throughput gain |

## Reading the current settings against this

- `apps/api` sets 1 to 16 per queue; the sum of all processors is the slot budget of **one** worker process (see `queue-topology.md`), all sharing one event loop and one DB pool. Per-queue numbers are not independent.
- CPU-bound processors (`privacy-export`, large exports, import parsing) should not raise concurrency above 1 to 2 in a process that also serves inbound queues.
- DB-bound processors: keep the sum of concurrencies of DB-bound queues at or below the worker's pool size minus a reserve.

## To turn this into settings

Measure `crm_queue_job_duration_seconds` p50/p95 per queue in staging, replace the assumed durations in `queue-backlog-forecasts.json`, then rerun `bench.mjs` with the real processors behind a mock provider.
