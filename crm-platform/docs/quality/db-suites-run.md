# The database-backed suites, run for the first time

Until now the integration and end-to-end suites had only run on a laptop with Docker. This run used a native Postgres 16 (pgvector 0.8) and Redis, with a small stand-in for
Testcontainers (`tools/quality/native-db/`), on one 4-core Linux machine with three files in parallel. Each file got its own copy of an empty UTF-8 cluster and ran its real migrations
(about 11 s). The suites themselves were not changed, except the QA tests listed under "Fixed".

## Results (19 Oct 2026, `main` at `1de765cc`)

| Suite                                                                  | Files | Tests | Pass  | Fail                          | Skipped |
| ---------------------------------------------------------------------- | ----- | ----- | ----- | ----------------------------- | ------- |
| Integration                                                            | 105   | 1,338 | 1,282 | 6 (+1 file that cannot start) | 50      |
| End to end, first pass                                                 | 382   | 8,390 | 8,070 | 139                           | 168     |
| End to end, failing files re-run with the sandbox's DNS check bypassed | 55    | 1,711 | 1,409 | 136                           | 166     |

The QA suites written in Phases 1 to 3 all pass now: contract (error contracts 30, responses 11, customer API document 3), negative (8, the sweep sent 2,366 bad requests to 764 routes and found no 5xx), journeys (5, 112 runs),
double-submit (26 + the route ratchet), unicode (108 + 24).

## What the first run showed in the QA tests themselves (fixed, commit `b8faa272c`)

- The contract test read a tag by id; there is no such route. The update now takes the version from the create reply.
- The negative sweep sent a bare string through supertest, which turns it into a form body that the server reads as `{}`; routes with all-optional bodies "accepted" it. It now sends real JSON, and accepts the customer API's `{ error: { code } }` envelope.
- The customer API document used a `Company` tag that is not in the published tag list. The tag is now published (`api-v1-tags.ts`).
- The route ratchets had never been generated: `undocumented-routes.json` (64 routes), the POST-without-`@Idempotent` list (57 more routes since Phase 2) and the customer API baseline `docs/quality/contract/api-v1.openapi.json` are now committed.
- Two unicode tests failed on a first cluster created with the C locale: Postgres counted bytes, not characters. Not a product problem; `build-template.sh` creates a UTF-8 cluster.

## Failing on `main`, not caused by any QA change

Integration (6):

| Test                                                                                                                                                    | Reading                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema-invariants`: `failed_operation_events.failed_operation_events_failed_operation_id_fkey -> failed_operations` has no `org_id`                    | **Real:** a foreign key into a tenant table that does not carry the tenant, so a cross-tenant reference is possible. Needs a composite foreign key in a new migration. |
| `companies-schema` (3): `company_briefs` cascades on delete where the test expects the link to be cleared; two more permission keys than the test lists | Test not updated for the briefs and the export and import permissions; the cascade needs an owner decision                                                             |
| `appointments-schema` (1): an `sms` booking template is accepted                                                                                        | Test not updated: SMS became a channel (`20261117090000_sms_channel`)                                                                                                  |
| `waiting-nudge` (1): inserts a `pending` conversation                                                                                                   | Test not updated: `pending` status was removed (`20261222090000`)                                                                                                      |
| `task-outcomes-schema`: cannot start; a default outcome is seeded for every new organisation                                                            | Test not updated                                                                                                                                                       |

Skipped by design (7 files, 50 tests): analytics bench, three catalog-variant files, S3 archive, offsite backup, privacy pipeline. They need object storage or an opt-in flag.

End to end, 136 failures in 53 files after the re-run (list with the first error line of each: `docs/quality/db-suites/e2e-failures.json`):

| Group                                                                                                                          | Count    | Reading                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------- |
| Wallet and wallet-producer files sign up without a phone number and the sign-up now needs a code (`AUTH_OTP_SEND_FAILED`)      | 58       | Test set-up not updated for the registration rules                                                |
| `expected N to be N` in dashboards, automation, setup-run, webhooks                                                            | 9        | Each needs reading; not triaged                                                                   |
| `Cannot read properties of null (reading 'address')` (supertest on a closed server)                                            | 7        | Follows an earlier failure in the same file                                                       |
| Chatbot widget launcher and public config shape                                                                                | 7        | Test expectations behind the code                                                                 |
| `queue.getJobState is not a function` (the tests' fake queue lacks a method the code now calls)                                | 5        | Stale fake                                                                                        |
| Broadcasts pacing and read                                                                                                     | 7        | Timing or drift; not triaged                                                                      |
| Roles and permissions lists (new keys)                                                                                         | 5        | Stale lists                                                                                       |
| WABA calls refused with an invalid token, webhook deliveries that time out, private-address webhook URLs, local-storage upload | about 12 | Need a Meta stub, outbound HTTP to a local stub or object storage, which this machine has none of |
| Other single failures                                                                                                          | about 26 | Not triaged                                                                                       |

The 58 plus the "stale list" groups are failures that exist on `main` today. They were not diagnosed one by one; the counts are by error text, and "reading" is my best explanation, not a finding, except for the foreign key.

## Limits

- The email-domain check was bypassed for the re-run only (this sandbox's DNS answers NXDOMAIN at once for made-up domains); that change is not in the repository.
- Files ran three at a time on four cores. One file (`rate-limiter`) needs a Redis on port 6379, four files read `REDIS_URL`, and three BSP and wallet files need a live database on 5432: the first full integration run missed those and was repeated.
- Skipped tests were not run. The authenticated browser (Playwright) flows were not run: they need the web app and the API up together and were left for a separate step.
