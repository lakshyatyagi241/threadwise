---
id: campaigns-overview
title: Campaigns
summary: Message a chosen audience with a text, a rich message, a template or a flow, now, later or on repeat, and follow the results.
area: campaigns
order: 10
documents: [nav:campaigns]
keywords: [campaign, bulk, send, schedule, recurring, a/b test, csv, audience, delivery, replies, clicks, ai, wizard, broadcast]
---

## What it is for

A campaign sends one message to an audience of contacts, groups, tags or phone numbers: plain text, a rich message, an approved template or a flow. The Campaigns screen shows sent, delivered, read, replied, clicked and failed counts for each one.

## How to use it

1. Open **Campaigns** and select **New WA campaign**. The screen opens on your default **Send from** number: a verified WhatsApp Cloud API (Meta) number fills the same steps with the guided logic (see [Create a campaign](help:campaigns-create)), any other number keeps the classic steps described here. The classic builder has five steps along the top: **Setup**, **Compose**, **Recipients**, **Schedule** and **Review**. **Next** only moves on when the current step has what it needs, and a list under the buttons names what is missing.
2. **Setup:** enter a campaign name and choose the sender. Pick the kind: **Custom message**, **Use template** or **Flow builder**. Turn on **Enable A/B test** to split the audience between two versions.
3. **Compose:** for a custom message, fill in the optional **Header**, the **Body** (use `{{name}}` or `{{first_name}}` to personalise), an optional **Attachment** (image, video or document), an optional **Footer** and up to three **Buttons** (call to action, quick reply or a mix). For a template or flow, pick one from the list; a template shows its variables to fill in for this send.
4. **Recipients:** choose one way to pick the audience. **Contact groups** uses saved groups, tags, segments and individual contacts. **Upload CSV** takes a file with the columns name, country_code and phone, and any other column becomes a variable. **Manual numbers** takes one number per line.
5. **Schedule:** choose **Send now**, **Schedule later** (one date and time) or **Recurring** (every day, week or month, optionally until a date). Under **Smart delivery** you can pace the sending.
6. **Review:** check the summary, the validation checklist and the recipient counts, then select **Launch campaign**, **Schedule campaign** or **Save recurring campaign**. **Save draft** at the top keeps it for later without sending.

The panel on the right shows a live preview of the message and the recipients, schedule, type and A/B choices as you fill them in.

**Build with AI** (top right) opens a short brief: the AI model, your business name, product, goal, tone, call to action, audience and offer. It writes a name, message, footer, link button and up to three quick replies into the Compose step for you to review and edit. It needs an AI provider that your workspace or the platform has switched on; the model list is empty otherwise.

> A verified Meta number keeps the same five steps but fills them with the guided logic instead: a template dropdown with its variables, contacts, groups, segments or a CSV, scheduling, recurring sends and retries, a credit check and a test message. See [Create a campaign](help:campaigns-create). Past, scheduled and recurring campaigns are all on the **Campaigns** list, each with its state.

## Options and settings

- **Enable A/B test** sends a second version to part of the audience. You set the split in Setup and write the second message, template or flow in Compose; the results appear per version on the campaign page.
- **Smart Delivery** paces sending: gaps between messages, batches, a daily limit and sending hours. Blank fields use the platform default.
- **Auto-end date** stops the campaign at that moment. **Track link clicks** records clicks on links.
- The list filters by status and message type. Each card offers the actions its status allows, and you can tick several cards to delete them together.
- A campaign page has the tabs **Overview**, **Messages**, **Engagement**, **Replies**, **Failures** and **Opt-outs**.

## Plan and access

You need the right to view campaigns to open the screen. Creating, editing, controlling (cancel, resume, send now, resend), exporting and deleting each need their own right, and the matching buttons are hidden without it. Your plan sets a limit on how many campaigns you can create.

## If something looks wrong

- **Next does not move on.** A list under the buttons names what is missing, such as a name, a message, an audience or a send date.
- **Build with AI says no provider is enabled.** An admin has to switch on an AI provider for the platform, or your workspace has to add its own key.
- **Messages failed.** Open the **Failures** tab for the most common reasons, then use the button there to resend to the recipients that failed.
- **A template is not listed.** Some sending engines accept only templates that WhatsApp has approved. See [Message templates](help:message-templates-overview).
