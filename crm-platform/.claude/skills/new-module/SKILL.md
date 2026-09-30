---
name: new-module
description: >-
  Scaffold a new domain entity/module (controller + service + repository +
  mapper + index.ts) for this CRM platform's NestJS API, following the exact
  pattern used by the contacts reference slice — tenant-scoped transactions,
  optimistic locking, cursor pagination, uuid<->bigint mapping, audit + outbox
  in the same transaction, RBAC decorators, problem+json errors. Use this
  whenever asked to add a new entity/resource/CRUD endpoint to this repo —
  e.g. "add a deals module", "create a companies CRUD API", "add tickets to
  the CRM app", "scaffold a new module for X" — or when about to hand-write a
  new controller/service pair from scratch instead of copying the pattern.
  Never write a new module's boilerplate from memory; always start here.
---

# New module

Every module in `apps/api/src/modules/**` must look like
`apps/api/src/modules/crm/contacts/` — same four files, same order of
operations inside each. This is not a style preference; it's what makes
`pnpm arch:check`, the RLS/tenant guarantees, and the audit/outbox pipeline
hold for every module without re-deriving them each time.

**Read `apps/api/src/modules/crm/contacts/` in full before writing anything.**
It is the spec. Everything below just points at _why_ each part of it exists,
so copying it is a decision, not a guess.

## Before scaffolding, get two things right

1. **Which app does this belong to?** `modules/crm`, `modules/inbox`,
   `modules/broadcast`, `modules/billing`, `modules/exams`, or
   `modules/identity`. If the app's module doesn't exist yet, create it
   alongside the entity (see the module-file section below) — check that
   app's README (`apps/api/src/modules/<app>/README.md`) first, it documents
   decisions already made for that domain.
2. **Does the table exist yet?** If not, **invoke the `add-migration` skill
   now** and come back — a module needs its table's columns, indexes and RLS
   policy in place before the repository can be written against real types.
   A module built against a table whose RLS was never enabled is exactly the
   bug this whole convention set exists to prevent.

This skill chains into several others. Invoke them via the Skill tool when
you reach the step — don't treat them as reading suggestions:

| Step                           | Skill              |
| ------------------------------ | ------------------ |
| table doesn't exist yet        | `add-migration`    |
| request/response shapes        | `contracts-change` |
| permission keys for the routes | `rbac-permission`  |
| events the module should emit  | `outbox-event`     |
| final verification             | `pre-pr`           |

## The four files, and what each one is actually for

### `<entity>.mapper.ts` — write this first

The **only** place that translates a database row into an API response.
snake_case → camelCase, internal `bigint` id → external `uuid`. See
`docs/adr/0016-api-conventions.md` for why ids are never exposed raw.

```ts
export function toXResponse(row: XRow): XResponse {
  return { id: row.uuid /* ...camelCase fields... */ };
}
```

### `<entity>.repository.ts` — all SQL/Drizzle for this entity

- Every method takes a `tx: Tx` (never a bare `Database`) — the caller is
  responsible for tenant scoping via `DatabaseService`, the repository just
  runs queries inside whatever transaction it's handed.
- List queries use **keyset pagination**: fetch `limit + 1` rows ordered by
  `(created_at, id)`, decode/encode cursors via
  `apps/api/src/common/pagination/cursor.ts`. Never `OFFSET`.
- Record-scope filtering (`all`/`team`/`own`) is applied here, not in the
  controller — see `contacts.repository.ts`'s `list()` for the exact SQL
  pattern (a `team` scope needs a subquery over `team_members`).
- Updates that should be optimistically locked take an `expectedVersion` and
  add `AND row_version = $n` to the WHERE clause; zero rows affected means the
  caller should get a 409, not a silent no-op.

### `<entity>.service.ts` — one transaction per operation

Every write method has this shape, in this order, inside **one**
`this.db.tx(async (tx) => { ... })`:

