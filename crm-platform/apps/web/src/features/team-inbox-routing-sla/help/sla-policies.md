---
id: sla-policies
title: Response targets (SLA)
summary: Set how fast your team should reply and resolve, see which conversations are late, and get told when a target is missed.
area: settings
order: 61
documents: [tile:sla-policies]
keywords:
  [
    sla,
    response time,
    first reply,
    resolution,
    target,
    breach,
    late,
    overdue,
    business hours,
    priority,
    policy,
  ]
---

## What it is for

A response target says how long a customer may wait for a first reply, and how long a conversation may stay unresolved. When a conversation passes a target, it is flagged as breached, it shows a red SLA badge in the inbox, and the person responsible is told.

## How to use it

1. Open **Settings**, go to **Automation** and select **Response targets**.
2. Under **Add a policy** give it a **Name** and the two targets in minutes: **First reply within** and **Resolve within**. Leave one empty if you do not want that target. 60 is one hour and 1440 is one day.
3. Choose how the clock runs. **Count business hours only** counts only the hours and time zone you set in your workspace settings, so a message that arrives on Friday evening is not late on Monday morning. **Pause while waiting on the customer** stops a conversation set to pending from being flagged.
4. Optional: open **Targets by priority** and give Low, Normal, High or Urgent their own targets. A priority's target replaces the policy's; leave a box empty to keep the policy's own.
5. Tick **Make this the default policy** and select **Create policy**. The first policy you create is always the default. A new conversation takes its clock from the default policy.
6. Use **Edit** and **Delete** on the list. Each row shows its targets and how many conversations have used it.

In the inbox, a conversation row shows a badge when its clock is within 30 minutes of its target (amber) or has passed it (red). The conversation header always shows the clock that matters now: the first-reply target while the customer is waiting for a first answer, then the resolution target. Hover the badge for the due time.

## What happens when a target is missed

A check runs every minute. A conversation that is open, or pending when the policy does not pause, and has passed its first-reply target while the customer is still waiting, or its resolution target, is flagged once. The timeline records it, and the assignee gets a notification. If nobody holds the conversation the team members are told, and if no team holds it either the people who manage response targets are. A first reply that came late is flagged too.

A snoozed conversation is checked after it wakes. A resolved, closed or spam conversation is not flagged.

## Options and settings

- A new clock starts when a customer starts a conversation, and again when a customer writes after you resolved or closed it. Editing a policy changes new clocks only; clocks already running keep their due times.
- Deleting a policy does not stop the clocks of the conversations that used it.
- The notification type is called **SLA breached** in your notification preferences. It is quiet by default (no sound, no push).

## Plan and access

Response targets need a plan with the SLA feature. Anyone who can open the inbox settings can read the policies; creating, editing and deleting them needs the right to manage response targets.

## If something looks wrong

- **No badge appears.** There is no default policy, the default policy has no targets, or your plan does not include the feature.
- **A conversation was flagged at an odd hour.** Check **Count business hours only** and the business hours and time zone in your workspace settings.
- **Someone else changed the policy first.** The list reloaded. Try again.
