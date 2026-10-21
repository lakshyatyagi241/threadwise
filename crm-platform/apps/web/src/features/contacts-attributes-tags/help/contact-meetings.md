---
id: contact-meetings
title: Meetings on a contact
summary: Schedule a meeting from the contact, see the meetings booked online beside it, and know what you can and cannot change on each.
area: audience
order: 13
documents: [nav:contacts]
keywords: [meeting, meetings, schedule, booked online, booking, appointment, join link, cancelled, upcoming, past, read-only, contact]
---

## What it is for

The **Meetings** list of a contact is every meeting with that person in one place: the ones you schedule yourself, and the ones the person booked online or you booked for them. Find it on the contact details page under **More** and **Meetings**, in the quick view's **Meetings** tab, and as the meeting lines of the **Activity** timeline.

The separate **Appointments** section of the contact stays as it is. A booking can appear in both: **Appointments** is the booking itself, **Meetings** is the same occasion in the contact's history.

## Schedule a meeting

1. Select **Schedule meeting** (or **Meeting** in the action bar). A row opens in the list; nothing pops up.
2. Give it a **title** and a **start**. Choose how long it lasts (15 minutes to 2 hours), **No end time**, or **Custom end**.
3. Add a link or a place if there is one. A web address becomes a **Join** link that opens in a new tab; anything else is shown as a place.
4. Press Enter, or **Save meeting**. Escape closes the row without saving.

### Add a video link and put it on the calendar

When your workspace has installed Zoom or Microsoft Teams and you have connected your own account, or has a connected Google Calendar, the row also offers **Add Zoom link**, **Add Teams link** or **Add Google Meet link**, and **Add to my calendar**. The meeting then shows a **Join** button. Nothing is offered before the integration is ready. See [Video meetings](help:video-meetings).

Times are shown in your time zone. You need permission to update contacts to schedule, edit or delete a meeting; without it the list is read-only.

## Upcoming, past and no date

The list is grouped. **Upcoming** holds meetings that have not ended (soonest first); **Past** holds the ones that are over (latest first); **No date** holds the ones logged without a time. The small number on the **Activity** tab counts open tasks and meetings still to come.

## Meetings booked online

When someone books through your booking page, the chat or the API, or you book for a contact, the contact gets a meeting line for it, at the same moment, for every way of booking. It carries:

- a **Booked online** tag;
- the booking's status as a small tag (for example **Confirmed**, **Cancelled**, **Completed** or **No-show**), always the booking's current status;
- the title, the time and the place of the booking, and a **Join** link when the booking has an online-meeting link, such as a Google Meet or Teams link made by the calendar.

A booking follows the contact it belongs to. If the booking is moved to another time, renamed, or given a new link, the line changes with it. If you link a contact to a booking that had none, the line appears then. If the contact is removed from the booking, the line goes. If the booking is deleted, its line is deleted with it. Bookings that were made before this existed were added to their contacts' lists once, when it arrived; cancelled and declined ones from before were not added.

### Cancelled, declined and no-show

A booking that is cancelled or declined keeps its line, tagged, and sits under **Past** even if its time is still ahead. It never counts as a meeting still to come, so it is not in the numbers on the tabs, in **Next meeting** on the overview, or under **Up next** in the timeline.

### What you can change

A booked line is **read-only here**: it has no **Edit** and no **Delete**, whatever your role, because it is changed on the booking itself.

- If you may view appointments, the line has a link to the booking: **View booking**, or **Manage booking** when you may also change that booking.
- If you may see the contact but not appointments, you still see the line, with a note that it can only be changed on the booking, and no link.

> A line kept from a booking whose appointment no longer exists is an ordinary meeting again and can be edited.

## If something looks wrong

- **A booking is missing from Meetings.** The line exists only while the booking has a contact. Open the booking and link the contact, or check that the appointment add-on is on for your workspace.
- **The tag says Cancelled but the time is ahead.** That is expected: a cancelled booking is never "upcoming".
- **I cannot edit a booked line.** Open the booking from the link, or ask someone who can view appointments to do it.
