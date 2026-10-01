# Broadcasts API (BCAST)

WhatsApp broadcasts: one template sent to a list of contacts. Port of WaDesk's `POST /broadcasts` (WD-BCAST-009, 010, 011,
012, 013, 014, 015). Parity notes and what is stubbed: [parity/broadcasts.md](../wadesk-port/parity/broadcasts.md).

All routes are under `/v2`, need a signed-in staff user, and use problem+json errors with a stable `code`.

## `POST /v2/broadcasts`

Permission `bcast.broadcasts.create` (granted to the locked Admin role). Requires an `Idempotency-Key` header.

```json
// request
{
  "name": "Diwali offer",
  "templateId": "7c6f…",                // wa_templates uuid, required
  "templateOverrides": null,             // optional object; blank values are dropped, all-blank stores null
  "contactIds": ["…"],                   // contacts, groups and tags are merged, first occurrence wins
  "groupIds": ["…"],
  "tagIds": ["…"],
  "senderKeys": ["baileys:4ce2…", "waba:9b1c…"],   // "<engine>:<uuid>"; none = one sender-less broadcast
  "senderShare": { "baileys:4ce2…": 7, "waba:9b1c…": 3 },  // weights 0..1000, missing or <= 0 means 1
  "scheduleType": "now",                 // or "later" with sendDate (YYYY-MM-DD) and sendTime (HH:mm)
  "sendDate": "2026-10-05",
  "sendTime": "09:00",
  "timezone": "Asia/Kolkata"             // IANA zone the date and time are read in; default UTC
}
// 201
{
  "devicesCount": 2,
  "broadcasts": [
    { "id": "…", "name": "Diwali offer · Phone A", "status": "processing", "provider": "baileys",
      "senderKey": "baileys:4ce2…", "templateId": "7c6f…", "timezone": "Asia/Kolkata",
      "scheduledAt": "2026-10-05T03:30:00.000Z", "completedAt": null, "totalRecipients": 3,
      "successCount": 0, "deliveredCount": 0, "readCount": 0, "clickedCount": 0, "failCount": 0,
      "rowVersion": 1, "createdAt": "…", "updatedAt": "…" }
  ]
}
```

One broadcast row is created per picked sender, all in one transaction (both or neither). The audience is split across
them by weight: each sender gets the floor of its share and the leftover goes to the largest fractions, so slices differ
from the ideal by at most one. A slice that would be empty (fewer contacts than senders) is not created. Each row starts
with one `pending` recipient per contact, status `processing` for `now` and `scheduled` for `later`.

### Order of checks (stops at the first refusal, as WaDesk)

| #   | Check                                                                 | Refusal                                                             |
| --- | --------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1   | Plan feature `broadcast` (not in the plan catalogue yet)              | 422 `PLAN_FEATURE_LOCKED` (shim: always allowed for now)            |
| 2   | Plan cap `broadcasts`: live row count of the organization             | 422 `PLAN_LIMIT_REACHED`                                            |
| 3   | Body validation                                                       | 422 `VALIDATION_FAILED` with `errors[{path,message}]`               |
| 4   | Audience has at least one sendable contact                            | 422 `BCAST_NO_RECIPIENTS`                                           |
| 5   | Emergency halt and content screen (`SendPolicyService`)              | 4xx from the send policy (`AUTH_SEND_HALTED` / `AUTH_SEND_BLOCKED`) |
| 6   | Wallet precheck                                                       | 422 `BCAST_SEND_BLOCKED` (shim: always allowed for now)             |
| 7   | Template exists in this organization                                  | 422 `BCAST_TEMPLATE_NOT_FOUND`                                      |
| 8   | Template can be broadcast (not OTP; reachable media; Meta guardrails) | 422 `BCAST_TEMPLATE_NOT_ALLOWED`                                    |
| 9   | Warmer holds for warming numbers                                      | 422 `BCAST_WARMER_HOLD` (shim: never holds for now)                 |

Audience rules: another organization's contacts, groups, tags and templates are never used (a foreign id behaves like an
unknown one). Contacts that opted out (`is_unsubscribed`) or are archived are dropped. Sender keys that are unknown,
disconnected, or of a disabled engine are dropped silently.

### Side effects

In the same transaction: one `audit_log` row (`broadcasts` / `insert`) and one outbox event `broadcast.created`
`{ uuid, status, isNow, totalRecipients }` per created broadcast. Nothing is sent by this endpoint; the sender (WD-BCAST-016)
consumes the event.

### Errors

`VALIDATION_FAILED`, `PLAN_FEATURE_LOCKED`, `PLAN_LIMIT_REACHED`, `BCAST_NO_RECIPIENTS`, `BCAST_SEND_BLOCKED`,
`BCAST_TEMPLATE_NOT_FOUND`, `BCAST_TEMPLATE_NOT_ALLOWED`, `BCAST_WARMER_HOLD`, `FORBIDDEN` (403), `UNAUTHENTICATED` (401).
