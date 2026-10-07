# API: segments

A product extension: Reference has only static groups (see `docs/threadwise-port/parity/product-extensions.md`, "Segments"). Base path
`/v2`. Errors are `application/problem+json` with a stable `code` and a `requestId`; the codes this adds are `SEG_NAME_TAKEN` and
`SEG_RULES_INVALID` in `@crm/contracts` `common/errors.ts`. Request and response shapes, and the rule model the web builder renders,
live in `packages/contracts/src/segments/`. Every id on the wire is a uuid. All routes need a staff bearer token.

**A group is a list a person fills by hand. A segment is a saved rule that fills itself**: membership is never stored, it is the
rule evaluated against `contacts` right now, so contacts enter and leave as their data changes and there is nothing to keep in
sync.

## Capabilities

| Key                      | Scope | Grants                                                                    |
| ------------------------ | ----- | ------------------------------------------------------------------------- |
| `record.segments.read`   | no    | list, get, usage, preview, refresh a count; sees what visibility allows   |
| `record.segments.create` | no    | create, "save this filter as a segment"                                   |
| `record.segments.update` | yes   | edit; `own` = segments I own, `team` = owned by someone on my team, `all` |
| `record.segments.delete` | yes   | delete, same scopes                                                       |

The Admin preset holds all four with scope `all`. The front-line preset (`Agent` from sign-up, `Counsellor` from the dev seed) gets
read and create, and update and delete with scope `own`.

**Visibility.** A segment is `private` (its owner and anyone who can edit every segment, that is `record.segments.update` with scope
`all`: the admins) or `shared` (everyone who can read segments). A segment the caller may not see is `404`, never `403`, so a private
segment's existence is not revealed. A segment the caller can see but not change is `403 FORBIDDEN` on PATCH and DELETE; the
response's `canEdit` tells the screen.

**Specific people** (a change beyond Reference, by request; Reference has no segments). A third visibility, `specific`, shows a segment
only to the people and teams in `sharedWith`, plus its owner and callers who can edit every segment. A person is on the list
directly (`sharedWith.userIds`) or through a team (`sharedWith.teamIds`: every member of the team **as it is when the question is
asked**, so joining or leaving the team changes who sees it at once). Being listed grants **view and use only** (see it, filter
contacts by it, pick it as an audience, export, tag, add to a group, duplicate it): editing and deleting stay with the owner and
the edit-all scope, so `canEdit` is false for a listed person. They still need `record.segments.read`: a listed person without it
sees nothing. Everyone else gets `404`, as for a private one, in `GET /segments/:id`, the list, `/segments/:id/contacts`, every
action, `GET /contacts?segmentId=` (no contacts) and the broadcast wizard's audience picker.

`sharedWith` is a request body field and a response field with different shapes. In: `{ userIds: uuid[], teamIds?: uuid[] }`, at
most 200 people and teams together, only with `visibility: "specific"` (any other kind with a non-empty list is 422
`VALIDATION_FAILED`), required and non-empty when the result is `specific`: `422 SEG_SHARE_EMPTY` (also when switching a private or
shared segment to `specific` without a list), `422 SEG_SHARE_USER_NOT_FOUND` / `SEG_SHARE_TEAM_NOT_FOUND` for an id that is not in
this workspace (`errors[].path` is `sharedWith.userIds.<n>` / `sharedWith.teamIds.<n>`; nothing is saved). On PATCH, absent keeps the
list, sent replaces it (the server diffs it: only the added and removed rows are written), and moving off `specific` clears it.
Out: `{ users: [{ id, name, email|null }], teams: [{ id, name, memberCount }] }`, empty unless `specific`; `email` is only filled in
for callers who can edit the segment. A change of the list alone bumps `rowVersion`, so two editors cannot overwrite each other.
Removing a person from the workspace, or deleting a team or the segment, removes the rows (`ON DELETE CASCADE`).

