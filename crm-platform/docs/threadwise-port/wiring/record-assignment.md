# Wiring map: record assignment rules (BL-013, BL-340 to BL-345)

Scope of this map: the rules that give a new (or edited) contact, company or deal to a sales owner, the engine that runs them, every writer of a record that can trigger them,
and every screen that shows the result. A product extension: Reference has no equivalent (its `AssignmentService` / `RoutingEngine` only assign conversations).
API: [docs/api/record-assignment.md](../../api/record-assignment.md). Earlier design: [specs/contact-owner-leave-and-delegation.md](../../specs/contact-owner-leave-and-delegation.md) section 10.

## Route, permission, plan

| Id            | What            | Where                                                                                                                                                                                                                                            |
| ------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| WIRE-RASG-001 | Web route       | `/record-assignment` in `apps/web/src/app/(app)/(record-assignment)`; the old `/contact-assignment` redirects to it. Reached ONLY from the Settings tile `record-assignment` (Automation section); no menu entry, no tile under Contacts         |
| WIRE-RASG-002 | API routes      | `apps/api/src/modules/crm/contact-assignment/contact-assignment.controller.ts` (`/v2/assignment/*`, registered in `crm.module.ts`)                                                                                                               |
| WIRE-RASG-003 | Permission keys | `crm.assignment.read`, `crm.assignment.manage` (migration `20261130090100`, labels reworded by `20270115090000`). Defaults: Admin, Workspace admin, Manager                                                                                      |
| WIRE-RASG-004 | Plan gate       | plan feature `record_assignment` on the whole controller (`@RequirePlanFeature`), in the engine, and as `planFeature` of the settings tile (paywall). Seeded by `20270115090000` on the plans that carry `inbox_sla`; explicit `false` elsewhere |
| WIRE-RASG-005 | Cross-links     | the conversation tile `auto-assignment` (team inbox routing) and this screen link to each other; the two never share rules                                                                                                                       |

## Tables

`assignment_settings` (switch, imports), `assignment_rules` (rules; `rules` jsonb tree, legacy `conditions`, `rr_cursor`, `updated_by`), `assignment_runs` (run log, ids only, 90 days),
`contacts.owner_changed_at`, `deals.owner_changed_at` (stamp triggers from `20261130090000`), `companies.owner_changed_at` (trigger added by `20270115090000`). Read: `users`, `teams`, `team_members`,
`member_leaves`, `member_delegates`, `agent_statuses`, `fields` (custom properties), `tags`, `pipelines`, `pipeline_stages`. All tenant tables have forced RLS.
Personal-data registry: `assignment_runs` stores no name, phone, email or contact link (record ids and rule names only), so it needs no registry entry; `registry.spec.ts` passes.

## Writers of an owner (the engine's trigger points)

Every writer below announces its record through the outbox; `ContactAssignmentConsumer` (worker) is the one place the engine is called. There is no call from a request handler.

| Id            | Writer                                             | Event the consumer reads                             | Notes                                                                                                                                                                     |
| ------------- | -------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WIRE-RASG-006 | New contact (screen, API, public REST API, mobile) | `contact.created`                                    | `via` decides `origin`                                                                                                                                                    |
| WIRE-RASG-007 | Contact import                                     | `contact.created` with `via: import`                 | assigned only when the switch `applyToImports` is on                                                                                                                      |
| WIRE-RASG-008 | Web form that creates a contact                    | `form.submitted` with `created: true`                | an existing contact that fills a form again keeps its owner                                                                                                               |
| WIRE-RASG-009 | Lead sources, Meta lead ads                        | `lead.created`                                       | a lead source with its own owner pool sets an owner first: the engine then leaves it                                                                                      |
| WIRE-RASG-010 | Flows (create contact action)                      | `contact.created`                                    | loop guard: events flagged `autoAssigned` are ignored                                                                                                                     |
| WIRE-RASG-011 | WhatsApp and chat inbound (first message)          | `contact.created` with `via: inbound/whatsapp/chat`  |                                                                                                                                                                           |
| WIRE-RASG-012 | New company (screen, API, form)                    | `company.created`                                    |                                                                                                                                                                           |
| WIRE-RASG-013 | New deal (screen, API, lead source, flows)         | `deal.created`                                       | origin is `manual` unless the payload says otherwise                                                                                                                      |
| WIRE-RASG-014 | Edits                                              | `contact.updated`, `company.updated`, `deal.updated` | assigns a record still without an owner; reassigns the engine's own pick for rules with the option                                                                        |
| WIRE-RASG-015 | NOT covered (quiet paths: no event by design)      | none                                                 | WhatsApp address-book sync, inbox history import, campaign audience import and the Cloud API inbox sink create contacts without `contact.created`; unchanged since BL-013 |

Other places that set an owner and are deliberately unchanged: the per-source owner rule of a lead source, a web form or a Meta lead form (`ownerMode`: fixed / round robin / unassigned, `features/lead-sources`,
`features/web-forms` settings, `common/leave-owner-pool.ts`). They are part of those objects' own set-up, not an assignment screen; the record leaves them with an owner, so the engine skips it.
Reviewed for the owner's "no second entry point" instruction: none was removed.

## Consumers of the result

| Id            | Consumer                                 | Where                                                                                                                                                                                                                                                                             |
| ------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WIRE-RASG-016 | Owner column, filters, segments, reports | read `owner_id` / `owner_user_id`; nothing special                                                                                                                                                                                                                                |
| WIRE-RASG-017 | Flows and webhooks                       | `contact.updated` / `company.updated` / `deal.owner_changed` with `autoAssigned: true`, and `<module>.auto_assigned`                                                                                                                                                              |
| WIRE-RASG-018 | Uncontacted marker                       | `ContactTouchService.afterReassign` after a contact assignment, when the lead-handling setting says so                                                                                                                                                                            |
| WIRE-RASG-019 | Audit log                                | `assignment.*` (module `assignment`) and `<module>.auto_assigned` on the record                                                                                                                                                                                                   |
| WIRE-RASG-020 | Worker                                   | `AssignmentRunSweepService` (daily 03:23) deletes runs older than 90 days                                                                                                                                                                                                         |
| WIRE-RASG-021 | Shared code                              | `common/agent-picker.ts` (round robin, least busy), `common/leave-delegate.ts`, `common/workspace-calendar.ts` (leave); segment predicates (`crm/segments/segment-compiler.ts`, `contacts/contact-predicates.ts`, `property-predicates.ts`); web `features/segments` rule builder |

## Not built (recorded, not dropped)

Territories as a property of a record; working hours as availability; per-person daily cap; weighted rotation; "owner of the record's company" strategy; custom properties on deals (the product has none);
running a rule over existing records on demand; the engine inside the writer's own transaction (it runs from the outbox, after the write has committed, which cannot fail the write).
