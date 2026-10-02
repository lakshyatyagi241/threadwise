# API: workspace members and teams

Domain `wsp` (TW-WSP-015 .. 022, 046, 047), PR 1: **Members** and **Teams**. Base path `/v2`. Errors are `application/problem+json`
with a stable `code` (`WSP_*` in `@crm/contracts` `workspace-teams-tenancy/errors.ts`, plus the common ones) and a `requestId`.
Request and response shapes live in `packages/contracts/src/workspaces-teams-tenancy/` (`members.ts`, `teams.ts`). Live docs: `/docs`.

Conventions: **User** = staff bearer token. **Public** = no token. Every id on the wire is a uuid. Lists are cursor paginated
(`{ data, page: { nextCursor, hasMore, limit } }`). Mutations that create something accept an optional `Idempotency-Key`.

## The role model

A "workspace" is an organization. Reference's five roles are a **display tier** computed from RBAC roles; permissions themselves are
the usual capability keys (`member.invite`, `member.role.assign`, `team.manage`, `workspace.settings`, `workspace.export`, all in
category `workspace`, granted to the locked Admin preset of every organization).

| Tier      | Rank | Who                                                                                                        |
| --------- | ---- | ---------------------------------------------------------------------------------------------------------- |
| `owner`   | 100  | the organization's owner (`organizations.settings.ownerUserId`); always holds the Admin role as well       |
| `admin`   | 80   | holds the Admin preset (`system_key = 'admin'`, locked, every key)                                         |
| `manager` | 60   | holds the Manager preset (`manager`): the Agent set at record scope `all`, plus delete, inbox, dashboards  |
| `agent`   | 40   | holds the Agent preset (a role called `Agent` with no system key)                                          |
| `custom`  | 40   | holds only roles the organization made itself; ranks like an agent                                         |
| `viewer`  | 20   | holds the Viewer preset (`readonly`): every `record.*.read` key and `inbox.conversation.read`, scope `all` |

A member's tier is the owner when they are the owner, otherwise the highest of their roles. Rules, enforced by the service on top
of the keys (they hold even for a caller whose custom role carries `member.invite`):

1. **Grant** (`canGrantRole`): only the owner grants Admin; nobody grants above their own rank; Owner is never grantable.
   Refusal: `403 WSP_CANNOT_GRANT_ROLE`.
2. **Act on** (role change, remove, reset password, resend): nobody acts on a member who outranks them (equal rank is allowed).
   Refusal: `403 WSP_CANNOT_ACT_ON_HIGHER_RANK`.
3. The owner's role cannot be reduced (`422 WSP_LAST_OWNER`) or removed (`422 WSP_CANNOT_REMOVE_OWNER`); nobody changes or removes
   themselves (`422 WSP_CANNOT_CHANGE_OWN_ROLE`, `422 WSP_CANNOT_REMOVE_SELF`).

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

`roles` is every role of the organization, highest tier first; `grantable` is `canGrantRole` for the caller. `seats.used` counts every
member who is not removed, pending invitations included; `limit` is the plan's `users` cap (`null` = unlimited).

### `POST /workspace/members/invite` (User, `member.invite`, idempotent) → 201

```json
// request
{ "fullName": "Riya Sharma", "email": "riya@acme.test", "roleId": "5afcfeda-11ce-4e2f-bb97-5de36d09834e" }
// 201
{ "member": { "id": "55c7a0c4-…", "email": "riya@acme.test", "tier": "manager", "status": "pending", "joinedAt": null, "…": "…" },
  "emailSent": true, "inviteLink": null }
```

Order of checks (Reference's): the **seat limit** first (`422 PLAN_LIMIT_REACHED`, even for an invalid payload), then the payload
(`422 VALIDATION_FAILED`, unknown `roleId` is a validation error on `roleId`), then who may grant the role
(`403 WSP_CANNOT_GRANT_ROLE`), then the address (`409 WSP_ALREADY_MEMBER` if it is an active or pending member).
A removed member's address is reactivated (the same user comes back as a fresh pending member, no old password, verified address
or second factor).

