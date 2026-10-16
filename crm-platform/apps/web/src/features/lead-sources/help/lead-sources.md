---
id: lead-sources
title: Social leads
summary: Bring leads from ads and forms into your contacts through a webhook or Meta lead forms: map fields, send a test lead, retry leads that need review.
area: settings
order: 15
documents: [tile:lead-sources]
keywords: [lead ads, webhook, zapier, make, forms, capture, attribution, campaign, import leads, meta, facebook, instagram, lead forms]
---

## What it is for

**Social leads** turns leads from your ads, forms and landing pages into contacts. There are two ways in. A webhook source has its own URL, and your collecting tool (Zapier, Make, a landing-page builder or your own form) posts each lead to it. A **Meta lead forms** source reads the leads of a Facebook or Instagram lead form straight from your Facebook Page. Either way the lead becomes a contact with its source recorded, an owner, an optional deal and a notification.

## How to use it

1. Open **Settings**, then **Channels**, then **Social leads**, or go to `/lead-sources`. The **Ads** tab shows where leads can come from. The **Webhook** and **Meta lead forms** cards are available; LinkedIn, TikTok and Google Ads are marked **Coming soon**.
2. Select **New source** and work through the wizard:
   1. **Basics**: a name, a platform label, an optional shared secret and how long to keep raw lead data.
   2. **What happens to a lead**: default country code, starting lifecycle stage, tag, owner, optional deal and notifications. Select **Create source**.
   3. **Connect your sender**: copy the URL and token into your tool. They are shown only once.
   4. **Map the fields**: say where each value sits in your tool's data. The **Live preview** shows the result as you type.
3. Select **Save and finish**, or **Skip for now** to map later.

## Meta lead forms

Open the **Meta lead forms** card on the **Ads** tab and select **Open Meta lead forms**. The card says how many Pages are connected and how many forms are picked. You need the Lead sources plan feature and the Facebook channel (extra channels) plan feature.

1. **Connect a Facebook Page.** Select **Connect a Facebook Page**. You are sent to Facebook to log in and to allow the permissions Meta requires to read leads, then brought back here with a message that says whether it worked. This needs permission to manage lead sources and to manage Facebook Pages.
2. **Grant lead access, if asked.** A Page connected earlier through the Facebook channel may lack the lead permissions. Its card shows **Lead access missing** and a **Grant lead access** button that repeats the login. A Page whose connection Meta no longer accepts shows **Reconnect** instead.
3. **Turn on lead sync.** Select **Turn on lead sync** on the Page. Meta then delivers new leads to this workspace. **Turn off lead sync** stops new leads after you confirm; the forms you picked and the leads already stored are kept.
4. **Choose lead forms.** Select **Choose lead forms** to list the Page's forms as Meta reports them. Select **Pick** on a form to bring its leads in. The **Map fields** dialog opens straight away.
5. **Map the questions.** Each question of the form can go to Full name, First name, Last name, Email, Phone, one of your contact properties, or stay on **Automatic**, which looks under the usual names. We fill in what each question's type suggests; check it and select **Save mapping**. Two questions cannot go to the same field. Any attribution mapping on the source is kept.
6. **Set the assignment.** Select **Assignment and deal** to choose the owner rule, whether each lead opens a deal, who is notified and the starting stage, the same rules every source has.

Select **Stop** on a picked form to stop bringing its leads in. After you confirm, its lead source and the leads stored under it are deleted; contacts already created stay, and you can pick the form again later.

### What the states mean

- **Receiving leads**: lead sync is on and Meta is delivering. A regular check also picks up leads Meta delivered late or not at all.
- **Lead sync off**: nothing arrives until you turn it on.
- **Needs lead access**: the Page lacks a lead permission. Use **Grant lead access**.
- **Needs reconnect**: Meta no longer accepts the Page's connection. Use **Reconnect**.
- **Error**: Meta refused something on the last attempt. The message on the Page says what and clears after the next success.

If no Meta app is set up on the install, the card says an administrator has to add it. Managers also see the callback address to register in the Meta app dashboard, whether the install has a verify token, and the steps: add the callback address under Webhooks for the Page object, enter the verify token from the install's Facebook settings, and subscribe the Page object to the leadgen field.

Each picked form appears as a source on the **Webhook** tab, with the type **Meta lead forms** and **From Meta** where other sources show a URL. Open it to see the leads it received, a **Meta lead form health** card with the Page, the form, the lead sync state, the last lead and the last error, and the settings. It has no URL or token, so there is nothing to rotate, and it is ended with **Stop** on the Ads tab rather than deleted from its own page.

## Managing a source

- The **Webhook** tab lists your sources and any leads that **Need attention**. Select a name to open it.
- On a source you can **Pause** it, **Resume** it, **Rotate token** (the old URL stops at once) or **Delete** it. Deleting removes its stored leads; contacts stay.
- **Leads received** shows each lead and its outcome. Open a lead for details and select **Retry** on one that needs review or failed.
- **Send a test lead** creates a real contact marked as a test. Nobody is notified.

## Plan and access

The tile needs the **Lead sources** plan feature and permission to read lead sources. Without the feature the screen offers **Upgrade plan**. Creating, changing, pausing, rotating, deleting, testing and retrying need the manage permission; with read access only you can look.

## If something looks wrong

- **A lead needs review.** The reason is shown, such as no email or phone, or an unreadable phone number. Fix the mapping or the default country code, then retry.
- **Nothing arrives.** Check the source is not paused, the URL is current and, with a shared secret, that your tool sends it in the `X-Webhook-Secret` header.
- **Nothing arrives from a Meta form.** Open the Page on the Ads tab: lead sync must be on, the state must read **Receiving leads**, and the form must be picked. Fix a **Needs lead access** or **Needs reconnect** state first.
- **You lost the URL or token.** They cannot be shown again. Rotate the token to get a new URL.

## Proof of consent with a lead

A lead does not mean the person agreed to marketing, so a lead records no consent on its own, except where a Meta lead form has a consent checkbox of its own: the picker marks those forms, and a ticked checkbox is recorded as proof of consent with its wording. If your form tool or ad platform already holds the person's agreement, it can send it with the lead and it is recorded on the contact:

- Put a `consent` object in the body: `given` (true or yes), and at least one of `text` (the wording the person saw), `version`, `form_id` or `ad_id`. You can also send `at` (when they agreed) and `channels` (`whatsapp`, `sms`, `email`).
- Flat keys work too: `consent_given`, `consent_text`, `consent_version`, `consent_at`, `consent_form_id`, `consent_ad_id`, `consent_channels`.
- Without `channels`, a phone number is recorded for WhatsApp and an email address for email. SMS is recorded only when you name it.
- A `given` that is not a yes, or a yes with no wording, version, form or ad, records nothing.
- **Send test lead** never records consent. A person who opted out is never turned back on.

The Consent card of the contact shows the record with the source **Lead capture**.
