# Parity evidence: channel-facebook (FB)

Reference 1.7.0 vs branch `punya/punyafix`. Inventory: [inventory/channel-facebook.md](../inventory/channel-facebook.md). API reference:
[docs/api/channel-facebook.md](../../api/channel-facebook.md). Build order: [plan/punya-plan.md](../plan/punya-plan.md) (F1 to F6).

## Evidence so far

Automated only; no screen yet, so the Playwright twin run against the running Reference has not been done.

- `apps/api/test/unit/channel-facebook/page-rules.spec.ts` and `event-rules.spec.ts`: 25 tests, passing (login address and state, signature and handshake, thread keys, payload reading, keyword start, history reading).
- `apps/api/test/e2e/channel-facebook/facebook-pages.e2e.spec.ts` (11 scenarios: login start, callback, bad state, popup, pasted token, reconnect, refresh, fix inbound, disconnect, isolation, permissions) and `facebook-inbound.e2e.spec.ts` (17 scenarios: handshake, signature, fan-out to two organizations, DM, redelivery, race, reopen, media, automation order, taps, comments, backfill, reply). **Written, typechecked and linted, NOT RUN**: Docker Desktop's engine is down on this machine, so testcontainers cannot start Postgres. Run `pnpm --filter @crm/api exec vitest run --dir test/e2e/channel-facebook --testTimeout=120000` first when it is back.

## Status of each feature

| Feature          | Status       | Notes                                                                                                                                                                   |
| ---------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TW-FB-001        | partial      | `GET /facebook/pages` and `GET /facebook/config` exist; the hub screen is F5.                                                                                           |
| TW-FB-002        | backend-done | Login start, public callback with a sealed state, popup code, pasted Page token. Long-lived upgrade before listing Pages, fallback to the short token.                  |
| TW-FB-003        | backend-done | Upsert per (organization, Page), granted scopes and data-access expiry from `debug_token`, webhook subscription, backfill queued.                                       |
| TW-FB-004        | backend-done | Refresh, fix inbound (a refusal is a field), disconnect (threads stay).                                                                                                 |
| TW-FB-005        | backend-done | Hourly worker sweep (`PageHealthSweepService`); a send refused with code 190 also flags the Page.                                                                       |
| TW-FB-006        | backend-done | Handshake, signature against both secrets in constant time, accepts unsigned only when no secret is configured, fans out to every organization that connected the Page. |
| TW-FB-007        | partial      | Thread, contact, message, profile name and unread are done. Automation order is called through the `InboundHooks` shim (nothing consumes or replies yet).               |
| TW-FB-008        | partial      | A tap is routed to the flow hook before any message handling and never stored; the flow runtime itself is blocked (TW-FB-021).                                          |
| TW-FB-009        | backend-done | One thread per post and commenter, redelivery dropped before any Graph call, text fetched when missing, the Page's own comments ignored, no contact, no automation.     |
| TW-FB-010        | backend-done | Queue job `fb-backfill`: 25 threads x 25 messages, oldest first, same dedup as live, stores only.                                                                       |
| TW-FB-011        | backend-done | `FacebookSenderService.reply`: DM text, attachment then caption, public comment reply under the thread's latest comment. The inbox composer that calls it is TIB's.     |
| TW-FB-012 to 014 | pending      | F2.                                                                                                                                                                     |
| TW-FB-015        | pending      | F3.                                                                                                                                                                     |
| TW-FB-016 to 019 | pending      | F4.                                                                                                                                                                     |
| TW-FB-020        | blocked      | Needs an AI provider (ai-keys-usage-admin).                                                                                                                             |
| TW-FB-021        | blocked      | Needs the flow runtime and Node bridge.                                                                                                                                 |
| TW-FB-022        | partial      | Permission keys `fb.*` added (`20261015090000_fb_permissions.sql`). The plan flags are a shim (see below).                                                              |
| TW-FB-023        | blocked      | Belongs to whoever owns the social calendar; the data (`facebook_posts`) is ready.                                                                                      |

