# Functional scenarios and acceptance criteria (QA task 6)

Every feature in `docs/threadwise-port/inventory/*.md` lists Given/When/Then criteria with a priority. This tooling turns that text into numbers: how many criteria exist, and how many have a test that names them.

## How a test names a criterion

Put one of these in the test title, a `describe` title or a comment:

| Written in the test                                          | Counts as                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `AC-TW-CON-025-1`                                            | criterion 1 of feature TW-CON-025 (stable id)                                              |
| `TW-CON-025 #1`, `TW-CON-025 #1, #2`, `TW-CON-025 #1 and #2` | criteria 1 (and 2) of TW-CON-025                                                           |
| `TW-CON-025` alone                                           | feature-level evidence only: a test exists for the feature, not proof of any one criterion |

Criteria are numbered from 1 in the order they appear under "Acceptance criteria" in the inventory file. Renumbering a file's criteria moves the ids, so add new criteria at the end.

## Commands

```bash
node tools/quality/extract-acceptance.mjs                       # inventory -> docs/quality/acceptance/acceptance.json
node tools/quality/extract-acceptance.mjs --check               # fail when the committed file is stale
node tools/quality/check-acceptance-coverage.mjs --report docs/quality/acceptance/REPORT.md
node tools/quality/check-acceptance-coverage.mjs --min-p0 100   # fail unless every P0 criterion is proven
```

## What the extractor reads

`### TW-XXX-NNN — Title` (also `-` or `:` as the separator), then `- **Status:**`, `- **Priority:**` and the indented list under `- **Acceptance criteria:**`. The campaigns file writes status and priority on one line; that works too. Known exceptions, listed in `acceptance.json`:

- `featuresWithoutCriteria`: features whose entry has no Given/When/Then list (most of `campaigns.md` uses a numbered "Rules" list instead). They are counted as features without criteria, not as covered.
- `groupHeadings`: a heading that covers several features at once (`TW-CAMP-025 to 028`).

## Reading the report

`docs/quality/acceptance/REPORT.md` has the totals by priority and by domain. "Proven" is the only number that shows a criterion is tested. "Feature only" means someone wrote a test for the feature without saying which criterion, which is a prompt to add the `#n`, not a pass.

References to criteria that do not exist (a test says `#7` and the entry has 5) are listed at the end; they are usually a test numbering its own scenarios, and each one should be renamed or the inventory entry extended.

## Closing the gap

Work the report from the top: P0 criteria with no test, then feature-only P0, then P1. For each, write the scenario in `apps/api/test/e2e/<domain>/` with the existing harness and put the id in the title. The target on the sheet is 100% of P0 and P1 criteria with a test; today's figure is in the report.