**Stale audiences.** Only creating and selecting is gated. A broadcast or campaign that already targets a segment keeps working after
the person who picked it, or the segment's list, lost access: sending resolves members through `SegmentsService.resolveMembers`
(no visibility check, as for private segments), and `memberIdsIn` (building an audience inside a request) is the one place that asks
who is looking. The broadcast wizard's draft check only requires that the segment exists in the workspace, as before.

**Using a segment on contacts needs the contact permission too**: the member list needs `record.contacts.read`, the export
`record.contacts.export`, tag and add-to-group `record.contacts.update`. Every one of them applies the caller's record scope to the
contacts: an agent with `record.contacts.read` scope `own` sees, counts, exports and tags only their own contacts of a segment.

## The segment

```json
{
  "id": "5c1e…",
  "name": "Hot leads from imports",
  "description": null,
  "color": "#22C55E",
  "visibility": "specific",
  "sharedWith": { "users": [{ "id": "…", "name": "Ravi", "email": null }], "teams": [] },
  "ownerId": "…",
  "ownerName": "Ana",
  "rules": { "type": "group", "combinator": "and", "children": [ … ] },
  "rulesVersion": 1,
  "memberCount": 128,
  "countApproximate": false,
  "memberCountAt": "2026-10-11T09:00:00.000Z",
  "invalidConditions": [],
  "canEdit": true,
  "rowVersion": 3,
  "createdAt": "…",
  "updatedAt": "…"
}
```

Names are unique per workspace ignoring case (`409 SEG_NAME_TAKEN`, with `errors:[{path:"existingId"}]`). Colour is `#RRGGBB`. `rowVersion`
is the optimistic lock; the cached count and the usage stamp never change it.

## Rules

A tree of AND / OR groups of conditions, validated strictly by `segmentRulesSchema` (the same schema the web imports):

```json
{
  "type": "group",
  "combinator": "and",
  "children": [
    { "type": "condition", "field": "lifecycleStage", "operator": "equals", "value": "qualified" },
    { "type": "condition", "field": "createdAt", "operator": "in_last_days", "value": 30 },
    {
      "type": "group",
      "combinator": "or",
      "children": [
        { "type": "condition", "field": "tags", "operator": "has_any", "value": ["<tag uuid>"] },
        { "type": "condition", "field": "custom.budget", "operator": "gte", "value": 10000 }
      ]
    }
  ]
}
```

Limits: depth 3 (the root group is level 1), at most 50 conditions in total and 50 children per group, 100 values in a list, 255
characters per text value, 3,650 days. A group has at least one child, a segment at least one condition. Unknown fields, operators and
extra keys are refused (`422 VALIDATION_FAILED`, one `errors[]` entry per problem with its path, e.g. `rules.children.1.value`).

### Fields and their operators

| Field                                      | Kind                   | Operators                                                                                                                               | Value                                                          |
| ------------------------------------------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `name`, `email`, `phone`, `source`         | text                   | `equals`, `not_equals`, `contains`, `not_contains`, `starts_with`, `in`, `not_in`, `is_empty`, `is_not_empty`                           | text (case-insensitive), or a list for `in`/`not_in`           |
| `leadScore`                                | number                 | `equals`, `not_equals`, `gt`, `gte`, `lt`, `lte`, `between`, `in`, `not_in`, `is_empty`, `is_not_empty`                                 | number, `{from,to}` for `between`                              |
| `lifecycleStage`, `status`                 | option                 | `equals`, `not_equals`, `in`, `not_in`, `is_empty`, `is_not_empty`                                                                      | the stage / status `value`                                     |
| `owner`                                    | user                   | `equals`, `not_equals`, `in`, `not_in`, `is_empty` (unassigned), `is_not_empty`                                                         | user uuid(s)                                                   |
| `tags`, `groups`                           | set                    | `has_any`, `has_all`, `has_none`, `is_empty`, `is_not_empty`                                                                            | tag / group uuids                                              |
| `unsubscribed`, `imported`                 | bool                   | `is_true`, `is_false`                                                                                                                   | none                                                           |
| `search`                                   | search                 | `matches`                                                                                                                               | the contacts search box: every word in name/email/phone digits |
| `createdAt`, `updatedAt`, `lastActivityAt` | date                   | `equals`, `before`, `after`, `on_or_before`, `on_or_after`, `between`, `in_last_days`, `more_than_days_ago`, `is_empty`, `is_not_empty` | `YYYY-MM-DD` or an ISO instant; days as a whole number         |
| `custom.<key>`                             | by the property's type | the operators of its kind (below)                                                                                                       | as its kind                                                    |

