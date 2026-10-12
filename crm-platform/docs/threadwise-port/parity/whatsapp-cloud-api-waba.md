# Parity: WhatsApp Cloud API / WABA numbers (WABA)

Evidence is automated but **nothing has run against real Meta or Interakt**: every external call is asserted against a fake at the HTTP
edge. Unit: `apps/api/test/unit/whatsapp-cloud-api-waba/` (provider layer, rules, template event rules, settings overlay, health details,
template client), web `apps/web/src/features/whatsapp-cloud-api-waba/lib/embedded-signup.test.ts`. API e2e with real Postgres and Redis:
`apps/api/test/e2e/whatsapp-cloud-api-waba/waba-connect.e2e.spec.ts` (27; needs Docker, last run on the author's machine before the
settings overlay and health extras were added). The Playwright twin run against the running Reference (`threadwise-playwright-parity`) has **not** been done.
The first real-Meta run is `pnpm waba:smoke` (see `docs/threadwise-port/waba-interakt/REAL_META_RUNBOOK.md`).

## Status

| Feature                                                                                        | State                                                                                                                                         |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| TW-WABA-001 platform Meta app settings                                                         | built as the `whatsapp` settings group + admin page `/admin/settings/whatsapp`; saved values overlay the environment (15 s) in API and worker |
| TW-WABA-004 numbers list and actions                                                           | built (`/channels/whatsapp`)                                                                                                                  |
| TW-WABA-005, 009 Embedded Signup launcher                                                      | built, logic unit tested; popup never opened against Meta                                                                                     |
| TW-WABA-006, 007 manual connect, token check                                                   | built                                                                                                                                         |
| TW-WABA-010 coexistence                                                                        | launch button + flag built; chat-history sync (028) not built                                                                                 |
| TW-WABA-011..014 subscribe, register, inbound verify, fix inbound                              | built (API), Fix inbound / Register on the cards                                                                                              |
| TW-WABA-016..020 primary, disconnect, remove, token replace, renew                             | built                                                                                                                                         |
| TW-WABA-021, 022 health                                                                        | built: phone node, WABA node, token scopes, subscribed apps, template tally, derived issues; 023 to 028 built (below)                         |
| TW-WABA-029..033 webhook handshake, auth, routing, inbound extraction                          | built (API); inbound messages are acknowledged and logged until the inbox exists                                                              |
| Business profile edit                                                                          | built (card on the health page)                                                                                                               |
| TW-WABA-002, 003, 015 coexistence self-check, one-click field subscribe, live diagnostic panel | built (see below)                                                                                                                             |
| Device limit (`device_limit`)                                                                  | not built: no plans equivalent yet                                                                                                            |
| Pinnacle                                                                                       | not built                                                                                                                                     |

## Intended differences from Reference

| Where                                                           | Reference                                      | Here                                                                                                      | Reason                                                |
| --------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Same number in two workspaces                                   | allowed                                        | refused (`WABA_NUMBER_IN_USE`, partial unique index)                                                      | inbound routing by phone number id would be ambiguous |
| Webhook authentication                                          | signature, with fallbacks                      | signature **or** the platform key in the callback URL (`?k=`), `requireSignature` closes the URL-key door | Interakt documents no signature                       |
| Verify token                                                    | stored, generated on first need                | saved secret, else the env value, else derived from the credentials key                                   | stable across instances with nothing to persist       |
| Ids from the Embedded Signup popup                              | trusted                                        | hints only, proven against the token's granular scopes (`WABA_ID_MISMATCH`)                               | a forged id must not attach someone else's WABA       |
| Message origin check                                            | any origin ending in `facebook.com`            | `facebook.com` and its subdomains only                                                                    | `evilfacebook.com` would pass the suffix check        |
| Routes                                                          | Meta only                                      | Interakt (default) or Meta per number                                                                     | Shubham: use Interakt's tech-provider app             |
| Submit and connect                                              | one synchronous request with seven Graph calls | same, but no database transaction is held across any Graph call                                           | pool starvation                                       |
| Platform settings                                               | `system_settings` keys                         | `whatsapp` group in the platform settings store, secrets encrypted and never returned                     | SET conventions                                       |
| `waba_dispatch_v2_enabled`, `waba_verify_by_ownership`          | present (dead / no UI)                         | dropped                                                                                                   | no runtime reader                                     |
| Enabled-engines card (Twilio, Unofficial/Baileys, Business API) | on the same page                               | not built                                                                                                 | Baileys is out of scope; Twilio is another channel    |
| Connected-WABAs count                                           | per platform                                   | same, counted across all workspaces with the platform store                                               |                                                       |
| Role gating of buttons                                          | admin only                                     | server enforces `waba.numbers.*`; the screens do not hide buttons yet (no per-screen permission payload)  | app-init payload does not exist yet                   |

## Health-page extras and diagnostics (TW-WABA-002, 003, 015, 023 to 028, 044)

- Built: free-conversation tile (023, optional, from Meta analytics), verified-badge checklist and the calling card (024, the calling domain's switch), business username with
  rules, suggestions and the status webhook (025, 026), QR codes (027), history re-sync button (028), the platform app's webhook-field check and one-click subscribe (002, 003, on
  the console WhatsApp settings page), the per-number live inbound check with a typed verdict and the own-app paste-in values (015), and business-app echoes (044).
- Evidence: `waba-extras.e2e.spec.ts` (10), `waba-coexistence.e2e.spec.ts` (echoes), unit `waba-extras-rules.spec.ts` and `waba-diagnostics.spec.ts`. Meta is faked at the HTTP edge;
  nothing ran against real Meta or Interakt.
