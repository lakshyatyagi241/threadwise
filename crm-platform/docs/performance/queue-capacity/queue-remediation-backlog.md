# Queue remediation backlog

| ID | Pri | Item | Evidence |
| --- | --- | --- | --- |
| QR-01 | P2 | Remove or wire the six dead queue registrations: outbox, billing-posting, sla-sweep, counter-flush, partition-maintenance, bulk-jobs | `queue-inventory.json` problems |
| QR-02 | P1 | Separate worker process for CPU/bulk queues | isolation scenario C vs D |
| QR-03 | P1 | BullMQ `limiter` on provider-facing queues from documented provider ceilings | provider scenario |
| QR-04 | P1 | Per-tenant admission cap in broadcast/campaign producers | fairness scenario |
| QR-05 | P1 | Verify queue alerts with promtool (no Docker here) and add a Grafana panel for depth/age | rules unverified |
| QR-06 | P1 | Benchmark the real processors behind mocks: waba-ingest, webhook-ingest, message-dispatch, flow-run, contact-import | harness uses synthetic handlers |
| QR-07 | P1 | Measure DB connections per worker and pool exhaustion at higher concurrency | not run |
| QR-08 | P1 | 12 h soak and 24 h pre-release soak; current soak is 150 s and inconclusive on RSS | QCAP-026 FAIL |
| QR-09 | P1 | Test the last-second window before a Redis crash (appendfsync everysec) and a broker outage with large backlog | not run |
| QR-10 | P1 | Test DB outage, provider outage, deploy under load, DLQ redrive during normal traffic | not run |
| QR-11 | P1 | Commit baselines and wire `inventory.mjs --check`, `model.test.mjs` into CI; nightly/weekly bench with `regression()` | no CI workflow yet |
| QR-12 | P2 | Replace assumed job durations in `queue-backlog-forecasts.json` with production p50/p95 | forecasts are model only |
| QR-13 | P2 | Quiet the ioredis "Unhandled error event" noise during the harness Redis-restart scenario | cosmetic |
