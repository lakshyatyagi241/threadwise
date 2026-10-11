# Documentation

## Start here

| If you want to…          | Read                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| understand the system    | [architecture/overview.md](architecture/overview.md)                                                    |
| run it locally           | [runbooks/local-development.md](runbooks/local-development.md)                                          |
| add a table              | [architecture/multi-tenancy.md](architecture/multi-tenancy.md#adding-a-new-table--the-checklist)        |
| add a module             | copy `apps/api/src/modules/crm/contacts/`                                                               |
| see what is planned      | [backlog.md](backlog.md) and the product specs in [specs/](specs/)                                      |
| take leads in            | [api/leads.md](api/leads.md): lead sources, the webhook door, the pipeline                              |
| capture leads with forms | [api/forms-builder.md](api/forms-builder.md): the Forms add-on, hosted and embedded web forms           |
| call external APIs       | [api/api-library.md](api/api-library.md): saved HTTP calls, the sandboxed function, logs, the flow node |
| extend or connect        | [api/marketplace.md](api/marketplace.md): mini apps, integrations, the kill switch                      |

## Architecture

| Document                                            | Covers                                                     |
| --------------------------------------------------- | ---------------------------------------------------------- |
| [overview.md](architecture/overview.md)             | the shape of the system, layers, request lifecycle         |
| [multi-tenancy.md](architecture/multi-tenancy.md)   | RLS, tenant context, the non-superuser rule                |
| [tenant-context.md](architecture/tenant-context.md) | how the tenant identity is resolved and carried everywhere |
| [kernel.md](architecture/kernel.md)                 | metadata, three storage tiers, outbox, audit, display ids  |
| [rbac.md](architecture/rbac.md)                     | capabilities, scopes, merge rules, caching                 |
| [messaging.md](architecture/messaging.md)           | inbox, identity resolution, broadcast pipeline             |
| [billing.md](architecture/billing.md)               | wallet, two-level ledger, rate cards                       |
| [scale.md](architecture/scale.md)                   | partitioning, hot rows, the target numbers                 |
| [partner-agents.md](architecture/partner-agents.md) | the sub-agent model                                        |

## Mobile app

[mobile/README.md](mobile/README.md): the iOS/Android app (`apps/mobile`): [handover](mobile/handover.md), [backlog](mobile/backlog.md), [security](mobile/security.md),
[i18n](mobile/i18n.md), [testing](mobile/testing.md). Decisions: ADR-0021 to 0027 in [adr/](adr/).

## Runbooks

| Document                                                                  | For                                                             |
| ------------------------------------------------------------------------- | --------------------------------------------------------------- |
| [local-development.md](runbooks/local-development.md)                     | getting it running, day-to-day commands                         |
| [migrations.md](runbooks/migrations.md)                                   | writing and applying schema changes safely                      |
| [outbox-backlog.md](runbooks/outbox-backlog.md)                           | when events stop being processed                                |
| [google-calendar-setup.md](runbooks/google-calendar-setup.md)             | creating the Google OAuth client for workspace calendars        |
| [marketplace-publish-listing.md](runbooks/marketplace-publish-listing.md) | publishing a Marketplace listing and writing a connector recipe |
| [mobile-local-development.md](runbooks/mobile-local-development.md)       | running the mobile app on an emulator or phone                  |
| [mobile-store-setup.md](runbooks/mobile-store-setup.md)                   | Apple, Google and Expo accounts, bundle id, first store listing |
| [mobile-release.md](runbooks/mobile-release.md)                           | OTA updates, store releases, rollbacks                          |

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
