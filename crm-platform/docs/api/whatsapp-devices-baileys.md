# Personal WhatsApp numbers API (`/v2/devices`)

Staff bearer JWT. Errors are problem+json; branch on `code`, never on `detail`. Spec: [personal-whatsapp-connect.md](../specs/personal-whatsapp-connect.md)
(BL-095, phase 1, backend). Schemas: `packages/contracts/src/whatsapp-devices-baileys/` (`devices.ts`, `notice.ts`, `errors.ts`). Code:
`apps/api/src/modules/whatsapp-devices-baileys/`. The read-only public `GET /v1/devices` (developer API) is unchanged.

This is the HTTP side of the **unofficial** engine (a personal number linked like WhatsApp Web, over Baileys). The sockets live in the worker; this API
reaches them only through Redis commands (`DeviceControlService`). It is unofficial, against WhatsApp's terms, and a number can be restricted or banned
at any time: the screens say so (the risk notice below).

## Gate and permissions

Every route first runs the engine gate (`UnofficialWhatsappGate.assertEnabledFor(orgId)`): the platform switch is on AND the workspace is on the operator's
allow-list, otherwise **422 `WA_UNOFFICIAL_DISABLED`** (see [the runbook](../runbooks/whatsapp-unofficial-switch.md)). The gate runs after authentication and the
permission check, so a caller who may not use the route is refused with 403 first.

| Key                     | Allows                                                                       | Default grant |
| ----------------------- | ---------------------------------------------------------------------------- | ------------- |
| `wa.devices.read`       | list, detail, the notice standing                                            | Owner, Admin  |
| `wa.devices.create`     | add, rename and edit a number, accept the risk notice                        | Owner, Admin  |
| `wa.devices.pair`       | start a QR or a pairing code, read the pairing (the QR and the code), end it | Owner, Admin  |
| `wa.devices.disconnect` | disconnect                                                                   | Owner, Admin  |
| `wa.devices.delete`     | delete                                                                       | Owner, Admin  |

No record scope (a device is a workspace resource, like `waba.numbers.*`). Manager, Agent and Viewer get nothing by default (owner decision D2). A
device is addressed by uuid and read through the caller's tenant: **another workspace's uuid is a 404**.

## The risk notice

`PERSONAL_WA_NOTICE_VERSION` (`2026-10-07.1`) and the canonical English text (three statements, five notes, the pairing-code warning) live in
`packages/contracts/src/whatsapp-devices-baileys/notice.ts`; the web translates them (en, ar) keyed by the version and the item ids
(`not_approved_ban_risk`, `own_number_expected_contacts`, `shared_inbox_disclosure`; notes `official_route_lower_risk`, `warm_up`, `no_ban_support`,
`shared_addresses`, `disconnect_keeps_chats`). Any wording change bumps the version, which asks everybody again at their next create or pairing.

