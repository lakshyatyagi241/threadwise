# Queue infrastructure bottlenecks (measured vs open)

Run: see `queue-test-results.json`. Synthetic jobs, local Redis 7, one machine.

## Measured

1. **Event loop, not the broker, is the first limit for a worker process.** 320 jobs/s for 3 ms sync jobs at 92% CPU; 4,500 jobs/s for io jobs at 47% CPU. Redis ping max stayed under 1 ms except one 381 ms outlier during the soak.
2. **A queue split does not isolate CPU.** Critical wait p95 with 40 ms sync bulk jobs in the same process: ~2.5 s (event-loop lag p99 163 ms). Same jobs in a separate process: 4 ms. `docker-compose.prod.yml` runs one `node dist/src/worker.js` hosting every processor.
3. **A shared FIFO queue starves small work** (p95 ~5 s behind a 3,000-job bulk flood); separate queues: 4 ms. The repo already splits queues; this is the evidence for keeping it so.
4. **Retry storm without a limiter.** Provider ceiling 100 req/s, concurrency 50, 5 attempts: 8,490 rejected calls for 2,000 jobs (4.5x call amplification) and ~1,560 jobs failed for good. With `limiter {max: 90, duration: 1000}`: 0 rejected, 2,000 completed. Only `lead-scoring` sets a `limiter` today.
5. **Noisy tenant.** FIFO: small tenant wait p95 ~6.4 s. A per-tenant admission cap of 300 queued jobs: ~320 ms, and the noisy tenant still completes. No such cap exists in the product.
6. **Backlog maths holds.** Predicted drain 8.0 s, measured 7.8 s (1.6% error). 300% spike (969/s against 462/s capacity) built a 1,517-job backlog that drained in 3.3 s after the spike; forecast 3.3 s. Wait p95 during stress and spike: 2.3 s and 3.1 s (not held to the normal SLO, by design).
7. **Worker kill.** 200 of 200 jobs completed after one and after two `kill -9` of a worker with 10 active jobs; recovery ~2 s with a 2 s lock. Execution is at-least-once, so effects must stay idempotent (the inbound queues already are).
8. **Redis restart.** Without persistence 5,000 of 5,000 accepted jobs vanished. With `appendonly yes` (as prod compose) none were lost after the fsync window. Jobs accepted in the last ~1 s before a crash were **not** tested.
9. **Memory.** Redis ~1 KB per retained job (6 MB for ~9,400 retained). Soak RSS slope 5.9 MB/min over 150 s and heap 1.4 MB/min: too short to separate warm-up from a leak (check QCAP-026 fails, kept failing on purpose).

## Not measured

Postgres connection use per worker, slow-query amplification, real Meta/partner throughput, Redis under a multi-hundred-thousand backlog, network payload limits, deploy with active work, DLQ redrive under load, tenant-context leakage with real processors.
