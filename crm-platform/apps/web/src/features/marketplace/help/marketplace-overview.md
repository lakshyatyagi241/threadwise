---
id: marketplace-overview
title: Marketplace
summary: Browse mini apps and integrations, install them after reviewing their permissions, then manage, pause or uninstall them.
area: apps
order: 10
documents: [nav:marketplace]
keywords: [marketplace, apps, mini apps, integrations, install, uninstall, permissions, connect, lead sources, request]
---

## What it is for

The Marketplace is where you add mini apps and connect outside services to your workspace. It has two tabs, **Mini apps** and **Integrations**, a list of what you have **Installed**, and a way to ask for something missing.

## How to use it

1. Open **Marketplace** from the menu. It opens on the **Integrations** tab.
2. Find an app with the search box, the categories on the left, the **Installed only** switch and **Sort by** (**Featured**, **Most installed**, **Newest** or **Name**). With no filter set, shelves show **Featured**, **Popular** and **New** apps.
3. Select a card to read the app page, including **What it can access** (each permission has a risk level), **What you will need to set up** and **Your data**.
4. Select **Install**. Step one is **Permissions**: read the list and tick the box that allows them. Step two is **Set up**, where you fill in the fields the app needs. Keys are stored sealed and cannot be read back. Step three confirms the install.
5. Some connections show a secret or a private address once. Copy it, tick the box that says you saved it, and then continue.
6. Select **Installed** at the top to see your apps. Filter by **Type** or **Status**, and select **Manage** on an app.
7. On the manage page you can **Pause** or **Resume** the app, review the permissions it holds, change **Credentials and settings**, use **Test connection**, **Send sample lead** or **Rotate secret** where they apply, read **Recent deliveries**, and **Uninstall**. Uninstalling asks whether to keep or delete the data the app created, though today its contacts stay either way.
8. Missing something? Select **Request an integration**, describe it, and vote on what others asked for.

## Plan and access

The Marketplace needs a plan that includes it. Without it, the menu entry shows an upgrade mark and every Marketplace page asks you to upgrade. Viewing needs `market.apps.read`, installing and uninstalling need `market.apps.install`, and configuring, pausing and testing need `market.apps.manage`. Your plan also caps how many apps you can install, shown as **Installed (3 of 10)**. Paid apps are bought with **Subscribe**, which goes to checkout. See [Plans](help:account-plans).

## If something looks wrong

- **An app says Not in your plan or Plan limit reached.** You can still read about it. Upgrade, or uninstall another app.
- **The install says the permissions changed.** Read the list again, then confirm it.
- **An app shows New permissions to review.** Open it and accept them. It keeps running on its current version until you do.
- **An app is Paused or Stopped by platform.** Resume a paused app. A stopped app can only be uninstalled.
- **You lost a secret.** Use **Rotate secret** on the manage page to get a new one.
