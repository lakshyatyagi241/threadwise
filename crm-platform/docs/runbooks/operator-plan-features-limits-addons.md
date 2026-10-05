---
id: operator-plan-editor
title: Set plan features, limits and add-ons
summary: For operators. Create or edit a plan in the console: price, which features it includes, its caps, and which paid add-ons its workspaces can see.
area: settings
order: 40
audience: operator
documents: [nav:plans]
keywords: [plan, plans, features, limits, caps, unlimited, add-ons, marketplace, operator, console]
---

## What it is for

Every workspace sits on a plan. The plan decides which areas of the product are open, how much the workspace can use, and which paid Marketplace add-ons it is offered. Operators build plans in the console under **Plans** (`/admin/plans`).

## How to use it

1. Open **Plans** in the operator console and choose **New plan**, or **Edit** on an existing plan.
2. Work through the four tabs. The strip scrolls sideways on a narrow screen. Each tab shows a count: features switched on, limits capped, add-ons selected.
3. Choose **Create plan** or **Save changes**. The buttons stay at the bottom of the dialog while you scroll.

If a field is wrong, the tab that holds it shows a dot and the dialog jumps to the first one. The message sits next to the field.

> Closing the dialog, or reloading the page, with unsaved changes asks you to confirm first.

## Details and pricing

Name, subtitle, description, button text, sort order, how long data is kept after a paid plan lapses, the active, signup default and highlighted switches, and the price: free, custom quote or a price with an optional offer price, plus the billing period. The slug is made from the name when the plan is created and never changes.

## Features

Each feature is a switch with a one-line description of the area it opens. A workspace on a plan whose feature is off cannot use that area. Use the search box to find a feature by name or description, and **Enable all** or **Disable all** to switch every feature in a group. When you have searched, they act only on the rows you can see. A new plan starts with every feature on.

## Limits

Each limit is a whole number with its unit shown next to it (per month, per broadcast, per minute, in total, per plan period). Once the workspace reaches the cap, the action is refused until it is back under it.

- Tick **Unlimited** to remove a cap. It is stored as 0. Untick it to type a number; the field is focused for you.
- **API requests per minute** is the exception. It has **Platform default** instead of Unlimited, because 0 there means the platform's own rate, not no limit.
- Use the search box to find a limit by name or description.

## Add-ons

This tab lists the paid add-ons that exist in the Marketplace, with their app, price and period. Tick the ones this plan should show. **Select all** and **Clear** act on the rows you can see after searching.

> Enabled add-ons are shown to workspaces on this plan in their Marketplace; they can only be used after the workspace buys them.

- An add-on marked **Not on sale** can be ticked but cannot be bought yet: its pack is switched off, or its app is not published.
- A selected add-on that no longer exists shows as **Unknown add-on**. Untick it, or the save is refused.
- If the list cannot be loaded, the plan's current selection is left exactly as it is unless you change it here. Use **Try again** to reload the list.

## The plans table

Each plan row shows three chips: how many features are on, how many limits are capped, and how many add-ons it shows. Select **Edit** to change them.

## If something looks wrong

- **The save is refused with a message on a tab.** Fix the field it names; the dot clears once the problem is gone.
- **An add-on is missing from the list.** It has no paid pack yet. Create the pack in the Marketplace catalogue first.
