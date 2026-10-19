---
domain: ai-copilot-lead-finder
code: AICRM
title: AI CRM Copilot
threadwise_version: '1.7.0'
sources_read: 3
---

# AI CRM Copilot

## Ownership note

`ownership.json` lists this domain's owner as `punya`. Per the project owner's explicit direction (2026-10-15, this
session — most of the original three-person team is no longer active on this project), this unit of work was built
outside that assignment with the owner's authorization. `ownership.json` itself was left unedited (no accurate
current roster to rewrite it against); flagging here instead so the override is visible in the domain's own record.

## Overview

This entry covers only the **AI CRM Copilot** (Reference `/ai-crm`): a chat surface where a staff member talks to an
LLM that runs the CRM by tool-calling — find/create contacts, companies and deals, move pipeline stages, create
invoices, record payments, create tasks, create proposals/estimates, and send WhatsApp messages. Every write tool is
confirm-before-act (the model never silently mutates data) and every tool run is audit-logged.

**Lead Finder**, the domain's other Reference feature (OpenStreetMap business scraping → enrich → bulk-add to
contacts), is explicitly **not** covered by this entry. It is parked to the backlog at the project owner's direction
and already shows as a disabled "coming soon" nav entry (`apps/web/src/features/_registry/planned.ts`) — leave that
as-is; do not build it as part of this domain's work without a separate decision to pick it up.

| Feature        | Controller                                                    | Model(s)                  | Route prefix | Plan gate                                                                   |
| -------------- | ------------------------------------------------------------- | ------------------------- | ------------ | --------------------------------------------------------------------------- |
| AI CRM Copilot | `AiCrmController` (Reference) → `AiCrmController` (this repo) | `AiCrmAction` (audit log) | `/ai-crm`    | `plan:access_ai_agents` (Reference) → `ai_crm_copilot` (new key, this repo) |

Actors: workspace manager+ (chat); workspace admin+ (the WhatsApp staff-channel toggle, `wa_copilot_enabled` — the
column already exists in `workspace_settings`, unwired, from an earlier unrelated migration; this domain is the first
to use it).

