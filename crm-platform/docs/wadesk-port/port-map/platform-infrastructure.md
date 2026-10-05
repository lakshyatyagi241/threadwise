# Port map: platform-infrastructure (INFRA)

Spec: `docs/wadesk-port/inventory/platform-infrastructure.md` (62 features, ids `WD-INFRA-001` to `062`). Zone: `ownership.json`
key `platform-infrastructure` (code `infra`, owner `lakshya`). Target state verified against branch `lakshya/auth/parity-gaps`
@ `86008a31`, 2026-10-04.

WaDesk's "infrastructure" is a Laravel monolith that is queue-less, scheduler-less and Redis-less: its database cache is also its
lock service and rate limiter, deferred work is closures run after the HTTP response, and periodic work rides on a bridge
heartbeat. This repo already replaced most of that with a different design (JWT auth, problem+json, BullMQ, outbox, Redis,
pino, Docker). So this domain is mostly **not new code in its own zone**. It is (1) a catalogue of implicit WaDesk behavior
that other domains must re-implement deliberately, (2) a short list of kernel and foundation gaps with named owners, and
(3) a small amount of INFRA-owned conformance work. The risk is not building too little, it is two people editing the same
kernel file; every kernel item below therefore goes through the kernel protocol (`conflict-map.md` section 4).

## Decision per feature

Dispositions: **Built** (already in the repo; INFRA adds only a test or doc), **Kernel PR** (change in a kernel file, own PR,
steward reviews), **Foundation** (belongs to an `ownership.json` foundation item with another owner), **Delegated** (the
owning WaDesk domain builds it; INFRA only records the contract), **Replaced** (different mechanism in the target),
**Not built**, **Docs**.

