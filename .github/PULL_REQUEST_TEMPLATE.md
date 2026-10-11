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

## Mobile app (only if `crm-platform/apps/mobile` changed)

- [ ] `bash .claude/skills/mobile-pre-pr/scripts/gate.sh` passes (`--full` for a native, plugin or SDK change)
- [ ] Every new or changed text is in all 21 locales (`pnpm --filter @crm/mobile i18n:check`)
- [ ] Run on an emulator or a device (which and what was tried: ___)
- [ ] No new permission, SDK or data type, or the store privacy answers to update are listed here
- [ ] Any API or contract change stays compatible with the app versions already in the field

## Risk

<!-- What breaks if this is wrong, and how would we notice? -->
