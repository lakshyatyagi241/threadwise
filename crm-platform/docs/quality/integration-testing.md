# Integration testing (QA task 7)

Tests where our code meets something real or realistic: Postgres, Redis and BullMQ, the outbox, and the providers (faked at the HTTP edge).
"Covered" is defined per boundary below, with the suite that proves it.

## The boundaries and what proves each

| Boundary                   | What "covered" means                                                                                                                                                                                              | Suite                                                                                                                          | Needs Docker |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| Database: tenant isolation | Every table with an `org_id` has RLS enabled and forced, hides foreign rows, refuses a cross-tenant write, and is probed (a table the seed cannot fill fails the run)                                             | `test/integration/tenancy-isolation.generated.spec.ts` (generated from the live catalog), `rls.spec.ts`                        | yes          |
| Database: shape            | Composite keys, optimistic locking, partitions, schema invariants                                                                                                                                                 | `schema-invariants.spec.ts`, `optimistic-lock.spec.ts`, `partition-maintenance.spec.ts`, and one `*-schema.spec.ts` per domain | yes          |
| Database: per domain       | The repository and service behave against a real schema                                                                                                                                                           | `test/integration/<domain>/` (38 folders)                                                                                      | yes          |
| Queues: wiring             | Every name in `QUEUES` is a distinct kebab-case string and has a consumer and a producer, or is on a reasoned reserved list that only shrinks                                                                     | `test/unit/infra/boundaries.matrix.spec.ts`                                                                                    | **no**       |
| Queues: behaviour          | A job is processed, retried with backoff, and fails into the failed set                                                                                                                                           | per-domain specs; a generic per-queue harness is not written                                                                   | yes          |
| Outbox: wiring             | Every subscriber registers itself, has a distinct name (the registry silently ignores a repeat), listens for an event, and says how a redelivery is harmless (its own comment, or a row in the idempotency audit) | `test/unit/infra/boundaries.matrix.spec.ts`                                                                                    | **no**       |
| Outbox: behaviour          | An event reaches every matching subscriber; a failing one is retried without repeating the others' work                                                                                                           | `test/e2e/*` per domain; a generic replay-twice spec is not written                                                            | yes          |
| Cache: idempotency keys    | Reservation, replay, conflict, release on failure, TTLs, Redis down                                                                                                                                               | `test/unit/common/idempotency.interceptor.spec.ts` (fake Redis), `test/e2e/double-submit/`                                     | partly       |
| Providers                  | Success, timeout, 4xx, 5xx, malformed body, rate limit, per provider                                                                                                                                              | fake gateways in `test/support/` and per-channel specs; no per-provider failure matrix                                         | yes          |

## What the new matrices found (14 Oct 2026)

- Six names in `QUEUES` are used by no code: `OUTBOX`, `BILLING_POSTING`, `SLA_SWEEP`, `COUNTER_FLUSH`, `PARTITION_MAINTENANCE`, `BULK_JOBS`.
  Three of them name work that is done by an `@Interval` service (outbox drain, partition maintenance, SLA sweep); three are not built. They are
  listed as reserved in the matrix with the reason, and the matrix fails if one starts being used without being taken off the list.
- Four subscribers carry no word on idempotency in their own file (`call-realtime`, `social-handoff`, the two in `commerce-resume`). They are
  explained in [idempotency-audit.md](idempotency-audit.md), which the matrix now treats as the place to look.

## Counting

`node tools/quality/collect-metrics.mjs` prints the blocks per suite; `pnpm --filter @crm/api test:integration -- --reporter=json` gives the
real count, `it.each` rows included. The target on the sheet is 4,500 tests across the boundaries. The static count of integration blocks is
in the Phase 3 report; it is well below the target, and the honest way up is more per-domain specs, not a bigger matrix over the same
tables.

## Adding a boundary

1. Name what "covered" means for it in the table above.
2. Prefer a spec generated from metadata (the catalog, `QUEUES`, the subscriber list) so a new item fails until it is covered.
3. Put a spec that needs no database in `test/unit/` so it runs everywhere.
