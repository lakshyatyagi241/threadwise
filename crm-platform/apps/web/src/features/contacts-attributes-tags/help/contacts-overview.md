---
id: contacts-overview
title: Contacts
summary: Your customer list: search, filter, add, import and export contacts, change their stage, and tag or group many at once.
area: audience
order: 10
documents: [nav:contacts]
keywords: [customers, people, leads, import, csv, export, duplicates, tags, bulk, contact hub]
---

## What it is for

**Contacts**, also called the Contact Hub, is your customer list. Every person you message or sell to is a contact here. Find people, add or import them, move them through your sales stages and act on many at once.

## How to use it

1. Open **Contacts** in the CRM area of the menu, or go to `/contacts`.
2. Search by name or number, or narrow the list with **Select Segment**, **Select Tag** and **Filters**.
3. Select **Create Contacts**. A first name and a mobile number or email address are required.
4. Select a name to open the contact page, with its stage, tasks, activity and details.
5. Change a stage from the table by selecting the stage chip. A lost stage asks for a reason.
6. Tick rows, then open **More Actions** to export, add to or remove from a group, tag, untag or delete.
7. To change several contacts at once, tick them and choose **Update**. Set the stage, status or owner, or use **Add property** under **Custom properties** to pick a property and give it one value for everyone selected. **Clear** empties that property on all of them; **Keep** takes it off the list so it is left alone. Anything you do not touch stays as it is.

## Options and settings

- **More Actions** also holds **Bulk upload**, **Remove duplicates** and **New group**.
- **Bulk upload** takes a CSV with a header row. The preview shows which columns were recognised and how many contacts would be created, updated or rejected. Rejected rows can be downloaded.
- **Remove duplicates** merges contacts sharing a phone number into the oldest one. It cannot be undone.
- **Save as segment** turns the current filters into a [segment](help:segments-overview).

## Tags: contact tags vs conversation tags

Tags come from one workspace library and are used in two places, with two different meanings.

- A **contact tag** describes the person: VIP, lead, region. You put it on contacts from this screen (**More Actions**, then **Tag**) or from the contact page. It follows the customer into every chat; the Team inbox shows it read-only under **Contact tags**.
- A **conversation tag** describes one chat thread: billing, refund, urgent. You put it on a conversation in the Team inbox, under **Conversation tags**.

A tag you create in one place is available in the other, and a tag deleted from either place is gone from both. See [Conversation tags](help:inbox-tags) and [Team inbox](help:team-inbox-overview).

## Plan and access

Opening the screen needs permission to read contacts. Creating, editing, deleting, exporting, importing and merging each need their own permission. Your plan can cap the number of contacts; at the cap, adding says so.

## If something looks wrong

- **The list is empty.** A filter may be on. Select **Reset filters**.
- **A contact with this phone number or email already exists.** Nothing new was created.
- **An import rejects rows.** The reason is shown per row. Fix them and upload again.
- **Someone else changed this record.** Reload it and apply your change again.
