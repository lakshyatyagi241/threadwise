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
