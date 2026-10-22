---
id: data-retention
title: Data retention (operator console)
summary: See every kind of data the platform deletes on a schedule, how long each is kept, and change the days (super admin only).
area: getting-started
order: 62
audience: operator
documents: []
routes: [/admin/data-retention]
keywords: [retention, data retention, delete, archive, live days, archive days, keep for ever, audit log, notifications, recordings]
---

## What it is for

Some data is deleted on a schedule so it does not pile up: logs, old notifications, call recordings, run histories and so on. This page lists all of it in one table and lets you change how long each kind is kept. Open it from **Data retention** in the operator console menu.

## Read the table

**Retention at a glance** has one row per kind of data, grouped (Analytics, Security and audit, Messaging and notifications, CRM and leads, Automation and integrations, Calling).

- **Stored in**: where it lives, for example the database only, or the database and then an archive.
- **Live (database)**: how many days it stays easy to reach.
- **Archive**: how many more days an archived copy is kept, **No archive** if it has none, or **For ever**.
- **Deleted for good after**: the total number of days before it is gone, or **Never**.
- **Setting**: **Current behaviour** means nothing was saved and the built-in rule applies; **Saved by you** means your numbers are used; **Not carried out yet** means your numbers are saved but the nightly job is not applying them yet.

Select a row to jump to its card below the table.

## Change how long something is kept

1. Select the row, then change **Live days** on its card. Where the data can be archived, also set **Archive days**, or tick **Keep the archive for ever**.
2. Select **Save**. A summary shows what will happen at the next nightly run, such as months moved to the archive or rows deleted.
3. Check it, then select **Save and apply**. Deleting is permanent and cannot be undone.
4. To undo your numbers, select **Back to current behaviour**. Data already archived stays in the archive.

> Only a super admin can save changes. Everyone else sees the saved values and what the last run did.

## Options and settings

- **Live days** and **Archive days** accept whole numbers inside the range shown under the box.
- Data cannot be deleted before it is archived, and unread notifications cannot be deleted before read ones.
- Each card shows how much is in the database and in the archive, and what the last run did.
- A message at the top tells you whether the archive job is off, only logging what it would do, not safe to use yet, or running. While it is not running, saved numbers for archived data are stored but not carried out.
- Call recordings: the number here is the default for workspaces that never chose their own window. A workspace's own window still wins.

## If something looks wrong

- **Save says someone else changed this item.** The latest numbers were loaded. Check them and save again.
- **Save says the values are not allowed.** Read the message under the box; it names the allowed range.
- **A row says Not carried out yet.** The archive job is not applying saved numbers yet; ask whoever runs the platform to switch it on.
