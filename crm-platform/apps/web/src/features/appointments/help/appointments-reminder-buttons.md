---
id: appointments-reminder-buttons
title: Confirm, Reschedule and Cancel buttons
summary: Add three reply buttons to the WhatsApp reminder so customers can confirm, ask to move or cancel with one tap.
area: settings
order: 18
documents: []
gates:
  planFeature: appointment_confirm_buttons
keywords: [buttons, confirm, reschedule, cancel, quick reply, whatsapp, reminder]
---

## What it is for

The 24 hour reminder can carry three buttons. The customer taps one and the appointment reacts, without anyone typing.

- **Confirm** marks the appointment as confirmed by the customer, adds a line to the contact's timeline and replies in the chat. A reminder set to skip when the customer already confirmed is then not sent.
- **Cancel** cancels the appointment as if the customer had cancelled on their booking page. Reminders still waiting stop and the host is told.
- **Reschedule** changes nothing and replies with the link to choose a new time.

## How to use it

1. Open **Settings**, then **Appointment settings**, then **Reminders and follow-ups**, and open the booking type.
2. On a reminder before the appointment, open **Message and channels**. WhatsApp must be one of its channels, and the WhatsApp template you choose must have quick-reply buttons. A ready-made sequence sets this up for the 24 hour reminder.
3. Switch on **Add Confirm, Reschedule and Cancel buttons (WhatsApp)**, optionally **Skip this step if the customer already confirmed**, and save.

## Good to know

- Each button works once. A second tap gets the same reply and does nothing more. After the appointment starts, a tap gets a reply that the reminder is no longer active. A tap that does not come from the customer the appointment belongs to does nothing.
- Cancelled, declined, completed and no-show appointments cannot be changed from a button.
- The reminder report counts the taps per step, and the appointment's history lists them.
- The buttons are part of the Appointments upgrade tier. See [Reminder buttons and rebook messages on your plan](help:appointment-reminder-plans) for what happens on a plan without it.

## If something looks wrong

- **The buttons are not on the reminder.** Check that the reminder is before the appointment, that WhatsApp is one of its channels, that the template has quick-reply buttons and that your plan still includes the buttons.
