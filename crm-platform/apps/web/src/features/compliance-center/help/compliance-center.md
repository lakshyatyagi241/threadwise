---
id: compliance-center
title: Compliance center
summary: Tools to help you meet your privacy duties: the laws you work under, privacy contacts, notices, sub-processors, quiet hours and a checklist.
area: settings
order: 10
documents: [tile:compliance-center]
keywords:
  [
    compliance,
    privacy,
    gdpr,
    dpdp,
    ccpa,
    tcpa,
    trai,
    lgpd,
    pdpa,
    hipaa,
    dpo,
    grievance officer,
    sub-processor,
    dpa,
    privacy policy,
    terms,
    quiet hours,
    do not call,
    checklist,
    children,
    minors,
  ]
---

## What it is for

The Compliance center gathers the privacy settings a business usually has to think about, in one place: which laws apply to the people you contact, who a person or a regulator can reach, your notices and links, the vendors that handle personal data for you, and the hours in which you work. Open **Settings**, then **Compliance center** under Security.

> These are tools to help you comply. Using them does not make a workspace compliant, and nothing here is legal advice. Ask your own counsel what applies to you.

> Do not store protected health information in this product. We do not claim HIPAA compliance and we do not sign business associate agreements.

## The baseline and the laws you switch on

Every workspace, in any country, gets the same strict baseline: a recorded purpose and wording for every consent, easy withdrawal, versioned notices, requests from people (access, export, erase), retention for call recordings, a sub-processor list and a children flag. On top of that you can switch on the laws and regions that apply to the people you contact. Several can be on at once, and where they differ the strictest rule is used.

## Checklist

The first tab lists each point as **Built**, **Partly** or **Open**, worked out from your own settings and data. Built means the tool is set up, not that a law is satisfied. Each row says why, names the laws that ask for it, and has an **Open** button that takes you to where you fix it. The list refreshes every time you open the tab.

## Laws and regions

Your billing country, or the country you gave when you opened the workspace, suggests profiles. A suggestion changes nothing until you choose **Use this suggestion** or tick the profiles yourself and select **Save changes**.

1. Tick every law or region that applies to the people you contact: the EU and EEA (GDPR), the United Kingdom, India (DPDP), the United States (CCPA, TCPA), India calls and texts (TRAI), Brazil (LGPD), Singapore (PDPA), or none.
2. Read "What the strictest rule asks for" under the list: the shortest answer time, the highest age to treat as a minor, the narrowest calling window. Switching a law on does not change how your workspace sends. To require a recorded consent before marketing, use the switch in [consent settings](help:contact-consent).
3. When the United States CCPA is on, say whether you offer a Do Not Sell or Share option and link to your opt-out notice. When India DPDP is on, you can note the consent manager you use. This is a note only, nothing is connected.

## Contacts and children

Name a **data protection officer or privacy contact** and, for India, a **grievance officer**, with an email and optionally a phone and an address. The profile you switched on marks the ones it asks for. Then say whether minors may be among your contacts. If they may, you can record that parental consent is required. Your answer also decides what happens to a contact you mark as a minor on its Consent card: with "we do not knowingly process the data of minors", marketing to that contact is held back; with "minors may be included", or when parental consent is required, it is held back until a parent or guardian's consent is recorded on the same card. Until you answer, the mark is only recorded. See [consent settings](help:contact-consent).

## Notices and links

- **Privacy and terms links** are stored once and offered, with one button, in the form builder's consent line and in every consent notice editor. Nothing is filled in on its own.
- **Notices** is your default consent wording, in English and a second language. Every change becomes a new numbered version, so a record can name the exact text a person agreed to. The India DPDP profile asks for English and one Indian language: pick the language, save, then write the notice.

## Sub-processors

List the vendors that process personal data for you: what they do, which data they receive, where, and a link to the agreement. Use **Add a sub-processor**, edit one, or remove one. Mark a vendor as no longer used to keep the history. You can switch on a **public page** at `/trust/` followed by your workspace name that shows the vendors in use, your links and your privacy contact. It is off until you switch it on and save.

