# API: sales activities (Settings > Sales Activities)

Backlog BL-370 to BL-379. Wiring map: [wiring/sales-activities.md](../threadwise-port/wiring/sales-activities.md). Types are in `@crm/contracts` (`sales-activities`). Session auth, ids are uuids.
A product extension: Reference has tasks and call logs but no configurable task types or outcomes. The behaviour follows Freshsales Admin Settings > Sales Activities, with
the differences listed in [product-extensions.md](../threadwise-port/parity/product-extensions.md) (item 27).

## Model

One registry per workspace, the same for every niche. Labels are not in the data: a default activity, task type or outcome has `name: null` and the web shows its own localised word
for the `key` (the Meeting activity follows the workspace vocabulary); a custom one carries the name the workspace typed.

- `activity_types`: `key` (`task`, `meeting`, `phone`, `email`, `reminder`, `sms`, `chat`, or `custom_<slug>`), `behavesAs` (`task` \| `meeting` \| `phone` \| `other`), `icon`, `position`, and the
  switches `showInCalendar`, `allowComplete`, `allowEditCompleted`, `mobileCheckIn`, `outcomesEnabled`.
- `activity_type_options`: the ordered `taskTypes` (kind `type`) and `outcomes` (kind `outcome`) of an activity. `key` is stable. Removing one sets `deleted_at`; it stays readable on every record
  that holds it (`removed: true` in the reference a record carries). Adding the same name again revives it. `countsAs` (phone outcomes only) is the built-in call outcome a custom outcome counts as.
- The defaults are seeded for every workspace by the trigger `trg_organizations_seed_activity_types`, for existing workspaces by the migration, and again, idempotently, the first time a workspace
  without them reads the list (`seed_activity_types(org)` never touches a row an admin changed).

Which switches and lists an activity offers follows its behaviour (`activityCapabilities` in the contracts): task: the calendar, complete and edit-completed-time switches and the task types (its outcomes are the Task outcomes list); meeting: all, plus mobile check-in, no task
types; phone: outcomes only; other: nothing. Turning on a switch the behaviour does not offer is `422 ACTIVITY_FEATURE_OFF`.

## Routes (`/v2/activity-types`)

