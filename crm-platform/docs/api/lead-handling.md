# API: lead handling (uncontacted leads, follow-ups, duplicate leads)

Spec: [specs/lead-followup-settings.md](../specs/lead-followup-settings.md). Types are in `@crm/contracts` (`lead-handling/settings`, `lead-handling/touch`). Session auth, ids are
uuids. A product extension (not in the Reference platform). Nothing here changes data until a workspace switches a setting on, or a person marks a contact by hand.

Keys: `admin.settings.manage` (read and write the settings; Owner and Admin), `record.contacts.update` (touch, mark and bulk-mark; the contact's own record scope applies).
No new permission key and no plan gate.

## Settings

Base `/v2/lead-handling`. One row per (workspace, section) in `lead_followup_settings`; a section never saved reads as its defaults with `rowVersion: null`.

| Method and path             | Key                     | What                                                                                              |
| --------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------- |
| `GET /settings`             | `admin.settings.manage` | `{ uncontacted: { clearOn, markNew, onReassign, rowVersion, updatedAt } }` (more sections follow) |
| `PUT /settings/uncontacted` | `admin.settings.manage` | the whole section + `rowVersion` (omit on the first save); 409 `ROW_VERSION_CONFLICT` when stale  |

`uncontacted`: `clearOn: { contactButton, message, automation, activity }` (all default `true`), `markNew: { manual, import, leadSource }` (all default `false`), `onReassign`:
`keep` (default) or `mark`. Each save writes an audit row (module `lead_followup_settings`, the changed leaves) and the outbox event `lead_handling.settings_changed { section, changed }`.

## The uncontacted marker

`contacts.uncontacted_since` (`uncontactedSince` on a contact): null = contacted, a timestamp = uncontacted since then. It never moves `rowVersion` (an open edit form is not
409ed by a colleague's reply).

| Method and path                         | Key                      | What                                                                                                             |
| --------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `POST /contacts/:id/touch`              | `record.contacts.update` | `{ channel: 'call' \| 'sms' \| 'email' \| 'whatsapp' }` -> `{ uncontacted }`: the contact button was pressed     |
| `PUT /contacts/:id/uncontacted`         | `record.contacts.update` | `{ uncontacted: boolean }` -> `{ uncontacted }`; the state it is already in is a no-op (no audit row, no event)  |
| `POST /contacts/bulk/uncontacted`       | `record.contacts.update` | a selection (`ids` or `filter` + `excludeIds`) + `uncontacted`; the bulk result (`matched`, `changed`, `failed`) |
| `GET /contacts?uncontacted=true\|false` | `record.contacts.read`   | the list filter; also on every bulk selection filter and as the segment field `uncontacted`                      |
| `GET /contacts/stats`                   | `record.contacts.read`   | gains `uncontacted` (the count; the web offers the "Uncontacted" view only while it is above zero)               |

Not-found, never forbidden, for a contact outside the caller's record scope or in another workspace.

What changes the marker, with the workspace's settings:

| Action                                                                                                                                      | Effect                                   | Setting                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------- |
| The contact button was pressed (`POST /contacts/:id/touch`); an outbound call a person placed, or an answered inbound call, is logged       | clears                                   | `clearOn.contactButton`                      |
| A person's message, template, saved reply or file the provider accepted (inbox, e-mail, SMS)                                                | clears                                   | `clearOn.message`                            |
| A campaign, broadcast or flow send reached the contact (not first-reply, FAQ or consent bots)                                               | clears                                   | `clearOn.automation`                         |
| A person added a timeline activity, a note or a meeting (a key or system actor does not count)                                              | clears                                   | `clearOn.activity`                           |
| A contact is created by a person / an import or the Sheets add-on / a lead source, a form, an API key or a channel partner                  | marks (a matched existing contact never) | `markNew.manual` / `.import` / `.leadSource` |
| The owner changes (edit, bulk, `POST /contacts/assignee`, a leave batch, auto-assign); a restore after leave does not; unassigning does not | marks                                    | `onReassign = mark`                          |

The hooks run in the caller's transaction, in a savepoint, and never fail the action they belong to (a failure is logged). Audit (module `contacts`): `uncontactedSince` old and new plus
`cause` for a single clear or a manual mark (not for a creation or reassign mark: the creation or the owner change is the record). Outbox: `contact.uncontacted_changed { uuid, uncontacted,
cause }` (cause: `manual`, `contact_button`, `message`, `automation`, `activity`); it is NOT `contact.updated`, so no customer flow starts because a flag moved.

## Automatic follow-ups (BL-291)

A contact's **next follow-up** is its one open task of kind `follow_up` (`tasks.kind`, at most one open per contact: unique index `uq_tasks_open_follow_up`). A follow-up without a date is
"someday": an open task with a null `due_at`, never reminded. The task list, due reminders (`task.due`), notifications, audit and scopes are the tasks module's own; the generic task
API cannot create a follow-up (`kind` is always `task` there). Tasks the rules create have `source = auto`; the title is `Follow up`; `TaskResponse.kind` is `task` or `follow_up`.

| Method and path                       | Key                      | What                                                                                                                             |
| ------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `PUT /settings/follow-ups`            | `admin.settings.manage`  | the whole section + `rowVersion` (omit on the first save); 409 when stale; 422 for an invalid document                           |
| `PUT /contacts/:id/follow-up`         | `record.contacts.update` | `{ dueAt: ISO datetime or null }` (null = someday) -> `{ nextFollowUp }`; a NEW follow-up also needs `record.tasks.create` (403) |
| `POST /contacts/:id/follow-up/snooze` | `record.contacts.update` | `{ preset: 'day', 'three_days' or 'week' }` -> that day at the workspace's default alert time; 404 without a follow-up           |
| `POST /contacts/:id/follow-up/done`   | `record.contacts.update` | completes it -> `{ nextFollowUp: null }`                                                                                         |
| `DELETE /contacts/:id/follow-up`      | `record.contacts.update` | removes it -> `{ nextFollowUp: null }`                                                                                           |
| `GET /contacts`, `GET /contacts/:id`  | `record.contacts.read`   | `nextFollowUp: { id, dueAt or null, assigneeId }` or null; list filter `followUp=overdue,today,upcoming,someday or none`         |
| `GET /contacts/stats`                 | `record.contacts.read`   | gains `withFollowUp` (the web offers the follow-up views only while it is above zero)                                            |

`follow_ups` section: `updateWhen: { none, overdue, today, future }` (all default `false`), `defaultDate`: `{ kind: 'days', days: 1..365 }` (default 3), `{ kind: 'month' }`, `{ kind: 'someday' }` or
`{ kind: 'none' }`, `defaultTime`: `HH:mm` (default `09:00`). The day and the time are read on the workspace's time zone (`organizations.settings.timezone`), the same zone as the task buckets.

Rules. A contact action that counts as reaching out (the same touches as the uncontacted marker, whatever that section's toggles say) looks at the contact's follow-up: no follow-up or a someday one is
`none`, a dated one is overdue (before now), today (the rest of the workspace's day) or upcoming. If the section's toggle for that state is on, the follow-up is set to the default date at the default time
(created for the contact's owner, else for the person who got in touch; an existing one keeps its person and re-arms its reminder), made "someday" (`defaultDate: someday`), or completed
(`defaultDate: none`). The computed instant is a calendar day plus a time, so a redelivered touch writes the same value and changes nothing. Audit and events are the tasks module's:
`task.created`, `task.updated`, `task.completed`, `task.deleted`, `task.assigned`.
