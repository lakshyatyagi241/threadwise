# Contributing

## Setup

[docs/runbooks/local-development.md](docs/runbooks/local-development.md).

## Branches and commits

Conventional commits, enforced by commitlint on `commit-msg`:

```
feat(crm): add company merge endpoint
fix(billing): stop double-posting on gateway webhook retry
docs(adr): record the sub-agent identity decision
refactor(kernel): extract scope-to-SQL translation
```

Scopes: `api`, `web`, `partner`, `db`, `contracts`, `config`, `kernel`, `crm`,
`inbox`, `broadcast`, `billing`, `exams`, `identity`, `partner-api`,
`public-api`, `realtime`, `infra`, `docs`, `adr`, `ci`, `deps`.

## The rules that are not negotiable

These exist because breaking them is a data breach, a money bug, or a silent
correctness failure — not because of taste.

### 1. Tenant-scoped everything

Every query touching business data goes through `DatabaseService.tx()` or
`txReplica()`. There is no "just grab a connection" accessor, on purpose.

`privileged()` has exactly four sanctioned uses (see
[multi-tenancy.md](docs/architecture/multi-tenancy.md#the-privileged-escape-hatch))
and **none of them is reachable from an HTTP handler**.

### 2. New tables need RLS, in the same migration

Privileges are inherited. RLS is not:

```sql
ALTER TABLE x ENABLE ROW LEVEL SECURITY;
ALTER TABLE x FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON x FOR ALL
  USING      (org_id = current_org_id() OR app_is_privileged())
  WITH CHECK (org_id = current_org_id() OR app_is_privileged());
```

Both `USING` and `WITH CHECK`. With only `USING`, a tenant can insert a row into
another tenant that it then cannot see.

### 3. Applied migrations are immutable

The runner checksums them. Fix forward.

### 4. Internal ids never leave the system

Responses carry `uuid`. The mapper is the only place that translates.

### 5. Money is a string until a decimal library touches it

`numeric` columns are deliberately not parsed to `number`.

### 6. Audit and outbox go in the same transaction as the write

Not after it. That is the entire point.

### 7. Modules talk through barrels or the outbox

`modules/a` may not import `modules/b/internals`. `pnpm arch:check` fails the
build if it does.

## Before you open a PR

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration    # if you touched the schema, RLS, or a repository
pnpm arch:check
```

Then work through the [PR template](.github/PULL_REQUEST_TEMPLATE.md).

## Writing code here

**Comments say why, not what.** The code says what. A comment that restates the
line above it is noise; a comment explaining why the obvious approach was
rejected saves the next person an afternoon.

Good:

```ts
// Fetching one extra row is how `hasMore` is answered without a COUNT — and a
// COUNT over a partitioned table is exactly the query that turns a 20ms list
// endpoint into a 2s one.
.limit(filter.limit + 1)
```

Noise:

```ts
// increment the counter
counter += 1;
```

**Match the surrounding code.** Same naming, same file layout, same comment
density. A module that reads differently from its neighbours costs more than
whatever the difference bought.

**Errors are `AppError`** with a stable code from `@crm/contracts`. Never a bare
`throw new Error` on a path a user can reach.

## Tests

| Kind        | Location           | For                                           |
| ----------- | ------------------ | --------------------------------------------- |
| Unit        | `test/unit`        | pure logic — merges, cursors, crypto, mappers |
| Integration | `test/integration` | anything that is a property of the database   |
| E2E         | `test/e2e`         | full request paths through the Nest app       |

Integration tests use testcontainers and run real migrations against real
Postgres. Isolation, optimistic locking, constraint enforcement and trigger
behaviour **cannot** be tested with mocks — a mock will happily confirm whatever
you assumed.

## Adding a decision record

If you make a call that would be expensive to reverse, or that the next person
would reasonably question, write an ADR. See
[docs/README.md](docs/README.md#writing-an-adr).

Be honest in **Consequences → Negative**. An ADR with no downsides has not been
thought through, and nobody trusts it.
