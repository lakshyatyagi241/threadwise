# API: teams and record scope

BL-380 (teams T0). How a record scope (`own` | `team` | `all`) decides what a signed-in person sees and may act on, for chats and for CRM records, and
the endpoint that previews what deleting a team changes. Design: `docs/specs/teams-unification.md`. Code map:
`docs/threadwise-port/wiring/teams-scope-inventory.md`. Base path `/v2`; errors are `application/problem+json` with a stable `code`.

## What a scope means

A role grants each permission with a scope (`role_grants.record_scope`). When a person holds several roles the widest allow wins
(`all` over `team` over `own`); a deny wins over everything (`RbacService`). The scope is applied by the service that serves the record,
through one resolver (`apps/api/src/kernel/rbac/scope`), the same way for a list and for one record.

| Scope  | CRM records (contacts, companies, deals, tasks, invoices, sales documents, appointments, forms, call logs, segments) | Conversations                                                                  |
| ------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `all`  | everything in the workspace                                                                                          | everything                                                                     |
| `team` | `own`, plus records whose owner, assignee, host or creator is a member of at least one team the caller is in         | assigned to the caller, or to one of the caller's teams, or assigned to nobody |
| `own`  | records whose owner, assignee, host or **creator** is the caller                                                     | assigned to the caller                                                         |

- The creator counts like the owner in `own` and in `team`, in every module (decision D1). Only deals had no creator column; migration
  `20270210090000_deals_created_by.sql` adds `deals.created_by`, set when a person creates a deal. Deals that exist today keep `NULL` (nobody
  gains or loses sight of an existing deal).
- A person who is in no team and holds `team` sees their own records. `team` is never narrower than `own`.
- A record with no person on any column is visible only at `all`.
- Reading one record outside the scope answers `404`, not `403`: the API does not confirm that the record exists.
- The contact scope also governs everything that shows a contact's details: the contacts list, the contact tabs, message history, the
  dashboard contact tiles, segment previews and the **inbox contact panel** (`GET /inbox/conversations/:id` returns `contactSummary: null` when
  the caller's contact scope does not cover the contact; the thread itself still opens and still names the contact).

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
