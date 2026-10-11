# Parity evidence: channel-sms (SMS, send-only)

Reference 1.7.0. Inventory: [inventory/channel-sms.md](../inventory/channel-sms.md). Build plan: [plan/channel-sms-build.md](../plan/channel-sms-build.md).
API reference: [docs/api/channel-sms.md](../../api/channel-sms.md). Owner decision: SMS is send-only, TW-SMS-D01 to D08 are not built.

Evidence so far is automated and backend only (the web is built by another session; no Playwright parity run yet, and nothing was run
against a live Twilio or MSG91 account):

- `apps/api/test/unit/channel-sms/*.spec.ts`: both provider adapters against a scripted `fetch` (verify, send, Lookup, error translation, phone
  normalisation, never-throw, key scrubbing), Twilio's signature, status mapping and the three MSG91 report shapes, the connect rules, the
  segment calculator and the environment file.
- `apps/api/test/e2e/channel-sms/sms-senders.e2e.spec.ts`: connect, update, rejected keys, Twilio key reuse, MSG91 key normalisation, validation, device cap,
  list, toggle (row version), remove, lookup (cache, no Twilio sender), plan gate, permissions, tenant isolation, table invariants.
- `apps/api/test/e2e/channel-sms/sms-send.e2e.spec.ts`: the SMS composer, a broadcast sent through the real SMS engine (merge, ids, no pacing, failures,
  opt-out, 21610, refused key, send later, allowance), Twilio and MSG91 delivery reports (signature, forward-only, cross-tenant), a campaign.

## Status of each feature (backend)

| Feature           | Status       | Notes                                                                                                                                                                                                          |
| ----------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TW-SMS-001        | backend-done | `GET /sms/senders` (+ `platformEnabled`, report address). The hub screen is the web session's.                                                                                                                 |
| TW-SMS-002 to 005 | backend-done | Connect with verify first, upsert by From as typed, Twilio key reuse, MSG91 key in one place, DLT fields, device cap.                                                                                          |
| TW-SMS-006, 007   | backend-done | Toggle with row version; remove. Events `sms.sender.toggled` / `removed`.                                                                                                                                      |
| TW-SMS-008        | backend-done | `POST /sms/lookup`, per-workspace cache, Twilio sender only.                                                                                                                                                   |
| TW-SMS-009        | backend-done | `measureSms` in contracts (UTF-16 units). The composer counters are the web session's.                                                                                                                         |
| TW-SMS-010 to 013 | backend-done | `SmsGateway` port, Twilio and MSG91 adapters, translation, never-throw.                                                                                                                                        |
| TW-SMS-014        | backend-done | Named variables render for SMS templates without a variable map; campaigns already resolve through their own map.                                                                                              |
| TW-SMS-015        | blocked      | The `sms` template channel: the composer reads `channel = 'sms'` rows, but the templates domain create path is WhatsApp-only (see open issues).                                                                |
| TW-SMS-016, 017   | backend-done | `?channel=sms` composer, plan gate, wallet exemption, the SMS engine sends the broadcast. Retry and sweeper are the shared ones.                                                                               |
| TW-SMS-018, 019   | backend-done | Campaign on `sms:<uuid>`: buttons dropped, plan gate, wallet exemption. The campaign wizard path (`wizard-run`) is not wired for SMS.                                                                          |
| TW-SMS-020        | backend-done | "Send later" is honoured (the shared due-broadcast sweep). Recurring campaigns use the shared campaign sweeper.                                                                                                |
| TW-SMS-021        | partial      | Shared retry and resume. Permanent failures (21610, invalid number) are still retried by the shared sweeper.                                                                                                   |
| TW-SMS-022, 023   | backend-done | `POST /sms/status[/:secret]`: signature or secret, forward-only, broadcast recipients too.                                                                                                                     |
| TW-SMS-024        | backend-done | Opt-out checked per recipient at send time; 21610 flags the contact.                                                                                                                                           |
| TW-SMS-025        | backend-done | Plan feature `sms` on every sender route; `sms_enabled` read from `platform_settings` and written from the operator console (`/admin/sms`, `PUT /v2/platform/sms`, super admin, audit `platform.sms_updated`). |
| TW-SMS-026        | backend-done | `sms_monthly`, atomic reserve per message, run-start check, usage meter.                                                                                                                                       |
| TW-SMS-027, 029   | blocked      | Per-message segments, cost and an outbound record: the plan decision is no new table. Rate and currency are stored on the sender.                                                                              |
| TW-SMS-028, 030   | partial      | Sender resolution and the pickers are done; the menu, More tile and Channels rows are the web session's.                                                                                                       |

