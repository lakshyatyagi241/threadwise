# Documentation

## Start here

| If you want to…                     | Read                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| understand the system               | [architecture/overview.md](architecture/overview.md)                                             |
| run it locally                      | [runbooks/local-development.md](runbooks/local-development.md)                                   |
| know why something is the way it is | the [ADRs](#decision-records)                                                                    |
| add a table                         | [architecture/multi-tenancy.md](architecture/multi-tenancy.md#adding-a-new-table--the-checklist) |
| add a module                        | copy `apps/api/src/modules/crm/contacts/`                                                        |

## Architecture

| Document                                            | Covers                                                    |
| --------------------------------------------------- | --------------------------------------------------------- |
| [overview.md](architecture/overview.md)             | the shape of the system, layers, request lifecycle        |
| [multi-tenancy.md](architecture/multi-tenancy.md)   | RLS, tenant context, the non-superuser rule               |
| [kernel.md](architecture/kernel.md)                 | metadata, three storage tiers, outbox, audit, display ids |
| [rbac.md](architecture/rbac.md)                     | capabilities, scopes, merge rules, caching                |
| [messaging.md](architecture/messaging.md)           | inbox, identity resolution, broadcast pipeline            |
| [billing.md](architecture/billing.md)               | wallet, two-level ledger, rate cards                      |
| [scale.md](architecture/scale.md)                   | partitioning, hot rows, the target numbers                |
| [partner-agents.md](architecture/partner-agents.md) | the sub-agent model                                       |

## Decision records

Every architectural decision, with the alternatives that were rejected and why.
Format: [MADR](https://adr.github.io/madr/). Template:
[0000-template.md](adr/0000-template.md).

| #                                               | Decision                                    | Status                                   |
| ----------------------------------------------- | ------------------------------------------- | ---------------------------------------- |
| [0001](adr/0001-modular-monolith.md)            | One NestJS app, split by domain module      | accepted                                 |
| [0002](adr/0002-postgres-rls-multitenancy.md)   | Shared schema + forced RLS                  | accepted                                 |
| [0003](adr/0003-drizzle-over-orm.md)            | Drizzle as a query builder, not an ORM      | accepted                                 |
| [0004](adr/0004-handwritten-sql-migrations.md)  | Hand-written SQL migrations + custom runner | accepted                                 |
| [0005](adr/0005-transactional-outbox.md)        | Transactional outbox, not event sourcing    | accepted                                 |
| [0006](adr/0006-rbac-at-middleware.md)          | RBAC in guards; RLS does isolation only     | accepted                                 |
| [0007](adr/0007-three-identity-pools.md)        | Separate identity pools, own JWT auth       | accepted                                 |
| [0008](adr/0008-rest-openapi-zod.md)            | REST + OpenAPI, Zod contracts               | accepted                                 |
| [0009](adr/0009-hard-delete-with-audit.md)      | Hard delete, audit log as the record        | accepted                                 |
| [0010](adr/0010-bullmq-worker-process.md)       | BullMQ, worker as a separate process        | accepted                                 |
| [0011](adr/0011-single-vm-deploy.md)            | Single VM + docker compose for v1           | accepted                                 |
| [0012](adr/0012-payments-and-settlements.md)    | Wallet, two-level ledger, settlement gate   | **schema accepted, settlements blocked** |
| [0013](adr/0013-read-replica-and-public-api.md) | External reads on a replica, API key + HMAC | accepted                                 |
| [0014](adr/0014-sub-agent-model.md)             | Sub-agents: own pool, live stage reads      | accepted                                 |
| [0015](adr/0015-legacy-geta-migration.md)       | Migrating off the legacy Geta system        | **proposed**                             |
| [0016](adr/0016-api-conventions.md)             | uuids, cursors, problem+json, idempotency   | accepted                                 |
| [0017](adr/0017-field-metadata-registry.md)     | Generic field-metadata registry (Tier-2)    | accepted                                 |
| [0018](adr/0018-web-app-stack-and-session.md)   | Web app stack and httpOnly-cookie session   | proposed                                 |

## Runbooks

| Document                                              | For                                        |
| ----------------------------------------------------- | ------------------------------------------ |
| [local-development.md](runbooks/local-development.md) | getting it running, day-to-day commands    |
| [migrations.md](runbooks/migrations.md)               | writing and applying schema changes safely |
| [outbox-backlog.md](runbooks/outbox-backlog.md)       | when events stop being processed           |

## Database

[db/README.md](db/README.md) — the ERD, and where the implementation currently
differs from it.

## Phase plan

[phase-plan.md](phase-plan.md) — build order, one phase per frontend page,
dependency-ordered and audited. Read this before starting a new phase; it
also defines the Swagger-gating rule (a page's routes stay out of `/docs`
until its phase is fully done).

## API inventory

[api-inventory.md](api-inventory.md) — every frontend page, the API groups it
needs, individual API names, and the actual `/v2/...` route once built. Update
it as each phase lands.

## API testing guide

[api-testing.md](api-testing.md) — Postman steps, sample request, and real
captured response for every endpoint currently live. Add a section here when
a new endpoint ships.

## Writing an ADR

Write one when a decision would be expensive to reverse, or when the next
person would reasonably ask "why on earth did they do it like this".

1. Copy `adr/0000-template.md` to the next number.
2. Fill in **Context** with facts and constraints, not opinions.
3. Be specific in **Consequences → Negative**. An ADR with no negative
   consequences has not been thought through.
4. Record the **Alternatives** you actually considered, and the concrete reason
   each was rejected. "Too complex" is not a reason.
5. Add a **Revisit when** trigger, so the decision does not calcify into dogma.
6. Link it from the table above.

Superseding an ADR does not delete it: set its status to `superseded by ADR-N`.
The record of what we used to think is the point.
