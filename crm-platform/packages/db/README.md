# @crm/db

Drizzle schema, hand-written SQL migrations, the migration runner, and seeds.

## Layout

```
migrations/          hand-written SQL, applied in filename order
src/
  schema/            Drizzle tables — types and queries only, never DDL; one folder per domain
  client.ts          pooled clients (primary + replica), int8 type parser
  tenant.ts          withTenant / withPrivileged
  migrator.ts        the runner (also used by integration tests)
  verify.ts          verifySchema(): Drizzle versus the live catalog (drift check)
  cli/               migrate.ts, seed.ts, verify-schema.ts
```

## Migrations applied today

| File                               | Contains                                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `0001_extensions`                  | citext, pgcrypto, pg_trgm, vector; tenant-context functions; `touch_row()`; `ensure_monthly_partition()`                          |
| `0002_enums`                       | `record_lifecycle`, `perm_effect`, `record_scope`, `partner_agent_status`, `api_key_status`                                       |
| `0003_foundation`                  | organizations, users, teams, team_members, permission_defs, roles, user_roles, role_grants, sequence_counters, Admin-lock trigger |
| `0004_crm_contacts`                | companies, contacts, contact_identities; normalisation + search triggers                                                          |
| `0005_partner_agents`              | partner_agents, partner_agent_leads, api_keys, `contacts.submitted_by_agent_id`                                                   |
| `0006_outbox_audit`                | event_outbox, audit_log — RANGE-partitioned monthly, with default partitions                                                      |
| `0007_rls_policies`                | RLS enabled **and forced**, policies, runtime roles, default privileges                                                           |
| `0008_seed_permission_defs`        | the global capability registry                                                                                                    |
| `20261001110000_partition_definer` | `ensure_monthly_partition()` becomes `SECURITY DEFINER` so the worker role can create partitions                                  |
| `20261001110100_partition_rls`     | every partition mirrors its parent's RLS and policy; grants for the `0006` partitions; `inherit_partition_rls()`                  |
| `2026100110*_<code>_threadwise_schema` | the Reference data model, one migration per domain: 202 tables ([docs/threadwise-port/schema](../../docs/threadwise-port/schema/README.md))  |

The inbox, broadcast, billing, AI and automation tables that the Reference port
needs are in the `threadwise_schema` migrations; exams and settlements are not (not
part of Reference). See [docs/db/README.md](../../docs/db/README.md).

## Two connection URLs

| Variable                 | Role                               | Used by           |
| ------------------------ | ---------------------------------- | ----------------- |
| `DATABASE_URL`           | `crm_app_user` — **non-superuser** | the application   |
| `MIGRATION_DATABASE_URL` | owner                              | migrations, seeds |

A superuser bypasses RLS entirely. If the app connects as the owner, every
policy is inert. This split is load-bearing.

## Commands

```bash
pnpm db:migrate            # apply pending
pnpm db:status             # applied / pending / modified / missing-file
pnpm db:verify-schema      # Drizzle schema versus the migrated database (--verbose lists warnings)
pnpm db:new <name>         # create a numbered migration file
pnpm db:seed               # two tenants, roles, users, an agent, sample contacts
pnpm db:reset              # dev only: drop schema, migrate, seed
```

## Using it from application code

```ts
import { withTenant, schema } from '@crm/db';

await withTenant(db, { orgId, userId }, async (tx) => {
  return tx.select().from(schema.contacts).where(eq(schema.contacts.orgId, orgId));
});
```

In the API, go through `DatabaseService` rather than calling `withTenant`
directly — it pulls the tenant from the request context, so there is no orgId
to pass around and forget.

## Two type-parser decisions

```ts
types.setTypeParser(types.builtins.INT8, (v) => Number(v));
```

`pg` returns `bigint` as a **string** by default. Every id here is bigint, so
without this a raw query gives `'42'` while a Drizzle select gives `42`, and
comparisons quietly disagree depending on which path produced the row.
Trade-off: values above 2^53 lose precision — not a problem any single tenant
will have.

`numeric` is deliberately **not** converted. Money stays a string all the way to
a decimal library. Float rounding on a wallet balance is the one bug nobody
forgives.

## Schema and migrations must be kept in step

The SQL is the source of truth. The Drizzle schema mirrors it for typing, and
`pnpm db:verify-schema` checks the mirror against a migrated database: it fails on
a missing or mistyped column, a nullability or default disagreement, a key, foreign
key (with its `ON DELETE`), index or check that is not there, and on any table with
an `org_id` that lacks forced RLS and a policy. CI runs it after the migrations,
and the schema-invariants integration test runs it too. It compares what Drizzle
can express; partial-index predicates, triggers and policy bodies it does not.
