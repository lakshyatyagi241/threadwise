---
id: contact-consent
title: Consent, STOP and START replies
summary: Keep a proof of who agreed to marketing, let contacts opt out by replying STOP, and tell them they can.
area: settings
order: 20
documents: [tile:consent]
keywords:
  [
    consent,
    opt out,
    opt in,
    unsubscribe,
    stop,
    start,
    keyword,
    gdpr,
    compliance,
    marketing,
    footer,
    proof,
    ledger,
  ]
---

## What it is for

Every contact has a consent history: when they agreed to marketing messages or opted out, on which channel, from where (a form, an import, a reply, a person) and with what proof. The history can only be added to, never edited, so it stands as evidence. The contact's **Unsubscribed** flag, which every campaign and broadcast already checks, always follows it.

A contact with no history shows **No consent recorded**. We never assume consent for you.

## How a contact opts out by replying STOP

Open **Settings**, then **Consent and STOP replies** under Security. When a contact sends **only** one of the STOP words (STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT or OPT OUT, plus the Arabic words), they are opted out of marketing on that channel. This works for WhatsApp, Telegram and every other channel that receives messages, and for numbers connected the official way or with a QR code.

The message must be the keyword and nothing else. Capital letters, spaces, punctuation, emoji and Arabic diacritics are ignored, so `Stop.` and `STOP!!` work. A sentence such as "please stop sending me invoices" or "don't stop" does **not** match, so nobody is opted out by accident. A STOP is never passed to a flow, an FAQ answer or an AI agent.

The same screen lists the START words (START, SUBSCRIBE, UNSTOP and the Arabic words). A contact who sends one is subscribed again.

You can change every list, add a language, and use **Test a message** to see what would happen for any text, before or after you save. Nothing is sent or changed by the test.

## The confirmation reply

By default the contact receives one short answer: "You have been unsubscribed from marketing messages and will not receive more. Reply START to subscribe again." After START: "You are subscribed again. Reply STOP at any time to unsubscribe." Edit the text for each language, or switch it off. It is a normal reply inside the 24 hour window, not a campaign. It is sent once per change: a second STOP from an opted-out contact adds to the history but is not answered again.

## Telling people they can reply STOP

Recipients only type STOP if they know they can. In the campaign composer, a marketing text without an opt-out instruction shows a warning with a button that adds your **opt-out line** (by default "Reply STOP to unsubscribe") under the text. The tick box **Add the opt-out line** adds or removes it. Set the wording for each language under **The opt-out line**; the preview shows what the recipient sees.

Templates are fixed by their approval, so we cannot add a line to one. Include the line in the template when you create it. The composer only reminds you.

## Require recorded consent

The switch **Require recorded consent for marketing sends** is off by default, so nothing changes for existing contacts. When you switch it on, campaigns and broadcasts send marketing only to contacts with a recorded consent. The audience step shows how many were skipped for lack of consent. Contacts who opted out are skipped whatever this switch says.

## On a contact

The **Consent** card on a contact's page shows the status, the state per channel and the history with who did it and the proof. **Mark as subscribed** asks you to say why (for example, signed the paper form). **Mark as unsubscribed** needs no reason. **Export proof (CSV)** downloads the history of that contact. The settings screen can export the whole workspace.

Forms record the consent line a visitor ticked, with the exact text and its version, when the box is marked as marketing. A form never overrides an opt-out.

## Permissions and limits

- **settings.consent.manage** opens the settings and the workspace export.
- **contacts.consent.read** shows the Consent card and exports one contact. **contacts.consent.manage** records a change.
- We store ids, hashes and the matched keyword as proof, never an IP address and never the text of a contact's message.
- If a keyword change does not seem to apply, wait a minute: each server keeps the list for up to a minute.

## What agents see in the inbox

When a contact replies STOP (or START) and it changes their status, the conversation gets a small grey line: "Contact replied STOP: unsubscribed from marketing". It is only a record for your team: it does not assign the conversation, ring a notification or count as an unread message. A second STOP from someone already opted out adds no line.

## Exporting the proof when the history is large

**Export proof (CSV)** downloads the whole history at once while it has up to 50,000 entries. Past that, the button becomes **Prepare the full proof file**: the file is built in the background, you get an email when it is ready, and it is listed under **Prepared proof files** with a **Download CSV** link. A prepared file is kept for 7 days and then deleted (prepare it again if you need it). Only one file is prepared at a time. Preparing a file needs the permission **contacts.consent.manage** and is recorded in the audit log.

## A yes / no column in a contact import

