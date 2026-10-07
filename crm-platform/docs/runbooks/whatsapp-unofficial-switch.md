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

## Not covered

- A flow stamped `baileys` is not refused when it is saved; when it runs on a `whatsapp_qr` channel its send fails with `WA_UNOFFICIAL_DISABLED` (a
  prompt ends the run `failed`, a plain message is skipped).
- The devices API and screens (domain not built yet) must call `UnofficialWhatsappGate.assertEnabledFor(orgId)` (`modules/auth/unofficial-whatsapp.port.ts`).
- `GET /api/whatsapp-message-settings` (the bridge's pull) has no workspace: it follows the PLATFORM switch only.
- Nothing here was run against a real WhatsApp session; the engine is covered with a fake socket.
