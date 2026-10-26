---
id: appointments-reminder-packs
title: Ready-made reminder sequences
summary: Set up a whole sequence of reminders for your kind of business in one go, in English or Hindi, and see where each WhatsApp message stands with Meta.
area: settings
order: 14
documents: [tile:appointment-settings]
keywords:
  [
    packs,
    ready-made,
    sequence,
    template,
    hindi,
    clinic,
    dental,
    salon,
    property visit,
    sales meeting,
    fitness,
    home service,
    meta approval,
  ]
---

## What it is for

A ready-made sequence fills a booking type's reminder timeline for you: the booking confirmation, the reminders before the appointment, the follow-up afterwards, the no-show message and a message that asks the contact to book again. There are seven, one per kind of business: **Clinic and doctor**, **Dental**, **Salon and spa**, **Property visit**, **Sales meeting or demo**, **Fitness and wellness** and **Home and auto service**. Each one comes in English and Hindi.

Ready-made sequences are part of the Appointments app, so you do not need an upgrade to use them. Two parts of a sequence need the Appointments upgrade tier: the Confirm, Reschedule and Cancel buttons and the rebook message. See [Reminder buttons and rebook messages on your plan](help:appointment-reminder-plans).

## How to use it

1. Open **Settings**, then **Appointment settings**, then **Reminders and follow-ups**, and open the booking type.
2. Select **Ready-made sequences** and choose one.
3. Pick the **Language of the messages**. The Hindi text is a machine-made draft: have someone who reads Hindi check it before you switch the steps on.
4. Read **What will change**. Each step is marked **New**, **Replaces yours** or **Already the same**, and shows whether it starts **On** or **Off**, whether it is a **Service message** or a **Marketing message**, and the state of its WhatsApp message. **Show messages** opens the texts with sample values; you can change the values to see how a longer name or another place reads.
5. If steps would be replaced, tick **Replace them**. Text you wrote on those steps is lost.
6. Leave **Send the WhatsApp messages to Meta for approval now** on, or turn it off to keep them as drafts.
7. Select **Apply sequence**. The result lists every WhatsApp message with its approval state; **Refresh status** asks again, because Meta decides later than the moment you apply.

## What each state means

- **Will be sent to Meta**: the WhatsApp message does not exist in your workspace yet and will be created.
- **Template not sent to Meta**: it exists as a draft.
- **Waiting for Meta approval**: Meta has it. Until it is approved, a step that also has email goes out by email.
- **Template approved**: the step sends on WhatsApp.
- **Rejected by Meta**: Meta refused it and said why. The step stays on email; edit the message and send it again.

## Limits

- A booking type has at most 5 steps with a time. A sequence that would pass that is blocked until you remove a step.
- You cannot apply a sequence while the booking type has unsaved changes, or if you may only view booking types.
- Without a connected WhatsApp Cloud API number no WhatsApp message is created and the steps use email.
- A step your plan does not include is left out and the dialog says so: the rebook step is saved switched off, and the buttons are left out of the 24 hour reminder. The result lists what was left out, with a link to the plans.

## If something looks wrong

- **Apply is greyed out.** Choose a sequence first, save or discard your changes, and check that you may edit booking types.
- **A WhatsApp message stays on Waiting for Meta approval.** Meta decides on its own time. Select **Refresh status** later.
