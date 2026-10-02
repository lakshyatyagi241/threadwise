# Punya's port plan (flow order)

Branch `punya/punyafix`, PR into `main`, reviewer Lakshya (see the root README). Each step is one commit, pushed, with the
PR description refreshed. A step is done when its tests pass, lint, typecheck and the architecture check are clean, and
`parity/<domain>.md` and `docs/api/<domain>.md` are updated. Work continues down the list without asking; stop only for a
decision that belongs to another domain or to the product owner, and record it in the parity file.

## BCAST (broadcasts), in dependency order

Done: 009, 010, 011 (partly), 012, 013 (stub), 014, 015, 016, 017, 025, 026, 027 (core).

| #   | Step                                            | TW ids                | Why this order                                                                   |
| --- | ----------------------------------------------- | --------------------- | -------------------------------------------------------------------------------- |
| B1  | Read API: list, detail, live stats (DONE)       | 001, 002, 030-036     | Everything on screen reads these; the web cannot start without them              |
| B2  | Retry, delete, CSV export (DONE)                | 037, 038, 039, 040    | Completes the operator actions the detail page offers                            |
| B3  | Link tracking and click analytics (DONE)        | 018, 042              | Wraps URL buttons at build time (017) and counts clicks; needs a public redirect |
| B4  | Pacing, batching, daily cap, pause (DONE)       | 022 (021 is done)     | Safe sending: the worker loop becomes paced instead of back to back              |
| B5  | Receipts and status webhooks (DONE)             | 024, 027 (webhooks)   | Delivered and read states: uses the state machine already in place               |
| B6  | Events: outbound webhooks, notifications (DONE) | 029                   | Emits from the state changes built above                                         |
| B7  | Inbox mirroring (DONE)                          | 028                   | Needs the inbox domain; shim behind an interface if it is not there              |
| B8  | Web: list (DONE), detail (DONE), compose (DONE) | 001, 003-008, 030-034 | UI over the API, same screens as the reference (PORTING_RULES section 3)         |
| B9  | Playwright twin run, parity evidence            | all                   | Compare every screen with the running Reference, fix differences, record the stamp  |
| B10 | Instagram reply-only                            | 019                   | Smaller variant. 020 (SMS runner) is skipped: channel-sms is on the ignore list  |

## CAMP (campaigns, Reference wa-campaigns)

Inventory written 2026-10-02: `docs/threadwise-port/inventory/campaigns.md` (TW-CAMP-001 to 028). Parity: `docs/threadwise-port/parity/campaigns.md`.

| Step | What                                                                                | Features                    |
| ---- | ----------------------------------------------------------------------------------- | --------------------------- |
| C1   | Inventory, create, edit, list, detail, builder, recipients (DONE)                   | 001-010, 019                |
| C2   | Cancel, resume, send now, resend, delete, export; the sender and the sweeper (DONE) | 011-018, 020, 023           |
| C3   | Node callbacks, provider receipts, replies, opt-outs (DONE)                         | 021, 022                    |
| C4   | Web: list, builder (create and edit), detail                                        | 001, 002, 003, 010, 016-020 |
| C5   | Webhook and bell mappers for `campaign.*`; segments and engagement tabs             | 019, 024                    |
| C6   | Flow campaigns, build with AI, Meta click sync (BLOCKED: other domains)             | 025, 026, 027               |

## Channels and ECOM

