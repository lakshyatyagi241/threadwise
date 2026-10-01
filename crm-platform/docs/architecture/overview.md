# Architecture overview

A multi-tenant, metadata-driven CRM platform: a **kernel** plus five **apps**
(CRM, Inbox, Broadcast, Billing, Exam Applications), a **staff web app**, and a
**sub-agent portal**.

## The shape

```
                    ┌─────────────┐  ┌─────────────┐
                    │  apps/web   │  │apps/partner │
                    │ staff CRM   │  │ sub-agents  │
                    └──────┬──────┘  └──────┬──────┘
                           │ /v2            │ /v2/partner
                           ▼                ▼
   external ──ApiKey──> ┌──────────────────────────────┐
   systems  +HMAC       │          apps/api            │
   /public/v1           │  guards → kernel → modules   │
                        └───────┬──────────────┬───────┘
                                │              │ enqueue
                          primary│              ▼
                                │        ┌──────────┐
   ┌────────────┐               │        │  worker  │  outbox drain
   │  replica   │◄──partner &───┤        │(same img)│  campaigns, billing
   │ (reads)    │   public reads │        └────┬─────┘  SLA, counters
   └────────────┘               ▼             │
                         ┌─────────────┐      │
                         │ PostgreSQL  │◄─────┘
                         │  RLS + FKs  │
                         └─────────────┘
                         ┌─────────────┐
                         │    Redis    │  queues · RBAC cache · sockets
                         └─────────────┘
```

## Layers inside `apps/api`

```
src/
  config/     env schema — the app refuses to boot on a bad value
  common/     context, guards' building blocks, filters, pipes, pagination
  infra/      db, redis, queue, s3, provider adapters   ← no domain knowledge
  kernel/     outbox, audit, RBAC, display ids           ← no app knowledge
  modules/    crm, partner, public-api, auth (+ inbox, broadcast, billing, exams)
  realtime/   socket.io gateway
  workers/    outbox drain, partition maintenance        ← worker process only
```

The dependency rule, enforced in CI by dependency-cruiser:

- `modules/*` may depend on `kernel`, `infra`, `common`
- `kernel` may **not** depend on `modules`
- `infra` may **not** depend on `kernel` or `modules`
- one module may **not** reach into another module's internals — only its
  `index.ts` barrel, or the outbox

## The ten decisions that shape everything else

| #   | Decision                                                  |
| --- | --------------------------------------------------------- |
| 1   | One NestJS app, split by domain module                    |
| 2   | Shared schema + forced RLS for tenant isolation           |
| 3   | Drizzle as a query builder, hand-written SQL migrations   |
| 4   | Transactional outbox, not event sourcing                  |
| 5   | RBAC in guards; RLS does isolation only                   |
| 6   | Separate identity pools (staff / agent / candidate / key) |
| 7   | REST + OpenAPI, Zod contracts shared with the frontend    |
| 8   | Hard delete, audit log as the record                      |
| 9   | BullMQ worker as a separate process from the same image   |
| 10  | External reads on a replica, behind API key + HMAC        |

## Hybrid storage — three tiers

1. **Core entities → physical tables.** Typed columns, real composite FKs.
   Contacts, companies, deals, conversations, campaigns, applications.
2. **Custom fields → `data` JSONB**, defined by `fields` metadata. Adding a
   field is one metadata row and zero DDL. Hot fields get online expression
   indexes, governed by `field_indexes`.
3. **Custom modules → the generic `records` table.** ~50 per org, no
   per-module DDL, ever.

The kernel makes all three look identical to the API.

## Request lifecycle

```
RequestContextMiddleware   open AsyncLocalStorage context, assign requestId
  → JwtAuthGuard           verify token, set orgId + actor on the context
  → PermissionsGuard       resolve grants (Redis-cached), check capability
  → IdempotencyInterceptor reserve/replay by Idempotency-Key
  → ZodValidationPipe      parse and transform the payload
  → Controller → Service
      → DatabaseService.tx()
          BEGIN
          set_config('app.org_id', …, true)    ← RLS predicate becomes true
          business write
          audit_log insert
          event_outbox insert                  ← same transaction
          COMMIT
  → ProblemExceptionFilter on any throw: RFC 9457 problem+json
```

## What exists today

| Area                             | State                                             |
| -------------------------------- | ------------------------------------------------- |
| Foundation, RBAC, tenancy        | migrations + services                             |
| Contacts                         | **complete vertical slice** — the pattern to copy |
| Partner agents / portal API      | submit, list, live read                           |
| Public API (`/public/v1`)        | key + HMAC auth, lead read/submit                 |
| Outbox + audit + partitioning    | working, drained by the worker                    |
| Inbox, Broadcast, Billing, Exams | documented, not built — see each module README    |

## Where to read next

- [Multi-tenancy](multi-tenancy.md) — how isolation actually works
- [Kernel](kernel.md) — the metadata engine
- [RBAC](rbac.md) — permissions and scopes
- [Scale](scale.md) — partitioning, counters, the numbers behind the design
- [Sub-agents](partner-agents.md) — the channel-partner model
