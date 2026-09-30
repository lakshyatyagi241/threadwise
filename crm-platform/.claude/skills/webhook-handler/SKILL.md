---
name: webhook-handler
description: >-
  Add an inbound webhook endpoint to this CRM platform — a provider delivery
  receipt, an inbound message, a payment gateway callback, or any external
  system POSTing to us. Use this whenever asked to "receive webhooks from
  X", "handle the callback from Y", "add an endpoint the provider calls",
  or when wiring up a provider's inbound path. Never accept an unauthenticated
  webhook, never trust redirect/callback query parameters as proof a payment
  succeeded, and never do the real processing inline in the request handler —
  each of those is a specific, known way this goes wrong.
---

# Inbound webhooks

A webhook is a public, unauthenticated-by-default URL that an outside party
POSTs to. Three things have to be right, and each has a specific failure mode
if it isn't.

## 1. Verify the signature — always

```ts
@Public()                              // JWT guard doesn't apply; the signature IS the auth
@Post('webhooks/whatsapp/:channelId')
async receive(@Req() req: Request & { rawBody?: Buffer }, @Param('channelId') channelId: string) {
  const ok = this.provider.verifyWebhookSignature(
    req.rawBody!,                      // RAW bytes, not the parsed body
    req.header('x-hub-signature-256') ?? '',
    appSecret,
  );
  if (!ok) throw AppError.unauthenticated('invalid signature');
  // ...
}
```

`rawBody: true` is already enabled in `main.ts` precisely for this. Hashing
the parsed-and-re-serialised body produces a different digest — key order and
whitespace aren't preserved — so it will fail in confusing, intermittent-looking
ways if you use `req.body`.

Verification belongs in the **provider adapter**
(`verifyWebhookSignature`), not inline in the controller — see the
`provider-adapter` skill. The controller calls it; the crypto lives in one
place per provider.

Never skip verification in development. A webhook URL is public by
definition; "we'll add auth later" means the window where anyone can inject
messages into a customer's inbox is however long "later" turns out to be.

## 2. Ack fast, process in a queue

Providers retry aggressively on a slow response. Parsing inline turns a brief
hiccup on our side into **duplicate inbound messages**, because the provider
assumes we didn't receive it and sends again.

```ts
await this.queue.add('inbound', { channelId, payload: req.body });
return { received: true }; // return immediately
```

Enqueue to `QUEUES.WEBHOOK_INGEST` and return. The processor does the real
work — invoke the `worker-job` skill for that side.

## 3. Be idempotent

Retries mean the same payload arrives more than once, guaranteed. Dedupe on
the provider's own message/event id (`provider_message_id`), not on a hash of
the body or a timestamp.

Related: delivery receipts arrive **out of order**. A late `sent` after a
`delivered` must be recorded in `message_events` but must not move
`messages.status` backwards — status only moves forward.

## Payments are a special case

For a payment gateway, the webhook is the **only** source of truth for "was
it paid." Never trust the browser redirect's query parameters — the user
controls those, and treating them as proof is how a free order happens.

Verify the gateway's hash, then post to the wallet idempotently on
`gateway_txn_id`. See
[ADR-0012](../../../docs/adr/0012-payments-and-settlements.md) — and note
exam-fee settlements are compliance-gated, test mode only.

## Routing and auth

Webhook routes are `@Public()` (no JWT), but that means the signature check
IS the authentication — there's no second layer behind it. If the endpoint
is for a partner system rather than a provider, prefer the existing
`/public/v1` surface with API key + HMAC (`ApiKeyGuard`) over a bespoke
webhook — it already handles keys, signatures, replay windows and rate
limiting.

## Before finishing

Invoke the `pre-pr` skill. If this webhook introduces a new external trust
boundary, invoke `adr-diff-guard` — new inbound attack surface is the kind of
thing an ADR should cover.
