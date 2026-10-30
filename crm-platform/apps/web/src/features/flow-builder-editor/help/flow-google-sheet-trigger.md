---
id: flow-google-sheet-trigger
title: Start a flow from a new Google Sheet row
summary: Start a flow for the contact in each new row of a Google Sheet, for example a lead form that writes into a sheet.
area: automation
order: 15
documents: [nav:flows]
keywords: [google sheet, spreadsheet, row, trigger, leads, automation, poll]
---

## What it is for

The **Google Sheet** start watches one tab of a spreadsheet. Every time a new row is added, the flow starts for the contact named in that row. It suits a sheet that another tool fills in, such as a lead form, a booking form or a team's own list.

## How to set it up

1. Connect your Google account on the Google account page and tick the **Sheets** permission. The Trigger node warns you if it is missing.
2. In the Advanced builder, open the **Trigger** node and choose **Integration: a new row is added to a Google Sheet**.
3. Pick the **Spreadsheet** and, if it is not the first tab, type the **Tab name**.
4. Type the header of the **Phone column** exactly as it is in row 1. Add an **Email column** and a **Name column** if you have them.
5. Choose how often to check, from every 1 to every 5 minutes.
6. Publish the flow and keep it active.

## What happens to each row

- Row 1 must hold the column headers.
- The contact is found by the phone number in the row, or created when it is new. If the phone cell is empty, the email is used. A row with neither is skipped.
- Every column becomes a variable named after its header. A column called `Topic` is `{{topic}}`, `Order No` is `{{order_no}}`, and `{{row_number}}` is the sheet row.
- The flow runs once for each row. Editing a row later does not run it again.

## Old rows are never run

Google does not tell Threadwise when a row is added, so the sheet is checked on the schedule you chose. The first check after you publish only notes how many rows there are: the rows already in the sheet never start the flow. If you pause or unpublish the flow and turn it back on, it starts again from the sheet as it is then, so rows added while it was off are not run.

If you delete rows, nothing runs; the next row added after that is picked up. If you point the trigger at a different sheet or tab, it starts again from that sheet's current rows.

## Limits

- Up to 100 new rows are started per check. A busier sheet catches up on the following checks.
- A row typed in slowly is picked up as soon as it is there, so fill in the phone cell before the other cells if you can; a row whose phone is still empty at the check is skipped for good.
- If Google is disconnected or the permission is removed, nothing starts and the checks resume once it is fixed. Rows added in the meantime are not lost, but they are only run if the sheet was already being watched.

## If something looks wrong

- **Nothing starts**: confirm the flow is published and active, the Sheets permission is on, and the phone column name matches the header in row 1.
- **A row was skipped**: its phone and email cells were empty when the sheet was checked.
