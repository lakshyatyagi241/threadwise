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

Inventory is `pending`: first write the inventory from the reference (routes, tables, wiring), then follow the same order as BCAST:
create flow, sender, read API, actions, tracking, receipts, events, web, parity.

Reference surface (scoped 2026-10-02, nothing written yet):

- Routes: `routes/web.php` prefix `wa-campaigns` (index, create, store, edit, update, destroy, show, export, sample-csv, bulk-delete,
  cancel, resume, send-now, resend, AI model list and AI generate) and `routes/api.php` Node callbacks (`nodeCampaignStatus`,
  `nodeContactStatus`, `nodeStatusByMessageId`, `nodeTrackResponse`, `nodeUnsubscribe`, `nodeCampaignDrain`).
- Code: `app/Http/Controllers/WaCampaignsController.php` (5,881 lines), models `WpCampaign` and `WpCampaignContact`,
  `app/Services/CampaignScheduleSweeper.php`; webhook events `campaign_created`, `campaign_status_updated`,
  `campaign_contact_status_updated`, `campaign_contact_replied`, `contact_opt_in`.
- Screens: `resources/views/user/wa-campaigns/{index,create,edit,detail,_cards}.blade.php` and their scripts
  `user-wa-campaigns-{index,create,edit,detail}.js`. (`user/campaigns` and `meta-ads` are the separate Meta Ads product, not CAMP.)
- Shared with BCAST and reusable as is: the template picker and overrides panel, the sender and audience pickers, the link
  tracker, pacing, the receipt state machine, the webhook and bell mappers.
- Order: read the controller in slices (store and validation, audiences and CSV, A/B and AI, send and sweeper, callbacks, detail),
  writing one inventory entry per behavior, then the same build order as BCAST. This is a multi-session job; do it one slice per commit.

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

| Step | What                                                   | Features           |
| ---- | ------------------------------------------------------ | ------------------ |
| T1   | Bots: connect by token, manage, plan gates, hub API    | 002, 007, 019, 001 |
| T2   | Inbound webhook, inbox ingest (shim), taps, payments   | 003, 004, 005, 006 |
| T3   | Sender: reply through the bot, template keyboard       | 008, 009           |
| T4   | Audience and broadcasts API with a BullMQ sender       | 010, 011-014       |
| T5   | Web: hub, broadcast list and compose                   | 001, 011, 012      |
| T6   | MTProto account and @BotFather (needs the Node bridge) | 015-017            |
| T7   | Flow hand-off and the two Node callbacks (shim)        | 018                |