facebook, instagram, telegram, shopify-woocommerce: each is `pending` too (tiktok, line, wechat, viber, sms, email are ignored on the user's word, 2026-10-02). For each:
write the inventory from the reference, then connect flow, webhook in, send out, inbox wiring, web settings screen, parity.
Order: telegram, facebook, instagram, then shopify-woocommerce.

## Rules that never relax

- No feature lost or changed; same UI rebuilt on our stack (PORTING_RULES.md).
- Anything that depends on another domain goes behind an interface in `_shims/`, listed in the parity file.
- One branch, always pushed, one PR with Lakshya as reviewer.
- No sub-agent swarms.

## TG (channel-telegram)

Inventory written 2026-10-02: `docs/threadwise-port/inventory/channel-telegram.md` (TW-TG-001 to 019). Build order, one commit and push per step:

| Step | What                                                        | Features           |
| ---- | ----------------------------------------------------------- | ------------------ |
| T1   | Bots: connect by token, manage, plan gates, hub API (DONE)  | 002, 007, 019, 001 |
| T2   | Inbound webhook, inbox ingest (shim), taps, payments (DONE) | 003, 004, 005, 006 |
| T3   | Sender: reply through the bot, template keyboard (DONE)     | 008, 009           |
| T4   | Audience and broadcasts API with a BullMQ sender (DONE)     | 010, 011-014       |
| T5   | Web: hub, broadcast list and compose (DONE)                 | 001, 011, 012      |
| T6   | MTProto account and @BotFather (BLOCKED: Node bridge)       | 015-017            |
| T7   | Flow hand-off and the two Node callbacks (BLOCKED: shim)    | 018                |

## FB (channel-facebook)

Inventory written 2026-10-02: `docs/threadwise-port/inventory/channel-facebook.md` (TW-FB-001 to 023). Parity: `docs/threadwise-port/parity/channel-facebook.md`. Build order, one commit and push per step:

| Step | What                                                                                                              | Features           |
| ---- | ----------------------------------------------------------------------------------------------------------------- | ------------------ |
| F1   | Pages: connect (login, popup, token), manage, webhook in, inbox ingest, backfill, reply, health sweep (DONE)      | 001-006, 007-011   |
| F2   | Messenger broadcasts: audience, compose, BullMQ sender, start, pause, retry, delete (DONE)                        | 012, 013, 014      |
| F3   | Messenger setup: Get Started, greeting, persistent menu, ice breakers (DONE)                                      | 015                |
| F4   | Posts: composer, schedule, list, publish now, delete, my posts, insights (DONE; uploads blocked on storage)       | 016, 017, 018, 019 |
| F5   | Web: hub, broadcasts, setup, posts, composer, my posts, insights (DONE; not yet compared with the running Reference) | 001, 012-019       |
| F6   | AI composer tools, flow hand-off and node callbacks, social calendar (BLOCKED: AI provider, flow runtime, owner)  | 020, 021, 023      |

## IG (channel-instagram)

Inventory written 2026-10-02: `docs/threadwise-port/inventory/channel-instagram.md` (TW-IG-001 to 020). The channel is the Instaflow bridge; the native add-on is not in the reference (020, blocked). Build order, one commit and push per step:

| Step | What                                                                          | Features                  |
| ---- | ----------------------------------------------------------------------------- | ------------------------- |
| I1   | Permissions, bridge port and client, accounts: available, link, unlink (DONE) | 016, 003, 004, 005, 006   |
| I2   | Inbound push, ingest (shim), pull job (DONE)                                  | 007, 008, 009             |
| I3   | Reply sender, flows list and run (DONE)                                       | 010, 011 (no caller), 012 |
| I4   | Composer recipients and reply-only broadcast (DONE)                           | 013, 014                  |
| I5   | Web: hub, add dialog, reply-only compose (DONE)                               | 001, 002, 013, 014, 015   |
| I6   | Auto-reply hook, flow import and push, templates (BLOCKED: others)            | 017, 018, 019, 020        |

## ECOM (shopify-woocommerce)

Inventory written 2026-10-03: `docs/threadwise-port/inventory/shopify-woocommerce.md` (TW-ECOM-001 to 038). The data model is in `20261001101800_ecom_threadwise_schema.sql`; `wa_products` and `wa_orders` already carry the store ids. Build order, one commit and push per step:

| Step | What                                                                                                                                                                                                                                                                                                                 | Features                                    |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| E1   | Permissions, platform settings, Shopify OAuth, WooCommerce connect and test, webhook register and teardown (DONE)                                                                                                                                                                                                    | 001, 002, 003, 005, 006, 007, 025, 026, 013 |
| E2   | Import into the mirror (both), keep it in step, sync now (DONE)                                                                                                                                                                                                                                                      | 011, 012, 013                               |
| E3   | Webhook receivers (both), automations config, event message, logs (E3 DONE: receivers, event message, logs, mirror upkeep, automations API)                                                                                                                                                                          | 008, 009, 010, 027, 028, 029, 033           |
| E4   | Offers, win-back, COD and prepaid, delivered, stock, cart recovery, GDPR, uninstall, concierge, inbound service (E4a delivered, uninstall, GDPR DONE; E4b COD, prepaid, risk DONE; E4c back in stock DONE; E4d cart recovery DONE; E4e offer and win-back DONE; E4f concierge and inbound entry point DONE; E4 DONE) | 014 to 022, 030, 031, 034                   |
| E5   | Web: Shopify and WooCommerce store screens                                                                                                                                                                                                                                                                           | 004, 023, 024                               |
| E6   | Plugin download, invoices, flow links and resume, embedded session (BLOCKED: decisions and other domains)                                                                                                                                                                                                            | 032, 035, 036, 037, 038                     |
