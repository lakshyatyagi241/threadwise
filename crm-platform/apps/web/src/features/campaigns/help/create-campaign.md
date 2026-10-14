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
  ]
---

## What it is for

Campaigns have one place to start: **Create campaign** on the Campaigns screen (what used to be broadcasts is part of campaigns now, and the old Broadcasts menu is gone). The number you send from decides whether you get the guided flow or the classic builder.

## One screen, one builder

**Create campaign** opens the campaign builder on the number the campaign is sent from (your default number is selected). The five steps along the top are **Setup**, **Compose**, **Recipients**, **Schedule** and **Review**, with the live preview on the right. The **Send from** select in **Setup** decides what the steps hold:

- **A verified WhatsApp Cloud API (Meta) number** keeps everything the classic builder has and adds the broadcast logic, described below. **Setup** has the **Campaign type** cards and **Enable A/B test**. **Compose** is a **Template** dropdown (name and language, only the approved templates of that number) with the variable mapping right under it, and a second dropdown and mapping for variant B when A/B is on. **Recipients** offers contacts, groups, segments and a CSV, with the filter panel and the live count. **Schedule** sends now, later or on a rule, with retries, the **Auto-end date**, **Smart Delivery** and **Track link clicks**. **Review** shows the cost, the summary and a test send, and the last button sends. The live preview shows your template as WhatsApp will. A number counts as verified when it is connected to Meta and Meta has not blocked it (banned, restricted, deleted, migrated or still pending), its code is verified and its display name was not declined.
- **Any other number** (Twilio, SMS, or a personal number when your platform allows them) keeps the classic steps: custom message, template or flow, A/B test, groups, tags, a CSV or typed numbers, and the classic live preview. See [Campaigns](help:campaigns-overview).
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

## The guided steps

With a verified Meta number the builder walks you through sending an approved WhatsApp template. Your work is saved as a draft while you go, so you can close the page and come back: open the draft from the Campaigns list and it reopens with what you entered.

## How to use it

1. **Setup.** Enter a campaign name and check the WhatsApp number to **Send from** (the one you chose is preselected, and you can change it). **Campaign type** shows a custom message, a template and a flow. On the WhatsApp Cloud API only a template can be sent from a campaign, so the other two are shown greyed out with the reason; choose another kind of number to use them. Turn on **Enable A/B test** to split the recipients between two templates and set the share that gets variant A.
2. **Compose.** Choose a template from the **Template** dropdown. It lists the approved templates of the number, by name and language. For each variable of the template, choose **Contact field** (with a fallback for contacts that lack it) or **Fixed text**. Sample messages show the message for a few real contacts, and flag any placeholder that came out empty. With A/B on, choose the variant B template too and map its variables the same way. The live preview on the right shows the message.
3. **Recipients.** Under **Send to** choose one of four ways to pick who gets the campaign. Each keeps its own selection, and the campaign goes to everyone selected in any of them, once. The chips above the panel count what each holds. Opted-out contacts and invalid numbers are always skipped. The **Matching contacts** panel shows who matches, who is skipped and who **will be messaged**, and the phone preview shows your template.
   - **Send to contacts** is a table of your contacts. Search by name, email or phone, or press **Filter** to open the filter panel: add conditions (country code, tags, a custom property...), then **Apply**; **Clear** removes them. The table and its total are worked out on the server. Tick rows, tick the box in the header for the whole page, and when the page is ticked choose **Select all N matching** to take every contact the search and filter found. Opted-out contacts are listed but cannot be ticked. The footer has the total, the pages and how many rows per page.
   - **Send to groups** lists your contact groups (your marketing lists) with their member counts. Tick any number.
   - **Send to segments** lists your saved segments. Tick any number.
   - **Send via CSV** takes a file of numbers (up to 2 MB and 10,000 rows) with a column named `phone`, and optionally `first_name`, `last_name` or `name` and `country_code`. Download the template from the panel. The file is checked on the server: numbers are put in international format, repeated numbers are kept once, and rows that cannot be used are listed with their line number (the whole list downloads as a CSV). You see how many numbers are valid, duplicate, invalid, opted out and new. Numbers that are already contacts are matched by phone. New numbers are added as contacts when you launch. The upload is kept for 7 days.
4. **Schedule.** Choose **When to send** (see below). You can also set an **Auto-end date** (a send stops at that moment; a recurring campaign ends by its own rule instead), turn on **Activate Retries**, tune **Smart Delivery** (a random delay between messages, batches with a pause, a daily limit and the hours it may send in; blank uses the platform default) untick **Retry failed messages automatically** to send each message once (it is on by default: a message that fails for a temporary reason is tried again a few times), and untick **Track link clicks** if you do not want links wrapped to count clicks.
5. **Review.** The credit check compares your wallet with the estimated cost, with a breakdown by country. If the balance is too low, **Next** is blocked and **Top up** takes you to add credit. The summary lists everything, with **Edit** links back to the step that owns each value. You can send a test first (see below). The last button sends, schedules or starts the recurring campaign.

## Send a test

Type one or more phone numbers in the format `+91xxxxxxxxxx`, separated by commas (up to 10). **Send Test** stays off until every number is valid. Tracking is not enabled for tests, and credits are deducted for the WhatsApp messages the test sends. Each number shows sent, delivered, read or failed, with the error and the amount charged. You need the permission to test campaigns to use this.

## When to send

- **Send now** sends right away, once.
- **Schedule campaign** sends once at the date and time you pick, in the time zone you choose (your workspace's by default). The date must be in the future.
- **Recurring campaign** sends again and again on a rule: daily, weekly (pick the weekdays) or monthly, every N days, weeks or months, ending never, on a date or after a number of runs. A sentence under the heading says what the rule does, and **Next runs** lists the first five. Each run goes to the audience as it is at that time. On the 31st, shorter months use their last day.

## Retries

Turn on **Activate Retries** and set an end date to try again the messages that Meta holds back because of its frequency cap (error 131049). Retries run at exactly 24-hour intervals until the end date, and cost nothing extra: you are only charged for a message when it is delivered.

## Launch

The last button reads **Send now**, **Schedule** or **Start recurring**. It opens a confirmation with the name, template, recipients, skipped contacts, estimated cost, schedule and retries. After you confirm you land on the campaign's status page.

## The status page

It shows the status, the schedule in words, the next run, the runs with their counts, and the retry summary. If you have the permission to control campaigns, you can **Pause**, **Resume** or **Cancel** it. When a finished run has failed recipients, **Retry failed (N)** sends again to just those recipients (a recurring campaign does it for every finished run); everyone who already got the message is left alone, and a message is charged only when it is delivered. It asks you to confirm first, and it is not offered while the failing run is still going. Each run links to its campaign page. The page refreshes every 15 seconds.

**Export rows** downloads the recipients as a CSV (needs the permission to export campaigns). For a recurring campaign it is one file with a **Run** column, run by run. **Delete** (needs the permission to delete campaigns) removes a one-off campaign that is still waiting for its time or that failed outright, together with its recipients. A recurring campaign can be deleted, with the runs it had planned, only while none of its runs has sent a message; once one has, its history is kept and you cancel it instead. The campaign page of any run has a **Broadcast status** button that opens this page.

## If something looks wrong

- **Could not save** next to the title means the last change is not saved yet. Press **Retry**; the page asks before you leave with unsaved changes.
- A banner saying the draft was changed somewhere else means someone saved it from another tab. Choose **Reload draft** to continue from the latest version.
- **Insufficient balance** on the launch sends you back to **Review**. Top up and continue.
- A launched campaign cannot be edited. Its draft shows a link to the status page instead.
