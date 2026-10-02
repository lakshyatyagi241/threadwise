# API: bsp-billing-engine

Domain `bsp` (WD-BSP-001 .. 017). Spec: `docs/wadesk-port/inventory/bsp-billing-engine.md`; plan: `docs/wadesk-port/port-map/bsp-billing-engine.md`.
Base path `/v2`. Errors are `application/problem+json` with a stable `code` and a `requestId`. Codes added in `@crm/contracts`
`common/errors.ts`: `BSP_NOT_CONFIGURED`, `BSP_CURRENCY_UNSUPPORTED`, `BSP_WABA_NOT_FOUND`, `BSP_META_REJECTED`,
`BSP_ALLOCATION_NOT_ATTACHED`, `BSP_RESELLER_UNAVAILABLE`. Shapes: `packages/contracts/src/bsp-billing-engine/reseller.ts`.
Money is a decimal string in the base currency's major unit; every id is a uuid.

## Platform routes (operator token, `/api/platform/*` through the web proxy)

Reads: any operator. Writes: `super_admin`. Every write is audited and emits an outbox event in the same transaction.

| Route                                       | Feature          | Notes                                                                                                     |
| ------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------- |
| `GET  /platform/bsp/status`                 | WD-BSP-001       | `{ ok, module, configured, graphVersion, allocations }`                                                   |
| `GET  /platform/bsp/settings`               | WD-BSP-003       | The token is never returned, only `tokenSet`                                                              |
| `PUT  /platform/bsp/settings`               | WD-BSP-004       | Blank token keeps the stored one; `clearToken` removes it. Token is stored encrypted in platform settings |
| `GET  /platform/bsp/waba-candidates`        | WD-BSP-003       | Connected WABA numbers of reseller workspaces, with workspace currency                                    |
| `GET  /platform/bsp/allocations`            | WD-BSP-010       | Cursor page (`cursor`, `limit`, `status`)                                                                 |
| `POST /platform/bsp/allocations`            | WD-BSP-006       | `{ workspaceId, wabaId, currency }`; idempotent per (workspace, WABA); a failed or revoked row is retried |
| `POST /platform/bsp/allocations/attach-all` | WD-BSP-007       | Bounded batches; reports `attached`, `failed`, `skipped` and what remains                                 |
| `POST /platform/bsp/allocations/:id/revoke` | WD-BSP-009       | Optimistic lock (`rowVersion`); reports workspaces still in reseller mode                                 |
| `GET  /platform/bsp/dashboard`              | WD-BSP-014, -015 | `month=YYYY-MM` (default current), top workspaces by revenue                                              |

## Workspace routes (staff bearer token)

| Route                   | Capability           | Feature    |
| ----------------------- | -------------------- | ---------- |
| `GET /bsp/billing-mode` | `bsp.billing.read`   | WD-BSP-011 |
| `PUT /bsp/billing-mode` | `bsp.billing.manage` | WD-BSP-011 |

`PUT { mode: 'reseller' }` is refused with `BSP_RESELLER_UNAVAILABLE` while the platform credit line is not configured; otherwise it
flips the workspace flag, attaches every connected WABA (failures are recorded, not thrown) and returns the attach summary.
`{ mode: 'meta_direct' }` only flips the flag; the credit line is not revoked (WaDesk behaviour).

The Admin preset holds both keys (migration `bsp_permissions`).
