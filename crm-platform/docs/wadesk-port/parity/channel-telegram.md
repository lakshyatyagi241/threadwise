# Parity evidence: channel-telegram (TG)

WaDesk 1.7.0 vs branch `punya/punyafix`. Inventory: [inventory/channel-telegram.md](../inventory/channel-telegram.md). API reference:
[docs/api/channel-telegram.md](../../api/channel-telegram.md). Build order: [plan/punya-plan.md](../plan/punya-plan.md) (T1 to T7).

Evidence so far is automated, no screen yet:

- `apps/api/test/e2e/channel-telegram/telegram-bots.e2e.spec.ts`: 11 scenarios (connect, re-paste, rejected token, webhook refused,
  fix inbound, pause, payment settings, disconnect, tenant isolation, permissions) against a real Postgres and a fake Telegram.
- `apps/api/test/e2e/channel-telegram/telegram-inbound.e2e.spec.ts`: 11 scenarios for the webhook (secret and unknown token, quiet kinds, first message, same thread and contact, reopen, two at once, group and channel post, photo, automation order, taps, payments, isolation).
- `apps/api/test/e2e/channel-telegram/telegram-sender.e2e.spec.ts`: 8 scenarios (the bot in the thread key, disconnected and foreign bots, older key, refusal, keyboard, media by address, upload and unreachable).
- `apps/api/test/e2e/channel-telegram/telegram-broadcasts.e2e.spec.ts`: 12 scenarios (audience and types, draft freeze and forged ids, empty and no-recipient refusals, template, a 30-chat run with blocked and failed, file id reuse, paused bot, pause and second start without double sends, retry, list totals, delete, isolation, permissions).
- `apps/api/test/unit/channel-telegram/bot-rules.spec.ts`, `update-rules.spec.ts` and `sending.spec.ts`: 29 tests (routing token, https address, error clipping, token shape, update kinds, media and text extraction, titles, payments).

## Status of each feature

| Feature          | Status       | Notes                                                                                                                                                    |
| ---------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WD-TG-001        | partial      | The list endpoint exists (`GET /telegram/bots`); the hub screen is T5.                                                                                   |
| WD-TG-002        | backend-done | Connect by token, encrypted, re-paste updates, webhook registered, refusal keeps it.                                                                     |
| WD-TG-007        | screen-done  | Fix inbound, pause and resume, payment settings, disconnect, on each bot card.                                                                           |
| WD-TG-019        | partial      | Permission keys added (`tg.*`). The plan flags are a shim (see below).                                                                                   |
| WD-TG-003        | backend-done | Public webhook, routing token, secret header, always 200, flood limit, tenant by a narrow lookup function.                                               |
| WD-TG-004        | partial      | Thread, contact, message and unread are done. Media is not downloaded (no storage upload yet) and automation is a stand-in.                              |
| WD-TG-005        | backend-done | Taps answered; `tqr:` taps replayed as typed messages.                                                                                                   |
| WD-TG-006        | backend-done | Pre-checkout approved first; payment recorded as its own row; resume hook called.                                                                        |
| WD-TG-008        | backend-done | `TelegramSenderService.reply`: the thread's bot sends text, media (file id, address or upload), long captions follow up. The inbox composer is TIB's.    |
| WD-TG-009        | backend-done | Template buttons become the keyboard; phone buttons are appended to the text.                                                                            |
| WD-TG-010        | backend-done | `GET /telegram/bots/:id/chats`: the bot's threads, newest 500, type from recent messages. Picker is T5.                                                  |
| WD-TG-011        | backend-done | `GET /telegram/broadcasts`: 50 newest plus totals over all of them (WaDesk counted "Sending" over the 50 only). Screen is T5.                            |
| WD-TG-012        | partial      | Draft with a frozen recipient list, forged ids dropped, template body and buttons. File upload is blocked on storage; a public address works. Screen T5. |
| WD-TG-013        | backend-done | BullMQ job `tg-broadcast`: batches of 25, 50 ms apart, file id reused, blocked vs failed, counters recomputed, inbox mirror through the shim.            |
| WD-TG-014        | backend-done | Start, pause, retry failed (blocked stay), delete in any status. Events `telegram.broadcast.*`.                                                          |
| WD-TG-015 to 017 | blocked      | Needs the Node bridge (T6).                                                                                                                              |
| WD-TG-018        | blocked      | Needs the flow runtime (T7).                                                                                                                             |

## Intended differences from WaDesk