An acknowledgement is one row of `device_risk_acknowledgements` per person and version: who (id and a name snapshot), when, the version, the SHA-256 of the
canonical text, the locale shown, the device it first led to (uuid), the user agent and a **hash** of the address. The table is append-only (a trigger
refuses UPDATE and DELETE). **Creating a device and every pairing start require the CURRENT version accepted by the caller** (each person accepts for
themselves; an admin's acceptance does not cover a colleague): otherwise **409 `PERSONAL_WA_NOTICE_REQUIRED`** with `errors: [{ path: "requiredVersion", message }]`.
The caller may send the acknowledgement inline (`acknowledgement` on create or on a pairing start), which records it in the same transaction.

## Routes

| Route                               | Permission              | Idempotency-Key                        | Request (contract)                                                        | Response (contract)                                             | Errors (besides 401, 403, 404, 422 `WA_UNOFFICIAL_DISABLED`, 422 validation)                                                                                                                          |
| ----------------------------------- | ----------------------- | -------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v2/devices`                   | `wa.devices.read`       | -                                      | `ListDevicesQuery` (`state`, `status`, `q`, `limit`, `cursor`)            | `ListDevicesResponse`: `data: PersonalDevice[]`, `page`, `meta` | 400 bad cursor                                                                                                                                                                                        |
| `POST /v2/devices`                  | `wa.devices.create`     | yes                                    | `CreateDeviceInput`                                                       | 201 `PersonalDeviceDetail`                                      | 409 `PERSONAL_WA_NOTICE_REQUIRED`, 409 `DEVICE_ALREADY_EXISTS` (`existingId`), 422 `PLAN_LIMIT_REACHED`, 422 `DEVICE_PILOT_CAP_REACHED`, 422 `DEVICE_PHONE_INVALID`, 429 `DEVICE_CREATE_RATE_LIMITED` |
| `GET /v2/devices/risk-notice`       | `wa.devices.read`       | -                                      | -                                                                         | `RiskNoticeStatus` (`version`, `accepted`, `acceptedAt`)        | -                                                                                                                                                                                                     |
| `POST /v2/devices/risk-notice`      | `wa.devices.create`     | yes                                    | `AcknowledgementInput` (`version`, `items: [true, true, true]`, `locale`) | `RiskNoticeStatus`                                              | 409 `PERSONAL_WA_NOTICE_REQUIRED` (an older version), 422 (a statement not ticked)                                                                                                                    |
| `GET /v2/devices/:id`               | `wa.devices.read`       | -                                      | -                                                                         | `PersonalDeviceDetail`                                          | -                                                                                                                                                                                                     |
| `PATCH /v2/devices/:id`             | `wa.devices.create`     | yes                                    | `UpdateDeviceInput` (`rowVersion` required)                               | `PersonalDeviceDetail`                                          | 409 `ROW_VERSION_CONFLICT`, 409 `DEVICE_NUMBER_LOCKED`, 409 `DEVICE_ALREADY_EXISTS`, 422 `DEVICE_PHONE_INVALID`                                                                                       |
| `POST /v2/devices/:id/pairing/qr`   | `wa.devices.pair`       | no (a stored answer would keep the QR) | `StartPairingInput` (`relink`, `acknowledgement?`)                        | `DevicePairing` (200, `Cache-Control: no-store`)                | 409 `PERSONAL_WA_NOTICE_REQUIRED`, 409 `DEVICE_NOT_PAIRABLE`, 409 `DEVICE_PAIRING_IN_PROGRESS`, 429 `DEVICE_PAIRING_RATE_LIMITED`, 503 `WA_WORKER_UNAVAILABLE`, 504 `DEVICE_PAIRING_TIMEOUT`          |
| `POST /v2/devices/:id/pairing/code` | `wa.devices.pair`       | no                                     | `StartPairingInput`                                                       | `DevicePairing` (carries `code`)                                | as the QR, plus 422 `DEVICE_PHONE_INVALID` (fewer than 8 digits with the country code)                                                                                                                |
| `GET /v2/devices/:id/pairing`       | `wa.devices.pair`       | no                                     | -                                                                         | `DevicePairing` (200, `no-store`)                               | 404 `DEVICE_NO_PAIRING`, 429 (one a second per person)                                                                                                                                                |
| `DELETE /v2/devices/:id/pairing`    | `wa.devices.pair`       | no                                     | -                                                                         | `CancelPairingResult`                                           | -                                                                                                                                                                                                     |
| `POST /v2/devices/:id/disconnect`   | `wa.devices.disconnect` | yes                                    | -                                                                         | `DisconnectResult` (`device`, `unlinked`)                       | 503 `WA_WORKER_UNAVAILABLE` (only for an error other than "no worker answered")                                                                                                                       |
| `DELETE /v2/devices/:id`            | `wa.devices.delete`     | yes                                    | -                                                                         | `DeleteDeviceResult` (`id`, `deleted`, `unlinked`)              | -                                                                                                                                                                                                     |

`risk-notice` is a literal path declared before `:id`. Not built, on purpose (recorded `intended`): `POST devices/check`, `POST devices/{id}/connection`
("Mark connected"), `POST devices/{id}/toggle` as a state flip (its useful part is `PATCH { active }`), proxy save and test (phase 3).

### Create

`CreateDeviceInput`: `name` (2 to 191), `countryCode` (max 8), `phone` (5 to 32), `region?` (max 16), `assigneeUserId?` (a member of this workspace, default the
creator), `activateAfterPairing` (default true), `acknowledgement?`. The number is reduced as Reference does: non-digits stripped from both parts; when the local
part starts with the country code **and** at least 9 digits remain, the prefix is stripped once (`+91` with `+91 7690059356` gives `7690059356`; a 10-digit
number that begins with 91 stays intact). The country code is stored as `+<digits>`; a blank region is guessed from the dial code (IN, US, GB, AE, DE, IT,
KR, NG, else XX). The device starts in state `created`.

Limits, checked in one transaction under a per-workspace advisory lock (Reference checked without a lock, so two parallel adds could both pass): the plan's
`devices` limit (`PlanUsageService.assertCanAdd`, 422 `PLAN_LIMIT_REACHED`) and the **pilot cap of 2 personal numbers per workspace** whatever the plan says
(owner decision D3; `PILOT_DEVICE_CAP`, 422 `DEVICE_PILOT_CAP_REACHED`; a plan limit of 0, "unlimited", does not lift it). `meta.limit` of the list is the
smaller of the two.

### Pairing

`POST .../pairing/qr` (or `/code`) checks, in order: the notice (by this person), the device state, another person's running attempt, then counts toward the
rate limits, records the attempt (Redis `wa:attempt:<org>:<dev>`: who, how, when; no secret), writes the audit row and the `device.pairing_started` event,
and only then asks the worker. A QR start answers when the first QR exists (up to 35 s).

**Pairable rule (spec R1).** A pairing wipes the saved session first, so it starts only from `created`, `disconnected`, `logged_out` or `error` with fewer
than 3 saved session rows. From any other state, or with a healthy saved session, send `relink: true` ("forget the saved session"); without it: 409
`DEVICE_NOT_PAIRABLE` (`errors: [{ path: "reason", message: "healthy_session" | "live_state" | "connected" }]`). A connected device is never re-paired, even with
`relink`: disconnect it first. The runtime enforces the same rule on its own (a command without `relink` never deletes a healthy session).

**One attempt at a time.** A second person's start while the first attempt is running (until its deadline, in a live state) is 409
`DEVICE_PAIRING_IN_PROGRESS` with `errors: [{ path: "startedBy" }, { path: "retryAfterS" }]`. The same person may start again (with `relink`).

**Rate limits** (fixed windows on Redis; a Redis error fails open and is logged): 5 pairing starts per device per hour and 20 per workspace per day (429
`DEVICE_PAIRING_RATE_LIMITED`, `errors: [{ path: "retryAfterS" }]`), 10 devices created per workspace per hour (429 `DEVICE_CREATE_RATE_LIMITED`), the pairing
read one per second per person. The constants are in `device-rules.ts`.

**`DevicePairing`** (start answer and poll): `attempt` (changes with each start), `method`, `state`, `reason`, `label`, `progress` (0 to 100), `qr` and `qrAgeMs`
(only while `state` is `awaiting_qr`; it rotates about every 20 s, draw it client-side), `code` and `codeExpiresIn` (only while `awaiting_pairing_code`; show as
`XXXX-XXXX` with `PERSONAL_WA_PAIRING_CODE_WARNING`), `startedAt`, `deadlineAt` (90 s for a QR, 3 minutes for a code), `startedByMe`. Poll every 2 s. Another person
who holds `wa.devices.pair` may read an attempt (flagged `startedByMe: false`).

**Secrets.** The QR and the code are in the response of the start and of the authenticated poll only. They are never written to Postgres, the outbox, the audit
trail or the idempotency store (the pairing routes are not `@Idempotent`), never logged, kept in Redis only as long as they can be used (QR 45 s as
`{ qr, at }`, code 180 s), the command answer is read once (`GETDEL`), and the responses are `Cache-Control: no-store` with `Vary: Authorization`. The web
proxy must not cache `/api/v2/devices/*/pairing*` (not checked here: `apps/web` was not touched).

### State

`PersonalDevice.connectionState` is one of `created`, `awaiting_qr`, `awaiting_pairing_code`, `connecting`, `connected`, `disconnected`, `logged_out`, `error`, with
`stateReason` one of `user`, `worker_silent`, `session_incomplete`, `unlinked_on_phone`, `forbidden`, `qr_timeout`, `pair_failed`, `code_failed`, `mismatch`,
`device_limit_reached` (and the reserved `proxy_unreachable`, `session_conflict`, `worker_unavailable`, not produced in phase 1). **Only the worker writes a
state**; the one exception is a disconnect nobody answered (below). `status` (`connected | disconnected | needs_pair`) is unchanged and is what the senders read.
There is no `banned` state: the runtime cannot tell a ban from an unlink, so `logged_out` with `forbidden` is shown as "WhatsApp ended the link", never as a ban.

### Disconnect and delete

`disconnect` asks the worker to log the number out and wipe its session (`unlinked: true`). If **no worker answers**, the saved session rows are deleted here
(so a worker that returns cannot restore and reconnect it), the row becomes `disconnected` / `user` and `unlinked` is `false`: the screen says "Also remove this
device in WhatsApp > Linked devices". A device that is not live only has its saved session removed.

`delete` asks the worker to unlink first (15 s at most), then in one transaction closes the open, pending and snoozed conversations of the number's inbox
channel (history stays readable), switches the channel off (`ChannelRegistryService.retireDeviceChannel`), deletes the row (the saved session cascades), audits
and emits `device.deleted`. The plan slot is free again.

## Events (outbox) and audit

In the same transaction as the change; none carries a QR, a code or a number. `device.created`, `device.renamed` / `device.updated`, `device.risk_acknowledged`
(aggregate `device_risk_acknowledgements`), `device.pairing_started` (`method`, `relink`), `device.disconnected` (API fallback), `device.deleted`. The runtime
raises `device.status_changed` (now with `state` and `reason`) and, on the transition only, `device.connected`, `device.disconnected` and `device.logged_out`.
There is no consumer yet (notifications, webhook, realtime push are phase 2). Audit rows (`audit_log`, module `devices` and `device_risk_acknowledgements`)
carry the actor and a field delta.

## Error codes added

`PERSONAL_WA_NOTICE_REQUIRED` 409, `DEVICE_ALREADY_EXISTS` 409, `DEVICE_PILOT_CAP_REACHED` 422, `DEVICE_PAIRING_RATE_LIMITED` 429, `DEVICE_CREATE_RATE_LIMITED` 429,
`DEVICE_PAIRING_IN_PROGRESS` 409, `DEVICE_NOT_PAIRABLE` 409, `DEVICE_NO_PAIRING` 404, `DEVICE_PHONE_INVALID` 422, `DEVICE_NUMBER_LOCKED` 409,
`WA_WORKER_UNAVAILABLE` 503, `DEVICE_PAIRING_TIMEOUT` 504. Shared and reused: `WA_UNOFFICIAL_DISABLED` 422, `PLAN_LIMIT_REACHED` 422, `ROW_VERSION_CONFLICT` 409.

# Groups of a personal number (`/v2/devices/:id/groups`)

Groups on a PERSONAL number (the unofficial engine, channel kind `whatsapp_qr`): a Groups tab that lists, creates and edits the groups the number is in and
their members, the twin of the official [`/v2/waba/numbers/:id/groups`](whatsapp-cloud-api-waba.md). Plan and decisions: [whatsapp-personal-groups-build.md](../threadwise-port/plan/whatsapp-personal-groups-build.md)
(D1 to D12); inventory `TW-WAGRP-003..014, 027..036`. Schemas: `packages/contracts/src/whatsapp-devices-baileys/groups.ts`. Code:
`apps/api/src/modules/whatsapp-devices-baileys/device-groups*.ts`. **Group messages in the inbox** (thread `g:<id>`, the composer, read-only when left) are the inbox's
business ([plan-inbox-chat.md](../threadwise-port/plan-inbox-chat.md)), not this API's.

`:id` is the `devices.uuid`, `:gid` the `wa_device_groups.uuid` (never WhatsApp's id; `groupId` in a response is the BARE WhatsApp id, no `@g.us`). Another
workspace's device or group is a 404 (`NOT_FOUND`, `WA_GROUP_NOT_FOUND`). Every route runs the engine gate first (422 `WA_UNOFFICIAL_DISABLED`; there is no plan
feature, decision D1) and then the key below. Owner and Admin hold all four by default.

| Key                | Allows                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `wa.groups.read`   | state, list, detail, refresh, sync                                                                                   |
| `wa.groups.create` | create a group                                                                                                       |
| `wa.groups.manage` | members (numbers are personal data), subject/description/settings, picture, join requests, invite link, join by link |
| `wa.groups.leave`  | leave                                                                                                                |

## How it works

Reads come from the directory `wa_device_groups` that the **worker** keeps from what the socket reads (`groups.upsert`, `groups.update`,
`group-participants.update`, `group.join-request`, and a low-frequency sweep). Changes call WhatsApp through `DeviceControlService.groupAction`, which applies the
unofficial gate and the per-number ban-safety limiter and relays to the worker that owns the socket. Rules the service keeps:

- WhatsApp is called OUTSIDE any database transaction; the write, its audit row and its outbox events are then one short transaction.
- What the stored row says is checked BEFORE the call: a number that is not an admin never reaches WhatsApp for an admin-only change (403 `WA_GROUP_NOT_ADMIN`; a plain
  member may still rename, set the picture or, when the group lets members add, add people); a group the number left is read-only (409 `WA_GROUP_LEFT`); a number that
  is not connected or that no worker holds is 409 `WA_GROUP_DEVICE_NOT_READY` and spends no limiter budget.
- A change we make updates the stored row at once (settings, roster, queue); the re-read the runtime schedules after WhatsApp's own event corrects names and anything
  missed, and diffs against the stored roster, so nothing is announced twice.
- Member numbers, the join-request queue and the invite link go only to `wa.groups.manage`. The invite code is in the explicit invite-link responses only: never in a
  list row, an audit row, an event, a log line or a push. Participant ids that are anonymous (`@lid`) are returned only as the `jid` a mention or a removal needs.

## Routes

| Route                                                | Key                | Idempotency-Key | Request (contract)                                                                                             | Response                                                                                                                                     |
| ---------------------------------------------------- | ------------------ | --------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v2/devices/:id/groups/state`                   | `wa.groups.read`   | -               | -                                                                                                              | `WaDeviceGroupsState` (`connected`, `reason`, `limits`, `joinByLinkEnabled`, `lastSyncedAt`)                                                 |
| `GET /v2/devices/:id/groups`                         | `wa.groups.read`   | -               | `waDeviceGroupListByDeviceQuerySchema` (`q`, `status`, `limit`, `cursor`)                                      | `WaDeviceGroupList` (`items`, `stats`, `page`), newest first by keyset                                                                       |
| `POST /v2/devices/:id/groups`                        | `wa.groups.create` | yes             | `createWaDeviceGroupBodySchema` (`subject`, `description?`, `numbers` 1..20, `acknowledgeRisk: true`)          | 201 `CreateWaDeviceGroupResult` (`group`, per-number `participants`, `descriptionSet`)                                                       |
| `POST /v2/devices/:id/groups/sync`                   | `wa.groups.read`   | yes             | -                                                                                                              | `WaDeviceGroupsSyncResult` (`groups`, `left`, `throttled`); once a minute per number                                                         |
| `GET /v2/devices/:id/groups/:gid`                    | `wa.groups.read`   | -               | -                                                                                                              | `WaDeviceGroup`                                                                                                                              |
| `POST /v2/devices/:id/groups/:gid/refresh`           | `wa.groups.read`   | yes             | -                                                                                                              | `WaDeviceGroup`; a read within 10 s of the last one is answered from the directory; a group WhatsApp no longer knows is marked left          |
| `PATCH /v2/devices/:id/groups/:gid`                  | `wa.groups.manage` | yes             | `UpdateWaDeviceGroupInput` (`subject`, `description`, `announce`, `restrict`, `joinApproval`, `memberAddMode`) | `WaDeviceGroup` after the change (synchronous, 200)                                                                                          |
| `PUT /v2/devices/:id/groups/:gid/picture`            | `wa.groups.manage` | yes             | multipart field `file`: JPEG or PNG up to 5 MB (checked on the bytes, 422)                                     | `WaDeviceGroup`                                                                                                                              |
| `DELETE /v2/devices/:id/groups/:gid/picture`         | `wa.groups.manage` | yes             | -                                                                                                              | `WaDeviceGroup`                                                                                                                              |
| `GET /v2/devices/:id/groups/:gid/participants`       | `wa.groups.manage` | -               | `WaDeviceGroupMembersQuery` (`q` name or digits, `limit`, `cursor`)                                            | `WaDeviceGroupMembers` (`members[{jid, phone, name, admin, self}]`, `total`, `page`); from the cached roster, the cursor is a position in it |
| `POST /v2/devices/:id/groups/:gid/participants`      | `wa.groups.manage` | yes             | `ChangeWaGroupParticipantsInput` (`action: add \| promote \| demote`, `numbers` 1..20)                         | 200 `WaGroupParticipantResults` (`okCount`, `failCount`, `results[{number, outcome, code}]`)                                                 |
| `DELETE /v2/devices/:id/groups/:gid/participants`    | `wa.groups.manage` | yes             | `{ numbers }` 1..20                                                                                            | 200 `WaGroupParticipantResults`                                                                                                              |
| `GET /v2/devices/:id/groups/:gid/join-requests`      | `wa.groups.manage` | -               | `?fresh=1` asks WhatsApp now (admin only; one counted operation)                                               | `WaDeviceGroupJoinRequests` (the stored queue)                                                                                               |
| `POST /v2/devices/:id/groups/:gid/join-requests`     | `wa.groups.manage` | yes             | `{ action: approve \| reject, jids[1..50] }`                                                                   | 200 `WaGroupParticipantResults` (the handled ones leave the stored queue)                                                                    |
| `GET /v2/devices/:id/groups/:gid/invite-link`        | `wa.groups.manage` | -               | -                                                                                                              | `{ code, url }`, `Cache-Control: no-store`; the held code is served without asking WhatsApp                                                  |
| `POST /v2/devices/:id/groups/:gid/invite-link/reset` | `wa.groups.manage` | yes             | -                                                                                                              | `{ code, url }`; every link shared before stops working                                                                                      |
| `POST /v2/devices/:id/groups/join-by-link/preview`   | `wa.groups.manage` | yes             | `{ invite }` (a `chat.whatsapp.com` link or a bare code)                                                       | `WaDeviceGroupJoinPreview`; counts toward the join-by-link cap                                                                               |
| `POST /v2/devices/:id/groups/join-by-link`           | `wa.groups.manage` | yes             | `{ invite, acknowledgeRisk: true }`                                                                            | `{ status: joined \| requested, group \| null }`                                                                                             |
| `POST /v2/devices/:id/groups/:gid/leave`             | `wa.groups.leave`  | yes             | `{ confirm: true }`                                                                                            | `WaDeviceGroup` (`left: true`); the row stays, read-only (D5)                                                                                |

Literal paths (`state`, `sync`, `join-by-link`) come before `:gid`. Partial success of a participants call is a success: read `results`. WhatsApp's per-person
answer is `ok`, `already_member`, `not_member`, `not_on_whatsapp`, `privacy_blocked` (send the invite link instead), `not_allowed`, `group_full` or `failed`, with its
status code for support. A PATCH sends one WhatsApp call per field that differs from the stored row (at most six); when a later call fails the earlier ones are kept (stored,
audited) and the failure is what the caller sees. Join by link is off unless the platform sets `WA_GROUPS_JOIN_BY_LINK_ENABLED` (422 `WA_GROUP_JOIN_BY_LINK_DISABLED`).
The idempotency store keeps the answers of the invite-link reset (it holds the new code, like the official link reset) and of nothing else secret.

### Errors (problem+json `code`)

| Code                             | HTTP | When                                                                                                                                                                                       |
| -------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `WA_GROUP_NOT_ADMIN`             | 403  | the stored row says the number is not an admin (no WhatsApp call), or WhatsApp refused for that reason                                                                                     |
| `WA_GROUP_NOT_FOUND`             | 404  | the group is not in this workspace and number, or WhatsApp says it is gone                                                                                                                 |
| `WA_GROUP_DEVICE_NOT_READY`      | 409  | the number is not connected, or no worker holds its session                                                                                                                                |
| `WA_GROUP_LEFT`                  | 409  | the number left or was removed: read-only                                                                                                                                                  |
| `WA_GROUP_RATE_LIMITED`          | 429  | the per-number limiter, a daily cap, the cooldown, or WhatsApp's own limit; `errors[]` has `retryAfterS` and `scope` (`ops_minute`, `ops_day`, `creates_day`, `join_link_day`, `cooldown`) |
| `WA_GROUP_LIMIT_REACHED`         | 422  | WhatsApp says the group is full or the number cannot be in more groups                                                                                                                     |
| `WA_GROUP_INVALID_NUMBER`        | 422  | the connected number itself, or no number; `errors[]` lists them                                                                                                                           |
| `WA_GROUP_JOIN_LINK_INVALID`     | 422  | the invite is expired, revoked or malformed                                                                                                                                                |
| `WA_GROUP_JOIN_BY_LINK_DISABLED` | 422  | joining by link is off on this platform                                                                                                                                                    |
| `WA_GROUP_UNAVAILABLE`           | 502  | WhatsApp refused for another reason (a plain "forbidden" starts the cooldown) or answered something unexpected                                                                             |
| `WA_WORKER_UNAVAILABLE`          | 503  | no worker answered in time, or none is running                                                                                                                                             |

`WA_GROUP_ANNOUNCE_ONLY` (a non-admin sending in an admins-only group) belongs to the inbox send path, not to this API.

## Limits (ban safety, decision D11)

Per workspace and number, in Redis: 20 group operations a minute and 200 a day, 5 creates a day, 5 joins by link a day, at most 20 people per call, and a 10-minute
cooldown after a refusal that looks like a limit or a ban signal (a plain not-admin never starts it). `GET .../state` shows what is left. Env (all optional):
`WA_GROUPS_OPS_PER_MINUTE`, `WA_GROUPS_OPS_PER_DAY`, `WA_GROUPS_CREATES_PER_DAY`, `WA_GROUPS_JOIN_BY_LINK_PER_DAY`, `WA_GROUPS_JOIN_BY_LINK_ENABLED`,
`WA_GROUPS_COOLDOWN_SECONDS`, `WA_GROUPS_PARTICIPANTS_PER_CALL`, and the sweep's `WA_GROUPS_SWEEP_HOURS` (below).

## The directory (worker)

`DeviceGroupsSink` is registered on the runtime's `InboundRouter` by `WhatsappDevicesBaileysWorkerModule` (imported by `WorkersModule`; the HTTP app reads no
socket). It does nothing for a workspace off the unofficial allow-list. One read is one short transaction (`DeviceGroupsSyncService`): lock the number's rows, upsert
what was read, mark what vanished (a `complete` read only: `left_at` is set and the row is kept), keep the legacy storefront tables, write the events the difference calls
for. Per-group events (a subject or settings change, our own promotion, a join request, the number removed) are applied at once; people joining or leaving are left to the
re-read the runtime schedules a few seconds later, which diffs the roster. A removal by someone else sets `removed: true` on the `left` event (the author is not our own
number); a leave from the phone, or a vanish found by a full read, says `removed: false` (no notification).

- **Legacy tables.** `/store/groups` and the ordering flow still read `wa_groups` and `wa_group_members` (unique on the group id alone). The sink keeps them filled the way
  Reference's bridge did: one `wa_groups` row per group with the full id (`<id>@g.us`), the number's digits, the subject, the size and `synced_at`; a group's members
  replaced as a whole when its roster moved; members known only by an anonymous id are skipped. The ordering `group_code` is never written, and a group the number left keeps
  its row and its code. Two numbers of one workspace in the same group share one row (the last sync wins `device_phone`), Reference's own limit.
- **Sweep.** `DeviceGroupsSweepService` (every 10 minutes, at most 5 numbers per pass, each after a random delay up to 20 s) re-reads the whole list of a connected
  number that was not read for `WA_GROUPS_SWEEP_HOURS` (default 6, `0` turns it off), claimed in Redis (`wa:grpsweep:<org>:<device>`) so one worker does it. It goes through
  the same limiter as every group action; a number that is resting or over budget is skipped and tried again on a later pass. Never a tight loop.
- **Bulk import.** A first read of more than 25 groups still writes every `created` event (the inbox retitles its thread from it) but marks them `bulk` and only the first
  `lead`, so the realtime push is one hint.

## Events (outbox) and audit

Aggregate module `whatsapp-devices-baileys`, aggregate id the `wa_device_groups.id`, in the same transaction as the change. Payload: `groupUuid`, `deviceId` (the device
uuid) and counters only: `created` (`changed: ['rejoined']` when the number came back), `updated` (`changed`: `subject`, `description`, `settings`, `admin`, `picture`,
`invite_link`), `participants_changed` (`added`, `removed`, `roles`, `size`), `join_request` (`added`, `pending`, or `handled: 'settled'`), `left` (`removed`). Never a
member's number, the subject or the invite code. Audit rows (`audit_log`, module `wa_device_groups`) carry the actor and `event`: `wa.group.create`, `.update` (with the field
names), `.participants_add|remove|promote|demote` (counts), `.join_requests` (action, count), `.invite_link_read`, `.invite_link_reset`, `.picture`, `.picture_remove`,
`.join_by_link`, `.leave`.

## Realtime and notifications

`whatsapp.device_group.changed` `{ groupId, deviceId, kind }` goes to people holding `wa.groups.read` ([realtime.md](realtime.md)). `device_group_join_request` (one
collapsing row per group) and `device_group_removed` go to people holding `wa.groups.manage` ([notifications.md](notifications.md)); push is off by default.
