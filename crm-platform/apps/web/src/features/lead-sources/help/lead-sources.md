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
