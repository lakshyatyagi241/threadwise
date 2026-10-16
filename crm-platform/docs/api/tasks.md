# API: tasks

Domain `task` (TW-TASK-001 .. 014). Base path `/v2`. Errors are `application/problem+json` with a stable `code` and a `requestId`;
the code this domain adds is `TASK_ASSIGNEE_INVALID` in `@crm/contracts` `common/errors.ts`. Request and response shapes live in
`packages/contracts/src/tasks/`. Live docs: `/docs`. Every id on the wire is a uuid. Decisions where the port differs from Reference:
"Port decisions" in `docs/threadwise-port/inventory/tasks.md`.

All routes need a staff bearer token, the plan's **sales pipeline** (`422 PLAN_FEATURE_LOCKED` otherwise, reads included: the flag
Reference gated tasks on) and the capability in brackets. "scope" means the caller's record scope applied to **who the task belongs
to**: `own` is "assigned to me or created by me" (so whoever hands a task to a colleague keeps seeing it), `team` adds people who
share a team with me, `all` is the workspace. A task outside the scope is `404`, never `403`. Literal paths (`my`, `counts`,
`bulk/...`) are registered before `:id`. `POST` create accepts an `Idempotency-Key`.

## Capabilities

| Key                   | Scope | Grants                                                                               |
| --------------------- | ----- | ------------------------------------------------------------------------------------ |
| `record.tasks.read`   | yes   | list, my tasks, counts, get, a contact's and a deal's tasks                          |
| `record.tasks.create` | no    | create a task                                                                        |
| `record.tasks.update` | yes   | edit, complete, reopen, assign, link and unlink, and the bulk complete/reopen/assign |
| `record.tasks.delete` | yes   | delete one task, or bulk delete                                                      |

The Admin preset holds all four. The editable front-line preset (`Agent` from sign-up, `Counsellor` from the dev seed) gets read,
update and delete on its own tasks, and create. A contact's task list also needs `record.contacts.read` on the contact, and a deal's
needs `record.deals.read` on the deal (each with its own scope: a contact or deal the caller cannot see is `404`; no permission on
it at all is `403`).

## The task

```json
{
  "id": "5c1e…",
  "title": "Call Acme about renewal",
  "notes": "Ask for the PO number",
  "priority": "high",
  "status": "open",
  "dueAt": "2026-10-05T09:00:00.000Z",
  "doneAt": null,
  "remindedAt": null,
  "bucket": "overdue",
  "overdue": true,
  "assignee": { "id": "…", "name": "Ana" },
  "createdBy": { "id": "…", "name": "Ben" },
  "contact": { "id": "…", "name": "Acme Ltd" },
  "deal": { "id": "…", "title": "Renewal 2027" },
  "company": null,
  "source": "manual",
  "rowVersion": 3,
  "createdAt": "…",
  "updatedAt": "…"
}
```

`status` is `open` or `done`; `doneAt` is set exactly when it is `done` (a database CHECK). `priority` is `low | medium | high`.
`bucket` is where an OPEN task sits against the clock in the **workspace's** time zone (`organizations.settings.timezone`, UTC when
unset): `overdue` (the due instant has passed, even earlier today), `today` (due later today), `upcoming` (a later day), `no_date`;
a done task has `bucket: null`. `overdue` is `bucket === "overdue"`. `source` is `manual | deal | ai | api | flow` (`deal`: mirrored
from a deal timeline task). `notes` is encrypted at rest and returned decrypted; it is never in an audit row or an event.

## Routes

