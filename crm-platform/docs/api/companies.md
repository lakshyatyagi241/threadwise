# API: companies

Domain `ctp` (companies; TW-CTP-001 .. 013). Base path `/v2`. Errors are `application/problem+json` with a stable `code` and a
`requestId`; the code this domain adds is `COMPANY_OWNER_INVALID` in `@crm/contracts` `common/errors.ts`. Request and response shapes
live in `packages/contracts/src/companies/`. Live docs: `/docs`. Every id on the wire is a uuid. Decisions where the port differs from
Reference: "Port decisions" in `docs/threadwise-port/inventory/companies.md`.

All routes need a staff bearer token, the plan's **sales pipeline** (`422 PLAN_FEATURE_LOCKED` otherwise, reads included: the flag
Reference gated companies on) and the capability in brackets. "scope" means the caller's record scope applied to **who the company
belongs to**: `own` is "owned by me or created by me" (so whoever hands a company to a colleague keeps seeing it), `team` adds people
who share a team with me, `all` is the workspace. A company outside the scope is `404`, never `403`; so is a company of another
workspace. Literal paths (`stats`, `industries`, `select-data`, `bulk/delete`) are registered before `:id`. `POST` create accepts an
`Idempotency-Key`.

## Capabilities

| Key                                              | Scope | Grants                                                                                                                                                                                                               |
| ------------------------------------------------ | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `record.companies.read`                          | yes   | list, tiles, industries, picker, get, a company's contacts, its activity                                                                                                                                             |
| `record.companies.create`                        | no    | create a company                                                                                                                                                                                                     |
| `record.companies.update`                        | yes   | edit, and link or unlink a company's contacts                                                                                                                                                                        |
| `record.companies.delete`                        | yes   | delete one company, or bulk delete                                                                                                                                                                                   |
| `record.company-properties.read`                 | no    | read the definitions of the workspace's company properties (`/v2/fields`, `/v2/field-sections` with `moduleKey=companies`); the Agent and Manager presets hold it (20261217090000) so the company form can draw them |
| `record.company-properties.create/update/delete` | no    | define, edit, reorder and deactivate company properties; Owner and Admin only by default                                                                                                                             |

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
  "customFields": { "tier": "gold", "seats": 12 },
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

`website` is free text (Reference never checked it); it is stored in `companies.domain`. The `rollup` is computed in the database over
every linked record: `contacts` counts the non-archived contacts of the company; the deal figures are per currency and are never
added across currencies, in the currency's own decimals (Reference summed minor units of every currency and divided by 100).

## Routes

