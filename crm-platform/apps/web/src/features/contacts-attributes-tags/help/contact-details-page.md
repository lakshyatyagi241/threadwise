---
id: contact-details-page
title: Contact details page
summary: One contact in full: who they are, one row of things to do, the activity timeline with a quick note, task, call and meeting box, and every other section.
area: audience
order: 12
documents: [nav:contacts]
keywords: [contact, profile, details, overview, activity, timeline, log a call, note, task, meeting, files, deals, consent, history, stage, status, lead score, key details]
---

## What it is for

The **contact details page** is everything about one person in one place. Open it from **Contacts** with **See all details** in the quick view, or with the open icon on a row, or go to `/contacts/<id>`. See [Contact quick view](help:contact-quick-view) for the lighter version.

## The page

- **The menu on the left.** **Back to listing** returns to the list. Three small groups: **Contact** (Overview, Activity, Conversations, Notes, Tasks, Meetings, Files), **Related** (Deals, Appointments, Invoices, Company) and **Record** (Details, Stats, Source, Consent, History). Notes, Tasks, Meetings and Files show how many there are. You only see what your role and plan allow. On a phone the menu becomes a row of tabs you scroll sideways.
- **The header.** The contact's name, lifecycle stage (select it to change it), lead score, opted-out and privacy badges; then phone, email, company and owner on one line; their tags with **Add tag**.
- **One row of actions.** **Note**, **Task**, **Call**, **Meeting** and **Message**, and a **...** menu. Note, Task, Call and Meeting take you to the **Activity** tab with that form open and the cursor in it, so nothing pops up. **Call** starts a call in the best way available (a WhatsApp call, otherwise your phone) and its small arrow offers the other ways and **Log a call**. **Message** opens the WhatsApp chat, or an email when there is no WhatsApp number, and its arrow offers a WhatsApp template and email. The **...** menu has **Edit contact**, **Add company** or **Change company**, **Field history** and **Delete contact**.
- **The stage line.** Under the header, one thin line shows the stages of your workspace with the contact's stage filled and the ones before it tinted. Select a stage to move the contact there. A lost stage asks for a reason. At the end, the **Status** menu lists the statuses that are valid in that stage. Moving to another stage keeps the status valid for it, and the message says what happened to it.

## The sections

1. **Overview.** On the left, **Key details** (phone, email, company, owner, city or address, source and last activity). Hover a value and select the pencil to change it where it stands; **Edit all** opens the full form and **Show all details** lists every field, the social links and your custom properties. Under it, **Subscription status** is open and the other cards are folded into one line each: **Tags and groups**, **Company**, **Time zone and location** (with when marketing messages may go), **Privacy** and **Lead score**. Select a card to open it; it stays as you left it. On the right, **Recent activity** shows the latest entries with **View all activity**.
2. **Activity.** The timeline comes first. At the top, a box with four tabs, **Note**, **Task**, **Call** and **Meeting**. Under it, the filters **All**, **Messages**, **Calls**, **Notes**, **Tasks**, **Meetings** and **Changes**, a search box, and the history in groups: **Up next** (open tasks and meetings still to come), **Today**, **Yesterday**, **This week** and **Earlier**. Select an entry to read more; tick a task to complete it; select a conversation to open the chat. **Load more** goes further back. A friendly start is shown when nothing has happened yet.
3. **Conversations.** The chats found for this contact, with the channel, the last message, unread count and a link to open the chat in the Team inbox.
4. **Notes, Tasks, Meetings.** The full lists, with the same inline forms as the Activity box. See [Contact quick view](help:contact-quick-view).
5. **Files.** The files attached to the contact. Uploading is not available yet.
6. **Deals, Appointments, Invoices, Company.** What is linked to the contact. Each is shown only with its own permission, and Deals needs a plan with the sales pipeline. In **Company** you search and change the company in place.
7. **Details, Stats.** Every field in one list, the groups and your custom property sections; figures for the chats, calls and open tasks found for this contact.
8. **Source.** Where the contact came from, with the first and latest lead touch.
9. **Consent.** The record of what the contact agreed to, when and where, with buttons to record a change. See [Contact consent](help:contact-consent).
10. **History.** Every change made to the contact's fields, newest first, with the person or system that made it.

## Logging a call

Select **Log a call** (from the **Call** arrow, or the **Call** tab of the box). Say whether you called them or they called you, how it went (**Connected**, **No answer**, **Busy**, **Left voicemail**, **Wrong number**), when (now to begin with), how long (optional) and what was said. Turn on **Create a follow-up task** and choose when it is due to get a task as well. The call appears on the timeline. You need permission to log calls; without it the **Call** tab and **Log a call** are not shown.

When you open your phone from **Call on your phone** and come back to the page, a quiet line asks **How did the call go?** with **Log it**. It never blocks you: dismiss it with the cross and it will not ask again about that call.

## Good to know

- Changing an owner, stage, status, tag, company or a key detail saves at once and is checked again by the server. If someone changed the contact first, you are told and the page reloads.
- A **Call** that starts from your phone's dialer cannot be seen by the CRM: it only knows you clicked. That is why it asks afterwards.
- **Delete contact** asks for confirmation and offers to keep the conversations without the person's identity.
- The page and the quick view read the same data, so a change made in one is seen in the other.

## If something looks wrong

- **A section is missing.** Your role or your plan does not include it.
- **There is no Call tab.** You do not have permission to log calls, or your workspace does not have call logging yet.
- **Deals says it is not available.** Your plan does not include the sales pipeline, or your role cannot read deals.
- **The timeline search finds less than you expect.** It searches what is loaded so far; select **Load more** to look further back.
