# Runbook: the storage meter (observe mode)

For the person on call and the platform operator. Spec: [storage-quota-and-archival.md](../specs/storage-quota-and-archival.md). API: [api/storage-quota.md](../api/storage-quota.md).
What exists today (phases S0 and S1): a meter that **measures** every counted file and **never refuses or deletes** one. If anything here looks like it could lose a file, stop and
escalate: it should not be able to.

## The three switches

| Want                            | Do                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Observe (the default)           | Nothing. No `storage.quota.mode` row in `platform_settings` means observe.                                                                                                                                                                                                                                                                                                                                                                         |
| Switch the meter off everywhere | `INSERT INTO platform_settings (key, value) VALUES ('storage.quota.mode', '"off"') ON CONFLICT (key) DO UPDATE SET value = '"off"';` Takes effect in each process within 5 seconds. Off means no registry writes, no backfill, no counter check. Already-recorded rows stay.                                                                                                                                                                       |
| Turn it back on                 | Set the value to `"observe"` (or delete the row). Files stored or deleted **while it was off** were not recorded: to catch up, run `UPDATE storage_org_state SET backfilled_at = NULL;` and the scheduler re-queues every workspace (3 per 10 minutes). The backfill adds what is missing; it does not drop registry rows of objects deleted during the pause (the weekly bucket verify of phase S5 does), so those bytes stay counted until then. |

`"enforce"` is accepted and **behaves as observe** until phase S2; the log says so once per process. There is no per-workspace switch yet (`storage_org_state.mode` is reserved).

## Reading it

- **Fleet:** `GET /v2/platform/storage/fleet` (operator console API; no screen yet). Total bytes by category, the 20 biggest workspaces, how many are `warn80` / `full` / `over` against their plan's `storage_gb`
  (display only), and the last counter check's drift. One workspace: `GET /v2/platform/storage/workspaces/:uuid`.
- **Is the meter healthy?** The counter `crm_storage_meter_failures_total{step}` should stay at zero. A non-zero value means a metering step threw and the file operation went on without it (the design:
  observe mode never blocks). Look for the log line "storage metering failed; the file operation went on without it" (fields: `step`, `orgId`, `err`). Steps: `reserve`, `commit`, `release`, `remove`.
  The usual causes: the database was unreachable for a moment, or a migration is missing on that node (`storage_*` tables). Drift is repaired by the next nightly check; nothing needs doing for the files.
- **Drift:** the nightly check records, per workspace, how many hot bytes the stored counter was off by (`storage_org_state.last_drift_bytes`) and logs a warning. Small and occasional is normal (a delete that
  raced a commit, a team chat message deleted with its blob). Large or repeated for one workspace means a writer is bypassing the meter: run the coverage test (`storage-writes-guarded.spec.ts`), then look at
  which kind of file that workspace uses.

## Jobs

| Job                | Where                                                                           | Look at                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backfill           | queue `storage-quota`, job `storage.backfill`, jobId `storage-backfill-<orgId>` | A workspace is done when `storage_org_state.backfilled_at` is set. If the object store could not answer a size check (an error, not "not found"), the run reports `deferred` in its log line and leaves `backfilled_at` empty, so the pick-up queues the workspace again in 10 minutes; a job that failed for good is revived by the next pick-up. It is safe to run twice. |
| Counter check      | job `storage.reconcile`, jobId `storage-reconcile-<orgId>-<yyyy-mm-dd>`         | Runs nightly at 03:17 UTC for every workspace, spread 250 ms apart (1,000 workspaces take about 4 minutes of queueing).                                                                                                                                                                                                                                                     |
| Reservation reaper | worker, every 5 minutes                                                         | Log line "returned expired reservations" with the count. A steady non-zero count means uploads are dying between "reserved" and "committed" (a crash loop, a killed worker).                                                                                                                                                                                                |

The backfill reads each owner table page by page (500 rows, 150 ms apart) and asks the object store for the size of recordings, contact files and knowledge files: one `HEAD` per object, four at a time. On a
workspace with 100,000 recordings that is 100,000 requests over a few hours. If the bucket provider rate-limits you, switch the mode to `off` for the day; nothing else depends on it.

## What it does not do (so do not look for it here)

Refuse an upload, warn anyone, sell or grant space, archive or delete a file, show a workspace its own usage, or change a plan. Those are phases S2 to S7. Files in the flow builder's local media and the
developer demo CLI are not metered (recorded gaps in the wiring map). Campaign media and e-mail attachments received before the meter existed are not backfilled until the weekly bucket verify of phase S5.

## Removing it

Set the mode to `off` (no data is touched). To go further: the four tables (`storage_org_state`, `storage_usage`, `storage_objects`, `storage_reservations`) hold nothing the product reads, so they can be
emptied at any time; the counter check and the backfill rebuild them. Do not drop them without a migration that also removes the code (the meter would fail open and log on every upload).
