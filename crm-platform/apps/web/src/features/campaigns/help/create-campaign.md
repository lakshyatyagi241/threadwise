---
id: campaigns-create
title: Create a campaign
summary: Choose the WhatsApp number, then send a template or a message to contacts, groups, segments or a CSV of numbers, now, later or on repeat.
area: campaigns
order: 20
documents: [nav:campaigns]
keywords:
  [
    campaign,
    broadcast,
    create,
    number,
    sender,
    empty,
    personal number,
    pending,
    verified,
    meta,
    cloud api,
    guided,
    wizard,
    template,
    audience,
    contacts,
    groups,
    segments,
    csv,
    filter,
    schedule,
    recurring,
    retries,
    test,
    variables,
    credit,
    email,
    subject,
    mailbox,
    ai,
    build with ai,
    picture,
    image,
  ]
---

## What it is for

Campaigns have one place to start: **Create campaign** on the Campaigns screen (what used to be broadcasts is part of campaigns now, and the old Broadcasts menu is gone). The number you send from decides whether you get the guided flow or the classic builder.

## One screen, one builder

**Create campaign** opens the campaign builder on the number the campaign is sent from (your default number is selected). The five steps along the top are **Setup**, **Compose**, **Recipients**, **Schedule** and **Review**, with the live preview on the right. The **Send from** select in **Setup** decides what the steps hold:

- **A verified WhatsApp Cloud API (Meta) number** keeps everything the classic builder has and adds the broadcast logic, described below. **Setup** has the **Campaign type** cards and **Enable A/B test**. **Compose** is a **Template** dropdown (name and language, only the approved templates of that number) with the variable mapping right under it, and a second dropdown and mapping for variant B when A/B is on. **Recipients** offers contacts, groups, segments and a CSV, with the filter panel and the live count. **Schedule** sends now, later or on a rule, with retries, the **Auto-end date**, **Smart Delivery** and **Track link clicks**. **Review** shows the cost, the summary and a test send, and the last button sends. The live preview shows your template as WhatsApp will. A number counts as verified when it is connected to Meta and Meta has not blocked it (banned, restricted, deleted, migrated or still pending), its code is verified and its display name was not declined.
- **Any other number** (Twilio, SMS, or a personal number when your platform allows them) keeps the classic steps: custom message, template or flow, A/B test, groups, tags, a CSV or typed numbers, and the classic live preview. See [Campaigns](help:campaigns-overview).
- **A mailbox** (an email campaign, opened from the **Email** card in **New campaign**) keeps the classic steps with only what an email can carry; see **Email campaigns** below.
- **A Meta number that is not verified yet** also keeps the classic steps, and a line next to the select says the guided steps are available once the number is verified.

If your default number is a verified Meta number, the builder opens with the guided steps already in place.

You can change the number at any time, and your campaign name comes along. When only the name was filled in, the steps simply change. Otherwise you are asked first, because the other steps start fresh: a guided campaign is saved as a draft in the Campaigns list before you leave, but the classic form is not saved, so use **Save draft** there if you want to keep it.

## When the Send from list is empty

The list only holds numbers that can send right now, and an empty list says why instead of leaving a blank select:

- **No WhatsApp number is connected.** Open **Connect a WhatsApp number** to add one on the WhatsApp numbers screen.
- **A number is still connecting, or its connection failed.** The message counts them. Open the number's status to finish the setup or reconnect it. It appears in the list once it is connected.
- **A number is disconnected.** Reconnect it. A personal number has its own screen, and the message links to it.
- **Personal numbers are turned off for this workspace.** Personal (QR) numbers only send while the platform has them on and your workspace is allowed to use them. A platform administrator turns that on for the workspace; until then, connect an official WhatsApp Business number.

The list loads while the page opens, and it refreshes when you come back to the page or the window regains focus, so a number you just connected shows up without reloading. You need the permission to create campaigns to see the list at all.

## Email campaigns

