# Messaging: inbox and broadcast

Not built yet. This is the design the schema already assumes, so that whoever
builds it does not have to re-derive it.

## Channels

`whatsapp`, `webbot`, `sms`, `email`, `voice`. The inbox launches with
WhatsApp and the web bot; broadcast targets all five.

A `channel` row is one connected endpoint: a WhatsApp number, an SMS sender ID,
a from-address, a voice DID. Credentials are encrypted at the application layer
(`CryptoService`) before they touch the database — a database dump must not be
a working set of API tokens.

## Identity resolution — the auto-merge backbone

An inbound message arrives from `+919876543210`. Who is that?

1. Look up `contact_identities` by `(kind, normalised value)`. Unique per org,
   so this is a single indexed hit and can never be ambiguous.
2. Miss → match on `contacts.normalized_phone` / `normalized_email`. Found →
   **attach** the new identity to that contact.
3. Still nothing → create a contact, then create its identity.

The result: the same person on WhatsApp and on the website is one contact with
one timeline, not two half-records for somebody to merge by hand later.

```sql
UNIQUE (org_id, kind, value)   -- an identity belongs to exactly ONE contact
```

There is an integration test asserting a second contact cannot claim an
identity that already belongs to someone.

Anonymous web-bot sessions live in `visitors` until the flow captures an email
or phone, at which point they are promoted to a contact. WhatsApp senders skip
this entirely — the phone number is known from message one.

## Conversations

**One perpetual thread per contact per channel:**

```sql
UNIQUE (org_id, channel_id, contact_id)
```

Resolving does not close the thread; the next inbound message reopens the same
row. A new thread per burst would fragment exactly the history an agent needs.

`service_window_expires_at` tracks the WhatsApp 24-hour customer service
window. Inside it, free-form replies are allowed; outside it, only approved
templates. This is **state on the conversation**, not a rule scattered through
send code.

`mode` is `bot` or `agent`. A bot flow's handoff node flips it and triggers
assignment.

## Messages

The biggest table in the system: 10–25M rows/month, range-partitioned monthly.

`messages` holds the **latest** status. The full history of transitions lives
in `message_events`, which is 2–4× larger and retained ~180 days before its
partitions are dropped.

Both tables are **exempt from the audit and outbox triggers**. They are the
log. Auditing an append-only table doubles the write volume to record nothing
new, and putting every message through the outbox would bury the drain.

**Status only moves forward.** Delivery receipts arrive out of order: a late
`sent` after a `delivered` must be recorded in `message_events` and ignored for
the summary column on `messages`.

## Webhooks

Ack fast, process in a queue. Meta retries aggressively on a slow response, and
parsing inline turns a provider hiccup into duplicate inbound messages.

Signature verification is mandatory and never skipped, including in
development. `MetaCloudProvider.verifyWebhookSignature`:

- hashes the **raw body**, not re-serialised JSON — key order and whitespace
  change the digest
- compares in **constant time**, so the comparison cannot be used as an oracle

This is the only thing between a public URL and someone writing arbitrary
messages into a customer's inbox.

## Provider abstraction

`WhatsAppProvider` is a port; `MetaCloudProvider` is the launch adapter. India
BSPs (Gupshup, Karix) have different template payloads and different receipt
shapes, so every provider maps into `NormalisedDeliveryEvent` /
`NormalisedInboundMessage`. Adding a BSP is a new adapter and a `provider`
value on the channel row.

## Broadcast pipeline

1. **Resolve audience** — static members, or evaluate the segment filter at send
   time. A dynamic segment is a query, not a snapshot.
2. **Consent and dedupe** — every skip is written to `campaign_recipients` with
   a `skip_reason`. Nobody is silently dropped; "why didn't this person get it"
   must always be answerable.
3. **Reserve budget** — hold the estimated cost on the wallet. Insufficient
   funds is a hard block: `paused_insufficient_funds`, nothing sent.
4. **Throttled send** — BullMQ rate limiter at `throttle_per_min`. Each send
   writes a `usage_charge` with the rate frozen at that moment.
5. **Settle** — on completion, settle actuals and release the remainder.

Counters (`sent_count`, `delivered_count`, …) are batch-updated every 2–5s by a
worker, never per receipt. See [scale.md](scale.md).

## Realtime

Socket.IO on `/realtime`, rooms `org:{id}`, `user:{org}:{id}`,
`conv:{org}:{id}`. The Redis adapter is required for more than one process —
without it, a message emitted on pod A never reaches a socket held by pod B.

Conversation rooms are joined explicitly and checked. A socket that auto-joined
every room would leak every conversation in the tenant to any authenticated
user.
