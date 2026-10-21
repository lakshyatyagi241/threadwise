# Wiring map: Teams v2 (BL-381, phase T1 of the teams unification)

Read with [specs/teams-unification.md](../../specs/teams-unification.md) (sections 2.1, 2.3, 5.1, 5.5, 6 T1, 7), the inventory entry
[workspaces-teams-tenancy](../inventory/workspaces-teams-tenancy.md) (TW-WSP-022) and the API doc
[api/workspaces-teams-tenancy.md](../../api/workspaces-teams-tenancy.md). Teams are not a Reference-only feature any more: this file lists
**every place a team or a team membership is read or written**, because T1 changes what a membership row means. `built` = in this repo and
tested; `reads` = unchanged code that now gets the new behaviour through the database; `not yet` = stored, deliberately not read.

## Data

| What                                                                                           | Where                                                                                                       | State                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `teams.parent_team_id`                                                                         | migration `20270210090000_teams_v2_schema`, FK `(org_id, parent_team_id)`, trigger `trg_teams_guard_parent` | built: same workspace by the composite FK, no cycle by the trigger, depth (5) by `TeamsService.resolveParent`                                                       |
| `teams.lead_user_id`                                                                           | same, FK `(org_id, lead_user_id)` to `users`                                                                | built: the manager; always a `lead` member; shown only while the person is active                                                                                   |
| `teams.receives_conversations`, `receives_records`                                             | same, default true                                                                                          | built and enforced (see "Where the switches apply")                                                                                                                 |
| `teams.is_scope_boundary`                                                                      | same, default true                                                                                          | not yet: stored; T2 (`team_and_below`) does not read it either, see [teams-t2.md](teams-t2.md)                                                                      |
| `team_members.role` (`member` or `lead`)                                                       | same; replaces `is_lead` (backfilled, column dropped)                                                       | built                                                                                                                                                               |
| `team_members.is_primary`                                                                      | same; partial unique index `uq_team_members_one_primary (org_id, user_id) WHERE is_primary`                 | built: backfilled for people on exactly one team; kept true by `TeamsRepository.settlePrimary`; reports do not read it yet                                          |
| `team_members` tenant policy                                                                   | same: rows of a user whose status is `inactive` are hidden from tenant sessions                             | built: the D10 mechanism, see below                                                                                                                                 |
| `teams.business_hours`, `timezone`, `default_assignee_id`, `assignment_strategy`, `device_ids` | untouched, returned as `unusedSettings` / `assignmentStrategy` / `deviceIds`                                | not yet (decision D7, phase T4); shown on the Teams screen as "Stored, not used yet"; `device_ids` is also still written by the API and tests, so it is not dropped |
| Drizzle mirror                                                                                 | `packages/db/src/schema/foundation.ts` (`teams`, `teamMembers`)                                             | built                                                                                                                                                               |

## Permissions

| Key                 | Registered in                                                                          | Presets                                                           | Used by                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `team.read`         | `20270210090100_teams_v2_permissions` (`permission_defs`, `workspace_preset_baseline`) | Owner, Admin, Manager, Agent; custom roles that grant anything    | `GET /workspace/teams`, `GET /workspace/teams/:id`; the Teams settings tile (`settings.ts`) and screen |
| `team.manage`       | same                                                                                   | Owner, Admin, Manager; custom roles that held `inbox.team.manage` | every team write, member endpoints; `me.canManageTeams` of the members summary                         |
| `inbox.team.manage` | `20261013100000_rbac_workspace_presets`                                                | unchanged (Owner, Admin)                                          | **deprecated alias for one release**: accepted wherever `team.manage` is, and opens the list too       |

## API

| Route                                                                       | Permission                                                    | Code                                                                                                                                |
| --------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `GET /workspace/teams`, `GET /workspace/teams/:id`                          | `team.read` / `team.manage` / alias                           | `workspaces-teams-tenancy/teams.controller.ts`, `teams.service.ts`, `teams.repository.ts`                                           |
| `POST /workspace/teams`, `PATCH`, `DELETE /:id`                             | `team.manage` / alias                                         | same; errors `WSP_TEAM_PARENT_CYCLE`, `WSP_TEAM_PARENT_INVALID`, `WSP_TEAM_MEMBER_NOT_ON_TEAM`                                      |
| `POST /workspace/teams/:id/members`, `PATCH`, `DELETE /:id/members/:userId` | `team.manage` / alias                                         | same                                                                                                                                |
| `GET /users`, `/users/:id` (`teams`, `managers`, `?teamId=`)                | `admin.user.manage`                                           | `admin/users/users.repository.ts` (`teamsForUsers`), `users.mapper.ts` (`managersOf`)                                               |
| `GET`, `POST /workspace/members/:id/handover`                               | `admin.user.manage` (+ record and inbox rights of the caller) | `workspaces-teams-tenancy/member-handover.*`; calls `OwnerReassignService.create` (crm barrel) and `AssignmentService.handOverOpen` |

