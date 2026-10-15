# CRM revenue report parity (reference `/crm/revenue`)

Reference: `CrmController@revenue`, `@revenueCsv`, `@revenuePdf`, views `user/crm/revenue.blade.php` and `revenue_pdf.blade.php`, copilot tool `revenue_report` (`CrmToolkit`). Inventory: TW-PAY-017, TW-INV-028. Wiring: [crm-revenue-report.md](../wiring/crm-revenue-report.md). API: [crm-revenue.md](../../api/crm-revenue.md).

## Same

- The four figures at the top, in Reference's order: collected in the period (Reference: 30 days), collected all time, outstanding (every open invoice as of today, whatever the period) and tax collected.
- Collected over time (Reference: the last six months; here per day, week or month of the chosen period, so a year gives twelve months), the receivables aging box (Reference buckets 0-30, 31-60, 61-90, 90+; here not yet due, 1-30, 31-60, 61-90, 90+ days past due, the same table the payment ledger's aging report uses) and the paid / open invoice counts.
- The payment ledger CSV with Reference's nine columns in its order: Date, Amount, Currency, Method, Source, Invoice, Contact, Company, Reference; and a PDF of the report with the same blocks (key figures, collected by month, aging, invoice counts).
- Plan gate: `sales_pipeline` (Reference `access_sales_pipeline`), reads included.
- A mixed-currency warning where more than one currency is present.
- The "Revenue report" button on the CRM dashboard.

## Intended differences

1. **Money is exact per currency** and converted only into one currency on request and when every rate is known (`convertTo`); a currency with no rate is named. Reference summed minor units of every currency under one symbol and printed a warning (D-05, same rule as the CRM dashboard).
2. **Period and comparison** (new): this month, last month, quarter, year, 30 or 90 days or custom, cut in the viewer's zone; compared with the previous period (the same stretch of the previous calendar period for calendar ranges, the window right before for rolling ones), the same dates last year, or nothing. Reference had fixed windows.
3. **Invoiced against paid against outstanding** (new): the invoices issued in the period (drafts, voided and proformas left out) with what has been paid and what is owed and overdue today; kept apart from the cash view (collected and refunded in the period) so no number mixes the two.
4. **Split table** (new) by lead source (the customer's source), invoice origin, product, owner or team, biggest first, with the totals row. By product an invoice is spread over its lines by value (document discount, shipping and rounding follow the lines, so rows add up to within a minor unit); by team a person on two teams counts in both; the lines carry no catalog link, so a product is a SKU, else the line description.
5. **Record scopes**: every number and every file honours the caller's `own` / `team` / `all` scope of `record.payments.read` (invoices by owner or creator, payments by their invoice or the person who recorded them). Reference showed the whole workspace to any user on the plan.
6. **Files are prepared by the worker** (queue `revenue-report-export`), kept 7 days, announced by email and listed on the page; the permission `record.payments.export` is separate from reading. Reference built the CSV and PDF inside the request, capped the CSV at the last 5,000 payments and had no permission beyond the plan. The CSV here reads the chosen period (up to 200,000 payments) instead of "the last 5,000"; two more columns follow Reference's nine: Type (a refund is a negative line) and Receipt and Owner. A second CSV is the table on screen. File names follow the period (`revenue-payments-<from>_<to>.csv`, Reference: `revenue-<date>.csv`).
7. **PDF** is written by hand like the invoice PDF (no PDF library, no network): Helvetica, so a name outside Windows-1252 prints as a question mark (BL-185). The workspace name replaces the product brand name in the title.
8. **Tax collected** is the tax on invoices that became fully paid in the period (Reference: every paid invoice ever, currencies mixed).
9. **Default currency**: Reference read `invoice_settings.currency`, which does not exist, and so always printed USD symbols. Here amounts carry their own currency.
10. **Dates** are the viewer's calendar days (Reference: the server zone), and refunds exist (Reference had none; they come off the ledger as negative lines and are shown as "Refunded").
11. The Reference page printed the generated time and had no filters; this one keeps its filters in the address and takes them into the files.

## Not built here

- The AI copilot tool `revenue_report` (the copilot is not built, BL-186).
- Drill-down from a row into the matching invoices or payments (those lists have no owner, source or product filter in their address, BL-184).

## Not verified

- No browser run in this session: no visual check, no RTL, mobile or dark layout, no side-by-side with the running Reference (BL-187). Render tests cover English and Arabic text only.
- The PDF was rendered to bytes and checked structurally (well-formed, text present); it was not opened in a PDF viewer.
- Translations of the 20 non-English locales are machine drafts and have not been reviewed by a native speaker.
- Performance on a large workspace (hundreds of thousands of invoices) was not measured; the queries are grouped and use the new partial indexes, but no `EXPLAIN` on large data was run.
