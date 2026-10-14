# Unit testing and coverage (QA task 5)

Fast tests of single functions and classes, plus a coverage gate on the business logic they can reach without a database.

## Run it

```bash
pnpm --filter @crm/api test:coverage          # API unit tests + coverage + the floors below
pnpm --filter @crm/web test:coverage          # web unit tests + coverage of every lib/
pnpm --filter @crm/web test                    # web unit tests (generates the registries first)
node tools/quality/collect-metrics.mjs --suite api-unit=<vitest json> --suite web-unit=<vitest json> --coverage apps/api/coverage/coverage-summary.json
```

Packages used to load only after `pnpm install`, which stops on one GitHub-hosted dependency in some environments (`libsignal`); on such a
machine the 32 test files that import `baileys` cannot load, and that is the machine, not the code.

## What was broken, and fixed

| Finding                                                                                        | Effect                                                                                                                  | Fix                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@vitest/coverage-v8` was `^5.0.3` while vitest is `2.1.9`                                     | `--coverage` stopped with "does not provide an export named BaseCoverageProvider": coverage had never produced a number | `^2.1.9` in `apps/api`, added to `apps/web`; lockfile changed only for that package                                                                                                                                                                                                        |
| vitest writes no coverage report when any test fails                                           | one failing test hid the whole baseline (a 17-minute run produced nothing)                                              | `reportOnFailure: true`                                                                                                                                                                                                                                                                    |
| Two API unit tests failed on `main`                                                            | red baseline                                                                                                            | `web-push-enqueue` expected the old list of push-on notification types (BL-112 added `assignment_blocked_by_leave`, push on, "a customer is waiting"); `integrations-nodes` needed more than 5 s for the runaway-allocation test on a machine that does not enforce the memory cap quickly |
| `@crm/contracts` has no tests of its own and 84 exported logic functions were named in no test | nothing pinned queries, wallet normalisers, coupon messages, recurrence, segment rules                                  | 118 tests in `apps/api/test/unit/contracts/` (22 functions)                                                                                                                                                                                                                                |
| `formatScaled(-5n, 4)` returned `"0.00-5"`                                                     | a small negative quantity or amount would print wrong; not reachable from the parser today                              | sign handled; test added                                                                                                                                                                                                                                                                   |

## The first measurement (14 Oct 2026)

|                                 |  Tests run | Passed | Notes                                                                                               |
| ------------------------------- | ---------: | -----: | --------------------------------------------------------------------------------------------------- |
| API unit (`apps/api/test/unit`) |      8,849 |  8,845 | the two failures above, since fixed; `it.each` rows are counted                                     |
| Web unit (`apps/web/src`)       |      9,481 |  9,480 | one skipped; `pnpm test` generates the registries first, a bare `vitest` run cannot load nine files |
| **Total**                       | **18,330** |        | **target 30,000 (61%)**; 67 more were added after this run (coupon, subscription, invoice)          |

Coverage of the API by kind of code (lines / branches):

| Kind                                               | Files | Lines | Branches | Gate (floor)                    |
| -------------------------------------------------- | ----: | ----: | -------: | ------------------------------- |
| Rules (`*-rules.ts`, `*.rules.ts`): pure decisions |   123 | 97.8% |    91.9% | 95% / 88%                       |
| Common (`src/common`)                              |    20 | 81.4% |    85.9% | 78% / 82%                       |
| Mappers (`*.mapper.ts`)                            |    68 | 34.4% |    77.0% | 30% / 70%                       |
| Workers (processors, consumers, jobs)              |    99 | 18.9% |    75.2% | not gated                       |
| Services                                           |   640 | 10.4% |    75.0% | not gated: they need a database |
| Repositories                                       |   154 | 12.8% |    48.9% | not gated: they need a database |
| Everything else                                    |   816 | 66.7% |    83.5% | not gated                       |

**Against the sheet's target of 85% lines and 80% branches on business logic:** the pure rule modules are above it. Common is below on lines (81.4%).
Mappers are far below (34.4%) and are the next place to spend tests. Services and repositories are covered by the e2e and integration suites,
which this measurement does not include, so a single number for "business logic" would be misleading; the table is the honest form.

## Where to add tests next (uncovered lines, from the same run)

- Mappers: `crm/invoicing/invoices.mapper.ts` (214 lines uncovered; `amountsOf` now has tests), `marketplace.mapper.ts` (189), `sales-docs.mapper.ts` (171),
  `appointments-booking.mapper.ts` (164), `forms.mapper.ts` (135), `products.mapper.ts` (91).
- Common: `leave-owner-pool.ts` (40), `workspace-calendar.ts` (33), `request-context.middleware.ts` (18).
- Rules: `campaigns/campaign-rules.ts` (45 uncovered at 88%), `marketing-site-cms/cms-rules.ts` (19).
  The two weakest rule files, `coupon-rules.ts` (9%) and `subscription-rules.ts` (25%), now have tests.

## The floors

`apps/api/vitest.config.ts` sets `coverage.thresholds` per glob a little under the measurement above, so nothing slips back. They fail a **full**
`test:coverage` run, not a run of one file (a single file never reaches them). Raise them as tests land; do not lower them to get green.

## What this does not show

- The 30,000-test target is not met (61%). Generating the rest from the zod schemas was considered and rejected: a test that asserts the
  schema rejects what the schema rejects checks zod, not the product. The honest way up is more tests of real decisions, starting with the lists above.
- Line coverage is measured by v8, which counts a line as covered when it ran, not when its result was checked.
- Components render to a string in the web tests, so they are exercised but excluded from the web coverage scope (`src/**/lib/**`).