## Intended differences from Reference

| #   | Area                    | Reference                                                                     | Here                                                                                                                                                                                             |
| --- | ----------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Segments                | An emoji counts as one unit; UCS-2 messages with emoji are under-counted.     | UTF-16 code units (what the carrier counts).                                                                                                                                                     |
| 2   | Named merge variables   | A saved named variable with no map reached the recipient empty.               | Resolved against the contact.                                                                                                                                                                    |
| 3   | Send later (broadcast)  | Sent at once whatever the schedule.                                           | Waits for its time.                                                                                                                                                                              |
| 4   | Delivery reports        | No signature, no ordering; broadcasts never updated.                          | Twilio signature or MSG91 per-sender secret; forward-only; broadcast and campaign recipients updated. `delivery_unknown` / `partially_delivered` are not delivery; `ndnc` counts as a rejection. |
| 5   | Quota                   | Checked once at the start of a run; could overshoot.                          | Checked at the start of a run and reserved atomically per message; a refused send gives its place back. Counted in the UTC month.                                                                |
| 6   | Wallet                  | A pay-per-message workspace with an empty wallet could not start an SMS send. | SMS never touches the wallet precheck.                                                                                                                                                           |
| 7   | Plan gate               | `access_sms` not checked on the broadcast and campaign routes.                | `sms` is required to create a broadcast or campaign on an SMS sender.                                                                                                                            |
| 8   | Lookup                  | One cache for every workspace and provider; the first sender of any provider. | Cache per workspace; first connected Twilio sender; at most 30 a minute per user.                                                                                                                |
| 9   | Lookup VoIP             | Only the exact type `voip`.                                                   | Also Twilio v2's `fixedVoip` and `nonFixedVoip`.                                                                                                                                                 |
| 10  | STOP at Twilio (21610)  | Recorded as a failure only; the contact was tried again every run.            | The contact is flagged `is_unsubscribed` (the plan's default; the owner may overrule).                                                                                                           |
| 11  | Refused key             | `bad_credentials` produced and read by nothing.                               | The sender is switched off with the reason (`lastError`).                                                                                                                                        |
| 12  | Opt-out on retry        | A retry did not re-check the flag.                                            | Checked on every send.                                                                                                                                                                           |
| 13  | Remove of an unknown id | Flash "removed".                                                              | 204 and no change (same effect).                                                                                                                                                                 |
| 14  | Pacing                  | None for SMS in Reference.                                                    | The shared dispatchers' human-like gaps are skipped for SMS so the rate matches Reference.                                                                                                       |
| 15  | Copy                    | "reconnect it on the devices page".                                           | "reconnect it on the SMS page" (our screen).                                                                                                                                                     |
| 16  | Device cap              | Counted this user's devices.                                                  | Counted for the workspace (devices plus `waba`, `twilio` and `sms` rows); the plan meter for `devices` still counts personal numbers only.                                                       |

## Not verified

Everything provider-side: Twilio and MSG91 were only exercised through scripted HTTP. MSG91's request and response shapes (flow route, plain route,
balance check, delivery-report fields and codes) come from its public documentation, as in Reference, and need a sandbox test before launch.
