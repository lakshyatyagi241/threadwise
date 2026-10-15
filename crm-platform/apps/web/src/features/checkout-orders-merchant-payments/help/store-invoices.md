---
id: store-invoices
title: Store invoices
summary: Find the invoices that were created from your store orders, with their status, total and dates, and open any of them in Sales.
area: store
order: 70
documents: [nav:store]
gates:
  permission: record.invoices.read
routes: [/store/invoices]
keywords:
  [
    store invoices,
    order invoice,
    create invoice,
    invoice from order,
    sales,
    paid,
    overdue,
    due date,
    billing,
  ]
---

## What it is for

Invoices is a shortcut into Sales for the invoices that came from store orders. It is not a second invoice list: every invoice here lives in Sales, and every row opens there. Use it to see which of your store orders have been billed and whether they are paid.

## How to use it

1. Open **Invoices** in the Store menu.
2. Read the table: invoice number, buyer, status, total, issue date and due date.
3. Search by invoice number, buyer name or reference, or pick a status to narrow the list.
4. Select the invoice number or **Open in Sales** to open it, where you can send it, record a payment or change it.
5. Select the buyer's name to open their contact. It is a link only when the invoice is linked to a contact.
6. Select **All invoices** to go to the full Sales invoice list.

To create an invoice for a store order, open the order in [Orders](help:store-orders) and select **Create invoice**. It then appears here.

## Options and settings

- **Status:** Draft, Issued, Partially paid, Overdue, Paid and Void. Paid shows green, Overdue and Void red, Issued and Partially paid amber and Draft grey.
- **Total:** shown in the invoice currency.
- **Looking further back:** the list is checked newest first. When a screenful of store invoices is not found in the latest invoices, the page says so and **Load more** looks further back.

## Plan and access

You need permission to view invoices to open this screen. It does not depend on a plan feature. Changing an invoice is done in Sales and follows the Sales permissions.

## If something looks wrong

- **"No invoices from store orders yet".** Open an order and select **Create invoice**. Invoices made by hand in Sales do not appear here.
- **An invoice you expect is missing.** Only invoices created from a store order are listed. Clear the search and status, then use **Load more** if it is offered.
- **Status says Overdue.** The due date has passed and a balance is still open. Open it in Sales to record the payment.
- **The list could not be loaded.** Select **Try again**.
