# Comparison rules

How two observations become a finding, and what each finding means.

## Principles

1. **Reference is the oracle, not the spec.** The twin run does not decide what _should_ happen; it records what each app _does_ and reports where they differ. A difference is a defect until it is explained by an architecture rule or a recorded `QUIRK` decision.
2. **Copy is never compared.** We must not reproduce Reference's wording (the repo's no-copy rule), so text differences are information, not defects. What is compared is behaviour and structure: was it accepted, which field was flagged, what was stored, was feedback shown, where did focus go.
3. **No pixel diffs.** Our screens must not look like Reference's. Visual comparison is structural (counts, kinds, states) plus side-by-side screenshots (`gallery.html`, `shots/`) that a person or the orchestrating model looks at for the `review` items.
4. **The comparator must be trusted before it is believed.** `parity.sh selftest` runs Reference against itself (must report zero defects) and against copies with planted defects (must report each one). Run it after any change to the harness.

## Result classes

| Result       | Meaning                                                                           | What to do                                                                    |
| ------------ | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `same`       | equivalent behaviour                                                              | nothing                                                                       |
| `intended`   | differs on purpose: an architecture rule (automatic) or a spec `intended[]` entry | nothing; the reason and reference appear in the report                        |
| `defect`     | differs, no explanation                                                           | fix it (sub-agent), or explain it in `intended[]` if the repo decided it      |
| `review`     | structure differs (`ui.*`): counts, columns, nav style                            | look at the screenshots; decide defect (missing element), intended, or ignore |
| `info`       | recorded only (copy, data-dependent values, "not applicable on one side")         | nothing                                                                       |
| `skipped`    | the spec skipped it, or a side had no steps for it                                | make sure the reason is real                                                  |
| `spec-issue` | the scenario failed on Reference too, or on both sides                            | the spec is wrong (locator, step): fix the spec, never the app                |

A scenario that works on Reference and fails on ours with a missing element/screen is a `defect` of kind `missing`: either the thing does not exist in our app (build it) or the spec's locator for ours is wrong (check with `explore.mjs ours <path>` before building anything).

## Comparators by key prefix

| Prefix                                                                                                                                                                                                           | Rule                                                                                                                       | Severity when it differs |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `flag.accepted`, `enum.outcome` (accepted/rejected/crash)                                                                                                                                                        | equal                                                                                                                      | blocker                  |
| `status.load`                                                                                                                                                                                                    | equal class                                                                                                                | blocker                  |
| `status.*`                                                                                                                                                                                                       | equal HTTP **class** (ok, rejected, unauthenticated, forbidden, not-found, conflict, throttled, crash); 302 vs 201 is fine | major                    |
| `sec.*`                                                                                                                                                                                                          | `true` is a violation on ours, Reference irrelevant                                                                        | blocker                  |
| `low.pageErrors`, `low.http5xx`                                                                                                                                                                                  | ours must not have more                                                                                                    | blocker                  |
| `low.failedRequests`, `low.brokenImages`, `low.keyboard.trap`, `low.degraded.*`, `low.a11y.critical/serious`                                                                                                     | ours must not have more                                                                                                    | major                    |
| `low.consoleErrors`, `low.http4xx`, `low.overflowX.*`, `low.unnamedInteractive`, `low.smallTargets.*`, `low.a11y.moderate/minor`                                                                                 | ours must not have more                                                                                                    | minor                    |
| `lowset.a11y.rules`                                                                                                                                                                                              | rule ids ours has and Reference lacks                                                                                      | minor                    |
| `set.flaggedFields`, `flag.field.*.present`, `flag.valueKept`, `flag.formLevelError`, `map.stored`                                                                                                               | equal                                                                                                                      | major                    |
| `abs.errorFeedbackOnServerFailure`, `abs.valueKeptOnServerFailure`, `abs.submitUsableAfterFailure`, `abs.degraded.errorShown`, `abs.keyboard.reachable`, `abs.submitGuardedWhileSending`, `abs.field.*.labelled` | ours at least as good as Reference                                                                                         | major                    |
| other `abs.*` (focus quality, progress shown, session expiry quality)                                                                                                                                            | ours at least as good                                                                                                      | minor                    |
| `perf.*`                                                                                                                                                                                                         | ours within 2.5x and 800 ms of Reference                                                                                   | minor                    |
| other `flag.* enum.* num.* set.* seq.*`                                                                                                                                                                          | equal                                                                                                                      | minor                    |
| `ui.*`                                                                                                                                                                                                           | equal, else `review`; a key missing on either side is `info`                                                               | (review)                 |
| `info.*`                                                                                                                                                                                                         | never compared                                                                                                             | -                        |

Override a severity per feature with `severity: { 'ui.table.0.columns': 'major' }`. A `ui.*` key listed there becomes a failing difference for that feature, which is how you turn "the contacts table has 4 columns, Reference has 8" from a review note into a defect once the inventory says those columns are required.

Data-dependent structure is skipped: table row actions and checkbox columns are only recorded when the table has rows, so a Reference screen with no data does not fail ours for having some.

## Intended deviations

Automatic (matched on the key, with the rule id and reference in the report), from `lib/intended.mjs`:

| Rule                 | Matches                                        | Why it is allowed                                            |
| -------------------- | ---------------------------------------------- | ------------------------------------------------------------ |
| `cursor-pagination`  | `ui.pagination.*`, fewer sortable headers      | cursor "load more", server-side filters, no totals           |
| `uuid-ids`           | `enum.idStyle`                                 | CONTRIBUTING 4: internal ids never leave the system          |
| `problem-json`       | `enum.errorFormat`                             | errors are problem+json with a stable code                   |
| `hard-delete-audit`  | `enum.deleteMode`, `flag.restorable`           | hard delete + audit instead of soft delete                   |
| `optimistic-locking` | `enum.concurrentEdit`                          | stale writes get 409                                         |
| `tenant-404`         | `enum.crossTenant` = not-found                 | another tenant's row is indistinguishable from a missing row |
| `idempotency-key`    | `double-submit` request/row counts, ours lower | repeated submits are replayed                                |
| `permission-keys`    | `enum.permissionModel`                         | permission keys instead of role names                        |

Everything else needs an `intended[]` entry in the spec with a reason and, for a deliberate fix of a Reference bug, the `quirk`. Adding a rule to `lib/intended.mjs` is for decisions the repo has already made in CONTRIBUTING, never to make a finding go away.

## Known comparability limits (say so in the report)

- Anything that needs a live provider session (WhatsApp QR pairing, real sends, gateway callbacks) cannot be compared live.
- Datasets differ between the apps: list scenarios compare behaviour, not counts.
- Server-rendered Reference pages and a client-rendered app react differently to "data requests fail": a page without data requests on load reports `not applicable`, not a failure.
- Reference's own accessibility and performance are the baseline. Ours may be better; it must not be worse.
