---
id: bsp-credit
title: Reseller billing (Meta credit line)
summary: Connect your Meta business, share your credit line with a customer's WhatsApp number, and revoke it again.
area: getting-started
order: 40
audience: operator
documents: []
routes: [/admin/bsp/credit]
keywords: [reseller, meta, credit line, bsp, solution partner, waba, attach, revoke]
---

## What it is for

This page is optional and only for true reselling. When you attach your own Meta credit line to a customer's WhatsApp Business account, Meta bills you for that customer's messages instead of billing the customer. Without it, customers top up their wallet and you charge per message as usual.

Only super admins can change anything here. Other operators can look at the page.

## Step 1: connect your Meta business

1. Enter your **Meta Business ID** (Business settings, Business info, Business portfolio ID).
2. Paste a **System-user token** with the `business_management` permission. It is stored encrypted and never shown back; leave the field blank to keep the stored one, or use the remove link to clear it.
3. Leave **Extended credit line ID** blank to have it read from Meta automatically. Fill it only to override.
4. Check the **Graph API version**, the optional **Meta rates endpoint**, and the **Base currency** used for the income figures.
5. Choose **Auto-attach when a customer connects** if every new connected number should get your credit line without you picking it. Pick the currency it bills in, or leave it on Auto.
6. Choose **Save connection**.

## Step 2: attach a customer by hand

Pick a connected customer number, pick the currency Meta bills you in for it, and choose **Attach credit line**. Meta does not allow the currency to change later, so set it right the first time. **Attach all connected now** does the same for every connected number that is not yet attached, in batches; if some are left it tells you to run it again.

## Credit lines in use

The table lists each allocation with its workspace, WABA, allocation id, currency and status (attached, revoked or failed). **Revoke** stops Meta billing you for that number so the customer pays Meta directly again. If the workspace is still on reseller billing, its wallet keeps being charged per message; the confirmation warns you.

> Reseller billing needs Meta Solution Partner status and an approved credit line. Until the connection is saved the attach actions are disabled.

## If something looks wrong

- "Meta refused" shows Meta's own reason; fix it in your Meta business settings and try again.
- "Someone else changed this": reload and repeat your change.
- See [Reseller P&L](help:bsp-dashboard) for what the attached numbers earn you.
