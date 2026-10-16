# Wiring map: channel-telegram (TG)

Generated from the controllers, repositories and web routes on branch `punya/punyafix`; the shim notes are hand-written. Update it in the same change as any new route, table, queue or consumer.

## API routes

| Method | Path                                  | Permission             |
| ------ | ------------------------------------- | ---------------------- |
| GET    | `/v2/telegram/bots`                   | `tg.bots.read`         |
| POST   | `/v2/telegram/bots`                   | `tg.bots.manage`       |
| POST   | `/v2/telegram/bots/:id/retry-webhook` | `tg.bots.manage`       |
| POST   | `/v2/telegram/bots/:id/toggle`        | `tg.bots.manage`       |
| PUT    | `/v2/telegram/bots/:id/payments`      | `tg.bots.manage`       |
| DELETE | `/v2/telegram/bots/:id`               | `tg.bots.manage`       |
| GET    | `/v2/telegram/bots/:id/chats`         | `tg.broadcasts.read`   |
| GET    | `/v2/telegram/broadcasts/compose`     | `tg.broadcasts.read`   |
| GET    | `/v2/telegram/broadcasts`             | `tg.broadcasts.read`   |
| POST   | `/v2/telegram/broadcasts`             | `tg.broadcasts.manage` |
| POST   | `/v2/telegram/broadcasts/:id/start`   | `tg.broadcasts.manage` |
| POST   | `/v2/telegram/broadcasts/:id/pause`   | `tg.broadcasts.manage` |
| POST   | `/v2/telegram/broadcasts/:id/retry`   | `tg.broadcasts.manage` |
| DELETE | `/v2/telegram/broadcasts/:id`         | `tg.broadcasts.manage` |
| POST   | `/v2/telegram/inbound/:token`         | public                 |

## Web screens

- `/telegram/broadcasts/create`
- `/telegram/broadcasts`
- `/telegram`

## Tables read or written

`channels`, `contacts`, `conversations`, `messages`, `picked`, `telegram_bots`, `telegram_broadcast_recipients`, `telegram_broadcasts`, `tg_bot_lookup`, `wa_templates`

## Queues and workers

`TG_BROADCAST`

## Outbox events emitted

`telegram.bot.connected`, `telegram.bot.disconnected`, `telegram.broadcast.created`, `telegram.broadcast.deleted`, `telegram.broadcast.paused`, `telegram.broadcast.retry_requested`, `telegram.broadcast.started`

## Shims, owners and blocked consumers

- `OpenTelegramPlanGate`: no Telegram keys in the plan catalogue (only the numeric cap).
- `NoInboundHooks`: unused now. Flows run from the inbox's inbound hooks (`FlowInboundService` in the flow runtime worker) on every stored Telegram message, because the bot is a `telegram` channel; routing and auto-reply are still absent.
- `StorageMediaStore`: real (workspace object storage); local disk saves nothing. `ChatInboxIngest`: real, over chat-conversations.

## Quiet hours (BL-191, product extension)

Not in Reference. `TgBroadcastSenderService` asks `SendWindowService` (compliance-center) through `splitByQuietHours` for each claimed batch: the broadcast is always marketing, so there is no purpose to read. A recipient whose contact (the conversation's `contact_id`; none means the workspace fallback clock) is inside the workspace's quiet hours goes back to `pending` with `telegram_broadcast_recipients.held_until` / `held_reason` (`holdRecipient`); `claim` skips it until then; the rest of the audience is sent. When only held recipients are left the run ends, the broadcast stays `sending`, and `scheduleWake` queues a delayed job on `tg-broadcast` (job id `<uuid>-held-<opening>`, so one per opening). Every chat, held or not, is checked with the ConsentGate (see below). The list carries `held` and `heldUntil` (`heldSummaries`), shown under the counts with `compliance-center.hold.*`. Pausing a held broadcast makes the wake-up a no-op. Migration `20261225090000`. Spec: privacy-and-data-governance.md 11.5.

## Consent on the first send (BL-141 follow-up, product extension)

Not in Reference. Every claimed batch of Telegram chats is put through the ConsentGate before anything is sent, on the first send and on a release from the quiet hours alike: `gateRecipients(gate, orgId, batch, 'telegram')` in `contact-consent/consent-gate.recipients.ts` (marketing purpose, consent channel `telegram`, one `checkMany` for the slice; a recipient with no contact is asked as an anonymous subject). The rule is the gate's own: a withdrawal (the roll-up flag, or STOP on any channel) always refuses; with the workspace switch "Require recorded consent for marketing sends" OFF (the default) nobody else is refused; with it ON a recorded grant on `telegram` is needed, so a recipient with no contact is refused too; a flagged minor is refused by the workspace's children setting (`subject_minor`); the Do-Not-Call list does not apply to this channel. Service and utility messages are never asked here: a broadcast is marketing by nature, and a reply typed in the inbox goes through the dispatcher (service purpose, never blocked by a marketing STOP). A refused chat is recorded `blocked` with `error = 'Not messaged: consent (<reason>)'` (`consentSkipNote`; the reason is the gate's closed-set code), counted in the broadcast's `blocked` and shown in the list counts; a retry keeps `blocked` rows blocked (a STOP is still a STOP) and the next Start asks the gate again for whoever is `pending`. The gate is asked BEFORE the quiet hours: a refused recipient is never merely held. There is no migration: `telegram` was already a consent channel (`consentChannelOfKind`) and the ledger's channel column is a free pattern check. Allow-list: none needed (the sender names `ConsentGate`); the guard test now also proves it calls `gateRecipients` for every recipient. Tests: `test/unit/contact-consent/consent-gate-recipients.spec.ts` (truth table per channel), `test/e2e/channel-telegram/telegram-broadcasts.e2e.spec.ts` (BL-141 block)`.
