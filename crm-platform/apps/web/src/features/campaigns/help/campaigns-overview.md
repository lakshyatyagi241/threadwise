---
id: campaigns-overview
title: Campaigns
summary: Message a chosen audience with a text, a rich message, a template or a flow, now, later or on repeat, and follow the results.
area: campaigns
order: 10
documents: [nav:campaigns]
keywords:
  [
    campaign,
    bulk,
    send,
    schedule,
    recurring,
    a/b test,
    csv,
    audience,
    delivery,
    replies,
    clicks,
    ai,
    wizard,
    broadcast,
    email,
    subject,
    mailbox,
    unsubscribe,
  ]
---

## What it is for

A campaign sends one message to an audience of contacts, groups, tags or phone numbers: plain text, a rich message, an approved template or a flow. The Campaigns screen shows sent, delivered, read, replied, clicked and failed counts for each one, and its **Cost**: what was charged to your wallet for the messages delivered so far (it grows while the campaign runs, and stays 0 for messages covered by your plan).

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
- **Auto-end date** stops the campaign at that moment. **Track link clicks** records clicks on links. **Retry failed messages automatically** (on by default) tries a message again a few times when it fails for a temporary reason; switch it off to send each message once, and use **Resend** later if you need to.
- **Email campaigns** use the same steps with a mailbox as the sender. Open them from **New campaign**: the **Email** card shows once a mailbox is connected (see [Email](help:email-mailboxes)) and your plan includes Email. **Setup** has no kind cards and no A/B test, because an email is always a typed message. In **Compose** the **Header** field becomes the **Subject** (up to 150 characters; left blank, the campaign name is used), and there is no attachment, footer or buttons. An unsubscribe link is added at the bottom of every email. **Recipients** and **Schedule** work as above (send now, later, recurring, auto-end date), but without **Smart Delivery** and **Track link clicks**. Contacts with no email address, repeated addresses and opted-out contacts are skipped, and the review lists how many chosen contacts have no address; typed numbers and CSV rows have none, so use contacts, groups, tags or segments. Emails are not charged to your WhatsApp wallet. Your plan sets a monthly email limit (replies and campaign emails together): a campaign that starts when the month is used up does not send, and the mailbox's own hourly sending limit spreads a long campaign over several hours, so the rest of the recipients stay waiting and go out when it frees up.
- The list filters by status and message type. Each card offers the actions its status allows, and you can tick several cards to delete them together.
- **New campaign** opens the campaign builder straight away when WhatsApp is your only channel. When you also have SMS, Email, Telegram, a Facebook Page or Instagram connected, it first asks you to pick a channel. WhatsApp, SMS and Email open the campaign builder; Telegram, Facebook and Instagram open their own composer, which sends to the people who already messaged that bot, Page or account (Facebook only within 24 hours of their last message).
- A campaign page has the tabs **Overview**, **Statistics**, **Messages**, **Engagement**, **Replies**, **Failures** and **Opt-outs**. While a campaign is scheduled or running, a **Live** line above the numbers shows when they were last read, and the numbers refresh every 12 seconds while the tab is on screen. The **Recipients** tile also says how many are still waiting to send and how many are being sent right now. When the campaign finishes the refresh stops and the final numbers stay. The **Statistics** tab shows where every recipient is right now (each counted once, so the rows add up to the audience), the delivery, read, reply, click and failure rates, and the campaign's timeline: when it was created, when it was set to start, when the first message went out, the last run and when it finished.

## Plan and access

You need the right to view campaigns to open the screen. Creating, editing, controlling (cancel, resume, send now, resend), exporting and deleting each need their own right, and the matching buttons are hidden without it. Your plan sets a limit on how many campaigns you can create.

## If something looks wrong

- **Next does not move on.** A list under the buttons names what is missing, such as a name, a message, an audience or a send date.
- **Build with AI says no provider is enabled.** An admin has to switch on an AI provider for the platform, or your workspace has to add its own key.
- **Messages failed.** Open the **Failures** tab for the most common reasons, then use the button there to resend to the recipients that failed. A campaign made with the guided flow has the same **Retry failed** button on its status page.
- **A template is not listed.** Some sending engines accept only templates that WhatsApp has approved. See [Message templates](help:message-templates-overview).
