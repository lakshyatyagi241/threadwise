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
2. Select **New segment**, then enter a **Name**, an optional **Description** and a colour. Choose who can see it: **Private**, **Shared** or **Specific people** (see below).
3. Under **Who is in this segment**, choose **All (AND)** or **Any (OR)** and select **Add condition**. Pick a field, an operator and a value. **Add group** nests conditions.
4. Check the **Live preview** for the number of matching contacts and the **In plain words** sentence.
5. Select **Create segment**, then open it to see its rules and members.

You can also select **Save as segment** on the Contacts screen after setting filters there.

## Options and settings

- Conditions can use stage, status, lead score (only while lead scoring is on for your workspace), people fields, activity dates and your own [contact properties](help:contact-properties). A segment holds up to 50 conditions.
- The "..." menu on a row offers **Edit rules**, **Duplicate**, **Export members (CSV)**, **Tag members**, **Add members to a group** and **Delete**. Tagging and grouping apply to the people who match right now.
- **Recount members** refreshes a member count.

## Sharing with specific people

Under **Who can see it**, choose **Specific people** to show the segment only to the people you pick, plus you and anyone who can edit every segment. Search the list by name or email, tick people (and teams, when you can see them) and check the count under the chips. You need to pick at least one, and up to 200. Choosing a team shares it with everyone who is on that team now, including people who join later.

- People you share with can see the segment, use it as a Contact Hub filter or a broadcast audience, and export, tag or group its members, but they cannot edit or delete it.
- Remove a person and the segment disappears for them straight away. A broadcast already scheduled to that segment still goes out.
- The list shows how many people a segment is shared with; hover over the badge to see their names. **Duplicate** copies the people too. Switching a segment back to Private or Shared clears the list.

## Plan and access

Opening the screen needs permission to read segments. Creating, editing and deleting need their own permissions, and you can only change a segment you may edit. Seeing members needs permission to read contacts; exporting needs permission to export contacts; tagging or grouping needs permission to update contacts.

## If something looks wrong

- **A condition needs fixing.** A tag, group, stage or property it uses was deleted. Select **Fix the rules**.
- **Another segment already has this name.** Choose a different name.
- **Someone else changed this segment.** Reload to see their version.
- **Choose at least one person or team.** Specific people needs someone on the list. If the app says some people are no longer in the workspace, remove them and save again.
- **Nobody matches yet.** Loosen a condition or check the values.
