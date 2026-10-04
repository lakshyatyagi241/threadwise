# API: companies

Domain `ctp` (companies; WD-CTP-001 .. 013). Base path `/v2`. Errors are `application/problem+json` with a stable `code` and a
`requestId`; the code this domain adds is `COMPANY_OWNER_INVALID` in `@crm/contracts` `common/errors.ts`. Request and response shapes
live in `packages/contracts/src/companies/`. Live docs: `/docs`. Every id on the wire is a uuid. Decisions where the port differs from
WaDesk: "Port decisions" in `docs/wadesk-port/inventory/companies.md`.

All routes need a staff bearer token, the plan's **sales pipeline** (`422 PLAN_FEATURE_LOCKED` otherwise, reads included: the flag
WaDesk gated companies on) and the capability in brackets. "scope" means the caller's record scope applied to **who the company
belongs to**: `own` is "owned by me or created by me" (so whoever hands a company to a colleague keeps seeing it), `team` adds people
who share a team with me, `all` is the workspace. A company outside the scope is `404`, never `403`; so is a company of another
workspace. Literal paths (`stats`, `industries`, `select-data`, `bulk/delete`) are registered before `:id`. `POST` create accepts an
`Idempotency-Key`.

## Capabilities

| Key                       | Scope | Grants                                                                   |
| ------------------------- | ----- | ------------------------------------------------------------------------ |
| `record.companies.read`   | yes   | list, tiles, industries, picker, get, a company's contacts, its activity |
| `record.companies.create` | no    | create a company                                                         |
| `record.companies.update` | yes   | edit, and link or unlink a company's contacts                            |
| `record.companies.delete` | yes   | delete one company, or bulk delete                                       |

The Owner, Admin and Manager presets hold all four at scope `all`. The Agent preset gets read and create at `all` (companies are
shared accounts, so an Agent can pick any of them on a deal) and update at `own`; it cannot delete. The Viewer preset has none. The
dev seed's `Counsellor` has the Agent's. Linking or unlinking a contact also needs `record.contacts.update` (each contact's own scope
applies), and a company's contact list needs `record.contacts.read`. A caller without `record.contacts.read` or `record.deals.read`
gets `null` for that part of the rollup.

## The company

```json
{
  "id": "5c1e…",
  "displayId": "COM-00001",
  "name": "Acme Ltd",
  "website": "acme.test",
  "email": "ops@acme.test",
  "phone": "+1 555 0100",
  "industry": "Retail",
  "sizeRange": "11-50",
  "address": "1 Main St",
  "notes": "Key account",
  "owner": { "id": "…", "name": "Asha" },
  "createdBy": { "id": "…", "name": "Asha" },
  "rollup": {
    "contacts": 3,
    "deals": {
      "total": 4,
      "open": 2,
      "won": 1,
      "openValue": [{ "currency": "USD", "amount": "150.50" }],
      "wonValue": [
        { "currency": "EUR", "amount": "10.00" },
        { "currency": "USD", "amount": "40.00" }
      ]
    }
  },
  "rowVersion": 3,
  "createdAt": "…",
  "updatedAt": "…"
}
```

`website` is free text (WaDesk never checked it); it is stored in `companies.domain`. The `rollup` is computed in the database over
every linked record: `contacts` counts the non-archived contacts of the company; the deal figures are per currency and are never
added across currencies, in the currency's own decimals (WaDesk summed minor units of every currency and divided by 100).

## Routes

