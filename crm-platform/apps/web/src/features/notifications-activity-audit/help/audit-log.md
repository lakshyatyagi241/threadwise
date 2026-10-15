---
id: audit-log
title: Audit log
summary: See who changed what in your workspace, when, and from what to what, including what platform support did when you asked for help.
area: settings
order: 30
documents: [tile:activity-log]
keywords:
  [
    audit,
    audit log,
    activity log,
    history,
    who changed,
    changes,
    security,
    compliance,
    export,
    support access,
    csv,
  ]
---

## What it is for

The audit log is the record of changes made in your workspace: a contact edited, a deal deleted, a team member added, a setting changed. Each entry says who did it, when, which record it was about, and which fields changed. Use it to answer "who did this?" and to review what your team and platform support have done.

Open **Settings**, then **Audit log** under Security. Only people whose role includes the audit log permission can see it (Owner and Admin by default). Managers and other roles do not, unless you add the permission to their role.

## Reading the list

Entries are listed newest first, in your own time zone (shown above the table). Each row shows the time, who acted (a person, the system, an API key), what was done, the record (a link when the record has a page), the request it belongs to, and the names of the fields that changed. Select **Details** to open the entry.

## Filters

Choose a period (the last 24 hours, 7, 30 or 90 days, or your own dates, up to 400 days), a person, who acted, an area, an action, a record number or a request ID. The search box matches the area and the action only; it never searches inside the changed values. Tick **Only platform support sessions** to see just the changes made while support was working in your workspace. Filters are kept in the address, so you can share a filtered view.

## One entry

The panel shows each changed field, before and after. Personal data such as phone numbers, e-mail addresses, names and notes is partly hidden (for example `+91 ******210`); only the workspace Owner sees it in full. Passwords, keys and tokens are never shown to anyone. Opening an entry is itself recorded in the audit log.

## Platform support

When a member of platform support works in your workspace as one of your users, their changes are marked **Platform support** with "acting as" and the person, and the entry shows the reason they gave and whether the session was read-only.

## Export

Choose **Export CSV** to prepare the entries that match the filters. The file is built in the background and we email you when it is ready; download it here within 7 days. Personal data is always hidden in the file. One export can be prepared at a time, and asking for one is recorded in the audit log.

## How long entries are kept

The page says how many days entries are kept. The platform sets this period, and older entries are deleted automatically.
