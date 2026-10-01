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

| Decision                               | Why it matters                                             |
| -------------------------------------- | ---------------------------------------------------------- |
| One NestJS app, split by module        | two engineers, one deploy                                  |
| Shared schema + **forced** RLS         | a forgotten WHERE returns nothing, not someone else's data |
| App connects as a **non-superuser**    | superusers bypass RLS — this is load-bearing               |
| Drizzle as a query builder             | composite keys, RLS, partitions, JSONB                     |
| Hand-written SQL migrations            | generators cannot emit policies or partitions              |
| Transactional outbox                   | "row committed" and "event exists" cannot diverge          |
| RBAC in guards, RLS for isolation only | query plans that do not depend on who is asking            |
| Separate identity pools                | an external agent cannot appear in a staff dropdown        |
| Worker as a separate process           | a campaign burst cannot starve HTTP latency                |
| External reads on a replica            | partner polling never competes with staff writes           |

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

Start at [docs/README.md](docs/README.md).

## Before production

A single-VM deploy needs backups with a **tested** restore, monitoring, disk
alerts and log shipping first.

Exam-fee settlements are **blocked** on an RBI PA/PG compliance review. Test
mode only until that is closed.
