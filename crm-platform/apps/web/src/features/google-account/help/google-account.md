---
id: google-account
title: Google account
summary: Connect one Google account with Google's own sign-in for bookings and the Calendar, Sheets, Docs, Forms and Meet steps, and choose what it may be used for.
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
    sign in,
    pick a sheet,
    file list,
  ]
---

## What it is for

Your workspace has one Google account connection. The booking calendar and the Google steps of your flows (**Google Sheets**, **Check Google Sheet field**, **Save contact from Google Sheet**, **Google Docs**, **Google Form** and **Google Meet**) all use it, so you connect once. Everything goes through this one sign-in with Google: there is no key, link, script or add-on to install or paste anywhere, and sheets, documents and forms are chosen from a list of what the account can open. Each step works only when the account was given the permission it needs, and the page shows which ones it has.

## How to use it

1. Open **Settings**, then **Integrations**, then **Google account**. You can also open it from the **More** page.
2. Tick what Google may be used for. **Calendar**, **Sheets**, **Forms** and **Drive file list** are ticked for you. **Docs and Drive** starts unticked on purpose: Google treats it as restricted, so tick it only when you use the Docs step. Until Google has verified the platform's app, only people listed as test users by your platform administrator can connect.
3. Select **Connect Google account**. Google asks you to choose an account and shows exactly the permissions you ticked. Keep every box ticked.
4. You land on a confirmation page that reads "Connect (the Google account) to (your workspace) for (the permissions)?". Select **Confirm** to connect it, or **Cancel** to connect nothing. Nothing is stored until you confirm, and only you, the person who pressed Connect, can confirm it.
5. You come back to this page with the result. The page shows the account, the calendar in use and the permissions that are now allowed.
6. To allow something more later, tick it and select **Add permissions**. Google asks only for the new ones and the account keeps what it already had.
7. In a flow, open a Google step. Choose the sheet, document or form from the list of what the account can open. A yellow note above its fields tells you when the account is not connected or lacks that step's permission, with a link back to this page.
8. In an appointment type, under the Google section, choose the calendar and the sheet from the same account.

## Options and settings

- **Calendar** lets bookings and Meet links be added to your calendar and hides busy times on the booking page. Use **Change calendar** to pick which one in **Appointment settings**.
- **Sheets** lets a step add a row, look a row up, check a cell or copy a row into a contact. The account must be able to open the sheet; share it with the account as an editor to write to it.
- **Docs and Drive** lets the Docs step copy a template, fill `{{name}}` or `{name}` placeholders and share the copy by link.
- **Forms** lets the Form step read a form's public link and read its answers, so the flow carries on when the customer fills the form. Nothing is pasted into the form; the answers are picked up about every half minute.
- **Drive file list** lets the pickers list your sheets, documents and forms by name, in the flow steps and on an appointment type. Every picker needs it. Without it the picker says so and links to this page.
- **Disconnect** withdraws the connection at Google. Calendar sync and every Google step stop until you connect again. Events and files already created stay in Google.

## Limits and requirements

You need permission to view the Google account to open this page, and permission to manage it to connect, add permissions or disconnect. Workspace admins have both. Connecting works only when your platform administrator has added the Google client; otherwise the page says it is not set up. A Google step that cannot use Google does not quietly do nothing: it fails (a step you left half empty is skipped, as before). If the step has an error exit the flow leaves by it, otherwise the run stops at that step, and the run log and the run view show the reason (for example, "no Google account is connected") and what to do, such as **Connect Google**.

## If something looks wrong

- **Needs reconnecting.** Google no longer accepts the connection: the access was withdrawn at your Google account, the password changed, or the grant expired. Select **Reconnect Google**; your calendar choice is kept.
- **"This Google connection was started by someone else."** A connection link only works for the person who pressed Connect, in their own workspace. Nothing was connected. Ask them to connect it themselves, or press Connect yourself.
- **"This Google connection took too long to confirm" or "was already confirmed".** Go back to this page and press Connect again.
- **Google did not give every permission.** You unticked a box on Google's screen. What was already allowed keeps working; add the missing permission again and keep every box ticked.
- **The last problem Google reported.** A yellow box shows the most recent account-level problem, such as Google limiting requests, and clears itself after the next success.
- **A picker says Google is not connected, or the file list was not allowed.** Open this page, connect the account or tick **Drive file list** and select **Add permissions**. Nothing can be typed in instead; the lists always come from the connected account.
- **The sheet or file I want is not in the list.** The connected account cannot open it. Share it with that account (as an editor to write to it), then open the picker again.
- **A Form step keeps waiting after the customer answered.** The account needs the **Forms** permission, which includes reading answers. If you connected before this was added, tick **Forms** and select **Add permissions**.
- **A step says the sheet or file was not found.** Pick it again from the list, and check that the connected account can still open the file.