A custom property's kind comes from the registry: `text`, `long_text`, `url`, `email`, `phone`, `timezone`, `lookup` are text;
`integer`, `big_integer`, `decimal`, `percentage`, `currency`, `rating` are numbers; `date`, `datetime` are dates; `select`, `radio` are
options; `multiselect` has the set operators (`has_any`/`has_all`/`has_none`/`is_empty`/`is_not_empty`) over its stored array;
`boolean`, `checkbox` are booleans; a `formula` is computed and cannot be used. The rule is checked against the property's type when
a segment is saved (`422 SEG_RULES_INVALID`).

Semantics worth knowing:

- "Not" operators (`not_equals`, `not_contains`, `not_in`, `has_none`) include contacts that have no value: a contact with no source IS
  "not from Facebook".
- A bare day covers the whole day in **UTC**: `before 2026-10-03` is strictly before its first instant, `on_or_before` includes the
  whole day, `after` starts the next day, `equals` is "on that day". An ISO instant is compared exactly. `in_last_days N` is
  `now - N days <= value <= now`; `more_than_days_ago N` is `value < now - N days`.
- Dirty stored values (a number property holding "n/a", a date of "2026-02-31", a multiselect holding a string) make that contact
  not match; they never fail a request.
- Archived contacts are never members.
- The conditions use the same SQL predicates as the contacts list filter (`contact-predicates.ts`, `contact-conditions.ts`): one
  builder for the list, the bulk actions, the export and a segment.

### Invalid conditions

