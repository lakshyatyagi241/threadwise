---
id: appointments-settings
title: Appointment settings
summary: Connect Google Calendar or Outlook, add other calendars for busy time, then set hours, booking rules and customer messages.
area: settings
order: 11
documents: [tile:appointment-settings, tile:google-calendar]
keywords:
  [
    google calendar,
    outlook,
    ical,
    ics,
    calendar feed,
    microsoft 365,
    teams,
    meet,
    busy times,
    time zone,
    business hours,
    reminders,
    buffer,
    notice,
    cancellation,
    messages,
    booking page,
  ]
---

## What it is for

Appointment settings holds what every booking in your workspace shares: the Google Calendar and Outlook connections, other calendars read for busy time, the time zone, the weekly business hours, default booking rules and the messages customers receive. The Google Calendar card can also be opened from Settings under **Integrations**.

## How to use it

1. Open **Settings**, then **Appointment settings**, or open **Google Calendar** on the **Add-ons** tab of the **Marketplace**. Both open this screen.
2. To connect Google Calendar, select **Connect Google Calendar**. Google asks you to choose an account and allow calendar access. You come back here with the result.
3. Once connected, select **Choose calendar** to pick the calendar confirmed bookings are written to.
4. To use Outlook or Microsoft 365 instead, or as well, select **Connect Outlook** on the **Outlook / Microsoft 365** card. Microsoft asks you to choose an account and allow calendar access. You come back here and a box asks you to confirm the connection: press **Connect** only if you started it yourself. Then choose the calendar the same way.
5. Set the **Time zone** and the **Business hours** for each day. Switch a day off to close it, or add intervals for a break.
6. Fill in **Booking rules**: slot length, bookings per day, buffers, how far ahead people can book and the default reminder.
7. Under **Reminders and follow-ups**, open a booking type to switch on reminders before its appointments and follow-ups after them, choose the channels and write the text. They are off until you switch them on, and are saved with their own **Save reminders** button. See [Reminders and follow-ups](help:appointments-reminders).
8. Edit the **Message templates** if you want your own wording. Use the placeholders such as the customer's name and the manage link. Select **Reset to default** to undo a change.
9. Select **Save settings**. The bar at the top shows whether you have unsaved changes.

## Options and settings

- **Google Calendar** shows the account and calendar in use. Its actions are **Choose calendar**, **Reconnect Google** and **Disconnect**. Disconnecting asks first.
- With Google Calendar, bookings are written as events, busy times are read so they are not offered twice, and a Meet link is added when the service asks for one.
- With Outlook, confirmed bookings are written as events and the customer is invited. Work and school accounts also get a Teams meeting link when the service is online. Personal Microsoft accounts get the event without a link.
- With both connected, busy times are read from both, and each booking is written to one of them. **Where bookings are written** lets you choose; **Automatic** uses Google Calendar when it works, otherwise Outlook.
- **Other calendars (iCal)** reads a calendar you can only reach by address (Apple, Fastmail, a timetable, or a Google or Outlook calendar published as a secret link). Only the times you are busy are used: nothing else from it is shown or kept. Paste the address, give it a name and select **Subscribe**: the address is checked straight away, then stored encrypted and never shown again. It is read about every 15 minutes, so a change there can take that long to show. **Pause**, **Read now** and **Unsubscribe** are on each calendar. Do not subscribe to the calendar your bookings are written to.
- **My bookings in my calendar app** gives you a private link to subscribe Apple Calendar, Outlook or Google Calendar to your own bookings. It shows the titles, times and places of the bookings you can see in the bookings list, never phone numbers, e-mail addresses or notes. Anyone with the link sees them, so keep it private; **Make a new link** stops the old one at once and **Stop sharing** ends it.
- Bookings that were made while no calendar was connected, or lost with an account you replaced, are written to the calendar by themselves after you connect (confirmed bookings in the next 90 days). The card **Where bookings are written** shows how many are waiting and has **Write them now**.
- **Discard changes** puts back the saved values.

## Plan and access

You need permission to view booking settings. Changing them, and connecting or disconnecting Google Calendar or Outlook, needs the booking type update permission. Without it the screen is read-only. Google Calendar and Outlook are available only when your platform administrator has added the Google client or the Microsoft app. Otherwise the card says it is not set up yet, and your bookings still work.

## If something looks wrong

- **Google Calendar needs reconnecting.** Google withdrew access or it expired. Bookings are not written to your calendar until you reconnect.
- **Outlook needs reconnecting.** Microsoft withdrew access, the password changed, or your organization asked for a new sign-in. Reconnect, then the missed bookings are written by themselves.
- **"This connection was started by someone else."** The link you came back through belongs to another person. Nothing was connected; press **Connect** yourself.
- **An iCal calendar shows a problem.** The card says why: the address could not be reached, it is not published to anyone with the link, it is not an iCal calendar (it should end in .ics) or it is too large. It keeps the last busy times it read, and tries again by itself.
- **An iCal calendar says some events were read in your time zone, or only their first occurrence counts.** Those events use a time zone or a repeat rule we cannot read; the card says how many.
- **Outlook cannot be connected.** Your platform administrator has to add the Microsoft app first. Some organizations also need an administrator to approve the app on Microsoft's side.
- **"That attempt took too long."** Press **Connect** again to start over.
- **Google did not give every permission.** Connect again and keep all the boxes ticked on Google's screen.
- **Save says the settings changed elsewhere.** Select **Reload latest**. Your unsaved edits are replaced.
- Times shown to customers follow their own time zone. Your business hours are read in the workspace time zone.
