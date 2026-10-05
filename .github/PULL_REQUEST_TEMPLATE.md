## What changed

<!-- One paragraph. What does this do that the codebase could not do before? -->

## Why

<!-- The problem, not the solution. Link the issue if there is one. -->

## Checklist

- [ ] Tenant-scoped queries go through `DatabaseService.tx()` — no raw pool access
- [ ] New tables have `org_id`, a composite PK, composite FKs, and an RLS policy
- [ ] Any new SQL migration is additive; no applied migration was edited
- [ ] Drizzle schema mirrors the migration (same commit)
- [ ] New API responses expose `uuid`, never internal `bigint` ids
- [ ] List endpoints use cursor pagination
- [ ] Money/message-sending endpoints accept `Idempotency-Key`
- [ ] `withPrivileged` is not reachable from an HTTP handler
- [ ] Contracts changed in `@crm/contracts`, not duplicated in the app

## Risk

<!-- What breaks if this is wrong, and how would we notice? -->
