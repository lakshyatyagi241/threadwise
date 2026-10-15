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

Set quiet hours for messages, a calling window with days, the time zone they are read in, and the Do Not Call or DND registry you check against.

> These settings are saved but not enforced yet. A message is not held back and a call is not blocked outside the hours you set. Plan your sending and calling around them.

## Who can do what

People with the read permission can see everything and cannot change it. People who may manage the Compliance center can save changes. Writing the default notice also needs permission to manage consent. Each change is recorded in the audit log, without the officer's contact details.

## If something looks wrong

- **The suggestion is wrong.** It comes from the billing country, or the country given at sign-up. Ignore it and tick the profiles you need.
- **Someone else saved first.** A message says so and loads the latest settings. Check them and make your change again.
- **The public page shows nothing.** It needs the switch on, saved, and at least the vendors marked as in use.
