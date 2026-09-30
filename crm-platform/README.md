# CRM Platform

Multi-tenant, metadata-driven CRM platform: a kernel plus five apps — CRM,
Inbox, Broadcast, Billing and Exam Applications — with a staff web app and a
sub-agent portal.

**Stack:** NestJS · PostgreSQL 16 (RLS + partitioning) · Drizzle · BullMQ/Redis ·
Socket.IO · Next.js · pnpm workspaces

## Quick start

```bash
corepack enable pnpm
pnpm install
cp .env.example .env

pnpm infra:up                          # postgres, redis, minio, mailpit
pnpm --filter @crm/contracts build
pnpm --filter @crm/db build
pnpm db:migrate && pnpm db:seed

pnpm dev                               # API  → http://localhost:3000
pnpm dev:worker                        # worker, in a second terminal
```

```bash
curl localhost:3000/health             # {"status":"ok",...}
open  localhost:3000/docs              # Swagger
```

Seeded staff login: `admin@studyfromuae.test` / `Passw0rd!` (org
`studyfromuae`). Full walkthrough:
[docs/runbooks/local-development.md](docs/runbooks/local-development.md).

## Layout

```
apps/
  api/          NestJS — HTTP, WebSocket, and the worker (same image)
  web/          staff CRM (Next.js)        ← slot, see its README
  partner/      sub-agent portal (Next.js) ← slot, see its README
packages/
  contracts/    Zod schemas + types shared by API and frontends
  db/           Drizzle schema, SQL migrations, runner, seeds
  config/       shared tsconfig
docs/
  architecture/ how it works
  adr/          why it works that way — 16 decision records
  runbooks/     how to operate it
  db/           the ERD
tools/migration/ legacy Geta migration (planned)
```

## What exists today

| Area                                            | State                                             |
| ----------------------------------------------- | ------------------------------------------------- |
| Tenancy, RLS, RBAC, outbox, audit, partitioning | working, tested                                   |
| **Contacts**                                    | **complete vertical slice — the pattern to copy** |
| Sub-agent portal API                            | submit, list, live stage reads                    |
| Public API `/public/v1`                         | API key + HMAC, lead read/submit                  |
| Auth                                            | staff + partner login, JWT, argon2                |
| Inbox, Broadcast, Billing, Exams                | designed and documented, not built                |

Each unbuilt module has a README with its intended shape and the decisions
already made — read it before starting.

## The ten decisions worth knowing

| Decision                               | Why it matters                                             | ADR                                                  |
| -------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------- |
| One NestJS app, split by module        | two engineers, one deploy                                  | [0001](docs/adr/0001-modular-monolith.md)            |
| Shared schema + **forced** RLS         | a forgotten WHERE returns nothing, not someone else's data | [0002](docs/adr/0002-postgres-rls-multitenancy.md)   |
| App connects as a **non-superuser**    | superusers bypass RLS — this is load-bearing               | [0002](docs/adr/0002-postgres-rls-multitenancy.md)   |
| Drizzle as a query builder             | composite keys, RLS, partitions, JSONB                     | [0003](docs/adr/0003-drizzle-over-orm.md)            |
| Hand-written SQL migrations            | generators cannot emit policies or partitions              | [0004](docs/adr/0004-handwritten-sql-migrations.md)  |
| Transactional outbox                   | "row committed" and "event exists" cannot diverge          | [0005](docs/adr/0005-transactional-outbox.md)        |
| RBAC in guards, RLS for isolation only | query plans that do not depend on who is asking            | [0006](docs/adr/0006-rbac-at-middleware.md)          |
| Separate identity pools                | an external agent cannot appear in a staff dropdown        | [0007](docs/adr/0007-three-identity-pools.md)        |
| Worker as a separate process           | a campaign burst cannot starve HTTP latency                | [0010](docs/adr/0010-bullmq-worker-process.md)       |
| External reads on a replica            | partner polling never competes with staff writes           | [0013](docs/adr/0013-read-replica-and-public-api.md) |

## Commands

```bash
pnpm dev / dev:worker      # watch mode
pnpm test                  # unit
pnpm test:integration      # testcontainers — real Postgres, real RLS
pnpm typecheck lint        # static checks
pnpm arch:check            # module boundary rules (CI-enforced)
pnpm db:migrate status new seed reset
pnpm infra:up down logs nuke
```

## Adding a module

Copy `apps/api/src/modules/crm/contacts/` — controller, service, repository,
mapper, `index.ts`. It is the reference implementation of every convention:
tenant-scoped transactions, optimistic locking, cursor pagination, uuid↔bigint
translation, audit + outbox in the same transaction, problem+json errors.

Then read the [PR checklist](.github/PULL_REQUEST_TEMPLATE.md).

## Documentation

Start at [docs/README.md](docs/README.md). If you are about to ask "why is it
done this way", the answer is in [docs/adr/](docs/adr/).

## Before production

See [ADR-0011](docs/adr/0011-single-vm-deploy.md#required-before-this-is-production-safe)
— backups with a **tested** restore, monitoring, disk alerts, log shipping.

And [ADR-0012](docs/adr/0012-payments-and-settlements.md#compliance--read-before-enabling-settlements)
— exam-fee settlements are **blocked** on an RBI PA/PG compliance review. Test
mode only until that is closed.
