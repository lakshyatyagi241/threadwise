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
2. The four-step **Create broadcast** wizard opens: **Name and template**, **Audience**, **Check and variables**, **Test and send**. Each step must be complete before **Next** works, and your work is saved as a draft you can resume. Read [Create a broadcast](help:campaigns-create-broadcast) for every step.
3. Broadcasts made with the wizard are listed at the top of the Broadcasts screen, under **Created with Create broadcast**. Open one to see its runs, retries and to pause, resume or cancel it.

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