| Method and path                 | Key                         | What                                                                                                                                                                                                                            |
| ------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /`                         | read (see below)            | `{ data: ActivityType[] }` in list order, each with `taskTypes` and `outcomes`                                                                                                                                                  |
| `POST /`                        | `crm.activity_types.manage` | create a custom activity `{ name, icon, behavesAs: task\|meeting\|phone }` (Idempotency-Key). 409 `ACTIVITY_NAME_TAKEN`; 422 `ACTIVITY_LIMIT_REACHED` (20)                                                                      |
| `PATCH /:id`                    | manage                      | `{ name?, icon?, showInCalendar?, allowComplete?, allowEditCompleted?, mobileCheckIn?, outcomesEnabled?, rowVersion }`. 409 `ROW_VERSION_CONFLICT` when stale. A default keeps its name and icon: 409 `ACTIVITY_DEFAULT_LOCKED` |
| `DELETE /:id`                   | manage                      | 204. Custom activities only (archived); 409 `ACTIVITY_DEFAULT_LOCKED` for a default                                                                                                                                             |
| `POST /:id/options`             | manage                      | `{ kind: type\|outcome, name, countsAs? }` at the end of the list; returns the activity. 409 `ACTIVITY_NAME_TAKEN`; revives a removed item of that name; 422 `ACTIVITY_LIMIT_REACHED` (50)                                      |
| `PUT /:id/options/order`        | manage                      | `{ kind, ids }`: every current id once, in the new order; 422 otherwise                                                                                                                                                         |
| `DELETE /:id/options/:optionId` | manage                      | soft delete; returns the activity                                                                                                                                                                                               |

`GET /` accepts any of `crm.activity_types.read`, `record.tasks.read`, `record.contacts.read`, `call.logs.read`, `call.logs.create` (the pickers on tasks, meetings and calls read the same lists).
Owner, Admin and Workspace admin hold both settings keys; Manager holds read. Every change is audited under module `activity_types` (field-level deltas, never a name's text beyond the
item names the admin typed).

## Where the lists are used

- **Tasks** (`/v2/tasks`): `taskTypeId` on create and edit; `doneAt` on `PATCH` of a done task. The response carries a `taskType` reference (`{ id, key, name, isSystem, activityKey, removed }`).
  The OUTCOME of a task is not a row of this registry: it is the workspace's task outcomes (`/v2/task-outcomes`, `tasks.outcome_id`, built in parallel and merged first). The Task activity's drawer
  edits that list inline (add, rename, drag to reorder, remove) through those routes and their permission `settings.task_outcomes.manage`; the standalone Settings > Task outcomes tile is retired and
  `/tasks/outcomes` redirects to Sales Activities. Remove keeps the tasks' outcomes: an outcome that tasks carry is hidden (`isActive: false`), an unused one is deleted, and adding a hidden name again
  shows it again. `POST /v2/activity-types/:id/options` with `kind: outcome` on the default Task activity stays 422 `ACTIVITY_FEATURE_OFF` (use `/v2/task-outcomes`). The Task activity's
  `outcomesEnabled` ("Predict outcomes for this activity") starts ON for every workspace (migration `20270211090000`) and, when turned off, hides the outcome pickers on tasks (form, panel, complete-with-outcome,
  the list filter); the routes themselves stay open, so the Waboo loaders and reports are unaffected. New
  workspaces get the five default task outcomes (Interested, Left message, No response, Not interested, Not able to reach) from the organization trigger; existing workspaces are not touched. Rules: completing needs `allowComplete` on Task
  (409 `ACTIVITY_COMPLETION_DISABLED`; bulk complete lists it per task; work the system finishes itself, such as a follow-up that was contacted, is not a user completing); editing `doneAt` needs
  `allowEditCompleted` (409 `ACTIVITY_EDIT_COMPLETED_DISABLED`) and may not be in the future; a task type or outcome that was removed, belongs to another kind of activity, or is of the wrong kind is
  422 `ACTIVITY_OPTION_INVALID`. Follow-up tasks made by lead handling are given the `Follow up` task type; the
  migration typed the existing ones. The task `kind` column is unchanged.
- **Meetings** (`/v2/contacts/:contactId/meeting-results`): `GET` lists the outcomes of the contact's completed meetings; `PUT /:meetingId` `{ outcomeId?, note?, completedAt? }` completes a meeting or edits
  the result (absent keeps, `null` clears; `completedAt` needs `allowEditCompleted` on Meeting); `DELETE /:meetingId` reopens it. Needs `record.contacts.read` / `update` with the contact's record scope. A meeting
  that mirrors a booking can be completed too (the booking is untouched). Table `contact_meeting_outcomes`; the meetings routes and table are unchanged.
- **Calls** (`POST /v2/calls/log`, `PATCH /v2/calls/log/:id`): `outcomeOptionId` names an outcome of the Phone activity; `outcome` becomes optional when it is given and is then what that item counts as (the
  built-in seven count as themselves). The entry carries `outcomeOption`. The call log keeps writing the built-in `outcome`, so analytics, stage nudges and the timeline text are unchanged. A bare `outcome` still
  works and clears the item.

## Not effective yet

- `mobileCheckIn` is stored and shown. The mobile app and its API have no meeting check-in and check-out (the appointments module has check-in for bookings, which is a different thing), so the switch changes
  nothing until they exist (BL-378).
- `showInCalendar` is stored. There is no activities calendar, only the appointments calendar (BL-379).
- A custom activity is configurable but cannot be created from a "+" menu yet (BL-379).
- The unified Call logs list still shows the built-in outcome of a call; the call's own record has the chosen item.

## Privacy

`activity_types` and `activity_type_options` hold workspace configuration (no contact, no personal data). `contact_meeting_outcomes` is registered in the personal-data registry (`contacts.notes_files`, cascade with the
contact; the note is declared personal data). The audit trail records that a meeting note was written, not what it says.
