---
id: tax-rates-settings
title: Tax rates
summary: Set up the taxes you add to invoice lines: load ready-made rates for your country or add your own, and choose a default.
area: settings
order: 20
documents: [tile:tax-rates]
keywords: [vat, gst, sales tax, percent, rate, inclusive, exclusive, default tax, hsn, sac, cgst, sgst]
---

## What it is for

Tax rates are the taxes you can pick on the lines of invoices, recurring invoices and sales orders. Each has a name, a percentage and a way of applying: **Exclusive** (added on top of the price) or **Inclusive** (already in the price). One rate is the **Default** that new lines start with. Changing or deleting a rate never alters invoices already written: each invoice keeps the rate it was made with.

## How to use it

1. Open **Settings**, find **Business and billing** and select **Tax rates**.
2. To start quickly, select **Load rates for my country**, choose a country, tick the rates you want (**Select recommended** ticks the usual ones) and add them. Rates you already have are skipped. Check the loaded rates before you rely on them: they are defaults, not tax advice.
3. To add your own, select **New tax rate**. Enter a **Name** and a **Rate** (0 to 100, up to four decimals), then choose **How it applies**. You can also set a country and region, the dates it is in force, a default HSN or SAC code and a description.
4. For a rate made of parts, such as GST 18% made of CGST 9% and SGST 9%, switch on **Made of several taxes** and add the parts. They must add up to the rate.
5. Use a row's menu to **Edit**, **Make default**, **Deactivate** or **Activate**, or **Delete**.

## Options and settings

- **Default for new lines:** new invoice lines start with this rate. When you have no rates yet, it is switched on for you.
- **Active:** inactive rates cannot be picked on new lines. The default rate stays active; make another rate the default first if you want to switch it off.
- **The table** shows each rate's type, percentage, how it applies, country or region, dates in force, status, how many invoice lines use it and its HSN or SAC code.

## Plan and access

The tile appears for roles that can view tax rates. Adding, editing and deleting each need their own permission, and the matching buttons are hidden without it. Nothing here depends on a plan feature.

## If something looks wrong

- **"A tax rate with this name already exists":** names must be unique, so choose another.
- **The parts do not add up:** the pieces of a combined rate must total the rate. **Split the rate evenly** fills them in.
- **Deleting asks about invoice lines:** the number is how many lines use the rate now. Those invoices keep it.
- **"Someone else changed this rate":** close and reopen it to see the latest version.
- **A rate is missing from an invoice line:** an inactive rate cannot be picked on new lines.
