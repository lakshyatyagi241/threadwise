---
name: frontend-api-call
description: >-
  Call this CRM platform's API correctly from apps/web (staff CRM) or
  apps/partner (sub-agent portal) — importing types from @crm/contracts,
  cursor pagination, problem+json error handling, Idempotency-Key on
  mutations, auth headers, and the Socket.IO realtime connection. Use this
  whenever writing frontend code that fetches from the API, adding a data
  hook, wiring a form submit, handling an API error in the UI, or connecting
  to realtime. Never redeclare a request/response type in the frontend or
  parse an error by its message text — the shared contracts package and the
  stable error codes exist exactly so neither is necessary.
---

# Calling the API from the frontend

Both `apps/web` and `apps/partner` are workspace packages, so they import
the same Zod schemas the API validates with:

```ts
import { contactResponseSchema, type ContactResponse, ERROR_CODES } from '@crm/contracts';
```

That's the whole point of the contracts package — a renamed field breaks the
frontend **build**, in the same commit, instead of surfacing as `undefined` in
someone's browser. If you're about to hand-write an `interface` for an API
response, stop: it exists in `@crm/contracts`, or it should (invoke the
`contracts-change` skill).

Parse at the boundary. The API is a separately deployed process and can be a
different version than the frontend build:

```ts
const page = await res.json();
const contacts = page.data.map((row: unknown) => contactResponseSchema.parse(row));
```

## Conventions that aren't optional

| Rule                                 | Why                                                        |
| ------------------------------------ | ---------------------------------------------------------- |
| Identifiers are **uuids**            | the API never emits internal bigint ids                    |
| Lists paginate by **cursor**         | `?limit=50&cursor=...`; there is no page number            |
| Errors are **problem+json**          | branch on `code`, never on `title`/`detail` text           |
| Mutations send **`Idempotency-Key`** | a retried POST must not double-charge or double-send       |
| Send **`X-Request-Id`**              | comes back on the response and is in every server log line |

## Pagination

```ts
// The response envelope is always { data, page: { nextCursor, hasMore, limit } }
const res = await api(`/v1/contacts?limit=50${cursor ? `&cursor=${cursor}` : ''}`);
```

There is no total count and no page number — that's deliberate: `OFFSET` on a
partitioned table is the query that turns a 20ms list endpoint into a 2s one.
Build "load more" / infinite scroll, not numbered pages. If a screen truly
needs page numbers, that's a design conversation, not a fetch-layer
workaround.

## Errors

```ts
if (!res.ok) {
  const problem: Problem = await res.json();
  switch (problem.code) {
    case ERROR_CODES.ROW_VERSION_CONFLICT:
      // someone else edited it — re-fetch and let the user re-apply.
      // Never silently retry: that's exactly the overwrite the lock prevented.
      break;
    case ERROR_CODES.WALLET_INSUFFICIENT_FUNDS:
      // a hard block, not a transient failure — show it, don't retry
      break;
    case ERROR_CODES.VALIDATION_FAILED:
      // problem.errors[] has { path, message } per field
      break;
  }
}
```

`code` is stable; `title` and `detail` get reworded. Show `problem.requestId`
in any error UI — it's what makes a support question answerable from the
server logs.

## Optimistic locking in forms

Any update sends back the `rowVersion` it read. A 409 means the record moved
underneath the user — re-fetch, show them what changed, let them decide. Don't
auto-retry with the new version; that silently discards whatever the other
person wrote, which is the exact data loss the lock exists to prevent.

## Auth

Staff (`apps/web`) and partner agents (`apps/partner`) are **different token
types**. A staff token is rejected on `/v1/partner/*` and vice versa — that's
enforced server-side by `@ActorKinds`, so don't try to share a session
between the two apps.

```
POST /v1/auth/staff/login     { orgSlug, email, password }
POST /v1/auth/partner/login   { orgSlug, email, password }
POST /v1/auth/refresh         { refreshToken }
```

`orgSlug` is required — the same email can exist in more than one tenant.

## Realtime

```ts
io(`${API_URL}/realtime`, { auth: { token: accessToken } });
```

Rooms are joined **server-side**. A client can't join an arbitrary
conversation room by asking — that check is in the gateway, and it's what
stops one authenticated user from subscribing to the whole tenant's
conversations.

## Partner portal specifics

The partner app stores **only the contact id** — name, stage and details are
read live on every view. Don't cache lifecycle stage client-side beyond a
normal request cache; there's exactly one source of truth for it.

## If the endpoint doesn't exist yet

Don't invent the shape and mock it. Invoke the `new-module` skill (for a new
entity) or `contracts-change` (for a new field on an existing one) so the
server and the contract land together.
