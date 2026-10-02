# Port map: add-ons, extensions and the module registry (ADD)

Spec: `inventory/addons-extension-registry.md`. Two unrelated things share the word "add-on" in Reference and stay separate here.

1. **Modules** (Reference "extensions"): code packages a platform operator installs. A package is a ZIP with an `extension.json` manifest.
2. **Billing add-ons**: a-la-carte feature and limit packs a workspace buys on top of its plan. Stored in the plan catalogue as `plans.kind = 'addon'`.

## Target modules

| Where                                                                       | What                                                                                                   |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `apps/api/src/modules/addons-extension-registry/`                           | the module; public surface in `index.ts` (registry, gate, entitlement, fulfilment, engine connections) |
| `apps/api/src/infra/providers/addons-extension-registry/`                   | `EngineHandshakePort` and its HTTP adapter (SSRF-guarded), the only outbound call of the domain        |
| `apps/api/src/config/domains/addons-extension-registry.env.ts`              | `ADDONS_DIR`, `CORE_VERSION`, size and entry limits, registry TTL, private-engine-URL switch           |
| `packages/contracts/src/addons-extension-registry/`                         | manifest, extension and add-on pack contracts                                                          |
| `packages/db/migrations/20261002130000_add_addon_registry.sql`              | constraints, the purchase index, read-only tenant policy                                               |
| `apps/web/src/features/addons-extension-registry/` and the two route groups | operator pages `/admin/addons`, `/admin/extensions`; workspace page `/addons`                          |

## Tables (already ported in `schema/`; this domain adds constraints)

| Table              | Scope                | Notes                                                                                                                                                                                    |
| ------------------ | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extensions`       | platform, not tenant | one row per installed package; reached only through `PlatformStore`. Slug is a folder name: `^[a-z0-9_-]{1,64}$`; status `active`/`disabled`; `files` lists exactly what was written     |
| `plans` (add-ons)  | platform             | `kind = 'addon'`, grants in `features` and `limits`; an add-on is never the sign-up default or a custom quote (check constraint)                                                         |
| `workspace_addons` | tenant, RLS          | tenant can only read; writes need a privileged transaction (order fulfilment), so a workspace cannot grant itself an add-on. FK to `plans` is `RESTRICT`. One row per (org, order, pack) |

## Endpoints

Operators (`OperatorGuard`; every role reads, writes need `super_admin`; each write is audited as a security event):

| Method and path                                                                               | Feature            |
| --------------------------------------------------------------------------------------------- | ------------------ |
| `GET /v2/platform/extensions`                                                                 | 001, 009, 017, 019 |
| `GET /v2/platform/extensions/nav`                                                             | 012                |
| `POST /v2/platform/extensions/verify`                                                         | 002                |
| `POST /v2/platform/extensions/upload` (multipart)                                             | 003, 004, 005, 021 |
| `POST /v2/platform/extensions/:id/toggle`                                                     | 007                |
| `DELETE /v2/platform/extensions/:id`                                                          | 008                |
| `POST /v2/platform/extensions/modules/:slug/toggle`                                           | 010                |
| `POST /v2/platform/extensions/engines/:engine/connect` and `/disconnect`                      | 017 to 020         |
| `GET/POST/PATCH/DELETE /v2/platform/addons`, `GET /addons/fields`, `PATCH /addons/:id/active` | 025 to 030         |

Workspace: `GET /v2/addons` (any signed-in member): packs on sale, what the workspace owns, whether it may buy (033).

Permission keys: none new. Reference had one admin tier; operator roles are the closest equivalent and the web UI hides what the role cannot do.

## Contracts and events

Manifest (`extension.json`), extension page, pack create/update/list, grant fields, workspace catalogue; errors `ADD_PACKAGE_INVALID`, `ADD_PACKAGE_TOO_LARGE`, `ADD_CORE_TOO_OLD`, `ADD_ENGINE_CONFLICT`, `ADD_PACK_IN_USE`, `ADD_MODULE_DISABLED`. Outbox: `addon.activated` (written in the fulfilment transaction).

## How a module plugs in

`ModuleRegistryService` reads the modules folder and the registry rows, caches for `ADDONS_REGISTRY_TTL_MS`, and answers: is a module on, what navigation, plan flags and plan limits it contributes. `@RequiresModule('slug')` + `ModuleGateGuard` turn a module's routes off when it is disabled. Package safety lives in `zip-reader.ts` (bounds, CRC, no traversal) and `extension-installer.ts` (writes only under `<dir>/<slug>/`, tracks files, protects core paths). Entitlement: `AddonEntitlementService` merges active add-ons onto a plan (booleans OR, limits add, -1 wins).

## Prerequisites from other domains

| Needs                                    | From     | Status here                                                                                                                                               |
| ---------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| plan catalogue and entitlement merge     | PLAN     | reused (`PlansCoreModule`)                                                                                                                                |
| operator identity, audit, store          | AUTH     | reused (`OperatorGuard`, `PlatformStore` now exported from the auth barrel)                                                                               |
| order finalisation calls fulfilment      | CHK      | **blocked**: `AddonFulfilmentService.fulfil(tx, ...)` is ready and tested; checkout must call it, and the workspace page shows state only (no Buy button) |
| plan form lists module-contributed flags | PLAN     | `GET /platform/addons/fields` exposes core plus module keys; the plan editor does not consume it yet                                                      |
| licence model for the purchase code      | INST     | `verify` accepts any code like Reference's stub, behind `ADDONS_REQUIRE_PURCHASE_CODE`                                                                       |
| native Instagram / email modules         | IG, MAIL | engine connections work; native modules arrive as installable packages                                                                                    |

## Build order and status

P0 (004, 005, 009, 011, 013, 025 to 028, 031, 032) and P1 (001 to 003, 007, 008, 010, 012, 014, 017 to 021, 023, 029, 030, 033) are built with tests. Not built: 006 (a package's own migrations are not run; see the first risk), 015 (dead code in Reference), 016 (route cache self-heal has no equivalent), 022 (boot teardown), 034 (EXT domain), 035 (docs only).

## Risks

- A module is files on disk; Node cannot hot-load arbitrary code safely, so this port installs, tracks and gates modules and their contributions but does not execute uploaded server code. Executing packages is a decision for the owner.
- ZIP bombs and path traversal: bounded entry count, unpacked size and per-entry CRC; traversal and core paths refused (unit tested).
- Engine URLs are an SSRF vector: private, loopback and link-local hosts are refused unless `ADDONS_ALLOW_PRIVATE_ENGINE_URLS` is set.
- The unique purchase index makes order replay a no-op, but whether a feature-only pack may be bought twice is checkout's rule.
