# Parity: platform-support-desk (SUPP)

Spec: `inventory/platform-support-desk.md`. Port map: `port-map/platform-support-desk.md`.

## Status

tier P0 done: TW-SUPP-001, 002, 004, 005, 007, 008, 009, 010, 011, 012 (API e2e `support-desk.e2e.spec.ts`, integration `support-schema.spec.ts`, web unit tests).
tier P1 done: TW-SUPP-003, 013, 014, 015, 016, 017, 018, 026, 027, 029, 030, 031, 033, 037, 038, 039, 040, 041, 042, 043, 044, 046 (API e2e `desk.e2e.spec.ts`).
tier P2 done: TW-SUPP-020, 021, 022, 023, 024, 028, 032.

Partial: TW-SUPP-045 (impersonation launcher: reason and target validated, session start answers 501 until the workspaces domain provides it).

## Not ported on purpose

| Id          | Reason                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------- |
| TW-SUPP-006 | Attachment picker is client-only in Reference (files are never uploaded or stored); nothing to port. |
| TW-SUPP-019 | Auto-assignment and workload tracking are described in docs only; no Reference code runs.            |
| TW-SUPP-025 | Playbook automatic triggers are described in docs only; playbooks run on demand (TW-SUPP-024).    |
| TW-SUPP-034 | Seeded `support.*` permission keys are never enforced in Reference (dead code); operators use roles. |
| TW-SUPP-035 | Reply-by-email, auto-close and admin alerts are advertised but missing in Reference.                 |
| TW-SUPP-036 | Legacy support mock code (dead).                                                                  |

## Intended deviations (each has a test)

- Customer "open" excludes closed; a closed ticket refuses a customer reply (409); an internal note changes nothing on the ticket.
- Moving to open, in_progress or pending clears `resolved_at`; assignment accepts only active roster operators; unknown ticket on priority change is 404.
- Operator writes need role `super_admin` or `support`, take `rowVersion` (409 when stale); auditors read only.
- Reply email outcome is stored on the message (`email_status`).
- SLA: breach scan runs on the worker every 5 minutes (Reference never scheduled it), is unique per ticket and type in the database, uses the
  customer workspace's business hours, records late first replies and late resolutions at the moment they happen, and emits outbox
  `support.sla.breached`. Policy edit exists (Reference had a PATCH route and no screen), with `rowVersion`; every policy change is audited.
- Audit rows for every staff mutation (Reference skipped toggles and deletes) are written in the ticket's organization with actor type `platform_operator`, same transaction.
- Flags/suspension: UI controls added in the drawer (Reference had API only); duplicate active flags collapse; unknown workspace is 404;
  a fraud or tos_violation flag still blocks the workspace like a suspension (kept from Reference, shown in the UI).
- Inbox permissions map to the operator roles: auditors reach the queue, drawer and audit feed; notes, spam, flags and suspension need support or super admin
  (suspend: super admin only).

## Screens (operator console menu group "Support")

Inbox, Team inbox (kanban), Agents, SLA board, Customers (+ workspace history), Playbooks, Reports (+ CSV), Platform inbox. Customer: `/support` and `/support/[id]`.

## Conformance against the running Reference (round 2)

Compared one by one with the live Reference (admin console and a workspace user) at 1440 px, empty state and with one ticket: operator inbox
and ticket panel, team kanban, agents, SLA board, customers, playbooks, reports, platform inbox, customer form, customer thread, history.
Fixed in this round: Reference's own punctuation and copy (middle dot, arrow, em dash, ellipsis in eyebrows, starters, hints, placeholders and
KPI labels), small uppercase mono field labels on the side forms (`Field eyebrow`, additive in `@crm/ui`), playbook empty-state icon tile,
reason rail icon tiles, attachment icon, send arrow, mono email field, ticket panel order (status pills, priority pills, assign with
Save, SLA, meta, thread), tinted lowercase status pills and mono priority pills in the inbox rows, unassigned in italics, customer
thread header (eyebrow, relative "Opened", tinted status pill), "Customer . initial" bubble label, back link under the reply card.

Intended differences, each on purpose:

- Page chrome (serif display titles with an italic accent word, warm paper palette, console sidebar) belongs to the operator console
  shell and the workspace shell, not to this domain.
- Agents: the roster is of platform operators ("Operator", "pick an operator"); Reference promoted platform users. The Reference sentence about
  auto-assignment is dropped because it is docs-only (TW-SUPP-019).
- Customers subtitle drops "+ impersonate": the impersonation session start belongs to the workspaces domain (TW-SUPP-045).
- Customer form hint keeps Reference's wording but our thread renders plain text (so does Reference; its "Markdown supported" is untrue there).
- Kanban keeps a keyboard "Move to" menu on every card and a one-line hint (accessibility; drag and drop works as in Reference).
- Customer ticket confirmation banner after sending and the "Reopens when replied" hint on resolved tickets are kept.
- KPI "Avg 1st reply" shows a bare dash when empty; Reference prints a dash followed by a stray "m".
- "Full history" link on the recent-tickets card is not shown: it points at Reference's account page tab, which another domain owns.

## Blocked

TW-SUPP-045 (impersonate): the launcher modal, reason validation (8 to 500 characters) and the target check are built and tested;
starting the session (minting the workspace owner's access, banner, audit start and stop) needs the workspaces and auth domains and
answers 501 until they provide it. A shim inside this zone is not possible without editing auth session code.

## Not verified

Drag-and-drop in a real browser, the CSV download in a browser and the email send against a live SMTP server were not exercised in this
run (covered by API e2e and unit tests). No browser spec was added.