| Route                       | Capability            | Notes                                                                                                                                          |
| --------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /tasks`                | `record.tasks.read`   | cursor-paged list (below)                                                                                                                      |
| `GET /tasks/my`             | `record.tasks.read`   | the same query with `mine=true` forced: tasks assigned to the caller                                                                           |
| `GET /tasks/counts`         | `record.tasks.read`   | bucket counts for the tab badges                                                                                                               |
| `POST /tasks`               | `record.tasks.create` | 201                                                                                                                                            |
| `GET /tasks/:id`            | `record.tasks.read`   |                                                                                                                                                |
| `PATCH /tasks/:id`          | `record.tasks.update` | needs `rowVersion` (409 `ROW_VERSION_CONFLICT`); absent keeps, `null` clears                                                                   |
| `PUT /tasks/:id/links`      | `record.tasks.update` | `{ contactId?, dealId?, companyId? }`; `null` unlinks; no version (last write wins)                                                            |
| `POST /tasks/:id/complete`  | `record.tasks.update` | `{ rowVersion? }`; idempotent                                                                                                                  |
| `POST /tasks/:id/reopen`    | `record.tasks.update` | `{ rowVersion? }`; idempotent; arms the reminder again                                                                                         |
| `DELETE /tasks/:id`         | `record.tasks.delete` | 204                                                                                                                                            |
| `POST /tasks/bulk/complete` | `record.tasks.update` | `{ ids }` (1 to 200)                                                                                                                           |
| `POST /tasks/bulk/reopen`   | `record.tasks.update` | `{ ids }`                                                                                                                                      |
| `POST /tasks/bulk/assign`   | `record.tasks.update` | `{ ids, assigneeId }` (`null` unassigns)                                                                                                       |
| `POST /tasks/bulk/delete`   | `record.tasks.delete` | `{ ids }`                                                                                                                                      |
| `GET /contacts/:id/tasks`   | `record.tasks.read`   | that contact's tasks; the list's filters and paging, minus the link filters                                                                    |
| `GET /deals/:id/tasks`      | `record.tasks.read`   | that deal's tasks, including those added from the deal timeline                                                                                |
| `GET /companies/:id/tasks`  | `record.tasks.read`   | that company's tasks (the company page's card); also needs `record.companies.read` on the company, whose record scope applies (404 outside it) |

### Create and edit

```json
// POST /v2/tasks
{
  "title": "Call Acme about renewal",
  "priority": "high",
  "dueAt": "2026-10-05T09:00:00+05:30",
  "assigneeId": "…",
  "dealId": "…",
  "notes": "Ask for the PO number"
}
```

`title` is required, trimmed, 1 to 255 characters. `notes` at most 5000. `dueAt` is a full timestamp **with an offset** (a bare date is
`422`, so nothing is silently read as midnight). `assigneeId` omitted means the caller, `null` means nobody; anyone who is not an
**active member of this workspace** is `422 TASK_ASSIGNEE_INVALID` (Reference silently substituted or dropped it). A `contactId`,
`dealId` or `companyId` that is not in this workspace is `404`. A task can link a contact, a deal and a company at once; creating
with a `dealId` brings the deal's contact and company along unless the body names them (`null` opts out).

An edit that moves `dueAt`, and a reopen, clear `remindedAt`, so the task can be reminded again. Status never changes through
`PATCH`: use `complete` and `reopen`, which are explicit and idempotent (completing a done task changes nothing and emits nothing).

### The list

`GET /tasks?status=open&due=overdue&priority=high,medium&assigneeId=…&q=renewal&limit=50&cursor=…`

| Query                              | Meaning                                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `status`                           | `open` (default), `done`, `all`                                                                                                            |
| `due`                              | `overdue`, `today`, `upcoming` (open tasks, workspace zone) or `none` (no due date). Any due filter implies open tasks                     |
| `dueFrom`, `dueTo`                 | due in `[dueFrom, dueTo)`; full timestamps with offset                                                                                     |
| `priority`                         | one or several, comma separated                                                                                                            |
| `mine`, `assigneeId`, `unassigned` | assigned to the caller / to that member / to nobody (a member who has left is still filterable)                                            |
| `contactId`, `dealId`, `companyId` | linked to that record; an id that is not in the workspace gives an empty page                                                              |
| `q`                                | case-insensitive substring of the title (notes are encrypted, so not searched)                                                             |
| `sort`                             | `due` (soonest first, undated last; the default), `created` (newest first), `completed` (latest done first; the default for `status=done`) |
| `limit`, `cursor`                  | 1 to 200 (default 50); the opaque `page.nextCursor` of the last page                                                                       |

The answer is `{ data: Task[], page: { nextCursor, hasMore, limit } }`. The cursor is a keyset over the sort key at **microsecond**
precision plus the row id, so rows that tie (a bulk import, a shared due time) are never lost or repeated; it is tied to its sort
(a cursor from `due` against `sort=created` is `400`). A damaged cursor is `400`; an invalid query is `422`.

### Counts for the badges

```json
// GET /v2/tasks/counts?priority=high   (same filters as the list, minus status/due/sort/paging)
{
  "overdue": 2,
  "today": 1,
  "upcoming": 1,
  "noDate": 2,
  "open": 6,
  "done": 1,
  "mine": { "open": 4, "overdue": 1 }
}
```

The four buckets partition the OPEN tasks inside the caller's scope and the filter; `open` is their sum; `done` counts completed
tasks. `mine` is the caller's own open and overdue assignments inside their scope, whatever the filter (the "My tasks" badge).

### Bulk

```json
// POST /v2/tasks/bulk/complete   { "ids": ["…", "…", "…"] }
{
  "succeeded": ["…", "…"],
  "failed": [{ "id": "…", "code": "NOT_FOUND", "message": "Task … not found" }]
}
```

One transaction per call. Ids that do not exist, belong to another workspace or fall outside the caller's scope are listed in
`failed` and do not stop the others; duplicates are applied once. Each success writes its own audit row and event. A bad assignee
on `bulk/assign` is the one failure that fails the whole call (`422 TASK_ASSIGNEE_INVALID`), before any task changes.

## How tasks relate to the deal timeline

A deal's timeline can hold tasks (`POST /deals/:id/activities` with `type: "task"`, owned by the deals domain). Since this port
those are **mirrored** into `tasks`: the new row has `source: "deal"`, links the deal, its contact and company, and carries the
timeline row's due date and assignee; the timeline row keeps its history and points at the task. The two stay in step:

- completing or reopening on either side does it on the other; completing from the timeline emits `deal.task_completed` and
  `task.completed`, completing from `/tasks` emits `task.completed` only;
- changing the task's due date or assignee updates the timeline row;
- deleting the task keeps the timeline row; deleting the deal removes the timeline (cascade) and leaves the mirrored task as an
  ordinary task with no deal link;
- the due sweep stamps the timeline row's `reminded_at` as well, so a deal-task reminder consumer does not announce it twice.

`GET /deals/tasks` (the deals domain's own "my tasks across deals") still lists the timeline rows. Timeline tasks written before the
mirror existed are not back-filled (their text is encrypted, so a migration cannot derive a title); the table was empty in every
environment when the mirror landed.

## Events (outbox) for notifications, flows and webhooks

Aggregate `tasks`. Payloads carry uuids and the few fields a consumer decides on (`uuid, title, priority, status, dueAt, assigneeId,
createdById, contactId, dealId, companyId, source`), plus `_meta`. At-least-once, written in the transaction of the change.

| Event                             | When                                                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `task.created`                    | a task is created (also when mirrored from a deal timeline)                                                                          |
| `task.updated`                    | a field edit, a link change or an assignment (`changed` lists the fields)                                                            |
| `task.assigned`                   | assigned to someone **other than the person who did it**, on create, edit or bulk (`previousAssigneeId`): the "assigned to you" hook |
| `task.completed`, `task.reopened` | a real status change (never on a no-op)                                                                                              |
| `task.deleted`                    | a delete                                                                                                                             |
| `task.due`                        | the due sweep: an open task whose due time passed and was never reminded                                                             |

### The due sweep

`TaskDueSweepService` (worker process, every 60 s, privileged, `FOR UPDATE SKIP LOCKED`, 200 per pass) claims open tasks with
`due_at <= now()` and `reminded_at IS NULL`, stamps `reminded_at` and writes one `task.due` event each, in one transaction: a task
is announced once however many workers run. The payload carries the assignee, and the creator for the unassigned (Reference's
fallback). Reopening a task and moving its due date clear `reminded_at`, which arms it again.

## Notifications

`TaskNotificationConsumer` (worker process, `apps/api/src/modules/notifications`) turns three of these events into rows of the in-app feed
(`inbox_notifications`, see [notifications.md](notifications.md)):

| Event            | Who is told                                             | Type             |
| ---------------- | ------------------------------------------------------- | ---------------- |
| `task.assigned`  | the new assignee, unless they assigned it to themselves | `task_assigned`  |
| `task.due`       | the assignee, else the creator                          | `task_due`       |
| `task.completed` | the creator, unless they completed it themselves        | `task_completed` |

Idempotent: the row's `dedupe_key` is the event type plus the outbox event id and the insert is `ON CONFLICT DO NOTHING`, so the drain's at-least-once
delivery cannot notify twice while a later real event (assigned, reassigned, assigned back) notifies again. The task is read again at delivery: a
`task.due` for a task completed since, or a `task.assigned` for one reassigned since, is dropped; so is a recipient who is no longer an active member.
"Due soon" is the sweep's moment (the due time is reached); there is no earlier heads-up.

## What is not built here

Email, Slack and Web Push for task notifications (the in-app feed only), per-person notification preferences, the AI copilot task tools (TW-TASK-011) and any other writers (flows, the
public REST API, which also needs key scopes) are follow-ups: they call `TasksService.create(input, source)` (and the bulk and
complete methods), which already take a `source`. The calendar and dashboard consumers (TW-TASK-012) read `GET /tasks` and
`GET /tasks/counts` (`dueFrom`/`dueTo` give the calendar its month). There is no recurrence and no snooze, as in Reference.
