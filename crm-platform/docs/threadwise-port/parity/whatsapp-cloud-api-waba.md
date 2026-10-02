# Parity: WhatsApp Cloud API / WABA numbers (WABA)

Evidence is automated but **nothing has run against real Meta or Interakt**: every external call is asserted against a fake at the HTTP
edge. Unit: `apps/api/test/unit/whatsapp-cloud-api-waba/` (provider layer, rules, template event rules, settings overlay, health details,
template client), web `apps/web/src/features/whatsapp-cloud-api-waba/lib/embedded-signup.test.ts`. API e2e with real Postgres and Redis:
`apps/api/test/e2e/whatsapp-cloud-api-waba/waba-connect.e2e.spec.ts` (27; needs Docker, last run on the author's machine before the
settings overlay and health extras were added). The Playwright twin run against the running Reference (`threadwise-playwright-parity`) has **not** been done.
The first real-Meta run is `pnpm waba:smoke` (see `docs/threadwise-port/waba-interakt/REAL_META_RUNBOOK.md`).

## Status

| Feature | State |
| --- | --- |
| TW-WABA-001 platform Meta app settings | built as the `whatsapp` settings group + admin page `/admin/settings/whatsapp`; saved values overlay the environment (15 s) in API and worker |
| TW-WABA-004 numbers list and actions | built (`/channels/whatsapp`) |
| TW-WABA-005, 009 Embedded Signup launcher | built, logic unit tested; popup never opened against Meta |
| TW-WABA-006, 007 manual connect, token check | built |
| TW-WABA-010 coexistence | launch button + flag built; chat-history sync (028) not built |
| TW-WABA-011..014 subscribe, register, inbound verify, fix inbound | built (API), Fix inbound / Register on the cards |
| TW-WABA-016..020 primary, disconnect, remove, token replace, renew | built |
| TW-WABA-021, 022 health | built: phone node, WABA node, token scopes, subscribed apps, template tally, derived issues; TW-WABA-023 free-conversation allowance, 024 verified-badge checklist and calling toggle, 025/026 business username, 027 QR codes **not built** |
| TW-WABA-029..033 webhook handshake, auth, routing, inbound extraction | built (API); inbound messages are acknowledged and logged until the inbox exists |
| Business profile edit | built (card on the health page) |
| TW-WABA-002, 003, 015 coexistence self-check, one-click field subscribe, live diagnostic panel | not built |
| Device limit (`device_limit`) | not built: no plans equivalent yet |
| Pinnacle | not built |

## Intended differences from Reference

| Where | Reference | Here | Reason |
| --- | --- | --- | --- |
| Same number in two workspaces | allowed | refused (`WABA_NUMBER_IN_USE`, partial unique index) | inbound routing by phone number id would be ambiguous |
| Webhook authentication | signature, with fallbacks | signature **or** the platform key in the callback URL (`?k=`), `requireSignature` closes the URL-key door | Interakt documents no signature |
| Verify token | stored, generated on first need | saved secret, else the env value, else derived from the credentials key | stable across instances with nothing to persist |
| Ids from the Embedded Signup popup | trusted | hints only, proven against the token's granular scopes (`WABA_ID_MISMATCH`) | a forged id must not attach someone else's WABA |
| Message origin check | any origin ending in `facebook.com` | `facebook.com` and its subdomains only | `evilfacebook.com` would pass the suffix check |
| Routes | Meta only | Interakt (default) or Meta per number | Shubham: use Interakt's tech-provider app |
| Submit and connect | one synchronous request with seven Graph calls | same, but no database transaction is held across any Graph call | pool starvation |
| Platform settings | `system_settings` keys | `whatsapp` group in the platform settings store, secrets encrypted and never returned | SET conventions |
| `waba_dispatch_v2_enabled`, `waba_verify_by_ownership` | present (dead / no UI) | dropped | no runtime reader |
| Enabled-engines card (Twilio, Unofficial/Baileys, Business API) | on the same page | not built | Baileys is out of scope; Twilio is another channel |
| Connected-WABAs count | per platform | same, counted across all workspaces with the platform store | |
| Role gating of buttons | admin only | server enforces `waba.numbers.*`; the screens do not hide buttons yet (no per-screen permission payload) | app-init payload does not exist yet |

## Inbox wiring (TW-WABA-034, 035, 037, 049)

- Each connected number is an inbox channel of kind `whatsapp_waba` (handle = the number's uuid, metered), created on its first message and by a one-minute pass in the
  worker that also marks the channel of a removed or disconnected number. The WABA domain keeps the credentials; the adapter reads them through
  `WabaConnectService.resolveConnection` when it sends or fetches a file.
- Inbound: `WabaInboxSink` (bound to `WABA_INBOUND_SINK`) maps the raw Meta message (text, file, location, reaction, button, contacts; anything else as `unsupported`)
  and hands it to the inbox ingest queue. A reply goes out through `MetaCloudProvider` (the guard and footer run once). Delivery reports the broadcasts do not claim become
  inbox receipts. Evidence: `waba-inbox.e2e.spec.ts` (6) through the real webhook door with Meta faked at the HTTP edge, and `waba-inbox.spec.ts` (unit).
- Deviations: a new channel kind `whatsapp_waba` beside Lakshya's skeleton `whatsapp_cloud` (which keeps credentials in the channel registry and stays non-live), because the
  numbers and their credentials already live in `wa_provider_configs`; outbound files are uploaded to Meta and sent by media id (the inbox store is not reachable from Meta).
- Not built: automation fan-out after the store (036), groups (039, 040), catalog orders (042), hand-offs to forms, Pay and calling (043), coexistence echoes, contact sync and
  history (044 to 046), wallet settlement once per delivery (WALLET), a hook that updates the channel the moment a number connects (the pass does it within a minute).
- Not verified: real Meta or Interakt; Playwright twin run.
