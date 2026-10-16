---
id: team-inbox-overview
title: Team inbox
summary: Read and answer customer conversations from every connected channel, assign them to your team, leave internal notes and resolve them.
area: inbox
order: 10
documents: [nav:inbox]
keywords:
  [inbox, conversations, reply, notes, assign, resolve, unread, customers, messages, 24-hour window]
---

## What it is for

The Team inbox gathers every customer conversation from your connected channels in one place. Your team reads, answers, assigns and resolves them here, and leaves internal notes that customers never see.

## How to use it

1. Open **Inbox**. The left column lists conversations, the middle shows the open one, and the right holds the contact and notes. On a phone the list comes first and a conversation opens over it with a back button.
2. Use the views **All**, **Mine**, **Unassigned** and **Unread**, and filter by **Status**, **Priority** and **Channel**. Search by name or number.
3. Select a conversation to read it. Use **Load earlier messages** for older history, and **Jump to latest** when you have scrolled up.
4. To answer, keep **Reply** selected, type in the box and press Enter. To leave a note only your team sees, choose **Internal note** first, then **Add note**.
   Above the box are formatting buttons for a chat message: **Bold**, **Italic**, **Underline**, **Strikethrough**, a **bulleted list** and a **numbered list**. They write WhatsApp's own marks into the text (`*bold*`, `_italic_`, `~strike~`, and `- ` or `1. ` at the start of a line), so the customer sees the formatting in WhatsApp; underline has no mark in WhatsApp, so it is drawn with a line under each letter (it can look different on some phones). The sparkle button opens the **Smart AI Assistant**: **Condense** (shorter), **Fix Grammar**, **Positive Tone** and **Translate** (pick a language from the searchable list). It works on the text you selected, or on the whole message when nothing is selected, and puts the result back in the box for you to read, edit and send; nothing is sent by it. It needs an AI model enabled for the workspace; without one the button is off.
5. To send a place, contact cards, buttons or a list, select the **+** button next to the box. Pick **Location** (latitude and longitude, plus an optional place name; you can paste "28.6139, 77.2090" from a map), **Contact** (a name and a phone or email, up to 10 contacts) or **Buttons**: up to 3 reply buttons, one button that opens a link, or a list (one button that opens up to 10 rows in sections). Location and Contact work on every WhatsApp number; Buttons and lists work on a WhatsApp Cloud API number only, and, like any free-form message, only inside its 24 hour window.
6. Select **Assign to me** to take the conversation, or pick a teammate or team in the contact panel. **Unassign** releases it.
7. Select **Resolve** when it is done. **Reopen** brings it back.

8. To act on several conversations at once, select **Select** above the list. Click rows to pick them, or hold Shift and click to pick the run between two rows. **Select all** takes every conversation loaded in the list, and the bar shows how many are selected. Choose **Mark as read**, **Resolve**, **Close**, **Reopen**, **Assign**, **Priority**, **Snooze** or **Tag**; the action is applied to each conversation on its own, and the message that follows says how many were updated, how many were already up to date and how many could not be changed. The ones that failed stay selected so you can see them and try again. A bulk action needs the bulk right plus the right for the action itself (for example resolve). Up to 200 conversations are changed per request; a longer selection is sent in several.
9. To set one conversation aside, use **Snooze** in its header and pick 1 hour, 3 hours, tomorrow at 9:00 or next Monday at 9:00. It leaves the Open list and comes back by itself at that time, with an entry in its timeline. **Wake now** brings it back early. Use the **Priority** menu in the header to mark it Low, Normal, High or Urgent.
10. For more than the boxes above the list, select the funnel button (a number on it says how many choices are on) to open the **Filters** window. It has **Chat status** (pick several at once; with none picked the list shows Open and Pending), **Conversation** (Assigned, Unassigned, or Unattended, which means it has messages nobody has read yet), **Tags**, **Channels**, **Agents** (conversations assigned to any of the people you tick), **Sort by** (Recent, or Old for the oldest activity first, which ignores pins) and a **Date range** of the last activity. Nothing changes until you select **Apply**; **Reset** clears all of them. The boxes above the list edit the same filters.

11. To tag a conversation, open the side panel and use **Tag** in the **Conversation tags** group, tick the tags that apply, then use the **Tags** filter above the list to show only conversations with those tags. See [Conversation tags](help:inbox-tags).

Keyboard shortcuts work when you are not typing: `j` and `k` move through the list, `e` resolves or reopens, and `/` jumps to search.

## Options and settings

- The contact panel has three tabs. **Contact** shows the customer's details and past conversations. **Notes** holds the internal notes. **Timeline** lists what happened, such as assignments, status changes and first replies.
- Each conversation shows its status (Open, Pending, Snoozed or Resolved) and its priority. The status list above the conversations starts on **Open**, which shows the conversations still being worked on: Open and Pending. **Resolved** also lists conversations the system closed (for example when a channel was removed): to an agent they are the same.
- **Pending** and **Snoozed** are both ways of setting a conversation aside, and they differ in one thing. **Pending** means you are waiting for the customer (or for something else) and the conversation stays in your **Open** list so it is not forgotten; it has no timer and comes back to Open when the customer writes. **Snoozed** hides the conversation until a time you pick, then it wakes by itself and returns to Open; it is not in the **Open** list while it sleeps.
- A red or amber **SLA** badge on a conversation means its response clock ran out or is about to: the customer has waited longer than the first-reply target, or the conversation is past its resolution target. The badge shows only on plans with response targets. See [Response targets (SLA)](help:sla-policies).
- **Channels** lists the accounts customers reach you on, with their status and reply window.
- **Email** mailboxes appear in the **Channel** filter under their own **Email** heading, one entry per connected mailbox. An email conversation shows the subject as its title, the message headers, attachments and the **Load images** button, and its reply box adds **Cc, Bcc and subject** and leaves out emoji, templates and files. See Email mailboxes.

## Tags: contact tags vs conversation tags

The side panel shows two separate groups of tags. Both come from the same workspace tag library, and they answer different questions.

- **Contact tags** describe the person: VIP, lead, region. They belong to the contact, so they follow the customer into every conversation. Here they are read-only; select **Edit on contact** (if you may edit contacts) to change them.
- **Conversation tags** describe this thread: billing, refund, urgent. They belong to the conversation only. Add them with **Tag** and take them off with the **×** next to a tag.

The **Tags** filter above the list has a switch for **Conversation tags** and **Contact tags**, so you can find every thread that has a tag itself, or every thread with a person who has it. See [Conversation tags](help:inbox-tags) and [Contacts](help:contacts-overview).

## Plan and access

You need the right to read conversations to open the inbox. Replying, adding notes, assigning, assigning to yourself and resolving each need their own right. Without the reply right the box is read-only, and the screen says so. Managing channels needs its own right.

## If something looks wrong

- **You cannot send a free-form reply.** WhatsApp allows free-form replies only within 24 hours of the customer's last message. After that, only an approved template can be sent. A banner explains the window, and you can still add notes.
- **There is no + button, or the Buttons tab is missing.** The channel does not carry them. A WhatsApp number linked by QR code sends plain text, files, locations and contact cards, but not buttons or lists.
- **A message shows as not sent.** Only a message that failed can be sent again, using **Retry**. Check that the channel is connected.
- **A channel is disconnected.** Reconnect it under WhatsApp numbers or the channel's settings before replying.
- **A conversation is missing.** Check the filters, or whether it belongs to a channel you cannot see.
- **Someone else changed the conversation first.** It has been reloaded. Try the action again.