Choose the **Email** card in **New campaign**. The card shows when your plan includes Email and a mailbox is connected and you may send from it (a shared mailbox, or your own personal one). The builder then lists your mailboxes in **Send from**, shown with their address. If there is none, the box says whether no mailbox is connected, one is disconnected or one needs reconnecting, and links to the **Email** page.

- **Setup:** a name and the mailbox. There are no campaign type cards (an email is always a typed message, not a template or a flow) and no A/B test.
- **Compose:** the **Subject** (up to 150 characters; blank uses the campaign name) and the **Body**. There is no attachment, footer or buttons. An unsubscribe link is added at the bottom of every email, so you do not need to write an opt-out line. The preview on the right is an email card with the sender, subject and body.
- **Recipients:** the same ways to pick an audience, with the contact table showing each email address. Contacts with no address are skipped when the campaign runs, so are repeated addresses and opted-out contacts. Typed numbers and CSV rows have no address, so they are skipped: the step warns you, and Review shows **Skipped (no email address)** for the contacts it can see (contacts inside groups, tags and segments are checked when the campaign runs).
- **Schedule:** send now, later or recurring, and the **Auto-end date**. **Smart Delivery** (gaps, batches, daily limit, sending hours) and **Track link clicks** are not offered for email. **Retry failed messages automatically** stays.
- **Review:** shows the mailbox, the subject, the recipients and the schedule. Emails are not charged to your WhatsApp wallet. Your plan sets a monthly email limit (replies and campaign emails together): a campaign that starts when the month is used up does not send, and the mailbox's own hourly sending limit spreads a long campaign over several hours, so the rest of the recipients stay waiting and go out when it frees up.

## The guided steps

With a verified Meta number the builder walks you through sending an approved WhatsApp template. Your work is saved as a draft while you go, so you can close the page and come back: open the draft from the Campaigns list and it reopens with what you entered.

## How to use it

1. **Setup.** Enter a campaign name and check the WhatsApp number to **Send from** (the one you chose is preselected, and you can change it). **Campaign type** shows a custom message, a template and a flow. On the WhatsApp Cloud API only a template can be sent from a campaign, so the other two are shown greyed out with the reason; choose another kind of number to use them. Turn on **Enable A/B test** to split the recipients between two templates and set the share that gets variant A.
2. **Compose.** Choose a template from the **Template** dropdown. It lists the approved templates of the number, by name and language, the same ones the guided flow offers. For each variable of the template, choose **Contact field** (with a fallback for contacts that lack it) or **Fixed text**. Sample messages show the message for a few real contacts, and flag any placeholder that came out empty. With A/B on, choose the variant B template too and map its variables the same way. The live preview on the right shows the message.
3. **Recipients.** Under **Send to** choose one of four ways to pick who gets the campaign. Each keeps its own selection, and the campaign goes to everyone selected in any of them, once. The chips above the panel count what each holds. Opted-out contacts and invalid numbers are always skipped. The **Matching contacts** panel shows who matches, who is skipped and who **will be messaged**, and the phone preview shows your template.
   - **Send to contacts** is a table of your contacts. Search by name, email or phone, or press **Filter** to open the filter panel: add conditions (country code, tags, a custom property...), then **Apply**; **Clear** removes them. The table and its total are worked out on the server. Tick rows, tick the box in the header for the whole page, and when the page is ticked choose **Select all N matching** to take every contact the search and filter found. Opted-out contacts are listed but cannot be ticked. The footer has the total, the pages and how many rows per page.
   - **Send to groups** lists your contact groups (your marketing lists) with their member counts. Tick any number.
   - **Send to segments** lists your saved segments. Tick any number.
   - **Send via CSV** takes a file of numbers (up to 2 MB and 10,000 rows) with a column named `phone`, and optionally `first_name`, `last_name` or `name` and `country_code`. Download the template from the panel. The file is checked on the server: numbers are put in international format, repeated numbers are kept once, and rows that cannot be used are listed with their line number (the whole list downloads as a CSV). You see how many numbers are valid, duplicate, invalid, opted out and new. Numbers that are already contacts are matched by phone. New numbers are added as contacts when you launch. The upload is kept for 7 days.
