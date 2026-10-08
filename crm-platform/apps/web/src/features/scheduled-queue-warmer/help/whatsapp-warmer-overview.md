---
id: whatsapp-warmer-overview
title: WhatsApp warmer
summary: Warm up a WhatsApp number by raising its daily send limit step by step, with human-like gaps and active hours.
area: campaigns
order: 50
documents: [nav:warmer]
gates:
  planFeature: whatsapp_warmer
keywords: [warm up, warming, ban risk, daily limit, budget, health, gap, spintax, unofficial api]
---

## What it is for

A new or quiet WhatsApp number that suddenly sends a lot is more likely to be blocked. The warmer limits how many messages a number may send each day, raises that limit gradually, spaces messages out and only sends during hours you choose. Campaigns, broadcasts and scheduled sends all respect the limit of a number that is warming.

> Warming lowers the risk of a ban on Unofficial API numbers. It is not a guarantee. For high volume, an official WhatsApp Cloud API number needs no warming.

## How to use it

1. Open **Settings**, then **Channels**, select **Unofficial WhatsApp API** and open the **Warmer** tab. Each connected number has a card showing its engine, a health score, its connection status and a **Warming** switch.
2. Turn on **Warming** for the number.
3. Set the ramp: **Start budget/day**, **Ramp +% / step** and **Ramp every (days)**, and the ceiling, **Max budget/day**.
4. Set the pacing: **Min gap (sec)** and **Max gap (sec)** between two messages, and the hours, **Active from (hr)** and **Active to (hr)**, on a 24-hour clock.
5. Optionally tick **Spintax variety** to send slightly different wording to each person. Write choices like `{Hi|Hello|Hey}` in your messages.
6. Select **Save warm-up**. Each number saves on its own.

## Options and settings

- The four tiles at the top show **Numbers warming**, **Today's budget**, **Sent today** and **Avg health**.
- Each card shows **Today's budget**, **Remaining today** and **Sent today** for that number.
- The health score is higher when it is safer to ramp up. Green is 70 and above, amber is 40 to 69, and red is below 40.

## Plan and access

The Warmer screen needs the **WhatsApp warmer** plan feature and the right to manage the warmer. Without the plan feature, the page shows a message that your plan does not include it, with a link to upgrade.

## If something looks wrong

- **No numbers are listed.** Connect a number first. The page links to the WhatsApp settings.
- **Save is refused.** The field with the problem is marked. Every box needs a whole number inside its allowed range, and the longest gap must not be shorter than the shortest.
- **A message says you do not have permission or your plan does not include this.** Ask a workspace admin to change your role, or see the plans.
