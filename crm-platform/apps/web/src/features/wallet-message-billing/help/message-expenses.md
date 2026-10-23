---
id: message-expenses
title: Expenses
summary: What every message, SMS, email, call, AI request and lookup cost, what it was for, and what came back.
area: settings
order: 31
documents: [tile:wallet-message-billing]
keywords: [expenses, spending, cost, template, message, sms, email, call, ai, type, log, per message, refund, failed, campaign, broadcast, breakdown, charges]
---

## What it is for

The expense log answers two questions: what each charge was for, and what it cost. The wallet statement lists every movement on the wallet. This page lists the items behind the charges, one row each, and adds up the cost of groups of them so you can see where the money went. An item is a WhatsApp message, an SMS, an email, a call, an AI request, a translation or a contact lookup. For a WhatsApp message the row also shows the template it went out with.

## How to use it

1. Open **Settings**, go to **Business and billing** and select **Expenses, wallet and statement**.
2. Select **Expenses**. The page opens at [the expense log](/billing/wallet/expenses).
3. Read the totals at the top: the number of items, what was charged, what came back, the net cost and how many items were not billed.
4. Under **Cost by**, choose **Template**, **Channel**, **Category**, **Country** or **Type** to see the cost of each group. Each row shows its items, what was charged, what was refunded, the net cost and how many were not billed. **Type** shows what AI, SMS, email and calls cost next to WhatsApp messages.
5. Below that is the list of items, newest first. Use **Next** and **Previous** to read further.
6. To narrow the list, set a status, a type, a channel, a category, a template name or a date range, then select **Apply**. **Reset** clears them all.

> The totals and the groups cover everything that matches the filters, not only the rows on the page.

## What each row shows

- **Date**: when the item was charged.
- **Type**: what was billed: WhatsApp message, SMS, Email, WhatsApp call, Voice call, AI, Translation, Contact lookup or Chat message. An SMS shows its segments and a call shows its minutes.
- **Template**: the name of the template a WhatsApp message was sent with. Other types have none.
- **Campaign, broadcast or feature**: the campaign, broadcast or schedule the item belonged to, or the AI feature that made the request, such as lead scoring. Chat and flow messages have none.
- **Channel**: where the item came from, such as Campaign, Broadcast, Scheduled, Flow / Chatbot, Auto-reply, Chat or API, or the feature for AI, calls and reminders. Messages a team member sent from the inbox are listed under Chat.
- **Category** and **Country**: the pricing category and the recipient's country, which set the price.
- **Status**: one of three.
  - **Charged**: the message was billed and the charge was not reversed.
  - **Not billed**: the item happened but nothing was taken. The reason is shown under it: included in your plan, the wallet was empty, or the price for it is zero.
  - **Refunded**: the item was billed, then the provider reported that it failed, so the same amount came back. The time it came back is shown under the status.
- **Charged**, **Refunded** and **Net**: the amounts. Net is charged minus refunded, so a failed message costs nothing in the end. An amount can show three or four decimals, the same as on the statement.
- **Not collected**: shown under the amount when the balance ran out part way through a message. The part that could not be taken is named there.

## Filters and grouping

- **Status**: all items, charged, not billed or refunded.
- **Type**: one kind of item, or all types.
- **Channel** and **Category**: one value from the list.
- **Template**: the template name. Capitals do not matter.
- **From** and **To**: the date range. The end date cannot be before the start date.
- **Cost by**: the grouping. It is kept in the address, so a link to a grouping opens the same view.

> Groups are listed largest cost first. When there are more than 200 groups, only the largest are shown and the page says so. Narrow the date range to see the rest.

## Plan and access

The page needs the permission to view the wallet statement. Owners and Admins have it by default. Without it, the page says you do not have access.

## If something looks wrong

- **A template or campaign shows as Not recorded.** The name is recorded when a message is charged. Messages sent before this page existed were not given a name, so they stay as Not recorded. Messages sent since then show the name they were sent with, even if the template has been renamed or deleted since.
- **An item is missing from the list.** Check the status, type, channel and category filters and the date range, then select **Reset**. An item appears once it has been charged or marked not billed, which can take a moment after it happens. Messages on a personal-number WhatsApp, calls you logged by hand and messages in the test chat are never listed because they are never charged.
- **The amounts do not match the statement.** Both read the same charges. Recent activity can take a moment to arrive; reload the page.
- **A message shows Refunded but you expected it delivered.** The provider reported it as failed or undelivered, and the charge was returned. See [How billing works](help:how-message-billing-works) for when a charge is taken and returned, and for everything that uses the wallet.

For the full list of movements, including top-ups and adjustments, see [Expenses, wallet and statement](help:wallet-statement).
