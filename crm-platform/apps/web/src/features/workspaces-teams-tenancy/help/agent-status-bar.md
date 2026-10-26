---
id: agent-status-bar
title: Your status: Available or Away
summary: The status pill in the top bar and the Inbox: set yourself as away or available, and reach working hours and time off.
area: inbox
order: 63
documents: []
gates:
  planFeature: agent_status_bar
keywords: [status, available, away, status bar, pill, out of office, time off, working hours, offline]
---

## What it is for

Your status tells automatic assignment whether to give you new chats. The **status pill** shows it wherever you are: in the top bar, next to the bell and your avatar, and at the top of the Inbox list. The dot and the word say which state you are in:

- **Available** (green): you receive new chats.
- **Away**: you chose it, and nothing new is assigned to you.
- **On leave until a date**: you are out of office, and the pill shows the last day.
- **Away outside working hours**: your own working hours put you away (see [Working hours and automatic status](help:agent-status-automation)).

## How to use it

1. Select the pill. The menu opens with your name.
2. Under **Update status**, select **Set as away** or **Set as available**. The menu offers the opposite of what you are now.
3. Under **Automate status**, select **Manage working hours and out of office**. It opens **Working hours** and, if you may set your own leave, **Time off**.

The Inbox shows **Outside of working hours** under the pill when your status is Away because of your schedule.

## What each state does

- **Away** takes you out of automatic assignment (routing rules, round robin, least busy). Chats you already hold stay yours. Someone can still assign you a chat by hand or hand one to you by name.
- A status you set by hand beats leave and your working hours. If you automate your status, your choice lasts until your hours next change (so Away is not forgotten for ever); otherwise it lasts until you change it.
- With no choice of your own, being on leave makes you Away, then your working hours, and otherwise you are Available.

## Plan and access

The pill's menu is part of the status bar plan feature. On a plan without it the pill still shows your state, and the menu says it is included in a higher plan, with a link to Plans. The **Availability** switch in your account menu stays on every plan and shows the same state.

Everyone can set their own status. Your own working hours and time off need the leave management permission that every role has for itself.

## If something looks wrong

- **The pill disagrees with another tab.** It refreshes when you return to the tab and about every minute.
- **No pill at all.** It is not drawn when the status cannot be read, for example in a platform operator session.
- **You are Away and did not choose it.** Look at the pill: leave and working hours both set it. A manual **Set as available** overrides them.
