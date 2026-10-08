---
id: store-gateways
title: Payment gateways
summary: Add the keys of your payment gateway once. Your store checkout and Sales invoices both use it to take online payments.
area: settings
order: 35
documents: [tile:payment-gateways]
keywords: [payment gateway, razorpay, stripe, checkout, pay link, online payment, webhook, api keys, test mode, invoice payment]
routes: [/store/gateways]
---

## What it is for

A payment gateway is the service that takes a card, UPI or wallet payment for you and pays it into your own account. You set your gateway up once on this page. The same setup is used by your store checkout (the payment links you send from an order) and by the pay button on Sales invoices, so there is no second place to enter keys.

## How to use it

1. Open **Settings**, then **Payment gateways** under Business and billing. You can also open it from the store sidebar.
2. Choose where the setup applies. **Workspace (all stores)** is the default for every store and for invoices. **This store only (override)** is used only by the checkout of one store and wins over the workspace setup. With two or more stores you pick which store.
3. Find your gateway in the list and select **Configure**. Paste the keys the gateway names in its own dashboard. Fields marked with a star are required.
4. Choose **Test** while you are trying it with the gateway's test keys, and **Live** to take real payments. Keep **Active** on, then select **Save gateway**.
5. Copy the **Webhook address** shown in the panel (it appears after the first save) and paste it into your gateway's dashboard, so payments confirm automatically.
6. Select **Test connection** on the card to check the keys.
7. If you saved more than one gateway, select **Set as default** on the one buyers should use first.

The line **Currently used** near the top tells you which gateway a checkout would pick right now and where it came from: a store override, the workspace default, or the keys saved on the store itself.

## Options and settings

- **Available / Not available yet:** a gateway marked Not available yet is listed so you can see what is coming, but it cannot be configured or switched on.
- **Payment links:** the gateway can create a link that a buyer opens from WhatsApp. Gateways without it cannot be used to send a payment link.
- **Default:** the gateway used first inside a scope.
- **Switch on / off:** a gateway that is off is never used by the checkout or by invoices, but its keys stay saved.
- **Remove:** deletes the saved keys for this scope after you confirm.
- **Saved keys are never shown again.** An edit panel only shows the end of each saved key as a reminder. Leave a box blank to keep the saved value, type to replace it, or tick **Clear the saved value** to remove it.
- **Test connection is honest about what it checked.** Razorpay and Stripe can check your keys with the provider, and the card says the provider accepted them. Every other gateway only has its required fields checked, because it has no safe check call. The card then says so: a real payment is the only true test for those.
- **Webhook secret missing:** the gateway uses a signing secret, but none is saved, so payment notifications from it are refused. Add the secret in the edit panel and in the gateway's dashboard.
- **Migrated from your storefront keys:** keys you had saved on the store were copied here. Save once to keep them in the new setup.

## Plan and access

You need permission to view gateways to open this page. With it you can see the list and the saved state of each gateway. Configuring, testing, switching on or off, setting the default and removing need the manage permission; without it those buttons are hidden. This screen does not depend on a plan feature, because invoices use the same gateway.

## If something looks wrong

- **Set as default says the gateway is not set up:** it is switched off or a required key is empty. Open **Edit**, fill in the missing key and make sure **Active** is on.
- **Test connection says the provider did not accept the keys:** check that the keys are for the mode you chose (Test or Live) and that you copied them whole, with no spaces.
- **Test connection says only the required fields were checked:** nothing is wrong. This gateway cannot be checked without making a payment, so make a small test payment.
- **Payments are not marked as paid:** the webhook address is probably missing in the gateway's dashboard, or the webhook secret differs from the one saved here.
- **A store still uses old keys:** a store override wins over the workspace default. Open **This store only (override)**, pick the store and check what is saved.
- **The list could not be loaded:** select **Try again**.
