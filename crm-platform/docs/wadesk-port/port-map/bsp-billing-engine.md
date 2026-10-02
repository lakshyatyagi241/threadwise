# Port map: bsp-billing-engine (BSP)

Spec: [../inventory/bsp-billing-engine.md](../inventory/bsp-billing-engine.md). Zone: `ownership.json` -> `domains.bsp-billing-engine`.
The reseller slice of WaDesk is small (one table, ten routes). Everything money-moving is the WALLET domain's; this domain owns
the Meta credit-line connection, the allocation register, the customer billing-mode choice, the reseller P&L and the
contracts WALLET consumes (billing mode, Meta cost resolution).

## Target modules

| Piece                                                                                      | Home                                                                                                            |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `BspBillingEngineModule` (controllers, services, platform reader)                          | `apps/api/src/modules/bsp-billing-engine/`                                                                      |
| `BspBillingEngineWorkerModule` (auto-attach sweep, runs in the worker process only)        | same folder, imported by `workers/workers.module.ts` (seam)                                                     |
| `CreditSourcePort` + `MetaCreditSource` (Graph calls, per-call timeout, no retries)        | `apps/api/src/infra/providers/bsp-billing-engine/`                                                              |
| Contracts (`bsp*` schemas, `BSP_ERROR_CODES` live in `common/errors.ts` like every domain) | `packages/contracts/src/bsp-billing-engine/`                                                                    |
| Web: operator console pages and the customer billing-mode card                             | `apps/web/src/app/(admin)/(bsp-billing-engine)/`, `(app)/(bsp-billing-engine)/`, `features/bsp-billing-engine/` |

## Tables

| Table                                        | Owner        | Shape                                                                                                                                                                                    |
| -------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bsp_credit_allocations`                     | BSP          | tenant (org_id first, forced RLS), already ported; migration `bsp_reseller_core` adds UNIQUE (org_id, waba_id), status/source CHECKs, `created_by_operator_id`, a platform listing index |
| `workspace_settings.bill_to_platform_credit` | WSP          | the reseller flag (`true` = reseller). BSP writes only this column (upsert of the org's row)                                                                                             |
| `wa_provider_configs`                        | WADEV        | read only: `provider='waba'`, `status='connected'`, `meta_json->>'waba_id'`, phone                                                                                                       |
| `usage_charges` (WaDesk `message_charges`)   | WALLET       | read only (P&L): `status`, `revenue_minor`, `cost_minor`, `created_at`                                                                                                                   |
| `message_rates`, `wallets`, `currencies`     | WALLET / CPN | read only (cost resolution, wallet float, currency list)                                                                                                                                 |
| `platform_settings`                          | AUTH         | through `PlatformSettingsService`: `bsp.connection` (JSON, non secret) and the secret `bsp.system_user_token` (encrypted envelope)                                                       |

There is no markup table, no BSP wallet and none of the six dropped `bsp_*` tables (WD-BSP-018, -019).

## Endpoints

Platform (operator pool, `OperatorGuard`; writes need `super_admin`), version 2:

| Route                                          | Feature          |
| ---------------------------------------------- | ---------------- |
| `GET  /v2/platform/bsp/status`                 | WD-BSP-001       |
| `GET  /v2/platform/bsp/settings`               | WD-BSP-003       |
| `PUT  /v2/platform/bsp/settings`               | WD-BSP-004       |
| `GET  /v2/platform/bsp/waba-candidates`        | WD-BSP-003       |
| `GET  /v2/platform/bsp/allocations`            | WD-BSP-010       |
| `POST /v2/platform/bsp/allocations`            | WD-BSP-006       |
| `POST /v2/platform/bsp/allocations/attach-all` | WD-BSP-007       |
| `POST /v2/platform/bsp/allocations/:id/revoke` | WD-BSP-009       |
| `GET  /v2/platform/bsp/dashboard`              | WD-BSP-014, -015 |

Tenant (staff, permission `bsp.billing.*`):

| Route                      | Feature    |
| -------------------------- | ---------- |
| `GET /v2/bsp/billing-mode` | WD-BSP-011 |
| `PUT /v2/bsp/billing-mode` | WD-BSP-011 |

## Permission keys

`bsp.billing.read`, `bsp.billing.manage` (migration `bsp_permissions`, granted to the Admin preset). WaDesk had no key (workspace
admin role check); the operator routes have no key either, they use operator roles.

## Cross-tenant reads (the sanctioned door)

The register, the WABA picker, the dashboard and the auto-attach sweep read across tenants. They go through the auth module's
`PlatformStore` (exported through the auth barrel, one additive edit) and never add a `.privileged(` call of their own; a unit test
greps the zone for it. Every write is tenant-scoped (`DatabaseService.txAs({ orgId })` for the organization being changed) and
never holds a transaction open across a Graph call: read, call Meta, then write (audit + outbox in that write).

## Prerequisites from other domains

| Needs                                 | State                     | What this domain does                                                                                                   |
| ------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| AUTH operator pool, settings, audit   | built                     | reuse                                                                                                                   |
| WALLET settle/refund/precheck engine  | not built                 | WD-BSP-012 partial: ships `BillingModeService` and the Meta cost resolver as the contract; engine blocked               |
| WADEV/WABA connection module + event  | not built (tables only)   | auto-attach is a sweep over `wa_provider_configs`, no event needed; revisit when `whatsapp.connection.connected` exists |
| WSP admin workspace form (WD-BSP-013) | not built                 | not built (P2, WSP's screen)                                                                                            |
| Outbox subscriber registry            | missing (drain only logs) | events are emitted for later consumers; nothing here depends on a consumer                                              |

## Build order

1. Migration + Drizzle (allocations constraints, permissions) -> integration test of RLS/constraints on the own database.
2. Contracts.
3. Provider: `CreditSourcePort` + Meta adapter (tested against a local HTTP stub).
4. Rules (currency allow-list, setting normalisation, cost resolution, month window) as pure functions with unit tests.
5. Settings service (WD-BSP-004/-005), credit service (006/007/008/009), billing mode (011/012), reporting (014/015/016).
6. Controllers, module, seams, e2e through HTTP.
7. Web: operator pages (connect + register, P&L), customer card, nav entries, messages.

## Risks

- A Graph call is slow (up to 30 s). Mitigation: per-call timeout, no open transaction, attach-all runs in bounded batches with limited concurrency and reports what is left.
- Two admins attaching the same WABA at once may both call Meta; the unique key makes the second write an update, and Meta's attach is idempotent per WABA. Documented, not locked.
- The reseller flag and the credit line can disagree (WaDesk QUIRK: revoke and switch-back do not coordinate). Revoke now reports the workspaces still in reseller mode so the operator sees the double-billing risk.
- `usage_charges` is partitioned and WALLET-owned; the dashboard query only reads it. If WALLET changes the column names, `reseller-report.service.ts` is the single place to follow.
