# ADR-0021: Partition maintenance creates partitions through a SECURITY DEFINER function

- **Status:** proposed
- **Date:** 2026-10-01
- **Deciders:** Lakshya (author); the db steward (K3) to review

## Context

Streams (`event_outbox`, `audit_log` and the 17 Reference streams in ADR-0020) are monthly `RANGE`
partitions. Migrations bootstrap the previous, current and next two months plus a `_default`;
`PartitionMaintenanceService` is meant to keep three months ahead from then on, and it now finds
the tables itself from `pg_partitioned_table`.

It cannot create a partition. The worker connects as `crm_app_user` (`DATABASE_URL`, a member of
`crm_app`), which owns no table and has no `CREATE` on schema `public` (Postgres 15 removed it
for non-owners). `CREATE TABLE ... PARTITION OF` needs ownership of the parent and `CREATE` on
the schema, so `ensure_monthly_partition()` as written in `0001` fails for that role with
`permission denied for schema public`. The job logs the error and carries on. It was found by an
integration test that ran the service as the runtime role; every earlier check ran as the owner.
The consequence is silent: the bootstrap partitions run out after about two months and rows
accumulate in `_default`, which also blocks creating the partition for the range they sit in.

Two more gaps sat next to it. A query that names a partition skips the parent's row-level
security and uses the partition's own policies, and no partition had any, so with the grants
`crm_app` gets by default it read every tenant's rows (95 partitions today). And the ten
`event_outbox` / `audit_log` partitions from `0006` predate the default privileges of `0007`, so
the app role could not read them at all, which is why `defaultPartitionCounts()` could not run as
the worker and was never wired to an alert.

Constraints: the runtime role must stay unable to bypass or alter row-level security (ADR-0002),
which rules out making it the owner; migrations stay hand-written SQL (ADR-0004); the worker is
a separate process from the same image with the same database URL (ADR-0010).

## Decision

`ensure_monthly_partition(parent regclass, at_month date)` becomes `SECURITY DEFINER`, owned by
the migration role that owns the partitioned tables, so the worker can create a partition without
DDL rights of its own. The function validates what it is asked to do, since the caller's rights no
longer do that:

- `search_path` is pinned to `public, pg_temp`.
- The parent must be a `RANGE`-partitioned table in schema `public` that is not itself a partition.
- The month must lie between ten years back and one year ahead of now.
- A transaction-scoped advisory lock on the partition name serialises concurrent callers.
- `EXECUTE` is revoked from `PUBLIC` and granted to `crm_app` and `crm_worker`.

Every partition also carries its parent's row-level security. `inherit_partition_rls(partition)`
copies the parent's RLS flags and policies onto it (an owner-only helper, not granted to the app
roles). `ensure_monthly_partition()` calls it for each partition it creates, and the migration
`20261001110100_partition_rls` applied it to every existing partition and granted the `0006`
ones the default app-role privileges. A migration that creates a partition by hand, such as a
stream's `_default`, calls the helper itself. A parent without RLS leaves its partitions open.
`PartitionMaintenanceService` now ends each pass with `defaultPartitionCounts()`, which reads the
`_default` partitions as the worker role, and logs a warning when any holds rows.

The signature is unchanged, so migrations that already call it are unaffected. A catalog test in
`schema-invariants.spec.ts` requires every `SECURITY DEFINER` function in `public` to pin
`search_path` and to be closed to `PUBLIC`, so the next one cannot skip those steps, and requires
every partition of an RLS-protected parent to force RLS behind a policy that names
`current_org_id()`, so a hand-made partition cannot skip the helper.

## Consequences

### Positive

- The job works as the role it runs as, and the integration test now proves it as that role
  rather than as the owner.
- The runtime role gains no ability to create arbitrary tables, own anything, or touch policies.
- Several workers starting together no longer race on the same partition.
- A query that names a partition is tenant-filtered like one on the parent, and fails closed
  without a tenant context.
- Rows in a `_default` partition are reported by the job that is supposed to prevent them.

### Negative

- This is the first `SECURITY DEFINER` function in the schema. The runtime role now runs DDL
  indirectly, and the validation inside the function is the only control: a bug there is a
  privilege-escalation bug, and if the migration role is a superuser in an environment the
  function runs as a superuser.
- A compromised app role can still create empty partitions, up to about 130 per partitioned
  table within the allowed window. That is bounded catalog growth, not data access.
- The function is owned by whoever ran the migration. Moving migrations to a different role
  means re-creating it under that role, or the new owner must own every partitioned parent.
- `CREATE TABLE ... PARTITION OF` takes a brief `ACCESS EXCLUSIVE` lock on the parent. Unchanged
  from before, but it now actually runs in production.
- Every partition now holds a copy of its parent's policy: 95 today, one more per stream per
  month, until retention drops them. A later change to a parent's policy is not propagated; the
  author must re-run `inherit_partition_rls()` on its partitions, and the invariant test only
  checks that each policy names `current_org_id()`, not that it equals the parent's.
- The partition policies stop a query that reaches the wrong relation. They do not stop a caller
  who can run arbitrary SQL as the app role: `app_is_privileged()` reads a setting that role can
  set, on a partition as on the parent. ADR-0002 already records that limit.
- The alert is a log warning. There is no metrics pipeline to page from yet.

### Neutral

- `defaultPartitionCounts()` scans each `_default` partition, which is empty in a healthy system.
  If it is ever large, the daily count is a sequential scan of rows that are already misplaced.

## Alternatives considered

### Run the job on a second, owner-credentialed connection

Needs a second database URL and secret in the worker and gives that process the owner role. A
superuser or owner connection bypasses or can rewrite every policy this repo relies on, so a
compromise of the worker, which also runs queue processors and provider code, would no longer
be contained by RLS. The definer function exposes one validated operation instead of a role.

### Make `crm_app` the owner of the partitioned tables, or grant it `CREATE` on `public`

The owner can disable row security and drop policies. Granting `CREATE` on the schema lets the
role create any table. Both give the runtime role more than the job needs.

### Revoke the app role's grants on partitions

Closes direct access instead of filtering it, and needs no per-partition policy. Rejected
because the one direct reader the application needs, the default-partition alert, would then
need a second `SECURITY DEFINER` function, and because the default privileges of `0007` re-grant
on every partition a later migration creates, so each stream migration would have to remember
the revoke. The policy copy has the same remember-to-call cost, but the invariant test catches
it, and it keeps one model: partitions behave like their parent.

### Create several years of partitions in a migration

No runtime privilege problem, but it turns partition maintenance into a calendar reminder: a
forgotten migration fails the same silent way. About 60 partitions per table across 19 tables
also adds planning cost to every query on the streams, for years of mostly empty tables.

### `pg_partman` or `pg_cron`

Solves it with an extension that needs superuser to install, is not available on every managed
Postgres, and brings its own role and grant model to maintain.

## Revisit when

The deployment target is a managed Postgres where the migration role cannot own a
`SECURITY DEFINER` function the runtime can call, or partition management moves into
`pg_partman` or an external scheduler, or a second `SECURITY DEFINER` function is proposed (it
should be reviewed against this one before it is added).
