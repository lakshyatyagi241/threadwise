# Merge-conflict hotspot map and skeleton-PR design

Snapshot of `main` @ `85f6513` (merge of PR #11), analysed 2026-09-30. Read-only research: nothing in the repo was modified except
this file. Companion documents: [target-map.md](target-map.md) (what the target repo already contains),
[inventory-spec.md](inventory-spec.md) (domain ids and codes), and the `wadesk-ownership-guard` skill, which consumes the zone
conventions in section 3.

Evidence is cited as `path:line` from a real read of the code. Where I ran an experiment (real migrator, real TypeScript, real
Nest, real git), it is listed in [Appendix A](#appendix-a-experiments-i-ran). Anything I could not verify is in
[section 6](#6-unverified-assumptions).

## 0. Summary

The repo is a clean modular monolith, but **every registry in it is a single hand-edited list**: modules in `app.module.ts`,
processors in `workers.module.ts`, queues in `queues.ts`, `export *` lines in two barrels, tags in `main.ts`, migration
numbers, docs tables. With one author that is fine; with three developers landing ~60 domains it means every feature PR edits
the same 10-15 files.

What git history already shows (feature commits after the scaffold that added domain code: `41ebb79`, `482e347`, `25054b5`,
`fdc7dc5`): `crm.module.ts` was edited in 4/4, and `crm/index.ts`, `packages/contracts/src/index.ts`,
`packages/db/src/schema/index.ts` and the committed `apps/api/tsconfig.tsbuildinfo` in 3/4 each. That was one author. Three
authors make each of those a merge conflict.

The fix is one skeleton PR (about 2 days, cut line marked in section 2) that:

1. **Pre-creates a shell for every domain in every layer** (Nest module, worker module, contracts folder, db schema folder, env
   fragment) and wires them into the shared registries **once**, via generated marker blocks. After that nobody edits a registry.
2. Replaces the registries that cannot be pre-created (outbox subscribers, realtime rooms) with **decorator-based
   discovery** (mechanism verified on the installed @nestjs/core), and turns queues and env vars into per-domain files
   that need no central edit.
3. Switches migrations to **timestamp names with a domain code** (`20260930153045_bsp_add_allocations.sql`). The real migrator
   accepts this with zero code change; only `db:new` needs a patch.
4. Moves docs to **one file per domain / per owner**, freezes the three global docs, and fixes the `.claude/skills/*` that
   currently instruct people to edit the hotspots (they are the most likely way the conflicts come back).
5. Removes two free foot-guns: committed `*.tsbuildinfo` files and the stale hard-coded RLS test list.

Decisions I need from the team lead before the skeleton starts are in section 2.0.

## 1. Hotspot table

Severity assumes 3 developers landing about 4 PRs each per week (about 12 PRs/week) over the port; that velocity is my
assumption, not a measured number.

- **S1**: edited by essentially every feature PR, or guaranteed to conflict. Must be fixed in the skeleton.
- **S2**: edited by most PRs of a class (async work, new provider, new enum). Fix in the skeleton.
- **S3**: occasional, or conflict is semantic (compiles but collides). Fix if cheap, otherwise a rule.
- **S4**: rare; a rule is enough.

"Step" refers to the skeleton checklist in section 2.

### 1.1 Table

| ID  | File / dir                                                                                                                                      | Why it is shared (evidence)                                                                                                                                                                                                                                                                                                                                               | Who / how often                                        | Sev | Mitigation                                                                                                                                                             | Step    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| H01 | `apps/api/src/app.module.ts:21-24,98-104`                                                                                                       | One import line + one `imports:[]` entry per module; comment at :103 tells the next dev to add `InboxModule, BroadcastModule...` here. Fan-in: this file imports every domain.                                                                                                                                                                                            | every dev, once per new domain (~60 total)             | S1  | Pre-created `modules/<domain>/<domain>.module.ts` shells + generated `domains.generated.ts`, spread into `imports`.                                                    | S6      |
| H02 | `apps/api/src/worker.ts:26-47`, `apps/api/src/workers/workers.module.ts:19`                                                                     | Worker root module hard-lists what it loads; `WorkersModule.providers` is the flat list for every processor/cron/interval (comment :14 "Still to land here: campaign sender, billing roll-up, SLA sweep...").                                                                                                                                                             | every domain with async or scheduled work              | S1  | Per-domain `<domain>.worker.module.ts` shell, generated `DOMAIN_WORKER_MODULES` spread into `WorkerModule.imports`. Processors live in the domain.                     | S6      |
| H03 | `apps/api/src/infra/queue/queues.ts:8`, `queue.module.ts:35`                                                                                    | One `QUEUES` const; `BullModule.registerQueue(...Object.values(QUEUES))` registers all of them. `worker-job` skill (:38) says "add yours there". BullMQ 5.81.5 rejects `:` in a name (`queue-base.js:35`).                                                                                                                                                                | every domain with a queue                              | S2  | Domain registers its own queues with `BullModule.registerQueue` in its own modules (verified per-module, `forRoot` is global). Names `<code>-<purpose>`.               | S7d     |
| H04 | `apps/api/src/workers/outbox-drain.service.ts:125` (`dispatch`)                                                                                 | The documented fan-out point (skill `outbox-event` :80). Today it only logs, so **zero subscribers exist**; the first consumer edits this method, the second edits the same lines.                                                                                                                                                                                        | every domain that reacts to an event (most of them)    | S1  | `@OutboxSubscriber(eventType)` decorator + registry built on `DiscoveryService` (verified working on the installed @nestjs/core 11.2.5). Kernel edits `dispatch` once. | S7a     |
| H05 | `apps/api/src/realtime/realtime.gateway.ts:14-19,76`                                                                                            | Room layout (`org`, `user`, `conv`) and `emitToConversation` are hard-coded in the gateway; no `@SubscribeMessage` exists, so the documented explicit room join is not implemented.                                                                                                                                                                                       | inbox, broadcast, notifications, any live view         | S2  | Generic `room:join` + `@RealtimeRoom(prefix)` handler discovered like outbox subscribers; `emitToRoom(prefix, ...)`.                                                   | S7b     |
| H06 | `apps/api/src/config/env.schema.ts:18-100,121-137`; `.env.example`; `.github/workflows/ci.yml:66-71`                                            | One `z.object` for every env var; prod guard rails in one function; a **required** var also has to appear in `.env.example` and the CI `env:` block or boot/CI fails.                                                                                                                                                                                                     | domains with provider keys or flags                    | S2  | Per-domain `config/domains/<domain>.env.ts` shape objects spread into the schema (pre-created). Rule: optional or defaulted only.                                      | S7c     |
| H07 | `apps/api/src/main.ts:48-66`                                                                                                                    | `.addTag()` chain. Verified: `DocumentBuilder.addTag` only appends to `document.tags` (order/description); routes get their tag from `@ApiTags` and are hidden by `@ApiExcludeController()` (`swagger-explorer.js:80`). The phase-plan gating recipe says to do both (exclude the controller and leave the tag out); only the decorator has any effect. 4 touches so far. | every domain when its phase completes                  | S3  | Delete the chain, use `swaggerOptions: { tagsSorter: 'alpha' }`. Gating stays in each controller file.                                                                 | S6      |
| H08 | `apps/api/src/infra/providers/providers.module.ts:13`                                                                                           | Global module listing every adapter by class; `provider-adapter` skill (:54) says "Bind it in providers.module.ts".                                                                                                                                                                                                                                                       | BSP, SMS, email, payment-gateway domains               | S3  | Adapter + port under `infra/providers/<domain>/`, bound in the domain's own module (not global). Existing WhatsApp binding stays.                                      | S6, S9  |
| H09 | `apps/api/src/health/health.controller.ts`                                                                                                      | Three fixed dependency checks. No per-domain need found.                                                                                                                                                                                                                                                                                                                  | none expected                                          | S4  | Leave kernel-owned. A domain that needs a probe exposes `GET /v2/<routeBase>/health` in its own controller.                                                            | none    |
| H10 | `apps/api/src/modules/crm/crm.module.ts:52-103`, `crm/index.ts:1-70`                                                                            | One Nest module with 10 controllers, 22 providers, 11 exports and a 70-line barrel. Touched by 4/4 feature commits. The arch rule treats all of `modules/crm/*` as one module, so no isolation inside it (see H35).                                                                                                                                                       | anyone extending contacts/companies                    | S2  | Legacy area: one owner for `modules/crm/**`. New domains never register into `CrmModule`. Split it only if two devs must work in CRM simultaneously.                   | S9      |
| H11 | `apps/api/src/workers/partition-maintenance.service.ts:7`                                                                                       | `PARTITIONED_TABLES = ['event_outbox','audit_log']` ("Add new ones here the day they are created"). Stream tables (messages, campaign_recipients, usage_charges) need to be added.                                                                                                                                                                                        | high-volume domains                                    | S3  | Discover partitioned parents from `pg_partitioned_table` instead of a constant. `ensure_monthly_partition()` (0001:60) is already generic.                             | S4      |
| H12 | `apps/api/src/kernel/**`, `common/**`, `infra/db/**`                                                                                            | Import fan-in measured with dependency-cruiser: `request-context.ts` 26 importers, `app-error.ts` 25, `database.service.ts` 22, `decorators/index.ts` 20. Closed unions: `ActorType` (`request-context.ts:4`), `AuditInput.action` (`audit.service.ts:11`).                                                                                                               | kernel steward; occasionally a domain wanting a member | S3  | Kernel protocol (section 4): additive only, own PR, reviewer named.                                                                                                    | sec. 4  |
| H13 | `packages/contracts/src/index.ts:11-26`                                                                                                         | Flat list of 16 `export *` lines; **no per-folder `index.ts` exists**, so every new contracts file needs a line here. 3/4 feature commits touched it.                                                                                                                                                                                                                     | every dev, every domain                                | S1  | Per-domain `packages/contracts/src/<domain>/index.ts` shell; root barrel gets one generated marker block, written once.                                                | S5      |
| H14 | `packages/contracts/src/common/errors.ts:7`, `common/enums.ts:70`                                                                               | `ERROR_CODES` const feeds the `ErrorCode` type that `AppError` requires; `moduleKeySchema` is a closed enum; PG enum mirrors live here (runbook: mirror in the same commit).                                                                                                                                                                                              | any domain with its own errors/enums                   | S2  | `DomainErrorCodes` interface merged from `<domain>/errors.ts` (verified to compile with the repo tsconfig). Enum mirrors live in the domain folder.                    | S5      |
| H15 | flat `export *` namespace in `@crm/contracts` and `@crm/db` (`export * as schema`, `packages/db/src/index.ts:3`)                                | Two domains exporting the same name compile as TS2308 **at the shared barrel** (verified), i.e. after both merge, blaming a file nobody owns. Also `client.ts:23` types `Database` over the whole schema, so one broken schema file breaks every build.                                                                                                                   | all                                                    | S2  | Naming rule: exported names start with the domain code; `domains:check` greps for it. Optional `export * as` for new domains.                                          | S4, S5  |
| H16 | `packages/db/src/schema/index.ts:11-19`                                                                                                         | Same flat `export *` list, 3/4 feature commits. Files are grouped per domain (`crm.ts`, `partner.ts`, `field-metadata.ts`...), not per table.                                                                                                                                                                                                                             | every dev, every domain                                | S1  | `schema/<domain>/index.ts` shells + generated marker block.                                                                                                            | S4      |
| H17 | `packages/db/src/schema/enums.ts`, `columns.ts`                                                                                                 | Central `pgEnum` file (5 enums). `columns.ts` is a legitimate shared kernel helper file.                                                                                                                                                                                                                                                                                  | domains adding a PG enum                               | S3  | Domain enums live in `schema/<domain>/`; `columns.ts` is kernel (additive only).                                                                                       | S4      |
| H18 | `packages/db/migrations/` naming: `packages/db/src/cli/migrate.ts:72-75`, `migrator.ts:40-42,98`                                                | `db:new` = highest existing number + 1. Runner sorts by filename and applies any file **not already in `_migrations`, wherever it sorts**. Verified: two branches both get `0020_`, no git conflict, but slug order decides the fresh-DB order, and `db:status` never flags out-of-order files.                                                                           | every dev, every table                                 | S1  | `YYYYMMDDHHmmss_<code>_<name>.sql`, `db:new <code> <name>`, `db:lint` (monotonic vs base, code prefix, RLS present).                                                   | S2      |
| H19 | permission migrations `0008:55`, `0011`, `0015`, `0018`                                                                                         | Registration is SQL (`INSERT INTO permission_defs ... ON CONFLICT (key) DO UPDATE`). A key clash between two domains **silently overwrites the other's label/category/scope**. No TS enum exists: keys are string literals in `@RequirePermission('...')`.                                                                                                                | any domain with routes                                 | S3  | Keys `<code>.<resource>.<action>`, own migration file `<ts>_<code>_permissions*.sql`, `db:lint` checks the prefix. Keep literal keys (scan.sh greps them, see S9).     | S2, S9  |
| H20 | `packages/db/src/cli/seed.ts:80,99-109`                                                                                                         | One 205-line seed. Admin gets every key via `SELECT key FROM permission_defs`; Counsellor's 5 grants are hard-coded.                                                                                                                                                                                                                                                      | any domain wanting demo data or role defaults          | S2  | `packages/db/src/seeds/<domain>.ts` files loaded by `readdir` (no registry), passed org/role ids.                                                                      | S4      |
| H21 | `apps/api/test/integration/rls.spec.ts:163`                                                                                                     | RLS assertion hard-codes 6 table names, so a new tenant table is not covered unless someone edits the list.                                                                                                                                                                                                                                                               | every new table                                        | S3  | Query every table with an `org_id` column instead.                                                                                                                     | S3      |
| H22 | `packages/db/README.md:17` ("Migrations applied today"), `docs/db/README.md:19`, `docs/*.dbml`                                                  | Hand-maintained tables. The first is already stale (stops at 0008; 0019 exists).                                                                                                                                                                                                                                                                                          | anyone adding a migration                              | S3  | Delete the table (point at `pnpm db:status`); per-domain schema notes go in the inventory "Data model" section.                                                        | S8      |
| H23 | `apps/api/tsconfig.tsbuildinfo`, `apps/api/tsconfig.build.tsbuildinfo` (tracked, 385 KB each)                                                   | Build caches are committed (`git ls-files`), `.gitignore` has no `*.tsbuildinfo`, `tsconfig.base.json:26` sets `incremental`. Every typecheck rewrites them; touched by 3/4 feature commits.                                                                                                                                                                              | every dev, every PR that ran typecheck                 | S1  | `git rm --cached` + ignore. Free.                                                                                                                                      | S1      |
| H24 | `pnpm-lock.yaml` (365 KB), `apps/api/package.json`                                                                                              | Every `pnpm add` edits both; `importers:` blocks are per package but `packages:`/`snapshots:` are one alphabetical list. The API is one package, so all three devs edit the same `dependencies` block.                                                                                                                                                                    | any dev adding a dependency                            | S2  | Pre-install the dependency set the inventory implies; deps lane; regenerate-not-merge rule (section 5).                                                                | S2, S10 |
| H25 | `commitlint.config.cjs:4-27`                                                                                                                    | `scope-enum` lists 22 fixed scopes at warn level (1); CONTRIBUTING lists a different set (no `skills`). ~60 new scopes would warn on every commit.                                                                                                                                                                                                                        | every commit                                           | S4  | Turn `scope-enum` off, require kebab-case.                                                                                                                             | S1      |
| H26 | `.github/workflows/ci.yml`, `apps/api/Dockerfile:22-25`, `docker-compose.yml`, `turbo.json`                                                     | Dockerfile `COPY`s each workspace `package.json` by name; a new workspace package breaks the image until added. CI `env:` needs every required var.                                                                                                                                                                                                                       | kernel; web move-in                                    | S3  | Kernel-owned. Rule: no new workspace packages without a kernel PR; web part updates the Dockerfile once.                                                               | S10, B  |
| H27 | `.github/` has no `CODEOWNERS`; PR template has no ownership item                                                                               | Nothing tells GitHub who must review what.                                                                                                                                                                                                                                                                                                                                | all                                                    | S3  | Generated CODEOWNERS from the ownership manifest.                                                                                                                      | S1, S6  |
| H28 | `.claude/skills/*`: `new-module:181`, `worker-job:38,60`, `provider-adapter:54`, `add-migration:25`, `rbac-permission:43-46`, `outbox-event:80` | The skills tell an agent (or dev) to edit exactly the hotspot files above. `new-module:117` also shows `version: '1'` while every real controller uses `'2'`.                                                                                                                                                                                                             | every agent-assisted PR                                | S1  | Rewrite the skills listed in S9. Otherwise the conflicts return.                                                                                                       | S9      |
| H29 | `docs/api-inventory.md` (78 KB), `docs/api-testing.md` (55 KB), `docs/phase-plan.md`                                                            | `README.md:72,78` and `api-inventory.md:9` say to update the first two "whenever a phase lands / a new endpoint ships"; phase-plan has the status table (`:18`) and Swagger-gating rules. phase-plan was touched 5 times, the most of any doc. Not enforced by CI, purely convention.                                                                                     | any dev finishing an endpoint                          | S2  | Freeze the three files (legacy pages 1-28); new work uses `docs/api/<domain>.md`.                                                                                      | S8      |
| H30 | `docs/README.md:26-50` (ADR index), `:72-82`                                                                                                    | One table of ADRs; `adr-guard.sh` checks that every ADR file has a row here. Two ADRs added the same week both append at the end of the table.                                                                                                                                                                                                                            | ADR authors                                            | S3  | Per-owner subsections (verified: git merges those cleanly, same-section appends conflict).                                                                             | S8      |
| H31 | `.claude/skills/write-adr/scripts/new-adr.sh:16-21`                                                                                             | Next number = highest existing + 1, so two ADRs written in parallel get the same number (different slug = no git conflict, duplicate numbers).                                                                                                                                                                                                                            | ADR authors                                            | S3  | Per-owner number blocks via `ADR_BLOCK_START`.                                                                                                                         | S8      |
| H32 | `docs/architecture/rbac.md:116`, `docs/runbooks/migrations.md:22`                                                                               | Stale guidance: "add the key to 0008" (contradicts immutability); `db:new` "creates 0009\_...". `local-development.md:83` already says "timestamped".                                                                                                                                                                                                                     | readers                                                | S4  | Fix wording in S8/S9.                                                                                                                                                  | S8, S9  |
| H33 | `docs/wadesk-port/inventory/*.md`, `port-map/*.md`, `tracker/<owner>.md`                                                                        | Already one file per domain / per owner. **Not a hotspot.** But at the time of writing 11 new markdown files under `docs/wadesk-port` and the wadesk skills fail `pnpm format:check` (measured).                                                                                                                                                                          | authors                                                | S3  | `.prettierignore` the inventory dirs or run `prettier --write` once.                                                                                                   | S1      |
| H34 | Global-vs-tenant helper lists                                                                                                                   | No code list of tenant tables exists (`tenant.ts` has none). RLS is per-migration; 0007's `tenant_tables` array only covers tables from 0003-0006. `check-rls.sh` takes table names as arguments.                                                                                                                                                                         | n/a                                                    | S4  | None needed beyond H21.                                                                                                                                                | none    |
| H35 | Arch rule granularity, `apps/api/.dependency-cruiser.cjs:24-33`                                                                                 | `no-cross-module-internals` uses the **first path segment** under `modules/` as "the module". Two domains nested under one dir (`modules/billing/reseller`, `modules/billing/wallet`) are one module to the checker, so their isolation is unenforced.                                                                                                                    | every domain                                           | S2  | Convention: **flat**, one top-level dir per domain under `modules/`.                                                                                                   | S6      |
| H36 | Future `apps/web`, `apps/partner` (READMEs only)                                                                                                | Not built. Precedent in the sibling repo `geta-platform-v1/apps/web`: nav lists hard-coded in three shell files (`agent-sidebar.tsx`, `global-icon-rail.tsx`, `mobile-nav-drawer.tsx`), a `middleware.ts`, and a `packages/ui/src/index.ts` barrel. These would each become hotspots.                                                                                     | all three, from day one of web work                    | S1  | Seams designed in Part B (route groups, feature folders, generated nav registry, per-domain i18n files, kernel api client).                                            | B       |

### 1.2 Direct answers to the brief

- **How is a backend module registered? Import fan-in?** `apps/api/src/app.module.ts` imports the module class directly
  (`:21-24`) and lists it in `imports` (`:98-102`). `partner`, `public-api` import `CrmModule` through `modules/crm/index.ts`
  (`partner.module.ts:2`, `public-api.module.ts:3`). Measured fan-in: 54 of 120 API source files import `@crm/contracts`, 23
  import `@crm/db`; the top internal targets are `request-context.ts` (26), `app-error.ts` (25), `database.service.ts` (22),
  `common/decorators/index.ts` (20). Only `CrmModule` and `AdminModule` have barrels of sub-barrels.
- **Swagger tags/gating.** `main.ts:48-66`: the tag chain is cosmetic; gating is `@ApiExcludeController()` on
  `users`/`roles`/`permissions` controllers only. Swagger is mounted only when `NODE_ENV !== 'production'` (`main.ts:38`).
- **Worker queue/processor registration.** None exists yet: no `@Processor`, `InjectQueue`, `Queue.add` or `Worker` in
  `apps/api/src`. `queue.module.ts:35` registers every `QUEUES` value in both processes. `worker.ts` loads only infra, kernel
  and `WorkersModule` (`:26-47`). `WORKER_MODE` is defined in `env.schema.ts:34` and never read.
- **Outbox handler registry.** None. `OutboxDrainService.dispatch()` (`:125`) logs and returns; it runs inside the drain's
  privileged transaction (`drainBatch`), so a heavy subscriber would hold that transaction open.
- **Realtime.** Rooms are a doc comment plus `emitToUser`/`emitToConversation`; nothing emits and there is no join handler.
  The worker cannot emit to sockets (no `@socket.io/redis-emitter` in `apps/api/package.json`).
- **Config/env.** One Zod object (`env.schema.ts:18-100`); validated at boot via `validateEnv`.
- **Health.** `HealthController` (`/health` liveness, `/ready` readiness for primary/replica/redis), no registry.
- **Contracts.** Barrel only at `src/index.ts`. Build order: `@crm/contracts` (tsc) and `@crm/db` (tsc) then `@crm/api`
  (`turbo.json` `dependsOn: ["^build"]`; CI builds contracts then db first). The API imports `dist/`, so a new schema is
  invisible until `pnpm --filter @crm/contracts build` (or `pnpm --filter @crm/contracts dev`, which is `tsc --watch`).
  **Yes, adding a schema today requires editing a shared file** (the barrel).
- **DB.** One schema file per domain group, one shared barrel. Migrations: `packages/db/migrations`, highest is `0019`, names
  `NNNN_slug.sql`; runner behaviour in H18. Seeds: one file. Global (non-RLS) tables: only `permission_defs`.
- **Permissions.** SQL-migration based, one file per feature (`0011`, `0015`, `0018`), no central TS enum, no role default
  grants in migrations. Dev seed gives Admin all keys and Counsellor 5 keys. A trigger (`protect_locked_role`,
  `0003_foundation.sql:134-153`) refuses any grant change on a locked role, so how a **production** org's Admin role gets a new
  key is undefined in the repo (see 2.0 D4).
- **Shared docs every PR "must" edit.** `api-inventory.md`, `api-testing.md`, `phase-plan.md`, `docs/README.md` (ADR index),
  `packages/db/README.md`, `docs/db/README.md`. CONTRIBUTING and `pre-pr`/`gate.sh` require **none** of these; `gate.sh` runs
  format, lint, typecheck, arch, unit, and conditionally db/integration. `adr-guard.sh` checks only ADR files against the
  `docs/README.md` index, at WARN level, and is **not** run in CI (`ci.yml`) or by `gate.sh`. So every docs collision is
  convention-driven (docs README, skills), which is why the fix is convention plus skills, not CI.
- **CI / deps / infra.** CI: `static` (format, lint, typecheck, arch) and `test` (db:migrate from scratch, db:status, unit,
  integration) and `build` (docker). Nothing checks docs, ownership or migration naming.

## 2. Skeleton PR spec

### 2.0 Inputs and decisions needed first

| #   | Decision / input                                                                                                                                                                                                                                       | Recommendation                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | The domain manifest: for every domain `id` (kebab, from `inventory/`), `code` (`^[a-z][a-z0-9]{1,11}$`, unique), `owner`, `routeBase` (unique first URL segment, default = id), `webRoute`. The sibling skill reads `docs/wadesk-port/ownership.json`. | Extend `ownership.json` `domains.<id>` with `code`/`routeBase`; the generator reads it, so there is one source of truth. Reserve `core` (kernel). Legacy prefixes `crm`, `inbox`, `broadcast`, `billing`, `exam`, `partner`, `admin`, `record` go to the successor domain. |
| D2  | Migration ordering scheme.                                                                                                                                                                                                                             | Timestamp + code (section 2 S2). Alternative (owner number blocks) rejected: fresh-DB order becomes "all of A, then all of B" and cross-owner FKs silently depend on block order.                                                                                          |
| D3  | How a worker job pushes to sockets (the gateway lives only in the API process).                                                                                                                                                                        | Add `@socket.io/redis-emitter` in the kernel PR that introduces the room registry; not in the skeleton.                                                                                                                                                                    |
| D4  | How real orgs' locked Admin role receives new permission keys.                                                                                                                                                                                         | Kernel ADR before the first permission ships to a real tenant (treat `system_key='admin'` as allow-all in `RbacService`, or an unlock/grant/lock migration helper). Dev seed already covers local.                                                                         |
| D5  | Super-admin actor kind. `ActorType` (`request-context.ts:4`) has no platform-admin; several inventory domains are admin-console features.                                                                                                              | Decide before admin domains start; it is a K1 kernel change (guards, contracts, token claims).                                                                                                                                                                             |
| D6  | Which Next.js app moves into `apps/web`, its Next version and i18n library.                                                                                                                                                                            | Part B is written library-agnostic; confirm before starting it.                                                                                                                                                                                                            |
| D7  | GitHub settings: CODEOWNERS enforcement, "require branch up to date", merge queue.                                                                                                                                                                     | Turn on (repo settings, not verifiable from here).                                                                                                                                                                                                                         |

Before starting, announce a **short freeze**: no PR that touches a file listed in section 1 merges until the skeleton lands.
Other work in that window should touch only new files.

### 2.1 Part A: backend, db, contracts, docs, tooling (about 15 h; one dev, 2 days)

Order matters: S1-S3 are independent quick wins; S4-S6 depend on the manifest; S7-S9 depend on S6; S10 closes.

New commands this PR creates (they do **not** exist today): `pnpm domains:sync`, `pnpm domains:check`, `pnpm db:lint`.
Commands that exist today and are used for verification: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`,
`pnpm arch:check`, `pnpm test`, `pnpm test:integration`, `pnpm db:migrate`, `pnpm db:status`,
`pnpm --filter @crm/contracts build`, `pnpm --filter @crm/db build`, `pnpm --filter @crm/api build`,
`bash .claude/skills/pre-pr/scripts/gate.sh`, `bash .claude/skills/adr-diff-guard/scripts/adr-guard.sh`.

#### S1. Repo hygiene (0.5 h) — removes H23, H25, H27, H33

```bash
git rm --cached apps/api/tsconfig.tsbuildinfo apps/api/tsconfig.build.tsbuildinfo
printf '\n# TypeScript incremental caches, rewritten by every typecheck/build\n*.tsbuildinfo\n' >> .gitignore
printf 'pnpm-lock.yaml linguist-generated=true\n' > .gitattributes   # collapses the lockfile in the GitHub PR view
```

`commitlint.config.cjs`: replace the `scope-enum` rule (level 1, 22 entries) with

```js
'scope-enum': [0],
'scope-case': [2, 'always', 'kebab-case'],   // scopes are the domain ids/codes now
```

`.prettierignore`: add `docs/wadesk-port/inventory/` and `docs/wadesk-port/port-map/` (huge, reflowed tables, authored by tools),
or run `pnpm exec prettier --write docs/wadesk-port .claude/skills` once. `.github/PULL_REQUEST_TEMPLATE.md`: add
`- [ ] Only files in my ownership zones changed (or the kernel PR protocol was followed)`,
`- [ ] Migration is named by db:new and passes db:lint`, `- [ ] No shared doc/barrel edited by hand`. Add the CODEOWNERS
template (generated in S6).

Verify: `git ls-files | grep -c tsbuildinfo` prints `0`; `pnpm typecheck` then `git status --short` shows no tracked change;
`pnpm format:check` passes.

#### S2. Migration naming and lint (2 h) — removes H18, H19 (naming half)

Why this is safe (verified with the real `loadMigrations`, Appendix A.1): the runner takes `readdirSync(dir)`, keeps `*.sql`,
`.sort()`s, uses the stem as the `_migrations.id` (a `text` primary key), and applies any file not yet recorded. Any file name
works; 14-digit stamps sort after every `00NN_` legacy file. **The runner needs no change.** The only code that assumes
numbering is `db:new` (`migrate.ts:72-75` parses the first 4 characters of the last file).

Patch `packages/db/src/cli/migrate.ts` `case 'new'`:

```ts
case 'new': {
  const [code, ...words] = rest;
  const name = words.join('_').replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
  if (!code || !/^[a-z][a-z0-9]{1,11}$/.test(code) || !name) {
    console.error('usage: pnpm db:new <code> <name>   e.g. pnpm db:new bsp add_allocations   (kernel: core)');
    process.exit(1);
  }
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14); // UTC yyyymmddhhmmss
  const id = `${stamp}_${code}_${name}`;
  const path = join(MIGRATIONS_DIR, `${id}.sql`);
  writeFileSync(path, `-- ${id}\n-- Why this migration exists (not what it does; the SQL says that):\n--\n` /* + existing header */);
  console.log(`created ${path}`);
  break;
}
```

Add `packages/db/src/cli/lint-migrations.ts` (tsx; `"lint:migrations": "tsx src/cli/lint-migrations.ts"` in
`packages/db/package.json`, root script `"db:lint": "pnpm --filter @crm/db lint:migrations"`). It checks files **added vs the
base ref** (`--base origin/main`, default; committed, staged or untracked) and always checks the whole directory for shape:

1. Name matches `^(\d{4}|\d{14})_[a-z0-9_]+\.sql$`; any **new** file must be the 14-digit form (no new `00NN_`).
2. New stamp is greater than the greatest stamp on base (`git ls-tree -r --name-only <base> packages/db/migrations`). Failure
   message: "older than a migration already on main; `git mv` it with a fresh stamp after rebasing".
3. Token 2 (`<code>`) is in the manifest (or `core`).
4. Every `CREATE TABLE|TYPE|FUNCTION|INDEX` name in the file starts with `<code>_` (indexes: `idx_<code>_` or `<code>_`).
   Index, type and function names are schema-global in Postgres, so this is what prevents two domains colliding on
   `idx_status` after both merge. `core` is exempt.
5. Every `CREATE TABLE x` has `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY` and `CREATE POLICY` for `x`, or the file
   contains `-- @global-table x`.
6. Every literal key in an `INSERT INTO permission_defs` tuple starts with `<code>.` and its `category` equals `<code>`.
   (Literals stay quoted so `scan.sh` L51, which greps `'key'` in `migrations/*.sql`, still finds them. **Do not move
   migrations into subdirectories**: that glob is not recursive.)

Why not per-domain subdirectories: would need a runner change plus `scan.sh:51` and every skill that globs the directory.
Why not owner number blocks: see D2.

Verify: `pnpm db:new bsp add_probe` creates a 14-digit file; `pnpm db:lint` passes on it and fails on a hand-made
`0020_x.sql`; `pnpm db:migrate && pnpm db:status` are clean; delete the probe.

#### S3. Generic RLS coverage test (0.5 h) — removes H21

In `apps/api/test/integration/rls.spec.ts` replace the `relname IN (...)` query (`:163`) with every non-partition tenant
table, keep the `>= 6` sanity floor:

```sql
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
       (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname) AS policies
FROM pg_class c
WHERE c.relkind IN ('r','p') AND c.relnamespace = 'public'::regnamespace AND NOT c.relispartition
  AND EXISTS (SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = c.oid AND a.attname = 'org_id' AND NOT a.attisdropped)
```

Expect `[true, true]` and `policies >= 1` for every row; add `organizations` by name (it is keyed by `id`, not `org_id`, so the predicate misses it). Verify: `pnpm test:integration` (needs Docker/testcontainers).
If partition parents behave differently than assumed the failure is immediate and local.

#### S4. DB seams (1.5 h) — removes H11, H15 (db half), H16, H17, H20

- `packages/db/src/schema/<domain>/index.ts` for every domain (`export {};`). Root barrel gets a **marker block**, written by
  the generator (S6), never by hand:

  ```ts
  // <domains:begin> generated by `pnpm domains:sync`; do not edit
  export * from './bsp-billing-engine';
  // <domains:end>
  ```

  Naming rule (checked by `domains:check`): exported table/enum variables start with the domain code (`bspAllocations`);
  PG names start with `bsp_`. Verified: duplicates across `export *` are TS2308 at the barrel, after the merge.

- `packages/db/src/seeds/` (empty dir with `.gitkeep`) and in `seed.ts`, after the per-org core block (`seed.ts:~183`):

  ```ts
  const seedsDir = resolve(__dirname, '../seeds');
  const files = readdirSync(seedsDir)
    .filter((f) => f.endsWith('.ts') && !f.startsWith('_'))
    .sort();
  for (const f of files) {
    const mod = await import(join(seedsDir, f));
    if (typeof mod.seed === 'function') {
      await mod.seed({
        client,
        orgId,
        orgSlug: org.slug,
        adminUserId,
        adminRoleId,
        counsellorRoleId,
      });
    }
  }
  ```

  A domain seed can grant its own keys to the Counsellor preset (it is not locked; only Admin is). Admin already gets every
  key via `SELECT key FROM permission_defs` (`seed.ts:80`), so domain seeds never touch Admin.

- `partition-maintenance.service.ts:7`: replace the constant with a catalogue query (`ensure_monthly_partition` is generic,
  `0001_extensions.sql:60`):

  ```sql
  SELECT c.relname FROM pg_partitioned_table p JOIN pg_class c ON c.oid = p.partrelid
  WHERE c.relnamespace = 'public'::regnamespace AND p.partstrat = 'r'
  ```

  Keep the `<table>_default` convention (copy `0006_outbox_audit.sql` for any stream table, as the skill says).

Verify: `pnpm --filter @crm/db build`, `pnpm db:reset` (loads the empty seeds dir), `pnpm dev:worker` logs
`partitions ensured` with both existing tables.

#### S5. Contracts seams (1 h) — removes H13, H14, H15 (contracts half)

- `packages/contracts/src/<domain>/index.ts` for every domain (`export {};`) plus the same marker block in
  `packages/contracts/src/index.ts`. Add a `domains:check` rule: every directory under `src/` other than `common` must be in
  the block.
- Error codes without touching `common/errors.ts` again. One change to `common/errors.ts`:

  ```ts
  export type CoreErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
  /** Domains add codes by merging into this interface from `<domain>/errors.ts`. */
  export interface DomainErrorCodes {}
  export type ErrorCode = CoreErrorCode | DomainErrorCodes[keyof DomainErrorCodes];
  ```

  and per domain (owner creates it inside their own folder and adds `export * from './errors';` to their own `index.ts`):

  ```ts
  export const BSP_ERROR_CODES = { BSP_QUOTA_EXCEEDED: 'BSP_QUOTA_EXCEEDED' } as const;
  declare module '../common/errors' {
    interface DomainErrorCodes {
      bsp: (typeof BSP_ERROR_CODES)[keyof typeof BSP_ERROR_CODES];
    }
  }
  ```

  Verified with the repo's `tsconfig.base.json` and TypeScript: compiles, survives into the `.d.ts`, and a typo such as
  `'BSP_QUOTA_EXCEEDDD'` is a type error. `AppError` (`app-error.ts:15`) needs no change.

- Per-domain subpath exports for the web (optional, additive): in `packages/contracts/package.json` add
  `"./*": { "types": "./dist/*/index.d.ts", "default": "./dist/*/index.js" }` to `exports`. **Verified pitfalls:** under the
  API's `moduleResolution: node` the subpath does not resolve, and a catch-all `typesVersions` breaks the root import too.
  So: API keeps `import ... from '@crm/contracts'`; the web (Next `moduleResolution: bundler`) imports
  `@crm/contracts/<domain>` so each page does not bundle 60 domains' zod schemas (the package is CommonJS, so bundlers cannot
  tree-shake the root barrel; expected but not measured).
- Rule: `moduleKeySchema`/`common/enums.ts` are kernel; a domain's enum mirror lives in `<domain>/`.

Verify: `pnpm --filter @crm/contracts build && pnpm --filter @crm/api typecheck` (`typecheck` script exists in `apps/api`),
plus a scratch import of a domain error code in `apps/api`.

#### S6. API domain shells, generator, registries (3 h) — removes H01, H02, H07, H08, H35, H27

Per domain (`<Domain>` = PascalCase of the id), the generator creates **if missing, never overwriting**:

```
apps/api/src/modules/<domain>/index.ts
apps/api/src/modules/<domain>/<domain>.module.ts
apps/api/src/modules/<domain>/<domain>.worker.module.ts
apps/api/src/config/domains/<domain>.env.ts            (S7c)
packages/contracts/src/<domain>/index.ts               (S5)
packages/db/src/schema/<domain>/index.ts               (S4)
```

```ts
// <domain>.module.ts  (HTTP process)
@Module({ controllers: [], providers: [], exports: [] })
export class BspBillingEngineModule {}

// <domain>.worker.module.ts  (worker process only: processors, @Cron/@Interval, @OutboxSubscriber classes)
@Module({ imports: [], providers: [] })
export class BspBillingEngineWorkerModule {}

// index.ts  (the domain's ONLY public surface; other domains import from here, nowhere else)
export { BspBillingEngineModule } from './bsp-billing-engine.module';
export { BspBillingEngineWorkerModule } from './bsp-billing-engine.worker.module';
```

Rules baked into the shells' header comment: the worker module **re-declares** the services/repositories it needs as its own
providers and never imports the HTTP module (importing it would also instantiate its controllers in a process that has no
guards; not verified safe, so the design avoids it). Dependency-cruiser sees `modules/<domain>/` as one module only because
each domain is a top-level dir (H35).

Generated `apps/api/src/domains.generated.ts` (whole file, formatted with prettier by the generator):

```ts
// GENERATED by `pnpm domains:sync` from docs/wadesk-port/ownership.json. Do not edit.
import { BspBillingEngineModule, BspBillingEngineWorkerModule } from './modules/bsp-billing-engine';
export const DOMAIN_MODULES = [BspBillingEngineModule /* ... */];
export const DOMAIN_WORKER_MODULES = [BspBillingEngineWorkerModule /* ... */];
```

Wire it once: `app.module.ts` `imports: [..., AdminModule, CrmModule, PartnerModule, PublicApiModule, ...DOMAIN_MODULES]`
(delete the comment at `:103-104`), and `worker.ts` `imports: [..., WorkersModule, ...DOMAIN_WORKER_MODULES]`. It is a plain
static list because the alternative, discovering `*.module.ts` files at runtime with `readdirSync`/`require`, would be
invisible to dependency-cruiser (it resolves static imports, so the modules would look orphaned and their boundaries
unchecked), needs `.ts`/`.js` handling between `dist/` and vitest, and is not typechecked. The list
is generated, so nobody edits it, and `domains:check` proves it is current.

`main.ts`: delete the `.addTag()` chain (`:48-66`), keep `.addBearerAuth()`, and add
`swaggerOptions: { persistAuthorization: true, tagsSorter: 'alpha' }` (`SwaggerUiOptions` is `[key: string]: any`, verified).
Update the phase-plan wording in S8: gating is `@ApiExcludeController()` only.

Generator: `apps/api/src/tools/domains.ts` (TypeScript so it is covered by the existing `apps/api` eslint/tsc/`no-console`
override, `eslint.config.mjs:63`; run with `tsx`, already an api devDependency). Scripts in `apps/api/package.json`:
`"domains:sync": "tsx src/tools/domains.ts sync"`, `"domains:check": "tsx src/tools/domains.ts check"`, root aliases
`pnpm domains:sync|check`. `sync` (idempotent): create missing shells, rewrite `domains.generated.ts`, the marker blocks in
the two barrels and `env.schema.ts`, `.github/CODEOWNERS`; run `pnpm exec prettier --write` on what it touched. `check`:
recompute and diff, plus these validations, exit 1 with file and reason:

- ids/codes/`routeBase` unique and well-formed; `code` not reserved;
- every `@Controller({ path })` first segment under `modules/<domain>/` equals that domain's `routeBase` (legacy
  `crm|admin|auth|partner|public-api` grandfathered to their successor);
- every `@RequirePermission('literal')` under `modules/<domain>/` starts with `<code>.` (legacy exempt);
- exported contracts/schema identifiers start with the code (regex on `export const|type|function|class|interface`);
- queue names in `BullModule.registerQueue`/`@Processor` literals match `^<code>-[a-z0-9-]+$`;
- no file outside a domain's own dir imports another domain's non-barrel path (same as `arch:check`, faster message).

Verify: `pnpm domains:sync` twice (second run is a no-op); `pnpm domains:check`; `pnpm arch:check` (baseline today: passes with
1 orphan warning); `pnpm --filter @crm/api build`; `pnpm dev` then `curl localhost:3000/health`, `/ready`, open `/docs`;
`pnpm dev:worker` boots. Review effort: review the generator and one sample domain, not the ~360 generated files.

#### S7. Kernel extension points (3 h)

These are kernel changes made once, with the ADR in S8. Each replaces an "edit the list" instruction with "decorate your class".

**S7a. Outbox subscribers — removes H04.** New `apps/api/src/kernel/outbox/outbox-subscriber.ts`:

```ts
export const OutboxSubscriber = DiscoveryService.createDecorator<{ eventType: string }>(); // exact or 'prefix.*'
export interface OutboxHandler {
  handle(event: OutboxEvent): Promise<void>;
}

@Injectable()
export class OutboxSubscriberRegistry implements OnModuleInit {
  constructor(@Inject(DiscoveryService) private readonly discovery: DiscoveryService) {}
  onModuleInit() {
    for (const w of this.discovery.getProviders({ metadataKey: OutboxSubscriber.KEY })) {
      const meta = this.discovery.getMetadataByDecorator(OutboxSubscriber, w);
      /* index w.instance by meta.eventType */
    }
  }
  async dispatch(event: OutboxEvent): Promise<void> {
    const results = await Promise.allSettled(
      this.match(event.eventType).map((h) => h.handle(event)),
    );
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length)
      throw new AggregateError(
        failed.map((f) => (f as PromiseRejectedResult).reason),
        `${failed.length} outbox subscriber(s) failed for ${event.eventType}`,
      );
  }
}
```

`WorkersModule` imports `DiscoveryModule` (exported by `@nestjs/core`, verified) and provides the registry;
`OutboxDrainService` injects it and `dispatch(row)` becomes `await this.subscribers.dispatch(toEvent(row))`. A failing
subscriber makes the drain retry the whole event with the existing backoff and dead-letter (`drainBatch` catch path), so
**every subscriber must be idempotent** (already the rule in the skill). Because `dispatch` runs inside the drain's privileged
transaction, subscribers must enqueue a BullMQ job for anything heavy and use `db.txAs({ orgId })` for their own reads.
Verified on the installed @nestjs/core 11.2.5: two domain modules each declaring a decorated provider are discovered by one
registry with no central list (Appendix A.4). Test: a unit test with a two-subscriber fake module.

**S7b. Realtime rooms — removes H05.** New `apps/api/src/realtime/room-registry.ts` with
`RealtimeRoom = DiscoveryService.createDecorator<{ prefix: string }>()` and the handler interface
`RealtimeRoomHandler { authorize(client: Socket, id: string): Promise<boolean> }`. The gateway gets one
`@SubscribeMessage('room:join')` that resolves the handler by prefix, calls `authorize`, and then joins the socket to the
room `<prefix>:<orgId>:<id>`; it also gets one `emitToRoom(prefix, orgId, id, event, payload)`. Keep `emitToUser`, and
reimplement `emitToConversation` as a thin wrapper so nothing breaks. Room prefixes and event names are namespaced with the
domain `<code>`. Domain code emits from an API-process service; emitting from the worker needs D3 (not in the skeleton).

**S7c. Env fragments — removes H06.** Move `booleanish` (currently private in `env.schema.ts:14`) to
`apps/api/src/config/zod-helpers.ts` so fragments can import it without a cycle. Each domain gets
`config/domains/<domain>.env.ts` exporting `export const bspEnvShape = {} satisfies z.ZodRawShape;`. `env.schema.ts` gets a
marker block inside the `z.object({...})` (`spread` of every fragment). Rules: prefix `<CODE>_`; every var **optional or
defaulted** (so `.env.example` and the CI `env:` block never need a domain edit); a domain that needs a hard production check
adds it to its own fragment as a `productionRequired` list evaluated in `validateEnv` (kernel adds the loop once).
`config` is a leaf layer; putting fragments under `config/domains/` (not `modules/`) is what avoids a `config -> modules ->
config` cycle, which `no-circular` would fail.

**S7d. Queues — removes H03.** No central edit. Convention only, enforced by `domains:check` and one vitest:
`modules/<domain>/<domain>.queues.ts` exports `export const BSP_QUEUES = { RESELLER_SYNC: 'bsp-reseller-sync' } as const`;
the **owning** domain calls `BullModule.registerQueue({ name: BSP_QUEUES.RESELLER_SYNC })` in its HTTP module (producer) and
worker module (consumer); `@Processor(BSP_QUEUES.RESELLER_SYNC)` classes live only in the worker module. Other domains enqueue
through the owner's service (barrel), not by re-registering the queue. Unit test: `import.meta.glob('.../modules/*/*.queues.ts',
{ eager: true })` asserts unique values, `^<code>-` prefix, no `:`. Existing `QUEUES` stays for core queues (kernel).
Because no processor or producer has ever run in this repo (target-map confirms), the **first** domain to use it must prove it
against real Redis before others copy it (Section 6, item 5).

Verify S7: `pnpm test` (new unit tests), `pnpm typecheck`, `pnpm arch:check`, `pnpm dev:worker` boots and the outbox drain
still logs; `pnpm test:integration`.

#### S8. Docs restructure and ADR bookkeeping (1.5 h) — removes H22, H29, H30, H31, H32

- New `docs/api/README.md` (template) and a per-domain file `docs/api/<domain>.md` created by owners on demand: a route table
  (`Route | WD id | Status`) plus captured request/response evidence. This merges what `api-inventory.md` and `api-testing.md`
  did per page.
- Prepend to `docs/api-inventory.md`, `docs/api-testing.md`, `docs/phase-plan.md`: **"Frozen for the WaDesk port. Legacy Geta
  pages 1-28 only, edited by <legacy owner>. New work: docs/api/<domain>.md."** In `docs/README.md` (`:72-82`) point the
  API inventory and testing sections at `docs/api/`. In `phase-plan.md` fix the gating paragraph (tag lists do not gate;
  `@ApiExcludeController()` does) and say the "docs/api-testing.md entry" requirement now means the domain's `docs/api/<domain>.md`.
- `docs/README.md` ADR table (`:26-50`): keep 0001-0017; below it add subsections `### ADRs 0100-0199 (<owner-a>)`,
  `### ADRs 0200-0299 (<owner-b>)`, `### ADRs 0300-0399 (<owner-c>)`, one table each. Verified: git merges edits in separate
  sections cleanly and conflicts when two people append to the same section (Appendix A.6). `adr-guard.sh` greps only for the
  `(adr/<file>)` link, so it works unchanged.
- `write-adr/scripts/new-adr.sh:16-21`: honour `ADR_BLOCK_START` (set once per dev with `git config crm.adrBlock 100`):

  ```bash
  start="${ADR_BLOCK_START:-$(git config --get crm.adrBlock || true)}"
  if [ -n "$start" ]; then
    last="$(ls docs/adr/[0-9][0-9][0-9][0-9]-*.md | awk -v s="$start" -v e="$((start+99))" \
      '{n=substr($0,10,4)+0} n>=s && n<=e {l=$0} END{print l}')"
    if [ -z "$last" ]; then next=$start; else next=$((10#$(basename "$last" | cut -d- -f1) + 1)); fi
  fi
  ```

- **ADR-0018** via the `write-adr` skill (kernel block 0018-0099), status accepted on merge: "Parallel-development seams".
  Extends ADR-0004 (naming only; the runner and immutability are unchanged) and ADR-0010 (queues registered per domain rather
  than only in `queues.ts`; per-domain worker modules). Supersedes nothing, so `adr-diff-guard` (which flags edits to
  accepted ADRs) stays quiet. Negative consequences to state honestly: 60 generated shells, eager wiring of every domain
  into both processes, migration order is author-time not merge-time (mitigated by the monotonic lint), and a decorator-based
  registry is less greppable than an explicit list.
- `packages/db/README.md` "Migrations applied today" (`:17`): replace with "see `pnpm db:status`". `docs/db/README.md`:
  add a note that domain deviations from the ERD are recorded in each inventory's "Data model" section.
- `docs/architecture/rbac.md:116` and `docs/runbooks/migrations.md:22` and the "Writing one" section: new command, new naming.

Verify: `bash .claude/skills/adr-diff-guard/scripts/adr-guard.sh` clean; `pnpm format:check`.

#### S9. Skills, CONTRIBUTING, CLAUDE.md (1.5 h) — removes H28, H10 (rule), H32

Edit exactly these instructions; each currently sends a developer or an agent to a hotspot:

| File                                                   | Line(s)          | Change                                                                                                                                                                                                                          |
| ------------------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.claude/skills/new-module/SKILL.md`                   | 175-186          | Modules live in `modules/<domain>/` (a top-level dir); the shell exists; **do not edit `app.module.ts`**; add controllers/providers to `<domain>.module.ts`. Also `:117` `version: '1'` should be `'2'` (all real controllers). |
| `.claude/skills/worker-job/SKILL.md`                   | 36-61            | Queues via `BullModule.registerQueue` in your own modules, names `<code>-<purpose>`; processors in `<domain>.worker.module.ts`.                                                                                                 |
| `.claude/skills/outbox-event/SKILL.md`                 | 78-97            | Consumers are `@OutboxSubscriber(...)` providers in the domain worker module; idempotent; enqueue heavy work.                                                                                                                   |
| `.claude/skills/provider-adapter/SKILL.md`             | 54-65            | Port/adapter in `infra/providers/<domain>/`, bound in the domain module; not `providers.module.ts`.                                                                                                                             |
| `.claude/skills/add-migration/SKILL.md`                | 22-28, 140-146   | `pnpm db:new <code> <name>`; stamp naming; run `pnpm db:lint`; Drizzle mirror goes in `schema/<domain>/`.                                                                                                                       |
| `.claude/skills/rbac-permission/SKILL.md`              | 20-66            | Keys `<code>.<resource>.<action>`; own `<ts>_<code>_permissions.sql`; **keep keys as string literals** in `@RequirePermission(...)` because `scan.sh:46-53` greps literals.                                                     |
| `.claude/skills/contracts-change/SKILL.md`             | 22-40            | Per-domain folder; prefix names; errors via `DomainErrorCodes`; no root-barrel edit.                                                                                                                                            |
| `.claude/skills/frontend-api-call/SKILL.md`            | imports section  | Import from `@crm/contracts/<domain>`; calls live in `features/<domain>/api/`.                                                                                                                                                  |
| `.claude/skills/pre-pr/SKILL.md` + `scripts/gate.sh`   | run list         | Add `pnpm domains:check` (always) and `pnpm db:lint` (when `packages/db/migrations/` changed), and the ownership check.                                                                                                         |
| `CONTRIBUTING.md`, `CLAUDE.md`, `docs/skill-router.md` | scopes, pointers | Scopes are now domain ids/codes (S1); add "Parallel-work seams: read `docs/wadesk-port/conflict-map.md` section 3-5"; router rows for the new rules.                                                                            |

Verify: grep the skills for `app.module`, `queues.ts`, `workers.module`, `providers.module`, `0008_seed`, `pnpm db:new <name>`:
no remaining instruction to edit them. `bash .claude/skills/adr-compliance-review/scripts/scan.sh` still resolves permission
keys.

#### S10. CI and the conflict-freedom drill (1 h) — closes H24, H26

- `.github/workflows/ci.yml` `static` job: `actions/checkout@v4` with `fetch-depth: 0` (needed for `db:lint --base`), then
  after `pnpm arch:check` add `pnpm domains:check` and `pnpm db:lint`.
- Dependencies: the kernel steward collects the npm packages the inventory's "External systems"/"Port notes" imply
  (provider SDKs, mailer, S3 client, phone parsing, socket emitter, CSV) and installs them in **this PR** (one lockfile change up front). Afterwards additions go through the deps lane (section 5). `.npmrc` already sets `link-workspace-packages`.
- Repo settings (D7): require PR review from code owners; require branches to be up to date (or a merge queue); no direct pushes.
- **Acceptance drill (must pass before merging the skeleton).** Create three throw-away branches from the skeleton. Each,
  for a different domain, adds a complete vertical slice touching every layer: controller + service, a queue + processor, an
  outbox subscriber, contracts schema + error code, table + migration (`db:new`) + permission migration, a seed, an env
  var, a docs file. Then:

  ```bash
  git checkout -b drill-merge skeleton && git merge --no-ff drill-a drill-b drill-c   # must report no conflicts
  pnpm --filter @crm/contracts build && pnpm --filter @crm/db build
  pnpm format:check && pnpm lint && pnpm typecheck && pnpm arch:check && pnpm test
  pnpm domains:check && pnpm db:lint && pnpm db:reset && pnpm db:status && pnpm test:integration
  ```

  Zero merge conflicts and everything green is the definition of done. Any file a drill branch had to edit outside its
  zone is a missed seam: fix the skeleton, not the drill.

Cut line if time runs short (each is a separate small follow-up, but land before the first domain needs it): S7b (realtime),
S4 partition discovery, S7c env fragments. Never cut S1, S2, S4-S6, S7a, S8-S9.

### 2.2 Part B: web skeleton (about 1 day; lands with the `apps/web` move-in)

`apps/web/README.md` says an existing Next.js app moves in. Do the restructure as part of that PR so the shell is born with
seams. Written library-agnostic (D6). Removes H36.

```
apps/web/
  messages/<locale>/<domain>.json          one file per domain per locale (namespace = domain id)
  e2e/<domain>/**
  src/
    middleware.ts                          kernel: auth gate only; no per-domain redirects
    app/
      layout.tsx  providers.tsx            kernel
      (auth)/...                           owned by the auth domain
      (app)/layout.tsx                     kernel shell: sidebar + header, reads the nav registry
      (app)/(<domain>)/<routeBase>/**      exclusive; thin pages that import from features/<domain>
      (admin)/layout.tsx                   kernel shell for the super-admin console
      (admin)/(<domain>)/<routeBase>/**    exclusive
    features/
      _registry/nav.generated.ts           GENERATED by `pnpm domains:sync`; never edited
      <domain>/index.ts                    public surface for other domains (types, hooks)
      <domain>/nav.ts                      exports NavItem[] for the shell
      <domain>/{api,components,hooks,schemas}/**
    lib/                                   kernel: api client, session, permissions hook, i18n loader, query client
packages/ui/                               kernel: primitives only (@crm/ui)
apps/partner/                              its own owner; consumes @crm/contracts/<domain> and @crm/ui only
```

- **Route groups per domain.** `(<domain>)` groups let each domain own a directory without changing URLs. Two domains cannot
  serve the same URL (Next fails the build on parallel routes resolving to one path; from Next docs, not run here), so
  `routeBase` uniqueness in the manifest (checked by `domains:check`) is what prevents it earlier. Admin-console domains use
  the `(admin)` shell.
- **Nav registry.** Each `features/<domain>/nav.ts` exports items; `nav.generated.ts` (written by the generator) imports all
  of them once. The shell sorts by `(section, order, id)`.

  ```ts
  export interface NavItem {
    id: string;
    area: 'app' | 'admin';
    section: string;
    labelKey: string;
    href: string;
    icon: string;
    permission?: string;
    order: number; // permission: literal key from permission_defs
  }
  ```

  A static generated import list is used instead of `require.context` because it is bundler-independent (Turbopack support
  for `require.context` is unverified). Permission filtering needs `GET /v2/users/me` to return permissions; today it returns
  user + roles only (`api-inventory.md` "App init", status partial), a K1 kernel item.

- **i18n.** `messages/<locale>/<domain>.json`, merged by a kernel loader that lists the directory at request/build time (no
  barrel). Keys `<domain>.<screen>.<key>`. Solves the classic single `en.json` conflict.
- **API client.** `lib/api/client.ts` (kernel): auth header, `Idempotency-Key` on mutations, `X-Request-Id`, problem+json to
  a typed error, zod `parse` at the boundary, cursor helper. Domains call it from `features/<domain>/api/*.ts`. Query keys
  start with the domain code.
- **Shared UI.** `@crm/ui` is kernel-owned and small. A domain needing a new primitive builds it in
  `features/<domain>/components/` and proposes promotion later, so it is never blocked on the kit.
- **Boundaries.** Copy `.dependency-cruiser.cjs` rules to the web: `features/<a>` may import `features/<b>` only via its
  `index.ts`; `app/(<a>)` may import only `features/<a>`, `lib`, `@crm/ui`, `@crm/contracts/*`. Add `arch:check` for web.
- **Housekeeping.** `apps/web/package.json` (`@crm/web`, `@crm/contracts: workspace:*`, tsconfig `moduleResolution: bundler`),
  `.env.example` (`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_REALTIME_URL` per `apps/web/README.md`), and `apps/api/Dockerfile:22-25`
  gets the new manifests (`apps/web`, `packages/ui`) or `pnpm install --frozen-lockfile` in the image build will not match the
  workspace (behaviour untested). `turbo.json` already outputs `.next/**`.

Verify: `pnpm --filter @crm/web build`, `pnpm typecheck`, `pnpm lint`, `docker build -f apps/api/Dockerfile .`, and add a web
slice to the acceptance drill (a page, a nav item, a message file for three domains; the merge must be conflict-free).

### 2.3 Compatibility checks behind each mitigation

What I checked in the code for each proposed change, and what came out. "Tested" means I ran it (Appendix A); "read" means I read
the code or the installed library.

| Mitigation                            | Constraint in the code                                                                                                                                                                                                                                | Result                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Timestamp migration names             | `loadMigrations` filters `.sql`, `.sort()`s, id = file stem (`migrator.ts:40-53`); `_migrations.id` is a `text` primary key; `db:new` parses the first 4 characters (`migrate.ts:72`); `scan.sh:51` and `gate.sh:46` glob the flat directory. Tested. | Works with no runner change; patch `db:new`; keep the directory flat.  |
| Static generated module list          | `.dependency-cruiser.cjs:24-33` only checks files under `src/modules/<x>/`; `src/domains.generated.ts` is outside and imports each domain through `modules/<d>/index.ts`, which the rule allows. Read.                                                | OK.                                                                    |
| `@OutboxSubscriber` / `@RealtimeRoom` | `@nestjs/core` 11.2.5 exports `DiscoveryModule` and `DiscoveryService.createDecorator`. Tested with two modules and one registry.                                                                                                                     | Works; the SWC build path is untested.                                 |
| Per-domain queues                     | `registerQueue` is per-module and `forRoot` is global (`bull.module.js`); no `:` in names (`queue-base.js:35`). No producer or processor exists in the repo yet. Read.                                                                                | Works on paper; the first domain to use it proves it.                  |
| Env fragments                         | `no-circular` counts type-only imports (`tsPreCompilationDeps: true`) and modules import `Env` from `config`, so fragments must live under `config/`; `booleanish` is private (`env.schema.ts:14`). Read.                                             | OK with those two adjustments.                                         |
| `DomainErrorCodes` merging            | Compiled under `tsconfig.base.json`; `.d.ts` keeps the augmentation; a typo is rejected. Tested.                                                                                                                                                      | OK.                                                                    |
| Code-prefixed exports                 | Duplicate names via `export *` are TS2308 at the barrel. Tested.                                                                                                                                                                                      | Rule plus `domains:check`.                                             |
| Contracts subpath exports             | Base `moduleResolution: node` ignores `exports`; catch-all `typesVersions` breaks the root import; `bundler` works. Tested.                                                                                                                           | API keeps the root import; only the web uses subpaths.                 |
| Swagger without `addTag`              | `addTag` only appends to `document.tags`; exclusion is `ApiExcludeController` (`swagger-explorer.js:80`); `SwaggerUiOptions` has an index signature. Read.                                                                                            | OK.                                                                    |
| Seed loader                           | `seed` runs as `tsx src/cli/seed.ts` and `tsx` is a `packages/db` devDependency. Read.                                                                                                                                                                | Expected OK; dynamic import untested.                                  |
| Partition discovery                   | `ensure_monthly_partition(regclass, date)` is generic (`0001_extensions.sql:60`); `defaultPartitionCounts` assumes `<table>_default`. Read.                                                                                                           | OK; keep the `_default` convention.                                    |
| Permission prefix lint                | `scan.sh:46-53` greps literal `@RequirePermission('...')` and `'key'` in `migrations/*.sql` (non-recursive); `PermissionsGuard` compares exact key strings. Read.                                                                                     | Works if keys stay literals and migrations stay flat.                  |
| Ownership globs                       | `ownership_check.py` `g2r` supports `*`, `**`, `?`, trailing `/`, and escapes parentheses. Read.                                                                                                                                                      | Works for the zone template; GitHub CODEOWNERS `?` support unverified. |
| Per-owner ADR sections                | Separate sections merge cleanly (tested); `adr-guard.sh` greps only `(adr/<file>)`. Read.                                                                                                                                                             | OK.                                                                    |
| Relaxed commit scopes                 | `scope-enum` is level 1 (warn); `.husky/commit-msg` runs commitlint. Read.                                                                                                                                                                            | OK.                                                                    |
| Generator in `apps/api/src/tools`     | `eslint.config.mjs:63` gives that directory a `no-console` override and `emit-openapi.ts` is precedent; root `tools/*.mjs` is outside every tsconfig and lint script, so linting it is uncertain. Read.                                               | Put it in `apps/api/src/tools`.                                        |
| Generated files vs prettier           | CI `format:check` covers `.ts`; `.prettierignore` skips only `**/*.sql`, lockfile, `docs/db/*.dbml`. Read.                                                                                                                                            | The generator runs prettier on its own output.                         |

## 3. Ownership zone conventions

### 3.1 Identifiers

| Placeholder         | Meaning                                                                                                     | Example (from `inventory/`) |
| ------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------- |
| `<domain>`          | kebab-case domain id: directory names, route groups, Swagger tag, docs                                      | `bsp-billing-engine`        |
| `<Domain>`          | PascalCase of the id: Nest module class names                                                               | `BspBillingEngine`          |
| `<code>` / `<CODE>` | lowercase/uppercase short code: SQL identifiers, permission namespace, queues, events, Redis keys, env vars | `bsp` / `BSP`               |
| `<routeBase>`       | the domain's owned first URL segment (API and web); defaults to the id                                      | `reseller`                  |
| `<owner>`           | a person key from `ownership.json` `owners`                                                                 | -                           |
| `<ts14>`            | `YYYYMMDDHHmmss` UTC                                                                                        | `20260930153045`            |

`code` must be unique, `^[a-z][a-z0-9]{1,11}$`, no `_` or `-` (so `_<code>_` is unambiguous). `core` is reserved for the kernel.

### 3.2 Exclusive globs per layer (feed `ownership.json` `domains.<id>.zone`)

Syntax matches `wadesk-ownership-guard` (`*` = one path segment, `**` = many, `?` = one character, trailing `/` = subtree).

| Layer                    | Glob(s)                                                                                                                                          | Naming rule and who guards it                                                                                                                                                                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API module               | `apps/api/src/modules/<domain>/`                                                                                                                 | flat, one top-level dir per domain; controller paths start with `<routeBase>`; `@ApiTags('<domain>')`. `domains:check`, `arch:check`.                                                                                                                                                                                    |
| API providers (adapters) | `apps/api/src/infra/providers/<domain>/`                                                                                                         | port + adapters + token; bound in the domain module, never in `providers.module.ts`.                                                                                                                                                                                                                                     |
| API env                  | `apps/api/src/config/domains/<domain>.env.ts`                                                                                                    | vars `<CODE>_*`, optional or defaulted. `domains:check`.                                                                                                                                                                                                                                                                 |
| API tests                | `apps/api/test/unit/<domain>/`, `apps/api/test/integration/<domain>/`                                                                            | vitest recurses (`--dir test/unit`).                                                                                                                                                                                                                                                                                     |
| Worker                   | inside the module dir: `<domain>.worker.module.ts`, `*.processor.ts`, `*.subscriber.ts`, `<domain>.queues.ts`                                    | queues `<code>-<purpose>` (no `:`); job names `<code>.<job>`; `@Cron`/`@Interval` in worker module only.                                                                                                                                                                                                                 |
| Outbox events            | (names only)                                                                                                                                     | `aggregateModule` = `<code>` (or `<code>_<entity>`), `eventType` = `<code>.<entity>.<past_verb>`. Legacy `contact.*` belongs to CRM.                                                                                                                                                                                     |
| Realtime                 | inside the module dir                                                                                                                            | room prefix and event names start with `<code>`.                                                                                                                                                                                                                                                                         |
| Redis keys               | (names only)                                                                                                                                     | `<code>:...` (kernel uses `rbac:`, `idem:`, `ratelimit:`).                                                                                                                                                                                                                                                               |
| Contracts                | `packages/contracts/src/<domain>/`                                                                                                               | exported identifiers start with the code (`bspAllocationResponseSchema`); errors via `DomainErrorCodes`.                                                                                                                                                                                                                 |
| DB schema                | `packages/db/src/schema/<domain>/`, `packages/db/src/seeds/<domain>.ts`                                                                          | tables `<code>_*`, pgEnums `<code>_*`, TS variables start with the code.                                                                                                                                                                                                                                                 |
| Migrations               | `packages/db/migrations/??????????????_<code>_*.sql`                                                                                             | `<ts14>_<code>_<name>.sql` via `pnpm db:new <code> <name>`. **14 `?` then `_<code>_` is deliberate**: a bare `*_<code>_*` would match another domain's file when the code is a common word (code `add` vs `..._bsp_add_allocations.sql`). Objects: `<code>_*` tables/types/functions, `idx_<code>_*` indexes. `db:lint`. |
| Permissions              | migration `<ts14>_<code>_permissions*.sql`; keys `<code>.<resource>.<action>`                                                                    | `permission_defs.category = <code>`; literal keys in `@RequirePermission`. `db:lint`, `scan.sh`.                                                                                                                                                                                                                         |
| Display ids / counters   | (names only)                                                                                                                                     | `sequence_counters.module_key = <code>`, prefix `<CODE>`.                                                                                                                                                                                                                                                                |
| Web routes               | `apps/web/src/app/(app)/(<domain>)/`, `apps/web/src/app/(admin)/(<domain>)/`                                                                     | URL segment `<routeBase>`, unique in the manifest.                                                                                                                                                                                                                                                                       |
| Web features             | `apps/web/src/features/<domain>/`                                                                                                                | public surface only via `index.ts`; nav in `nav.ts`.                                                                                                                                                                                                                                                                     |
| Web messages             | `apps/web/messages/*/<domain>.json`                                                                                                              | keys `<domain>.<screen>.<key>`.                                                                                                                                                                                                                                                                                          |
| Web e2e                  | `apps/web/e2e/<domain>/`                                                                                                                         |                                                                                                                                                                                                                                                                                                                          |
| Docs                     | `docs/wadesk-port/inventory/<domain>.md`, `docs/wadesk-port/port-map/<domain>.md`, `docs/wadesk-port/tracker/<owner>.md`, `docs/api/<domain>.md` | plus the owner's ADR number block and own ADR-index subsection.                                                                                                                                                                                                                                                          |

Domain zone template for `ownership.json` (a later step instantiates `{domain}`, `{code}`, `{owner}`):

```json
"zoneTemplate": [
  "apps/api/src/modules/{domain}/",
  "apps/api/src/infra/providers/{domain}/",
  "apps/api/src/config/domains/{domain}.env.ts",
  "apps/api/test/unit/{domain}/",
  "apps/api/test/integration/{domain}/",
  "packages/contracts/src/{domain}/",
  "packages/db/src/schema/{domain}/",
  "packages/db/src/seeds/{domain}.ts",
  "packages/db/migrations/??????????????_{code}_*.sql",
  "apps/web/src/app/(app)/({domain})/",
  "apps/web/src/app/(admin)/({domain})/",
  "apps/web/src/features/{domain}/",
  "apps/web/messages/*/{domain}.json",
  "apps/web/e2e/{domain}/",
  "docs/api/{domain}.md"
]
```

### 3.3 Not owned by a domain

**Kernel** (`ownership.json` `kernel[]`; changes follow section 4):

```
apps/api/src/{app.module.ts,main.ts,worker.ts,domains.generated.ts}
apps/api/src/{kernel,common,realtime,health,workers,tools}/**
apps/api/src/config/{env.schema.ts,config.module.ts,zod-helpers.ts}
apps/api/src/infra/{db,redis,queue}/**  apps/api/src/infra/providers/{providers.module.ts,whatsapp,payments}/**
apps/api/test/{unit,integration}/*.spec.ts                       (top-level legacy specs)
packages/db/src/{client.ts,tenant.ts,migrator.ts,index.ts,cli/**}  packages/db/src/schema/{columns,enums,foundation,ops,index}.ts
packages/db/migrations/00*.sql                                    (legacy, immutable)
packages/contracts/{package.json,src/index.ts,src/common/**}
packages/ui/**  packages/config/**  apps/web/src/{app/layout.tsx,app/providers.tsx,app/(app)/layout.tsx,app/(admin)/layout.tsx,middleware.ts,lib/**,features/_registry/**}
.github/** docker/** docker-compose*.yml turbo.json package.json pnpm-workspace.yaml .npmrc eslint.config.mjs commitlint.config.cjs .husky/** .claude/skills/**
CLAUDE.md CONTRIBUTING.md docs/{adr,architecture,runbooks,db}/** docs/{README.md,skill-router.md} tools/**
```

**Legacy areas** get one owner each, decided in the assignments (they are not kernel): `apps/api/src/modules/crm/**` +
`packages/contracts/src/crm/**` + `packages/db/src/schema/{crm,contact-detail,contact-views,field-metadata}.ts` (contacts
successor); `modules/admin/**` + `contracts/src/admin/**` (roles-permissions successor); `modules/auth/**`
(auth successor); `modules/partner/**` + `modules/public-api/**` + `contracts/src/{partner,public}/**` + `schema/partner.ts`.

**Residual seams** (`ownership.json` `seams[]`, each with a reviewer role):

| Path                                                                                                                                                                                                                                    | Policy                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `pnpm-lock.yaml`, `package.json`, `apps/*/package.json`, `packages/*/package.json`                                                                                                                                                      | deps lane only; never hand-merge the lockfile; kernel steward reviews                                              |
| marker blocks in `packages/contracts/src/index.ts`, `packages/db/src/schema/index.ts`, `apps/api/src/config/env.schema.ts`, `apps/api/src/domains.generated.ts`, `apps/web/src/features/_registry/*.generated.ts`, `.github/CODEOWNERS` | generated; change only by editing the manifest and running `pnpm domains:sync`; on conflict take main's and re-run |
| `docs/README.md`                                                                                                                                                                                                                        | only rows inside your own ADR subsection                                                                           |
| `.env.example`                                                                                                                                                                                                                          | kernel only (domain vars are optional and documented in the fragment)                                              |
| `docs/wadesk-port/ownership.json`, `.github/CODEOWNERS` source                                                                                                                                                                          | changes need all three developers' approval                                                                        |

## 4. Shared-kernel change protocol

Kernel = everything in section 3.3. It is small on purpose; if you think you need to change it, first ask whether an
extension point already covers you (a decorator, a fragment, a generated block).

**Areas and stewards.** Assign four areas across the three developers (one takes two). The steward reviews and is a
CODEOWNER; a different developer gives the second approval.

| Area | Covers                                                                                               |
| ---- | ---------------------------------------------------------------------------------------------------- |
| K1   | tenancy, RLS, RBAC (`kernel/rbac`, `PermissionsGuard`), auth/identity, actor kinds, `common/context` |
| K2   | outbox, audit, queues, worker plumbing, realtime, `infra/*`                                          |
| K3   | `packages/db` client/migrator/conventions, `packages/contracts/src/common`, CI, generator, skills    |
| K4   | web shell, `lib/`, `@crm/ui`, nav registry, `middleware.ts`                                          |

**Change classes.**

- **Class 0 — additive and compatible** (new export, new optional field, new decorator option, bug fix with no behaviour
  change; roughly under 50 lines): open a PR titled `kernel(<area>): ...` with label `kernel`, one approval from the steward,
  target turnaround the same working day. No ADR.
- **Class 1 — behaviour or contract change** (RBAC/tenancy/outbox semantics, kernel table, new dependency, guard order, actor
  kind): first a GitHub issue labelled `kernel-request` (what, why, API sketch, who is affected), then an ADR through
  `write-adr` (`adr-diff-guard` must pass), steward approval **plus** an ack from the other two developers, landed alone.
- **Class 2 — breaking**: two phases. Add the new path alongside the old one (Class 0/1), then each domain owner migrates
  their own call sites in their own PRs, then a later kernel PR removes the old path. Nobody edits another owner's files to
  migrate them.

**Announce.** Issue or channel message before coding (Class 1) or at PR open (Class 0). When it merges: post "kernel PR
merged, rebase now" with the PR link. Kernel PRs merge first thing in the day so the others rebase once.

**Do not block.** While a kernel change is pending, code against the interface you asked for and stub it inside your own zone
(`modules/<domain>/_shims/`), mark the feature `blocked` in your tracker with the kernel issue id, and continue with something
else; never copy kernel code into your module, and never fix a kernel bug locally. If the kernel PR is slow, the requester may
author it (they own the code being changed for the duration) but the steward still reviews.

**Extension over modification** (preference order): a new decorator/registry entry in your own dir, a new file, an optional
parameter, and only then a change to an existing kernel signature. Closed unions (`ActorType`, `AuditInput.action`) are widened
in a Class 0 PR.

**Cross-domain APIs.** A domain's `index.ts` barrel is its public contract. Additive exports are free. Removing or changing
one is Class 2: find dependants with `rg "modules/<domain>'" apps/api/src`, notify them, keep the old export until they move.
Cycles between domains fail `arch:check` (`no-circular`); break them with an outbox event.

**Emergency.** A red `main` blocks all three developers: whoever broke it reverts or fixes forward within 30 minutes; a
migration that already ran anywhere is never edited (fix forward with a new stamp).

## 5. Rules of the road

1. **Stay in your zones.** Run `python3 .claude/skills/wadesk-ownership-guard/scripts/ownership_check.py` before every push.
   Anything outside your zones goes through section 4 or the owner.
2. **Small branches.** `<owner>/<domain>/<WD-id>-<slug>`, one feature per PR, about a day of work, title
   `feat(<code>): ...` (commit scopes are open, kebab-case).
3. **Rebase, do not merge main.** `git fetch && git rebase origin/main` daily and before opening the PR; merge only when CI is
   green **and** the branch is up to date.
4. **Never hand-merge generated files or the lockfile.** Lockfile conflict: take main's copy
   (`git checkout origin/main -- pnpm-lock.yaml`), run `pnpm install`, commit the result. Generated blocks: take main's, edit the
   manifest if needed, run `pnpm domains:sync`.
5. **Dependencies are their own PR** (`chore(deps): add X for <code>`), merged within the hour; never bump existing versions in
   a feature PR; ask the kernel steward before adding a workspace package.
6. **Migrations:** `pnpm db:new <code> <name>`, one logical change each, never edit one after it is on main. If `db:lint` says
   your stamp is older than main's newest, `git mv` it to a fresh stamp after rebasing. FKs only to tables already on main
   (composite `(org_id, id)`); to reference another domain's data that is not merged yet, store its uuid (app-enforced) and
   add the FK in a later migration once both are on main.
7. **Contracts:** prefix exports with your code, put errors in `<domain>/errors.ts`, and rebuild after editing
   (`pnpm --filter @crm/contracts build`, or keep `pnpm --filter @crm/contracts dev` running).
8. **Cross-domain calls** only through the other domain's `index.ts` barrel or the outbox. Need something? Ask the owner, code
   against the interface, stub it, mark `blocked` with the feature id.
9. **Docs:** edit only your own files (`docs/api/<domain>.md`, inventory, tracker). Never touch `docs/api-inventory.md`,
   `docs/api-testing.md`, `docs/phase-plan.md` (frozen).
10. **ADRs:** use your number block (`git config crm.adrBlock <start>`), add the row only inside your own subsection of
    `docs/README.md`, then run `adr-diff-guard`.
11. **Gate before push:** `bash .claude/skills/pre-pr/scripts/gate.sh` plus `pnpm domains:check` and `pnpm db:lint`. No
    `--no-verify`; lint-staged and commitlint exist for a reason.
12. **Permission keys are literals** `<code>.<resource>.<action>` in `@RequirePermission(...)` and registered in your own
    migration; new queues, env vars, rooms and subscribers are added by decorating or registering inside your own directory.

## 6. Unverified assumptions

Each item says how to check it.

1. **Manifest schema.** `docs/wadesk-port/ownership.json` does not exist yet; I assumed `owners.<name>.{aliases,github}`,
   `domains.<id>.{owner,zone[]}` (as `ownership_check.py` reads) plus new `code`, `routeBase`, `seams[]`, `kernel[]`. The domain
   count (about 60), codes, routeBases and owners are not fixed. Check: decide D1 first.
2. **GitHub-side behaviour.** CODEOWNERS enforcement, "require up to date", merge queue, that `pull_request` CI checks out the
   merge ref, and that CODEOWNERS accepts `?` in patterns. Not verifiable from the repo. Check: repo settings, one test PR.
3. **pnpm lockfile conflict handling.** The pnpm 9 `pnpm install` conflict auto-resolution is documented behaviour but I did not
   exercise it on this lockfile. Check: force a conflict in a scratch clone. The `--frozen-lockfile` CI step is the safety net.
4. **Worker importing an HTTP module.** Whether it instantiates controllers safely without `AuthModule` is untested; the design
   avoids it (separate worker modules). Check: a boot smoke test of `WorkerModule` with a sample domain.
5. **BullMQ end to end.** No queue, producer or processor has ever run in this repo. I verified only that
   `BullModule.registerQueue` is per-module and `forRoot` is global in `@nestjs/bullmq@11.0.5`, and that BullMQ 5.81.5 rejects
   `:`. Check: the first domain proves producer in the HTTP module + processor in the worker module against real Redis.
6. **Discovery under SWC.** The `DiscoveryService` registry was verified with tsx, not the SWC build (`nest build -b swc`), and
   without a database. Check: S7a unit test plus `pnpm --filter @crm/api build` and `pnpm dev:worker`.
7. **Generic RLS query on partitions** (the `relispartition` filter and the `pg_attribute` catalogue query) was not run
   (needs Docker). Check: S3 verify step.
8. **`tsx` dynamic `import()` of `seeds/*.ts`** from a CommonJS CLI is expected to work but was not exercised.
9. **Web specifics.** The Next.js app to be moved in is not in the repo; `geta-platform-v1/apps/web` is only precedent. Next's
   duplicate-route build error, Turbopack and `require.context`, and the bundle-size benefit of subpath imports are not
   verified here. The i18n library is undecided.
10. **Docker image with new workspace packages.** Whether `pnpm install --frozen-lockfile` in the `deps` stage tolerates
    missing manifests for `apps/web`/`packages/ui` is untested; Part B updates the Dockerfile instead of relying on it.
11. **Severity numbers** use my assumed velocity (3 developers, about 4 PRs each per week), not measured throughput. History
    is a single author's sequential PRs, so it shows which files a feature touches, not observed conflicts.
12. **Production database state.** I do not know whether any deployed database has migrations applied (relevant to the
    fresh-vs-incremental ordering caveat), nor how real orgs' locked Admin role gets new permission keys (D4).
13. **Swagger `tagsSorter`.** Typed as accepted (`SwaggerUiOptions` is `[key: string]: any`); behaviour in the UI not run.
14. **Format status.** Today `pnpm format:check` fails on 11 untracked markdown files under `docs/wadesk-port` and
    `.claude/skills/wadesk-*` (measured). lint-staged formats staged markdown on commit, so this bites only with `--no-verify`.
15. **Time estimates.** The 15 h for Part A and 1 day for Part B are my sizing, not measured.

## Appendix A: Experiments I ran

All in a scratch directory outside the repo; none modified the repo.

1. **Real migrator ordering.** Called `loadMigrations` from the built `packages/db/dist/migrator.js` on a temp dir holding
   these files plus a `README.md`:

   ```
   0019_legacy_x  0020_inbox_a  0020_broadcast_b  0021_c
   20260101000000_zzz_early  20260930153044_add_flags  20260930153045_bsp_add_allocations
   ```

   Result: `0019_legacy_x`, then `0020_broadcast_b` before `0020_inbox_a`, then `0021_c`, then the three 14-digit names in
   stamp order; the README was ignored. Conclusion: any name works, same number with a different slug both load, the slug
   (not authoring time) breaks the tie, and timestamps sort after the legacy files.

2. **TS2308 on duplicate names.** Two domain barrels exporting `listQuerySchema` through `export *` fail at the root barrel:
   `error TS2308: Module './bsp' has already exported a member named 'listQuerySchema'`.
3. **Error-code registry.** `DomainErrorCodes` interface merging across `<domain>/errors.ts` compiled under
   `packages/config/tsconfig.base.json`, emitted correct `.d.ts`, accepted domain codes and rejected a typo.
4. **Nest DiscoveryService.** With `@nestjs/core` 11.2.5, two independent modules each providing a class decorated with
   `DiscoveryService.createDecorator()` were both found and invoked by one registry; no central list.
5. **Subpath exports.** With `moduleResolution: node` (the repo base), `@pkg/<sub>` fails even with `exports`, and a catch-all
   `typesVersions` also breaks the root import; with `moduleResolution: bundler` both work; Node runtime `require` of the
   subpath works via `exports`.
6. **git merge behaviour.** Two branches appending to a flat list: conflict. Two branches editing different lines of a
   pre-created generated block, and different sections of an index: clean merge. Two branches appending to the same
   section: conflict.
7. **Baseline checks.** `pnpm arch:check` passes (1 `no-orphans` warning, `easebuzz.port.ts`); `pnpm format:check` currently
   fails on the 11 untracked markdown files noted above.
8. **Library facts read from `node_modules`.** `@nestjs/swagger` 11.4.7 `addTag` and `swagger-explorer.js:80`
   (`ApiExcludeController`); `@nestjs/bullmq` 11.0.5 `registerQueue`/`forRoot` global; `bullmq` 5.81.5 `queue-base.js:35`.
9. **History.** `git log --no-merges --name-only` over all 34 commits (30 by one author); feature-commit touch matrix in
   section 0.
