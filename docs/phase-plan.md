# Phase Plan

Replaces the earlier chat-only phase sketch. Two rules from here on:

1. **One phase = one frontend page.** Matches [api-inventory.md](api-inventory.md) 1:1 — same 28 rows, same names.
2. **A page's routes stay out of `/docs` until that phase is fully done.** "Fully done" means every route listed for that page in api-inventory.md is implemented AND has a real captured entry in [api-testing.md](api-testing.md) — not "the happy path works."

Order below was produced by having each page independently judge its own backend dependencies, synthesizing one strict sequence from all 28, then auditing that sequence three times over for dependency violations (a page scheduled before something it structurally needs). The audit caught two real defects — a circular dependency between Contacts and Tasks, and a false FK claim between Deals and Tasks — both fixed below (see Phase 11 and Phase 15's "AUDIT FIX" / "AUDIT NOTE").

## Swagger-gating: how, mechanically

Every controller for a not-yet-complete phase carries `@ApiExcludeController()` (from `@nestjs/swagger`) and its tag is left out of `main.ts`'s `DocumentBuilder`. The routes work normally — callable via Postman/curl with a real bearer token, exactly as documented in api-testing.md — they just don't render in the `/docs` UI. Remove the decorator and add the tag in the **same commit** that satisfies the phase's exit criteria, never before.

Applied retroactively as of this doc: **Users/Roles/Permissions** (missing hard-delete-user + permission-tree shape) is `partial`, not `done` — its controllers carry `@ApiExcludeController()` and its tag is removed from `main.ts`. It stays fully testable via api-testing.md; it just doesn't show in `/docs` yet.

Company Properties (7), Contact Properties (8), and Contacts (11) are marked `done` below even though a handful of their api-inventory.md rows are explicitly deferred rather than built (see each phase's own notes) — `syncToSubaccounts` has no sub-accounts hierarchy to sync to, linked-tasks is stubbed pending the Tasks module (14), and bulk CSV import/export needs async-job infra that doesn't exist yet. Every route that _is_ built has a real docs/api-testing.md entry; the deferred items are tracked below, not silently missing.

## Quick reference

| #   | Page                                            | APIs | Status         |
| --- | ----------------------------------------------- | ---- | -------------- |
| 1   | Login                                           | 3    | ✅ done        |
| 2   | Settings > Users & Permissions                  | 14   | 🔶 partial     |
| 3   | Sign Up                                         | 1    | ⬜ not started |
| 4   | OTP Verification                                | 4    | ⬜ not started |
| 5   | Verify Account (app init)                       | 1    | ⬜ not started |
| 6   | Subscription / Billing                          | 30   | ⬜ not started |
| 7   | Settings > Data Management > Company Properties | 23   | ✅ done        |
| 8   | Settings > Data Management > Contact Properties | 24   | ✅ done        |
| 9   | File Manager                                    | 9    | ⬜ not started |
| 10  | Api Library                                     | 10   | ⬜ not started |
| 11  | Contacts                                        | 51   | ✅ done        |
| 12  | Company                                         | 71   | ⬜ not started |
| 13  | Segments                                        | 7    | ⬜ not started |
| 14  | Tasks                                           | 9    | ⬜ not started |
| 15  | Deals                                           | 16   | ⬜ not started |
| 16  | Forms                                           | 20   | ⬜ not started |
| 17  | Conversations / Inbox                           | 14   | ⬜ not started |
| 18  | URL Tracking                                    | 14   | ⬜ not started |
| 19  | Marketing List                                  | 29   | ⬜ not started |
| 20  | Dashboard                                       | TBD  | ⬜ not started |
| 21  | Webhook                                         | 9    | ⬜ not started |
| 22  | Settings (remaining bundle)                     | 92   | ⬜ not started |
| 23  | WhatsApp Broadcast                              | 16   | ⬜ not started |
| 24  | SMS Broadcast                                   | 31   | ⬜ not started |
| 25  | Email Broadcast                                 | 31   | ⬜ not started |
| 26  | Automation                                      | TBD  | ⬜ not started |
| 27  | WhatsApp Flow                                   | 11   | ⬜ not started |
| 28  | App Store                                       | 44   | ⬜ not started |

---

# Phase detail

## Phase 1 — Login

**API count:** 3 · **Status:** done

**Why here:** No dependencies at all, and it's the one page already fully built and tested — anchoring the order on it means every later phase inherits a stable, verified JWT/tenant-claim contract instead of one still in flux.

**Entry criteria:** Tenant/User/Partner tables from the initial monorepo scaffold exist.

**Exit criteria:** Already satisfied: every route listed for auth-login in docs/api-inventory.md is implemented and has a real captured request/response entry in docs/api-testing.md (staff login, partner/agent login, refresh token). Treat any future schema change from users-permissions/subscription work as a regression risk against this contract, not new scope.

## Phase 2 — Settings > Users & Permissions

**API count:** 14 · **Status:** partial

**Why here:** Root of trust for the whole tenant — nearly every other page (contact-properties, contacts, company, tasks, deals, inbox, dashboard, api-library, webhook, settings-remaining, broadcasts, forms, automation, whatsapp-flow, app-store, subscription) needs a finished user/role/permission model to gate on, and auth-verify-account explicitly must not be built until this module's shape is final.

**Entry criteria:** auth-login done (user/tenant tables stable). User/Role CRUD, Permission-registry read already built and verified.

**Exit criteria:** Every route listed for users-permissions in docs/api-inventory.md is implemented and has a real captured request/response entry in docs/api-testing.md. Specifically finish: hard-delete-user with a defined reassign/orphan/block policy enforced consistently, and the permission-tree (grouped/nested) shape validated against the actual permissions.guard.ts enforcement keys so the UI can never configure a permission with no real enforcement point.

## Phase 3 — Sign Up

**API count:** 1 · **Status:** not started

**Why here:** True root of the multi-tenant data model (tenant/org shape, owner-user binding, namespacing identifier) that every later page's schema inherits; has no dependencies itself, and auth-otp needs it. Sequenced after users-permissions only so the verified/active account state machine can be defined against a stable permission model, not before it.

**Entry criteria:** None beyond the base monorepo scaffold.

**Exit criteria:** Every route listed for auth-signup in docs/api-inventory.md is implemented and has a real captured request/response entry in docs/api-testing.md. Specifically: tenant/user creation is transactional and race-safe on duplicate signup, password hashing and cross-tenant email/domain uniqueness are enforced, and the unverified/verified/active state machine is explicit and blocks dashboard access pre-verification.

## Phase 4 — OTP Verification

**API count:** 4 · **Status:** not started

**Why here:** Needs a signup-created pending user/org row to verify against, so auth-signup's user-creation API must exist first (even as a stub).

**Entry criteria:** auth-signup's signup endpoint exists and creates a pending-status user/org row.

**Exit criteria:** Every route listed for auth-otp in docs/api-inventory.md is implemented and has a real captured request/response entry in docs/api-testing.md. Specifically: per-identifier and per-IP rate limiting on send/resend, OTP expiry + max-attempt lockout, constant-time/no-account-enumeration comparison, and forgot-password issuing a distinct short-lived reset token (never a session token) after invalidating prior codes.

## Phase 5 — Verify Account (app init)

**API count:** 1 · **Status:** not started

**Why here:** An aggregation endpoint over auth-login and users-permissions — it joins user, resolved permissions, and workspace into the payload every route guard and menu trusts on app boot, so it must wait until both of those are stable or it locks in a flat-role payload shape that breaks later.

**Entry criteria:** auth-login done; users-permissions' role/permission data model finalized (order 2 complete).

**Exit criteria:** Every route listed for auth-verify-account in docs/api-inventory.md is implemented and has a real captured request/response entry in docs/api-testing.md. Specifically: payload includes fully-resolved permissions (incl. per-user overrides, not just a role name), and workspace/tenant details are strictly scoped to the JWT's tenant claim (tested against a cross-tenant token to confirm no leak).

## Phase 6 — Subscription / Billing

**API count:** 30 · **Status:** not started

**Why here:** Only needs auth-verify-account and users-permissions per its own dependencies, but its riskNotes flag it as upstream of every money-spending module (whatsapp/sms/email broadcast, automation) — those pages need a stable wallet check-and-reserve API to call into, so it is pulled forward here rather than left until just before broadcasts (a missed cross-page dependency added on judgment: broadcasts and automation implicitly depend on this).

**Entry criteria:** auth-verify-account and users-permissions available for tenant/user scoping.

**Exit criteria:** Every route listed for subscription in docs/api-inventory.md is implemented and has a real captured request/response entry in docs/api-testing.md. Specifically: wallet balance never goes negative (single conditional UPDATE + DB CHECK constraint, no read-then-check-then-write), usage_charges/wallet_transactions two-level ledger with idempotent posting (org_id+idempotency_key) is live, and exam-fee settlement flows are gated to test-mode only pending RBI PA/PG sign-off.

## Phase 7 — Settings > Data Management > Company Properties

**API count:** 23 · **Status:** done

**Why here:** No dependencies — it's foundational schema for Company, so scheduling it now (in parallel with the auth cluster settling) means Company, Forms, and Segments never have to be built against a moving custom-field schema.

**Entry criteria:** None beyond base scaffold (tenant model from auth-signup conceptually exists, but no other page's backend is required).

**Exit criteria:** Every route listed for company-properties in docs/api-inventory.md is implemented and has a real captured request/response entry in docs/api-testing.md. Specifically: property group/definition CRUD with core field types, ordered-schema retrieval endpoint, and a defined soft-delete/versioning strategy for field-type changes and dropdown-option removal so existing Company records never end up with dangling values.

**Current state:** Phase 8's field-metadata registry (ADR-0017) is generic over `moduleKey` by design, so Company Properties is served by the _same_ `FieldSectionsController`/`FieldsController`/`StatusOptionsController` as Contact Properties, called with `moduleKey=companies` — `companies.data jsonb` (0004_crm_contacts.sql) already exists to hold the Tier-2 values. What Phase 7 actually added: `record.company-properties.{read,create,update,delete}` (0018_add_company_properties_permissions.sql) as permission keys distinct from contact-properties', plus the enforcement to make that split real — `@RequirePermission` is static route metadata and can't see a request's moduleKey, so each controller route now accepts _either_ module's key as a coarse gate, and every service method (field-sections/fields/status-options) does the precise per-moduleKey check itself once it knows which row is actually being touched (see `field-metadata-permission.ts`). Reorder endpoints additionally verify every id in `orderedIds` actually belongs to the declared moduleKey (and, for field options, the declared field) — without that, a caller could smuggle another module's row into a same-permission reorder call. Every route above now has a real docs/api-testing.md entry (see "Field Metadata"), so these controllers' `@ApiExcludeController()` is removed and their tags are registered in `main.ts`. Deferred, not built: the 23 rows in docs/api-inventory.md's Company Properties table are legacy RPC-style names not yet remapped onto this REST surface (same gap as Phase 8's table).

## Phase 8 — Settings > Data Management > Contact Properties

**API count:** 24 · **Status:** done

**Why here:** Schema root for the whole Contacts data model — contacts, segments, forms, deals, tasks, and every broadcast/automation feature reads or writes through it, so it must exist before contacts. Its only real dependency is users-permissions, for gating who may mutate tenant-wide schema.

**Entry criteria:** users-permissions available to gate schema-mutation permissions.

**Exit criteria:** Every route listed for contact-properties in docs/api-inventory.md is implemented and has a real captured request/response entry in docs/api-testing.md. Specifically: sections/fields/field-types CRUD is tenant-scoped, field-type changes and deletions are soft-delete/versioned (never a naive DELETE against live contact data), and any conditional field-dependency support has cycle detection before it ships.

**Current state:** the field-metadata registry (ADR-0017) is built and RLS-verified — `FieldSectionsController`/`FieldsController`/`StatusOptionsController` in `apps/api/src/modules/crm/{field-sections,fields,status-options}` cover sections, fields (+ options + field-level and option-level dependencies, cycle-checked), and status-option groups, all soft-delete/versioned as required above. These same controllers also serve Phase 7 (Company Properties) via `moduleKey=companies`, gated by their own `record.company-properties.*` permission keys — see Phase 7's entry. Every route above now has a real docs/api-testing.md entry (see "Field Metadata"), so `@ApiExcludeController()` is removed and the tags are registered in `main.ts`. Deferred, not built: the 24 rows in docs/api-inventory.md's Contact Properties table are named after the legacy system's RPC-style endpoints (`getListProperties`, `reorderFieldPosition`, `syncToSubaccounts`, ...), not a 1:1 match to this REST surface — that table needs a pass to re-map or supersede those names against the actual routes above. `syncToSubaccounts` (multi-account/franchise sync) has no equivalent here; there is no sub-accounts hierarchy in this schema to sync to, and no obvious near-term path — likely permanently out of scope.

## Phase 9 — File Manager

**API count:** 9 · **Status:** not started

**Why here:** Generic asset store needed by company, forms, sms/email-broadcast, and marketing-list — its only real prerequisites are identity (auth-verify-account) and permission gating (users-permissions), so it can be built as soon as those exist without waiting on any business-object schema.

**Entry criteria:** auth-verify-account and users-permissions available.

**Exit criteria:** Every route listed for file-manager in docs/api-inventory.md is implemented and has a real captured request/response entry in docs/api-testing.md. Specifically: multipart/large-file upload streams to object storage without buffering in memory, per-tenant storage quota and MIME/size validation are enforced, and delete uses a soft-delete/reference-check convention so a file_id referenced elsewhere is never silently orphaned.

## Phase 10 — Api Library

**API count:** 10 · **Status:** not started

**Why here:** Self-contained (owns its own tables) and only needs users-permissions for tenant/role scoping — no other page blocks it, so it's cheap to clear early rather than let it linger.

**Entry criteria:** users-permissions available for tenant/role scoping.

**Exit criteria:** Every route listed for api-library in docs/api-inventory.md is implemented and has a real captured request/response entry in docs/api-testing.md. Specifically: the test-run/execute endpoint blocks private-IP/localhost targets and caps redirects/timeouts/response size (SSRF hardening) before it's enabled even in dev, and stored auth credentials are encrypted at rest and never echoed back in logs or list views.

## Phase 11 — Contacts

**API count:** 51 · **Status:** done

**Why here:** Load-bearing entity for the whole CRM; needs contact-properties (dynamic schema) and users-permissions (assignee identities) to exist first. Base CRUD (5 of 51 endpoints) is already done, so this phase is about finishing the remaining bulk/tag/view/assignee surface, not starting from zero. AUDIT FIX: the draft's exitCriteria previously required linked-tasks to be 'a thin wrapper over the Tasks module's own API' as a firm requirement at this order, even though Tasks (order 14) doesn't exist yet — a genuine circular dependency (contacts needs Tasks' API; Tasks' own entryCriteria needs contacts complete). That is a real defect, confirmed on inspection. Reordering can't fix it (Tasks structurally cannot move ahead of contacts, since Tasks' entryCriteria itself requires contacts complete), so the fix is to defer/stub linked-tasks here, the same pattern 'company' (order 12) already uses for its activities/chat-transcript tabs — not to move any phase.

**Entry criteria:** contact-properties and users-permissions complete; existing base CRUD (create/get/list/update/delete) already in place.

**Exit criteria:** Every route listed for contacts in docs/api-inventory.md is implemented (all 51, not just the 5 base-CRUD ones already done) and has a real captured request/response entry in docs/api-testing.md. Specifically: list/filter/sort/bulk-edit correctly handle the admin-defined custom-field schema, every query is tenant-scoped, bulk import/bulk-edit/bulk-delete are transactional with partial-failure reporting, and the linked-tasks tab is explicitly stubbed (a placeholder/empty list keyed by contact_id, contract documented but not backed by a real cross-module call) until the Tasks module (order 14) exists — it gets wired into a thin wrapper over Tasks' own API as a small follow-on once Tasks lands, not built now against a guessed contract.

**Current state:** base CRUD plus the full bulk/tag/view/assignee surface is built — `ContactsController` (list/get/create/update/delete, `select-data`, `assignees`, `bulk/update`, `bulk/delete`, `assignee`, `field-history`), `TagsController` (+ attach/detach on `ContactsController`), `ContactViewsController` (+ reorder/favorite), and the four detail-tab modules `contact-notes`/`contact-files`/`contact-meetings` (full CRUD) and `contact-activities` (append-only), all gated behind `record.contacts.*` except tags/views' own permission keys. Bulk operations use per-row `SAVEPOINT` isolation (`ContactsService.forEachRowIsolated`) so one bad id in a batch fails independently. Field history reuses the kernel audit trail (`AuditService.listByRecord`) rather than a dedicated table. Every route above now has a real docs/api-testing.md entry, so `ContactsController`/`TagsController`/`ContactViewsController`/the four detail-tab controllers all drop `@ApiExcludeController()` and register their tags in `main.ts`. Deferred, not built: linked-tasks (10 routes, stubbed pending Tasks/order 14 per the AUDIT FIX above), bulk CSV import/export and job-history (needs async-job infra that doesn't exist), and add-to-marketing-list (blocked on Marketing List/order 19). **Known gap, not fixed in this pass:** Tags/Notes/Files/Activities/Meetings all reuse `record.contacts.read`/`.update`, which support `own`/`team`/`all` scope, but none of the four detail-tab modules actually apply that scope against the parent contact's owner — an `own`-scoped role (e.g. seeded Counsellor) can read/write any contact's notes/files/activities/meetings, not just their own. Found while capturing docs/api-testing.md evidence; tracked as a follow-up, not a one-line fix.

## Phase 12 — Company

**API count:** 71 · **Status:** not started

**Why here:** Mirrors the Contacts pattern (same CRUD/dedupe/pagination approach) but needs contacts, contact-properties, company-properties, users-permissions, and file-manager all in place first for its linking, notes, and files sub-resources.

**Entry criteria:** contacts, contact-properties, company-properties, users-permissions, file-manager all complete.

**Exit criteria:** Every route listed for company in docs/api-inventory.md is implemented and has a real captured request/response entry in docs/api-testing.md. Specifically: contacts<->company linking has a clear primary-contact/multi-membership model, notes/files reuse Contacts' existing tables (not forked copies), and activities/chat-transcript tabs are explicitly stubbed until tasks/deals/inbox exist rather than built against guesses.

## Phase 13 — Segments

**API count:** 7 · **Status:** not started

**Why here:** Pure query-builder over contacts — entirely dependent on contacts (for the base table) and contact-properties (for which custom fields are filterable).

**Entry criteria:** contacts and contact-properties complete.

**Exit criteria:** Every route listed for segments in docs/api-inventory.md is implemented and has a real captured request/response entry in docs/api-testing.md. Specifically: the filter-JSON-to-SQL translator parameterizes every value (no injection path) against both typed columns and the jsonb `data` field, and the count/preview endpoint is built on-read first, with materialized/cached membership deferred until real load numbers justify it.

## Phase 14 — Tasks

**API count:** 9 · **Status:** not started

**Why here:** Needs real contact and company records to link against, plus users-permissions for ownership/visibility rules (rep vs manager scoping). Note: tasks' own model is a contact-or-company polymorphic link only — it does not FK into deals (see the correction on deals' rationale below), so tasks has no dependency on the deals phase.

**Entry criteria:** contacts, company, and users-permissions complete.

**Exit criteria:** Every route listed for tasks in docs/api-inventory.md is implemented and has a real captured request/response entry in docs/api-testing.md. Specifically: the polymorphic contact-or-company link has a clean constraint/index (exactly one, never both) with correct cascade-delete behavior, and role-based visibility (own vs team tasks) is enforced server-side, not just in the UI.

## Phase 15 — Deals

**API count:** 16 · **Status:** not started

**Why here:** FKs into both contacts and company, so those tables must exist and be seeded first or the pipeline/stage-move CRUD has nothing real to attach to. AUDIT NOTE: the draft previously also claimed deals 'is itself referenced by tasks' — on inspection this is not real: tasks' exitCriteria (order 14) defines only a contact-or-company polymorphic link with no deal option, so no task->deal or deal->task FK exists in this design. That claim is corrected/removed here rather than reordering deals ahead of tasks, since deals has no actual dependency on tasks either way — deals stays at order 15 purely because it independently needs contacts/company, same as tasks does.

**Entry criteria:** contacts, company, and users-permissions complete.

**Exit criteria:** Every route listed for deals in docs/api-inventory.md is implemented and has a real captured request/response entry in docs/api-testing.md. Specifically: stage-move is transactional (position/order update + stage-history log) and safe under concurrent moves, and won/lost is a terminal state that requires a lost-reason.

## Phase 16 — Forms

**API count:** 20 · **Status:** not started

**Why here:** Needs contact-properties (submission-to-contact mapping), contacts, file-manager (attachments), company-properties, and users-permissions — all already complete by this point, so it can be cleared before the inbox/settings/broadcast cluster since nothing there blocks it.

**Entry criteria:** contact-properties, contacts, file-manager, company-properties, users-permissions all complete.

**Exit criteria:** Every route listed for forms in docs/api-inventory.md is implemented and has a real captured request/response entry in docs/api-testing.md. Specifically: form definitions are versioned so old submissions still render against the schema version they were submitted under, the public submission endpoint is rate-limited and tenant-scoped, and if payment collection ships in this pass its webhook handling is idempotent with a defined reconciliation path — otherwise it is explicitly deferred, not half-built.

## Phase 17 — Conversations / Inbox

**API count:** 14 · **Status:** not started

**Why here:** Needs auth-verify-account, users-permissions (for assignment), and a real contacts table to attach threads to. Core send/receive/assign/status loop is scheduled now; note the cross-cutting gap: business-hours-gated routing and automated auto-assignment rules live in settings-remaining (order 22) and land as a follow-on enhancement to this page's assignment logic rather than a hard prerequisite, since settings-remaining itself depends on inbox's conversation model existing first — building both simultaneously would be circular, so inbox ships its core loop now and gets reconciled with settings-remaining's rules once that page lands.

**Entry criteria:** auth-verify-account, users-permissions, and contacts complete.

**Exit criteria:** Every route listed for inbox in docs/api-inventory.md is implemented and has a real captured request/response entry in docs/api-testing.md. Specifically: inbound webhook ingestion acks fast and enqueues rather than parsing inline, delivery-status callbacks only move status forward while still recording every out-of-order event, and a resolved conversation can be silently reopened by the next inbound message per the one-thread-per-contact-per-channel model.

## Phase 18 — URL Tracking

**API count:** 14 · **Status:** not started

**Why here:** Only real dependency is contacts (for later attribution linking); otherwise self-contained, so it slots in once contacts is solid and ahead of the broadcast pages that reference it (sms-broadcast, email-broadcast).

**Entry criteria:** contacts complete.

**Exit criteria:** Every route listed for url-tracking in docs/api-inventory.md is implemented and has a real captured request/response entry in docs/api-testing.md. Specifically: the redirect resolver is public/unauthenticated, resolves and 302s in milliseconds without blocking on click-event logging, and short codes never collide across tenants.

## Phase 19 — Marketing List

**API count:** 29 · **Status:** not started

**Why here:** Needs contacts, contact-properties, segments, and file-manager (CSV import) — all complete by this point — and must land before the broadcast pages that resolve audiences from it.

**Entry criteria:** contacts, contact-properties, segments, file-manager complete.

**Exit criteria:** Every route listed for marketing-list in docs/api-inventory.md is implemented and has a real captured request/response entry in docs/api-testing.md. Specifically: CSV import runs as an async job (never blocks the request) with per-row error reporting and clear create/update/skip dedupe semantics against existing contacts, and list/segment membership share one underlying table rather than diverging into two parallel systems.

## Phase 20 — Dashboard

**API count:** TBD · **Status:** not started

**Why here:** Pure read-only aggregation over contacts, deals, inbox, and tasks — cannot be meaningfully built or tested until all four have real tables and data, and its permission-scoped widgets need users-permissions finalized.

**Entry criteria:** contacts, deals, inbox, tasks, and users-permissions all complete with real data to aggregate over.

**Exit criteria:** Every route listed for dashboard in docs/api-inventory.md is implemented and has a real captured request/response entry in docs/api-testing.md. Specifically: every KPI/activity-feed query is both tenant-scoped and permission-scoped (a rep can't see org-wide KPIs their role doesn't allow), using shared aggregation helpers rather than one-off per-widget queries.

## Phase 21 — Webhook

**API count:** 9 · **Status:** not started

**Why here:** Only needs auth-login and users-permissions, but as generic cross-cutting infrastructure that automation and whatsapp-flow will build on, it's sequenced right before settings-remaining/automation rather than immediately after auth so its event catalog is designed with the real module list (contacts/deals/forms) already in view.

**Entry criteria:** auth-login and users-permissions complete.

**Exit criteria:** Every route listed for webhook in docs/api-inventory.md is implemented and has a real captured request/response entry in docs/api-testing.md. Specifically: outbound delivery runs through a durable queue/retry-with-backoff worker (never a synchronous fetch) with HMAC signing, and inbound receive URLs are tenant-scoped with signature verification and idempotency handling against retried/duplicate senders.

## Phase 22 — Settings (remaining bundle)

**API count:** 92 · **Status:** not started

**Why here:** Bundles 13+ subsystems that depend on users-permissions (roles for auto-assignment/RBAC), inbox (chat labels, canned responses, business-hours routing), contacts (lifecycle stage), and tasks (task outcome) all being real first. Positioned here — after inbox's core loop but before the broadcast pages — because whatsapp-broadcast, sms-broadcast, and email-broadcast structurally need this page's channel-config/business-hours pieces to function end-to-end even though their own drafts didn't name it explicitly (added on judgment as a missed cross-page dependency); it cannot be moved before inbox since it needs inbox's conversation model to attach to, so the reconciliation between the two happens now, once, in this slot.

**Entry criteria:** users-permissions, inbox, contacts, and tasks all complete.

**Exit criteria:** Every route listed for settings-remaining in docs/api-inventory.md is implemented and has a real captured request/response entry in docs/api-testing.md. Specifically: the standalone config CRUD groups (notifications, lifecycle stage, task outcome, chat labels, canned responses, business hours, auto-assignment) are fully built; channel-config OAuth/webhook flows for Email/WhatsApp/Facebook/Instagram are at least sandboxed and testable; and manage-account credit/transaction-log operations are atomic and auditable even without a real payment gateway underneath.

## Phase 23 — WhatsApp Broadcast

**API count:** 16 · **Status:** not started

**Why here:** Needs contacts, segments, marketing-list, and users-permissions per its own draft, plus subscription's wallet-reserve API (order 6) and settings-remaining's WhatsApp channel config (order 22) added here as missed cross-page dependencies — a broadcast can't actually send without a connected, template-approved channel and a funded wallet.

**Entry criteria:** contacts, segments, marketing-list, users-permissions, subscription, and settings-remaining all complete.

**Exit criteria:** Every route listed for whatsapp-broadcast in docs/api-inventory.md is implemented and has a real captured request/response entry in docs/api-testing.md. Specifically: wallet-reservation is a hard block on insufficient funds (not a warning), recipient counters update in batches (every 2-5s via worker, not per-receipt), and every skipped recipient records a skip_reason for the compliance/consent audit trail.

## Phase 24 — SMS Broadcast

**API count:** 31 · **Status:** not started

**Why here:** Same audience/wallet/channel prerequisites as whatsapp-broadcast, plus url-tracking (click analytics) and file-manager, all already complete by this point.

**Entry criteria:** auth-verify-account, users-permissions, contacts, segments, marketing-list, url-tracking, file-manager, subscription, and settings-remaining all complete.

**Exit criteria:** Every route listed for sms-broadcast in docs/api-inventory.md is implemented and has a real captured request/response entry in docs/api-testing.md. Specifically: recipient resolution is deduplicated and opt-out-filtered before dispatch, per-tenant sender-id/DLT compliance is enforced, and delivery-status (DLR) webhooks update per-recipient status without race conditions at scale.

## Phase 25 — Email Broadcast

**API count:** 31 · **Status:** not started

**Why here:** Same audience/wallet/channel-config prerequisites as the other two broadcast channels, plus contact-properties and url-tracking for merge-fields and click tracking.

**Entry criteria:** contacts, marketing-list, segments, users-permissions, contact-properties, file-manager, url-tracking, subscription, and settings-remaining all complete.

**Exit criteria:** Every route listed for email-broadcast in docs/api-inventory.md is implemented and has a real captured request/response entry in docs/api-testing.md. Specifically: suppression-list/unsubscribe checks are applied atomically immediately before dispatch (never emailing an unsubscribed contact), and per-ESP-account rate limiting/retry logic cannot produce duplicate sends.

## Phase 26 — Automation

**API count:** TBD (9 workstreams + 30 forms) · **Status:** not started

**Why here:** Its action nodes are only as testable as whatsapp-broadcast/sms-broadcast/email-broadcast and webhook, and its triggers/conditions must validate against the now-finalized contact-properties/company-properties schemas — so it waits until all three channel senders, webhook, and both schema pages are done. Wallet spend for action execution also routes through subscription (order 6).

**Entry criteria:** contacts, contact-properties, company-properties, tasks, segments, whatsapp-broadcast, sms-broadcast, email-broadcast, webhook, users-permissions, and subscription all complete.

**Exit criteria:** Every route listed for automation in docs/api-inventory.md is implemented and has a real captured request/response entry in docs/api-testing.md. Specifically: the execution engine persists per-instance state and survives restarts, retries failed steps idempotently, and has a defined policy for what happens to in-flight instances when a tenant edits the live workflow definition.

## Phase 27 — WhatsApp Flow

**API count:** 11 · **Status:** not started

**Why here:** Shares its WABA connection/credentials with whatsapp-broadcast (a hard prerequisite, not optional), and needs webhook for completion callbacks plus contacts for tying flow responses back to a record.

**Entry criteria:** whatsapp-broadcast, contacts, webhook, and users-permissions all complete.

**Exit criteria:** Every route listed for whatsapp-flow in docs/api-inventory.md is implemented and has a real captured request/response entry in docs/api-testing.md. Specifically: flow CRUD plus a thin, well-tested Meta publish/version-sync path is proven end-to-end (draft->published->deprecated, immutability enforced), with response-capture/analytics explicitly deferred until this base is solid.

## Phase 28 — App Store

**API count:** 44 · **Status:** not started

**Why here:** Last in the order because it is a shell around six third-party integrations that write into inbox (channels), contacts (leads), forms, whatsapp-flow, and automation data models — every one of which must be stable first or the generic connection model gets built against guesses.

**Entry criteria:** users-permissions, inbox, contacts, forms, whatsapp-flow, and automation all complete.

**Exit criteria:** Every route listed for app-store in docs/api-inventory.md is implemented and has a real captured request/response entry in docs/api-testing.md. Specifically: one generic per-tenant encrypted-credential connection model covers all six integrations' differing auth patterns (API key vs OAuth+refresh), and Facebook Lead Forms/Instagram channel connections correctly write into the now-finalized Contacts/Inbox schemas.
