# API: storage quota (phases S0 and S1, observe mode)

Spec: [specs/storage-quota-and-archival.md](../specs/storage-quota-and-archival.md) (backlog BL-300). Types are in `@crm/contracts` (`storage-quota`). Wiring:
[threadwise-port/wiring/storage-quota.md](../threadwise-port/wiring/storage-quota.md). Operating it: [runbooks/storage-quota.md](../runbooks/storage-quota.md).

**This build measures and refuses nothing.** No route a workspace uses changes: an upload that worked still works, with the same status, body and headers. The only new routes are
the platform operator's, and they only read. The error code `STORAGE_QUOTA_EXCEEDED` is registered so every client can handle it before enforcement (phase S2) exists; nothing raises it yet.

## Platform operator (read only)

Base `/v2/platform/storage`. Operator session, `OperatorGuard` + `PlatformPermissionGuard`, key `platform.workspace.view_all`. Not plan-gated (platform routes).

| Method and path       | What                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /fleet`          | `StorageFleetResponse`: the mode in force, totals (workspaces, hot / cold / reserved bytes, objects), usage by category, the 20 workspaces with most hot bytes, how many sit at each level, the counter-drift figures of the last nightly check                                                                                                                                         |
| `GET /workspaces/:id` | `StorageWorkspaceDetailResponse` for one workspace (`:id` is the workspace uuid): `summary` (hot, reserved, cold, cap, level, `overSince`, usage by category, last check) and the bytes of `pending` registry rows older than an hour with no owner (`orphanCandidates`, reported, never acted on). Writes a security event `platform.storage.workspace_viewed` (actor, workspace uuid) |

- `mode` is the platform setting `storage.quota.mode` as stored (`off`, `observe`, `enforce`); a missing row is `observe`. `enforce` is not built: it is reported as configured and behaves as `observe`.
- `capBytes` is the plan limit `storage_gb` in bytes at the last nightly check (0 = unlimited). `level` is `ok | warn80 | full | over` against that cap, **for display only**.
  Packs and grants do not enter the cap until phase S4.
- Bytes are plain numbers. A workspace that was never measured has no row and does not appear in `top`; `levels` counts only measured workspaces.
- Errors: 401 without an operator session, 403 `RBAC_PLATFORM_PERMISSION_REQUIRED` without the key (and a `platform.permission_denied` security event), 400 for an `:id` that is not a uuid, 404 for an unknown workspace.

The keys `platform.workspace.storage` (reconcile now, re-evaluate a cap; Super Admin and Admin) and `platform.workspace.storage_grant` (grace grants; Super Admin) are seeded and guard no route yet (phases S2 and S4).

## Plan limit

`storage_gb` is a core plan limit key (group `workspace`): whole GB, 1 GB = 2^30 bytes, `0` = unlimited. A plan that lacks the key reads as 0, so adding it changes nothing until an operator sets
a value; the plan editor (platform console) shows it as "Storage (GB)" with the note that it is measured only. A workspace's usage panel does not list it yet (phase S2);
`PlanUsageService.assertCanAdd('storage_gb')` throws on purpose (it is bytes, not rows).

## Workspace permissions (seeded, no route yet)

`storage.usage.read`, `storage.files.manage`, `storage.restore.request`, granted to the Owner and Admin presets of every workspace (existing and new). The Settings > Storage screen, the banner and the
restore flow of phases S2 and S5 are built on them.

## What the meter does to existing routes (no visible change)

Every counted write goes through the guard, which records it after the file is stored. For a caller nothing changes: same status, same body, same headers, no new field, no new error. The writers are
listed in the wiring map; in short: agent and visitor uploads, the developer REST API media upload, inbound customer media on every channel, call recordings, email attachments (inbound and staged),
scheduled and campaign media, Telegram profile pictures, AI knowledge files and team chat attachments.

If the meter cannot do its job (database fault, a bug), the write still succeeds; the fault is logged with the workspace id and the step (never a file name or a number) and counted in
`crm_storage_meter_failures_total{step}` (`reserve`, `commit`, `release`, `remove`).

## Background jobs (worker)

| Job                 | Queue / clock                                      | What                                                                                                                                                                   |
| ------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage.backfill`  | queue `storage-quota`; 3 workspaces per 10 minutes | Builds a workspace's registry from the rows that own files, measuring what the table does not store; idempotent, throttled, resumable. Marks `backfilled_at`.          |
| `storage.reconcile` | queue `storage-quota`; nightly 03:17, spread       | The counter check: syncs team chat blobs, links `pending` rows to their owner, recomputes counters from the registry, records the drift, writes the cap and the level. |
| Reservation reaper  | every 5 minutes                                    | Returns reservations nobody committed or released within 15 minutes to `reserved_bytes`.                                                                               |

All three do nothing when the mode is `off`. None deletes a file.
