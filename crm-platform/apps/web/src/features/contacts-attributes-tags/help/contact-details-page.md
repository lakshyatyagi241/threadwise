---
id: contact-details-page
title: Contact details page
summary: One contact in full: the lifecycle stage and status, every field, notes, files, conversations, deals, tasks, consent and the history of changes.
area: audience
order: 12
documents: []
keywords: [contact, profile, details, overview, activities, notes, files, deals, tasks, consent, history, stage, status, lead score]
---

## What it is for

The **contact details page** is everything about one person in one place. Open it from **Contacts** with **See all details** in the quick view, or with the open icon on a row, or go to `/contacts/<id>`. See [Contact quick view](help:contact-quick-view) for the lighter version.

## The page

- **The menu on the left.** **Back to listing** returns to the list. **Contact details** holds Overview, Activities, Conversations, Contact details, Communication stats, Notes and Files. **Related** holds Tasks, Deals, Appointments, Invoices and documents, Lead source, Company, Consent and Field history. You only see what your role and plan allow.
- **The header.** The contact's name, lifecycle stage chip, lead-score star, an opted-out badge, minor and privacy badges, then email, phone, company and owner on one line, their social links, and their tags with **Add tag**. **Contact Field History** and the privacy menu (export or erase the contact's data) are at the end. The action bar under it has **Note**, **Task**, **Meeting**, **Add company**, the WhatsApp, email, chat and phone icons and a **...** menu with **Edit contact** and **Delete contact**.
- **Lifecycle.** The stages of your workspace run left to right with the contact's stage highlighted and the ones before it tinted. Select a stage to move the contact there. A lost stage asks for a reason. Under it, the **Status** bar lists the statuses that are valid in that stage; select one to set it. Moving to another stage keeps the status valid for it, and the message says what happened to the status.

## The sections

1. **Overview.** The same tabs and cards as the quick view: contact information, social media, lead source, custom fields; lead score, subscription status, owner and assignment, location and privacy.
2. **Activities.** Meetings logged with the contact, then the timeline of everything that happened.
3. **Conversations.** The chats found for this contact, with the channel, the last message, unread count and a link to open the chat in the Team inbox.
4. **Contact details.** Every field in one list, the groups, and your custom property sections.
5. **Communication stats.** Figures for the chats, calls and open tasks found for this contact. They cover what exists today; there are no per-contact sent, delivered or read counts.
6. **Notes.** Write notes about the contact, edit or delete them. A note counts as activity.
7. **Files.** The files attached to the contact. Uploading is not available yet.
8. **Tasks, Deals, Appointments, Invoices and documents.** What is linked to the contact. Each is shown only with its own permission, and Deals needs a plan with the sales pipeline.
9. **Lead source.** Where the contact came from.
10. **Company.** The linked company; change it here.
11. **Consent.** The record of what the contact agreed to, when and where, with buttons to record a change. See [Contact consent](help:contact-consent).
12. **Field history.** Every change made to the contact's fields, newest first, with the person or system that made it.

## Good to know

- Changing an owner, stage, status, tag or company saves at once and is checked again by the server. If someone changed the contact first, you are told and the page reloads.
- **Delete contact** asks for confirmation and offers to keep the conversations without the person's identity.
- The page and the quick view read the same data, so a change made in one is seen in the other.

## If something looks wrong

- **A section is missing.** Your role or your plan does not include it.
- **Deals says it is not available.** Your plan does not include the sales pipeline, or your role cannot read deals.
- **The job title line is missing.** Add a contact property called Job title (key `job_title`) under Contact properties.
