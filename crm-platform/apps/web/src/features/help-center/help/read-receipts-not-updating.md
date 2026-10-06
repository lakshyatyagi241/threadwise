---
id: read-receipts-not-updating
title: Delivery ticks and read receipts not updating
summary: Understand the ticks under your messages and what to check when a message stays on Sent or never turns to Delivered or Read.
area: troubleshooting
order: 30
documents: [nav:inbox, nav:broadcasts, nav:campaigns]
keywords: [ticks, read receipts, delivered, read, sent, status, blue ticks, delivery report]
---

## What it is for

The ticks under a message tell you how far it got. This guide explains what each one means and what to check when a message seems stuck on one of them.

## What the ticks mean

- A clock, **Sending**: the message is saved and not yet handed to WhatsApp.
- One tick, **Sent**: WhatsApp accepted the message.
- Two grey ticks, **Delivered**: WhatsApp reports it reached the customer's phone.
- Two blue ticks, **Read**: WhatsApp reports the customer opened it.
- A red alert icon, **Not sent**: it failed. The reason is under the message. See [A message is stuck or was not sent](help:message-stuck-or-not-sent).

A message only moves forward. If **Read** arrives before **Delivered**, or a late **Delivered** arrives after **Read**, the message stays on the furthest step. A message that already shows **Delivered** or **Read** never changes to **Not sent**. A message on **Sent** can still change to **Not sent** if WhatsApp reports a failure later.

## Check these in order

1. **Wait and reload.** Ticks come from updates that WhatsApp sends to the platform some time after the message left, so they can lag. Open conversations and broadcasts that are running update by themselves, and a reload shows the latest.
2. **Check that updates reach your workspace.** Updates about your messages travel the same way as customers' messages. Open **Settings**, then **WhatsApp**. If the number's card says **Inbound not wired**, ticks will not move and new customer messages will not arrive either. Select **Fix inbound**. See [Incoming messages or delivery updates are missing](help:whatsapp-incoming-missing).
3. **Think about the customer's side.** WhatsApp reports **Delivered** only when the message reaches the customer's phone, so a phone that is off or offline stays on **Sent**. WhatsApp reports **Read** only when the customer's own WhatsApp settings allow read receipts, so a message can stay on **Delivered** for good.
4. **Look at the detail in a broadcast.** The **Recipients** tab shows the time of each step, and an **Error / WA id** column for recipients that failed. In a campaign, the **Messages** tab lists each recipient with its status: Queued, Sending, Sent, Delivered, Read, Replied, Failed, Unsubscribed or Skipped.
5. **Check the number's health.** On the number's **Health** page, read **Issues & blocks**. It names problems such as a token that is no longer valid, a missing permission, or a blocked number. See [WhatsApp numbers](help:whatsapp-numbers-overview).

## Why this matters for billing

If you pay per message, a message is charged when WhatsApp reports it **Delivered** or **Read**, not when you send it. A failure reported afterwards refunds the charge. See [How message billing works](help:how-message-billing-works).

## If something looks wrong

- **Every message stays on Sent.** Updates are not arriving. Run **Fix inbound** on the number, then send a test message to a phone you control.
- **Only some customers never show Read.** That is normal when they have turned read receipts off.
- **The numbers in a broadcast do not match the inbox.** Reload both. If they still differ after a few minutes, contact support from [Support](/support) with the broadcast name and choose **Message delivery**.
