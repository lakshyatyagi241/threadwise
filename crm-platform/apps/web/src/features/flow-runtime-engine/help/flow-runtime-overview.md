---
id: flow-runtime-overview
title: Flow runs
summary: See every time a flow ran for a contact, where it stands and how it ended, then enroll contacts, cancel runs and retry failures.
area: automation
order: 20
documents: [nav:flow-runtime]
keywords: [flows, automation, runs, subscribers, enroll, retry, failed, analytics, history, errors]
---

## What it is for

Each time a flow starts for a contact, it is recorded as a run. **Flow runs** shows what started it, where it is now and how it ended. You can also see who is in a flow, enroll contacts and retry failures from here.

## How to use it

1. Open **Flow runs**. The table lists runs newest first, with the flow, contact, channel, **Started by**, status, start time, last activity and steps.
2. Narrow the list with the **Status**, **Started by** and **Flow** filters, and use **Load more** for older runs.
3. Select a flow name to open the run. It shows the facts about the run, why it ended, what it is waiting for, the execution timeline and the variables it holds.
4. To stop a run that is still live (running, waiting for a reply, delayed or halted), select **Cancel** and confirm. The run stops where it is and the customer is not told.
5. On a run, select **Subscribers** to see everyone in that flow. Use **Enroll contacts** to start the flow now for chosen contacts or a contact group. A contact already in the flow is counted and not started again.
6. On the subscribers page, use the status tabs (Active, Paused, Completed, Failed), then **Pause**, **Resume** or **Retry** on a row. **Retry all failed** restarts every failed contact from the beginning.

## Reading the execution timeline

Open a run and look at **Execution timeline**. It lists every node the run executed, in order, with its result (OK, Error, Skipped, Waiting or Timed out), the exit it left by, how long it took and which visit it was when a flow loops back. Select a node to see what it did, the error if it failed and the time.

- **Path taken** shows the nodes the run reached, in order, and **Not reached** shows the rest of the flow.
- Use **Errors only** to jump to the node that failed.
- The timeline shows each node as it was when it ran. If someone edits the flow afterwards, a notice says so, and nodes that were deleted are marked **Removed from the flow**. The log itself does not change.
- A run logs at most 200 steps. If it ran more, the timeline says the later ones were counted but not listed. Failures are always kept.
- Run logs are deleted 30 days after the run ends. Runs that are still live are never deleted.

## Options and settings

Select **Analytics** for performance. Pick a period and optionally one flow, then use the tabs:

- **Overview** shows started, running, completed and failed runs, completion rate, average time to complete, a daily trend, the status mix, failure reasons, runs by source and a flow leaderboard.
- **Execution history** lists every run, with failed runs ready to retry in bulk.
- **Error logs** groups failures by reason. **Retry records** lists every retry and its outcome.

## Plan and access

You need the right to view flow runs. Without it the screen says you have no access. Cancelling, enrolling, pausing, resuming and retrying need the manage right. With only the view right the screen is read-only and says so.

## If something looks wrong

- **Enrolling is refused.** The message says why: the flow may be paused or switched off, or it may have no steps yet.
- **A retry is refused.** Only a failed contact can be retried, and a run retried a moment ago must wait a short while.
- **A run is halted.** The channel was down or the daily sending cap was reached. It tries again by itself.
- **A run is not listed.** Check the filters at the top and reset them.
