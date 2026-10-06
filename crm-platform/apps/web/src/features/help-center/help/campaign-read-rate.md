---
id: campaign-read-rate
title: Why a campaign shows few reads
summary: Use the campaign page to see where recipients drop out between sent, delivered and read, and which of your choices to change next time.
area: campaigns
order: 60
documents: [nav:campaigns]
keywords: [read rate, delivery, funnel, engagement, failures, opt-outs, campaign results, low reads]
---

## What it is for

A campaign page shows how far each message got. When the **Read** number is lower than you hoped, the cause is usually earlier in the chain: messages that failed, were not delivered, or went to the wrong people. This guide shows where to look on our screens. For the screen itself, see [Campaigns](help:campaigns-overview).

## Follow the funnel

1. Open **Campaigns** and select a campaign. The tiles at the top show **Recipients**, **Sent**, **Delivered**, **Read**, **Replies**, **Clicks** and **Failed**.
2. Open the **Overview** tab. **Funnel** shows how many recipients reached each step: Recipients, Sent, Delivered, Read and Replies. The biggest drop tells you where to look.
3. Read **Audience** on the same tab. It splits the list into uploaded, typed or CSV numbers, numbers without a valid phone, contacts who opted out (skipped) and the final list. A final list much smaller than you expected means the problem is the audience, not the message.

## If many messages did not arrive

- Open the **Failures** tab. It lists the most common reasons. Fix the cause, then use the **Resend to** button, which names how many recipients failed. Only the failed ones are sent again.
- Open the **Messages** tab and filter by **Status** to see who is still **Queued** or **Sending**. A campaign that is still running, paced by **Smart Delivery** or limited to sending hours, simply has not reached everyone yet.
- On the campaigns list, the **Delivery health** card warns when campaigns have more than five failures.

## If messages arrived but were not read

- **Sends by hour** on the Overview tab shows when messages went out. If most went at an hour when your customers are unlikely to look at their phones, schedule the next campaign for another time. See [Recurring sends and pausing them](help:recurring-sends-pause) for how time zones work.
- Open the **Engagement** tab. **Top performing groups** shows the read rate for each contact group in the audience, so you can see which groups respond and which do not.
- Check the template. An approved template's quality rating is shown on its page under [Message templates](help:message-templates-overview). A weak rating is a signal to rewrite it.
- Compare two wordings with an [A/B test](help:campaign-ab-test) rather than guessing.

> **Read** only counts people whose WhatsApp has read receipts switched on. Someone can read your message and never be counted, so treat the number as a lower bound, and look at **Replies** and **Clicks** too.

## If people are leaving

The **Opt-outs** tab lists recipients who opted out of your messages. They are never messaged again. A rise here suggests the audience or the message does not match what people expected. **Engagement** also shows the opt-out rate as a percentage.

## If something looks wrong

- **Clicks are zero.** Clicks are only counted when **Track link clicks** was on and the message has a link or a link button. Quick replies have no link, so the screen shows a dash for them instead of zero.
- **The numbers keep changing.** Delivery and read reports arrive after the message is sent, so counts rise for a while.