```ts
async create(input: CreateXInput): Promise<XResponse> {
  const ctx = RequestContextStore.require();
  return this.db.tx(async (tx) => {
    // 1. resolve any uuid inputs (owner, company, ...) to internal ids
    // 2. the actual repository write
    // 3. this.audit.record(tx, { module: 'x', recordId, action: 'insert' })
    // 4. this.outbox.emit(tx, { aggregateModule: 'x', aggregateId, eventType: 'x.created', payload })
    // 5. re-read and return the mapped row
  });
}
```

Why all in one transaction: if the outbox emit is outside it, a crash between
the write and the emit leaves a row nobody was ever notified about. See
`docs/adr/0005-transactional-outbox.md`.

For updates, diff old vs new with `this.audit.diff(before, after)` — only
changed fields go in the audit row, not a full snapshot.

Errors are always `AppError` statics from
`apps/api/src/common/errors/app-error.ts` — `AppError.notFound(...)`,
`.forbidden(...)`, `.rowVersionConflict(...)`, `.validation(...)`. Never a bare
`throw new Error(...)` on a path a user can reach; it would surface as an
unhelpful 500 instead of the right problem+json code.

### `<entity>.controller.ts` — thin, declarative

```ts
@ActorKinds('user')
@Controller({ path: 'x', version: '1' })
export class XController {
  @Get()
  @RequirePermission('record.x.read')
  async list(
    @Query(zodPipe(listXQuerySchema)) query: ListXQuery,
    @GrantedScope('record.x.read') scope: RecordScope,
  ) {
    return this.x.list(query, scope);
  }

  @Post()
  @Idempotent()
  @RequirePermission('record.x.create')
  async create(@Body(zodPipe(createXSchema)) body: CreateXInput) {
    return this.x.create(body);
  }
  // ...
}
```

- `@RequirePermission('record.<module>.<action>')` on every route — the key
  must already exist in `permission_defs` (see the `rbac-permission` skill if
  it doesn't yet).
- `@Idempotent()` on POST/PATCH that a retried request must not duplicate.
- No business logic here. If a controller method is more than the
  Zod-pipe + service call, that logic belongs in the service.

### `index.ts` — the module's only public surface

```ts
export { XService } from './x.service';
export { XRepository } from './x.repository';
export { toXResponse } from './x.mapper';
export type { XRow } from './x.repository';
```

Other modules may only import through this barrel — reaching into
`modules/x/internal-file.ts` from `modules/y` fails `pnpm arch:check` by
design (`.dependency-cruiser.cjs`, rule `no-cross-module-internals`). If two
modules genuinely need to talk, that's what the outbox is for.

## Contracts come from `@crm/contracts`, not from the API package

Request/response Zod schemas live in `packages/contracts/src/<app>/<entity>.ts`
and are exported from `packages/contracts/src/index.ts`. **Invoke the
`contracts-change` skill** to write them — the short version is schema first,
type inferred, then rebuild the package
(`pnpm --filter @crm/contracts build`) before the API can see the new export,
but there are enough rules that it's worth running that skill properly.

## Permissions for the routes

Every route needs a `@RequirePermission('record.<module>.<action>')` key that
already exists in `permission_defs`. **Invoke the `rbac-permission` skill**
to register them — a key that was never seeded fails as a silent no-op on the
grant insert, not as an obvious error.

## Wiring the module

1. Create the app-level module file if it doesn't exist yet
   (`modules/<app>/<app>.module.ts`), following `modules/crm/crm.module.ts`.
2. Add the new entity's controller/service/repository to its `providers`/
   `controllers` arrays.
3. Register the app module in `apps/api/src/app.module.ts`'s `imports` — it's
   currently commented as "InboxModule, BroadcastModule, ... — see each
   module's README" if this is the first entity in that app.
4. Add an `index.ts` barrel for the app module too
   (`modules/<app>/index.ts`), mirroring `modules/crm/index.ts`.

## Before calling it done

**Invoke the `pre-pr` skill** — it runs the full local gate (format, lint,
typecheck, `arch:check`, unit tests, and migration/integration checks when
relevant files changed) rather than you running a partial subset by hand.

Then **invoke the `adr-compliance-review` skill** if this module touches
tenancy, auth, billing or the outbox — it checks the diff against the rules
those ADRs set, which is a different question from "does it compile and pass
tests."