Main flow end to end: staff opens `/ai-crm`, types a message. The server resolves an AI provider/key the same way
every other AI feature in this repo does (`AiKeyResolver`: workspace BYOK key first, else the platform's), runs a
tool-calling loop (OpenAI function-calling / Anthropic tool_use / Gemini function-calling — whichever provider
resolved), executing READ tools immediately and parking any WRITE tool call as a pending confirmation ("Reply YES to
confirm, or NO to cancel"). A later message that reads as affirmative/negative resolves the pending action. Every
executed tool (read or write) writes one `ai_crm_actions` row with masked phone/email params, for the workspace's own
audit trail.

Connections: `ai-keys-usage-admin` (provider/key resolution, token metering — `AiKeyResolver`, `AiTokenMeter`), `crm`
(contacts/companies/deals/pipelines/tasks/invoicing/sales-docs — every write tool calls that domain's own
application service, never its repository directly, so RBAC/audit/outbox stay intact), `chat-conversations`
(`OutboundService.enqueue` for the two messaging tools), `plans-subscriptions-trials` (new plan-feature key).

## Open questions / port decisions to settle before building

1. **Conversation history storage.** Reference keeps the last 12 turns in the PHP session (server-side, per
   workspace). This repo has no server session store for this; port notes below record the Redis-cache approach
   taken (same cache the confirm-before-act "pending" state already uses) rather than inventing a new session layer
   or pushing history to the client (which would let a user tamper with it).
2. **Three Reference write tools have no backing feature in this repo and are recorded `blocked`, not silently
   dropped:**
   - `generate_brief` — Reference's Phase 5 "client brief/deck" generator (`BriefService`, shareable PDF). No
     equivalent domain or service exists anywhere in `crm-platform`.
   - `create_project` / `list_projects` — Reference's Phase 6 "delivery project" tracking (`Project` model). Gap-check
     (2026-10-15) confirmed no `projects` controller, service, table or feature directory exists anywhere in this
     repo; building it is its own domain-sized unit of work, not a side effect of the copilot.
     These three tool definitions are _not_ registered in this port's toolkit at all (an LLM cannot call a tool it was
     never told about) rather than registered-but-erroring, so the model never promises something that then fails.
3. **WhatsApp staff-channel bridge is recorded `blocked`, not built in this PR.** Reference answers the _same_
   copilot service from an inbound WhatsApp message when `wa_copilot_enabled` is on (a staff member DMs the
   workspace's own number). That requires hooking into the inbound-message pipeline (`node-bridge-runtime` /
   `whatsapp-cloud-api-waba` inbound handling) to recognize a staff sender and divert their message away from the
   normal customer-conversation path — a cross-cutting change into another domain's inbound pipeline, not something
   to do unilaterally from this domain. This PR ships the admin-only toggle (`POST /ai-crm/settings` writes the
   existing `wa_copilot_enabled` column) with no consumer yet, exactly like `ai-agents-training`'s WIRE-AIAG-012
   already records for a similar "stored but nothing reads it yet" case — port the toggle, not the bridge.
4. **Assignee / member resolution by name.** Reference resolves `assignee_name`/`owner_name` by a `LIKE` scan over
   workspace members. This repo's `TasksService.create` takes an assignee **uuid**, not a name. Port note: the
   copilot's own tool-execution layer resolves a name to a uuid via `MembersService.list({ search: name })` before
   calling the CRM service — this repo's services intentionally don't do fuzzy name matching themselves (RBAC-correct
   APIs take ids), so that resolution step belongs here, in the copilot, not retrofitted into `TasksService`.
5. **Invoice-number and quote-number lookup.** `PaymentsService.record` takes an invoice **uuid**; Reference's tool
   takes a human invoice number (e.g. "INV-0042") and looks it up. Same pattern as #4: the copilot resolves
   number→uuid itself via a read-only query, rather than adding a number-lookup method to `InvoicesService`/
   `SalesDocsService` that nothing else needs.

## Feature index

| Id           | Feature                                                                         | Status  | Priority | Effort | Depends on                       |
| ------------ | ------------------------------------------------------------------------------- | ------- | -------- | ------ | -------------------------------- |
| TW-AICRM-001 | Chat engine: multi-provider tool-calling loop, confirm-before-act, audit log    | done    | P0       | L      | -                                |
| TW-AICRM-002 | Dashboard chat screen, message/reset endpoints, recent-actions panel            | done    | P0       | M      | TW-AICRM-001                     |
| TW-AICRM-003 | Contact tools: `find_contact`, `create_contact`                                 | done    | P0       | S      | TW-AICRM-001                     |
| TW-AICRM-004 | Deal/pipeline tools: `list_deals`, `create_deal`, `move_deal_stage`             | done    | P0       | M      | TW-AICRM-001                     |
| TW-AICRM-005 | Company tools: `find_company`, `create_company`, `link_contact_company`         | done    | P0       | S      | TW-AICRM-001                     |
| TW-AICRM-006 | `sales_report` tool                                                             | done    | P1       | S      | TW-AICRM-004                     |
| TW-AICRM-007 | Invoicing/payment tools: `create_invoice`, `record_payment`, `list_outstanding` | done    | P1       | M      | TW-AICRM-001                     |
| TW-AICRM-008 | Task tools: `create_task`, `assign_task`, `complete_task`, `list_my_tasks`      | done    | P1       | M      | TW-AICRM-001                     |
| TW-AICRM-009 | `revenue_report` tool                                                           | done    | P1       | S      | TW-AICRM-007                     |
| TW-AICRM-010 | Quote tools: `create_quote`, `list_quotes` (proposals/estimates)                | done    | P1       | M      | TW-AICRM-001                     |
| TW-AICRM-011 | Messaging tools: `send_message`, `send_quote`                                   | done    | P1       | M      | TW-AICRM-010                     |
| TW-AICRM-012 | `generate_brief` tool (client brief/deck)                                       | blocked | P2       | M      | (no Briefs domain)               |
| TW-AICRM-013 | `create_project` / `list_projects` tools                                        | blocked | P2       | M      | (no Projects domain)             |
| TW-AICRM-014 | WhatsApp staff-channel bridge (inbound command routing)                         | blocked | P2       | L      | (cross-domain, inbound pipeline) |
| TW-AICRM-015 | WhatsApp staff-channel toggle (`wa_copilot_enabled`, admin-only)                | done    | P2       | S      | -                                |
| TW-AICRM-016 | Plan-feature gate (`ai_crm_copilot`) and permissions                            | done    | P0       | S      | -                                |

## Features

### TW-AICRM-001 — Chat engine: multi-provider tool-calling loop, confirm-before-act, audit log

- **Summary:** One service resolves the workspace's AI provider/key (`AiKeyResolver`, same resolver every other AI
  feature uses), then runs up to 5 tool-calling steps against whichever of OpenAI/Anthropic/Gemini resolved. A READ
  tool executes immediately and its result is fed back to the model. A WRITE tool is never executed on the first
  pass: it's parked (Redis, 10 minute TTL, keyed by org+user+channel) and the user is asked to confirm; a later
  affirmative message runs it, a negative one cancels it. Every tool invocation (read or write, successful or not)
  writes one `ai_crm_actions` row with masked phone/email params.
