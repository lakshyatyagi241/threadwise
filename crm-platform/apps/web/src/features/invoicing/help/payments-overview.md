---
id: payments-overview
title: Payments
summary: See money received and refunded, record a payment against an invoice, and follow what is owed by lateness or by contact.
area: sales
order: 40
documents: [nav:payments]
keywords: [payment, receipt, refund, ledger, aging, outstanding, owed, collected, overdue, balance]
---

## What it is for

Payments shows the money side of your invoices in three views: **Ledger** (every payment and refund), **Aging** (what is owed, grouped by how late it is) and **Owed by contact** (each contact's open balance). In the **At a glance** panel, **Collected** and **Refunded** cover the last 7, 30 or 90 days of your choice, while **Outstanding** and **Overdue** show what is owed right now, one row per currency.

## How to use it

1. Select **Record payment**, then search for the invoice that was paid. Only issued, partly paid and overdue invoices with a balance are offered.
2. Check the amount. It starts as the balance due, so lower it for a part payment. Pick the **Method** (Cash, Bank transfer, Card, UPI, Cheque or Other), set **Paid on**, and add a **Reference** such as a transaction ID and a **Note** if you like.
3. Select **Record payment**. If the amount is more than the balance, press the button again to confirm: the extra is recorded as a credit on the invoice.
4. To give money back, open the row menu on a payment and choose **Refund**. Enter the amount (up to what is left to refund), the date and a reason. The invoice then owes the refunded amount again.
5. Choose **View receipt** on any row to see the receipt and print it.

You can also record a payment from the invoice itself. See [Invoices](help:invoices-overview).

## Options and settings

- **Ledger filters:** search by reference, receipt or invoice, then narrow by **Entry type** (payments or refunds), **Method**, currency, contact and a paid-from and paid-to date range. **Clear filters** resets them.
- **Aging** groups unpaid invoices into **Not yet due**, **1-30 days late**, **31-60 days late**, **61-90 days late** and **Over 90 days late**. Lateness counts from the due date.
- **Owed by contact** lists each contact's outstanding and overdue amounts, the number of invoices and the oldest due date. The **Only overdue** switch narrows it.
- Amounts in different currencies are never added together. Use the currency filter to look at one.

## Plan and access

The menu entry is not tied to a plan feature. **Record payment** and **Refund** each need their own permission and are hidden without it.

## If something looks wrong

- **A payment is missing:** check the entry type, method and date filters, then **Clear filters** and **Load more**.
- **There is no Refund on a row:** only a payment with an amount left can be refunded, and a refund cannot itself be refunded.
- **The invoice you want is not offered:** drafts, paid and void invoices have nothing left to pay.
- **The date is refused:** a payment date cannot be in the future.
