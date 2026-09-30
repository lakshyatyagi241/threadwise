# ADR-0009: Hard delete, with the audit trail as the record

- **Status:** accepted
- **Date:** 2026-09-16

## Context

Soft delete (`deleted_at IS NULL` everywhere) is the reflex choice. It has a
well-known cost: every query needs the predicate, every unique constraint needs
a partial index, every join risks resurrecting a deleted parent, and the table
grows forever with rows nobody will read.

There is also a legal dimension: "delete my data" requests under Indian DPDP
and GDPR are not satisfied by a flag.

## Decision

Hard delete. `DELETE FROM contacts WHERE org_id = ? AND id = ?`.

Before the row goes:

1. an `audit_log` entry records who deleted what and when,
2. an outbox event fires so downstream systems can react.

Two related mechanisms cover what soft delete is usually reached for:

- **`lifecycle_state = 'archived'`** — archive-in-place for "I don't want to see
  this any more". Excluded from default queries, fully restorable. This is what
  users almost always actually mean.
- **`is_archived`** — the fast boolean on the hot path, backing partial indexes.

Child rows follow `ON DELETE CASCADE` where ownership is real (identities,
consents, documents) and `ON DELETE SET NULL` where the reference is incidental
(owner, company).

## Consequences

### Positive

- No `deleted_at IS NULL` in a hundred queries, and no bug the day one of them
  is forgotten.
- Unique constraints mean what they say.
- A deletion request is genuinely satisfiable.
- Tables do not accumulate tombstones.

### Negative

- **Deletion is irreversible.** Recovery is a point-in-time restore, which is an
  operational procedure, not an undo button. The UI must make this explicit —
  "archive" should be the prominent action and "delete" the buried one.
- A cascade can remove more than the user pictured. Cascade paths must be
  reviewed when any FK is added; the PR checklist calls this out.
- S3 objects referenced by deleted rows are orphaned until the sweeper runs.

### Neutral

- Streams (`messages`, `audit_log`, `event_outbox`) are never deleted
  row-by-row. They age out by dropping whole partitions, which is instant.

## Alternatives considered

### Soft delete everywhere

Safer against accidents, at the cost of a predicate on every query forever, and
still not sufficient for a legal erasure request.

### Soft delete with a purge job

The complexity of both, plus a scheduled job that must be correct.

## Revisit when

A customer requires an undo window on deletion. The likely answer is not soft
delete but a short-lived recycle-bin table written by the delete path — which
keeps the main tables clean.
