# ADR-0018: Webhook fan-out — one Meta callback, many forward targets

- **Status:** accepted
- **Date:** 2026-10-05

## Context

Meta allows one webhook callback URL per app. Several of our products (this platform, Geta, Wabo) need the same Meta
events, and only one of them can be the registered callback.

## Decision

The platform receiver (`public/webhooks/whatsapp`, already registered with Meta) also acts as a forwarder:

1. It verifies the signature first. Unauthenticated traffic is never forwarded (otherwise anyone could spam every target).
2. Before any parsing into our own work, it enqueues one BullMQ job per active target on its own queue
   (`webhook-forward`) and answers Meta. The request path does no outbound HTTP.
3. The worker POSTs the **raw bytes unchanged**, with the original `X-Hub-Signature-256` and `Content-Type`, so each
   target verifies the payload with the same Meta app secret as if Meta had called it.
4. Targets are platform data (`webhook_forward_targets`, `webhook_forward_failures`): no `org_id`, writes under the
   privileged flag only, managed by super admins at `/v2/platform/webhook-targets`. This is the same exception as
   `admin_ai_keys`, not a hole in ADR-0002.
5. Targets must be https and must not be or resolve to a private/reserved address (SSRF); redirects are not followed.
   The address is re-checked before every delivery.
6. Retries: exponential backoff, per-target attempts (1-10) and timeout (1-30 s). A delivery that is out of retries, or
   gets a non-retryable 4xx, is kept with its body for 14 days and can be replayed. Successes are only counted
   (in-memory tally flushed every 5 s) so the log cannot grow with webhook volume.
7. Failures to enqueue are logged and swallowed; forwarding must never make Meta retry something our own ingest accepted.

## Consequences

- Adding a product is an admin action, not a deploy; Meta config is touched once.
- Delivery is at-least-once, unordered across targets. Targets must tolerate duplicates (Meta already sends them).
- We hold target header secrets (AES-GCM, write-only); a leaked database dump does not reveal them without the key.
- A DNS rebind between the address check and the connect is a small residual window; targets are operator-only.