4. **Schedule.** Choose **When to send** (see below). You can also set an **Auto-end date** (a send stops at that moment; a recurring campaign ends by its own rule instead), turn on **Activate Retries**, tune **Smart Delivery** (a random delay between messages, batches with a pause, a daily limit and the hours it may send in; blank uses the platform default) untick **Retry failed messages automatically** to send each message once (it is on by default: a message that fails for a temporary reason is tried again a few times), and untick **Track link clicks** if you do not want links wrapped to count clicks. On a Cloud API number the **Follow-ups** card sits here too (see below).
5. **Review.** The credit check compares your wallet with the estimated cost, with a breakdown by country. If the balance is too low, **Next** is blocked and **Top up** takes you to add credit. The summary lists everything, with **Edit** links back to the step that owns each value. You can send a test first (see below). The last button sends, schedules or starts the recurring campaign.

## Build with AI

**Build with AI** drafts for you; you always review before anything is sent. It needs an AI provider enabled for your workspace (a platform key or your own key); with none, the dialog says so and **Generate** stays off.

- **Classic builder.** The **Build with AI** button in the top bar opens a short brief: the AI model, business name, product, goal, tone, call to action, audience, offer and notes. **Generate campaign** fills the message, footer, link button and quick replies (up to three buttons) and opens **Compose**; a name you already typed is kept. Nothing is saved until you save or send.
- **Also create a picture.** Tick it to have one image drawn from the same brief and attached as the campaign's **Attachment** once the text is in. Pick the shape: square, landscape or portrait. Pictures are drawn by OpenAI only, so the box is off until you choose an OpenAI model, and off for senders that cannot carry an image (SMS and email). If the picture fails (no OpenAI key, the monthly allowance used, or OpenAI refusing the request), the text stays in the form and the dialog shows a separate message with **Try the picture again**, which draws only the picture.
- **Guided flow.** Next to the template list, **Build with AI** drafts a new WhatsApp template (marketing, in US English) and opens the new-template form with the draft filled in. Meta reviews every template before it can be sent, so come back to your draft campaign (it was saved as you went) and pick the template once it is approved. The button shows only if you may create templates.

## Send a test

Type one or more phone numbers in the format `+91xxxxxxxxxx`, separated by commas (up to 10). **Send Test** stays off until every number is valid. Tracking is not enabled for tests, and credits are deducted for the WhatsApp messages the test sends. Each number shows sent, delivered, read or failed, with the error and the amount charged. You need the permission to test campaigns to use this.

## When to send