## Deactivation (gap 4, D10)

| Step                                  | Where                                                                                                                                     |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Ask what happens to the person's work | web `DeactivateDialog` (`workspaces-teams-tenancy/components/deactivate-dialog.tsx`): preview, then the hand-over, then the status change |
| Move contacts and open deals          | the existing owner-reassign batch (`owner_reassign_batches`, undo 14 days, `OwnerReassignService`)                                        |
| Move open conversations               | `AssignmentService.handOverOpen` (the only writer of the assignee columns; one transaction per conversation)                              |
| Keep the membership                   | `MembersRepository.deactivate` no longer deletes `team_members`; `PATCH /users/:id` never did                                             |
| An inactive person grants nothing     | the `team_members` policy hides their rows; **every** reader below inherits it with no code change                                        |
| Reactivation restores the teams       | `users.status` back to `active` makes the rows visible again                                                                              |

### Readers of `team_members` that now ignore inactive people (reads, unchanged code)

Scope `team` peer joins (contacts and companies, deals, tasks, invoices, credit notes, payments, recurring invoices, sales orders and
documents, appointments, call logs, forms and submissions, segments, contact meetings, CRM dashboard, revenue report), the inbox
visibility (`team-inbox-conversations`, `realtime/audience/member-directory.service.ts`, `room-access.service.ts`), routing and record
assignment pools (`routing-rules.repository.ts`, `contact-assignment.repository.ts`, `owner-reassign.repository.ts`), the leave module, SLA
and conversation notification rules, the flow builder's team list, the campaign wizard and `members.repository.ts`. Proved by the e2e test
"team scope: a teammate who is deactivated stops granting visibility of their contacts" and the integration test of the policy.

## Where the switches apply

| Switch                  | Enforced in                                                                                                                                                                                                                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `receivesConversations` | inbox assign-to list (`assignees.service.ts`), manual assignment (`AssignmentService.resolveTarget`), routing rule save (`routing-rules.service.ts`) and engine (`routing-engine.service.ts` via `repo.teams(..., { receivingOnly })`), flow builder team list (`builder-context.service.ts`) |
| `receivesRecords`       | assignment rule save and engine (`contact-assignment.service.ts`, `.engine.ts` via `teamIdsByUuid`), reassign to a team (`owner-reassign.repository.ts teamMemberIds`), web pickers (`record-assignment` subject panel, leave dialog reassign)                                                |

## Web

| Screen / piece                                                                             | Where                                                                                                                                                           |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Teams (`/teams`), tile gated by `team.read`                                                | `workspaces-teams-tenancy/components/teams-screen.tsx`, `team-dialog.tsx` (modal and the delete confirmation), `team-editor-form.tsx` (the form), `settings.ts` |
| Team members (`/settings/team`): Teams, Manager, team filter, deactivate prompt, More menu | `roles-permissions/workspace/members-page.tsx`, `workspaces-teams-tenancy/components/member-account.tsx`                                                        |
| `/team-members`                                                                            | redirects to `/settings/team`, keeping the query (`?member=&reassign=1` of the leave notice opens that person's leave dialog)                                   |
| Roles matrix label for the `team` scope                                                    | `messages/<locale>/roles-permissions-workspace.json` `matrix.scope.team`: "My team's records"                                                                   |
| Help                                                                                       | `help/teams.md`, `help/teams-access.md`, `help/team-members.md`, `roles-permissions/help/settings-team.md`, `roles.md`                                          |
| Vocabulary layer                                                                           | surface `teams` in `persona-vocabulary/lib/bindings.ts` (docs/api/persona-vocabulary.md)                                                                        |

## Not in T1 (and where it goes)

`team_and_below`, the unassigned-conversation permission and `owning_team_id` (T2, built: [teams-t2.md](teams-t2.md)); product-line metadata, the `teams` limit,
`team_hierarchy` and `custom_roles` plan features (T3); team business hours, time zone, default assignee and strategy as real settings, and
the single assignment engine (T4); territory, team queues, seat types (T5). The delete-preview with usage and a `team.deleted` consumer is
T0 (BL-380) and lives in the delete confirmation of `team-dialog.tsx`.
