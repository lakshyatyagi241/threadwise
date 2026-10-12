---
id: marketplace-overview
title: Marketplace
summary: Browse mini apps and integrations, install them after reviewing their permissions, then manage, pause or uninstall them.
area: apps
order: 10
documents: [nav:marketplace]
keywords: [marketplace, apps, mini apps, integrations, install, uninstall, permissions, connect, lead sources, request, add-on, available add-ons, subscribe]
---

## What it is for

The Marketplace is where you add mini apps and connect outside services to your workspace. It has two tabs, **Mini apps** and **Integrations**, a list of what you have **Installed**, and a way to ask for something missing.

## How to use it

1. Open **Marketplace** from the menu. It opens on the **Integrations** tab.
2. With no filter set, the **Integrations** tab starts with an **Integrations and developer** block of tools you may use, such as REST API, Webhooks, Google Calendar, Add-ons, Shopify and WooCommerce. Select one to open it. The block hides when you search or filter. Plan and role decide which tiles you see, and the same tiles are still found by Settings search.
3. Find an app with the search box, the categories on the left, the **All**, **Available add-ons** and **Installed** buttons, and **Sort by** (**Featured**, **Most installed**, **Newest** or **Name**). With no filter set, shelves show **Featured**, **Popular** and **New** apps.
4. Select a card to read the app page, including **What it can access** (each permission has a risk level), **What you will need to set up** and **Your data**.
5. Select **Install**. Step one is **Permissions**: read the list and tick the box that allows them. Step two is **Set up**, where you fill in the fields the app needs. Keys are stored sealed and cannot be read back. Step three confirms the install.
6. Some connections show a secret or a private address once. Copy it, tick the box that says you saved it, and then continue.
7. Select **Installed** at the top to see your apps. Filter by **Type** or **Status**, and select **Manage** on an app.
8. On the manage page you can **Pause** or **Resume** the app, review the permissions it holds, change **Credentials and settings**, use **Test connection**, **Send sample lead** or **Rotate secret** where they apply, read **Recent deliveries**, and **Uninstall**. Uninstalling asks whether to keep or delete the data the app created, though today its contacts stay either way.
9. Missing something? Select **Request an integration**, describe it, and vote on what others asked for.

## Available add-ons

Your plan can list paid add-ons that you have not bought yet. They show an **Add-on** label with the monthly price and a **Subscribe** button. **Install** stays disabled with the note "Included in your plan's catalogue, buy it to use it" until you subscribe. Select **Available add-ons** above the grid to see only these. Apps your plan does not list do not appear at all. Add-ons you already bought, free apps and apps your plan includes install as usual.

## Plan and access

The Marketplace needs a plan that includes it. Without it, the menu entry shows an upgrade mark and every Marketplace page asks you to upgrade. Viewing needs `market.apps.read`, installing and uninstalling need `market.apps.install`, and configuring, pausing and testing need `market.apps.manage`. Your plan also caps how many apps you can install, shown as **Installed (3 of 10)**. Paid apps are bought with **Subscribe**, which goes to checkout. See [Plans](help:account-plans).

## If something looks wrong

- **An app says Not in your plan or Plan limit reached.** You can still read about it. Upgrade, or uninstall another app.
- **The install says the permissions changed.** Read the list again, then confirm it.
- **An app shows New permissions to review.** Open it and accept them. It keeps running on its current version until you do.
- **An app is Paused or Stopped by platform.** Resume a paused app. A stopped app can only be uninstalled.
- **You lost a secret.** Use **Rotate secret** on the manage page to get a new one.
