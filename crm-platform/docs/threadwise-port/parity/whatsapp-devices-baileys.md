# Parity evidence: whatsapp-devices-baileys (WADEV), personal-number slice

Reference 1.7.0 vs this branch. Wiring map: [wiring/whatsapp-devices-baileys.md](../wiring/whatsapp-devices-baileys.md). Spec:
[personal-whatsapp-connect.md](../../specs/personal-whatsapp-connect.md) (BL-095, phase 1, **backend only**). The screens are built separately by the web side of the same phase.

## Evidence

- `apps/api/test/e2e/whatsapp-devices-baileys/devices.e2e.spec.ts` (23): the real app, Postgres and Redis, a fake socket. The journey create, acknowledge, QR start,
  poll, simulated connected, rename, disconnect, delete (with the QR never in a log, the outbox, the audit trail or the idempotency store); the pairing code; every
  refusal (engine off on every route, removed from the allow-list mid-pairing, no acknowledgement per person, an older notice version, pilot cap and plan limit,
  parallel adds, duplicate number, assignee from another workspace, 403 per key, 404 for another workspace on every route); the pairable rule and `relink`; a second
  person's start; the 5-an-hour limit; no worker; mismatch; `logged_out`; cancel; disconnect without a worker; delete with threads; the list (cursor, filters, search).
- `apps/api/test/integration/whatsapp-devices-baileys/devices-rls.spec.ts` (10): forced RLS on both tables, two-workspace isolation, composite foreign keys, the append-only
  trail (and that a person or a workspace can still be removed), unique digits, the closed state set, the keys and who holds them.
- Unit: `test/unit/whatsapp-devices-baileys/` (phone normalisation with Reference's examples, cap, pairable rule, attempt rule, consent version, limits, notice text and
  hash) and `test/unit/node-bridge-runtime/device-state.spec.ts` (every runtime status to a state and reason, QR shape and TTL, `senderDigits`).
- **Not provable here** (needs a real phone, no WhatsApp session was used): that WhatsApp accepts the QR and the code, the 515 "Syncing" step, ban behaviour, and that
  `qr`, `code` and `logout` behave on the real library. The manual checklist is [runbooks/personal-whatsapp-manual-test.md](../../runbooks/personal-whatsapp-manual-test.md).
  The Reference reference was not run for this slice; behaviour is taken from the inventory entries and the spec.

## Intended differences (each with its reason)

1. **Risk acknowledgement before a device exists and before every pairing** (Reference shows no ban text in the connect modal). Recorded per person and version, with a
   hash of the exact English text; append-only. Reason: owner request 2026-10-07 and plan-inbox-chat decision 1.
2. **Admin only** (`wa.devices.*`, Owner and Admin presets) instead of Reference's workspace-role check, with five keys instead of Reference's six unused staff keys (no
   `wa.devices.proxy` until phase 3). Owner decision D2.
3. **Pilot cap of 2 personal numbers per workspace** on top of the plan's `devices` limit; "unlimited" (0) does not lift it. Owner decision D3. Reference counted devices plus
   WABA and Twilio numbers together and checked without a lock; ours counts personal numbers only and creates under a per-workspace advisory lock (a documented bug fix).
4. **No proxy in phase 1** (owner decision D5): save and test are `blocked` (phase 3); the runtime still honours a proxy already on the row.
5. **Every chat on the number enters the shared inbox**, disclosed in the notice (owner decision D4); no per-device filter yet (phase 4).
6. **A browser can never assert a connection state.** Not ported: "Mark connected" (`POST devices/{id}/connection`), the browser-driven status check
   (`POST devices/check`, replaced by the worker heartbeat and the 90 s stale sweep), and the toggle as a state flip (its useful part is `PATCH { active }`).
7. **A QR request never wipes a healthy saved session** unless the caller says `relink` (Reference terminated on every QR request). Spec R1.
8. **`connection_state` beside `status`**, with a reason code: a blink is "connecting", never "needs re-pair" (R3); a restriction is "WhatsApp ended the link", never
   "banned" (R8).
9. **Delete terminates first** (Reference left the socket and session alive), closes the open conversations of the number's channel and frees the slot; history stays readable.
10. **Duplicate number is checked on edit too** and the assignee must be a member of the workspace (both are quirks in Reference). The number cannot be edited while a
    session exists.
