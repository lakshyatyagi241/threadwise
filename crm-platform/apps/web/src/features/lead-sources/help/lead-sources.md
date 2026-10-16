---
id: lead-sources
title: Social leads
summary: Bring leads from ads and landing pages into your contacts through a webhook: create a source, map its fields, send a test lead and retry leads that need review.
area: settings
order: 15
documents: [tile:lead-sources]
keywords: [lead ads, webhook, zapier, make, forms, capture, attribution, campaign, import leads]
---

## What it is for

**Social leads** turns leads from your ads, forms and landing pages into contacts. Each lead source is a webhook with its own URL. Your collecting tool (Zapier, Make, a landing-page builder or your own form) posts each lead to it, and the lead becomes a contact with its source recorded, an owner, an optional deal and a notification.

## How to use it

1. Open **Settings**, then **Channels**, then **Social leads**, or go to `/lead-sources`. The **Ads** tab shows where leads can come from. Only the **Webhook** card is available; the others are marked **Coming soon**.
2. Select **New source** and work through the wizard:
   1. **Basics**: a name, a platform label, an optional shared secret and how long to keep raw lead data.
   2. **What happens to a lead**: default country code, starting lifecycle stage, tag, owner, optional deal and notifications. Select **Create source**.
   3. **Connect your sender**: copy the URL and token into your tool. They are shown only once. The URL is complete, with your platform's public address in front. If the platform's public API address has not been set (or points at a private address), you see only the path and a warning; ask whoever runs your platform to set it, then rotate the token to get the full URL.
   4. **Map the fields**: say where each value sits in your tool's data. The **Live preview** shows the result as you type.
3. Select **Save and finish**, or **Skip for now** to map later.

## Managing a source

- The **Webhook** tab lists your sources and any leads that **Need attention**. Select a name to open it.
- On a source you can **Pause** it, **Resume** it, **Rotate token** (the old URL stops at once) or **Delete** it. Deleting removes its stored leads; contacts stay.
- **Leads received** shows each lead and its outcome. Open a lead for details and select **Retry** on one that needs review or failed.
- **Send a test lead** creates a real contact marked as a test. Nobody is notified.

## Send a first message to a new lead

A source can reply to a new lead by itself, so the person hears from you in minutes. It is off by default. On the source's **What happens to a lead** step (or its settings page), turn on **Send a first message automatically** and choose:

- **Channel**: a **WhatsApp template**, an **SMS** or an **email**. The list shows only templates that channel can really send: for WhatsApp, approved templates that need nothing but the contact (a name, for example); for email, shared templates.
- **Send from**: for SMS and email, the number or the shared mailbox. Leave it as the first connected one if you have only one.
- **Wait before sending**: 0 to 60 minutes.
- **Only during business hours**: outside the hours set for your workspace, the message waits for them to open.

The message goes only to a lead that becomes a **new** contact, once. A contact who comes back, or a test lead, gets none. It is sent through the same checks as every other message you start:

- **Consent is never assumed.** A WhatsApp utility template is a service message. A marketing template, an SMS or an email is marketing: where your workspace requires recorded consent, the contact needs it, and a contact who opted out is never messaged. A lead that arrives with proof of consent records it (see below).
- **Quiet hours** hold a marketing message until they end.
- **Your plan's limits and your wallet** apply. An empty wallet or a channel that is not connected holds the message; it goes when that is fixed, or is dropped after a day.

What happened to each lead's first message shows on the lead (**Leads received**, then the lead) and on the contact's timeline: **Sent**, **Held** (with the reason and the next try), **Blocked** (opted out, no consent, plan limit), **Skipped** (no number or address, no connected sender, the template is gone, or a value the template needs, such as a name, is missing) or **Failed**. If a name is missing, give the workspace attribute a default value (for example "there") so the template can still be filled.

## Plan and access

The tile needs the **Lead sources** plan feature and permission to read lead sources. Without the feature the screen offers **Upgrade plan**. When you have reached the number of sources your plan allows, creating another says how many you use, for example **You have used 5 of 5 lead sources**. Creating, changing, pausing, rotating, deleting, testing and retrying need the manage permission; with read access only you can look.

## If something looks wrong

- **A lead needs review.** The reason is shown, such as no email or phone, or an unreadable phone number. Fix the mapping or the default country code, then retry.
- **Nothing arrives.** Check the source is not paused, the URL is current and, with a shared secret, that your tool sends it in the `X-Webhook-Secret` header.
- **You lost the URL or token.** They cannot be shown again. Rotate the token to get a new URL.

## Proof of consent with a lead

A lead does not mean the person agreed to marketing, so a lead records no consent on its own. If your form tool or ad platform already holds the person's agreement, it can send it with the lead and it is recorded on the contact:

- Put a `consent` object in the body: `given` (true or yes), and at least one of `text` (the wording the person saw), `version`, `form_id` or `ad_id`. You can also send `at` (when they agreed) and `channels` (`whatsapp`, `sms`, `email`).
- Flat keys work too: `consent_given`, `consent_text`, `consent_version`, `consent_at`, `consent_form_id`, `consent_ad_id`, `consent_channels`.
- Without `channels`, a phone number is recorded for WhatsApp and an email address for email. SMS is recorded only when you name it.
- A `given` that is not a yes, or a yes with no wording, version, form or ad, records nothing.
- **Send test lead** never records consent. A person who opted out is never turned back on.

The Consent card of the contact shows the record with the source **Lead capture**.
