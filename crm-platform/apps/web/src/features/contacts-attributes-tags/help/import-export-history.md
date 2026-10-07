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
2. Under **Imports**, read each file's status, how many contacts it created and updated, and how many rows were rejected.
3. For an import with rejected rows, select **Download rejects**. The file lists each row, the reason it was refused and the original cells. Fix them and upload it again.
4. Select **Import contacts** to start a new import from here.
5. Under **Exports**, see who exported, when, how many contacts, and whether it was the ticked contacts or everything matching.

> An import that is still running refreshes by itself. The exported file itself is not kept, only the record that it was taken.

## Options and settings

- **Status**: Queued, Running, Completed or Failed. A failed import shows the reason when you hover over it.
- **Scope** of an export: ticked contacts, or everything matching the filter.

## Plan and access

The imports list needs the permission to import contacts, and the exports list needs the permission to export them. Owners and Admins hold both by default; a section you may not use is not shown.

## If something looks wrong

- **No imports or exports are listed.** Nothing has been imported or exported yet in this workspace.
- **An import stays on Queued.** Large files run in the background; wait a moment and the page updates.
- **Download rejects does nothing.** Try again; if it keeps failing, re-run the import with a corrected file.
