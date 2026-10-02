# Parity evidence: channel-telegram (TG)

Reference 1.7.0 vs branch `punya/punyafix`. Inventory: [inventory/channel-telegram.md](../inventory/channel-telegram.md). API reference:
[docs/api/channel-telegram.md](../../api/channel-telegram.md). Build order: [plan/punya-plan.md](../plan/punya-plan.md) (T1 to T7).

Evidence so far is automated, no screen yet:

- `apps/api/test/e2e/channel-telegram/telegram-bots.e2e.spec.ts`: 11 scenarios (connect, re-paste, rejected token, webhook refused,
  fix inbound, pause, payment settings, disconnect, tenant isolation, permissions) against a real Postgres and a fake Telegram.
- `apps/api/test/unit/channel-telegram/bot-rules.spec.ts`: 5 tests (routing token, https webhook address, error clipping, token shape).

## Status of each feature

| Feature          | Status       | Notes                                                                                |
| ---------------- | ------------ | ------------------------------------------------------------------------------------ |
| TW-TG-001        | partial      | The list endpoint exists (`GET /telegram/bots`); the hub screen is T5.               |
| TW-TG-002        | backend-done | Connect by token, encrypted, re-paste updates, webhook registered, refusal keeps it. |
| TW-TG-007        | backend-done | Fix inbound, pause and resume, payment settings, disconnect. Screen is T5.           |
| TW-TG-019        | partial      | Permission keys added (`tg.*`). The plan flags are a shim (see below).               |
| TW-TG-003 to 006 | not started  | T2.                                                                                  |
| TW-TG-008, 009   | not started  | T3.                                                                                  |
| TW-TG-010 to 014 | not started  | T4.                                                                                  |
| TW-TG-015 to 017 | blocked      | Needs the Node bridge (T6).                                                          |
| TW-TG-018        | blocked      | Needs the flow runtime (T7).                                                         |

## Intended differences from Reference

| #   | Area            | Reference                                          | Here                                                                                                                       |
| --- | --------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | Access          | Workspace role plus plan flags                  | Permission keys `tg.bots.read`, `tg.bots.manage`, `tg.broadcasts.read`, `tg.broadcasts.manage`, `tg.accounts.manage`.      |
| 2   | Webhook secret  | Stored in plain text, hidden from serialization | Encrypted at rest like the bot token (the schema marks it encrypted).                                                      |
| 3   | Webhook address | `/api/telegram/inbound/{token}`                 | `/v2/telegram/inbound/{token}` (the API's versioned prefix). Existing webhooks must be re-registered once ("Fix inbound"). |
| 4   | Connect answer  | Redirect back with a flash message              | 201 with the bot and a `webhookError` field; a refused webhook is not an HTTP error.                                       |
| 5   | Ids             | Numeric database ids in URLs                    | Uuids.                                                                                                                     |

## Stubbed inputs (shims)

| Shim               | Real owner                        | Effect now                                                                                                 |
| ------------------ | --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `TelegramPlanGate` | plans-subscriptions-trials (PLAN) | `access_telegram`, `telegram_broadcasts` and the bot cap are not enforced (Reference never enforced the cap). |

## Not verified

- No real Telegram call was made (no bot token here): the Bot API client is covered by the e2e through a fake only.
- No screen exists yet, so the Playwright twin run against the running Reference has not been done for this feature.
