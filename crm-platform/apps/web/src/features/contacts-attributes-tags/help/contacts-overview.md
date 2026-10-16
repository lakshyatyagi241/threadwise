---
id: contacts-overview
title: Contacts
summary: Your customer list: search, filter, add, import and export contacts, change their stage, and tag or group many at once.
area: audience
order: 10
documents: [nav:contacts]
keywords: [customers, people, leads, import, csv, export, duplicates, tags, bulk, contact hub, owner, assign, reassign, my contacts]
---

## What it is for

**Contacts**, also called the Contact Hub, is your customer list. Every person you message or sell to is a contact here. Find people, add or import them, move them through your sales stages and act on many at once.

## How to use it

1. Open **Contacts** in the CRM area of the menu, or go to `/contacts`.
2. Search by name or number, or narrow the list with **Select Segment**, **Select Tag**, **Owner** and **Filters**.
3. Select **Create Contacts**. A first name and a mobile number or email address are required.
4. Select a name to open the contact page, with its stage, tasks, activity and details.
5. Change a stage from the table by selecting the stage chip. A lost stage asks for a reason.
6. Tick rows, then open **More Actions** to export, add to or remove from a group, tag, untag or delete.
7. To change several contacts at once, tick them and choose **Update**. Set the stage, status or owner, or use **Add property** under **Custom properties** to pick a property and give it one value for everyone selected. **Clear** empties that property on all of them; **Keep** takes it off the list so it is left alone. Anything you do not touch stays as it is.

## Company

If you can read companies, the contact form has a **Company** field: search, pick a company, or select the cross to remove it. When no company matches and you may create companies, **Create "name"** makes one and picks it. A company you may not read cannot be picked. The company shows in the contact's header, and the contact appears on the company's page. See [Companies](help:companies-overview).

## Owners

Every contact can have one **owner**, the person who looks after it. A contact you create is yours until you pick someone else (or **Unassigned**) in the **Owner** field of the form.

- **See who owns what.** Turn on the **Owner** column under **Columns**. It starts hidden. Contacts nobody owns say **Unassigned**.
- **Filter by owner.** Open **Owner** in the toolbar. Tick one or several people, and **Unassigned** to include contacts nobody owns. **My contacts** shows only yours. The choice is kept in the page address, so you can share the link.
- **Change one contact's owner.** Open the contact. Under **Details**, select the owner and pick another person. You can also change it in **Edit**.
- **Move many contacts.** Tick rows and choose **Update**, then **Owner**. To move everything a filter matches, tick the top box, select **Select all N matching this filter** in the banner, then **More Actions**, **Update**. Only the owner can be changed that way. With one person in the **Owner** filter, **Reassign the contacts of** that person does the same in one step.
- **Who you can pick.** Your access decides. With access to your own contacts you can only keep a contact for yourself; with team access, yourself and your teammates; with full access, anyone. If you pick someone you are not allowed to, the form says so and nothing is saved.
- **Export.** The CSV has an `owner_email` column. Importing does not read it yet, so imported contacts belong to the person importing.

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

## Date of birth and minors

A contact can have a **Date of birth**, set on its edit form, in an import or by a form, the chat or a flow. When the person is under your workspace's age, the contact is flagged as a minor and shows a minor badge next to its name. Use the **Minors** view of the list to see them, or the "minor" filter in the filter panel and in segments. See [consent](help:contact-consent) for how the flag works and when it lapses.
