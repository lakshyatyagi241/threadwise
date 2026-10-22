---
id: analytics-overview
title: Analytics
summary: A detailed message report for any window: delivery, failures, reply rate, daily charts, message types and the busiest hours, with CSV export.
area: overview
order: 20
documents: [nav:analytics]
keywords: [analytics, login devices, sign-ins, browsers, sessions, report, delivery, failed, queued, reply rate, heatmap, best hours, export, csv, message types]
---

## What it is for

Analytics gives you a full report on the messages your workspace has sent and received. It answers how many reached their reader, how many failed or are still queued, how many people replied, which kinds of message you send, and which hours of the week are busiest.

## How to use it

1. Open **Analytics** from the **Platform** area of the menu, or go to `/analytics`.
2. Choose a window with the buttons: **7d**, **30d**, **90d** or **Custom**. The page opens on **30d**.
3. For **Custom**, fill in **From** and **To** and select **Apply**. If you leave **From** blank it starts 30 days back, if you leave **To** blank it ends today, and if **From** is after **To** the two are swapped. A custom window can span at most 366 days.
4. Read the headline under the title. It gives the share of messages that reached their reader between the two dates, then the number sent and the reply rate.
5. Read the key numbers: **Sent**, **Delivered**, **Queued**, **Failed** and **Reply rate**. Each has a trend against the previous window of the same length. For **Queued** and **Failed**, a fall is the good direction.
6. Under them, **Received messages** counts the messages your contacts sent in the window, and the conversation tiles count the conversations that had activity in the window, a message or a resolve or close: **Open**, **Resolved** (you pressed Resolve), **Closed** (you pressed Close), **Assigned** and **Unassigned**. A conversation you resolve today counts as resolved today, even when its last message is older. A message counts as delivered when its delivery or read time was recorded, even if it still reads as sent.
7. Scroll down to the charts, described below.
8. Select **Export CSV** to download the report for the window you are looking at.

### What each chart shows

- **Messages over time**: sent, delivered and failed per day.
- **Delivery rates**: the share delivered, queued and failed.
- **Daily totals**: delivered, queued and failed per day, stacked.
- **Engagement funnel**: contacts messaged, delivered, replied and goal completed (contacts whose flow finished), with conversation activity and the reply-rate change against the previous period.
- **Message types**: outbound messages split into text, template, media, interactive and location.
- **Best hours**: a grid of weekday against hour. Darker cells mean more messages.
- **Login devices**: how people sign in to this workspace. It counts the sign-ins started in the window and groups them three ways: by **Browser**, by **System** and by **Type** (desktop, mobile or unknown). Each bar has a solid part for sessions that are still active and a lighter part for sessions that were signed out or have expired. The badge in the corner shows how many sessions are active right now, whatever the window. The card only counts: it never shows names, addresses or session details. To see and sign out your own devices, open **Account security**. The **By device** card is separate and lists your connected WhatsApp numbers.

## Plan and access

Analytics needs a plan that includes the analytics feature, and the permission to view analytics. On a plan without it, the menu entry shows an upgrade mark, and the page says your plan does not include analytics, with a **See plans** link to [Plans](help:account-plans). Days and hours follow your workspace timezone.

## If something looks wrong

- **The page says there are no outgoing messages.** Nothing was sent in that window. Try a longer one.
- **Login devices says there are no sign-ins.** Nobody signed in during that window. Try a longer one.
- **The charts are empty.** The window holds no messages. **Best hours** says so when it has no volume.
- **A custom window fails to load.** It may be longer than 366 days. Shorten it and apply again.
- **A message says you do not have access.** Your role does not include analytics. Ask a workspace admin.
