# API: record assignment rules (contacts, companies, deals)

Backlog BL-013 (first version), BL-340 to BL-345 (this version). Wiring map: [wiring/record-assignment.md](../threadwise-port/wiring/record-assignment.md). Types are in `@crm/contracts`
(`crm/contact-assignment`). Session auth, ids are uuids. A product extension: Reference only routes conversations (the team inbox), it has no
rule that gives a new contact, company or deal to a sales owner. The behaviour follows Freshsales "auto-assign records to users (sales owners)"
with the additions listed under "Differences from Freshsales".

Base `/v2/assignment`. Every route needs the plan feature **`record_assignment`** (`422 PLAN_FEATURE_LOCKED` otherwise, reads included). Reading needs
`crm.assignment.read`, everything else `crm.assignment.manage` (Manager, Workspace admin and Admin by default). Literal paths come before `:id`.

## The plan gate

`record_assignment` is a plan feature, default **off** in the registry. Migration `20270115090000_record_assignment_rules.sql` switches it on only for the
plans that already carry SLA policies (`features.inbox_sla = true`, the higher tier) and writes an explicit `false` on every other plan, so the basic plan does not
get it. No plan name is written in code: the operator changes it per plan in the plan editor (Features tab, "Record assignment rules"), or per workspace with
an override. The web screen shows the plan paywall when the feature is missing; the engine does nothing for a workspace without it (outcome `plan`).
Workspaces that used the first version (BL-013) on a plan without the feature lose it until the plan has it; there is no grandfathering.

## Settings

| Method and path | Key                     | What                                                                                                                    |
| --------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `GET /settings` | `crm.assignment.read`   | `{ enabled, applyToImports }`. Both default `false`                                                                     |
| `PUT /settings` | `crm.assignment.manage` | `{ enabled?, applyToImports? }`. Audited (`assignment.settings.updated`). `applyToImports`: assign imported records too |

## Rules

| Method and path            | Key    | What                                                                                                                      |
| -------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------- |
| `GET /rules`               | read   | `{ data: Rule[] }` of the three modules, each in list order                                                               |
| `POST /rules`              | manage | create (Idempotency-Key). Last in its module. At most 50 rules in all                                                     |
| `PATCH /rules/:id`         | manage | edit; needs the `rowVersion` read (409 `ROW_VERSION_CONFLICT` when stale). A changed method or pool restarts the rotation |
| `DELETE /rules/:id`        | manage | 204. The run log keeps the rule's name                                                                                    |
| `POST /rules/reorder`      | manage | `{ subject, ids }`: these rules first, in this order; the rest follow in their old order                                  |
| `POST /rules/:id/clone`    | manage | a copy named "<name> (copy)": paused, last in its module (Idempotency-Key)                                                |
| `POST /rules/:id/activate` | manage | the rule is prioritised and takes records                                                                                 |
| `POST /rules/:id/pause`    | manage | keeps its place, is not prioritised, never runs                                                                           |

A rule: `name`, `description` (500), `subject` (`contact` \| `company` \| `deal`, fixed once created), `rules` (the condition tree or `null`), `strategy`,
`userIds`, `teamIds`, `skipOffline`, `reassignOnUpdate`, `isActive`; read back with `isFallback`, `position`, `priority`, `firedCount`, `lastFiredAt`,
`brokenConditions`, `createdAt`, `updatedAt`, `lastModifiedBy`, `rowVersion`.

- **Conditions** (`rules`): the segment rule tree: `{ type: 'group', combinator: 'and' \| 'or', children: [condition \| group] }`, a condition being
  `{ type: 'condition', field, operator, value? }`. Up to three levels of groups and 50 conditions. The fields are those of the module
  (`ASSIGNMENT_FIELDS` in the contract): contacts take every contact field of a segment except owner and search, plus `origin`, `custom.<property key>` and
  `company.<company property key>`; companies take `name email phone domain industry sizeRange address status createdAt updatedAt origin` and `custom.<company property key>`;
  deals take `title value currency pipeline stage status source expectedCloseDate createdAt hasContact hasCompany origin` (deals have no custom properties). The operator must
  suit the field's kind (the same table as segments) and the value must have the operator's shape; `422 VALIDATION_FAILED` with `errors[].path` such as
  `rules.children.0.value` otherwise. A custom property, pipeline, stage, tag or person that does not exist is refused on save; one deleted later makes only
  that condition match nothing (`brokenConditions` counts them).
- **Fallback**: a rule with no condition (`rules: null`) matches every record and runs **after** every rule that has conditions, wherever it sits in the list.
- **Priority**: only active rules are numbered. `priority` 1 runs first; fallbacks come last; `position` is the place in the drag order. Of the rules a record matches, the
  highest priority one that finds somebody gives it away.
- **Method** (`strategy`): `round_robin` (default; continues after the last person who took a turn, by id, so people coming and going never repeat or skip a turn),
  `least_busy` (fewest owned records of the module now: contacts owned, companies owned, open deals owned; ties by the rotation), `fixed` (a specific single user; exactly one person, no team; if that
  person is on leave their delegate takes the record, with no delegate the rule finds nobody).
- **Who can take a record**: the named people plus the members of the named teams, who are active, **not on leave today** (the workspace calendar, `member_leaves`) and, when
  `skipOffline` (default on), not marked offline (`agent_statuses`). The picking functions are the team inbox's own (`common/agent-picker.ts`, `common/leave-delegate.ts`).
