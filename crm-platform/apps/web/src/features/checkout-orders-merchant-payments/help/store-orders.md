---
id: store-orders
title: Store orders
summary: See every order from your storefront and WhatsApp, move it through its statuses, send payment links and turn it into an invoice.
area: store
order: 20
documents: [nav:store-orders]
keywords:
  [
    orders,
    order status,
    payment link,
    checkout link,
    invoice,
    cash on delivery,
    storefront,
    whatsapp order,
  ]
---

## What it is for

Orders lists every order your store has received, from every channel: WhatsApp, the storefront, Twilio, Shopify, WooCommerce and orders added by hand. Open an order to see what was bought, who bought it, where it goes, what has happened to it and what has been paid.

## How to use it

1. Open **Orders**. The tabs at the top show how many orders are in each status. Select a tab to see only those orders.
2. Narrow the list with the search box (phone, name or order number), the source, the payment status and a date range. The filters stay in the address, so you can bookmark or share a filtered list. **Clear filters** brings everything back.
3. Change a status straight from the list with the status menu on a row. Marking an order **Completed** or **Cancelled** asks you to confirm first.
4. Select an order number to open it.
5. In the order, use **Update status** to choose any status, add a note and, if you have one, a payment link. Select **Save changes**. The buyer is messaged when the status changes or a new link is added, and the screen tells you whether that message went out.
6. To collect payment online, use **Generate link and send** under **Payment link**. It creates a pay link on your payment gateway and sends it to the buyer on WhatsApp. If you already have a link, paste it into **Send a link you already have** instead.
7. Select **Create invoice** to turn the order into an invoice and a sales order. Once they exist, the card gives you links to both.

## Options and settings

- **Statuses:** New, Pending, Confirmed, Paid, Processing, Completed, Shipped and Cancelled. You can move an order to any status; there is no fixed order.
- **Payment:** Paid, Awaiting payment (a link was sent), Cash on delivery, or Unpaid.
- **Shop filter:** shown only when your workspace has two or more shops.
- **Customer:** if the buyer is already a contact, **View contact** opens their record.
- **Return-to-origin risk:** cash-on-delivery orders can show a risk band and score.
- **Delete order:** removes the order for good and cannot be undone.

## Plan and access

Orders needs a plan that includes the storefront. You need permission to view orders to open the screen. Changing a status, sending links and creating an invoice need the manage permission; deleting needs the delete permission. Without them those controls are hidden and the order is read-only.

## If something looks wrong

- **No payment gateway set up:** a payment gateway has to be set up before you can generate a checkout link. Select **Set up a gateway** and add your keys.
- **The link was saved but not sent:** nothing could message the buyer, for example the order has no phone number or no WhatsApp number is connected. Copy the link and share it yourself.
- **Changed by someone else:** the order was edited while you had it open. Select **Reload order** and try again.
- **A list says nothing matches:** a filter or date range is hiding the orders. Select **Clear filters**.
- **The list could not be loaded:** select **Try again**.
