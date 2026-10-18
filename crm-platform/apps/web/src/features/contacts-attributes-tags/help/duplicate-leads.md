---
id: duplicate-leads
title: Duplicate leads
summary: Choose what happens when a new lead from a lead source has the same phone number or e-mail as a contact: merge it into that contact or create a new one.
area: settings
order: 42
documents: [tile:duplicate-leads]
keywords: [duplicate, merge, lead, same phone, same email, new contact, lead source, webhook, lead ads]
---

## What it is for

The same person can fill in more than one form or click more than one ad. When a new lead arrives through a lead source (a webhook, Meta lead ads or another connected source) and its phone number or e-mail already belongs to a contact, this page decides whether the lead is **merged into that contact** or becomes **a new contact**.

## How to use it

1. Open **Settings**, then **Automation and AI**, then **Duplicate leads**, or choose the gear on the Contacts page. Only people who manage the workspace settings see this page.
2. Choose **Merge into the existing contact** (the way it has always worked) or **Create a new contact**.
3. Optionally switch on **Add a note to the timeline when a lead is merged**.
4. Select **Save**. The choice applies to the next lead, not to leads that already arrived.

## What each choice does

- **Merge into the existing contact.** The lead fills the blanks of the contact (name, e-mail, phone, custom fields) and never overwrites something already there. The contact keeps its owner and its first source, and the lead is added to its history as a new touch (campaign, ad and form). A new consent is recorded only when the lead itself proves it.
- **Create a new contact.** A separate contact is made, counted against your plan's contact limit. The shared phone number or e-mail stays linked to the first contact, so incoming messages keep going there, and the new contact carries a timeline entry that says it may be a duplicate. You can merge them later with **Remove duplicates** on the Contacts page.
- A lead that matches nothing always creates a contact, and a test lead from the source screen is never merged or duplicated.

## Options and settings

- The note on merge starts switched off: a timeline note also moves the contact's last activity, which would change what you see today.
- The same lead sent twice (the sender's own id) is recognised and never repeated, whichever choice is on.

## Plan and access

The page needs permission to manage workspace settings, which Owners and Admins have. It applies to every lead source of the workspace. This page has no plan requirement of its own; the lead sources themselves follow their plan feature.

## If something looks wrong

- **A lead was merged although I chose a new contact.** The choice applies from the moment it is saved. Leads that arrived earlier were already merged.
- **Two contacts share a phone number now.** That is what **Create a new contact** does. Merge them with **Remove duplicates** when you are ready.
- **Someone else changed these settings.** The page was refreshed with their values. Make your change again.
