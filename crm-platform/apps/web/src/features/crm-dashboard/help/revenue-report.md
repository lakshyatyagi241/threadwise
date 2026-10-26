---
id: revenue-report
title: Revenue report
summary: What you invoiced, how much is paid and still owed, and the money that came in, split by source, product, owner or team, with CSV and PDF downloads.
area: sales
order: 2
documents: []
routes: [/crm/revenue]
gates:
  planFeature: sales_pipeline
  permission: record.payments.read
keywords: [revenue, invoices, payments, collected, outstanding, overdue, report, export, csv, pdf, currency, tax]
---

## What it is for

The revenue report answers "how much money are we making, and where is it stuck". It reads your invoices and payments for a period you choose and sets them against an earlier period. Open it with the **Revenue report** button on the [CRM dashboard](help:crm-dashboard).

## How to use it

1. Pick a period: this month, last month, this quarter, this year, 30 or 90 days, or a custom range. Days are cut in your own time zone.
2. Choose what to compare with: the previous period, the same period last year, or nothing.
3. Choose how the table is split: by lead source, invoice origin, product, owner or team.
4. Narrow the numbers with the owner, team and currency pickers. The choices stay in the address, so you can share the view.

## Two views that are never mixed

- **Invoiced, paid so far, owed and overdue** count the invoices you **issued** in the period. Drafts, voided invoices and proformas are left out. "Paid so far" is net of refunds, and "owed" and "overdue" are as of today.
- **Collected and refunded** count the money that **came in** during the period, whichever invoice it settled, or none.

The key figures also show four more: collected in the period, collected all time, outstanding (every open invoice as of today, whatever the period) and the tax on invoices that became fully paid in the period.

## What each part shows

- **Key figures**: arrows compare with the comparison period.
- **Invoiced, paid and owed**: one bar for the invoices issued in the period, split into paid, owed and overdue.
- **Invoiced and collected**: per day, week or month, whichever keeps the chart readable.
- **The table**: a total line and the biggest rows first, with the change against the comparison period under invoiced and collected. By product, an invoice is spread over its lines by value, so a discount on the whole invoice or shipping follows the lines. By team, each person counts for their primary team only, so a person on two teams is counted once and people with no primary team are listed under no team.
- **Receivables aging**: open invoices by how long past due, one block per currency.

## Downloading

If your role allows exports you will see **Download this report**. Choose a CSV of the payments (one line per payment and refund of the period), a CSV of the table on screen, or a PDF. The file is prepared in the background with the filters on screen and announced by email. It stays on the page for 7 days, and only you can download it. After that the file is deleted; the page keeps only a line saying it was made. A downloaded file is a temporary copy of your invoices and payments, not a record: if the person who prepared it is removed from the workspace, or a customer is erased under a data request or deleted from the CRM, the unexpired files are deleted at once and you can prepare them again. Your invoices and payments themselves are kept as the law requires.

> A file never holds more than the report shows you. A member whose scope is "own" gets only the invoices they own, in the screen and in the file.

## Good to know

- Money is converted into your workspace currency for the totals. Pick one currency to see its exact amounts instead. A currency with no exchange rate is left out and named.
- The report needs a plan with the sales pipeline, and your role needs the payments read permission. Downloads need the export permission too.
- The PDF is written in English and prints names outside the Latin alphabet as question marks. The CSV has them in full.
