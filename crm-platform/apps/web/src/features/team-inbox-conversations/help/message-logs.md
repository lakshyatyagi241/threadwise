---
id: message-logs
title: Message logs
summary: See every step a message went through, and export the delivery log of a date range up to a year back.
area: settings
order: 20
documents: [nav:inbox-message-logs, tile:message-logs]
keywords: [delivery log, export, history, archive, csv, failed, delivered]
---

## What it is for

Every message you send keeps an exact log: when it was queued, each time we tried to send it, when the provider accepted it, and each report the provider sent back (sent, delivered, read, or failed with the reason). Use it to find out why a customer did not receive something.

## See the log of one message

1. Open a conversation in the **Inbox**.
2. Point at a message you sent and select the list icon, or select **Delivery log** under a message that failed.
3. The window shows the message's status now, then every step from oldest to newest with the time to the second. A line written by the provider says so; a report that arrived late or for an earlier send is greyed and does not change the message.

If a message failed, the reason is shown in plain words with the provider's own code next to it, for example error 131049 when WhatsApp chooses not to deliver a marketing message to a customer who has not been engaging with them.

> Retry sends the message to the provider again as a new message. The log keeps both attempts, so you can compare them.

## How long logs are kept

- The last 90 days are read straight from the inbox.
- After 90 days a log moves to the archive. It still opens in the same window.
- A log is kept for one year after it happened, then it is deleted.

## Export the logs

1. Open **Settings**, then **Data and security**, then **Message logs**.
2. Choose the first and last day (in UTC) and, if you want, only messages that are now failed, delivered or in another status.
3. Select **Request export**. The file is prepared in the background, so you can close the page.
4. When it is ready we email you a link to the same page. Select **Download** next to the export. The file is kept for 7 days.

Only one export is prepared at a time for your workspace. If you need a bigger range than a single export allows, request it in smaller parts.

> Exporting needs the **Export the message delivery log** permission. The file contains customers' phone numbers, so share it with care.

## If something looks wrong

- The export says **Failed**: request it again with fewer days or one status.
- No email arrived: open **Message logs**; a finished export is listed there for 7 days.
- A message has no log: messages sent before logs were kept have none.