**Download the template** gives you a data processing agreement template filled in with your details and your list. It is a starting point for your counsel, not an agreement.

## Quiet hours and calls

Set quiet hours for messages, a calling window with days, a fallback time zone, and the Do Not Call or DND registry you note.

Both windows are off until you switch them on and save. Once they are on:

- **Quiet hours hold marketing messages; they never refuse them.** A marketing message that falls inside the quiet hours waits and is sent when they end. This covers marketing templates sent from the inbox, broadcasts (WhatsApp, LINE, Messenger, Telegram, Viber, WeChat and Instagram), the offers and win-back messages of your store, campaigns (and their follow-up steps), scheduled messages, the test sends of the broadcast wizard and the marketing messages of a flow. The screen that shows the message says it is held and until when. When it is released the consent is checked again, so a contact who unsubscribed meanwhile is not messaged.
- **Replies and notices are never held.** A reply inside the 24-hour window, a utility or authentication template, a booking notice, and a note to a colleague's number go out at any hour.
- **The calling window refuses a call outside it.** A call cannot wait in a queue, so a call placed outside the window is not made and the message says when the window opens. A call back to someone who messaged or called you in the last 24 hours is not refused.
- **The hours are read on the contact's own clock.** First the contact's own time zone (set on the contact, in a bulk edit, in a CSV import or through the API, and shown on the contact's page with where it came from; an older contact property of type time zone, or one named `timezone`, still counts), then the country code of their number (a country with several time zones waits until the hours are right in all of them), then the fallback time zone you choose, then your workspace time zone.
- **Your laws only suggest hours.** The profiles you switched on show the hours they suggest, but nothing is held until you switch the quiet hours or the calling window on yourself.

> The Do Not Call or DND registry is a note. Nothing is checked against it yet. A recurring campaign sends the recipients it held as soon as their hours end, then goes on with its normal schedule.

## Do not call list

The **Do not call** tab holds the phone numbers that must get no marketing by voice call or SMS, whatever their consent history says. A number on the list is refused for those two kinds of marketing with the reason "on the do not call list". WhatsApp, email and service messages (replies, order and appointment notices) are not held back by it.

- **Add numbers** by typing or pasting them, one per line or separated by commas. A number without its country code is read with the **Country code for local numbers** you pick. You can add a short note, such as why they are listed.
- **Add from a CSV file** reads the column named phone, mobile or number, else the first column. A big file is sent in parts and the screen shows the progress. Tick the box when the file is an extract from a registry you are entitled to use; the numbers are then shown as "Registry extract".
- The result says how many numbers were added, how many were already on the list and how many were not a phone number, with a few examples.
- **Remove** takes a number off the list after a confirmation. Remove one only if the person asked you to or it was added by mistake. It can then get marketing again unless the contact withdrew consent.

> Nothing is checked against a national registry (for example India NDNC or the United States Do Not Call registry) from here. Download the extract you are entitled to and add it to the list. A live registry check needs credentials from the registry and is not built yet.

Seeing the list needs permission to read the Compliance center. Adding and removing numbers needs permission to manage it, and each change is recorded in the audit log.

## The age at which a person counts as a minor

Under **Laws and regions**, "Treat a person as a minor under" shows the age used in your workspace: the highest age among the profiles you switched on (13 for the United States, 16 for the EU, 18 for India DPDP and when no profile is on). Forms, the website chat and flows start from this age, and each can use its own. See [forms](help:forms-builder) and [website chat bots](help:website-chat-bots) for how an age is asked.

The consent manager note for India DPDP also has a registration number field. It is a note only: nothing is connected to a consent manager yet.

## Who can do what

People with the read permission can see everything and cannot change it. People who may manage the Compliance center can save changes. Writing the default notice also needs permission to manage consent. Each change is recorded in the audit log, without the officer's contact details.

## If something looks wrong

- **The suggestion is wrong.** It comes from the billing country, or the country given at sign-up. Ignore it and tick the profiles you need.
- **Someone else saved first.** A message says so and loads the latest settings. Check them and make your change again.
- **The public page shows nothing.** It needs the switch on, saved, and at least the vendors marked as in use.
