# API contract testing (QA task 8)

Proves that what the API sends matches what it says it sends, errors included, and catches a change that breaks a caller before it merges.

## Pieces

| File                                            | What it does                                                                                                                                                                                                                                                                                                                                  | Runs without Docker                                 |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `apps/api/test/support/contract.ts`             | `expectContract(res, schema)` parses a response with the zod schema from `@crm/contracts`; `expectProblem(res, status)` checks the problem+json envelope, an `ERROR_CODES` code, `status` equal to the HTTP status and no stack trace. Both count assertions. `withContractWatch` checks every error of an e2e run when `QA_CONTRACT` is set. | yes (`test/unit/common/contract.spec.ts`, 14 tests) |
| `tools/quality/openapi-diff.mjs`                | Breaking-change check between two OpenAPI documents (removed path, method, response field or success status; new required input; retyped field; lost request enum value). Stand-in for `oasdiff`.                                                                                                                                             | yes (9 tests)                                       |
| `tools/quality/sum-contract-assertions.mjs`     | Adds up the assertions a run recorded, to measure the 5,000 target.                                                                                                                                                                                                                                                                           | yes (2 tests)                                       |
| `apps/api/src/common/openapi.ts`                | `buildOpenApiDocument(app)`: the internal document, now shared by `main.ts` and the tests.                                                                                                                                                                                                                                                    | n/a                                                 |
| `test/e2e/contract/openapi.e2e.spec.ts`         | Route registry (every served route is documented or on `undocumented-routes.json`, which only shrinks); the customer API document is well formed and does not break its committed baseline.                                                                                                                                                   | needs the app                                       |
| `test/e2e/contract/responses.e2e.spec.ts`       | Create, read, list, update for tags, companies and contacts, each response parsed with its schema.                                                                                                                                                                                                                                            | needs the app                                       |
| `test/e2e/contract/error-contracts.e2e.spec.ts` | 401, 403, 404, 409 and 422 per endpoint class, each through `expectProblem`. 429 is not in the matrix.                                                                                                                                                                                                                                        | needs the app                                       |

## Counting

One assertion is the status, plus the content type of an error, plus every leaf value (string, number, boolean, null, empty array) a schema validated. A list of 50 rows with 8 fields is about 400 assertions. The count is honest about what was checked, and it is also easy to inflate by listing more rows, so read it together with the number of distinct routes (`byLabel` in the summary).

```bash
QA_CONTRACT_OUT=/tmp/contract.jsonl pnpm --filter @crm/api exec vitest run test/e2e/contract --testTimeout=120000
node tools/quality/sum-contract-assertions.mjs /tmp/contract.jsonl --min 5000
```

## Watching every existing e2e request

`Api.as(token)` (the shared e2e client) passes each request through `withContractWatch`. It is off by default.

```bash
QA_CONTRACT=1      pnpm --filter @crm/api test:e2e   # record envelope violations, never fail
QA_CONTRACT=strict pnpm --filter @crm/api test:e2e   # a violation fails the test that made the request
```

Only awaited requests are watched; a request ended with `.expect(...)` bypasses it. Requests made with `api.http()` directly (sign-up, login) are not wrapped.

## Breaking changes to the customer API

`/docs/api.json` (`ApiV1DocsService`) is the external contract. `openapi.e2e.spec.ts` compares it with `docs/quality/contract/api-v1.openapi.json`:

```bash
QA_UPDATE=1 pnpm --filter @crm/api exec vitest run test/e2e/contract/openapi.e2e.spec.ts   # refresh baselines on purpose
node tools/quality/openapi-diff.mjs base.json head.json --prefix /api/v1                    # the same check by hand
```

The first run on a checkout with no baseline writes it and passes, so **commit the two files it writes** (`api-v1.openapi.json`, `undocumented-routes.json`); from then on the check is enforced.

## What is not covered

- The e2e specs above have not been run against the app (they need Docker); the helper, the differ and the summing tool have.
- Success responses of most routes: three resources only. Add a row to `RESOURCES` in `responses.e2e.spec.ts`.
- The internal document is built from tagged controllers only, so most of the roughly 1,500 routes start on `undocumented-routes.json`.
- The customer API's own error envelope (`{ error: { code, message } }`) is accepted by `expectProblem` but not checked against its published code list.
