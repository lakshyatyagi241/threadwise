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
   3. **Connect your sender**: copy the URL and token into your tool. They are shown only once. The URL is complete, with your platform's public address in front. If the platform's public API address has not been set (or points at a private address), you see only the path and a warning; ask whoever runs your platform to set it, then rotate the token to get the full URL.
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

## Send a first message to a new lead

A source can reply to a new lead by itself, so the person hears from you in minutes. It is off by default. On the source's **What happens to a lead** step (or its settings page), turn on **Send a first message automatically** and choose:

- **Channel**: a **WhatsApp template**, an **SMS** or an **email**. The list shows only templates that channel can really send: for WhatsApp, approved templates that need nothing but the contact (a name, for example); for email, shared templates.
- **Send from**: for SMS and email, the number or the shared mailbox. Leave it as the first connected one if you have only one.
- **Wait before sending**: 0 to 60 minutes.
- **Only during business hours**: outside the hours set for your workspace, the message waits for them to open.
- **Do not message leads older than**: one hour unless you choose otherwise (up to 90 days). A lead that reaches you late, for example from a backfill, a retry or a missed sync, is still saved, assigned and announced to your team, but it gets no first message once it is older than this. Choose a longer time only if you want old leads messaged. The consent checks below still apply.

The message goes only to a lead that becomes a **new** contact, once. A contact who comes back, or a test lead, gets none. It is sent through the same checks as every other message you start:

- **Consent is never assumed.** A WhatsApp utility template is a service message. A marketing template, an SMS or an email is marketing: where your workspace requires recorded consent, the contact needs it, and a contact who opted out is never messaged. A lead that arrives with proof of consent records it (see below).
- **Quiet hours** hold a marketing message until they end.
- **Your plan's limits and your wallet** apply. An empty wallet or a channel that is not connected holds the message; it goes when that is fixed, or is dropped after a day.

What happened to each lead's first message shows on the lead (**Leads received**, then the lead) and on the contact's timeline: **Sent**, **Held** (with the reason and the next try), **Blocked** (opted out, no consent, plan limit), **Skipped** (no number or address, no connected sender, the template is gone, a value the template needs, such as a name, is missing, or the lead is older than the limit above) or **Failed**. If a name is missing, give the workspace attribute a default value (for example "there") so the template can still be filled.

## Lead inbox: every lead in one place

The **Lead inbox** tab lists every lead any of your sources received, newest first, including the ones that could not become a contact. It opens on the leads that wait (**Needs attention**: needs review or failed) with test leads hidden; the chips above the list show the counts and switch to **All**, **Created**, **Duplicates** and the rest.

- **Filter** by source, reason, when it arrived (24 hours, 7 or 30 days, or your own dates), test leads, and the start of the sender's own lead id. Names, numbers and addresses are never searched.
- **Open** a lead to see why it waits, its first message and the data the sender sent. Phone numbers, email addresses, names, addresses and free text are hidden and secrets removed; **Show the original** reveals them and is recorded in the audit log.
- **Retry** one lead, or tick several (up to 100 at a time) and select **Retry selected**. Each is processed again from its stored data under the source's current settings, so fix the mapping or the default country code first. A lead already fixed is reported as not waiting and nothing is created twice. A lead whose stored data was deleted after its retention period, or whose source is paused, cannot be retried.

### Sync now and backfill

Sources that can be asked for their leads are listed under the table: the portals you installed from the Marketplace, and each **Meta lead form** you picked. **Sync now** fetches what is new; the source's own limit decides how soon you can do it again and the screen says how long to wait. **Backfill...** pulls a past date range again (up to 90 days, and no further back than the source keeps leads; Meta keeps a lead for about 90 days). Both run in the background, one at a time per source, and show their progress and counts: new leads, leads you already had, and leads that could not be handed over. Leads you already have are recognised, so running a backfill twice adds nothing twice. Managers can start them; everyone who can see Social leads can watch.

Backfilled leads are treated like new ones: they become contacts, are assigned to an owner by the source's rule and notify your team. What they do **not** get is the automatic first message, unless they are younger than the source's **Do not message leads older than** limit (one hour by default). Consent works exactly as for any lead: a Meta lead is recorded as having agreed only when it ticked the form's own consent checkbox.

If Meta slows a run down, it waits and tries again by itself; if Meta keeps asking it to wait, the run ends **Partly done** with "The source asked us to wait", and what it already brought in is kept. Run it again later. A run that fails with "Meta did not allow this Page to read leads" or "The source refused the credentials" needs you to open **Meta lead forms**, grant lead access or reconnect the Page, and run it again.

## Plan and access

The tile needs the **Lead sources** plan feature and permission to read lead sources. Without the feature the screen offers **Upgrade plan**. When you have reached the number of sources your plan allows, creating another says how many you use, for example **You have used 5 of 5 lead sources**. Creating, changing, pausing, rotating, deleting, testing and retrying need the manage permission; with read access only you can look.

## If something looks wrong

- **A lead needs review.** The reason is shown, such as no email or phone, or an unreadable phone number. Fix the mapping or the default country code, then retry.
- **Nothing arrives.** Check the source is not paused, the URL is current and, with a shared secret, that your tool sends it in the `X-Webhook-Secret` header.
- **Nothing arrives from a Meta form.** Open the Page on the Ads tab: lead sync must be on, the state must read **Receiving leads**, and the form must be picked. Fix a **Needs lead access** or **Needs reconnect** state first. To bring in a lead that was missed, use **Sync now** on the Lead inbox tab.
- **You lost the URL or token.** They cannot be shown again. Rotate the token to get a new URL.

## Proof of consent with a lead

A lead does not mean the person agreed to marketing, so a lead records no consent on its own, except where a Meta lead form has a consent checkbox of its own: the picker marks those forms, and a ticked checkbox is recorded as proof of consent with its wording. If your form tool or ad platform already holds the person's agreement, it can send it with the lead and it is recorded on the contact:

- Put a `consent` object in the body: `given` (true or yes), and at least one of `text` (the wording the person saw), `version`, `form_id` or `ad_id`. You can also send `at` (when they agreed) and `channels` (`whatsapp`, `sms`, `email`).
- Flat keys work too: `consent_given`, `consent_text`, `consent_version`, `consent_at`, `consent_form_id`, `consent_ad_id`, `consent_channels`.
- Without `channels`, a phone number is recorded for WhatsApp and an email address for email. SMS is recorded only when you name it.
- A `given` that is not a yes, or a yes with no wording, version, form or ad, records nothing.
- **Send test lead** never records consent. A person who opted out is never turned back on.

The Consent card of the contact shows the record with the source **Lead capture**.
