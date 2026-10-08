---
id: sales-orders-overview
title: Sales orders
summary: Turn accepted offers into orders, then invoice them in one go or in parts and record deliveries separately.
area: sales
order: 20
documents: [nav:sales-orders]
keywords: [order, purchase order, fulfilment, delivery, partial invoice, confirm, cancel, accepted proposal]
---

## What it is for

A sales order records what a buyer has agreed to buy. You can invoice it all at once or in parts, and track delivery separately from billing. The list shows each order's buyer, expected date, **Status**, **Invoicing** and **Delivery** progress and total. A strip above the tabs shows the value of open orders per currency.

## How to use it

1. Select **New sales order**. Start from **A blank order** or from **An accepted proposal or estimate**, which brings over its lines, prices and taxes. On an accepted proposal or estimate you can also choose **Create sales order** from its row menu.
2. Fill in the buyer, the currency (fixed once the order exists), an expected date, a reference, the line items, shipping, notes and terms. Select **Create draft**.
3. Select **Confirm order**. Confirming freezes the lines and prices.
4. Select **Invoice...** on the order. Choose **Everything that is left** or **Choose quantities**, then **Create and issue invoice** or **Create draft invoice**. Whatever is not billed stays on the order for the next invoice.
5. Select **Record delivery** when goods are delivered, or **Mark all as delivered** from the row menu. Delivery and invoicing can happen in either order.
6. An order closes when everything on it is invoiced and delivered. Use **Cancel order** if it will not go ahead.

## Options and settings

- **Tabs:** **All**, **Draft**, **Confirmed**, **Cancelled** and **Closed**, with counts. The quick filters **To invoice** and **To fulfil** show confirmed orders that still need billing or delivery.
- **Search and filters:** search by number, buyer or reference, or filter by contact.
- **Row menu:** **Open**, **Edit**, **Confirm order**, **Invoice everything left**, **Mark all as delivered**, **Cancel order** and **Delete draft**, shown only when the order's state and your role allow them.
- **Cancel order** asks for a reason. A cancelled order cannot be invoiced, delivered or reopened.

## Plan and access

The menu entry is not tied to a plan feature. You need permission to see sales orders; without it the screen says so. Creating, editing, invoicing and deleting are separate permissions.

## If something looks wrong

- **You cannot edit lines:** a confirmed order is frozen. Cancel it and start a new one.
- **Cancel is refused:** an invoice from this order is still live. Void or delete that invoice first. A voided invoice gives its quantities back to the order.
- **A quantity is refused:** it is more than what is left on that line.
- **Delete is missing:** only drafts can be deleted. Confirmed orders can only be cancelled.
