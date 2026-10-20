# API: teams and record scope

BL-380 (teams T0) and BL-382 (teams T2). How a record scope (`own` | `team` | `team_and_below` | `all`) decides what a signed-in person sees and may act on, for chats and for CRM
records; the permission that opens the unassigned conversation queue; the team that owns a record; and the endpoint that previews what deleting a team changes. Design:
`docs/specs/teams-unification.md`. Code map: `docs/threadwise-port/wiring/teams-scope-inventory.md` (T0) and `docs/threadwise-port/wiring/teams-t2.md` (T2). Base path `/v2`; errors are
`application/problem+json` with a stable `code`.

## What a scope means

A role grants each permission with a scope (`role_grants.record_scope`). When a person holds several roles the widest allow wins
(`all` over `team_and_below` over `team` over `own`); a deny wins over everything (`RbacService`). The scope is applied by the service that serves the record,
through one resolver (`apps/api/src/kernel/rbac/scope`), the same way for a list and for one record.

| Scope            | CRM records (contacts, companies, deals, tasks, invoices, sales documents, appointments, forms, call logs, segments) | Conversations                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `all`            | everything in the workspace                                                                                          | everything                                                                                                                             |
| `team_and_below` | `team`, plus records of people in a team **below** one of the caller's teams, at any depth                           | assigned to the caller, to one of the caller's teams or to a team below them, plus the unassigned queue with `read_unassigned` (below) |
| `team`           | `own`, plus records whose owner, assignee, host or creator is a member of at least one team the caller is in         | assigned to the caller or to one of the caller's teams, plus the unassigned queue with `read_unassigned`                               |
| `own`            | records whose owner, assignee, host or **creator** is the caller                                                     | assigned to the caller                                                                                                                 |

- The creator counts like the owner in `own` and in `team`, in every module (decision D1). Only deals had no creator column; migration
  `20270210090000_deals_created_by.sql` adds `deals.created_by`, set when a person creates a deal. Deals that exist today keep `NULL` (nobody
  gains or loses sight of an existing deal).
