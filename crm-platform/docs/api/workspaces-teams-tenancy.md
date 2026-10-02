# API: workspace members and teams

Domain `wsp` (WD-WSP-015 .. 022, 046, 047), PR 1: **Members** and **Teams**. Base path `/v2`. Errors are `application/problem+json`
with a stable `code` (`WSP_*` in `@crm/contracts` `workspace-teams-tenancy/errors.ts`, plus the common ones) and a `requestId`.
Request and response shapes live in `packages/contracts/src/workspaces-teams-tenancy/` (`members.ts`, `teams.ts`). Live docs: `/docs`.

Conventions: **User** = staff bearer token. **Public** = no token. Every id on the wire is a uuid. Lists are cursor paginated
(`{ data, page: { nextCursor, hasMore, limit } }`). Mutations that create something accept an optional `Idempotency-Key`.

## The role model

A "workspace" is an organization. There is one role model, the RBAC domain's (`docs/wadesk-port/parity/roles-permissions.md`, decisions
D-RBAC-05 and D-RBAC-06): five preset roles per organization created by `provision_workspace_presets(org_id)`, plus any custom role the
organization makes. WaDesk's five roles are shown as a **tier** read from a role's preset `system_key`. Permissions are the usual
capability keys, all RBAC's: `org.member.invite` (invite, resend, remove, reset password), `org.member.role_assign` (change a role) and
`inbox.team.manage` (teams writes), granted to the Owner and Admin presets.

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
`me.canManageTeams` are the caller's `org.member.invite`, `org.member.role_assign` and `inbox.team.manage`. `seats.used` counts every
member who is not removed, pending invitations included; `limit` is the plan's `users` cap (`null` = unlimited).

### `POST /workspace/members/invite` (User, `org.member.invite`, idempotent) → 201

```json
// request
{ "fullName": "Riya Sharma", "email": "riya@acme.test", "roleId": "5afcfeda-11ce-4e2f-bb97-5de36d09834e" }
// 201
{ "member": { "id": "55c7a0c4-…", "email": "riya@acme.test", "tier": "manager", "status": "pending", "joinedAt": null, "…": "…" },
  "emailSent": true, "inviteLink": null }
```

Order of checks (WaDesk's): the **seat limit** first (`422 PLAN_LIMIT_REACHED`, even for an invalid payload), then the payload
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

A team is a named group of members the inbox routes conversations to. Any signed-in member may list; writes need `inbox.team.manage`.

```json
{
  "id": "0c78f94d-…",
  "name": "Sales",
  "color": "#075E54",
  "description": null,
  "assignmentStrategy": "manual",
  "isDefault": false,
  "sort": 0,
  "deviceIds": [],
  "members": [
    {
      "id": "97e03962-…",
      "fullName": "Demo Agent",
      "presence": "offline",
      "isLead": false,
      "capacity": 20
    }
  ],
  "rowVersion": 1,
  "createdAt": "2026-10-02T13:25:20.195Z"
}
```

### `GET /workspace/teams` (User)

Query: `limit`, `cursor`, `order` (`asc` = creation order; default `desc`), `q` (name contains). → `PageResponse<WspTeam>`.

### `POST /workspace/teams` (User, `inbox.team.manage`, idempotent) → 201

```json
{
  "name": "Sales",
  "color": "#ff0000",
  "description": "Inbound",
  "assignmentStrategy": "round_robin",
  "memberIds": ["97e03962-…"],
  "deviceIds": []
}
```

`name` 1..64 and unique per workspace (`409 WSP_TEAM_NAME_TAKEN`); `color` matches `^#?[0-9A-Za-z_-]{1,16}$` (default `#075E54`);
`assignmentStrategy` is `manual | round_robin | least_loaded | sticky` (default `manual`). `memberIds` must be **active members of this
workspace** (`422 WSP_TEAM_MEMBER_UNKNOWN`, nothing is created); members join with `isLead = false`, `capacity = 20`. `deviceIds` are
intersected with this workspace's devices and unknown ones are dropped silently; none left (or none given) means **every device**.

### `PATCH /workspace/teams/:id` (User, `inbox.team.manage`) → 200 `WspTeam`

Every field optional, plus the required `rowVersion` (`409 ROW_VERSION_CONFLICT` when stale). `memberIds`, when present, replaces the
member list (an empty list removes everyone; members who stay keep their lead flag and capacity). `deviceIds: []` resets to every device.
A team of another workspace is `404`.

### `DELETE /workspace/teams/:id` (User, `inbox.team.manage`) → 204

Removes the team and its member places; conversations assigned to it lose the team (the foreign key sets `assignee_team_id` null) and
the `team.deleted` event lets routing drop its references.

## Error codes added by this domain

| Code                            | Status | When                                                          |
| ------------------------------- | ------ | ------------------------------------------------------------- |
| `WSP_ALREADY_MEMBER`            | 409    | invite: the address is an active or pending member            |
| `WSP_CANNOT_ACT_ON_HIGHER_RANK` | 403    | the target outranks the caller                                |
| `WSP_CANNOT_REMOVE_SELF`        | 422    | remove yourself                                               |
| `WSP_CANNOT_REMOVE_OWNER`       | 422    | remove an Owner                                               |
| `WSP_INVITE_INVALID`            | 400    | any problem with an invitation token (deliberately uniform)   |
| `WSP_INVITE_NOT_PENDING`        | 409    | resend for a member who has already joined                    |
| `WSP_TEAM_NAME_TAKEN`           | 409    | team name already used in the workspace                       |
| `WSP_TEAM_MEMBER_UNKNOWN`       | 422    | a `memberIds` entry is not an active member of this workspace |

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
