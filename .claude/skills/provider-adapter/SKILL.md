---
name: provider-adapter
description: >-
  Integrate an external third-party service into this CRM platform behind a
  port interface — a WhatsApp BSP (Gupshup, Karix), an SMS/DLT route, an
  email sender, a voice provider, a payment gateway, or any vendor API. Use
  this whenever asked to "add support for <vendor>", "integrate <service>",
  "switch providers", or when writing code that calls an external API from
  this repo. Never call a vendor SDK or a raw fetch directly from a domain
  service — everything above the adapter must be written against the port
  interface, or swapping a provider becomes a rewrite of the send pipeline
  instead of one new file.
---

# Provider adapters

The pattern: a **port** (interface + DI token) in
`apps/api/src/infra/providers/<domain>/<domain>.port.ts`, one or more
**adapters** implementing it, and a binding in `providers.module.ts`.
Everything above is written against the port.

Read `whatsapp/whatsapp.port.ts` + `whatsapp/meta-cloud.provider.ts` before
writing a new one — they're the reference.

## Why the indirection is worth it here

India BSPs all have different template payload shapes and different
delivery-receipt formats. The port exists so adding Gupshup alongside Meta
Cloud is one new adapter file and a `provider` value on the channel row —
not a rewrite of the send pipeline. That's a concrete, already-anticipated
requirement, not speculative abstraction.

## Structure

```ts
// <domain>.port.ts
export interface SendXParams {
  /* normalised, vendor-neutral */
}
export interface XProvider {
  readonly name: string;
  send(credentials: ChannelCredentials, params: SendXParams): Promise<SendResult>;
  verifyWebhookSignature(rawBody: Buffer, header: string, secret: string): boolean;
  parseWebhook(payload: unknown): {/* normalised events */};
}
export const X_PROVIDER = Symbol('X_PROVIDER');
```

**Normalise at the boundary.** Every adapter maps the vendor's shape into
the same internal types (`NormalisedDeliveryEvent`,
`NormalisedInboundMessage`). If a vendor concept leaks past the adapter into
domain code, the abstraction has failed and the next provider will hurt.

Bind it in `apps/api/src/infra/providers/providers.module.ts`:

```ts
providers: [MyProvider, { provide: X_PROVIDER, useExisting: MyProvider }],
exports: [X_PROVIDER, MyProvider],
```

Inject by **token**, never by concrete class:

```ts
constructor(@Inject(X_PROVIDER) private readonly provider: XProvider) {}
```

## Credentials

Vendor tokens live in the `channels` table's `credentials` JSONB, encrypted
at the application layer with `CryptoService` before they're written. A
database dump must not be a working set of API keys.

Global/static config (a graph API version, a sandbox flag) goes in
`env.schema.ts` instead — and remember the schema is validated at boot, so
adding a required var there means the app refuses to start without it.

## Signature verification is not optional

If the provider sends webhooks, `verifyWebhookSignature` must:

- hash the **raw body**, not re-serialised JSON — key order and whitespace
  change the digest, and `JSON.parse` → `JSON.stringify` round-trips are not
  byte-identical
- compare in **constant time** (`timingSafeEqual`), so the comparison can't
  be used as an oracle to guess the signature byte by byte
- return `false` on any doubt — malformed header, wrong length, parse error

`MetaCloudProvider.verifyWebhookSignature` does all three; copy its shape.
This is the only thing between a public URL and someone writing arbitrary
messages into a customer's inbox — it is never skipped, including in
development.

For the route side of a webhook, invoke the `webhook-handler` skill.

## Infra may not import domain

`apps/api/src/infra/**` must not import from `modules/` or `kernel/` —
enforced by `pnpm arch:check` (`.dependency-cruiser.cjs`, rule
`infra-must-not-depend-on-domain`). An adapter that needs domain data is a
sign the logic belongs in a service that _calls_ the adapter, not inside it.

## Before finishing

Adding a provider for a **new channel type** is usually an architectural
decision (new billing unit types, new consent semantics, new compliance
surface) — invoke the `adr-diff-guard` skill to check whether it contradicts
or extends an existing ADR, and the `write-adr` skill if it warrants its own
record.

Then invoke the `pre-pr` skill.
