# ADR-0004: Hand-written SQL migrations with a custom runner

- **Status:** accepted
- **Date:** 2026-09-16

## Context

The schema needs things no migration generator emits correctly:

- `PARTITION BY RANGE` parents plus rolling monthly partitions
- `CREATE POLICY` / `ALTER TABLE ... FORCE ROW LEVEL SECURITY`
- `CREATE INDEX CONCURRENTLY` (which cannot run inside a transaction)
- expression and partial indexes over JSONB
- triggers and PL/pgSQL functions
- composite foreign keys

## Decision

Migrations are hand-written `.sql` files in `packages/db/migrations`, applied by
a small runner in `packages/db/src/migrator.ts`.

Rules the runner enforces:

1. Files apply in filename order, each in its own transaction.
2. A file whose **first line** is `-- @no-transaction` runs outside one.
3. Every applied file's sha256 is recorded. Editing an applied migration is
   refused — the repo and the database would silently disagree otherwise.
4. A session advisory lock serialises concurrent runners, so two instances
   booting at once cannot race.

## Consequences

### Positive

- Full access to Postgres. Nothing has to be worked around.
- Migrations are reviewable as SQL — the thing that will actually run.
- The checksum rule turns "someone tweaked an old migration" from a silent
  production drift into a loud CI failure.
- ~200 lines with no dependency beyond `pg`.

### Negative

- No automatic `down` migrations. Rollback is a new forward migration. This is
  deliberate: a generated `down` that has never been tested is worse than
  admitting there isn't one.
- No drift detection against the live database yet. `pnpm db:status` compares
  the journal, not the schema.
- Writing DDL by hand is slower and easier to typo than generating it. CI
  applying every migration from scratch on each PR is the backstop.

## Alternatives considered

### drizzle-kit generate

Diffs the TS schema and emits SQL. It cannot express policies, partitions or
`CONCURRENTLY`, so every migration would need hand-editing afterwards — and
then the generated file is no longer regenerable.

### node-pg-migrate

Mature and close to what we built. Rejected to avoid a dependency whose main
value (up/down pairs, a JS DSL) we do not want.

### Atlas / Sqitch

Strong declarative planning and real drift detection. An extra binary in CI and
in every developer's path, for a schema that is currently eight files.

## Revisit when

- Schema drift between environments bites us (then: Atlas, or `pg_dump
--schema-only` diffing in CI), or
- the migration count passes ~100 and ordering by filename gets unwieldy.
