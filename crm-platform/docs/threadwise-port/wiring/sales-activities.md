# Wiring map: sales activities (BL-370 to BL-379)

Scope: the workspace registry of activity types with their task types and outcomes, and every place that reads it. A product extension: Reference has no equivalent (its `Task` model has no
type, its call logs have no outcome list). API: [docs/api/sales-activities.md](../../api/sales-activities.md). Differences from Freshsales: [product-extensions.md](../parity/product-extensions.md) item 27.

## Route, permission, plan

| Id           | What            | Where                                                                                                                                                                                                           |
| ------------ | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WIRE-ACT-001 | Web route       | `/sales-activities` in `apps/web/src/app/(app)/(sales-activities)`. Reached ONLY from the Settings tile `sales-activities` (Data section); no menu entry                                                        |
| WIRE-ACT-002 | API routes      | `apps/api/src/modules/crm/activity-types/activity-types.controller.ts` (`/v2/activity-types/*` and `/v2/contacts/:contactId/meeting-results/*`), registered in `crm.module.ts`                                  |
| WIRE-ACT-003 | Permission keys | `crm.activity_types.read` (Admin, Workspace admin, Manager), `crm.activity_types.manage` (Admin, Workspace admin); migration `20270201090100`. The list route also accepts the task, contact and call read keys |
| WIRE-ACT-004 | Plan gate       | none (task types and outcomes are part of the basic CRM)                                                                                                                                                        |

## Tables

`activity_types`, `activity_type_options` (workspace configuration), `contact_meeting_outcomes` (outcome and note of a completed meeting), `tasks.task_type_id` / `tasks.outcome_id`,
`call_log_entries.outcome_option_id`. Migration `20270201090000_sales_activities.sql`: forced RLS on all three new tables, composite foreign keys, the seed function
`seed_activity_types(org)` and the trigger `trg_organizations_seed_activity_types`, the backfill (defaults for every workspace; existing follow-up tasks get the `Follow up` type). Personal-data
registry: `contact_meeting_outcomes` declared in `privacy/manifests/contacts.ts` (cascade with the contact, `note` is personal data); the two configuration tables hold no personal data.

## Consumers

| Id           | Consumer                                           | Where                                                                                                                                                                                                                                                                                        |
| ------------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WIRE-ACT-005 | Task create, edit, complete, reopen (single, bulk) | `crm/tasks/tasks.service.ts` (`resolveOption`, `assertCompletable`, `doneAt`/`outcomeId` edit), `tasks.repository.ts` (joins, insert, setDone)                                                                                                                                               |
| WIRE-ACT-006 | Follow-up tasks (lead handling)                    | `TasksService.setFollowUpIn` types the task `Follow up`; internal completion (`completeFollowUpIn`) is not a user completing and ignores `allowComplete`                                                                                                                                     |
| WIRE-ACT-007 | Task screens                                       | `features/tasks`: `task-form-modal` and `task-drawer` (`OptionSelect`), `parts.tsx` `CompleteCheck` (disabled when completing is off), `lib/task-form.ts`, `lib/errors.ts` (`completionDisabled`)                                                                                            |
| WIRE-ACT-008 | Meetings                                           | `crm/activity-types/meeting-results.service.ts`; web `MeetingOutcome` rendered by one line in `contacts-attributes-tags/components/contact/meetings-section.tsx`. Meeting routes, table and mirror are untouched                                                                             |
| WIRE-ACT-009 | Call logging                                       | `calling-voice/logging/call-log-entries.service.ts` (`pickOutcome`), `.repository.ts`; web `calling-voice/components/log-call-dialog.tsx` and `contacts-attributes-tags/.../timeline/log-call-form.tsx` (the inline form keeps its five outcomes: `declined` and `failed` stay hidden there) |
| WIRE-ACT-010 | Workspace provisioning                             | trigger on `organizations` (every creation path, including `provisionOrganization`)                                                                                                                                                                                                          |
| WIRE-ACT-011 | Persona vocabulary                                 | `useActivityLabels` takes the Meeting activity's name from `noun('meeting')`; meeting toasts go through `localize`                                                                                                                                                                           |
| WIRE-ACT-012 | Settings registry                                  | `features/sales-activities/settings.ts` (tile `sales-activities`, section `data`, gate `crm.activity_types.read`, shortcut from `/tasks`)                                                                                                                                                    |

## Not wired (recorded, not dropped)

- Mobile meeting check-in and check-out (BL-378): the switch is stored; nothing reads it.
- Show in calendar (BL-379): stored; no activities calendar exists (the appointments calendar shows bookings only).
- Custom activities have no "+" menu entry and no records of their own (BL-379). Their outcomes are configurable.
- The unified Call logs list (`calling-voice/call-logs.repository.ts`) reads the built-in `outcome` only.
- Outbox events for settings changes: none (no consumer); task completion events carry the task type and outcome keys.
