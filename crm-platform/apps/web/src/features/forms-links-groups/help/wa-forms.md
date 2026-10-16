---
id: wa-forms
title: WhatsApp Forms
summary: Build a form customers fill in right inside WhatsApp, send it from a flow, and review or export the answers.
area: automation
order: 15
documents: [nav:wa-forms]
gates:
  planFeature: forms_and_links
  permission: wfl.forms.read
keywords:
  [forms, whatsapp form, whatsapp flow, flow builder, lead capture, survey, submissions, publish]
---

## What it is for

A WhatsApp Form is an interactive card a customer fills in without leaving the chat — a few screens of fields
(name, email, choices, and so on) that end in one tap on **Send**. You design it here, publish it to WhatsApp, then
send it from the **WhatsApp Form** step of a flow. Every submission lands on the form's **Submissions** page and
in the conversation, so your team can follow up without leaving the inbox.

**WhatsApp Forms** needs a WhatsApp Business number connected through the Cloud API — it does not work on an
Unofficial API (QR-paired) or Twilio number.

## How to use it

1. Open **WhatsApp Forms** in the menu (under Automation) and select **New form**.
2. Give it a title, pick a type (lead capture, survey, appointment booking, customer support, sign up, or other),
   and add an optional purpose note.
3. Add screens and fields from the field list: headings, short text, paragraphs, email, phone number, number,
   date, and the choice fields (dropdown, radio buttons, checkboxes). Mark a field **Required** if the customer
   must answer it before continuing.
4. For each field, you can pick what it **maps to**: a contact field (full name, first name, last name, email,
   job title, language, address) or any of your workspace's custom properties. Leave it as "Don't save to a
   contact property" to only keep the answer in the submission. A heading has nothing to map — it has no answer.
5. Set the **Send button label** (what the final button on the form says) and an optional **Thank-you note** shown
   after submission.
6. Select **Save draft** to keep working later, or **Save & publish** to push it live to WhatsApp.
7. In the flow builder, add a **WhatsApp Form** node and pick this form from the list — only published forms are
   offered there.

## Editing a published form

Saving changes to a published form sends it back to **Draft** automatically. Publish again when you are ready —
publishing is safe to repeat; it reuses the same WhatsApp Flow instead of creating a new one each time.

## Submissions

Open a form's **Submissions** page to see every answer, newest first, with the customer's name and phone number
alongside each field. Select **Export CSV** to download the full list.

A field mapped to a contact property is saved onto the contact the moment they submit — a deleted or deactivated
custom property is skipped silently rather than failing the submission, so an old mapping never blocks a new
answer from being kept. The contact's phone number can never be overwritten this way.

## If publishing fails

- **No connected WhatsApp Cloud API number has usable credentials** — connect a WhatsApp Business number through
  the Cloud API first.
- **Meta rejected the form definition** — a field or option in your form definition was not accepted; check the
  message shown for the exact reason.
- **Account verification required** — WhatsApp needs your Business Account to pass its own review before it will
  publish any form; this is a Meta-side check, not something to fix in the form itself.

## Costs and limits

WhatsApp Forms is included with plans that have the **Forms and links** feature. Deleting a form that a flow still
references will break that flow's WhatsApp Form step — the flow builder does not stop you from deleting a form
that is in use, so check the flow first.
