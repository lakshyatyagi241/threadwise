# ADR-0013: External reads go to a replica, behind an API-key + HMAC surface

- **Status:** accepted
- **Date:** 2026-09-16

## Context

From the requirements discussion: external systems need to read lead data —
the sub-agent portal showing current stage, and eventually partner and
institute systems pulling updates.

Two constraints were explicit:

1. **Read calls must not hit the primary.** The phrase used was to give them a
   wrapper served from a read replica, not the main database.
2. The legacy system has a _submit_ API exposed but no _read_ API. The read
   surface has to be built, and it should be built as a deliberate external
   contract rather than by exposing internal endpoints.

## Decision

### Two connection pools

`DATABASE_URL` (primary) and `DATABASE_REPLICA_URL` (replica), exposed as
`DatabaseService.tx()` and `DatabaseService.txReplica()`.

All partner-portal and `/public/v1` reads use the replica. Writes and
read-your-own-write paths use the primary. Production refuses to boot without
`DATABASE_REPLICA_URL` — enforced in `validateEnv`.

### A separate external surface

`/public/v1`, versioned independently of the internal `/v1`. Internal
refactors must not break an integration we cannot redeploy.

Response fields are exactly what was agreed: name, email, mobile, lifecycle
stage, college tag, last-updated.

### Three-factor authentication per request

1. **API key** — `Authorization: ApiKey <prefix>.<secret>`, argon2-verified.
   `key_prefix` is public and globally unique so a request resolves to an org
   before any tenant context exists.
2. **HMAC signature** — `X-Signature` over
   `{timestamp}.{METHOD}.{path}.{rawBody}`, with a ±5 minute window.
3. **Rate limit** — per key, per minute, in Redis.

## Consequences

### Positive

- Partner polling — which is unbounded and untrusted — cannot compete with
  staff writes for primary capacity.
- The key alone is not enough to replay a captured request: the signature binds
  it to a timestamp and a body digest, and it expires.
- The external contract can stay frozen while internal DTOs move.
- Replica failure degrades reads, it does not stop writes. `/ready` reports it;
  the client falls back to the primary when no replica is configured.

### Negative

- **Replication lag is real.** Reading your own write through the replica
  returns stale data. Worse, in development the replica _is_ the primary, so the
  bug is invisible until production. The rule is written on
  `DatabaseService.txReplica` and must be respected.
- The API-key lookup runs in privileged mode, because the org is unknown until
  the prefix resolves. One of exactly four sanctioned uses.
- HMAC signing is a real integration burden for partners. It needs example code
  in several languages, or adoption suffers.
- Raw-body capture (`rawBody: true`) is required for signature verification —
  re-serialised JSON produces a different digest.

### Neutral

- Locally the replica URL may point at the primary. Production validation
  prevents that configuration shipping.

## Alternatives considered

### Same internal API with a JWT

Simplest. Couples the external contract to internal shapes, and puts polling
traffic on the primary.

### Webhooks instead of polling

Better in principle — push on change instead of poll on a timer, and the outbox
already carries the events. It needs retry, signing, endpoint management and a
delivery log. Worth building; not first.

## Revisit when

Partners ask for push. Outbox → webhook delivery is the natural next step, and
`/public/v1` remains the read fallback.
