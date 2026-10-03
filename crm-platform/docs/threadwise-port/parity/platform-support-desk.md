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

## Not verified

Side-by-side Playwright comparison with the running Reference was not repeated in this run; the screens were built from the Blade views and
controllers in the earlier run. Per-item count badges in the menu have no slot in the operator nav.
