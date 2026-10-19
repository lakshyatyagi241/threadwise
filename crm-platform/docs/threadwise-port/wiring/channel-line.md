# Wiring map: channel-line (LINE)

Written from the controllers, repositories and web routes on branch `lakshya/channels/line`; the shim notes are hand-written. Update it in the same change as any new route, table, queue or consumer.

## API routes

| Method | Path                                  | Permission                                  |
| ------ | ------------------------------------- | ------------------------------------------- |
| GET    | `/v2/line/channels`                   | `line.channels.read`                        |
| POST   | `/v2/line/channels`                   | `line.channels.manage`                      |
| POST   | `/v2/line/channels/:id/retry-webhook` | `line.channels.manage`                      |
| POST   | `/v2/line/channels/:id/toggle`        | `line.channels.manage`                      |
| PUT    | `/v2/line/channels/:id/rotation`      | `line.channels.manage`                      |
| DELETE | `/v2/line/channels/:id`               | `line.channels.manage`                      |
| GET    | `/v2/line/channels/:id/audience`      | `line.broadcasts.read`                      |
| GET    | `/v2/line/broadcasts/compose`         | `line.broadcasts.read`                      |
| GET    | `/v2/line/broadcasts`                 | `line.broadcasts.read`                      |
| POST   | `/v2/line/broadcasts`                 | `line.broadcasts.manage`                    |
| POST   | `/v2/line/broadcasts/:id/start`       | `line.broadcasts.manage`                    |
| POST   | `/v2/line/broadcasts/:id/pause`       | `line.broadcasts.manage`                    |
| POST   | `/v2/line/broadcasts/:id/retry`       | `line.broadcasts.manage`                    |
| DELETE | `/v2/line/broadcasts/:id`             | `line.broadcasts.manage`                    |
| POST   | `/v2/line/inbound/:token`             | public (`X-Line-Signature` on the raw body) |

All but the webhook are gated by the plan feature `extra_channels`.

## Web screens

- `/line` (hub: connect form, channels, token rotation, guide), Settings tile `line` in Channels
- `/line/broadcasts`
- `/line/broadcasts/create`
- Campaigns chooser card `line` (opens `/line/broadcasts`)

## Tables read or written

`line_channels`, `line_broadcasts`, `line_broadcast_recipients`, `line_rich_menus` (unused, blocked on TW-LINE-016, see below), plus `channels`, `contacts`, `conversations`, `messages`, `wa_templates` (channel `line`), `organizations` (no write). `line_channel_lookup` is the only function.

## Queues and workers

`LINE_BROADCAST` (`line-broadcast`): one job per started broadcast, processed by `LineBroadcastProcessor` in `ChannelLineWorkerModule` (imported only by `WorkersModule`). The `line` ChannelAdapter is registered by `ChannelLineModule` in both processes.

## Outbox events emitted

`line.channel.connected`, `line.channel.disconnected`, `line.broadcast.created`, `line.broadcast.started`, `line.broadcast.paused`, `line.broadcast.retry_requested`, `line.broadcast.deleted`

## Upstream feeders

- LINE pushes events to `/v2/line/inbound/:token` (signed with the channel secret).
- The team inbox calls the `line` adapter for every reply typed in a LINE thread.
- Message templates with `channel = line` feed the compose page.
- The ConsentGate answers per contact for every broadcast batch (see "Consent on the first send").

## Downstream consumers

- Team inbox (threads, contacts, outbound mirror of each broadcast send), contacts (one per LINE user id), Campaigns chooser (`features/broadcasts`), Settings hub tile, the Help center guide `line-channels`.
- Contact consent (the broadcast's audience), message log (outbound rows), audit log and outbox consumers.

## Shims, owners and blocked consumers

- `NoInboundHooks` (`INBOUND_HOOKS`): flow hand-off and routing, AI agent and keyword auto-reply are not bound yet; nothing consumes a message and nothing replies. Owners: flow-runtime-engine, team-inbox-routing-sla, ai-agents-training. Reference's two Node callbacks (`flow-log`, `flow-node`) wait on the same owners (TW-LINE-015, blocked). The `line_flow_sessions` table was dropped by `20261216090000_drop_dormant_tables.sql` (Reference keeps these sessions in Node memory and never writes it); flow state is `flow_runs`, one engine for every channel (TW-FLR-070 wontfix, TW-NODE-050). Pending owner confirmation: punya.
- `SqlLineTemplates` (`LINE_TEMPLATES`): reads `wa_templates` where the channel is line until message-templates exports a lookup.
- Plan flags `access_line`, `line_broadcasts` and `line_channels_limit` are folded into `extra_channels`; the channel cap is not enforced (Reference never did).
- Rich menus (`line_rich_menus`, TW-LINE-016) and insights (TW-LINE-017) are Reference features that are **blocked / not ported**; no control for them is shown.

## Quiet hours (BL-191, product extension)

Not in Reference. `LineBroadcastSenderService` asks `SendWindowService` (compliance-center) through `splitByQuietHours` for each claimed batch: the broadcast is always marketing, so there is no purpose to read. A recipient whose contact (the conversation's `contact_id`; none means the workspace fallback clock) is inside the workspace's quiet hours goes back to `pending` with `line_broadcast_recipients.held_until` / `held_reason` (`holdRecipient`); `claim` skips it until then; the rest of the audience is sent. When only held recipients are left the run ends, the broadcast stays `sending`, and `scheduleWake` queues a delayed job on `line-broadcast` (job id `<uuid>-held-<opening>`, so one per opening). The ConsentGate was already asked for every batch, so a released person is checked again. The list carries `held` and `heldUntil` (`heldSummaries`), shown under the counts with `compliance-center.hold.*`. Pausing a held broadcast makes the wake-up a no-op. Migration `20261225090000`. Spec: privacy-and-data-governance.md 11.5.

## Consent on the first send (BL-141 follow-up, product extension)

Not in Reference. Every claimed batch of LINE recipients is put through the ConsentGate before anything is sent, on the first send and on a release from the quiet hours alike: `gateRecipients(gate, orgId, batch, 'line')` in `contact-consent/consent-gate.recipients.ts` (marketing purpose, consent channel `line`, one `checkMany` for the slice; a recipient with no contact is asked as an anonymous subject). The rule is the gate's own: a withdrawal (the roll-up flag, or STOP on any channel) always refuses; with the workspace switch "Require recorded consent for marketing sends" OFF (the default) nobody else is refused; with it ON a recorded grant on `line` is needed, so a recipient with no contact is refused too; a flagged minor is refused by the workspace's children setting (`subject_minor`); the Do-Not-Call list does not apply to this channel. Service and utility messages are never asked here: a broadcast is marketing by nature, and a reply typed in the inbox goes through the dispatcher (service purpose, never blocked by a marketing STOP). LINE already asked the gate for every batch before this change; what is new is that a person with no contact is asked as an anonymous subject (refused with the switch on, allowed with it off) instead of being sent unchecked, and the code now uses the shared `gateRecipients`. A refused person is recorded `blocked` with `error = 'Not messaged: consent (<reason>)'`. The gate is asked BEFORE the quiet hours: a refused recipient is never merely held. There is no migration: `line` was already a consent channel (`consentChannelOfKind`) and the ledger's channel column is a free pattern check. Allow-list: none needed. Tests: `test/unit/contact-consent/consent-gate-recipients.spec.ts` (truth table per channel), `test/e2e/channel-line/line-quiet-hours.e2e.spec.ts` (BL-141 block) and `line-broadcasts.e2e.spec.ts`.