- **Legacy rules**: rules saved before this version have flat `conditions` instead of `rules`. They keep working (read as the tree `legacyConditionsToRules` makes of them, API shows that tree) and are replaced by a tree the first time they are edited.

## Test with a record and the run log

| Method and path | Key  | What                                                                                                                                                                          |
| --------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /test`    | read | `{ subject, recordId }` -> `{ enabled, outcome, record, rule, owner, trace, skipped }`. Changes nothing (no owner, cursor, counter or log row). Works while the switch is off |
| `GET /runs`     | read | `?subject&ruleId&recordId&outcome&limit&cursor` -> `{ data: Run[], nextCursor }`, newest first                                                                                |

Test `outcome`: `would_assign`, `disabled`, `has_owner` (the trace is still shown), `no_rule`, `nobody_available`, `plan`, `not_found`. `trace` lists every active rule in the order it was tried:
`{ ruleId, name, matched, nobody, broken }` (it stops at the rule that wins).

A **run** is one decision: `outcome` (`assigned`, `reassigned`, `skipped`), `reason` (`matched`, `has_owner`, `no_rule`, `nobody_available`, `raced`, `unchanged`), the rule (id and the name it had),
the person, the method, how the record arrived (`origin`: manual, import, inbound, form, lead, api), `trigger` (`created` or `updated`) and the trace. Logged: every decision about a new record (assigned, owner already
set, no rule matched, nobody available) and every assignment or reassignment on an update. An edit that finds nothing is not logged. The row holds ids and the rule's name only: the screen
reads the record's current name (never a phone number or email) when it lists the log, so erasing a person leaves nothing personal in the log. Kept **90 days** (`ASSIGNMENT_RUN_RETENTION_DAYS`), swept daily by the worker.

## When the engine runs (every write path)

The engine is one service, `ContactAssignmentEngine`, called by one outbox consumer in the worker, `ContactAssignmentConsumer`, for: `contact.created`, `company.created`, `deal.created`,
`form.submitted` (when it created the contact), `lead.created`, and for updates `contact.updated`, `company.updated`, `deal.updated`. Every path that writes these records already announces
them through the outbox (screens, REST API, import, forms, lead sources and Meta lead ads, flows, the mobile app), so there is no second code path. Events flagged `autoAssigned` (the engine's own writes) are ignored: an assignment cannot start another.
A creation that raises no event (the quiet bulk paths: WhatsApp address-book sync, inbox history import, campaign audience import) is not assigned, as before. Imports are assigned only when `applyToImports` is on.

Per record, in one transaction that holds the record's row lock: switch on, plan has `record_assignment`, then:

1. **Only records without an owner.** A record that has an owner, or whose owner a person ever set or cleared (`owner_changed_at` is stamped by a trigger on contacts, companies and deals), is never touched; a redelivered event does nothing (idempotent).
2. The active rules in priority order; the first whose conditions hold **and** that finds somebody fires. A rule that matches but finds nobody (everyone away or offline) is passed over; the next one is tried.
3. The owner is written only where the record still looks as it did (a lost race is outcome `raced`), with an audit row (`<module>.auto_assigned`), the owner-changed event (flagged) and `<module>.auto_assigned`, the rule's counters and a run row.
4. **Reassign on update** (rule option, default **off**): on an update event a record whose owner is still the engine's own last pick (same person and the owner stamp the engine wrote, so nobody changed it since) moves to the first matching rule when that rule is a different rule that has this option on. The same rule matching again, or a matching rule without the option, leaves the record. A record a person took over is never reassigned.

Contacts are marked uncontacted again after an assignment when the lead-handling setting says so (BL-290), exactly as for a manual reassignment.

## Differences from Freshsales

| Freshsales                                                                                                                                        | Here                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Territories and owners: both empty runs, both filled skips the rule, territory only runs, owner only runs when owner and record share a territory | The product has **teams**, not territories: records do not belong to a team. A team is a pool of people; a rule takes people, teams or both and uses their union. The territory/owner combinations do not exist |
| Round robin only                                                                                                                                  | Round robin (default), least open workload, specific single user                                                                                                                                                |
| Active/inactive                                                                                                                                   | Active, or paused (keeps its place); "Save and activate" and "Save as paused"                                                                                                                                   |
| Applies to new, imported and updated records                                                                                                      | New records always; imports when the switch says so; updated records when they still have no owner, or when the rule has "reassign on update"                                                                   |
| No log                                                                                                                                            | Run log with the reason and the trace; test with a record; broken-condition counts                                                                                                                              |
| Availability not considered                                                                                                                       | People on leave (and their delegate), and optionally offline people, are skipped. Working hours are **not** used (the product only has them for conversation routing)                                           |
| Modules: contacts, accounts, deals                                                                                                                | Contacts, companies, deals. Deals have no custom properties here                                                                                                                                                |

Reference (WaDesk) has no equivalent: its routing rules (`AssignmentService`, `RoutingEngine`) only assign conversations, and the same is true of the "Auto-assignment" tile in this product. The two screens link to each other.

## Events and audit

Audit module `assignment` (settings and rule changes: `assignment.settings.updated`, `assignment.rule.created|updated|deleted|reordered|activated|paused|cloned`) and, on the record's own module
(`contacts`, `companies`, `deals`), `contact.auto_assigned` / `company.auto_assigned` / `deal.auto_assigned` with `{ ownerId, ruleId }`. Outbox: `contact.updated` / `company.updated` / `deal.owner_changed`
flagged `autoAssigned: true`, and `<module>.auto_assigned { uuid, ownerId, ruleId, ruleName }`.
