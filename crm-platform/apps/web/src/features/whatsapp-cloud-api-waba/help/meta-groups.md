---
id: meta-groups
title: WhatsApp groups
summary: Create WhatsApp groups from your business number, share the invite link, approve people who want to join and remove members.
area: campaigns
order: 17
documents: [nav:waba-groups]
gates:
  planFeature: waba_groups
  permission: waba.groups.read
keywords: [groups, whatsapp group, meta groups, invite link, join request, approve, members, official business account, group chat]
---

## What it is for

WhatsApp groups let you talk to many customers in one chat from your business number. You create the group here, WhatsApp gives you an invite link, and you share that link. People choose to join: there is no way to add someone directly. Messages that people post in a group appear in your [Team inbox](help:team-inbox-overview) as a chat of their own.

WhatsApp groups are a paid feature. **Meta Groups** appears in the menu, under Campaigns, only when your plan includes it and a WhatsApp Business number is connected.

## Before you start

- The number must be an **Official Business Account**: the verified tier with the green badge. WhatsApp only opens groups to those numbers, and not to numbers that are also used on the WhatsApp Business app. A number that does not qualify sees a page saying so instead of the controls. Apply for the status in WhatsApp Manager, then select **Check again**.
- The number must be connected straight to Meta. A number reached through another provider shows a message that groups are not available on that route.

## How to use it

1. Open **Meta Groups** in the menu. If you have more than one number, pick the number on the left: every number has its own groups.
2. Fill in **Create a group**: a name (up to 128 characters), who can join, and an optional description. Choose **Anyone with the link joins straight away** or **You approve each person first**, then select **Create group**.
3. The group appears in the list with the text **Invite link is being created by WhatsApp…**. The link shows up on its own a moment later, when WhatsApp issues it. Select **Copy** and share it.
4. When a group asks for approval, people who open the link appear under **Waiting to join**. Select **Approve** or **Reject** for each one.
5. Select **Refresh** on a group to read its current state and link from WhatsApp.

## Changing a group

- **New link** creates a fresh invite link. Every link you sent before stops working, and you are asked to confirm.
- **Edit** changes the name and the description. The change is sent to WhatsApp and appears on this page once WhatsApp confirms it, so a name can change while the description is still waiting.
- **Members** lists the people in the group, read from WhatsApp each time you open it (nothing is stored here). Tick up to 8 people and select **Remove selected**. A removed person cannot rejoin with the old link.
- **Delete** removes everyone from the group, including your business, and deletes it. A deleted group cannot be recovered. Its chat history stays in your inbox.

## Costs and limits

Every message you send to a group is charged once per person who receives it, as WhatsApp states: a message to 100 members costs 100 sends. The four counters at the top show your groups, their members, the people waiting to join and the groups WhatsApp has suspended.

A suspended group shows a warning. You cannot message it until WhatsApp restores it.

## Staying up to date

The page updates by itself: when someone asks to join, when a colleague creates, edits or deletes a group, or when WhatsApp suspends or restores one, the list, the counters and the waiting requests refresh within a second, without reloading.

People with permission to manage groups also get a notification in the bell: **N people want to join (group name)** (ten requests in a row are one line with the count), **(group) was suspended**, and **(group) is active again** for those who heard about the suspension. The notification names the group and the number of people, never a phone number or the invite link. You choose how each one reaches you under **Notification preferences**, in the **WhatsApp groups** section: bell and pop-up are on, the browser notification is off until you turn it on. That section only appears when your plan includes WhatsApp groups.

## Plan and access

Groups need a plan that includes WhatsApp groups. Seeing groups and their invite links needs permission to view groups; creating needs the create permission; the link reset, editing, join requests and members each need the manage permission, and deleting needs the delete permission. The phone numbers of people waiting to join and of members are shown only with the manage permission. The page also reads your WhatsApp numbers, so it needs the right to view them.

## If something looks wrong

- **This number cannot use groups yet.** It is not an Official Business Account. Apply in WhatsApp Manager, then select **Check again**.
- **The invite link never appears.** WhatsApp sends it in a message to this workspace. Select **Refresh** on the group. If it still does not appear, the group may have failed to create: the row then shows the reason from WhatsApp.
- **Too many group operations.** WhatsApp or this workspace limits how fast one number can change groups. Wait a minute and try again.
- **A limit was reached.** WhatsApp limits how many groups a number can create. Delete one you no longer need.
- **What can I send to a group from the inbox?** Text, files and templates. Reactions, places, contact cards and buttons are not available in a group. A group that Meta suspended cannot be messaged until Meta clears it.
- **What does a group message cost?** Every message is charged once per member who receives it, from your workspace's own message wallet. Before sending, the inbox checks that the wallet can cover one message to every member; if it cannot, the message is not sent and you are asked to top up. Members Meta marks as free are not charged. Under each message you sent, the inbox shows how many members it reached and how many were billed or free.
- **Who wrote a message in the group?** Each message from a member shows the member's name (when WhatsApp gives one) and number above it.
