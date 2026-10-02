---
domain: tasks
code: TASK
title: Tasks (first-class CRM to-dos)
wadesk_version: '1.7.0'
sources_read: 14
---

# Tasks (first-class CRM to-dos)

## Overview

"AI-CRM Phase 3" added a stand-alone task list to the Sales Pipeline CRM: a to-do with a title, notes, priority, an optional due
timestamp, an assignee and an optional link to one contact, deal or company. The `/tasks` page ("My tasks") sorts the open ones into
four buckets (overdue, today, upcoming, no date), has a Mine / All switch, a "recently completed" drawer and a New-task modal.
A reminder sweep notifies the assignee once when the due time passes, the AI copilot can create, assign, complete and list tasks,
and the CRM dashboard and calendar read the table.

It is gated by the same plan flag as deals and companies (`access_sales_pipeline`); there is no permission key. Every workspace member
who can open the area sees and edits every task of the workspace. Platform admins bypass the plan gate.

There are **two task systems** in WaDesk: this table and the "task" rows of a deal's timeline (`deal_activities.type='task'`, owned by
`deals-pipelines`, WD-DEAL-015/016). They share nothing: no id, no list, no reminder. `tasks.related_type='deal'` is the only
(untyped) bridge, and nothing in the UI writes it: the New-task modal has no link picker at all (only the AI copilot and a direct
POST can set `related_type` / `related_id`).

Connections: `deals-pipelines` (WD-DEAL-015/016/017, the timeline tasks), `contacts-attributes-tags` (contact link), `workspaces-teams-tenancy`
(assignee must be a workspace member), `notifications-activity-audit` (the due and assigned notifications), the AI CRM copilot
(`CrmToolkit` task tools), the CRM dashboard (`CrmController`) and the unified calendar (`CalendarController`).

## Feature index

| Id          | Feature                                     | Status      | Priority | Effort | Depends on       |
| ----------- | ------------------------------------------- | ----------- | -------- | ------ | ---------------- |
| WD-TASK-001 | Plan gate (no role gate)                    | implemented | P0       | S      |                  |
| WD-TASK-002 | My tasks board: scope, buckets, recent done | implemented | P0       | M      | 001, 009         |
| WD-TASK-003 | Create task                                 | implemented | P0       | S      | 001              |
| WD-TASK-004 | Assignee rules (member check, defaults)     | implemented | P0       | S      | 003              |
| WD-TASK-005 | Edit task                                   | implemented | P0       | S      | 003              |
| WD-TASK-006 | Complete / reopen toggle                    | implemented | P0       | S      | 003              |
| WD-TASK-007 | Delete task                                 | implemented | P1       | S      | 003              |
| WD-TASK-008 | Link to a contact, deal or company          | partial     | P1       | S      | 003              |
| WD-TASK-009 | Due-date buckets and the overdue rule       | implemented | P0       | S      |                  |
| WD-TASK-010 | Due reminder sweep and notifications        | implemented | P1       | M      | 003              |
| WD-TASK-011 | AI copilot task tools                       | implemented | P2       | S      | 003              |
| WD-TASK-012 | Calendar and CRM dashboard consumption      | implemented | P2       | S      | 003              |
| WD-TASK-013 | Notes encrypted at rest                     | implemented | P2       | S      | 003              |
| WD-TASK-014 | Relation to the deal timeline tasks         | docs-only   | P1       | M      | 008, WD-DEAL-015 |

## Features

### WD-TASK-001 — Plan gate (no role gate)

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** none
- **Summary:** every task route sits behind the `plan:access_sales_pipeline` middleware, nothing else.
- **Actors & access:** any member of the workspace on a plan with the flag; platform admins bypass. The class comment says "role manager"
  but no role check exists in the controller or the route group; only the header nav entry carries `tier: admin` (a menu, not a gate).
  No permission key. The plan check only runs on the page-level middleware: all five routes are behind it, reads included.
- **Endpoints:**

