---
id: message-billing-mode
title: Message billing
summary: Choose who bills you for WhatsApp messages: Meta directly, or the platform per message from your wallet.
area: settings
order: 30
documents: [tile:bsp-billing-mode]
keywords: [billing, whatsapp, meta, wallet, per message, credit line, reseller, charges, conversation charges]
---

## What it is for

Every WhatsApp message sent through your connected numbers has to be paid for by someone. This page lets you choose who that is. The choice applies to the whole workspace, and the page shows how it affects each of your connected numbers.

## How to use it

1. Open **Settings**, then **Business and billing**, then **Message billing**. You can also go to `/billing-mode`.
2. Read the two cards:
   - **I pay Meta directly** means your own payment method is on Meta, and you only need an active plan.
   - **Bill me through the platform** means messages are charged per message from your wallet, and the platform's credit line is shared with your number.
3. The card you are on today is marked **Active**. On the other card, select **Choose**.
4. Wait for the confirmation. It says either that Meta bills you directly, or that messages are charged per message from your wallet.
5. If you chose the platform, a second message reports the credit line for your numbers: how many were attached, how many failed and how many were already set up.
6. Check **Your numbers** below the cards. Each connected WhatsApp Business (Cloud API) number is listed with its phone number and the end of its account id, and its credit line status: **No credit line**, **Credit line attached** with a currency, **Credit line failed** or **Credit line revoked**.

## Plan and access

Seeing this page needs the permission to view message billing. Changing the choice needs the permission to manage it. With only view access, the page shows a note that you can see how messages are billed but cannot change it, and the **Choose** buttons are off. No particular plan feature is needed.

> **Bill me through the platform** is marked **Not available yet** until the platform's own credit line is set up. You cannot choose it before then.

## If something looks wrong

- **The platform option says Not available yet.** The platform operator has not finished setting up its credit line. Use **I pay Meta directly** for now.
- **The change is refused.** The message names the reason, for example that someone else changed it just now. Reload the page and try again.
- **A number shows Credit line failed.** The credit line could not be attached to that number. Contact support with the number shown on the row.
- **Your numbers says none is connected.** Connect a WhatsApp Business (Cloud API) number first. The list only shows those.
