# ADR-0028: Workspace inactivity lifecycle: remind, archive, erase

- **Status:** proposed
- **Date:** 2026-10-11
- **Deciders:** Lakshya (to confirm: timings, what counts as activity, billing-record handling)

## Context

An idle workspace keeps its contacts, messages and files forever. DPDP (India) and GDPR require storage limitation, erasure when data is
no longer needed, and a fair, documented notice before it happens. The owner asked for: archive after 90 days of inactivity, erase after
180, three reminders, and an operator override per workspace (change the timings, mark "never delete").

Reference has one related job, the lapsed-plan data wipe (TW-PLAN-023, `PlanRetentionService`). It only acts on workspaces whose paid plan
ended, empties tenant data but keeps the workspace shell, sends no warning, and is not a notice-and-archive process. This is a new,
separate process; it does not replace or change that job.

## Decision

**State machine** `active -> archived -> erased`. Erase never skips archive. `suspended` and `deleted` workspaces are not managed here.

**Clock.** `organizations.last_activity_at`. Reset by any authenticated request of the workspace's own people (throttled, written in the
workspace's own tenant scope, so no privileged transaction on the request path), and by message traffic (the sweep folds the newest
`messages.created_at` in before deciding). An operator acting as the owner (act-as) does not count. Restore also resets it, which opens
a fresh reminder cycle. The migration starts every clock at now().

**Paid workspaces are exempt.** A workspace on an active paid plan, on a custom-quote plan, or platform-owned is never idle-archived. A
lapsed paid plan is not exempt (and the lapsed-plan wipe of TW-PLAN-023 still runs on its own).

**Timings.** Defaults 90 and 180 days, overridable per workspace (archive 60 to 3650, erase 120 to 7300); erase stays at least 60 days after
archive.

**Reminders.** Three before each destructive step: 30, 15 and 5 days before archive; 30, 15 and 7 before erase. They are
`org.lifecycle.reminder` outbox events; a worker consumer mails the owner and the active admins. Sequential and at least 3 days apart. A
step runs only when all three reminders for it are recorded for the current cycle and the final notice has elapsed (3 days before
archive, 7 before erase). A backlog (worker down, an expired exemption, a lowered override) delays destruction; it never skips a warning.
Erase also needs 30 or more days in the archived state.

**Operator controls** (Workspaces hub): per-workspace timings, never-delete (mandatory reason, optional expiry so it is re-reviewed),
legal hold (blocks archive and erase, never lapses on its own; its own key, Super Admin only) and restore. Keys:
`platform.workspace.retention`, `platform.workspace.legal_hold`; reading needs `platform.workspace.view_all`.

**Archive** sets `status = 'archived'` (sign-in, refresh and public links already require `active`) and ends every live session at once.

**Records.** `org_lifecycle_log`: append-only (UPDATE and DELETE revoked), no personal data, no FK so it outlives the workspace, the
proof of notice and of erasure. A reminder is unique per (workspace, stage, number, cycle).

**Erase.** In one transaction under the worker role: tombstone; copy the platform's paid sales records (`orders`) into
`financial_records_archive` without the buyer's identity (below); queue every file key into `storage_purge_queue`; delete the workspace's
`audit_log`, `event_outbox` and `security_events` rows (field values, IPs; none has a cascading FK); then `DELETE organizations`, whose
foreign keys remove all tenant data. An integration test fails if any table with an `org_id` column still holds a row afterwards, so a
table added later without a cascade cannot silently survive an erasure.

**Files.** File keys are found from the catalogue, not a hand-kept list: every text column named `storage_key`, `media_key` or `*_path`
on a table that carries `org_id`. A worker (`StoragePurgeService`, every 10 minutes) removes each queued key through both storage doors
(the chat media store, which also owns local disk, and the platform media storage for the bucket), counts failures, retries up to 8
times, and leaves a failed row with its last error visible. An erasure is complete only when the queue is empty. Keys outside those names
are not found: a new file-bearing column must follow the naming, or be added to the discovery rule.

**Sales records.** Tax law requires the platform to keep its own sales records after the customer is gone. `financial_records_archive`
keeps, for each paid order, the order number and uuid, kind, status, currency, amounts, tax rate and amount, billing country and tax id,
gateway references and dates, and drops the buyer's name, email, company and address. A row is deleted when `retain_until` passes
(`FINANCIAL_RECORD_RETENTION_YEARS`, default 8, covering India's GST period; legal must confirm). A workspace's own customer invoices
(`invoices`) are the workspace's data, not the platform's, and are erased with it.

**Owner-deleted workspaces.** `status = 'deleted'` (set by the owner in Settings, now with `deleted_at`) was never purged. The sweep
erases it 30 days after the deletion. No reminders (the owner asked for it) and the operator's never-delete switch does not stop it, since
a person's erasure request outranks a commercial courtesy; a legal hold does. Workspaces deleted before this change are dated from their
last update.

**Rollout.** Three independent switches, all safe by default: `ORG_LIFECYCLE_ENABLED` (off), `ORG_LIFECYCLE_DRY_RUN` (on),
`ORG_LIFECYCLE_DELETE_ENABLED` (off).

## Consequences

### Positive

- A documented, auditable notice before every irreversible step, and a provable erasure.
- Paying customers and anything the operator protects are never touched.
- Reuses the operator guards, the outbox, the mail port and the worker cron pattern; no new infrastructure.

### Negative

- Erase is irreversible; archive is the only recovery window.
- A small write per workspace per 10 minutes for the activity clock.
- Erasure removes the workspace's audit trail and security events by design; only the tombstone remains.

### Neutral

- Whether 30 days is the right grace for an owner deletion, and 8 years for sales records, are legal calls; both are one constant to change.

## Open items

- Local-disk files of modules other than chat are only removed if the chat store owns the key (`chat/<orgId>/...`); with the bucket driver
  every key is removed. A module that stores uploads on local disk outside the chat store needs its own removal.
- `payments` rows (gateway transaction records) are erased with the workspace; the order archive keeps the gateway references.

## Alternatives considered

### Extend the lapsed-plan wipe

It keeps the workspace shell and has no warning or archive step; merging would change a ported Reference behaviour.

### Soft delete with a long grace period

Contradicts ADR-0009 and does not satisfy erasure.

## Revisit when

Legal confirms different periods, billing retention is decided, or the storage purge worker lands.
