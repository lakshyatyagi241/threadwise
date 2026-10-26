---
id: appointments-reminder-report
title: Reminder report
summary: See how many reminders were sent, delivered, failed or skipped for each booking type and step, and how many went by another channel.
area: settings
order: 16
documents: [tile:appointment-settings]
keywords: [report, delivery, sent, delivered, failed, skipped, fallback, statistics, confirmed, cancelled]
---

## What it is for

The reminder report answers "did my reminders go out, and what happened next?". For each booking type it shows every step that had a result in the period, with counts only. It never shows a name, a phone number, an email address or a message.

## How to use it

1. Open **Settings**, then **Appointment settings**, and scroll to **Reminder report** below Reminders and follow-ups.
2. Choose a **Booking type**, or leave **All booking types**.
3. Choose the **Period**: the last 7, 30 or 90 days, or **Choose dates** and pick a start and an end date (up to a year). The period counts steps by the time they were due. **Refresh** reads it again.

## What the columns mean

- **Sent**: the step went out on a channel.
- **Delivered**: WhatsApp reported it as delivered. Email has no delivery report, so an email counts as sent only.
- **Failed**: the send failed on every channel.
- **Sent by another channel**: the first channel could not deliver it, so a later one (usually email) did.
- **Skipped**: the step did not go. **Why** opens the reasons, for example the contact had already confirmed or has no number or address for the channel.
- **Confirmed**, **Reschedule asked** and **Cancelled**: how many customers tapped the Confirm, Reschedule and Cancel buttons of that step. These columns are part of the Appointments upgrade tier. Without it they are left out and a note with a link to the plans says why.

Above each table you see the share of appointments that got a reminder and were then confirmed, cancelled or marked no-show.

## If something looks wrong

- **The report is empty.** No reminder was due in the period. Widen the period, or check that the steps are switched on.
- **Delivered is lower than Sent.** Email never counts as delivered, and WhatsApp reports delivery a little later.
- **The report could not be loaded.** Select **Try again**.