11. **Disconnect with no worker**: the saved session rows are removed by the API (Reference flipped the row whatever the bridge said, and a surviving session was the bug its
    own comment records); the answer says `unlinked: false`.
12. **`activate_after_pairing` is honoured** by the runtime (the first connection sets `active` only when the flag is on; it was always on before). Spec R2.
13. **Pairing starts are rate limited** (5 an hour per device, 20 a day per workspace; Reference had only the bridge's 60 s lock) and one person's attempt blocks another's.
14. **`senderDigits` fix**: a 10-digit local number that merely begins with the country code (`+91` with `9123456789`) was read as already carrying it; it now needs 9 or more
    digits left after the code, the same rule Reference uses when it stores a number. Without it the mismatch guard could refuse the right phone.

## Not done in this slice (recorded, not dropped)

Notifications and realtime push for status changes (`blocked:BL-095 phase 2`), `proxy_unreachable` and `session_conflict` states (R4, R5), operator panel additions, the
`sent_24h` / `failed_24h` writer, proxy save and test, analytics, the connect popover (`blocked:BL-095 phase 3`), the per-device ingest filter (phase 4), the screens, the help
guide and Arabic copy (web), the real-phone run, and counsel's review of the notice text (decision D1: the wording is a draft).

## Groups of a personal number: intended differences (API and worker)

1. **A management API where Reference had none on the web** (mobile `api/app/groups*` only): `/v2/devices/:id/groups` with list, create, members, settings, picture, join requests,
   invite link, join by link and leave. Port additions TW-WAGRP-027 to 031. Same limits as Reference unless a decision says otherwise (subject 60, description 512).
2. **Own table `wa_device_groups`, per device**, instead of Reference's `wa_groups` (unique on the group id alone). The legacy tables stay and are kept filled one way
   (`wa_device_groups` -> `wa_groups`, `wa_group_members`) so the ordering code and the order notice keep working; the merchant's `group_code` is never overwritten.
3. **Every change is checked against the stored role BEFORE WhatsApp is called** (Reference learned "not admin" only from the error text), and a group the number left is read-only.
4. **The directory reacts to `groups.update`** (rename, restrictions) and to join requests; Reference listened to `groups.upsert` and participant changes only. The whole list is
   re-read at most once per `WA_GROUPS_SWEEP_HOURS` (default 6) per number, jittered, through the limiter (Reference re-read it on every list refresh and sync).
5. **Ban safety** (D11): per-number caps (20 operations a minute, 200 a day, 5 creates a day, 5 joins by link a day, 20 people per call) and a 10-minute cooldown after a refusal that
   looks like a limit signal. Joining by link is off unless the platform enables it.
6. **A participants call answers per number** (`ok`, `privacy_blocked`, `not_on_whatsapp`, `already_member`...) and partial success is a 200; Reference answered one boolean.
7. **No "delete a group"**: WhatsApp has none; leaving keeps the row read-only (D5). Removing every member and leaving is not offered.
8. **The group picture is not stored here**: it goes to WhatsApp, which re-encodes it; the list shows no picture until a profile-picture read exists (`picture_url` is empty).
9. **Notifications**: a join request and a removal reach people holding `wa.groups.manage` (in-app only by default); Reference's FCM push `is_group` flag is not a notification of this kind.

## Import of existing chats of a personal number: intended differences (TW-WAHIST)

1. **Reference has no history import** (`reference/app/node/classes/BaileysClientManager.js`: `syncFullHistory: false`, `shouldSyncHistoryMessage: () => false`; a `.backup.js` copy once set `true`). This is a port addition,
   opt-in and off by default; a number that does not opt in is built with exactly Reference's settings. `intended`, owner request (walkthrough item 26).
2. **Quiet, read, silent, no media, no consent**: the same rules as the Cloud API coexistence import (TW-WABA-046) and the mail backfill; see spec section 23.4.
3. **Imported people become contacts** (coexistence history creates none). Created quietly (no `contact.created`), counted against the plan's contact cap, never with consent. A group never makes one. `intended`.
4. **Plan gate and marker (2026-10-14):** `full` needs the plan feature `personal_history_full`; imported threads and messages are marked in the inbox; one realtime hint per run; coexistence history now also makes contacts quietly (TW-WAHIST-006 to 008). `intended`, owner decisions.
5. **Not verified:** a live WhatsApp account. The adapter is tested against a mocked library and the importer against a fake socket; see spec section 23.8. Open decisions are in the build plan.