- Deviations: the QR screen is new (Reference had the routes and no screen); echo files and places are described on the thread, not downloaded; the free-allowance constant is
  kept as Reference has it though Meta's pricing changed; the own-app panel reads `GET /v2/waba/webhook-config`.
- Not built here: nothing of this group; the rows that are not built are listed at the end of the next section.

## Groups, hand-offs, coexistence imports, orders, click sync, saved customers (TW-WABA-039, 040, 042, 043, 045, 046, 053, 055, 056)

- Built: Groups webhooks mirrored into `waba_groups` (040); group messages on their own thread and per-participant delivery folded into one bubble (039); catalog carts as
  orders (042); form submissions and payment statuses handed to the outbox (043); the Business app's contacts synced quietly (045); chat history imported quietly (046);
  Meta template button clicks pulled daily onto campaigns (053); saved customers with the Customers screen (055, 056).
- Evidence: unit `waba-groups-handoff.spec.ts` (14); e2e `waba-coexistence.e2e.spec.ts` (8: echoes, groups, hand-offs, orders, history, contacts), `waba-click-sync.e2e.spec.ts` (2) and `waba-customers.e2e.spec.ts` (5), a real Postgres and Redis with Meta faked at the HTTP edge. Nothing ran against real Meta; no Playwright twin run.
- Deviations: a group thread is keyed `g:<group id>` and never gets a contact (Reference used `raw_jid` and no contact too, but kept the group id as a phone-like key);
  Meta's retry of an order is one order (Reference could double it); saved-customer **delete keeps the orders** (Reference deleted every order of that phone, a destructive quirk);
  the customer list pages by offset with a total; history media and echo media are described on the thread, not downloaded; a synced contact stores the source
  `whatsapp_business_app` instead of Reference's free-text note.
- Not built, with the reason: 047 Twilio inbound (the Twilio connection and its inbox
  channel kind belong to WADEV), 054 ads reuse (MADS is the consumer), the buyer
  acknowledgement and pay link of 042 (CHK listens to `whatsapp.order.received`).

## Groups management: blocked (WIRE-WABA-001 to 010, backlog BL-094, spec [waba-groups-management.md](../../specs/waba-groups-management.md))

- Built: only the receiving side (above). **Blocked, not ported**: the `/waba-groups` page (001), create (002), refresh (003), reset invite link (004), edit settings (005),
  join request approve and reject (006), remove participants (007), delete (008) and sending to a group from the inbox (009; guarded, see below). **Built (phase 0)**: the
  webhook-field check and one-click subscribe now cover the four Groups fields beside the four coexistence fields (010). Reference has no inventory entry for these (its WFL domain is not inventoried), hence `WIRE-WABA-*` ids.
- Found while reading Reference: settings (005) and remove participants (007) are routes with **no control on the page**; there is **no sync-all-groups** action (the list endpoint
  is only the eligibility probe); the join queue is fed only by the webhook; a suspended group is not blocked on send; there is no plan gate. Recorded as decisions D3, D4 and
  D10 in the spec (any addition becomes `intended` here once approved).
- Finding in our code, not a Reference difference: a reply on a group thread (`g:<id>`) is built by `metaRecipient()` (digits only) with `recipient_type: 'individual'`, so it either
  fails or can reach an unrelated number. **Phase 0 of BL-094 is built**: a `g:` thread is refused with `WABA_GROUP_SEND_UNAVAILABLE` (422, not retryable) before anything is stored,
  again in the send worker and in the Meta builders, and the inbox composer is switched off on a group thread with the line "Sending to WhatsApp groups is not available yet.
  Reply from the WhatsApp Business app." (en, ar). Sending stays `blocked` until phase 3.
- Nothing about groups ran against real Meta (no Official Business Account is available); the Meta facts in the spec are from a summary of its docs and need re-reading.

## Meta Groups management (BL-094 phases 1 and 2, built 2026-10-08)

Spec: [waba-groups-management.md](../../specs/waba-groups-management.md). Reference source: `WabaGroupsController`, `GroupClient`, `waba-groups/index.blade.php`.

Intended differences (each approved by the owner's answers of 2026-10-08, spec section 20):

- **Plan gate**: Reference had none; ours needs plan feature `waba_groups` (D1 override). Every route refuses reads too (422 `PLAN_FEATURE_LOCKED`).
- **Permissions** `waba.groups.read|create|manage|delete` instead of the workspace admin role (D2).
- **Edit settings and Members screens**: Reference has the routes but no control; ours builds both (D3). Members are read from Meta on demand and never stored.
- **Join request failures** show as a toast, not `alert()`; the create/reset/delete forms are modals and calls, not full-page POSTs; counts and numbers of people waiting are shown only with `waba.groups.manage`.
- **Idempotency-Key, rate budget (30 changes per minute per number), retry once on a transient failure** (not create, not remove); delete treats 131041 as done after a retry.
- **Refused routes**: a number on Interakt or a registry provider answers `WABA_GROUPS_PROVIDER_UNSUPPORTED` (Reference always called Meta directly).
- **Audit and outbox events** on every change (Reference logged none); the thread title follows a rename.
- Numbers pages ask no capacity figures (D9). Sending to a group and the suspended-group refusal (D8, D10) are phase 3, not built.

Not verified: everything about Meta. No Official Business Account exists to test with (BL-030); the client and the screens were exercised only against `test/support/fake-waba-groups-gateway.ts`. The 15 operator sentences and error codes are Reference's, not re-verified. The reference screen was not run side by side (threadwise-playwright-parity not run for this change). Not built: Socket.IO push and notifications for the group events (BL-099).
