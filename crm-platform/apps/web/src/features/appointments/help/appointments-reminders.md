---
id: appointments-reminders
title: Reminders and follow-ups
summary: Message a contact before an appointment starts and follow up after it ends, set per booking type and sent on WhatsApp, SMS or email.
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
    sms,
    email,
    quiet hours,
    after visit,
  ]
---

## What it is for

A reminder is a message sent before an appointment starts, so the contact turns up. A follow-up is a message sent after it ends, to thank them or ask how it went. Both are set for each booking type, so a 15-minute check-up and an hour-long consultation can have different ones. Every reminder and follow-up is **off** until you switch it on, and a workspace that switches nothing on sends nothing.

## How to use it

1. Open **Settings**, then **Appointment settings**, and find **Reminders and follow-ups**. You can also set them in the **Messaging** step of a booking type.
2. Open the booking type you want. Use a quick-add button such as **24 hours before** or **2 hours after**, or **Add reminder** for your own time.
3. Pick the time: a number of minutes, hours or days, and whether it counts **before the appointment starts** or **after the appointment ends**.
4. Switch it **On**.
5. Select **Message and channels** to choose how it is sent and what it says, then select **Save reminders**.

## Options and settings

- **Send on** lists the channels in the order they are tried: WhatsApp, SMS and email. The first one that can deliver is used and the others are fallbacks, so a contact never gets the same reminder twice. Use the arrows to reorder and **-** to drop a channel.
- **Message** is the text. Insert placeholders such as the contact's name, the date and time, the place, the join link and the link to move or cancel. Leave it empty to use the booking type's own reminder message, or the standard text. The **Preview** shows an example with sample values.
- **Email subject** is used when email is one of the channels.
- **WhatsApp template**: WhatsApp only delivers free text within 24 hours of the contact's last message. Outside that, pick an approved template. Its variables are filled in this order: 1 name, 2 service, 3 date, 4 time, 5 place, 6 join link, 7 manage link. Without a template WhatsApp is skipped in that case and the next channel is tried.
- **Label** is an optional name for your own reference.
- A booking type can have up to 8 reminders and follow-ups. Two cannot share the same time on the same side of the appointment.

## What happens to each one

- A reminder is never sent after the appointment starts, and not in the last minutes before it.
- If the appointment is cancelled, declined or marked no-show, what was waiting stops. A follow-up is not sent after a no-show.
- If the appointment is moved, what was waiting for the old time stops, and the reminders are planned again for the new time. A reminder whose time had already passed when the booking was made is not sent.
- If your workspace has quiet hours, a message is held until they end. A reminder that quiet hours would push to the start of the appointment is skipped.
- A contact who opted out, or whose number is on the do-not-call list, is skipped. A follow-up counts as marketing where your workspace asks for recorded consent. A reminder is a service message.
- A follow-up that could not go within a day of its time is dropped.

Open an appointment to see each reminder with its status: **Scheduled**, **Waiting**, **Sent** (and on which channel), **Not sent** or **Failed**, with the reason. The same outcome appears on the contact's timeline, without the message text.

## Plan and access

Seeing the reminders needs permission to view booking types. Changing them needs permission to edit booking types. Sending needs a connected WhatsApp number, SMS number or shared mailbox for the channels you choose; a channel without one is skipped.

## If something looks wrong

- **Nothing was sent.** Check that the reminder is **On** and the booking type is active, that the appointment is confirmed, and that the contact has a phone number or email for a channel you chose. Open the appointment to read the reason.
- **WhatsApp was skipped.** The contact has not written to you in the last 24 hours and no approved template is chosen. Pick a template, or add SMS or email as a fallback.
- **It says waiting.** Quiet hours or a channel that is not connected is holding it. It goes on its own when that clears.
