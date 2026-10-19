---
id: deployments-dashboard
title: Deployments
summary: See every flow published to the Geta console, what is queued, what is running now, and what failed and why.
area: getting-started
order: 61
audience: operator
documents: []
routes: [/admin/deployments]
keywords: [deployment, deploy, publish, geta, queue, running, failed, error, stalled, live, flow]
---

## What it is for

This page is for platform operators. It lists every flow that has been published to the Geta console, across all workspaces, with the exact state of each publish. Open it from the **System** group in the operator console menu, then **Deployments**.

## What each status means

- **Queued**: the publish is waiting for the worker. No step has started yet.
- **Running**: the worker is pushing the bot right now. The **Step** column names the call in progress.
- **Failed**: one of the calls to Geta failed. The **Failed at** line names the step and the **Error** column shows the stored reason, cut to 300 characters.
- **Live**: both calls to Geta answered successfully.

## How to read the page

> The counters at the top count every deployment, whatever filter is picked.

The list refreshes every few seconds on its own, so a publish that moves shows up without a reload. Pick a status above the table to show only that status. Running and queued deployments are listed first, then failed, then live.

A **Stalled** badge means the deployment has not changed for 10 minutes. The worker most likely stopped, or the queue is not being emptied. Check the worker before retrying anything.

## What to do about a failed publish

Retry is done by the workspace from the flow editor, not from this page. The page is read-only. If the same step fails again, the error text says why: a 401 or 403 means the Geta tokens expired, and a 4xx on the configuration update means the chatbot record is not what Geta expects.

> Only the first 200 deployments are listed. When more exist, the page says so; pick a status to narrow the list.
