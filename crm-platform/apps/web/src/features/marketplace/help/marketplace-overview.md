---
id: marketplace-overview
title: Marketplace
summary: Browse mini apps and integrations, install them after reviewing their permissions, then manage, pause or uninstall them.
area: apps
order: 10
documents: [nav:marketplace]
keywords:
  [
    marketplace,
    apps,
    mini apps,
    integrations,
    install,
    uninstall,
    permissions,
    connect,
    lead sources,
    request,
    add-on,
    available add-ons,
    subscribe,
  ]
---

## What it is for

The Marketplace is where you add mini apps and connect outside services to your workspace. It has three tabs, **Mini apps**, **Integrations** and **Add-ons**, a list of what you have **Installed**, and a way to ask for something missing.

## How to use it

1. Open **Marketplace** from the menu. It opens on the **Integrations** tab.
2. Besides apps, the **Integrations** tab starts with cards for the services you can connect to your workspace: **Shopify**, **WooCommerce**, **Google Sheets add-on** and **Email**. The **Add-ons** tab has cards for **Google Calendar**, **REST API**, **Webhooks**, **Geta publishing**, **Translation** and **Add-ons**. Select **Open** on a card to go to that screen. Your role and plan decide which cards you see, and the cards on the Integrations tab hide while you search or filter.
3. Find an app with the search box, the categories on the left, the **All**, **Available add-ons** and **Installed** buttons, and **Sort by** (**Featured**, **Most installed**, **Newest** or **Name**). With no filter set, shelves show **Featured**, **Popular** and **New** apps.
4. Select a card to read the app page, including **What it can access** (each permission has a risk level), **What you will need to set up** and **Your data**.
5. Select **Install**. Step one is **Permissions**: read the list and tick the box that allows them. Step two is **Set up**, where you fill in the fields the app needs. Keys are stored sealed and cannot be read back. Step three confirms the install.
6. Some connections show a secret or a private address once. Copy it, tick the box that says you saved it, and then continue.
7. Select **Installed** at the top to see your apps. Filter by **Type** or **Status**, and select **Manage** on an app. An app that has a screen of its own, such as Forms, Appointments or AI lead scoring, also has **Open** on its page, on the last step of the install and on its manage page; it takes you straight to that screen.
8. On the manage page you can **Pause** or **Resume** the app, review the permissions it holds, change **Credentials and settings**, use **Test connection**, **Send sample lead** or **Rotate secret** where they apply, read **Recent deliveries**, and **Uninstall**. Uninstalling asks whether to keep or delete the data the app created, though today its contacts stay either way.
9. Missing something? Select **Request an integration**, describe it, and vote on what others asked for.

## Apps that switch on a feature

Some apps are how a feature is added to a workspace: Appointments, Forms, Email, SMS, AI lead scoring, AI CRM Copilot, Chat widget, Help assistant, WhatsApp catalog and orders, and WhatsApp groups. The feature's screens, menu entries and Settings tiles appear when the app is installed and running, and go away when it is paused or uninstalled. Subscribing alone does not switch it on. A workspace whose plan already includes the feature keeps it and does not need to install the app, and a feature that was open to every workspace before it became an app stays with the workspaces that already used it.

If you open a screen of an app the workspace does not have, the page says it isn't part of your workspace and links to the app's page in the Marketplace, where you can subscribe and install it. A few listings only describe a feature that is already part of the product, such as **Personal WhatsApp numbers** and **Meta lead forms**; installing them changes nothing about who can use the feature.

## Available add-ons

Your plan can list paid add-ons that you have not bought yet. They show an **Add-on** label with the monthly price and a **Subscribe** button. **Install** stays disabled with the note "Included in your plan's catalogue, buy it to use it" until you subscribe. Select **Available add-ons** above the grid to see only these. Apps your plan does not list do not appear at all. Add-ons you already bought, free apps and apps your plan includes install as usual.

## Plan and access

The Marketplace needs a plan that includes it. Without it, the menu entry shows an upgrade mark and every Marketplace page asks you to upgrade. Viewing needs `market.apps.read`, installing and uninstalling need `market.apps.install`, and configuring, pausing and testing need `market.apps.manage`. Your plan also caps how many apps you can install, shown as **Installed (3 of 10)**. Paid apps are bought with **Subscribe**, which goes to checkout. A paid app is either a prepaid month, which you pay for again before the date shown (**Paid until**), or it renews on its own: your card is charged every month on the **Renews on** date until you cancel. **Cancel subscription** first stops the automatic charge at the payment provider, then the app runs to the end of what you paid for; if the provider cannot be reached nothing changes and you are asked to try again. If a card payment fails the page shows **Payment failed**: the app keeps working for a few days while the payment is retried, and **Pay now** starts a fresh subscription. When an app has a yearly price you choose **Monthly** or **Yearly** before you subscribe; a yearly payment covers twelve months. If the platform keeps subscribers on the price they first paid, the page says **Your price is locked** and a later price change does not touch you while you stay subscribed. After you pay you come back to the app's page, which says whether the payment is confirmed. A few days before a period ends you get a reminder in the app and by email, and another if a payment fails or the subscription ends. See [Plans](help:account-plans).

## If something looks wrong

- **An app says Not in your plan or Plan limit reached.** You can still read about it. Upgrade, or uninstall another app.
- **The install says the permissions changed.** Read the list again, then confirm it.
- **An app shows New permissions to review.** Open it and accept them. It keeps running on its current version until you do.
- **An app is Paused or Stopped by platform.** Resume a paused app. A stopped app can only be uninstalled.
- **You lost a secret.** Use **Rotate secret** on the manage page to get a new one.
