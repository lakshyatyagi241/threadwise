---
id: contact-details-page
title: Contact details page
summary: One contact in three columns: profile and actions, the timeline with a note, task, call and meeting box, and small cards for tasks, deals and company.
area: audience
order: 12
documents: [nav:contacts]
keywords: [contact, profile, details, overview, activity, timeline, log a call, note, task, meeting, files, deals, consent, history, stage, status, lead score, about this contact]
---

## What it is for

The **contact details page** is everything about one person in one place. Open it from **Contacts** with **See all details** in the quick view, or with the open icon on a row, or go to `/contacts/<id>`. See [Contact quick view](help:contact-quick-view) for the lighter version.

## The three columns

On a wide screen (1280 px and up) the three columns fill the window and scroll on their own. On a smaller screen the cards of the right column move under the middle column, and on a phone everything is one column.

- **Left: the profile.** **Back to listing**, then the contact's name with the **lead score** chip beside it (a star and the number, green, amber or grey by how hot the lead is; select it to open the **Lead score** card; nothing is shown while lead scoring is off for your workspace) and the job title, the **Stage** control with the **Status** menu beside it, and ONE row of round actions: **Note**, **Message**, **Call**, **Task**, **Meeting** and **More**. Note, Task, Call and Meeting open that form in the compose box (nothing pops up). **Call** starts a call in the best way available, and when there are several ways it lists them (a WhatsApp call, your phone, **Log a call**). **Message** opens the WhatsApp chat, or an email when there is no WhatsApp number, and lists a template message and email. **More** has **Edit contact**, **Add company** or **Change company**, **Field history**, the privacy actions (export or erase this person's data, for those who may) and **Delete contact**.
- **Left: About this contact.** Phone, email, owner, company, address or city, source, when it was created and the last activity, then the tags with **Add tag**. Hover a value and select the pencil to change it where it stands. **Edit all** opens the full form and **Show all details** lists every field, the social links and your custom properties.
- **Middle: the tabs.** **Overview**, **Activity**, **Conversations**, **Deals**, **Files** and **More**. **More** holds Notes, Tasks, Meetings, Appointments, Invoices, Company, Source, Consent, Stats, Details and History: every section is still there and has its own address. Activity, Deals and Files show a small count (Activity counts what is waiting: open tasks and meetings still to come). You only see what your role and plan allow. On a phone the tab bar scrolls sideways.
- **Right: small cards.** Each card is one row with a count and **+ Add**: **Open tasks** (tick one to complete it), **Deals**, **Company**, **Subscription status** (the three channel ticks stay in the row), **Lead score**, **Time zone and location** (with when marketing messages may go) and **Privacy**. Open tasks and Subscription status are open when you arrive; the others are folded into one line that says what is inside. A card you open stays as you left it, and none is taller than about 200 px. The **Lead score** card is there only while lead scoring is on for your workspace (see [AI lead scoring](help:lead-scoring)); while it is off the card is left out, a score someone typed included, and it comes back with its number when scoring is switched on again.

## The stage

**Stage: Qualified** is one control. Select it to see every stage in a list (never a sideways strip): the current one is checked, each stage has its colour, and a search box appears when there are more than eight. Select a stage that has statuses and its statuses appear under it as small choices: pick one to move and set it together, or press **Move** to use the stage's default status. A stage without statuses moves at once. A lost stage asks for a reason first. The screen changes at once, goes back with the reason if the server refuses, and a message says what happened to the status and offers **Undo** for eight seconds. Arrow keys move, Enter chooses, Esc closes; on a phone the list is a sheet from the bottom. The same control is used in the list, the quick view and the bulk **Change stage**.

## The tabs

1. **Overview.** A summary strip (open tasks and the next one due, the next meeting, the last activity, open deals), then the compose box and the timeline right under it.
2. **Activity.** The compose box with four tabs, **Note**, **Task**, **Call** and **Meeting**. Under it the filters **All**, **Messages**, **Calls**, **Notes**, **Tasks**, **Meetings** and **Changes**, a search box, and the history in groups: **Up next** (open tasks and meetings still to come), **Today**, **Yesterday**, **This week** and **Earlier**. Select an entry to read more; tick a task to complete it; select a conversation to open the chat. **Load more** goes further back. A friendly start is shown when nothing has happened yet.
3. **Conversations.** The chats found for this contact, with the channel, the last message, unread count and a link to open the chat in the Team inbox.
4. **Deals.** The contact's deals, open ones first, with the value per currency. Needs a plan with the sales pipeline.
5. **Files.** The files attached to the contact. Uploading is not available yet.
6. **More.** **Notes**, **Tasks** and **Meetings** (the full lists with the same inline forms), **Appointments**, **Invoices**, **Company** (search and change it in place), **Source** (where the contact came from), **Consent** (what the contact agreed to; see [Contact consent](help:contact-consent)), **Stats** (message and call figures, the lead score and, for WhatsApp, how many messages were sent, delivered, seen, received, failed and replied to), **Details** (every field in one list, including the lead score, the stage the contact first had, who created and last changed it, how long the contact has been in its lifecycle stage, the stage before it and when it moved, the lost reason and when the contact was last updated) and **History** (every change to the contact's fields).

## Logging a call

Select **Log a call** (from **Call**, or the **Call** tab of the box). Say whether you called them or they called you, how it went (**Connected**, **No answer**, **Busy**, **Left voicemail**, **Wrong number**), when (now to begin with), how long (optional) and what was said. Turn on **Create a follow-up task** and choose when it is due to get a task as well. The call appears on the timeline. You need permission to log calls; without it the **Call** tab and **Log a call** are not shown.

When you open your phone from **Call on your phone** and come back to the page, a quiet line asks **How did the call go?** with **Log it**. It never blocks you: dismiss it with the cross and it will not ask again about that call.

## Good to know

- Changing an owner, stage, status, tag, company or a detail saves at once and is checked again. If someone changed the contact first, you are told and the page reloads.
- A call that starts from your phone's dialer cannot be seen by the CRM: it only knows you clicked. That is why it asks afterwards.
- **Delete contact** asks for confirmation and offers to keep the conversations without the person's identity.
- The page and the quick view read the same data, so a change made in one is seen in the other.

## If something looks wrong

- **A tab or card is missing.** Your role or your plan does not include it.
- **There is no Call tab.** You do not have permission to log calls, or your workspace does not have call logging yet.
- **Deals says it is not available.** Your plan does not include the sales pipeline, or your role cannot read deals.
- **The timeline search finds less than you expect.** It searches what is loaded so far; select **Load more** to look further back.