| WD-INFRA id | Disposition                  | Target                                                                                                                                                                                                                                                  |
| ----------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 001         | Built                        | `app.module.ts` guard order (`JwtAuthGuard`, `PermissionsGuard`, `@Public()` opt-out), `domains.generated.ts`. No catch-all route in the API; `/{slug}` resolves in `apps/web`.                                                                         |
| 002         | Replaced + Docs              | Each middleware lives with its owner (AUTH security headers, SET maintenance, INST demo guard, I18N locale, PLAN gates). INFRA writes the ordered-guards reference in `docs/architecture/` (kernel doc PR).                                             |
| 003         | Built + test                 | `TRUST_PROXY` (default `loopback`) in `main.ts`. INFRA adds an e2e test: forged `X-Forwarded-For` from an untrusted peer is ignored by lockout, allowlist and audit IP.                                                                                 |
| 004         | Replaced (Kernel PR, P2)     | Fixed public origin from `APP_URL`; one helper for every absolute URL (mail, signed links, payment returns). Never read the Host header.                                                                                                                |
| 005         | Build (INFRA)                | Webhook-authentication checklist (one row per machine entry point) and an architecture test that every `@Public()` non-GET route names a signature/secret guard. CSRF itself is not needed for bearer tokens.                                           |
| 006         | Delegated                    | ECOM (Shopify embed) and `apps/web` route with a scoped `SameSite=None` cookie.                                                                                                                                                                         |
| 007         | Replaced                     | API answers 401 problem+json always; web `proxy.ts` redirects with a validated same-origin `next`.                                                                                                                                                      |
| 008         | Built                        | `ProblemExceptionFilter` (RFC 9457, `code`, `requestId`). INFRA checks the web app for root `not-found`, `error` and `global-error` pages and a 503 maintenance page (only `app/s/not-found.tsx` exists today); the work belongs to the web foundation. |
| 009         | Delegated                    | Domain error codes (`PLAN_LIMIT_REACHED`, assignment target) added by PLAN and TIB2 through additive contracts PRs.                                                                                                                                     |
| 010         | Kernel PR (INFRA authors)    | Redis-backed throttler guard with named policies (`auth`, `public-form`, `webhook`, `api-key`, `ui-poll`), `RATE_LIMITED` + `Retry-After`. No `@nestjs/throttler` today. Reviewer: K2 (vedant).                                                         |
| 011         | Built                        | `public-api/api-key.guard.ts` (`ApiKey prefix.secret`, argon2, HMAC, replay window, per-key limit). WaDesk `Bearer wsk_` keys: decision with API domain (migrated customers only).                                                                      |
| 012         | Delegated                    | EXT builds a hashed, expiring, revocable per-user token guard.                                                                                                                                                                                          |
| 013         | Delegated                    | MOB: org selected by header is validated against membership, never trusted.                                                                                                                                                                             |
| 014         | Built + Kernel PR (small)    | `enableCors` with `CORS_ORIGINS`. Change: an empty list in production means deny for credentialed requests (today it reflects any origin).                                                                                                              |
| 015         | Built + Kernel PR            | `/health`, `/ready` exist. Add a worker probe and queue/outbox lag to readiness. Per-channel health is each channel domain's `GET /v2/<routeBase>/health`.                                                                                              |
| 016         | Not built                    | No local-disk file routes; signed object-storage URLs only.                                                                                                                                                                                             |
| 017         | Foundation F5 (punya)        | One upload service: presigned PUT, size caps, magic-byte sniff in a worker, per-org quota. INFRA supplies the per-surface matrix from the inventory as the spec.                                                                                        |
| 018         | Replaced (Kernel PR)         | Sentry init in `main.ts` and `worker.ts` with PII scrubbing, `uncaughtException`/`unhandledRejection` handlers. No FatalTrace.                                                                                                                          |
| 019         | Replaced                     | AUTH JWT access plus rotating refresh. No non-expiring tokens.                                                                                                                                                                                          |
| 020         | Kernel PR (INFRA authors)    | Explicit body-size limits per route class in `main.ts` (keep `rawBody`), per-field trimming in Zod schemas, no blanket empty-to-null.                                                                                                                   |
| 021         | Build (INFRA)                | `config/domains/platform-infrastructure.env.ts` (`INFRA_*`) for new keys; the dropped-key list and env mapping from the inventory go into `docs/runbooks/`.                                                                                             |
| 022         | Built                        | `NODE_ENV`, `APP_URL`, `PORT`; version from `npm_package_version` or a build arg.                                                                                                                                                                       |
| 023         | Built + Kernel PR + decision | `CryptoService` (AES-256-GCM, `v1:`). Add a key ring with key ids and multi-key decrypt for rotation; recorded decision on which columns are application-encrypted (PII) vs RLS plus disk encryption.                                                   |
| 024         | Built                        | `packages/db` migrator, `_migrations`, `infra/db/` primary plus replica, non-superuser role.                                                                                                                                                            |
| 025         | Kernel PR (K2, vedant)       | `RedisLockService` plus a throttle-gate helper over `REDIS_CLIENT` so domains do not re-create `Cache::lock`/`Cache::add` ad hoc. Replaces roughly 200 WaDesk cache call sites.                                                                         |
| 026         | Replaced                     | No server session; AUTH refresh-token/device table.                                                                                                                                                                                                     |
| 027         | Built + Foundation F4        | `infra/queue/` (BullMQ defaults), about ten `*.processor.ts` in domains. Add a startup check: queue names unique, prefixed `<code>-`, each processed by a worker.                                                                                       |
| 028         | Built + Kernel PR (small)    | pino with redaction. Add secret-bearing fields to the redact list, a `silent` level, a worker child logger with job id.                                                                                                                                 |
| 029         | Built (AUTH) + Foundation    | `MailPort` and `SmtpMailAdapter` exist under AUTH providers; F5 (punya) generalizes to a platform mailer with retries and bounce handling. SET supplies runtime SMTP settings.                                                                          |
| 030         | Not built                    | Dropped config blocks recorded in the env mapping.                                                                                                                                                                                                      |
| 031         | Kernel PR (small)            | Emit and publish the `/public/v1` OpenAPI file at build time (`tools/emit-openapi.ts`); `/docs` stays off in production.                                                                                                                                |
| 032         | Delegated                    | MADS (seed data or constants plus a provider adapter).                                                                                                                                                                                                  |
| 033         | Delegated                    | STORE env fragment (`STORE_HOST`, CNAME target); wildcard TLS in Caddy (see 057).                                                                                                                                                                       |
| 034         | Replaced                     | NODE: the bridge is a worker; no shared-secret HTTP boundary.                                                                                                                                                                                           |
| 035         | Replaced                     | Outbox plus explicit `audit.record()` in services (the transactional outbox design, the hard-delete-with-audit rule). No observers.                                                                                                                     |
| 036         | Replaced                     | WABA/BSP: explicit `channel.status_changed` outbox event and an `@OutboxSubscriber`.                                                                                                                                                                    |
| 037         | Replaced                     | SET settings service with Redis invalidation, read lazily by adapters.                                                                                                                                                                                  |
| 038         | Not built                    | Compile-time modules; plan flags decide availability (ADD).                                                                                                                                                                                             |
| 039         | Foundation F4 (vedant)       | Room registry (`room:join` handler per prefix) and `@socket.io/redis-emitter`. INFRA supplies the channel and event table from the inventory.                                                                                                           |
| 040         | Delegated + Foundation F4    | Every sweeper (SLA, snooze, reminders, retries, wipes, stock holds, token refresh) becomes a repeatable job in its owning domain's worker module, tenant context per org. INFRA owns the catalogue, not the jobs.                                       |
| 041, 042    | Not built                    | No CLI in the API. Demo seeds go to `packages/db/src/seeds/`.                                                                                                                                                                                           |
| 043         | Replaced                     | Shared libs: timezone via `Intl`, media URLs via the storage service, a maintained HTML sanitizer.                                                                                                                                                      |
| 044         | Replaced                     | NODE: Redis/BullMQ plus DB; a heartbeat key per channel connection surfaced in `/ready`.                                                                                                                                                                |
| 045         | Not built                    | No migration. `cache`, `jobs`, `migrations` and the rest map to Redis, BullMQ, `_migrations`.                                                                                                                                                           |
| 046         | Built                        | vitest, testcontainers, `docker-compose.yml`, the `setup` skill.                                                                                                                                                                                        |
| 047         | Docs                         | Dependency decisions recorded; each new package in a dependency-only `chore(deps)` PR (seam policy).                                                                                                                                                    |
| 048         | Kernel PR (with 057)         | `apps/api/Dockerfile`: `TZ=UTC`, digest-pinned base image, `ffmpeg` only if media domains need it.                                                                                                                                                      |
| 049         | Delegated                    | NODE decides the socket-runner packaging.                                                                                                                                                                                                               |
| 050, 051    | Built (web foundation)       | Next.js 16, Tailwind 4, next-intl exist in `apps/web`; logical properties for RTL. INFRA verifies no CDN scripts and self-hosted fonts.                                                                                                                 |
| 052         | Replaced                     | Typed API client (`frontend-api-call`), shared `PasswordInput`.                                                                                                                                                                                         |
| 053         | Replaced                     | Next.js serves assets; Caddy fronts both (see 057).                                                                                                                                                                                                     |
| 054, 055    | Foundation F5 (punya)        | Storage module over the `S3_*` buckets, key prefix `org/<orgId>/<feature>/`, private by default. The chat `LocalDiskMediaStore`, the SET SigV4 probe and `contact_files` become clients of the one port. decision needed.                               |
| 056         | Foundation F5 + Delegated    | Orphan-object sweeper (F5); per-domain retention jobs; pino to stdout with off-box shipping (the single-VM deploy design item).                                                                                                                         |
| 057         | Kernel PR (K2 + K3)          | `docker-compose.prod.yml`: Caddy, one-shot migrate step, per-service healthchecks, `stop_grace_period`, resource and log limits; CI image push; deployment runbook; the single-VM deploy design checklist.                                              |
| 058         | Delegated                    | AUTH: single-use hashed verification tokens, public origin from `APP_URL`.                                                                                                                                                                              |
| 059         | Built + Kernel PR            | `timestamptz`, ISO-8601 with offset; `TZ=UTC` (with 048). Locale from explicit input, not inferred by the API.                                                                                                                                          |
| 060         | Built                        | vitest, dependency-cruiser, husky, commitlint, `.github/workflows/ci.yml`.                                                                                                                                                                              |
| 061, 062    | Docs                         | Developer docs in `docs/`; per-domain `docs/api/<domain>.md`; credits generated from the lockfile in CI.                                                                                                                                                |