| Route                                       | Capability                | Notes                                                                                                |
| ------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------- |
| `GET /companies`                            | `record.companies.read`   | cursor-paged list (below)                                                                            |
| `GET /companies/stats`                      | `record.companies.read`   | the three tiles for the same filters                                                                 |
| `GET /companies/industries`                 | `record.companies.read`   | the distinct industries typed so far (the industry filter's options)                                 |
| `GET /companies/select-data`                | `record.companies.read`   | picker rows `{id, name, industry}` (WaDesk: `GET companies/search`)                                  |
| `POST /companies`                           | `record.companies.create` | 201                                                                                                  |
| `GET /companies/:id`                        | `record.companies.read`   | with its rollup                                                                                      |
| `PATCH /companies/:id`                      | `record.companies.update` | needs `rowVersion` (409 `ROW_VERSION_CONFLICT`); absent keeps, `null` or `""` clears                 |
| `DELETE /companies/:id`                     | `record.companies.delete` | 204; contacts, deals and every other record that pointed at it are kept and unlinked                 |
| `POST /companies/bulk/delete`               | `record.companies.delete` | `{ ids }` (1 to 100)                                                                                 |
| `GET /companies/:id/contacts`               | `record.companies.read`   | the company's contacts, newest first, cursor-paged; needs `record.contacts.read`                     |
| `POST /companies/:id/contacts`              | `record.companies.update` | `{ contactIds }` (1 to 100): put existing contacts under the company; needs `record.contacts.update` |
| `DELETE /companies/:id/contacts/:contactId` | `record.companies.update` | 204; take a contact out of the company (404 when it is not one of its contacts)                      |
| `GET /companies/:id/activity`               | `record.companies.read`   | who changed what, newest first, cursor-paged                                                         |
| `GET /deals?companyId=:id`                  | `record.deals.read`       | the company's deals (the deals module; the company page uses it)                                     |
| `GET /tasks?companyId=:id`                  | `record.tasks.read`       | the company's tasks (the tasks module)                                                               |

### Create and edit

```json
// POST /v2/companies
{
  "name": "Acme Ltd",
  "email": "ops@acme.test",
  "phone": "+1 555 0100",
  "website": "acme.test",
  "industry": "Retail",
  "sizeRange": "11-50",
  "address": "1 Main St",
  "notes": "Key account",
  "ownerId": "…"
}
```

Only `name` is required (trimmed, 1 to 191 characters). The other limits are WaDesk's: `email` an address up to 191, `phone` up to
32 (free text), `website` up to 191, `industry` up to 100, `sizeRange` up to 40, `address` up to 500, `notes` up to 2000. Every text
field is trimmed and an empty string means "nothing" (it clears the field on edit, as WaDesk's input middleware did). `ownerId`
omitted means the caller, `null` means nobody; anyone who is not an **active member of this workspace** is
`422 COMPANY_OWNER_INVALID`. Duplicate names are allowed. A create writes `display_id` (`COM-nnnnn`), an audit row and
`company.created`.

An edit takes only the fields it changes plus the `rowVersion` that was read. The name cannot be cleared (`422`). An edit that
changes nothing writes no audit row and no event and does not move the version.

### The list

`GET /companies?q=acme&sort=name&ownerId=…&industry=retail&hasOpenDeals=true&limit=50&cursor=…`

| Query          | Meaning                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------ |
| `q`            | case-insensitive substring of the name (the only field WaDesk searched); `%` and `_` are letters |
| `ownerId`      | owned by that member (a member who has left is still filterable)                                 |
| `unassigned`   | owned by nobody; not together with `ownerId` (`422`)                                             |
| `industry`     | exactly this industry, any case                                                                  |
| `hasOpenDeals` | only companies with at least one open deal                                                       |
| `sort`         | `created` (newest first, WaDesk's order; the default) or `name` (A to Z, case-insensitive)       |
| `limit`        | 1 to 200 (default 50); there is no 500-row cap                                                   |
| `cursor`       | the opaque `page.nextCursor` of the last page                                                    |

The answer is `{ data: Company[], page: { nextCursor, hasMore, limit } }`. The cursor is a keyset over the sort key (the
`created_at` instant at microsecond precision, or the lower-cased name) plus the row id, so rows that tie are never lost or repeated;
it is tied to its sort (a `created` cursor against `sort=name` is `400`). A damaged cursor is `400`; an invalid query is `422`.

`GET /companies/stats` takes the same filters (not `sort`, `limit` or `cursor`) and answers the three tiles:

```json
{ "total": 12, "withOpenDeals": 4, "wonValue": [{ "currency": "USD", "amount": "9400.00" }] }
```

`withOpenDeals` and `wonValue` are `null` for a caller without `record.deals.read`. Unlike WaDesk's page (tiles computed from the
rows it had loaded), they cover every company inside the caller's scope and the filter.

### Contacts of a company

`GET /companies/:id/contacts?limit=50&cursor=…` answers `{ data: [{ id, name, phone, email }], page }`, newest first by id (WaDesk's
order). A contact the caller's `record.contacts.read` scope cannot see is not listed. `name` is `null` for a contact without one (the
screen says "(no name)").

```json
// POST /v2/companies/:id/contacts   { "contactIds": ["…", "…"] }
{
  "succeeded": ["…"],
  "failed": [{ "id": "…", "code": "NOT_FOUND", "message": "Contact … not found" }]
}
```

Each contact is its own savepoint: ids that do not exist, belong to another workspace or fall outside the caller's contact scope are
listed in `failed` and do not stop the others; duplicates are applied once. A contact already in the company succeeds with no write; a
contact in another company **moves**. Each move writes the contact's own audit row (`companyId` old and new, visible in its field
history) and `contact.updated`, plus an audit row and an event on each company involved (`contactLinked` / `contactUnlinked`,
`company.contact_linked`, `company.contact_unlinked`).

