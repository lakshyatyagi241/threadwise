# ADR-0020: The WaDesk data model, and a drift check between Drizzle and the database

- **Status:** proposed
- **Date:** 2026-10-01
- **Deciders:** Lakshya (author); the db steward (K3) to review

## Context

The port needs WaDesk's 227 tables in this schema before most domains can start. Left to each feature, every domain would translate
its tables by hand and differently: some with composite keys and forced RLS, some without; streams partitioned or not; JSON and secrets
treated per developer. The conventions exist (ADR-0002, 0004, 0009, 0012) but nothing applied them to WaDesk's shape in one place.

Separately, ADR-0003 and ADR-0004 accepted a limitation: the Drizzle schema is a hand-kept mirror of the SQL migrations and nothing
checks that they agree, so a mismatch is a runtime error. The Drizzle files for the existing tables also declare columns only, not
foreign keys, so they are not a usable reference for how tables relate. The schema now grows by about 200 tables, which makes both
problems worse.

Facts that bound the choice: composite `(org_id, id)` keys and composite foreign keys on every tenant table, forced RLS, monthly range
partitions, partial indexes, `touch_row` triggers; three developers adding migrations in parallel (timestamp names, one migration per
domain); the reference database holds 227 tables, 149 with `workspace_id`, 115 real foreign keys against 343 integer `*_id` columns (the rest of WaDesk's relations are enforced by the application).

## Decision

Keep Drizzle as the typed query builder (ADR-0003) and hand-written SQL as the source of truth (ADR-0004). Do not adopt a different ORM
and do not let Drizzle generate DDL.

Translate WaDesk's schema once, mechanically, from one internal model that emits the SQL migrations, the Drizzle files and the docs, so
they cannot disagree. Judgement calls live in one reviewable file (`docs/wadesk-port/schema/source/decisions.toml`), reviewed against
WaDesk's source. The conventions applied to every table are listed in `docs/wadesk-port/schema/README.md`; the ones that are decisions
rather than translation:

- a tenant-owned unique key is per tenant, a reference to a user is nullable and `SET NULL`, and in the financial domains a reference to
  a tenant row restricts the parent delete instead of cascading;
- a table with no `workspace_id` inherits its tenant from a parent row through a composite foreign key;
- platform data has two shapes without `org_id`: a catalogue every tenant may read and only the privileged role may write, and
  operator data that no tenant transaction can read;
- append-only high-volume tables are partitioned streams with no foreign keys;
- personal data is stored plain behind RLS (as contacts already are) and secrets are ciphertext;
- where an accepted ADR already names a table (ADR-0012 `wallets`, `usage_charges`, `wallet_transactions`), the ADR's shape wins.

Add `pnpm db:verify-schema` (`packages/db/src/verify.ts`, exported as `verifySchema`): it compares every Drizzle table with the live
catalog and fails on column, type, nullability, default, primary key, unique, foreign key (including `ON DELETE`), index and check
disagreements, and on any table with an `org_id` that lacks enabled and forced RLS plus a policy. It runs in CI after the migrations and
in the schema-invariants integration test, which also asserts, for every table, that tenant references carry `org_id`. New tables
declare their keys, foreign keys, indexes and checks in Drizzle, not only their columns.

## Consequences

### Positive

- The "no drift detection" negative in ADR-0003 and ADR-0004 is closed for the cases that break queries. The check already found a real
  mismatch in an existing table.
- Every domain starts from a complete, consistent schema and an ERD; features add behaviour, not tables.
- A table added later is covered by the invariants test the day it lands, without anyone writing a test for it.
- Cross-tenant references, missing RLS and missing `FORCE` cannot ship silently for any table.

### Negative

- 51 migrations and about 200 tables arrive at once, including tables for features that may be cut (the scope decision is still open).
  They are empty and cheap, but each carries RLS and a trigger.
- The schema is the translation of WaDesk's database, not a redesign. Where WaDesk's shape is poor (a JSON list of ids, polymorphic
  `device_id`, two balances on a user row) the poor shape is kept, normalised only where this ADR or an earlier one says so, and the
  rest is listed as open decisions.
- The check compares what Drizzle can express. Partial-index predicates, `ON DELETE SET NULL (col)` column lists, triggers and policy
  bodies are not compared; RLS is checked by presence and by the invariants test, not by policy text.
- The older hand-written Drizzle files still produce warnings (undeclared foreign keys). They are not errors and not fixed here.

### Neutral

- The generator is a bootstrapping tool. After this baseline the SQL and Drizzle are edited by hand and the check keeps them aligned;
  re-running the generator is for comparison.

## Alternatives considered

### Prisma, TypeORM or Kysely

Rejected for the reasons in ADR-0003, which still hold: composite foreign keys, RLS session variables and partitions are first-class
needs here. Nothing about the larger schema changes that; it makes it more true.

### drizzle-kit as the source of truth (generate or push)

It would remove the mirror problem by removing the mirror, and it would also need hand-editing for every partition, policy and
`SET NULL (col)` clause (ADR-0004), after which the file is no longer regenerable. A check is cheaper than a generator that has to be
worked around on most tables.

### Port each table with its feature

The default in the WaDesk skills. It keeps tables out of the database until used, but every domain re-decides the conventions, foreign
keys across domains wait for the other domain's migration, and the Drizzle schema is incomplete as a reference for months. Mitigated
here by the scope question staying open: unneeded domains cost empty tables, not code.

### Atlas for drift detection

Stronger (it diffs the whole schema, including policies). ADR-0004 named it as the answer if drift bites. The check here covers the
failures that have happened and adds no binary to CI; Atlas remains the next step.

## Revisit when

- the scope cut (decision S in `docs/wadesk-port/README.md`) removes whole domains: drop their migrations before first release, not after;
- the check misses a drift that reaches production, or the warnings are never cleaned up: then adopt Atlas or `pg_dump --schema-only`
  diffing in CI;
- the channel model ADR replaces `devices` and `wa_provider_configs`: the loose `device_id` columns get their foreign key then.