- A person who is in no team and holds `team` or `team_and_below` sees their own records. Both are never narrower than `own`.
- A record with no person on any column is visible only at `all`.
- Reading one record outside the scope answers `404`, not `403`: the API does not confirm that the record exists.
- The contact scope also governs everything that shows a contact's details: the contacts list, the contact tabs, message history, the
  dashboard contact tiles, segment previews and the **inbox contact panel** (`GET /inbox/conversations/:id` returns `contactSummary: null` when
  the caller's contact scope does not cover the contact; the thread itself still opens and still names the contact).

### `team_and_below` (BL-382)

A role that reads at `team_and_below` reaches the members of the caller's teams **and of every team under them** (`teams.parent_team_id`, teams v2). Rules:

- The walk follows `parent_team_id` downward from each team the caller belongs to. It is cycle-safe (a team met twice counts once; a trigger already refuses a loop) and
  depth-bounded (10 levels; the Teams service allows 5), and it runs inside the request's transaction, so moving a team under another takes effect on the next request. The
  tree is cached for the life of the request only, never across requests.
- A deactivated person grants nothing (their `team_members` rows are hidden from tenant sessions, teams v2), also as a member of a sub-team.
- The hand-over bound (a record may only be given to someone inside the giver's scope) follows the same reach: `team_and_below` may hand a record to a person in a sub-team,
  `team` may not.
- The Roles matrix offers it only when the plan feature `team_hierarchy` is on. The key is added by teams T3 (BL-383); until it is in the catalogue the scope is offered to every
  workspace (`teamHierarchyOffered` in `packages/contracts/src/common/team-hierarchy.ts`, with a TODO to drop the note when T3 merges). Saving a role with the scope while the feature is
  off is `422 PLAN_FEATURE_LOCKED` (`details`: `grants` = `team_and_below`, `feature` = `team_hierarchy`); a role that already holds it keeps it.
- Nobody grants a wider scope than they hold (`403 RBAC_ROLE_GRANT_FORBIDDEN`): `all` > `team_and_below` > `team` > `own`.
- `teams.is_scope_boundary` (teams v2) is still stored and not read: a team with the flag off still counts for `team` and `team_and_below`.

### Unassigned conversations: `inbox.conversation.read_unassigned` (decision D2)

Before BL-382 a role that read conversations at `team` also saw every conversation assigned to nobody (no person and no team). That rule hid inside the word "team". It is now the
permission `inbox.conversation.read_unassigned` (category `inbox`, a plain switch: `supportsScope` false):

| Read scope on `inbox.conversation.read` | Without the permission                      | With the permission                                     |
| --------------------------------------- | ------------------------------------------- | ------------------------------------------------------- |
| `all`                                   | everything                                  | everything                                              |
| `team_and_below`                        | assigned to me, to my teams and teams below | the same, plus conversations assigned to nobody         |
| `team`                                  | assigned to me or to my teams               | the same, plus conversations assigned to nobody         |
| `own`                                   | assigned to me                              | assigned to me (the permission widens team scopes only) |

- A conversation assigned to a team the caller does not reach is **not** unassigned and stays hidden.
- The migration `20270225090100_inbox_read_unassigned_permission` grants it to **every role that holds `inbox.conversation.read` as an allow at scope `team`** (the Viewer preset and
  custom roles alike, in every workspace) and adds it to the Viewer preset's baseline for workspaces created later, so nobody's visible set changes when it ships.
  Owner and Admin receive it through the registry trigger, like every new key.
- Acting rights (reply, note, assign, resolve, ...) keep their rule: they are asked only after the conversation is visible, and a team-scoped action grant still covers the
  unassigned queue. Granting the new permission by someone's reply scope would have widened what they can read, so it is not done.
- The list, the counts, the thread, message history, notifications and the socket rooms all use the same rule (`conversationScopeAllows` / `conversationScopeCondition`).

**Operator report: who would see something different.** `pnpm --filter @crm/api report:unassigned-visibility -- [--org <slug|id>] [--json]` (read-only) lists, per workspace, the
roles that read at `team` or `team_and_below` and do not hold the permission, with the number of active members and the number of unassigned conversations they no longer see.
Right after the migration the list is empty (the migration changes nobody); afterwards it shows what an administrator narrowed. On a database where the migration has not run yet it
lists every `team` reader, which is the set that would change if the rule were applied without the grant.

### The owning team of a record (decision D8)

Contacts, companies, deals and tasks carry `owning_team_id` (nullable, a team of the same workspace, cleared if the team is deleted): **the owner's primary team
(`team_members.is_primary`) at the moment the owner was set or last changed**. For a task the owner is the assignee. It is NULL when the record has no owner or the owner has no primary team.

- It is for **reports, filters and the team picker, never for access**: what a person may open is still decided by the owner and the role's scope.
- A database trigger on each table (`stamp_owning_team`) sets it when the row is inserted with an owner or when the owner column changes, so every writer is covered: the single
  edit, the bulk edit, the record assignment engine, owner-reassign batches and their undo, imports, the public API and flows. It does not follow a later change of the
  owner's primary team, and it is not an API input (it is never read from a request body).
- A person on two teams is counted **once**, for their primary team. A person on two teams with no primary team belongs to no team in reports until someone chooses one.
- Existing records are stamped by the worker job `owning-team-backfill` (500 rows per transaction, per table, resumable, runs once per Redis and every night). The nightly pass gives a
  team to records left empty because their owner had no primary team yet; it never changes a record that already has one. It keeps `updated_at` and `row_version` untouched.
- `deals.owner_team_id` (an orphan column, no foreign key, never read) is retired in favour of `deals.owning_team_id`. It stays in the table, unused, for the release that is still
  serving traffic while the migration runs; a later migration drops it (follow-up in BL-382).

**List filter.** `GET /contacts`, `GET /deals` (list, board, board column) and `GET /tasks` (list and counts) take `teamId=<team uuid>`: only records whose owning team is that team,
inside the caller's scope (it narrows, it never widens). An unknown team answers an empty list. The contacts filter is part of the shared contact filter, so "select all matching",
export, bulk actions and segment previews honour it too.

**Reports.** The CRM dashboard team filter reads `owning_team_id` for the contact, deal and task tiles and the owner's primary team for invoices and payments (they carry no stamp);
the revenue report's "by team" grouping and team filter use the owner's primary team. Either way a person on two teams counts for one team. Old reports that counted a person on two
teams for both show different team totals from the day this ships.

## Roles API additions

- `RoleResponse` and the grant bodies take `recordScope`: `all | team | team_and_below | own`.
- `RoleResponse.membersWithoutTeam` (integer): active members holding the role who are in no team. The role editor warns when a role grants at a team scope and this is above zero.
- `GET /permissions` lists `inbox.conversation.read_unassigned` (switch, no scope).
- `GET /auth/session` and the account summary carry the caller's scope per permission, now possibly `team_and_below`.

## Record assignment candidates

A person named by a record assignment rule (directly or through a team) is offered a record only when they hold the read permission for it
(`record.contacts.read`, `record.companies.read` or `record.deals.read`): a record they own is always inside their own and team scope, so the
right to read is what decides. `POST /assignment/test` and the run log carry, per rule in `trace`, an `excluded` list:

```json
{
  "ruleId": "...",
  "name": "West leads",
  "matched": true,
  "nobody": false,
  "excluded": [{ "id": "<user uuid>", "name": "Rahul", "reason": "no_access" }]
}
```

`reason` is `no_access` (cannot open this kind of record), `inactive`, `on_leave` or `offline`. At most 10 people are listed per rule.

## `GET /workspace/teams/:id/usage`

What deleting the team would change. Read-only. Needs `inbox.team.manage` (the key that guards team writes). `404` for a team of another
workspace.

```json
{
  "members": 12,
  "routingRules": 2,
  "assignmentRules": 1,
  "segmentShares": 3,
  "conversationsAssigned": 41,
  "peopleWithReachChange": 9
}
```

| Field                   | Meaning                                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `members`               | People in the team.                                                                                                                 |
| `routingRules`          | Conversation routing rules that name the team as a target.                                                                          |
| `assignmentRules`       | Record assignment rules that name the team in their pool.                                                                           |
| `segmentShares`         | Segments shared with the team.                                                                                                      |
| `conversationsAssigned` | Conversations assigned to the team (any status).                                                                                    |
| `peopleWithReachChange` | Members who share a team with a colleague only through this team, so their `team` reach loses that colleague when the team is gone. |

## `DELETE /workspace/teams/:id` and the `team.deleted` consumer

Unchanged contract (`204`). The delete writes the `team.deleted` outbox event; the worker consumer `team-deleted-references` then:

- removes the team uuid from the `assign` targets of every routing rule; a rule whose only target was that team loses its assignment and keeps
  its other actions; a deferred reassignment that depended on the assignment is dropped; a rule left with nothing to do is switched off
  (`is_active = false`), not deleted;
- removes the team uuid from `assignment_rules.team_ids`.

Segment shares, conversations (`assignee_team_id`) and reassign batches are cleaned by their foreign keys. The consumer is idempotent. Flow
Assign nodes that name the team are not cleaned (a known gap, see the inventory).

## Plan gate

The Deals menu entry declares the `sales_pipeline` plan feature, which the deals API already enforces (`PLAN_FEATURE_LOCKED`). The entry stays in the
menu and shows the paywall; it is not hidden.
