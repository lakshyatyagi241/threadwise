---
id: support-operator-platform-inbox
title: Platform team inbox (operator)
summary: Look across every customer workspace: triage SLA breaches, mark spam, add notes, flag or suspend, impersonate with a reason.
area: getting-started
order: 68
audience: operator
documents: []
routes: [/admin/team-inbox]
keywords: [platform inbox, impersonate, suspend, flag, spam, audit]
---

## What it is for

The platform inbox is a cross-workspace view of customer conversations for triage. It is separate from the [Support inbox](help:support-operator-inbox), which holds the tickets sent to support.

## How to use it

1. Open **Support**, then **Platform inbox**. The tiles show workspaces, SLA breached, open conversations and the active impersonation.
2. Use the tabs **SLA breach**, **Unassigned**, **Spam** and **All**, and the workspace filter, then **Load more**.
3. Select a conversation to open the drawer: thread, **Platform notes** (visible only to operators, with a severity), workspace notes and events.
4. **Mark spam** flags the conversation. **Audit log** shows the platform actions taken here.
5. Under **Flags and suspension** add or clear a flag (spam, abuse, fraud, billing overdue, ToS violation, frozen) or **Suspend workspace**. A fraud, ToS violation or frozen flag blocks the workspace like a suspension.

## Impersonation

1. Select **Impersonate**, type a reason of at least 8 characters and select **Start session**.
2. You land in the customer's workspace as its owner, with a banner on screen. The reason and the start are written to the audit log.
3. End it from the banner. Starting a new session ends the previous one.

> Impersonation needs the platform permission for it and the super admin role. Without them the button is hidden or refused.
