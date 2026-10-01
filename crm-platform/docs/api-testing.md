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

### POST /v2/auth/staff/login

- **Auth**: none (`@Public()`)
- **Postman**: Method `POST`, URL `{{baseUrl}}/v2/auth/staff/login`, Body → raw → JSON

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

### POST /v2/auth/partner/login

Same shape as staff login, different pool (`partner_agents` table — sub-agent
portal, not staff).

- **Postman**: `POST {{baseUrl}}/v2/auth/partner/login`

Request:

```json
{
  "orgSlug": "studyfromuae",
  "email": "agent@studyfromuae.test",
  "password": "Passw0rd!"
}
```

Response — `200 OK`: same `{ accessToken, refreshToken, expiresIn }` shape as
staff login. Use this token only against `/v2/partner/*` routes — it carries
`typ: "partner_agent"`, not `"user"`, so staff routes reject it.

### POST /v2/auth/refresh

- **Auth**: none — the refresh token itself is the credential
- **Postman**: `POST {{baseUrl}}/v2/auth/refresh`

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

### GET /v2/users/me

No permission needed beyond being logged in — always returns the caller's own
profile.

- **Postman**: `GET {{baseUrl}}/v2/users/me`, no body

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

### GET /v2/users

- **Permission**: `admin.user.manage`
- **Postman**: `GET {{baseUrl}}/v2/users?limit=2`

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

### GET /v2/users/:id

- **Permission**: `admin.user.manage`
- **Postman**: `GET {{baseUrl}}/v2/users/02118b2e-96db-4ec0-9d76-aea6e18ac4c4`

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

### POST /v2/users

- **Permission**: `admin.user.manage`
- **Postman**: `POST {{baseUrl}}/v2/users`, Body → raw → JSON

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

### PATCH /v2/users/:id

- **Permission**: `admin.user.manage`
- **Postman**: `PATCH {{baseUrl}}/v2/users/<id>`, Body → raw → JSON
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

### GET /v2/roles

- **Permission**: `admin.role.manage`
- **Postman**: `GET {{baseUrl}}/v2/roles?limit=2`

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

### GET /v2/roles/:id

- **Permission**: `admin.role.manage`
- **Postman**: `GET {{baseUrl}}/v2/roles/<id>`

Response — `200 OK`: single role object, same shape as one item above.

### POST /v2/roles

- **Permission**: `admin.role.manage`
- **Postman**: `POST {{baseUrl}}/v2/roles`, Body → raw → JSON

Request:

```json
{
  "name": "Marketing Viewer",
  "grants": [{ "permissionKey": "record.contacts.read", "effect": "allow", "recordScope": "all" }]
}
```

`recordScope` is one of `all` | `team` | `own`. See `GET /v2/permissions` for
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

### PATCH /v2/roles/:id

- **Permission**: `admin.role.manage`
- **Postman**: `PATCH {{baseUrl}}/v2/roles/<id>`, Body → raw → JSON

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

### DELETE /v2/roles/:id

- **Permission**: `admin.role.manage`
- **Postman**: `DELETE {{baseUrl}}/v2/roles/<id>`

Response — `204 No Content`, empty body.

Deleting a locked/system role → same `422` "System roles cannot be deleted"
shape as above.

---

## Permissions

### GET /v2/permissions

