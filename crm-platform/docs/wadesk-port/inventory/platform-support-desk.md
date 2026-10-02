---
domain: platform-support-desk
code: SUPP
title: Platform Support Desk (operator helpdesk, customer ticket form, platform inbox)
wadesk_version: '1.7.0'
sources_read: 62
---

# Platform Support Desk (operator helpdesk, customer ticket form, platform inbox)

## Overview

This domain is the **SaaS operator's own helpdesk**: how a paying workspace user asks the platform owner for help, and how the platform owner's staff triage, answer, measure and moderate. It has three surfaces that are easy to confuse and must be kept separate in the rebuild:

1. **Customer ticket form (`/support`)** - any signed-in user (not tied to a workspace role or plan) files a ticket, sees their own last ten tickets, opens a thread and can reply. Tickets are owned by the _user_ (`user_id`) and stamped with the user's current workspace.
2. **Operator helpdesk (`/admin/support/*`)** - the "Support" group of the admin console: Inbox (table + slide-in panel), Team-inbox kanban, Agents, SLA board, Customers, Playbooks, Reports. Everything is platform-scoped (no tenant filter), reachable only by platform admins behind the admin + IP-allowlist middleware. It is a classic status/priority/assignee ticket system with an SLA timer engine, canned "playbook" macros and a CSV export.
3. **Platform inbox (`/admin/team-inbox`)** - a _different_ tool that shares only the name "team inbox": a cross-workspace, read-mostly oversight view of the **workspace conversations** (WhatsApp/Meta/etc. threads that belong to TIB1/TIB2) for SLA-breach, spam and unassigned triage, with platform-only notes, spam flagging, workspace flags/suspension and an impersonation launcher. Its JSON endpoints live in `AdminTeamInboxController`.

Main flow end to end (helpdesk): user submits a ticket -> row in `support_tickets` (status `open`, priority `normal`) -> appears in the operator Inbox and kanban "New" column with sidebar badge counts -> an admin opens the panel, assigns it, replies (customer is emailed; first non-note reply stamps `first_response_at` and moves `open` to `in_progress`), changes status/priority or runs a manual playbook -> resolving stamps `resolved_at` once -> customer can reply to reopen -> Reports/SLA board measure first-response and resolution against platform-wide SLA policies.

Plan tiers: none. The customer form and thread are not plan-gated, not workspace-role-gated and not rate-limited. The operator side has no per-permission gating either (see WD-SUPP-034): any platform admin can do everything except the platform-inbox JSON endpoints, which check Spatie `platform.*` permissions.

Big honesty notes for the rebuilder (details in the features and in Open questions): the SLA breach scanner `support:sla-scan` is **never scheduled or invoked**, so `sla_breaches` stays empty in a stock install and the SLA board, "SLA compliance" KPIs are effectively decorative; playbook auto-triggers, agent auto-assignment, reply-by-email, ticket attachments and auto-close are advertised in UI copy but have no code path; the workspace flag/suspend endpoints in the platform inbox have no buttons; support audit rows land in the _workspace_ audit layer of the acting admin.

Connections: RBAC (platform roles/permissions used by the platform inbox; `support.*` keys seeded but unused), ASHELL (admin sidebar badges, `EnsureUserIsAdmin`, IP allowlist, admin layout), WSP (workspace suspension, `workspace_flags`, impersonation `POST admin/impersonate/{workspaceId}`, workspace `business_hours`/`timezone`), NOTIF (`audit_logs` writer `Audit`/`AuditLogger`, admin notification feed listing new tickets, reply email view), TIB1/TIB2 (conversation model, `sla_policies` table shared with workspace SLA, conversation notes/events), AUTH (`/account?tab=support` and `/more` chip read `support_tickets`), SET (mail from address / app name / app URL settings used by the reply email), CMS (support-guidebook doc page shared with Guidebook articles).

## Feature index

| Id          | Feature                                                          | Status      | Priority | Effort | Depends on        |
| ----------- | ---------------------------------------------------------------- | ----------- | -------- | ------ | ----------------- |
| WD-SUPP-001 | Customer submits a support ticket                                | implemented | P0       | M      | AUTH              |
| WD-SUPP-002 | Ticket number generation                                         | implemented | P0       | S      | WD-SUPP-001       |
| WD-SUPP-003 | Customer ticket history on /support and account summaries        | implemented | P1       | S      | WD-SUPP-001       |
| WD-SUPP-004 | Customer ticket thread view                                      | implemented | P0       | S      | WD-SUPP-001       |
| WD-SUPP-005 | Customer follow-up reply and auto-reopen                         | implemented | P0       | S      | WD-SUPP-004       |
| WD-SUPP-006 | Attachment picker on the ticket form (client-only)               | docs-only   | P2       | S      | WD-SUPP-001       |
| WD-SUPP-007 | Operator support inbox: list, KPIs, filters, search              | implemented | P0       | M      | WD-SUPP-001       |
| WD-SUPP-008 | Ticket detail slide-in panel                                     | implemented | P0       | M      | WD-SUPP-007       |
| WD-SUPP-009 | Reply to customer or add internal note                           | implemented | P0       | M      | WD-SUPP-008       |
| WD-SUPP-010 | Customer reply notification email                                | implemented | P0       | S      | WD-SUPP-009, SET  |
| WD-SUPP-011 | Assign or unassign a ticket                                      | implemented | P0       | S      | WD-SUPP-008       |
| WD-SUPP-012 | Change ticket status (resolved_at rules)                         | implemented | P0       | S      | WD-SUPP-008       |
| WD-SUPP-013 | Change ticket priority                                           | implemented | P1       | S      | WD-SUPP-008       |
| WD-SUPP-014 | SLA snapshot pills on the ticket panel                           | implemented | P1       | S      | WD-SUPP-029       |
| WD-SUPP-015 | Team-inbox kanban board                                          | implemented | P1       | M      | WD-SUPP-007       |
| WD-SUPP-016 | Kanban drag-and-drop status move                                 | implemented | P1       | S      | WD-SUPP-015       |
| WD-SUPP-017 | Support agent roster with live stats                             | implemented | P1       | M      | WD-SUPP-007       |
| WD-SUPP-018 | Add, toggle and remove support agents                            | implemented | P1       | S      | WD-SUPP-017       |
| WD-SUPP-019 | Agent auto-assignment and workload tracking                      | docs-only   | P2       | M      | WD-SUPP-018       |
| WD-SUPP-020 | Customers ranked by support load                                 | implemented | P2       | S      | WD-SUPP-007       |
| WD-SUPP-021 | Customer workspace ticket history                                | implemented | P2       | S      | WD-SUPP-020       |
| WD-SUPP-022 | Playbook library and builder                                     | implemented | P2       | M      | WD-SUPP-008       |
| WD-SUPP-023 | Pause, activate and delete playbooks                             | implemented | P2       | S      | WD-SUPP-022       |
| WD-SUPP-024 | Run a playbook on a ticket                                       | implemented | P2       | M      | WD-SUPP-022       |
| WD-SUPP-025 | Playbook automatic triggers (status change, tag added)           | docs-only   | P2       | L      | WD-SUPP-022       |
| WD-SUPP-026 | SLA board: policies, breaches, KPIs                              | implemented | P1       | M      | WD-SUPP-029       |
| WD-SUPP-027 | Create SLA policy                                                | implemented | P1       | S      | WD-SUPP-026       |
| WD-SUPP-028 | Update and delete SLA policy                                     | partial     | P2       | S      | WD-SUPP-026       |
| WD-SUPP-029 | SLA calculation engine (policy pick, business hours, severity)   | implemented | P1       | L      | WD-SUPP-027       |
| WD-SUPP-030 | SLA breach scanner command                                       | partial     | P1       | M      | WD-SUPP-029       |
| WD-SUPP-031 | Support reports dashboard                                        | implemented | P1       | M      | WD-SUPP-007       |
| WD-SUPP-032 | Ticket CSV export                                                | implemented | P2       | S      | WD-SUPP-031       |
| WD-SUPP-033 | Helpdesk audit trail                                             | partial     | P1       | S      | NOTIF             |
| WD-SUPP-034 | Support permission keys (seeded, never enforced)                 | dead-code   | P2       | S      | RBAC              |
| WD-SUPP-035 | Advertised but missing: reply-by-email, auto-close, admin alerts | docs-only   | P2       | M      | WD-SUPP-009       |
| WD-SUPP-036 | Legacy support mock code (dead)                                  | dead-code   | P2       | S      | WD-SUPP-007       |
| WD-SUPP-037 | Platform inbox page and bootstrap                                | implemented | P1       | M      | RBAC, WSP         |
| WD-SUPP-038 | Cross-workspace conversation queue                               | implemented | P1       | M      | WD-SUPP-037, TIB1 |
| WD-SUPP-039 | Read-only conversation drawer                                    | implemented | P1       | M      | WD-SUPP-038       |
| WD-SUPP-040 | Platform-only notes on a conversation                            | implemented | P1       | S      | WD-SUPP-039       |
| WD-SUPP-041 | Mark conversation as spam (global)                               | implemented | P1       | S      | WD-SUPP-039       |
| WD-SUPP-042 | Flag and clear workspace flags (API only)                        | partial     | P1       | S      | WSP               |
| WD-SUPP-043 | Suspend and unsuspend workspace (API only)                       | partial     | P1       | S      | WSP               |
| WD-SUPP-044 | Platform audit feed panel                                        | implemented | P1       | S      | NOTIF             |
| WD-SUPP-045 | Impersonate launcher from the drawer                             | implemented | P1       | S      | WSP               |
| WD-SUPP-046 | Platform inbox permission model and staff-role reality           | partial     | P1       | S      | RBAC              |

## Features

### WD-SUPP-001 — Customer submits a support ticket

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** AUTH (signed-in user), WD-SUPP-002
- **Summary:** A signed-in user opens `/support`, picks one of seven reasons in a left rail, fills name, reply email, subject and message and submits. A `support_tickets` row is created for them and they are sent back to the same page with a success banner and the new ticket highlighted in their list.
- **Actors & access:** any authenticated user (middleware `web` + `auth` only). No workspace role gate, no plan gate, no throttle, no CAPTCHA. Guests hitting the POST are redirected to `login`. Platform scope: the ticket is stamped with `users.current_workspace_id` (nullable) but the customer never chooses a workspace.
- **UX & screens:** `resources/views/user/support/index.blade.php` (user layout, nav-key `more`, back arrow to `/more`, badge "Live support inbox"). Left rail "Pick a reason" with seven buttons: `bug` (Something is broken, default active), `delivery` (Message delivery), `template` (Template approval), `billing` (Billing & plans), `integration` (Integration help), `account` (Account access), `other` (Something else); each has an icon tile and a one-line hint. Clicking a reason moves the active highlight, rewrites the small category label above the form title ("How can we help?") and copies the value into a hidden `reason` input (two small scripts do this: `resources/js/charts/user-support-index.js` for label/highlight and an inline script for the hidden field). Form fields: Your name (required, prefilled from the user), Reply email (required, prefilled, monospace), Subject (required), "Tell us what happened" textarea (7 rows, required). Helper copy claims "Markdown supported" but messages are rendered as plain pre-wrapped text (no markdown anywhere). Footer text: submitting shares account context with the support team; buttons Cancel (does nothing) and "Send to support". Validation errors render as a coral list above the main grid; success banner is a mint strip. Old input is repopulated on validation failure.
- **Endpoints:**

  | Endpoint     | Route name         | Action                        | Middleware | Request                               | Response                                                           |
  | ------------ | ------------------ | ----------------------------- | ---------- | ------------------------------------- | ------------------------------------------------------------------ |
  | GET support  | user.support       | SupportTicketController@index | web, auth  | -                                     | HTML page with `tickets` (last 10) and `prefill` name/email        |
  | POST support | user.support.store | SupportTicketController@store | web, auth  | reason, name, email, subject, message | 302 to `user.support` with flash `success` and `new_ticket_number` |

- **Data:** writes `support_tickets`: `user_id` (auth user), `workspace_id` (`current_workspace_id`), `ticket_number`, `reason`, `name`, `email`, `subject`, `message`, `status='open'`; DB defaults give `priority='normal'`, timestamps; `assigned_agent_id`, `sla_policy_id`, `first_response_at`, `tags`, `meta`, `resolved_at` stay null. No `support_messages` row is created for the initial message: the first message lives in `support_tickets.message` and every thread renderer prepends it as a synthetic "initial" bubble.
- **Rules & edge cases:**
  1. Validation: `reason` required, one of bug|delivery|template|billing|integration|account|other; `name` required string max 191; `email` required valid email max 191; `subject` required string max 191; `message` required string max 20000.
  2. The email is editable and is the only address replies go to; it is not tied to the account email after creation.
  3. No duplicate/flood protection: the same user can create unlimited tickets, back to back.
  4. `reason` is stored but never displayed anywhere in the operator UI (list, panel, kanban, CSV); the panel JSON returns it but the JS ignores it. Do not treat it as routing input (no code routes by it).
  5. `workspace_id` may be null (user with no current workspace); such tickets are invisible in the Customers pages (they group only rows with a workspace).
  6. Flash text is "Ticket {number} created - we'll follow up shortly." and the new number highlights the matching row in the "Recent tickets" list for one request.
  7. No confirmation email is sent to the customer and no notification is pushed to admins on creation (admins discover it via sidebar badge counts, the admin notification bell feed, and the Inbox page).
  8. Attachments are not accepted server-side (see WD-SUPP-006).
- **Async & events:** none. No queue, no mail, no websocket, no audit row on creation.
- **External systems:** none.
- **Settings:** none. (`support_email` in general settings is only a display/invoice value; the form does not use it.)
- **Acceptance criteria:**
  - Given a signed-in user with a current workspace, when they submit reason `billing`, valid name/email, subject and a message, then a ticket with status `open`, priority `normal`, their user id and workspace id and a `TKT-` number exists and they are redirected to `/support` with a success banner naming the number.
  - Given a message of 20001 characters or an invalid email, when they submit, then nothing is created and the field errors show with their input preserved.
  - Given an unauthenticated visitor, when they POST `/support`, then they are redirected to the login page and nothing is created.
  - Given the user picks "Message delivery" then submits, then `reason` is stored as `delivery`.
  - Given the same user submits twice quickly, then two distinct tickets with different numbers exist (no dedupe).
- **Source refs:** app/Http/Controllers/SupportTicketController.php; app/Models/SupportTicket.php; resources/views/user/support/index.blade.php; resources/js/charts/user-support-index.js; routes/web.php (support routes); database/migrations/2026_05_19_010000_create_support_tickets_table.php.
- **Port notes:** New tenant-less (platform-owned) table `support_tickets` with a nullable `workspace_id` attribute (NOT an RLS tenant column: platform staff must read across workspaces, the submitting user only their own rows). Suggested home `apps/api/src/modules/admin/support-desk` for staff routes and a small `customer-support` controller for `/support`. Validate with a shared zod contract (max lengths above). Consider adding a per-user rate limit (WaDesk has none) and a confirmation email; log both as deliberate deviations. Keep `reason` as a filterable enum even though WaDesk never surfaces it.

### WD-SUPP-002 — Ticket number generation

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-SUPP-001
- **Summary:** Every ticket gets a short human-readable, non-sequential number like `TKT-A1B2C3`, unique across the platform, shown in every list, in the panel, in the CSV and in the reply email.
- **Actors & access:** system, at ticket creation.
- **UX & screens:** shown as `#TKT-XXXXXX` in operator rows, panel header, customer thread header and email footer.
- **Endpoints:** none (internal helper `SupportTicket::freshTicketNumber`).
- **Data:** `support_tickets.ticket_number` varchar(16), unique index `support_tickets_ticket_number_unique`.
- **Rules & edge cases:**
  1. Format: literal `TKT-` plus 6 random alphanumeric characters upper-cased (mixed random string, so digits and letters).
  2. Up to 5 attempts, each checked with an existence query; on 5 collisions a fallback `TKT-` + 4 random upper-case chars + `-` + last 4 digits of the unix time is used; the DB unique index is the last line of defense (a collision there surfaces as a 500, there is no retry).
  3. Numbers are not sequential and leak nothing about ticket volume. The customer thread URL uses the numeric id, not the number.
  4. Operator search matches the number with a substring `LIKE` (so `tkt-a1` matches, case depends on collation; MySQL collation here is case-insensitive).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a new ticket, when created, then its number matches `^TKT-[A-Z0-9]{6}$` (or the documented fallback shape) and is unique.
  - Given a forced collision on the first candidate, when generating, then a second candidate is tried before the fallback.
  - Given a ticket number, when an operator searches part of it in the Inbox, then that ticket is returned.
- **Source refs:** app/Models/SupportTicket.php (freshTicketNumber); database/migrations/2026_05_19_010000_create_support_tickets_table.php.
- **Port notes:** Generate in the service with a retry loop and rely on a unique index; use a cryptographically random alphabet without ambiguous characters if desired (WaDesk does not), keep the `TKT-` prefix so exports stay comparable. Postgres varchar(16) fits both shapes.

### WD-SUPP-003 — Customer ticket history on /support and account summaries

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-SUPP-001
- **Summary:** Under the form, "Recent tickets" lists the user's last ten tickets with number, status pill, subject, a 140-char excerpt and the date; each links to the thread. The same ticket data feeds an account "Support" tab and a count chip on the `/more` page.
- **Actors & access:** authenticated user, own tickets only (`support_tickets.user_id = auth id`), so teammates never see each other's tickets even inside one workspace.
- **UX & screens:** card "Your history / Recent tickets" (only rendered when at least one ticket exists) with a "Full history ->" link to `/account?tab=support`. Row: `#number`, pill, optional "just submitted" tag when the number equals the session flash, subject (serif), message excerpt (2-line clamp), `M d` date. Status pill mapping is inline: `awaiting_user` "your turn" (amber), `awaiting_support` "awaiting reply" (mint), `resolved` "resolved" (neutral), anything else "open" (mint). QUIRK: because of that mapping, `closed`, `pending` and `in_progress` tickets all display as "open"; and the legacy `awaiting_*` values were remapped by migration 2026_05_23_160344 (awaiting_support -> pending, awaiting_user -> in_progress) so those two pill styles can never appear. `SupportTicket::statusLabel()` exists with the same mapping and is unused.
- **Endpoints:** GET support (WD-SUPP-001 table). Account tab: `AccountController@index` (AUTH) loads all of the user's tickets (no limit) ordered by id desc and computes `open` = status not `resolved` (QUIRK: `closed` counts as open), `resolved`, `all`; `UserPagesController` `/more` computes `supportTotal` (all) and `supportOpen` (status not `resolved`).
- **Data:** reads `support_tickets` where `user_id = me`, ordered `id` desc, limit 10 on this page.
- **Rules & edge cases:**
  1. Soft-deleted tickets are excluded automatically (model uses SoftDeletes) but nothing in the product deletes tickets.
  2. The history list does not show reply counts, unread indicators or last-activity time; only the creation date.
  3. "Open" everywhere on the customer side means `status != resolved`, which counts `closed` as open (inconsistent with the operator side where open-like = open|in_progress|pending). Preserve or fix deliberately; document the choice.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a user with 12 tickets, when they open `/support`, then exactly the 10 newest by id are listed.
  - Given a user whose colleague filed a ticket in the same workspace, when they open `/support`, then the colleague's ticket is not listed.
  - Given a ticket just submitted, when the page reloads after the redirect, then its row carries the "just submitted" tag.
  - Given a `closed` ticket, when listed, then its pill reads "open" (WaDesk behavior; flagged for the port as a bug-compatible choice).
