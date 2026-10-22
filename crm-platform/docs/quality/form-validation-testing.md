# Form validation testing (QA task 12)

Target: an automated suite with at least 95% of the P0 and P1 scenarios covered, and zero flaky P0 tests.

## What was added

| Piece                                                                                                                                                 | Where                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Scenario generator and checker: finds every body schema the API binds to a route, reads each field's rules and writes the accept and refuse scenarios | `tools/quality/form-validation.mjs`                                                                             |
| The catalogue it writes (one JSON per module, `REPORT.md`, `baseline.json`)                                                                           | `docs/quality/form-validation/`                                                                                 |
| Suite: 12 tests (generator rules, every real scenario runs as promised, deterministic, coverage floor)                                                | `tools/quality/form-validation.test.mjs`                                                                        |
| Browser suite: the 5 public forms, 77 scenarios                                                                                                       | `apps/web/e2e/form-validation/public-forms.spec.ts`                                                             |
| Commands                                                                                                                                              | `pnpm qa:form-validation` (check and unit tests), `node tools/quality/form-validation.mjs --write` (regenerate) |

## How the scenarios are made

A form can only submit what the API accepts, so the source of truth is the schema the API binds to each body (`@Body(zodPipe(schema))`). For each field the generator writes scenarios from its rules:

| Rule        | Refuse                                                                          | Accept                                       |
| ----------- | ------------------------------------------------------------------------------- | -------------------------------------------- |
| required    | field omitted                                                                   |                                              |
| type        | number for text, text for number, text for list, and so on                      |                                              |
| empty / min | empty text, spaces only (when trimmed), one under the minimum                   | exactly the minimum                          |
| max         | one over the maximum                                                            | exactly the maximum, emoji up to the maximum |
| format      | not an email, not a URL, not a UUID, not a date-time, pattern mismatch          |                                              |
| number      | below the minimum, above the maximum, a fraction where a whole number is needed | the boundary values                          |
| enum        | a value outside the list                                                        | the last listed value                        |
| list size   | one under the minimum, one over the maximum                                     | exactly the maximum                          |
| null        | null where a value is needed                                                    | null where the field is nullable             |

A refusal passes only if the error points at the right field. An accept scenario that another rule refuses (a cross-field or custom check) is not counted as a defect; it moves to "rules not generated" with the reason, so the number stays honest.

Priority: a P0 module (the tier is taken from `docs/quality/edge-cases/<module>.json`) makes every core rule P0. In other modules a core rule on a sensitive field (password, email, phone, amount, price, token, code, URL) is P0, and other core rules are P1 or P2.

## What counts as covered

Coverage = scenarios generated and run / (scenarios + rules the generator could not express). The rules it cannot express are listed and only allowed to shrink (`baseline.json`): cross-field `refine` rules, a maximum on a formatted text (the boundary value must also match the format), a union (only its first option is exercised), a body with no buildable valid sample. Fields that are preprocessed or coerced accept many inputs by design, so no wrong-type scenario applies to them; they are counted separately, not as missing rules.

## Result (21 Oct 2026)

| Layer              | Result                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| Scenario catalogue | 77 modules, 706 body schemas, 15,485 scenarios; every one behaves as promised                          |
| P0 / P1 coverage   | 95.1% / 96.7% (target 95%)                                                                             |
| Schema suite       | 12 tests; 20 consecutive runs (240 executions) all passed; the output is byte-identical between builds |
| Browser suite      | 77 scenarios on the 5 public forms; no product defect found                                            |
| Flaky P0 tests     | zero (see "Flakiness" below)                                                                           |

### Flakiness

A clean repeat run with nothing else running (3 x 77 = 231 executions, no retries, its own output folder): 231 passed, 0 failed, 0 flaky, in 8 minutes.

The first repeat run (3 x 77 = 231 executions) had one failure: Playwright's own trace file vanished (`ENOENT .playwright-artifacts/traces`). Two browser runs were writing to the same `e2e/.results` folder and one deleted the other's artifacts, so it was a collision between my runs, not the test. The same test then passed 30 of 30 in isolation. Give each Playwright run its own `--output` folder when two run at once, and run flake checks with nothing else running.

## Findings

- Four body schemas are defined inside a controller instead of `@crm/contracts` (`auth/clerkSessionSchema`, `auth/partnerLoginSchema`, `bsp-billing-engine/revokeBodySchema`, `marketing-site-cms/categoryBodySchema`). The generator cannot test them, and they break the repo rule that request shapes live in `@crm/contracts`. They are on a known list that only shrinks.

## Run it

```bash
pnpm qa:form-validation                                    # check the catalogue, run the 12 tests
node tools/quality/form-validation.mjs --write             # regenerate after a contract changes
HEADLESS=1 WEB_URL=http://localhost:3001 pnpm --filter @crm/web exec playwright test e2e/form-validation
```

The browser suite needs the production web app (`next build` then `next start`) and, only to render, the API. It never signs in and only submits invalid or incomplete data, so no account is created and no mail is sent.

## Not covered (honest limits)

- The generated scenarios run through the schema, not through a live API. The existing negative sweep (QA task 13, `apps/api/test/e2e/negative`) is the API-level layer.
- The browser suite covers the five public forms. The signed-in forms (contact create, invite, templates, and so on) share the same API rules, but their screens are not driven in the browser here.
- Cross-field rules, patterns and unions are listed as not generated, not tested.
