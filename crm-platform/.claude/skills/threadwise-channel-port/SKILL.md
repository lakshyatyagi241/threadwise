---
name: threadwise-channel-port
description: >-
  Port a Reference messaging channel or provider integration (WhatsApp Cloud API,
  WhatsApp QR/Baileys bridge, Telegram, Facebook, Instagram, TikTok, LINE,
  WeChat, Viber, SMS, Email, payment/ecommerce providers) onto this repo's
  provider-port architecture. Use this whenever someone says "port the
  Telegram channel", "add WhatsApp Cloud", "the Baileys bridge", "connect
  channel X", "inbound webhook for Y", "send message through Z", "channel
  connect flow", "node bridge", or works on any TW feature whose source refs
  include a *Webhook controller, a Services/<Channel> directory or node/ files.
  It orders the work and names the decisions that need an ADR before code.
---

# Port a channel

Every channel is the same shape in Reference: connect (credentials or QR) → inbound webhook/poll → normalize → store in
the inbox → outbound send → delivery status → templates/broadcasts/flow nodes/insights. This repo has the rules, but
**the channel plumbing itself mostly does not exist yet** (target-map §7): a `WhatsAppProvider` port with a Meta adapter
whose send methods throw, no `channels` table, no credential storage, no session-based provider, no queue producers,
no outbox consumers. Do the foundation pieces first, through the kernel protocol, then the channel.

## Decide before coding (each needs an ADR via `write-adr`, owner = whoever does the first channel)

1. **Channel model:** a `channels` (connected account) table per org, status/health, encrypted credentials (AES-GCM at rest,
   the pattern in `provider-adapter`), multiple connected numbers/accounts per org, sender selection.
2. **Stateful providers** (Reference's Baileys/QR WhatsApp, WeChat/LINE sessions): where the long-lived session process lives.
   Options are a separate Node service (a new workspace package needs a kernel PR: Dockerfile/CI) or a worker-owned session
   manager. Reference's Node bridge internals and its Laravel contract are documented in the `node-bridge-runtime` inventory file.
   Note the legal/ban-risk context in Reference's docs (`faqs/whatsapp-bans`) before choosing.
3. **Worker→realtime path** (`@socket.io/redis-emitter`) so inbound messages reach browsers (kernel item D3).
4. **Unified message model:** contracts enums `channelType`, `msgDirection`, `deliveryStatus` exist; the messages table/stream
   (RANGE-partitioned) belongs to the inbox domain. Channels write through the inbox module's barrel, never its tables.

## Order of work for one channel

1. **Port + adapter** under `infra/providers/<domain>/` (invoke `provider-adapter`): send text/media/template, fetch profile/media,
   verify webhook signature, parse webhook. Credentials come from the channel record, not env. Unit-test parse/verify with
   fixtures you write from the inventory description.
2. **Connect flow:** credentials/OAuth/QR pairing endpoints, health check, disconnect; permissions via `rbac-permission`; audit rows.
3. **Inbound webhook** (invoke `webhook-handler`): `@Public()` controller, verify signature on the raw body in constant time, ack fast,
   enqueue on `<code>-ingest`, dedupe on the provider message id, status only moves forward, set `ctx.orgId` yourself.
4. **Ingest processor** (`worker-job`): normalize → resolve/create the contact identity (contacts barrel) → store message → emit
   outbox event (`outbox-event`) → realtime.
5. **Send path:** queue `<code>-send`, idempotent, rate limited per Reference's send-safety rules (see the SCHED/NODE inventories),
   consent and service-window checks (`CONSENT_OPTED_OUT`, `SERVICE_WINDOW_CLOSED`, `TEMPLATE_NOT_APPROVED` exist in contracts),
   wallet charge in the same transaction where the channel bills (ADR-0012; `Idempotency-Key` mandatory), retries with backoff.
6. **Delivery/status webhooks** → message status updates (monotonic).
7. Then the channel extras in the inventory: templates, broadcasts, flow nodes, insights, rich menus/bots.

## Rules

- Provider access only behind the port + token; no vendor SDK or raw fetch in a domain service.
- Tests use fixtures and fake adapters; never real accounts, numbers, tokens or customer data. Sandbox/test credentials only, never committed.
- Anything in Reference that is explicitly unofficial, ban-prone or terms-violating is flagged in the entry: raise it with the team before porting, do not decide alone.
- One person owns a channel end to end; shared plumbing (channel model, ingest pipeline) has one owner and the others consume its interface.
