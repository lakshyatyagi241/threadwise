---
id: contacts-overview
title: Contacts
summary: Your customer list: search, filter, add, import and export contacts, change their stage, and tag or group many at once.
area: audience
order: 10
documents: [nav:contacts]
keywords: [customers, people, leads, import, csv, export, duplicates, tags, bulk, contact hub, owner, assign, reassign, my contacts, columns, filter, quick view, pagination]
---

## What it is for

**Contacts**, also called the Contact Hub, is your customer list. Every person you message or sell to is a contact here. Find people, add or import them, move them through your sales stages and act on many at once.

## How to use it

1. Open **Contacts** in the CRM area of the menu, or go to `/contacts`. The page reads **Contacts / List**.
2. Search by name, number or email in the search box (press Ctrl K or Command K to jump to it). Select **Filter** to narrow the list by segment or group, tag, owner, lifecycle stage, status, minor flag, consent or source, to describe the people you want in plain words with **Filter with AI**, or to build exact conditions (custom properties, a time zone property, dates) with **Add advanced filter**. Every filter you turn on shows as a chip under the toolbar; select the cross on a chip to remove it, or **Clear all**.
3. Select **Add Contact**. A first name and a mobile number or email address are required.
4. Select a name to open the **quick view**, a panel on the right with the contact's details, while the list stays visible behind it. See [Contact quick view](help:contact-quick-view). To open the full page, hover the row and select the open icon, or choose **See all details**. See [Contact details page](help:contact-details-page).
5. Change a stage from the table by selecting the stage chip. A lost stage asks for a reason.
6. Tick rows. A bar appears with **Send campaign**, **Tag**, **Assign owner**, **Change stage**, **Export**, **Delete** and **More** (**Update**, add to or remove from a group, untag). Untick everything and the bar goes away.
7. To change several contacts at once, tick them and choose **Assign owner**, **Change stage** or **More**, then **Update**. Set the stage, status or owner, or use **Add property** under **Custom properties** to pick a property and give it one value for everyone selected. **Clear** empties that property on all of them; **Keep** takes it off the list so it is left alone. Anything you do not touch stays as it is.

## The table

- **Sort.** Select a column heading to sort by it (A to Z, then Z to A, then back to newest first). The small arrow at the end of a heading opens that column's menu: sort, filter, hide. On Name, Phone and Email, **Filter** opens the advanced filter with a condition on that field ready to fill. Tags, groups, owner, lead score, company, source, last activity, Modified On and the opt-in columns cannot be sorted.
- **Columns.** The button **Columns** shows how many are on. The table starts with Name, Phone, Email, Stage, WhatsApp, Owner and Created. The headings are short so they are never cut off; point at one to read its full name, such as Lifecycle stage or WhatsApp opt-in, and the Created column shows the date and time. The lifecycle caret shows when you point at the row. Select **+** at the end of the heading row to add another (status, tags, groups, lead score (only while lead scoring is on for your workspace; with it off the column is hidden and not offered, and it returns with its numbers when scoring is switched on), company, source, last activity, SMS or email opt-in, language, memo, Modified On (the last change, date and time; not sortable and hidden until you add it), and your own custom properties), or open **Columns** to tick, search and drag them into order. **Reset to default** brings the seven back. Your choice is kept in this browser; a saved view can keep its own columns.
- **WhatsApp, SMS and email opt-in.** A small mark, not a word on every row. A green tick means the contact is subscribed on that channel. A faint grey dot means no opt-in is recorded. A red cross means the contact opted out of marketing messages, which wins over every channel. Point at the mark to read the state. The consent card on the contact page shows the proof. The **Subscribed** choice of the Consent filter and the opted-in count follow the same rule: a contact is subscribed only when its WhatsApp status says subscribed and it has not opted out, so a contact with no status recorded is not counted.
- **Last activity.** The day the contact last wrote to you or was answered, taken from its conversations as well as from what is recorded on the contact, so the **Never contacted** view lists only contacts without any conversation message.
- **Row actions.** Point at a row (or tab to it) to see three icons and a **...** menu over the end of the name; they sit on top of the cell, so the row and the columns never move. **Message** opens the WhatsApp chat, or writes an email when the contact has no number or no WhatsApp number is connected. **Call** calls the contact. **+** adds a note, a task or a meeting: the quick view opens on that tab with the cursor in the form. The **...** menu holds the rest: open details, open in a new tab, edit, send email, send SMS, add to group, tag, delete, and copy the phone number or email address. Each shows only if you have the permission for it; Message and Call are greyed out, with the reason as their tip, when the contact cannot be reached. On a touch screen, or a window narrower than 640 px, only the **...** menu shows (always visible) and it holds the same actions.
- **Pages.** The footer stays at the bottom while the rows scroll: **Showing 1-50 of N** on the left, the page numbers and the rows per page (10, 25, 50, 100 or 200) on the right. The list loads page by page, so the numbered buttons reach ten pages beyond the one you are on; step on with the arrow to go further. The footer always says which page you are on out of how many.
- **Saved views and quick chips.** Under the toolbar, the view picker shows the open view and how many contacts it holds (while a filter is on and no view is open, **Total** shows the number of matches instead, so you never see two counts). Beside it are five chips: **My contacts**, **Unassigned**, **New this week**, **Needs follow-up** (no activity for 7 days, not opted out) and **Hot leads** (a lead score in the hot band; it, and the view of the same name in the picker, appear only while lead scoring is on for your workspace, so with it off there are four chips). Select a chip to apply it and select it again to go back to all contacts; they are built-in views, so they cannot be deleted, and the picker lists them too. **Create View** saves the filters on screen as a view of your own.

