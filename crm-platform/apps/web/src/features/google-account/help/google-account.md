---
id: google-account
title: Google account
summary: Connect one Google account for your booking calendar and the Calendar, Sheets, Docs, Forms and Meet steps in your flows, and choose what Google may be used for.
area: settings
order: 120
documents: [tile:google-account]
keywords:
  [
    google,
    google account,
    connect google,
    calendar,
    sheets,
    docs,
    forms,
    meet,
    drive,
    permissions,
    reconnect,
    disconnect,
    oauth,
  ]
---

## What it is for

Your workspace has one Google account connection. The booking calendar and the Google steps of your flows (**Google Sheets**, **Check Google Sheet field**, **Save contact from Google Sheet**, **Google Docs**, **Google Form** and **Google Meet**) all use it, so you connect once. Each step works only when the account was given the permission it needs, and the page shows which ones it has.

## How to use it

1. Open **Settings**, then **Integrations**, then **Google account**. You can also open it from the **More** page.
2. Tick what Google may be used for. **Calendar**, **Sheets** and **Forms** are ticked for you. **Docs and Drive** and **Drive file list** start unticked on purpose: Google treats them as restricted, so tick them only when you use the Docs step or want to pick files by name. Until Google has verified the platform's app, only people listed as test users by your platform administrator can connect.
3. Select **Connect Google account**. Google asks you to choose an account and shows exactly the permissions you ticked. Keep every box ticked.
4. You land on a confirmation page that reads "Connect (the Google account) to (your workspace) for (the permissions)?". Select **Confirm** to connect it, or **Cancel** to connect nothing. Nothing is stored until you confirm, and only you, the person who pressed Connect, can confirm it.
5. You come back to this page with the result. The page shows the account, the calendar in use and the permissions that are now allowed.
6. To allow something more later, tick it and select **Add permissions**. Google asks only for the new ones and the account keeps what it already had.
7. In a flow, open a Google step. A yellow note above its fields tells you when the account is not connected or lacks that step's permission.

## Options and settings

- **Calendar** lets bookings and Meet links be added to your calendar and hides busy times on the booking page. Use **Change calendar** to pick which one in **Appointment settings**.
- **Sheets** lets a step add a row, look a row up, check a cell or copy a row into a contact. The account must be able to open the sheet; share it with the account as an editor to write to it.
- **Docs and Drive** lets the Docs step copy a template, fill `{{name}}` or `{name}` placeholders and share the copy by link.
- **Forms** lets the Form step read a form's public link.
- **Drive file list** lets the step pickers list your sheets, documents and forms by name. Without it you paste the link or id.
- **Disconnect** withdraws the connection at Google. Calendar sync and every Google step stop until you connect again. Events and files already created stay in Google.

## Limits and requirements

You need permission to view the Google account to open this page, and permission to manage it to connect, add permissions or disconnect. Workspace admins have both. Connecting works only when your platform administrator has added the Google client; otherwise the page says it is not set up. A Google step that cannot use Google does not quietly do nothing: it fails (a step you left half empty is skipped, as before). If the step has an error exit the flow leaves by it, otherwise the run stops at that step, and the run log and the run view show the reason (for example, "no Google account is connected") and what to do, such as **Connect Google**.

## If something looks wrong

- **Needs reconnecting.** Google no longer accepts the connection: the access was withdrawn at your Google account, the password changed, or the grant expired. Select **Reconnect Google**; your calendar choice is kept.
- **"This Google connection was started by someone else."** A connection link only works for the person who pressed Connect, in their own workspace. Nothing was connected. Ask them to connect it themselves, or press Connect yourself.
- **"This Google connection took too long to confirm" or "was already confirmed".** Go back to this page and press Connect again.
- **Google did not give every permission.** You unticked a box on Google's screen. What was already allowed keeps working; add the missing permission again and keep every box ticked.
- **The last problem Google reported.** A yellow box shows the most recent account-level problem, such as Google limiting requests, and clears itself after the next success.
- **A step says the sheet or file was not found.** Check the id or link, and that the connected account can open the file.
