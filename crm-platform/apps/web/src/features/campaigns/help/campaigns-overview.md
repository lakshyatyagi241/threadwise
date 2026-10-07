---
id: campaigns-overview
title: Campaigns
summary: Message a chosen audience with a text, a rich message, a template or a flow, now, later or on repeat, and follow the results.
area: campaigns
order: 10
documents: [nav:campaigns]
keywords:
  [campaign, bulk, send, schedule, recurring, a/b test, csv, audience, delivery, replies, clicks]
---

## What it is for

A campaign sends one message to an audience of contacts, groups, tags or phone numbers: plain text, a rich message, an approved template or a flow. The Campaigns screen shows sent, delivered, read, replied, clicked and failed counts for each one.

## How to use it

1. Open **Campaigns** and select **New campaign**.
2. Under **Campaign setup**, enter a name and choose **Send from**. Left on **Default sender**, the campaign goes out on your workspace's main engine.
3. Under **Message**, pick **Text**, **Rich message**, **Template** or **Flow** and fill it in. Use `{{name}}` or `{{first_name}}` to personalise. For a template or flow, pick one from the list.
4. Under **Audience**, pick tags, groups or contacts, type numbers (one per line or comma separated), or upload a CSV with the columns name, country_code and phone. Any other column becomes a variable you can use in the message. **Download a sample** shows the layout.
5. Under **When to send**, choose **Send now**, **Schedule** (one date and time) or **Recurring** (every day, week or month, optionally until a date).
6. Check the live preview on the right, then select **Launch campaign**, **Schedule campaign** or **Save recurring campaign**. **Save as draft** keeps it for later.

> **Create broadcast** is a shorter four-step way to send an approved template, with a credit check, a test message, scheduling and retries. See [Create a broadcast](help:campaigns-create-broadcast).

## Options and settings

- **A/B test this campaign** sends a second version to part of the audience. You set the split, and the results appear per version on the campaign page.
- **Smart Delivery** paces sending: gaps between messages, batches, a daily limit and sending hours. Blank fields use the platform default.
- **Auto-end date** stops the campaign at that moment. **Track link clicks** records clicks on links.
- The list filters by status and message type. Each card offers the actions its status allows, and you can tick several cards to delete them together.
- A campaign page has the tabs **Overview**, **Messages**, **Engagement**, **Replies**, **Failures** and **Opt-outs**.

## Plan and access

You need the right to view campaigns to open the screen. Creating, editing, controlling (cancel, resume, send now, resend), exporting and deleting each need their own right, and the matching buttons are hidden without it. Your plan sets a limit on how many campaigns you can create.

## If something looks wrong

- **The form will not submit.** A list under the preview names what is missing, such as a name, a message, an audience or a send date.
- **Messages failed.** Open the **Failures** tab for the most common reasons, then use the button there to resend to the recipients that failed.
- **A template is not listed.** Some sending engines accept only templates that WhatsApp has approved. See [Message templates](help:message-templates-overview).
