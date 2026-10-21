# API: workspace members and teams

Domain `wsp` (TW-WSP-015 .. 022, 046, 047), PR 1: **Members** and **Teams**. Base path `/v2`. Errors are `application/problem+json`
with a stable `code` (`WSP_*` in `@crm/contracts` `workspace-teams-tenancy/errors.ts`, plus the common ones) and a `requestId`.
Request and response shapes live in `packages/contracts/src/workspaces-teams-tenancy/` (`members.ts`, `teams.ts`). Live docs: `/docs`.

Conventions: **User** = staff bearer token. **Public** = no token. Every id on the wire is a uuid. Lists are cursor paginated
(`{ data, page: { nextCursor, hasMore, limit } }`). Mutations that create something accept an optional `Idempotency-Key`.

## The role model

A "workspace" is an organization. There is one role model, the RBAC domain's (`docs/threadwise-port/parity/roles-permissions.md`, decisions
D-RBAC-05 and D-RBAC-06): five preset roles per organization created by `provision_workspace_presets(org_id)`, plus any custom role the
organization makes. Reference's five roles are shown as a **tier** read from a role's preset `system_key`. Permissions are the usual
capability keys, all RBAC's: `org.member.invite` (invite, resend, remove, reset password), `org.member.role_assign` (change a role),
`team.read` (see the Teams screen) and `team.manage` (teams writes). `inbox.team.manage`, the key that gated teams writes before Teams v2,
is a deprecated **alias for one release**: any route that needs `team.manage` also accepts it.

| Tier      | Rank | Role (preset `system_key`)                                                                                  |
| --------- | ---- | ----------------------------------------------------------------------------------------------------------- |
| `owner`   | 100  | **Owner** (`admin`, locked, every key). The key kept its old name; the role is displayed "Owner"            |
| `admin`   | 80   | **Admin** (`workspace_admin`): every key except the owner-only ones (billing, `org.delete`, owner settings) |
| `manager` | 60   | **Manager** (`manager`)                                                                                     |
| `agent`   | 40   | **Agent** (`agent`)                                                                                         |
| `viewer`  | 20   | **Viewer** (`viewer`): reads the conversations of its own teams                                             |
| `custom`  | 0    | a role the organization made itself (no `system_key`): below every preset, as in RBAC's ladder              |

A member's tier is the highest of their roles; `isOwner` is true when they hold the Owner preset (more than one Owner is possible; the
organization always keeps at least one, in the service and in the database). `organizations.settings.ownerUserId` is not read here: it
stays the account page's primary-owner marker only.

Rules. Handing out a role, changing a role, acting on someone above you, owner-only grants and the last Owner are **RBAC's**
(`WorkspaceRoleRulesService.assertCanChangeRoles`, imported through the `roles-permissions` barrel), so this screen and Settings > Users
cannot disagree. Their refusals use RBAC's codes: `403 RBAC_ROLE_GRANT_FORBIDDEN`, `422 RBAC_SELF_ROLE_CHANGE`, `422 RBAC_LAST_OWNER`.
Only an Owner hands out the Owner or Admin role; an Admin hands out Manager, Agent, Viewer and custom roles it fully holds; handing out a
role needs `org.member.role_assign` as well, so an invite needs both keys. What this domain adds, for the member lifecycle:

1. **Act on** (remove, reset password, resend): nobody acts on a member who outranks them (equal rank is allowed). Refusal:
   `403 WSP_CANNOT_ACT_ON_HIGHER_RANK`.
2. Nobody removes themselves (`422 WSP_CANNOT_REMOVE_SELF`) or an Owner (`422 WSP_CANNOT_REMOVE_OWNER`); only an Owner resets an
   Owner's password.

Every member action writes an audit row (module `members`, action `member.invited | member.invite_resent | member.role_changed |
member.removed | member.password_reset | member.joined`) and an outbox event of the same name; teams write `team.created |
team.updated | team.deleted` (module `teams`). Rows and events are written in the same transaction as the change.

## Members

### `GET /workspace/members` (User, no permission key)

Everyone in the workspace except removed members. Sorted **tier (owner first), then name**; `order` is ignored.
Query: `limit` (1..200, default 50), `cursor`, `q` (name or email contains, case-insensitive), `tier` (`owner|admin|manager|agent|viewer|custom`).

```json
{
  "data": [
    {
      "id": "b04848dd-eb96-4950-9c75-4eb0e8402c49",
      "fullName": "Demo Admin",
      "email": "owner@acme.test",
      "avatarUrl": null,
      "tier": "owner",
      "roles": [{ "id": "3ee1863a-888c-4eb1-9c06-11ce2f61a401", "name": "Admin", "tier": "admin" }],
      "isOwner": true,
      "status": "active",
      "presence": "offline",
      "lastSeenAt": null,
      "invitedAt": null,
      "joinedAt": null,
      "teamIds": ["0c78f94d-ce05-4156-b362-0120f15a74d2"],
      "rowVersion": 2
    }
  ],
  "page": { "nextCursor": null, "hasMore": false, "limit": 50 }
}
```

