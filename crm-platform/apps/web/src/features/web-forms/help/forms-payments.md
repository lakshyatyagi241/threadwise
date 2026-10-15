---
id: forms-payments
title: Taking payment on a form
summary: Charge visitors on your payment gateway when they submit a form, and follow each payment in the submissions screen.
area: campaigns
order: 18
documents: []
gates:
  planFeature: form_builder
keywords: [payment, gateway, razorpay, stripe, price, amount, donation, awaiting payment, paid]
---

## What it is for

A form can charge the visitor. After they send their answers, they are taken to your payment gateway's secure page. The form counts as **paid** only when the gateway confirms the payment, never because the visitor came back to your page.

## Before you start

Connect a payment gateway under **Payment gateways** in the store menu. Only gateways that can make a hosted payment link work on a form, such as Razorpay and Stripe. The **Payment** section of the form's **Settings** tab tells you which gateway will be used and whether it is in test or live mode. Without one, the form cannot be published with payment on.

## How to use it

1. Open the form and go to the **Settings** tab, then **Payment**.
2. Turn on **Collect payment** and choose how the amount is set:
   - **Fixed price**: every visitor pays the same.
   - **From a choice field**: pick a required dropdown or radio field and give each option a price.
   - **The visitor enters the amount**: pick a required number or currency field, then set the smallest and, if you want, the largest amount. Good for donations.
3. Choose the **Currency** (three letters, for example INR) and, if you like, a short note shown on the payment page.
4. Save, then publish. Visitors now see **Amount to pay** above the send button.

## How the amount is decided

The amount is worked out on our server from the published version of the form. A visitor cannot change it by editing the page. If you change a price, publish again; people who already submitted keep the price they were shown.

## Following a payment

Open **Submissions**. A form with payment shows **Awaiting payment** until the gateway confirms, then **Paid**. Open a submission to see each payment attempt, its amount, the gateway and the reference. The contact's timeline also gets a "Paid" entry.

- **Get a new payment link**: when the first link failed or expired (links last 48 hours), create a fresh one and send it to the visitor yourself.
- **Mark as paid**: only for money that arrived outside the gateway, such as a bank transfer or cash. It is recorded under your name.
- If a visitor pays twice, the submission is flagged. Refund the extra payment from your gateway; the app does not refund for you.

## If something looks wrong

- **Payment is on but the form says it is closed.** The workspace has no gateway that can make a payment link, or it was disconnected. Reconnect it; answers are not saved while the form cannot take payment.
- **The visitor paid but it still says Awaiting payment.** The gateway has not confirmed yet. Wait a few minutes and reopen the submission. If it stays, check the gateway's dashboard and use **Mark as paid** only once you have seen the money.
- **The amount looks wrong.** Check the option prices or the smallest and largest amounts, then publish again.
