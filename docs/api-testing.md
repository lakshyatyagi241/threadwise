# API Testing Guide (Postman)

Every sample request/response below was captured live against a running dev
server (`pnpm dev`, seeded org `studyfromuae`) — not hand-written. Re-run the
`curl` equivalent yourself if a response ever looks stale; IDs are real rows
from the seed data and will differ on your machine after a fresh
`pnpm db:seed`.

Covers every endpoint currently live in `apps/api`. Cross-reference with
[api-inventory.md](api-inventory.md) for what's still unbuilt — there is
nothing to test for a route that doesn't exist yet.

## One-time Postman setup

1. Create an environment (e.g. "CRM Local") with one variable:
   - `baseUrl` = `http://localhost:3000`
2. Create a collection. On its **Authorization** tab: type `Bearer Token`,
   token = `{{accessToken}}` — every request in the collection inherits this,
   so you don't set auth per-request.
3. On the **Login** request (below), open its **Tests** tab and paste:
   ```js
   const body = pm.response.json();
   pm.environment.set('accessToken', body.accessToken);
   pm.environment.set('refreshToken', body.refreshToken);
   ```
   Every time you run Login, your environment's token updates and every other
   request in the collection picks it up automatically.
4. Access tokens expire in 15 minutes (`JWT_ACCESS_TTL`). Re-run Login, or use
   the Refresh Token request, when you start getting 401s mid-session.

---

## Auth

### POST /v1/auth/staff/login

- **Auth**: none (`@Public()`)
- **Postman**: Method `POST`, URL `{{baseUrl}}/v1/auth/staff/login`, Body → raw → JSON

Request:

```json
{
  "orgSlug": "studyfromuae",
  "email": "admin@studyfromuae.test",
  "password": "Passw0rd!"
}
```