| #   | Area                 | WaDesk                                                 | Here                                                                                                                       |
| --- | -------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | Access               | Workspace role plus plan flags                         | Permission keys `tg.bots.read`, `tg.bots.manage`, `tg.broadcasts.read`, `tg.broadcasts.manage`, `tg.accounts.manage`.      |
| 2   | Webhook secret       | Stored in plain text, hidden from serialization        | Encrypted at rest like the bot token (the schema marks it encrypted).                                                      |
| 3   | Webhook address      | `/api/telegram/inbound/{token}`                        | `/v2/telegram/inbound/{token}` (the API's versioned prefix). Existing webhooks must be re-registered once ("Fix inbound"). |
| 4   | Connect answer       | Redirect back with a flash message                     | 201 with the bot and a `webhookError` field; a refused webhook is not an HTTP error.                                       |
| 6   | Webhook secret check | Compared in constant time only when a secret is stored | Same, and the bot always has one (a fresh secret is made on every connect).                                                |
| 7   | Inbound contact      | `forSocialSender` on the contact model                 | One insert-or-update keyed by (organization, channel, channel user id), name filled only when empty.                       |
| 8   | Send loop            | Driven by an open browser tab; closing it paused it    | A worker job (`tg-broadcast`); closing the page does not pause it. Pause is an explicit action.                            |
| 9   | Counters             | Incremented per row                                    | Recomputed from the recipient rows after each batch, so an interrupted batch cannot drift them.                            |
| 10  | Delete of a bot      | Its broadcasts stay and refuse to start                | The schema cascades: deleting a bot deletes its broadcasts and recipients.                                                 |
| 11  | Rate limit (429)     | Recipient failed                                       | Same: a 429 marks the chat failed so Retry picks it up; the 50 ms gap keeps the send well under Telegram's ceiling.        |
| 5   | Ids                  | Numeric database ids in URLs                           | Uuids.                                                                                                                     |

## Stubbed inputs (shims)

| Shim                                         | Real owner                                              | Effect now                                                                                                 |
| -------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `TelegramPlanGate`                           | plans-subscriptions-trials (PLAN)                       | `access_telegram`, `telegram_broadcasts` and the bot cap are not enforced (WaDesk never enforced the cap). |
| `InboxIngest` (`SqlInboxIngest`)             | team-inbox-conversations (TIB)                          | Writes `conversations`, `messages` and `contacts` directly; no live "message received" push.               |
| `MediaStore` (`NoMediaStore`)                | platform-settings-branding-storage                      | Files and avatars are not downloaded; blocked on a storage upload.                                         |
| `TelegramTemplates` (`SqlTelegramTemplates`) | message-templates                                       | Reads `wa_templates` rows whose channel is telegram directly.                                              |
| `InboundHooks` (`NoInboundHooks`)            | flow-runtime-engine, TIB routing, AI agents, auto-reply | Nothing consumes a message and nothing replies; payments do not resume flows.                              |

## Not verified

- The flood limit (120 a minute per token) is not covered by a test.
- No real Telegram call was made (no bot token here): the Bot API client is covered by the e2e through a fake only.
- No screen exists yet, so the Playwright twin run against the running WaDesk has not been done for this feature.

## Screens (T5)

`apps/web/src/features/channel-telegram`: hub `/telegram`, list `/telegram/broadcasts`, compose `/telegram/broadcasts/create`; nav entry
in the Channels group (the planned placeholder is removed); messages `messages/en/telegram.json`. `compose-model.test.ts` covers the
preview, template fill, button labels and the create rule.

Intended differences on the screens:

| #   | Area         | WaDesk                                                        | Here                                                                                                               |
| --- | ------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 12  | `{name}`     | Screen promises `{name}`; the sender only replaced `{{name}}` | The sender replaces `{name}` too, so what the screen promises is what is sent. Nothing WaDesk accepted is refused. |
| 13  | Sending row  | "Resume" re-runs the browser loop                             | "Pause": a worker sends, so the only thing left to do to a sending broadcast is stop it.                           |
| 14  | Attachment   | File picker (50 MB)                                           | A public address; uploading a file waits on the storage service (blocked, recorded).                               |
| 15  | Hub header   | Team inbox, Flows, Broadcasts                                 | Adds a "Telegram broadcasts" link, the only way into that list from the hub.                                       |
| 16  | Account card | Connect Account opens a QR and phone login                    | Shown disabled with the reason (T6, needs the Node bridge).                                                        |

Not verified: the side-by-side run against WaDesk (the dev sign-in is the user's), the 3-second polling while a broadcast is sending.