`status` is `pending` while the member was invited and has not accepted (`joinedAt` null), else `active`. `presence` is what the inbox
last stored in `agent_statuses` (`online|away|busy|offline`), `offline` if nothing. `avatarUrl` is always null for now.

### `GET /workspace/members/summary` (User, no permission key)

The header numbers and what the caller may do.

```json
{
  "counts": {
    "all": 3,
    "owner": 1,
    "admin": 0,
    "manager": 1,
    "agent": 0,
    "viewer": 0,
    "custom": 1,
    "pending": 1
  },
  "roles": [
    { "id": "…", "name": "Admin", "tier": "admin", "grantable": true },
    { "id": "…", "name": "Manager", "tier": "manager", "grantable": true },
    { "id": "…", "name": "Viewer", "tier": "viewer", "grantable": true }
  ],
  "seats": { "used": 3, "limit": 5 },
  "me": {
    "id": "b04848dd-…",
    "tier": "owner",
    "canInvite": true,
    "canAssignRoles": true,
    "canManageTeams": true
  }
}
```

`roles` is every role of the organization, highest tier first; `grantable` is RBAC's `grantableRoleIds` for the caller (empty without `org.member.role_assign`). `me.canInvite`, `me.canAssignRoles` and
`me.canManageTeams` are the caller's `org.member.invite`, `org.member.role_assign` and `team.manage` (or the alias `inbox.team.manage`). `seats.used` counts every
member who is not removed, pending invitations included; `limit` is the plan's `users` cap (`null` = unlimited).

### `POST /workspace/members/invite` (User, `org.member.invite`, idempotent) → 201

```json
// request
{ "fullName": "Riya Sharma", "email": "riya@acme.test", "roleId": "5afcfeda-11ce-4e2f-bb97-5de36d09834e" }
// 201
{ "member": { "id": "55c7a0c4-…", "email": "riya@acme.test", "tier": "manager", "status": "pending", "joinedAt": null, "…": "…" },
  "emailSent": true, "inviteLink": null }
```

Order of checks (Reference's): the **seat limit** first (`422 PLAN_LIMIT_REACHED`, even for an invalid payload), then the payload
(`422 VALIDATION_FAILED`, unknown `roleId` is a validation error on `roleId`), then who may grant the role
(`403 RBAC_ROLE_GRANT_FORBIDDEN`), then the address (`409 WSP_ALREADY_MEMBER` if it is an active or pending member).
A removed member's address is reactivated (the same user comes back as a fresh pending member, no old password, verified address
or second factor).