| METHOD uri               | route name          | Controller@action        | middleware                       | request                                                               | response                             |
| ------------------------ | ------------------- | ------------------------ | -------------------------------- | --------------------------------------------------------------------- | ------------------------------------ |
| GET tasks                | user.tasks.index    | TasksController@index    | auth, plan:access_sales_pipeline | `scope=mine                                                           | all`                                 | Blade page |
| POST tasks               | user.tasks.store    | TasksController@store    | same                             | title, notes, priority, due_at, assignee_id, related_type, related_id | redirect back, flash "Task created." |
| POST tasks/{id}/complete | user.tasks.complete | TasksController@complete | same                             | none (JSON when `Accept: json`)                                       | `{ok,status}` or redirect            |
| PATCH tasks/{id}         | user.tasks.update   | TasksController@update   | same                             | any of title, notes, priority, due_at, assignee_id                    | redirect back                        |
| DELETE tasks/{id}        | user.tasks.destroy  | TasksController@destroy  | same                             | none                                                                  | redirect back                        |

- **Acceptance criteria:**
  - Given a plan without the flag, When any task route is called, Then access is refused.
  - Given a member of a plan with the flag, When they call any task route, Then it works whatever their role.
- **Source refs:** routes/web.php:1461-1469, app/Http/Controllers/TasksController.php:1-15, resources/views/components/user/header.blade.php:126.
- **Port notes:** reuse `SalesPipelineGuard` (`features.sales_pipeline`). Replace "any member" with permission keys (D-02).

### WD-TASK-002 — My tasks board: scope, buckets, recent done

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-TASK-001, WD-TASK-009
- **Summary:** one page with four bucket cards and a collapsed "Recently completed" list.
- **UX & screens:** `resources/views/user/tasks/index.blade.php`. Header with a Mine | All pill switch and "+ New task". A how-to strip. Four cards
  (Overdue, Today, Upcoming, No date) each with a count and rows: a tick box (POST complete), title, priority pill, due `d M, H:i`, linked
  object label, assignee name, a delete button (no confirm). Empty card: "Nothing here.". "Recently completed (n)" is a `<details>` with
  struck-through titles and a Reopen link. A new-task modal (title, priority, due, assignee select defaulting to the caller, notes).
  There is no edit UI even though the update route exists, no search, no filters, no pagination.
- **Data:** `scope=all` loads every OPEN task of the workspace; `scope=mine` (default) loads open tasks whose assignee is the caller OR
  has no assignee. Ordered by due date ascending with undated last, **hard-capped at 500** and bucketed in PHP. Recently completed:
  the 20 latest by `done_at`, all assignees, ignoring the Mine/All switch.