A condition that points at a tag, group, stage, status, user or custom property that was **deleted** after the segment was saved
never fails a request. It evaluates to "matches nothing" (`false`, for negated operators too: a deleted reference is never "matches
everyone"), the rest of the rules still apply, and the segment, the list, the member list, the preview and `resolveMembers` report it:

```json
"invalidConditions": [
  { "path": "children.1.children.0", "field": "tags", "reason": "tag_deleted",
    "message": "A tag used here does not exist (it may have been deleted).", "refs": ["<tag uuid>"] }
]
```

`reason` is `tag_deleted | group_deleted | stage_deleted | status_deleted | user_deleted | field_deleted | field_type_unsupported |
operator_unsupported` (the last two: a property that became a formula, or whose type no longer has the operator). A reference that does
not exist when **saving** is refused instead (`422 SEG_RULES_INVALID`, `errors[]` with the condition's path), so a typo cannot
create a broken segment; a rule also cannot point at another workspace's tag or group (it simply does not exist here).

## Routes

| Route                              | Capability                                      | Notes                                                                                                                                               |
| ---------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /segments`                    | `record.segments.read`                          | cursor-paged, newest first; `q`, `visibility` (`private\|shared\|specific`), `mine=true`. Counts are the cached ones: a list never counts           |
| `GET /segments/usage?kind&ref`     | `record.segments.read`                          | segments (visible to the caller) that use a `tag`, `group`, `stage`, `status`, `field` (key) or `user`: the warning before a delete                 |
| `POST /segments/preview`           | `record.segments.read` + `record.contacts.read` | `{ rules }` → `{ count, countApproximate, sample[≤10 contacts], invalidConditions }`; nothing is saved; 30 per minute per user (`429 RATE_LIMITED`) |
| `POST /segments/from-filters`      | `record.segments.create`                        | `{ name, description?, color?, visibility?, filter }`: the contacts list filter converted to rules (AND of its parts); no conditions = 422          |
| `POST /segments`                   | `record.segments.create`                        | 201; `Idempotency-Key` supported                                                                                                                    |
| `GET /segments/:id`                | `record.segments.read`                          | with the member count (cache ≤ 5 minutes, recounted under a 3 s limit)                                                                              |
| `PATCH /segments/:id`              | `record.segments.update` (scope)                | needs `rowVersion` (`409 ROW_VERSION_CONFLICT`); absent keeps, `null` clears description / colour; new rules reset the count                        |
| `DELETE /segments/:id`             | `record.segments.delete` (scope)                | 204; its contacts are untouched                                                                                                                     |
| `POST /segments/:id/refresh-count` | `record.segments.read`                          | recount now, store it; 20 per minute per user                                                                                                       |
| `GET /segments/:id/contacts`       | `record.contacts.read`                          | the contacts list query: `limit`, `cursor`, `order`, `expand=groups,tags`, `includeTotal`, every filter; same as `GET /contacts?segmentId=`         |
| `POST /segments/:id/export`        | `record.contacts.export`                        | CSV of the members (the contacts export: same columns, 200,000 rows max), `{ bom? }`                                                                |
| `POST /segments/:id/tag`           | `record.contacts.update`                        | `{ tagId }` or `{ name }` (a new name creates the tag: needs `record.tags.create`, plan limit); a **snapshot**                                      |
| `POST /segments/:id/add-to-group`  | `record.contacts.update`                        | `{ groupId }`; a **snapshot**; over 1,000 members it is a background job in chunks of 1,000: `{ matched, changed: 0, queued: true }`                |

Actions answer `{ matched, changed, queued }`. Tag and add-to-group act on the members at that moment; contacts that join the
segment later are not tagged or grouped (use the segment itself to target "everyone who matches now"). They write the same audit rows
and events as the equivalent bulk action (`tag.contacts_changed`, `contact.tag_added`, `contact_group.members_changed`,
`contact.group_added`). The group job copies only contacts the person who started it could change (their `record.contacts.update`
scope), is idempotent (members already in the group are skipped by the insert), and writes one audit row and one
`contact_group.members_changed` event (`selection: "segment"`) when it ends.

### Filtering the contacts table by a segment

`GET /contacts` (and the contacts bulk actions' `filter`) accept `segmentId` next to every other filter, combined by AND:

```
GET /v2/contacts?segmentId=5c1e…&source=import&includeTotal=true&expand=tags
```

A segment that does not exist or the caller cannot see is an **empty list**, never "all contacts" (the same rule as an unknown group
or tag id in a filter). When the request names a segment the response carries
`"segment": { "id": "…", "invalidConditions": [ … ] }`. `includeTotal` on a segment is counted under the 3 second limit; past it
`meta.approximate` is `true`.

The contacts filter also gained date windows, usable with or without a segment: `createdFrom` / `createdTo`, `updatedFrom` /
`updatedTo`, `lastActivityFrom` / `lastActivityTo` (inclusive; a bare `YYYY-MM-DD` covers the whole day in UTC).

## Member counts

The count is computed by the database on demand: `SELECT count(*)` of the compiled rules inside a savepoint with `statement_timeout`
= 3 seconds. Past it the statement is cancelled (the request carries on, nothing else is aborted) and the answer is the last cached
count or, with none, the planner's row estimate, with `countApproximate: true`; an approximate count is never stored.

- `GET /segments/:id` serves the cached count for 5 minutes (`SEGMENT_COUNT_TTL_MS`) and recounts when it is older.
- `GET /segments` never counts: it returns what is cached (`null` before the first count). A new segment is counted when created.
- A worker sweep (`SegmentCountSweepService`, every minute, worker process only) recounts segments used in the last 24 hours whose
  count is older than 4 minutes, 25 per pass, each as its own tenant. "Used" is `last_used_at`, stamped (at most once a minute) by
  reading a segment, listing its contacts, or filtering the contacts table by it.
- Deleting a tag, group, stage, status or property that segments use drops those segments' cached counts, so the next read recounts
  instead of showing a number from before the delete.
- A caller whose `record.contacts.read` scope is not `all` gets their own live, uncached count (the cache holds one workspace-wide
  number); a caller without `record.contacts.read` gets `memberCount: null`.

## Deleting what a segment uses

Segments never block a delete: the condition becomes invalid and is flagged. Where a delete has a body it says which segments are
affected; where it does not, look first:

- `GET /status-options/usage` rows and `GET /fields/usage` rows carry `segments`: how many segments use that stage / status / property.
- `GET /segments/usage?kind=tag|group|stage|status|field|user&ref=<uuid, value or key>` lists them for any of the six (tag and group
  deletes answer 204 with no body).
- The audit row and the outbox event of a tag, group, stage/status and property delete (`tag.deleted`, `contact_group.deleted`,
  `status_option.deleted`, `field.deleted`) carry `segments: [names]`.

## For other domains (broadcasts, campaigns)

Exported from the CRM module barrel (`apps/api/src/modules/crm`):

```ts
SegmentsService.resolveMembers(segmentUuid, { cursor?, limit }): Promise<{
  members: Array<{ id: number /* internal contact id */; uuid: string }>;
  nextCursor: string | null;      // the last contact id; pass it back for the next page
  invalidConditions: InvalidCondition[];
}>;
SegmentsService.countMembers(segmentUuid): Promise<{ count: number; approximate: boolean; invalidConditions: InvalidCondition[] }>;
```

Both need a request context for the tenant (`RequestContextStore.run({ orgId, … })` inside a job). They do **not** check who may see
the segment (a broadcast runs as a job long after the click: the caller authorizes its own use) and do **not** apply consent: a
sender must drop opted-out (`is_unsubscribed`) contacts itself. Pages are ordered by contact id, 5,000 at most, so they stay stable
while membership moves; a sender that must not target a half-broken audience can refuse when `invalidConditions` is not empty.
`resolveMembers` never counts, so it is safe on any size.

## Events and audit

`segment.created`, `segment.updated` (`{ uuid, name, visibility, rulesChanged, sharesChanged, sharedUsers?, sharedTeams? }`; `segment.created` also carries the two counts), `segment.deleted`, each with an audit row
(module `segments`) in the same transaction as the write. An edit that changes nothing writes neither; a failed write (a taken
name, a stale `rowVersion`) leaves neither. Sharing is audited as counts (`sharedUsers`, `sharedTeams`, old and new), never names. Cached counts and the usage stamp are bookkeeping and are not audited.

## Storage

`segments` (`20261011090000_seg_segments.sql`): composite primary key `(org_id, id)`, `uuid`, `name` (unique per workspace, case-
insensitive), `description`, `color`, `visibility`, `owner_id` (composite FK to `users`, `ON DELETE SET NULL (owner_id)`: a segment
outlives its owner), `rules jsonb`, `rules_version`, `member_count_cache`, `member_count_at`, `last_used_at`, timestamps, `row_version`.
Forced RLS with the tenant policy. The touch trigger is `segments_touch()`, `touch_row()` except that writes touching only the cached
count and the usage stamp leave `row_version` and `updated_at` alone (otherwise a count refresh would turn the editor's next save
into a 409). `segment_safe_numeric()` and `segment_safe_timestamptz()` do the casts of custom property values so a dirty value is a
non-match, not an error. Permissions: `20261011090100_seg_permissions.sql`.

`segment_shares` (`20261106090000_seg_share_with_users.sql`): `(org_id, id)` primary key, `segment_id`, and exactly one of `user_id` /
`team_id` (CHECK), composite foreign keys with `ON DELETE CASCADE` to `segments`, `users` and `teams`, unique per segment and person and
per segment and team, forced RLS. The same migration widens `chk_segments_visibility` to `private|shared|specific` (existing rows are
not rewritten) and adds `segments.shares_rev`, which the service bumps with every change of the list so that it moves `row_version`.
