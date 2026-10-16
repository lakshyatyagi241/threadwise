# Developer REST API v1 (API)

The customer REST API: the `/api/v1` routes a workspace calls with its own API key, and the Developers console routes
(`/v2/developer/keys`) staff use to create that key. Port of Reference's `/api/v1` service and its Developers page (TW-API-001
to 010, 020 to 054, 080 to 095, 110 to 120, 150). Inventory:
[inventory/developer-rest-api-v1.md](../threadwise-port/inventory/developer-rest-api-v1.md).

Two audiences read this page. An integrator needs sections 1 to 4 and 6. A staff developer who maintains the API needs
sections 5, 7 and 8 as well.

## 1. Overview and base URL

- Base URL: `<APP_URL>/api/v1`. The routes are version-neutral, so there is no `/v2` in front. `<APP_URL>` is the public URL of
  the API for the installation (the same value the media links use).
- Every route is JSON in and JSON out. Two routes accept `multipart/form-data` for files (`POST /messages`, `POST /templates/{id}/send`)
  and one takes only multipart (`POST /media`).
- Identifiers are uuids, never numbers. A path id that is not a uuid is a `404 not_found`, not a `400`.
- Timestamps are ISO-8601 in UTC (`2026-10-05T03:30:00.000Z`). Field names are snake_case, as in Reference.
- Browsers: `/api/v1` and `/docs/api.json` answer every origin (`Access-Control-Allow-Origin: *`) and never with credentials, because a caller holds its own bearer key. The staff API keeps its own origin list.
- A request can only see and change the workspace the key belongs to. Another workspace's id behaves like an unknown one (`404`).
- The key acts as the staff member who created it: what it creates (contacts, deals, templates) is owned by that member and the audit
  log records the actor as `api_key`.
- Every route needs the plan feature `public_api` (on by default). A workspace whose plan lacks it gets `403 plan_feature_disabled`
  on every route. Deals also need the feature `sales_pipeline`.

## 2. Authentication

Send the key on every request, in one of two forms:

```http
Authorization: Bearer wsk_Xk3...40 characters...
```

```http
X-Api-Key: wsk_Xk3...40 characters...
```

The bearer header is read first; `X-Api-Key` is used when there is no usable bearer token.

### The key

| Property       | Value                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format         | `wsk_` followed by 40 characters from `A-Z a-z 0-9` (44 in all). A token of any other shape is refused without a database lookup.                             |
| Shown          | Once, in the answer to `POST /v2/developer/keys` (field `secret`). It cannot be read again; only a sha256 hash and the first 12 characters are stored.        |
| Prefix         | The first 12 characters (`wsk_` plus 8). The console lists the prefix so a key can be recognised without the secret.                                          |
| How many       | The plan limit `api_keys` decides how many active keys a workspace holds. Reference allowed exactly one; a plan limit of 1 reproduces that. `0` is unlimited. |
| Owner          | The member who created it. If that member is deleted the key stops working (`401 invalid_api_key`).                                                           |
| Expiry         | `expiresAt` can be set on the row; an expired key is `401 invalid_api_key`. The console does not set one.                                                     |
| Revoked        | Takes effect on the next call.                                                                                                                                |
| `last_used_at` | Written at most once a minute per key (Reference wrote it on every call).                                                                                     |

### Scopes

A key may carry scopes named `<resource>:read` or `<resource>:write`. `<resource>:write` also grants `<resource>:read`. A key with
no scopes has full access, as in Reference. Resources: `account`, `contacts`, `contact-groups`, `deals`, `flows`, `templates`,
`auto-replies`, `broadcasts`, `campaigns`, `scheduled`, `messages`, `media`, `conversations`, `devices`, `webhooks`.

A call outside the key's scopes is `403 forbidden` with a message naming the scope (`needs the "contacts:write" scope`). The scope is
checked before the rate limit, so a refused call does not use the budget.

The console's create form has a "Restrict this key" switch that sets them (stored on the key row, `api_keys.scopes`). It is off by
default, so a key made without touching it is full access, as in Reference; the key list shows a **Full access** badge on such a key, or
the scope names on a restricted one. A restricted key's scopes are fixed at creation: revoke it and make a new one to change them.

### Order of checks

1. Too many failed attempts from this address: `429 rate_limited` (30 failures per address per minute; the counter lives 60
   seconds from its first failure).
2. No key sent: `401 missing_api_key`.
3. Key unknown, malformed, revoked, expired or ownerless: `401 invalid_api_key` (and the failure is counted).
4. Scope: `403 forbidden`.
5. Rate limit: `429 rate_limited`.
6. Plan feature: `403 plan_feature_disabled`.

### How this differs from the signed partner scheme at `/public/v1`

Both schemes use the `api_keys` table and share the rate-limit and plan-feature code (`ApiKeyAccessService`), but they are separate
surfaces and the keys are not interchangeable.

|                | Customer API `/api/v1`                          | Partner API `/public/v1`                                                        |
| -------------- | ----------------------------------------------- | ------------------------------------------------------------------------------- |
| Key kind       | `bearer`, `wsk_` + 40 characters                | `signed`, `<prefix>.<secret>`                                                   |
| Header         | `Authorization: Bearer <key>` or `X-Api-Key`    | `Authorization: ApiKey <prefix>.<secret>` plus an HMAC-SHA256 request signature |
| Secret storage | sha256 hash, constant-time compare              | argon2 hash and an encrypted signing secret                                     |
| Answers        | `{ data, meta }` and `{ error: { code, ... } }` | problem+json like the staff API                                                 |
| Created in     | Developers console, `POST /v2/developer/keys`   | Not by the console; the `/v2/developer/keys` routes only touch `bearer` keys    |

A signed key presented at `/api/v1` is `401 invalid_api_key`; a bearer key presented at `/public/v1` is refused as well.

## 3. Rate limits

The limit is per key, counted in a fixed window of one clock minute (a caller can burst across a window boundary). The limit applied
to a request is the lower of:

1. the key's own `rate_limit_per_minute` (`0` means no limit of its own; keys made in the console have `0`), and
2. the ceiling: the plan limit `api_rate_limit_per_minute` when it is above 0, otherwise the platform security policy
   `apiRateLimitPerMinute`, which defaults to **600**. A policy value of 0 means no ceiling.

A workspace override of `-1` on `api_rate_limit_per_minute` lifts the limit altogether (no counting, no headers).

Every answer carries:

| Header                  | Meaning                                              |
| ----------------------- | ---------------------------------------------------- |
| `X-RateLimit-Limit`     | Requests allowed per minute for this key.            |
| `X-RateLimit-Remaining` | Requests left in the current minute (never below 0). |
| `Retry-After`           | Only on `429`: seconds until the minute turns.       |

Over the limit:

```http
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 600
X-RateLimit-Remaining: 0
Retry-After: 23
```

```json
{
  "error": {
    "code": "rate_limited",
    "message": "Rate limit of 600 requests/minute for your plan exceeded. Retry in 23s.",
    "requestId": "7f0c9a52-6f43-4e0e-8f0d-0a5b8b0e2c11"
  }
}
```

The failed-authentication lockout (section 2) is a separate `429 rate_limited` with its own message and no rate-limit headers.
The usual per-IP throttle does not apply to `/api/v1`: the per-key limit is the one that counts.

## 4. Answers and errors

### Success

```json
{ "data": { "...": "..." }, "meta": { "...": "..." } }
```

`meta` is left out when there is nothing to say. A list answers an array in `data` and the page in `meta`:

```json
{
  "data": [{ "id": "…" }],
  "meta": { "limit": 25, "next_cursor": "eyJ…", "has_more": true }
}
```

Some lists add keys to `meta` (`count`, `counts`, `stats`, `conversation_id`); each is named under its endpoint.

### Failure

```json
{
  "error": {
    "code": "validation_failed",
    "message": "The given data was invalid.",
    "details": { "phone": ["The phone is not a valid number."] },
    "requestId": "7f0c9a52-6f43-4e0e-8f0d-0a5b8b0e2c11"
  }
}
```

`code` is a stable snake_case string: branch on it, not on `message`. `details` is `{ field: [messages] }` and appears on
validation failures and a few domain refusals (the key is the request field, `_` when the problem is not tied to one). `requestId` is
the id to quote to support. The same envelope is used for every failure under `/api/v1`: a guard, a pipe, an unknown route
(`404 not_found`) and unreadable JSON (`422 validation_failed`).

### Codes of the shared envelope

These are the values of `V1_ERROR_CODES` (`packages/contracts/src/developer-rest-api-v1/envelope.ts`).

| `code`                   | HTTP | When                                                                                                                             |
| ------------------------ | ---- | -------------------------------------------------------------------------------------------------------------------------------- |
| `missing_api_key`        | 401  | No key sent.                                                                                                                     |
| `invalid_api_key`        | 401  | Key malformed, unknown, revoked, expired, a partner key, or its owner is gone.                                                   |
| `rate_limited`           | 429  | Over the per-key limit, or too many failed authentications from one address.                                                     |
| `forbidden`              | 403  | The key lacks the scope the route needs.                                                                                         |
| `not_found`              | 404  | Unknown record, a record of another workspace, a path id that is not a uuid, or a route that does not exist.                     |
| `validation_failed`      | 422  | The body or query broke a rule. Always 422 with `details` (Reference redirected without `Accept: application/json`).             |
| `plan_feature_disabled`  | 403  | The plan lacks `public_api`, or `sales_pipeline` on the deals routes.                                                            |
| `plan_limit`             | 402  | A plan cap is reached (contacts, broadcasts, campaigns, templates, scheduled messages). Reference answered 422 on some of these. |
| `conflict`               | 409  | A concurrent edit lost the optimistic lock, or an `Idempotency-Key` request is still in flight.                                  |
| `payload_too_large`      | 413  | The request body is over the body limit.                                                                                         |
| `unsupported_media_type` | 422  | An uploaded file has a type or content that is not allowed (`POST /media`, a file on `POST /messages`, `header_media`).          |
| `server_error`           | 500  | An unexpected failure.                                                                                                           |
| `method_not_allowed`     | 405  | A known path called with another method. The message lists the methods that work and the `Allow` header carries them.            |

### Domain codes

A refusal that has no entry in the table above reaches the client as its platform code in lower case (`TPL_NAME_TAKEN` becomes
`tpl_name_taken`). The codes Reference clients already branch on are kept exactly as Reference spelled them. All are `422` unless the
status is given.

