# Node bridge runtime API (NODE)

Operator console, `v2`, platform operator token. Every operator may read; a super admin saves and tests. Errors are problem+json with a stable `code`.

| Method | Path                                                      | Who         | What                                                                                                                                                                         |
| ------ | --------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v2/platform/node-bridge`                                | operator    | `{ serverUrl, tokenSet, rowVersion, pacing, pacingRowVersion }`. The token is never returned.                                                                                |
| PATCH  | `/v2/platform/node-bridge`                                | super admin | `{ serverUrl, token?, rowVersion }`. Blank token keeps the saved one; blank URL clears it.                                                                                   |
| GET    | `/v2/platform/node-bridge/unofficial/workspaces`          | super admin | `?q=&limit=&cursor=` -> `{ data: UnofficialWorkspace[], page }` (the workspaces allowed to use the unofficial engine)                                                        |
| GET    | `/v2/platform/node-bridge/unofficial/workspace-options`   | super admin | `?q=&limit<=20` -> `{ data: [{ orgUuid, name, slug, planSlug, ownerEmail, alreadyEnabled }] }`                                                                               |
| PUT    | `/v2/platform/node-bridge/unofficial/workspaces/:orgUuid` | super admin | `{ enabled, note?<=500 }` -> `UnofficialWorkspace`; `false` removes the workspace; 404 unknown workspace; audited `platform.whatsapp_unofficial.workspace_enabled/_disabled` |
| PATCH  | `/v2/platform/node-bridge/pacing`                         | super admin | `{ msgGap 1..600, batchesGap 1..10000, bwMsgGap 1..1440, enableBatches, rowVersion }`                                                                                        |
| POST   | `/v2/platform/node-bridge/test`                           | super admin | `{ serverUrl, token? }` (blank token = saved). 422 if the address is not http(s); else 200 `{ ok, message }`.                                                                |

Failures: 409 `ROW_VERSION_CONFLICT` (stale `rowVersion`), 422 `VALIDATION_FAILED`, 403 for a non-super operator on a write.

## Bridge-facing

Authenticated only by the shared `X-Node-Token` header (constant-time compare; no configured secret means everyone is refused with 403). The path is the
bridge's own, with no version prefix.

| Method | Path                             | Response                                                                                                 |
| ------ | -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| GET    | `/api/whatsapp-message-settings` | `{ success: true, msg_gap, batches_gap, bw_msg_gap, enable_batches: 0 \| 1 }` (the bridge's wire format) |

Audit events: `platform.node_bridge_updated`, `platform.node_pacing_updated` (changed field names only, never values).

## Group directory consumers (personal numbers)

The runtime hands what a socket reads about its groups to `InboundRouter.groups(orgId, deviceId, groups, { complete })` and `InboundRouter.groupEvent(...)`. The directory sink
(`DeviceGroupsSink`, `apps/api/src/modules/whatsapp-devices-baileys/`, registered by `WhatsappDevicesBaileysWorkerModule`) is the consumer: it writes `wa_device_groups` (a
`complete` read prunes the groups that vanished by setting `left_at`; a partial one never does), keeps the legacy `wa_groups` and `wa_group_members` filled for the storefront's
ordering codes, and writes the outbox events. A workspace off the unofficial allow-list is skipped. `DeviceGroupsSweepService` re-reads the whole list of a connected number
every `WA_GROUPS_SWEEP_HOURS` (default 6) through `DeviceControlService.groupAction`, so the ban-safety limiter applies. `DeviceControlService.hasOwner(orgId, deviceId)` says
whether a worker holds the session (the Groups tab's `worker_unavailable` state). Management routes: [whatsapp-devices-baileys.md](whatsapp-devices-baileys.md#groups-of-a-personal-number-v2devicesidgroups).
