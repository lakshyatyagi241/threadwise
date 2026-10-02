# Port map: platform-support-desk (SUPP)

Spec: `inventory/platform-support-desk.md`. Zone: `ownership.json` key `platform-support-desk`. Status: the ticket core (customer form and
thread, operator inbox and panel, reply, assign, status, priority) is built and tested; the rest is listed under "Not built".

## Shape

Two surfaces on one table family, deliberately split by identity pool:

| Surface           | Who                                  | API base                       | Database door                                                                        |
| ----------------- | ------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------ |
| Customer form     | any signed-in workspace user         | `/v2/support/tickets`          | `DatabaseService.tx()` (tenant RLS) plus `user_id = me` in every statement           |
| Operator helpdesk | platform operators (`OperatorGuard`) | `/v2/platform/support/tickets` | `SupportStore.tx()` (privileged; the only `.privileged(` in the module, unit-tested) |

A ticket belongs to the organization of the user who filed it (its RLS tenant, `org_id`); Reference's `workspace_id` is that `org_id`. Staff
cross tenants through `SupportStore`, exactly as `PlanStore` and `PlatformStore` do.

## Modules and files

`apps/api/src/modules/platform-support-desk/`: `ticket-rules.ts` (pure state rules), `customer-tickets.{service,controller}.ts`,
`operator-tickets.{service,controller}.ts`, `support-mailer.service.ts` (reply email through the global `MAIL_PORT`), `support-store.ts`,
`platform-support-desk.module.ts`, `index.ts` (barrel: the module only).

## Tables

Existing (migration `20261001102800_supp_threadwise_schema.sql`): `support_tickets`, `support_messages`, plus `support_agents`,
`support_assignments`, `playbooks`, `platform_notes` (not used yet). New migrations:

- `20261003090000_supp_core.sql`: `assigned_agent_id` now references `platform_operators` (a ticket is worked by an operator, which a tenant
  `users` row can never be); CHECKs for status, priority, reason and message author role; `support_messages.email_status`; index
  `(created_at DESC, id DESC)` for the cross-organization inbox.
- `20261003090100_supp_message_author.sql`: `support_messages.author_operator_id` (operator replies and notes); at most one of
  `author_user_id` / `author_operator_id`.

RLS stays tenant-shaped (`org_id = current_org_id() OR app_is_privileged()`, forced, USING and WITH CHECK); verified by
`test/integration/platform-support-desk/support-schema.spec.ts` as the restricted role.

## Contracts (`packages/contracts/src/platform-support-desk/tickets.ts`)

`createSupportTicketRequestSchema`, `supportReplyRequestSchema`, `customerTicketListResponseSchema`, `customerTicketDetailSchema`,
`operatorTicketListQuerySchema`, `operatorTicketListResponseSchema`, `operatorTicketDetailSchema`, `operatorReplyRequestSchema`,
`setTicketStatusRequestSchema`, `setTicketPriorityRequestSchema`, `assignTicketRequestSchema`, `ticketAssigneesResponseSchema`, the status,
priority and reason enums. Every id is a uuid; the ticket number `TKT-XXXXXX` is the human handle.

## Endpoints

Customer (`@ActorKinds('user')`, no permission key: not role- or plan-gated, as in Reference)

| Method | Path                            | Feature         |
| ------ | ------------------------------- | --------------- |
| POST   | `/v2/support/tickets`           | TW-SUPP-001/002 |
| GET    | `/v2/support/tickets?limit=10`  | TW-SUPP-003     |
| GET    | `/v2/support/tickets/:id`       | TW-SUPP-004     |
| POST   | `/v2/support/tickets/:id/reply` | TW-SUPP-005     |

Operator (`@ActorKinds('platform_operator')`, `OperatorGuard`; writes `@OperatorRoles('super_admin','support')`, auditors read)

| Method | Path                                        | Feature         |
| ------ | ------------------------------------------- | --------------- |
| GET    | `/v2/platform/support/tickets`              | TW-SUPP-007     |
| GET    | `/v2/platform/support/tickets/assignees`    | TW-SUPP-011     |
| GET    | `/v2/platform/support/tickets/:id`          | TW-SUPP-008     |
| POST   | `/v2/platform/support/tickets/:id/reply`    | TW-SUPP-009/010 |
| PATCH  | `/v2/platform/support/tickets/:id/status`   | TW-SUPP-012     |
| PATCH  | `/v2/platform/support/tickets/:id/priority` | TW-SUPP-013     |
| PATCH  | `/v2/platform/support/tickets/:id/assignee` | TW-SUPP-011     |

## Permissions

None added. Operators have roles, not capability keys: reads for every role, writes for `super_admin` and `support` (Reference enforced nothing
on this surface). The seeded Reference `support.*` keys stay unused (TW-SUPP-034 is dead code there too). Customer routes need only a signed-in user.

## Events and audit

Same transaction as the write. Outbox (aggregate `support_tickets`): `support.ticket.created`, `.customer_replied`, `.replied`,
`.note_added`, `.status_changed`, `.priority_changed`, `.assigned`. Audit rows go to the TICKET's organization with
`actor_type = 'platform_operator'` for operator actions. No consumers exist yet; the reply email is sent after commit by `SupportMailer`
(not through the outbox) and its outcome is stored on the message (`email_status`).

## Web

- Customer: `(app)/(platform-support-desk)/support` (form, reason rail, last ten tickets) and `support/[id]` (thread, reply); nav entry in
  the Help group (replaces the planned placeholder).
- Operator: `(admin)/(platform-support-desk)/admin/support` (KPI tiles, filters, cursor-paged table, slide-in panel, `?open=<id>` deep link);
  entry in the console menu (`operator-nav.ts`).
- Messages: `messages/en/platform-support-desk.json`.

## Prerequisites from other domains

AUTH (built: operator guard, tenant users, sessions), ASHELL (admin sidebar badge counts, not built; the menu entry is added to the operator
nav list), SET (mail settings `from_email`/`app_name`/`app_url`: not built, the mailer uses `APP_NAME`/`WEB_APP_URL` from env), NOTIF
(admin notification bell: not built), TIB1/TIB2 (conversation model and `sla_policies` for SLA, platform inbox: not built), WSP (workspace flags,
suspension, impersonation: not built).

## Build order

1. Migrations and Drizzle (done). 2. Contracts (done). 3. Customer API, operator API (done). 4. Web: customer, operator (done).
2. Next: agents roster (017/018), kanban (015/016), SLA board and engine (026-030, needs TIB2 `sla_policies`), reports and CSV (031/032),
   playbooks (022-024), customers (020/021), platform inbox (037-046, needs TIB1/TIB2 and WSP).

## Not built (honest list)

TW-SUPP-006 attachments, 014 SLA pills, 015/016 kanban, 017-019 agents, 020/021 customers, 022-025 playbooks, 026-030 SLA, 031/032 reports and
export, 033 audit feed screen (rows are written), 035 reply-by-email, 037-046 platform inbox. Assignment is to active operators (a
`support_agents` roster is the next step), so the panel's agent list is "every active super admin and support operator".

## Risks

- The reply email depends on the platform mailer (`MAIL_PORT`); without SMTP the reply is saved and marked `failed` on the message.
- Cross-organization reads rely on the privileged door; keep every new operator query inside `SupportStore` and covered by the unit
  test that bans `.privileged(` elsewhere in the module.
- `ticket_number` uniqueness is global and relies on the unique index plus a retry on `ON CONFLICT DO NOTHING`.
