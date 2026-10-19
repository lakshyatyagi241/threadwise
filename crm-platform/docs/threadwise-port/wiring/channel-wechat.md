# Wiring map: channel-wechat (WECH)

Hand-written from the controllers, repositories and web routes on branch `lakshya/channels/wechat`. Update it in the same change as any new route, table, queue or consumer.

## API routes

| Method | Path                                    | Permission                 |
| ------ | --------------------------------------- | -------------------------- |
| GET    | `/v2/wechat/channels`                   | `wechat.channels.read`     |
| POST   | `/v2/wechat/channels`                   | `wechat.channels.manage`   |
| GET    | `/v2/wechat/channels/:id/server-config` | `wechat.channels.manage`   |
| POST   | `/v2/wechat/channels/:id/recheck`       | `wechat.channels.manage`   |
| POST   | `/v2/wechat/channels/:id/toggle`        | `wechat.channels.manage`   |
| DELETE | `/v2/wechat/channels/:id`               | `wechat.channels.manage`   |
| GET    | `/v2/wechat/channels/:id/chats`         | `wechat.broadcasts.read`   |
| GET    | `/v2/wechat/broadcasts/compose`         | `wechat.broadcasts.read`   |
| GET    | `/v2/wechat/broadcasts`                 | `wechat.broadcasts.read`   |
| POST   | `/v2/wechat/broadcasts`                 | `wechat.broadcasts.manage` |
| POST   | `/v2/wechat/broadcasts/:id/start`       | `wechat.broadcasts.manage` |
| POST   | `/v2/wechat/broadcasts/:id/retry`       | `wechat.broadcasts.manage` |
| DELETE | `/v2/wechat/broadcasts/:id`             | `wechat.broadcasts.manage` |
| GET    | `/v2/wechat/inbound/:token`             | public (signature)         |
| POST   | `/v2/wechat/inbound/:token`             | public (signature)         |

All behind `@RequirePlanFeature('extra_channels')` except the two public routes.

## Web screens

- `/wechat` (hub, connect modal), Settings > Channels tile `wechat` (permission `wechat.channels.read`)
- `/wechat/broadcasts` (list), `/wechat/broadcasts/create` (compose)
- Campaigns > New broadcast chooser: the WeChat card (`features/broadcasts/api/channels.ts`, `lib/channel-cards.ts`)
- Help guide `wechat-channels` (documents `tile:wechat`)

## Tables read or written

`wechat_channels`, `wechat_broadcasts`, `wechat_broadcast_recipients`; `channels` (kind `wechat`, one per channel row, external id the row id), `conversations`, `messages`, `contacts` (channel `wechat`, channel uid = OpenID), `wa_templates` (channel `wechat`, read); `wech_channel_lookup()` (SECURITY DEFINER). `wechat_flow_sessions` was dropped by `20261216090000_drop_dormant_tables.sql` (Reference keeps these sessions in Node memory and never writes the table; flow state is `flow_runs`, TW-FLR-070 wontfix, TW-NODE-050; pending owner confirmation: punya).

## Queues and workers

`WECHAT_BROADCAST` (`wechat-broadcast`), processor `BroadcastProcessor` in `ChannelWechatWorkerModule` (imported by `WorkersModule` only). The webhook, the adapter and the token upkeep run in the API process and in the worker (the adapter is registered by `ChannelWechatModule`, which the worker module imports).

## Outbox events emitted

`wechat.channel.connected`, `wechat.channel.disconnected`, `wechat.broadcast.created`, `wechat.broadcast.started`, `wechat.broadcast.retry_requested`, `wechat.broadcast.deleted`

## Upstream feeders and consumers

- Feeds: WeChat (webhook, GET and POST); the Campaigns chooser reads `GET /wechat/channels` to show the card.
- Consumers: the team inbox (threads, replies through the adapter), contacts (contact per OpenID), the consent gate (`WECHAT_API` is a send primitive; the adapter runs behind `ChannelDispatcher`), the flow runtime and routing through the inbox's inbound listeners (generic by channel kind).
- Redis: `wechat_hits:<token>:<minute>` (flood limit), `wechat:token:<org>:<channel>` (access-token refresh lock).

