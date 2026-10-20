# CRM revenue report (`/crm/revenue`)

Reference: `CrmController@revenue`, `@revenueCsv`, `@revenuePdf` (plan feature `access_sales_pipeline`). Code: `apps/api/src/modules/crm/revenue-report`, contract `packages/contracts/src/crm/revenue-report.ts`, screen `apps/web/src/features/crm-dashboard/revenue`. Wiring: [crm-revenue-report.md](../threadwise-port/wiring/crm-revenue-report.md). Parity: [crm-revenue-report.md](../threadwise-port/parity/crm-revenue-report.md).

## `GET /v2/crm/revenue`

Auth: user. Capability `record.payments.read`; its record scope (`own` / `team` / `all`) cuts every number: invoices by owner or creator (a team scope adds the people on the caller's teams), payments by their invoice or the person who recorded them. Plan: `sales_pipeline` (422 `PLAN_FEATURE_LOCKED` otherwise, reads included, like the deals routes). Throttle: 60 per minute per person.

Query (all optional):

| Param               | Meaning                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `range`             | `month` (default, to date), `lastMonth`, `quarter` (to date), `year` (to date), `30d`, `90d`, `custom`                      |
| `from` / `to`       | custom period, `YYYY-MM-DD`, inclusive, at most 366 days; a missing `to` is today, a future `to` is cut to today            |
| `compare`           | `previous` (default), `lastYear`, `none`                                                                                    |
| `groupBy`           | `source` (default: the customer's lead source), `origin` (how the invoice was raised), `product`, `owner`, `team`           |
| `ownerId`, `teamId` | the invoice owner / everyone on a team                                                                                      |
| `currency`          | only invoices and payments in this currency (exact figures of a mixed-currency workspace)                                   |
| `convertTo`         | show everything in one currency; a currency with no exchange rate is named in `unconverted` and no converted total is given |

The period is cut at local midnights in the viewer's zone (`user_profiles.timezone`, else the workspace's, else UTC). `previous` for a calendar range is the same stretch of the previous calendar period (1-15 October against 1-15 September, cut to the shorter month; last month against the month before; quarter and year to date against the same stretch of the previous quarter and year); for `30d`, `90d` and `custom` it is the window of the same length ending the day before. `lastYear` is the same dates one year earlier (29 February becomes 28 February).

Two views, never mixed in one figure:

- **Invoices issued in the period** (by `issue_date`; status `issued`, drafts, voided and proforma documents left out): `invoiced`, `credited` (credit notes), `paid` (so far, net of refunds), `outstanding` (now) and `overdue` (the part whose due date is before today).
- **Money that came in during the period** (by `paid_at`, any invoice or none): `collected` (payments) and `refunded` (refunds, as a positive amount).

Response: `period`, `comparison` (null with `compare=none`), `convertedTo`, `currencies`, `mixedCurrency`, `summary` (`metrics` with `current` and `previous` money totals each; `taxCollected`: tax on invoices that became fully paid in the period; `invoices.issued` and `paidInFull` counts; `receivables`: every open invoice as of today whatever the period, Reference's "Outstanding"; `collectedAllTime`), `rows` (the table: key, label, id, invoice count, the same `metrics`; at most 50, `truncated` says when there were more; the empty key is the row of invoices with no value, such as no source or unassigned), `trend` (invoiced and collected per day, week or month; zero buckets kept) and `aging` (receivables as of today per currency, over the same scope and filters).

Money is a `{ byCurrency: [{ currency, amount }], converted?, unconverted? }` total: exact per currency, decimal strings in major units, never added across currencies.

Splits. `source` reads `contacts.source` through the invoice's contact (a payment with no invoice uses its own contact); `origin` is `invoices.source`; `owner` is `invoices.owner_id`; `team` is the owner's PRIMARY team (`team_members.is_primary`), so a person on two teams counts once and a person with no primary team falls in the empty row; the `teamId` filter keeps the people whose primary team it is (BL-382); `product` spreads each invoice over its lines in proportion to their value (line subtotal less line discount plus added tax), so a document discount, shipping and rounding follow the lines and the rows add up to the invoice to within a minor unit. A line's product is its SKU, else its lower-cased description (lines have no catalog link).

Errors: 404 unknown owner or team, 422 a period over 366 days, 400 bad query, 403 without payments read, 401 unauthenticated.

## Files (`/v2/crm/revenue/exports`)

A file is prepared by the worker (queue `revenue-report-export`), stored gzipped on a `revenue_report_exports` row for 7 days and announced by email with a link to `/crm/revenue?export=<id>`. One at a time per person. A person lists and downloads only their own files.

| Method and path                            | Capability                                 | Notes                                                                                                                                                                                                                                          |
| ------------------------------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v2/crm/revenue/exports`             | `record.payments.export` and payments read | Body: the query above plus `format` (`csv` or `pdf`) and `csvKind` (`payments` default, or `summary`). `Idempotency-Key` required. 202. 409 `REVENUE_EXPORT_IN_PROGRESS`. Audited (`revenue-report-exports` / `export`). Throttle 6 per minute |
| `GET /v2/crm/revenue/exports`              | `record.payments.export`                   | The caller's latest 20, newest first                                                                                                                                                                                                           |
| `GET /v2/crm/revenue/exports/:id/download` | `record.payments.export`                   | The file (`text/csv` or `application/pdf`). 404 `REVENUE_EXPORT_NOT_FOUND` (also for someone else's file), 409 `REVENUE_EXPORT_NOT_READY` (building, failed or expired)                                                                        |

The request fixes the dates (and the comparison window), the viewer's zone and the record scope of the caller's payments read grant; the worker builds the file from those, so it holds no more than the screen showed that person. `payments` is Reference's CSV: Date, Amount, Currency, Method, Source, Invoice, Contact, Company, Reference, then Type, Receipt and Owner, newest first, read in keyset pages of 5,000 (stopped past 200,000 payments with a message on the row). `summary` is the table (a Total line, then one line per row and currency, plus a converted line with `convertTo`). `pdf` is the report as a document (Helvetica, hand-written like the invoice PDF). Cells that start with a formula character are defused.

Permissions: `record.payments.export` (migration `20261215090000`) goes to Owner and Admin by the preset trigger and to Manager through `workspace_preset_baseline`; Agent and Viewer do not get it.
