# Parity: WhatsApp Cloud API / WABA numbers (WABA)

Evidence is automated but **nothing has run against real Meta or Interakt**: every external call is asserted against a fake at the HTTP
edge. Unit: `apps/api/test/unit/whatsapp-cloud-api-waba/` (provider layer, rules, template event rules, settings overlay, health details,
template client), web `apps/web/src/features/whatsapp-cloud-api-waba/lib/embedded-signup.test.ts`. API e2e with real Postgres and Redis:
`apps/api/test/e2e/whatsapp-cloud-api-waba/waba-connect.e2e.spec.ts` (27; needs Docker, last run on the author's machine before the
settings overlay and health extras were added). The Playwright twin run against the running WaDesk (`wadesk-playwright-parity`) has **not** been done.
The first real-Meta run is `pnpm waba:smoke` (see `docs/wadesk-port/waba-interakt/REAL_META_RUNBOOK.md`).

## Status

| Feature                                                                                        | State                                                                                                                                         |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| WD-WABA-001 platform Meta app settings                                                         | built as the `whatsapp` settings group + admin page `/admin/settings/whatsapp`; saved values overlay the environment (15 s) in API and worker |
| WD-WABA-004 numbers list and actions                                                           | built (`/channels/whatsapp`)                                                                                                                  |
| WD-WABA-005, 009 Embedded Signup launcher                                                      | built, logic unit tested; popup never opened against Meta                                                                                     |
| WD-WABA-006, 007 manual connect, token check                                                   | built                                                                                                                                         |
| WD-WABA-010 coexistence                                                                        | launch button + flag built; chat-history sync (028) not built                                                                                 |
| WD-WABA-011..014 subscribe, register, inbound verify, fix inbound                              | built (API), Fix inbound / Register on the cards                                                                                              |
| WD-WABA-016..020 primary, disconnect, remove, token replace, renew                             | built                                                                                                                                         |
| WD-WABA-021, 022 health                                                                        | built: phone node, WABA node, token scopes, subscribed apps, template tally, derived issues; 023 to 028 built (below)                         |
| WD-WABA-029..033 webhook handshake, auth, routing, inbound extraction                          | built (API); inbound messages are acknowledged and logged until the inbox exists                                                              |
| Business profile edit                                                                          | built (card on the health page)                                                                                                               |
| WD-WABA-002, 003, 015 coexistence self-check, one-click field subscribe, live diagnostic panel | built (see below)                                                                                                                             |
| Device limit (`device_limit`)                                                                  | not built: no plans equivalent yet                                                                                                            |
| Pinnacle                                                                                       | not built                                                                                                                                     |

## Intended differences from WaDesk

| Where                                                           | WaDesk                                         | Here                                                                                                      | Reason                                                |
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

## Health-page extras and diagnostics (WD-WABA-002, 003, 015, 023 to 028, 044)

- Built: free-conversation tile (023, optional, from Meta analytics), verified-badge checklist (024, without the calling toggle: CALL owns it), business username with
  rules, suggestions and the status webhook (025, 026), QR codes (027), history re-sync button (028), the platform app's webhook-field check and one-click subscribe (002, 003, on
  the console WhatsApp settings page), the per-number live inbound check with a typed verdict and the own-app paste-in values (015), and business-app echoes (044).
- Evidence: `waba-extras.e2e.spec.ts` (10), `waba-coexistence.e2e.spec.ts` (echoes), unit `waba-extras-rules.spec.ts` and `waba-diagnostics.spec.ts`. Meta is faked at the HTTP edge;
  nothing ran against real Meta or Interakt.
- Deviations: the QR screen is new (WaDesk had the routes and no screen); echo files and places are described on the thread, not downloaded; the free-allowance constant is
  kept as WaDesk has it though Meta's pricing changed; the own-app panel reads `GET /v2/waba/webhook-config`.
- Not built, with the reason: 036 automation fan-out (needs the flow and auto-reply engines), 039 and 040 groups and 042 catalog orders and 043 hand-offs to forms, Pay and
  calling (other domains' tables and engines), 045 contact sync and 046 history import (need an import mode in the contacts module and in the inbox ingest: no flows or
  notifications on an imported address book, backdated messages with no unread), 047 Twilio inbound (needs the Twilio connection from WADEV), 053 button-click analytics sync
  (campaign and template columns belong to CAMP and TPL), 054 ads reuse (no ads client), 055 and 056 saved customers (commerce tables).

## Groups, hand-offs, coexistence imports, orders, click sync, saved customers (WD-WABA-039, 040, 042, 043, 045, 046, 053, 055, 056)

- Built: Groups webhooks mirrored into `waba_groups` (040); group messages on their own thread and per-participant delivery folded into one bubble (039); catalog carts as
  orders (042); form submissions and payment statuses handed to the outbox (043); the Business app's contacts synced quietly (045); chat history imported quietly (046);
  Meta template button clicks pulled daily onto campaigns (053); saved customers with the Customers screen (055, 056).
- Evidence: unit `waba-groups-handoff.spec.ts` (14); e2e `waba-coexistence.e2e.spec.ts` (8: echoes, groups, hand-offs, orders, history, contacts), `waba-click-sync.e2e.spec.ts` (2) and `waba-customers.e2e.spec.ts` (5), a real Postgres and Redis with Meta faked at the HTTP edge. Nothing ran against real Meta; no Playwright twin run.
- Deviations: a group thread is keyed `g:<group id>` and never gets a contact (WaDesk used `raw_jid` and no contact too, but kept the group id as a phone-like key);
  Meta's retry of an order is one order (WaDesk could double it); saved-customer **delete keeps the orders** (WaDesk deleted every order of that phone, a destructive quirk);
  the customer list pages by offset with a total; history media and echo media are described on the thread, not downloaded; a synced contact stores the source
  `whatsapp_business_app` instead of WaDesk's free-text note.
- Not built, with the reason: 036 automation fan-out (the flow runtime's inbound hook, branch `vishal/FLR`), 047 Twilio inbound (the Twilio connection and its inbox
  channel kind belong to WADEV), 054 ads reuse (MADS is the consumer), the calling toggle of 024 (waits for the calling API, branch `vishal/CALL`), and the buyer
  acknowledgement and pay link of 042 (CHK listens to `whatsapp.order.received`).
