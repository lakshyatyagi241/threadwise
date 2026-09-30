# ADR-0003: Drizzle as a typed query builder, not an ORM

- **Status:** accepted
- **Date:** 2026-09-16

## Context

The schema uses composite primary keys `(org_id, id)`, composite foreign keys,
Row-Level Security, JSONB custom fields, expression indexes, table partitioning
and `tsvector` search columns.

Mainstream Node ORMs model none of these well. The question was which layer
gives typed queries without fighting the schema.

## Decision

Drizzle ORM, used as a **typed query builder**. The Drizzle schema exists for
types and query composition only — it never generates DDL. `drizzle-kit push`
and `drizzle-kit generate` are deliberately not wired up (see ADR-0004).

Anything Drizzle cannot express — `FOR UPDATE SKIP LOCKED`, `set_config`,
partition DDL, row-value comparisons — is written as parameterised raw SQL
through `sql` templates.

## Consequences

### Positive

- The SQL that runs is the SQL that was written. No lazy-loading surprises, no
  N+1 emitted from a relation traversal, no query the author never saw.
- Composite keys and composite FKs are a non-issue because the query builder
  does not try to own the schema.
- Raw SQL is a first-class escape hatch, not a defeat.
- Small runtime, no decorators, no metadata reflection at startup.

### Negative

- No change detection, no unit of work, no cascade-on-save. Every write is
  explicit — which is more typing and fewer surprises.
- The Drizzle schema and the SQL migration must be kept in step **by hand**.
  A mismatch is a runtime error, not a compile error. The PR checklist calls
  this out; `pnpm db:status` catches the migration half.
- Fewer batteries than Prisma: no studio, no generated client, no seeding DSL.

### Neutral

- Relations are declared where useful for joins; the codebase mostly uses
  explicit joins because the query shapes are known.

## Alternatives considered

### Prisma

Best-in-class DX. No composite foreign keys, no RLS session variables, no
partitioning support, and `$queryRaw` returns untyped rows — which is where
most of this schema would have ended up.

### TypeORM

The NestJS default. Weak on composite keys, and its migration generator
produces DDL that has to be reviewed and rewritten for anything involving
partitions or policies. The escape hatches would have outnumbered the ORM.

### Kysely

Very close call — arguably a purer query builder. Drizzle was chosen for its
schema-as-types story, which makes `$inferSelect` usable directly in service
signatures.

## Revisit when

Query composition for the metadata-driven `records` store (Tier-3) outgrows
what the builder can express. That layer compiles a filter AST to SQL and may
end up bypassing Drizzle entirely — which is fine, and is why the repository
layer is an interface boundary.
