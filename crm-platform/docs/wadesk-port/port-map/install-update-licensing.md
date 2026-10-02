# Port map: install-update-licensing (INST)

WaDesk's installer, updater and licence check exist because a buyer uploads the product to shared hosting. Our
platform is deployed as containers (image + migrator), so most of the 29 features are replaced by deploy-time
mechanisms the repo already has. This map says which survive as product behaviour, which are replaced, and which
are deliberately not built. The feature ids below are from `inventory/install-update-licensing.md`.

## Decision per feature

| WD id                                             | Disposition                  | Target                                                                                                                                                                                                                                             |
| ------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 001 install gate + lock                           | **Build** (P1)               | `platform_setup` singleton row = the lock; setup endpoints refuse once it is complete **or** any platform operator exists. No filesystem marker, no `.env` writing.                                                                                |
| 002 wizard shell                                  | **Build** (P2, thin)         | One client stepper at `/setup` (token, operator, workspace, review). Every step is re-validated server-side by the single bootstrap call; no forward-jump state in a session.                                                                      |
| 003, 017, 020 Envato licence                      | **Not built**                | Not our product on CodeCanyon. No licence enforcement (inventory open question 1; recorded as a deviation).                                                                                                                                        |
| 004 requirements check                            | **Build** (P1)               | `GET /v2/setup/status` prerequisites (database reachable, migrations current, permission defs seeded) and `GET /v2/platform/system` checks (database, redis, migrations).                                                                          |
| 005, 006 database step / connection test          | **Replaced**                 | Connection comes from env (`env.schema.ts`); the readiness probe reports reachability.                                                                                                                                                             |
| 007 application basics                            | **Build** (P1)               | Organization timezone (IANA, validated server-side) and locale (BCP 47) on the bootstrap input; app URL comes from env `WEB_APP_URL`.                                                                                                              |
| 008 first super admin                             | **Build** (P0)               | First `platform_operators` row, role `super_admin`, argon2id, strict password policy, must enrol MFA at first sign-in (existing operator flow).                                                                                                    |
| 009 Node bridge step                              | **Replaced**                 | Bridge URL and shared secret are deploy-time env (NODE domain). Reported as "not checked" on the system page until NODE lands.                                                                                                                     |
| 010 install run + dispatcher                      | **Replaced**                 | One idempotent transaction (`POST /v2/setup/bootstrap`) instead of six browser-driven calls; replaying it after success is a clean 409.                                                                                                            |
| 011, 016 write `.env` / `node/.env`               | **Replaced**                 | Deploy-time env, validated at boot. Never written by the app.                                                                                                                                                                                      |
| 012 run migrations                                | **Replaced + verified** (P0) | `pnpm db:migrate` (checksum runner). Setup refuses to run while migrations are pending (`SETUP_PREREQUISITES_FAILED`).                                                                                                                             |
| 013 seed default data                             | **Build** (P0, as a check)   | Permission defs are seeded by migrations; setup verifies them (an org provisioned with zero capability keys would be a locked-out admin). Plans/currencies/gateways belong to PLAN/CPN/PAYGW; demo coupons and the default tax are **not** seeded. |
| 014 first admin, workspace, owner                 | **Build** (P0)               | `TenantDirectory.provisionOrganization` (the sanctioned door), org admin user in the same transaction, audit + outbox.                                                                                                                             |
| 015 finalize + lock                               | **Build** (P0)               | `platform_setup.completed_at` written by an atomic claim in the same transaction as the org and operator.                                                                                                                                          |
| 018 hosting docs                                  | Docs                         | `docs/api/install-update-licensing.md` describes the deploy-time contract.                                                                                                                                                                         |
| 019, 025, 027 updater screen/finalize/version     | **Build** (P1, read-only)    | `GET /v2/platform/system` + `/admin/system` page: version, build, git sha, migration ledger, health checks. No mutating update operations.                                                                                                         |
| 021-024, 026 backup/upload/apply/migrate/rollback | **Not built**                | Container image + migrator + `pg_dump`/PITR. A browser-driven code overwrite has no meaning here.                                                                                                                                                  |
| 028 update procedure doc                          | Docs                         | Forward-only migrations (already a repo rule).                                                                                                                                                                                                     |
| 029 demo guard                                    | **Build** (P1)               | Global Nest guard, env `DEMO_MODE`, default-deny writes with an exact allow-list and a `@DemoSafe()` opt-in. Covers the public API too.                                                                                                            |

