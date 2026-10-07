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
creator), `activateAfterPairing` (default true), `acknowledgement?`. The number is reduced as WaDesk does: non-digits stripped from both parts; when the local
part starts with the country code **and** at least 9 digits remain, the prefix is stripped once (`+91` with `+91 7690059356` gives `7690059356`; a 10-digit
number that begins with 91 stays intact). The country code is stored as `+<digits>`; a blank region is guessed from the dial code (IN, US, GB, AE, DE, IT,
KR, NG, else XX). The device starts in state `created`.

Limits, checked in one transaction under a per-workspace advisory lock (WaDesk checked without a lock, so two parallel adds could both pass): the plan's
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
