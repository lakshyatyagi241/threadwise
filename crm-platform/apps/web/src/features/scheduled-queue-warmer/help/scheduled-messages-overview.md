---
id: scheduled-messages-overview
title: Scheduled messages
summary: Queue a WhatsApp message for later or on a repeat, then pause, run, retry or review each schedule and its delivery.
area: campaigns
order: 40
documents: [nav:scheduled]
gates:
  planFeature: scheduled_messages
keywords: [schedule, later, recurring, queue, send time, timezone, repeat, delay, test message]
---

## What it is for

A schedule sends one message to recipients at a time you choose, once or on a repeat. The Scheduled screen shows what is queued, running and finished.

## How to use it

1. Open **Scheduled** and select **Schedule message**. It takes five steps, and each is checked before **Next**.
2. **Basics.** Name the schedule (an internal label), tick the sender or senders, and pick the type: **Plain text**, **Template**, **With media** or **Location**. If you tick several senders, each runs its own schedule with a fair share of the audience.
3. **Recipients.** Choose a source: saved **Group**s, **Tags**, an **Audience queue** (the recipients of past broadcasts) or **Numbers** that you paste with the country code and no plus sign. The total is shown, and contacts who opted out or are archived are left out.
4. **Message.** Write the text, pick an approved template, give a media link or enter latitude and longitude, depending on the type. Use `{name}`, `{phone}` or `{email}` to personalise. You see an estimated send time and a live preview.
5. **When.** Choose **Send once** with a date, time and timezone, or **Recurring** every number of days, weeks or months. Weekly schedules need at least one weekday, and you can end never or on a date. The time must be a few minutes ahead.
6. **Review.** Check the summary. You can tick **Send a test first** and enter a number to receive one preview message. Then select **Schedule message**.

## Options and settings

- The list has status tabs, a search box and a **Next to fire** card. Row actions depend on status: **Pause**, **Resume**, **Run now**, **Cancel**, **Retry with new time** and **Delete**.
- A schedule's page shows its delivery funnel and recipients. Numbers that are warming up follow the [WhatsApp warmer](help:whatsapp-warmer-overview).

## Plan and access

You need the right to view schedules to open the screen. Scheduling and every action on a schedule need the manage right. Creating a schedule needs the **Scheduled messages** plan feature, and your plan limits how many schedules you can hold.

## If something looks wrong

- **Template schedules are refused.** WhatsApp Cloud API numbers cannot send template schedules. Untick them or choose another message type.
- **You cannot move to the next step.** A message under the field says what to fix, such as a missing name, an over-long message or a time that is too soon.
- **A schedule failed.** Open it for the reason, then use **Retry with new time**.
- **A message says sending is halted for this workspace.** Ask a workspace admin about it.