## Modules

| Layer     | Path                                                                                                                                  | Contents                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| API       | `apps/api/src/modules/install-update-licensing/`                                                                                      | setup controller/service/repository, system controller/service, demo guard, release info                   |
| API env   | `apps/api/src/config/domains/install-update-licensing.env.ts`                                                                         | `SETUP_TOKEN`, `DEMO_MODE`, `GIT_SHA`, `BUILD_NUMBER`, `BUILT_AT` (parsed here; `env.schema.ts` untouched) |
| Contracts | `packages/contracts/src/install-update-licensing/`                                                                                    | setup + system schemas                                                                                     |
| Database  | `packages/db/migrations/20261003090000_inst_platform_setup.sql`, `packages/db/src/schema/install-update-licensing/`                   | `platform_setup`, `platform_migration_ledger()`                                                            |
| Web       | `apps/web/src/features/install-update-licensing/`, `src/app/(admin)/(install-update-licensing)/admin/system`, `src/app/(setup)/setup` | setup stepper, system page                                                                                 |
| Messages  | `apps/web/messages/en/install-update-licensing.json`                                                                                  |                                                                                                            |
| Tests     | `apps/api/test/{unit,integration,e2e}/install-update-licensing/`, `apps/web` unit tests next to the code                              |                                                                                                            |

## Tables

`platform_setup` (singleton, `id = 1`): `completed_at`, `completed_version`, `first_operator_id`, `first_org_id`,
`app_url`, `row_version`. Platform-wide (no `org_id`), RLS forced, policy `privileged_only` (same shape as
`platform_operators`); only reachable through `PlatformStore` / `TenantDirectory`.
`platform_migration_ledger()`: `SECURITY DEFINER` read of `_migrations` so the restricted app role can report
migration state without a grant on the runner's table.

## Endpoints

| Method + path                 | Auth                      | What                                                                         |
| ----------------------------- | ------------------------- | ---------------------------------------------------------------------------- |
| `GET /v2/setup/status`        | public                    | `{ state: open or completed, tokenConfigured, prerequisites[] }`             |
| `POST /v2/setup/verify-token` | public                    | proves the setup token before the form is filled; 403 on mismatch            |
| `POST /v2/setup/bootstrap`    | public + setup token body | creates operator + org + admin, locks setup, audit + outbox, one transaction |
| `GET /v2/platform/system`     | operator (any role)       | release, uptime, setup state, migration ledger, dependency checks            |

## Permission keys

None. Platform operators are a separate identity pool with roles (`OperatorRoles`), not tenant capability keys; the
system page is readable by every active operator, there is no mutating route. (The inventory suggested
`platform.system.manage`; it only becomes necessary if a mutating system action is ever added.)

## Prerequisites from other domains (all present)

AUTH: `OperatorGuard`, `PasswordService`, `AuthAuditService`, `PlatformStore`, `TenantDirectory` (two additive
exports, see seam edits). PLAN: `PlanEntitlementService` (called inside `provisionOrganization`). Kernel: `OutboxService`.
Web shell: operator console nav and proxies.

## Build order (as built)

1. migration + Drizzle mirror, RLS check against `crm_inst`
2. contracts + error codes
3. release info, setup input rules, token check (pure, unit tested)
4. setup service + controller; system service + controller
5. demo guard
6. integration (RLS, claim race), e2e (HTTP), unit
7. web: system page, setup stepper
8. docs

## Risks

- **First-come ownership.** Whoever reaches `/setup` first with the token owns the platform. Mitigation: the token is
  deploy-time (`SETUP_TOKEN`, 32+ chars), compared in constant time, and setup is unreachable afterwards. If
  `SETUP_TOKEN` is unset the endpoint answers 403 `SETUP_DISABLED` and operators use `operator:create`.
- **Existing environments.** An environment that already has an operator is treated as completed, so rolling this
  out never re-opens setup.
- **Demo guard is default-deny.** Domains that want a demo user to write opt a route in with `@DemoSafe()`; until they
  do the demo is read-only for them.
