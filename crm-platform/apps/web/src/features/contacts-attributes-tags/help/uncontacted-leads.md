---
id: uncontacted-leads
title: Uncontacted leads
summary: Mark the leads nobody has reached yet, choose which actions count as reaching out, and decide which new contacts and reassigned contacts start as uncontacted.
area: settings
order: 40
documents: [tile:uncontacted-leads]
keywords: [uncontacted, contacted, lead, new lead, first contact, marker, reassign, follow up]
---

## What it is for

A lead nobody has reached yet is easy to lose in a long list. The **Uncontacted** marker is a quiet label on such a contact: a small dot beside the name in the list, a chip in the contact's header and in the quick view. It disappears as soon as someone on your team gets in touch, so the team can work through the leads that are still waiting. Nothing is marked until you switch an option on here, and contacts you already have are never marked on their own.

## How to use it

1. Open **Settings**, then **Automation and AI**, then **Uncontacted leads**, or choose the gear on the Contacts page. Only people who manage the workspace settings see this page.
2. Under **Mark as contacted**, choose what removes the marker: pressing a contact button or placing a call, sending a message, template, saved reply or file from the inbox, a campaign, broadcast or flow sending to the lead, or adding a note, meeting or other activity to the timeline.
3. Under **Mark new leads as uncontacted**, choose which new contacts start with the marker: created manually in the app, imported from a file or Google Sheets, or created by a lead source, a form or an integration.
4. Under **Reassigned leads**, choose whether giving a contact to a new owner (one by one, in bulk, when someone is away, or by an assignment rule) keeps the marker as it is or marks the contact as uncontacted again.
5. Select **Save**. The options apply to the next action, not to the past.

## Working with the marker

- The **Uncontacted** view and chip on the Contacts page list the marked contacts. They appear only while at least one contact is marked.
- To change a marker by hand, open the **More** menu on a contact and choose **Mark as contacted** or **Mark as uncontacted**, or select several contacts and use **More** in the bar above the list. This works on everything the filter shows when you select all matching contacts.
- A contact can also be found with the condition **Uncontacted** in the advanced filter and in segments.

## Options and settings

- The four **Mark as contacted** options start switched on, because they only act on contacts that are already marked. The options that mark contacts (new leads, reassigned leads) start switched off.
- A lead that arrives from a lead source and matches a contact you already have is not marked: only a newly created contact can start as uncontacted.
- Automatic replies, FAQ answers and consent keyword replies do not count as reaching out, so a new lead keeps its marker until a person or one of your own campaigns or flows contacts it.
- A call counts when a person placed it (even if nobody answered) or answered it; a missed call from the lead does not.

## Plan and access

The page needs permission to manage workspace settings, which Owners and Admins have. Changing a single contact's marker needs permission to edit contacts, and only the contacts you may edit. This page has no plan requirement of its own.

## If something looks wrong

- **The marker did not clear.** Check that the option for that kind of action is switched on, and that the action was done by a person (or by one of your campaigns or flows) after you saved.
- **The marker did not appear on a new contact.** The contact may have matched one that already existed, or its creation method is switched off.
- **Someone else changed these settings.** The page was refreshed with their values. Make your change again.
