---
id: segments-overview
title: Segments
summary: Saved rules that keep a list of contacts up to date by themselves: build rules, preview who matches, then export, tag or add the members to a group.
area: audience
order: 30
documents: [nav:segments]
keywords: [rules, filter, dynamic list, audience, conditions, smart list, export, vip]
---

## What it is for

A segment is a saved rule that fills itself. You describe who belongs, for example qualified contacts tagged VIP, and contacts join and leave as their data changes. A [group](help:contact-groups) is different: you choose its members by hand.

## How to use it

1. Open **Segments** in the CRM area of the menu, or go to `/segments`.
2. Select **New segment**, then enter a **Name**, an optional **Description** and a colour. Choose who can see it: **Private** or **Shared**.
3. Under **Who is in this segment**, choose **All (AND)** or **Any (OR)** and select **Add condition**. Pick a field, an operator and a value. **Add group** nests conditions.
4. Check the **Live preview** for the number of matching contacts and the **In plain words** sentence.
5. Select **Create segment**, then open it to see its rules and members.

You can also select **Save as segment** on the Contacts screen after setting filters there.

## Options and settings

- Conditions can use stage, status, lead score, people fields, activity dates and your own [contact properties](help:contact-properties). A segment holds up to 50 conditions.
- The "..." menu on a row offers **Edit rules**, **Duplicate**, **Export members (CSV)**, **Tag members**, **Add members to a group** and **Delete**. Tagging and grouping apply to the people who match right now.
- **Recount members** refreshes a member count.

## Plan and access

Opening the screen needs permission to read segments. Creating, editing and deleting need their own permissions, and you can only change a segment you may edit. Seeing members needs permission to read contacts; exporting needs permission to export contacts; tagging or grouping needs permission to update contacts.

## If something looks wrong

- **A condition needs fixing.** A tag, group, stage or property it uses was deleted. Select **Fix the rules**.
- **Another segment already has this name.** Choose a different name.
- **Someone else changed this segment.** Reload to see their version.
- **Nobody matches yet.** Loosen a condition or check the values.
