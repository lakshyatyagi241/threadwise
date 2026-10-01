# Punya's port plan (flow order)

Branch `punya/punyafix`, PR into `main`, reviewer Lakshya (see the root README). Each step is one commit, pushed, with the
PR description refreshed. A step is done when its tests pass, lint, typecheck and the architecture check are clean, and
`parity/<domain>.md` and `docs/api/<domain>.md` are updated. Work continues down the list without asking; stop only for a
decision that belongs to another domain or to the product owner, and record it in the parity file.

## BCAST (broadcasts), in dependency order

Done: 009, 010, 011 (partly), 012, 013 (stub), 014, 015, 016, 017, 025, 026, 027 (core).

| #   | Step                                      | TW ids                | Why this order                                                                   |
| --- | ----------------------------------------- | --------------------- | -------------------------------------------------------------------------------- |
| B1  | Read API: list, detail, live stats (DONE) | 001, 002, 030-036     | Everything on screen reads these; the web cannot start without them              |
| B2  | Retry, delete, CSV export (DONE)          | 037, 038, 039, 040    | Completes the operator actions the detail page offers                            |
| B3  | Link tracking and click analytics (DONE)  | 018, 042              | Wraps URL buttons at build time (017) and counts clicks; needs a public redirect |
| B4  | Pacing, batching, daily cap, pause        | 022 (021 is done)     | Safe sending: the worker loop becomes paced instead of back to back              |
| B5  | Receipts and status webhooks              | 024, 027 (webhooks)   | Delivered and read states: uses the state machine already in place               |
| B6  | Events: outbound webhooks, notifications  | 029                   | Emits from the state changes built above                                         |
| B7  | Inbox mirroring                           | 028                   | Needs the inbox domain; shim behind an interface if it is not there              |
| B8  | Web: list, detail, compose                | 001, 003-008, 030-034 | UI over the API, same screens as the reference (PORTING_RULES section 3)         |
| B9  | Playwright twin run, parity evidence      | all                   | Compare every screen with the running Reference, fix differences, record the stamp  |
| B10 | Instagram reply-only and SMS runner       | 019, 020              | Smaller variants; SMS needs the SMS channel adapter                              |

## CAMP (campaigns, Reference wa-campaigns)

Inventory is `pending`: first write the inventory from the reference (routes, tables, wiring), then follow the same order as BCAST:
create flow, sender, read API, actions, tracking, receipts, events, web, parity.

## Channels and ECOM

facebook, instagram, telegram, tiktok, line, wechat, viber, sms, email, shopify-woocommerce: each is `pending` too. For each:
write the inventory from the reference, then connect flow, webhook in, send out, inbox wiring, web settings screen, parity.
Order by value: sms and email first (needed by broadcasts and campaigns), then telegram, facebook and instagram, then the rest.

## Rules that never relax

- No feature lost or changed; same UI rebuilt on our stack (PORTING_RULES.md).
- Anything that depends on another domain goes behind an interface in `_shims/`, listed in the parity file.
- One branch, always pushed, one PR with Lakshya as reviewer.
- No sub-agent swarms.
