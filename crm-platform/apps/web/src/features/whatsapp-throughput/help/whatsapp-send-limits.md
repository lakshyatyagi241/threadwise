---
id: whatsapp-send-limits
title: WhatsApp send limits and live performance
summary: See how fast each WhatsApp number may send, how much of its daily limit it has used, and pause or cap a number.
area: getting-started
order: 60
audience: operator
documents: []
routes: [/admin/whatsapp-throughput]
keywords: [whatsapp, throughput, mps, rate limit, tier, 130429, 131057, pause, override, queue]
---

## What it is for

This page is for Super Admins. It shows every connected WhatsApp number, how fast it is allowed to send, what it is sending right now, and how much of its daily messaging limit has been used. Open it from **WhatsApp**, then **Send limits**. Campaigns, broadcasts, automations and bot replies all share the same pacing, so one number never sends faster than its limit whichever feature is using it.

## How a number's rate is chosen

Meta sets the speed. Every number starts at 80 messages per second, Meta raises it to 1,000 for a number that qualifies, and a number also used on the WhatsApp Business app is fixed at 20. The page reads the level from Meta and shows where the rate comes from: **From Meta**, **Business app (fixed)**, **Default** (Meta has not reported it yet) or **Override** (you set it). Sends are paced a little under the limit, by the **Safety margin**, because incoming messages share the same budget.

## Reading the overview

- **Sending now** and **Sent** add up all numbers; the table shows each number's current speed, its busiest second in the last minute and what happened in the last 5 minutes.
- **Daily limit** compares the template messages sent to different people in 24 hours with the number's messaging tier. The count is kept here and is accurate to about 1%; Meta's own count is the final word.
- **State** shows Healthy, Paused, Slowed, Near daily limit, Daily limit reached or Meta read failed.

The page refreshes every few seconds. If the live counters cannot be read, the live columns show zero and a notice says so.

## Platform settings

These apply to every number and take effect on the next message.

1. **Pace sends to each number's limit** turns the pacing on or off. Meta's own throttling always applies.
2. **Default rate** is used for a number whose rate Meta has not reported.
3. **Safety margin** keeps part of the limit free.
4. **Longest wait** hands a send back to the waiting line instead of holding it for longer than this.
5. **Slow down after a Meta throttle** halves the speed when Meta answers that sending is too fast, then recovers over about a minute.
6. **Hold template messages at the daily limit** stops new template messages when a number reaches its tier. Off, the number is only flagged.
7. **Warn at** sets the share of the tier at which a number is flagged.
8. **Re-read from Meta** sets how often each number's rate and tier are refreshed.

## Controls for one number

Open a number with **Details** for its live charts, the daily limit and a log of recent events. **Refresh from Meta** reads its level and tier now.

- **Rate override** replaces Meta's value until you clear it. Leave it empty to follow Meta.
- **Pause sending from this number** blocks its sends. Broadcasts and campaigns stop and resume by themselves; other messages fail with a Retry. Give a reason, which appears in the event log.

> Changes to a number apply to every workspace that uses it. If someone else saved first, you are told and the latest values are loaded; apply your change again.

## If something looks wrong

- **Slowed** means Meta recently refused a message for sending too fast. The number returns to full speed on its own.
- **Throughput upgrade in progress** appears when Meta is raising a number's level; sending pauses briefly and then resumes.
- **Meta read failed** means the last refresh did not get an answer; the previous values are still in use. Try **Refresh from Meta**.
