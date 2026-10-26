# Error-state and empty-state catalogues (QA sheet tasks 2 and 3)

Owner: Vishal. Priority P1. Target from the sheet: 100% of applicable modules and features; machine-readable and traceable to tests.

## What is being built

One catalogue per task, for the web app (`apps/web/src/features/*`, 88 features today):

| Task | Catalogue                    | Id                   | Question it answers                                                                                                     |
| ---- | ---------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 2    | `docs/quality/error-states/` | `ES-<feature>-<nnn>` | When a call fails, does the screen say so, keep the user's input and offer a way forward?                               |
| 3    | `docs/quality/empty-states/` | `EM-<feature>-<nnn>` | When there is nothing to show, does the screen say why and offer the next step, with no flash of "empty" while loading? |

It reuses the layout of the API edge-case catalogue (`docs/quality/edge-cases/`): one JSON file per feature, a schema, a checker that fails the build, and a generated `REPORT.md`.

## Definitions

- **Applicable.** A feature is applicable for error states when its code calls the API (`apiFetch`, `useQuery`, `useMutation`). It is applicable for empty states when it shows a collection (an `EmptyState`, a list or table fed by a query). A feature that is not applicable is still listed, with a reason, so "100%" is checkable.
- **Covered.** A case is covered only when a test file exists and its test titles mention the case (a `match` substring, or the case id). A word in a comment or an import does not count.
- **Gap.** The case applies but no test traces it. Gaps are listed, not hidden.
- **Handled in code.** Separate from covered: whether the screen has a branch for the state at all. A state that no screen handles is a product defect, reported to the owner of the feature, not only a missing test.

## Case catalogue

Error states (per applicable feature, a case exists when the feature has the matching surface):

| Key        | Scenario                                                          | Expected                                                                     |
| ---------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| LOAD       | A read fails (5xx or network)                                     | An in-place error with a retry. No blank screen, no crash, no raw stack text |
| FORBIDDEN  | A read or action returns 403                                      | A permission message, no data shown                                          |
| NOTFOUND   | A detail screen opens an id that is gone or not in this workspace | A not-found state, not a blank page                                          |
| MUTATE     | A save, create or delete fails                                    | The error is shown, typed values are kept, the button works again            |
| VALIDATION | The API returns field errors (422)                                | Each error appears on its field                                              |
| CONFLICT   | The row changed under the user (409, `ROW_VERSION_CONFLICT`)      | A reload prompt, no silent overwrite                                         |
| OFFLINE    | The browser is offline or the request times out                   | A retryable message                                                          |

Empty states:

| Key      | Scenario                        | Expected                                                                  |
| -------- | ------------------------------- | ------------------------------------------------------------------------- |
| FIRST    | No rows exist yet               | A title, one line of why, and the primary action                          |
| FILTERED | Filters or search match nothing | "No results" with a way to clear the filters, never the first-use message |
| LOADING  | The list is still loading       | A skeleton or spinner, never the empty state                              |
| SCOPE    | The user's role shows nothing   | Says so, does not look like a broken page                                 |
| ZERO     | A counter or chart has no data  | Shows 0 or a flat chart, never NaN or a blank box                         |

## Steps

1. **Generator and schema** (`tools/quality/state-catalogue.mjs`, `docs/quality/error-states/schema.json`, `docs/quality/empty-states/schema.json`). Reads each feature's source for applicability and code handling, reads web test titles for evidence, writes one JSON per feature and the report. Pure functions with unit tests.
2. **Checker** (`--check`, `--strict`). Fails when a feature has no file, when a case is malformed, when a covered case points at a missing test or a title that does not match, or when the catalogue is out of date. A gap baseline stops the gap count from growing.
3. **Run it and read the result.** Review every "not handled in code" finding by hand before it goes in a report; the generator guesses from source and can be wrong.
4. **Close gaps that matter.** Write real tests, starting with the shared components in `@crm/ui` (`EmptyState`, `Alert`) and the shared error components, then P0 features (auth, contacts, inbox, billing, campaigns).
5. **Wire and document.** `pnpm qa:error-states`, `pnpm qa:empty-states`, a section in `docs/quality/README.md`, and a report in the style of the other QA reports.
6. **Gates.** Format, lint and unit tests on the changed files, the security review gate, then a PR.

## Out of scope

- Fixing every product defect the catalogue finds. They are listed with an owner; fixes go in separate PRs.
- The mobile app (`apps/mobile`) and the partner portal. The same generator can take them later.

## Findings for the feature owners (from the first P0 test pass)

These came from writing the tests. They are product gaps, not missing tests, and nothing here was fixed in this change.

| Feature                  | State           | What the screen does                                                                                                                                                                      |
| ------------------------ | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| broadcasts               | Empty, filtered | `audience-picker.tsx`: a tag, group or consent filter that returns zero contacts shows the first-use text "No contacts yet. Add some", and "Clear filters" sits next to the wrong message |
| broadcasts               | Error, load     | No screen in the feature loads a list, so there is nothing to trace; load errors live in code outside the feature folder                                                                  |
| wallet-message-billing   | Empty, filtered | `admin/logs-page.tsx` and `admin/workspaces-page.tsx` show the first-use empty state when filters match nothing; only the statement page has a filtered message                           |
| workspaces-teams-tenancy | Empty, filtered | Members list shows "No members match this view" with no clear-filters control                                                                                                             |
| roles-permissions        | Empty, filtered | The permissions page shows "No permissions match your search" with no clear control (the roles list has one)                                                                              |
| contact-consent          | Error, load     | The contact consent card and the notice editor show an alert with no retry; only the settings screen has one                                                                              |
| flow-builder-editor      | Error, load     | Any failure in the Google file picker shows the "Google isn't connected" notice, with no retry; the commerce product picker shows the raw error message with no retry                     |
| flow-runtime-engine      | Empty, filtered | The enroll panel's contact search error is plain red text with no retry and no clear-search control; the errors tab empty states have no primary action                                   |
| whatsapp-cloud-api-waba  | Error, load     | The business profile card shows a warning with the error text and no retry                                                                                                                |

Cross-cutting: there is no shared error component. Every feature defines its own `LoadError` or `ErrorLine`, so behaviour (retry, wording, layout) differs from screen to screen.

## Where the numbers stand

Run `pnpm qa:error-states` and `pnpm qa:empty-states`; the reports are `error-states/REPORT.md` and `empty-states/REPORT.md`. Cases listed in `partial.json` count as traced but are marked partial in the feature file, because the test covers only part of the scenario.
