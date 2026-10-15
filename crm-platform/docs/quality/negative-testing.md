# Negative testing (QA task 13)

Sends every route the wrong thing and proves it refuses cleanly: a 4xx with the standard error envelope, never a 5xx, never a 2xx, no stack trace.

## Pieces

| File                                              | What it is                                                                                                                                                                                                                                                                                                                             | Runs without Docker               |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `apps/api/test/support/negative.ts`               | `mutations(schema)` makes bad bodies from a zod schema (missing field, wrong type, one past each min and max, outside an enum, empty string, null, wrong container, unknown field); `validSample(schema)` builds a good body to mutate. Every case is checked against the schema, so a body the schema would accept is never reported. | yes                               |
| `apps/api/test/unit/common/negative.spec.ts`      | unit tests of the generator                                                                                                                                                                                                                                                                                                            | yes                               |
| `apps/api/test/e2e/negative/routes.ts`            | reads every route, its public flag and its body schema from the controllers' own metadata                                                                                                                                                                                                                                              | needs the app                     |
| `apps/api/test/e2e/negative/negative.e2e.spec.ts` | body sweep, auth sweep (no, garbage and tampered token), protocol checks (malformed JSON, 413, wrong content type, long query, wrong method)                                                                                                                                                                                           | needs Postgres and Redis (Docker) |
| `apps/api/test/e2e/negative/known-gaps.json`      | routes allowed to fail today, each with an owner and a reason. Only shrinks.                                                                                                                                                                                                                                                           | n/a                               |

## Run it

```bash
pnpm --filter @crm/api exec vitest run test/e2e/negative --testTimeout=120000
# one domain at a time, all cases, with a failure report to triage:
NEGATIVE_FILTER='^POST /v2/contacts' NEGATIVE_MAX_CASES=0 NEGATIVE_REPORT=/tmp/neg.json \
  pnpm --filter @crm/api exec vitest run test/e2e/negative
```

## First run

The sweep was written without being able to start the database (no Docker in the authoring environment), so **it has not been run against the app**. Expect failures
on the first run: each is either a real defect (a 5xx on bad input, a schema that is not enforced) or a case the generator should not send. Triage the report:
fix the defect, or add the route to `known-gaps.json` with an owner. A route that later passes must be taken off the list (the sweep tells you).

## Limits

- Only routes that bind their body with `zodPipe(schema)` get generated cases. Routes that validate another way are counted by the auth and protocol checks only.
- "No partial write" is not asserted by the generic sweep (it cannot know each route's table). Domain specs that need it assert the row count, as `test/e2e/double-submit` does.
- Path ids are a well-formed random uuid, so the request reaches body validation; routes with non-uuid path params may stop at the path check (still a 4xx).
- 5 consecutive clean runs and the 95% P0/P1 coverage target need the first run and the gap list to settle before they can be measured.