| `code`                                             | HTTP | Where                                                     | Meaning                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------- | ---- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `send_failed`                                      | 422  | `POST /messages`                                          | The request was understood but the message cannot go out. `error.message` is a machine reason: `empty_message`, `invalid_media`, `media_fetch_failed`, `wrong_channel`, `no_connected_device`, `service_window_closed`, `channel_disconnected`, `channel_capability_unsupported`, `send_blocked`, `out_of_credits` (HTTP 402), or the sentence `Invalid recipient number.` |
| `media_required`                                   | 422  | `POST /messages`                                          | `type` is image, video, document or audio with neither a file nor `media_url`.                                                                                                                                                                                                                                                                                             |
| `template_not_found`                               | 404  | `POST /templates/{id}/send`, `POST /scheduled`            | The template is not in this workspace.                                                                                                                                                                                                                                                                                                                                     |
| `not_approved`                                     | 422  | `POST /templates/{id}/send`                               | Meta has not approved the template. `details.template_id` carries the id.                                                                                                                                                                                                                                                                                                  |
| `paused`                                           | 422  | `POST /templates/{id}/send`                               | Meta paused the template.                                                                                                                                                                                                                                                                                                                                                  |
| `quality_floor`                                    | 422  | `POST /templates/{id}/send`                               | The template has a RED quality rating.                                                                                                                                                                                                                                                                                                                                     |
| `unsupported_template`                             | 422  | `POST /templates/{id}/send`                               | Authentication templates and named-variable templates cannot be sent through the API yet.                                                                                                                                                                                                                                                                                  |
| `missing_header_media`                             | 422  | `POST /templates/{id}/send`                               | The template has a media header, which the API cannot send yet.                                                                                                                                                                                                                                                                                                            |
| `no_provider`                                      | 422  | `POST /templates/{id}/send`                               | No connected WhatsApp number carries the template.                                                                                                                                                                                                                                                                                                                         |
| `tpl_name_taken`                                   | 409  | `POST /templates`                                         | The name is already used on that number.                                                                                                                                                                                                                                                                                                                                   |
| `tpl_not_editable`                                 | 409  | `PUT /templates/{id}`                                     | The template is approved or otherwise not editable (Reference allowed it).                                                                                                                                                                                                                                                                                                 |
| `tpl_no_connection`                                | 422  | `POST /templates`                                         | The workspace has no WhatsApp number to author the template on.                                                                                                                                                                                                                                                                                                            |
| `contact_not_found`                                | 404  | `POST /flows/{id}/enroll`                                 | No contact matches `contact_id` or `phone`.                                                                                                                                                                                                                                                                                                                                |
| `flow_inactive`                                    | 422  | `POST /flows/{id}/enroll`                                 | The flow is not active.                                                                                                                                                                                                                                                                                                                                                    |
| `unprocessable` (stage not in the deal's pipeline) | 422  | `PUT /deals/{id}`                                         | The stage is not in the deal's pipeline.                                                                                                                                                                                                                                                                                                                                   |
| `unprocessable` (pipeline has no stages)           | 422  | `POST /deals`                                             | The pipeline has no stages.                                                                                                                                                                                                                                                                                                                                                |
| `no_recipients`                                    | 422  | `POST /broadcasts`                                        | The audience has no sendable contact.                                                                                                                                                                                                                                                                                                                                      |
| `invalid_template`                                 | 422  | `POST /broadcasts`                                        | The template is not in this workspace.                                                                                                                                                                                                                                                                                                                                     |
| `invalid_group`                                    | 422  | `POST /broadcasts`                                        | `group_id` is not a group of this workspace.                                                                                                                                                                                                                                                                                                                               |
| `create_failed`                                    | 422  | `POST /campaigns`                                         | The campaign could not be created; `error.details` names the field.                                                                                                                                                                                                                                                                                                        |
| `schedule_failed`                                  | 422  | `POST /scheduled`                                         | The schedule could not be created; `error.details` names the field.                                                                                                                                                                                                                                                                                                        |
| `not_stoppable`                                    | 422  | `POST /broadcasts/{id}/stop`, `POST /campaigns/{id}/stop` | The status cannot be stopped.                                                                                                                                                                                                                                                                                                                                              |
| `not_cancellable`                                  | 422  | `DELETE /scheduled/{id}`                                  | The schedule is already finished.                                                                                                                                                                                                                                                                                                                                          |
| `delete_failed`                                    | 422  | `DELETE /campaigns/{id}`                                  | The campaign status cannot be deleted.                                                                                                                                                                                                                                                                                                                                     |
| `bcast_*`, `auth_send_halted`, `auth_send_blocked` | 4xx  | `POST /broadcasts`                                        | The broadcast domain's own refusals (template not allowed, send blocked, warmer hold), unchanged apart from the case.                                                                                                                                                                                                                                                      |

### Cursor pagination

Every list is paged by cursor, never by page number.

| Query parameter | Meaning                                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `limit`         | Page size. Default 25, range 1 to 100. A value outside the range is pulled into it, not refused.                            |
| `per_page`      | Alias of `limit` (Reference's name). `limit` wins when both are sent.                                                       |
| `cursor`        | The opaque `meta.next_cursor` of the previous page. Absent on the first page. Treat it as a string; its content can change. |
| `page`          | **Refused**: `422 validation_failed`, `details.page`, with a message that names the cursor.                                 |

`meta` always carries `limit`, `next_cursor` (null on the last page) and `has_more`. There is no total.

Exceptions to the 25 / 100 default:

| List                                                | Default   | Maximum | Note                                                       |
| --------------------------------------------------- | --------- | ------- | ---------------------------------------------------------- |
| `GET /messages`, `GET /conversations/{id}/messages` | 50        | 200     | A non-numeric `limit` is read as 1, as Reference did.      |
| `GET /conversations`                                | 25        | 100     | A non-numeric `limit` is read as 1.                        |
| `GET /flows/{id}/subscribers`                       | 100       | 200     | A non-numeric `limit` is read as 1. The cursor is numeric. |
| `GET /contact-groups`, `GET /devices`               | not paged | -       | The whole list; `meta.count` is its length.                |

`GET /templates` lists only sendable templates, so one page can come back shorter than `limit` while `has_more` is still true;
keep following `next_cursor` until it is null.

### Idempotency

`POST /messages`, `POST /templates`, `PUT /templates/{id}`, `POST /templates/{id}/send` and `POST /flows/{id}/enroll` honour an
optional `Idempotency-Key` header. A repeat with the same key (per workspace, for 24 hours) answers the first response and does not
repeat the action; a repeat while the first is still running is `409 conflict`. Reference had no idempotency, so a retry sent twice.

## 5. The Developers console (staff)

These routes are for signed-in staff, not for API keys. They are under `/v2` and answer the platform's problem+json errors
(`code` in capitals, `detail`), not the `/api/v1` envelope. The web page is `/developers`, a tile under Integrations that shows only
to roles holding `api.keys.read` on a plan with `public_api`.

| Permission        | Allows                    | Held by default by      |
| ----------------- | ------------------------- | ----------------------- |
| `api.keys.read`   | List the workspace's keys | Owner and Admin presets |
| `api.keys.create` | Create a key              | Owner and Admin presets |
| `api.keys.revoke` | Revoke a key              | Owner and Admin presets |

Reference let any workspace member open the page; the three keys make the menu's rule (owners and admins) the server's rule, and a
workspace can widen it in its role editor. The permissions are separate so a developer can see a key's state without being able to
create or revoke one.

Plan: creating a key needs the feature `public_api`. The limit `api_keys` caps the active keys (see section 2).

### `GET /v2/developer/keys`

Permission `api.keys.read`. The workspace's customer (bearer) keys, newest first. Signed partner keys are not listed.

Query: `limit` (1 to 200, default 50), `cursor`, `order` (`asc` or `desc`, default `desc`).

```json
{
  "data": [
    {
      "id": "0b9c1d5e-5f4e-4a39-9a2e-8f8a3b6c1d20",
      "name": "Production backend",
      "prefix": "wsk_Xk3pQ9aB",
      "status": "active",
      "scopes": [],
      "lastUsedAt": "2026-10-05T08:41:12.000Z",
      "expiresAt": null,
      "revokedAt": null,
      "createdAt": "2026-10-01T09:00:00.000Z"
    }
  ],
  "page": { "nextCursor": null, "hasMore": false, "limit": 50 }
}
```

The answer never carries the secret or the hash. `status` is `active` or `revoked`. `scopes` is the list the key is restricted to;
an empty list is full access.

### `POST /v2/developer/keys`

Permission `api.keys.create`; plan feature `public_api`.

| Field    | Type     | Required | Rules                                                                                                                                                           |
| -------- | -------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`   | string   | yes      | Trimmed, 1 to 120 characters.                                                                                                                                   |
| `scopes` | string[] | no       | Scope names (see Scopes above), each `<resource>:read` or `<resource>:write`; duplicates are dropped. Omitted or `[]` is full access. An unknown name is `422`. |

```json
{ "name": "Production backend", "scopes": ["contacts:read", "messages:write"] }
```

`201`:

```json
{
  "key": {
    "id": "0b9c1d5e-5f4e-4a39-9a2e-8f8a3b6c1d20",
    "name": "Production backend",
    "prefix": "wsk_Xk3pQ9aB",
    "status": "active",
    "scopes": ["contacts:read", "messages:write"],
    "lastUsedAt": null,
    "expiresAt": null,
    "revokedAt": null,
    "createdAt": "2026-10-01T09:00:00.000Z"
  },
  "secret": "wsk_Xk3pQ9aB…rest of the 44-character key"
}
```

`secret` is the raw key and is shown only here. The route is deliberately not `@Idempotent`: the idempotency store would keep the
response, and the secret, for 24 hours. A double submit is stopped by the active-key cap instead.

Errors: `422 VALIDATION_FAILED` (blank or over-long name); `422 PLAN_LIMIT_REACHED` when the cap is reached, with the Reference
sentence for a cap of 1 (`You already have an active API key. Revoke it before creating a new one - only one key per workspace is
allowed.`) and `errors[]` entries `limit`, `reason`, `used`, `limitValue`; `422 PLAN_FEATURE_LOCKED` without `public_api`;
`403 FORBIDDEN`; `401 UNAUTHENTICATED`.

Creation is serialised per workspace, so two simultaneous requests on a one-key plan make one key and refuse the other.

### `DELETE /v2/developer/keys/{id}`

Permission `api.keys.revoke`. Revokes the key: effective on the next API call. `200` answers the key (same shape as in the list) with
`status: "revoked"` and `revokedAt`. Idempotent: revoking a revoked key answers the same and keeps the first `revokedAt`. A revoked key
frees its place under the `api_keys` cap. `404 NOT_FOUND` for an unknown id or another workspace's key.

Each create and revoke writes an audit row (`api_keys`, `insert` or `update`) and an outbox event (`api.key_created`,
`api.key_revoked`) in the same transaction. The events carry `uuid`, `name` and `prefix` (and `scopes` on creation), never the secret.
The create audit row records the scopes. Reference wrote neither.

## 6. Endpoints

Conventions used below: "Scope" is the scope the key needs (`write` also satisfies `read`). Request tables list every field the
contract accepts. A string field marked "blank is null" is trimmed and an empty string is read as not sent, as Laravel's middleware
did. Boolean fields accept `true`, `false`, `1`, `0`, `"1"`, `"0"`.

| Group          | Routes                                                                                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account        | `GET /me`, `GET /usage`                                                                                                                                               |
| Contacts       | `GET /contacts`, `GET /contacts/{id}`, `POST /contacts`, `PUT` and `PATCH /contacts/{id}`, `DELETE /contacts/{id}`                                                    |
| Contact groups | `GET /contact-groups`, `POST /contact-groups`, `DELETE /contact-groups/{id}`                                                                                          |
| Deals          | `GET /deals`, `GET /deals/{id}`, `POST /deals`, `PUT` and `PATCH /deals/{id}`, `DELETE /deals/{id}`                                                                   |
| Templates      | `GET /templates`, `GET /templates/categories`, `GET /templates/{id}`, `POST /templates`, `PUT /templates/{id}`, `DELETE /templates/{id}`, `POST /templates/{id}/send` |
| Flows          | `GET /flows`, `GET /flows/{id}`, `POST /flows/{id}/enroll`, `GET /flows/{id}/subscribers`                                                                             |
| Broadcasts     | `POST /broadcasts`, `GET /broadcasts`, `GET /broadcasts/{id}`, `GET /broadcasts/{id}/recipients`, `POST /broadcasts/{id}/stop`                                        |
| Campaigns      | `GET /campaigns/statistics`, `GET /campaigns`, `POST /campaigns`, `GET /campaigns/{id}`, `POST /campaigns/{id}/stop`, `DELETE /campaigns/{id}`                        |
| Scheduled      | `POST /scheduled`, `GET /scheduled`, `GET /scheduled/{id}`, `DELETE /scheduled/{id}`                                                                                  |
| Messages       | `POST /messages`, `GET /messages`, `GET /messages/{id}`                                                                                                               |
| Media          | `POST /media`, `GET /media/{token}`                                                                                                                                   |
| Conversations  | `GET /conversations`, `GET /conversations/{id}/messages`                                                                                                              |
| Devices        | `GET /devices`, `GET /devices/{id}`                                                                                                                                   |

### Account

#### `GET /me`

Scope `account:read`. The workspace behind the key, its plan, limits and unlocked features.

```json
{
  "data": {
    "account": { "name": "Asha Rao", "email": "asha@acme.example" },
    "workspace": {
      "id": "5d1f7c0a-2e0c-4c0e-9a8e-1c3b8f7a9e10",
      "name": "Acme Retail",
      "slug": "acme-retail",
      "timezone": "Asia/Kolkata",
      "currency": "INR"
    },
    "plan": { "id": "growth", "name": "Growth", "is_free": false },
    "limits": {
      "monthly_messages_limit": 1000,
      "contacts_limit": 10000,
      "device_limit": 3,
      "user_seat_limit": 5,
      "flow_limit": null
    },
    "features": { "public_api": true, "sales_pipeline": true }
  }
}
```

`account` is the member who created the key. `limits` has Reference's five meters under its key names (`monthly_messages_limit`, `contacts_limit`, `device_limit`, `user_seat_limit`,
`flow_limit`); `null` is unlimited. The platform's other limits are not part of this contract. `features` lists
`<feature_key>: true` for every unlocked feature; a feature that is off is absent.

#### `GET /usage`

Scope `account:read`. The message cycle, plan validity, meters and wallet.

```json
{
  "data": {
    "period": { "label": "October 2026", "resets_on": "2026-11-01T00:00:00.000Z", "days_left": 26 },
    "plan": {
      "name": "Growth",
      "valid_until": "2027-03-01T00:00:00.000Z",
      "valid_until_days": 146
    },
    "messages": { "used": 120, "limit": 1000, "unlimited": false, "remaining": 880, "percent": 12 },
    "credits": "1250",
    "currency": "INR",
    "meters": {
      "contacts_limit": {
        "label": "Contacts",
        "used": 3,
        "limit": 10,
        "unlimited": false,
        "percent": 30
      }
    }
  }
}
```

Difference from Reference: `credits` is the wallet balance in minor units of `currency`, as a string (`"1250"` is 12.50). Reference
answered a credit count. `meters` has the same five keys as `limits`, labelled `Messages this month`, `Contacts`, `Connected numbers`, `Team seats` and `Flows`.
An uncapped message meter reports `limit: null`, `unlimited: true`, `remaining: null`.

### Contacts

A contact as the API shows it:

| Field        | Type            | Notes                                                     |
| ------------ | --------------- | --------------------------------------------------------- |
| `id`         | uuid            |                                                           |
| `name`       | string or null  | The display name.                                         |
| `phone`      | string or null  | `+` and digits only, whatever was stored.                 |
| `email`      | string or null  |                                                           |
| `tags`       | array           | The contact's groups: `[{ "id": uuid, "name": string }]`. |
| `attributes` | object          | Free-form attributes.                                     |
| `created_at` | ISO-8601 string |                                                           |

#### `GET /contacts`

Scope `contacts:read`. Newest first. Query: `limit`, `per_page`, `cursor`, and `search` (trimmed, up to 200 characters; matches name,
phone and email). A key sees the whole workspace, not only the records of the member who made it.

```json
{
  "data": [
    {
      "id": "c1d2e3f4-0a1b-4c2d-8e3f-5a6b7c8d9e0f",
      "name": "Alice Ray",
      "phone": "+919812345678",
      "email": "alice@example.test",
      "tags": [{ "id": "9f8e7d6c-5b4a-4392-8a1b-0c9d8e7f6a5b", "name": "VIP" }],
      "attributes": { "plan": "gold" },
      "created_at": "2026-10-01T09:00:00.000Z"
    }
  ],
  "meta": { "limit": 25, "next_cursor": null, "has_more": false }
}
```

#### `GET /contacts/{id}`

Scope `contacts:read`. One contact in the shape above. `404 not_found` for an unknown id, another workspace's contact or a non-uuid.

#### `POST /contacts`

Scope `contacts:write`. Creates a contact, or returns the one an identity already belongs to.

| Field             | Type           | Required             | Rules                                                                                              |
| ----------------- | -------------- | -------------------- | -------------------------------------------------------------------------------------------------- |
| `name`            | string         | Without `first_name` | Max 191. Blank is null.                                                                            |
| `first_name`      | string         | Without `name`       | Max 191.                                                                                           |
| `middle_name`     | string         | No                   | Max 191.                                                                                           |
| `last_name`       | string         | No                   | Max 191.                                                                                           |
| `title`           | string         | No                   | Max 50.                                                                                            |
| `phone`           | string         | Yes                  | Max 32. Normalised to E.164 with `country_code`; a value that is not a number is `422` on `phone`. |
| `country_code`    | string         | No                   | Max 10. Combined with a local `phone`.                                                             |
| `email`           | string         | No                   | A valid address, max 191.                                                                          |
| `language`        | string         | No                   | Max 80.                                                                                            |
| `address`         | string         | No                   | Max 1000.                                                                                          |
| `note`            | string         | No                   | Max 2000.                                                                                          |
| `group_ids`       | array of uuids | No                   | Each must be a group of this workspace; otherwise `422` on `group_ids.<index>`.                    |
| `attributes`      | object         | No                   | Free-form key/value pairs.                                                                         |
| `is_unsubscribed` | boolean        | No                   | Default false.                                                                                     |

When `name` is absent the display name is title, first, middle and last name joined by single spaces.

```json
{
  "first_name": "Ada",
  "last_name": "Lovelace",
  "title": "Dr",
  "phone": "+44 20 7946 0958",
  "email": "ada@example.test",
  "language": "en",
  "group_ids": ["9f8e7d6c-5b4a-4392-8a1b-0c9d8e7f6a5b"],
  "attributes": { "plan": "gold" }
}
```

`201`:

```json
{
  "data": {
    "id": "c1d2e3f4-0a1b-4c2d-8e3f-5a6b7c8d9e0f",
    "name": "Dr Ada Lovelace",
    "phone": "+442079460958",
    "email": "ada@example.test",
    "tags": [{ "id": "9f8e7d6c-5b4a-4392-8a1b-0c9d8e7f6a5b", "name": "VIP" }],
    "attributes": { "plan": "gold" },
    "created_at": "2026-10-06T10:15:00.000Z"
  },
  "meta": { "created": true }
}
```

Difference from Reference: when the phone or email already belongs to a contact the answer is that contact, untouched, with
`meta.created: false` and still `201`. The new request's title, address and groups are not applied to it. The contact is created
through the dashboard's service, so identity matching, the contacts plan cap (`402 plan_limit`), audit and the `contact.created`
event are the same as for a dashboard create; its source is `api`.

#### `PUT /contacts/{id}` and `PATCH /contacts/{id}`

Scope `contacts:write`. The same verb under two names: a partial update. Every field of `POST` is accepted and optional (`phone`
included); only keys present in the body change, and a key sent as `null` clears the field.

- `name` or `first_name` present: the display name is recomputed from the parts. An empty result keeps the old name.
- `phone` present: re-composed with the sent `country_code`, else the stored one.
- `group_ids` present: replaces the groups (`[]` clears them).
- `attributes` present: replaces the whole object (`{}` clears it).

Answers `200` with the contact (no `meta`). `404 not_found` for an unknown or foreign contact; `422` as for create. A lost
optimistic-lock race is retried once, so the client never sees a `409` from it.

#### `DELETE /contacts/{id}`

Scope `contacts:write`. `200`:

```json
{ "data": { "id": "c1d2e3f4-0a1b-4c2d-8e3f-5a6b7c8d9e0f", "deleted": true } }
```

A repeat, an unknown id or another workspace's contact is `404 not_found`.

### Contact groups

A group: `id`, `name`, `note` (string or null), `color` (string or null), `contacts_count` (integer), `created_at`.

#### `GET /contact-groups`

Scope `contact-groups:read`. Every group, newest first, not paged. `meta` is `{ "count": 2 }`.

```json
{
  "data": [
    {
      "id": "9f8e7d6c-5b4a-4392-8a1b-0c9d8e7f6a5b",
      "name": "VIP",
      "note": "Top customers",
      "color": "#7C3AED",
      "contacts_count": 12,
      "created_at": "2026-09-20T07:00:00.000Z"
    }
  ],
  "meta": { "count": 1 }
}
```

#### `POST /contact-groups`

Scope `contact-groups:write`.

| Field   | Type   | Required | Rules                                                              |
| ------- | ------ | -------- | ------------------------------------------------------------------ |
| `name`  | string | yes      | Max 191.                                                           |
| `note`  | string | no       | Max 500.                                                           |
| `color` | string | no       | A hex colour such as `#7C3AED` (Reference took any 32 characters). |

```json
{ "name": "VIP", "note": "Top customers", "color": "#7C3AED" }
```

`201` answers the group with `contacts_count: 0`. Difference from Reference: a name the workspace already has (compared ignoring
case) answers that group with `200` and `meta: { "existing": true }` instead of making a twin. `422` for a missing name, a name over
191 characters and a colour that is not hex.

#### `DELETE /contact-groups/{id}`

Scope `contact-groups:write`. Deletes the group; its contacts are detached and kept. `200`: `{ "data": { "id": "…", "deleted": true } }`.
`404 not_found` for an unknown, foreign or repeated id.

### Deals

Every deals route needs the plan feature `sales_pipeline` (`403 plan_feature_disabled`), checked before validation and before any
lookup, so a bad body or unknown id on a plan without it is still `403`. Reference let a platform admin who owned the key bypass the
plan; a key here has no role, so that bypass is not carried over.

A deal:

| Field                      | Type                  | Notes                                                             |
| -------------------------- | --------------------- | ----------------------------------------------------------------- |
| `id`                       | uuid                  |                                                                   |
| `title`                    | string                |                                                                   |
| `pipeline_id`              | uuid                  |                                                                   |
| `stage_id`                 | uuid                  |                                                                   |
| `stage`                    | string or null        | Stage name.                                                       |
| `status`                   | `open`, `won`, `lost` | Follows the stage.                                                |
| `value`                    | number                | Major units; a whole number when the minor amount divides evenly. |
| `value_minor`              | integer               | Minor units (value times 100).                                    |
| `currency`                 | string                | Three-letter code.                                                |
| `contact_id`               | uuid or null          |                                                                   |
| `owner_user_id`            | uuid or null          |                                                                   |
| `source`                   | string                | `api` for a deal created here.                                    |
| `expected_close_date`      | string or null        | `YYYY-MM-DD`.                                                     |
| `lost_reason`              | string or null        |                                                                   |
| `won_at`, `lost_at`        | ISO-8601 or null      |                                                                   |
| `created_at`, `updated_at` | ISO-8601              |                                                                   |

#### `GET /deals`

Scope `deals:read`. Newest first. Query: `limit`, `per_page`, `cursor`, `pipeline_id`, `stage_id`, `status`. As in Reference the filters
are not validated: a value that matches nothing (an unknown status, a non-uuid id) is an empty list, not an error.

#### `GET /deals/{id}`

Scope `deals:read`. One deal. `404 not_found` for an unknown, foreign or malformed id.

#### `POST /deals`

Scope `deals:write`.

| Field                 | Type             | Required | Rules                                                                                                     |
| --------------------- | ---------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| `title`               | string           | yes      | Max 191.                                                                                                  |
| `pipeline_id`         | uuid             | no       | An unknown or foreign pipeline falls back to the default pipeline.                                        |
| `stage_id`            | uuid             | no       | An unknown stage falls back to the pipeline's first stage. A won or lost stage sets the status and stamp. |
| `value`               | number or string | no       | 0 to 99999999, major units. Typed text is kept so money is never rounded through a float.                 |
| `currency`            | string           | no       | Three letters; upper-cased.                                                                               |
| `contact_id`          | uuid             | no       | An unknown contact is ignored (the deal is created unlinked).                                             |
| `owner_user_id`       | uuid             | no       | A member of the workspace; a foreign or malformed value is `422` on `owner_user_id`. Omitted: no owner.   |
| `expected_close_date` | string           | no       | Any parseable date; kept as the calendar day (UTC).                                                       |

```json
{
  "title": "Annual plan, Acme Retail",
  "value": 12.5,
  "currency": "usd",
  "contact_id": "c1d2e3f4-0a1b-4c2d-8e3f-5a6b7c8d9e0f",
  "expected_close_date": "2026-12-31"
}
```

`201` (no `meta`):

```json
{
  "data": {
    "id": "3a4b5c6d-7e8f-4091-a2b3-c4d5e6f70819",
    "title": "Annual plan, Acme Retail",
    "pipeline_id": "e1f2a3b4-c5d6-4e7f-8091-a2b3c4d5e6f7",
    "stage_id": "f2a3b4c5-d6e7-4f80-91a2-b3c4d5e6f708",
    "stage": "New Lead",
    "status": "open",
    "value": 12.5,
    "value_minor": 1250,
    "currency": "USD",
    "contact_id": "c1d2e3f4-0a1b-4c2d-8e3f-5a6b7c8d9e0f",
    "owner_user_id": null,
    "source": "api",
    "expected_close_date": "2026-12-31",
    "lost_reason": null,
    "won_at": null,
    "lost_at": null,
    "created_at": "2026-10-06T10:20:00.000Z",
    "updated_at": "2026-10-06T10:20:00.000Z"
  }
}
```

`422` on `title` (missing or over 191), `value` (negative or over 99999999), `currency` (not three letters), `owner_user_id`.
`422 unprocessable` when the pipeline has no stages.

#### `PUT /deals/{id}` and `PATCH /deals/{id}`

Scope `deals:write`. Same verb under two names: only the keys present change.

| Field                 | Type             | Rules                                                                                                                                                                                                                                                  |
| --------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `title`               | string           | 1 to 191; present means it must not be empty.                                                                                                                                                                                                          |
| `value`               | number or string | 0 to 99999999. Sent as `null` it becomes 0.                                                                                                                                                                                                            |
| `currency`            | string           | Three letters. With `value` it relabels both; alone it relabels the amount (Reference's behaviour).                                                                                                                                                    |
| `stage_id`            | uuid             | **Strict**: must be a stage of the deal's own pipeline, else `422 unprocessable`. A new stage moves the deal, runs the stage engine (status and won/lost stamps follow, one timeline row, `deal.stage_changed`). The same stage again is not a change. |
| `contact_id`          | uuid             | Lenient: an unknown or blank value unlinks the contact.                                                                                                                                                                                                |
| `owner_user_id`       | uuid             | A blank value clears the owner; a malformed one is `422`.                                                                                                                                                                                              |
| `expected_close_date` | string           | Any parseable date; `null` clears it.                                                                                                                                                                                                                  |
| `lost_reason`         | string           | Max 191. A move into a lost stage keeps the reason sent with it. On an already lost deal it replaces the reason. On an open or won deal it is not kept (the status rules forbid a reason there; Reference stored it).                                  |

The deal is looked up first and the body validated second, so an unknown id with a bad body is `404`. Answers `200` with the deal.

#### `DELETE /deals/{id}`

Scope `deals:write`. Deletes the deal and its timeline. `200`: `{ "data": { "id": "…", "deleted": true } }`.

### Templates

A template as the API shows it. `GET /templates` answers only sendable templates (approved locally with a Meta id, Meta status
APPROVED, not paused, and its number still connected); `GET /templates/{id}` answers any template whatever its state.

| Field                      | Type           | Notes                                                                                                          |
| -------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------- |
| `id`                       | uuid           |                                                                                                                |
| `name`                     | string         |                                                                                                                |
| `type`                     | string         | `standard`, `media`, `auth`, ...                                                                               |
| `category`                 | string or null | Lower case Meta category: `marketing`, `authentication`, `utility`.                                            |
| `language`                 | string         | For example `en_US`.                                                                                           |
| `header`                   | string or null |                                                                                                                |
| `header_location`          | object or null | Always `null` until the template domain stores locations.                                                      |
| `body`                     | string         | With positional variables `{{1}}`, `{{2}}`.                                                                    |
| `footer`                   | string or null |                                                                                                                |
| `buttons`                  | array          | `{ "type": "visit_website" or "call_phone" or "quick_reply", "text", "value" }`; a quick reply has no `value`. |
| `carousel_data`            | array          | Always `[]` for now.                                                                                           |
| `attachment_type`          | string or null | `image`, `video`, `audio`, `document`, `location`.                                                             |
| `status`                   | string         | `draft`, `approved`, `pending`, ...                                                                            |
| `created_at`, `updated_at` | ISO-8601       |                                                                                                                |

Meta ids, quality score, variable map and provider config are not exposed.

#### `GET /templates`

Scope `templates:read`. Sendable templates, newest first. Query: `limit`, `per_page`, `cursor`. See the note on short pages in
section 4.

```json
{
  "data": [
    {
      "id": "7c6f2b1a-9d3e-4f5a-8b7c-1e2d3c4b5a69",
      "name": "order_ready",
      "type": "standard",
      "category": "utility",
      "language": "en_US",
      "header": null,
      "header_location": null,
      "body": "Hi {{1}}, your order {{2}} is ready.",
      "footer": "Thanks",
      "buttons": [
        { "type": "visit_website", "text": "Open", "value": "https://shop.example.com" },
        { "type": "quick_reply", "text": "Yes" }
      ],
      "carousel_data": [],
      "attachment_type": null,
      "status": "approved",
      "created_at": "2026-09-01T08:00:00.000Z",
      "updated_at": "2026-09-02T08:00:00.000Z"
    }
  ],
  "meta": { "limit": 25, "next_cursor": null, "has_more": false }
}
```

#### `GET /templates/categories`

Scope `templates:read`. The ids `category` accepts. No `meta`.

```json
{
  "data": [
    { "id": 1, "name": "Marketing" },
    { "id": 2, "name": "Authentication" },
    { "id": 3, "name": "Utility" }
  ]
}
```

#### `GET /templates/{id}`

Scope `templates:read`. One template, any state. `404 not_found` (`Template not found.`) for an unknown, foreign or non-uuid id.

#### `POST /templates`

Scope `templates:write`. Honours `Idempotency-Key`. Saves a **draft**; it is never submitted to Meta (Reference's create did not talk
to Meta either).

| Field                     | Type               | Required                           | Rules                                                                                                                                           |
| ------------------------- | ------------------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `template_name`           | string             | yes                                | Trimmed, 1 to 191. Stored in Meta's form (`Order Update` becomes `order_update`).                                                               |
| `template_type`           | string             | no                                 | `standard`, `carousel`, `media`, `auth`. Omitted is treated as standard.                                                                        |
| `category`                | string or number   | yes                                | Meta id 1, 2 or 3, a Meta slug (any case), or an industry bucket; anything unrecognised is stored as utility.                                   |
| `template_body`           | string             | When `template_type` is `standard` | Max 4096. QUIRK kept: with the type omitted the body is not required and is stored empty.                                                       |
| `header`                  | string             | no                                 | Max 255.                                                                                                                                        |
| `footer`                  | string             | no                                 | Max 255.                                                                                                                                        |
| `language`                | string             | no                                 | Max 16. Default `en_US`.                                                                                                                        |
| `buttons`                 | array or JSON text | no                                 | Call-to-action buttons: `{ "type": "visit_website" or "call_phone", "text", "value", "country_code" }`. Items that are not objects are skipped. |
| `quick_replies`           | array or JSON text | no                                 | Strings or `{ "text" }`. Blank ones are dropped.                                                                                                |
| `code_expiration_minutes` | integer            | no                                 | 1 to 90 (authentication templates).                                                                                                             |
| `carousel_data`           | array or JSON text | no                                 | Not storable yet: a non-empty value is `422`.                                                                                                   |
| `latitude`                | number             | With `longitude`                   | -90 to 90. Not storable yet: any value is `422` on `latitude`.                                                                                  |
| `longitude`               | number             | With `latitude`                    | -180 to 180.                                                                                                                                    |
| `location_name`           | string             | no                                 | Max 191.                                                                                                                                        |
| `location_address`        | string             | no                                 | Max 255.                                                                                                                                        |

Only the first three buttons are kept, call-to-action buttons first and then quick replies; extras are dropped silently, as in
Reference. Body variables written by name (`{{name}}`) are stored as positional (`{{1}}`) with a variable map.

```json
{
  "template_name": "Order Update",
  "category": 3,
  "template_body": "Hi {{name}}, your order {{city}} is ready.",
  "footer": "Acme",
  "buttons": [
    { "type": "visit_website", "text": "Track", "value": "https://shop.example.com/track" }
  ],
  "quick_replies": ["Thanks"]
}
```

`201`:

```json
{
  "data": {
    "id": "7c6f2b1a-9d3e-4f5a-8b7c-1e2d3c4b5a69",
    "name": "order_update",
    "type": "standard",
    "category": "utility",
    "language": "en_US",
    "header": null,
    "header_location": null,
    "body": "Hi {{1}}, your order {{2}} is ready.",
    "footer": "Acme",
    "buttons": [
      { "type": "visit_website", "text": "Track", "value": "https://shop.example.com/track" },
      { "type": "quick_reply", "text": "Thanks" }
    ],
    "carousel_data": [],
    "attachment_type": null,
    "status": "draft",
    "created_at": "2026-10-06T10:30:00.000Z",
    "updated_at": "2026-10-06T10:30:00.000Z"
  }
}
```

The template is authored on the workspace's primary WhatsApp number (Reference's create named none). Errors: `422 validation_failed`
with `details` per field; `422 tpl_no_connection` without a WhatsApp number; `409 tpl_name_taken`; `402 plan_limit` at the
template cap; `422 validation_failed` on `template_type` or `carousel_data` for a carousel and on `latitude` for a location header
(the message ends `is not supported by this API yet.`).

#### `PUT /templates/{id}`

Scope `templates:write`. Honours `Idempotency-Key`. A replacement of the text fields: same fields as create, with `template_body`
always required. An omitted `header`, `footer` or `code_expiration_minutes` clears it; `language`, `template_type`, the buttons
(unless `buttons` or `quick_replies` is sent; an empty list clears them) and the stored header file are kept. No `rowVersion` is
needed. Answers `200` with the template.

Difference from Reference: a template Meta has approved is refused (`409 tpl_not_editable`), because editing approved text would
diverge from what Meta holds. Reference allowed it. The body is validated before the template is looked up, so an unknown id with an
empty body is `422`, with a valid body `404`.

#### `DELETE /templates/{id}`

Scope `templates:write`. `200`:

```json
{ "data": { "deleted": true, "message": "Template deleted successfully" } }
```

`404 not_found` for an unknown or foreign id.

#### `POST /templates/{id}/send`

Scope `templates:write`. Honours `Idempotency-Key`. JSON or multipart. Queues one template to one number through the inbox's
outbound pipeline (stored `queued`, sent by the worker, which owns the emergency halt, the plan message cap and the wallet).

| Field              | Type                                  | Required | Rules                                                                                                                                                                             |
| ------------------ | ------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `to`               | string                                | yes      | Max 32. Every non-digit is stripped.                                                                                                                                              |
| `body`             | array or object of strings            | no       | Variable values by position: a list, or a 1-indexed map (sorted by number, then re-indexed). Each a string up to 1024; numbers and booleans are refused. In multipart, JSON text. |
| `header_text`      | string                                | no       | Max 1024. Not available yet: `422`.                                                                                                                                               |
| `header_media_url` | string (URL)                          | no       | Not available yet: `422`.                                                                                                                                                         |
| `header_filename`  | string                                | no       | Max 255. Not available yet: `422`.                                                                                                                                                |
| `buttons`          | array of `{ index, sub_type, value }` | no       | Dynamic button values. Not available yet: a non-empty list is `422`.                                                                                                              |
| `header_media`     | file (multipart)                      | no       | Up to 16384 KB. The platform's upload guard runs first (before the template lookup); a stored header file is not available yet, so a file that passes is `422` on `header_media`. |

```json
{ "to": "+91 98112-00555", "body": { "1": "Ana", "2": "B-42" } }
```

`202`:

```json
{
  "data": {
    "message_id": "b7a6c5d4-e3f2-4a1b-9c8d-7e6f5a4b3c2d",
    "wamid": null,
    "status": "queued",
    "template_id": "7c6f2b1a-9d3e-4f5a-8b7c-1e2d3c4b5a69",
    "template_name": "order_ready",
    "to": "919811200555"
  }
}
```

`wamid` is null because the send is queued: poll `GET /messages/{message_id}` for the provider's outcome. The recipient becomes a
contact only after every check has passed, so a refused send leaves no contact behind.

Errors, in the order Reference checks: `422 unsupported_media_type` or `422 validation_failed` on `header_media`; `404 template_not_found`;
`422 not_approved`, `paused`, `quality_floor`, `unsupported_template` (all carry `details.template_id`); `422 validation_failed` for
the not-yet-available fields; `422 missing_header_media`; `422 no_provider`; `422 validation_failed` on `to`;
`402 plan_limit` at the contact cap.

### Flows

A flow: `id`, `name`, `trigger` (string or null), `status` (`draft`, `live` or `paused`), `category` (string or null),
`subscribers_count` (integer), `created_at`, `updated_at`. The signed `GET /public/v1/flows` of the flow runtime is a different
surface and is unchanged.

#### `GET /flows`

Scope `flows:read`. Most recently updated first. Query: `limit`, `per_page`, `cursor`. `422` for a cursor that is not one of ours.

```json
{
  "data": [
    {
      "id": "d4c3b2a1-f0e9-4d8c-b7a6-5e4d3c2b1a09",
      "name": "Welcome journey",
      "trigger": "new_contact",
      "status": "live",
      "category": "onboarding",
      "subscribers_count": 42,
      "created_at": "2026-08-10T06:00:00.000Z",
      "updated_at": "2026-10-04T11:30:00.000Z"
    }
  ],
  "meta": { "limit": 25, "next_cursor": null, "has_more": false }
}
```

#### `GET /flows/{id}`

Scope `flows:read`. One flow. `404 not_found` (`Flow not found.`).

#### `POST /flows/{id}/enroll`

Scope `flows:write`. Honours `Idempotency-Key`. Enrols one contact.

| Field        | Type   | Required             | Rules                                                 |
| ------------ | ------ | -------------------- | ----------------------------------------------------- |
| `contact_id` | uuid   | Without `phone`      | A contact of this workspace. Wins when both are sent. |
| `phone`      | string | Without `contact_id` | Max 32. The contact is found by its number.           |

```json
{ "phone": "+91 98112 00001" }
```

`201`:

```json
{
  "data": {
    "flow_id": "d4c3b2a1-f0e9-4d8c-b7a6-5e4d3c2b1a09",
    "contact_id": "c1d2e3f4-0a1b-4c2d-8e3f-5a6b7c8d9e0f",
    "subscriber_id": "a9b8c7d6-e5f4-4a3b-8c2d-1e0f9a8b7c6d",
    "status": "active",
    "enrolled_at": "2026-10-06T10:40:00.000Z",
    "failure_reason": null
  }
}
```

`status` is `active`, `paused`, `completed` or `failed`. A launch that failed (no connected sender, no usable number) still answers
`201` with `status: "failed"`, as Reference did, and unlike Reference says why in `failure_reason`. Enrolling the same contact twice returns
the same subscriber and makes no second row. Errors: `422 validation_failed` (neither field sent; `details` names both),
`404 not_found` (flow), `404 contact_not_found`, `422 flow_inactive` (a paused flow; a draft that is active proceeds).

#### `GET /flows/{id}/subscribers`

Scope `flows:read`. A flow's subscribers, newest first. Query: `limit` or `per_page` (default 100, 1 to 200), `cursor`.

```json
{
  "data": [
    {
      "id": "a9b8c7d6-e5f4-4a3b-8c2d-1e0f9a8b7c6d",
      "contact_id": "c1d2e3f4-0a1b-4c2d-8e3f-5a6b7c8d9e0f",
      "contact_name": "Asha",
      "contact_phone": "919811300006",
      "status": "completed",
      "enrolled_at": "2026-10-06T10:40:00.000Z",
      "failed_at": null,
      "failure_reason": null
    }
  ],
  "meta": {
    "count": 1,
    "counts": { "active": 4, "paused": 0, "completed": 2, "failed": 1 },
    "limit": 100,
    "next_cursor": null,
    "has_more": false
  }
}
```

`meta.count` is the length of this page; `meta.counts` is over all of the flow's subscribers. A contact with no name is shown as `#`
followed by its id. `422` for a cursor that is not numeric.

### Broadcasts

A broadcast:

| Field                      | Type             | Notes                                                                                                                                                             |
| -------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                       | uuid             |                                                                                                                                                                   |
| `name`                     | string           |                                                                                                                                                                   |
| `status`                   | string           | For example `scheduled`, `processing`, `paused`, `completed`, `cancelled`.                                                                                        |
| `template_id`              | uuid or null     |                                                                                                                                                                   |
| `device_id`                | string or null   | The sender key `<engine>:<uuid>`; null when the broadcast has no sender of its own.                                                                               |
| `total_recipients`         | integer          |                                                                                                                                                                   |
| `counts`                   | object           | `sent`, `delivered`, `read`, `failed`, `clicked`, `pending`. Counts cascade: sent includes delivered includes read. `pending` is what is neither sent nor failed. |
| `scheduled_at`             | ISO-8601 or null |                                                                                                                                                                   |
| `completed_at`             | ISO-8601 or null |                                                                                                                                                                   |
| `created_at`, `updated_at` | ISO-8601         |                                                                                                                                                                   |

#### `POST /broadcasts`

Scope `broadcasts:write`; plan feature `public_api`. Runs the same plan, audience, wallet, template and warmer checks as the
dashboard's "new broadcast" form.

| Field         | Type           | Required             | Rules                                                                                                                                                                                                                   |
| ------------- | -------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | string         | yes                  | Trimmed, 1 to 255.                                                                                                                                                                                                      |
| `template_id` | uuid           | yes                  | A template of this workspace, else `422 invalid_template`.                                                                                                                                                              |
| `recipients`  | array of uuids | Without `group_id`   | Contact ids, up to 100000. Ids that are not the workspace's are dropped without a word.                                                                                                                                 |
| `group_id`    | uuid           | Without `recipients` | A group of this workspace, else `422 invalid_group`. Its members are the audience, once each.                                                                                                                           |
| `device_id`   | string         | no                   | Max 80. `<engine>:<uuid>` or a bare uuid of a connected sender. One that does not resolve is ignored: the broadcast has no sender (Reference).                                                                          |
| `schedule_at` | string         | no                   | A date and time such as `2026-12-01 09:00` or `2026-12-01T09:00:00+05:30`. Only its wall-clock date and time are kept; an offset inside the text does not move them. A time in the past is accepted. Omitted: send now. |
| `timezone`    | string         | no                   | IANA zone in which `schedule_at` is read. Default UTC. An unknown zone is `422`.                                                                                                                                        |

```json
{
  "name": "Diwali offer",
  "template_id": "7c6f2b1a-9d3e-4f5a-8b7c-1e2d3c4b5a69",
  "recipients": ["c1d2e3f4-0a1b-4c2d-8e3f-5a6b7c8d9e0f", "d2e3f4a5-1b2c-4d3e-9f40-6b7c8d9e0f1a"],
  "schedule_at": "2026-11-08 09:00",
  "timezone": "Asia/Kolkata"
}
```

`201`:

```json
{
  "data": {
    "id": "4e5f6a7b-8c9d-4e0f-a1b2-c3d4e5f6a7b8",
    "name": "Diwali offer",
    "status": "scheduled",
    "template_id": "7c6f2b1a-9d3e-4f5a-8b7c-1e2d3c4b5a69",
    "device_id": null,
    "total_recipients": 2,
    "counts": { "sent": 0, "delivered": 0, "read": 0, "failed": 0, "clicked": 0, "pending": 2 },
    "scheduled_at": "2026-11-08T03:30:00.000Z",
    "completed_at": null,
    "created_at": "2026-10-06T10:45:00.000Z",
    "updated_at": "2026-10-06T10:45:00.000Z"
  },
  "meta": { "broadcast_ids": ["4e5f6a7b-8c9d-4e0f-a1b2-c3d4e5f6a7b8"], "devices_count": 1 }
}
```

`data` is the first broadcast created. With one sender there is one broadcast; the dashboard's multi-sender split is not reachable
through `device_id`, but `meta.broadcast_ids` and `meta.devices_count` keep the shape open. Errors: `422 validation_failed` (neither
`recipients` nor `group_id`, with `details.recipients`; a bad `schedule_at` with `details.schedule_at`; an unknown zone);
`422 no_recipients` (no sendable contact: another workspace's, opted out or archived); `422 invalid_template`; `422 invalid_group`;
`402 plan_limit` at the broadcast cap (Reference: 422 `plan_limit_reached`); `bcast_template_not_allowed`, `bcast_send_blocked`,
`bcast_warmer_hold`, `auth_send_halted`, `auth_send_blocked` from the broadcast domain.

#### `GET /broadcasts`

Scope `broadcasts:read`. Newest first. Query: `limit`, `per_page`, `cursor`, `status` (exact match, not validated: an unknown status
is an empty list). Each item has the shape above, counts from the stored counters.

#### `GET /broadcasts/{id}`

Scope `broadcasts:read`. One broadcast with live counts computed from its recipient rows (so the answer never lags a webhook).
`404 not_found` for a missing, foreign or malformed id.

#### `GET /broadcasts/{id}/recipients`

Scope `broadcasts:read`. Query: `limit`, `per_page`, `cursor`. No phone number is ever shown.

```json
{
  "data": [
    {
      "contact_id": "c1d2e3f4-0a1b-4c2d-8e3f-5a6b7c8d9e0f",
      "status": "failed",
      "error": "Number is not on WhatsApp",
      "wa_message_id": null,
      "sent_at": null,
      "delivered_at": null,
      "read_at": null
    }
  ],
  "meta": {
    "limit": 25,
    "next_cursor": null,
    "has_more": false,
    "stats": { "sent": 0, "delivered": 0, "read": 0, "failed": 1, "processing": 0, "queued": 2 }
  }
}
```

`status` defaults to `pending`.

#### `POST /broadcasts/{id}/stop`

Scope `broadcasts:write`. Stops a `scheduled`, `processing` or `paused` broadcast (`paused` is added: it is in flight and would
otherwise be stuck). Answers `200` with the broadcast (`status: "cancelled"`, `completed_at` set). The sender stops at its next pass;
recipient rows stay `pending` and no credit is refunded (as Reference). Any other status is `422 not_stoppable` and is left unchanged.
Audited, with a status event carrying the previous status.

### Campaigns

A campaign:

| Field                                      | Type                                  | Notes                                                                                                                                                                |
| ------------------------------------------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                       | uuid                                  |                                                                                                                                                                      |
| `name`                                     | string                                |                                                                                                                                                                      |
| `type`                                     | string                                | `custom`, `template`, `flow`.                                                                                                                                        |
| `status`                                   | string                                | `scheduled`, `running`, `paused`, `completed`, `failed`, `stopped`. Our `cancelled` is Reference's `stopped` and is spelled that way on the wire, in the filter too. |
| `device_id`                                | string or null                        | The sender key `<engine>:<uuid>`.                                                                                                                                    |
| `template_id`                              | uuid or null                          |                                                                                                                                                                      |
| `flow_id`                                  | uuid or null                          |                                                                                                                                                                      |
| `ab_testing`                               | boolean                               |                                                                                                                                                                      |
| `ab_split`                                 | integer                               | Split between the two A/B variants, 10 to 90 (default 50).                                                                                                           |
| `counts`                                   | object                                | `total_recipients`, `sent`, `delivered`, `read`, `failed`, `clicked`, `responded`.                                                                                   |
| `metrics`                                  | object                                | `delivery_rate`, `read_rate`, `click_rate`, `response_rate`: percentages rounded to two decimals.                                                                    |
| `schedule_type`                            | string                                | `now`, `scheduled`, `recurring`.                                                                                                                                     |
| `scheduled_for`                            | ISO-8601 or null                      | The send date and time as the instant they mean in `timezone`.                                                                                                       |
| `timezone`                                 | string or null                        |                                                                                                                                                                      |
| `created_at`, `updated_at`, `completed_at` | ISO-8601 (`completed_at` may be null) |                                                                                                                                                                      |

#### `GET /campaigns/statistics`

Scope `campaigns:read`. The workspace rollup. Registered before `{id}`, so `statistics` is never read as an id.

```json
{
  "data": {
    "campaigns": { "total": 8, "active": 1, "completed": 5, "scheduled": 1, "failed": 1 },
    "messages": {
      "total_recipients": 1200,
      "sent": 1100,
      "delivered": 1050,
      "read": 700,
      "failed": 100,
      "clicked": 90,
      "responded": 40
    },
    "rates": {
      "delivery_rate": 95.45,
      "read_rate": 66.67,
      "click_rate": 8.18,
      "response_rate": 3.64
    }
  }
}
```

`active` counts running campaigns (Reference counted only `processing`, which a new campaign never was).

#### `GET /campaigns`

Scope `campaigns:read`. Newest first. Query: `limit`, `per_page`, `cursor`, `status` (use `stopped` for stopped campaigns),
`campaign_type`, `search` (case-insensitive substring of the name, up to 100 characters).

#### `POST /campaigns`

Scope `campaigns:write`; plan feature `public_api`. Creates and dispatches a campaign through the dashboard's service.

| Field                            | Type             | Required                         | Rules                                                                                                                                                                                                                               |
| -------------------------------- | ---------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `campaign_name`                  | string           | yes                              | Trimmed, 1 to 255; the inner form accepts 191 (`422 create_failed` over that).                                                                                                                                                      |
| `device_id`                      | string           | yes                              | Max 80. `<engine>:<uuid>` or a bare uuid of a connected sender of this workspace; otherwise `422 create_failed` on `device_id`.                                                                                                     |
| `campaign_type`                  | string           | yes                              | `custom`, `template` or `flow`.                                                                                                                                                                                                     |
| `schedule_type`                  | string           | yes                              | `now`, `later` or `recurring`. `later` is stored as `scheduled`; `recurring` is weekly with no end and needs no start (it first fires on the next sweep).                                                                           |
| `template_id`                    | uuid             | For a template campaign          |                                                                                                                                                                                                                                     |
| `template_id_a`, `template_id_b` | uuid             | For A/B testing                  | Variant templates.                                                                                                                                                                                                                  |
| `flow_id`                        | uuid             | For a flow campaign              |                                                                                                                                                                                                                                     |
| `custom_message`                 | string           | When `campaign_type` is `custom` | Max 4096.                                                                                                                                                                                                                           |
| `send_date`                      | string           | When `schedule_type` is `later`  | `YYYY-MM-DD`.                                                                                                                                                                                                                       |
| `send_time`                      | string           | When `schedule_type` is `later`  | `HH:mm` (24 hour) or `h:mm AM`.                                                                                                                                                                                                     |
| `timezone`                       | string           | no                               | IANA zone. An unknown one is `422 create_failed` on `timezone`.                                                                                                                                                                     |
| `ab_testing`                     | boolean          | no                               | Default false.                                                                                                                                                                                                                      |
| `ab_split`                       | integer          | no                               | 10 to 90, default 50.                                                                                                                                                                                                               |
| `contacts`                       | array of strings | yes                              | 1 to 100000 phone numbers in any formatting. Fewer than 8 digits are dropped, duplicates collapse, the rest become workspace contacts (an existing one in another format is reused; a new one is named after its last four digits). |

```json
{
  "campaign_name": "Diwali offer",
  "device_id": "baileys:4ce2a1b0-7d3e-4f5a-8b7c-1e2d3c4b5a69",
  "campaign_type": "custom",
  "schedule_type": "now",
  "custom_message": "Hello from Acme: 20% off this week.",
  "contacts": ["+91 98123 45678", "+91 98123 45679"]
}
```

`201` answers the stored row, with counts and rates all 0 (even the audience) and `scheduled_for` null; a read right after has the
real numbers. Reference behaved the same and it is kept on purpose.

```json
{
  "data": {
    "id": "5f6a7b8c-9d0e-4f1a-b2c3-d4e5f6a7b8c9",
    "name": "Diwali offer",
    "type": "custom",
    "status": "running",
    "device_id": "baileys:4ce2a1b0-7d3e-4f5a-8b7c-1e2d3c4b5a69",
    "template_id": null,
    "flow_id": null,
    "ab_testing": false,
    "ab_split": 50,
    "counts": {
      "total_recipients": 0,
      "sent": 0,
      "delivered": 0,
      "read": 0,
      "failed": 0,
      "clicked": 0,
      "responded": 0
    },
    "metrics": { "delivery_rate": 0, "read_rate": 0, "click_rate": 0, "response_rate": 0 },
    "schedule_type": "now",
    "scheduled_for": null,
    "timezone": null,
    "created_at": "2026-10-06T11:00:00.000Z",
    "updated_at": "2026-10-06T11:00:00.000Z",
    "completed_at": null
  }
}
```

Errors: `422 validation_failed` (the contract rules above, with `details`); `422 create_failed` for everything the dashboard's rules
refuse (unknown sender, name over 191, bad zone, a template of another workspace or an authentication template, no recipients, expiry
before send; `details` names the field); `402 plan_limit` at the campaign cap.

#### `GET /campaigns/{id}`

Scope `campaigns:read`. One campaign with numbers brought in line with the recipient rows. `meta` repeats the counts and gives the
rates **unrounded** (Reference QUIRK, kept): `data.metrics.read_rate` is `33.33` where `meta.metrics.read_rate` is `33.3333...`.

```json
{
  "data": {
    "id": "5f6a7b8c-9d0e-4f1a-b2c3-d4e5f6a7b8c9",
    "status": "completed",
    "counts": { "total_recipients": 4, "sent": 3 },
    "...": "..."
  },
  "meta": {
    "counts": {
      "total": 4,
      "sent": 3,
      "delivered": 3,
      "read": 1,
      "failed": 1,
      "clicked": 0,
      "responded": 0
    },
    "metrics": { "delivery_rate": 100, "read_rate": 33.3333, "click_rate": 0, "response_rate": 0 }
  }
}
```

(`data` is the full object above; abbreviated here.) `meta.counts.total` is the audience size.

#### `POST /campaigns/{id}/stop`

Scope `campaigns:write`. Stops a `running`, `scheduled` or `paused` campaign (Reference refused a campaign it had just launched). `200`
with the campaign: `status: "stopped"` and `completed_at` set. Any other status is `422 not_stoppable`.

#### `DELETE /campaigns/{id}`

Scope `campaigns:write`. Deletes a `scheduled`, `failed`, `completed` or `stopped` campaign and its recipients (Reference refused a
stopped one). `200`: `{ "data": { "deleted": true, "message": "Campaign deleted." } }`. A running or paused campaign is
`422 delete_failed`. `404 not_found` for a missing, foreign or malformed id on show, stop and delete.

### Scheduled

A scheduled message:

| Field                                           | Type             | Notes                                                                |
| ----------------------------------------------- | ---------------- | -------------------------------------------------------------------- |
| `id`                                            | uuid             |                                                                      |
| `name`                                          | string           |                                                                      |
| `type`                                          | string           | `text`, or `template` when it was made from a template.              |
| `status`                                        | string           | `scheduled`, `cancelled`, `completed`, `failed`, ...                 |
| `message`                                       | string or null   | Null in a list item.                                                 |
| `template_id`                                   | uuid or null     |                                                                      |
| `device_id`                                     | string or null   | The sender key.                                                      |
| `recipient_count`                               | integer          | Phone numbers are never part of the answer, only how many there are. |
| `run_at`                                        | ISO-8601         |                                                                      |
| `next_run_at`                                   | ISO-8601 or null |                                                                      |
| `timezone`                                      | string           |                                                                      |
| `total_sent`, `total_delivered`, `total_failed` | integer          |                                                                      |
| `created_at`                                    | ISO-8601         |                                                                      |

#### `POST /scheduled`

Scope `scheduled:write`; plan feature `public_api`. The plan feature and limit, the send gate (halt, content screen, wallet), the
warmer's budget and the two-minute lead are the dashboard service's, stricter than Reference's API, which checked none of them at
scheduling time.

| Field         | Type             | Required              | Rules                                                                                                                                               |
| ------------- | ---------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | string           | yes                   | Trimmed, 1 to 255.                                                                                                                                  |
| `message`     | string           | Without `template_id` | Max 4096.                                                                                                                                           |
| `template_id` | uuid             | Without `message`     | A template of this workspace, else `404 template_not_found`.                                                                                        |
| `recipients`  | array of strings | yes                   | 1 to 5000 phone numbers; reduced to digits, empty ones dropped, duplicates collapse, no minimum length.                                             |
| `run_at`      | string           | yes                   | A date and time, read in `timezone` unless it carries its own offset. At least two minutes ahead.                                                   |
| `timezone`    | string           | no                    | IANA zone. Default `UTC`. An unknown zone is `422 schedule_failed` on `timezone`.                                                                   |
| `device_id`   | string           | no                    | Max 80. A connected sender of this workspace. Omitted: the most recent connected device (an unofficial number before a Cloud API or Twilio number). |

```json
{
  "name": "Reminder",
  "message": "See you soon",
  "recipients": ["+91 98123 45678"],
  "run_at": "2026-12-01 09:00",
  "timezone": "Asia/Kolkata"
}
```

`201`:

```json
{
  "data": {
    "id": "6a7b8c9d-0e1f-4a2b-83c4-d5e6f7a8b9c0",
    "name": "Reminder",
    "type": "text",
    "status": "scheduled",
    "message": "See you soon",
    "template_id": null,
    "device_id": "baileys:4ce2a1b0-7d3e-4f5a-8b7c-1e2d3c4b5a69",
    "recipient_count": 1,
    "run_at": "2026-12-01T03:30:00.000Z",
    "next_run_at": "2026-12-01T03:30:00.000Z",
    "timezone": "Asia/Kolkata",
    "total_sent": 0,
    "total_delivered": 0,
    "total_failed": 0,
    "created_at": "2026-10-06T11:10:00.000Z"
  }
}
```

Errors: `422 validation_failed` (neither `message` nor `template_id`, `details.message`); `422 schedule_failed` (under two minutes ahead,
unparseable `run_at`, bad zone, unknown sender, no connected sender at all; `details` names the field). Reference saved a message with
no sender that never sent; here that is a refusal. `404 template_not_found`; `402 plan_limit`.

#### `GET /scheduled`

Scope `scheduled:read`. The workspace's schedules, newest first, cancelled ones included. Query: `limit`, `per_page`, `cursor` (an
opaque offset; `422` for one that is not ours).

#### `GET /scheduled/{id}`

Scope `scheduled:read`. One schedule with its message. `404 not_found` for a foreign or malformed id.

#### `DELETE /scheduled/{id}`

Scope `scheduled:write`. Cancels the schedule and keeps the row, as Reference does (the verb says delete, the row stays): `200` with
`status: "cancelled"`. A schedule that is already cancelled, completed or failed is `422 not_cancellable` (`This schedule is already
finished.`).

### Messages

A message:

| Field            | Type                    | Notes                                                                                                                                                    |
| ---------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | uuid                    | The id to poll with `GET /messages/{id}`.                                                                                                                |
| `to`             | string or null          | The recipient's number as digits; for an inbound message the business number. A send answers the string exactly as it was sent.                          |
| `type`           | string                  | `text`, `image`, `video`, `document`, `audio`, `location`, or another stored kind (`sticker`, `voice`, `contact`). Templates and buttons read as `text`. |
| `status`         | string                  | `pending` (queued), `scheduled` (never produced here), `sent`, `delivered`, `read`, `failed`, `received` (inbound).                                      |
| `failure_reason` | string or null          |                                                                                                                                                          |
| `error_code`     | integer, string or null | The provider's typed code (Meta `131047`) as a number, a platform code (`AUTH_SEND_HALTED`) as text.                                                     |
| `body`           | string or null          |                                                                                                                                                          |
| `media_url`      | string or null          | A link to the stored file, read with `GET /media/{token}` using the same key.                                                                            |
| `created_at`     | ISO-8601                | UTC. (Reference answered two different forms depending on the endpoint.)                                                                                 |

#### `POST /messages`

Scope `messages:write`; plan feature `public_api`. Honours `Idempotency-Key`. JSON, or multipart to attach a file in `media`. One
WhatsApp message to one number, through the same pipeline the inbox sends with, so it is guarded, queued, counted and receipted like a
dashboard send.

| Field       | Type             | Required                               | Rules                                                                                                                                                                                                                                          |
| ----------- | ---------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `to`        | string           | yes                                    | Max 32. Every non-digit is stripped (`+91 98123-45678` and `919812345678@s.whatsapp.net` both work); no digits is `422 send_failed`.                                                                                                           |
| `device_id` | string           | no                                     | Max 64. The `id` from `GET /devices` (a number is read as text); `<engine>:<uuid>` and `cfg_<uuid>` are accepted. A pick that names nothing here, or another workspace's, falls through to the default sender.                                 |
| `type`      | string           | no                                     | `text` (default), `image`, `video`, `document`, `audio`, `location`.                                                                                                                                                                           |
| `text`      | string           | no                                     | Max 4096. `{{merge tags}}` are filled from the contact that owns the number; an unknown tag becomes empty, never raw braces. For a file it is the caption.                                                                                     |
| `media`     | file (multipart) | For a media `type`, unless `media_url` | Up to 16 MB, of an allowed type.                                                                                                                                                                                                               |
| `media_url` | string (URL)     | For a media `type`, unless `media`     | Max 2048. Downloaded by the server through a guarded fetcher that refuses private, loopback and reserved hosts, every redirect hop included. A link this API gave out (`POST /media`, a message's `media_url`) is read from the store instead. |
| `latitude`  | number           | With `longitude`                       | -90 to 90.                                                                                                                                                                                                                                     |
| `longitude` | number           | With `latitude`                        | -180 to 180.                                                                                                                                                                                                                                   |

When both coordinates are set and not zero the message is a location pin whatever `type` says, and any file is ignored (Reference read
0 as empty; `latitude: 0` sends text). Text that carries a file is read from the file; a URL alone reads as an image.

Sender choice, in order: an explicit `device_id`; the newest connected unofficial number; the primary Cloud API connection; any connected
connection; any unofficial number even if not connected. A sender that does not carry WhatsApp is `422 send_failed` /
`wrong_channel`; none at all is `no_connected_device`.

```json
{
  "to": "+91 98123 45678",
  "type": "text",
  "text": "Hi {{first_name}}, your order has shipped."
}
```

`201` (no `meta`):

```json
{
  "data": {
    "id": "8c9d0e1f-2a3b-4c4d-85e6-f7a8b9c0d1e2",
    "to": "+91 98123 45678",
    "type": "text",
    "status": "sent",
    "failure_reason": null,
    "error_code": null,
    "body": "Hi {{first_name}}, your order has shipped.",
    "media_url": null,
    "created_at": "2026-10-06T11:20:00.000Z"
  }
}
```

`to`, `body` and `type` echo what the caller sent (the type asked for, or inferred); `body` is the raw text, not the merged one. The
message is queued and a worker sends it, normally in well under a second. The request waits up to 3 seconds for the worker to take
it, so the answer is usually `sent` (or `failed` with `failure_reason` and `error_code`); on a slow channel it is `pending` and the
client polls `GET /messages/{id}`.

Errors: `422 validation_failed` (`details` names `to`, `type`, `text`, `media_url`, `latitude`, `longitude`, `device_id`, `media`);
`422 media_required`; `422 send_failed` with a machine reason (section 4); `402 send_failed` / `out_of_credits`;
`422 unsupported_media_type` for a refused file type or content; `422 validation_failed` on `media` for a file over 16 MB;
`402 plan_limit` at the contact cap (a number becomes a contact when first messaged); `403 forbidden`.

#### `GET /messages`

Scope `messages:read`. The most recent messages of the workspace, newest first, inbound ones included (`status: "received"`, `to` the
business number). Query: `limit` or `per_page` (default 50, 1 to 200), `cursor`. `meta` is `{ limit, next_cursor, has_more, count }`.

#### `GET /messages/{id}`

Scope `messages:read`. One message with its current delivery status. `404 not_found` (`Message not found.`) for an unknown, foreign or
non-uuid id.

### Media

#### `POST /media`

Scope `media:write`. Multipart, field `file`. Uploads a file once so it can be reused as `media_url`. Up to 16 MB; images, video,
audio, PDF and Office documents, text, CSV and ZIP. Scripts, markup and SVG are refused, and a file whose bytes do not match its
extension is refused.

`201`:

```json
{
  "data": {
    "url": "https://api.example.com/api/v1/media/eyJ…",
    "path": "chat-media/1699_9f8e7d6c5b4a.png",
    "type": "image",
    "mime": "image/png",
    "size": 20480
  }
}
```

`type` is `image`, `video`, `audio` or `document`. `path` has no client file name and no workspace number. The same file uploaded twice
is stored twice, under two paths. Errors: `422 validation_failed` on `file` (missing, or over 16 MB); `422 unsupported_media_type`
(`This file type is not allowed.` or `This file content is not allowed.`).

#### `GET /media/{token}`

Scope `media:read`. Not in the OpenAPI document. Reads the file behind a link this API gave out; the token names one file of one
workspace, and the request must carry the same workspace's key. A link from `POST /media` works for 24 hours; the `media_url` of a
message read works for minutes and is minted again by each read. The file is always a download (`Content-Disposition: attachment`,
`nosniff`, a sandboxing content security policy). A forged token or another workspace's link is `404 not_found`.

### Conversations

A conversation:

| Field             | Type             | Notes                                                                                                                     |
| ----------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `id`              | uuid             |                                                                                                                           |
| `contact`         | string or null   | Digits of the peer's number.                                                                                              |
| `name`            | string or null   |                                                                                                                           |
| `last_message`    | string or null   | Preview.                                                                                                                  |
| `last_message_at` | ISO-8601 or null |                                                                                                                           |
| `unread`          | integer          |                                                                                                                           |
| `status`          | string           | The send state of the thread: `pending`, `sent` or `failed` (Reference's queue status, not the inbox's open or resolved). |
| `channel`         | string           | `W` unofficial WhatsApp, `WB` WhatsApp Cloud; any other channel is its kind (`telegram`, `instagram`).                    |

#### `GET /conversations`

Scope `conversations:read`. The workspace's threads, most recently active first; a thread opened by a send is listed (Reference hid
those). Query: `limit` or `per_page` (default 25, 1 to 100), `cursor`.

```json
{
  "data": [
    {
      "id": "9d0e1f2a-3b4c-4d5e-86f7-a8b9c0d1e2f3",
      "contact": "919812345678",
      "name": "Asha",
      "last_message": "hello",
      "last_message_at": "2026-10-06T11:25:00.000Z",
      "unread": 1,
      "status": "pending",
      "channel": "W"
    }
  ],
  "meta": { "limit": 25, "next_cursor": null, "has_more": false }
}
```

#### `GET /conversations/{id}/messages`

Scope `conversations:read`. The messages of one conversation, newest first, in the message shape above. Query: `limit` or
`per_page` (default 50, 1 to 200), `cursor`. Any thread of the workspace answers, whatever channel it runs on. Reading does not mark
the thread read. `meta` is `{ limit, next_cursor, has_more, count, conversation_id }`. `404 not_found` for an unknown, foreign or
non-uuid id.

### Devices

A device: `id` (uuid), `name`, `phone` (digits; empty text for an unofficial number without one, `null` for a connection without
one), `engine` (`unofficial`, `whatsapp_cloud`, `twilio`), `status`, `active` (boolean), `last_seen_at` (ISO-8601 or null).
Unofficial numbers report `connected`, `disconnected`, `needs_pair` or `failed`; Cloud API and Twilio connections report `connected`
or `disconnected`. The id is either a device's or a connection's uuid; both are valid `device_id` values of a send (Reference numbered
the two kinds separately). Stored state only: there is no live status probe.

#### `GET /devices`

Scope `devices:read`. Unofficial numbers first (active first), then Cloud API and Twilio connections. Not paged; `meta` is
`{ "count": 2 }`.

```json
{
  "data": [
    {
      "id": "0e1f2a3b-4c5d-4e6f-87a8-b9c0d1e2f3a4",
      "name": "Shop phone",
      "phone": "919811100000",
      "engine": "unofficial",
      "status": "connected",
      "active": true,
      "last_seen_at": "2026-10-01T09:00:00.000Z"
    },
    {
      "id": "1f2a3b4c-5d6e-4f70-88b9-c0d1e2f3a4b5",
      "name": "Cloud line",
      "phone": "919811122222",
      "engine": "whatsapp_cloud",
      "status": "connected",
      "active": true,
      "last_seen_at": "2026-09-15T12:00:00.000Z"
    }
  ],
  "meta": { "count": 2 }
}
```

#### `GET /devices/{id}`

Scope `devices:read`. One number by the id the list gives, a disconnected one too. `404 not_found` for an unknown, foreign or
non-uuid id.

## 7. Routes that do not exist yet

Two groups of Reference's API are not built. A call to their paths answers `404 not_found`.

| Group        | Reference routes                                               | Blocked on                                                                              |
| ------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Auto-replies | `/api/v1/auto-replies` (keyword and automatic reply rules)     | The auto-reply-keywords domain, which owns the rules these routes would read and write. |
| Webhooks     | `/api/v1/webhooks` (register endpoints for signed event posts) | The integrations domain, which owns outbound webhook endpoints and their signing.       |

The scope names `auto-replies:read`, `auto-replies:write`, `webhooks:read` and `webhooks:write` are already accepted on a key and
the OpenAPI tags `AutoReply` and `Webhook` are listed, but both scopes map to no permissions and there is no controller. When the
domains land, each route is added the way section 8 describes and the scope map gets its permissions.

## 8. Developer reference

### OpenAPI

`GET /docs/api.json` serves the OpenAPI document of the customer API. It is public (it describes routes, never data), cached for 60
seconds, and contains only the `/api/v1` resources: never the staff routes or the signed partner surface. The document is generated
from the controllers, so a route appears once it is in one of the four resource modules. Descriptions use a `{{brand}}` token that is
replaced with the installation's brand name when the document is served. `GET /media/{token}` is excluded from it.

### Where the code lives

| Path                                                                                    | What                                                                                                                                 |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/contracts/src/developer-rest-api-v1/`                                         | Zod contracts: `envelope.ts` (codes, paging, scope names), `keys.ts` (console), `crm.ts`, `automation.ts`, `bulk.ts`, `messaging.ts` |
| `apps/api/src/modules/developer-rest-api-v1/`                                           | The module. `developer-rest-api-v1.module.ts` registers the error renderer for `/api/v1`.                                            |
| `.../auth/`                                                                             | `bearer-api-key.guard.ts`, `api-scope.ts` (`@RequireApiScope`), `api-key-grants.ts` (scope to permission map)                        |
| `.../http/`                                                                             | `v1-controller.decorator.ts`, `v1-envelope.ts` (`ok`, `pageMeta`, `countMeta`), `v1-error-renderer.ts`, `v1-error.ts`                |
| `.../keys/`                                                                             | The console: controller, service, repository, `api-key-secret.ts` (generate, hash, compare)                                          |
| `.../docs/`                                                                             | `api-v1-docs.service.ts` (OpenAPI build), `api-v1-tags.ts` (group order and text)                                                    |
| `.../resources/{crm,automation,bulk,messaging}/`                                        | The resource controllers, services or adapters, and mappers                                                                          |
| `apps/api/src/modules/public-api/api-key-access.service.ts`                             | Rate limit, plan feature and `last_used_at`, shared with `/public/v1`                                                                |
| `apps/web/src/features/developer-rest-api-v1/`                                          | The `/developers` console page                                                                                                       |
| `apps/api/test/unit/developer-rest-api-v1/`, `apps/api/test/e2e/developer-rest-api-v1/` | Tests                                                                                                                                |

Design rules the code follows:

- A resource is a thin layer over the service the dashboard uses (contacts, deals, templates, broadcasts, campaigns, scheduled,
  inbox). Plan caps, audit, outbox events and tenant scoping are therefore the dashboard's. Controllers hold no business rules.
- The key's request context has `actorType = 'api_key'`, `userId` = the owner member and grants built from the scopes with `all`
  record scope (Reference: a key sees the whole workspace).
- Request and response shapes are Zod schemas in `@crm/contracts`; no class-validator DTOs.
- Reference's wire codes (`send_failed`, `no_recipients`, ...) are not in the platform-wide `ERROR_CODES`; `v1Error()` raises them and the
  renderer writes any unmapped code lower-cased.

### Adding a resource

1. **Contract.** Add the request and response schemas to the fitting file in `packages/contracts/src/developer-rest-api-v1/` (see
   the `contracts-change` skill). Names are `v1<Thing>Schema`. If the resource has a new scope, add it to `API_SCOPE_RESOURCES`
   in `envelope.ts`.
2. **Scope map.** Add `'<resource>:read'` and `'<resource>:write'` to `SCOPE_PERMISSIONS` in `auth/api-key-grants.ts`, listing the
   capability keys the delegated services check (`ctx.grants`). Without them the service refuses the key even when the scope passes.
3. **Controller.** Write it with `@V1Controller('<path>')`, which applies `@Public()`, `BearerApiKeyGuard`, `@SkipThrottle()`,
   `@RequirePlanFeature('public_api')`, the Swagger tag and bearer auth, and the version-neutral `api/v1/<path>` route. Put
   `@RequireApiScope('<resource>:read' | '<resource>:write')` on every handler. Validate with `zodPipe(schema)`. A literal route
   (`categories`, `statistics`) goes before `:id`. Use `@Idempotent()` on creates that must not repeat. Parse a path id with
   `uuidOrNotFound` or a `ParseUUIDPipe` with `errorHttpStatusCode: 404`, since a non-uuid is a missing record.
4. **Answers.** Wrap data with `ok(data, meta?)`. For a paged list use `ok(items, pageMeta(page))`; for an unpaged one
   `ok(items, countMeta(items.length))`. Never return an internal numeric id.
5. **Errors.** Throw `AppError`; the renderer maps it. For a Reference wire code use `v1Error('code', 'message', status, details?)`.
   Map a delegated domain's "not found" to `NOT_FOUND` so the client sees `404 not_found`.
6. **Module and docs.** Declare the controller in the group module (`V1CrmModule`, `V1AutomationModule`, `V1BulkModule` or
   `V1MessagingModule`). A new group module also goes in the `imports` of `DeveloperRestApiV1Module` and in the `include` list of
   `ApiV1DocsService.build()`, or it will work but be missing from `/docs/api.json`. Add the path to `TAG_BY_PATH` in
   `v1-controller.decorator.ts` and a row to `API_V1_TAGS` in `docs/api-v1-tags.ts` when the group is new.
7. **Tests.** Add an e2e spec case per behaviour (below), including 401 without a key, 403 for a key with another scope, tenant
   isolation (a second workspace gets 404), and the 422 shape. Update this page.

Skeleton:

```ts
@V1Controller('widgets')
export class V1WidgetsController {
  constructor(private readonly widgets: V1WidgetsService) {}

  @Get()
  @RequireApiScope('widgets:read')
  async list(@Query(zodPipe(v1ListQuerySchema)) paging: V1ListQuery) {
    const res = await this.widgets.list(paging);
    return ok(res.data, pageMeta(res.page));
  }

  @Post()
  @Idempotent()
  @RequireApiScope('widgets:write')
  async create(@Body(zodPipe(v1CreateWidgetSchema)) body: V1CreateWidget) {
    return ok(await this.widgets.create(body));
  }
}
```

### Running the tests

Unit tests (mappers, key secret, grants, envelope, renderer, input parsing) need nothing else:

```bash
pnpm --filter @crm/api exec vitest run --dir test/unit/developer-rest-api-v1
```

The e2e specs boot the application against disposable Postgres and Redis containers (testcontainers), so Docker must be running. Each
spec signs up its own workspace and mints a key through the console, so specs do not see each other's rows:

```bash
pnpm --filter @crm/api exec vitest run --dir test/e2e/developer-rest-api-v1 --testTimeout=240000
```

Add a file name (`crm.e2e.spec.ts`, `automation.e2e.spec.ts`, `bulk.e2e.spec.ts`, `messaging.e2e.spec.ts`, `auth.e2e.spec.ts`,
`keys.e2e.spec.ts`) to run one group. `support.ts` has the helpers: `tenantWithKey(api, label)` returns a workspace, its key and a
`call` object (`get`, `post`, `put`, `delete`, `raw`) that sends `Authorization: Bearer <key>` to `/api/v1`.

Before opening a pull request run the `pre-pr` skill; a change to this page that touches a contract also needs the contracts build.

## Date of birth and the minor flag (BL-190, product extension)

Not in Reference. `date_of_birth` (`YYYY-MM-DD`, `null` clears it) is accepted on `POST /v1/contacts` and `PUT|PATCH /v1/contacts/:id`; every contact carries `date_of_birth` and `is_minor`. A date that makes the contact a minor flags it in the same request (source `dob`). `GET /v1/contacts/:id/privacy` (`contacts:read`) and `POST /v1/contacts/:id/privacy` (`contacts:write`, `Idempotency-Key`; body `{ kind: minor | guardian_consent | sale_share_opt_out, value, note?, evidence? }`, source stored as `api`) read and write the flags; guardian consent needs a note (422 `CONSENT_NOTE_REQUIRED`) and a flagged minor (422 `CONSENT_PRIVACY_NOT_MINOR`) and never creates a marketing grant.

## Contact time zone (BL-193, product extension)

`timezone` (an IANA zone such as `Asia/Kolkata`; blank or `null` clears it; 422 on `timezone` when it is not a zone) is accepted by `POST /v1/contacts` and `PATCH /v1/contacts/:id`, and returned with the read-only `timezone_source` (`staff`, `import` or `api`; `null` when no zone is stored) on every contact. A zone written through the API is recorded as `api`. Marketing messages to the contact are held for the workspace's quiet hours on this clock.
