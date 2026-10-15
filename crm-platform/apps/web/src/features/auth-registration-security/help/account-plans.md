---
id: account-plans
title: Plans
summary: See your plan and usage, compare the plans on offer, upgrade or switch, stop auto-renew and see the add-ons available to your workspace.
area: account
order: 20
documents: [tile:plans]
keywords:
  [
    plan,
    plans,
    usage,
    limits,
    meters,
    quota,
    upgrade,
    downgrade,
    pricing,
    subscription,
    trial,
    renew,
    compare,
    billing,
    features,
    validity,
    add-ons,
    addons,
    unlimited,
  ]
---

## What it is for

The Plans page shows what your workspace is on today, what it has used against each limit, and every plan on offer, with what each includes. A plan belongs to the workspace, so a change here applies to everyone in it. Every **Upgrade** link in the app leads here. The old Plan and usage page now lives at the top of this page, under **Your plan and usage**.

## How to use it

1. Open **Settings**, then **Business and billing**, then **Plans**. You can also choose **Plans** from the list on the Account page.
2. Start with **Your plan and usage**. The **Current plan** card shows the state in a badge: Free trial, Active, Lapsed, Free, Custom or Trial ended. Under it you see when the monthly allowances reset and, when there is one, the date the plan is valid until. A banner says whether a trial is running or has ended, or whether the plan has expired and paid features are paused.
3. Under **Usage and limits**, limits are grouped: Messaging, Workspace, Content, Sales, Integrations and AI. Groups with a maximum start open; the others are collapsed, and you can open or close any group by selecting its name.
4. Each bar shows how much of a limit you have used. It changes colour as it fills: a warning colour from 80% and red when the limit is full. Some limits count this month only; others count in total.
5. Limits with no maximum are hidden to keep the page short. Select **Show N unlimited limits** to list them as well, and **Hide unlimited limits** to tuck them away again.
6. Under **What your plan includes**, a tick means the feature is on your plan. Select **Compare plans** to jump to the plans below.
7. Select **Upgrade plan** to scroll down to **Choose a plan**. If a **Monthly** and **Yearly** switch is shown, choose the billing period. The page opens on Yearly and shows the saving.
8. Look at the plan cards. Each shows the name, price and period, a short feature list (use **Show all** for the rest), and one button. Your own plan is marked **Current plan**. Select the button on the plan you want.
9. Scroll down for the add-ons on offer, the **Compare plans** table and the **Frequently asked questions**. Under the add-ons, each card names a Marketplace app, its price and how often it is billed. **Owned** means your workspace already has it. Otherwise select **Buy** to open the app's page in the Marketplace and subscribe there.

The address `/account/plans#usage` opens the page at the usage section. The old `/account/usage` address leads there too.

### What the button does

- **Upgrade to** a dearer paid plan opens the checkout, where you pay.
- **Switch to** a cheaper or equal-priced plan, or a free plan, asks you to confirm and then moves the workspace straight away. Nothing is deleted, but anything above the new limits cannot be added to until you are back under them, and the page lists those items. When the new plan is a paid one, the paid time you have left stays on your workspace.
- **Talk to sales** is shown on plans that are arranged with the sales team.

## What the limits count

Each bar counts what the workspace holds now, so deleting something frees its place. Two things are not given back: campaigns created in the plan period, and the invoices created this month. Monthly bars (messages, appointments, invoices, AI tokens) reset on the date shown. Broadcast recipients is the largest audience one broadcast may be sent to, not a running total.

When a limit is full, creating one more is refused with a message that names the limit and links to this page. A limit with no maximum is unlimited on your plan. The one exception is API requests per minute: with no maximum set it shows **Platform default**, meaning the platform's standard rate applies, and it is not unlimited. If a limit shows **No usage tracked**, the page has no counter for it yet.

The bars show the limits that apply to your workspace, which can include values the platform team set for you specifically. **Compare plans** lists the same limits, features and add-ons side by side. The first column stays in place while you scroll sideways, your plan is tinted, and **Only show differences** hides the rows every plan shares.

An add-on listed on your plan is available to buy, not already switched on. It starts working once you have bought it.

## Stopping auto-renew

When a renewing subscription exists, the page says when it renews and offers **Cancel auto-renew**. Your plan stays active until it expires and then does not renew.

## Plan and access

Everyone in the workspace can see the plan, the usage and the plans. Only workspace owners and admins, who hold the permission to manage the plan, can use the buttons. For everyone else the buttons are off and a note explains why. Add-ons are covered in [Add-ons](help:workspace-addons).

## If something looks wrong

- **A plan I expected is missing.** The page lists only the active plans set up for your workspace. If the list is empty, a platform administrator has to create plans.
- **A switch is refused.** The confirmation shows a message, for example that the plan cannot be selected right now. Close it and try another plan.
- **The buttons are greyed out.** Your role cannot change the plan. Ask a workspace owner or admin.
- **A limit shows no maximum.** That limit is unlimited on your plan; the bar only shows usage. Turn on **Show N unlimited limits** to see it.
- **An add-on is missing.** Your plan only lists the add-ons the platform team made available for it. Compare plans to see which plans offer more.
- **The plan says it has lapsed.** The paid period has ended, and paid features are paused until you renew.
- **Usage numbers look out of date.** Reload the page. Monthly allowances reset on the date shown.
- **One part of the page shows an error.** The usage section and the plans load separately. Select **Try again** in the part that failed, and check your connection if it keeps failing.
