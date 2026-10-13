# API: contacts list and filters, contact groups, bulk actions, CSV import, duplicates, tags and attributes

Domain `con` (TW-CON-001 .. 049). Base path `/v2`. Errors are `application/problem+json` with a stable `code` and a
`requestId`; the codes this domain adds are `CON_*` in `@crm/contracts` `common/errors.ts`. Request and response shapes live in
`packages/contracts/src/contacts-attributes-tags/` (and `crm/contact.ts`, `crm/tag.ts`). Live docs: `/docs`. Every id on the wire is a
uuid. Decisions where the port differs from Reference: "Port decisions" in
`docs/threadwise-port/inventory/contacts-attributes-tags.md`.

All routes need a staff bearer token. The capability each one needs is in brackets; "scope" means the caller's record scope
(`all`, `team`, `own`) is applied to which contacts the call can see or change. Routes under `/contacts/...` that are literal words
(`stats`, `duplicates`, `import`, `bulk/...`, `export`, `dedupe`) are registered before `/contacts/:id`.

## Contact list (extends `GET /contacts`)

### `GET /contacts` [`record.contacts.read`, scope]

Query (all optional, all filters combine with AND):

| Param                                                                                     | Meaning                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `limit` 1-1000 (50), `cursor`, `order` (`desc`)                                           | cursor pagination over `(created_at, id)`, newest first                                                                                                                                                                                                               |
| `q`                                                                                       | every word must match the name, first/last name, email or phone; a numeric word also matches the digits of the phone                                                                                                                                                  |
| `ownerId`, `lifecycleStage`, `status`, `source`, `includeArchived`                        | as before; `status`/`source` are exact                                                                                                                                                                                                                                |
| `ownerIds=a,b` + `unassigned=true`                                                        | contacts owned by any of these people; `unassigned` adds (or, alone, selects) the contacts nobody owns. An OR inside the filter, ANDed with everything else; a person who is not in this workspace owns nothing; `ownerId` (one person) keeps working and is ANDed in |
| `groupId` / `noGroup=true`                                                                | members of one group / contacts in no group (not together)                                                                                                                                                                                                            |
| `tagIds=a,b` (or `tagId=a`) + `tagMode=any\|all`                                          | contacts carrying any / all of these tags                                                                                                                                                                                                                             |
| `imported=true\|false`                                                                    | created by a CSV import, or not                                                                                                                                                                                                                                       |
| `unsubscribed=true\|false`                                                                | opted out / subscribed                                                                                                                                                                                                                                                |
| `createdFrom`/`createdTo`, `updatedFrom`/`updatedTo`, `lastActivityFrom`/`lastActivityTo` | date windows, both ends inclusive; a bare `YYYY-MM-DD` covers the whole day in UTC (the same SQL as a segment's date operators)                                                                                                                                       |
| `segmentId`                                                                               | members of one segment (a saved rule that fills itself), combined with every other filter by AND; unknown or not visible = no contacts; adds `segment: { id, invalidConditions }` to the response. See [segments.md](segments.md)                                     |
| `expand=groups,tags`                                                                      | adds the chips of each row                                                                                                                                                                                                                                            |
| `includeTotal=true`                                                                       | adds `meta.total`, the count of every contact matching the filter                                                                                                                                                                                                     |

```json
// GET /v2/contacts?q=aarav&groupId=2f6c…&expand=groups&includeTotal=true&limit=12
{
  "data": [
    {
      "id": "9b1e…",
      "name": "Aarav Sharma",
      "phone": "+919812345678",
      "email": "aarav@example.com",
      "source": "import",
      "isUnsubscribed": false,
      "status": null,
      "customFields": {},
      "groups": [{ "id": "2f6c…", "name": "VIP", "color": "#22C55E" }],
      "rowVersion": 1,
      "…": "…"
    }
  ],
  "page": { "nextCursor": "MjAyNi0xMC0wMVQwOTowMDowMC4wMDBafDQy", "hasMore": false, "limit": 12 },
  "meta": { "total": 1 }
}
```

A uuid in a filter that is not in this workspace (a deleted group, a stale tag, another workspace's owner) matches nothing; it never
widens the result. `limit` above 1000, a `tagId` that is not a uuid, or `groupId` with `noGroup` is 422 `VALIDATION_FAILED`.

**`lastActivityAt`** (the "Last Activity" column, the `lastActivityFrom`/`lastActivityTo` filter and the segment field) moves when a
note, activity, meeting or file is added, a form is submitted or an order is placed, **and when the contact writes to us or a person on
the team replies** in the Inbox (a bot reply, a broadcast, an imported history message and a group thread do not count). The chat's
stamp is a bookkeeping write: it moves forward at most once a minute per contact and it does not change `updatedAt` or `rowVersion`
(migration `20261121090000_contacts_activity_touch`), so an open edit form is not sent a 409 while the customer is typing.

### `GET /contacts/stats` [`record.contacts.read`, scope]

Workspace-wide, ignores any filter: `{ "total": 10, "groups": 3, "subscribed": 8, "unsubscribed": 2, "noGroup": 7, "grouped": 3, "imported": 0 }`.

### `POST /contacts`, `PATCH /contacts/:id` (existing)

New in this domain: `source` (<= 128), the phone is canonicalised (E.164) and written as the same identity key an import uses (an existing
match is returned, 201), the display name is the typed `name` else `firstName lastName` (never a title), and a create at the plan's contact
cap is 422 `PLAN_LIMIT_REACHED` (`errors`: `limit`, `used`, `limitValue`, `upgradeUrl`).

**Required properties are enforced.** A contact property (`/fields`, `moduleKey=contacts`) marked `isRequired` must have a value in `customFields`:
a create (and a `PATCH` that carries `customFields`) with a missing one is 422 `CON_REQUIRED_PROPERTY_MISSING`, with one `errors` entry per property,
`{ "path": "customFields.<key>", "message": "required" }` (the detail names the labels). A value counts as missing when it is `null`, blank text or an
empty list; `0` and `false` are answers. Not enforced: system fields (they have rules of their own), inactive, hidden and read-only properties,
formulas, and checkboxes (an unticked box is an answer). A property with a "show only when" rule (`/fields/dependencies`) is required only while every
one of its conditions holds (the same test the contact form uses to show it). A `PATCH` that carries `customFields` is held to the whole set on the merged
result; a patch without `customFields` (a stage, owner or source change) is not, so a contact that predates a newly required property stays editable.
`POST /contacts/bulk/update` may not blank a required property it sets; the refusal is listed per contact in `failed` with the same code.

**Bulk update of custom properties.** `POST /contacts/bulk/update` takes `values.customFields`, an object of property key to value, applied to every contact in `ids` (up to 500;
permission `record.contacts.update`, the caller's record scope applies per contact, one transaction, one SAVEPOINT per contact). `null` (or blank text, or an empty list) clears that
key: it is removed from the contact's `customFields`; keys not named are kept. The whole request is checked before anything is written: a key that is not an active, non-system,
visible, writable, non-formula contact property of the workspace is 422 `CON_PROPERTY_NOT_EDITABLE` (`errors: [{ "path": "customFields.<key>", "message": ... }]`), and a value that does
not fit the type is 422 `VALIDATION_FAILED` (text up to 1,000 characters, long text 4,000, integer/decimal numbers (strings such as `"12"` are parsed), checkbox `true`/`false`, `date` as
`YYYY-MM-DD`, `datetime` as `YYYY-MM-DDTHH:mm`, `email`, `url` with http(s), select/radio one of the property's visible option values, multi-select a list of them). Each contact's audit row
lists the keys that changed (`delta.customFieldKeys`), never the values; the `contact.updated` event carries `customFieldKeys` the same way.

**Won and lost stages.** When the contact's `lifecycleStage` changes to a stage flagged `isWon` or `isLost` (see Contact stages), `wonAt` / `lostAt`
are stamped (and the other cleared). Entering a lost stage needs a reason: `lostReason` (a `lost_reason` option's value) or `otherLostReason` (free
text), sent with the change or already on the contact, else 422 `CON_LOST_REASON_REQUIRED` (`errors: [{ path: "lostReason", message: "required" }]`).
The same rules apply to a create into such a stage and to `bulk/update` (which takes `lostReason` / `otherLostReason` in `values`; one reason is
recorded on every contact moved). Moving out of a lost stage clears `lostAt` and the reasons that described it; moving out of a won stage clears
`wonAt`. A stage that is not flagged behaves as before.

### Owner: `ownerId` on create and update, `GET /contacts/assignees`

`POST /contacts` takes `ownerId`: omitted = the creator (Reference stamped `user_id` with the caller), a uuid = that active member, `null` = nobody.
`PATCH /contacts/:id` takes the same; absent keeps, `null` clears, and it is checked only when it changes, so a save of another field never fails on
it. The record scope of the permission that governs the write bounds the target (`assertOwnerWithinScope`): `own` = only the caller, `team` = the
caller or a teammate, `all` = anyone; nobody (`null`) is refused to `own` and `team` because the contact would vanish from their own list. 403
with `errors:[{path:"ownerId"}]` otherwise; an unknown user, one of another workspace: 404. The change is audited (`ownerId` in the delta) and emits
`contact.updated`.

`GET /contacts/assignees` [`record.contacts.read`] lists the active people: `[{ id, fullName, email, canAssign }]`, by name. `canAssign` says whether the
caller's `update` scope lets them hand a contact to that person (all: everyone; team: themselves and people who share a team; own: themselves). The form
offers only those; the list filter and the Owner column use every name.

### `GET /contacts/:id/groups`, `PUT /contacts/:id/groups` [`record.contacts.read` / `record.contacts.update`, scope]

`PUT { "groupIds": ["2f6c…"] }` replaces the contact's groups with exactly that array (an empty array removes the last one). Returns
`[{ "id", "name", "color" }]`. Unknown group: 404. Emits `contact.group_added` / `contact.group_removed` per change.

## Contact groups

### `GET /contact-groups` [`record.contact-groups.read`]

`limit`, `cursor`, `q` (name). Newest first, each with the SQL member count:
`{ "data": [ { "id", "name", "note", "color", "memberCount", "rowVersion", "createdAt", "updatedAt" } ], "page": { … } }`.

### `GET /contact-groups/:id` [`record.contact-groups.read`] · `POST /contact-groups` [`record.contact-groups.create`]

```json
// POST { "name": "VIP", "note": "Top accounts", "color": "#7C3AED" }
// 201 { "id": "2f6c…", "name": "VIP", "note": "Top accounts", "color": "#7C3AED", "memberCount": 0, "rowVersion": 1, "existing": false, … }
// the same name again, any case or padding: 200 with the existing group untouched
// 200 { "id": "2f6c…", "name": "VIP", …, "existing": true }
```

Name 1-191 (trimmed), note <= 500, colour `#RRGGBB`. Audit `insert` and outbox `contact_group.created` in the same transaction.

### `PATCH /contact-groups/:id` [`record.contact-groups.update`]

`{ "name"?, "note"?, "color"?, "rowVersion" }`. Absent keeps, `null` clears note and colour. 409 `ROW_VERSION_CONFLICT` for a stale version;
409 `CON_GROUP_NAME_TAKEN` (with `errors:[{path:"existingId"}]`) for a name another group has.

### `DELETE /contact-groups/:id` [`record.contact-groups.delete`] → 204

Contacts stay and lose only the membership (foreign-key cascade). Audit `delete` and `contact_group.deleted` (`detachedContacts`).

## Bulk actions (selection: ids OR a filter)

Every body below carries a **selection**: either `"ids": [uuid…]` (1-5,000) or `"filter": { …same fields as the list, as JSON… }` with
optional `"excludeIds"` (the rows un-ticked after "select all matching"), never both. A filter that matches more than 50,000 contacts is 422
`CON_SELECTION_TOO_LARGE`.

```json
// 200 — same shape for every action
{
  "matched": 40,
  "changed": 38,
  "succeeded": [],
  "failed": [{ "id": "…", "code": "NOT_FOUND", "message": "Contact not found" }],
  "failedCount": 1
}
```

`matched` is what the selection resolved to inside the caller's scope; `changed` is what actually changed (already in the group, already
tagged, ...). `succeeded` lists uuids for an `ids` selection and is empty for a filter. `failed` (at most 100 entries, `failedCount` is the real
number) holds ids that do not exist in this workspace or are outside the caller's scope.

| Route                        | Needs                           | Extra body                                           | Effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------- | ------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /contacts/bulk/delete` | `record.contacts.delete`, scope |                                                      | hard delete in batches of 500; one audit row and one `contact.deleted` event per contact                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `POST /contacts/bulk/group`  | `record.contacts.update`, scope | `groupId`, `action: add\|remove`                     | set-based; one `contact.group_added\|removed` per contact that changed, one audit row and one `contact_group.members_changed` for the action. Group of another workspace: 404                                                                                                                                                                                                                                                                                                                                                |
| `POST /contacts/bulk/owner`  | `record.contacts.update`, scope | `ownerId` (uuid, or `null` for nobody)               | set-based, ids or a whole filter: contacts already owned by that person are skipped. The caller's update scope bounds both the contacts (as for every action) and the target: `own` = only themselves, `team` = themselves or a teammate, `all` = any ACTIVE member; `null` is refused to `own` and `team` (403 with `errors:[{path:"ownerId"}]`). A person of another workspace, disabled or unknown: 404. One audit row (`ownerId: {old, new}`) and one `contact.updated` (`ownerId`, `previousOwnerId`) per contact moved |
| `POST /contacts/bulk/tag`    | `record.contacts.update`, scope | `action: add\|remove`, `tagId` and/or `name` (<= 64) | by id, else by name (any case). `add` with an unknown name creates the tag (needs `record.tags.create`, counts against the plan tag limit, 422 `PLAN_LIMIT_REACHED`); `remove` never creates. Neither found: 422 `CON_TAG_REQUIRED`                                                                                                                                                                                                                                                                                          |
| `POST /contacts/export`      | `record.contacts.export`, scope | `bom` (true)                                         | streams `text/csv`, see below; audit `export`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

### Export format

Header: `name,first_name,last_name,phone,country_code,email,groups,tags,language,title,address,memo,status,source,unsubscribed,created_at,owner_email`
then `attr:<key>` per active attribute. `owner_email` is the owner's login email, empty when nobody owns the contact (the importer ignores the column). Newest first. `phone` is E.164; `groups` and `tags` are names joined with `", "`; free-text cells starting
with `= + - @` get a leading `'`; a UTF-8 BOM leads the file unless `bom` is false. At most 200,000 rows (422 `CON_EXPORT_TOO_LARGE`: narrow the filter).

## Duplicates

### `GET /contacts/duplicates` [`record.contacts.merge` at scope `all`]

`{ "totalSets": 1, "totalDuplicates": 2, "sets": [ { "phone": "+919812345678", "survivorId": "9b1e…", "duplicateIds": ["…", "…"] } ] }` (first 100 sets).
Contacts with the same canonical phone are duplicates; the oldest survives.

### `POST /contacts/dedupe` [`record.contacts.merge` at scope `all`]

`{ "maxSets": 1000 }` → `{ "mergedSets": 1, "removed": 2, "remainingSets": 0 }`. The survivor takes the fields it lacks, the union of groups and tags, the
attribute values it lacks, keeps any opt-out, and receives every row that pointed at a duplicate. Audit `merge` on the survivor and `delete` per duplicate;
events `contact.merged` and `contact.deleted` (`mergedInto`). Other scopes: 403 `CON_MERGE_SCOPE_REQUIRED`.

## CSV import

Needs `record.contacts.import` and `record.contacts.create`; creating groups or tags the file names needs `record.contact-groups.create` /
`record.tags.create` (403 otherwise). Upload as `multipart/form-data`: `file` (.csv or .txt, up to 20 MB, 200,000 rows; UTF-8, else Windows-1252;
comma, semicolon, tab or pipe) and optionally `options` (a JSON string):

```json
{
  "mapping": { "phone": 1, "name": 0, "email": null },
  "delimiter": ";",
  "defaultCountryCode": "+91",
  "status": "customer",
  "source": "Spring 2026",
  "groupId": "2f6c…",
  "tagIds": ["5d3a…"],
  "triggerAutomations": false
}
```

Columns are detected from the header (name, first_name, last_name, mobile/phone/whatsapp..., email, country_code, group(s)/list(s), tags, language, title,
address, notes/memo, status, source); `mapping` (field -> column index, `null` to ignore) overrides it. A phone and some name are required.

### `GET /contacts/import/sample` → `text/csv` attachment `contacts-sample.csv` (3 lines, Reference's header)

### `POST /contacts/import/preview` → 200, writes nothing

```json
{
  "fileName": "people.csv",
  "delimiter": ",",
  "headers": ["Phone", "Name"],
  "detected": { "phone": 0, "name": 1 },
  "mapping": { "phone": 0, "name": 1, "email": null, "…": null },
  "missingRequired": [],
  "sampleRows": [{ "Phone": "+919812300500", "Name": "Person 0" }],
  "totals": {
    "rows": 8,
    "valid": 8,
    "invalid": 0,
    "duplicateInFile": 0,
    "willCreate": 8,
    "willUpdate": 0
  },
  "invalidSamples": [{ "row": 5, "reason": "missing_name", "values": { "Phone": "…" } }],
  "newGroups": ["Brand new group"],
  "newTags": ["Hot"],
  "quota": { "limit": 500, "used": 120, "remaining": 380 },
  "runsAsJob": false
}
```

### `POST /contacts/import`

Plan check first (422 `PLAN_LIMIT_REACHED` at the cap, before the file is read), then validation (422 `CON_IMPORT_FILE_INVALID`: not text, empty, header only, a
required column missing; 413 over the size limit). Up to 1,000 data rows run inside the request → **200**; larger files are queued on `con-import` → **202**.

```json
{
  "id": "c0de…",
  "status": "completed",
  "fileName": "people.csv",
  "totalRows": 4,
  "processedRows": 4,
  "created": 2,
  "updated": 0,
  "invalid": 2,
  "duplicatesInFile": 0,
  "limitExceeded": 0,
  "error": null,
  "startedAt": "…",
  "finishedAt": "…",
  "createdAt": "…"
}
```

Each outcome has its own counter: `created`, `updated` (an existing contact matched by canonical phone; the oldest of several), `duplicatesInFile` (a repeat of a
number earlier in the file, merged into it), `invalid` (rejected rows), `limitExceeded` (new contacts the plan cap stopped). Created contacts get `source` (the knob,
else the row's, else `import`), `status`, the owner (the importer) and `import_job_id`; updated ones keep their status and source but join the knob group and tags.

### `GET /contacts/import/jobs`, `GET /contacts/import/jobs/:id` → the job above (poll a 202 here: `queued` → `running` → `completed` | `failed` with `error`)

### `GET /contacts/import/jobs/:id/rejects` → `text/csv`: `row,reason,<original columns>` for up to 1,000 rejected rows

Reasons: `missing_name`, `missing_phone`, `invalid_phone`, `invalid_email`, `group_name_too_long`, `tag_name_too_long`, `plan_limit_reached`.

## Tags (extends `/tags`)

| Route                              | Needs                           | Notes                                                                                                                                                                                     |
| ---------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /tags?includeCounts=true`     | `record.tags.read`              | adds `contactCount` to each tag                                                                                                                                                           |
| `POST /tags`                       | `record.tags.create`            | name 1-64; unique ignoring case (409 `CON_TAG_NAME_TAKEN`); counts against the plan tag limit (422 `PLAN_LIMIT_REACHED`)                                                                  |
| `POST /contacts/:id/tags`          | `record.contacts.update`, scope | `{ "tagId"?, "name"? }`: by id, else by name (created when new: also needs `record.tags.create`). Idempotent; 201 with the tag; `contact.tag_added` once. Neither: 422 `CON_TAG_REQUIRED` |
| `DELETE /contacts/:id/tags/:tagId` | `record.contacts.update`, scope | 204; `contact.tag_removed` only when something was removed                                                                                                                                |
| `GET /contacts/:id/tags`           | `record.contacts.read`, scope   | the contact's tags                                                                                                                                                                        |

One library, two meanings. A **contact tag** describes the person (VIP, lead, region). A **conversation tag** describes one inbox thread (billing,
refund, urgent) and lives in `conversation_tag`; it uses the same `tags` rows, the same unique name and the same plan `tags` limit, so a tag created in
either place is available in the other and a delete removes it from both. The inbox routes for conversation tags (`/inbox/tags*`) are in
[team-inbox-conversations.md](team-inbox-conversations.md#tags-contact-tags-and-conversation-tags).

## Attributes (merge variables)

Rows of the contact field registry (`fields`, `module_key = "contacts"`, section "Custom attributes"). Management needs the Contact Properties capabilities.

| Route                                                         | Needs                              | Notes                                                                                                                                                                                 |
| ------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /attributes?q&status=all\|active\|inactive&limit&cursor` | `record.contact-properties.read`   | `{ data, page, counts: { all, active, inactive } }`; counts are workspace-wide                                                                                                        |
| `GET /attributes/:id`                                         | `record.contact-properties.read`   |                                                                                                                                                                                       |
| `POST /attributes`                                            | `record.contact-properties.create` | `{ "name", "key", "type"?, "defaultValue"?, "description"?, "isActive"? }`; key `^[a-z][a-z0-9_]{0,63}$`; reserved keys 422 `CON_ATTRIBUTE_KEY_RESERVED`; taken 409 `FIELD_KEY_TAKEN` |
| `PATCH /attributes/:id`                                       | `record.contact-properties.update` | `{ "name"?, "defaultValue"?, "description"?, "isActive"?, "rowVersion" }`; the key and type never change; `null`/`""` clears                                                          |
| `DELETE /attributes/:id?force=true`                           | `record.contact-properties.delete` | 204; contacts keep their values; 409 `CON_ATTRIBUTE_IN_USE` (`errors:[{path:"contacts"}]`) until `force=true`                                                                         |
| `GET /attributes/picker`                                      | `record.contacts.read`             | `{ system: [10 built-in tokens], custom: [active attributes with `value`] }`                                                                                                          |
| `GET /attributes/catalog`                                     | `record.contacts.read`             | groups `contact`, `custom_field` (keys found on recent contacts), `workspace`, `system`; each key once, with a sample from the newest contact                                         |
| `POST /attributes/resolve`                                    | `record.contacts.read`, scope      | `{ "template", "contactId"? }` → `{ "rendered", "tokens": [ { "token", "key", "resolved", "source" } ] }`                                                                             |

```json
// POST /v2/attributes/resolve { "template": "Hi {{Customer Name}} from {{city}}{{nope}}", "contactId": "9b1e…" }
{
  "rendered": "Hi Aarav Sharma from Pune",
  "tokens": [
    { "token": "{{Customer Name}}", "key": "name", "resolved": true, "source": "contact" },
    { "token": "{{city}}", "key": "city", "resolved": true, "source": "contact_attribute" },
    { "token": "{{nope}}", "key": "nope", "resolved": false, "source": "unresolved" }
  ]
}
```

Resolution order for each `{{token}}` (key normalised, aliases applied): contact column, the contact's own attribute value, the active attribute's default,
system token (`today`, `business_name`, `company_name`). Unresolved is the empty string. Other domains call `MergeTagService` (exported by the CRM barrel);
`validatePositionalPlaceholders` (contracts) is the `{{1}}..{{n}}` gap check for the templates and campaign save paths.

## Contact stages and statuses (`/status-options`)

The lists behind a contact's lifecycle stage and status are rows of `status_options` (`moduleKey=contacts`, `optionGroup=lifecycle_stage` or `status`; a
`lost_reason` group is understood too). They need the Contact Properties permissions (`record.contact-properties.read|create|update|delete`). A workspace with no rows
falls back to the platform's ten stages and four statuses in the web app.

| Route                                             | Notes                                                                                                                                                                                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /status-options?moduleKey&optionGroup`       | in saved order                                                                                                                                                                                                                                                           |
| `GET /status-options/usage?moduleKey&optionGroup` | `{ data: [ { id, value, count, segments } ] }`: contacts holding each option (archived included; 0 for groups no contact column stores) and the segments whose rules use it                                                                                              |
| `POST /status-options`                            | `{ moduleKey, optionGroup, value (snake_case), label, color?, position?, isDefault?, isWon?, isLost?, stageOptionId? }`; a default clears the previous default of its scope (the database allows one per scope, see below)                                               |
| `PATCH /status-options/:id`                       | `{ label?, color?, isDefault?, isActive?, isWon?, isLost?, stageOptionId?, rowVersion }`; the value never changes. Setting one flag clears the other unless both are named                                                                                               |
| `POST /status-options/reorder`                    | `{ moduleKey, optionGroup, orderedIds }`                                                                                                                                                                                                                                 |
| `DELETE /status-options/:id?moveTo=<option id>`   | 204. Contacts still holding the value: 409 `STATUS_OPTION_IN_USE` (`errors:[{path:"contacts",message:"<count>"}]`) until `moveTo` names another option of the same group; they are moved in the same transaction (a stage move stamps the stage date and previous stage) |

`POST /contacts` without a `lifecycleStage` starts the contact in the group's default option (else the column default `new`).

**Won / lost flags** (`isWon`, `isLost`, default false, in every response) exist on the `lifecycle_stage` group of `contacts` only, and a stage is never both:
anything else is 422 `STATUS_OPTION_FLAG_INVALID`. Several stages may be won and several lost. Nothing is flagged by the migration, so existing workspaces
behave as before until an admin flags a stage; a workspace seeded from the platform stages in the web app gets `enrolled` as won and `lost` as lost.
Deleting a stage with `moveTo` a flagged stage stamps the moved contacts like any other move into it.

### Stage and status are linked (lightly)

A contact's **lifecycle stage** is where the person is in the sales journey (new, contacted, qualified, ..., won, lost); its **status** is a sub-state inside that
stage (in Qualified: Waiting for quote, Quote sent, Negotiating; in Lost: Not interested, Went elsewhere) or a state that is not part of the journey (Do not contact).
A status option may therefore be **scoped to one stage**:

- `stageOptionId` (uuid, in every response, `null` = valid in every stage) is accepted on `POST` / `PATCH /status-options` for the `status` / `contact_status`
  groups of `contacts` only. It must be a `lifecycle_stage` option of the same workspace: another workspace's id is 404, anything else (a status, a lost reason, a
  stage being scoped itself, a deal option) is 422 `STATUS_OPTION_STAGE_INVALID`. On `PATCH`, absent keeps the scope and `null` makes the status valid everywhere.
  Changing a scope is not applied to contacts that already hold the status: they keep it until their stage changes.
- **One default per scope.** `isDefault` on a scoped status means "the status a contact gets when it enters that stage without a valid one". Each stage has at most
  one (a second one clears the first), next to the group's own unscoped default; a default that is moved into a scope that already has one gives way unless
  `isDefault: true` is sent in the same request. The database enforces it (`uq_status_options_one_default` is per `(org, module, group, stage scope)`).
  A hidden (`isActive=false`) default is never applied.
- Unscoped statuses are exactly what every status was before: valid in every stage. A workspace that never scopes a status sees no change anywhere.

The rules on a contact (`POST /contacts`, `PATCH /contacts/:id`, `POST /contacts/bulk/update`, one SAVEPOINT per contact in the bulk):

| Situation                                                                                                                       | Result                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The stage changes and the status held is still valid in the new stage (unscoped, scoped to it, or a value no option exists for) | The status is kept                                                                                                                                                                                    |
| The stage changes and the status held is scoped to another stage                                                                | Reset to the new stage's default status, or cleared (`null`) when it has none. Moving into a won or lost stage is the same rule: those stages simply get a default like any other.                    |
| The stage changes and the contact has no status, and the new stage has a default status                                         | The default is applied (the same as creating a contact in that stage). No default: stays empty.                                                                                                       |
| A status is set (different from the one held) and it is scoped to a stage other than the contact's stage after the write        | 422 `CON_STATUS_STAGE_MISMATCH`, `errors:[{path:"status", message:"Status \"X\" belongs to the \"A\" stage and cannot be set on a contact in the \"B\" stage."}]` (bulk: that contact is in `failed`) |
| A request sends the status the contact already holds along with a stage change                                                  | Treated as "status not sent": the reset above applies (a form that posts every field must not fail on a stale status)                                                                                 |
| `status: null` (clear)                                                                                                          | Always allowed, and wins over a default                                                                                                                                                               |
| `POST /contacts` with no `status`                                                                                               | The default status of the stage the contact starts in, if that stage has one                                                                                                                          |

The check is made against the stage after the write, so `{ lifecycleStage, status }` in one request is judged together. Editing other fields of a contact whose
status is out of scope is not blocked. Import (`/contacts/import`) writes the status knob as before and does not validate it against a stage.

Deleting a **stage** keeps the statuses scoped to it: they become valid in every stage (`stageOptionId: null`) and stop being a default. Deleting a **status** with
`moveTo` a status that is scoped to a stage moves the contacts of that stage and leaves the contacts of other stages with no status.

## Contact properties (`/fields`, `/field-sections`)

The custom properties of a contact are rows of the field registry (`moduleKey=contacts`), grouped by sections; **Attributes (above) are the same rows** seen as merge
variables (`config.defaultValue`, `config.description`), so a property created here is also an attribute and the reverse. Contact values live in `customFields[key]`
as their type (number, boolean, list for a multi-select, text otherwise). Same permissions as above.

| Route                                                            | Notes                                                                                                                                                    |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /fields?moduleKey&includeInactive=true`                     | options inline for select, multiselect and radio. Send `includeInactive` only when true (the flag is coerced from text, so `false` would also mean true) |
| `GET /fields/usage?moduleKey`                                    | `{ data: [ { id, key, count, segments } ] }`: contacts with a non-empty value per key, and the segments whose rules use it                               |
| `GET /fields/dependencies?moduleKey`                             | every "show only when" rule of the module: `[ { id, fieldId, dependsOnFieldId, dependsOnOptionId                                                         | dependsOnValue } ]` |
| `POST /fields`                                                   | as before; a contact key that is a built-in token or a form-owned key is 422 `CON_ATTRIBUTE_KEY_RESERVED` (same rule as `POST /attributes`)              |
| `PATCH /fields/:id`, `DELETE /fields/:id`                        | `DELETE` deactivates (`isActive=false`, values kept); a system field is 409 `FIELD_IS_SYSTEM`                                                            |
| `/fields/:id/options`, `/fields/dependencies`, `/field-sections` | create, rename, reorder, delete as documented on the routes; a dependency that closes a cycle is 409 `DEPENDENCY_CYCLE_DETECTED`                         |

## Permissions added

`record.contact-groups.read|create|update|delete`, `record.contacts.import` (migration `20261002100200_con_permissions`; the Admin preset of every existing and new
workspace has them). Everything else reuses `record.contacts.*`, `record.tags.*` and `record.contact-properties.*`.

## Events (outbox)

`contact_group.created|updated|deleted|members_changed`, `contact.group_added|group_removed|tag_added|tag_removed`, `tag.contacts_changed`,
`contact.merged`, `contact.deleted` (also from merges, with `mergedInto`), `contact.exported`, `contact.import_started|import_completed`, and (only with
`triggerAutomations`) `contact.created` per imported contact. `contact.stage_changed` (payload `previousStage`, `stage`) is emitted when a stage moves.