When you import contacts, map a column to **Marketing consent (yes / no)**. Rows that say yes (yes, y, true, 1, opted in, subscribed and the same words in Arabic and other languages) are recorded as agreeing, with the file name as proof. Rows that say no, are blank or say something else get **no** consent record: they stay "No consent recorded". The preview counts both and lists any value it did not understand. The column only counts once you tick **I have consent to message these contacts**; without the tick it is ignored. Contacts who opted out are never turned back on by a file.

## Campaign audiences

With **Require recorded consent for marketing sends** on, the campaign wizard's list of recipients, its count and its sample only include contacts with a recorded consent. Numbers you upload that are not contacts yet have no consent, so they are counted as "no recorded consent" and are not messaged.

## What STOP does and does not stop

A STOP (or an unsubscribe link, or a person marking the contact as opted out) stops **marketing**: campaigns, broadcasts, scheduled promotions, MARKETING templates and flows you start yourself. It does not stop **service messages**: your replies in a conversation, order and appointment notices, and utility templates. If an agent tries to send a MARKETING template to a contact who opted out, the inbox refuses it with a clear message and nothing is sent. There is no override.

With **Require recorded consent for marketing sends** on, a MARKETING template also needs a recorded consent on that channel; replies never do.

## The unsubscribe link in marketing emails

A marketing email carries a personal unsubscribe link and the standard one-click unsubscribe header, so the mail app can show its own Unsubscribe button. The link opens a short page (no login) with one button. Pressing it records that the contact opted out of marketing emails, and every marketing path then skips them, including WhatsApp and SMS. A marketing email can only go to someone who is a contact, so there is always a link that works.

## How a contact becomes "agreed"

A first message from a person lets you **reply** to them. It never records marketing consent. Consent is recorded only when the person actually agreed, and the history shows where, with the wording they saw, its version and the time.

These are the places that record it:

- **A person on your team** sets a contact's WhatsApp, SMS or email status to **subscribed**, or uses **Mark as subscribed**. You are asked how they agreed (what they said or signed, and where). A status set to subscribed with no explanation is refused: a status on its own is a label, not proof.
- **A form** with the marketing box ticked, **the website chat form** and **the booking page** when the person ticks the consent line you wrote for them (see below), and **your Shopify or WooCommerce store** when the customer accepted marketing there.
- **The customer API, partner and public lead submissions and the Google Sheets add-on**, when the request says the person agreed and explains how. In a sheet, put yes in a `consent` column and say how in a `consent_note` column; a yes without a note is refused for that row, and a no or a blank changes nothing.

A grant never overrides a STOP the contact sent: to bring an opted-out contact back, use **Mark as subscribed** on their Consent card and say why.

## The consent line of the chat widget, a booking page or a store

On the chat widget's settings, on a booking type and on your Shopify or WooCommerce connection you can write the wording a person agrees to, add a link to your privacy policy, and switch the line on. Every change to the wording, the link or the switch is saved as a numbered **version**, and a person who ticks the box is recorded against the version they saw. Switching the line on grants nothing by itself.

- **Chat widget**: shown under the details form, only when the widget asks for a phone number or an email. A visitor who ticks it is recorded as agreeing on the channels they gave (WhatsApp for a phone, email for an address).
- **Booking page**: an optional tick box on the booking form. Booking never needs it.
- **Store**: the store's own marketing choice (Shopify's email and SMS consent) is recorded when a customer is synced or orders. Write what that checkbox tells your customers; tick "also count it as WhatsApp consent" only if the wording says so.

You need the permission to manage consent settings to edit these lines.

## Proof that comes with leads, files and forms

A lead, an uploaded file or a form submission never counts as consent by itself. A consent is recorded only when the person agreed, and the record keeps where, the wording they saw, its version and when.

- **Leads**: when your form tool or ad platform sends the person's agreement together with the lead (a yes, plus the wording, its version, the form or the ad), it is recorded with the source **Lead capture**. A lead that carries no such proof records nothing, and a test lead never records anything. See [Lead sources](help:lead-sources).
- **Click-to-WhatsApp ads**: when someone writes to you from an ad, the ad is kept on their contact as the way they reached you. It is not consent: you may reply, and you may not send them marketing until they agree.
- **Contact import and Broadcast via CSV**: ticking **I have consent to message these contacts** records a consent for each person in the file, with the file name and, if you typed it, the notice or lawful basis and its version. Columns for SMS and email consent record those channels, only for the rows that say yes.
- **Forms**: a ticked marketing box records marketing consent. A ticked box that is not marketing (for example "I agree to be contacted about my request") is recorded as agreement to **service messages** only, and the Consent card shows it that way, not as a subscription. A box left unticked records nothing.

Nobody who opted out is turned back on by any of these.
