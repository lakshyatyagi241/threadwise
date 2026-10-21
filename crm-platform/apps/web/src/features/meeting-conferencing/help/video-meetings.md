---
id: video-meetings
title: Video meetings
summary: Add a Zoom, Microsoft Teams or Google Meet link to a meeting you schedule, and put the meeting on your calendar.
area: settings
order: 125
documents: [tile:video-meetings]
keywords:
  [
    zoom,
    teams,
    microsoft teams,
    google meet,
    meet,
    video,
    video call,
    meeting link,
    join link,
    calendar,
    invitation,
    conferencing,
    connect zoom,
    connect teams,
  ]
---

## What it is for

When you schedule a meeting with a contact, the **Add meeting** form can add a video link to it: **Add Zoom link**, **Add Teams link** or **Add Google Meet link**. The link is saved on the meeting, which then shows a **Join** button. The same form can also put the meeting on your calendar.

Nothing is offered by guesswork. **Zoom** and **Microsoft Teams** are integrations: your workspace installs them from the Marketplace, then each person connects their own account. **Google Meet** needs no account of its own: Google makes the room when the meeting is put on the Google Calendar your workspace has connected. Until an option is ready, the form shows nothing for it, or one quiet **Connect video conferencing** link when you can do something about it.

## How to use it

1. A workspace admin installs **Zoom** and/or **Microsoft Teams**: on **Video meetings**, a card that says **Not installed** has an **Install in the Marketplace** button that opens that integration's own page. A card that says **Not available yet** cannot be installed: your platform operator has to set it up and publish it first, so ask them.
2. Open **Settings**, then **Integrations**, then **Video meetings**. A card that says **Installed** is waiting for your own account: select **Connect**, sign in at Zoom or Microsoft and accept the permissions. You come back to this page, and the card says **Connected as** your account.
3. Open a contact, then **Meetings**, and select **Schedule meeting**. Fill in the title and the start time.
4. Under the place, select **Add Zoom link**, **Add Teams link** or **Add Google Meet link**. Select it again, or **Remove the video link**, to take it off.
5. Tick **Add to my calendar** to put the meeting on the workspace calendar. Tick **Send a calendar invitation to the contact** if you also want the calendar to email them an invitation.
6. Save. The meeting shows the provider and a **Join** button. Moving or renaming the meeting moves the room and the calendar entry; deleting it removes both.

## Options and settings

- **Zoom** and **Teams** rooms are made in the account of the person who chose the link, so that person hosts the call. Each person connects their own account; a colleague's connection is never used for you.
- **Google Meet** links are part of a calendar event, so choosing one also adds the meeting to the Google Calendar your workspace connected. A **Teams** link can likewise be made by the workspace's Microsoft 365 calendar when you have not connected your own Teams account.
- The **calendar** is the one your workspace connected for appointments (Settings, Integrations, Google Calendar or Microsoft 365). It is the workspace's calendar, not one calendar per person, so meetings land on that calendar and the form shows its account name.
- **Send a calendar invitation** is separate from the email invitation the product sends. Unticking it later does not recall an invitation that was already sent.
- A link needs a **start time**. A meeting with no end time is created as half an hour.

## Limits and requirements

You need permission to edit contacts to use the form and this page. Installing Zoom or Teams needs the permission to install Marketplace apps, and the platform administrator must have set up the Zoom app (and the Microsoft app, with the online meetings permission, for Teams). A meeting booked through an appointment page is changed on the appointment, not here.

## If something looks wrong

- **A card says "Not available yet", and the Marketplace shows nothing.** The integration is not published yet, or the platform has no Zoom or Microsoft app set up for it. There is no button on purpose. Ask your platform operator to set it up (the operator console has a checklist on the listing).
- **The form shows no video options.** Zoom or Teams may not be installed yet, or you have not connected your account. If the workspace installed it, the **Connect video conferencing** link opens this page; otherwise ask an admin to install it from the Marketplace.
- **The meeting says your account is not connected or needs reconnecting.** The meeting is saved. Open **Settings**, **Integrations**, **Video meetings**, reconnect, then select **Try again** on the meeting.
- **The provider did not answer.** The meeting is saved without its link. Select **Try again** on the meeting.
- **Disconnecting.** Rooms already made stay, but moving or deleting those meetings can no longer change them at the provider.
- **Changes made in Zoom, Teams, Google or Outlook.** They are not noticed until the meeting is saved again here.