### Bulk delete

`POST /companies/bulk/delete {"ids": [...]}` answers `{ succeeded, failed }` like the contact link. One transaction per call, each
company in its own savepoint. Each success writes its own audit row and `company.deleted`.

### Activity

```json
// GET /v2/companies/:id/activity?limit=20&cursor=…
{
  "data": [
    {
      "action": "update",
      "actor": { "id": "…", "name": "Asha" },
      "at": "2026-10-05T10:00:00.000Z",
      "changes": [
        { "field": "industry", "old": "Retail", "new": "Software" },
        { "field": "owner", "old": "Asha", "new": "Ben" },
        { "field": "contactLinked", "old": null, "new": { "id": "…", "name": "Ana" } }
      ]
    }
  ],
  "page": { "nextCursor": null, "hasMore": false, "limit": 20 }
}
```

Read from the audit trail of the company (`module = companies`): the create (`insert`), each edit field by field (`name, website,
email, phone, industry, sizeRange, address, notes, owner`), and contacts linked and unlinked. Owners and contacts are stored by uuid
and named when read (`null` when the contact has since been deleted). The trail of a deleted company is not reachable.

## Delete

`DELETE /companies/:id` is a hard delete. Contacts, deals, tasks, projects, proposals and estimates, invoices, recurring invoices,
sales orders and payments that pointed at the company are **unlinked, not deleted**: each table's composite foreign key is
`ON DELETE SET NULL (company_id)`, so their `row_version` and update stamp move and nothing is left dangling (WaDesk unlinked
contacts and deals by hand and left the rest pointing at a missing id). The audit row names what it unlinked
(`contactsUnlinked`, `dealsUnlinked`) and `company.deleted` carries the same counts.

## Events (outbox)

Aggregate `companies`. Payloads carry uuids and the few fields a consumer decides on (`uuid, displayId, name, industry, ownerId,
createdById`), plus `_meta`. At-least-once, written in the transaction of the change.

| Event                      | When                                                                      |
| -------------------------- | ------------------------------------------------------------------------- |
| `company.created`          | a company is created                                                      |
| `company.updated`          | a real edit (`changed` lists the fields)                                  |
| `company.deleted`          | a delete, one or in bulk (`unlinkedContacts`, `unlinkedDeals`)            |
| `company.contact_linked`   | a contact is put under the company (`contactId`, `previousCompanyId`)     |
| `company.contact_unlinked` | a contact leaves the company, by unlink or because it moved (`contactId`) |

The contact side is `contact.updated` on aggregate `contacts` (payload adds `companyId` and `previousCompanyId`).

## Where other screens show a company

| Screen          | What it shows                                                                                |
| --------------- | -------------------------------------------------------------------------------------------- |
| Contact page    | the company's name, linking to `/companies/:id` (the name is read from `GET /companies/:id`) |
| Deal drawer     | "Company: name" linking to the company (the deal already carries `company: {id, name}`)      |
| Deals and tasks | `companyId` on create and edit, `GET /deals?companyId=`, `GET /tasks?companyId=`             |

## Not built here

The "Generate brief" button on the company page (the client brief feature is not built), the AI copilot's company tools (owned by
the AI domain; they call `CompaniesService`), a company's tasks card, a company picker on the contact and deal forms, and a company
properties screen. See "Not built here" in the inventory.
