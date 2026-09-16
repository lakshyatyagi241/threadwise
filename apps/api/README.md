# @crm/api

The API and the worker. One codebase, one image, two entrypoints.

```bash
pnpm dev             # HTTP + WebSocket on :3000
pnpm dev:worker      # BullMQ processors and schedulers, no HTTP listener
```

Build output is `dist/src/**` — the Nest SWC builder mirrors `sourceRoot`, so
the entrypoints are `dist/src/main.js` and `dist/src/worker.js`. Not a mistake.

## Layout

```
src/
  config/     env schema — Zod, fail-fast at boot
  common/     request context, decorators, filters, pipes, crypto, pagination
  infra/      db, redis, queue, provider adapters      ← no domain knowledge
  kernel/     outbox, audit, RBAC, display ids          ← no app knowledge
  modules/
    auth/       staff + partner login, guards
    crm/        contacts — THE REFERENCE SLICE
    partner/    sub-agent portal API
    public-api/ /public/v1, API key + HMAC
    inbox|broadcast|billing|exams/   READMEs only, not built
  realtime/   socket.io gateway + Redis adapter
  workers/    outbox drain, partition maintenance       ← worker process only
```

Boundaries are enforced by `pnpm arch:check`
(`.dependency-cruiser.cjs`): `kernel` may not import `modules`, `infra` may not
import either, and one module may not reach into another's internals.

## The reference slice

`src/modules/crm/contacts/` is four files and demonstrates every convention:

| File                     | Shows                                                           |
| ------------------------ | --------------------------------------------------------------- |
| `contacts.controller.ts` | `@RequirePermission`, `@GrantedScope`, `@Idempotent`, Zod pipes |
| `contacts.service.ts`    | one transaction per operation; write + audit + outbox together  |
| `contacts.repository.ts` | keyset pagination, scope predicates, optimistic update          |
| `contacts.mapper.ts`     | uuid↔bigint translation, snake_case → camelCase                 |

Copy it. Do not invent a different arrangement.

## Request lifecycle

```
RequestContextMiddleware   AsyncLocalStorage context + requestId
  → JwtAuthGuard           global; opt out with @Public()
  → PermissionsGuard       global; active when @RequirePermission is present
  → IdempotencyInterceptor reserve/replay on Idempotency-Key
  → ZodValidationPipe      parse and transform
  → Controller → Service → DatabaseService.tx()
  → ProblemExceptionFilter RFC 9457 on any throw
```

Authentication is **opt-out**, not opt-in. A controller added in a hurry is
protected by default.

## Tests

```bash
pnpm test               # unit — pure logic, no I/O
pnpm test:integration   # testcontainers: real Postgres, real RLS, real triggers
```

`test/integration/rls.spec.ts` is the most important file in the repository. It
creates a non-superuser role and proves a tenant cannot read, insert into or
move a row to another tenant — and asserts the connection is not a superuser,
because otherwise every other assertion in it would be vacuous.

## Notes

- `rawBody: true` is enabled in `main.ts`. Webhook and public-API signatures are
  computed over the bytes as sent; re-serialised JSON has a different digest.
- Health is version-neutral: `/health` and `/ready`, not `/v1/health`. An
  orchestrator probe should not need updating when the API moves to v2.
- `/public/v1` is also version-neutral, so global URI versioning does not
  prefix it into `/v1/public/v1`.