The new account has a random password nobody knows; only the invitation link can open it. The mail is sent after the transaction
commits (subject "<inviter> invited you to <workspace> on <app>"); the link is `${WEB_APP_URL}/accept-invite?token=…&org=<slug>`,
single use, **7 days**. When no mail transport is configured (or sending fails) `emailSent` is `false` and `inviteLink` carries the link
**once**; it is never retrievable later (only the token's hash is stored). No plaintext password exists anywhere.

### `POST /workspace/members/:id/resend-invite` (User, `member.invite`) → 200

Only for a pending member (`409 WSP_INVITE_NOT_PENDING` otherwise). Issues a fresh link (the old one stops working) and answers with
`{ member, emailSent, inviteLink }` as above.

### `PATCH /workspace/members/:id/role` (User, `member.role.assign`) → 200 `WspMember`

```json
{ "roleId": "…", "rowVersion": 2 }
```

Replaces the member's whole role set with that one role and bumps the roles version, so the member's grants change on their next
request. Checks, in order: not yourself, the owner's role is protected, the target must not outrank the caller, the caller may grant
the role. Stale `rowVersion` is `409 ROW_VERSION_CONFLICT`; an unknown or foreign member is `404`.

### `DELETE /workspace/members/:id` (User, `member.invite`) → 204

Removal is soft: the user becomes `inactive`, loses all roles and team places, live tokens are cancelled and **every session is
revoked now** (an unexpired access token is refused on its next use). The account and everything that references it stay; the
`member.removed` outbox event lets other domains unassign conversations. Removed members are not listed; inviting the address again
reactivates them. Errors: `422 WSP_CANNOT_REMOVE_SELF`, `422 WSP_CANNOT_REMOVE_OWNER`, `403 WSP_CANNOT_ACT_ON_HIGHER_RANK`, `404`.

### `POST /workspace/members/:id/reset-password` (User, `member.invite`) → 200

Emails the member the auth domain's own set-password link (`/reset-password?token=…&org=<slug>`, 60 minutes, single use); the
password keeps working until the link is used. Nobody is shown a password. Answers `{ member, emailSent, inviteLink }` (the link comes
back once when the mail cannot be sent). Only the owner may reset the owner's password (`403 WSP_CANNOT_ACT_ON_HIGHER_RANK`); a target
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

A team is a named group of members the inbox routes conversations to. Any signed-in member may list; writes need `team.manage`.

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

### `POST /workspace/teams` (User, `team.manage`, idempotent) → 201

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

### `PATCH /workspace/teams/:id` (User, `team.manage`) → 200 `WspTeam`

Every field optional, plus the required `rowVersion` (`409 ROW_VERSION_CONFLICT` when stale). `memberIds`, when present, replaces the
member list (an empty list removes everyone; members who stay keep their lead flag and capacity). `deviceIds: []` resets to every device.
A team of another workspace is `404`.

### `DELETE /workspace/teams/:id` (User, `team.manage`) → 204

Removes the team and its member places; conversations assigned to it lose the team (the foreign key sets `assignee_team_id` null) and
the `team.deleted` event lets routing drop its references.

## Error codes added by this domain

| Code                            | Status | When                                                          |
| ------------------------------- | ------ | ------------------------------------------------------------- |
| `WSP_ALREADY_MEMBER`            | 409    | invite: the address is an active or pending member            |
| `WSP_CANNOT_GRANT_ROLE`         | 403    | the caller may not hand out that role                         |
| `WSP_CANNOT_ACT_ON_HIGHER_RANK` | 403    | the target outranks the caller                                |
| `WSP_CANNOT_CHANGE_OWN_ROLE`    | 422    | role change on yourself                                       |
| `WSP_CANNOT_REMOVE_SELF`        | 422    | remove yourself                                               |
| `WSP_CANNOT_REMOVE_OWNER`       | 422    | remove the owner                                              |
| `WSP_LAST_OWNER`                | 422    | reduce the owner's role                                       |
| `WSP_INVITE_INVALID`            | 400    | any problem with an invitation token (deliberately uniform)   |
| `WSP_INVITE_NOT_PENDING`        | 409    | resend for a member who has already joined                    |
| `WSP_TEAM_NAME_TAKEN`           | 409    | team name already used in the workspace                       |
| `WSP_TEAM_MEMBER_UNKNOWN`       | 422    | a `memberIds` entry is not an active member of this workspace |

Also used: `PLAN_LIMIT_REACHED` (422, seat limit), `ROW_VERSION_CONFLICT` (409), `VALIDATION_FAILED` (422), `FORBIDDEN` (403), `NOT_FOUND` (404),
`RATE_LIMITED` (429), `AUTH_PASSWORD_POLICY` (422).

## Operational notes

- Migration `20261013090000_wsp_members_teams.sql` registers the five keys, adds the Manager and Viewer presets to every organization
  through `wsp_seed_role_presets(org_id)` (idempotent; provisioning and the dev seed call it too), records the earliest Admin as owner
  for organizations that predate `settings.ownerUserId`, and widens the `user_tokens.kind` check with `invite`.
- A removed member signing in is refused by the account gate (`AUTH_ACCOUNT_SUSPENDED`).
- The invite and reset mails use `WEB_APP_URL` (the same base the other auth mails use).