## Your first contacts

A workspace with no contacts shows **Add your first contacts** instead of an empty table, with three ways to start: **Create Contacts** (a name and a number or email), **Import a CSV file**, and **Connect WhatsApp** (opens Settings > Channels). Each card appears only if you may do it.

## Company

If you can read companies, the contact form has a **Company** field: search, pick a company, or select the cross to remove it. When no company matches and you may create companies, **Create "name"** makes one and picks it. A company you may not read cannot be picked. The company shows in the contact's header, and the contact appears on the company's page. See [Companies](help:companies-overview).

## Owners

Every contact can have one **owner**, the person who looks after it. A contact you create is yours until you pick someone else (or **Unassigned**) in the **Owner** field of the form.

- **See who owns what.** The **Owner** column is on by default; contacts nobody owns say **Unassigned**.
- **Filter by owner.** Select **Filter**, then **Owner**. Tick one or several people, and **Unassigned** to include contacts nobody owns. **My contacts** shows only yours. The choice is kept in the page address, so you can share the link.
- **Filter by team.** When your role can see teams and the workspace has at least one, **Filter** also has a **Team** row. It lists the contacts whose owning team is the team you pick: the primary team of the owner at the moment the owner was set. Contacts whose owner has no primary team, and contacts nobody owns, are in no team. The choice is kept in the page address and carries into a saved segment, **Select all N matching this filter** and **Export**. See [How team access works](help:team-access).
- **Change one contact's owner.** Open the contact. In the **Owner and assignment** card, select the owner and pick another person. You can also change it in **Edit**.
- **Move many contacts.** Tick rows and choose **Assign owner**. To move everything a filter matches, tick the top box, select **Select all N matching this filter** in the banner, then **Assign owner**. Only the owner can be changed that way. With one person in the **Owner** filter, **Reassign the contacts of** that person does the same in one step.
- **Who you can pick.** Your access decides. With access to your own contacts you can only keep a contact for yourself; with team access, yourself and your teammates; with full access, anyone. If you pick someone you are not allowed to, the form says so and nothing is saved.
- **Export.** The CSV has an `owner_email` column. Importing does not read it yet, so imported contacts belong to the person importing.

## Options and settings

- The **...** menu at the end of the toolbar holds **Bulk upload**, **Export all**, **Remove duplicates**, **New group**, **Save as segment** (when filters are on) and **Show stats**.
- **Bulk upload** takes a CSV with a header row. The preview shows which columns were recognised and how many contacts would be created, updated or rejected. Rejected rows can be downloaded.
- **Remove duplicates** merges contacts sharing a phone number into the oldest one. It cannot be undone.
- **Save as segment** turns the current filters into a [segment](help:segments-overview).
- The list and board buttons switch between the table and a board with one column per lifecycle stage. The refresh button reloads the list and the counts.
- A contact can carry a quiet **Uncontacted** marker (a dot beside the name, a chip in its header): nobody on the team has reached out yet. The **Uncontacted** view and chip appear once any contact has it. Mark or unmark contacts from the **More** menu, and choose when it is set or cleared in [Uncontacted leads](help:uncontacted-leads).

## Tags: contact tags vs conversation tags

Tags come from one workspace library and are used in two places, with two different meanings.

- A **contact tag** describes the person: VIP, lead, region. You put it on contacts from this screen (select rows, then **Tag**) or from the contact page. It follows the customer into every chat; the Team inbox shows it read-only under **Contact tags**.
- A **conversation tag** describes one chat thread: billing, refund, urgent. You put it on a conversation in the Team inbox, under **Conversation tags**.

A tag you create in one place is available in the other, and a tag deleted from either place is gone from both. See [Tags](help:inbox-tags) and [Team inbox](help:team-inbox-overview).

## Time zone and quiet hours

Each contact has a **Time zone**, the clock your quiet hours are read on (see [Compliance center](help:compliance-center)). Set it in the contact form, on the contact's page with **Change**, or for several contacts at once with **Update** (pick a zone, or **Clear the time zone**). Leave it empty and the clock is worked out for you: from the country of the phone number, then your fallback time zone, then your workspace's.

The **Time zone** card on a contact's page says which zone is used and why: set by staff, by a CSV import or through the API, or read from the number's country or your workspace. It shows the time there now, whether a marketing message could go now, the next time one may go if it would wait, and how many messages are already waiting. A zone you set is never replaced by one worked out from the number, and a CSV import fills only contacts that have none. Find contacts by zone with **Add condition** and the field **Time zone**.

## Plan and access

Opening the screen needs permission to read contacts. Creating, editing, deleting, exporting, importing and merging each need their own permission. Your plan can cap the number of contacts; at the cap, adding says so. The row icons and the quick view's buttons appear only with the permission each needs.

## If something looks wrong

- **The list is empty.** A filter may be on. Select **Clear all**, or **Reset filters**.
- **A contact with this phone number or email already exists.** Nothing new was created.
- **An import rejects rows.** The reason is shown per row. Fix them and upload again.
- **Someone else changed this record.** Reload it and apply your change again.
- **A column is missing from the plus list.** It is already shown, or you do not have access to what it holds (the Company column needs access to companies).

## Date of birth and minors

A contact can have a **Date of birth**, set on its edit form, in an import or by a form, the chat or a flow. When the person is under your workspace's age, the contact is flagged as a minor and shows a minor badge next to its name. Use the **Minors** view of the list to see them, or the "minor" filter in the filter panel and in segments. See [consent](help:contact-consent) for how the flag works and when it lapses.
