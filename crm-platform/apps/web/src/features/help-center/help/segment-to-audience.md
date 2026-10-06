---
id: segment-to-audience
title: Message the people in a segment
summary: Build a segment from a rule, preview who matches, then tag its members or add them to a group so you can pick them as an audience for a send.
area: audience
order: 40
documents: [nav:segments]
keywords: [smart segment, audience, rule, tag members, group, target, campaign audience, filter]
---

## What it is for

A segment finds people by a rule, such as "qualified contacts tagged VIP who have been quiet for 30 days". The send screens do not take a segment directly: Campaigns, Broadcasts and Scheduled messages take **tags**, **groups**, contacts or numbers. So the way to message a segment is to copy its members into a tag or a group, then pick that tag or group as the audience. This guide walks through it. For the segment screen itself, see [Segments](help:segments-overview).

## Build the rule

1. Open **Segments** and select **New segment**.
2. Enter a **Name**, for example "Hot leads gone quiet", and choose who can see it, **Private** or **Shared**.
3. Under **Who is in this segment**, choose **All (AND)** if every condition must be true, or **Any (OR)** if one is enough.
4. Select **Add condition**. Pick a field, an operator and a value. For the example, add three: **Stage** is your qualified stage, **Tags** includes any of VIP, and **Last activity** is more than 30 days ago.
5. Watch the **Live preview**. It shows how many contacts match and a sample of them, and **In plain words** reads the rule back as a sentence. Loosen a condition if the number is zero or far too big.
6. Select **Create segment**.

You can also set filters on the Contacts screen and select **Save as segment**. See [Contacts](help:contacts-overview).

## Turn the members into an audience

1. On the Segments list, open the "..." menu of your segment.
2. Choose **Tag members** to give everyone a tag, or **Add members to a group** to put them in a [contact group](help:contact-groups).
3. Pick an existing tag or group. For a tag you can also type a new name, which creates it. Confirm with **Tag members** or **Add to group**.
4. A message tells you how many contacts were tagged or added. For a large segment the work continues in the background and can take a few minutes.
5. Start your send and choose that tag or group as the audience. See [Campaign, broadcast or scheduled message?](help:choose-send-tool).

> Tagging or grouping copies who matches right now. The segment keeps updating, but the tag or group does not. Contacts who match later are not added until you run the action again, so repeat steps 1 to 4 before each send.

## Limits and access

- A segment holds up to 50 conditions, and groups of conditions can be nested three levels deep.
- Seeing members needs the right to read contacts. Tagging and grouping need the right to update contacts, and typing a new tag needs the right to create tags.
- Tags count against a limit on your plan, so creating a new one can be refused when you are at the limit.

## If something looks wrong

- **The preview says nobody matches.** Loosen a condition, or check the values, such as a stage that was renamed.
- **A condition needs fixing.** A tag, group, stage or property it uses was deleted. Select **Fix the rules**.
- **Some people are missing from the send.** Contacts who opted out are skipped by the send screens, even if they are in the tag or group.
- **The group or tag has old people in it.** Running the action again adds new matches, but it does not remove people who no longer match. Remove them from the tag or group on the Contacts screen.