- **Permission**: `admin.role.manage` (read-only registry, gated the same as
  role management since it's only useful there)
- **Postman**: `GET {{baseUrl}}/v2/permissions`

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
`POST`/`PATCH /v2/roles`.

---

## Contacts

### GET /v2/contacts

- **Permission**: `record.contacts.read`
- **Postman**: `GET {{baseUrl}}/v2/contacts?limit=2`

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

### GET /v2/contacts/:id

- **Permission**: `record.contacts.read`
- **Postman**: `GET {{baseUrl}}/v2/contacts/<id>`

Response — `200 OK`: single contact, same shape as one list item above.

### POST /v2/contacts

- **Permission**: `record.contacts.create`
- **Postman**: `POST {{baseUrl}}/v2/contacts`, Body → raw → JSON

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

### PATCH /v2/contacts/:id

- **Permission**: `record.contacts.update`
- **Postman**: `PATCH {{baseUrl}}/v2/contacts/<id>`, Body → raw → JSON
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

### DELETE /v2/contacts/:id

- **Permission**: `record.contacts.delete`
- **Postman**: `DELETE {{baseUrl}}/v2/contacts/<id>`

Response — `204 No Content`, empty body. Hard delete — the
audit log is the only trail left, not a soft-delete flag.

---

## Field Metadata (Settings > Data Management — Contact Properties + Company Properties)

One generic registry (Phase 8) serves both Contact Properties and
Company Properties — every route below takes a `moduleKey` of `contacts` or
`companies`, and the two are permission-isolated from each other:
`record.contact-properties.*` and `record.company-properties.*` are
distinct keys, so a grant to one does not unlock the other. Most examples
below use `moduleKey=contacts`; each resource has one `moduleKey=companies`
example too, showing the shape is identical either way.

### Field Sections

#### POST /v2/field-sections

- **Permission**: `record.contact-properties.create` (or `record.company-properties.create` for `moduleKey: "companies"`)
- **Postman**: `POST {{baseUrl}}/v2/field-sections`, Body → raw → JSON

Request:

```json
{
  "moduleKey": "contacts",
  "name": "Docs Test Section"
}
```

Response — `201 Created`:

```json
{
  "id": "1a262588-9d22-4d56-805f-932c23bcb6a9",
  "moduleKey": "contacts",
  "name": "Docs Test Section",
  "position": 0,
  "isActive": true,
  "rowVersion": 1,
  "createdAt": "2026-09-25T20:54:06.985Z",
  "updatedAt": "2026-09-25T20:54:06.985Z"
}
```

`moduleKey: "companies"` returns the identical shape, just tagged
`"moduleKey": "companies"` and gated by `record.company-properties.create`
instead.

#### GET /v2/field-sections

- **Permission**: `record.contact-properties.read` / `record.company-properties.read`
- **Postman**: `GET {{baseUrl}}/v2/field-sections?moduleKey=contacts&limit=20`

Response — `200 OK`:

```json
{
  "data": [
    {
      "id": "1a262588-9d22-4d56-805f-932c23bcb6a9",
      "moduleKey": "contacts",
      "name": "Docs Test Section",
      "position": 0,
      "isActive": true,
      "rowVersion": 1,
      "createdAt": "2026-09-25T20:54:06.985Z",
      "updatedAt": "2026-09-25T20:54:06.985Z"
    }
  ],
  "page": { "nextCursor": null, "hasMore": false, "limit": 20 }
}
```

A whole org's sections for one module is a handful of rows, so this always
returns everything in one page — the envelope still carries the standard
`page` shape for consistency with every other list endpoint.

**Permission isolation, proven live**: a bearer token for a role granted
_only_ `record.contact-properties.read` —

- `GET ?moduleKey=contacts` → `200 OK`, the caller's own module.
- `GET ?moduleKey=companies` → `403 Forbidden`:

```json
{
  "type": "https://errors.crm.platform/forbidden",
  "title": "Forbidden",
  "status": 403,
  "detail": "Missing permission: record.company-properties.read",
  "instance": "/v2/field-sections?moduleKey=companies",
  "code": "FORBIDDEN",
  "requestId": "b8e10e4d-5a86-465e-9690-e73086964697"
}
```

`@RequirePermission` is static route metadata and can't see the request's
`moduleKey`, so the controller-level check only confirms "some
properties permission for this action" — the precise per-module check
above happens in the service, against the actual moduleKey, once it's
known (see `field-metadata-permission.ts`). Without it, a
contact-properties grant would also unlock company-properties.

#### PATCH /v2/field-sections/:id

- **Permission**: `record.contact-properties.update` / `record.company-properties.update`
- **Postman**: `PATCH {{baseUrl}}/v2/field-sections/<id>`, Body → raw → JSON
- Requires the `rowVersion` you read. A mismatch returns `409 ROW_VERSION_CONFLICT`.

Request:

```json
{ "name": "Docs Test Section Renamed", "rowVersion": 1 }
```

Response — `200 OK`: same shape, `name` updated, `rowVersion` incremented to `2`.

#### POST /v2/field-sections/reorder

- **Permission**: `record.contact-properties.update` / `record.company-properties.update`
- **Postman**: `POST {{baseUrl}}/v2/field-sections/reorder`, Body → raw → JSON

Request:

```json
{ "moduleKey": "contacts", "orderedIds": ["<section-id-2>", "<section-id-1>"] }
```

Response — `204 No Content`, empty body.

Every id in `orderedIds` must actually belong to the declared `moduleKey` —
a caller can't smuggle another module's section into a reorder call this
way; a mismatched id is treated as not found.

#### DELETE /v2/field-sections/:id

- **Permission**: `record.contact-properties.delete` / `record.company-properties.delete`
- **Postman**: `DELETE {{baseUrl}}/v2/field-sections/<id>`

Response — `204 No Content`, empty body. Fields in the section are not
deleted — the composite FK is `ON DELETE SET NULL (section_id)`, so they
just become sectionless rather than disappearing (see `section_id: null`
on a field's response after its section is deleted).

### Fields

#### POST /v2/fields

- **Permission**: `record.contact-properties.create` / `record.company-properties.create`
- **Postman**: `POST {{baseUrl}}/v2/fields`, Body → raw → JSON

Request — a `select` field with its options created inline:

```json
{
  "moduleKey": "contacts",
  "sectionId": "<section-id>",
  "key": "docs_test_select",
  "label": "Docs Test Select",
  "fieldType": "select",
  "options": [
    { "value": "a", "label": "Option A" },
    { "value": "b", "label": "Option B" }
  ]
}
```

Response — `201 Created`:

```json
{
  "id": "65f9be89-aff9-4fa6-a1cc-de600ae4b160",
  "moduleKey": "contacts",
  "sectionId": "ace42a52-249a-4860-a053-0ae044b7cc8d",
  "key": "docs_test_select",
  "label": "Docs Test Select",
  "fieldType": "select",
  "isRequired": false,
  "isHidden": false,
  "isReadOnly": false,
  "isMasked": false,
  "isUnique": false,
  "isQuickCreate": false,
  "isGlobalSearch": false,
  "isSystem": false,
  "isActive": true,
  "position": 0,
  "config": {},
  "replacesFieldId": null,
  "options": [
    {
      "id": "567e6f44-d55b-4381-b012-0b978ac02bba",
      "fieldId": "65f9be89-aff9-4fa6-a1cc-de600ae4b160",
      "value": "a",
      "label": "Option A",
      "position": 0,
      "isHidden": false,
      "rowVersion": 1
    },
    {
      "id": "8199351a-01f4-4d58-8d6a-b7cebc163cfb",
      "fieldId": "65f9be89-aff9-4fa6-a1cc-de600ae4b160",
      "value": "b",
      "label": "Option B",
      "position": 1,
      "isHidden": false,
      "rowVersion": 1
    }
  ],
  "rowVersion": 1,
  "createdAt": "2026-09-25T20:54:25.066Z",
  "updatedAt": "2026-09-25T20:54:25.066Z"
}
```

`key` must be snake_case and is immutable once created (along with
`fieldType`) — a type change is modeled as a new field with
`replacesFieldId` pointing at the old one, never an in-place PATCH. A
non-option-backed field (`fieldType: "text"`, etc.) omits `options`
entirely rather than returning `options: []`.

Companies parity — the identical call with `"moduleKey": "companies"` and a
`record.company-properties.create` grant returns the same shape tagged
`"moduleKey": "companies"`.

#### GET /v2/fields

- **Permission**: `record.contact-properties.read` / `record.company-properties.read`
- **Postman**: `GET {{baseUrl}}/v2/fields?moduleKey=contacts&limit=20`

Response — `200 OK`:

```json
{
  "data": [
    {
      "id": "e83eca46-db23-4c1a-9651-1125649b9d29",
      "moduleKey": "contacts",
      "sectionId": "d1b3af71-4c6f-4845-bb04-9c87eefcf412",
      "key": "docs_final_select",
      "label": "Docs Final Select",
      "fieldType": "select",
      "isRequired": false,
      "isHidden": false,
      "isReadOnly": false,
      "isMasked": false,
      "isUnique": false,
      "isQuickCreate": false,
      "isGlobalSearch": false,
      "isSystem": false,
      "isActive": true,
      "position": 0,
      "config": {},
      "replacesFieldId": null,
      "options": [
        {
          "id": "ad9166c7-e1f4-4fcf-9c1e-4726c63f005b",
          "fieldId": "e83eca46-db23-4c1a-9651-1125649b9d29",
          "value": "a",
          "label": "Option A",
          "position": 0,
          "isHidden": false,
          "rowVersion": 1
        },
        {
          "id": "efea990f-0b91-4913-9a16-17c4913ee839",
          "fieldId": "e83eca46-db23-4c1a-9651-1125649b9d29",
          "value": "b",
          "label": "Option B",
          "position": 1,
          "isHidden": false,
          "rowVersion": 1
        }
      ],
      "rowVersion": 1,
      "createdAt": "2026-09-25T21:28:40.874Z",
      "updatedAt": "2026-09-25T21:28:40.874Z"
    },
    {
      "id": "747245c0-1503-431d-a67b-da5bb88a2c76",
      "moduleKey": "contacts",
      "sectionId": "d1b3af71-4c6f-4845-bb04-9c87eefcf412",
      "key": "docs_final_text",
      "label": "Docs Final Text",
      "fieldType": "text",
      "isRequired": false,
      "isHidden": false,
      "isReadOnly": false,
      "isMasked": false,
      "isUnique": false,
      "isQuickCreate": false,
      "isGlobalSearch": false,
      "isSystem": false,
      "isActive": true,
      "position": 1,
      "config": {},
      "replacesFieldId": null,
      "rowVersion": 1,
      "createdAt": "2026-09-25T21:28:40.967Z",
      "updatedAt": "2026-09-25T21:28:40.967Z"
    }
  ],
  "page": { "nextCursor": null, "hasMore": false, "limit": 20 }
}
```

**A real bug lived here until this pass**: this exact call — a module with
both an option-backed field (`select`/`multiselect`/`radio`) and a plain
field — used to 500 with `"malformed array literal"` from Postgres.
`FieldOptionsRepository.listByFieldIds` bound a JS array as a raw
`sql`-tagged `ANY($2)` parameter instead of using drizzle's `inArray()`,
which Postgres rejects outright. Fixed; the response above is the real,
now-working output. Filed as its own commit since it predates this PR and
had apparently never been hit over real HTTP with more than one field type
present in a module.

#### GET /v2/fields/:id

- **Permission**: `record.contact-properties.read` / `record.company-properties.read`
- **Postman**: `GET {{baseUrl}}/v2/fields/<id>`

Response — `200 OK`: single `FieldResponse`, same shape as one row of the
list above (including inline `options` for option-backed types). Fetching
one field by id was never affected by the list bug above — that crash was
specific to the multi-row list path.

#### PATCH /v2/fields/:id

- **Permission**: `record.contact-properties.update` / `record.company-properties.update`
- **Postman**: `PATCH {{baseUrl}}/v2/fields/<id>`, Body → raw → JSON
- Every flag except `key`/`fieldType`. Requires `rowVersion`; a mismatch returns `409 ROW_VERSION_CONFLICT`.

Request:

```json
{ "label": "Docs Test Select Updated", "rowVersion": 1 }
```

Response — `200 OK`: same shape, `label` updated, `rowVersion` incremented to `2`.

#### POST /v2/fields/reorder

- **Permission**: `record.contact-properties.update` / `record.company-properties.update`
- **Postman**: `POST {{baseUrl}}/v2/fields/reorder`, Body → raw → JSON

Request:

```json
{
  "moduleKey": "contacts",
  "sectionId": "<section-id>",
  "orderedIds": ["<field-id-2>", "<field-id-1>"]
}
```

Response — `204 No Content`, empty body.

#### DELETE /v2/fields/:id

- **Permission**: `record.contact-properties.delete` / `record.company-properties.delete`
- **Postman**: `DELETE {{baseUrl}}/v2/fields/<id>`

Response — `204 No Content`, empty body. Soft delete (`isActive: false`) —
existing records' `data` jsonb still has this key, so the column can't
disappear from under live rows. A system field (`isSystem: true`, e.g.
`first_name`, `email`) returns `409 FIELD_IS_SYSTEM` instead.

### Field Options

#### GET /v2/fields/:id/options

- **Permission**: `record.contact-properties.read` / `record.company-properties.read`
- **Postman**: `GET {{baseUrl}}/v2/fields/<id>/options`

Response — `200 OK`: bare array (no pagination envelope), e.g.:

```json
[
  {
    "id": "567e6f44-d55b-4381-b012-0b978ac02bba",
    "fieldId": "65f9be89-aff9-4fa6-a1cc-de600ae4b160",
    "value": "a",
    "label": "Option A",
    "position": 0,
    "isHidden": false,
    "rowVersion": 1
  },
  {
    "id": "8199351a-01f4-4d58-8d6a-b7cebc163cfb",
    "fieldId": "65f9be89-aff9-4fa6-a1cc-de600ae4b160",
    "value": "b",
    "label": "Option B",
    "position": 1,
    "isHidden": false,
    "rowVersion": 1
  }
]
```

#### POST /v2/fields/:id/options

- **Permission**: `record.contact-properties.create` / `record.company-properties.create`
- **Postman**: `POST {{baseUrl}}/v2/fields/<id>/options`, Body → raw → JSON

Request:

```json
{ "value": "c", "label": "Option C" }
```

Response — `201 Created`:

```json
{
  "id": "fe6d77d2-6bdb-4eba-bbf5-4d39e39f05d2",
  "fieldId": "65f9be89-aff9-4fa6-a1cc-de600ae4b160",
  "value": "c",
  "label": "Option C",
  "position": 2,
  "isHidden": false,
  "rowVersion": 1
}
```

#### PATCH /v2/fields/options/:optionId

- **Permission**: `record.contact-properties.update` / `record.company-properties.update`
- **Postman**: `PATCH {{baseUrl}}/v2/fields/options/<optionId>`, Body → raw → JSON

Request:

```json
{ "label": "Option C Updated", "rowVersion": 1 }
```

Response — `200 OK`: same shape, `label` updated, `rowVersion` incremented to `2`.

#### POST /v2/fields/:id/options/reorder

- **Permission**: `record.contact-properties.update` / `record.company-properties.update`
- **Postman**: `POST {{baseUrl}}/v2/fields/<id>/options/reorder`, Body → raw → JSON

Request:

```json
{ "orderedIds": ["<option-id-3>", "<option-id-1>", "<option-id-2>"] }
```

Response — `204 No Content`, empty body. `orderedIds` must all belong to
this field — an id from a different field (even in the same module) is
treated as not found rather than reordered.

#### DELETE /v2/fields/options/:optionId

- **Permission**: `record.contact-properties.delete` / `record.company-properties.delete`
- **Postman**: `DELETE {{baseUrl}}/v2/fields/options/<optionId>`

Response — `204 No Content`, empty body.

### Field Dependencies

Field-level (shows/hides a whole field) and option-level (which child
options a parent option permits) — two separate tables, same shape of
routes.

#### GET /v2/fields/:id/dependencies

- **Permission**: `record.contact-properties.read` / `record.company-properties.read`
- **Postman**: `GET {{baseUrl}}/v2/fields/<id>/dependencies`

Response — `200 OK`: bare array, `[]` if none exist yet.

#### POST /v2/fields/dependencies

- **Permission**: `record.contact-properties.create` / `record.company-properties.create`
- **Postman**: `POST {{baseUrl}}/v2/fields/dependencies`, Body → raw → JSON
- Rejected with `409 DEPENDENCY_CYCLE_DETECTED` if it would close a cycle.

Request:

```json
{
  "fieldId": "<dependent-field-id>",
  "dependsOnFieldId": "<parent-field-id>",
  "dependsOnOptionId": "<parent-option-id>"
}
```

Response — `201 Created`:

```json
{
  "id": "d584b22a-2449-44ab-a817-5f0edbf0e6b2",
  "fieldId": "cb42921f-c80c-4c8e-bb5c-32da44c31a4c",
  "dependsOnFieldId": "65f9be89-aff9-4fa6-a1cc-de600ae4b160",
  "dependsOnOptionId": "567e6f44-d55b-4381-b012-0b978ac02bba",
  "dependsOnValue": null,
  "createdAt": "2026-09-25T20:56:08.641Z"
}
```

`dependsOnOptionId` and `dependsOnValue` are mutually exclusive — set at
most one.

#### DELETE /v2/fields/dependencies/:dependencyId

- **Permission**: `record.contact-properties.delete` / `record.company-properties.delete`
- **Postman**: `DELETE {{baseUrl}}/v2/fields/dependencies/<dependencyId>`

Response — `204 No Content`, empty body.

#### GET /v2/fields/options/:optionId/dependencies

- **Permission**: `record.contact-properties.read` / `record.company-properties.read`
- **Postman**: `GET {{baseUrl}}/v2/fields/options/<optionId>/dependencies`

Response — `200 OK`: bare array, `[]` if none exist yet.

#### POST /v2/fields/options/dependencies

- **Permission**: `record.contact-properties.create` / `record.company-properties.create`
- **Postman**: `POST {{baseUrl}}/v2/fields/options/dependencies`, Body → raw → JSON

Request:

```json
{ "parentOptionId": "<parent-option-id>", "childOptionId": "<child-option-id>" }
```

Response — `201 Created`:

```json
{
  "id": "7a5e931a-d50a-4948-b147-81cefc22d1a3",
  "parentOptionId": "567e6f44-d55b-4381-b012-0b978ac02bba",
  "childOptionId": "8199351a-01f4-4d58-8d6a-b7cebc163cfb",
  "createdAt": "2026-09-25T20:56:17.203Z"
}
```

#### DELETE /v2/fields/options/dependencies/:dependencyId

- **Permission**: `record.contact-properties.delete` / `record.company-properties.delete`
- **Postman**: `DELETE {{baseUrl}}/v2/fields/options/dependencies/<dependencyId>`

Response — `204 No Content`, empty body.

### Status Options

Org-extensible enum groups (`lifecycle_stage`, `deal_status`, subscription
statuses, ...) — same generic moduleKey/permission-isolation pattern as
sections and fields above, scoped further by an `optionGroup` string.

#### POST /v2/status-options

- **Permission**: `record.contact-properties.create` / `record.company-properties.create`
- **Postman**: `POST {{baseUrl}}/v2/status-options`, Body → raw → JSON

Request:

```json
{
  "moduleKey": "contacts",
  "optionGroup": "docs_test_group",
  "value": "docs_a",
  "label": "Docs A",
  "isDefault": true
}
```

Response — `201 Created`:

```json
{
  "id": "16c4b170-4eb9-41bb-8d05-36355cfdae2b",
  "moduleKey": "contacts",
  "optionGroup": "docs_test_group",
  "value": "docs_a",
  "label": "Docs A",
  "color": null,
  "position": 0,
  "isDefault": true,
  "isActive": true,
  "rowVersion": 1
}
```

Companies parity — the identical call with `"moduleKey": "companies"` and a
`record.company-properties.create` grant returns the same shape tagged
`"moduleKey": "companies"`.

#### GET /v2/status-options

- **Permission**: `record.contact-properties.read` / `record.company-properties.read`
- **Postman**: `GET {{baseUrl}}/v2/status-options?moduleKey=contacts&optionGroup=docs_test_group&limit=20`

Response — `200 OK`: standard cursor-page envelope of the shape above.

#### PATCH /v2/status-options/:id

- **Permission**: `record.contact-properties.update` / `record.company-properties.update`
- **Postman**: `PATCH {{baseUrl}}/v2/status-options/<id>`, Body → raw → JSON
- Requires `rowVersion`; a mismatch returns `409 ROW_VERSION_CONFLICT`.

Request:

```json
{ "label": "Docs B Updated", "rowVersion": 1 }
```

Response — `200 OK`: same shape, `label` updated, `rowVersion` incremented to `2`.

#### POST /v2/status-options/reorder

- **Permission**: `record.contact-properties.update` / `record.company-properties.update`
- **Postman**: `POST {{baseUrl}}/v2/status-options/reorder`, Body → raw → JSON
- Unlike the section/field reorder routes, this one also needs `optionGroup`
  — options are only ordered relative to others in the same group.

Request:

```json
{ "moduleKey": "contacts", "optionGroup": "docs_test_group", "orderedIds": ["<id-2>", "<id-1>"] }
```

Response — `204 No Content`, empty body.

#### DELETE /v2/status-options/:id

- **Permission**: `record.contact-properties.delete` / `record.company-properties.delete`
- **Postman**: `DELETE {{baseUrl}}/v2/status-options/<id>`

Response — `204 No Content`, empty body.

**A bug fixed in this pass, shared across every reorder route above**: each
of `POST /v2/field-sections/reorder`, `POST /v2/fields/reorder`,
`POST /v2/fields/:id/options/reorder`, and `POST /v2/status-options/reorder`
returned a stray `201 Created` with an empty body instead of `204` — the
handler returns nothing, but had no `@HttpCode(HttpStatus.NO_CONTENT)`
decorator, so Nest fell back to its POST default. Fixed; the `204`s
documented above are the real, current behavior.

---

## Contacts — Tags

Org-wide tags and their attachment to contacts (`apps/api/src/modules/crm/tags`).

### POST /v2/tags

- **Permission**: `record.tags.create`
- **Postman**: `POST {{baseUrl}}/v2/tags`, Body → raw → JSON

Request:

```json
{ "name": "VIP", "color": "#ff0000" }
```

Response — `201 Created`:

```json
{
  "id": "d2c15d74-bda3-4916-92fc-6a27601a51bc",
  "name": "VIP",
  "color": "#ff0000",
  "rowVersion": 1,
  "createdAt": "2026-09-25T20:54:53.163Z",
  "updatedAt": "2026-09-25T20:54:53.163Z"
}
```

`color` is optional — omit it and the response carries `color: null`.

### GET /v2/tags

- **Permission**: `record.tags.read`
- **Postman**: `GET {{baseUrl}}/v2/tags?limit=10` (optional `q` filters by name substring)

Response — `200 OK`: standard cursor-page envelope of `TagResponse` rows.

### PATCH /v2/tags/:id

- **Permission**: `record.tags.update`
- **Postman**: `PATCH {{baseUrl}}/v2/tags/<id>`, Body → raw → JSON
- Requires `rowVersion`; a mismatch returns `409 ROW_VERSION_CONFLICT`.

Request:

```json
{ "name": "VIP Customer", "color": "#00ff00", "rowVersion": 1 }
```

Response — `200 OK`: same shape, updated fields, `rowVersion` incremented to `2`.

Re-sending the now-stale `rowVersion: 1` a second time:

```json
{
  "type": "https://errors.crm.platform/row_version_conflict",
  "title": "Conflict",
  "status": 409,
  "detail": "Tag was modified by someone else. Reload and try again.",
  "code": "ROW_VERSION_CONFLICT"
}
```

### DELETE /v2/tags/:id

- **Permission**: `record.tags.delete`
- **Postman**: `DELETE {{baseUrl}}/v2/tags/<id>`

Response — `204 No Content`, empty body. Removes the tag from every contact
it was attached to (org-wide delete, not per-contact).

### POST /v2/tags/attach

- **Permission**: `record.tags.update` (same key as PATCH — there is no separate "attach" permission)
- **Postman**: `POST {{baseUrl}}/v2/tags/attach`, Body → raw → JSON
- Idempotent per (contact, tag) pair.

Request:

```json
{
  "contactIds": ["fbeb432d-f56e-4f1e-9403-1adec16fe976"],
  "tagIds": ["d2c15d74-bda3-4916-92fc-6a27601a51bc"]
}
```

Response — `201 Created`:

```json
{ "succeeded": ["fbeb432d-f56e-4f1e-9403-1adec16fe976"], "failed": [] }
```

`BulkResult` shape — partial failure is reported per contact id, the same
pattern `bulk/update`/`bulk/delete` below use.

### GET /v2/contacts/:id/tags

- **Permission**: `record.contacts.read` (lives on `ContactsController`, not a `tags.*` key)
- **Postman**: `GET {{baseUrl}}/v2/contacts/<id>/tags`

Response — `200 OK`: bare `TagResponse[]` array (no pagination envelope).

### DELETE /v2/contacts/:id/tags/:tagId

- **Permission**: `record.contacts.update` (lives on `ContactsController`, not a `tags.*` key)
- **Postman**: `DELETE {{baseUrl}}/v2/contacts/<id>/tags/<tagId>`

Response — `204 No Content`, empty body. Detaches the tag from this one
contact — the tag itself is untouched.

---

## Contacts — Saved Views

Saved/shared list views (`apps/api/src/modules/crm/contact-views`).

### GET /v2/contact-views

- **Permission**: `record.contact-views.read`
- **Postman**: `GET {{baseUrl}}/v2/contact-views`

Response — `200 OK`: everything visible to the caller (own + org-shared) in
one page — same envelope shape as every list endpoint, but there's no real
cursor pagination since a saved-view count per org is small.

### POST /v2/contact-views

- **Permission**: `record.contact-views.create`
- **Postman**: `POST {{baseUrl}}/v2/contact-views`, Body → raw → JSON

Request:

```json
{
  "name": "VIP Prospects",
  "filter": { "and": [{ "field": "status", "op": "eq", "value": "lead" }] },
  "isShared": true
}
```

Response — `201 Created`:

```json
{
  "id": "234c6b69-e1bb-4163-af2b-d98db9ae01c0",
  "name": "VIP Prospects",
  "filter": { "and": [{ "op": "eq", "field": "status", "value": "lead" }] },
  "position": 0,
  "isShared": true,
  "createdBy": "02118b2e-96db-4ec0-9d76-aea6e18ac4c4",
  "isFavorite": false,
  "rowVersion": 1,
  "createdAt": "2026-09-25T20:54:47.895Z",
  "updatedAt": "2026-09-25T20:54:47.895Z"
}
```

`position` auto-assigns to the next free slot when omitted. `filter` is an
opaque AND/OR condition tree — the query-builder that consumes it is
Phase 13 (Segments), not built yet.

### PATCH /v2/contact-views/:id

- **Permission**: `record.contact-views.update`
- **Postman**: `PATCH {{baseUrl}}/v2/contact-views/<id>`, Body → raw → JSON
- Requires `rowVersion`; a mismatch returns `409 ROW_VERSION_CONFLICT`.

Request:

```json
{ "name": "VIP Prospects (Q4)", "rowVersion": 1 }
```

Response — `200 OK`: same shape, `name` updated, `rowVersion` incremented to `2`.

### POST /v2/contact-views/reorder

- **Permission**: `record.contact-views.update`
- **Postman**: `POST {{baseUrl}}/v2/contact-views/reorder`, Body → raw → JSON

Request:

```json
{ "orderedIds": ["<view-id-2>", "<view-id-1>"] }
```

Response — `204 No Content`, empty body.

### POST /v2/contact-views/:id/favorite

- **Permission**: `record.contact-views.read` — pinning a shared view onto
  your own sidebar is a read-side personalization, not a mutation of the
  view record itself.
- **Postman**: `POST {{baseUrl}}/v2/contact-views/<id>/favorite`

Response — `204 No Content`, empty body. The view's `isFavorite` flips to
`true` for the calling user only — other users' visibility is unaffected.

### DELETE /v2/contact-views/:id/favorite

- **Permission**: `record.contact-views.read`
- **Postman**: `DELETE {{baseUrl}}/v2/contact-views/<id>/favorite`

Response — `204 No Content`, empty body. Unpins the view — the view itself
is not deleted.

### DELETE /v2/contact-views/:id

- **Permission**: `record.contact-views.delete`
- **Postman**: `DELETE {{baseUrl}}/v2/contact-views/<id>`

Response — `204 No Content`, empty body. Hard-deletes the view row.

**A bug fixed in this pass**: `POST /v2/contact-views/reorder` and
`POST /v2/contact-views/:id/favorite` returned a stray `201 Created` with an
empty body instead of `204` — same missing-`@HttpCode` cause as the
field-metadata reorder routes above. Fixed; the `204`s documented above are
the real, current behavior.

---

## Contacts — Bulk, Assignment & Misc

Everything on `ContactsController` besides the base list/get/create/update/
delete CRUD, which is already documented under **Contacts** above.

### GET /v2/contacts/select-data

- **Permission**: `record.contacts.read`
- **Postman**: `GET {{baseUrl}}/v2/contacts/select-data` (optional `q`, `limit` — default 20)

Response — `200 OK`: bare array of lightweight rows for pickers/typeaheads —
never the full `ContactResponse`:

```json
[
  {
    "id": "dba6966c-1093-4f42-ad14-ac7d3b96b9fe",
    "name": "Demo Contact 1",
    "email": "demo1@studyfromuae.test",
    "phone": "+919876500001"
  }
]
```

### GET /v2/contacts/assignees

- **Permission**: `record.contacts.read`
- **Postman**: `GET {{baseUrl}}/v2/contacts/assignees`

Response — `200 OK`: the org's full active-staff list (used to pick a valid
`ownerId` for the routes below):

```json
[
  {
    "id": "631ad5e1-9aff-4a80-af19-2189f37b4e25",
    "fullName": "Agent One",
    "email": "agent1@studyfromuae.test"
  }
]
```

### POST /v2/contacts/bulk/update

- **Permission**: `record.contacts.update`
- **Postman**: `POST {{baseUrl}}/v2/contacts/bulk/update`, Body → raw → JSON
- Each id is transactional independently (per-row `SAVEPOINT`) — one bad id
  fails on its own, reported in `failed`, without affecting the rest.

Request — two real contacts and one that doesn't exist, on purpose:

```json
{
  "ids": [
    "fbeb432d-f56e-4f1e-9403-1adec16fe976",
    "74023b5b-5603-4787-aa94-d71940b8c50d",
    "00000000-0000-0000-0000-000000000000"
  ],
  "values": { "lifecycleStage": "qualified" }
}
```

Response — `201 Created`:

```json
{
  "succeeded": ["fbeb432d-f56e-4f1e-9403-1adec16fe976", "74023b5b-5603-4787-aa94-d71940b8c50d"],
  "failed": [
    {
      "id": "00000000-0000-0000-0000-000000000000",
      "code": "NOT_FOUND",
      "message": "Contact not found"
    }
  ]
}
```

The two real contacts land in `succeeded`; the fake id lands in `failed`
instead of failing the whole batch — the point of the per-row `SAVEPOINT`
isolation. Status is `201` (Nest's default for a bare `@Post`) even though
semantically this is an update, not a creation.

### POST /v2/contacts/bulk/delete

- **Permission**: `record.contacts.delete`
- **Postman**: `POST {{baseUrl}}/v2/contacts/bulk/delete`, Body → raw → JSON
- Same per-id partial-failure semantics as `bulk/update`.

Request:

```json
{ "ids": ["<throwaway-contact-id>", "00000000-0000-0000-0000-000000000000"] }
```

Response — `201 Created`: same `BulkResult` shape as `bulk/update`.

### POST /v2/contacts/assignee

- **Permission**: `record.contacts.update`
- **Postman**: `POST {{baseUrl}}/v2/contacts/assignee`, Body → raw → JSON
- Sets (or clears, with `ownerId: null`) the owner on multiple contacts at once.

Request:

```json
{
  "ids": ["fbeb432d-f56e-4f1e-9403-1adec16fe976"],
  "ownerId": "c8eec1d8-34f2-4e6e-8565-85729ec2bb09"
}
```

Response — `201 Created`: same `BulkResult` shape as `bulk/update`, even
though this is a single-purpose route.

### GET /v2/contacts/:id/field-history

- **Permission**: `record.contacts.read`
- **Postman**: `GET {{baseUrl}}/v2/contacts/<id>/field-history`

Response — `200 OK`: reuses the kernel `audit_log` via
`AuditService.listByRecord()` rather than a dedicated table:

```json
{
  "data": [
    {
      "fieldKey": "lifecycleStage",
      "oldValue": "qualified",
      "newValue": "customer",
      "actorType": "user",
      "changedByUserId": "02118b2e-96db-4ec0-9d76-aea6e18ac4c4",
      "changedAt": "2026-09-25T20:55:38.495Z"
    },
    {
      "fieldKey": "ownerId",
      "newValue": "c8eec1d8-34f2-4e6e-8565-85729ec2bb09",
      "actorType": "user",
      "changedByUserId": "02118b2e-96db-4ec0-9d76-aea6e18ac4c4",
      "changedAt": "2026-09-25T21:32:30.232Z"
    }
  ],
  "page": { "nextCursor": null, "hasMore": false, "limit": 50 }
}
```

**A bug fixed in this pass**: the `ownerId` entry used to carry the
_internal bigint_ owner id as `newValue` (e.g. `6`), not a uuid —
`ContactsService.setAssignee`'s audit delta used the already-resolved
internal id instead of the caller-supplied uuid. Every other field/route in
this API resolves ids to uuid at the response edge; this was the
one place that leaked one. Fixed; the `ownerId` entry above is the real,
current response. An entry with no prior value (like `ownerId` here, on a
contact that had no previous owner change recorded in this trail) simply
omits `oldValue` from the JSON rather than sending `null`.

---

## Contacts — Notes

Free-text notes on a contact (`apps/api/src/modules/crm/contact-notes`,
`/v2/contacts/:contactId/notes`). Full CRUD.

### GET /v2/contacts/:contactId/notes

- **Permission**: `record.contacts.read`
- **Postman**: `GET {{baseUrl}}/v2/contacts/<contactId>/notes`

Response — `200 OK`: standard cursor-page envelope, `[]` for a contact with no notes.

### POST /v2/contacts/:contactId/notes

- **Permission**: `record.contacts.update`
- **Postman**: `POST {{baseUrl}}/v2/contacts/<contactId>/notes`, Body → raw → JSON

Request:

```json
{ "body": "Called the contact, interested in the Pro plan. Follow up next week." }
```

Response — `201 Created`:

```json
{
  "id": "7283055e-fbe9-45b5-8987-5821e05ba888",
  "contactId": "fbeb432d-f56e-4f1e-9403-1adec16fe976",
  "body": "Called the contact, interested in the Pro plan. Follow up next week.",
  "createdBy": "02118b2e-96db-4ec0-9d76-aea6e18ac4c4",
  "updatedBy": "02118b2e-96db-4ec0-9d76-aea6e18ac4c4",
  "rowVersion": 1,
  "createdAt": "2026-09-25T20:54:26.566Z",
  "updatedAt": "2026-09-25T20:54:26.566Z"
}
```

### PATCH /v2/contacts/:contactId/notes/:id

- **Permission**: `record.contacts.update`
- **Postman**: `PATCH {{baseUrl}}/v2/contacts/<contactId>/notes/<id>`, Body → raw → JSON
- Requires `rowVersion`; a mismatch returns `409 ROW_VERSION_CONFLICT`.

Request:

```json
{
  "body": "Called the contact, interested in the Pro plan. Follow up next week. UPDATE: sent pricing sheet.",
  "rowVersion": 1
}
```

Response — `200 OK`: same shape, `body` updated, `rowVersion` incremented to `2`.

> **Note found in this pass**: the note is looked up by its own uuid,
> org-scoped only — the `:contactId` in the URL is never checked against the
> note's actual contact. Not a cross-tenant issue (org scoping still
> applies), but worth knowing before relying on the URL shape for anything.
> See the open follow-up on permission-scope enforcement below.

### DELETE /v2/contacts/:contactId/notes/:id

- **Permission**: `record.contacts.update`
- **Postman**: `DELETE {{baseUrl}}/v2/contacts/<contactId>/notes/<id>`

Response — `204 No Content`, empty body. Hard delete — no soft-delete flag
on this table.

---

## Contacts — Files

Metadata-only file records (`apps/api/src/modules/crm/contact-files`,
`/v2/contacts/:contactId/files`) — **no real storage provider exists yet**
(Phase 9/File Manager). `storageKey` is caller-supplied and not validated
against any actual object store.

### GET /v2/contacts/:contactId/files

- **Permission**: `record.contacts.read`
- **Postman**: `GET {{baseUrl}}/v2/contacts/<contactId>/files`

Response — `200 OK`: standard cursor-page envelope, `[]` for a contact with no files.

### POST /v2/contacts/:contactId/files

- **Permission**: `record.contacts.update`
- **Postman**: `POST {{baseUrl}}/v2/contacts/<contactId>/files`, Body → raw → JSON

Request:

```json
{
  "fileName": "contract-signed.pdf",
  "fileSizeBytes": 248312,
  "storageKey": "orgs/1/contacts/fbeb432d-f56e-4f1e-9403-1adec16fe976/contract-signed.pdf",
  "mimeType": "application/pdf"
}
```

Response — `201 Created`:

```json
{
  "id": "32b97b10-6743-45ba-97d1-529df0401211",
  "contactId": "fbeb432d-f56e-4f1e-9403-1adec16fe976",
  "fileName": "contract-signed.pdf",
  "fileSizeBytes": 248312,
  "storageKey": "orgs/1/contacts/fbeb432d-f56e-4f1e-9403-1adec16fe976/contract-signed.pdf",
  "mimeType": "application/pdf",
  "uploadedBy": "02118b2e-96db-4ec0-9d76-aea6e18ac4c4",
  "createdAt": "2026-09-25T20:54:39.762Z"
}
```

### DELETE /v2/contacts/:contactId/files/:id

- **Permission**: `record.contacts.update`
- **Postman**: `DELETE {{baseUrl}}/v2/contacts/<contactId>/files/<id>`

Response — `204 No Content`, empty body. Hard delete — no soft-delete/
tombstone on this table.

---

## Contacts — Activities

Append-only activity timeline (`apps/api/src/modules/crm/contact-activities`,
`/v2/contacts/:contactId/activities`) — list and create only, no
update/delete.

### GET /v2/contacts/:contactId/activities

- **Permission**: `record.contacts.read`
- **Postman**: `GET {{baseUrl}}/v2/contacts/<contactId>/activities`

Response — `200 OK`: standard cursor-page envelope — but the cursor is
built from `occurredAt` (which can be backdated, e.g. importing historical
activity), not `createdAt` — the shared `buildPage()` helper hardcodes
`createdAt` and would build the wrong bound here, so this route's repository
writes its own cursor logic instead (see the pattern note in
`contact-activities.service.ts`).

### POST /v2/contacts/:contactId/activities

- **Permission**: `record.contacts.update`
- **Postman**: `POST {{baseUrl}}/v2/contacts/<contactId>/activities`, Body → raw → JSON

Request:

```json
{
  "activityType": "note",
  "title": "Followed up with contact",
  "body": "Called to confirm renewal details."
}
```

Response — `201 Created`:

```json
{
  "id": "2c8773f2-a516-4cbc-b8e5-f080ff8894ec",
  "contactId": "fbeb432d-f56e-4f1e-9403-1adec16fe976",
  "activityType": "note",
  "title": "Followed up with contact",
  "body": "Called to confirm renewal details.",
  "source": "user",
  "actorId": "02118b2e-96db-4ec0-9d76-aea6e18ac4c4",
  "occurredAt": "2026-09-25T20:54:34.503Z",
  "createdAt": "2026-09-25T20:54:34.503Z"
}
```

`source` is not a request field — the API always writes `"user"` for calls
through this route; `"system"`/`"bot"` (the table's other two CHECK-allowed
values) are only ever written by internal service code, never reachable
here. `occurredAt` accepts an optional ISO datetime on create for
backdating; omitted, it defaults to now.

---

## Contacts — Meetings

Scheduled meetings on a contact (`apps/api/src/modules/crm/contact-meetings`,
`/v2/contacts/:contactId/meetings`). Full CRUD; `startsAt`/`endsAt` are nullable.

### GET /v2/contacts/:contactId/meetings

- **Permission**: `record.contacts.read`
- **Postman**: `GET {{baseUrl}}/v2/contacts/<contactId>/meetings`

Response — `200 OK`: standard cursor-page envelope, `[]` for a contact with no meetings.

### POST /v2/contacts/:contactId/meetings

- **Permission**: `record.contacts.update`
- **Postman**: `POST {{baseUrl}}/v2/contacts/<contactId>/meetings`, Body → raw → JSON

Request:

```json
{
  "title": "Quarterly renewal check-in",
  "startsAt": "2026-10-02T09:30:00.000Z",
  "endsAt": "2026-10-02T10:00:00.000Z",
  "location": "Zoom"
}
```

Response — `201 Created`:

```json
{
  "id": "b3d5a4ca-c152-47ff-93da-7051975e416f",
  "contactId": "fbeb432d-f56e-4f1e-9403-1adec16fe976",
  "title": "Quarterly renewal check-in",
  "startsAt": "2026-10-02T09:30:00.000Z",
  "endsAt": "2026-10-02T10:00:00.000Z",
  "location": "Zoom",
  "createdBy": "02118b2e-96db-4ec0-9d76-aea6e18ac4c4",
  "rowVersion": 1,
  "createdAt": "2026-09-25T20:54:27.007Z",
  "updatedAt": "2026-09-25T20:54:27.007Z"
}
```

### PATCH /v2/contacts/:contactId/meetings/:id

- **Permission**: `record.contacts.update`
- **Postman**: `PATCH {{baseUrl}}/v2/contacts/<contactId>/meetings/<id>`, Body → raw → JSON
- Requires `rowVersion`; a mismatch returns `409 ROW_VERSION_CONFLICT`.
  `startsAt`/`endsAt` are nullish on update — send `null` to explicitly
  clear one, omit the key to leave it unchanged.

Request:

```json
{ "title": "Quarterly renewal check-in (rescheduled)", "endsAt": null, "rowVersion": 1 }
```

Response — `200 OK`:

```json
{
  "id": "b3d5a4ca-c152-47ff-93da-7051975e416f",
  "contactId": "fbeb432d-f56e-4f1e-9403-1adec16fe976",
  "title": "Quarterly renewal check-in (rescheduled)",
  "startsAt": "2026-10-02T09:30:00.000Z",
  "endsAt": null,
  "location": "Zoom",
  "createdBy": "02118b2e-96db-4ec0-9d76-aea6e18ac4c4",
  "rowVersion": 2,
  "createdAt": "2026-09-25T20:54:27.007Z",
  "updatedAt": "2026-09-25T20:54:50.215Z"
}
```

### DELETE /v2/contacts/:contactId/meetings/:id

- **Permission**: `record.contacts.update`
- **Postman**: `DELETE {{baseUrl}}/v2/contacts/<contactId>/meetings/<id>`

Response — `204 No Content`, empty body.

---

## Known gap: contact sub-resources don't apply record scope

`record.contacts.update`/`.read` both have `supports_scope: true` — an org
can grant a role `own` or `team` scope, not just `all` (see the seeded
Counsellor role: `record.contacts.update` at scope `own`). `ContactsController`
itself applies that scope on its base list/get/update routes. **Tags,
Notes, Files, Activities, and Meetings do not** — they reuse the same
`record.contacts.read`/`.update` keys but never check the scope against the
parent contact's owner, so an `own`-scoped role can read/write any
contact's notes/files/activities/meetings/tags org-wide, not just their own
contacts'. Per the `rbac-permission` skill's own warning, a permission with
no scope-applying code behind it is worse than no permission — it reads as
properly restricted while quietly not being. Not fixed in this pass (it's a
real feature addition across four modules, not a one-line bug); tracked as
a follow-up.

---

## Partner Portal (sub-agent pool — separate login, separate token)

Run **POST /v2/auth/partner/login** first; these routes reject a staff
(`typ: "user"`) token.

### POST /v2/partner/leads

- **Auth**: partner-agent bearer token
- **Postman**: `POST {{baseUrl}}/v2/partner/leads`, Body → raw → JSON

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

### GET /v2/partner/leads

- **Postman**: `GET {{baseUrl}}/v2/partner/leads`

Response — `200 OK`: `{ data: [...leads this agent submitted], page: {...} }`
— same envelope shape as every other list endpoint. Structurally scoped: this
agent can never see another agent's leads, there is no scope parameter to ask
for it.

### GET /v2/partner/leads/:id

- **Postman**: `GET {{baseUrl}}/v2/partner/leads/<id>`

Response — `200 OK`: single lead, same shape as the POST response above.

---

## Public API (external partner systems — API key + HMAC, not a bearer token)

### GET /public/v1/leads/:id

- **Auth**: `X-Api-Key` header + HMAC signature
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