## What INFRA builds in its own zone

| Layer      | Path                                                                                          | Contents                                                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| API tests  | `apps/api/test/{unit,integration,e2e}/platform-infrastructure/`                               | forged `X-Forwarded-For`, CORS in production, probe behavior, redaction, shutdown-with-job, webhook-guard architecture test, queue-name check |
| API env    | `apps/api/src/config/domains/platform-infrastructure.env.ts`                                  | optional `INFRA_*` keys (planned: body limits per route class, throttle policy overrides); stays empty until Kernel PR 1 reads them           |
| Contracts  | `packages/contracts/src/platform-infrastructure/`                                             | upload-policy matrix types only if F5 needs them shared; otherwise nothing                                                                    |
| Docs       | `docs/wadesk-port/port-map/`, `docs/api/platform-infrastructure.md`                           | webhook-auth checklist, periodic-work catalogue, dropped env keys, cache-usage catalogue                                                      |
| Module, DB | `modules/platform-infrastructure/`, `schema/platform-infrastructure/`, `migrations/*_infra_*` | **none**: no tables, no routes, no permissions. `routeBase infra` stays reserved but unused                                                   |
| Web        | `apps/web/.../(platform-infrastructure)/`                                                     | none. The operator system page is INST (`/admin/system`); health dashboards are DASH                                                          |

