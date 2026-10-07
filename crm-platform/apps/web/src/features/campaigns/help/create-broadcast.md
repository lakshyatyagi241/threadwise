---
id: campaigns-create-broadcast
title: Create a broadcast
summary: Send an approved WhatsApp template to contacts, groups, segments or a CSV of numbers, now, later or on repeat, in four steps.
area: campaigns
order: 20
documents: [nav:campaigns]
keywords: [broadcast, wizard, template, audience, contacts, groups, segments, csv, filter, schedule, recurring, retries, test, variables, credit]
---

## What it is for

**Create broadcast** on the Campaigns screen walks you through sending an approved WhatsApp template in four steps. Your work is saved as a draft while you go, so you can close the page and come back: open the draft from the Campaigns list and it reopens at the step where you stopped.

## How to use it

1. **Name and template.** Enter a broadcast name, choose the WhatsApp number to **Send from** (the default one is preselected), then pick a template. Search by name or text, or filter by language and category. Only approved templates are listed. The phone preview on the right shows the message, with its variables highlighted.
2. **Audience.** Under **Broadcast action** choose one of four ways to pick who gets the broadcast. Each keeps its own selection, and the broadcast goes to everyone selected in any of them, once. The chips above the panel count what each holds. Opted-out contacts and invalid numbers are always skipped. The **Matching contacts** panel shows who matches, who is skipped and who **will be messaged**, and the phone preview shows your template.
   - **Broadcast to contacts** is a table of your contacts. Search by name, email or phone, or press **Filter** to open the filter panel: add conditions (country code, tags, a custom property...), then **Apply**; **Clear** removes them. The table and its total are worked out on the server. Tick rows, tick the box in the header for the whole page, and when the page is ticked choose **Select all N matching** to take every contact the search and filter found. Opted-out contacts are listed but cannot be ticked. The footer has the total, the pages and how many rows per page.
   - **Broadcast to groups** lists your contact groups (your marketing lists) with their member counts. Tick any number.
   - **Broadcast to segments** lists your saved segments. Tick any number.
   - **Broadcast via CSV** takes a file of numbers (up to 2 MB and 10,000 rows) with a column named `phone`, and optionally `first_name`, `last_name` or `name` and `country_code`. Download the template from the panel. The file is checked on the server: numbers are put in international format, repeated numbers are kept once, and rows that cannot be used are listed with their line number (the whole list downloads as a CSV). You see how many numbers are valid, duplicate, invalid, opted out and new. Numbers that are already contacts are matched by phone. New numbers are added as contacts when you launch. The upload is kept for 7 days.
3. **Check and variables.** The credit check compares your wallet with the estimated cost, with a breakdown by country. If the balance is too low, **Next** is blocked and **Top up** takes you to add credit. For each variable of the template, choose **Contact field** (with a fallback for contacts that lack it) or **Fixed text**. Sample messages show the message for a few real contacts, and flag any placeholder that came out empty. The summary lists everything, with **Edit** links back to the step that owns each value.
4. **Test and send.** Send a test first, then choose **When to send** and finish.

## Send a test

Type one or more phone numbers in the format `+91xxxxxxxxxx`, separated by commas (up to 10). **Send Test** stays off until every number is valid. Tracking is not enabled for tests, and credits are deducted for the WhatsApp messages the test sends. Each number shows sent, delivered, read or failed, with the error and the amount charged. You need the permission to test campaigns to use this.

## When to send

- **Broadcast now** sends right away, once.
- **Schedule Broadcast** sends once at the date and time you pick, in the time zone you choose (your workspace's by default). The date must be in the future.
- **Recurring Broadcast** sends again and again on a rule: daily, weekly (pick the weekdays) or monthly, every N days, weeks or months, ending never, on a date or after a number of runs. A sentence under the heading says what the rule does, and **Next runs** lists the first five. Each run goes to the audience as it is at that time. On the 31st, shorter months use their last day.

## Retries

Turn on **Activate Retries** and set an end date to try again the messages that Meta holds back because of its frequency cap (error 131049). Retries run at exactly 24-hour intervals until the end date, and cost nothing extra: you are only charged for a message when it is delivered.

## Launch

The last button reads **Broadcast now**, **Schedule** or **Start recurring**. It opens a confirmation with the name, template, recipients, skipped contacts, estimated cost, schedule and retries. After you confirm you land on the page that matches how you sent it, with the new broadcast marked **New**: **Broadcast history** for a broadcast sent now, **Scheduled broadcasts** for a scheduled one, **Recurring broadcasts** for a recurring one (see [Broadcast history](help:campaigns-broadcast-history)). Select a row to open its status page.

## The status page

It shows the status, the schedule in words, the next run, the runs with their counts, and the retry summary. If you have the permission to control campaigns, you can **Pause**, **Resume** or **Cancel** it. Each run links to its campaign page. The page refreshes every 15 seconds.

## If something looks wrong

- **Could not save** next to the title means the last change is not saved yet. Press **Retry**; the page asks before you leave with unsaved changes.
- A banner saying the draft was changed somewhere else means someone saved it from another tab. Choose **Reload draft** to continue from the latest version.
- **Insufficient balance** on the launch sends you back to step 3. Top up and continue.
- A launched broadcast cannot be edited. Its draft shows a link to the status page instead.