## Intended differences from Reference

| #   | Area                 | Reference                                                                   | Here                                                                                                                                                                                                      |
| --- | -------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Access               | Workspace role plus plan flags                                           | Permission keys `fb.pages.read`, `fb.pages.manage`, `fb.broadcasts.*`, `fb.setup.manage`, `fb.posts.*`, `fb.insights.read`.                                                                               |
| 2   | Login round trip     | PHP session CSRF token as `state`; `/facebook/connect` is a GET redirect | `POST /facebook/connect/start` returns the address; `state` is a sealed value naming organization and user, good for 15 minutes; the callback is public and redirects to the hub with `fb` and `message`. |
| 3   | Webhook address      | `/webhooks/facebook`                                                     | `/v2/facebook/webhook`. The address in the Meta app must be changed once.                                                                                                                                 |
| 4   | Meta app settings    | `SystemSetting` keys (`fb_app_id`, `waba_app_id` ...)                    | Environment: `FB_APP_ID` or `META_APP_ID`, `FB_APP_SECRET` or `WHATSAPP_APP_SECRET`, `FB_WEBHOOK_VERIFY_TOKEN` or `WHATSAPP_VERIFY_TOKEN`, `FB_CONFIG_ID`, `FB_GRAPH_VERSION`. Same fallback order.       |
| 5   | Ids                  | Numeric database ids in URLs                                             | Uuids.                                                                                                                                                                                                    |
| 6   | Backfill             | A hook after the response                                                | A queue job (`fb-backfill`).                                                                                                                                                                              |
| 7   | Token sweep          | Inline, once an hour per workspace, on Channels page load                | An hourly worker job over every organization that has a Page.                                                                                                                                             |
| 8   | Sender name          | Resolved before the contact is created                                   | The thread starts as "Facebook user" and is renamed right after (thread, contact name and picture); the end state is the same.                                                                            |
| 9   | Sender profile cache | Cached six hours                                                         | Not cached: it is fetched once when a thread is created, so a cache could only matter after a thread is deleted.                                                                                          |
| 10  | Backfill clock       | A history message moved the thread's times to its own time               | Times only move forward (`greatest`), so importing old history never drags a live thread's clock back.                                                                                                    |
| 11  | Disconnect           | The Page's broadcasts and posts stayed orphaned                          | The schema cascades: they go with the Page. Inbox threads stay.                                                                                                                                           |
| 12  | Message lookup       | JSON path scan joined to conversations                                   | An expression index (`20261015090200_fb_message_dedup_idx.sql`).                                                                                                                                          |

QUIRKS kept on purpose: a bad webhook signature is refused only when a secret is configured; `facebook_pages_limit` is never enforced; a
backfilled message still counts as unread; comment authors are not contacts.

## Stubbed inputs (shims)

| Shim                                | Real owner                                              | Effect now                                                                                                             |
| ----------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `FacebookPlanGate`                  | plans-subscriptions-trials (PLAN)                       | `access_facebook`, `facebook_posts`, the Page cap pass; the AI agent is allowed (Reference enforced `facebook_ai_agent`). |
| `InboxIngest` (`SqlInboxIngest`)    | team-inbox-conversations (TIB)                          | Writes `conversations`, `messages` and `contacts` directly; no live "message received" push.                           |
| `InboundHooks` (`NoInboundHooks`)   | flow-runtime-engine, TIB routing, AI agents, auto-reply | Nothing consumes a message and nothing replies; a tap reaches the hook and goes no further.                            |
| `MediaUrls` (`PublicOnlyMediaUrls`) | platform-settings-branding-storage                      | An outbound file is sent only when its address is already public.                                                      |

## Not verified

- The Graph client has not made a real call (no Meta app here): it is covered by the e2e through a fake only.
- The signature check is covered by unit tests with a real HMAC; the end to end door is in the e2e that has not run yet.
- The platform switch `facebook_enabled` has no equivalent yet (the platform settings domain owns it); every organization with a Page is served.
