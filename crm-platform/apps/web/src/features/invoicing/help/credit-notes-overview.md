---
id: credit-notes-overview
title: Credit notes
summary: Reduce what a customer owes on an issued invoice for returns, price changes or goodwill, as a lower balance or a cash refund.
area: sales
order: 35
documents: [nav:credit-notes]
keywords: [credit note, refund, return, adjustment, correction, goodwill, billing error]
---

## What it is for

A credit note reduces what a customer owes on an issued invoice, for example when goods come back, a price was wrong or you want to give something back. Credit notes lists them all with their invoice, buyer, reason, settlement, total and status. A credit note is a **Draft** until you issue it, then **Issued**, or **Void** if you cancel it.

## How to use it

1. Select **New credit note**, or choose **Create credit note** on an issued invoice, which fills the invoice in for you.
2. Under **Invoice to credit**, search by number or buyer and pick an issued invoice (issued, partly paid, overdue or paid). A draft or void invoice cannot be credited.
3. Under **What to credit**, choose **The whole remaining invoice**, or **Some lines or amounts**: tick lines and set quantities, or add a free-form line with a description, an amount before tax and a tax rate.
4. Pick a **Reason**: **Goods returned**, **Price adjustment**, **Billing error**, **Cancellation**, **Goodwill** or **Other**. The issue date and a note are optional.
5. Under **What happens to the money**, choose **Apply to the invoice balance** (no money moves, the invoice just owes less) or **Refund in cash** (money the customer paid above what is now owed goes back through the [payment ledger](help:payments-overview)).
6. Check the **Estimated credit** panel, then select **Save draft** or **Save and issue**. Issuing gives the credit note its number, lowers the invoice and locks the credit note. The server's saved figures are the final ones.

## Options and settings

- **Tabs and filters:** **All**, **Draft**, **Issued** and **Void**, a search box for number or buyer, a contact filter and a chip that limits the list to one invoice.
- **Row menu:** **Open**, **Edit draft**, **Issue**, **Download PDF** (not for drafts), **Print**, **Void** and **Delete draft**.
- **Void** asks for a reason, and the invoice goes back to what it was before. It is not offered once cash was returned for the credit note.

## Plan and access

The menu entry is not tied to a plan feature. You need permission to see credit notes; without it the screen says so. Creating, issuing, voiding and deleting are separate permissions, and buttons you may not use are hidden.

## If something looks wrong

- **"Credit notes cannot add up to more than the invoice":** lower the amounts, or credit only what is left. The screen shows how much of each line remains.
- **You cannot edit or delete a credit note:** only drafts can be changed or deleted. Void an issued one instead.
- **Void is missing:** cash was returned for this credit note, and that refund stays in the payment ledger.
- **The invoice is not offered:** a credit note can only be made against an issued invoice.
