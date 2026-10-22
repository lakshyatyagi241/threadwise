---
id: personal-whatsapp-groups
title: Groups of a personal WhatsApp number
summary: Create and manage the groups of a linked personal number, answer join requests and reply from the inbox. Unofficial: WhatsApp can restrict the number.
area: inbox
order: 41
documents: [nav:devices-groups]
keywords: [groups, personal number, group admin, members, join requests, invite link, mention, ban risk, unofficial, read-only]
---

## What it is for

The **Groups** tab shows the WhatsApp groups that each linked personal number is in, and lets you manage the ones where that number is an admin: create a group, change its name, description, picture and settings, add and remove people, answer join requests, share the invite link and leave. It is part of the same area as **Numbers** and **Warmer**, so it is only available to workspaces that the platform operator has allowed. See [Connect a personal WhatsApp number](help:personal-whatsapp-connect) first.

> This uses the unofficial connection. WhatsApp watches group actions closely: creating groups, adding people who do not know you, and joining groups from links are the actions it restricts numbers for most often. We add limits to protect the number, but we cannot prevent a restriction or get a banned number back.

Messages that members write in a group also appear in the shared inbox as a conversation, and your team can reply there. See "Replying from the inbox" below.

## The page

1. Open **Settings**, then **Channels**, select **Unofficial WhatsApp API**, and open the **Groups** tab.
2. On the left, pick the number. Each number shows **Online** or **Offline**. A group belongs to one number only.
3. The counters show how many groups the number is in, how many members they have, in how many groups it is admin, how many people are waiting to join, and how many groups it left.
4. The list shows each group with its name, its picture, how many members it has and who some of them are, and badges: **You are admin** or **Not admin**, **Admins send only**, **Admins edit info**, **Approval to join**, **Left**, and the number of join requests. Use the search box and the **Show** menu to find a group or to see only active or left groups.
5. **Refresh from WhatsApp** reads the whole list again. It can be used about once a minute.

The list also updates by itself when something changes, for example when someone asks to join.

## Only an admin can change a group

If the number is not an admin of a group, you can read the group, see who is in it and chat in it from the inbox, but the buttons that change it are off and the row says why. A number that is offline cannot change anything either: the page shows the groups as last saved and says so.

## Create a group

1. Select **Create a group**.
2. Enter the **Group name** (up to 60 characters). The **Description** is optional (up to 512).
3. Under **People to add**, type phone numbers with their country code, one per line or separated by commas. You can add up to 20 at a time and add more later. The page counts them and shows any entry that is not a phone number. This number itself is added by WhatsApp, so leave it out.
4. Tick the box that says you understand the risk. You can read the full notice first.
5. Select **Create group**.

The answer says what happened to each person. Someone may not be added because their privacy settings do not allow it (send them the invite link instead), because the number is not on WhatsApp, or because they are already in. A person who could not be added does not stop the others. If WhatsApp does not take the description, the group still exists and you can edit it.

## Members

Select **Members** on a group to see who is in it, who is an admin and which one is this number. Search by name or number.

- **Add people**: type numbers as above, up to 20 at a time.
- **Remove**: tick people (up to 20 at a time) and select **Remove**.
- **Make admin** and **Remove admin** change one person.

A member that WhatsApp shows only by an anonymous id has no number here, so they can be read but not changed from this page. Numbers are personal data, so only members of your team with permission to manage groups see them.

## Edit a group

Select **Edit** to change the name, the description and the picture (JPEG or PNG, up to 5 MB), and these settings:

- **Only admins can send messages**
- **Only admins can edit group info**
- **Admins approve new members**
- **Only admins can add members**

## Join requests

When a group needs approval, people who use its invite link wait in the group's list. Each one has **Approve** and **Reject**, and **Approve all** and **Reject all** answer everyone at once (up to 50 at a time). A person with permission to see groups but not to manage them only sees how many are waiting. You are also notified when someone asks to join.

## Invite link

Select **Invite link** on a group to show it, **Copy** it, or make a **New link**. A new link ends the old one at once. The link lets anyone who has it ask to join, so share it with care.

## Join by invite link

If the platform allows it, **Join by invite link** lets the number join a group from a `chat.whatsapp.com` link. **Look up** shows the group's name and size first. This is the riskiest action, so it has its own small daily limit and needs the risk box ticked. If the button is not there, the platform has this switched off.

## Leave a group

Select **Leave** and confirm. The number leaves the group and cannot rejoin from here without an invite. The group stays in the list as **Left**, and its conversation stays in the inbox, read-only. If someone else removes the number, the same happens and you are notified.

## Replying from the inbox

A group conversation appears in the inbox like any other, and each message shows who wrote it: their name, their number, or **Group member**. In the reply box you can send text, files, a place, contact cards, reactions and replies to a message. Type `@` to open the list of the group's members and pick one to mention. A reply from the number counts as one message.

The reply box is switched off, with the reason, when the number left the group or when only admins may send and the number is not one. You can still add internal notes. **Open group** in the conversation header takes you to this tab.

## Limits

Each number has limits, shown on the left of the page with how many are left:

- group actions per minute and per day,
- new groups per day,
- joins by link per day (when joining is on),
- at most 20 people per add or remove.

When a limit is reached, or when WhatsApp pushes back, group actions on that number pause and the page shows a countdown. Wait for it to end. Trying again sooner makes things worse. The numbers are the platform defaults and the operator can change them.

## Who can do what

Separate permissions control seeing the tab and the groups, creating groups, editing groups (seeing members and join requests, using the invite link and joining by link) and leaving a group. By default only workspace admins have them. The unofficial connection must also be allowed for the workspace.

## If something looks wrong

- **The Groups tab is missing.** Your role cannot see groups, or the workspace is not allowed to use personal numbers. Ask a workspace admin.
- **The number is offline.** Open the number and reconnect it. The groups stay as last saved.
- **A group does not appear.** Select **Refresh from WhatsApp**. A group the number joined on the phone appears within a few seconds.
- **Group actions are paused.** A limit was reached or WhatsApp pushed back. Wait for the countdown.
- **The page says the feature is no longer enabled.** The operator turned it off for your workspace. Your groups and chats are kept.
