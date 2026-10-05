---
id: shopify-store
title: Shopify
summary: Connect your Shopify store so its orders, products and customers reach your CRM and trigger WhatsApp messages.
area: store
order: 40
documents: [nav:shopify]
keywords: [shopify, store, orders, products, customers, webhooks, automations, abandoned cart, offers, sync]
---

## What it is for

The Shopify screen connects your Shopify store to this workspace. Once connected, order, fulfilment, refund and cart events can send WhatsApp messages, and the store's orders, products and customers are copied into your CRM so you can see them and send offers.

## How to use it

1. Open **Shopify** in the Store area of the menu. If no store is connected, the connect page opens.
2. Enter your store handle, for example **my-store**, or paste the full store address. The **.myshopify.com** part is added for you.
3. Select **Continue to Shopify**. Shopify asks you to approve the access the app needs. You come back here with the result.
4. Once connected, use the tabs on the left: **Overview**, **Orders**, **Products**, **Send Offer**, **Customers**, **Automations**, **Analytics**, **Activity** and **Settings**.
5. In **Automations**, turn on an event, pick an approved WhatsApp template for it and save. Events without a template cannot be switched on.
6. Select **Sync now** to import the latest data. The import runs in the background, and the figures update a moment later.

## Options and settings

- **Products** lets you search, filter by brand and send any product to a customer, or **Offer** it from the Send Offer tab.
- **Send Offer** sends an approved template to a customer segment, with an optional product and coupon.
- **Activity** lists webhook deliveries with their status. The side panel shows whether webhooks are healthy.
- **Settings** shows the store address, the scopes granted and the registered webhooks. **Disconnect** removes the webhooks and keeps your settings.

## Plan and access

You need the Shopify permission to open the screen. Connecting, syncing and disconnecting need the connect permission. Automations need their own permission, and sending offers needs the broadcast permission. The Shopify integration must be included in your plan.

## If something looks wrong

- **"Shopify isn't enabled yet."** An administrator must add the Shopify app before a store can be connected.
- **Shopify did not connect.** Try again. Shopify may have refused the access you were asked to approve.
- **Webhooks show no recent events.** Trigger an action in Shopify, such as a test order, and check **Activity** again.
- **Automations stay off.** Each one needs an approved template chosen before it can be turned on.
- If you use WooCommerce instead, see [WooCommerce store](help:woocommerce-store).
