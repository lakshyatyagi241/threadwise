# Parity evidence: channel-telegram (TG)

WaDesk 1.7.0 vs branch `punya/punyafix`. Inventory: [inventory/channel-telegram.md](../inventory/channel-telegram.md). API reference:
[docs/api/channel-telegram.md](../../api/channel-telegram.md). Build order: [plan/punya-plan.md](../plan/punya-plan.md) (T1 to T7).

Evidence so far is automated, no screen yet:

- `apps/api/test/e2e/channel-telegram/telegram-bots.e2e.spec.ts`: 11 scenarios (connect, re-paste, rejected token, webhook refused,
  fix inbound, pause, payment settings, disconnect, tenant isolation, permissions) against a real Postgres and a fake Telegram.
- `apps/api/test/e2e/channel-telegram/telegram-inbound.e2e.spec.ts`: 11 scenarios for the webhook (secret and unknown token, quiet kinds, first message, same thread and contact, reopen, two at once, group and channel post, photo, automation order, taps, payments, isolation).
- `apps/api/test/unit/channel-telegram/bot-rules.spec.ts` and `update-rules.spec.ts`: 18 tests (routing token, https address, error clipping, token shape, update kinds, media and text extraction, titles, payments).

## Status of each feature

| Feature          | Status       | Notes                                                                                                                       |
| ---------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| WD-TG-001        | partial      | The list endpoint exists (`GET /telegram/bots`); the hub screen is T5.                                                      |
| WD-TG-002        | backend-done | Connect by token, encrypted, re-paste updates, webhook registered, refusal keeps it.                                        |
| WD-TG-007        | backend-done | Fix inbound, pause and resume, payment settings, disconnect. Screen is T5.                                                  |
| WD-TG-019        | partial      | Permission keys added (`tg.*`). The plan flags are a shim (see below).                                                      |
| WD-TG-003        | backend-done | Public webhook, routing token, secret header, always 200, flood limit, tenant by a narrow lookup function.                  |
| WD-TG-004        | partial      | Thread, contact, message and unread are done. Media is not downloaded (no storage upload yet) and automation is a stand-in. |
| WD-TG-005        | backend-done | Taps answered; `tqr:` taps replayed as typed messages.                                                                      |
| WD-TG-006        | backend-done | Pre-checkout approved first; payment recorded as its own row; resume hook called.                                           |
| WD-TG-008, 009   | not started  | T3.                                                                                                                         |
| WD-TG-010 to 014 | not started  | T4.                                                                                                                         |
| WD-TG-015 to 017 | blocked      | Needs the Node bridge (T6).                                                                                                 |
| WD-TG-018        | blocked      | Needs the flow runtime (T7).                                                                                                |

## Intended differences from WaDesk

| #   | Area                 | WaDesk                                                 | Here                                                                                                                       |
| --- | -------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | Access               | Workspace role plus plan flags                         | Permission keys `tg.bots.read`, `tg.bots.manage`, `tg.broadcasts.read`, `tg.broadcasts.manage`, `tg.accounts.manage`.      |
| 2   | Webhook secret       | Stored in plain text, hidden from serialization        | Encrypted at rest like the bot token (the schema marks it encrypted).                                                      |
| 3   | Webhook address      | `/api/telegram/inbound/{token}`                        | `/v2/telegram/inbound/{token}` (the API's versioned prefix). Existing webhooks must be re-registered once ("Fix inbound"). |
| 4   | Connect answer       | Redirect back with a flash message                     | 201 with the bot and a `webhookError` field; a refused webhook is not an HTTP error.                                       |
| 6   | Webhook secret check | Compared in constant time only when a secret is stored | Same, and the bot always has one (a fresh secret is made on every connect).                                                |
| 7   | Inbound contact      | `forSocialSender` on the contact model                 | One insert-or-update keyed by (organization, channel, channel user id), name filled only when empty.                       |
| 5   | Ids                  | Numeric database ids in URLs                           | Uuids.                                                                                                                     |

## Stubbed inputs (shims)

| Shim                              | Real owner                                              | Effect now                                                                                                 |
| --------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `TelegramPlanGate`                | plans-subscriptions-trials (PLAN)                       | `access_telegram`, `telegram_broadcasts` and the bot cap are not enforced (WaDesk never enforced the cap). |
| `InboxIngest` (`SqlInboxIngest`)  | team-inbox-conversations (TIB)                          | Writes `conversations`, `messages` and `contacts` directly; no live "message received" push.               |
| `MediaStore` (`NoMediaStore`)     | platform-settings-branding-storage                      | Files and avatars are not downloaded; blocked on a storage upload.                                         |
| `InboundHooks` (`NoInboundHooks`) | flow-runtime-engine, TIB routing, AI agents, auto-reply | Nothing consumes a message and nothing replies; payments do not resume flows.                              |

## Not verified

- The flood limit (120 a minute per token) is not covered by a test.
- No real Telegram call was made (no bot token here): the Bot API client is covered by the e2e through a fake only.
- No screen exists yet, so the Playwright twin run against the running WaDesk has not been done for this feature.