- **Source refs:** app/Http/Controllers/SupportTicketController.php (index); app/Http/Controllers/AccountController.php; app/Http/Controllers/UserPagesController.php; app/Models/SupportTicket.php; resources/views/user/support/index.blade.php.
- **Port notes:** Expose `GET /support/tickets?limit=10` plus a `GET /support/summary` (counts) that the account tab and `/more` chip can share. Fix the pill to use the real status vocabulary; keep a mapping table in one place.

### WD-SUPP-004 — Customer ticket thread view

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-SUPP-001
- **Summary:** The customer opens `/support/{id}` and sees the full conversation with support: their original message, then every non-internal reply from support or themselves in time order.
- **Actors & access:** authenticated user who owns the ticket; anyone else gets a 404 (query is scoped by `user_id`). Platform admins have their own route (WD-SUPP-008) and do not use this one.
- **UX & screens:** `resources/views/user/support/show.blade.php`. Header: breadcrumb "Support . #number", subject as H1, status pill (open=amber, in progress=deep green, pending=coral, resolved=mint, closed=grey, shown with underscores replaced by spaces), "Opened {relative}" and, when set, "Resolved {relative}". Thread: first card "You . initial" with the original message (pre-wrapped), then each message: `author_role = admin` shows "Support team" on a green bubble, every other role shows "You" (QUIRK: a `system` role would be labelled "You"; no code writes `system` messages). Timestamps use the user's local zone via helper `wa_local` (`M j, Y . H:i`). Reply form (WD-SUPP-005) or a "ticket is closed" card with a link to open a new ticket; a "Back to all tickets" link.
- **Endpoints:**

  | Endpoint         | Route name        | Action                       | Middleware               | Request | Response                                           |
  | ---------------- | ----------------- | ---------------------------- | ------------------------ | ------- | -------------------------------------------------- |
  | GET support/{id} | user.support.show | SupportTicketController@show | web, auth (`id` numeric) | -       | HTML; 404 if not owned; guests redirected to login |

- **Data:** reads `support_tickets` (by id + user_id) and `support_messages` for the ticket ordered by `created_at` ascending, filtering `is_internal_note = false OR NULL`.
- **Rules & edge cases:**
  1. Internal notes are never returned to the customer (server-side filter, not just hidden).
  2. There is no unread/read tracking, no attachments rendering (attachments JSON column unused), no markdown.
  3. The route constraint `whereNumber('id')` means non-numeric ids 404 before the controller.
  4. Messages by other users on the same ticket cannot exist (only the owner can reply), so "You" is always the owner.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given ticket 7 owned by user A, when user B requests `/support/7`, then the response is 404.
  - Given an internal note and a public reply on the ticket, when the owner opens the thread, then only the public reply appears.
  - Given a `closed` ticket, when the owner opens it, then no reply form is shown and a "open a new ticket" link is.
  - Given an admin reply, when the owner opens the thread, then it is labelled "Support team".
