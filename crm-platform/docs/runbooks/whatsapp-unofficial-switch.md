# Runbook: the unofficial WhatsApp engine switch

For the platform super admin. Owner decision 2026-10-05: only the **official** WhatsApp route (Meta Cloud API / WABA, directly or through a BSP
registered in the provider registry) is supported. The **unofficial** engine (personal WhatsApp numbers linked by QR or pairing code over Baileys,
inbox channel kind `whatsapp_qr`, the `devices` table, the worker's sockets) is **off by default** and does nothing for any workspace until a
super admin turns it on.

## The two levels (owner decision 2026-10-06)

The engine is not open to all workspaces. **Effective access for a workspace = the platform switch is ON and the workspace is on the allow-list.**

1. **Platform switch** (below): the global kill-switch, "is the engine available at all". Off means nobody, whatever the list says.
2. **Allow-list** (table `unofficial_whatsapp_workspaces`, one row per allowed workspace): a super admin allows specific workspaces (clients). Every
   workspace starts off, new sign-ups and platform-owned workspaces included; platform-owned workspaces get no special treatment. No row means off.

Turning the platform switch on therefore opens nothing by itself: allow the workspaces first (or after).

### Allow a workspace (API, super admin only: support gets 403, a workspace token 401)

- Find it: `GET /v2/platform/node-bridge/unofficial/workspace-options?q=<name, slug or owner email>&limit=20` gives
  `{ data: [{ orgUuid, name, slug, planSlug, ownerEmail, alreadyEnabled }] }`.
- Allow or remove: `PUT /v2/platform/node-bridge/unofficial/workspaces/:orgUuid` with `{ "enabled": true, "note": "pilot client" }` (note optional, at most
  500 characters; a repeat keeps the first `enabledAt` and operator and only updates the note when one is sent) or `{ "enabled": false }`. Idempotent;
  404 for an unknown workspace. The answer is the entry `{ orgUuid, name, slug, planSlug, enabledAt, enabledBy: { operatorUuid, name } | null, note,
deviceCount, activeDeviceCount }` (for a removal, the entry as it was).
- See who is on the list: `GET /v2/platform/node-bridge/unofficial/workspaces?q=&limit=&cursor=` gives `{ data: [entry], page }`, newest first.
  `GET /v2/platform/node-bridge` also returns `unofficialWorkspaceCount` next to `unofficialEnabled`.
- Audit: the security events `platform.whatsapp_unofficial.workspace_enabled` and `platform.whatsapp_unofficial.workspace_disabled` carry the
  workspace uuid, name, slug, note and the operator id.
- It takes effect at once on the instance that took the call and within 5 seconds on every other API and worker instance (the allow-list is cached 5 s).
  Nothing is inserted by the migration: every workspace is off until you allow it.

### What happens when a workspace is removed from the list (or was never on it)

Exactly what "platform switch off" does, for that workspace only (see the next sections): its actions are refused with 422 `WA_UNOFFICIAL_DISABLED`, its
queued broadcasts, campaigns and scheduled messages on a personal number are skipped quietly and stay as they are, the worker closes its sockets on the
next pass (within 20 s) and logs it once for that workspace, its entitlements lose `unofficial_whatsapp`, and its dashboard devices card and sender
pickers hide the personal numbers. Devices, saved sessions, rows and conversations are kept; allowing the workspace again picks everything up.

## Turn the platform switch on or off

- API: `PUT /v2/platform/node-bridge/unofficial` with `{ "enabled": true }` (or `false`). Operator session with MFA, role `super_admin`
  (support and other operator roles get 403). The answer is `{ "unofficialEnabled": true }`.
- Read the state: `GET /v2/platform/node-bridge` returns `unofficialEnabled` next to the bridge address and pacing.
- Every change writes the security event `platform.whatsapp_unofficial.updated` with `before` and `after` (`{ "enabled": false }` to
  `{ "enabled": true }`) and the operator id. The stored value is `platform_settings.wa.unofficial.enabled` (JSON boolean; no row means off).
- It takes effect within 5 seconds on every API and worker instance (the platform-settings snapshot), at once on the instance that took the call.
  No restart, no migration.

## What it affects while OFF

"OFF" below means the engine is off for the workspace in question: the platform switch is off (every workspace) or this workspace is not on the
allow-list. Every decision uses the workspace of the request or of the row; a sweep over rows of many workspaces decides per row.

Refused with 422 `WA_UNOFFICIAL_DISABLED` (the web shows a clear message):

- creating a broadcast, campaign or scheduled message that picks a personal-number sender;
- saving a warmer profile for a device, choosing a device as the WooCommerce "send from";
- every device action (QR, pairing code, disconnect, send, message action, group action) and sending on a `whatsapp_qr` inbox channel.

Skipped quietly (nothing is sent, nothing is failed or deleted):

- due broadcasts, scheduled campaigns and scheduled messages whose sender is a personal number stay `scheduled` or `processing`; a running campaign is
  parked as `scheduled` by the stalled-run sweep;
- the worker opens no socket and takes no lease, closes the ones it holds on its next pass (within 20 s), logs it once, and keeps the saved sessions;
- `GET /api/whatsapp-message-settings` (the bridge's pull) answers `{ "success": false, "disabled": true }`.

Changed to the official route: a blank sender, a blank provider and a workspace whose default engine is `baileys` now resolve to `waba`.

Hidden: `whatsapp_qr` channels in the inbox channel list, personal numbers in every sender picker and in the warmer page, and the dashboard devices card
(`devices.unofficialDisabled: true`, empty rows). `GET /v2/billing/entitlements` does not carry the feature key `unofficial_whatsapp`, so the web hides
every personal-number surface.

## What stays untouched

Devices, their saved sessions (`device_auth_state`), broadcasts, campaigns, scheduled rows and recipients, `whatsapp_qr` channels and their
conversations and messages, warmer profiles, and the plan `devices` limit. Nothing is deleted when you turn it off, and nothing needs repair when you
turn it on.

## Turning it ON

1. `PUT /v2/platform/node-bridge/unofficial` `{ "enabled": true }`.
2. `GET /v2/billing/entitlements` for an **allowed** workspace now includes `unofficial_whatsapp` (other workspaces still do not); the plan `devices` limit
   applies again for it (0 means unlimited).
3. Workers restore every device that has a saved session on their next pass (within 20 s, then one device per 2 s). Parked broadcasts, campaigns and
   scheduled messages are picked up by their sweeps within seconds. A one-off scheduled message that is more than `SCHED_MAX_LATE_MINUTES` late by then
   ends `failed` ("Missed its time"), as after any outage; recurring ones move to their next occurrence.
4. The bridge pull route answers normally again.

## What an allowed workspace can now do (BL-095, phase 1 backend)

Allowing a workspace gives its **Owner and Admin** members (the presets that hold the `wa.devices.*` keys; nobody else by default) the personal-number API
([api/whatsapp-devices-baileys.md](../api/whatsapp-devices-baileys.md)). The screens come with the web part of phase 1; until then it is reachable over the API.

- **Add a number** (`POST /v2/devices`), up to **2 personal numbers per workspace** during the pilot (a constant, `PILOT_DEVICE_CAP`, in
  `modules/whatsapp-devices-baileys/device-rules.ts`; the plan's `devices` limit still applies when it is lower, and a plan limit of 0 does not lift the cap).
- **Link it** by QR or by pairing code, **after each person accepted the risk notice themselves** (current version `2026-10-07.1`, recorded in
  `device_risk_acknowledgements`: who, when, a hash of the exact text, the locale; append-only). Raising the version in `@crm/contracts` asks everybody again.
  The notice says, honestly, that this is unofficial, against WhatsApp's terms, that the number can be restricted or banned at any time, that a ban is not covered by support, and that
  every private chat on the number lands in the shared inbox.
- **Rename, disconnect, delete**; see its state (`created`, `awaiting_qr`, `awaiting_pairing_code`, `connecting`, `connected`, `disconnected`, `logged_out`, `error`).
- Limits an operator should know: 5 pairing starts per device per hour, 20 per workspace per day, 10 devices created per workspace per hour; one pairing attempt at a time per device.
- The sockets run in the **worker**: with no worker a pairing start answers 503 `WA_WORKER_UNAVAILABLE`.
- **Pilot rule (decision D1)**: add no workspace to the allow-list until counsel has approved the notice text (English and Arabic). The text is a draft.
- Removing a workspace from the allow-list mid-pairing: its next call is 422 `WA_UNOFFICIAL_DISABLED`, the worker closes its sockets within 20 s, nothing is deleted.
- To see what happened: `audit_log` (module `devices`) and the outbox events `device.created`, `device.pairing_started`, `device.connected`, `device.disconnected`,
  `device.logged_out`, `device.deleted`, `device.risk_acknowledged` (no consumer yet: notifications are phase 2).
- Before a pilot number is linked for real, run [personal-whatsapp-manual-test.md](personal-whatsapp-manual-test.md) on one real phone: nothing here was ever run against a real WhatsApp session.

## Not covered

- A flow stamped `baileys` is not refused when it is saved; when it runs on a `whatsapp_qr` channel its send fails with `WA_UNOFFICIAL_DISABLED` (a
  prompt ends the run `failed`, a plain message is skipped).
- Every route of the devices API (`/v2/devices`, below) calls `UnofficialWhatsappGate.assertEnabledFor(orgId)` first. Anything new that targets the engine must do the same (`modules/auth/unofficial-whatsapp.port.ts`).
- `GET /api/whatsapp-message-settings` (the bridge's pull) has no workspace: it follows the PLATFORM switch only.
- Nothing here was run against a real WhatsApp session; the engine is covered with a fake socket.
