---
id: campaign-stop-resume
title: Stop, resume or resend a campaign
summary: Cancel a running or scheduled campaign, pick it up again where it stopped, send it now, or resend to failed or all recipients.
area: campaigns
order: 64
documents: [nav:campaigns]
keywords: [cancel campaign, stop, resume, resend, send now, retry failed, auto-end, delete campaign]
---

## What it is for

Sometimes a campaign needs to stop: a typo, the wrong audience, the wrong time. This guide covers the controls on a campaign and what each one does to the recipients that have not been messaged yet. For the whole screen, see [Campaigns](help:campaigns-overview).

## Stop a campaign

1. Open **Campaigns**. On the campaign's card, or on its own page, select **Cancel**. The control shows for a campaign that is **Running** or **Scheduled**.
2. The status changes to **Cancelled**. The sender checks the status before each message, so it stops within moments and puts the unsent recipients back.
3. Messages already sent stay sent. Cancelling does not recall them.

> There is no Pause button on a campaign. To stop a repeating send and bring it back later, use [Scheduled messages](help:scheduled-messages-overview), which has **Pause** and **Resume**.

## Start it again

- **Resume** appears on a campaign that is **Paused**, **Failed** or **Cancelled**. It moves the campaign back to **Running**, and the recipients who were not messaged yet are picked up where the run stopped. Resume starts sending straight away, even for a campaign that was waiting for a scheduled time. If the wallet cannot cover the unsent messages, Resume is refused with a message.
- **Send now** appears on a **Draft**, **Scheduled** or **Paused** campaign. It sets the send date and time to now, in the campaign's time zone, and starts the run.
- **Edit** appears on a **Draft**, **Scheduled** or **Paused** campaign. Change the message, audience or timing, then save.

## Send again to recipients

- **Failures tab.** Open the campaign, select **Failures**, and use the **Resend to** button, which names how many failed, to send only to those recipients. This is for a campaign that has finished. The tab also lists the most common reasons, so fix the cause first.
- **Resend to all.** On a **Completed**, **Failed** or **Cancelled** campaign, select **Resend to all** and confirm. The campaign is queued again and every recipient is messaged once more, including people who already received it.
- On the campaigns list, the card of a completed, failed or cancelled campaign offers **Resend campaign**, which also messages every recipient again.

## Let it end by itself

Under **When to send** in the builder, **Auto-end date (optional)** stops the campaign at that moment. After it, nothing more is sent, whatever is left. The date must be later than the send date. **Smart Delivery** can also set sending hours, so messages only go out inside them, and a daily limit, after which the rest goes the next day.

## Delete a campaign

Select **Delete** on a campaign, or tick several cards on the list and use the **Delete** button that shows how many are selected. This removes the campaign and its recipient list. It cannot be undone.

## Access

Cancel, Resume, Send now and Resend need the right to control campaigns. Edit needs the right to edit campaigns, and Delete needs the right to delete them. A button you are not allowed to use is hidden.

## If something looks wrong

- **Cancel is missing.** It only shows while the campaign is Running or Scheduled.
- **Resume is refused.** The message says why, most often that the wallet cannot cover the messages still to send. See [Wallet top-up](help:wallet-top-up).
- **Messages kept going for a moment after Cancel.** A message that was already being handed to WhatsApp at that moment cannot be stopped.
- **Nothing to resend.** The campaign has no failed recipients, so **Resend to** the failed has nothing to do.