- **Source refs:** app/Http/Controllers/SupportTicketController.php (show); resources/views/user/support/show.blade.php; app/Models/SupportMessage.php.
- **Port notes:** Enforce ownership in the query, never via a post-load check. Return the initial message as a real first message row in the new model (WaDesk's synthetic first bubble complicates exports and SLA math); if you keep the WaDesk shape, do it in the read model only.

### WD-SUPP-005 — Customer follow-up reply and auto-reopen

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-SUPP-004
- **Summary:** The owner can add a reply to their ticket. Replying to a resolved (or closed) ticket reopens it so it reappears in the operator queue.
- **Actors & access:** authenticated ticket owner; POST is scoped by `user_id` (404 for others).
- **UX & screens:** "Reply" card on the thread page: textarea (4 rows, required, placeholder about adding details or a screenshot link) and "Send reply". When status is `resolved` a hint says replying reopens the ticket. When `closed` the card is replaced (form hidden), but the endpoint itself still accepts a reply (QUIRK: a hand-crafted POST reopens a closed ticket). Success: redirect back to the thread with "Reply sent."
- **Endpoints:**

  | Endpoint                | Route name         | Action                        | Middleware | Request                         | Response                              |
  | ----------------------- | ------------------ | ----------------------------- | ---------- | ------------------------------- | ------------------------------------- |
  | POST support/{id}/reply | user.support.reply | SupportTicketController@reply | web, auth  | body (required string max 8000) | 302 to `user.support.show` with flash |

- **Data:** inserts `support_messages` (`ticket_id`, `author_user_id` = user, `author_role='customer'`, `body`, `is_internal_note=false`, `created_at=now`); updates `support_tickets.last_reply_at = now`; if status is `resolved` or `closed` sets `status='in_progress'` and `resolved_at = null`.
- **Rules & edge cases:**
  1. A reply on `pending` ("awaiting customer") does NOT move the ticket to any other status (QUIRK: the kanban "Awaiting customer" card stays there after the customer answers until an operator moves it).
  2. A reply never touches `first_response_at` (only operator non-note replies set it) and does not reset SLA windows.
  3. `resolved_at` cleared on reopen means the next resolution gets a fresh timestamp (see WD-SUPP-012).
  4. No email/notification is sent to staff (see WD-SUPP-035); the only signals are the ticket reappearing in the open counts and `last_reply_at` changing (which nothing sorts by).
  5. No rate limit; empty/whitespace bodies fail the `required` rule.
- **Async & events:** none; no audit row.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a resolved ticket, when the owner replies, then a customer message is stored, the status becomes `in_progress`, `resolved_at` is null and `last_reply_at` is set.
  - Given a pending ticket, when the owner replies, then the status stays `pending`.
  - Given another user, when they POST a reply to the ticket, then 404 and no message is stored.
  - Given a body over 8000 chars, when submitted, then validation fails and nothing is stored.
- **Source refs:** app/Http/Controllers/SupportTicketController.php (reply); app/Models/SupportMessage.php; resources/views/user/support/show.blade.php.
- **Port notes:** Make "reopen on customer reply" a single domain rule in the ticket service (status transition table) and decide explicitly whether `pending -> open/in_progress` should happen (WaDesk does not). Emit a `support.ticket.customer_replied` outbox event so staff notifications can be added later.

### WD-SUPP-006 — Attachment picker on the ticket form (client-only)

- **Status:** docs-only
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-SUPP-001
- **Summary:** The ticket form shows a dashed "Drop files or browse" area (images, PDF, TXT, LOG, CSV, "max 10 MB each") and lists chosen files with a Remove button, but the files are never uploaded or submitted.
- **Actors & access:** any signed-in user on `/support`.
- **UX & screens:** in `user/support/index.blade.php`, a hidden file input (`accept image/*,.pdf,.txt,.log,.csv`, multiple, no `name` attribute, form is not multipart) plus the global `window.handleAtt` (defined in `user-support-index.js`) that renders a row per file with icon, name, KB size, type and a Remove link. Clicking the drop area opens the file dialog. There is no drag-and-drop handler and no size/type enforcement despite the copy.
- **Endpoints:** none (no server path).
- **Data:** `support_messages.attachments` (JSON) and the panel/thread views exist in the schema but nothing writes or reads them.
- **Rules & edge cases:**
  1. Files chosen are discarded on submit; the customer gets no warning.
  2. "max 10 MB each" and the accepted-type list are copy only.
  3. The operator side has no attachment UI at all.
- **Async & events:** none.
- **External systems:** none (would need object storage; see SET storage).
- **Settings:** none.
- **Acceptance criteria:**
  - Given the form, when the user picks two files, then two rows appear with sizes and Remove works (cosmetic parity).
  - Given the real port, when a user attaches a file, then it is uploaded to storage, linked to the ticket message and visible to both customer and operator (this is a deliberate improvement over WaDesk).
- **Source refs:** resources/views/user/support/index.blade.php; resources/js/charts/user-support-index.js; database/migrations/2026_05_23_154446_support_module_phase1_schema.php (attachments column).
- **Port notes:** Decide scope: either drop the widget or build real attachments through the platform storage abstraction (STORAGE/SET) with virus/size/type validation; store as `support_message_attachments` rows instead of a JSON blob.

### WD-SUPP-007 — Operator support inbox: list, KPIs, filters, search

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-SUPP-001, ASHELL
- **Summary:** `Admin -> Support -> Inbox` lists every ticket across the platform, newest first, with four KPI tiles, status/priority/assignee filters and free-text search, twelve per page. Clicking a row opens the ticket panel (WD-SUPP-008).
- **Actors & access:** platform admins only (`web`, `auth`, `EnsureUserIsAdmin`, `IPAllowlist`; see ASHELL). No `support.*` permission check.
- **UX & screens:** `resources/views/admin/support/index.blade.php`, admin key `support`, JS `admin-support-index.js`. Header breadcrumb "Admin > Support inbox"; button "Kanban view" links to the kanban (WD-SUPP-015). Success flash strip (mint) from redirects. KPI tiles: Open, Unassigned (coral border), Resolved 24h, All-time. Filter bar (GET form, selects auto-submit on change): Status (All, open, in progress, pending, resolved, closed), Priority (urgent, high, normal, low), Agent (All, "Assigned to me", "Unassigned"), search box (placeholder "Search ticket / customer"), and a "Clear" link when any filter is active. Table columns: When (date `M j` + time `H:i`, server zone), Subject/Customer (subject bold or "(no subject)", second line `#number . name-or-email`), Priority pill, Status pill (underscore replaced by space), Assignee (name or "unassigned" or `User #id` when the user row is missing), "Open ->". Whole row is clickable. Pagination links under the table. Empty state "No tickets match the current filters."
- **Endpoints:**

  | Endpoint          | Route name          | Action                              | Middleware                                   | Request                                                                                                  | Response |
  | ----------------- | ------------------- | ----------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------- |
  | GET admin/support | admin.support.index | Admin\Support\InboxController@index | Authenticate, EnsureUserIsAdmin, IPAllowlist | `status`, `priority`, `agent` (`me`\|`unassigned`), `q`, `page`, `open` (deep link, handled client side) | HTML     |

- **Data:** reads `support_tickets` (all rows, soft-delete scope on), `users` (assignee names via one `whereIn` keyed lookup), `support_agents` (active, with user) for the panel assign dropdown, `playbooks` (active AND `trigger_type = manual`, ordered by name) for the panel run dropdown. Ordering: `created_at` desc. Page size 12, query string preserved.
- **Rules & edge cases:**
  1. Filters are exact matches on `status` and `priority` (any string accepted, no enum validation: an unknown value simply returns zero rows).
  2. `agent=me` filters `assigned_agent_id = auth id`; `agent=unassigned` filters null.
  3. Search `q` (trimmed) is a `LIKE %q%` over subject, name, email and ticket_number; no fulltext, no message-body search.
  4. KPI definitions: Open = status in (open, pending, in_progress); Unassigned = null assignee AND status in (open, pending) (note: excludes in_progress); Resolved 24h = `resolved_at` within the last 24 hours (regardless of current status); All-time = total count. KPIs ignore the active filters.
  5. `assigned_agent_id` stores a `users.id` (not a `support_agents.id`).
  6. There is no bulk action, no sorting control, no saved views, no export from this page (export is on Reports, WD-SUPP-032).
  7. The `/admin/support/{id}` GET returns JSON, not a page; deep links use `?open={id}` on this list.
- **Async & events:** none (page refreshes on navigation only, no polling or websocket).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 30 tickets, when an admin opens the Inbox, then 12 rows show newest first with working pagination that keeps active filters.
  - Given filter `agent=me`, when applied, then only tickets assigned to the current admin's user id show.
  - Given `q` equal to part of an email, when submitted, then tickets whose name/email/subject/number match are listed.
  - Given a non-admin user, when they request `/admin/support`, then 403.
  - Given no tickets match, when filtered, then the empty-state row appears and KPIs still show global numbers.
- **Source refs:** app/Http/Controllers/Admin/Support/InboxController.php; resources/views/admin/support/index.blade.php; routes/admin.php (support group); resources/js/charts/admin-support-index.js; docs Documentation/pages/admin-panel/support-guidebook.html.
- **Port notes:** Home `apps/api/src/modules/admin/support-desk/tickets`. Use keyset or offset pagination (12 default). Add a status/priority enum check and an index on `(status, priority)` and `(assigned_agent_id)` as WaDesk does. Search should be `ILIKE` on the four fields plus optionally a trigram index. Platform staff queries run in a platform-context DB role that bypasses tenant RLS (support tables are platform-owned).

### WD-SUPP-008 — Ticket detail slide-in panel

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-SUPP-007
- **Summary:** A 520px panel slides in from the right with the ticket subject/number, status and priority quick-action pills, an assign dropdown, a "Run playbook" picker, SLA pills, customer/workspace meta, the whole thread and a reply box. It is a progressively-enhanced page: every action is a normal form POST and the page reloads with the panel re-opened.
- **Actors & access:** platform admins (same middleware as the Inbox).
- **UX & screens:** `aside#support-panel` inside `admin/support/index.blade.php`, behavior in `resources/js/charts/admin-support-index.js`. Opening: clicking a row (or arriving with `?open={id}`) calls `GET /admin/support/{id}` (Accept JSON), rewrites all form `action`s to `/admin/support/{id}/{verb}`, shows "Loading..." then renders. The URL is updated with `history.replaceState` (`?open=id`) so a reload or a redirect-back re-opens the same ticket; closing removes it. Header: `Ticket #number` and subject. Meta grid: Status, Priority, Customer (name or email), Workspace (link to `/admin/workspaces/{id}` or "-"), Assigned (name or "unassigned"), 1st reply (locale datetime or "-"), Opened. The currently active status and priority pills get a ring. Assign select is pre-set to the current assignee. SLA lines: "SLA . 1st reply" and "SLA . resolution" (WD-SUPP-014). Thread: first card "Customer . initial" with `tickets.message`, then each message with `name . role`, an amber "internal" badge for notes and a local timestamp; bubble colors: admin green, system grey, customer white. Text is HTML-escaped and pre-wrapped. After render the reply textarea is focused. Failure shows "Failed to load: HTTP {code}".
- **Endpoints:**

  | Endpoint               | Route name         | Action                             | Middleware  | Request    | Response                                                                                                                                                                                                                                                                                                                |
  | ---------------------- | ------------------ | ---------------------------------- | ----------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | GET admin/support/{id} | admin.support.show | Admin\Support\InboxController@show | admin group | numeric id | JSON `{ticket{id, ticket_number, subject, message, name, email, status, priority, reason, created_at, first_response_at, last_reply_at, resolved_at}, workspace{id,name,slug}\|null, assigned_agent{id,name,email}\|null, sla{first_response,resolution}, messages[{id, role, name, body, note, at}]}` ; 404 if missing |

- **Data:** reads `support_tickets` (404 on missing/soft-deleted), `support_messages` for the ticket ordered by `created_at` asc with author (id, name, email) eager-loaded (ALL messages including internal notes), `workspaces` (find by `workspace_id`), `users` (assignee). Message `name` = author name, else "System" for role `system`, else "Customer".
- **Rules & edge cases:**
  1. Internal notes are included (flagged `note: true`) - this endpoint is staff-only.
  2. The thread array omits the initial `message`; the panel adds it as a separate top card from `ticket.message`.
  3. The panel never lists ticket tags, `reason` or `meta` although the JSON carries `reason`.
  4. Opening a ticket has no side effects (no read receipts, no audit).
  5. The status/priority/assign forms use native POST + `back()` so unsaved reply text is lost on any action.
  6. Timestamps are shown in the browser locale; the JSON uses ISO-8601.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a ticket with an admin reply, an internal note and a customer reply, when the panel opens, then all three render in time order after the initial message with the note badged "internal".
  - Given the URL `/admin/support?open=42`, when loaded, then the panel opens ticket 42 and reflects its current status/priority ring.
  - Given a missing id, when the panel requests it, then it shows "Failed to load: HTTP 404".
  - Given a workspace-less ticket, when opened, then the Workspace meta shows a dash.
- **Source refs:** app/Http/Controllers/Admin/Support/InboxController.php (show); resources/views/admin/support/index.blade.php; resources/js/charts/admin-support-index.js.
- **Port notes:** Build as a Next.js side sheet driven by a `GET /admin/support/tickets/:id` JSON (same shape, plus tags/reason). Use optimistic mutations and keep the reply draft when other actions run; the WaDesk full-page reload is an implementation detail, not a behavior to copy. Keep `?open=` deep links.

### WD-SUPP-009 — Reply to customer or add internal note

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-SUPP-008
- **Summary:** From the panel an admin writes a reply that is stored on the thread and emailed to the customer, or ticks "Internal note (not sent to customer)" to keep it private. The first non-note reply starts counting as the first response.
- **Actors & access:** platform admins.
- **UX & screens:** reply form at the bottom of the panel: textarea (3 rows, placeholder "Reply to customer or add an internal note..."), checkbox "Internal note (not sent to customer)", button "Send reply". Flash after redirect: "Reply sent to {email}." or "Internal note added."
- **Endpoints:**

  | Endpoint                      | Route name          | Action                              | Middleware  | Request                                                               | Response                |
  | ----------------------------- | ------------------- | ----------------------------------- | ----------- | --------------------------------------------------------------------- | ----------------------- |
  | POST admin/support/{id}/reply | admin.support.reply | Admin\Support\InboxController@reply | admin group | `body` required string max 8000; `is_internal_note` sometimes boolean | 302 back with `success` |

- **Data:** inserts `support_messages` (`author_user_id` = admin, `author_role='admin'`, `is_internal_note`, `created_at=now`). Updates the ticket: `first_response_at = now` only when currently null AND not a note; `last_reply_at = now` (for notes too); if status is `open` it becomes `in_progress` (for notes too).
- **Rules & edge cases:**
  1. QUIRK: an internal note on an `open` ticket moves it to `in_progress` and bumps `last_reply_at`, but does not stop the first-response SLA timer.
  2. The message row is saved before any email attempt; mail failure is caught, logged as a warning with ticket id and recipient, and the reply is kept. QUIRK: the success flash and the audit `emailed=true` flag still say the email was sent even if delivery threw.
  3. No email is sent for notes; `ticket.email` is NOT NULL so the "no address" guard rarely triggers.
  4. A reply does not change status other than open -> in_progress (no auto "pending"). Replies to `resolved`/`closed` tickets are accepted and do not reopen them.
  5. Body is stored raw (no sanitization); every renderer escapes it.
  6. `ticket_id` not found -> 404 (findOrFail) before validation output matters.
  7. Sequential race: two admins replying simultaneously both see `first_response_at` null and last write wins; not guarded.
- **Async & events:** mail send is synchronous inside the request (Mailable is not queued). Audit `support.reply` with meta `{internal_note, emailed}` (see WD-SUPP-033).
- **External systems:** SMTP/mailer configured in admin mail settings (SET); see WD-SUPP-010.
- **Settings:** mail configuration keys (from address/name, app name/URL) used by WD-SUPP-010.
- **Acceptance criteria:**
  - Given an open ticket with no response, when an admin sends a normal reply, then a message row exists, `first_response_at` and `last_reply_at` are set, status is `in_progress` and the customer receives an email.
  - Given the "Internal note" box ticked, when submitted, then no email is sent, `first_response_at` stays null and the customer's thread does not show it.
  - Given the mailer throws, when an admin replies, then the reply is still saved and visible and a warning is logged.
  - Given an 8001-char body, when submitted, then validation fails and nothing is stored.
- **Source refs:** app/Http/Controllers/Admin/Support/InboxController.php (reply); app/Models/SupportMessage.php; app/Mail/Support/AdminReplyToCustomer.php.
- **Port notes:** Do the message insert + ticket update in one transaction and enqueue the email through the outbox (`support.reply.email`) rather than sending inline; report delivery failure honestly on the message (add `email_status`). Fix the note-moves-status quirk deliberately (recommended: notes touch nothing) and record the decision.

### WD-SUPP-010 — Customer reply notification email

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-SUPP-009, SET
- **Summary:** When an admin replies (not a note), the customer gets an HTML email "Re: {subject}" quoting the reply with a button to view and answer the ticket on the web.
- **Actors & access:** system, triggered by WD-SUPP-009.
- **UX & screens:** `resources/views/emails/support/admin-reply.blade.php` (also listed in NOTIF): 560px card; header "{brand} support" with a monospace line "Re: ticket #{number} . {status}" where the status word is colored (open amber, in_progress deep green, pending coral, resolved green, closed/other grey); body "Hi {name or 'there'}," then "Our support team replied to your ticket "{subject}":" and the reply text in a quoted box (pre-wrapped); centered button "View ticket & reply" (only if a URL exists); footer paragraph; bottom strip "Ticket #number . opened {M j, Y} . sent by {brand}". QUIRK: footer copy says "Reply to this email to add to your ticket" and "the ticket will close automatically" - neither is implemented (no Reply-To header, no inbound parser, no auto-close job).
- **Endpoints:** none (Mailable `App\Mail\Support\AdminReplyToCustomer`).
- **Data:** reads ticket + message; envelope: from address = system setting `from_email` else config mail from (`no-reply@wadesk.local` default), from name = setting `app_name` (else app name, else "Support") followed by " Support"; subject `Re: {subject}` (fallback "Your support ticket"); link = setting `app_url` (trailing slash trimmed) else `url('/')` + `/support/{ticket id}`; brand = `app_name` setting.
- **Rules & edge cases:**
  1. No Reply-To, no CC of the operator, no plain-text alternative, no per-language variants (strings partly wrapped in `__()`, partly hard-coded English).
  2. The link points at the customer thread which requires login as the ticket owner.
  3. Sent to `ticket.email` (the address typed on the form), which may differ from the account email.
  4. Not sent for notes, playbook-generated replies or kanban/status changes.
- **Async & events:** synchronous send in the reply request; failures swallowed and logged.
- **External systems:** configured SMTP (or provider driver) from admin mail settings.
- **Settings:** system settings `from_email`, `app_name`, `app_url`; `config('mail.from.address')`.
- **Acceptance criteria:**
  - Given a reply on ticket TKT-ABC123 with status in_progress, when sent, then the email subject is "Re: {subject}", contains the reply text, the ticket number and a link to `/support/{id}` under the configured app URL.
  - Given `from_email` and `app_name` settings, when sent, then the From is `{app_name} Support <from_email>`.
  - Given an internal note, when saved, then no email is dispatched.
- **Source refs:** app/Mail/Support/AdminReplyToCustomer.php; resources/views/emails/support/admin-reply.blade.php; app/Http/Controllers/Admin/Support/InboxController.php.
- **Port notes:** Use the platform transactional-mail template system (NOTIF/CMS) and add a real `Reply-To` if reply-by-email is ever built; localise all strings; add the reply id to the email for idempotent retries.

### WD-SUPP-011 — Assign or unassign a ticket

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-SUPP-008
- **Summary:** Admins pick an agent from a dropdown in the panel (or "unassigned") and save; the assignee shows in the Inbox column and feeds the "Assigned to me", agent stats and reports.
- **Actors & access:** platform admins.
- **UX & screens:** in the panel: "Assign to" select with "- unassigned -" plus one option per **active** `support_agents` row (label = user name or `User #id`), and a Save button. Flash "Assigned." or "Unassigned."
- **Endpoints:**

  | Endpoint                       | Route name           | Action                               | Middleware  | Request                                                    | Response            |
  | ------------------------------ | -------------------- | ------------------------------------ | ----------- | ---------------------------------------------------------- | ------------------- |
  | POST admin/support/{id}/assign | admin.support.assign | Admin\Support\InboxController@assign | admin group | `agent_user_id` nullable integer, must exist in `users.id` | 302 back with flash |

- **Data:** sets `support_tickets.assigned_agent_id` (FK `users.id`, ON DELETE SET NULL). Nothing is written to `support_assignments` and `support_agents.current_load` is not updated.
- **Rules & edge cases:**
  1. The endpoint accepts ANY existing user id, not only active support agents; the dropdown is the only guard (QUIRK).
  2. No status change on assignment, no notification to the assignee, no customer notification.
  3. Assigning does not verify the assignee is a platform admin.
  4. Audit `support.assign` with meta `agent_user_id`.
  5. Assignment history (`support_assignments`) is designed but unused; see WD-SUPP-019.
- **Async & events:** audit row only.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an unassigned ticket, when an admin selects agent A and saves, then `assigned_agent_id` = A's user id and the Inbox shows A's name.
  - Given the empty option, when saved, then the ticket is unassigned and "Unassigned." shows.
  - Given a nonexistent user id posted directly, when submitted, then validation fails.
  - Given the agent filter `me`, when the assigning admin filters, then the ticket appears.
- **Source refs:** app/Http/Controllers/Admin/Support/InboxController.php (assign); app/Models/SupportAgent.php; database/migrations/2026_05_23_154446_support_module_phase1_schema.php.
- **Port notes:** Constrain the assignee to active support agents server-side (recommended tightening), write a `support_assignments` history row and adjust workload if you implement WD-SUPP-019, emit an in-app notification to the assignee.

### WD-SUPP-012 — Change ticket status (resolved_at rules)

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-SUPP-008
- **Summary:** Five status pills in the panel (open, in progress, pending, resolved, closed) set the status. Resolving stamps a resolution time once; reopening clears it.
- **Actors & access:** platform admins.
- **UX & screens:** row of five pill buttons in the panel, current one ringed. Flash "Status updated."
- **Endpoints:**

  | Endpoint                       | Route name           | Action                                  | Middleware  | Request                                                       | Response |
  | ------------------------------ | -------------------- | --------------------------------------- | ----------- | ------------------------------------------------------------- | -------- |
  | POST admin/support/{id}/status | admin.support.status | Admin\Support\InboxController@setStatus | admin group | `status` required in open,in_progress,pending,resolved,closed | 302 back |

- **Data:** updates `support_tickets.status`, `resolved_at`.
- **Rules & edge cases:**
  1. Setting `resolved` stamps `resolved_at = now` only if it is currently null; moving `resolved -> closed` keeps the original resolution time (preserved for SLA reporting).
  2. Moving from `resolved` to open/in_progress/pending sets `resolved_at = null`. Moving `closed -> open` does NOT clear it if it was set (only a _current_ status of `resolved` triggers clearing) - QUIRK: a ticket resolved, closed, then reopened keeps a stale `resolved_at`.
  3. Setting `closed` directly from open leaves `resolved_at` null, so closed-without-resolved tickets are absent from resolution metrics.
  4. No customer email on status change; no note is written to the thread.
  5. Any-to-any transitions are allowed; there is no workflow state machine.
  6. Audit `support.status_change` with meta `status`.
- **Async & events:** audit row only.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an open ticket, when set to resolved, then `resolved_at` is set and appears in Resolved-24h.
  - Given a resolved ticket, when set to closed, then `resolved_at` is unchanged.
  - Given a resolved ticket, when set to in_progress, then `resolved_at` is null.
  - Given an invalid status posted directly, when submitted, then validation fails.
- **Source refs:** app/Http/Controllers/Admin/Support/InboxController.php (setStatus).
- **Port notes:** Centralize transitions in a `TicketService.transition()` used by the panel, kanban, playbooks and customer reply so `resolved_at`/`first_response_at` rules are identical everywhere (WaDesk's four writers disagree, see WD-SUPP-016 and WD-SUPP-024).

### WD-SUPP-013 — Change ticket priority

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-SUPP-008
- **Summary:** Four priority pills (low, normal, high, urgent) in the panel set the ticket priority, shown as colored chips in every list.
- **Actors & access:** platform admins.
- **UX & screens:** row "Priority:" with the four pills, current one ringed. Flash "Priority set."
- **Endpoints:**

  | Endpoint                         | Route name             | Action                                    | Middleware  | Request                                       | Response |
  | -------------------------------- | ---------------------- | ----------------------------------------- | ----------- | --------------------------------------------- | -------- |
  | POST admin/support/{id}/priority | admin.support.priority | Admin\Support\InboxController@setPriority | admin group | `priority` required in low,normal,high,urgent | 302 back |

- **Data:** `support_tickets.priority` varchar(12) default `normal`. The update is a raw `UPDATE ... WHERE id` (no model event, no 404 for unknown ids: it silently affects zero rows and still flashes success).
- **Rules & edge cases:**
  1. Priority does not change SLA targets (the calculator ignores it; `sla_policies.priority_overrides` is unused here).
  2. Customers cannot set priority; new tickets are always `normal`.
  3. Audit `support.priority_change` with meta `priority`.
  4. Colors: urgent coral, high amber, normal grey, low pale.
- **Async & events:** audit row only.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a normal ticket, when set to urgent, then the Inbox chip reads URGENT and filter `priority=urgent` includes it.
  - Given an unknown ticket id, when posted, then the request succeeds silently with no change (WaDesk behavior; port should 404).
  - Given priority `critical` posted, when submitted, then validation fails.
- **Source refs:** app/Http/Controllers/Admin/Support/InboxController.php (setPriority).
- **Port notes:** Enforce 404 on unknown id and use the shared transition service; consider making priority drive SLA targets via `priority_overrides` in a later phase (schema already has it on `sla_policies`).

### WD-SUPP-014 — SLA snapshot pills on the ticket panel

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-SUPP-029
- **Summary:** The panel shows two live pills, first-reply and resolution, reading "12m left", "8m over" or "met", colored by severity, computed on request from the default SLA policy.
- **Actors & access:** platform admins.
- **UX & screens:** two rows under the quick actions: "SLA . 1st reply:" and "SLA . resolution:". Rendering rules in JS: no SLA info -> "no policy"; `minutes_over` present -> coral "{n}m over . {severity}"; `minutes_remaining` present -> amber for severity `warn` else deep green "{n}m left . {severity}"; otherwise "met".
- **Endpoints:** part of GET admin/support/{id} (WD-SUPP-008): `sla = SlaCalculator::status(ticket)` returning `{first_response, resolution}` each `{deadline (ISO), breached, minutes_remaining, minutes_over, severity (ok|warn|breach|met)}` or null when no policy exists.
- **Data:** reads `sla_policies`, `workspaces` (timezone, business_hours) via WD-SUPP-029.
- **Rules & edge cases:**
  1. QUIRK: once the first response is recorded and was on time the pill says "met"; when late, `minutes_over` is set (see the Carbon-3 sign question in Open questions) and the pill shows a breach.
  2. Resolved tickets show resolution "met" or "breach" against the deadline, never a running timer.
  3. Timers are not paused while the ticket is `pending` (the policy flag exists but is unused, WD-SUPP-029).
  4. Recomputed on every panel open; nothing is cached or stored.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** default policy (WD-SUPP-027).
- **Acceptance criteria:**
  - Given a default policy of 60 min first reply and an unanswered ticket created 45 min ago (24/7), when the panel opens, then it shows about "15m left".
  - Given no default policy, when the panel opens, then both pills read "no policy".
  - Given a ticket answered within target, when opened, then first-reply shows "met".
  - Given an unanswered ticket 8 min past target, then the pill shows "8m over . breach".
- **Source refs:** app/Support/SlaCalculator.php (status); resources/js/charts/admin-support-index.js; app/Http/Controllers/Admin/Support/InboxController.php.
- **Port notes:** Implement the calculator as a pure function with injected clock and business-hours provider so it is unit-testable; return integer minutes.

### WD-SUPP-015 — Team-inbox kanban board

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-SUPP-007
- **Summary:** `Admin -> Support -> Team inbox` shows tickets as cards in four columns (New, In progress, Awaiting customer, Resolved) with an optional "Mine only" filter.
- **Actors & access:** platform admins.
- **UX & screens:** `resources/views/admin/support/team-inbox.blade.php`, admin key `support-team`, JS `admin-support-team.js`. Header "Team kanban" with explanatory copy ("Resolved sets resolved_at to now"), toggle link "Mine only" / "Show all tickets" (`?mine=1`). Four columns mapping status to title: `open` New, `in_progress` In progress, `pending` Awaiting customer, `resolved` Resolved, each with a count chip; each card (`draggable`): subject (or "(no subject)"), `number . relative-created`, priority chip, first 100 chars of the message, customer name-or-email. Empty column text "No tickets". Cards are not clickable (no way to open the panel from the board).
- **Endpoints:**

  | Endpoint                     | Route name         | Action                                  | Middleware  | Request        | Response |
  | ---------------------------- | ------------------ | --------------------------------------- | ----------- | -------------- | -------- |
  | GET admin/support/team-inbox | admin.support.team | Admin\Support\TeamInboxController@index | admin group | `mine` boolean | HTML     |

- **Data:** reads the 500 most recently updated tickets (`updated_at` desc, optionally `assigned_agent_id = me`), then groups in memory by status.
- **Rules & edge cases:**
  1. QUIRK: `closed` tickets never appear on the board; tickets beyond the 500 most-recently-updated are invisible, and old resolved tickets consume that budget (a busy desk shows a truncated Resolved column).
  2. Column counts are counts of the loaded slice, not true totals.
  3. Sidebar badge for this page counts unassigned open/pending/in_progress tickets (ASHELL).
  4. Route `/admin/support/team-inbox` is registered before `/{id}` so it is not swallowed by the wildcard (ordering matters in the port's router).
- **Async & events:** none (no live updates).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given tickets in all statuses, when the board opens, then open/in_progress/pending/resolved columns show matching cards and closed ones are absent.
  - Given `?mine=1`, when opened, then only the admin's assigned tickets show.
  - Given 600 tickets, when opened, then only the 500 most recently updated are placed.
- **Source refs:** app/Http/Controllers/Admin/Support/TeamInboxController.php; resources/views/admin/support/team-inbox.blade.php; resources/js/charts/admin-support-team.js.
- **Port notes:** Cap per-column (e.g. 50 each with "load more") instead of a global slice; add card click to open the ticket sheet; add `closed` as an optional fifth column.

### WD-SUPP-016 — Kanban drag-and-drop status move

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-SUPP-015
- **Summary:** Dragging a card into another column immediately flips the ticket status to that column, then the page reloads to refresh counts.
- **Actors & access:** platform admins.
- **UX & screens:** HTML5 drag-and-drop in `admin-support-team.js`: dragged card gets 50% opacity; hovered column gets a green ring; on drop the card is appended optimistically, a `POST /admin/support/{id}/move` (form-data `status`, CSRF header) is sent and the page reloads regardless of result (errors only logged to console). Dropping in the same column is a no-op.
- **Endpoints:**

  | Endpoint                     | Route name         | Action                                 | Middleware  | Request                                                | Response          |
  | ---------------------------- | ------------------ | -------------------------------------- | ----------- | ------------------------------------------------------ | ----------------- |
  | POST admin/support/{id}/move | admin.support.move | Admin\Support\TeamInboxController@move | admin group | `status` required in open,in_progress,pending,resolved | 302 back "Moved." |

- **Data:** updates `support_tickets.status`; sets `resolved_at = now` when moving to `resolved` and it is currently null.
- **Rules & edge cases:**
  1. QUIRK vs WD-SUPP-012: moving OUT of resolved does not clear `resolved_at` (the panel does), so a ticket dragged back to New keeps its resolution timestamp and stays counted in Resolved-24h/reports.
  2. `closed` cannot be a drop target.
  3. `first_response_at` is untouched (dragging to In progress does not stop the first-response SLA).
  4. Audit `support.kanban_move` with meta `to`; QUIRK: the audit call passes `resource`/`resource_id` keys that the audit facade ignores (it reads `subject_type`/`subject_id`), so the row has no subject.
  5. Touch devices: native HTML5 DnD does not work on most mobile browsers; there is no fallback control.
- **Async & events:** audit row.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a card in New, when dropped on Resolved, then the ticket status is `resolved` and `resolved_at` is set.
  - Given a resolved ticket, when dropped on New, then status is `open` (and, per WaDesk, `resolved_at` remains - the port may fix this).
  - Given the POST fails, when the drop occurs, then the page still reloads and shows the true state.
- **Source refs:** app/Http/Controllers/Admin/Support/TeamInboxController.php (move); resources/js/charts/admin-support-team.js.
- **Port notes:** Use dnd-kit with keyboard/touch support and a status menu fallback; call the shared transition service so `resolved_at` clears on reopen; carry over the audit action `support.kanban_move` but fix the subject.

### WD-SUPP-017 — Support agent roster with live stats

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-SUPP-007
- **Summary:** `Admin -> Support -> Agents` lists the people registered as support agents with their open load, resolved-in-30-days, average first-reply time and an on/off switch, plus four KPI tiles.
- **Actors & access:** platform admins.
- **UX & screens:** `resources/views/admin/support/agents.blade.php`, key `support-agents`. Header copy: "Promote any platform user to a support agent. Active agents appear in the ticket-assign dropdown and rotate into auto-assignment" (the last clause is false, WD-SUPP-019). KPI tiles: Total agents, Active, Open tickets (platform-wide), Unassigned (open/pending, no assignee). Table "Agent roster": Name + email, Specialty (or dash), Open, Resolved 30d, Avg 1st reply ("{n}m" or dash), Active pill button (On/Off), Remove. Empty: "No agents yet. Add one on the right." Right rail form: WD-SUPP-018.
- **Endpoints:**

  | Endpoint                 | Route name           | Action                               | Middleware  | Request | Response |
  | ------------------------ | -------------------- | ------------------------------------ | ----------- | ------- | -------- |
  | GET admin/support/agents | admin.support.agents | Admin\Support\AgentsController@index | admin group | -       | HTML     |

- **Data:** reads `support_agents` (with user id, name, email) ordered by `is_active` desc then `current_load` desc; per agent three subqueries against `support_tickets` where `assigned_agent_id = agent.user_id`: open_count (status open/in_progress/pending), resolved_30d (`resolved_at >= now-30d`), avg first response = average minutes between `created_at` and `first_response_at` over ALL time (not 30d), rounded. Candidates = users without a platform-level agent row (`support_agents.workspace_id IS NULL` relation), by name, max 200. Agents with a null user_id (cannot happen: FK not null) would show zeros.
- **Rules & edge cases:**
  1. `current_load` is only used as a sort key and is never updated by any code (always 0).
  2. Stats are computed with per-row queries (N+1) - acceptable for "rarely exceeds 50 rows".
  3. The candidate dropdown lists every user of the platform (customers included), capped at 200 alphabetically, so on a big install the intended user may not be selectable (QUIRK).
  4. Workspace-scoped agent rows (`workspace_id` set) are not creatable in the UI and are not distinguished in the list.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given two agents with different resolved counts, when the page loads, then active agents come first and each row shows open/resolved-30d/avg-reply computed from tickets assigned to that user.
  - Given an agent with no responded tickets, then Avg 1st reply shows a dash.
  - Given no agents, then the empty message shows and KPIs read zero.
- **Source refs:** app/Http/Controllers/Admin/Support/AgentsController.php; app/Models/SupportAgent.php; app/Models/User.php (supportAgent relation); resources/views/admin/support/agents.blade.php.
- **Port notes:** Aggregate stats in one grouped query; replace the 200-user dropdown with a searchable user picker (platform staff only). Partial unique index on `support_agents(user_id) WHERE workspace_id IS NULL` (Postgres treats NULLs as distinct in a plain unique).

### WD-SUPP-018 — Add, toggle and remove support agents

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-SUPP-017
- **Summary:** Admins promote a user to support agent (optionally with a specialty label), switch agents on/off and remove them. Active agents appear in the assign dropdown.
- **Actors & access:** platform admins.
- **UX & screens:** right rail "Promote user / New agent": User select (required, "- pick a user -"), Specialty text (placeholder "billing / integrations / general"), button "Add agent". Per row: On/Off toggle button; Remove link with a confirm prompt ("Remove {name}?").
- **Endpoints:**

  | Endpoint                              | Route name                   | Action                               | Middleware  | Request                                                                | Response                            |
  | ------------------------------------- | ---------------------------- | ------------------------------------ | ----------- | ---------------------------------------------------------------------- | ----------------------------------- |
  | POST admin/support/agents             | admin.support.agents.store   | Admin\Support\AgentsController@store | admin group | `user_id` required exists:users,id; `specialty` nullable string max 60 | 302 back "Agent added."             |
  | POST admin/support/agents/{id}/toggle | admin.support.agents.toggle  | AgentsController@toggle              | admin group | -                                                                      | 302 back "Activated." / "Disabled." |
  | DELETE admin/support/agents/{id}      | admin.support.agents.destroy | AgentsController@destroy             | admin group | -                                                                      | 302 back "Agent removed."           |

- **Data:** `support_agents`: `firstOrCreate(user_id, workspace_id=NULL)` with defaults `is_active=true`, `specialty`, `current_load=0`. Toggle flips `is_active`. Delete is a hard delete of the agent row only.
- **Rules & edge cases:**
  1. Adding an already-registered user is idempotent (firstOrCreate) and still flashes "Agent added."; a supplied specialty is ignored in that case (only applied on create).
  2. A DB unique key exists on `(user_id, workspace_id)` but MySQL allows duplicate NULL workspaces, so only the firstOrCreate prevents duplicates (race-prone).
  3. Deactivating or removing an agent does NOT unassign their tickets and does not block direct assign posts (WD-SUPP-011).
  4. Removing an agent does not remove their platform role or account.
  5. Only `agents.store` writes an audit row (`support.agent_added` with the request data as meta); toggle and destroy are unaudited.
  6. `specialty` is a free label with no behavioral effect (no routing).
- **Async & events:** audit on add only.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a user who is not an agent, when added with specialty "billing", then an active agent row exists with that specialty and they appear in the assign dropdown.
  - Given an active agent, when toggled, then they disappear from the dropdown but keep their tickets.
  - Given a removed agent, when the roster reloads, then they are gone and the user reappears in the candidate list.
  - Given a specialty of 61 chars, when submitted, then validation fails.
- **Source refs:** app/Http/Controllers/Admin/Support/AgentsController.php; app/Models/SupportAgent.php; resources/views/admin/support/agents.blade.php.
- **Port notes:** Audit all three mutations; consider auto-unassigning or warning when deactivating an agent with open tickets; emit `support.agent.changed` for cache invalidation of the assign dropdown.

### WD-SUPP-019 — Agent auto-assignment and workload tracking

- **Status:** docs-only
- **Priority:** P2
- **Effort:** M
- **Depends on:** WD-SUPP-018
- **Summary:** The Agents page promises active agents "rotate into auto-assignment" and the schema has `support_agents.current_load`, `support_agents.specialty` and a `support_assignments` history table (assigned_at, released_at, outcome resolved|abandoned|reassigned), but no code assigns tickets automatically or writes any of these.
- **Actors & access:** would be platform staff/system.
- **UX & screens:** only the copy on the Agents page.
- **Endpoints:** none.
- **Data:** tables `support_assignments` (ticket_id, agent_user_id, assigned_at default now, released_at, outcome; index ticket_id+released_at; cascades on ticket/user delete) and `support_agents.current_load` (unsigned int default 0) exist and are never written; `support_tickets.assigned_agent_id` is the only assignment record.
- **Rules & edge cases:**
  1. New tickets are always unassigned; they wait for a human.
  2. The workspace-side routing engine (`RoutingEngine`, TIB2) is unrelated to platform tickets.
  3. Specialty is display-only.
- **Async & events:** none exist.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the WaDesk baseline, when a ticket is created, then it is unassigned (parity).
  - Given the optional enhancement, when auto-assign is enabled, then a new ticket goes to the active agent with the lowest open load matching the reason/specialty, a `support_assignments` row opens and `current_load` is incremented (port improvement, feature-flagged).
- **Source refs:** app/Http/Controllers/Admin/Support/AgentsController.php; resources/views/admin/support/agents.blade.php; database/migrations/2026_05_23_154446_support_module_phase1_schema.php; app/Models/SupportAgent.php.
- **Port notes:** Do not port `current_load` as a stored counter; derive from open tickets. Only build `support_assignments` if assignment history is wanted in reports.

### WD-SUPP-020 — Customers ranked by support load

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-SUPP-007
- **Summary:** `Admin -> Support -> Customers` ranks workspaces that have raised tickets by number of open tickets, with totals, average resolution time and last-ticket age, and a name/slug filter.
- **Actors & access:** platform admins.
- **UX & screens:** `resources/views/admin/support/customers.blade.php`, key `support-customers`. KPI tiles: Customers, Total tickets, Open, Top open. Filter input "Filter workspace..." (GET `q`, submits on Enter). Table: Workspace (name + slug, or "Workspace #id" when the workspace no longer exists), Open (coral when > 0), Total, Avg resolution ("{n}m" or dash), Last ticket (relative), "Open ->" link to the customer page (only when the workspace exists). Empty: "No customers have raised tickets yet." No pagination.
- **Endpoints:**

  | Endpoint                    | Route name              | Action                                  | Middleware  | Request | Response |
  | --------------------------- | ----------------------- | --------------------------------------- | ----------- | ------- | -------- |
  | GET admin/support/customers | admin.support.customers | Admin\Support\CustomersController@index | admin group | `q`     | HTML     |

- **Data:** raw grouped query on `support_tickets` where `workspace_id IS NOT NULL`, grouped by workspace: count, open-like count (open, in_progress, pending), max created_at, sum of resolution minutes and resolved count (rows with `resolved_at`); ordered by open desc then total desc. Workspace names/slugs are fetched for the result set. `q` is applied in memory (case-insensitive substring on workspace name or slug) AFTER grouping.
- **Rules & edge cases:**
  1. Raw `DB::table` bypasses the model's soft-delete scope, so soft-deleted tickets would be counted (none can be created by the product).
  2. KPI `customers` = rows after filtering; `total`/`open` are sums over filtered rows; `top` = open count of the first row (the maximum) or 0.
  3. Tickets whose workspace was deleted (FK SET NULL) or never had one vanish from this page.
  4. Avg resolution = total minutes / count of resolved tickets, integer-rounded; tickets without `resolved_at` excluded.
  5. Page copy promises "impersonate" but no impersonation control exists here (docs-only claim); the sidebar badge for Customers counts distinct ticket emails instead (ASHELL).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given workspace A with 3 open and 1 resolved ticket and B with 1 open, when the page loads, then A ranks first showing Open 3, Total 4.
  - Given `q=acme`, when submitted, then only workspaces whose name or slug contains "acme" show and KPIs reflect them.
  - Given a ticket whose workspace was deleted, then it does not appear.
- **Source refs:** app/Http/Controllers/Admin/Support/CustomersController.php (index); resources/views/admin/support/customers.blade.php.
- **Port notes:** Implement as a grouped SQL view/query with pagination; filter in SQL by joining `workspaces`. Keep `workspace_id` ON DELETE SET NULL or snapshot the workspace name on the ticket so history survives deletion.

### WD-SUPP-021 — Customer workspace ticket history

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-SUPP-020
- **Summary:** Drill-down for one workspace: five stat tiles and the last 200 tickets with status, priority, assignee and time-to-resolve, each linking back to the Inbox panel.
- **Actors & access:** platform admins.
- **UX & screens:** `resources/views/admin/support/customer-show.blade.php`, key `support-customers`. Header buttons "Workspace settings" (to `/admin/workspaces/{id}`, WSP) and "All customers". Tiles: Total tickets, Open (coral when > 0), Resolved, Avg 1st reply (minutes), Avg resolution (minutes). Table "Ticket history": When (`M j Y` + time), Subject + `#number . opener name` (the ticket opener's account name, else the ticket's name), Status, Priority, Assigned, Resolved in ("{n}m" or dash), "Open ->" to `/admin/support?open={ticket id}`.
- **Endpoints:**

  | Endpoint                           | Route name                   | Action                                 | Middleware                   | Request | Response                                                               |
  | ---------------------------------- | ---------------------------- | -------------------------------------- | ---------------------------- | ------- | ---------------------------------------------------------------------- |
  | GET admin/support/customers/{wsId} | admin.support.customers.show | Admin\Support\CustomersController@show | admin group (`wsId` numeric) | -       | HTML, or redirect to customers with flash error "Workspace not found." |

- **Data:** reads `workspaces` by id (soft-deleted excluded), `support_tickets` for the workspace ordered by created_at desc, LIMIT 200 (stats are computed over these 200 only), `users` for assignee/opener names.
- **Rules & edge cases:**
  1. Stats: `open` = open-like statuses; `resolved` = rows with `resolved_at`; avg first response and avg resolution in whole minutes (0 shows a dash); all limited to the latest 200 tickets.
  2. Empty: "This workspace hasn't raised any tickets."
  3. Note that "Resolved" tile counts by `resolved_at` not status, so a reopened-by-drag ticket still counts.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a workspace with 5 tickets, 3 resolved, when opened, then tiles read Total 5, Resolved 3 with averages over the relevant subsets.
  - Given an unknown id, when opened, then redirected to Customers with an error flash.
  - Given a ticket row, when "Open ->" is clicked, then the Inbox opens with that ticket's panel.
- **Source refs:** app/Http/Controllers/Admin/Support/CustomersController.php (show); resources/views/admin/support/customer-show.blade.php.
- **Port notes:** Compute stats in SQL over all tickets (not just 200) and paginate the history.

### WD-SUPP-022 — Playbook library and builder

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** WD-SUPP-008
- **Summary:** Playbooks are reusable macros: a name, a trigger label and up to three ordered action steps (set status, set priority, add tag, send reply, assign agent, add internal note). The page lists them and offers a builder card.
- **Actors & access:** platform admins.
- **UX & screens:** `resources/views/admin/support/playbooks.blade.php`, key `support-playbooks`. KPI tiles: Total, Active, Runs (all-time). Library list (order: active first, then most used): name, status pill (active/paused), trigger chip (`{trigger_type}` plus `: value`), meta line "{n} steps . used {n}x . {slug}", step chips (label plus first 24 chars of value). Empty state with three example starters (Refund standard, Escalate urgent, Pause awaiting customer) that are only text. Builder (sticky right card "Build a macro"): Name (required), Trigger select (Manual / Status change / Tag added), Value (optional text), three step rows each with an action select ("- skip -" plus the six actions) and a value input; hint "Empty rows are ignored. 3 step slots".
- **Endpoints:**

  | Endpoint                     | Route name                    | Action                                  | Middleware  | Request                                                                                                                                                                                                                                                                     | Response                     |
  | ---------------------------- | ----------------------------- | --------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
  | GET admin/support/playbooks  | admin.support.playbooks       | Admin\Support\PlaybooksController@index | admin group | -                                                                                                                                                                                                                                                                           | HTML                         |
  | POST admin/support/playbooks | admin.support.playbooks.store | PlaybooksController@store               | admin group | `name` required max 120; `trigger_type` required in manual,status_change,tag_added; `trigger_value` nullable max 120; `steps` nullable array; `steps.*.action` required_with steps, in set_status,set_priority,add_tag,reply,assign,note; `steps.*.value` nullable max 8000 | 302 back "Playbook created." |

- **Data:** `playbooks`: `name`, `slug` = slugified name + `-` + 6 hex chars (unique index), `trigger_type`, `trigger_value`, `steps` JSON (list of `{action, value}`, re-indexed), `is_active=true`, `use_count=0`, `workspace_id` always null (column exists for per-workspace playbooks; unused).
- **Rules & edge cases:**
  1. Action catalogue (label / expected value): set_status (status), set_priority (priority), add_tag (tag), reply "Send reply" (body), assign "Assign agent" (agent user id), note "Add internal note" (body). The `params` names in the catalogue are informational; the stored key is always `value`.
  2. QUIRK (verify at parity): the builder renders three slots and tells the admin empty rows are ignored, but the validation rule makes `steps.*.action` required whenever `steps` is present, and blank selects arrive as null, so saving with fewer than three filled rows probably fails with "action is required" errors; there is no server-side pruning of empty steps.
  3. `trigger_value` has no semantic validation (e.g. a real status or tag name).
  4. `trigger_type` other than manual never fires (WD-SUPP-025).
  5. Audit `support.playbook_created` with the name.
  6. No edit form: playbooks are create/toggle/delete only ("clone to chain more" copy but there is no clone).
- **Async & events:** audit row.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a name and two valid steps (with the third slot handled per the port's UI), when saved, then a playbook exists, active, `use_count` 0, with a unique slug.
  - Given a step action outside the catalogue, when submitted, then validation fails.
  - Given the library, when loaded, then active and most-used playbooks are listed first.
  - Given two playbooks with the same name, then slugs differ.
- **Source refs:** app/Http/Controllers/Admin/Support/PlaybooksController.php; app/Models/Playbook.php; resources/views/admin/support/playbooks.blade.php; database/migrations/2026_05_23_154446_support_module_phase1_schema.php.
- **Port notes:** Build steps as a dynamic list (add/remove/reorder, any number) with typed step forms (status picker, priority picker, agent picker) instead of free text; store as JSONB with a discriminated-union schema (`{type:'set_status', status}`) and validate on write. Keep `workspace_id` null (platform-owned) or drop it.

### WD-SUPP-023 — Pause, activate and delete playbooks

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-SUPP-022
- **Summary:** Each playbook has a Pause/Activate button and a Delete link (with confirm).
- **Actors & access:** platform admins.
- **UX & screens:** buttons in the library rows; confirm text "Delete playbook '{name}'?"; flashes "Playbook activated." / "Playbook paused." / "Playbook deleted."
- **Endpoints:**

  | Endpoint                                 | Route name                      | Action                      | Middleware  | Request | Response |
  | ---------------------------------------- | ------------------------------- | --------------------------- | ----------- | ------- | -------- |
  | POST admin/support/playbooks/{id}/toggle | admin.support.playbooks.toggle  | PlaybooksController@toggle  | admin group | -       | 302 back |
  | DELETE admin/support/playbooks/{id}      | admin.support.playbooks.destroy | PlaybooksController@destroy | admin group | -       | 302 back |

- **Data:** flips `playbooks.is_active`; hard delete of the row (no soft delete).
- **Rules & edge cases:**
  1. A paused playbook disappears from the panel's run dropdown, but the run endpoint itself does not check `is_active` (WD-SUPP-024).
  2. Neither action is audited.
  3. Delete does not cascade anywhere; historical `support.playbook_run` audit rows keep the playbook id only.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an active playbook, when paused, then it leaves the panel dropdown and the list shows "paused".
  - Given a playbook, when deleted, then it is gone from the list and KPIs.
- **Source refs:** app/Http/Controllers/Admin/Support/PlaybooksController.php (toggle, destroy).
- **Port notes:** Add audit rows for both; consider soft-delete to keep run history readable.

### WD-SUPP-024 — Run a playbook on a ticket

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** WD-SUPP-022, WD-SUPP-008
- **Summary:** From the ticket panel an admin picks a manual playbook and clicks Run; its steps are applied in order to that ticket and the playbook's use counter goes up.
- **Actors & access:** platform admins. The dropdown is only rendered when at least one active manual playbook exists.
- **UX & screens:** panel row "Run playbook" (select "- pick playbook -", Run button). Client JS blocks submit if nothing is picked and posts to `/admin/support/{ticket}/run-playbook/{playbook}`. Flash: Playbook "{name}" executed.
- **Endpoints:**

  | Endpoint                                    | Route name                  | Action                          | Middleware                     | Request | Response |
  | ------------------------------------------- | --------------------------- | ------------------------------- | ------------------------------ | ------- | -------- |
  | POST admin/support/{tid}/run-playbook/{pid} | admin.support.playbooks.run | PlaybooksController@runOnTicket | admin group (both ids numeric) | -       | 302 back |

- **Data:** loads ticket and playbook (404 if either missing); iterates `steps` in order and mutates the in-memory ticket, saved once at the end; increments `playbooks.use_count`; audit `support.playbook_run` (subject ticket, meta playbook id).
- **Rules & edge cases:**
  1. `set_status`: applied only if the value is one of open, in_progress, pending, resolved, closed (silently ignored otherwise); QUIRK: it does not stamp or clear `resolved_at`, so playbook-resolving leaves `resolved_at` null (excluded from resolution metrics, Resolved-24h).
  2. `set_priority`: only low/normal/high/urgent.
  3. `add_tag`: appends to `tickets.tags` if not present. QUIRK (likely crash, verify): the model has no array cast for `tags` (JSON longtext), so reading yields a string (treated as empty) and assigning an array to the attribute at save time is likely to error; tags are also never displayed anywhere, and re-running would overwrite prior tags.
  4. `assign`: sets `assigned_agent_id` to the integer value or null when empty/0; no existence or active-agent check (FK violation on a bad id -> 500).
  5. `reply` / `note`: insert an `admin` message (`note` marks internal); these do NOT set `first_response_at`/`last_reply_at`, do NOT change status and do NOT email the customer, so a "reply" step posts silently onto the customer's thread (visible to them in the thread page).
  6. Manual-only in practice: the route runs ANY playbook id regardless of `trigger_type` or `is_active`.
  7. `use_count` increments even for zero-step playbooks; there is no run log beyond the audit row.
  8. Not transactional: messages created by earlier steps persist if a later step throws.
- **Async & events:** audit row `support.playbook_run`.
- **External systems:** none (docs mention future integrations such as WhatsApp templates, none exist).
- **Settings:** none.
- **Acceptance criteria:**
  - Given a playbook [set_priority urgent, note "escalated"], when run on an open ticket, then priority is urgent, an internal note exists, `use_count` is 1 and an audit row exists.
  - Given a step `set_status` with value `bogus`, when run, then that step is skipped and others still apply.
  - Given a `reply` step, when run, then the customer thread shows the reply but no email is sent.
  - Given an unknown ticket or playbook id, then 404.
- **Source refs:** app/Http/Controllers/Admin/Support/PlaybooksController.php (runOnTicket, ACTIONS); resources/views/admin/support/index.blade.php; resources/js/charts/admin-support-index.js.
- **Port notes:** Execute steps through the same `TicketService` methods as manual actions (so `resolved_at`, first-response, email side-effects are consistent) inside one transaction. Decide whether playbook `reply` emails the customer (recommended: yes, same path as WD-SUPP-009). Fix tags with a real `tags text[]` column or a join table.

### WD-SUPP-025 — Playbook automatic triggers (status change, tag added)

- **Status:** docs-only
- **Priority:** P2
- **Effort:** L
- **Depends on:** WD-SUPP-022
- **Summary:** Playbooks can be defined with trigger type `status_change` or `tag_added` and a trigger value, but nothing in the codebase ever evaluates triggers; only manual runs exist.
- **Actors & access:** would be system.
- **UX & screens:** Trigger select and value input in the builder; the library chip shows the trigger label.
- **Endpoints:** none.
- **Data:** `playbooks.trigger_type` (`manual|status_change|tag_added`, default manual), `trigger_value`; `support_tickets.tags` JSON is never populated by any UI.
- **Rules & edge cases:**
  1. Non-manual playbooks never run and never appear in the run dropdown (which filters `trigger_type='manual'`), so they are unusable in WaDesk.
  2. No event/listener on ticket status change or tag change exists.
- **Async & events:** none exist.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the WaDesk baseline, when a `status_change` playbook exists and a ticket changes status, then nothing happens (parity).
  - Given the optional enhancement, when a ticket's status changes to the trigger value, then active matching playbooks execute once, with loop protection.
- **Source refs:** app/Http/Controllers/Admin/Support/PlaybooksController.php; app/Models/Playbook.php; resources/views/admin/support/playbooks.blade.php.
- **Port notes:** Do not port triggers in the first cut; if built, run them from ticket domain events via BullMQ with a per-ticket execution guard to avoid loops.

### WD-SUPP-026 — SLA board: policies, breaches, KPIs

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-SUPP-029
- **Summary:** `Admin -> Support -> SLA board` lists SLA policies, the fifty most recent recorded breaches and four KPI tiles, with a right-hand form to add a policy.
- **Actors & access:** platform admins.
- **UX & screens:** `resources/views/admin/support/sla.blade.php`, key `support-sla`. KPI tiles: Policies, Open breaches, At risk now, Compliance . 7d. Policies table: Name, 1st reply (`{n}m`), Resolution (`{n}m`), Hours ("biz" or "24/7"), Default badge, Delete link (confirm). Empty: "No SLA policies yet. Create one to set response/resolution targets." Recent breaches table: When (relative), Ticket (`#number . subject` truncated to 50), Type chip (`first_response`|`resolution`), Over by (`{n}m` or dash), Severity chip (warn amber, breach coral, hard_breach heavier coral). Empty: "No breaches yet."
- **Endpoints:**

  | Endpoint              | Route name        | Action                            | Middleware  | Request | Response |
  | --------------------- | ----------------- | --------------------------------- | ----------- | ------- | -------- |
  | GET admin/support/sla | admin.support.sla | Admin\Support\SlaController@index | admin group | -       | HTML     |

- **Data:** reads ALL `sla_policies` ordered by id (QUIRK: includes workspace-scoped policies created by workspaces in TIB2 since the table is shared and no `workspace_id IS NULL` filter is applied, and the delete link works on them); `sla_breaches` joined to `support_tickets` (subject, number) ordered by `breached_at` desc limit 50; at-risk = tickets in open-like statuses created in the last 48 hours, oldest first, limit 30.
- **Rules & edge cases:**
  1. KPI "Open breaches" is the count of the 50-row breaches list (max 50; not "open" in any sense; resolved tickets' breaches still count).
  2. KPI "At risk now" is the size of the recent-open list (max 30); the tickets themselves are computed but never displayed; it is not an SLA computation.
  3. KPI "Compliance . 7d" = 100 if no tickets resolved in the last 7 days, else `100 - (distinct tickets with a breach recorded in 7 days / tickets resolved in 7 days) * 100`, floored at 0, one decimal. The numerator and denominator are different populations, so it can reach 0 when many unresolved tickets breached.
  4. Because the breach scanner is not scheduled (WD-SUPP-030), breaches are empty on a stock install and compliance shows 100%.
- **Async & events:** none on this page.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given two platform policies and three breach rows, when the board loads, then it lists both policies, the breaches newest first, and KPI Policies=2 Open breaches=3.
  - Given no resolved tickets in 7 days, then Compliance shows 100%.
  - Given a default policy, then its row carries the "default" badge.
- **Source refs:** app/Http/Controllers/Admin/Support/SlaController.php (index, complianceRate); resources/views/admin/support/sla.blade.php.
- **Port notes:** Scope this page to platform policies (`workspace_id IS NULL`) and keep workspace SLA policies in TIB2's screens; compute compliance on one cohort (tickets resolved in window that met vs missed targets) instead of mixing populations; actually list at-risk tickets with time left.

### WD-SUPP-027 — Create SLA policy

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-SUPP-026
- **Summary:** Admins add a named platform-wide SLA policy with first-response and resolution targets in minutes, business-hours and pause toggles and a default flag.
- **Actors & access:** platform admins.
- **UX & screens:** right rail "New policy / Add SLA target": Name (required, placeholder "Standard / Premium / Urgent"), "1st reply (min)" number (min 1, default 60), "Resolve (min)" (min 1, default 1440), toggles "Business hours only" (default ON), "Pause on customer wait" (default off), "Set as default" (default off), button "Add policy". Toggles post hidden 0 plus checkbox 1. Flash "SLA policy saved."
- **Endpoints:**

  | Endpoint                        | Route name              | Action                    | Middleware  | Request                                                                                                                                                                                                                 | Response |
  | ------------------------------- | ----------------------- | ------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
  | POST admin/support/sla/policies | admin.support.sla.store | SlaController@storePolicy | admin group | `name` required max 120; `first_response_minutes` required integer 1..10080; `resolution_minutes` required integer 1..43200; `pause_when_waiting_on_customer`, `respect_business_hours`, `is_default` sometimes boolean | 302 back |

- **Data:** inserts `sla_policies` with `workspace_id = NULL` (platform-wide; the column was made nullable by migration 2026_05_23_160344), booleans coerced (business hours default true when absent, pause default false, default false).
- **Rules & edge cases:**
  1. Setting `is_default` first clears `is_default` on EVERY policy in the table with no workspace scope (QUIRK: it silently strips the default flag from every workspace's own SLA policy in TIB2; conversely the calculator then may not find a default). A port must scope this to platform policies.
  2. Multiple non-default policies are allowed; only the default is ever applied (WD-SUPP-029).
  3. `pause_when_waiting_on_customer` is stored but not honored; `priority_overrides` and `device_ids` (used by workspace SLA) are not editable here.
  4. Audit `support.sla_policy_created` with the name.
- **Async & events:** audit row.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given valid values with "Set as default" on, when saved, then the policy is default and any previous default is cleared.
  - Given `first_response_minutes` = 10081, when submitted, then validation fails.
  - Given no toggle interaction, then the stored policy has business-hours true, pause false, default false.
- **Source refs:** app/Http/Controllers/Admin/Support/SlaController.php (storePolicy); app/Models/SlaPolicy.php; database/migrations/2026_05_23_160344_support_phase1_fixes_sla_nullable_status_remap.php.
- **Port notes:** Separate table or a `scope='platform'` discriminator from workspace policies to avoid the cross-tenant default clobber; enforce single default with a partial unique index (`WHERE is_default AND workspace_id IS NULL`).

### WD-SUPP-028 — Update and delete SLA policy

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-SUPP-026
- **Summary:** Policies can be deleted from the board; an update endpoint exists (PATCH) but no screen calls it.
- **Actors & access:** platform admins.
- **UX & screens:** only the Delete link exists (confirm "Delete policy '{name}'?"). There is no edit UI for policies.
- **Endpoints:**

  | Endpoint                               | Route name                | Action                      | Middleware  | Request               | Response                   |
  | -------------------------------------- | ------------------------- | --------------------------- | ----------- | --------------------- | -------------------------- |
  | PATCH admin/support/sla/policies/{id}  | admin.support.sla.update  | SlaController@updatePolicy  | admin group | same fields as create | 302 back "Policy updated." |
  | DELETE admin/support/sla/policies/{id} | admin.support.sla.destroy | SlaController@destroyPolicy | admin group | -                     | 302 back "Policy deleted." |

- **Data:** update writes the validated fields (workspace_id unchanged); `is_default=true` clears all other policies' defaults (`id != this`, again unscoped). Delete is a hard delete; `support_tickets.sla_policy_id` and `sla_breaches.sla_policy_id` are ON DELETE SET NULL; if the deleted policy was the default, no policy applies afterwards (pills show "no policy").
- **Rules & edge cases:**
  1. Update and delete accept ANY policy id including workspace policies of other tenants (no scope check).
  2. Neither action is audited.
  3. Deleting the last default silently disables SLA math platform-wide.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a default policy, when deleted, then the panel pills read "no policy".
  - Given a PATCH with valid data, when sent, then the policy reflects the new values and, if marked default, others lose default.
- **Source refs:** app/Http/Controllers/Admin/Support/SlaController.php; resources/views/admin/support/sla.blade.php.
- **Port notes:** Add the missing edit modal, block deleting a policy referenced by open tickets or warn, audit both, and scope to platform policies.

### WD-SUPP-029 — SLA calculation engine (policy pick, business hours, severity)

- **Status:** implemented
- **Priority:** P1
- **Effort:** L
- **Depends on:** WD-SUPP-027
- **Summary:** `SlaCalculator` decides which policy applies to a ticket, computes first-response and resolution deadlines (optionally counting only business hours), and returns remaining/over minutes with a severity bucket.
- **Actors & access:** internal service used by the panel (WD-SUPP-014) and the scanner (WD-SUPP-030).
- **UX & screens:** none directly.
- **Endpoints:** none.
- **Data:** reads `sla_policies`, `workspaces` (`timezone`, `business_hours` JSON), `support_tickets`.
- **Rules & edge cases:**
  1. Policy selection: the ticket's `sla_policy_id` if set (nothing ever sets it), else the FIRST row with `is_default = true` in the entire table (QUIRK: not filtered by workspace, so a workspace's own default policy from TIB2 could be picked; there is no ordering).
  2. Deadline = `created_at` + policy minutes. With `respect_business_hours=true` it walks forward counting only open time. Hours come from the ticket's CUSTOMER workspace (`business_hours` JSON `{tz, days:{mon:["09:00","17:00"],... sat:null}}`, missing keys fall back to Mon-Fri 09:00-17:00 in `tz` or workspace timezone or app timezone); the operator's own hours are never used. Look-ahead is bounded to 30 days of minutes. Result converted back to the app timezone.
  3. First response: if `first_response_at` exists -> deadline compared to it (`breached` if later, severity `met`, or `breach` when late); else compared with now: `minutes_remaining`/`minutes_over`, `breached = now > deadline`.
  4. Resolution: same, using `resolved_at`, otherwise running against now. Note closed-but-never-resolved tickets keep a running timer.
  5. Severity for running timers: `breach` if past due; `warn` when remaining minutes < max(5, quarter of the total window); else `ok`.
  6. `pause_when_waiting_on_customer`, `SlaPolicy::priority_overrides`, `targetsFor()`, `appliesToDevice()` and `bestFor()` (workspace SLA helpers) are NOT used for platform tickets; ticket priority never changes targets.
  7. The code comment says "not business-hours-aware in Phase 4 baseline"/stub `inBusinessHours()` - stale: business-hour math is implemented and defaults ON per policy.
  8. Timers never stop for status `pending`/`closed`.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** platform default policy; workspace `timezone` and `business_hours`.
- **Acceptance criteria:**
  - Given a 60-minute 24/7 policy and a ticket created 20 minutes ago with no reply, then first-response `minutes_remaining` is about 40, severity `ok`.
  - Given a 60-minute policy with 10 minutes left, then severity is `warn` (threshold max(5, 15)).
  - Given a business-hours policy and a ticket created Friday 16:30 in the workspace zone with a 120-minute target and Mon-Fri 09-17 hours, then the deadline is Monday 10:30 (30 minutes Friday plus 90 Monday).
  - Given no default policy and no ticket policy, then both timers are null.
- **Source refs:** app/Support/SlaCalculator.php; app/Models/SlaPolicy.php; app/Models/Workspace.php (business_hours, timezone).
- **Port notes:** Home `apps/api/src/modules/admin/support-desk/sla`. Pure functions with injected `now` and a `BusinessHoursProvider`; per-ticket SLA snapshot (`first_response_due_at`, `resolution_due_at` stored at creation and on policy change) would avoid recomputation and the scanner's incomplete-row problem. Decide whose business hours apply (WaDesk uses the customer's).

### WD-SUPP-030 — SLA breach scanner command

- **Status:** partial
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-SUPP-029
- **Summary:** `php artisan support:sla-scan` scans unresolved tickets and inserts one `sla_breaches` row per ticket per breach type (first_response, resolution) the first time a deadline is crossed. It feeds the SLA board and compliance figures - but it is never scheduled or called automatically.
- **Actors & access:** operators/cron (CLI).
- **UX & screens:** none; output line "[support:sla-scan] inserted N breach row(s) in Xms".
- **Endpoints:** none.
- **Data:** reads tickets whose status is not resolved/closed (chunks of 200, selecting only id, created_at, first_response_at, sla_policy_id); inserts `sla_breaches` (`ticket_id`, `sla_policy_id` = ticket's policy id (always null in practice), `breach_type`, `breached_at=now`, `severity` `breach` (never `warn`/`hard_breach`), `over_by_minutes`).
- **Rules & edge cases:**
  1. Idempotent by an existence check on (ticket_id, breach_type); no DB unique constraint (only an index) so concurrent runs can double-insert.
  2. QUIRK (documentation vs code): the header comment and `routes/console.php` say the scan runs every 5 minutes / is swept inline by the workspace team-inbox queue poll, but the schedule manifest is empty and no code calls `support:sla-scan` or `scanAndPersist` (the inline sweep only runs `inbox:escalate`/`inbox:wake-snoozed`). So on a stock install breaches are only recorded if the host cron-calls the command.
  3. QUIRK: because the query selects only four columns, the ticket's `workspace_id` is null inside the calculator, so the scan uses default Mon-Fri 09-17 in the APP timezone instead of the customer workspace's hours, disagreeing with the panel's pills.
  4. Resolved tickets are never scanned: a ticket resolved late (after a deadline but before any scan) never records a breach.
  5. Late-first-response tickets that are still unresolved would compute `over_by_minutes` from a signed Carbon diff (see Open questions) that may be negative and fail an unsigned column in strict mode.
  6. No notification, event or webhook is emitted on breach (the workspace-side `SlaBreached` event belongs to TIB2 and is unrelated).
- **Async & events:** intended cadence 5 minutes; nothing schedules it.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an open ticket 90 minutes old with no reply and a 60-minute 24/7 default policy, when the command runs, then one `first_response` breach row exists with over-by about 30 minutes; running again inserts nothing.
  - Given the port's scheduler, when a ticket crosses its resolution deadline, then a `resolution` breach is recorded within the sweep interval and the SLA board lists it.
  - Given a ticket with no applicable policy, then no rows are written.
- **Source refs:** app/Console/Commands/Support/ScanSlaBreaches.php; app/Support/SlaCalculator.php (scanAndPersist); routes/console.php; database/migrations/2026_05_23_154446_support_module_phase1_schema.php.
- **Port notes:** Implement as a BullMQ repeatable job (every 1-5 min) with a unique constraint on `(ticket_id, breach_type)`; load the workspace hours consistently with the panel; also emit an outbox event `support.sla.breached` for notifications.

### WD-SUPP-031 — Support reports dashboard

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-SUPP-007
- **Summary:** `Admin -> Support -> Reports` shows volume trend, average first-reply and resolution times, SLA compliance, status distribution and top agents over a selectable window (7, 30, 90 or 365 days).
- **Actors & access:** platform admins.
- **UX & screens:** `resources/views/admin/support/reports.blade.php`, key `support-reports`. Window buttons 7d/30d/90d/1y (active one filled), "Download CSV" (WD-SUPP-032). KPI tiles: "Tickets . 30d", "Resolved . 30d", "Avg 1st reply" (minutes), "Avg resolution" (minutes), "SLA compliance" (percent). QUIRK: tile labels and the intro copy are hard-coded "30d/Last 30 days" even when another window is selected. Panels: "Volume . last 30 days" (simple flex bar chart, one bar per day that HAS tickets, heights scaled to the max with a 4px floor; empty text "No tickets in the last 30 days."), "By status" (bar per status with count and percent; empty "No tickets yet."), "Top agents . 30 days" table (Agent, Resolved, Avg 1st reply, Avg resolution; empty "No resolved tickets yet.").
- **Endpoints:**

  | Endpoint                  | Route name            | Action                                | Middleware  | Request                                  | Response |
  | ------------------------- | --------------------- | ------------------------------------- | ----------- | ---------------------------------------- | -------- |
  | GET admin/support/reports | admin.support.reports | Admin\Support\ReportsController@index | admin group | `days` (int, clamped 1..365, default 30) | HTML     |

- **Data:** reads `support_tickets` and `sla_breaches` (raw), `users`. Definitions over the window `now - days`: tickets = created in window; resolved = `resolved_at` in window; avg first reply = average minutes created->first_response over tickets CREATED in the window that have `first_response_at`; avg resolution likewise with `resolved_at`; compliance as in WD-SUPP-026 with the window; volume = count per calendar date (server zone) with no zero-filling; by-status counts are ALL-TIME (not windowed); top agents = tickets with an assignee resolved in the window, grouped by user, top 8 by resolved count, with average first reply/resolution (nullable).
- **Rules & edge cases:**
  1. Averages are integer-rounded minutes; zero renders a dash.
  2. The `days` param accepts any integer and clamps; buttons only offer four values.
  3. No charts library; pure HTML bars; no drill-down.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given `?days=7`, when loaded, then all windowed metrics use 7 days (labels still say 30d in WaDesk; the port should label correctly).
  - Given `?days=9999`, then 365 is used.
  - Given no tickets, then each panel shows its empty text and compliance 100%.
  - Given agents with resolved tickets, then the table is ordered by resolved count and capped at 8.
- **Source refs:** app/Http/Controllers/Admin/Support/ReportsController.php (index); resources/views/admin/support/reports.blade.php.
- **Port notes:** Put on the ADMIN analytics stack (DASH chart components); fix labels to reflect `days`; zero-fill the volume series; window the status distribution or label it all-time.

### WD-SUPP-032 — Ticket CSV export

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-SUPP-031
- **Summary:** One click downloads every ticket as CSV for offline analysis.
- **Actors & access:** platform admins.
- **UX & screens:** "Download CSV" button on Reports.
- **Endpoints:**

  | Endpoint                             | Route name                   | Action                                    | Middleware  | Request | Response                                                         |
  | ------------------------------------ | ---------------------------- | ----------------------------------------- | ----------- | ------- | ---------------------------------------------------------------- |
  | GET admin/support/reports/export.csv | admin.support.reports.export | Admin\Support\ReportsController@exportCsv | admin group | none    | streamed `text/csv`, attachment `support-tickets-YYYY-MM-DD.csv` |

- **Data:** streams `support_tickets` (soft-delete scope on) ordered created_at desc in chunks of 500; header row then columns `ticket_number, subject, status, priority, workspace_id, assigned_agent_id, created_at, first_response_at, resolved_at`.
- **Rules & edge cases:**
  1. Always the full table: the selected window, filters and search are ignored.
  2. Timestamps come out as the DB-format strings; no message bodies, customer names or emails are exported.
  3. No formula-injection sanitization of subject text (a subject starting with `=` is exported raw).
  4. Not audited.
- **Async & events:** none (streamed synchronously).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 1200 tickets, when downloaded, then the file has 1201 lines (header + 1200) in newest-first order.
  - Given an admin without access, then 403.
  - Given the filename, then it carries the current date.
- **Source refs:** app/Http/Controllers/Admin/Support/ReportsController.php (exportCsv).
- **Port notes:** Stream with a server-side cursor; prefix cells that start with `=,+,-,@` to defuse CSV injection; accept the same filters as the list; audit the export.

### WD-SUPP-033 — Helpdesk audit trail

- **Status:** partial
- **Priority:** P1
- **Effort:** S
- **Depends on:** NOTIF
- **Summary:** Most operator mutations write an audit row (`support.reply`, `support.assign`, `support.status_change`, `support.priority_change`, `support.kanban_move`, `support.agent_added`, `support.playbook_created`, `support.playbook_run`, `support.sla_policy_created`).
- **Actors & access:** system (via the `Audit` facade); viewable in the admin audit log (NOTIF).
- **UX & screens:** none in this domain.
- **Endpoints:** none.
- **Data:** `audit_logs` rows via `Audit::log(action, {subject_type, subject_id, meta})`.
- **Rules & edge cases:**
  1. QUIRK: the facade assigns layer `platform` only when the action starts with `admin.`; none of the `support.*` actions do, so they are written to the `workspace` layer with `workspace_id` = the acting admin's `current_workspace_id`. They therefore show up in the admin's own workspace Activity Log and NOT in the platform layer used by `/admin/team-inbox/api/audit`.
  2. Not audited: agent toggle/remove, playbook toggle/delete, SLA update/delete, customer-side create/reply, CSV export, ticket creation.
  3. `support.kanban_move` passes non-standard keys, so its subject is empty.
  4. Meta payloads carry ids/flags, never message text.
- **Async & events:** synchronous insert; failures are swallowed by the logger.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an admin reply, then an audit row with action `support.reply`, subject `support_ticket` and meta `internal_note`/`emailed` exists.
  - Given a status change, then `support.status_change` exists with the new status.
  - Given the port, when any staff mutation occurs (including toggles/deletes), then an audit row in the platform layer exists.
- **Source refs:** app/Support/Audit.php; app/Services/Inbox/AuditLogger.php; all Admin/Support controllers.
- **Port notes:** Emit audit events in the same transaction as the mutation (outbox design outbox + audit) with `layer='platform'`; audit every mutation.

### WD-SUPP-034 — Support permission keys (seeded, never enforced)

- **Status:** dead-code
- **Priority:** P2
- **Effort:** S
- **Depends on:** RBAC
- **Summary:** The permission catalogue seeds `support.view`, `support.create`, `support.edit`, `support.delete` and grants them to Admin/Super Admin (all), Manager (view/edit), User (view), but no support route or view checks them.
- **Actors & access:** n/a.
- **UX & screens:** the keys appear in the Roles/Permissions admin screens (RBAC).
- **Endpoints:** none check them; every support admin route is guarded only by the admin middleware group.
- **Data:** Spatie `permissions` rows.
- **Rules & edge cases:**
  1. Any platform admin may do every support action; a Manager-role user without admin flag cannot reach `/admin` at all.
  2. Platform Support/Auditor roles cannot reach the admin console either (403 from the admin gate, see ASHELL), even though `PlatformPermissions` gives them inbox permissions.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the WaDesk baseline, when a platform admin without `support.edit` calls the reply endpoint, then it still succeeds (parity, flagged).
  - Given the port, then support routes require the equivalents of view/create/edit/delete permissions.
- **Source refs:** database/seeders/RolePermissionSeeder.php; routes/admin.php.
- **Port notes:** Map to `support.tickets.read|reply|assign|manage`, `support.sla.manage`, `support.playbooks.manage`, `support.reports.read` under RBAC design middleware RBAC and add `Platform Support` staff access so the role has a real purpose.

### WD-SUPP-035 — Advertised but missing: reply-by-email, auto-close, admin alerts

- **Status:** docs-only
- **Priority:** P2
- **Effort:** M
- **Depends on:** WD-SUPP-009
- **Summary:** Copy across the helpdesk implies behaviors that do not exist: replying to the notification email adds to the ticket; resolved tickets "close automatically"; "we'll get back within a few hours during business hours"; live support inbox; admins are alerted about new tickets/customer replies.
- **Actors & access:** n/a.
- **UX & screens:** email footer, customer form header, user page badge "Live support inbox".
- **Endpoints:** none.
- **Data:** none.
- **Rules & edge cases:**
  1. No inbound email/webhook creates or updates tickets; no Reply-To is set.
  2. No job closes or auto-resolves tickets by age or inactivity.
  3. Admins learn about new tickets only through: sidebar badge counts (open, unassigned, agents, SLA, playbooks; ASHELL), the notification-bell feed listing the newest 40 tickets as "New support ticket" (NOTIF), and the Inbox itself. Customer replies raise no notification.
  4. Response-time promise is copy only.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the WaDesk baseline, when a customer replies, then no staff email/notification is generated (parity).
  - Given the optional enhancement, when a customer replies, then the assignee (or all agents when unassigned) receives an in-app notification.
- **Source refs:** resources/views/emails/support/admin-reply.blade.php; resources/views/user/support/index.blade.php; app/Http/Controllers/Admin/AdminNotificationController.php.
- **Port notes:** Track as backlog; if built, use an inbound-email adapter (MAIL domain) with a ticket token in the address or subject.

### WD-SUPP-036 — Legacy support mock code (dead)

- **Status:** dead-code
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-SUPP-007
- **Summary:** Leftovers from the pre-Phase-1 prototype that nothing reaches: `AdminPagesController::support/supportSla/supportCustomers/supportPlaybooks/supportReports` (methods with no route; `support()` even returns the same view with different variables) and `resources/js/charts/support-index.js` (registered under page key `support-index` which no blade view uses).
- **Actors & access:** none.
- **UX & screens:** none reachable.
- **Endpoints:** none.
- **Data:** the legacy `support()` KPIs assumed no assignee column ("Mine = 0") and a 1h/4h fake urgent/breach heuristic.
- **Rules & edge cases:**
  1. Do not port. Real behavior is in the `Admin\Support\*` controllers.
  2. `SupportTicket::isOpen()` (status != resolved) and `statusLabel()` are also unused helpers.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the port, then no equivalent of these stubs exists.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (support methods); resources/js/charts/support-index.js; app/Models/SupportTicket.php.
- **Port notes:** Ignore; listed so the coverage audit has a home for `support-index.js`.

### WD-SUPP-037 — Platform inbox page and bootstrap

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** RBAC, WSP
- **Summary:** `Admin -> Team inbox` is a single-page console loaded from three JSON calls: it shows platform KPIs, a "Recent activity" workspace list with per-workspace open/breach counts, and hosts the conversation queue (WD-SUPP-038), drawer, audit panel and impersonation modal.
- **Actors & access:** platform admins (admin middleware group). The JSON endpoints additionally check Spatie `platform.*` permissions (WD-SUPP-046). Note: unrelated to the workspace-side `/team-inbox` (TIB1/TIB2).
- **UX & screens:** `resources/views/admin/team-inbox/index.blade.php` (key `team-inbox`, JS `admin-team-inbox-index.js`). Header copy: "Read-only view across every customer workspace. Use it to triage SLA breaches, flag spam, and (with reason) impersonate workspace owners". KPI tiles: Workspaces ("total active"), SLA breached ("across platform"), Open conversations ("all workspaces"), Active impersonation ("none / no active session" - static; never updated by JS, QUIRK). Right column "Workspaces / Recent activity": first 30 workspaces with name, `slug . plan`, "{n} open", and "{n} breach" in coral when > 0. Left: queue (WD-SUPP-038). Bottom: "Platform actions" audit panel (WD-SUPP-044). A toast div shows success/error messages (3.5s). Error handling: bootstrap failure shows toast "Bootstrap failed: ...".
- **Endpoints:**

  | Endpoint                           | Route name                     | Action                               | Middleware  | Request | Response                                                                                                                               |
  | ---------------------------------- | ------------------------------ | ------------------------------------ | ----------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
  | GET admin/team-inbox               | admin.team-inbox               | Admin\AdminTeamInboxController@index | admin group | -       | HTML                                                                                                                                   |
  | GET admin/team-inbox/api/bootstrap | admin.team-inbox.api.bootstrap | AdminTeamInboxController@bootstrap   | admin group | -       | JSON `{permissions{key:bool} for all 16 platform keys, workspaces[{id,name,slug,plan,status,open_count,breach_count,last_active_at}]}` |

- **Data:** workspaces ordered by `last_active_at` desc, limit 200, with two count subqueries over `conversations` (open = `inbox_status` in open/pending; breach = open AND `sla_breached=1`). Columns id,name,slug,plan,status,last_active_at.
- **Rules & edge cases:**
  1. Bootstrap performs NO permission check itself; it only reports the caller's permission booleans.
  2. QUIRK: the front end stores `permissions` but never uses it, so buttons the caller lacks permission for still render and fail with a toast on click (docs say the UI hides them).
  3. KPI "Workspaces" is the number of loaded rows (max 200), including suspended ones despite the "total active" caption; the other two KPIs are sums over those 200 workspaces only.
  4. Workspace list shows plan but not status/flag chips (docs claim status/suspended indication).
  5. Suspended workspaces (status false) are still listed.
- **Async & events:** none (no polling; a manual reload refreshes).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 250 workspaces, when the page loads, then the sidebar lists the most recently active 30 and KPI Workspaces reads 200.
  - Given a workspace with 3 open conversations, 1 breached, then its row shows "3 open" and "1 breach".
  - Given an Auditor-only permission set (port), then bootstrap returns false for write permissions.
- **Source refs:** app/Http/Controllers/Admin/AdminTeamInboxController.php (index, bootstrap); resources/views/admin/team-inbox/index.blade.php; resources/js/charts/admin-team-inbox-index.js; Documentation/pages/admin-panel/platform-inbox.html.
- **Port notes:** Home `apps/api/src/modules/admin/platform-inbox`. Cross-tenant reads require the platform DB role (BYPASSRLS or a `platform` GUC path) and must be audited. Use real aggregate counts (not the loaded slice) and hide UI actions by permission map.

### WD-SUPP-038 — Cross-workspace conversation queue

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-SUPP-037, TIB1
- **Summary:** A tabbed list of workspace conversations across the whole platform: SLA breach (default), Unassigned, Spam, All, with an optional workspace filter.
- **Actors & access:** requires Spatie permission `platform.conversation.view_all` (else 403 JSON).
- **UX & screens:** panel "Conversations": tabs (`sla_breach`, `unassigned`, `spam`, `all`) and an "All workspaces" select filled from bootstrap. Rows: title (or "Untitled"), red "SLA" chip if breached, grey "SPAM" chip, preview, `workspace . assignee-or-unassigned . team-or-dash`, last-message time (`HH:MM` today else `Mon D`). Empty: "No conversations match this filter." Clicking a row opens the drawer (WD-SUPP-039). No pagination controls: only page 1 (30 items) is ever requested.
- **Endpoints:**

  | Endpoint                       | Route name                 | Action                         | Middleware  | Request                                                                                                                          | Response                                                                                                                                                                                                                                                                       |
  | ------------------------------ | -------------------------- | ------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | GET admin/team-inbox/api/queue | admin.team-inbox.api.queue | AdminTeamInboxController@queue | admin group | `tab` (sla_breach\|unassigned\|spam\|all; unknown -> sla_breach), `workspace_id`, `page` (>=1), `per_page` (default 30, max 100) | JSON `{items[{id, workspace_id, workspace_name, title, preview, inbox_status, priority, channel, assignee_user_id, assignee_name, assignee_team_id, team_name, team_color, last_message_at, sla_breached, sla_first_due, sla_resolution_due, is_spam, flags[]}], total, page}` |

- **Data:** reads `conversations` (title/preview are encrypted-at-rest attributes, decrypted by the model) with assignee, team and workspace relations; `flags` = names of the workspace's active (uncleared) `workspace_flags`. Base filter `open()` = `inbox_status` in (open, pending), optionally `workspace_id`.
- **Rules & edge cases:**
  1. `sla_breach` = open AND `sla_breached=1`; `unassigned` = open AND `assignee_user_id IS NULL`; `all` = open.
  2. QUIRK: the `spam` tab replaces the whole query, so it ignores both the open-status scope and the workspace filter: it lists spam conversations from every workspace even when one is selected.
  3. Ordering `last_message_at` desc, `id` desc. Implementation fetches `per_page*4` rows and then slices the requested page in memory, so pages beyond the fourth are always empty; `total` is the number fetched (max `per_page*4`), not a true count.
  4. A `per_page` of 0 or less yields an empty page.
  5. `flags` is computed per row (N+1) via the workspace relation.
  6. Conversation content is visible to platform staff with no audit entry for viewing.
- **Async & events:** none (manual refresh on tab/filter change).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given breached open conversations in two workspaces, when the SLA tab loads, then both appear newest-message first with workspace names.
  - Given `workspace_id` filter on tab `unassigned`, then only that workspace's unassigned open conversations show.
  - Given the `spam` tab with a workspace filter, then spam from all workspaces still shows (WaDesk behavior, flagged).
  - Given a user without `platform.conversation.view_all`, then 403.
- **Source refs:** app/Http/Controllers/Admin/AdminTeamInboxController.php (queue); app/Models/Conversation.php (scopes); app/Models/WorkspaceFlag.php; resources/js/charts/admin-team-inbox-index.js.
- **Port notes:** Real keyset pagination with a true count, apply the workspace filter to spam, add an audit note on cross-tenant read access, keep title/preview decryption in the conversation read model (TIB1) rather than duplicating.

### WD-SUPP-039 — Read-only conversation drawer

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-SUPP-038
- **Summary:** Clicking a queue row opens a right drawer with the latest messages of that workspace conversation (read-only), the workspace agents' internal notes, the platform-only notes and an event timeline, plus Impersonate and Mark-spam actions.
- **Actors & access:** `platform.conversation.view_all` (403 otherwise).
- **UX & screens:** drawer (max 640px): header with workspace name, conversation title, buttons "Impersonate" and "Mark spam". Sections: Thread (message bubbles; outbound indented right on green, inbound left; text only, timestamp and direction; empty "No messages yet."), Platform notes (list plus textarea, severity select Info/Warn/Critical, "Add note"), Workspace notes (amber cards `author id . time`, empty "No internal notes."), Events (type label plus time; empty "No events.").
- **Endpoints:**

  | Endpoint                                    | Route name                | Action                        | Middleware  | Request    | Response                                                                                                                                                                                                                                                                                                                                                 |
  | ------------------------------------------- | ------------------------- | ----------------------------- | ----------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | GET admin/team-inbox/api/conversations/{id} | admin.team-inbox.api.show | AdminTeamInboxController@show | admin group | numeric id | JSON `{conversation{all attributes + workspace{id,name,slug,plan}, plaintext title/preview}, messages[{id,direction,body,media_path,media_type,status,user_id,created_at}], notes[{id,body,mentions,author_id,created_at}], events[{id,type,actor_user_id,payload,created_at}], platform_notes[{id,body,severity,admin_user_id,admin_name,created_at}]}` |

- **Data:** conversation (404 if missing) with workspace; last 80 messages (returned oldest-first); latest 80 workspace `conversation_notes` (newest first); latest 80 `conversation_events`; latest 80 `platform_notes` with admin name.
- **Rules & edge cases:**
  1. Each list is capped at 80 with no "load more".
  2. The whole conversation attribute array is returned (including SLA fields, assignee ids, flags) - broader than the UI uses.
  3. Media is exposed as path/type only; the drawer shows no attachments or media previews.
  4. Viewing is not audited (customer message content is exposed to staff silently), a compliance gap to fix in the port.
  5. Message ordering: newest 80 reversed to chronological.
  6. Drawer closes via overlay or the x button.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a conversation with 100 messages, when opened, then the 80 newest show in chronological order.
  - Given platform notes and workspace notes, then they appear in separate sections.
  - Given a missing conversation id, then a toast reports the failure.
  - Given the caller lacks the permission, then 403.
- **Source refs:** app/Http/Controllers/Admin/AdminTeamInboxController.php (show); resources/views/admin/team-inbox/index.blade.php; resources/js/charts/admin-team-inbox-index.js.
- **Port notes:** Return a narrowed DTO; write an `audit_logs` row (`platform.conversation.viewed`) per open with rate limiting; decide retention/privacy policy for viewing message bodies (GDPR).

### WD-SUPP-040 — Platform-only notes on a conversation

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-SUPP-039
- **Summary:** Staff can attach severity-tagged internal notes to a customer conversation that workspace users never see.
- **Actors & access:** requires `platform.note.write`.
- **UX & screens:** textarea "Write a platform-only note..." with severity select and "Add note"; empty body is ignored client-side; on success toast "Platform note added.", drawer re-fetches and the audit panel reloads.
- **Endpoints:**

  | Endpoint                                          | Route name                | Action                                | Middleware  | Request                                                                                   | Response                                             |
  | ------------------------------------------------- | ------------------------- | ------------------------------------- | ----------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------- |
  | POST admin/team-inbox/api/conversations/{id}/note | admin.team-inbox.api.note | AdminTeamInboxController@platformNote | admin group | `body` required string max 8000; `severity` nullable in info,warn,critical (default info) | JSON `{ok:true, note}` (404 if conversation missing) |

- **Data:** `platform_notes` (`conversation_id`, `workspace_id` copied from the conversation, `admin_user_id`, `body` encrypted at rest via the model cast, `severity`, timestamps). Indexed by conversation and workspace.
- **Rules & edge cases:**
  1. Notes cannot be edited or deleted (no endpoints).
  2. Audit (platform layer) `platform_note.added` with subject `platform_note` and the workspace id.
  3. Never exposed to the workspace UI/API (only this drawer reads them).
- **Async & events:** audit row.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a user with `platform.note.write`, when a note with severity warn is added, then it is stored encrypted, returned decrypted in the response and shown in the drawer with "warn".
  - Given a user without the permission, then 403.
  - Given an 8001-char body, then validation fails.
- **Source refs:** app/Http/Controllers/Admin/AdminTeamInboxController.php (platformNote); app/Models/PlatformNote.php; resources/js/charts/admin-team-inbox-index.js.
- **Port notes:** Column-level encryption via the platform crypto helper; add edit/delete only if product requires (audit trail must keep history).

### WD-SUPP-041 — Mark conversation as spam (global)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-SUPP-039
- **Summary:** From the drawer, staff mark a conversation as spam; it leaves normal queues and appears under the Spam tab across the platform.
- **Actors & access:** requires `platform.conversation.flag_spam`.
- **UX & screens:** "Mark spam" button with a browser confirm "Mark this conversation as spam?"; success toast "Flagged as spam.", drawer closes, queue reloads.
- **Endpoints:**

  | Endpoint                                          | Route name                | Action                            | Middleware  | Request | Response         |
  | ------------------------------------------------- | ------------------------- | --------------------------------- | ----------- | ------- | ---------------- |
  | POST admin/team-inbox/api/conversations/{id}/spam | admin.team-inbox.api.spam | AdminTeamInboxController@flagSpam | admin group | -       | JSON `{ok:true}` |

- **Data:** sets `conversations.is_spam = true` and `inbox_status = 'spam'` (previous status is lost); inserts a `conversation_events` row type `spam_flagged` with actor type `platform_admin`; audit `conversation.spam_flagged`.
- **Rules & edge cases:**
  1. No un-spam endpoint in this domain (a workspace-side action may reopen; see TIB1).
  2. No reason field, no notification to the workspace; the conversation silently disappears from their open lists.
  3. Repeated calls are idempotent but add duplicate events/audit rows.
- **Async & events:** conversation event + audit; the workspace realtime channel is not notified by this controller.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an open conversation, when marked spam, then `is_spam` is true, `inbox_status` is `spam`, an event of type `spam_flagged` exists and the Spam tab lists it.
  - Given a user without the permission, then 403.
  - Given a nonexistent id, then 404.
- **Source refs:** app/Http/Controllers/Admin/AdminTeamInboxController.php (flagSpam); app/Models/ConversationEvent.php.
- **Port notes:** Store the pre-spam status so it can be restored; expose un-spam with permission; publish a realtime event to the workspace so open inbox tabs update.

### WD-SUPP-042 — Flag and clear workspace flags (API only)

- **Status:** partial
- **Priority:** P1
- **Effort:** S
- **Depends on:** WSP
- **Summary:** Staff can attach a typed flag (spam, abuse, fraud, billing_overdue, tos_violation, frozen) with an optional reason to a workspace and later clear it. The endpoints work, but the platform inbox UI has no controls for them although the docs describe flagging from the drawer.
- **Actors & access:** flag needs `platform.workspace.flag`; clear needs `platform.workspace.unflag`.
- **UX & screens:** none (no buttons in `team-inbox/index.blade.php` or its JS); flags only surface as an array in queue items and in the enforcement middleware.
- **Endpoints:**

  | Endpoint                                       | Route name                      | Action                                 | Middleware  | Request                                                      | Response                               |
  | ---------------------------------------------- | ------------------------------- | -------------------------------------- | ----------- | ------------------------------------------------------------ | -------------------------------------- |
  | POST admin/team-inbox/api/workspaces/{id}/flag | admin.team-inbox.api.flag       | AdminTeamInboxController@flagWorkspace | admin group | `flag` required in the six values; `reason` nullable max 500 | JSON `{ok, flag}`                      |
  | DELETE admin/team-inbox/api/flags/{id}         | admin.team-inbox.api.flag.clear | AdminTeamInboxController@clearFlag     | admin group | -                                                            | JSON `{ok:true}` (404 if flag missing) |

- **Data:** `workspace_flags` insert (`workspace_id`, `flag`, `reason`, `flagged_by_user_id`) / update (`cleared_at`, `cleared_by_user_id`). Audit `workspace.flagged` (payload flag, reason) and `workspace.unflagged`.
- **Rules & edge cases:**
  1. The flag endpoint does not verify the workspace exists (an orphan flag row can be created).
  2. Duplicate active flags of the same type are allowed.
  3. QUIRK with real effect: the workspace membership middleware treats a workspace as suspended when it has an active `frozen`, `tos_violation` OR `fraud` flag (`Workspace::isSuspended`), so flagging fraud/tos_violation blocks access exactly like suspension, even though the UI/docs call flags "informational".
  4. Clearing sets `cleared_at`, keeping history; nothing deletes flags.
- **Async & events:** audit rows (platform layer).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given `platform.workspace.flag`, when flag `fraud` is posted for a workspace, then a flag row is created and workspace members are treated as suspended.
  - Given an active flag, when cleared with `platform.workspace.unflag`, then `cleared_at` is set and access returns.
  - Given a flag value outside the list, then validation fails.
- **Source refs:** app/Http/Controllers/Admin/AdminTeamInboxController.php; app/Models/WorkspaceFlag.php; app/Models/Workspace.php (isSuspended); app/Http/Middleware/EnsureWorkspaceMembership.php.
- **Port notes:** Shared with WSP (workspace flags and suspension enforcement live there). Build the missing UI (workspace panel with flag chips, add/clear) and make the effect of each flag explicit in the UI.

### WD-SUPP-043 — Suspend and unsuspend workspace (API only)

- **Status:** partial
- **Priority:** P1
- **Effort:** S
- **Depends on:** WSP
- **Summary:** Staff can suspend a workspace with an optional reason (sets it inactive and adds a `frozen` flag) and later unsuspend it (reactivates and clears frozen flags). Endpoints exist; no UI in the platform inbox invokes them.
- **Actors & access:** `platform.workspace.suspend` / `platform.workspace.unsuspend`. Seeded to Super Admin and Admin (docs say Super Admin only); Platform Support does not have suspend.
- **UX & screens:** none.
- **Endpoints:**

  | Endpoint                                            | Route name                     | Action                                      | Middleware  | Request                          | Response                                    |
  | --------------------------------------------------- | ------------------------------ | ------------------------------------------- | ----------- | -------------------------------- | ------------------------------------------- |
  | POST admin/team-inbox/api/workspaces/{id}/suspend   | admin.team-inbox.api.suspend   | AdminTeamInboxController@suspendWorkspace   | admin group | `reason` nullable string max 500 | JSON `{ok:true}` (404 if workspace missing) |
  | POST admin/team-inbox/api/workspaces/{id}/unsuspend | admin.team-inbox.api.unsuspend | AdminTeamInboxController@unsuspendWorkspace | admin group | -                                | JSON `{ok:true}`                            |

- **Data:** `workspaces.status` false/true; suspend inserts a `workspace_flags` row flag `frozen` with the reason; unsuspend clears all ACTIVE `frozen` flags. Audit `workspace.suspended` / `workspace.unsuspended`.
- **Rules & edge cases:**
  1. Suspend does not clear other flags; unsuspend leaves `fraud`/`tos_violation` flags in place (so the workspace can stay blocked by `isSuspended`).
  2. Suspending an already-suspended workspace adds another `frozen` flag.
  3. No notification to workspace owner; no forced session logout; the middleware blocks on next request.
  4. Impersonation sessions are exempt from the suspension gate (ASHELL).
- **Async & events:** audit rows.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given `platform.workspace.suspend`, when suspended with reason "chargeback", then `status` is false and an active `frozen` flag with that reason exists.
  - Given unsuspend, then `status` is true and the frozen flags are cleared.
  - Given a workspace with an active `fraud` flag, when unsuspended, then members remain blocked until the fraud flag is cleared.
- **Source refs:** app/Http/Controllers/Admin/AdminTeamInboxController.php; app/Models/WorkspaceFlag.php; app/Models/Workspace.php.
- **Port notes:** Owned functionally by WSP; here only expose the platform-inbox surface. Add UI, owner notification and session revocation as improvements.

### WD-SUPP-044 — Platform audit feed panel

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** NOTIF
- **Summary:** The bottom of the platform inbox lists the latest 50 platform-layer audit events (action, workspace id, time), loaded from a JSON endpoint that also supports layer and workspace filters.
- **Actors & access:** `platform.audit.view` (403 otherwise; the UI swallows the 403 silently).
- **UX & screens:** panel "Platform actions" (`#audit`, header button "Audit log" jumps to it): rows with monospace action, `workspace_id N` or dash, time; empty "No audit events yet." The UI always requests `layer=platform` and offers no filter controls (docs claim filtering).
- **Endpoints:**

  | Endpoint                       | Route name                 | Action                            | Middleware  | Request                            | Response                                                   |
  | ------------------------------ | -------------------------- | --------------------------------- | ----------- | ---------------------------------- | ---------------------------------------------------------- |
  | GET admin/team-inbox/api/audit | admin.team-inbox.api.audit | AdminTeamInboxController@auditLog | admin group | `layer`, `workspace_id` (optional) | JSON array of up to 200 raw `audit_logs` rows newest first |

- **Data:** `audit_logs` (all columns incl. `ip`, `user_agent`, `payload`), newest first, limit 200; the UI slices 50.
- **Rules & edge cases:**
  1. Only events written with layer `platform` show under `layer=platform` (spam flag, platform notes, workspace flag/suspend, impersonation, IP-block); helpdesk `support.*` audits are in the workspace layer (WD-SUPP-033).
  2. No pagination and no export here (the full audit log is `/admin/audit-log`, NOTIF).
  3. Raw rows expose IP and user agent to anyone with the permission.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a platform note added, when the panel loads, then `platform_note.added` appears first.
  - Given `layer=workspace&workspace_id=5`, when requested via API, then only those rows return.
  - Given a user without `platform.audit.view`, then 403 and the panel shows the empty text.
- **Source refs:** app/Http/Controllers/Admin/AdminTeamInboxController.php (auditLog); resources/js/charts/admin-team-inbox-index.js.
- **Port notes:** Home is NOTIF's audit module (this route is claimed there too); map the response to a DTO, add pagination and filters in the UI.

### WD-SUPP-045 — Impersonate launcher from the drawer

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WSP
- **Summary:** The drawer's Impersonate button opens a modal that requires a reason (8+ chars, checked client-side) and then submits a native form to `admin/impersonate/{workspaceId}`; the server side (session, audit, redirect into the workspace inbox) belongs to WSP.
- **Actors & access:** button is always visible; the server needs `platform.workspace.impersonate` (WSP/RBAC).
- **UX & screens:** modal "Start impersonation": warning copy that the customer's workspace is viewed as its owner and the session is audit-logged, reason textarea ("Reason (required, min 8 chars)..."), Cancel and "Start session". Client toast "Reason must be at least 8 characters." on short input; a workspace must be targeted (else "No target workspace.").
- **Endpoints:** `POST admin/impersonate/{workspaceId}` (owned by WSP, `Admin\ImpersonationController@start`); this domain only builds the CSRF form with `reason`.
- **Data:** none written here.
- **Rules & edge cases:**
  1. The reason limits (min 8 client-side; the server enforces 8-500 per WSP docs) live in WSP.
  2. The drawer's workspace id comes from the queue row, so impersonation is only reachable through a conversation, not directly from the workspace list.
- **Async & events:** see WSP (audit start/stop).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the modal, when the reason is 7 characters, then no request is sent and an error toast shows.
  - Given a valid reason, when confirmed, then a POST to the impersonation endpoint with `reason` and CSRF is submitted and the browser follows the redirect.
- **Source refs:** resources/views/admin/team-inbox/index.blade.php; resources/js/charts/admin-team-inbox-index.js; routes/admin.php.
- **Port notes:** Implementation detail: call the WSP impersonation API via fetch and then navigate; keep the reason mandatory in the shared contract.

### WD-SUPP-046 — Platform inbox permission model and staff-role reality

- **Status:** partial
- **Priority:** P1
- **Effort:** S
- **Depends on:** RBAC
- **Summary:** Each platform-inbox action checks a `platform.*` Spatie permission, but the whole console sits behind the platform-admin gate, so only Admin/Super Admin ever get in and the Platform Support/Auditor role matrices are effectively unreachable.
- **Actors & access:** see table.
- **UX & screens:** none (permission errors surface as toasts).
- **Endpoints:** all `admin/team-inbox/api/*` routes.
- **Data:** Spatie roles/permissions (RBAC).
- **Rules & edge cases:**
  1. Permission per endpoint: queue and show -> `platform.conversation.view_all`; note -> `platform.note.write`; spam -> `platform.conversation.flag_spam`; flag -> `platform.workspace.flag`; clear flag -> `platform.workspace.unflag`; suspend/unsuspend -> `platform.workspace.suspend`/`unsuspend`; audit -> `platform.audit.view`; bootstrap: no check.
  2. Checks are done through `PlatformPermissions::userCan` (Spatie `hasPermissionTo`, any exception becomes false).
  3. Seeder: Super Admin and Admin get every permission; Platform Support gets view_all, impersonate, flag, unflag, conversation view/flag_spam, note.write, audit.view, user.view_all; Auditor gets read-only view_all/conversation.view_all/audit.view/user.view_all. The class constant `MATRIX` differs slightly (omits unflag) and is unused.
  4. Docs say only Super Admin can suspend by default; the seeder grants Admin all permissions too.
  5. Users holding only Platform Support/Auditor fail the admin middleware (403 on `/admin/*`), so they cannot use this inbox at all despite the matrix.
  6. Legacy `users.role` admins without Spatie roles/permissions get 403 on every endpoint that checks a permission (the check is Spatie-only).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a Spatie Admin, then all inbox endpoints succeed.
  - Given a user with the Auditor role (port), then queue/show/audit succeed and note/spam/flag/suspend are 403.
  - Given a legacy-role admin with no Spatie permission, then permission-checked endpoints return 403 (WaDesk behavior, flagged).
- **Source refs:** app/Support/PlatformPermissions.php; database/seeders/RolePermissionSeeder.php; app/Http/Controllers/Admin/AdminTeamInboxController.php.
- **Port notes:** Under RBAC design map to `platform.inbox.read`, `platform.inbox.note`, `platform.inbox.spam`, `platform.workspace.flag`, `platform.workspace.suspend`; let `Platform Support` and `Auditor` staff roles reach exactly these routes through a staff guard instead of the blanket admin gate.

## Data model

Platform-owned (NOT tenant/RLS tables; readable by platform staff, filtered by `user_id` for customers): `support_tickets`, `support_messages`, `support_agents`, `support_assignments`, `sla_breaches`, `playbooks`, `platform_notes`. Shared with other domains: `sla_policies` (workspace SLA in TIB2 uses `workspace_id`, `device_ids`, `priority_overrides`; the helpdesk uses only `workspace_id IS NULL` rows plus, by accident, all rows) and `workspace_flags` (WSP owns enforcement).

### support_tickets

Purpose: one row per customer ticket (initial message inline). Written by WD-SUPP-001/005/009/011/012/013/015/016/024; read everywhere. Row volume: low (tens to thousands).

- `id` bigint PK; `user_id` bigint NOT NULL FK users ON DELETE CASCADE (opener); `workspace_id` bigint NULL FK workspaces ON DELETE SET NULL (opener's current workspace at creation).
- `ticket_number` varchar(16) NOT NULL UNIQUE (`TKT-XXXXXX`).
- `reason` varchar(32) NOT NULL default `other`; values bug|delivery|template|billing|integration|account|other (stored, never displayed).
- `name` varchar(191), `email` varchar(191) (reply address), `subject` varchar(191), `message` text (initial message) all NOT NULL.
- `status` varchar(24) NOT NULL default `open`; values open|in_progress|pending|resolved|closed (legacy awaiting_support/awaiting_user remapped to pending/in_progress by migration).
- `priority` varchar(12) NOT NULL default `normal`; low|normal|high|urgent.
- `assigned_agent_id` bigint NULL FK users ON DELETE SET NULL (a user id, not support_agents.id); `sla_policy_id` bigint NULL FK sla_policies SET NULL (never written).
- `last_reply_at`, `first_response_at`, `resolved_at` timestamp NULL; `tags` JSON NULL (never populated; playbook add_tag risky), `meta` JSON NULL (unused).
- `created_at`, `updated_at`, `deleted_at` (SoftDeletes; nothing soft-deletes today).
- Indexes: (user_id,status), (workspace_id,status), (status,priority), assigned_agent_id, sla_policy_id, unique ticket_number.
- `$fillable` on the model omits priority/assigned_agent_id/first_response_at/tags/sla_policy_id; controllers assign attributes directly.

### support_messages

Thread replies (no row for the initial message). `id`; `ticket_id` FK support_tickets CASCADE; `author_user_id` NULL FK users SET NULL; `author_role` varchar(16) default `admin` (admin|customer|system; `system` never written); `body` text; `attachments` JSON (unused); `is_internal_note` bool default 0 (private to staff); `created_at` timestamp default now (no `updated_at`; model timestamps off). Index (ticket_id, created_at). Written by WD-SUPP-005/009/024.

### support_agents

Platform support staff registry. `id`; `user_id` FK users CASCADE; `workspace_id` NULL FK workspaces CASCADE (always NULL in practice = platform-wide); `is_active` bool default 1; `specialty` varchar(60) NULL (label only); `current_load` unsigned int default 0 (never updated); timestamps. Unique (user_id, workspace_id) - ineffective for NULL workspace in MySQL/Postgres. Read by assign dropdown, roster, sidebar badge.

### support_assignments

Designed history of who handled which ticket: `id`, `ticket_id` FK CASCADE, `agent_user_id` FK users CASCADE, `assigned_at` default now, `released_at` NULL, `outcome` varchar(24) NULL (resolved|abandoned|reassigned). Index (ticket_id, released_at). No code reads or writes it (WD-SUPP-019).

### sla_policies (shared)

`id`; `workspace_id` NULL (NULL = platform-wide; made nullable by 2026_05_23_160344); `name` varchar(128); `first_response_minutes`, `resolution_minutes` unsigned int NULL; `pause_when_waiting_on_customer` bool default 1 (form default off; unused in calc); `respect_business_hours` bool default 1; `device_ids` JSON and `priority_overrides` JSON (workspace SLA only); `is_default` bool default 0; timestamps. Indexes (workspace_id,is_default), (workspace_id). Helpdesk validation: name max 120, first_response 1..10080, resolution 1..43200.

### sla_breaches

One row per (ticket, breach type) crossing. `id`; `ticket_id` FK support_tickets CASCADE; `sla_policy_id` NULL FK SET NULL (always null in practice); `breach_type` varchar(24) first_response|resolution; `breached_at` default now; `severity` varchar(16) default warn (warn|breach|hard_breach; only `breach` is ever written); `over_by_minutes` unsigned int NULL. Index (ticket_id, breach_type) (not unique). Written only by the scanner (WD-SUPP-030); read by SLA board and compliance metrics.

### playbooks

`id`; `workspace_id` NULL FK workspaces CASCADE (unused, always NULL); `name` varchar(120); `slug` varchar(140) UNIQUE; `trigger_type` varchar(24) default manual (manual|status_change|tag_added); `trigger_value` varchar(120) NULL; `steps` JSON list of `{action, value}` where action in set_status|set_priority|add_tag|reply|assign|note; `is_active` bool default 1; `use_count` unsigned int default 0; timestamps.

### platform_notes

`id`; `conversation_id` NULL (no FK constraint); `workspace_id` NULL (no FK); `admin_user_id` NOT NULL (no FK); `body` text (encrypted at rest by cast); `severity` varchar(12) default info (info|warn|critical); timestamps. Indexes on conversation_id and workspace_id. Written by WD-SUPP-040.

### workspace_flags (shared with WSP)

`id`; `workspace_id` NOT NULL; `flag` varchar(32) in spam|abuse|fraud|billing_overdue|tos_violation|frozen; `reason` varchar(500) NULL; `flagged_by_user_id`, `cleared_at`, `cleared_by_user_id`; timestamps. Indexes (workspace_id, cleared_at), workspace_id, flag. Active flag = `cleared_at IS NULL`.

## Cross-domain contracts

- **Consumes ASHELL:** admin middleware group (`EnsureUserIsAdmin`, `IPAllowlist`), admin layout components, sidebar Support group; exposes to ASHELL the counts it renders (open/unassigned tickets, active agents, ticket-emails, active playbooks, SLA-heuristic count = open tickets with no first response).
- **Consumes RBAC:** Spatie `platform.*` permissions checked via `PlatformPermissions::userCan` (WD-SUPP-046); exposes: `support.*` keys are seeded but unused (WD-SUPP-034).
- **Consumes NOTIF:** `Audit::log` / `AuditLogger::platform` writers (audit_logs) and the audit log screens; NOTIF also lists the reply email view (`emails/support/admin-reply.blade.php`) and reads `support_tickets` for the admin notification bell ("New support ticket", newest 40, link `/admin/support`); the `GET admin/team-inbox/api/audit` route is claimed by both domains.
- **Consumes WSP:** `workspaces` (name, slug, plan, status, `last_active_at`, `timezone`, `business_hours`), `workspace_flags` semantic (`Workspace::isSuspended` blocks on frozen/tos_violation/fraud), impersonation start endpoint; WSP also documents flag/suspend endpoints that this domain's controller implements (shared).
- **Consumes TIB1/TIB2:** `conversations` (title/preview decrypted, `inbox_status`, `is_spam`, `sla_breached`, assignee, team), `conversation_notes`, `conversation_events`, `messages`; TIB2 owns workspace SLA policies in `sla_policies` (workspace_id set) and the `RoutingEngine`; this domain must not collide on the default-policy flag (WD-SUPP-027/029).
- **Consumes SET:** system settings `from_email`, `app_name`, `app_url`, mail transport for the reply email; storage (only if real attachments are built).
- **Consumes AUTH:** authenticated user, `users.current_workspace_id`, `/account?tab=support` (AccountController) and `/more` chips read `support_tickets` (WD-SUPP-003).
- **Exposes:** `support_tickets` (customer summary counts, admin badges), `sla_policies` platform rows, `SlaCalculator`, `Playbook`/`SupportAgent` models. Nothing is published as events or webhooks in WaDesk.
- **CMS:** the support-guidebook doc page describes both this helpdesk and the Guidebook article CMS; only the helpdesk half is documented here.

## Open questions & quirks

1. **Scanner never runs.** `support:sla-scan` is described as every-5-minutes and as "swept by the team-inbox queue", but the schedule manifest is empty and no code calls it; `sla_breaches` is empty unless a host cron calls the command. Decide whether the port schedules it (recommended) or removes the breach table and computes on read.
2. **Carbon 3 signed differences.** `SlaCalculator` calls `diffInMinutes` with the later-dated argument in a way that under Carbon 3 (installed 3.11.4) likely yields negative and fractional minutes for "met late" cases, and the scan writes `over_by_minutes` into an unsigned column. Verify at parity time and specify the port as integer, non-negative minutes.
3. **Customer vs operator business hours.** Panel pills use the ticket's customer workspace `business_hours`/`timezone`; the scanner omits `workspace_id` from its select so it uses defaults (Mon-Fri 09-17 app timezone). Decide one rule.
4. **Default-policy clobber.** Creating/updating a default SLA policy in the admin form clears `is_default` on every `sla_policies` row, including workspace-owned policies (TIB2); `policyFor` takes the first default row without a workspace filter; the SLA board lists and can delete workspace policies. Treat as a cross-tenant defect in the port.
5. **Playbook builder validation.** With three fixed slots and `required_with` on step action, partially-filled builders likely fail; `add_tag` likely errors due to a missing array cast on `tags`; `set_status` playbook steps do not maintain `resolved_at`; `reply` steps do not email. Verify each with the parity skill before rebuilding.
6. **Inconsistent status writers.** Panel status, kanban move, playbooks and customer reply each handle `resolved_at`/`first_response_at` differently (WD-SUPP-012/016/024/005). Port with one transition service; record any deliberate normalisation.
7. **Open-count definitions differ** by surface: operator open = open|in_progress|pending; customer/account/`/more` open = not `resolved` (counts closed); unassigned KPI = open|pending only; sidebar Team badge = open|pending|in_progress.
8. **Audit layer.** Helpdesk audit rows land in the workspace layer of the acting admin (no `admin.` prefix); kanban audit has no subject; several mutations are unaudited.
9. **Docs vs code (platform inbox).** Docs say buttons are hidden by permission, workspace rows show plan/status, flags/suspend are available from the drawer/workspace panel, the audit panel is filterable, and only Super Admin can suspend: the UI has none of the flag/suspend controls, ignores the permission map, shows no status chips, has no audit filters, and the seeder grants suspend to Admin as well. "Active impersonation" tile is static.
10. **Docs vs code (helpdesk).** Customers page copy mentions impersonation (absent); Agents copy mentions auto-assignment (absent); reply email mentions reply-by-email and auto-close (absent); form copy claims markdown and 10 MB attachments (absent); "Live support inbox" is just a static badge; the support-guidebook doc's "Playbooks - reusable canned responses" oversells the six-action macro engine.
11. **Platform Support and Auditor lockout.** These Spatie roles cannot pass the admin gate, so the platform inbox matrix is moot for them (ASHELL/RBAC quirk); the port should give staff roles a real entry point.
12. **Unused schema:** `support_assignments`, `support_agents.current_load`, `support_tickets.sla_policy_id/tags/meta`, `support_messages.attachments`, `playbooks.workspace_id`, `sla_policies.priority_overrides/device_ids` (helpdesk side), `SupportTicket::statusLabel/isOpen`, `SlaPolicy::targetsFor/appliesToDevice/bestFor` for platform tickets.
13. **Privacy:** platform staff can read customer message bodies in the drawer without an audit entry; ticket replies are HTML-escaped by renderers but stored raw.
14. **Ticket ownership is per user**, not per workspace: a teammate cannot see or reply to a colleague's ticket, and `workspace_id` is a snapshot of the creator's current workspace at creation time.
15. **Unclaimed neighbours:** `Admin/ContactMessagesController` (public contact form inbox with its own sidebar badge) is a separate feature outside this domain (CMS); the workspace-side `TeamInboxController`/`SlaTracker`/`SlaBreached` event belong to TIB1/TIB2. All workspace-side `team-inbox*` routes (page, `team-inbox/api/*`, `team-inbox/sla*`, kanban, members, PWA manifest/push) are deliberately left to TIB1/TIB2/TCHAT/NOTIF/WSP even though they share the "team inbox" name and the `sla` uri fragment with this domain; Slack routes belong to INTG and translation routes to I18N.
16. **Time and locale:** admin tables print server-zone times; the customer thread uses the user's zone via `wa_local`; the panel uses browser locale. Standardise on stored UTC + viewer zone in the port.

## Coverage

```json wadesk-coverage
{
  "routes": [
    "GET admin/support",
    "GET admin/support/agents",
    "POST admin/support/agents",
    "DELETE admin/support/agents/{id}",
    "POST admin/support/agents/{id}/toggle",
    "GET admin/support/customers",
    "GET admin/support/customers/{wsId}",
    "GET admin/support/playbooks",
    "POST admin/support/playbooks",
    "DELETE admin/support/playbooks/{id}",
    "POST admin/support/playbooks/{id}/toggle",
    "GET admin/support/reports",
    "GET admin/support/reports/export.csv",
    "GET admin/support/sla",
    "POST admin/support/sla/policies",
    "PATCH admin/support/sla/policies/{id}",
    "DELETE admin/support/sla/policies/{id}",
    "GET admin/support/team-inbox",
    "GET admin/support/{id}",
    "POST admin/support/{id}/assign",
    "POST admin/support/{id}/move",
    "POST admin/support/{id}/priority",
    "POST admin/support/{id}/reply",
    "POST admin/support/{id}/status",
    "POST admin/support/{tid}/run-playbook/{pid}",
    "GET admin/team-inbox",
    "GET admin/team-inbox/api/audit",
    "GET admin/team-inbox/api/bootstrap",
    "GET admin/team-inbox/api/conversations/{id}",
    "POST admin/team-inbox/api/conversations/{id}/note",
    "POST admin/team-inbox/api/conversations/{id}/spam",
    "DELETE admin/team-inbox/api/flags/{id}",
    "GET admin/team-inbox/api/queue",
    "POST admin/team-inbox/api/workspaces/{id}/flag",
    "POST admin/team-inbox/api/workspaces/{id}/suspend",
    "POST admin/team-inbox/api/workspaces/{id}/unsuspend",
    "GET support",
    "POST support",
    "GET support/{id}",
    "POST support/{id}/reply"
  ],
  "controllers": [
    "app/Http/Controllers/Admin/AdminTeamInboxController.php",
    "app/Http/Controllers/Admin/Support/AgentsController.php",
    "app/Http/Controllers/Admin/Support/CustomersController.php",
    "app/Http/Controllers/Admin/Support/InboxController.php",
    "app/Http/Controllers/Admin/Support/PlaybooksController.php",
    "app/Http/Controllers/Admin/Support/ReportsController.php",
    "app/Http/Controllers/Admin/Support/SlaController.php",
    "app/Http/Controllers/Admin/Support/TeamInboxController.php",
    "app/Http/Controllers/SupportTicketController.php"
  ],
  "services": ["app/Support/SlaCalculator.php"],
  "models": [
    "Playbook",
    "PlatformNote",
    "SlaPolicy",
    "SupportAgent",
    "SupportMessage",
    "SupportTicket",
    "WorkspaceFlag"
  ],
  "tables": [
    "playbooks",
    "platform_notes",
    "sla_breaches",
    "sla_policies",
    "support_agents",
    "support_assignments",
    "support_messages",
    "support_tickets",
    "workspace_flags"
  ],
  "views": [
    "resources/views/admin/support/agents.blade.php",
    "resources/views/admin/support/customer-show.blade.php",
    "resources/views/admin/support/customers.blade.php",
    "resources/views/admin/support/index.blade.php",
    "resources/views/admin/support/playbooks.blade.php",
    "resources/views/admin/support/reports.blade.php",
    "resources/views/admin/support/sla.blade.php",
    "resources/views/admin/support/team-inbox.blade.php",
    "resources/views/admin/team-inbox/index.blade.php",
    "resources/views/emails/support/admin-reply.blade.php",
    "resources/views/user/support/index.blade.php",
    "resources/views/user/support/show.blade.php"
  ],
  "commands": ["support:sla-scan"],
  "permissions": [
    "support.view",
    "support.create",
    "support.edit",
    "support.delete",
    "platform.audit.view",
    "platform.conversation.flag_spam",
    "platform.conversation.view_all",
    "platform.note.write",
    "platform.workspace.flag",
    "platform.workspace.unflag",
    "platform.workspace.suspend",
    "platform.workspace.unsuspend"
  ],
  "middleware": [],
  "node_files": [],
  "js_assets": [
    "resources/js/charts/admin-support-index.js",
    "resources/js/charts/admin-support-team.js",
    "resources/js/charts/support-index.js",
    "resources/js/charts/user-support-index.js",
    "resources/js/charts/admin-team-inbox-index.js"
  ],
  "misc_files": ["app/Mail/Support/AdminReplyToCustomer.php"],
  "config_files": [],
  "doc_pages": [
    "Documentation/pages/admin-panel/platform-inbox.html",
    "Documentation/pages/admin-panel/support-guidebook.html"
  ],
  "feature_map": {
    "WD-SUPP-001": ["GET support", "POST support"],
    "WD-SUPP-002": [],
    "WD-SUPP-003": ["GET support"],
    "WD-SUPP-004": ["GET support/{id}"],
    "WD-SUPP-005": ["POST support/{id}/reply"],
    "WD-SUPP-006": [],
    "WD-SUPP-007": ["GET admin/support"],
    "WD-SUPP-008": ["GET admin/support/{id}"],
    "WD-SUPP-009": ["POST admin/support/{id}/reply"],
    "WD-SUPP-010": [],
    "WD-SUPP-011": ["POST admin/support/{id}/assign"],
    "WD-SUPP-012": ["POST admin/support/{id}/status"],
    "WD-SUPP-013": ["POST admin/support/{id}/priority"],
    "WD-SUPP-014": ["GET admin/support/{id}"],
    "WD-SUPP-015": ["GET admin/support/team-inbox"],
    "WD-SUPP-016": ["POST admin/support/{id}/move"],
    "WD-SUPP-017": ["GET admin/support/agents"],
    "WD-SUPP-018": [
      "POST admin/support/agents",
      "POST admin/support/agents/{id}/toggle",
      "DELETE admin/support/agents/{id}"
    ],
    "WD-SUPP-019": [],
    "WD-SUPP-020": ["GET admin/support/customers"],
    "WD-SUPP-021": ["GET admin/support/customers/{wsId}"],
    "WD-SUPP-022": ["GET admin/support/playbooks", "POST admin/support/playbooks"],
    "WD-SUPP-023": [
      "POST admin/support/playbooks/{id}/toggle",
      "DELETE admin/support/playbooks/{id}"
    ],
    "WD-SUPP-024": ["POST admin/support/{tid}/run-playbook/{pid}"],
    "WD-SUPP-025": [],
    "WD-SUPP-026": ["GET admin/support/sla"],
    "WD-SUPP-027": ["POST admin/support/sla/policies"],
    "WD-SUPP-028": [
      "PATCH admin/support/sla/policies/{id}",
      "DELETE admin/support/sla/policies/{id}"
    ],
    "WD-SUPP-029": [],
    "WD-SUPP-030": [],
    "WD-SUPP-031": ["GET admin/support/reports"],
    "WD-SUPP-032": ["GET admin/support/reports/export.csv"],
    "WD-SUPP-033": [],
    "WD-SUPP-034": [],
    "WD-SUPP-035": [],
    "WD-SUPP-036": [],
    "WD-SUPP-037": ["GET admin/team-inbox", "GET admin/team-inbox/api/bootstrap"],
    "WD-SUPP-038": ["GET admin/team-inbox/api/queue"],
    "WD-SUPP-039": ["GET admin/team-inbox/api/conversations/{id}"],
    "WD-SUPP-040": ["POST admin/team-inbox/api/conversations/{id}/note"],
    "WD-SUPP-041": ["POST admin/team-inbox/api/conversations/{id}/spam"],
    "WD-SUPP-042": [
      "POST admin/team-inbox/api/workspaces/{id}/flag",
      "DELETE admin/team-inbox/api/flags/{id}"
    ],
    "WD-SUPP-043": [
      "POST admin/team-inbox/api/workspaces/{id}/suspend",
      "POST admin/team-inbox/api/workspaces/{id}/unsuspend"
    ],
    "WD-SUPP-044": ["GET admin/team-inbox/api/audit"],
    "WD-SUPP-045": [],
    "WD-SUPP-046": []
  }
}
```

## Port decisions (built features)

Deliberate differences from WaDesk in the rebuilt ticket core (WD-SUPP-001..005, 007..013), each covered by a test:

- Customer "open" means neither resolved nor closed (WaDesk counted closed as open) and the pill uses the real status vocabulary.
- A closed ticket refuses a customer reply with 409 (WaDesk hid the box but the endpoint reopened it).
- An internal note changes nothing on the ticket (WaDesk moved `open` to `in_progress` and bumped `last_reply_at`).
- Moving to `open`, `in_progress` or `pending` always clears `resolved_at` (WaDesk kept a stale value on closed to open).
- Assignment accepts only active `super_admin` or `support` operators (WaDesk accepted any user id); staff are platform operators, so
  `assigned_agent_id` references `platform_operators`.
- Unknown ticket on a priority change is a 404 (WaDesk silently succeeded); every operator write takes `rowVersion` (409 when stale).
- Operator writes need the `super_admin` or `support` role; auditors read only (WaDesk enforced nothing).
- The customer email outcome is stored on the message (`email_status`) and shown in the panel; WaDesk's banner said "sent" even when delivery threw.
- Kept as in WaDesk: a customer reply on `pending` leaves it `pending`; no per-user rate limit, no dedupe; `reason` is stored and filterable.