- **Send now** sends right away, once.
- **Schedule campaign** sends once at the date and time you pick, in the time zone you choose (your workspace's by default). The date must be in the future.
- **Recurring campaign** sends again and again on a rule: daily, weekly (pick the weekdays) or monthly, every N days, weeks or months, ending never, on a date or after a number of runs. A sentence under the heading says what the rule does, and **Next runs** lists the first five. Each run goes to the audience as it is at that time. On the 31st, shorter months use their last day.

## Retries

Turn on **Activate Retries** and set an end date to try again the messages that Meta holds back because of its frequency cap (error 131049). Retries run at exactly 24-hour intervals until the end date, and cost nothing extra: you are only charged for a message when it is delivered.

## Follow-ups

On a Cloud API number, **Add a follow-up** sends another message, or starts a flow, depending on what the contact does after the campaign message. You can chain up to 3 steps. Follow-ups need a Cloud API number because Meta's delivery reports tell us who read or replied; with another kind of number the card is switched off and says so.

For each step, choose when it fires and how long to count:

- **Replies** or **Reads the message:** the contact is watched for the time you set. The step fires the moment they reply to, or read, the previous message. If the time runs out first, the sequence ends there.
- **Has not replied** or **Has not read the message:** we wait the time you set, then fire if they have not. If they did reply or read, the sequence ends there.

Set the time as a number of minutes, hours or days (from 1 minute up to 7 days). Step 1 counts from the campaign message, step 2 from the message of step 1, and so on. Then choose **Send a template** (any approved template) or **Start a flow** (one of your flows), and pick it. Each step needs its template or flow before you can continue, and **Remove** deletes a step. The summary in step 3 lists the follow-ups in words. A contact who opted out, whose message failed, or who stopped receiving the chain does not get a later step. A recurring campaign carries its follow-ups to every run.

### Templates in order

A recurring campaign can send a different template on each run. When **When to send** is **Recurring campaign**, the **Templates in order** card appears on the Schedule step (the last step of the guided flow). The template you chose for the campaign is **Template 1** and cannot be changed there. **Add a template** adds a step with a dropdown of the approved templates, up to 10 templates in all; **Up**, **Down** and **Remove** change the order, and **Remove all** empties the list. Run 1 sends template 1, run 2 sends template 2, and so on; after the last one the list starts again from the first.

Each added template has its own variable mapping, because its placeholders can differ. A card titled with its name and position appears once the template is chosen, and every placeholder must be mapped before you can continue. The summary lists them under **Sends in turn**, and the status page shows how many templates are in turn and which template each run sent.

> Templates in order only work with a recurring schedule and cannot be combined with an A/B test. If you switch to another schedule, or turn A/B on, the list stays but is locked, with the reason shown; remove the extra templates or switch back to continue.

## Launch

The last button reads **Send now**, **Schedule** or **Start recurring**. It opens a confirmation with the name, template, recipients, skipped contacts, estimated cost, schedule and retries. After you confirm you land on the campaign's status page.

## The status page

It shows the status, the schedule in words, the next run, the runs with their counts, the retry summary, and, under each run that has follow-ups, what every step did: waiting, sent, delivered, read, flows started, skipped (the condition was not met), lapsed (the watch time ran out) and failed. If you have the permission to control campaigns, you can **Pause**, **Resume** or **Cancel** it. When a finished run has failed recipients, **Retry failed (N)** sends again to just those recipients (a recurring campaign does it for every finished run); everyone who already got the message is left alone, and a message is charged only when it is delivered. It asks you to confirm first, and it is not offered while the failing run is still going. Each run links to its campaign page, and shows the template it sent when the campaign sends templates in order. The page refreshes every 15 seconds.

**Export rows** downloads the recipients as a CSV (needs the permission to export campaigns). For a recurring campaign it is one file with a **Run** column, run by run. **Delete** (needs the permission to delete campaigns) removes a one-off campaign that is still waiting for its time or that failed outright, together with its recipients. A recurring campaign can be deleted, with the runs it had planned, only while none of its runs has sent a message; once one has, its history is kept and you cancel it instead. The campaign page of any run has a **Broadcast status** button that opens this page.

## If something looks wrong

- **Could not save** next to the title means the last change is not saved yet. Press **Retry**; the page asks before you leave with unsaved changes.
- A banner saying the draft was changed somewhere else means someone saved it from another tab. Choose **Reload draft** to continue from the latest version.
- **Insufficient balance** on the launch sends you back to **Review**. Top up and continue.
- A launched campaign cannot be edited. Its draft shows a link to the status page instead.

## Consent for a CSV of numbers

Before you choose the file in **Send via CSV**, you can tick **I have consent to message these numbers** and, if you want, write the notice or lawful basis they agreed under and its version. The choice is kept with the upload. When you launch, every number in the file (new contacts and existing ones) is recorded as having agreed to marketing, with the file name and your notice as proof; people who opted out are skipped and stay opted out. If the workspace requires recorded consent for marketing, numbers of a confirmed file count as consented. Without the tick, nothing is recorded and the numbers stay "No consent recorded".