| Route                                       | Capability                | Notes                                                                                                                                                                     |
| ------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /companies`                            | `record.companies.read`   | cursor-paged list (below)                                                                                                                                                 |
| `GET /companies/stats`                      | `record.companies.read`   | the three tiles for the same filters                                                                                                                                      |
| `GET /companies/industries`                 | `record.companies.read`   | the distinct industries typed so far (the industry filter's options)                                                                                                      |
| `GET /companies/select-data`                | `record.companies.read`   | picker rows `{id, name, industry}` (Reference: `GET companies/search`)                                                                                                    |
| `POST /companies`                           | `record.companies.create` | 201                                                                                                                                                                       |
| `GET /companies/:id`                        | `record.companies.read`   | with its rollup                                                                                                                                                           |
| `PATCH /companies/:id`                      | `record.companies.update` | needs `rowVersion` (409 `ROW_VERSION_CONFLICT`); absent keeps, `null` or `""` clears                                                                                      |
| `DELETE /companies/:id`                     | `record.companies.delete` | 204; contacts, deals and every other record that pointed at it are kept and unlinked                                                                                      |
| `POST /companies/bulk/delete`               | `record.companies.delete` | `{ ids }` (1 to 100)                                                                                                                                                      |
| `GET /companies/:id/contacts`               | `record.companies.read`   | the company's contacts, newest first, cursor-paged; needs `record.contacts.read`                                                                                          |
| `POST /companies/:id/contacts`              | `record.companies.update` | `{ contactIds }` (1 to 100): put existing contacts under the company; needs `record.contacts.update`                                                                      |
| `DELETE /companies/:id/contacts/:contactId` | `record.companies.update` | 204; take a contact out of the company (404 when it is not one of its contacts)                                                                                           |
| `GET /companies/:id/activity`               | `record.companies.read`   | who changed what, newest first, cursor-paged                                                                                                                              |
| `GET /deals?companyId=:id`                  | `record.deals.read`       | the company's deals (the deals module; the company page uses it)                                                                                                          |
| `GET /tasks?companyId=:id`                  | `record.tasks.read`       | the company's tasks, filtered from the whole tasks list (the tasks module; the Tasks screen's "Linked to a company" filter)                                               |
| `GET /companies/:id/tasks`                  | `record.tasks.read`       | the company page's tasks card: same filters and paging as `GET /tasks`; also needs `record.companies.read` on the company (its record scope applies: outside it is `404`) |

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

Only `name` is required (trimmed, 1 to 191 characters). The other limits are Reference's: `email` an address up to 191, `phone` up to
32 (free text), `website` up to 191, `industry` up to 100, `sizeRange` up to 40, `address` up to 500, `notes` up to 2000. Every text
field is trimmed and an empty string means "nothing" (it clears the field on edit, as Reference's input middleware did). `ownerId`
omitted means the caller, `null` means nobody; anyone who is not an **active member of this workspace** is
`422 COMPANY_OWNER_INVALID`. Duplicate names are allowed. A create writes `display_id` (`COM-nnnnn`), an audit row and
`company.created`.

### Custom properties (`customFields`)

A workspace defines its own company fields in Settings, Company properties (the shared field registry with `moduleKey: companies`, the same screen as Contact properties). Their values are stored in the company's `data` column and travel as `customFields`, by property key; a key with no value is absent. A create takes `customFields` and an edit merges it: a key sent changes, `null` or a blank value (blank text, an empty list, an unticked checkbox) clears it, a key left out keeps its value.

- Only an **editable** property can be written: defined for companies, active, not a system property, not hidden, not read-only, not a formula. Anything else is `422 COMPANY_PROPERTY_NOT_EDITABLE`, naming each `customFields.<key>`. Only keys whose value _changes_ are held to this, so a form that sends back everything it loaded still saves.
- A value must fit its property's type: whole number, number, boolean (checkbox), a real calendar date (`YYYY-MM-DD`), date and time, an http(s) link, an email address, one of the options (dropdown), a list of options (multi-select), text otherwise. Otherwise `422 COMPANY_PROPERTY_INVALID`. Text values are at most 4000 characters, lists at most 100 items (`422 VALIDATION_FAILED` from the contract).
- A property marked **required** (checkboxes excepted) must have a value, honouring its "show only when" rule: `422 COMPANY_REQUIRED_PROPERTY_MISSING`. A create is always held to it; an edit only when it sends `customFields` (a company that predates a new required property stays editable).
- The audit row and `company.updated` name the properties that changed (`customFieldKeys`), never their values. The properties screen's "In use" count (`GET /fields/usage?moduleKey=companies`) is the number of companies holding a value. Deactivating a property keeps the values; a form submission that maps a field to a company property fills blanks the same way as before.

An edit takes only the fields it changes plus the `rowVersion` that was read. The name cannot be cleared (`422`). An edit that
changes nothing writes no audit row and no event and does not move the version.

### The list

`GET /companies?q=acme&sort=name&ownerId=…&industry=retail&hasOpenDeals=true&limit=50&cursor=…`

| Query          | Meaning                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------- |
| `q`            | case-insensitive substring of the name (the only field Reference searched); `%` and `_` are letters |
| `ownerId`      | owned by that member (a member who has left is still filterable)                                    |
| `unassigned`   | owned by nobody; not together with `ownerId` (`422`)                                                |
| `industry`     | exactly this industry, any case                                                                     |
| `hasOpenDeals` | only companies with at least one open deal                                                          |
| `sort`         | `created` (newest first, Reference's order; the default) or `name` (A to Z, case-insensitive)       |
| `limit`        | 1 to 200 (default 50); there is no 500-row cap                                                      |
| `cursor`       | the opaque `page.nextCursor` of the last page                                                       |

The answer is `{ data: Company[], page: { nextCursor, hasMore, limit } }`. The cursor is a keyset over the sort key (the
`created_at` instant at microsecond precision, or the lower-cased name) plus the row id, so rows that tie are never lost or repeated;
it is tied to its sort (a `created` cursor against `sort=name` is `400`). A damaged cursor is `400`; an invalid query is `422`.

`GET /companies/stats` takes the same filters (not `sort`, `limit` or `cursor`) and answers the three tiles:

```json
{ "total": 12, "withOpenDeals": 4, "wonValue": [{ "currency": "USD", "amount": "9400.00" }] }
```

`withOpenDeals` and `wonValue` are `null` for a caller without `record.deals.read`. Unlike Reference's page (tiles computed from the
rows it had loaded), they cover every company inside the caller's scope and the filter.

### Contacts of a company

`GET /companies/:id/contacts?limit=50&cursor=…` answers `{ data: [{ id, name, phone, email }], page }`, newest first by id (Reference's
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
`ON DELETE SET NULL (company_id)`, so their `row_version` and update stamp move and nothing is left dangling (Reference unlinked
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

## Linking a company from a contact, a deal or a task

`companyId` on `POST/PATCH /contacts` and `POST/PATCH /deals` (and `POST/PATCH /tasks`, which already took it). Putting a company on a contact or a deal needs `record.companies.read` and the company inside the caller's record scope: a company outside it is `404 NOT_FOUND`, never `403`, so a company is not revealed to exist; without the capability it is `403 FORBIDDEN`. Both answers carry the field (`errors: [{ path: "companyId" }]`) so a form says it at the company field. A company the record already has never blocks an unrelated edit (only a _new_ link is checked), a deal that takes its contact's company is not a choice and is not checked, and a request with no grants (a flow, an import, a public form) is not scoped, as everywhere else in the CRM. Tasks keep their existing rule (the company must be in the workspace).

## Not built here

The "Generate brief" button on the company page (the client brief feature is not built: BL-194). The AI copilot's company tools (`find_company`, `create_company`, `link_contact_company`) exist in the AI CRM Copilot and call `CompaniesService`; its `generate_brief` waits for the same feature. See "Not built here" in the inventory.
