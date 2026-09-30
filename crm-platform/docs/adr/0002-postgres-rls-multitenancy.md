# ADR-0002: Shared schema with Row-Level Security for tenant isolation

- **Status:** accepted
- **Date:** 2026-09-16

## Context

Every business row belongs to exactly one organisation. A cross-tenant read is
the worst bug this system can have: it is a data breach, not an outage, and it
cannot be rolled back.

Three isolation models were available: database-per-tenant,
schema-per-tenant, and shared schema with a tenant column.

## Decision

Shared schema. Every business table carries `org_id`, has a composite primary
key `(org_id, id)`, and has Row-Level Security enabled **and forced**.

The application sets the tenant per transaction:

```sql
SELECT set_config('app.org_id', $1, true);   -- transaction-local
```

and every policy reads it back:

```sql
CREATE POLICY tenant_isolation ON contacts
  FOR ALL
  USING      (org_id = current_org_id() OR app_is_privileged())
  WITH CHECK (org_id = current_org_id() OR app_is_privileged());
```

Every foreign key is composite — `(org_id, x) → (org_id, id)` — which makes a
cross-tenant reference structurally impossible rather than merely incorrect.

## Consequences

### Positive

- Isolation is a property of the database, not of our diligence. A forgotten
  `WHERE org_id = ?` returns zero rows instead of someone else's data.
- One migration, one connection pool, one backup, regardless of tenant count.
- Onboarding a tenant is an INSERT.

### Negative

- Policies add a predicate to every plan. Mitigated by keeping `org_id` first
  in every composite index, so the predicate is index-friendly rather than a
  filter after the fact.
- **`FORCE ROW LEVEL SECURITY` is mandatory.** Without it the table owner —
  which in development is the same role the app connects as — bypasses every
  policy, and the isolation tests pass against an application that has none.
- The privileged escape hatch (`app.privileged`) is an application-enforced
  rule, not a database-enforced one. Kept honest by review and by the
  integration test asserting no HTTP path can reach it.
- A "restore one tenant to yesterday" request is genuinely hard.

### Neutral

- Noisy-neighbour effects are real but manageable at this scale; the whale-tier
  escalation path exists for when they are not.

## Alternatives considered

### Database per tenant

Strongest isolation, and the operational cost scales linearly with customers:
N migrations, N backups, N connection pools. Cross-tenant platform analytics
become an ETL project. Right for a handful of enterprise tenants; wrong here.

### Schema per tenant

Same migration-fan-out problem with weaker isolation. Postgres also degrades
noticeably once a database has thousands of schemas.

### Application-level filtering only

One forgotten `WHERE` is a breach. No.

## Revisit when

A single tenant's volume justifies its own database, or a customer contract
requires physical separation. The migration path is per-tenant logical
replication of rows filtered by `org_id`.

## Verification

`apps/api/test/integration/rls.spec.ts` proves, against a real Postgres, that a
tenant cannot read, insert into or move a row to another tenant — and that RLS
is forced, not merely enabled.
