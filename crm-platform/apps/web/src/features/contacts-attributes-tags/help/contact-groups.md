---
id: contact-groups
title: Contact groups
summary: Named lists of contacts that you fill by hand: create a group, give it a colour, see how many contacts it holds and jump to its members.
area: audience
order: 20
documents: [nav:contact-groups]
keywords: [groups, lists, audience, bucket, tag, segment, vip]
---

## What it is for

A group is a named list of contacts that you fill yourself. A contact can be in several groups, and a contact stays in a group until you remove it. Use groups for audiences such as VIPs, new sign-ups or the guests of an event. Deleting a group never deletes its contacts.

If you want a list that fills itself from rules, use a segment instead. See [Segments](help:segments-overview).

## How to use it

1. Open **Groups** in the CRM area of the menu, or go to `/contact-groups`. The screen is titled **Contact groups**, and each row shows the group's colour, name, note, how many contacts it holds, who created it and when, who last changed it and when.
2. Select **New group**.
3. Enter a **Group name**. Add a **Note** if you like and choose one of the five accent colours.
4. Select **Save group**.
5. Select **View contacts** on a row to open the Contacts list filtered to that group. Use the pencil to edit a group or the bin to delete it; deleting asks you to confirm.

## Finding a group and seeing who changed it

- Type in the search box above the table to narrow the list by name. The search looks through every group in the workspace, not only the rows on screen.
- **Activity** opens the workspace audit trail for groups, newest first, for the last 30 days: who did what, and which fields changed. Search it by person, action or field name. It shows the names of the changed fields, never their values. You need permission to read the activity log to see the button.
- **Modified by** and **Updated at** change when the group's name, note or colour is saved. Adding or removing contacts does not count as a change to the group.

## Putting contacts into a group

- On [Contacts](help:contacts-overview), tick the contacts, open **More Actions** and choose **Add to group**. The "..." menu on a single row has **Add to group** too.
- Edit a contact and tick the groups it belongs to.
- During a **Bulk upload**, pick a group for everyone in the file. A group column in the CSV is applied as well.

## Plan and access

Opening the screen needs permission to read contacts. Creating, editing and deleting groups here needs permission to update contacts; without it you only see the groups and their counts. On the Contacts screen, **New group** in **More Actions** has its own permission to create contact groups. This screen has no plan requirement of its own.

## If something looks wrong

- **A group with this name already exists.** Group names are unique. Creating one with a taken name does not make a second group.
- **"Groups are not available yet".** The contact groups service is not live on this server. Ask your workspace admin.
- **A deleted group is gone from its contacts.** Nothing else changed. Create the group again and add the contacts back.
- **No groups and no buttons.** You can only view groups. Ask a workspace manager to create the first one.
