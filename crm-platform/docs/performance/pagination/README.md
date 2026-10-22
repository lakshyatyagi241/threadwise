# Pagination optimization

Target: 100% of the critical data paths reviewed, with measurable before and after evidence.

## How to run

| When                   | Command                                                                   | What                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Pull request           | `bash script-testing/pagination/run.sh --quick` (`pnpm audit:pagination`) | tool tests, the audit of every paged list route and every OFFSET in the API, the inventory is current |
| On demand, pre-release | `bash script-testing/pagination/run.sh`                                   | adds a scratch database with a 300,000-recipient campaign and the before/after measurement            |

The audit (`tools/pagination-audit/scan.mjs`) reads every controller query schema and every SQL text. A new OFFSET in the API fails it until it has a decision in `tools/pagination-audit/policy/offset-register.json`. Inventory: `inventory.json`.

## What the audit found

145 paged list routes: 109 page by keyset cursor, 12 by page number, 2 by offset, 22 by a limit only. Every size is capped. 17 OFFSET sites in 15 files (the platform rule is keyset everywhere; these are numbered-page screens kept as they were).

- **Fixed: unbounded page numbers.** Five numbered-page lists accepted any page number (campaign list, campaign recipients, Facebook posts, public storefront home; the admin billing lists already capped it). A request for page 9007199254740991 made the database walk to the end of the table. They now accept pages up to `MAX_PAGE_NUMBER` (100,000, the cap the call log and the coupon list already had).
- **Optimized: campaign recipients.** The page query joined every skipped row to its contact and evaluated the sender column for rows it then discarded. It now finds the page of ids on the recipient table alone and joins the 50 rows shown (same rows, same order; a search still uses the old query because it needs the contact).
- **Accepted, with a reason and an owner, in the register:** call log, campaign wizard contact picker, API Library logs, the platform admin lists and the other numbered-page screens.

## Before and after (campaign recipients, 300,000 recipients, medians of 7 runs, EXPLAIN ANALYZE)

| Page offset | Before   | After  | Faster                                 |
| ----------- | -------- | ------ | -------------------------------------- |
| 0           | 0.4 ms   | 0.9 ms | (same: first page is cheap either way) |
| 1,000       | 4.8 ms   | 1.3 ms | 3.7x                                   |
| 50,000      | 288 ms   | 18 ms  | 16x                                    |
| 150,000     | 1,557 ms | 60 ms  | 26x                                    |
| 299,900     | 1,583 ms | 127 ms | 12.5x                                  |

With a status filter (`delivered`) the deep pages (offsets 150,000 and 299,900) went from about 1.4 to 1.6 seconds to 65 to 68 ms. Every case returned the same rows before and after. Raw numbers: `bench.json`, produced by `tools/pagination-audit/bench.mjs`. The machine was busy with another test run during the measurement; before and after were interleaved, so the ratio holds.

## Critical data paths reviewed

| Path                      | Route                              | Paging                                   | Size cap             | OFFSET      | Verdict                                                                             |
| ------------------------- | ---------------------------------- | ---------------------------------------- | -------------------- | ----------- | ----------------------------------------------------------------------------------- |
| Contacts list             | `GET /v2/contacts`                 | cursor, several sorts, ties broken by id | 200                  | none        | Good. The total is computed only when asked (`includeTotal`)                        |
| Inbox conversations       | `GET /v2/inbox`                    | cursor                                   | 200                  | none        | Good                                                                                |
| Message history           | `GET /v2/message-history`          | cursor                                   | 200                  | none        | Good                                                                                |
| Notifications             | `GET /v2/notifications`            | cursor                                   | 50                   | none        | Good                                                                                |
| Audit and activity log    | `GET /v2/audit-log`                | cursor                                   | 100                  | none        | Good                                                                                |
| Deals (activities, tasks) | `deals.controller`                 | cursor                                   | 200                  | none        | Good                                                                                |
| Tasks                     | `GET /v2/tasks`                    | cursor                                   | 200                  | none        | Good                                                                                |
| Segments, companies       | list routes                        | cursor                                   | 100 to 200           | none        | Good                                                                                |
| Templates                 | `templates`, `email-templates`     | cursor                                   | 100                  | none        | Good                                                                                |
| Wallet ledger, invoices   | list routes                        | cursor                                   | 100 to 200           | none        | Good                                                                                |
| Campaign list             | `GET /v2/campaigns`                | page number                              | fixed                | none in SQL | Page number now capped (was unbounded)                                              |
| **Campaign recipients**   | `GET /v2/campaigns/:id/recipients` | page number                              | fixed 50             | yes         | **Optimized, 12x to 26x on deep pages; page number capped**                         |
| Broadcast summary people  | `broadcast-summary.controller`     | cursor                                   | 100                  | none        | Good                                                                                |
| Call logs                 | `GET /v2/call-logs`                | page number                              | capped, page 100,000 | yes         | Accepted (numbered pages with a total); keyset candidate past about a million calls |
| Campaign wizard contacts  | wizard contact picker              | page number                              | capped               | yes         | Accepted; same page-of-ids-first change is the next step                            |

## Not covered

Authenticated per-tenant data volumes in production, query plans on a production-sized `messages` table, the web screens' own pagination (this reviews the API), and the keyset conversion of the numbered-page screens (a product change).
