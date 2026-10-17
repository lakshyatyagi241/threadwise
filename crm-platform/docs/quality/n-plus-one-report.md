# N+1 query report (QA task 43)

Run: `pnpm qa 43` on 2026-10-15. Owner: Punya. The run flagged **40** database or repository calls awaited inside a loop. Each was read in
the code and classified. This file is the durable record; the generated report (`reports/qa-suite/latest/report.html`) is git-ignored and
local to whoever ran it, so regenerate it with `pnpm qa 43`.

## Where QA reports live

| Report                             | Location                                                                                                    | In git                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Live `pnpm qa` output              | `crm-platform/reports/qa-suite/<timestamp>/` and `.../latest/` (`report.html`, `report.md`, `results.json`) | No (`.gitignore`: `reports/qa-suite/`) |
| Reviewed exceptions (with reasons) | `tools/qa-suite/data/baseline.json`                                                                         | Yes                                    |
| Written reports and findings       | `docs/quality/` (this file, phase reports, security batch)                                                  | Yes                                    |

## Result

| Outcome                                  | Count | Notes                                                            |
| ---------------------------------------- | ----: | ---------------------------------------------------------------- |
| Fixed                                    |     8 | Real N+1, now one query (or one per workspace)                   |
| Reviewed, not a per-item database lookup |    20 | Baselined with a written reason in `data/baseline.json`          |
| Still open                               |    12 | Need a design decision or a behavior-preserving batch; see below |

Task 43 reports **13 unreviewed findings, down from 40**. The check still fails until those are fixed or reviewed.

## Fixed

| Where                                                                  | Before                                                                     | After                                                                                            |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `ContactsService.forEachRowIsolated` (bulk assign, bulk update)        | 1 SELECT per id, up to `BULK_IDS_MAX` = 5000                               | 1 query (`idsByUuid`); 500 ids: 500 -> 1                                                         |
| `FaqService.bulk` delete / pause / resume                              | 1 `findById` per entry (2 loops)                                           | 1 query (`findByIds`)                                                                            |
| Field section reorder (`field-sections.service.ts`)                    | 1 SELECT per id in the ordered list                                        | 1 query (`findByUuids`)                                                                          |
| Field option reorder (`fields.service.ts`)                             | 1 SELECT per id                                                            | 1 query (`findByUuids`)                                                                          |
| Status option reorder (`status-options.service.ts`)                    | 1 SELECT per id                                                            | 1 query (`findByUuids`)                                                                          |
| Campaign sweeper stalled-campaign scan (`campaign-sweeper.service.ts`) | 1 settings read per stalled campaign (up to 100)                           | 1 per workspace, memoised for the sweep                                                          |
| Meta catalog import (`catalog-sync.service.ts`, update 2026-10-17)     | 2 reads per listed product (product by retailer id, then its variants): 2N | 2 reads for the whole listing (`findByRetailerIds`, one `withVariants`); 12,000 ids in 3 queries |

Every fix keeps the old per-row checks: a missing or foreign id still fails with the same not-found error naming that id, and the bulk
helper still isolates each row in its own savepoint. Evidence: unit specs `test/unit/contacts-attributes-tags/bulk-row-lookup.spec.ts`
and `test/unit/crm/reorder-lookup.spec.ts` assert the lookup count and the error behavior.

## Reviewed, not a defect (baselined)

| Pattern                                                                                            | Why it is not an N+1                                                 |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Gmail `listHistory` / `listMessages`, template `remote.list`, v1 templates and contact-groups list | Pagination: each call needs the cursor from the previous page        |
| Gmail `getMessage` per new message                                                                 | External HTTP, bounded by `maxMessages`; not a database query        |
| `remote-runner` `jobs.read`                                                                        | A poll loop with a sleep, not a per-item lookup                      |
| `scheduled-due` `queue.getJob`                                                                     | One Redis lookup per stale row, bounded by `BATCH`, background sweep |
| v1 contacts / deals update, API key create, sheets contact upsert                                  | Optimistic-lock or collision retry loops: one read per attempt       |
| Appointment lifecycle sweep                                                                        | The per-row read is the `FOR UPDATE` lock with a re-check under it   |
| Recurring invoices catch-up                                                                        | Must re-read the profile for the advanced next-run date; bounded     |
| Segment actions, segment count sweep                                                               | One segment per chunk or transaction by design                       |
| Campaign sweeper retry scan                                                                        | One campaign per distinct pair, `LIMIT 25`                           |
| Growth enrichment                                                                                  | One external HTTP call per candidate, bounded batch                  |
| Support playbooks `resolveAgent`                                                                   | One small lookup per playbook step                                   |
| Demo calls CLI                                                                                     | Developer seed script, not a request or worker path                  |

## Still open (12 as of 2026-10-15, plus loops other changes have added since)

These are real loops that run a query per item. They were left alone on purpose: each carries behavior (plan caps, audit, create on miss,
side effects) that a quick batch could change. Proposed approach for each:

| Where                                                  | Why it is open                                                                      | Proposed fix                                                                                      |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `campaigns/audience.service.ts:65` (per number)        | `resolveOrCreateByIdentity` per recipient plus `mergeAttributes`; thousands of rows | Batch the "already a contact" lookup by phone; keep create-on-miss, plan cap and audit per number |
| `campaigns/wizard/wizard-audience.service.ts:354` (x2) | `findOrCreateByPhone` per CSV row                                                   | Same as above                                                                                     |
| `campaigns/wizard/wizard-audience.service.ts:116`      | `segmentsRepo.findByUuid` per selected segment                                      | `findByUuids` (few segments, low value)                                                           |
| `whatsapp-cloud-api-waba/waba-ingest.service.ts:415`   | `resolveOrCreateByIdentity` per contact in a webhook batch (tiny N)                 | Leave unless batches grow; document                                                               |
| `crm/contact-import/contact-import.engine.ts:217, 247` | Group and tag lookup per distinct name (bounded by distinct names, not rows)        | `findByNames` for groups and tags, create the missing ones                                        |
| `forms-builder/form-submit.service.ts:822`             | `tags.findByName` per tag on a public form submission (few tags)                    | `findByNames`, then create the missing ones under the plan cap                                    |
| `crm/pipelines/pipelines.service.ts:520`               | `dealsRepo.findById` plus `minOrder` per deal when moving a stage's deals           | Batch the reads; `changeStage` stays per deal                                                     |
| `notifications/*-notification.consumer.ts` (x3)        | `publisher.read` per user whose rows were cleared                                   | Check what `read` costs; batch by user if it is a database write                                  |

## Not covered

- `n1-serial-write` (140 warnings: awaited writes in loops) was not reviewed; many are inherent per-row audit/outbox writes.
- No fix here was exercised against a database. The unit specs stub the repositories; the new SQL (`IN (...)` by uuid or id) is covered by the e2e stack.
- The detector is a pattern match on `await <repo call>` inside a loop. It cannot see ORM lazy loading or N+1 across function boundaries.
