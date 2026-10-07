---
id: workspaces-hub
title: Workspaces (operator console)
summary: Every customer workspace in one table, with the plan, provider, wallet and owner facts and the actions to act on each one.
area: getting-started
order: 5
audience: operator
documents: []
routes: [/admin/workspaces]
keywords: [workspaces, customers, plan, wallet, provider, suspend, impersonate]
---

## What it is for

The Workspaces page lists every customer workspace. It replaces the separate workspace plans, workspace wallets, support customers and provider assignments lists, which now open this page.

## Find a workspace

1. Type in the search box: it matches the workspace name, its slug, and the owner's name or email.
2. Use the status buttons to see all, active or suspended workspaces. Each button shows its count.
3. Narrow the list by plan, plan state, or provider, or tick **Low balance only**.
4. Choose how the list is sorted: newest, last active, or name.

The filters are kept in the address, so you can reload the page or share the link. **Load more** brings the next workspaces.

## Read the table

- **Workspace**: the name and slug. A suspended workspace has a tinted row and a badge.
- **Provider**: the WhatsApp provider its numbers use, and whether that is an override, the default, or the platform setting.
- **Numbers**: connected WhatsApp numbers.
- **Plan** and **State**: the plan, and whether the workspace is on trial, paid, in grace or lapsed.
- **Ends**: when the trial or plan ends. It turns amber within 7 days and red within 3 days, and says Expired once passed.
- **Limits**: messages per month, users, contacts and devices. The infinity sign means no cap, and an Override badge means the workspace has its own limits.
- **Wallet**: the balance in the workspace's own currency, with a Low badge when it is running out.
- **Owner**, **MRR**, **7d msgs** and **Last active**.

## Show and hide columns

Open **Columns** and tick the columns you want. **Reset columns** shows them all again. The Workspace column always stays. Your choice is remembered in this browser.

## Actions on a workspace

Open the menu at the end of a row.

- **Workspace dashboard**: figures, a 30-day messages chart and tabs for plan, wallet, provider and support.
- **Edit & change plan**: attach another plan, set when it ends, and give the workspace its own limits.
- **Plan and limits**: the dashboard's Plan & limits tab.
- **Change and set provider**: choose the provider new numbers connect through, or go back to the default. A link leads to the page that moves already connected numbers.
- **Login as Owner**: opens the workspace as its owner in a new tab. You must give a reason of at least 8 characters, which is kept in the audit trail. Tick **Read-only session** to look without being able to change anything.
- **Suspend** and **Reactivate**: stop or restore a workspace, with an optional reason.

An action your role cannot run is greyed out and says so.

## If something looks wrong

- If the list does not load, use **Try again**. The error shows a request id you can give to support.
- If Login as Owner opens nothing, your browser may have blocked the new tab. The dialog then shows a link to open it yourself.
