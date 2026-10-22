---
id: appointments-channels-templates
title: Message channels and templates
summary: Choose which channels may carry appointment messages and add ready-made confirmation, reminder, reschedule, cancellation and follow-up messages.
area: settings
order: 13
documents: [tile:appointment-settings]
keywords:
  [
    channels,
    whatsapp,
    email,
    template,
    predefined,
    meta approval,
    confirmation,
    reminder,
    follow-up,
    reminder call,
    voice,
  ]
---

## What it is for

Appointment messages (confirmations, reminders, reschedule and cancellation notices, after-visit follow-ups) can go out on email and WhatsApp. The workspace owner or an admin decides which of these channels may be used. A booking type can use a channel only when it is **switched on** here and **connected**. Nothing is sent on a channel that is off, even for a booking type that was set up earlier.

You can also add ready-made messages and edit them, so you do not start from a blank page.

## Choose the channels

1. Open **Settings**, then **Appointment settings**, and find **Message channels**.
2. Switch on the channels your team may use. A channel that is on but not connected shows **Connect it in Settings** with a link.
3. If you have more than one sender for a channel, pick the **default sender**. Otherwise the first connected one is used.

A workspace that existed before this setting keeps working as it did: email and WhatsApp are on, and a channel with nothing connected stays unusable. A new workspace starts with nothing chosen, so no appointment message is sent until the owner chooses.

**Reminder call** is shown but cannot be switched on. It is an outbound call that will arrive with the Voice bot, and it will then be switched on for each booking type.

## Add ready-made messages

1. In **Message templates**, find the message you want under **Predefined messages**: booking confirmation, reminder, rescheduled, cancelled or after-visit follow-up, each for email and for WhatsApp.
2. Click **Preview** to read it, then **Add to my messages**. The predefined texts are in English; edit them to your language.
3. An **email** message is ready at once.
4. A **WhatsApp** message is added as a **draft**. When you are happy with it, click **Send to Meta for approval**. It shows **In review at Meta** until Meta decides, then **Approved** or **Rejected** with Meta's reason. Fix a rejected message and send it again.
   If no WhatsApp number is connected, adding or sending a WhatsApp message is refused with a note to connect a WhatsApp number in **Settings** first.

Only an **approved** WhatsApp message can be chosen for a booking type, and outside the 24 hour window WhatsApp sends nothing else. A WhatsApp message can use only the placeholders `name`, `type`, `date`, `time`, `location`, `join_link` and `manage_link`, in that order without skipping one, because WhatsApp numbers its variables.

## Use a message in a booking type

1. Open the booking type and go to the **Messaging** step. The top card lists the channels this booking type can use and why the others cannot.
2. For each message (confirmation, reminder, cancellation, reschedule), tick the channels it goes out on. Choose a message from your library, or keep the text you typed.
3. In **Reminders and follow-ups**, a rule offers only the channels that are available. For email, choose **Use a message from the library** to copy a message into the rule.

If you choose a library message, the booking type reads it when it sends, so editing the message changes the next one that goes out.

## Good to know

- The booking messages still follow quiet hours, consent and opt-outs. A channel being on does not override them.
- If the owner switches a channel off, messages already scheduled on it are skipped with the reason shown on the booking, and the next channel in the order is tried.
- Removing a message from the library is refused while a booking type uses it. A WhatsApp template stays in your WhatsApp templates; delete it there if you no longer need it.
