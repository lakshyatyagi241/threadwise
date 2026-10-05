---
id: broadcasts-overview
title: Broadcasts
summary: Send an approved template to many contacts at once, now or on a schedule, and follow delivery, reads and failures per recipient.
area: campaigns
order: 20
documents: [nav:broadcasts]
keywords: [bulk message, mass send, template send, schedule, delivery, read, failed, retry, audience]
---

## What it is for

A broadcast sends one approved message template to a set of contacts, now or at a time you choose. The Broadcasts screen lists every send with its counts for contacts, sent, delivered, read, failed and clicked.

## How to use it

1. Open **Broadcasts** and select **New broadcast**. If a Telegram bot or an Instagram account is also connected, a window asks you to pick a channel first. Choose WhatsApp for a template send.
2. Enter a **Broadcast name**. It is an internal label used in reports.
3. Under **Select template message**, pick an approved template. Only approved templates are listed. If there are none, use the **Create one** link, or read [Message templates](help:message-templates-overview).
4. If the template has variables, header media or button links, a **Fill in this send** panel appears. What you type there applies to this send only. Blank fields keep what the template already does.
5. Pick the number to send from. With one connected number it is used automatically. With several, tick each one and give it a share weight: weights of 7 and 3 send 70% and 30% of the contacts.
6. Choose who gets it: tags, groups or individual contacts. The count of selected contacts is shown.
7. Choose **Send now** or **Schedule for later**, then set the date, time and timezone.
8. Select **Add Broadcast**. If you ticked several numbers, one broadcast is created per number.

## Options and settings

- The list filters by status (**All broadcasts**, **Scheduled**, **Processing**, **Completed**, **Failed**), by date range and by name. A broadcast can only be deleted while it is scheduled or after it failed.
- A broadcast opens on four tabs: **Overview**, **Recipients**, **Failures** and **Events**. The numbers update by themselves while it is running.
- **Retry failed** sends again to recipients that failed. **Resume** restarts a paused broadcast.

## Plan and access

You need the right to view broadcasts to open this screen. Creating, deleting, retrying, resuming and exporting each need their own right, and the matching buttons are hidden without it. Your plan sets a limit on how many broadcasts you can create.

## If something looks wrong

- **Add Broadcast is refused.** The reason is shown above the form, for example no sendable contacts were selected (contacts who opted out are skipped), or the wallet cannot cover the send.
- **A broadcast is paused.** A notice says why: the daily sending cap was reached and it resumes by itself, or sending is halted for the workspace.
- **Many recipients failed.** Open the **Failures** tab to see the top error reasons, fix the cause, then use **Retry failed**.
