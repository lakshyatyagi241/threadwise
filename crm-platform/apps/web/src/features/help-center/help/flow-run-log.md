---
id: flow-run-log
title: Reading a flow run's log
summary: Open one flow run to see why it ended, what it is waiting for, its step-by-step log and its variables, then find and retry failed runs.
area: automation
order: 32
documents: [nav:flow-runtime]
keywords: [flow log, run detail, step log, why it ended, failed run, retry, variables, error log, halted]
---

## What it is for

When a flow does something unexpected, such as stopping early or never answering, the run's page tells you why. Every time a flow starts for a contact it is recorded as a run, with a log of each step. This guide shows how to read it. For the list of runs and the subscribers screen, see [Flow runs](help:flow-runtime-overview).

## Open a run

1. Open **Flow runs**. Narrow the list with **Status**, **Started by** and **Flow**.
2. Select the flow name on the row to open the run. Its page starts with a short code that identifies it.

## Read the facts at the top

- **Contact**, **Flow** and **Channel** say who it ran for and where.
- **Started by** says what triggered it, for example Keyword, Tag added, Group join, Order placed, Manual or Campaign. **Trigger text** shows the customer's message when there is one.
- **Started**, **Last activity**, **Ended**, **Duration** and **Steps** give the timing and how many steps ran.
- **Current node** is where the run is parked or stopped.
- **Continues at** shows when a delayed run will carry on.

## Find out how it ended

The status chip is one of **Running**, **Waiting for reply**, **Delayed**, **Halted**, **Completed**, **Failed**, **Cancelled** or **Expired**. For a finished run, **Why it ended** gives the reason:

- **Reached the end of the flow**, or **Reached a node with no next step**. The first is a normal finish. The second means the run stopped at a step with nothing connected after it. That is fine when intended, otherwise connect the next step or add an **End** step.
- **No reply before the timeout**, or **Ran past its maximum lifetime**. The customer did not answer in time, or the run was open too long.
- **Stopped by the loop guard**. A branch loops back with no exit. The failure line quotes the loop.
- **Replaced by another flow**, or **An agent took over**. Another flow took over the conversation, or a person did.
- **The channel was removed**, **A message could not be sent** or **The run failed**. Look at **Failure** just below for the detail.
- **Cancelled**. Someone cancelled the run.

A **Halted** run shows **Halted because**, such as the channel being down or the daily sending cap being reached. It tries again by itself.

While a run is live, a **Waiting** box says which node it is parked at and what it is waiting for, and when it gives up.

## Read the step log

The **Step log** has one row per event, in order:

- **#** is the order and **When** the time.
- **Event** is **Step** (the flow ran a node), **Customer reply** (the customer wrote back) or **End**.
- **Node** is the step's identifier on the canvas.
- **Notes** and **Error** hold what the step did, or what went wrong.

Read down to the last rows. The last step before the run stopped, and its error, usually explain the problem. An empty log means no steps were recorded yet.

## Check the variables

**Variables** lists the names and values the run holds, such as answers saved by an **Ask question** step. If a message came out wrong, check here that the value you expected was saved.

## Retry a failed run

- On the run's flow, open **Subscribers**, pick the **Failed** tab and use **Retry** on a contact, or **Retry all failed**.
- Under **Analytics**, **Execution history** lets you tick failed runs and **Retry selected**. **Error logs** groups failures by reason so you can fix one cause and retry the affected runs together. **Retry records** shows what each retry did.

A retry puts the contact back into the flow from the start, so they receive the flow's messages again. A run retried a moment ago must wait a short while before another retry, and retrying in bulk has a limit per batch. The flow must be turned on, or the retry is refused.

## Access

You need the right to view flow runs to open these pages. Cancelling or retrying needs the manage right. With only the view right the screens are read-only.

## If something looks wrong

- **The log is empty.** The run has just started, or no step has been recorded yet. Refresh later.
- **Cancel is missing.** It shows only on a live run, and only with the manage right.
- **A run is not in the list.** Reset the filters at the top.
- **You need to find out why many runs failed.** Use **Analytics**, then **Error logs**.
