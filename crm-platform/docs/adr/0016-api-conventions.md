# ADR-0016: API conventions — uuids, cursors, problem+json, idempotency

- **Status:** accepted
- **Date:** 2026-09-16

## Context

Four conventions get decided once or argued about forever. Deciding them before
the second module exists is much cheaper than retrofitting them across five.

## Decision

### 1. uuids on the wire, bigint inside

Internal ids are `bigint` — they partition well, index compactly and join fast.
They never leave the system. Every API identifier is the row's `uuid`.

Translation happens in exactly one place per module: the mapper.

**Why:** sequential ids leak row counts and invite enumeration
(`/contacts/1`, `/contacts/2`). Making the external id opaque costs one lookup
and removes a whole class of exposure.

### 2. Cursor pagination everywhere

```
GET /v2/contacts?limit=50&cursor=eyJ...
→ { "data": [...], "page": { "nextCursor": "...", "hasMore": true, "limit": 50 } }
```

The cursor encodes the `(created_at, id)` tuple. `id` is the tiebreaker — two
rows can share a timestamp, and a page boundary landing mid-tie silently drops
or repeats rows.

`hasMore` is answered by fetching `limit + 1` rows, never by `COUNT(*)`.

**Why not OFFSET:** on a partitioned table `OFFSET 100000` makes Postgres walk
and discard 100,000 rows on every page, and concurrent inserts shift the pages
under the reader.

### 3. RFC 9457 problem+json

```json
{
  "type": "https://errors.crm.platform/wallet_insufficient_funds",
  "title": "Conflict",
  "status": 409,
  "detail": "Wallet balance is insufficient for this campaign.",
  "instance": "/v2/campaigns/abc/start",
  "code": "WALLET_INSUFFICIENT_FUNDS",
  "requestId": "3f2a...",
  "errors": [{ "path": "email", "message": "..." }]
}
```

`code` is the stable machine identifier; the frontend switches on it. `title`
and `detail` are for humans and may be reworded at any time. `requestId`
matches the `x-request-id` header and appears on every server log line for that
request.

One exception filter produces this. Nothing else in the codebase formats an
error response — that is what makes the shape dependable enough to build on.

### 4. Idempotency-Key on mutating routes

Routes marked `@Idempotent()` honour an `Idempotency-Key` header. The response
is stored in Redis for 24h and replayed on a repeat; a concurrent repeat while
the first is still running gets 409 rather than racing it.

**Why:** the client POSTs, the response is lost to a timeout, the client
retries. Without this, the retry sends the message twice, charges the wallet
twice, or creates the lead twice.

Currently optional so clients can adopt it incrementally. It becomes
**mandatory** on money-moving and message-sending routes when Billing and
Broadcast land — a deliberate, separate decision.

### Casing

snake_case in the database, camelCase in the API. Custom-field keys inside
`data` JSONB keep exactly the casing the org defined — those are user data, not
our schema.

## Consequences

### Positive

- Pagination cost is constant regardless of depth.
- Error handling on the client is one switch over `code`.
- A support question ("this request failed at 14:03") is answerable from the
  `requestId` the user can see.
- Retries are safe by construction on the routes that matter.

### Negative

- Cursors cannot jump to "page 7". Products that need page numbers need a
  different strategy for those specific views.
- The uuid↔bigint translation is one extra lookup per related entity on write.
- Idempotency keys occupy Redis for 24h per mutating request that sends one.
- Every module must remember these. The PR checklist enforces them; nothing
  else does.

## Alternatives considered

### Expose bigint ids

Simpler and faster. Leaks volume, invites enumeration, and makes the internal
key part of the public contract forever.

### Plain `{ error: "..." }` responses

Easy until the client needs to branch on the failure, at which point it starts
matching on message text — which then cannot be reworded.

## Revisit when

A UI genuinely needs page numbers (an admin table with "go to page 7"). That
view can use a bounded keyset-with-offset hybrid rather than changing the
platform-wide rule.
