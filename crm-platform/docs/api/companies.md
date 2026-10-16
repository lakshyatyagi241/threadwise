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
| `record.companies.export`                        | yes   | `GET /companies/export` (CSV of the list inside the key's scope); Owner, Admin and Manager (20261222090000)                                                                                                          |
| `record.companies.import`                        | no    | `POST /companies/import`; also needs `record.companies.create`; Owner, Admin and Manager (20261222090000)                                                                                                           |
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
| `sort`         | `created` (newest first, Reference's order; the default), `name` (A to Z, case-insensitive) or `property` (below) |
| `sortKey`      | the property key, with `sort=property` (required then)                                              |
| `sortDir`      | `asc` or `desc`; the default is newest first for `created`, ascending for the others                |
| `props`        | conditions on company properties, a JSON array (below); at most 10, all of which must hold          |
| `limit`        | 1 to 200 (default 50); there is no 500-row cap                                                      |
| `cursor`       | the opaque `page.nextCursor` of the last page                                                       |

The answer is `{ data: Company[], page: { nextCursor, hasMore, limit } }`. The cursor is a keyset over the sort key (the
`created_at` instant at microsecond precision, or the lower-cased name) plus the row id, so rows that tie are never lost or repeated;
it is tied to its sort (a `created` cursor against `sort=name` is `400`). A damaged cursor is `400`; an invalid query is `422`.

### Company properties on the list (BL-196)

`props` is `[{ "key": "tier", "operator": "equals", "value": "gold" }, …]`, in the operators and value shapes of segment rules
([segments.md](segments.md#fields-and-their-operators)): the same predicates, so text, number, date, option, multi-select and checkbox
properties filter as they do on contacts. The property must exist, be active, stored (not a formula) and not masked, and the operator
must suit its kind, else `422 COMPANY_FILTER_INVALID` with the path (`props.0.key`, `props.1`); malformed JSON or more than 10
conditions is `400`. A company with no value is "empty": `is_empty` and the `not_*` operators hold for it.

`sort=property&sortKey=seats` orders by a property: text and options case-insensitively, numbers, dates and checkboxes by value, and a
company with no value takes the lowest key (first when ascending, last when descending). A multi-select has no order (`422`). The
cursor names the order, the key and the direction (`property:seats:asc`) and checks its key against the type it is cast to, so a
cursor from one order is `400` against another and a crafted key never reaches SQL.

### CSV export and import (BL-196)

`GET /companies/export` takes the filters and order of the list (no `limit` or `cursor`) and `columns`, a comma-separated list of
`name`, `website`, `email`, `phone`, `industry`, `sizeRange`, `address`, `notes`, `owner`, `createdAt` and `property:<key>`; without
it, every one of them and every active, stored, unmasked property (headed by its label). It needs `record.companies.export`, applies
that key's record scope, holds at most 5000 companies (`422 COMPANY_EXPORT_TOO_LARGE`; narrow it with a filter), writes a UTF-8 BOM,
guards free-text cells against spreadsheet formulas (`=`, `+`, `-`, `@` get a leading apostrophe; a phone and a date do not) and writes
an audit row (module `company_exports`, action `export`: the number of rows and the columns).

`POST /companies/import` takes `{ "csv": "<text>", "matchExisting": true }`. The first line names the columns, in any case: `name`,
`website`, `email`, `phone`, `industry`, `size`, `address`, `notes`, `owner` (an active member's email or full name; ambiguous or
unknown is a row failure) and any editable company property by label or key; others are listed in `ignoredColumns`. A row needs a name
or a website. Every row is checked by the form's own rules (limits, a valid email, typed property values, required properties) in a
savepoint of its own, so a bad row is `failed: [{ line, field, message }]` while the rest are kept. With `matchExisting`, a company
with the same website (every common spelling of the host), else the same name, has only its empty fields filled and is counted as
`updated` or `unchanged`; it is looked up inside the caller's `record.companies.update` scope, and outside it the row creates a new
company, as the form would. Up to 1000 rows and 1 MB; a file with no header, no name or website column or too many rows is
`422 COMPANY_IMPORT_INVALID`. It needs `record.companies.import` and `record.companies.create`. Each created company is audited and
announces `company.created` as if made by hand.

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

## Generate brief (BL-194)

`GET /companies/:id/brief` and `POST /companies/:id/brief`, in `modules/company-briefs`. Both need the sales pipeline plan feature and
`record.companies.read`; the company must be inside the caller's scope (`404` outside it). Reference's Client Brief was a deck of the
numbers it could count, with no AI, under a public token link (`/b/{token}`) and a PDF. Here an AI model writes the brief **for the
person who asks** and it is shown on the company page; there is no public link (see the parity file).

- **State.** `GET` answers `{ available, brief, sources }` and calls no model. `available` is false when no AI key is available to the
  workspace (its own key for anthropic, openai, gemini, mistral, deepseek or groq, else the platform's). `brief` is the caller's own
  latest brief of this company or `null`: `{ id, content, sources, generatedAt, model, stale }`, where `content` is
  `{ summary, sections: [{ key, bullets }] }` (keys `activity`, `deals`, `tasks`, `conversations`, `properties`, `risks`,
  `nextSteps`, at most 8 bullets of 400 characters) and `stale` is true when the CRM has changed since (the digest of the facts
  differs).
- **Generate.** `POST` takes `{ "regenerate": false }` and answers `{ brief, cached }`. The same facts within 24 hours return the stored
  brief without a model call (`cached: true`); `regenerate: true` always writes anew. A second generation of the same company by the
  same person within 30 seconds is `429 COMPANY_BRIEF_RATE_LIMITED`, and the route is also throttled at 20 a person an hour. No key is
  `422 COMPANY_BRIEF_AI_UNAVAILABLE` and nothing is sent anywhere; a vendor failure or an answer that is not a brief is
  `502 COMPANY_BRIEF_PROVIDER_FAILED` and the stored brief is kept. A key paid by the platform asks the workspace's monthly allowance
  first (`AiTokenMeter.guard`); every call writes the token ledger.
- **What is read, and as whom.** Everything is read as the caller through the services and record scopes of the screens: the company
  (`record.companies.read` scope), contacts counted by lifecycle stage and last activity date (`record.contacts.read` scope), deals
  (`record.deals.read` scope: the figures per currency and the ten most recent), open tasks (`record.tasks.read` scope), conversations
  with the company's contacts (`inbox.conversation.read`, the inbox visibility rule `visibleToSql`, counts and the last message date)
  and the company properties (`record.company-properties.read`; hidden, masked, system and computed ones are skipped). A kind the
  caller may not read is left out and `sources` says so. Because the result depends on the caller, the stored brief is per company and
  per person (`company_briefs`, unique on `(org_id, company_id, user_id)`), also the cache.
- **What is sent to the model.** Counts, dates, amounts, lifecycle stages, stage names, short titles of deals and tasks, the company's
  name, industry, size, notes and property values. Never a contact's name, email, phone or address, the company's own email, phone or
  address, or the text of any message. Titles, notes and values are cut and have emails and runs of seven or more digits replaced by
  `[email]` and `[number]` (`maskPersonalText`). The facts go in as data and the prompt tells the model to ignore instructions inside
  them; its answer is parsed strictly (unknown sections, repeats and empty bullets dropped) and rendered as text.
- **Audit and privacy.** An audit row (module `company_briefs`, the company id) records who generated, the provider, model, which side
  paid, the token counts and which kinds of records were used; never the facts or the text. The workspace AI-use switches and notices
  of the privacy spec (BL-149) are not built yet, so there is nothing to read; the card carries its own notice of what is sent. When
  they exist the brief must read the `ai_content_processing` switch (recorded in the backlog).
- **Copilot.** The AI CRM Copilot's `generate_brief` tool (read kind) takes a company name, picks the company the caller can read whose
  name matches best and calls the same service as the caller, so the scopes, privacy rules, cache and limits are the same. Its answer
  carries the summary and the sections for the model to relay.
- **Tests with no real AI.** The model is reached through the single-completion port the flow AI node uses (`FLOW_AI_PORT`); the
  vendor base URLs can be overridden by environment (`FLR_AI_OPENAI_BASE_URL`, ...), which is how the end-to-end tests run a local fake.

## Not built here

Reference's public brief link and PDF (`/b/{token}`, `/b/{token}/pdf`) and briefs for a contact or a deal (BL-212). The AI copilot's other company tools (`find_company`, `create_company`, `link_contact_company`) exist in the AI CRM Copilot and call `CompaniesService`. A company saved view / saved filter (the list's state lives in the address; segments are of contacts). See "Not built here" in the inventory.
