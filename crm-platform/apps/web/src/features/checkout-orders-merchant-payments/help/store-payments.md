---
id: store-payments
title: Store payments
summary: See what is paid, awaiting payment and cash on delivery across your store orders, and set up WhatsApp Pay in chat for India.
area: store
order: 50
documents: [nav:store]
gates:
  permission: store.payments.view
keywords: [payments, paid, awaiting payment, cash on delivery, collected, reference, whatsapp pay, direct pay method, razorpay, payu, billdesk, zaakpay]
routes: [/store/payments]
---

## What it is for

Payments is the money side of your store orders. At the top you see how many orders are paid, awaiting payment, cash on delivery or unpaid, and how much has been collected in each currency. Below that is a list of every order's payment, and a section where you set up WhatsApp Pay so buyers can pay inside the chat.

## How to use it

1. Open **Payments** from the store sidebar. The tiles show counts by payment state and the money collected so far.
2. Narrow the list with **Search** (order number, customer or reference), **Status**, **Method** and a **From** and **To** date. The filters stay in the address, so you can bookmark or share a filtered list. **Reset filters** brings everything back.
3. For **Method**, choose Prepaid, Cash on delivery or **A gateway...** and type its code, for example `razorpay`.
4. Select an order number to open the order.
5. Select **Load more** under the list to see older payments.

To let buyers pay inside WhatsApp (India only):

1. In WhatsApp Manager, under Payments for India, create a **Direct Pay Method** and link your Razorpay, PayU, BillDesk or Zaakpay account. This step happens on Meta's side and cannot be done from here.
2. Under **WhatsApp Pay in chat**, enter the same **Configuration name**, choose its gateway and select **Save configuration**. The name must match exactly.
3. Turn on **Auto-charge new orders** if the pay request should be sent the moment an order is placed.
4. Use **Edit** to change a configuration, or **Remove** and confirm to delete it.

## Options and settings

- **Columns:** order, customer, status, method, paid via, reference (the provider's payment id when one was recorded), amount, shop and date.
- **Payment states:** Paid, Awaiting payment (a link was sent), Cash on delivery and Unpaid.
- **Date range:** if the start date is after the end date, the range is ignored and the screen tells you.
- **WhatsApp Pay is India only.** Country and currency are fixed to India and INR, because Meta supports it only there. Outside India, send a payment link from an order instead, which uses your [Payment gateways](help:store-gateways).
- **Names are the key.** Saving a name that already exists updates that configuration. To rename one, remove it and add it again.

## Plan and access

You need permission to view payments to open this screen and see everything on it. Adding, editing and removing WhatsApp Pay configurations need the manage permission; without it you see the list but the form and the buttons are hidden.

## If something looks wrong

- **The list is empty:** a payment appears here when a store order is placed. If you set filters, select **Reset filters**.
- **An order is stuck on Awaiting payment:** the buyer has not paid the link yet, or the gateway's webhook is not set up. Check **Payment gateways**.
- **A WhatsApp Pay configuration does nothing:** its name probably does not match the Direct Pay Method name in WhatsApp Manager. Remove it and add it again with the exact name.
- **The list could not be loaded:** select **Try again**.
