---
id: agent-status-automation
title: Working hours and automatic status
summary: Set the days and times you are available, and let your status switch to Away outside them.
area: inbox
order: 64
documents: []
gates:
  planFeature: agent_status_automation
keywords: [working hours, schedule, automate status, away, time zone, availability, outside of working hours, overnight]
---

## What it is for

Working hours let your status follow your day. Outside your hours you are **Away** without touching anything, and new chats go to colleagues who are in. Inside them you are **Available** again.

## How to use it

1. Open the status pill, select **Manage working hours and out of office**, then **Working hours**.
2. Switch **Automate my status** on.
3. Check the **Time zone**. It starts from your workspace's time zone; change it if you work somewhere else, or use **Use the workspace time zone** to go back.
4. For each day, switch it on or off and set the **From** and **To** times. **Add hours** gives a second or third range in the same day (a lunch break is two ranges). **Open all day** covers midnight to midnight. **Copy Monday to Tuesday-Friday** copies the first day.
5. Save.

A closing time earlier than the opening time is an overnight range, for example 22:00 to 06:00: it runs through midnight and ends the next morning, even if the next day is switched off.

## Rules you can rely on

- The order is: your own choice, then leave, then working hours, then Available.
- A status you set by hand lasts until your hours next change when you automate, so you are not Away for ever. With **Automate my status** off it lasts until you change it.
- If no day is open, you are never Away because of the schedule, and the dialog warns you about it.
- Times follow your time zone's clock, so a change to or from summer time moves the moment in real time, not the time on the clock.
- Automatic assignment skips people outside their hours. **Try it** names them as "outside their working hours". A chat handed to a named person still goes to that person.
- Switching **Automate my status** off, or losing the plan feature, stops the automation. Your saved days are kept.

## Plan and access

This is the automatic status plan feature. On a plan without it the dialog is read only, says it is included in a higher plan, and links to Plans; your saved hours are kept but ignored, and your own Available and Away choices keep working.

You set your own hours with the leave management permission (every role has it for itself). Managers who may manage leave for others set a person's hours from **Settings**, **Team members**, with the clock icon on their row. Anyone who can see leave can open the hours; only those who may manage them can change them.

## If something looks wrong

- **I am Away during my hours.** Your own **Set as away** beats the schedule until your hours next change. Select **Set as available**.
- **The Inbox says Outside of working hours.** Check the time zone and the days in the dialog.
- **Nothing happens outside my hours.** Check **Automate my status** is on and at least one day is open.
