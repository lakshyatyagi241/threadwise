---
id: catalog-overview
title: WhatsApp catalog
summary: Link a catalog, keep products in sync and send products, carousels or catalog links to customers on WhatsApp.
area: store
order: 10
documents: [nav:catalog]
keywords:
  [
    whatsapp catalog,
    meta commerce,
    product message,
    carousel,
    collections,
    sync,
    send products,
    cart,
  ]
---

## What it is for

Catalog lets you push products into WhatsApp chats. It has four tabs: **Setup** (connection, sync and settings), **Send**, **Collections** and **Activity**. A pill at the top shows whether a catalog is connected.

## How to use it

1. Open **Setup**. With no WhatsApp number connected you see **Connect a device first**, with a button to your channels. WhatsApp connects through the official WhatsApp Business API, and catalog sending needs at least one connected number.
2. Once a number is connected the screen says **Ready to send**. Linking a Meta Commerce catalog is optional and unlocks the official catalog button, the cart and order notifications. With a Meta number, select **Fetch from my WhatsApp account**. Otherwise open **Optional · advanced**, choose the provider, enter the catalog ID, WABA ID, phone number ID and access token, and select **Connect & verify**.
3. After connecting, use **Sync to Meta** to push products, **Refresh status** to check the results and **Import from Meta** to pull in products made in Meta. The counters show Total, Synced, Pending and Failed.
4. Open **Send**. Choose the recipients (**Contact groups**, **Individual contacts** or **Manual numbers**, up to 500 per send), a format (**Single product**, **Product list (carousel)** with up to 30 products, or **Catalog link**), the number to **Send from**, the products and an optional message, then select the send button.
5. Use **Collections** to save a group of products once and send it in one click, and **Activity** to see every catalog message your workspace sent.

## Options and settings

- **Commerce settings:** show the catalog in your business profile, and enable the cart.
- **Automation:** auto-reply when a customer sends a cart, with an optional payment link base, and a catalog concierge that answers product questions with matching products. The concierge is off by default.
- **Catalog health** lists products with no image, no price or a sync error.
- **Create a catalog:** with a connected Meta number that has a Business ID, **Create a new catalog on Meta** on Setup makes an empty catalog, links it to your WhatsApp account and connects it. When your workspace's Meta app has catalog login set up, a Meta popup opens first: approve catalog access there. Only one catalog can be connected at a time.
- **Manage on Meta:** with a catalog connected, **Rename on Meta** changes its name. **Delete on Meta** permanently removes the catalog and its products on Meta after you type its catalog ID; it then disconnects here.
- **Collections on Meta:** on a collection card, **Push to Meta** creates a product set from its active products, **Update on Meta** refreshes it after edits, and **Remove from Meta** deletes the set. The card shows whether it is on Meta.
- **Disconnect** stops syncing. Your products stay on Meta.
- Single product and list messages need the customer to have written to you in the last 24 hours. A catalog link works anytime.

## Plan and access

Catalog needs the **WhatsApp catalog** plan feature and permission to view the catalog. Connecting, syncing and changing settings need the manage permission, and sending needs the send permission. Without it you can look at the Send tab but not send.

## If something looks wrong

- **Nothing was sent:** the screen lists the reasons. Common ones are no connected number, no recipients, a wallet balance too low to send, or more than 500 recipients.
- **A product shows failed:** read the message under its Meta status, fix the product (often the image or price) in [Products](help:store-products-overview) and sync again.
- **A product is missing from Send:** only active products are listed.

## Get it as an app

The WhatsApp catalog and its store orders is also sold as an app in the **Marketplace**. A workspace whose plan already includes it keeps it as it is, with nothing to buy or install. A workspace without it can subscribe to the app and install it to switch it on. See [Marketplace](help:marketplace-overview).