## Shims, owners and blocked consumers

- BLOCKED `TW-WECH-017` custom menu builder, `TW-WECH-018` follower insights: Reference pages not built yet (outside the first channel port).
- BLOCKED `TW-WECH-019` Node flow bridge (`flow-send`, `flow-node`): depends on the flow runtime and the node bridge. Flow sessions need no table here (`wechat_flow_sessions` was dropped, see above).
- The inbox's template picker lists WhatsApp templates only: no inbox screen sends a WeChat template message yet (the adapter accepts one).
- Plan flags `access_wechat`, `wechat_broadcasts`, `wechat_channels_limit` and the platform switch `wechat_enabled` collapse into `extra_channels`; the cap and the switch are not enforced.

## Quiet hours (BL-191, product extension)

Not in Reference. A WeChat broadcast is ONE mass-send call to followers WeChat resolves, so it cannot be split per contact. `BroadcastSenderService.runLocked` asks `SendWindowService.check` on the workspace fallback clock (the zone chosen in Compliance center, else the workspace's): inside the quiet hours the broadcast stays `sending` with `wechat_broadcasts.held_until`, `scheduleWake` queues a delayed job on `wechat-broadcast`, and the run returns `held`. At the opening the call is made (the `clientmsgid` guard is untouched). A held broadcast is not "stuck": `staleSending` ignores it, so the Retry button does not appear and a retry cannot make a second mass send. The list row shows `heldUntil` with `compliance-center.hold.heldUntil`. Migration `20261225090000`.

## Consent on the send (BL-141 follow-up, product extension)

Not in Reference. `BroadcastSenderService.run` asks the ConsentGate (marketing purpose, consent channel `wechat`) before the one mass-send call, before the quiet-hours check (a refused person is never merely held), and again on every run, so a held broadcast is re-checked when it wakes.

- **Picked list.** The recipients are read with their thread's `contact_id` (`BroadcastsRepository.recipients`), put through `gateRecipients`, and whoever is refused is left out of the OpenID list and kept `status = 'blocked'` with `error = 'Not messaged: consent (<reason>)'` (`markBlocked`). The call carries only the rest; `markDone` marks only those `sent` and `sent` counts them (`total` stays the audience that was picked). A WeChat list send needs two OpenIDs, so with fewer than two left the broadcast fails with a short sentence naming the reasons (`last_error`, "Not sent: only N of M recipients can be messaged (consent: withdrawn 2, ...)") and no call is made; a retry asks the gate again.
- **All followers or a tag.** WeChat resolves these audiences itself, so a person cannot be left out of the call. The broadcast is therefore refused (`failed`, `last_error` names the reason and says "Send to a picked list instead") when (a) the gate refuses an anonymous subject, which is the case with the workspace switch ON (nobody the account has never met can have a recorded consent), or (b) the gate refuses any follower the account already knows as an inbox thread with a contact (`BroadcastsRepository.knownContactIds`; for a tag the check is against every known follower of the account, the stricter reading, because tag membership is not stored here). With the switch OFF and nobody known refused, the call goes as before.
- **Not done.** Expanding an all-followers or tag audience into an OpenID list through WeChat's follower-list API, so the refused could be left out instead of refusing the whole send, is a follow-up (`BL-243`).
- **Allow-list.** The KNOWN GAP entry for this file is gone from `consent-gate.allowlist.ts`; the guard test proves it calls `gateRecipients`. Tests: `test/unit/contact-consent/consent-gate-recipients.spec.ts`, `test/e2e/channel-wechat/wechat-broadcasts.e2e.spec.ts` (BL-141 block). `ChannelWechatModule` imports `ContactConsentModule`.