The new account has a random password nobody knows; only the invitation link can open it. The mail is sent after the transaction
commits (subject "<inviter> invited you to <workspace> on <app>"); the link is `${WEB_APP_URL}/accept-invite?token=…&org=<slug>`,
single use, **7 days**. When no mail transport is configured (or sending fails) `emailSent` is `false` and `inviteLink` carries the link
**once**; it is never retrievable later (only the token's hash is stored). No plaintext password exists anywhere.

### `POST /workspace/members/:id/resend-invite` (User, `org.member.invite`) → 200

Only for a pending member (`409 WSP_INVITE_NOT_PENDING` otherwise). Issues a fresh link (the old one stops working) and answers with
`{ member, emailSent, inviteLink }` as above.

### `PATCH /workspace/members/:id/role` (User, `org.member.role_assign`) → 200 `WspMember`

```json
{ "roleId": "…", "rowVersion": 2 }
```

Replaces the member's whole role set with that one role and bumps the roles version, so the member's grants change on their next
request. The rules are RBAC's `assertCanChangeRoles`: not yourself, the target must not outrank the caller, the caller may
grant the role, the organization keeps an Owner. Stale `rowVersion` is `409 ROW_VERSION_CONFLICT`; an unknown or foreign member is `404`.

### `DELETE /workspace/members/:id` (User, `org.member.invite`) → 204

Removal is soft: the user becomes `inactive`, loses all roles and team places, live tokens are cancelled and **every session is
revoked now** (an unexpired access token is refused on its next use). The account and everything that references it stay; the
`member.removed` outbox event lets other domains unassign conversations. Removed members are not listed; inviting the address again
reactivates them. Errors: `422 WSP_CANNOT_REMOVE_SELF`, `422 WSP_CANNOT_REMOVE_OWNER`, `403 WSP_CANNOT_ACT_ON_HIGHER_RANK`, `404`.

### `POST /workspace/members/:id/reset-password` (User, `org.member.invite`) → 200

Emails the member the auth domain's own set-password link (`/reset-password?token=…&org=<slug>`, 60 minutes, single use); the
password keeps working until the link is used. Nobody is shown a password. Answers `{ member, emailSent, inviteLink }` (the link comes
back once when the mail cannot be sent). Only an Owner may reset an Owner's password (`403 WSP_CANNOT_ACT_ON_HIGHER_RANK`); a target
who is not in this workspace is `404`. A member who never accepted gets a fresh invitation instead.

## Invitations (Public)

Both calls are rate limited per client address (20 per 10 minutes, then `429 RATE_LIMITED`). Every way a token can be wrong
(unknown workspace, unknown token, used, expired, member removed, workspace not active) answers the same
`400 WSP_INVITE_INVALID`, so nothing can be probed.

### `GET /workspace/invitations/preview?token=…&orgSlug=…`

```json
{
  "workspaceName": "Acme",
  "email": "riya@acme.test",
  "fullName": "Riya Sharma",
  "roleName": "Manager",
  "invitedBy": "Demo Admin"
}
```

Does not use the token up.

### `POST /workspace/invitations/accept` → 201

```json
{ "token": "…", "orgSlug": "acme", "password": "Str0ngPassw0rd#1" }
```

The password goes through the same policy as sign-up (`422 AUTH_PASSWORD_POLICY`, checked before the token is spent). On success the
token is consumed atomically, the password is set, `joined_at` and `email_verified_at` are stamped, `member.joined` is audited, and the
answer is the same body as `POST /auth/login` (`status: "authenticated"`, `tokens`, `landing`, `flags`), so the web signs the person in.
There is no second-factor step: a new account cannot have one.

## Teams

A team is a named group of people used for conversations (routing and assignment), for records (contact, company and deal assignment)
and for reports: **one entity for chat, CRM and workspaces that have both** (Teams v2, BL-381, T1 of
[specs/teams-unification.md](../specs/teams-unification.md)).

| Right         | Who holds it by default                     | What it opens                                                                                         |
| ------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `team.read`   | Owner, Admin, Manager, Agent                | the Teams list and one team; custom roles that grant anything were given it by the migration          |
| `team.manage` | Owner, Admin, Manager                       | create, edit, delete, members, roles, primary team; `inbox.team.manage` holders keep the same ability |
| neither       | Viewer, a custom role created after the key | `403` on every route below                                                                            |

Writes also accept `inbox.team.manage` (alias). A list or read needs `team.read`, `team.manage` or the alias.

```json
{
  "id": "0c78f94d-…",
  "name": "Sales West",
  "color": "#075E54",
  "description": null,
  "assignmentStrategy": "manual",
  "isDefault": false,
  "sort": 0,
  "deviceIds": [],
  "parentId": "5d1c…",
  "depth": 2,
  "lead": { "id": "97e03962-…", "fullName": "Demo Manager" },
  "receivesConversations": true,
  "receivesRecords": true,
  "isScopeBoundary": true,
  "members": [
    {
      "id": "97e03962-…",
      "fullName": "Demo Manager",
      "presence": "offline",
      "isLead": true,
      "role": "lead",
      "isPrimary": true,
      "capacity": 20
    }
  ],
  "memberCount": 1,
  "usage": {
    "routingRules": 1,
    "assignmentRules": 0,
    "segmentShares": 0,
    "childTeams": 0,
    "conversations": 3
  },
  "unusedSettings": { "businessHours": null, "timezone": null, "defaultAssignee": null },
  "rowVersion": 1,
  "createdAt": "2026-10-02T13:25:20.195Z"
}
```

- `parentId` / `depth`: the optional parent team and the level in the tree (1 = top). At most **5 levels** (`WSP_TEAM_MAX_DEPTH`).
- `lead`: the team's manager; `null` when none is set **or the manager is deactivated** (the choice is kept for their return).
- `members[].role` is `member` or `lead`; `isLead` stays for older clients. `isPrimary` is the person's main team: **at most one per
  person** (a partial unique index), a person on exactly one team always has it, and routing, assignment and visibility use every team.
- `receivesConversations` and `receivesRecords` (default true) decide where the team can be **chosen**: the inbox assign list, manual
  assignment and routing rules (conversations); contact assignment rules and reassign-to-a-team (records). A rule that already points at a
  team that does not receive is skipped by the engine. `isScopeBoundary` is stored for the `team_and_below` scope of phase T2 and not read yet.
- `usage`: where the team is used (routing rule actions and assignment rule pools by uuid, shared segments, sub-teams, conversations
  assigned to it).
- `unusedSettings`, `assignmentStrategy` and `deviceIds` are stored and **not read by anything yet** (decision D7, phase T4); the Teams
  screen lists them as "not used yet".

### `GET /workspace/teams` (User, `team.read`)

Query: `limit`, `cursor`, `order` (`asc` = creation order; default `desc`), `q` (name contains). → `PageResponse<WspTeam>`.
`GET /workspace/teams/:id` answers one team.

### `POST /workspace/teams` (User, `team.manage`, idempotent) → 201

```json
{
  "name": "Sales West",
  "color": "#ff0000",
  "description": "Inbound",
  "memberIds": ["97e03962-…"],
  "parentId": "5d1c…",
  "leadId": "97e03962-…",
  "receivesConversations": true,
  "receivesRecords": true
}
```

`name` 1..64 and unique per workspace (`409 WSP_TEAM_NAME_TAKEN`); `color` matches `^#?[0-9A-Za-z_-]{1,16}$` (default `#075E54`);
`assignmentStrategy` is `manual | round_robin | least_loaded | sticky` (default `manual`). `memberIds` and `leadId` must be **active
members of this workspace** (`422 WSP_TEAM_MEMBER_UNKNOWN`, nothing is created); members join with `role = member`, `capacity = 20`, and
the manager joins as a `lead`. `parentId` must be a team of this workspace and keep the tree within 5 levels
(`422 WSP_TEAM_PARENT_INVALID`). `deviceIds` are intersected with this workspace's devices and unknown ones are dropped silently; none
left (or none given) means **every device**.

### `PATCH /workspace/teams/:id` (User, `team.manage`) → 200 `WspTeam`

Every field optional, plus the required `rowVersion` (`409 ROW_VERSION_CONFLICT` when stale). `memberIds`, when present, replaces the
member list (an empty list removes everyone; members who stay keep their role, capacity and primary mark; somebody taken off the list
stops being the manager). `parentId: null` makes the team top-level, `leadId: null` removes the manager, and a new `leadId` demotes the
previous manager to `member` and makes the new one a `lead`. A parent that is the team itself or one of its descendants is
`422 WSP_TEAM_PARENT_CYCLE` (also enforced by the trigger `trg_teams_guard_parent`, which reports the constraint
`chk_teams_parent_cycle`); a move that would make the team plus its sub-tree deeper than 5 levels is `422 WSP_TEAM_PARENT_INVALID`.
`deviceIds: []` resets to every device. A team of another workspace is `404`.

### `POST /workspace/teams/:id/members` (User, `team.manage`) → 200 `WspTeam`

Body `{ "userId": "…", "role": "member" | "lead", "isPrimary"?: boolean }`. Adds the person, or changes their role and primary mark when
they are on the team. `isPrimary: true` clears the person's mark on every other team first.

### `PATCH /workspace/teams/:id/members/:userId` (User, `team.manage`) → 200 `WspTeam`

Body `{ "role"?: …, "isPrimary"?: … }` (one at least). Not on the team: `422 WSP_TEAM_MEMBER_NOT_ON_TEAM`. Making the manager a plain
`member` removes them as manager.

### `DELETE /workspace/teams/:id/members/:userId` (User, `team.manage`) → 200 `WspTeam`

Takes the person off the team. If it was the manager, the team has no manager; a person left on exactly one team gets it as primary.

### `DELETE /workspace/teams/:id` (User, `team.manage`) → 204

Removes the team and its member places; conversations assigned to it lose the team (the foreign key sets `assignee_team_id` null),
**its sub-teams move up to the deleted team's parent** (trigger `trg_teams_reparent_children`), and the `team.deleted` event lets routing
drop its references: the worker consumer `team-deleted-references` takes the team out of every routing rule's targets and every record assignment pool (BL-380, `docs/api/teams-scope.md`).

### `GET /workspace/teams/:id/usage` (User, `team.manage`) → 200 `WspTeamDeletePreview`

What the delete would change, as counts: `members`, `routingRules`, `assignmentRules`, `segmentShares`, `conversationsAssigned`,
`peopleWithReachChange`. Read-only; the delete confirmation shows it. A team of another workspace is `404`. Details in `docs/api/teams-scope.md`.

### Deactivating a person: membership is kept (D10)

Removing a member (`DELETE /workspace/members/:id`) and the Users status change to `inactive` **keep their `team_members` rows**. The
`tenant_isolation` policy of `team_members` shows tenant sessions only the rows whose user is not inactive, so every query that joins
`team_members` (the team record scope of contacts, companies, deals, tasks, invoices, appointments and forms, the inbox visibility,
routing and assignment pools, the leave and reassign pickers) ignores an inactive person on both sides of a peer join without any of
those queries changing. Setting the user `active` again brings the places back. The privileged role (migrations, platform jobs) sees every
row, which is how the history stays readable.

### `GET /workspace/members/:id/handover` (User, `admin.user.manage`) → `WspHandoverPreview`

What the person holds, for the deactivate dialog: `{ contacts, openDeals, openConversations, teamLeads: [{ id, fullName, teamName }] }`.
`teamLeads` are the active managers of the person's teams, the primary team first, then up the parent chain; never the person themself.

### `POST /workspace/members/:id/handover` (User, `admin.user.manage`, idempotent) → `WspHandoverResult`

Body `{ "mode": "person", "userId": "…" }`, `{ "mode": "team_lead" }` or `{ "mode": "leave" }`. Call it **before** deactivating. Contacts and
open deals move through the existing owner-reassign batch (`POST /owner-reassignments`: the caller's record scope, one audit row and
event per record, undo for 14 days); open, non-archived conversations of the person are reassigned through `AssignmentService` one by
one (the target must be able to open the inbox; one that cannot is skipped and counted). Needs `record.contacts.update` for records.
At most 50,000 records and 200 conversations per call; `remaining` says what is left. `leave` changes nothing. `team_lead` with no active
manager is `422 WSP_REASSIGN_INVALID`; a target who is not an active member is `422`.

### Members and users

`GET /users` (and `/users/:id`) now carry `teams` (`[{ id, name, color, role, isPrimary }]`, primary first, empty for an inactive person)
and `managers` (`[{ id, fullName }]`: the manager of the person's primary team, else of all their teams, never the person themself).
`GET /users?teamId=<uuid>` lists only the people on that team. `GET /workspace/members/summary` reports `me.canManageTeams` true for
`team.manage` or the alias.

## Operator Workspaces hub (TW-WSP-023, 025)

Operator-only (`/v2/platform/*`, `OperatorGuard` + `PlatformPermissionGuard`). Read cross-tenant through the platform door, never a
tenant transaction. Contract: `packages/contracts/src/workspaces-teams-tenancy/admin-hub.ts`.

| Method | Path                                    | Key                            | Notes                                          |
| ------ | --------------------------------------- | ------------------------------ | ---------------------------------------------- |
| GET    | `/v2/platform/workspaces`               | `platform.workspace.view_all`  | list, filters, keyset cursor, KPIs             |
| GET    | `/v2/platform/workspaces/:id`           | `platform.workspace.view_all`  | one workspace's dashboard                      |
| POST   | `/v2/platform/workspaces/:id/suspend`   | `platform.workspace.suspend`   | body `{ reason? }`; returns the refreshed row  |
| POST   | `/v2/platform/workspaces/:id/unsuspend` | `platform.workspace.unsuspend` | clears the `frozen` flag only; returns the row |

`view_all` is seeded for Super Admin, Admin, Platform Support and Auditor (`20261013090000_rbac_platform_roles.sql`). Suspend and lift
delegate to the platform inbox (frozen flag, status sync, `platform.inbox.*` audit); a remaining `fraud` or `tos_violation` flag keeps
the workspace suspended after a lift (`suspendedBy` shows it). Reads are not audited.

## Operator workspace lifecycle (inactivity: remind, archive, erase)

Not a Reference feature: added at the owner's request (ADR-0028). Operator-only, on its own path (`/v2/platform/workspace-lifecycle`, a sibling
of the hub because `/v2/platform/workspaces/:id` would swallow a literal segment). Contract: `packages/contracts/src/workspaces-teams-tenancy/lifecycle.ts`.

| Method | Path                                              | Key                             | Notes                                                                        |
| ------ | ------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------- |
| GET    | `/v2/platform/workspace-lifecycle`                | `platform.workspace.view_all`   | filters `status`, `minDaysInactive`, `exempt`; `order=asc` = most idle first |
| GET    | `/v2/platform/workspace-lifecycle/:id`            | `platform.workspace.view_all`   | effective timings, schedule, reminders sent, exemption, hold                 |
| GET    | `/v2/platform/workspace-lifecycle/:id/log`        | `platform.workspace.view_all`   | the compliance history (newest first)                                        |
| PATCH  | `/v2/platform/workspace-lifecycle/:id/policy`     | `platform.workspace.retention`  | `{ archiveAfterDays?, deleteAfterDays?, reason }`; `null` = platform default |
| POST   | `/v2/platform/workspace-lifecycle/:id/exemption`  | `platform.workspace.retention`  | `{ exempt, reason, until? }`: the never-delete switch                        |
| POST   | `/v2/platform/workspace-lifecycle/:id/restore`    | `platform.workspace.retention`  | archived only; restarts the inactivity clock                                 |
| POST   | `/v2/platform/workspace-lifecycle/:id/legal-hold` | `platform.workspace.legal_hold` | `{ legalHold, reason }`; Super Admin only                                    |

Defaults 90 / 180 days; overrides archive 60 to 3650, erase 120 to 7300, erase at least 60 days after archive. Every write needs a reason
and is recorded with the operator in `org_lifecycle_log`. A workspace on an active paid plan is never idle-archived (`exemptByPlan`).
A workspace its owner deleted (`status = 'deleted'`) is listed too and is erased 30 days after the deletion (a legal hold stops it; never-delete does not).
Settings: `ORG_LIFECYCLE_ENABLED`, `ORG_LIFECYCLE_DRY_RUN`, `ORG_LIFECYCLE_DELETE_ENABLED`, `FINANCIAL_RECORD_RETENTION_YEARS` (see ADR-0028 for what each does).

### GET /v2/platform/workspaces

Query: `q` (name, slug, owner name or email), `status` (`all|active|suspended`), `plan` (slug), `state` (`free_trial|free|paid_active|paid_grace|paid_lapsed|custom_quote`),
`provider` (effective provider key), `lowBalanceOnly`, `sort` (`created` newest first, `last_active` most recent first, never-active last, `name` A to Z), `limit` (1..100, default 25), `cursor`.
The cursor carries the sort value and the id and only fits the sort it came from (another sort or a made-up cursor is 422).

```json
{
  "data": [
    {
      "workspaceId": "5afcfeda-11ce-4e2f-bb97-5de36d09834e",
      "name": "Hub Alpha",
      "slug": "hub-alpha",
      "status": "active",
      "suspendedBy": [],
      "createdAt": "2026-09-07T10:00:00.000Z",
      "provider": {
        "key": "meta",
        "name": "Meta Cloud API (direct)",
        "source": "platform_setting"
      },
      "numbers": 1,
      "plan": { "slug": "hub_pro", "name": "Hub Pro", "known": true, "platformOwned": false },
      "validity": {
        "state": "paid_active",
        "trialEndsAt": null,
        "planEndsAt": "2026-10-27T10:00:00.000Z",
        "daysLeft": 20,
        "renewalWindow": false,
        "graceEndsAt": null
      },
      "limits": {
        "monthlyMessages": 1000,
        "users": 25,
        "contacts": null,
        "devices": null,
        "overridden": true
      },
      "wallet": { "currency": "USD", "balanceMinor": "15", "low": true },
      "owner": {
        "userId": "...",
        "name": "Alice Owner",
        "email": "alice@hub.test",
        "phone": "+919876543210"
      },
      "mrr": "10.00",
      "messages7d": 15,
      "lastActiveAt": "2026-10-06T11:00:00.000Z",
      "health": "low"
    }
  ],
  "page": { "nextCursor": "eyJzb3J0Ijoi...", "hasMore": true, "limit": 25 },
  "kpis": {
    "total": 3,
    "active": 3,
    "suspended": 0,
    "trial": 1,
    "newThisMonth": 1,
    "lowBalance": 2,
    "mrr": "10.00",
    "currency": "USD"
  },
  "filters": {
    "plans": [{ "slug": "hub_pro", "name": "Hub Pro" }],
    "providers": [{ "key": "meta", "name": "Meta Cloud API (direct)" }]
  }
}
```

Rules worth knowing:

- Provider: the workspace's override, else the registry default, else the platform setting (`WABA_DEFAULT_PROVIDER`), the same choice a new number follows. `numbers` counts connected `waba` configs.
- Limits: plan limits with the workspace's override applied; `0` and `-1` are unlimited (`null`); a lapsed paid plan shows the free plan's caps; platform-owned is unlimited.
- Wallet: in the workspace's billing currency (its own currency when the platform can bill it, else the platform currency); `low` is the wallet list's rule (threshold converted to that currency).
- Owner: `organizations.settings.ownerUserId`, else `workspace_settings.owner_user_id`, else a holder of the Admin role. `phone` is `user_profiles.phone_e164`.
- `mrr`: the plan price per month (offer-aware) converted to the platform currency, only while the plan is paid (active or in grace) and the workspace is not platform-owned. Marketplace subscription revenue is not included.
- `health`: `suspended`, then `new` (created under 7 days ago with no outbound message in 7 days), then `good` (500+), `active` (50+), `low`, `idle` by outbound messages in 7 days.
- `messages7d` and `lastActiveAt` come from one grouped query each for the page's workspaces.

### GET /v2/platform/workspaces/:id

```json
{
  "row": { "...": "the row above" },
  "members": 1,
  "contacts": 0,
  "openTickets": 1,
  "messages30d": [
    { "day": "2026-09-07", "sent": 0, "delivered": 0 },
    "... 30 UTC days, zero-filled, oldest first"
  ],
  "deliveredPct": 80,
  "adminNote": "VIP",
  "can": {
    "suspend": true,
    "unsuspend": true,
    "impersonate": true,
    "editPlan": true,
    "manageProvider": true,
    "adjustWallet": true
  }
}
```

`can` comes from the caller's platform permissions (`platform.workspace.suspend`, `.unsuspend`, `.impersonate`, `platform.whatsapp_providers.manage`);
`editPlan` and `adjustWallet` need the super admin operator role, as the plan and wallet endpoints do. `deliveredPct` is null when nothing was sent in 30 days.
Unknown id is 404 `NOT_FOUND`.

### POST /v2/platform/workspaces/:id/suspend and /unsuspend

Body for suspend: `{ "reason": "Chargeback" }` (optional, max 500). Response 200: the refreshed hub row (for example `status: "suspended"`, `suspendedBy: ["frozen"]`, `health: "suspended"`).

## Operator impersonation: "Login as owner" (TW-WSP-032, 033)

An operator enters a workspace as its owner through an **act-as token**, not the owner's session (ADR-0020). Shapes:
`startImpersonationRequestSchema`, `startImpersonationResponseSchema`, `redeemImpersonationRequestSchema`,
`redeemImpersonationResponseSchema`, `impersonationStatusSchema`, `stopImpersonationResponseSchema` in `admin-hub.ts`.

The flow: console **start** (operator token) -> one-time handoff URL -> web `/impersonate?code=` **redeem** (server to server) ->
act-as cookie -> workspace app with the banner -> **stop** (banner) -> back to the console.

### POST /v2/platform/workspaces/:id/impersonate

Operator token. Needs the permission `platform.workspace.impersonate` AND the `super_admin` operator role (MFA enrolment is enforced by
the operator guard). The Admin Team Inbox launcher (`POST /v2/platform/inbox/workspaces/:id/impersonate`, body `{ reason }`) starts the same
session, with writes allowed. Starting ends any session this operator already had open (`ended_by: new_session`).

```json
// request
{ "reason": "Ticket 1234 debug", "readOnly": true }
// 201
{
  "sessionId": "6a9f0c52-1b6e-4a35-8f6d-3d2f7a0b9c11",
  "workspaceId": "9d1f0b9a-6c52-4a3b-8d5e-2f6a7c1b0e22",
  "workspaceName": "Acme Co",
  "handoffUrl": "https://app.example.com/impersonate?code=hX3...43 characters",
  "expiresAt": "2026-10-07T11:00:00.000Z"
}
```

`reason` 8 to 500 characters (422 below), `readOnly` defaults to false. `expiresAt` is at most `IMPERSONATION_MAX_MINUTES` (60) after the start.
The code in `handoffUrl` is valid 60 seconds and once; only its hash is stored. The owner is `organizations.settings.ownerUserId`, else the oldest
active holder of the Owner preset. Errors: 401 no operator token, 403 `AUTH_OPERATOR_ROLE_REQUIRED` (not super admin) or
`RBAC_PLATFORM_PERMISSION_REQUIRED`, 404 unknown workspace, 409 `WSP_IMPERSONATION_NO_OWNER`.

### POST /v2/auth/impersonation/redeem (public)

Called by the web app's `/impersonate` route, never by page code (the generic `/api/v2` proxy refuses it, because the answer carries a token).

```json
// request
{ "code": "hX3...43 characters" }
// 200
{ "accessToken": "eyJ...", "expiresIn": 3541, "expiresAt": "2026-10-07T11:00:00.000Z", "workspaceSlug": "acme" }
```

The token's claims: `sub` = the owner's user id, `org` = the workspace, `typ: "user"`, `sid` = the session uuid, and
`imp: { sid, oid (operator id), ro (read-only), exp (session end, unix seconds) }`. It is access-only: there is **no refresh token**, it lives until the
session ends (never past 60 minutes) and nothing renews it. Unknown, used, expired or ended code: 400 `WSP_IMPERSONATION_CODE_INVALID` (one answer for all);
more than 20 tries a minute from one address: 429 `RATE_LIMITED`.

### GET /v2/auth/impersonation and POST /v2/auth/impersonation/stop

Workspace token. `GET` feeds the banner: `{ "active": true, "sessionId": "...", "operatorName": "Root Operator", "reason": "Ticket 1234 debug", "readOnly": false,
"expiresAt": "..." }`, or `{ "active": false, ... }` for every ordinary session. `POST stop` ends the session (also allowed in read-only mode), writes
`platform.impersonation.stopped` with the duration and the number of audited changes by action, and answers `{ "returnUrl": "https://app.example.com/admin/workspaces" }`.
After stop, the same token fails on its next request with 401 `WSP_IMPERSONATION_ENDED`. From an ordinary session `stop` changes nothing.

### What an act-as session may not do

Checked on every request, in this order, by `ImpersonationGuard` (list: `IMPERSONATION_FORBIDDEN` in `impersonation-rules.ts`):

- **403 `WSP_IMPERSONATION_FORBIDDEN`**, read-only or not: changing the owner's password or email, 2FA setup/disable/recovery codes, the owner's sessions, account deletion,
  workspace API keys (`/developer/keys`) and AI provider keys, switching workspace, and everything under `/v2/platform/*`.
- **403 `WSP_IMPERSONATION_READ_ONLY`**: any request that is not GET, HEAD or OPTIONS in a read-only session (except `POST /v2/auth/impersonation/stop`).
- **401 `WSP_IMPERSONATION_ENDED`**: the session was stopped, ran out, was replaced by a newer one of the same operator, or its operator is no longer an active super admin.

The owner's own account gates (forced password change, 2FA enrolment, unverified email) are skipped for the operator. A suspended workspace can still be entered
(as in Reference) so support can look; writes follow the session's own read-only flag.

### Audit

Both actors are recorded. `security_events`: `platform.impersonation.started / redeemed / ended / stopped` with the operator as actor and the owner in the payload,
and every event written during an act-as request carries `payload.impersonation = { sessionId, asUserId }` with the operator as actor. `audit_log` (visible in the
workspace's own activity log): a `started` and `stopped` row with actor `platform_operator`, and every audit row written during the session is stamped
`delta._impersonatedBy = { old: null, new: { operatorId (uuid), sessionId } }` by a trigger.

Configuration: the handoff URL is built from `WEB_APP_URL` (the public address of the web app, which serves both the console and the workspace app).

## Error codes added by this domain

| Code                             | Status | When                                                           |
| -------------------------------- | ------ | -------------------------------------------------------------- |
| `WSP_ALREADY_MEMBER`             | 409    | invite: the address is an active or pending member             |
| `WSP_CANNOT_ACT_ON_HIGHER_RANK`  | 403    | the target outranks the caller                                 |
| `WSP_CANNOT_REMOVE_SELF`         | 422    | remove yourself                                                |
| `WSP_CANNOT_REMOVE_OWNER`        | 422    | remove an Owner                                                |
| `WSP_INVITE_INVALID`             | 400    | any problem with an invitation token (deliberately uniform)    |
| `WSP_INVITE_NOT_PENDING`         | 409    | resend for a member who has already joined                     |
| `WSP_TEAM_NAME_TAKEN`            | 409    | team name already used in the workspace                        |
| `WSP_TEAM_MEMBER_UNKNOWN`        | 422    | a `memberIds` entry is not an active member of this workspace  |
| `WSP_IMPERSONATION_READ_ONLY`    | 403    | a write in a read-only impersonation session                   |
| `WSP_IMPERSONATION_FORBIDDEN`    | 403    | an owner-only or operator route inside an impersonation        |
| `WSP_IMPERSONATION_NO_OWNER`     | 409    | the workspace has no active owner to act as                    |
| `WSP_IMPERSONATION_CODE_INVALID` | 400    | the handoff code is unknown, used, expired or its session over |
| `WSP_IMPERSONATION_ENDED`        | 401    | the act-as token's session ended, expired or lost its operator |

Role rules answer with the RBAC codes `RBAC_ROLE_GRANT_FORBIDDEN` (403), `RBAC_SELF_ROLE_CHANGE` (422) and `RBAC_LAST_OWNER` (422).
Also used: `PLAN_LIMIT_REACHED` (422, seat limit), `ROW_VERSION_CONFLICT` (409), `VALIDATION_FAILED` (422), `FORBIDDEN` (403), `NOT_FOUND` (404),
`RATE_LIMITED` (429), `AUTH_PASSWORD_POLICY` (422).

## Operational notes

- Migration `20261013110000_wsp_members_teams.sql` only widens the `user_tokens.kind` check with `invite`. The roles, the keys and
  the always-keep-an-Owner rule come from `20261013100000_rbac_workspace_presets.sql`, which it must sort after; new organizations get
  their presets from `provision_workspace_presets(org_id)` (sign-up and the dev seed already call it).
- A development database that applied the earlier file name `20261013090000_wsp_members_teams` (it was never on main) cannot take the
  RBAC presets migration: its Viewer role carries the old key `readonly`. Drop and recreate it, or run this once before
  `pnpm db:migrate`:

  ```sql
  BEGIN;
  SELECT set_config('app.privileged', 'on', true);
  UPDATE roles SET is_locked = false WHERE system_key = 'admin' AND is_locked;
  UPDATE roles SET system_key = 'viewer' WHERE system_key = 'readonly';
  DELETE FROM role_grants WHERE permission_key IN ('member.invite','member.role.assign','team.manage','workspace.settings','workspace.export');
  DELETE FROM permission_defs WHERE key IN ('member.invite','member.role.assign','team.manage','workspace.settings','workspace.export');
  UPDATE roles SET is_locked = true WHERE system_key = 'admin';
  DROP FUNCTION IF EXISTS wsp_seed_role_presets(bigint);
  DELETE FROM _migrations WHERE id = '20261013090000_wsp_members_teams';
  COMMIT;
  ```

- A removed member signing in is refused by the account gate (`AUTH_ACCOUNT_SUSPENDED`).
- The invite and reset mails use `WEB_APP_URL` (the same base the other auth mails use).
