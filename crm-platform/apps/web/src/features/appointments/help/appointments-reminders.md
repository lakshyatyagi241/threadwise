---
id: appointments-reminders
title: Reminders and follow-ups
summary: Message a contact before an appointment starts and follow up after it ends, set per booking type and sent on WhatsApp or email.
area: settings
order: 12
documents: [tile:appointment-settings]
keywords:
  [
    reminders,
    follow-up,
    follow up,
    appointment reminder,
    no-show,
    whatsapp template,
    email,
    quiet hours,
    after visit,
  ]
---

## What it is for

A reminder is a message sent before an appointment starts, so the contact turns up. A follow-up is a message sent after it ends, to thank them or ask how it went. Both are set for each booking type, so a 15-minute check-up and an hour-long consultation can have different ones. Every reminder and follow-up is **off** until you switch it on, and a workspace that switches nothing on sends nothing.

## How to use it

1. Open **Settings**, then **Appointment settings**, and find **Reminders and follow-ups**. You can also set them in the **Messaging** step of a booking type.
2. Open the booking type you want. Its steps sit on a timeline in three rows: **When it is booked**, **Before the appointment** and **After the appointment**.
3. Select **Add step** and pick one: **Booking confirmation**, **24 hours before**, **2 hours before**, **15 minutes before** (online appointments only), **Reminder at another time**, **After-appointment message**, **No-show message** or **Rebook message, some days later**. A choice you already added, or that would pass the limit, is greyed out.
4. For a step with a time, enter the number, pick minutes, hours or days, and see whether it counts before the appointment starts or after it ends.
5. Switch the step on with its switch.
6. Select **Message and channels** on the step to choose how it is sent and what it says, then select **Save reminders**. **Discard changes** drops what you have not saved.

## Options and settings

- **Send on** lists the channels in the order they are tried: WhatsApp and email. The first one that can deliver is used and the others are fallbacks, so a contact never gets the same reminder twice. Use the arrows to reorder and **-** to drop a channel.
- **Message** is the text. Insert placeholders such as the contact's name, the date and time, the place, the join link and the link to move or cancel. Leave it empty to use the booking type's own reminder message, or the standard text. The **Preview** shows an example with sample values.
- **Email subject** is used when email is one of the channels.
- **WhatsApp template**: WhatsApp only delivers free text within 24 hours of the contact's last message. Outside that, pick an approved template. Its variables are filled in this order: 1 name, 2 service, 3 date, 4 time, 5 place, 6 join link, 7 manage link. Without a template WhatsApp is skipped in that case and the next channel is tried.
- **Label** is an optional name for your own reference.
- **Confirm, Reschedule and Cancel buttons** adds three quick-reply buttons to the WhatsApp message.
- **Skip this step if the customer already confirmed** leaves the step out when the contact has already confirmed.
- **If not delivered, try the next channel after (minutes)** moves on to the next channel when the message was not delivered in that time (5 to 720 minutes). Leave it empty to switch it off.
- A booking type can have up to 5 steps with a time. The booking confirmation and the no-show message do not count. Two cannot share the same time on the same side of the appointment. The line above the timeline says how many you have used.
- A step that sends a WhatsApp template shows where the template stands: **Template approved**, **Waiting for Meta approval**, **Template not sent to Meta** or **Rejected by Meta**. Until it is approved, a step that also has email goes out by email.
- SMS reminders were removed. A step that used SMS is moved to email, or switched off, and shows a notice until you choose WhatsApp or email and save.

## Ready-made sequences

**Ready-made sequences** (above the timeline) sets up the confirmation, the reminders, the follow-up and the rebook message for your kind of business in one go.

1. Select **Ready-made sequences** and choose a sequence. Pick the **Language of the messages**; a Hindi text is a machine-made draft, so have someone who reads Hindi check it first.
2. Read **What will change**: each step is marked **New**, **Replaces yours** or **Already the same**, and **Show messages** lets you read the texts with sample values you can change.
3. If it replaces steps you already have, tick **Replace them**. Your own text on those steps is lost.
4. Leave **Send the WhatsApp messages to Meta for approval now** on to send the new WhatsApp messages for approval, or turn it off to keep them as drafts.
5. Select **Apply sequence**. The result lists each WhatsApp message and its approval state; **Refresh status** reads it again.

> You cannot apply a sequence while you have unsaved changes on the booking type, when it would pass the limit of 5 timed steps, or without the right to change booking types. A step your plan does not allow (rebook messages, reply buttons) is left switched off or left out, and the dialog says so.

## What happens to each one

- A reminder is never sent after the appointment starts, and not in the last minutes before it.
- If the appointment is cancelled, declined or marked no-show, what was waiting stops. A follow-up is not sent after a no-show.
- If the appointment is moved, what was waiting for the old time stops, and the reminders are planned again for the new time. A reminder whose time had already passed when the booking was made is not sent.
- If your workspace has quiet hours, a message is held until they end. A reminder that quiet hours would push to the start of the appointment is skipped.
- A contact who opted out, or whose number is on the do-not-call list, is skipped. A follow-up counts as marketing where your workspace asks for recorded consent. A reminder is a service message.
- A follow-up that could not go within a day of its time is dropped.

Open an appointment to see each reminder with its status: **Scheduled**, **Waiting**, **Sent** (and on which channel), **Not sent** or **Failed**, with the reason. The same outcome appears on the contact's timeline, without the message text.

## Test, report and history

- Send a step to yourself before customers see it: [Send a test email of a reminder](help:appointments-reminder-test-email).
- See what the reminders did, per booking type and step: [Reminder report](help:appointments-reminder-report).
- See what happened to one appointment's reminders, including the channels tried and the buttons tapped: [What happened to an appointment's reminders](help:appointments-reminder-history).
- Details of the ready-made sequences and where their WhatsApp messages stand with Meta: [Ready-made reminder sequences](help:appointments-reminder-packs).

## Plan and access

Timed reminders on WhatsApp and email, the ready-made sequences, the test email, the email fallback, the report and the history come with the Appointments app. The Confirm, Reschedule and Cancel buttons and the rebook messages are the upgrade tier, which your plan has to include: where it does not, those controls are shown locked with a link to the plans. See [Reminder buttons and rebook messages on your plan](help:appointment-reminder-plans).

Seeing the reminders needs permission to view booking types. Changing them, applying a sequence and sending a test email need permission to edit booking types. Sending needs a connected WhatsApp number or shared mailbox for the channels you choose; a channel without one is skipped.

## If something looks wrong

- **Nothing was sent.** Check that the reminder is **On** and the booking type is active, that the appointment is confirmed, and that the contact has a phone number or email for a channel you chose. Open the appointment to read the reason.
- **WhatsApp was skipped.** The contact has not written to you in the last 24 hours and no approved template is chosen. Pick a template, or add email as a fallback.
- **It says waiting.** Quiet hours or a channel that is not connected is holding it. It goes on its own when that clears.
