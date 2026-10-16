---
id: import-export-history
title: Import and export history
summary: Every contact import and export of the workspace: who did it, when, how many contacts, and the rows that were rejected.
area: settings
order: 26
documents: [tile:import-export]
keywords: [import, export, history, csv, upload, download, rejected rows, audit]
---

## What it is for

This page lists the contact files your workspace has imported and the exports it has taken, newest first. Use it to check that an import finished, to see how many contacts it created or updated, to fix the rows it rejected, and to know who exported contacts and when.

## How to use it

1. Open **Settings**, go to **Data and security** and select **Import and export**.
2. Under **Imports**, read each file's status, who imported it, how many contacts it created and updated, and how many rows were rejected.
3. For an import with rejected or skipped rows, select **Download errors and skipped rows**. The file lists each row, the reason (an error, the plan limit, or a repeated number that was merged into an earlier row) and the original cells. Fix them and upload it again.
4. Select **Import contacts** to start a new import from here.
5. Under **Exports**, see who exported, when, how many contacts, and whether it was the ticked contacts or everything matching. Select **Download** on a row to get that file again.

> An import that is still running refreshes by itself. An exported file is kept for 30 days: the person who exported it, and anyone who may export all contacts, can download it again from this page. Older exports, and files past 30 days, show only the record that they were taken.

## Options and settings

- **Status**: Queued, Running, Completed or Failed. A failed import shows the reason when you hover over it.
- **Scope** of an export: ticked contacts, or everything matching the filter.

## Plan and access

The imports list needs the permission to import contacts, and the exports list needs the permission to export them. Owners and Admins hold both by default; a section you may not use is not shown.

## If something looks wrong

- **No imports or exports are listed.** Nothing has been imported or exported yet in this workspace.
- **An import stays on Queued.** Large files run in the background; wait a moment and the page updates.
- **Download rejects does nothing.** Try again; if it keeps failing, re-run the import with a corrected file.

## Marketing consent column

If your file has a column that says whether each person agreed to marketing, map it to **Marketing consent (yes / no)**. Only the rows that say yes get a recorded consent, and only when you tick **I have consent to message these contacts**. See "Consent, STOP and START replies" for what is recorded.

## Consent notice and SMS or email consent

When you tick **I have consent to message these contacts**, two optional boxes appear: the notice or lawful basis the contacts agreed under (for example "Opted in at checkout, privacy notice v3") and its version. They are kept with each recorded consent as proof. If your file has columns for SMS consent or email consent (headers such as "SMS consent" or "Email opt-in"), map them to **SMS marketing consent (yes / no)** and **Email marketing consent (yes / no)**. Those channels are recorded only for rows that say yes; email also needs an email address on the row. A file with no such column records WhatsApp only.

## Date of birth and minor columns

Map a column to **Date of birth** to save it on the contact. Write it as year first, for example 2010-05-04. A row whose date of birth is not a real, believable date is rejected and listed with the reason; a blank cell is simply no date. A contact whose date of birth shows they are under your workspace's age is flagged as a minor with the source "date of birth". Map a column to **Minor (yes / no)** to flag the rows that say yes, with the file as proof. A no, a blank cell or an unknown word changes nothing, and a file never clears a minor flag.
