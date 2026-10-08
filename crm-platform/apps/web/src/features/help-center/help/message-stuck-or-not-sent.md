---
id: message-stuck-or-not-sent
title: A message is stuck or was not sent
summary: Find out why a WhatsApp message stays on Sending or shows Not sent, in the Team inbox, broadcasts, campaigns and scheduled messages.
area: troubleshooting
order: 20
documents: [nav:inbox, nav:broadcasts, nav:campaigns]
keywords: [stuck, queued, sending, not sent, failed, retry, undelivered, wallet, balance]
---

## What it is for

Use this guide when a WhatsApp message stays on **Sending**, or ends as **Not sent**. It lists the checks in the order they usually pay off. Every check is something you can see on a screen of this app.

## A reply in the Team inbox

Look at the small icon beside the time under your message:

- A clock and the word **Sending**: the message is saved and waiting to be handed to WhatsApp. This normally takes seconds.
- One tick is **Sent**, two grey ticks are **Delivered** and two blue ticks are **Read**. See [Delivery ticks and read receipts](help:read-receipts-not-updating).
- A red alert icon is **Not sent**. The reason is written under the message, next to **Retry**.

### Check these in order

1. **Give it a minute.** A send is tried up to 8 times. The wait before each new try is longer than the last, starting at 2 seconds and doubling, and longer still when WhatsApp asks you to slow down. A message that is still on Sending after a minute is put back in the queue by a check that runs every 30 seconds. Messages older than a day are left alone.
2. **Read the banner above the reply box.** It says "This WhatsApp number needs to be reconnected", "has a connection problem" or "is switched off". Replies cannot go out until the number is connected again, but internal notes still work. Someone who manages channels can follow **Open the WhatsApp settings**. See [WhatsApp numbers](help:whatsapp-numbers-overview).
3. **Check the 24-hour window.** The conversation header shows **Window closed**, or how long is left. After 24 hours without a message from the customer, only an approved template can be sent. Use **Send a template** in the banner, or wait for the customer to write again.
4. **Read the reason under the message.** The common ones are listed below.
5. **Press Retry** once the cause is fixed. Only a message that failed can be sent again, and the window and the connection are checked again.

### Reasons shown under a message

- The 24-hour reply window had closed: send a template, or wait for the customer.
- WhatsApp could not deliver this message: the number may not be on WhatsApp, or the customer has not accepted its latest terms.
- This number cannot be messaged from here: it is the sender's own number, or it is not on the list of test recipients.
- WhatsApp is limiting how fast you can send, or sending is limited because too many messages were reported as spam: wait a while, then use **Retry**.
- WhatsApp rejected the number's access token, or the WhatsApp account has a problem: the number needs attention in its settings, then **Retry**.
- The template could not be sent: it was not found, was paused or rejected, or its variables do not match. See [Message templates](help:message-templates-overview).
- WhatsApp had a temporary problem, or sending is paused for the whole platform: use **Retry** a little later.
- Send blocked by security policy, followed by a reason such as link count, short link or scam pattern: your platform's message safety rules refused the text, so change the message.

### Refused before it was saved

Some problems are shown at once in the reply box instead of under a message: the 24-hour window is closed, the channel is disconnected, sending is paused for the platform, or "Your plan's monthly message limit has been reached." For the last one, look at [Plan and usage](help:plan-and-usage) and upgrade the plan or wait for the next period. If your connection drops while sending, the message stays with a clock, then shows the error with **Retry** and **Dismiss**.

## A broadcast, campaign or scheduled message

1. **Was it refused when you launched it?** A launch is checked against your wallet first. The message reads "Your message wallet is empty. Top up to start sending." or "Your wallet balance doesn't cover this send. Top up to start sending." Nothing is created or sent in that case. When you are not paying per message and your plan's monthly allowance still covers the whole audience, no balance is needed. Resuming a campaign that still has unsent recipients is checked the same way. See [How message billing works](help:how-message-billing-works) and [Wallet top-up](help:wallet-top-up).
2. **Check the template.** A broadcast on a WhatsApp Cloud number lists only approved templates that are not paused. On the Templates screen, a template that is In review, Rejected, Paused, Disabled or Missing on Meta cannot be used. See [Message templates](help:message-templates-overview).
3. **Check the sending number.** It must be connected and healthy. Open **Settings**, then **WhatsApp**, and select **Health** on its card.
4. **Look for a Paused note on the broadcast.** It says why. When sending is halted, the broadcast restarts by itself once the halt is lifted. If it only says Paused, select **Resume**.
5. **Remember that a number sends one broadcast at a time.** A second broadcast on the same number waits and checks again every 15 seconds. Messages also go out one by one with a short gap, about 3 seconds by default, so a large audience takes time. The counts move while it runs.
6. **Check a schedule's status.** A schedule marked **Queued** is simply waiting for its send time, and **Run now** sends it early. A schedule that failed shows the reason on its page, and **Retry with new time** starts it again. See [Scheduled messages](help:scheduled-messages-overview).
7. **Open the Failures tab of a broadcast or campaign.** It lists the most common reasons. By default, failed broadcast recipients are retried by themselves up to 3 more times, waiting 60 seconds, then 2 minutes, then 4 minutes. A recipient with no usable phone number, or a number WhatsApp says cannot be reached, is not retried. After that, fix the cause and use **Retry failed**. See [Broadcasts](help:broadcasts-overview) and [Campaigns](help:campaigns-overview).

## If none of this explains it

Open [Support](/support), choose **Message delivery** and send the time of the message, the recipient's number and how long it has been on Sending.