- **Source refs:** `app/Services/AiCrm/AiCrmCopilotService.php`, `app/Services/AiCrm/CrmToolkit.php` (Reference;
  behavior reference only).
- **Port notes:** no existing multi-turn tool-calling loop in this repo to reuse (`AiCallService` is single-shot) —
  built fresh under `infra/providers/ai-copilot-lead-finder/`. Routes every provider call through `AiKeyResolver` +
  `AiTokenMeter` exactly like `AiCallService` does, so token metering and the platform-key monthly cap apply here
  too. Tool definitions are provider-neutral (name/description/JSON-schema), converted to each vendor's exact wire
  shape at call time.

### TW-AICRM-002 — Dashboard chat screen, message/reset endpoints, recent-actions panel

- **Summary:** `/ai-crm` renders the chat; `POST /ai-crm/message` (throttled) relays one turn; `POST /ai-crm/reset`
  clears history. A side panel shows the last 12 executed actions (tool + summary + timestamp).
- **Source refs:** `AiCrmController::index/message/reset`.
- **Port notes:** history kept server-side in Redis (see Open question #1), not the client, so it can't be tampered
  with; capped at 12 turns like Reference.

### TW-AICRM-003 — Contact tools: `find_contact`, `create_contact`

- **Summary:** `find_contact` searches by name fragment or phone; `create_contact` resolves-or-creates by phone.
- **Source refs:** `CrmToolkit::findContact/createContact`.
- **Port notes:** `find_contact` calls `ContactsService.selectData` (name-fragment search); `create_contact` calls
  `ContactsService.resolveOrCreateByIdentity(tx, orgId, {kind:'phone', value, name})` inside the service's own
  `db.tx()` — the one method in this repo that already does exactly Reference's "find or create by phone" shape.

### TW-AICRM-004 — Deal/pipeline tools: `list_deals`, `create_deal`, `move_deal_stage`

- **Summary:** list open/won/lost deals, optionally by stage; create a deal (optionally linked to a contact by
  phone, with a value and stage); move an existing deal to a different stage by name fragment.
- **Source refs:** `CrmToolkit::listDeals/createDeal/moveDealStage`.
- **Port notes:** calls `DealsService.list`, `.create`, `.moveStage` — the normal RBAC-scoped application methods
  (not `DealsService.flowAction`, which runs as a system actor for the flow engine's own Deal node and is the wrong
  actor model for a user-driven chat). Stage-name-fragment resolution is done here against `PipelinesService`'s
  stage list, since the CRM service itself takes a stage uuid.

### TW-AICRM-005 — Company tools: `find_company`, `create_company`, `link_contact_company`

- **Summary:** search/create companies; link an existing contact to a company by name (creating the company if
  it doesn't exist).
- **Source refs:** `CrmToolkit::findCompany/createCompany/linkContactCompany`.
- **Port notes:** `CompaniesService.list` (name-fragment search), `.create`, `.linkContacts`.

### TW-AICRM-006 — `sales_report` tool

- **Summary:** open pipeline value, weighted forecast (probability-weighted by stage), deals won this month, win
  rate.
- **Source refs:** `CrmToolkit::salesReport`.
- **Port notes:** computed from `DealsService.list`/`PipelinesService` stage probabilities; a read-only aggregate,
  no new report endpoint needed elsewhere.

### TW-AICRM-007 — Invoicing/payment tools: `create_invoice`, `record_payment`, `list_outstanding`

- **Summary:** issue an invoice with line items for a named buyer; record a payment (optionally against an invoice
  number); list outstanding/aging invoices.
- **Source refs:** `CrmToolkit::createInvoice/recordPayment/listOutstanding`.
- **Port notes:** `InvoicesService.create`, `PaymentsService.record` (resolves a human invoice number to a uuid via
  a read-only lookup first — see Open question #5), `PaymentsService.outstanding`/`.aging`.

### TW-AICRM-008 — Task tools: `create_task`, `assign_task`, `complete_task`, `list_my_tasks`

- **Summary:** create a follow-up task (optional due date/priority/assignee-by-name); reassign or complete an
  existing task by id; list the caller's own open tasks.
- **Source refs:** `CrmToolkit::createTask/assignTask/completeTask/listMyTasks`.
- **Port notes:** assignee name resolved to a member uuid via `MembersService.list({search})` first (Open question
  #4), then `TasksService.create`/`.update`/`.complete`/`.myTasks`.

### TW-AICRM-009 — `revenue_report` tool

- **Summary:** money collected (30 days + all-time), outstanding, tax collected, paid/open invoice counts.
- **Source refs:** `CrmToolkit::revenueReport`.
- **Port notes:** built on `PaymentsService.aging` plus a payments-collected aggregate query.

### TW-AICRM-010 — Quote tools: `create_quote`, `list_quotes`

- **Summary:** create a priced proposal or estimate with line items, tax rate and expiry, returning a shareable
  public link; list recent quotes with status/total.
- **Source refs:** `CrmToolkit::createQuote/listQuotes`.
- **Port notes:** `SalesDocsService.create`, `.list`, `.getLink` for the share URL.

### TW-AICRM-011 — Messaging tools: `send_message`, `send_quote`

- **Summary:** send a plain WhatsApp text to a contact (by phone or name) through the workspace's own connected
  number; send an existing quote's share link the same way.
- **Source refs:** `CrmToolkit::sendMessage/sendQuote`.
- **Port notes:** resolves/opens a conversation (`InboxThreadService.open`) then `OutboundService.enqueue` — the
  same queued-send path the inbox UI itself uses, not a new dispatch mechanism. Returns once queued, matching
  Reference's "sent" framing (actual delivery is the worker's job, same as every other inbox message).

### TW-AICRM-012 — `generate_brief` tool (client brief/deck)

- **Port status (blocked):** no Briefs/client-deck feature exists anywhere in this repo (see Open question #2). Not
  registered in the toolkit.

### TW-AICRM-013 — `create_project` / `list_projects` tools

- **Port status (blocked):** no Projects domain exists anywhere in this repo (see Open question #2). Not registered
  in the toolkit.

### TW-AICRM-014 — WhatsApp staff-channel bridge (inbound command routing)

- **Port status (blocked):** needs a cross-domain change to the inbound WhatsApp message pipeline (see Open question
  #3). Not built in this PR.

### TW-AICRM-015 — WhatsApp staff-channel toggle (`wa_copilot_enabled`, admin-only)

- **Summary:** `POST /ai-crm/settings` (admin+ only) flips the existing `workspace_settings.wa_copilot_enabled`
  column. Nothing reads it yet (TW-AICRM-014 is blocked) — stored for when that bridge is built.
- **Source refs:** `AiCrmController::settings`.

### TW-AICRM-016 — Plan-feature gate (`ai_crm_copilot`) and permissions

- **Summary:** the whole `/ai-crm` route group is gated on a new plan-feature key and `aicrm.copilot.use`/
  `aicrm.copilot.manage` permission keys (chat vs. the WhatsApp-channel toggle).
- **Source refs:** Reference `plan:access_ai_agents` + `workspace.role:manager`/`workspace.role:admin` middleware.
- **Port notes:** new key `ai_crm_copilot` (default `false`, group `aiCalling`) in
  `packages/contracts/src/plans-subscriptions-trials/catalogue.ts` — deliberately not reusing `ai_assistants`
  (Reference's own `access_ai_chat_assistant`, a different flag already mapped to that key for `ai-agents-training`).
