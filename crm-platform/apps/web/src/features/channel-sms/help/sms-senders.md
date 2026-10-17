---
id: sms-senders
title: SMS senders
summary: Connect a Twilio number or an MSG91 sender, switch it on or off, check a number before you text it and read how segments are billed.
area: settings
order: 60
documents: [tile:sms]
keywords: [sms, text message, twilio, msg91, dlt, sender id, segments, lookup, broadcast]
---

## What it is for

SMS senders connects the numbers or sender names you text from. SMS here is send only: you send to your contacts from a broadcast or a campaign, and replies are not received in the app. Several Twilio numbers and MSG91 senders can run at once.

## How to use it

1. Open **Settings**, then **SMS** under **Channels**.
2. In **Connect a number**, choose the **SMS provider**: **Twilio (global)** for most countries, or **MSG91 (India / DLT)** for reliable delivery into India.
3. Enter the **From number / Sender ID**. For Twilio paste the **Twilio Account SID** (it starts with AC) and the **Auth Token**. Leave both blank to reuse the keys already connected for WhatsApp. For MSG91 paste the MSG91 key in the **Auth Token / MSG91 Auth Key** field.
4. For MSG91 in India, open **MSG91 / India (DLT) options** and enter the **DLT Sender ID** and the **DLT Template ID**.
5. Optionally enter a **Rate per segment** and a **Currency** for your own spend reporting.
6. Select **Verify + connect SMS**. The provider checks the credentials first, and nothing is saved if it refuses them. The reason it gives appears above the form.
7. Copy the **Delivery report URL** from the top of the screen into your provider's panel, so delivered and failed texts are recorded.
8. Pick the sender when you create a broadcast or a campaign.

> Sending the same From number again updates that sender instead of adding a second one.

## Options and settings

- **Activate** and **Deactivate** switch a sender on or off without losing its credentials. An inactive sender cannot send and is not offered when you create a broadcast or a campaign.
- **Remove** deletes a sender and its saved credentials after you confirm.
- **Check a number before you text it** tells you whether a number is a mobile, a landline or not valid. SMS is billed when it is sent, so a landline or a typo costs money and is never delivered. The check uses a connected Twilio sender.
- The text box in a campaign shows a live count of characters, segments and encoding. A plain text up to 160 characters is one segment; one emoji or non-Latin character limits each segment to 70 characters. Longer texts are split and every segment is billed.
- With a DLT template id, an MSG91 sender uses MSG91's template route; without one it sends plain text. One sender holds one DLT template, so connect a second sender for another template.

## Plan and access

You need the permission to view SMS senders to open the screen, and the manage permission to connect, switch or remove a sender. SMS needs a plan that includes it; without one the entry in Settings is locked. Texts count against your plan's monthly SMS quota and are never charged to the WhatsApp wallet.

## If something looks wrong

- **"That is not an Account SID."** Copy the Account SID that starts with AC from the Twilio console home page. An API key that starts with SK does not work.
- **"An MSG91 auth key is required."** Paste the MSG91 key into the Auth Token field.
- **The provider refused the credentials.** The reason is shown above the form. Fix the value and submit again; your other entries are kept.
- **"SMS is not available on your plan."** Ask an administrator to upgrade the plan or switch SMS on.
- **A sender shows Inactive.** Select **Activate**. A sender with no credentials has to be connected again.
- **A text is billed as several messages.** It is longer than one segment, or it has an emoji or non-Latin character. Shorten it, or remove the character.

## Get it as an app

SMS is also sold as an app in the **Marketplace**. A workspace whose plan already includes it keeps it as it is, with nothing to buy or install. A workspace without it can subscribe to the app and install it to switch it on. See [Marketplace](help:marketplace-overview).
