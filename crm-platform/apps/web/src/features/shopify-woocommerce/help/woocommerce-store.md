---
id: woocommerce-store
title: WooCommerce
summary: Connect your WooCommerce store with its REST API keys so orders, products and customers reach your CRM and trigger WhatsApp messages.
area: store
order: 41
documents: [nav:woocommerce, tile:woocommerce]
keywords:
  [
    woocommerce,
    wordpress,
    store,
    REST API,
    consumer key,
    orders,
    products,
    customers,
    automations,
    cart recovery,
    sync,
  ]
---

## What it is for

The WooCommerce screen connects your WordPress store to this workspace. After connecting, order, refund, cart and stock events can send WhatsApp messages, and the store's orders, products and customers are shown in your CRM for follow-up and offers.

## How to use it

1. In your WooCommerce admin, go to **WooCommerce, Settings, Advanced, REST API**. Select **Add key**, give it a description such as CRM, pick a user with administrator rights and set **Permissions** to Read/Write. Select **Generate API key** and keep both keys.
2. Open **Settings**, then **Integrations**, and select **WooCommerce**. If no store is connected, the connect page opens.
3. Enter your **Store URL**, which must start with https, then paste the **Consumer Key** and **Consumer Secret**.
4. Select **Test connection**. It checks the keys and saves nothing.
5. Select **Connect store**. The keys are saved, and the webhooks are registered on your store.
6. Use the tabs on the left to work with the store, the same way as for Shopify. Select **Sync now** to pull the latest data.

> The secret is shown only once in WooCommerce. If you lose it, generate a new key and connect again.

## Options and settings

- **Automations** turns on order, cash-on-delivery, cart and stock messages. Each one needs an approved template, and you choose which connected number sends them.
- **Send Offer** sends a product offer or a win-back message to a contact group, with an optional coupon.
- **Activity** shows webhook deliveries and their results.
- **Settings** shows the store address, the WooCommerce version and the number of registered webhooks. It also has a **WordPress plugin** card: download the zip made for this store, upload it in WordPress under Plugins, Add New, Upload Plugin, and activate it. The plugin recovers abandoned carts before an order exists and passes on failed subscription payments and custom order statuses. The file holds the store's secret key, so keep it private. **Disconnect** removes the registered webhooks.
- **Invoices** lists the invoices made from this store's orders. Turn on **Invoice this store's orders automatically** and choose when: placed, paid (the default) or fulfilled. Each order is invoiced once, even if the store sends the event again, and the buyer's copy is queued on WhatsApp, or by email without a phone number. It needs the invoicing feature on your plan.

## Plan and access

You need the WooCommerce permission to open the screen. Connecting, syncing and disconnecting need the connect permission. Automations and offers need their own permissions. The WooCommerce integration must be included in your plan.

## If something looks wrong

- **"WooCommerce isn't enabled yet."** An administrator must enable the integration first.
- **Connection failed.** Check that the store address uses https and that the keys have Read/Write permission.
- **Basic Auth needs HTTPS.** If your store is HTTP only, install an SSL certificate first.
- **No events appear.** Place a test order in WooCommerce and check **Activity**.
- For Shopify stores, see [Shopify](help:shopify-store).