Response — `200 OK`:

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": "15m"
}
```

Wrong password/org/email all return the same shape (never reveal which part
was wrong):

```json
{
  "type": "about:blank",
  "title": "Unauthorized",
  "status": 401,
  "detail": "Invalid credentials",
  "code": "UNAUTHENTICATED"
}
```

### POST /v1/auth/partner/login

Same shape as staff login, different pool (`partner_agents` table — sub-agent
portal, not staff).

- **Postman**: `POST {{baseUrl}}/v1/auth/partner/login`

Request:

```json
{
  "orgSlug": "studyfromuae",
  "email": "agent@studyfromuae.test",
  "password": "Passw0rd!"
}
```

Response — `200 OK`: same `{ accessToken, refreshToken, expiresIn }` shape as
staff login. Use this token only against `/v1/partner/*` routes — it carries
`typ: "partner_agent"`, not `"user"`, so staff routes reject it.

### POST /v1/auth/refresh

- **Auth**: none — the refresh token itself is the credential
- **Postman**: `POST {{baseUrl}}/v1/auth/refresh`

Request:

```json
{
  "refreshToken": "{{refreshToken}}"
}
```

Response — `201 Created` (Nest's default POST status; body is a fresh pair):

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": "15m"
}
```

---

## Users

Run **Login** first so `{{accessToken}}` is set. All routes below need
`Authorization: Bearer {{accessToken}}` (inherited from collection auth).

### GET /v1/users/me

No permission needed beyond being logged in — always returns the caller's own
profile.

- **Postman**: `GET {{baseUrl}}/v1/users/me`, no body

Response — `200 OK`:

```json
{
  "id": "02118b2e-96db-4ec0-9d76-aea6e18ac4c4",
  "email": "admin@studyfromuae.test",
  "fullName": "Demo Admin",
  "status": "active",
  "roles": [{ "id": "af710257-a613-4f6e-9668-17ca28e79679", "name": "Admin" }],
  "rowVersion": 2,
  "createdAt": "2026-09-16T12:45:15.144Z",
  "updatedAt": "2026-09-17T12:38:51.102Z"
}
```

### GET /v1/users

- **Permission**: `admin.user.manage`
- **Postman**: `GET {{baseUrl}}/v1/users?limit=2`

Response — `200 OK`:

```json
{
  "data": [
    {
      "id": "631ad5e1-9aff-4a80-af19-2189f37b4e25",
      "email": "agent1@studyfromuae.test",
      "fullName": "Agent One",
      "status": "active",
      "roles": [{ "id": "6f6c8bf2-3b15-47a8-9182-423cc9c06286", "name": "Support Agent" }],
      "rowVersion": 1,
      "createdAt": "2026-09-17T11:09:39.743Z",
      "updatedAt": "2026-09-17T11:09:39.743Z"
    }
  ],
  "page": { "nextCursor": null, "hasMore": false, "limit": 2 }
}
```

Pass the next page with `?limit=2&cursor={{page.nextCursor}}` when `hasMore`
is `true`. Filters: `?q=agent` (name/email search), `?status=active`.

### GET /v1/users/:id

- **Permission**: `admin.user.manage`
- **Postman**: `GET {{baseUrl}}/v1/users/02118b2e-96db-4ec0-9d76-aea6e18ac4c4`

Response — `200 OK`: same shape as `/users/me` above, for the given id.

Invalid uuid format → `400`:

```json
{
  "type": "about:blank",
  "title": "Bad Request",
  "status": 400,
  "detail": "Validation failed (uuid is expected)",
  "code": "VALIDATION_FAILED"
}
```

### POST /v1/users

- **Permission**: `admin.user.manage`
- **Postman**: `POST {{baseUrl}}/v1/users`, Body → raw → JSON

Request:

```json
{
  "email": "neha.verma@studyfromuae.test",
  "fullName": "Neha Verma",
  "password": "Passw0rd!",
  "roleIds": []
}
```

Response — `201 Created`:

```json
{
  "id": "c8eec1d8-34f2-4e6e-8565-85729ec2bb09",
  "email": "neha.verma@studyfromuae.test",
  "fullName": "Neha Verma",
  "status": "active",
  "roles": [],
  "rowVersion": 1,
  "createdAt": "2026-09-17T13:03:17.467Z",
  "updatedAt": "2026-09-17T13:03:17.467Z"
}
```

Same email again → `422`:

```json
{
  "type": "https://errors.crm.platform/validation_failed",
  "title": "Unprocessable Entity",
  "status": 422,
  "detail": "A user with this email already exists",
  "code": "VALIDATION_FAILED",
  "errors": [{ "path": "email", "message": "already in use" }]
}
```

### PATCH /v1/users/:id

- **Permission**: `admin.user.manage`
- **Postman**: `PATCH {{baseUrl}}/v1/users/<id>`, Body → raw → JSON
- Read the user first (GET) to get its current `rowVersion` — this call is
  optimistic-locked.

Request:

```json
{
  "fullName": "Demo Admin Updated",
  "rowVersion": 2
}
```

Response — `200 OK`: updated user, `rowVersion` incremented.

Stale `rowVersion` (someone else updated it since your last read) → `409`:

```json
{
  "type": "https://errors.crm.platform/row_version_conflict",
  "title": "Conflict",
  "status": 409,
  "detail": "User was modified by someone else. Reload and try again.",
  "code": "ROW_VERSION_CONFLICT"
}
```

Fix: GET again, take the new `rowVersion`, retry.

`roleIds` in the body, when present, **fully replaces** the user's role set —
not a merge. Omit the field entirely to leave roles untouched.

---

## Roles

### GET /v1/roles

- **Permission**: `admin.role.manage`
- **Postman**: `GET {{baseUrl}}/v1/roles?limit=2`

Response — `200 OK`:

```json
{
  "data": [
    {
      "id": "6f6c8bf2-3b15-47a8-9182-423cc9c06286",
      "name": "Support Agent",
      "systemKey": null,
      "isLocked": false,
      "grants": [
        { "permissionKey": "inbox.conversation.read", "effect": "allow", "recordScope": "own" }
      ],
      "rowVersion": 1,
      "createdAt": "2026-09-17T11:09:39.695Z",
      "updatedAt": "2026-09-17T11:09:39.695Z"
    }
  ],
  "page": { "nextCursor": "MjAyNi0wOS0xNlQxMjo0NToxNS4xNDRafDI", "hasMore": true, "limit": 2 }
}
```

### GET /v1/roles/:id

- **Permission**: `admin.role.manage`
- **Postman**: `GET {{baseUrl}}/v1/roles/<id>`

Response — `200 OK`: single role object, same shape as one item above.

### POST /v1/roles

- **Permission**: `admin.role.manage`
- **Postman**: `POST {{baseUrl}}/v1/roles`, Body → raw → JSON

Request:

```json
{
  "name": "Marketing Viewer",
  "grants": [{ "permissionKey": "record.contacts.read", "effect": "allow", "recordScope": "all" }]
}
```

`recordScope` is one of `all` | `team` | `own`. See `GET /v1/permissions` for
the full list of valid `permissionKey` values.

Response — `201 Created`:

```json
{
  "id": "9b0b784c-2993-4088-9a8d-eedd2f707e23",
  "name": "Marketing Viewer",
  "systemKey": null,
  "isLocked": false,
  "grants": [{ "permissionKey": "record.contacts.read", "effect": "allow", "recordScope": "all" }],
  "rowVersion": 1,
  "createdAt": "2026-09-17T13:03:17.582Z",
  "updatedAt": "2026-09-17T13:03:17.582Z"
}
```

### PATCH /v1/roles/:id

- **Permission**: `admin.role.manage`
- **Postman**: `PATCH {{baseUrl}}/v1/roles/<id>`, Body → raw → JSON

Request:

```json
{
  "name": "Marketing Viewer (Read Only)",
  "rowVersion": 1
}
```

Response — `200 OK`: updated role, `rowVersion` now `2`.

`grants`, when present, fully replaces the grant set (same "replace not
merge" rule as `roleIds` on users). Editing a system role (`isLocked: true`,
e.g. seeded "Admin") is rejected regardless of `rowVersion`:

```json
{
  "type": "https://errors.crm.platform/validation_failed",
  "title": "Unprocessable Entity",
  "status": 422,
  "detail": "System roles cannot be modified",
  "code": "VALIDATION_FAILED",
  "errors": [{ "path": "id", "message": "role is locked" }]
}
```

### DELETE /v1/roles/:id

- **Permission**: `admin.role.manage`
- **Postman**: `DELETE {{baseUrl}}/v1/roles/<id>`

Response — `204 No Content`, empty body.

Deleting a locked/system role → same `422` "System roles cannot be deleted"
shape as above.

---

## Permissions

### GET /v1/permissions

- **Permission**: `admin.role.manage` (read-only registry, gated the same as
  role management since it's only useful there)
- **Postman**: `GET {{baseUrl}}/v1/permissions`

Response — `200 OK` (33 rows total in the seeded registry; truncated here):

```json
{
  "data": [
    {
      "key": "record.contacts.read",
      "label": "View contacts",
      "category": "crm",
      "supportsScope": true
    },
    {
      "key": "record.contacts.create",
      "label": "Create contacts",
      "category": "crm",
      "supportsScope": false
    }
  ]
}
```

Use the `key` values here as `permissionKey` when building `grants` for
`POST`/`PATCH /v1/roles`.

---

## Contacts

### GET /v1/contacts

- **Permission**: `record.contacts.read`
- **Postman**: `GET {{baseUrl}}/v1/contacts?limit=2`

Response — `200 OK` (truncated to 1 of many rows):

```json
{
  "data": [
    {
      "id": "427d11fb-1b01-4858-9bad-de80630c0d15",
      "displayId": "CON-00002",
      "name": "Fatima Noor",
      "email": "fatima.noor@example.com",
      "phone": "+971501234567",
      "companyId": null,
      "ownerId": null,
      "lifecycleState": "active",
      "lifecycleStage": "new",
      "status": null,
      "customFields": {},
      "isArchived": false,
      "rowVersion": 1,
      "createdAt": "2026-09-17T13:02:48.866Z",
      "updatedAt": "2026-09-17T13:02:48.866Z"
    }
  ],
  "page": { "nextCursor": "MjAyNi0wOS0xNlQxMjo0NToxNS4xNDRafDQ", "hasMore": true, "limit": 2 }
}
```

Filters: `?q=fatima` (name/email/phone search), `?ownerId=<uuid>`,
`?lifecycleStage=new`, `?includeArchived=true`.

### GET /v1/contacts/:id

- **Permission**: `record.contacts.read`
- **Postman**: `GET {{baseUrl}}/v1/contacts/<id>`

Response — `200 OK`: single contact, same shape as one list item above.

### POST /v1/contacts

- **Permission**: `record.contacts.create`
- **Postman**: `POST {{baseUrl}}/v1/contacts`, Body → raw → JSON

Request:

```json
{
  "name": "Riya Kapoor",
  "email": "riya.kapoor@example.com",
  "phone": "+919812345678",
  "lifecycleStage": "new"
}
```

Must include at least one of `email`/`phone` — a contact with neither can't be
reached, deduplicated, or resolved from an inbound message.

Response — `201 Created`:

```json
{
  "id": "ae97e110-c08e-4a33-be4b-2ac67970a551",
  "displayId": "CON-00001",
  "name": "Riya Kapoor",
  "email": "riya.kapoor@example.com",
  "phone": "+919812345678",
  "companyId": null,
  "ownerId": "02118b2e-96db-4ec0-9d76-aea6e18ac4c4",
  "lifecycleState": "active",
  "lifecycleStage": "new",
  "status": null,
  "customFields": {},
  "isArchived": false,
  "rowVersion": 1,
  "createdAt": "2026-09-17T13:02:37.469Z",
  "updatedAt": "2026-09-17T13:02:37.469Z"
}
```

Note: `ownerId` defaults to the caller when not supplied.

Neither `email` nor `phone` given → `422`:

```json
{
  "type": "https://errors.crm.platform/validation_failed",
  "title": "Unprocessable Entity",
  "status": 422,
  "detail": "Request payload failed validation",
  "code": "VALIDATION_FAILED",
  "errors": [{ "path": "email", "message": "contact requires at least one of: email, phone" }]
}
```

No/expired token on any contacts route → `401`:

```json
{
  "type": "https://errors.crm.platform/unauthenticated",
  "title": "Unauthorized",
  "status": 401,
  "detail": "Missing bearer token",
  "code": "UNAUTHENTICATED"
}
```

### PATCH /v1/contacts/:id

- **Permission**: `record.contacts.update`
- **Postman**: `PATCH {{baseUrl}}/v1/contacts/<id>`, Body → raw → JSON
- Read the contact first (GET) for its current `rowVersion`.

Request:

```json
{
  "lifecycleStage": "contacted",
  "rowVersion": 1
}
```

Response — `200 OK`: updated contact, `rowVersion` incremented. `customFields`
sent here are **merged** into the existing object, not replaced.

Stale `rowVersion` → `409 ROW_VERSION_CONFLICT` (same shape as the Users
section above).

### DELETE /v1/contacts/:id

- **Permission**: `record.contacts.delete`
- **Postman**: `DELETE {{baseUrl}}/v1/contacts/<id>`

Response — `204 No Content`, empty body. Hard delete (per ADR-0009) — the
audit log is the only trail left, not a soft-delete flag.

---

## Partner Portal (sub-agent pool — separate login, separate token)

Run **POST /v1/auth/partner/login** first; these routes reject a staff
(`typ: "user"`) token.

### POST /v1/partner/leads

- **Auth**: partner-agent bearer token
- **Postman**: `POST {{baseUrl}}/v1/partner/leads`, Body → raw → JSON

Request:

```json
{
  "name": "Fatima Noor",
  "email": "fatima.noor@example.com",
  "phone": "+971501234567",
  "city": "Dubai",
  "collegeTag": "RIT Dubai"
}
```

Response — `201 Created`:

```json
{
  "id": "427d11fb-1b01-4858-9bad-de80630c0d15",
  "name": "Fatima Noor",
  "email": "fatima.noor@example.com",
  "phone": "+971501234567",
  "lifecycleStage": "new",
  "collegeTag": "RIT Dubai",
  "submittedAt": "2026-09-17T13:02:48.887Z",
  "updatedAt": "2026-09-17T13:02:48.887Z"
}
```

Behind the scenes this creates (or matches, via identity dedup) a row in the
same `contacts` table Contacts uses — the agent only ever sees the
lead-shaped view above, never the full contact record.

### GET /v1/partner/leads

- **Postman**: `GET {{baseUrl}}/v1/partner/leads`

Response — `200 OK`: `{ data: [...leads this agent submitted], page: {...} }`
— same envelope shape as every other list endpoint. Structurally scoped: this
agent can never see another agent's leads, there is no scope parameter to ask
for it.

### GET /v1/partner/leads/:id

- **Postman**: `GET {{baseUrl}}/v1/partner/leads/<id>`

Response — `200 OK`: single lead, same shape as the POST response above.

---

## Public API (external partner systems — API key + HMAC, not a bearer token)

### GET /public/v1/leads/:id

- **Auth**: `X-Api-Key` header + HMAC signature (see [ADR-0013](adr/0013-read-replica-and-public-api.md))
- **Postman**: `GET {{baseUrl}}/public/v1/leads/<id>` — generating a valid
  signed request needs an issued API key + secret, which isn't part of the
  seed data. Not covered here yet; add once an API-key issuance endpoint
  exists (tracked in [api-inventory.md](api-inventory.md) under Settings →
  Manage Account → API Keys).

Without a key, every public route rejects the same way:

```json
{
  "type": "https://errors.crm.platform/api_key_invalid",
  "title": "Unauthorized",
  "status": 401,
  "detail": "Missing API key",
  "code": "API_KEY_INVALID"
}
```