- **Rules & edge cases:**
  1. Mine includes unassigned tasks (so an unowned task shows on everyone's list).
  2. Buckets are computed after the 500 cap, so a workspace with more than 500 open tasks silently loses the rest, and the cards' counts are the capped numbers.
  3. QUIRK: "Recently completed" is not filtered by scope.
  4. Done tasks cannot be browsed beyond the latest 20.
- **Acceptance criteria:**
  - Given three open tasks (overdue, due later today, due next week) and one undated, When the board loads, Then they fall into the four buckets in that order.
  - Given a task assigned to someone else, When "Mine" is shown, Then it is hidden; "All" shows it.
  - Given a done task, When "Reopen" is pressed, Then it returns to its bucket.
- **Source refs:** TasksController.php:30-62, resources/views/user/tasks/index.blade.php.
- **Port notes:** replace the 500 cap with cursor pagination plus a counts endpoint for the badges.

### WD-TASK-003 — Create task

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-TASK-001
- **Rules & edge cases:**
  1. `title` required, string, max 255. `notes` nullable, max 5000. `priority` low|medium|high (default medium). `due_at` nullable, any parseable date/datetime
     (the modal sends `datetime-local`, no offset: read in the server's time zone, not the workspace's).
  2. `status` is always `open`; `created_by` is the caller; `workspace_id` the current workspace.
  3. `related_type` (contact|deal|company) and `related_id` (integer) are accepted **without checking that the object exists or belongs to the workspace**
     and without requiring them together (a type with no id is stored as is).
  4. No notification is sent on create from the UI (only the AI tool notifies an assignee other than the caller).
  5. Validation failures are Laravel's 422 / redirect-back with errors.
- **Acceptance criteria:**
  - Given a title only, When created, Then it is open, medium priority, assigned to the caller, no due date.
  - Given a 256-character title, Then it is rejected.
- **Source refs:** TasksController.php:64-96, app/Models/Task.php.

### WD-TASK-004 — Assignee rules (member check, defaults)

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-TASK-003
- **Rules & edge cases:**
  1. On create, the assignee defaults to the caller; a given `assignee_id` that is not a member of the workspace is **silently replaced by the caller** (no error).
  2. On update, a non-member `assignee_id` is **silently dropped** (the old assignee stays, the response says "Task updated.").
  3. `assignee_id: null` on update clears the assignee (an unassigned task shows on everyone's "Mine").
  4. Membership is `workspace_user`; there is no "active" check, so a removed or suspended user's membership row still counts while it exists.
  5. The AI tool matches an assignee by a case-insensitive substring of the member's name (first hit wins), falling back to the caller on create and failing on assign.
  6. Assigning a task to someone else from the UI never notifies them; `notifyTaskAssigned` runs only from the AI tools.
- **Acceptance criteria:**
  - Given an assignee who belongs to another workspace, When creating, Then the task is assigned to the caller (WaDesk); the port answers 422.
- **Source refs:** TasksController.php:20-26, 70-80, 119-124, CrmToolkit.php:811-863.

### WD-TASK-005 — Edit task

- **Status:** partial (route and controller exist, no UI)
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-TASK-003
- **Rules & edge cases:** PATCH accepts `title` (sometimes, max 255), `notes`, `priority`, `due_at`, `assignee_id`; the link and the status are not editable
  here. `sometimes|string` on a title means an explicit empty string fails and `null` is rejected. A changed due date does NOT clear `reminded_at`: a task
  already reminded and moved to next week is never reminded again. Last write wins, no version.
- **Acceptance criteria:** Given a task, When PATCHed with a new priority, Then only the priority changes.
- **Source refs:** TasksController.php:111-126.

### WD-TASK-006 — Complete / reopen toggle

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-TASK-003
- **Rules & edge cases:** `POST tasks/{id}/complete` toggles: an open task becomes `done` with `done_at = now`; a done task becomes `open` with `done_at = null`
  (the Reopen link posts to the same route). It is a toggle, so a double click (or two tabs) completes then reopens. `reminded_at` is **not** cleared on reopen.
  Any workspace member can complete any task. JSON answer `{ok:true,status}`.
- **Acceptance criteria:** Given an open task, When toggled twice, Then status is done then open and `done_at` is set then null.
- **Source refs:** TasksController.php:98-109.
- **Port notes:** explicit `complete` and `reopen` actions (idempotent), not a toggle.

### WD-TASK-007 — Delete task

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-TASK-003
- **Rules & edge cases:** hard delete, no confirm in the UI, no audit, no trace. A deleted task leaves no timeline entry anywhere.
- **Source refs:** TasksController.php:128-137.

### WD-TASK-008 — Link to a contact, deal or company

- **Status:** partial
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-TASK-003
- **Rules & edge cases:**
  1. A task links to at most one object through `related_type` + `related_id` (polymorphic, no foreign key, index `(related_type, related_id)` only).
  2. The board shows a label via `Contact::find` / `Deal::find` / `Company::find` **without the workspace filter**, so a cross-workspace id shows another workspace's contact name; a
     deleted object shows nothing; any error is swallowed.
  3. Nothing in the UI sets the link (WD-TASK-003 #3); the contact, deal and company pages do not list their tasks.
  4. A deleted contact or deal leaves the task with a dangling link.
- **Source refs:** app/Models/Task.php:62-79.

### WD-TASK-009 — Due-date buckets and the overdue rule

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** none
- **Rules & edge cases:** only OPEN tasks are bucketed. No due date: "no date". Due instant already past: "overdue" (the instant, so a task due at 09:00 is overdue at 09:01 the
  same day). Otherwise due on today's calendar date: "today". Otherwise "upcoming". "Today" and "past" use the application's time zone, not the workspace's; a datetime-local
  due time with no offset is read in that same zone. `isOverdue()` = open and due in the past. The dashboard counts overdue as open, with a due date, `due_at < now`.
- **Acceptance criteria:** Given now = 10:00, a task due 09:00 is overdue, due 15:00 is today, due tomorrow is upcoming, undated is no date.
- **Source refs:** TasksController.php:41-52, Task.php:55-58, CrmController.php:61-72.

### WD-TASK-010 — Due reminder sweep and notifications

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-TASK-003, notifications domain
- **Rules & edge cases:**
  1. Candidates: open, `done_at IS NULL`, `reminded_at IS NULL`, `due_at IS NOT NULL AND due_at <= now`, soonest first, limited (500 by command; per workspace on the inbox poll, cache-gated 60 s).
  2. `task_due` notification to the assignee, fallback the creator (title "Task due", body = task title, link `/tasks`, dedupe key `task_due:{id}`); in-app plus web push.
  3. `reminded_at` is stamped for every processed task, even when the notification failed or nobody could be notified.
  4. `task_assigned` ("Task assigned to you") exists but is only sent from the AI tools.
  5. Reopening or re-dating never re-arms the reminder (compare D-20 for deal tasks).
  6. Triggered by the team-inbox poll or `php artisan crm:remind-tasks {--limit=500}`; no scheduler of its own.
- **Acceptance criteria:**
  - Given an open task due an hour ago with no reminder, When the sweep runs, Then the assignee gets one notification and `reminded_at` is set; a second run sends none.
  - Given a done task, Then it is never reminded.
- **Source refs:** app/Services/Crm/TaskReminderService.php, app/Console/Commands/CrmRemindTasksCommand.php, NotificationDispatcher.php:171-198.

### WD-TASK-011 — AI copilot task tools

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-TASK-003
- **Rules & edge cases:** `create_task` (title; optional due string parsed leniently and **silently ignored when unparseable**, priority silently replaced by medium when invalid,
  assignee by name), `assign_task` (task id + name; notifies), `complete_task` (always sets done, never reopens), `list_my_tasks` (open, assignee = caller or unassigned, due soonest,
  25, with an `overdue` flag). Tools run as the staff member; no link parameter. The services' `source` is the copilot, so a port gives the task creation a `source` hook.
- **Source refs:** app/Services/AiCrm/CrmToolkit.php:195-240, 811-890.

### WD-TASK-012 — Calendar and CRM dashboard consumption

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-TASK-003
- **Rules & edge cases:** the calendar lists tasks with a due date in the visible month (id, title, due date, done flag; links to `/tasks`); the CRM dashboard shows open and
  overdue counts and the next six open dated tasks with assignee. Both read the table directly and never see the deal timeline tasks.
- **Source refs:** CalendarController.php:32-46, CrmController.php:61-72.

### WD-TASK-013 — Notes encrypted at rest

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-TASK-003
- **Rules & edge cases:** `notes` is an encrypted cast (title stays plain so it can be sorted and shown). Consequence: notes cannot be searched.
- **Source refs:** Task.php:19-24.

### WD-TASK-014 — Relation to the deal timeline tasks

- **Status:** docs-only (the bridge is a comment, not code)
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-TASK-008, WD-DEAL-015, WD-DEAL-016, WD-DEAL-017
- **Rules & edge cases:** a task added from a deal's timeline lives only in `deal_activities` (`body`, `due_at`, `done_at`, `reminded_at`; no assignee in WaDesk) with its own done toggle
  and its own `deal_task_due` reminder for the deal owner. It is invisible in `/tasks`, the calendar and the dashboard. A task created at `/tasks` with `related_type=deal` is invisible in the deal drawer.
- **Source refs:** DealsController.php:387-427, DealReminderService.php, Models/DealActivity.php.

## Data model

### tasks (WaDesk MySQL, 0 rows locally)

`id`, `workspace_id` (NOT NULL), `created_by` null, `assignee_id` null, `title` varchar(255) NOT NULL, `notes` text (encrypted), `priority` varchar(8) default `medium`,
`status` varchar(8) default `open`, `related_type` varchar(16) null, `related_id` bigint null, `due_at` timestamp null, `reminded_at` timestamp null, `done_at` timestamp null,
`created_at`, `updated_at`. Indexes: `(workspace_id, status, due_at)`, `(related_type, related_id)`, `workspace_id`, `assignee_id`, `status`, `due_at`. No foreign keys, no CHECKs, no soft delete.
Enums are PHP constants only: priority low|medium|high, status open|done, related contact|deal|company.

### Our draft (migration 20261001103900) and live DB

Same columns with `org_id` (composite PK `(org_id,id)`), `uuid`, `row_version`, composite FKs to `users` for `created_by` and `assignee_id` (SET NULL), forced RLS, `touch_row` trigger. Still the
untyped `related_type` / `related_id` with no FK and no CHECK, no CHECK on status or priority, no done-stamp invariant. Drizzle mirror in `packages/db/src/schema/companies-projects-tasks/tables.ts`.

## Cross-domain contracts

- **Consumes** `deals-pipelines`: deals (link, owner scope), the timeline tasks (WD-TASK-014); `contacts-attributes-tags`: contacts (link, record scope); `crm` companies (link); `workspaces-teams-tenancy`: members (assignee), teams (record scope `team`).
- **Exposes** to deals: `tasks.deal_id` rows listed at `GET /deals/:id/tasks`; to contacts: `GET /contacts/:id/tasks`; to the dashboard and calendar domains: the list, count and due-window endpoints; to notifications: the outbox events `task.created`, `task.assigned`, `task.completed`, `task.reopened`, `task.deleted`, `task.due`.

## Open questions & quirks

- The controller comment says role manager; no role check exists.
- No link picker, no edit UI, no search or filters; the API surface the UI uses is five routes.
- `reminded_at` is never cleared.
- Today/overdue use the app time zone.
- Dangling links and cross-workspace label lookups (WD-TASK-008).
- Two task systems (WD-TASK-014).

## Differences to decide

| Id   | WaDesk behavior                                                                   | Recommendation for the port                                                                                                                                                                                   |
| ---- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-01 | Plan gate on the page only                                                        | `PLAN_FEATURE_LOCKED` on every route, reads included (same guard as deals)                                                                                                                                    |
| D-02 | No permission keys: any member does anything                                      | `record.tasks.read/create/update/delete` with a record scope (own / team / all); Admin all, Agent own                                                                                                         |
| D-03 | A non-member assignee is silently replaced (create) or dropped (update)           | 422 `TASK_ASSIGNEE_INVALID`; only ACTIVE members; omitted on create means the caller, `null` means unassigned                                                                                                 |
| D-04 | Mine = assigned to me OR unassigned                                               | Mine = assigned to me (filter `mine`); `unassigned` is its own filter. A creator keeps sight of what they created under scope `own`                                                                           |
| D-05 | Link is untyped, unchecked, dangling after delete, label lookup across workspaces | Typed `contactId`, `dealId`, `companyId` with composite FKs, `ON DELETE SET NULL`, each resolved inside the workspace (404 when absent); a task may link a contact AND a deal (a deal task knows its contact) |
| D-06 | 500-row cap with buckets in PHP                                                   | Cursor pagination at DB level, counts per bucket endpoint for badges                                                                                                                                          |
| D-07 | Complete is a toggle                                                              | `POST /tasks/:id/complete` and `/reopen`, idempotent, outbox event only on a real change                                                                                                                      |
| D-08 | `due_at` read in the server zone; today/overdue in the server zone                | Full timestamp with offset required; buckets cut in the workspace zone (`organizations.settings.timezone`, else UTC)                                                                                          |
| D-09 | Reopen and re-dating never re-arm the reminder                                    | Both clear `reminded_at`                                                                                                                                                                                      |
| D-10 | No version, last write wins                                                       | `rowVersion` on update (409 `ROW_VERSION_CONFLICT`); complete/reopen/bulk are last-write-wins                                                                                                                 |
| D-11 | Delete leaves no trace                                                            | Hard delete (repo rule), audited with what was deleted, `task.deleted` event                                                                                                                                  |
| D-12 | Assigning from the UI never notifies                                              | `task.assigned` outbox event on every assignment to someone other than the actor (create or change)                                                                                                           |
| D-13 | Recently completed ignores the scope; done list capped at 20                      | `status=done` list with its own cursor, sorted by completion time                                                                                                                                             |
| D-14 | Two disconnected task systems                                                     | A timeline task created on a deal is mirrored into `tasks` (linked deal and contact), both sides stay in sync for done/open, due and assignee; documented under Port decisions                                |
| D-15 | Reminder runs from the inbox poll                                                 | Outbox `task.due` hook point plus an idempotent sweep keyed on `reminded_at`; the notification consumer belongs to the notifications domain                                                                   |
| D-16 | Notes encrypted, so unsearchable                                                  | Keep encrypted; search covers the title only                                                                                                                                                                  |
| D-17 | AI tools: lenient parsing, silent fallbacks                                       | The services take a `source`; callers decide how to surface errors                                                                                                                                            |

## Coverage

```json wadesk-coverage
{
  "routes": [
    "GET tasks",
    "POST tasks",
    "POST tasks/{id}/complete",
    "PATCH tasks/{id}",
    "DELETE tasks/{id}"
  ],
  "controllers": ["app/Http/Controllers/TasksController.php"],
  "services": ["app/Services/Crm/TaskReminderService.php"],
  "models": ["Task"],
  "tables": ["tasks"],
  "views": ["resources/views/user/tasks/index.blade.php"],
  "commands": ["crm:remind-tasks"],
  "permissions": [],
  "middleware": [],
  "misc_files": [],
  "feature_map": {
    "WD-TASK-001": ["GET tasks"],
    "WD-TASK-003": ["POST tasks"],
    "WD-TASK-005": ["PATCH tasks/{id}"],
    "WD-TASK-006": ["POST tasks/{id}/complete"],
    "WD-TASK-007": ["DELETE tasks/{id}"]
  }
}
```

## Port decisions

Recorded by the API port of tasks. The default was to **fix clear bugs and keep intended behaviour**; every place the port differs from
WaDesk is listed here with the "Differences to decide" row it settles. Code: `apps/api/src/modules/crm/tasks`, contracts in
`packages/contracts/src/tasks/`, migrations `20261004100000..100200_task_*`, endpoints in `docs/api/tasks.md`, tests in
`apps/api/test/{unit,integration,e2e}/tasks`.

### Decided as recommended (fixes)

| Diff # | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Where            |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| D-01   | The plan check covers reads too: a workspace whose plan lacks the sales pipeline gets `422 PLAN_FEATURE_LOCKED` on every task route (the same `SalesPipelineGuard` and `features.sales_pipeline` flag as deals).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | WD-TASK-001      |
| D-02   | Permissions are keys, not "any member": `record.tasks.read/create/update/delete`, registered in `permission_defs`, granted to Admin (all) and to the Agent / Counsellor preset (read, update, delete on `own`; create). The record scope is on the task's PEOPLE: `own` = assigned to me OR created by me (so a creator who hands a task over keeps sight of it), `team` adds teammates, `all` is everyone. Out of scope is 404, never 403. The sign-up provisioning and the dev seed carry the same Agent grants.                                                                                                                                                                                                                                 | WD-TASK-001      |
| D-03   | An assignee must be an ACTIVE member of the workspace: `422 TASK_ASSIGNEE_INVALID` on create, edit and bulk assign (WaDesk replaced it with the caller on create and dropped it on update, answering success). Omitted on create means the caller; `null` means nobody.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | WD-TASK-004      |
| D-04   | "Mine" is `mine=true` (assigned to me) and no longer includes unassigned tasks; `unassigned=true` is its own filter. `GET /tasks/my` is the list with `mine` forced.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | WD-TASK-002      |
| D-05   | The link is typed and enforced: `contact_id`, `deal_id`, `company_id` with composite foreign keys (`ON DELETE SET NULL`, so a deleted deal or contact never leaves a dangling pointer and the task survives), each resolved inside the workspace (404 when absent; WaDesk stored any integer and read the label across workspaces). A task may link a contact AND a deal AND a company (WaDesk: one object); a deal brings its contact and company on create unless the body names them. `PUT /tasks/:id/links` links and unlinks. The old `related_type` / `related_id` columns are migrated where the object exists in the same workspace and dropped.                                                                                           | WD-TASK-008      |
| D-06   | No 500-row cap: the list is cursor-paged at the database (microsecond keyset over the sort key + id; sorts due, created, completed) and `GET /tasks/counts` returns the bucket counts and the done count for the tab badges in one query. Partial and expression indexes serve the open-by-due, assignee, done, link and reminder paths; a trigram index serves the title search.                                                                                                                                                                                                                                                                                                                                                                  | WD-TASK-002      |
| D-07   | Complete and reopen are explicit, idempotent actions (`POST /tasks/:id/complete`, `/reopen`, optional `rowVersion`), not a toggle; an event and an audit row are written only on a real change. Bulk complete, reopen, assign and delete are added (one transaction per call, per-id failures listed, 200 ids at most).                                                                                                                                                                                                                                                                                                                                                                                                                            | WD-TASK-006      |
| D-08   | A due date is a full timestamp with an offset (a bare date is 422). The overdue / today / upcoming cut is made in the workspace's time zone (`organizations.settings.timezone`, else UTC), not the server's; `bucket` and `overdue` come back on every task, and `due=overdue\|today\|upcoming\|none` filters on the same rule.                                                                                                                                                                                                                                                                                                                                                                                                                    | WD-TASK-009      |
| D-09   | Reopening a task and changing its due date both clear `reminded_at`, so the task can be reminded again.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | WD-TASK-005, 010 |
| D-10   | `PATCH` takes `rowVersion` (409 `ROW_VERSION_CONFLICT`); the database trigger bumps `row_version` on every write. Complete, reopen, links and the bulk actions are last write wins unless the body carries a version. A CHECK makes `status = 'done'` exactly when `done_at` is set.                                                                                                                                                                                                                                                                                                                                                                                                                                                               | WD-TASK-005      |
| D-11   | Hard delete (the repo's rule), audited with what was deleted, `task.deleted` event.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | WD-TASK-007      |
| D-12   | `task.assigned` is emitted whenever a task is assigned to someone other than the person doing it (create, edit, bulk): the hook for the "assigned to you" notification that WaDesk only sent from the AI tools.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | WD-TASK-004, 010 |
| D-13   | `status=done` is a first-class, paged list sorted by completion (not a fixed 20), and it respects the scope.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | WD-TASK-002      |
| D-14   | One task list: a task added on a deal timeline is mirrored into `tasks` (`source: deal`, linked to the deal, its contact and company, same due date and assignee; `deal_activities.task_id` points at it, one to one, `ON DELETE SET NULL`). Completing or reopening on either side, and editing the due date or assignee of the task, keep the pair in step; deleting the task keeps the timeline row; the due sweep stamps both so a deal reminder does not repeat it. `GET /deals/:id/tasks` and `GET /contacts/:id/tasks` serve the lists. The deals module's own `GET /deals/tasks` still lists the timeline rows. Not back-filled: the existing timeline tasks hold encrypted text, so no title can be derived in SQL (the table held none). | WD-TASK-014      |
| D-15   | The reminder is a worker job, not an inbox poll: `TaskDueSweepService` (every 60 s, privileged, `FOR UPDATE SKIP LOCKED`) stamps `reminded_at` and writes `task.due` in one transaction. The notification itself (in-app, push) is a consumer of the event and belongs to the notifications domain.                                                                                                                                                                                                                                                                                                                                                                                                                                                | WD-TASK-010      |
| D-16   | Notes stay encrypted at rest (AES-GCM through `CryptoService`, as the WaDesk cast did) and are never copied to an audit row or an event; search covers the title only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | WD-TASK-013      |
| D-17   | The service takes a `source` (`manual, deal, ai, api, flow`, enforced by a CHECK) so the AI tools, flows and the public API can write tasks without a lenient parser of their own.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | WD-TASK-011      |

### Other decisions

| Decision                                                                                                                                                                                            | Where       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Ids on the wire, in audit rows and in events are uuids; the audit trail names people and linked records by uuid.                                                                                    | all         |
| `title` is trimmed and 1 to 255 characters (a blank title is 422; WaDesk accepted whitespace); `notes` at most 5000; an unknown `priority` is 422.                                                  | WD-TASK-003 |
| A due-window filter (`due`, `dueFrom`, `dueTo`) is about open tasks: a done task is never "overdue".                                                                                                | WD-TASK-009 |
| A deleted user is `ON DELETE SET NULL` on assignee and creator; a suspended or removed member can no longer be assigned, but stays filterable.                                                      | WD-TASK-004 |
| A role migration cannot clear the permission cache: on a running environment the new keys appear when the 10-minute grant cache expires (or after flushing the `rbac:*` Redis keys), as with deals. | rbac        |

### Not built here (follow-ups)

| What                                                                         | Why / where it goes                                                                               |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| The `task.due` and `task.assigned` notification consumers (in-app, web push) | Notifications domain; the events and the sweep are in place.                                      |
| AI copilot task tools (WD-TASK-011), flow and public-API writers             | Owned by the AI, flows and developer-API domains; they call `TasksService.create(input, source)`. |
| Calendar and CRM dashboard consumers (WD-TASK-012)                           | Other domains read `GET /tasks` (`dueFrom` / `dueTo`) and `GET /tasks/counts`.                    |
| Recurring tasks, snooze, subtasks, comments                                  | Not in WaDesk.                                                                                    |
| `sales_pipeline` is still not in the plan registry (`PLAN_FEATURE_DEFS`)     | Same follow-up as deals: the web plan editor needs its messages in the same change.               |
