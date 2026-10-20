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

This page is for platform operators. It shows what the platform is deploying: the product releases first, then the flow publishes. Open it from the **System** group in the operator console menu, then **Deployments**.

## Product releases

The first view, **Product releases**, is the release history of the product itself, desk.wabo.ai.

- **Live now** names the release that is serving customers and when it went live.
- **In progress** means an attempt is building, shipping or releasing right now.
- Each attempt shows its **State** (Building, Shipping, Releasing, Live, Failed, Rolled back), the **Step** it reached, and the **Error** if it stopped.
- **Failed** means the release stopped before traffic moved. **Rolled back** means traffic was moved to the new release and then moved back, so the previous release is still serving.

A **Stalled** badge means an attempt has not changed for 45 minutes. The build or the release most likely stopped; check the build server before doing anything else.

## Flow publishes

The first view, **Flow publishes**, lists every time a flow was published, with the state the worker has left it in:

- **Queued**: the publish is waiting for the worker.
- **Running**: the worker is handling it now.
- **Failed**: the worker ran out of retries. The **Error** column shows the last reason, cut to 300 characters.
- **Done**: the publish was handled. Done publishes older than 30 days are not listed.

The **Attempts** column counts the tries the worker has made. **Finished at** stays empty until the publish is done or failed.

## Geta console

The second view, **Geta console**, lists the flows pushed live to the Geta console. It only has rows for workspaces that have saved Geta credentials.

- **Queued**, **Running**, **Failed** and **Live** have the same meaning as above. The **Step** column names the Geta call in progress.
- A **Failed at** line names the failed step and the **Error** column shows the stored reason.

## Reading the page

> The counters at the top count every item in the view, whatever filter is picked.

The list refreshes every few seconds on its own. Pick a status above the table to show only that status. Running and queued items are listed first, then failed, then done or live.

A **Stalled** badge means the item has not moved for 10 minutes. The worker most likely stopped, or the queue is not being emptied. Check the worker before retrying anything.

## What to do about a failed item

The page is read-only. A failed Geta publish is retried by the workspace from the flow editor. If the same step keeps failing, the error text says why: a 401 or 403 means the Geta tokens expired, and a 4xx on the configuration update means the chatbot record is not what Geta expects.

> Only the first 200 items of a view are listed. When more exist, the page says so; pick a status to narrow the list.
