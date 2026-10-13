---
id: message-history
title: Message history
summary: Every message you sent or received in one place, with its delivery status, the reason a message failed, and a CSV export.
area: campaigns
order: 40
documents: [nav:history]
keywords: [history, messages, delivery, failed, delivered, read, export, csv, report, log]
---

## What it is for

Message history is one list of everything that went out and came in: messages from the inbox, flows, auto-replies, the AI assistant and the API, and one line for every person a broadcast, a campaign or a scheduled message was sent to. Use it to answer "did this reach the customer?", "why did it fail?" and "how did last week go?".

## Read the screen

- The **cards** at the top count the whole period, not only what is on screen: total messages (and how that compares with the period before), sent, received, failed, the average time to a first reply, how many were delivered and read, and the delivery rate. If you may see the wallet, a **Cost** card adds up what the messages cost, per currency.
- The **charts** show messages over time (daily, hourly or weekly), the split between sent, received and failed, the mix of message types and the most active conversations. They follow the filters you choose.
- The **table** lists the messages, newest first. Select **Load more** to go further back.

## Find a message

1. Choose the period at the top: the last 24 hours, 7, 30 or 90 days, or your own dates (up to one year back).
2. Use the tabs **All**, **Sent**, **Received** and **Failed**; each shows how many there are.
3. Narrow it with the search (a name, part of the text, a phone number or a message id), the channel, the type, the status or **Sent by** (inbox, flow, auto-reply, AI assistant, API, broadcast, campaign or scheduled).
4. The address of the page holds all your choices, so you can bookmark it or share it with a teammate who has access.

> You can only search a phone number that you are allowed to see. Numbers of contacts you cannot open are hidden except for the last four digits, and typing digits will not find them.

## Open one message

Select a row to open its details: the full text, who sent it, which channel and template, the cost, and every step it went through (queued, each attempt, sent, delivered, read or failed) with the time to the second. A message that failed shows the reason in plain words, with the provider's own code next to it.

Use **Open chat** to go to the conversation, **Open contact** to see the person, and the eye in the table to open the broadcast, campaign or scheduled message a line belongs to.

## What you can see

- Messages of a conversation appear only if you can open that conversation. If you can read only your own conversations, you see only your own messages here.
- Lines for broadcasts, campaigns and scheduled messages belong to no conversation, so they appear only for people who can read all conversations.
- Message text appears shortened (the first 40 characters) in the table and whole in the details.

## How long history is kept

The list of messages reaches back one year. The delivery steps of each message are kept in full for 90 days, then archived and kept until a year after the message. Older steps are removed; the message and its status stay.

## Export to CSV

1. Set the filters you want in the file.
2. Select **Export CSV**. The file is prepared in the background, so you can leave the page.
3. When it is ready we email you, and it appears under **CSV exports** with a **Download** button. The file is kept for 7 days.

Exporting needs the **Export the message delivery log** permission and access to all conversations. Only one export is prepared at a time. The file contains customers' phone numbers and message text, so share it with care.

## If something looks wrong

- A message you sent is missing: check the period and the filters, and that you can open its conversation.
- A broadcast recipient shows as **Queued**: the message has not left yet.
- The cards and the table differ: the cards ignore the search, type, status and "sent by" filters on purpose, so the headline numbers stay put.
