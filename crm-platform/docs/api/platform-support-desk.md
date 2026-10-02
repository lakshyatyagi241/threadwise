# Platform support desk API

Customer routes use the workspace user's bearer token; operator routes use a platform operator token. Errors are `application/problem+json`
(validation 422, stale `rowVersion` 409 `ROW_VERSION_CONFLICT`, closed ticket reply 409 `CONFLICT`, unknown or foreign ticket 404).

## Customer

### POST /v2/support/tickets

```json
{
  "reason": "billing",
  "name": "Asha Rao",
  "email": "asha@example.com",
  "subject": "Invoice question",
  "message": "Why was I charged twice?"
}
```

201:

```json
{
  "id": "3b0f...",
  "ticketNumber": "TKT-7K2QXA",
  "subject": "Invoice question",
  "excerpt": "Why was I charged twice?",
  "status": "open",
  "createdAt": "2026-10-03T10:00:00.000Z",
  "resolvedAt": null
}
```

### GET /v2/support/tickets?limit=10

`{ "data": [ticket, ...], "summary": { "total": 12, "open": 10, "resolved": 1 } }`. Only the caller's own tickets; `open` excludes resolved and closed.

### GET /v2/support/tickets/:id

Ticket plus `reason` and `messages`: `[{ id: null, role: "initial", body, createdAt }, { id, role: "support" | "customer", body, createdAt }]`.
Internal notes are never returned.

### POST /v2/support/tickets/:id/reply

`{ "body": "Still broken" }` (max 8000). A resolved ticket reopens as `in_progress`; `pending` stays; a closed ticket answers 409. Returns the thread.

## Operator

### GET /v2/platform/support/tickets?status=&priority=&agent=me|unassigned&q=&limit=12&cursor=

`{ "data": [row], "page": { "nextCursor", "hasMore", "limit" }, "kpis": { "open", "unassigned", "resolved24h", "total" } }`. KPIs ignore the filters.
Search (`q`) matches subject, customer name, email and ticket number (case-insensitive substring).

### GET /v2/platform/support/tickets/:id

Full ticket: `message`, `reason`, `rowVersion`, `assignee`, `workspace { id, name, slug }`, timestamps and every message including internal notes
(`isInternalNote`) and `emailStatus` (`sent` | `failed` | null).

### POST /v2/platform/support/tickets/:id/reply

`{ "body": "Try again now", "isInternalNote": false }`. A normal reply stamps `firstResponseAt` once, sets `lastReplyAt`, moves `open` to
`in_progress` and emails the customer (`Re: <subject>`); a note changes nothing on the ticket and sends nothing.

### PATCH /v2/platform/support/tickets/:id/status | priority | assignee

`{ "status": "resolved", "rowVersion": 3 }`, `{ "priority": "urgent", "rowVersion": 3 }`, `{ "agentId": "<operator uuid>" | null, "rowVersion": 3 }`.
Returns the refreshed ticket. `resolvedAt` is stamped once on `resolved`, kept on `resolved -> closed`, cleared when reopened.

### GET /v2/platform/support/tickets/assignees

`{ "data": [{ "id", "name", "email" }] }`: active `super_admin` and `support` operators.
