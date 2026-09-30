---
name: wadesk-e2e-tests
description: >-
  Turn a WaDesk feature's Given/When/Then acceptance criteria into automated
  tests in this repo: unit tests, database-backed integration tests, API-level
  end-to-end tests, and browser e2e tests for the web app. Use this whenever
  someone says "write tests for WD-XXX", "cover the acceptance criteria", "e2e
  test for this feature", "is my feature tested end to end", "add an
  integration test", "prove tenant isolation for my new table", or as the test
  step inside wadesk-port-feature. Every criterion in the inventory entry must
  map to a named test; a feature is not done without them.
---

# Tests for a ported feature

Test layers that exist today (verified by running them in this repo):

| Layer             | Where                                          | Run                                                                                                | Notes                                                                                                                   |
| ----------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Unit              | `apps/api/test/unit/<domain>/*.spec.ts`        | `pnpm --filter @crm/api test`                                                                      | pure logic, mappers, permission merges, parsers. Runs in seconds, no Docker                                             |
| Integration (DB)  | `apps/api/test/integration/<domain>/*.spec.ts` | `pnpm --filter @crm/api exec vitest run --dir test/integration --testTimeout=120000 <name-filter>` | starts its own throwaway `pgvector/pgvector:pg16` container via testcontainers; needs Docker; never touches your dev DB |
| API e2e           | `apps/api/test/e2e/<domain>/*.spec.ts`         | `pnpm --filter @crm/api test:e2e`                                                                  | script exists; **no spec and no harness yet**, see below                                                                |
| Web e2e (browser) | `apps/web/e2e/<domain>/`                       | defined by the web foundation (K4)                                                                 | not available until the web app lands                                                                                   |

Files are picked up by vitest (`**/*.spec.ts`), suites run serially. `@nestjs/testing` and `supertest` are
already devDependencies but nothing uses them yet.

## Criterion → test mapping (do this first)

Open the feature entry (`wadesk-feature-lookup`). For each **Given/When/Then** bullet write one test whose name
starts with the feature id and the criterion number: `it('WD-TIB1-014 #2: assigning a closed conversation reopens it', ...)`.
Then add the tests the entry implies but does not state, always:

1. **Tenant isolation:** the same request as org B for org A's row returns 404/empty, never 403-with-data. For every new table run `check-rls.sh` and add an integration test in the style of `test/integration/rls.spec.ts` (raw SQL as the restricted app role, not the container superuser, which bypasses RLS).
2. **Permission:** every route without the permission gets 403; scope-capable keys are exercised at `own` and `all`.
3. **Validation:** each documented validation rule (required, max length, enum, uniqueness scope) has a rejecting case with the problem+json `code`.
4. **Optimistic locking:** update with a stale `rowVersion` returns 409 `ROW_VERSION_CONFLICT`.
5. **Audit + outbox:** a successful write leaves exactly one audit row and one outbox event in the same transaction; a failed write leaves neither.
6. **Idempotency** for money/sending routes: same `Idempotency-Key` replays, does not double-charge/send.
7. **Async paths:** processors/subscribers run against fixtures; assert idempotency on redelivery.
8. **Provider/webhook:** feed recorded-shape payload fixtures (write your own from the inventory description; never real customer data) including a bad signature.

## API e2e harness (until it exists)

The harness is a K3 kernel item: `apps/api/test/support/` (start a testcontainers Postgres, run migrations with the
restricted app role as `rls.spec.ts` does, boot the Nest app with `Test.createTestingModule`, expose a `supertest`
agent and a helper that signs in as a seeded staff user of a chosen org). If it is missing when you need it, ask
the K3 steward or land it as its own small kernel PR (see the kernel protocol in `wadesk-ownership-guard`); do not
copy a private harness into your domain.

## Fixtures and data

- Seed through the same repositories/services the app uses, or SQL under the app role; never bypass RLS with the owner connection to arrange data for a test that asserts isolation.
- Money as strings, ids as uuids, timestamps in UTC. No sleeping: wait on the observable condition.
- Realtime and web: assert the socket event/UI state that the entry lists under UX.

## Gate

Run your tests, then the whole gate before the PR: `bash .claude/skills/pre-pr/scripts/gate.sh` (it runs the integration suite when db/api files changed). A flaky test is a failing test: fix or delete it, never retry-loop.
