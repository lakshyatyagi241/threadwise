---
id: team-performance
title: Team performance report
summary: See how many replies each agent sent, how many conversations they resolved and how fast they answered first, for today, this week or this month.
area: inbox
order: 70
documents: []
gates:
  permission: inbox.analytics.view
  planFeature: team_performance
routes: [/inbox/analytics/team]
keywords:
  [
    team performance,
    report,
    analytics,
    agents,
    replies,
    resolved,
    first reply,
    response time,
    workload,
    load,
  ]
---

## What it is for

The Team performance report answers "how fast did your team respond?". It shows the totals for the workspace and one row for each agent who replied, so a manager can see who is carrying the work and how quickly customers get a first answer. The page refreshes by itself every 30 seconds.

## How to use it

1. Go to `/inbox/analytics/team`.
2. Choose the period: **Today**, **This week** (from Monday) or **This month**. The period follows your workspace time zone.
3. If the workspace has two or more channels, pick one under **Channel** to narrow every figure to it. The choice stays in the address, so a link keeps it.
4. Read the four tiles, then the table.

## What the numbers mean

- **Replies sent** counts the replies people typed themselves. Automatic replies from auto-assignment, keywords, out-of-hours messages and AI agents are not counted.
- **Resolved** counts conversations resolved in the period.
- **Inbounds** counts messages customers sent in the period.
- **Avg first reply** is the average time from the start of a conversation to the first reply, over the conversations resolved in the period. It is clock time, not business hours, and it is credited to the person the conversation is assigned to.
- **Status**, **Load** and **Last seen** show the agent's availability, how many open conversations they hold right now, and when they were last active.

An agent appears in the table once they have sent at least one reply in the period.

## Who can see it

The report needs the **View Team Inbox performance reports** permission. Owners, Admins and Managers hold it by default; Agents and Viewers do not. The plan must include Team performance: on a plan without it, the page opens with an upgrade sheet over it.

## If something looks wrong

- **The table is empty.** No agent replied in that period. Try **This week** or **This month**, or choose **All channels**.
- **A teammate is missing.** They have not sent a reply in the period. People who only resolved or were assigned conversations are not listed.
- **The average shows a dash.** No conversation was resolved in the period, or none of them had a reply.
