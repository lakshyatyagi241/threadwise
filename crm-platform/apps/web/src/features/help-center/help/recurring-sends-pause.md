---
id: recurring-sends-pause
title: Recurring sends and pausing them
summary: Repeat a scheduled message daily, weekly or monthly in a time zone you choose, then pause, resume or cancel it. Also covers audiences in several time zones.
area: campaigns
order: 66
documents: [nav:scheduled]
gates:
  planFeature: scheduled_messages
keywords: [recurring, repeat, daily, weekly, monthly, pause, resume, timezone, local time, schedule]
---

## What it is for

A recurring schedule sends the same message again and again on a pattern, such as every Monday morning. This guide shows how to set one up, how the repeat and the time zone work, and how to pause it without losing it. For the other schedule options, see [Scheduled messages](help:scheduled-messages-overview).

## Set up a recurring schedule

1. Open **Scheduled** and select **Schedule message**. Work through **Basics**, **Recipients** and **Message** as usual.
2. On the **When** step, choose **Recurring** instead of **Send once**.
3. Enter the **Send date**, **Time** and **Timezone** of the first send. It must be a few minutes ahead.
4. Under **Recurrence**, set **Repeat every** to a whole number from 1 to 365 and pick **day(s)**, **week(s)** or **month(s)**.
5. For a weekly schedule, tick at least one of the **Days of week**.
6. Under **End**, choose **Never**, or **On a specific date** and set the **Last day**. A send due on the last day still goes out.
7. On **Review**, check the first send and the repeat, then select **Schedule message**.

## How the repeat works

- **Daily.** The message goes out every chosen number of days at the same time.
- **Weekly.** After each send, the next one goes out on the next ticked weekday.
- **Monthly.** The message goes out on the same day of the month. A month that is too short uses its last day instead.
- **Time of day.** The time is read on the clock of the time zone you chose, so it stays at the same local time in that zone.
- **Tags.** If the audience is a tag, the people are worked out again each time the schedule fires, so contacts tagged since last time are included.

## Time zones and your recipients

A schedule uses one time zone, and the send starts for everyone on it at the same moment. There is no setting that sends at each recipient's own local time. If your audience spans regions:

1. Put each region's contacts in its own [group](help:contact-groups).
2. Create one schedule per group, each with the time zone of that region.

The same applies to [Campaigns](help:campaigns-overview) and [Broadcasts](help:broadcasts-overview), which also take a single time zone. A campaign can repeat too, with **Recurring** under **When to send**, but it has no Pause button. See [Stop, resume or resend a campaign](help:campaign-stop-resume).

## Pause, resume or cancel

1. Open **Scheduled**. Use the **Paused** tab to find paused schedules, or open a schedule from the list.
2. Select **Pause** on a schedule that is **Queued** or **Running**. It stops and keeps its settings.
3. Select **Resume** when you are ready. The schedule goes back in line.
4. Select **Cancel** instead to end it for good. It cannot be undone.

> If a send time passes while the schedule is paused, the message goes out as soon as you resume. To make sure that message is never sent, cancel the schedule instead.

**Run now** sends right away instead of waiting for the next time. Recipients who already received the message are skipped.

## Access

You need the right to view schedules to open the screen, and the manage right to create, pause, resume, run or cancel one. Creating a schedule also needs the **Scheduled messages** feature on your plan.

## If something looks wrong

- **The time is refused.** A schedule must start a few minutes ahead, in the time zone you picked.
- **A weekly schedule will not continue.** It needs at least one weekday ticked.
- **No more sends after a date.** The schedule reached its **Last day** and finished. It shows as done.
- **A schedule failed.** Open it for the reason, then use **Retry with new time**.
