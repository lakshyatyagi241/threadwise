---
id: workspace-retention
title: Workspace retention (operator console)
summary: See which workspaces are idle, when each will be archived and erased, and change timings, protect or restore one.
area: getting-started
order: 6
audience: operator
documents: []
routes: [/admin/workspaces/retention]
keywords: [retention, idle, archive, erase, never delete, legal hold]
---

## What it is for

A workspace nobody uses is archived after a period of inactivity and erased later, with three reminders to its owner and admins before each step. The Retention page shows where every workspace stands and lets you step in. Open it with **Retention** at the top of the Workspaces page.

## Read the table

Workspaces are listed most idle first. **Load more** brings the next ones.

- **Status**: active, archived or suspended.
- **Days inactive** and **Last activity**: how long since its own people last used it.
- **Archive on** and **Erase on**: the dates of the next steps. They are empty while the workspace is protected.
- **Reminders sent**: how many of the three reminders for archive and for erase have gone out.
- **Protection**: **Never delete** (hover for the reason and expiry), **Legal hold**, and **Paid plan (exempt)** for a workspace on an active paid plan, which is never archived for inactivity.

Filter by status, by a minimum number of days inactive, or tick **Never delete only**. The filters stay in the address.

## Act on a workspace

Open the menu at the end of a row. Only the actions your role may run are shown.

1. **Change timings**: set the days before archive and before erase, or choose **Use platform default**. Archive needs at least 60 days, erase at least 120, and erase must come at least 60 days after archive. A reason of at least 5 characters is required.
2. **Never delete**: stops archiving and erasing. Give a reason and, if you want it looked at again, a review date. **Clear never delete** turns it off.
3. **Restore**: for an archived workspace. It becomes active again and the inactivity clock restarts. A reason is required.
4. **Place legal hold** and **Lift legal hold**: the hold blocks archive and erase until it is lifted. Only a Super Admin can use it.

Each action asks you to confirm, and an error from the server is shown in the dialog with a request id you can give to support.

## History

**History** opens the log of one workspace: reminders, archive, restore, and every change with who made it, when, and the reason. It is kept as proof of notice.

## If something looks wrong

- If the page says you have no access, your role cannot read workspaces.
- A workspace you expected to be archived may be protected, on a paid plan, or still waiting for its reminders: the steps never run before all three reminders are recorded.