No new table, so no RLS work. No new route, so no permission keys and no `docs/api` sample beyond the catalogues.

## Kernel and foundation requests (each its own PR; INFRA authors unless noted)

| #   | Change                                                                                      | Features        | Kernel files                                                  | Reviewer          |
| --- | ------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------- | ----------------- |
| K-1 | Throttler guard and decorators; body-size limits; CORS empty-list fix                       | 010 020 014     | `common/`, `main.ts`, `app.module.ts`, `config/env.schema.ts` | K2 vedant         |
| K-2 | `RedisLockService` and throttle-gate helper                                                 | 025             | `infra/redis/`                                                | K2 vedant (owner) |
| K-3 | Sentry init, process handlers, worker probe, queue/outbox lag in `/ready`, pino redact list | 015 018 028     | `main.ts`, `worker.ts`, `health/`, `workers/`                 | K2 vedant         |
| K-4 | Crypto key ring and rotation runbook; recorded decision on application-level encryption     | 023             | `common/crypto/`, `docs/adr/`, `docs/runbooks/`               | K1 lakshya + all  |
| K-5 | Production compose: Caddy, migrate step, healthchecks, grace period, `TZ=UTC`, image pin    | 048 057 059     | `docker-compose.prod.yml`, `apps/api/Dockerfile`              | K2 vedant         |
| K-6 | CI hygiene: image push, dependency and image scan, Dependabot, OpenAPI emit and diff        | 031 060         | `.github/`, `tools/`                                          | K3 punya          |
| F4  | Queue registry check, room registry, redis-emitter                                          | 027 039 040     | `infra/queue/`, `realtime/`                                   | vedant (owner)    |
| F5  | Storage module and uploads, platform mailer, orphan sweeper                                 | 017 029 054-056 | new `infra/` module, recorded decision                        | punya (owner)     |

K-4 changes how credentials are stored. The repo's ADR process was removed (commit `4f0c0f83`), so the decision goes in the PR description and in `docs/architecture/` (kernel doc), reviewed by all three owners.

## Build order

1. **Verify what exists** (no kernel edits): INFRA e2e tests for 003, 014, 015, 028; queue-name check (027) as a unit test.
2. **K-1** throttler, body limits, CORS. Unblocks every domain that needs a rate limit (auth, public forms, webhooks).
3. **K-2** Redis coordination helper, so domains stop copying cache-lock idioms (about 200 call sites in WaDesk, catalogued in WD-INFRA-025).
4. **K-3** observability and worker probe.
5. **K-5** production compose and runbook (can run in parallel with 4 by a different person).
6. **K-4** key ring plus recorded decision (decision needed first: D-INFRA-1 below).
7. **K-6** CI hygiene.
8. Catalogues in `docs/` (005, 021, 025, 040) as soon as 2 starts, so other domains can use them.
9. F4/F5 items are tracked on their owners' lists, not here.

## Decisions needed

| #         | Decision                                                                                                   | Recommendation                                                                                           |
| --------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| D-INFRA-1 | Which columns are application-encrypted (message bodies, phone numbers, names) vs RLS plus disk encryption | Credentials only by default; PII stays plaintext under RLS (keeps SQL search); needs a recorded decision |
| D-INFRA-2 | Keep WaDesk `Bearer wsk_` API keys for migrated customers beside `ApiKey prefix.secret`                    | Accept both at the guard for a migration window, issue only the new format                               |
| D-INFRA-3 | Should maintenance, trial and suspension gates also apply to API-key and webhook traffic                   | Maintenance yes (503 with `Retry-After`), trial/suspension on API keys yes, webhooks no                  |
| D-INFRA-4 | Own estimate: `estDays` is 130 in `ownership.json` but the INFRA-owned build is small                      | Re-baseline after K-1 to K-6 are sized by their reviewers; foundation days are on F4/F5                  |

## Risks

- Kernel files (`main.ts`, `app.module.ts`, `env.schema.ts`) are touched by K-1, K-3 and K-5 within a short window: land them
  one at a time, rebase before opening, keep each additive.
- The periodic-work catalogue (040) is only useful if each owning domain adopts it; unowned sweepers silently never run (WaDesk
  already has this problem: SLA breach and escalation stop when no inbox is open).
- Gaps listed under "Target gaps" in the inventory were verified on 2026-10-04; re-verify before starting each K-item because
  the repo moves daily.
- Nothing here was compared against a running WaDesk; the inventory is static analysis only.
