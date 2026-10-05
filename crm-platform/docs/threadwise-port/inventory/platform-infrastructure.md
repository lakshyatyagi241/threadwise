---
domain: platform-infrastructure
code: INFRA
title: Platform Infrastructure (HTTP pipeline, config, runtime services, dependencies, storage, operations)
threadwise_version: '1.7.0'
sources_read: 185
---

# Platform Infrastructure

## Overview

This domain is everything Reference does that is not a product feature but that every feature stands on: how a request enters and is trusted (bootstrap, middleware, proxies, CSRF, CORS, rate limits, error pages), how the app is configured (env keys, `config/*.php`, runtime overrides read from the database), what the framework silently provides (cache as lock service, sessions, encryption with the app key, timezone and hashing defaults), how deferred work really runs, what third-party packages and build tooling exist, where files live on disk, and how the product is deployed and documented. Its users are the platform operator (installing, hosting, upgrading), developers extending the product, and, indirectly, every other domain.

The honest finding is that Reference is a **queue-less, scheduler-less, Redis-less monolith**: the `jobs` table and a configured database queue exist but no job class does; periodic work (SLA breach, escalation, snooze wake, reminders, retries, wipes) rides on the Node bridge heartbeat, a 5-second inbox poll and page loads; the database cache doubles as lock service, throttle and circuit breaker; deferred work is closures run after the HTTP response inside PHP-FPM. The port replaces all of that with BullMQ, outbox events and Redis, so this inventory records each implicit behavior (INFRA-007, INFRA-005 and the periodic-work catalogue) that other domains must re-implement deliberately.

HTTP pipeline in one paragraph: a single bootstrap file (no HTTP kernel, no exception handler class) wires surfaces in a fixed order ending in a `/{workspace-slug}` catch-all; the `web` group carries sessions, CSRF and 17 app middleware, the `api` group only route binding. Cross-cutting policy (maintenance, demo lock, trial gate, idle timeout, 2FA enforcement, session cap) lives in web-only middleware read from system settings, so API-key, mobile, extension and Node-callback traffic bypasses those gates by design. Machine callers authenticate per class and are exempted from CSRF by an 86-entry path list. Rate limiting is inline, with one shared counter per caller across routes.

How it connects: nearly every domain consumes it. Owners of the behavior it only references: `auth-registration-security` (security headers, session middleware), `platform-settings-branding-storage` (settings store, storage disks), `install-update-licensing` (installer, updater, demo mode), `node-bridge-runtime` (bridge process and heartbeat), `developer-rest-api-v1` (REST API behavior), `localization-translation`, `plans-subscriptions-trials` (plan gates and API throttle). **Port ownership:** most target files (`main.ts`, `app.module.ts`, `common/`, `health/`, `config/env.schema.ts`, `infra/{db,redis,queue}/`, `workers/`, `realtime/`, compose, CI) are KERNEL; they change through the kernel-protocol PR (steward K2 Vedant, K3 Punya for CI), not through this domain's PRs. Only `modules/platform-infrastructure/`, `config/domains/platform-infrastructure.env.ts` and the zone in `ownership.json` are INFRA's own. Plan tiers do not change this domain.

## Feature index

| Id           | Feature                                                                                             | Status      | Priority | Effort | Depends on                                                                         |
| ------------ | --------------------------------------------------------------------------------------------------- | ----------- | -------- | ------ | ---------------------------------------------------------------------------------- |
| TW-INFRA-001 | Application bootstrap: route surfaces, middleware groups, aliases and route-file load order         | implemented | P0       | M      | -                                                                                  |
| TW-INFRA-002 | Web request middleware stack: ordered reference with skip conditions                                | implemented | P0       | M      | TW-INFRA-001                                                                       |
| TW-INFRA-003 | Trusted proxies and real-client-IP resolution                                                       | implemented | P0       | S      | TW-INFRA-001                                                                       |
| TW-INFRA-004 | Request-derived base URL, scheme forcing and sub-folder installs                                    | implemented | P2       | S      | TW-INFRA-003                                                                       |
| TW-INFRA-005 | CSRF policy and the exemption catalogue                                                             | implemented | P1       | S      | TW-INFRA-001                                                                       |
| TW-INFRA-006 | Cookie-encryption exceptions and Shopify-embed session cookie relaxation                            | implemented | P2       | S      | TW-INFRA-001, TW-INFRA-005                                                         |
| TW-INFRA-007 | Unauthenticated redirect with deep-link return                                                      | partial     | P1       | S      | TW-INFRA-001                                                                       |
| TW-INFRA-008 | Exception handling and branded HTTP error pages                                                     | implemented | P1       | M      | TW-INFRA-001                                                                       |
| TW-INFRA-009 | Domain exceptions that render their own responses                                                   | implemented | P1       | S      | TW-INFRA-008                                                                       |
| TW-INFRA-010 | Rate limiting: inline throttles, shared-bucket semantics and where limits are absent                | implemented | P1       | M      | TW-INFRA-001                                                                       |
| TW-INFRA-011 | Customer REST API key authentication (`auth.apikey`)                                                | implemented | P0       | M      | TW-INFRA-001, TW-INFRA-010                                                         |
| TW-INFRA-012 | Browser-extension bearer-token authentication (`ExtensionApiAuth`)                                  | implemented | P2       | S      | TW-INFRA-001                                                                       |
| TW-INFRA-013 | Mobile-app workspace, device and sender scoping (`app.workspace`)                                   | implemented | P0       | M      | TW-INFRA-001, TW-INFRA-019                                                         |
| TW-INFRA-014 | CORS policy for API routes                                                                          | implemented | P2       | S      | TW-INFRA-001                                                                       |
| TW-INFRA-015 | Liveness and per-channel health endpoints                                                           | partial     | P1       | S      | TW-INFRA-001                                                                       |
| TW-INFRA-016 | Local-disk file routes (`storage/{path}`) and the public `/storage` mount                           | dead-code   | P2       | S      | TW-INFRA-001                                                                       |
| TW-INFRA-017 | Upload validation: the shared guard and the per-surface matrix                                      | partial     | P0       | L      | TW-INFRA-016                                                                       |
| TW-INFRA-018 | Fatal-error post-mortem tracing and logging control                                                 | partial     | P2       | S      | TW-INFRA-008                                                                       |
| TW-INFRA-019 | Sanctum token guard defaults and the cookie-bootstrap route                                         | partial     | P1       | S      | TW-INFRA-001                                                                       |
| TW-INFRA-020 | Global request-body middleware: path validation, input trimming, empty-to-null and POST size        | implemented | P1       | S      | TW-INFRA-001                                                                       |
| TW-INFRA-021 | Environment variable catalogue (.env.example, config env keys, direct env() reads)                  | implemented | P0       | M      | TW-INFRA-022, TW-INFRA-024, TW-INFRA-025, TW-INFRA-027, TW-INFRA-028, TW-INFRA-029 |
| TW-INFRA-022 | Application identity and runtime config (config/app.php)                                            | partial     | P1       | S      | TW-INFRA-021                                                                       |
| TW-INFRA-023 | Encryption at rest: APP_KEY, encrypted casts, SafeEncrypted and the re-encrypt backfill             | implemented | P0       | L      | TW-INFRA-021                                                                       |
| TW-INFRA-024 | Database connection configuration and the migrations table (config/database.php)                    | implemented | P0       | M      | TW-INFRA-021                                                                       |
| TW-INFRA-025 | Cache store and cache-backed coordination (locks, throttles, rate limits, ephemeral state)          | implemented | P0       | L      | TW-INFRA-021, TW-INFRA-045                                                         |
| TW-INFRA-026 | Session storage, session table usage and cookie settings (config/session.php)                       | implemented | P1       | M      | TW-INFRA-021, TW-INFRA-024                                                         |
| TW-INFRA-027 | Queue configuration and the actual absence of queue workers                                         | partial     | P0       | XL     | TW-INFRA-025, TW-INFRA-040                                                         |
| TW-INFRA-028 | Logging configuration and log conventions                                                           | implemented | P1       | S      | TW-INFRA-021                                                                       |
| TW-INFRA-029 | Mail transport configuration and fallback chain (config/mail.php)                                   | implemented | P0       | M      | TW-INFRA-021, TW-SET-024                                                           |
| TW-INFRA-030 | Unused and dead configuration blocks (services.php and driver stubs)                                | dead-code   | P2       | S      | —                                                                                  |
| TW-INFRA-031 | OpenAPI document generation and developer docs wiring (Scramble)                                    | implemented | P1       | M      | TW-INFRA-021                                                                       |
| TW-INFRA-032 | Meta ad targeting catalogue (config/meta_targeting.php)                                             | partial     | P2       | S      | —                                                                                  |
| TW-INFRA-033 | Storefront host and CNAME target config (config/storefront.php)                                     | implemented | P2       | S      | TW-INFRA-021                                                                       |
| TW-INFRA-034 | Automatic Node-bridge token on outbound HTTP calls                                                  | implemented | P0       | S      | TW-INFRA-043, TW-NODE-002                                                          |
| TW-INFRA-035 | Boot-time domain wiring: auth events, audit observers, policies, Blade directive                    | implemented | P0       | M      | TW-NOTIF-026, TW-AUTH-017, TW-RBAC                                                 |
| TW-INFRA-036 | Model hooks on WABA connection saves (status-flip trace, BSP auto-attach)                           | partial     | P2       | S      | TW-BSP-008, TW-WABA                                                                |
| TW-INFRA-037 | Runtime configuration overrides from the database at boot (mail, real-time, Pusher driver)          | implemented | P1       | M      | TW-SET-001, TW-SET-024, TW-SET-042                                                 |
| TW-INFRA-038 | Add-on boot reconciliation and ModuleServiceProvider                                                | implemented | P2       | M      | TW-ADD-009, TW-ADD-011, TW-ADD-022                                                 |
| TW-INFRA-039 | Real-time channel authorization and event catalogue (routes/channels.php)                           | partial     | P1       | M      | TW-INFRA-037, TW-TIB1-015                                                          |
| TW-INFRA-040 | Scheduler policy and the cron-less periodic work catalogue (routes/console.php)                     | implemented | P0       | XL     | TW-INFRA-025, TW-INFRA-027, TW-NODE-014                                            |
| TW-INFRA-041 | Operator artisan commands not owned by other domains                                                | partial     | P2       | M      | TW-INFRA-040, TW-INFRA-023                                                         |
| TW-INFRA-042 | Framework and package artisan commands (docs, reload, schema:dump, sanctum:prune-expired)           | docs-only   | P2       | S      | —                                                                                  |
| TW-INFRA-043 | Global helper functions (infrastructure subset)                                                     | implemented | P0       | M      | TW-SET-001                                                                         |
| TW-INFRA-044 | Node bridge pairing contract from the Laravel side (shared secret, address, health)                 | implemented | P0       | S      | TW-INFRA-021, TW-INFRA-034, TW-NODE-002                                            |
| TW-INFRA-045 | Framework plumbing tables and what replaces them                                                    | implemented | P1       | S      | TW-INFRA-025, TW-INFRA-026, TW-INFRA-027                                           |
| TW-INFRA-046 | Developer and test runtime profile (phpunit env, composer scripts, test suite)                      | partial     | P2       | S      | TW-INFRA-021                                                                       |
| TW-INFRA-047 | PHP dependency set (composer.json): groups, owners and target equivalents                           | implemented | P1       | M      | —                                                                                  |
| TW-INFRA-048 | Runtime requirements as the code actually uses them (PHP extensions, OS binaries, ini limits)       | implemented | P1       | S      | TW-INFRA-047                                                                       |
| TW-INFRA-049 | Node bridge dependency set (node/package.json) and the two-install model                            | implemented | P1       | M      | TW-NODE-001                                                                        |
| TW-INFRA-050 | Front-end dependency set (root package.json): build tools vs bundled runtime libraries              | implemented | P1       | M      | —                                                                                  |
| TW-INFRA-051 | Front-end build pipeline (Vite 7, Tailwind 4, RTL post-processing, per-page modules)                | implemented | P1       | M      | TW-INFRA-050                                                                       |
| TW-INFRA-052 | Browser bootstrap layer: axios defaults, sub-folder URL patching, password reveal                   | implemented | P2       | S      | TW-INFRA-051                                                                       |
| TW-INFRA-053 | Public web root, entry points and sub-folder installs                                               | implemented | P1       | S      | TW-INFRA-051                                                                       |
| TW-INFRA-054 | Storage layout, filesystem disks and the public-storage link                                        | implemented | P0       | M      | TW-INFRA-053                                                                       |
| TW-INFRA-055 | Upload locations per feature (catalogue)                                                            | implemented | P0       | M      | TW-INFRA-054                                                                       |
| TW-INFRA-056 | Retention and cleanup of files, logs, sessions and framework tables                                 | partial     | P1       | M      | TW-INFRA-054, TW-INFRA-055                                                         |
| TW-INFRA-057 | Deployment and process model (what runs where)                                                      | implemented | P0       | L      | TW-INFRA-048, TW-INFRA-053, TW-INFRA-054                                           |
| TW-INFRA-058 | APP_KEY-bound signed URLs and token-bearing links                                                   | implemented | P2       | S      | TW-INFRA-023, TW-INFRA-053                                                         |
| TW-INFRA-059 | Framework defaults the app silently relies on (timezone, locale, hashing, cache prefixes)           | implemented | P1       | M      | —                                                                                  |
| TW-INFRA-060 | Developer toolchain and the test suite Reference ships                                                 | partial     | P2       | M      | TW-INFRA-047                                                                       |
| TW-INFRA-061 | Developer documentation set: architecture, customization, database schema, third-party integrations | implemented | P2       | M      | TW-INFRA-057                                                                       |
| TW-INFRA-062 | Product documentation site, FAQs, legal and support pages                                           | implemented | P2       | M      | —                                                                                  |

## Features

### TW-INFRA-001 — Application bootstrap: route surfaces, middleware groups, aliases and route-file load order

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** -
- **Summary:** One bootstrap file decides which URL surfaces exist (browser app, admin console, Node/extension callbacks, mobile API, customer REST API, per-channel route files, installed extensions, workspace-slug landing), which middleware group each one runs through, the short names (aliases) routes use to attach guards, and the exact order the route files are loaded. Getting this wrong silently changes which requests get sessions, CSRF checks and throttles, so it is the map every other infrastructure feature hangs off.
- **Actors & access:** none (framework wiring). Applies to every HTTP request. Platform scope.
- **UX & screens:** none.
- **Endpoints:** no routes of its own. The surfaces it mounts (prefix, group, route name prefix):

| Surface                             | URL prefix           | Middleware group / stack                                       | Name prefix           | Source file                                                                                                                             |
| ----------------------------------- | -------------------- | -------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Browser app + public site           | `/`                  | `web`                                                          | (per route)           | `routes/web.php`                                                                                                                        |
| Node-bridge and extension callbacks | `/api`               | `api`                                                          | (per route)           | `routes/api.php`                                                                                                                        |
| Admin console                       | `/admin`             | `web`, `auth`, `admin`, `ip.allowlist`                         | `admin.`              | `routes/admin.php`                                                                                                                      |
| Mobile app API                      | `/api/app`           | `api` (routes add `auth:sanctum` + `app.workspace` themselves) | `app.`                | `routes/app.php`                                                                                                                        |
| Customer REST API                   | `/api/v1`            | `api`, `auth.apikey`, `auth.apikey.throttle`                   | `api.v1.`             | `routes/api_v1.php` (auto-requires `routes/api/v1/*.php`)                                                                               |
| Broadcast auth                      | `/broadcasting/auth` | `web`, `auth`                                                  | -                     | `routes/channels.php` (channel callbacks)                                                                                               |
| Health                              | `/up`                | none                                                           | -                     | framework closure (see TW-INFRA-015)                                                                                                    |
| Installed extensions                | their own            | their own (file is `require`d, not wrapped)                    | their own             | `ExtensionRegistry::routeFiles()`                                                                                                       |
| Core channel files                  | their own            | each file declares its own groups                              | their own             | `routes/bsp.php`, `facebook.php`, `tiktok.php`, `telegram.php`, `line.php`, `wechat.php`, `viber.php`, `mailtrixy-email.php`, `sms.php` |
| In-place add-on modules             | their own            | their own                                                      | their own             | `ModuleLoader::routeFiles()`                                                                                                            |
| Workspace-slug landing              | `/{wsSlug}`          | `web`                                                          | `workspace.slug.open` | closure in the bootstrap file                                                                                                           |

- **Data:** reads `storage/installed` (file), system settings and the extension registry (DB) while booting; no writes.
- **Rules & edge cases:**
  1. Framework: Laravel 12.58 style bootstrap (fluent routing/middleware/exceptions configuration, no HTTP kernel class, no `Exceptions\Handler` class). Add-on modules get their PSR-4 autoloading registered before the app is configured so module controllers referenced by their route files resolve.
  2. Load order is significant: web, api (`/api` prefix), console, then the `then` hook in this order: admin, mobile app, customer REST, enabled extensions, bsp, facebook, tiktok, telegram, line, wechat, viber, mailtrixy-email, sms, in-place modules, and DEAD LAST the workspace-slug catch-all. The catch-all (`GET /{wsSlug}`, slug must match 2-61 chars of letters, digits and hyphens, starting alphanumeric) therefore only sees paths nobody else claimed. A single-segment path such as `/instagram` or `/sms` would be swallowed by it if its owning file loaded later.
  3. Extension route files are only required for extensions that are ENABLED; disabling an extension removes its URLs (not just its nav link). If the database is unreachable the enabled-check returns false so the app still boots and extension pages 404.
  4. Extension and channel route files are `require`d raw, not wrapped in a group, because one file mixes session pages, public webhooks and stateless Node callbacks. Consequence: any route in those files that does not declare its own group gets NO group middleware at all (no session, no CSRF, no `SubstituteBindings`, no throttle).
  5. Global middleware is the framework default set (path-encoding validation, deferred callbacks, trusted proxies, CORS handling, the framework's own `php artisan down` guard with `/up` excepted, post-size check, string trimming, empty-string-to-null). The app adds nothing globally; it only configures trusted proxies (TW-INFRA-003) and cookie-encryption exceptions (TW-INFRA-006). See TW-INFRA-020 for the global input middleware.
  6. `web` group = the six framework defaults (cookie encryption, queued cookies, session start, shared validation errors, CSRF validation, route-binding substitution) with three middleware PREPENDED and fourteen APPENDED. The full ordered list, with owners, is TW-INFRA-002.
  7. `api` group = route-binding substitution ONLY. The app never enables the default API throttle and never enables Sanctum's stateful-SPA mode, so `/api/*` has no session, no CSRF and no rate limit unless a route adds one (TW-INFRA-010).
  8. Aliases registered: `admin` (EnsureUserIsAdmin), `auth.apikey` (AuthenticateApiKey, TW-INFRA-011), `auth.apikey.throttle` (ApiPlanRateLimit), `platform.role`, `workspace.member`, `workspace.role`, `agent.activity`, `app.workspace` (ResolveAppWorkspace, TW-INFRA-013), `plan` (EnforcePlanFeature), `trial`, `install.session` (UseFileSession), `force2fa`, `session.timeout`, `ip.allowlist`, `concurrent.sessions`, `widget.cors`. Framework aliases `auth`, `guest`, `throttle:N,M`, `auth:sanctum` are also used.
  9. QUIRK: the aliases `trial`, `force2fa`, `session.timeout`, `concurrent.sessions` exist for per-route use but the same classes are also appended to the `web` group, so a route that also names them runs them twice (idempotent but wasteful). The `install.session` alias is not attached to any route in v1.7.0 (UseFileSession is effectively dead; the installer relies on EnsureInstalled instead, see TW-INST-001, TW-AUTH-049).
  10. QUIRK: Laravel re-sorts middleware that appear in its priority list (session start, authentication, throttling, route binding) relative to each other when a route adds `auth`/`throttle`. The statically listed order is therefore not guaranteed to be the executed order for those names; confirm with a route listing in the running reference app during parity checks before relying on "X runs before auth". Not verified here (no artisan run).
  11. Many middleware begin with a stat of `storage/installed` and bail out when it is missing; every web request pays that stat several times plus system-setting reads (cached in the cache store, which defaults to the database).
- **Async & events:** `ReconcileSubscription` does its work in the framework's terminate phase, after the response is sent (see TW-INFRA-002). No queues.
- **External systems:** none.
- **Settings:** env `APP_ENV`, `APP_DEBUG`, `APP_URL`, `TRUSTED_PROXIES`, `DEMO_MODE`; `storage/installed` marker; `SystemSetting` keys read by the individual middleware (TW-INFRA-002).
- **Acceptance criteria:**
  - Given a POST to `/api/update-status` with the Node token and no cookies, When it is handled, Then no session cookie is issued and no CSRF check runs (api group; the path is also in the explicit CSRF exemption list, TW-INFRA-005).
  - Given a workspace with slug `my-crm-b46g` and a signed-in member, When they GET `/my-crm-b46g`, Then the catch-all switches their active workspace and redirects to the dashboard; Given the path `/admin`, Then the admin routes answer, not the catch-all.
  - Given an extension is disabled in the admin, When its URL is requested, Then it returns 404 and its routes are absent from the router.
  - Given a request under `/api/v1/*` without an API key, When handled, Then it is rejected by `auth.apikey` before any controller runs (TW-INFRA-011).
  - Given an unknown single-segment path that matches the slug regex but no workspace, Then 404.
- **Source refs:** `bootstrap/app.php`, `bootstrap/providers.php`, `routes/web.php`, `routes/api.php`, `routes/api_v1.php`, `routes/app.php`, `routes/admin.php`, `routes/channels.php`, `routes/console.php`, `app/Providers/ModuleServiceProvider.php`, `app/Providers/AppServiceProvider.php`, `Documentation/pages/developer-guide/architecture.html` (read for the request-flow overview).
- **Port notes:** NestJS equivalents: URL surfaces are controller prefixes/versions (`/v1` internal, `/public/v1` customer API already present; webhook and Node-style callbacks become their own `@Public()` controllers with signature guards), the middleware groups collapse into global guard order. The repo already has this shape: `apps/api/src/app.module.ts` registers `RequestContextMiddleware` for all routes and `APP_GUARD` order `JwtAuthGuard` then `PermissionsGuard` (authentication is opt-out via `@Public()`, which is safer than Reference's per-route opt-in). Do NOT port the workspace-slug catch-all as an API route; resolve `/{slug}` in `apps/web` (Next.js dynamic route) and keep the API free of catch-alls. `app.module.ts`, `main.ts` and `common/` are KERNEL-owned (`_work/schema/ownership.json` kernel list), so any change to global guard/middleware order is a kernel-protocol PR (additive, own PR, named reviewer per `conflict-map.md` section 4), not a domain PR. Per-domain route mounting is already generated through `domains.generated.ts` (kernel).

### TW-INFRA-002 — Web request middleware stack: ordered reference with skip conditions

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week) to reproduce the intent as guards/interceptors; each member has its own feature elsewhere
- **Depends on:** TW-INFRA-001
- **Summary:** Every browser request passes the same ordered chain of 17 app middleware around the framework defaults. This entry is the single place that records the ORDER and each member's "do nothing when ..." condition, so a port can decide where each concern lives (guard, interceptor, edge, or not needed) without re-reading the bootstrap. Behavior of each member is specified once in its owning domain; this entry does not repeat it.
- **Actors & access:** all browser requests (public and authenticated). Platform admins bypass several members as noted.
- **UX & screens:** none; effects surface as redirects, 503 pages, flash messages and response headers.
- **Endpoints:** none. The ordered chain for the `web` group:

| #   | Position  | Middleware                                                                                      | Does nothing when                                                                                                               | Owning feature |
| --- | --------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 1   | prepended | EmbeddedShopifySession                                                                          | request is not a Shopify embed context                                                                                          | TW-INFRA-006   |
| 2   | prepended | EnsureInstalled                                                                                 | never skips: redirects to the installer until `storage/installed` exists, and away from it afterwards                           | TW-INST-001    |
| 3   | prepended | PaddleReturnRedirect                                                                            | no `_ptxn` query value, or not a GET, or path is a payment callback/webhook                                                     | TW-PAYGW-017   |
| 4-9 | framework | cookie encryption, queued cookies, session start, shared errors, CSRF validation, route binding | CSRF skipped for the exemption list                                                                                             | TW-INFRA-005   |
| 10  | appended  | SecurityHeaders                                                                                 | never skips (sets headers after the response is built); skips frame headers for `widget*`                                       | TW-AUTH-045    |
| 11  | appended  | SetLocale                                                                                       | not installed                                                                                                                   | TW-I18N-008    |
| 12  | appended  | ResolveTenantDomain                                                                             | not installed, or host equals the platform host, or host is not a verified custom domain                                        | TW-WSP-013     |
| 13  | appended  | Maintenance                                                                                     | not installed, toggle off, platform staff, or path on the allowlist (login, assets, `up`, `csrf-token`, webhooks, `api/*`, ...) | TW-SET-008     |
| 14  | appended  | ImpersonationBanner                                                                             | not impersonating                                                                                                               | TW-WSP-033     |
| 15  | appended  | RecordAgentActivity                                                                             | not installed or no user/workspace; throttles itself to one write per 30 s per user+workspace via cache                         | TW-TIB1-046    |
| 16  | appended  | CaptureReferral                                                                                 | no valid `ref` query value (letters/digits only, uppercased, max 16 chars)                                                      | TW-WSP-012     |
| 17  | appended  | EnsureUserActive                                                                                | not installed, no user, or platform admin; allowlist of account/verify/logout routes                                            | TW-AUTH-016    |
| 18  | appended  | EnsureTrialActive                                                                               | no user, admin, allowlisted route name, or trial not expired                                                                    | TW-PLAN-015    |
| 19  | appended  | ReconcileSubscription                                                                           | no signed-in user / no current workspace (runs in the terminate phase, after the response)                                      | TW-PAYGW-030   |
| 20  | appended  | SessionTimeout                                                                                  | not installed, guest, remember-me session, or timeout setting <= 0                                                              | TW-AUTH-033    |
| 21  | appended  | Force2FA                                                                                        | not installed, guest, 2FA already confirmed, auth/2FA paths, or no enforcement toggle applies                                   | TW-AUTH-032    |
| 22  | appended  | LimitConcurrentSessions                                                                         | not installed, guest, or cap <= 0; checks once per session per cap value                                                        | TW-AUTH-034    |
| 23  | appended  | DemoMode                                                                                        | demo flag off, method is GET/HEAD, guest, or path on the small allow list                                                       | TW-INST-029    |

The `admin` surface adds route-level `auth`, `admin` (EnsureUserIsAdmin) and `ip.allowlist` (TW-AUTH-038). Per-route aliases `workspace.role`, `workspace.member`, `plan:<key>` (TW-PLAN-019) and `platform.role` are attached in route files.

- **Data:** no tables owned. Members read `SystemSetting` keys (`maintenance_mode`, `security.session_timeout_minutes`, `security.max_concurrent_sessions`, `security.require_2fa_*`, `auto_verify_email`), the `sessions` table, and workspace trial/plan state.
- **Rules & edge cases:**
  1. Order matters in three documented places: the install gate runs before the session starts (no database exists yet); tenant-domain resolution runs before the impersonation banner and the suspended-user bounce so they see the forced workspace; security enforcement (timeout, 2FA, session cap) runs after authentication state is known and before DemoMode.
  2. QUIRK: several members open with the same "is the installer finished" file check, and `Maintenance`, `SetLocale`, `SessionTimeout`, `Force2FA` and `EnsureTrialActive` each read system settings or workspace rows; there is no shared per-request cache of "current user + workspace + settings".
  3. QUIRK: Maintenance, DemoMode, EnsureTrialActive, EnsureUserActive, SessionTimeout, Force2FA and LimitConcurrentSessions exist ONLY in the `web` group. The `api` group (Node callbacks, mobile app, customer REST API, extension API) is not affected by maintenance (except that `api/*` is explicitly allow-listed, so it stays up), the demo write-lock, trial expiry or suspension. A suspended user's API key or mobile token keeps working.
  4. Failure policy: security members are designed to FAIL OPEN (a thrown exception inside Force2FA's owner lookup, SetLocale, EnsureTrialActive, ResolveTenantDomain lookup etc. is swallowed and the request continues). Keep that policy explicit in the port rather than inherited.
  5. Redirect targets used by the chain: installer `/install`, `/login`, `/account/suspended`, `/account/verify-email`, `/account/plans`, `/settings?tab=security`.
- **Async & events:** `ReconcileSubscription` runs after the response is sent; `RecordAgentActivity` writes an `agent_statuses` row at most every 30 s per user and workspace. Audit rows are written by SessionTimeout (`auth.session_timeout`) and LimitConcurrentSessions (`auth.concurrent_sessions_evicted`).
- **External systems:** `ReconcileSubscription` may poll a payment gateway (see TW-PAYGW-030). Otherwise none.
- **Settings:** see the owning features; global switches are `storage/installed`, `DEMO_MODE` env, `maintenance_mode` system setting.
- **Acceptance criteria:**
  - Given maintenance mode is on and a non-staff user, When they request a normal page, Then they get the 503 page; When they request `/up`, `/login` or any `api/*` path, Then the request passes.
  - Given `DEMO_MODE=true` and a signed-in user, When a POST goes to a non-allow-listed path, Then it is refused with the demo message; When the same write is made through `/api/v1/*` with an API key, Then it is NOT refused (demo lock is web-only).
  - Given a user with a trial-expired workspace, When they request a feature page, Then they are redirected to the plans page (402 JSON for AJAX); the same workspace's API key still works.
  - Given the installer is incomplete, When any non-`/install` URL is requested, Then it redirects to `/install` before a session is started.
- **Source refs:** `bootstrap/app.php`, `app/Http/Middleware/*.php` (the 17 classes above), `Documentation/pages/developer-guide/architecture.html`.
- **Port notes:** the port is a token API plus Next.js, so most members vanish or move: install gate (not needed, see TW-INST-001 notes), CSRF (not needed for bearer tokens), SessionTimeout/LimitConcurrentSessions (refresh-token policy in `modules/auth`), Maintenance (a `MaintenanceGuard` plus a status read from Redis/DB so `/health` and webhook paths stay open), DemoMode (a role/flag guard, if wanted), headers (helmet equivalent, TW-INFRA-003/TW-INFRA-014). Decide explicitly whether maintenance and trial/suspension apply to API-key and webhook traffic (Reference: they do not). A global maintenance/demo guard would be a KERNEL change (`common/`, `app.module.ts`), so it needs a kernel-protocol PR; the individual security policies belong to the auth/plans domains' zones.

### TW-INFRA-003 — Trusted proxies and real-client-IP resolution

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-INFRA-001
- **Summary:** Reference runs behind TLS-terminating proxies (Cloudflare tunnels, ngrok, load balancers). It trusts the forwarded-for/host/port/proto headers so the request IP, HTTPS detection and generated URLs reflect the real client. The trusted set is controlled by one env key and defaults to "trust everyone".
- **Actors & access:** infrastructure operator (env). Affects every IP-based control: admin IP allowlist, per-IP throttles, login lockout, audit log IPs.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** none.
- **Rules & edge cases:**
  1. `TRUSTED_PROXIES` is a comma-separated list of IPs/CIDRs. Empty or unset means `*` (trust every peer). A list containing `*` also means trust everyone. Otherwise only the listed peers are trusted and forwarded headers from anyone else are ignored.
  2. Trusted headers: forwarded-for, forwarded-host, forwarded-port, forwarded-proto and the AWS-ELB style set.
  3. QUIRK (security): the default `*` lets any client set `X-Forwarded-For` and thereby choose the IP that the admin IP allowlist, per-IP rate limits, login lockout and audit logging see. The code comments call this a conscious "no-breakage" default and tell operators to pin the edge IP; the shipped `.env.example` does not set `TRUSTED_PROXIES`, so default installs are spoofable.
  4. No trusted-hosts allow-list is configured, so the `Host` header is also attacker-controlled; base URLs are derived from it (TW-INFRA-004).
  5. Both the Laravel `web` and `api` surfaces share this setting (it is applied to global middleware).
- **Async & events:** none.
- **External systems:** the edge proxy / tunnel in front of the app.
- **Settings:** env `TRUSTED_PROXIES` (default empty = `*`).
- **Acceptance criteria:**
  - Given `TRUSTED_PROXIES` is unset, When a request carries `X-Forwarded-For: 1.2.3.4`, Then the app treats 1.2.3.4 as the client IP (documented spoofable default).
  - Given `TRUSTED_PROXIES=10.0.0.0/8` and a request from outside that range carrying `X-Forwarded-For`, Then the header is ignored and the peer address is used.
  - Given a TLS-terminating proxy sending `X-Forwarded-Proto: https`, When the app builds a URL, Then it uses `https`.
- **Source refs:** `bootstrap/app.php`.
- **Port notes:** ALREADY present in the repo: `apps/api/src/main.ts` sets Express `trust proxy` from the `TRUST_PROXY` env key (`config/env.schema.ts`, default `loopback`; a number, a comma list or a keyword), so `req.ip` for `RequestContextMiddleware`, lockout, allowlist and audit follows only the configured proxies. Nothing to build for Reference's trust-all default: keep the restrictive default, and document in the runbook that production behind Caddy must set `TRUST_PROXY` to the proxy hop count or address. Remaining work: a test that a forged `X-Forwarded-For` from an untrusted peer is ignored. KERNEL files (`main.ts`, `env.schema.ts`) are touched only if that test exposes a defect.

### TW-INFRA-004 — Request-derived base URL, scheme forcing and sub-folder installs

- **Status:** implemented
- **Priority:** P2 (nice to have; mostly a shared-hosting accommodation)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-INFRA-003
- **Summary:** On every web request the app recomputes the root URL (scheme + live host + optional sub-folder such as `/public`) and forces the URL generator, the form actions and the public-disk file URL to use it, so one build works on any domain, sub-domain or sub-folder without editing `APP_URL`. A small client script patches `fetch` and XHR so root-relative URLs also carry the sub-folder.
- **Actors & access:** all visitors; operators installing on shared hosting.
- **UX & screens:** layouts (guest, admin, user) emit a meta tag with the sub-folder; the client script `resources/js/lib/base-url.js` reads it, exposes `window.appBase` and `window.appUrl(path)`, and rewrites root-relative `fetch()` and XHR URLs unless already prefixed, absolute, or protocol-relative. It does nothing at a domain root.
- **Endpoints:** none.
- **Data:** none.
- **Rules & edge cases:**
  1. Skipped in CLI/queue contexts (no request).
  2. Sub-folder is derived from the filesystem/server variables (document root vs front-controller directory, falling back to the script path), never from config, so a stale cached config cannot break it. It is dropped when the live request URI does not actually start with it (internal rewrite from a root `.htaccess`). Normalised to `""` or `/sub`, never a bare `/` (which would produce `//x` links).
  3. Scheme: HTTPS is assumed when the request is secure, OR `APP_URL` starts with `https://`, OR `X-Forwarded-Proto` is `https`, OR the server port is 443; otherwise the request's own scheme. A TLS site is never downgraded.
  4. The forced root is `scheme://<live Host header><sub-folder>`; it overrides the URL root and scheme globally and sets the public-disk URL to `<root>/storage`.
  5. QUIRK (security): because the host comes from the request and no trusted-host list exists, a forged `Host` header yields absolute links (password-reset emails, invoice links, webhook callback URLs generated during that request) pointing at the attacker's host. Mail jobs run in CLI/queue context and use `APP_URL` instead, which limits but does not remove exposure.
  6. The mixed-content/redirect-loop fix for TLS-terminating edges relies on TW-INFRA-003 trusting `X-Forwarded-Proto`.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** env `APP_URL`; server variables (`DOCUMENT_ROOT`, `SCRIPT_FILENAME`, `SCRIPT_NAME`, `REQUEST_URI`, `SERVER_PORT`).
- **Acceptance criteria:**
  - Given the app is served at `https://host/public/`, When a page is rendered, Then all links and form actions begin with `/public` and a root-relative `fetch('/devices')` becomes `/public/devices`.
  - Given an HTTPS site behind a proxy that forwards plain HTTP with `X-Forwarded-Proto: https`, Then generated URLs are `https`.
  - Given the app is at a domain root, Then the client patch is inert and no prefix is added.
  - Given a root `.htaccess` that rewrites internally to `/public`, When the browser URL has no `/public`, Then no `/public` prefix is emitted.
- **Source refs:** `app/Providers/AppServiceProvider.php` (base-URL configuration), `app/Support/fc_helpers.php` (`tw_base`), `resources/js/lib/base-url.js`, `resources/views/components/layouts/{guest,admin,user}.blade.php` (meta tag), `bootstrap/app.php`.
- **Port notes:** mostly NOT NEEDED: the port deploys as an API plus Next.js on a single-VM Docker setup (the single-VM deploy design), not shared hosting. Replace with a fixed public origin from env (`APP_URL` already exists in `apps/api/src/config/env.schema.ts`) for every absolute link the API emits (emails, signed links, webhook callback URLs), never the request Host. Next.js `basePath` covers sub-path hosting if ever needed. Nothing here is kernel-protocol work unless a trusted-host check is added in `main.ts` (kernel).

### TW-INFRA-005 — CSRF policy and the exemption catalogue

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-INFRA-001
- **Summary:** All session-based POST/PUT/PATCH/DELETE requests are CSRF-validated except an explicit list of 86 path patterns (85 unique) registered in the bootstrap. Each exemption is justified by a different authentication mechanism (Node shared token, provider HMAC, public capability token, or same-origin session AJAX). This entry classifies them so the port can map each to the right replacement check.
- **Actors & access:** none (policy). Applies to the `web` group only; `api`-group routes never run CSRF validation at all.
- **UX & screens:** none; failure handling is TW-INFRA-008/TW-AUTH-020.
- **Endpoints:** the exemption list, grouped by what authenticates the call:

| Class                                  | Patterns (representative)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Real authentication                                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Deploy tooling                         | `tw-sync`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `X-Sync-Key` header (TW-NODE-053)                                                                                            |
| Same-origin session AJAX               | `team-inbox/api/*`, `chat/api/*`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | session cookie (`SameSite=Lax` blocks cross-site cookie); exempted because stale tabs and `sendBeacon` cannot send the token |
| Public tokenised endpoints             | `widget/*/api/*` (listed twice), `hooks/in/*`, `s/*/checkout`, `s/*/coupon`, `s/*/review`, `s/*/abandon`                                                                                                                                                                                                                                                                                                                                                                                                                  | path token / embed token plus per-IP throttle (TW-INFRA-010)                                                                 |
| Provider webhooks (signature)          | `webhooks/whatsapp/inbound`, `webhooks/instagram`, `webhooks/facebook`, `webhooks/tiktok`, `webhooks/tiktok/business`, `webhooks/tiktok/leads`, `webhooks/wa-calling`, `webhooks/slack/command`, `webhooks/trello`, `webhooks/storefront-pay`, `wa/checkout/webhook/*`, `shopify/webhook/*`, `shopify/compliance`, `woocommerce/webhook/*`, `payment/webhook/*`, `payment/callback/*`, `api/telegram/inbound/*`, `api/line/inbound/*`, `api/wechat/inbound/*`, `api/viber/inbound/*`, `api/sms/inbound`, `api/sms/status` | HMAC/secret/token verified inside each controller                                                                            |
| Node-bridge callbacks (`X-Node-Token`) | `api/update-*` (schedule, scheduled-contact, status, message, broadcast), `api/inbound-message`, `api/whatsapp-settings`, `api/whatsapp-message-settings`, `api/campaigns/*` (6), `api/scheduled/active`, `api/{tiktok,telegram,wechat,viber,email,line,facebook}/flow-*`, `api/appointments/{slots,book}`, `api/commerce/*` (3), `api/flow-node/*` (incl. `google/*`), `api/call-flow/active`, `api/waba-creds`, `api/waba-call/*`, `api/flows/*`                                                                        | shared token checked in controller or route group (TW-NODE)                                                                  |
| Other tokens                           | `api/google/form-response` (`X-Workspace-Token`), `api/v1/sheets-addon/*` (bearer)                                                                                                                                                                                                                                                                                                                                                                                                                                        | token header                                                                                                                 |

- **Data:** none.
- **Rules & edge cases:**
  1. 60 of the 86 entries start with `api/`; those routes already live in the `api` group (no CSRF) and the entries only matter for the few routes declared with `web` middleware or outside a group. They are belt-and-braces; the port should not replicate the list, only the per-class authentication.
  2. QUIRK: not every exempt route proves who is calling. `api/appointments/slots`, `api/appointments/book` and the commerce/flow-node callbacks rely on the Node token being validated inside each controller; a missing check in one controller is an unauthenticated write. Flag these for a signature/token audit in the port.
  3. QUIRK: `GET`/`HEAD` are never CSRF-checked, and logout accepts GET and POST (a drive-by logout is accepted by design).
  4. Guest auth pages (login, register, reset) are NOT exempt; stale-token repair is TW-AUTH-020.
  5. Because exempt `team-inbox/api/*` and `chat/api/*` rely on `SameSite=Lax` cookies alone, the Shopify-embed cookie downgrade (TW-INFRA-006) widens the exposure for a user whose session cookie was issued as `SameSite=None`.
- **Async & events:** none.
- **External systems:** providers listed above (their signature schemes are specified in their own domains).
- **Settings:** none (list is code). Session cookie flags come from `config/session.php` (`SESSION_SAME_SITE` default `lax`, `SESSION_SECURE_COOKIE` defaulting to secure in production).
- **Acceptance criteria:**
  - Given a signed-in user's POST to a normal page with no token, When handled, Then it is rejected as CSRF mismatch (TW-INFRA-008 turns that into a redirect for browsers).
  - Given a POST to `team-inbox/api/...` with the session cookie but no token, Then it is accepted (and fails only on auth/authorization).
  - Given a POST to `webhooks/instagram` with a bad signature, Then it is rejected by the controller (not by CSRF) and with a valid signature it is processed.
  - Given a request to a Node callback without the Node token, Then it is rejected by the token check even though CSRF is exempt.
- **Source refs:** `bootstrap/app.php` (CSRF exception list), `config/session.php`, `routes/web.php`, `routes/api.php`.
- **Port notes:** with bearer-token auth CSRF disappears for the API; for the Next.js BFF cookie session use `SameSite=Lax` plus an Origin/Host check on state-changing requests. The real deliverable is a webhook-authentication checklist: every row above except "Same-origin session AJAX" must have a signature/shared-secret guard in the port (webhook controllers under `@Public()` with a verify step; the repo already enables Nest `rawBody: true` in `main.ts` for exactly this). Webhook modules live in their domains' zones, not kernel; only a cross-cutting signature helper would be a kernel addition.

### TW-INFRA-006 — Cookie-encryption exceptions and Shopify-embed session cookie relaxation

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-INFRA-001, TW-INFRA-005
- **Summary:** Two cookie tweaks in the web stack. (1) Two cookies are read as plaintext instead of being encrypted. (2) When the app is loaded inside the Shopify admin iframe, the middleware `EmbeddedShopifySession` downgrades the session cookie to `SameSite=None; Secure` for that request so the embedded login POST keeps its session (otherwise sign-in 419s).
- **Actors & access:** visitors loading `/shopify*` or arriving from the Shopify admin. Platform scope.
- **UX & screens:** none; the visible symptom of the fix is that Sign in works inside the Shopify iframe.
- **Endpoints:** none of its own (applies to `/shopify`, `/shopify/*`, any request carrying both `host` and `shop`, and auth paths while the marker cookie is present).
- **Data:** cookies only: marker cookie `chatkar_embedded` (value `1`, session-lifetime, path `/`, Secure, HttpOnly, `SameSite=None`, not encrypted); cookie-consent cookie `threadwise_cookie_consent` (plaintext JSON written by browser JS).
- **Rules & edge cases:**
  1. The middleware is PREPENDED so it runs before the session starts: it sets `session.same_site=none` and `session.secure=true` in config for the request, but only when the request is HTTPS (SameSite=None requires Secure; forcing Secure on plain HTTP would lose the session entirely in local dev).
  2. Embed is recognised by: path `shopify` or under `shopify/`; OR both `host` and `shop` query/body values present; OR (marker cookie present AND path is an auth handshake path: `login`, `logout`, `register`, `two-factor`, `forgot-password`, `reset-password`, `password`, or under those).
  3. After the response, if embed and HTTPS and the marker is absent, it sets the marker cookie so the redirect from `/shopify` to `/login` and the login POST are still recognised.
  4. The marker is deliberately not honoured on ordinary pages, so a stray marker cannot keep the downgrade alive for the rest of a browser session.
  5. QUIRK (security): the `host` + `shop` rule applies on ANY path, so a crafted link containing both params makes the response's session cookie `SameSite=None` for whoever follows it. The comments describe the rule as tightly scoped; it is only as tight as "two query params".
  6. QUIRK: `SecurityHeaders` decides "Shopify embed" with a slightly different rule (marker cookie honoured on every path, not only auth paths) to allow framing; the two definitions can disagree. See TW-AUTH-045.
  7. QUIRK: the marker name carries a previous product brand (`chatkar`); keep the literal only if migrating live browsers matters.
  8. Cookie-consent exception exists because the server reads that JSON to decide which analytics trackers to emit; encrypting it would null it each request and analytics would never start.
- **Async & events:** none.
- **External systems:** Shopify admin (iframe host). Domain `shopify-woocommerce` owns the embedded app itself.
- **Settings:** none (`SESSION_SAME_SITE`, `SESSION_SECURE_COOKIE` are the baseline).
- **Acceptance criteria:**
  - Given an HTTPS request to `/shopify` with `host` and `shop`, When the response is sent, Then the session cookie carries `SameSite=None; Secure` and the marker cookie is set.
  - Given the following `POST /login` from inside the iframe with the marker cookie, Then the session cookie is still `SameSite=None` and the login succeeds without a 419.
  - Given a plain HTTP request to `/shopify`, Then the session cookie is unchanged (Lax) and no marker is set.
  - Given the marker cookie on a request to `/team-inbox`, Then the SameSite relaxation is not applied.
  - Given a cookie named `threadwise_cookie_consent` with raw JSON, Then it is readable server-side without decryption.
- **Source refs:** `app/Http/Middleware/EmbeddedShopifySession.php`, `bootstrap/app.php` (prepend and cookie-encryption exceptions), `app/Http/Middleware/SecurityHeaders.php`.
- **Port notes:** only relevant if the Shopify embedded app is ported (domain `shopify-woocommerce`). In the port the iframe session lives in a Next.js route that sets its own cookie with `SameSite=None; Secure` scoped to the embed route prefix only (no query-param trigger). Cookie consent is a client concern in `apps/web`. No API-side work; no kernel file.

### TW-INFRA-007 — Unauthenticated redirect with deep-link return

- **Status:** partial
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-INFRA-001
- **Summary:** When the `auth` middleware rejects a guest, browser GET requests are redirected to `/login?next=/the/path` so the user can be returned to where they were going; everything else goes to plain `/login`. JSON callers get the standard 401 JSON instead.
- **Actors & access:** unauthenticated visitors.
- **UX & screens:** the login page receives a `next` query value (handled in TW-AUTH-001).
- **Endpoints:** no route of its own; fires from the `auth` middleware on any protected route.
- **Data:** none.
- **Rules & edge cases:**
  1. `?next=` is added only when the method is GET, the request does NOT expect JSON, and the current route is not the login route. The value is `/` + the request PATH only (the query string is dropped).
  2. Non-GET or JSON-expecting guests get the bare login URL; for requests that expect JSON the framework answers 401 `{"message":"Unauthenticated."}` instead of redirecting.
  3. QUIRK: "expects JSON" means an `Accept: application/json` header (or an AJAX header). An API/mobile client that omits the header and hits a session-guard route is redirected (302) to `/login` instead of getting 401. The REST documentation tells customers to send the Accept header for this reason.
  4. QUIRK (status partial): the live login controller ignores `next`, so the deep link is generated but not honoured (see TW-AUTH-001 rule on `next`).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a guest, When they GET `/team-inbox`, Then they receive a 302 to `/login?next=%2Fteam-inbox`.
  - Given a guest, When they POST to a protected route, Then they are redirected to `/login` without `next`.
  - Given a guest with `Accept: application/json`, When they request a protected route, Then they receive 401 JSON and no redirect.
  - Given a guest requesting `/login` itself, Then no `next` is appended.
- **Source refs:** `bootstrap/app.php`, `Documentation/pages/developer-guide/rest-api.html` (Accept header guidance).
- **Port notes:** the API already answers 401 problem+json for every unauthenticated call (`JwtAuthGuard` with `AppError.unauthenticated`), regardless of Accept header, which removes this class of ambiguity. The deep-link return belongs to `apps/web` (Next.js middleware redirecting to `/login?next=...` and validating `next` as a same-origin relative path, which Reference never validated). No kernel file; web auth zone.

### TW-INFRA-008 — Exception handling and branded HTTP error pages

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** TW-INFRA-001
- **Summary:** There is no custom exception handler class. The app registers exactly two render hooks (CSRF/419, documented in TW-AUTH-020) and otherwise relies on framework defaults: JSON for callers that ask for JSON, branded Blade pages for browsers. Eight error views share one layout.
- **Actors & access:** every visitor; the 503 page is only produced by the maintenance middleware (TW-SET-008) and the IP-blocked page only by the admin IP allowlist (TW-AUTH-038).
- **UX & screens:** `resources/views/errors/{401,403,404,419,429,500,503,ip-blocked}.blade.php` over `errors/layout.blade.php` (guest layout, brand mark and name, large status code, eyebrow, headline, body, "Go back" button to the previous URL, primary button, support footer link to `/support`).
  - 401 "sign in required"; 403 "no access to this page" (explains role/workspace); 404 "page not found"; 419 "page expired" (see rule 3); 429 "too many requests, wait a minute"; 500 "server error, we logged it"; 503 "down for maintenance" with a primary button that is "Admin sign in" for guests and "Sign out" for signed-in users (so a non-admin can switch to an admin account); ip-blocked is standalone and shows the visitor's IP, tells them to ask a super-admin to add it under the admin security IP allowlist, and offers dashboard and sign-out.
  - Primary button on the others: dashboard when signed in, login otherwise.
  - The layout resolves the brand name inside a guard so a 500 caused by the database being down does not crash the error page itself.
- **Endpoints:** none.
- **Data:** none.
- **Rules & edge cases:**
  1. Status-to-view mapping is by Laravel's standard `errors.<status>` lookup. Statuses without a view (405, 408, 413, 422 as HTTP error, 502 and others) fall back to the framework's built-in plain pages. There is no 413 view although oversize POSTs raise 413 (TW-INFRA-020).
  2. JSON/AJAX callers (Accept JSON or AJAX header) receive framework JSON `{"message": ...}` with the status; with `APP_DEBUG` on, exception class, file, line and trace are added. Validation failures on a JSON request are 422 with the field error bag; on a non-JSON request they redirect back with flashed errors (which is why the REST docs require an Accept header, TW-INFRA-007).
  3. 419: every `TokenMismatchException` and every HTTP exception with status 419 is converted by the bootstrap handler: JSON gets 419 with a "session expired, refresh" message; logout completes and redirects to login; any other browser request regenerates the CSRF token and redirects back with input flashed (never `_token`, `password`, `password_confirmation`) plus a friendly status flash. Consequence: the 419 view is never shown to anyone (dead view).
  4. Reporting: default framework reporting to the configured log channel (TW-INFRA-018). No Sentry/Bugsnag-style integration, no error-reporting settings in the admin. The "we've logged the issue" copy on the 500 page is true only if logging is not disabled (`LOG_LEVEL=off` forces a null log channel).
  5. QUIRK: the doc comment of `PlanLimitReachedException` refers to `App\Exceptions\Handler`, which does not exist in this Laravel 12 layout; the exception renders itself instead (TW-INFRA-009).
  6. Unauthenticated handling is TW-INFRA-007; maintenance JSON is a 503 with `Retry-After: 3600`; the 429 view is shown by the framework's throttle exception for browsers (TW-INFRA-010).
  7. `.env.example` ships `APP_DEBUG=true` and `APP_ENV=local`, while `config/app.php` defaults to production/false when the keys are absent: a copied example file exposes stack traces.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** env `APP_DEBUG`, `APP_ENV`, `LOG_LEVEL`; system setting `maintenance_mode` for the 503 variant.
- **Acceptance criteria:**
  - Given a browser GET to an unknown URL, When handled, Then the branded 404 page renders with a Go-back button and a dashboard/login button.
  - Given a request with `Accept: application/json` to an unknown URL, Then the response is 404 JSON with a `message` and no HTML.
  - Given an unhandled exception in a controller with debug off, Then the 500 page shows no stack trace and the error is written to the log.
  - Given the database is down, When a 500 occurs, Then the error page still renders (brand name falls back to the env app name).
  - Given a browser POST with an expired CSRF token, Then the user is redirected back with the friendly flash and a fresh token, and the 419 page is not shown.
- **Source refs:** `bootstrap/app.php` (exception configuration), `resources/views/errors/*.blade.php`, `config/app.php`, `.env.example`.
- **Port notes:** API side already exists: `apps/api/src/common/filters/problem-exception.filter.ts` is the single exit point emitting RFC 9457 problem+json with a stable `code` and `requestId`; 5xx are logged with stack, 4xx at debug. Keep it; it replaces the JSON half (and removes the Accept-header ambiguity). Web side: `apps/web` `not-found.tsx`, `error.tsx`, `global-error.tsx` and a maintenance page, with the status-specific copy above (translated, per the i18n foundation), 429 and 403 variants driven by the problem `code`. `common/` is KERNEL-owned; adding `PLAN_LIMIT_REACHED`-style codes touches `packages/contracts/src/common/errors.ts` (kernel), so use the kernel-protocol PR (additive).

### TW-INFRA-009 — Domain exceptions that render their own responses

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-INFRA-008
- **Summary:** Three small exception classes carry business failures out of services. Two know how to turn themselves into a response (plan limit reached, assignment target invalid) so any endpoint that forgets to catch them still answers 422 or a flash message instead of a 500. The third (WhatsApp catalog provider failure) does not render itself.
- **Actors & access:** any workspace user or API client whose action trips the rule.
- **UX & screens:** web forms show the message as an error flash after redirecting back; AJAX/JSON/API callers receive a structured 422.
- **Endpoints:** none (fires from many).
- **Data:** none.
- **Rules & edge cases:**
  1. `PlanLimitReachedException` carries a limit key, used and limit values and a reason: `limit_reached`, `quota_reached` or `feature_disabled`. Message text depends on the reason: feature disabled -> "not available on your plan, upgrade"; quota reached (delete-proof quotas such as campaigns) -> upgrade only, never "delete one"; live-count limits (devices, flows) -> upgrade OR delete an existing one. The label is the limit key without `_limit`, underscores to spaces, correctly pluralised.
  2. Rendering: if the request expects JSON or the path starts with `api/`, respond 422 with `ok:false`, `error:"plan_limit_reached"`, `reason`, `key`, `used`, `limit`, `message`; otherwise redirect back with the message in the `error` flash.
  3. `AssignmentTargetException` (reason `user_not_in_workspace` or `team_not_in_workspace`) renders the same way: 422 JSON `ok:false`, `error:"assignment_target_invalid"`, `reason`, translated `message`, or a redirect back with an error flash. Purpose: refuse to silently unassign a chat when the chosen assignee left the workspace.
  4. `WhatsAppCatalogException` wraps a Meta/360dialog catalog failure with a normalised message, numeric code and a raw context array readable via `context()`. It has no render method, so an uncaught instance becomes a 500; callers are expected to catch it.
  5. QUIRK: the 422 for plan limits is reused for "feature disabled on plan", where 402 or 403 would be more accurate; the trial-expired gate uses 402 (TW-INFRA-002). Clients must switch on `error`/`reason`, not on status alone.
- **Async & events:** none.
- **External systems:** Meta Graph / 360dialog (only as the source of the catalog failure).
- **Settings:** none.
- **Acceptance criteria:**
  - Given a workspace at its device limit, When an API client creates another device, Then it receives 422 with `error: plan_limit_reached`, `reason: limit_reached`, `used` and `limit`.
  - Given a browser form that trips the same limit, Then the user returns to the form with the upgrade message and no 500.
  - Given an assignment to a member who was removed from the workspace, Then the response is 422 `assignment_target_invalid` and the conversation's assignee is unchanged.
  - Given a catalog call that fails at the provider, When the exception is not caught, Then the response is 500 (documented gap).
- **Source refs:** `app/Exceptions/PlanLimitReachedException.php`, `app/Exceptions/AssignmentTargetException.php`, `app/Exceptions/WhatsAppCatalogException.php`.
- **Port notes:** map to `AppError` with stable codes in `@crm/contracts` (existing `ERROR_CODES` has no plan-limit or assignment codes; add `PLAN_LIMIT_REACHED`, `ASSIGNMENT_TARGET_INVALID` as 422/403 as decided). `ProblemExceptionFilter` already formats them. The contracts file and `common/errors/app-error.ts` are KERNEL-owned (additive PR); throwing sites live in the plans and inbox domains. `WhatsAppCatalogException` becomes a provider-adapter error mapped inside the WhatsApp provider port (`infra/providers/whatsapp/` is kernel-owned; catalog adapter belongs to the catalog domain's provider folder).

### TW-INFRA-010 — Rate limiting: inline throttles, shared-bucket semantics and where limits are absent

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** TW-INFRA-001
- **Summary:** Reference defines no named rate limiters. Throttling is a mix of framework `throttle:N,M` attachments on selected routes, a custom per-plan limiter for the customer API (TW-PLAN-022), and hand-rolled counters for login lockout and mobile password OTP. This entry catalogues them and the unusual way the numeric form counts.
- **Actors & access:** anonymous visitors (keyed by IP) and signed-in users (keyed by user id).
- **UX & screens:** browsers see the 429 page; AJAX sees JSON; the customer API returns its own JSON envelope with rate headers.
- **Endpoints:** representative `throttle:` attachments (requests per minute):

| Limit           | Routes                                                                                                                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 5               | `register.verify.resend`                                                                                                                                                                                                             |
| 6               | public contact form `POST contact`                                                                                                                                                                                                   |
| 10              | `POST register/verify`; mobile app auth group (`login`, `register`, social callback, passcode verify, forgot, verify-otp, reset, 2FA enable/send/verify/disable); extension `POST api/login`; storefront review; Telegram create-bot |
| 20              | storefront checkout; Telegram QR start and username check                                                                                                                                                                            |
| 30              | storefront coupon and abandon-cart; lead-finder search; AI-CRM copilot message; mobile `chats/{id}/messages`; `tw-sync`                                                                                                              |
| 40              | lead-finder enrich                                                                                                                                                                                                                   |
| 60              | public booking-manage pages (group); widget `message` endpoint; team-inbox unread summary and presence leave                                                                                                                         |
| 120             | public invoice / brief / proposal token pages (group); widget `history`; attributes list API; Telegram QR poll; Telegram inbound webhook group                                                                                       |
| 240             | team-inbox presence ping; LINE, WeChat, Viber and SMS inbound webhook groups                                                                                                                                                         |
| plan-based      | `/api/v1/*` via `auth.apikey.throttle` (TW-PLAN-022: per-plan or global default 600/min, 0 = unlimited, 60-second window, 429 JSON with `Retry-After` and `X-RateLimit-*`)                                                           |
| custom counters | web and mobile login lockout (`lockout_after_failures` default 5 per email+IP within `lockout_window_minutes` default 15; TW-AUTH); mobile password OTP: 5 sends per 15 min, 5 verify attempts, 15-min OTP lifetime                  |

- **Data:** counters live in the cache store (`CACHE_STORE` defaults to `database`, so every hit is a table write; Redis is optional).
- **Rules & edge cases:**
  1. QUIRK (important): the numeric `throttle:N,M` form keys its counter by user id (signed in) or domain+IP (anonymous) ONLY, with no route component. All numeric-throttled routes therefore share ONE bucket per user or IP, and each route merely compares the shared count to its own ceiling. A route capped at 10/min starts returning 429 as soon as the caller has made 10 hits across any throttled routes within the window; busy signed-in tabs (presence pings at up to 240/min, unread polls) can push a user over the lower ceilings of other routes. The port must key limits per route/purpose.
  2. The `api` group has no default throttle and Node-bridge callbacks, most provider webhooks (WhatsApp, Facebook, Instagram, TikTok, Slack, Trello, Shopify, WooCommerce, payments) and flow callbacks are unthrottled. Channel inbound endpoints (LINE, WeChat, Viber, SMS 240/min; Telegram 120/min) are throttled per source IP, which can 429 a legitimate burst from one provider IP.
  3. 429 responses for the numeric form carry the framework headers (`Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`). The customer API sets its own headers on every response, not just 429.
  4. Anonymous buckets depend on a trustworthy client IP (TW-INFRA-003); with the default `*` trust a client rotating `X-Forwarded-For` bypasses all IP throttles.
  5. Public token endpoints (invoice, brief, proposal, booking-manage) rely on unguessable tokens plus these limits; the throttle is the only brute-force defence.
  6. Account lockout counters are separate from throttle counters and clear on a successful login.
- **Async & events:** none. Lockout writes an `auth.lockout` audit row (TW-AUTH).
- **External systems:** cache store (database default; Redis optional).
- **Settings:** system settings `security.api_rate_limit_per_minute` (600), per-plan `api_rate_limit_per_minute`, `security.lockout_after_failures`, `security.lockout_window_minutes`; env `CACHE_STORE`.
- **Acceptance criteria:**
  - Given an anonymous client, When it posts the contact form 7 times in a minute, Then the 7th returns 429.
  - Given an API key on a plan limited to 60/min, When it makes 61 calls in a minute, Then the 61st is 429 with `error.code = rate_limited` and a `Retry-After` header; calls 1-60 carry `X-RateLimit-Remaining`.
  - Given 5 failed logins for one email+IP, Then the sixth is refused with a try-again-in-minutes message and an audit row, even with the correct password.
  - Given the shared-bucket behavior (reference app), When a user makes 12 calls to 60/min routes and then calls a 10/min route, Then that route returns 429 (to be verified in the parity run; the port should NOT reproduce this).
- **Source refs:** `routes/web.php`, `routes/app.php`, `routes/api.php`, `routes/telegram.php`, `routes/line.php`, `routes/wechat.php`, `routes/viber.php`, `routes/sms.php`, `app/Http/Middleware/ApiPlanRateLimit.php`, `app/Http/Controllers/AuthController.php`, `app/Http/Controllers/AuthPagesController.php`, `app/Http/Controllers/Api/App/PasswordController.php`, `config/cache.php`, framework `ThrottleRequests` (signature rule read in `vendor/`).
- **Port notes:** the repo has NO general throttler: no `@nestjs/throttler` dependency, only the per-API-key Redis limiter inside `modules/public-api/api-key.guard.ts` (env `PUBLIC_API_RATE_LIMIT_PER_MINUTE`, per-key `rate_limit_per_minute`). Add a Redis-backed throttler guard (e.g. `@nestjs/throttler` with the existing `ioredis` client) with named policies (`auth`, `public-form`, `webhook`, `api-key`, `ui-poll`), key = route policy + user/IP, and the problem+json `RATE_LIMITED` code (already in `ERROR_CODES`) plus `Retry-After`. A global guard registered in `app.module.ts` plus decorators in `common/decorators` is KERNEL-owned work (kernel-protocol PR, additive); each domain then applies a decorator in its own controllers. Depends on TW-INFRA-003 for correct IPs.

### TW-INFRA-011 — Customer REST API key authentication (`auth.apikey`)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** TW-INFRA-001, TW-INFRA-010
- **Summary:** Every `/api/v1` request must present a workspace API key. The middleware resolves the key, "acts as" the key's owner user with the key's workspace set as current, records last use, and exposes the key to controllers. It is the only authentication in front of the public REST API.
- **Actors & access:** API clients holding a key minted by a workspace user (key management screens belong to the developer/REST domain). Workspace scope = the key's workspace.
- **UX & screens:** none here (developer keys screen is `developer-rest-api-v1`).
- **Endpoints:** applies to the whole `/api/v1/*` surface (middleware chain `api` -> `auth.apikey` -> `auth.apikey.throttle`).
- **Data:** table `api_keys`: `workspace_id`, `user_id` (owner acted as), `name`, `key_hash` (sha256 hex, unique), `prefix` (first 12 characters of the raw key, for display), `scopes` (JSON, null = full access), `last_used_at`, `expires_at`, `revoked_at`, `created_by`, timestamps. Raw keys are `wsk_` plus 40 random characters, shown once at creation.
- **Rules & edge cases:**
  1. The key is read from `Authorization: Bearer <key>`, else the `X-Api-Key` header.
  2. Errors use the envelope `{ "error": { "code", "message" } }`, status 401: `missing_api_key` (nothing sent) and `invalid_api_key` (unknown hash, revoked, expired, or owner user no longer exists - soft-deleted users are excluded).
  3. Active = `revoked_at` null and `expires_at` null or in the future.
  4. On success the owner user is loaded, its `current_workspace_id` is overwritten with the key's workspace in memory, the user becomes the authenticated user and request user, the key is stored on the request, and `last_used_at` is updated with a quiet save on EVERY request (a write per call).
  5. QUIRK: the in-memory workspace override is applied with a force-fill but the "original" attribute is not re-synced (the mobile middleware does sync, TW-INFRA-013). If any code path later saves that user model, the key's workspace could be persisted into the owner's web `current_workspace_id` and flip their browser session. Latent; verify no API v1 path saves the user.
  6. QUIRK: `scopes` are stored and the model offers a scope check, but nothing in the API ever calls it: scopes are not enforced in v1.7.0 (every key is effectively full access).
  7. QUIRK: no check for suspended owner, expired trial or plan feature (`api` group has none of the web gates, TW-INFRA-002 rule 3); only the per-plan rate limit is plan-aware.
  8. Standard v1 envelopes (base controller): success `{ data, meta? }` (201 on create); failure `{ error: { code, message, details? } }`.
- **Async & events:** none (the last-used write is synchronous).
- **External systems:** none.
- **Settings:** per-plan and global API rate limits (TW-INFRA-010).
- **Acceptance criteria:**
  - Given no Authorization header, When calling `GET /api/v1/account`, Then 401 `missing_api_key`.
  - Given a revoked key, Then 401 `invalid_api_key`; Given the same key before revocation, Then 200 and `last_used_at` is updated.
  - Given a key from workspace 7 owned by user U whose web session is on workspace 3, When the key is used, Then the API operates on workspace 7 and U's web workspace stays 3 (guards the quirk above).
  - Given a key created with `scopes = ["messages:send"]`, When it calls a contacts endpoint, Then it succeeds in v1.7.0 (documented non-enforcement; the port must decide).
  - Given the key is passed as `X-Api-Key`, Then authentication succeeds exactly as with Bearer.
- **Source refs:** `app/Http/Middleware/AuthenticateApiKey.php`, `app/Models/ApiKey.php`, `app/Http/Controllers/Api/V1/V1Controller.php`, `routes/api_v1.php`, `bootstrap/app.php`, `database/migrations/2026_06_13_000100_create_api_keys_table.php`, `Documentation/pages/developer-guide/rest-api.html`.
- **Port notes:** an equivalent exists and differs: `apps/api/src/modules/public-api/api-key.guard.ts` uses `Authorization: ApiKey <prefix>.<secret>` (argon2-verified), an HMAC request signature with a replay window, and a per-key Redis rate limit, and sets tenant context from the key. Decide with the `developer-rest-api-v1` domain (owner of `modules/public-api/` per ownership.json) whether to also accept Reference-style `Bearer wsk_...` keys for migrated customers (one-time rehash is impossible from sha256; keep a compat lookup table), and implement scopes properly. Not KERNEL-owned: it lives in the developer-rest-api-v1 zone. Do not "act as" a user in the port; carry an API-key actor (the context type `ActorType` is closed and kernel-owned, so a new actor kind is a kernel PR).

### TW-INFRA-012 — Browser-extension bearer-token authentication (`ExtensionApiAuth`)

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-INFRA-001
- **Summary:** The Chrome extension signs in with email and password and receives an opaque bearer token. This middleware authenticates each later extension call against a hashed token table and binds the token's user as the authenticated user.
- **Actors & access:** a workspace user using the extension. Scope: the user's stored current workspace.
- **UX & screens:** none (extension UI is domain `chrome-extension-sheets-addon`).
- **Endpoints:**

| Endpoint                                                                                                                                   | Route name     | Handler                              | Middleware            | Request             | Response                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | ------------------------------------ | --------------------- | ------------------- | -------------------------------------------------------- |
| GET api/app-config                                                                                                                         | ext.app-config | Api\ExtensionApiController@appConfig | api                   | -                   | `{app_url, app_name}`                                    |
| POST api/login                                                                                                                             | ext.login      | ...@login                            | api, throttle 10/min  | `email`, `password` | `{status, access_token, user{id,name,email}}` or 401/403 |
| POST api/logout                                                                                                                            | ext.logout     | ...@logout                           | api, ExtensionApiAuth | bearer              | `{status: success}`; deletes the presented token         |
| GET api/get-devices, api/attributes, api/get-templates, api/message-history, api/credits, api/get-contact-csv; POST api/send-quick-message | ext.*          | ...@devices etc.                     | api, ExtensionApiAuth | bearer              | feature data (EXT domain)                                |

- **Data:** table `extension_api_tokens`: `user_id`, `token_hash` (sha256), `label`, `last_used_at`, `expires_at` (nullable, added later), timestamps.
- **Rules & edge cases:**
  1. Token = 60 random characters, hashed on storage, plaintext returned once at login. Login issues it with label `browser-extension` and NO expiry (the issue helper supports a TTL but login does not pass one), so tokens live until logout.
  2. Middleware: read bearer token; empty or unknown -> 401 `{status:"error", message:"Unauthenticated."}`; expired (expiry set and past) -> same 401; on success touch `last_used_at`, bind the user as authenticated and request user.
  3. Login rejects bad credentials with 401 (generic message) and soft-deleted accounts with 403 "Account is disabled." It does not check suspension, verified email, 2FA or lockout counters (the web login lockout, TW-AUTH, is not applied).
  4. The workspace is NOT set from the token: calls act on the user's stored `current_workspace_id`, so switching workspace in the web app changes what the extension sees.
  5. The doc comments in the controller say `/api/ext/...`; the live URIs are plain `/api/login`, `/api/logout`, etc.
- **Async & events:** none.
- **External systems:** the extension.
- **Settings:** none.
- **Acceptance criteria:**
  - Given valid credentials, When posting `/api/login`, Then an access token is returned once and a hashed row exists.
  - Given the token, When calling `GET /api/credits`, Then 200 for that user; after `POST /api/logout`, the same token gets 401.
  - Given 11 login attempts in a minute from one IP, Then the 11th is 429 (shared-bucket caveat, TW-INFRA-010).
  - Given a token with a past `expires_at`, Then 401.
  - Given a soft-deleted user's valid password, Then login returns 403.
- **Source refs:** `app/Http/Middleware/ExtensionApiAuth.php`, `app/Models/ExtensionApiToken.php`, `app/Http/Controllers/Api/ExtensionApiController.php`, `routes/api.php`, `database/migrations/2026_07_07_000101_j_add_expires_at_to_extension_api_tokens.php`.
- **Port notes:** endpoints belong to the extension domain; the auth mechanism should be an API-key/PAT style token issued per user and org (hashed, expiring, listed and revocable in settings) rather than a password-for-token endpoint without lockout. No existing equivalent in `apps/api` besides `modules/auth/token.service.ts`; implement as a guard in the extension domain zone, using the same lockout policy as normal login. Not kernel unless a new actor kind is introduced.

### TW-INFRA-013 — Mobile-app workspace, device and sender scoping (`app.workspace`)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** TW-INFRA-001, TW-INFRA-019
- **Summary:** The mobile app holds one bearer token for many workspaces and many senders. This middleware turns the `X-Workspace-Id`, `X-Device-Id` and `X-Sender-Key` request hints into a verified per-request workspace and sender selection, without ever persisting the choice to the user record (which would also switch their web session).
- **Actors & access:** authenticated mobile users (runs after `auth:sanctum`).
- **UX & screens:** none; the app sends headers on every call after picking a workspace and sender.
- **Endpoints:** every route in the authenticated group of `routes/app.php` (prefix `/api/app`, middleware `auth:sanctum` + `app.workspace`); the public mobile routes (login, content, payment landing pages) skip it.
- **Data:** reads `workspace_user` (membership with `joined_at` set), `devices`, `wa_provider_configs`, the sender catalog of the workspace engine service; writes nothing.
- **Rules & edge cases:**
  1. No authenticated user -> pass through (auth middleware already answered 401).
  2. Workspace: `X-Workspace-Id` header, else `workspace_id` in body/query. If present it must belong to a workspace where the user is a JOINED member, else 403 `{success:false, message:"You are not a member of that workspace."}`. The id is set on the in-memory user and the attribute is re-synced as clean so a later user save never persists it. No header -> the token owner's stored current workspace is used.
  3. Device: body `device_id` and header `X-Device-Id` both present and different -> 422 "device_id does not match the selected device". Prevents sending as another device by tampering.
  4. Composite sender key: `sender_key` input, else `X-Sender-Key`, else `X-Device-Id`, in the form `engine:id`. For any non-baileys engine (waba, twilio, telegram, line, wechat, viber, instagram, facebook, sms...) with a numeric id: an explicit body `device_id` as well -> 422 "device_id conflicts with the selected sender". Otherwise the request attributes `app_sender_engine`, `app_sender_id`, `app_sender_key` are set (no existence check; consumers scope by workspace, so a foreign id matches nothing). For `waba` and `twilio` it additionally verifies a provider-config row of that provider in the workspace, then sets `app_provider_config_id` and fills `account_id` input if missing. Processing stops there (no device lookup).
  5. `baileys:127` is unwrapped to device 127.
  6. Plain device resolution: device id = body, else header, else unwrapped key. If the workspace (and user) owns that device: set `app_device_id` and default the `device_id` input to it, so every endpoint sends from the picked sender; an explicit body value wins.
  7. Legacy fallback: older app builds send a bare id for non-baileys senders. If the id is not an owned device, look it up across the workspace's connected senders and, ONLY when exactly one non-baileys sender has that id, pin to it (ids collide across per-channel tables; pinning wrongly is worse than not pinning). Any failure here is swallowed and the request proceeds unscoped.
  8. QUIRK: non-numeric header values coerce to 0 for the device checks, so `X-Device-Id: waba:89` does not trigger the header/body mismatch rule, by design; but an unscoped fallthrough returns the workspace's full lists, not an error.
  9. QUIRK: the mobile group has no maintenance, suspension, trial or plan-feature gate (TW-INFRA-002 rule 3).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a user who is a joined member of workspaces 3 and 7, When calling with `X-Workspace-Id: 7`, Then data is scoped to 7 and the user's web workspace remains unchanged.
  - Given a workspace the user does not belong to (or has an invitation not yet joined), Then 403 with the not-a-member message.
  - Given `X-Device-Id: 5` and body `device_id: 6`, Then 422 mismatch.
  - Given `X-Sender-Key: waba:89` where config 89 is a WABA number of the workspace, Then handlers see sender engine `waba`, id 89, `account_id` 89.
  - Given a bare `X-Device-Id: 20` that is not a device but is exactly one connected non-baileys sender, Then the request is pinned to that sender; if two senders share id 20, Then it is left unpinned.
- **Source refs:** `app/Http/Middleware/ResolveAppWorkspace.php`, `routes/app.php`, `app/Services/WorkspaceEngine.php`, `app/Http/Controllers/Api/App/Concerns/ScopesToSelectedSender.php`.
- **Port notes:** NestJS: an interceptor/guard in `modules/mobile-app-api/` (domain zone, not kernel) that validates a requested org against the caller's memberships and sets it on `RequestContextStore` (today `JwtAuthGuard` takes the org from token claims; header-selected orgs must be validated against membership, never trusted). Senders are channel rows in the channels table (foundation F3, kernel/vedant) so the composite `engine:id` becomes the channel uuid; keep the mismatch/conflict rejections. RLS makes the "foreign id matches nothing" property automatic.

### TW-INFRA-014 — CORS policy for API routes

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-INFRA-001
- **Summary:** The app has no CORS configuration file, so the framework's default policy applies: every route under `/api/*` (and the Sanctum cookie route) answers preflights and adds permissive CORS headers. The chatbot widget's public API uses its own origin-checking middleware instead because it is not under `/api`.
- **Actors & access:** browsers on third-party origins calling Reference APIs.
- **UX & screens:** none.
- **Endpoints:** all `api/*` URIs plus `GET sanctum/csrf-cookie`; widget endpoints `widget/{token}/api/*` use `widget.cors` (TW-WGT-020).
- **Data:** none.
- **Rules & edge cases:**
  1. Default policy (framework file, not overridden): paths `api/*` and `sanctum/csrf-cookie`; any origin (`*`), any method, any request header; no exposed headers; no credentials; max-age 0 (no preflight caching).
  2. Because credentials are not allowed, cookie-authenticated browser calls from other origins are not permitted; bearer-token calls (mobile, REST) work from any origin. The permissive `*` also applies to Node-bridge callbacks, which are not meant for browsers.
  3. Web (non-`/api`) routes have no CORS headers at all: cross-origin XHR to the app UI fails, which is intended.
  4. The widget API echoes the request `Origin` back only when it is on the widget's allowed-domain list and returns 403 otherwise (specified in TW-WGT-020); the Node bridge has its own CORS policy (TW-NODE-003).
  5. QUIRK: `CORS` handling runs as global middleware before maintenance and everything else, so preflights succeed even in maintenance mode.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none (no `config/cors.php` in the project).
- **Acceptance criteria:**
  - Given an OPTIONS preflight from `https://evil.example` to `/api/v1/messages`, When handled, Then it answers with allow-origin `*` and no allow-credentials header.
  - Given a preflight to `/team-inbox/api/send`, Then no CORS headers are returned.
  - Given a request from a non-allowed origin to `widget/{token}/api/message`, Then 403 (widget middleware).
- **Source refs:** framework default `vendor/laravel/framework/config/cors.php` (no project override), `bootstrap/app.php`, `app/Http/Middleware/ChatbotWidgetCors.php`.
- **Port notes:** already present: `apps/api/src/main.ts` calls `enableCors` with `CORS_ORIGINS` (env, comma list; EMPTY list means reflect any origin) and `credentials: true`, exposing `x-request-id`. That is STRICTER-in-intent but unsafe if the env is empty in production: change the empty-list behavior to "deny" for credentialed requests, and give `/public/v1` and webhook controllers separate origin handling (public API: `*` without credentials). Widget origin allow-list per widget is a domain concern (chatbot-widget zone). `main.ts` and `config/env.schema.ts` are KERNEL-owned: kernel-protocol PR.

### TW-INFRA-015 — Liveness and per-channel health endpoints

- **Status:** partial
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-INFRA-001
- **Summary:** Four unauthenticated probe URLs exist: the framework liveness route `/up` and three static "health ping" routes for the Facebook, TikTok and Telegram channel modules. None of them checks a real dependency. Real health (database, cache, queue, Node bridge, engines) lives on admin screens and in the Node bridge, covered by other domains.
- **Actors & access:** anyone (uptime monitors, load balancers, installers). No auth, no permission keys.
- **UX & screens:** `/up` returns a small HTML status page (green "application up" style) with HTTP 200; the channel pings return JSON.
- **Endpoints:**

| Endpoint             | Route name | Handler                                                       | Middleware                    | Request | Response                                                                            |
| -------------------- | ---------- | ------------------------------------------------------------- | ----------------------------- | ------- | ----------------------------------------------------------------------------------- |
| GET up               | -          | framework closure (registered by the `health` routing option) | none (no session, no cookies) | -       | 200 HTML page; 500 if a health listener throws (exception text shown only in debug) |
| GET facebook/_health | -          | closure in `routes/facebook.php`                              | `web`                         | -       | `{"ok":true,"channel":"facebook","version":"1.0.0"}`                                |
| GET tiktok/_health   | -          | closure in `routes/tiktok.php`                                | `web`                         | -       | same shape, `tiktok`                                                                |
| GET telegram/_health | -          | closure in `routes/telegram.php`                              | `web`                         | -       | same shape, `telegram`                                                              |

- **Data:** none.
- **Rules & edge cases:**
  1. `/up` dispatches the framework's health-diagnosing event and renders a fixed page. No listener is registered in the app, so it succeeds even when the database or cache is down: it proves only that PHP booted. The framework excludes `/up` from its own down-mode guard, and the app's maintenance middleware allow-lists `up` explicitly, so it keeps answering during maintenance.
  2. QUIRK: the three `_health` closures return a hard-coded "ok" and version `1.0.0`, ignoring token validity, webhook subscription state or credentials. They sit in the `web` group, so each probe starts a session and (with the default database session driver) writes a `sessions` row; the maintenance middleware does NOT allow-list them, so they return the 503 page during maintenance.
  3. Other health-like URLs belong elsewhere: admin system-health screen and "clear jobs" action (TW-DASH-048..051), BSP probe (TW-BSP-001), WABA account health (TW-WABA-021..022), Node `/health` (TW-NODE-004), Sheets add-on `GET api/v1/sheets-addon/health` (EXT domain), updater post-update health check (TW-INST-025).
  4. Marked `partial` because the advertised "health" has no dependency checks.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the app is running, When `GET /up` is requested without cookies, Then it returns 200 and sets no session cookie.
  - Given the database is stopped, When `GET /up` is requested, Then it still returns 200 (documented weakness).
  - Given maintenance mode is on, Then `/up` returns 200 while `/facebook/_health` returns the 503 maintenance response.
  - Given `GET /telegram/_health`, Then the body is exactly the static JSON above regardless of Telegram configuration.
- **Source refs:** `bootstrap/app.php` (health option), framework `ApplicationBuilder` / `health-up` view, `routes/facebook.php`, `routes/tiktok.php`, `routes/telegram.php`, `app/Http/Middleware/Maintenance.php`.
- **Port notes:** ALREADY BUILT and better: `apps/api/src/health/health.controller.ts` exposes version-neutral `GET /health` (liveness, no dependency checks, uptime and version) and `GET /ready` (primary DB, replica, Redis; 503 when primary or Redis is down) and logging skips both. Only gap: no per-channel readiness (credential/webhook subscription status); that belongs to each channel domain as `GET /v2/<routeBase>/health` per `conflict-map.md` H09 (health module stays kernel-owned; domains expose their own controller). Do not port the static `_health` pings. `health/` is KERNEL-owned.

### TW-INFRA-016 — Local-disk file routes (`storage/{path}`) and the public `/storage` mount

- **Status:** dead-code
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-INFRA-001
- **Summary:** The framework registers `GET storage/{path}` and `PUT storage/{path}` closures for the private `local` disk because that disk is configured to be served. They only answer to signed URLs, and nothing in the app generates such URLs, so they are inert. Public uploads are NOT served by these routes: they are served as static files from `public/storage` (symlink or a real directory) by the web server.
- **Actors & access:** anyone with a signed URL (none issued). Platform scope.
- **UX & screens:** none.
- **Endpoints:**

| Endpoint           | Route name           | Handler                           | Middleware | Request                                                  | Response                                                                                                                                                                                   |
| ------------------ | -------------------- | --------------------------------- | ---------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET storage/{path} | storage.local        | framework closure (file server)   | none       | path (any depth); valid relative signature               | the file with `Cache-Control: no-store` and a locked-down content-security header; 403 (non-production) or 404 (production) without a valid signature; 404 if missing or on path traversal |
| PUT storage/{path} | storage.local.upload | framework closure (file receiver) | none       | query `upload=1` plus valid relative signature; raw body | 204 on write; 404/403 as above                                                                                                                                                             |

- **Data:** `local` disk root `storage/app/private` (used for AI-training source files); `public` disk root `storage/app/public`, URL `<APP_URL>/storage`; `public/storage` link target is `storage/app/public`.
- **Rules & edge cases:**
  1. A private disk (default visibility) requires a valid signature on GET; a GET carrying `upload=true` is refused. A disk with public visibility would be served without signature, but the `local` disk is private and the `public` disk is not served by PHP at all.
  2. The app never calls temporary/signed URL helpers, so both routes are unreachable in practice. Marked dead-code; they still exist as an attack surface and show in the route list.
  3. The static mount is repaired at every boot (documented in TW-SET-040 rule 8): create the target directory; remove a broken symlink; try creating the link; if links are blocked, repoint the `public` disk at a real `public/storage` directory when it is writable and mirror existing files into it.
  4. The maintenance middleware allow-lists `storage/*` so uploaded media keep loading on the maintenance page; the web server's rewrite rules let existing files bypass PHP, and missing ones fall through to these closures (answering 403/404).
  5. Other upload destinations bypass the disks and write straight to `public/uploads/...` (flows, scheduled media, auto-reply media, call recordings, admin auth/frontend images); see TW-INFRA-017.
  6. Access control of uploaded media is therefore "unguessable file name only": any public-disk file is world-readable by URL (tenant isolation by obscurity).
- **Async & events:** none.
- **External systems:** optional cloud storage routing is TW-SET-040.
- **Settings:** env `FILESYSTEM_DISK` (default `local`), `APP_URL`; storage routing settings in TW-SET.
- **Acceptance criteria:**
  - Given an unsigned `GET /storage/anything`, When no static file exists, Then the response is 403 (debug/non-production) or 404 (production).
  - Given a file in `public/storage/avatars/x.png`, When requested, Then the web server serves it directly without touching PHP.
  - Given an unsigned `PUT /storage/x.txt?upload=1`, Then it is rejected and nothing is written.
- **Source refs:** framework `FilesystemServiceProvider` / `ServeFile` / `ReceiveFile` (vendor), `config/filesystems.php`, `app/Providers/AppServiceProvider.php` (static-mount repair), `app/Http/Middleware/Maintenance.php`, `public/.htaccess`.
- **Port notes:** do NOT port these routes. Uploads go to S3/MinIO with signed URLs (foundation F5 "Storage and mail", owner punya); `docker-compose` already carries MinIO per the setup skill. Serve per-tenant objects only through short-lived signed URLs (no world-readable paths). Nest has no equivalent route; no `apps/api` file needed here. Storage client and signed-URL service are foundation/kernel (`infra/`), tracked outside this domain.

### TW-INFRA-017 — Upload validation: the shared guard and the per-surface matrix

- **Status:** partial
- **Priority:** P0 (product unusable without)
- **Effort:** L (<=2 weeks) to centralise
- **Depends on:** TW-INFRA-016
- **Summary:** Every file upload in Reference is validated by Laravel validation rules at the controller; only five surfaces additionally pass through the central `SecureUpload` guard (extension allow-list, blocked list, sniffed-MIME allow-list, randomised stored name). This entry records the guard once (its feature is TW-AUTH-043) and the validation actually applied per surface, so the port can build one upload policy that is at least as strict everywhere.
- **Actors & access:** authenticated users of each surface; two surfaces are API-key clients; admin-only for branding.
- **UX & screens:** none specific; failures surface as field errors or JSON errors from each surface.
- **Endpoints:** none (see surfaces).
- **Data:** files under `storage/app/public/*` (campaign-media, chat-media, wa-templates, wa-queue, branding, brand, blog, contacts, store-products, social, flows, voice-replies, avatars, invoices, payment-proofs, billing, team-chat, pwa, tiktok, facebook, viber/telegram/line broadcast media, meta-campaigns), `storage/app/private` (AI training files) and `public/uploads/{flows,scheduled,autoreply,auto-reply,call-recordings,auth,frontend}`.
- **Rules & edge cases:**
  1. `SecureUpload` guard: stored extension comes only from an allow-list (images jpg/jpeg/png/gif/webp/bmp/tiff; video mp4/webm/mov/3gp/mkv; documents pdf/doc/docx/xls/xlsx/ppt/pptx/txt/csv/rtf/zip; audio mp3/ogg/opus/m4a/aac/wav/amr). A separate block list rejects php-family, phar, htaccess, html/htm/xhtml, svg, xml, js/mjs, cgi, pl, py, sh, exe, bat, com, jsp, asp/aspx. The real content-sniffed MIME (not the client header) must be in a MIME allow-list that includes `application/octet-stream` and `application/zip` (needed for opus/m4a and Office files). Stored name = timestamp + 24 random characters + safe extension. Invalid or empty files return a generic "invalid" message; disallowed extension "type not allowed"; disallowed content "content not allowed".
  2. Surfaces using the guard (in addition to size rules): scheduled-message media (50 MB), flow media upload (50 MB), auto-reply media, `POST /api/v1/media` (16 MB, hosted public URL), API v1 template header media (16 MB).
  3. Representative other surfaces (sizes in the unit used by the rule, kilobytes): team-inbox file 16 384 and voice note 16 384 (type unchecked); chat quick-send media 10 240 (jpg/jpeg/png/gif/webp/mp4/webm/mp3/wav/pdf/doc/docx); template attachment 102 400 (type unchecked); campaigns: image jpg/jpeg/png 2 048, video mp4 16 384, document pdf/doc/docx 16 384, CSV csv/txt 5 120; mobile auto-reply images jpeg/jpg/png/gif 10 240, videos mp4/avi/mov/wmv 51 200, documents 10 240 (type unchecked); mobile chat media 51 200 with a broad type list; mobile queue media 51 200 (type unchecked); social posts image 8 192, video mp4/quicktime 102 400; Facebook video mp4/quicktime 204 800, photos 8 192 each; TikTok video 307 200, photos 20 480 each; contacts CSV 5 120 / 51 200 (text/csv family); contact image 2 048; invoice logo and signature 2 048 images; AI training source 10 240 (type unchecked); team-chat attachment 20 480 (type unchecked); extension image 8 192 (type unchecked); flow import JSON 4 096; admin: extension ZIP 100 MB (zip), favicon 512 and logos 1 024 (png/jpg/ico/svg/webp, SVG allowed), PWA icons png/webp 1 024 / 2 048, auth-page media 20 480 (images/gif/mp4/webm), CSV imports 4 096 - 10 240.
  4. Laravel's `image` rule does not accept SVG by default; `mimes:` checks the sniffed type, not the client name. Rules of the form `file|max:N` only check that it is an uploaded file, not what it is.
  5. QUIRK (risk to verify in parity/security review): surfaces with no type rule store whatever arrives. Where the stored name keeps an extension derived from the content, an executable extension in a web-served directory could be reachable. Only the five guarded surfaces carry an explicit guarantee.
  6. Host limits: PHP `upload_max_filesize` / `post_max_size` and the framework post-size check cap everything; an oversize POST fails with 413 before validation. Facebook and TikTok video forms detect an empty upload and tell the user to raise the server limits or paste a public HTTPS video URL.
  7. Branding uploads may be SVG (admin-trusted); served same-origin, so an SVG with script is an admin-to-admin XSS vector.
  8. No antivirus scan, no image re-encoding, no EXIF stripping, no per-workspace storage quota enforced at upload time (storage limits are plan-level, see TW-PLAN).
  9. Outbound media fetched by URL (not uploads) is guarded separately by the Node bridge (TW-NODE-028).
- **Async & events:** none.
- **External systems:** none (cloud routing: TW-SET-040).
- **Settings:** `php.ini` limits; plan/storage limits in TW-PLAN; allow-lists are constants in code.
- **Acceptance criteria:**
  - Given a scheduled-message upload named `shell.php.png` whose content is PHP, When submitted, Then it is rejected by the guard (blocked or sniffed-MIME mismatch) and nothing is written.
  - Given a `.docx` upload, Then it is accepted (zip container MIME) and stored with a randomised `.docx` name.
  - Given a 60 MB file on the scheduled-message surface, Then it is rejected for size.
  - Given an `.svg` sent to `POST /api/v1/media`, Then 422/validation failure ("type not allowed").
  - Given a campaign image of 3 MB, Then rejected (limit 2 MB); a 2 MB `.png` is accepted.
- **Source refs:** `app/Support/SecureUpload.php`, `app/Http/Controllers/{ScheduledController,FlowsController,AutoReplyController}.php`, `app/Http/Controllers/Api/V1/{MediaController,TemplateController}.php`, `app/Http/Controllers/{TeamInboxController,ChatController,TemplatesController,WaCampaignsController,SocialPostsController,ContactsController,InvoiceSettingsController,AiTrainingController,TeamChatController,AdminPagesController}.php`, `app/Http/Controllers/Api/App/{AutoreplyController,ChatController,QueueController,TemplateController,CampaignController}.php`, `app/Http/Controllers/Api/ExtensionApiController.php`, `app/Http/Controllers/Admin/{ExtensionController,UsersController}.php`, `app/Http/Controllers/{Facebook/FacebookPostController,Tiktok/TiktokPostController}.php`.
- **Port notes:** no upload code of consequence exists in `apps/api` (no multer/file-type dependency; `modules/crm/contact-files` stores metadata incl. `mimeType`). Build ONE upload service (foundation F5, "uploads with quota and MIME checks", owner punya): presigned S3 PUT with server-declared content type and size, post-upload magic-byte sniff in a worker, allow-list by feature (image/video/doc/audio sets above), size caps per feature from this matrix, per-org quota, random object keys, `Content-Disposition: attachment` and no SVG unless explicitly allowed. The guard and storage client are foundation/kernel-adjacent (`infra/`); per-feature allow-lists live in each domain's contracts. Nest's default JSON body limit and any multipart limits must be set explicitly in `main.ts` (kernel).

### TW-INFRA-018 — Fatal-error post-mortem tracing and logging control

- **Status:** partial
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-INFRA-008
- **Summary:** `FatalTrace` is a diagnostic helper that survives a PHP fatal (typically out-of-memory) by recording, from a shutdown function, how many queries ran, the last five statements, memory at named checkpoints and the URL. It is armed on exactly one action today (Meta Ads analytics). A single `LOG_LEVEL` env switch controls all application logging, including turning it off.
- **Actors & access:** operators reading the log; no UI.
- **UX & screens:** none.
- **Endpoints:** none (armed inside the Meta Ads analytics page action, owned by `meta-ads`).
- **Data:** log file `storage/logs/laravel.log` (default `single` channel).
- **Rules & edge cases:**
  1. Arming (`arm(tag)`) is a no-op unless config `diagnostics.fatal_trace` is true (env `FATAL_TRACE`, default TRUE) and only the first arm per process counts. It registers a database query listener (counts all, keeps a ring buffer of the last 5 SQL strings, each cut to 300 characters) and a shutdown function. Checkpoints are added with `mark(label)` (memory in MB and query count).
  2. On shutdown, if the last PHP error was a fatal class (error, parse, core, compile, user error) it raises the memory limit to unlimited (so the log write itself cannot die), then logs an error entry: tag, message, file:line, queries run, last checkpoint, all checkpoints, recent SQL, peak MB, elapsed seconds, full URL. Non-fatal requests write nothing.
  3. Usage today: the Meta Ads analytics action arms with tag `meta-ads.analytics` and marks `picker-loaded`, `view-built:campaign|global`, `aggregate-built`.
  4. Logging control: `LOG_LEVEL` is the only knob. Unset means `debug` (everything). Values `off`, `none`, `false`, `0`, `disabled` force the null channel (nothing is logged, including FatalTrace and error reports) overriding `LOG_CHANNEL`. Default channel `stack` -> `single` file (set `LOG_STACK=daily` for rotation; daily keeps 14 days by default); other channels (slack, papertrail, stderr) are defined but unused by default. Deprecation logging goes to the null channel.
  5. QUIRK: `.env.example` says an unset `LOG_LEVEL` auto-picks `debug` locally and `warning` in production; the config actually defaults to `debug` always, so production logs grow quickly unless an operator sets the level.
  6. QUIRK: a temporary diagnostic observer in the app service provider logs every `wa_provider_configs.status` change with its call site (warning level) - leftover debugging, belongs to the WABA domain.
  7. Marked `partial`: a general-purpose tool wired to one page, intended to be left in place and later switched off via env.
- **Async & events:** shutdown function; no queues.
- **External systems:** none.
- **Settings:** env `FATAL_TRACE` (default true), `LOG_LEVEL` (default debug), `LOG_CHANNEL`, `LOG_STACK`, `LOG_DAILY_DAYS`, `LOG_DEPRECATIONS_CHANNEL`.
- **Acceptance criteria:**
  - Given `FATAL_TRACE=true` and a request on the armed action that exhausts memory, When PHP dies, Then one error log entry with tag, queries run, last checkpoint, peak memory and URL exists.
  - Given `FATAL_TRACE=false`, Then no listener or shutdown function is registered.
  - Given a request on the armed action that completes normally, Then nothing is logged by FatalTrace.
  - Given `LOG_LEVEL=off`, Then no application log lines are written, even for a 500.
- **Source refs:** `app/Support/FatalTrace.php`, `config/diagnostics.php`, `config/logging.php`, `app/Http/Controllers/MetaAdsController.php` (arming), `.env.example`, `app/Providers/AppServiceProvider.php` (comment and status-change observer).
- **Port notes:** Node does not have a PHP-fatal analogue; the equivalents are the existing `nestjs-pino` setup in `app.module.ts` (request id, org and actor on every line, secret redaction, health probes ignored) plus Sentry (`@sentry/node` is a dependency, `SENTRY_DSN` already in the env schema), `process.on('uncaughtException'/'unhandledRejection')` logging, a memory-limit/heap alert, and Node `--max-old-space-size` with an OOM report. Do not port FatalTrace. `app.module.ts`, `main.ts`, `config/env.schema.ts` are KERNEL-owned; wiring Sentry init and process-level handlers is a kernel-protocol PR.

### TW-INFRA-019 — Sanctum token guard defaults and the cookie-bootstrap route

- **Status:** partial
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-INFRA-001
- **Summary:** The mobile API authenticates with Laravel Sanctum personal access tokens on the `auth:sanctum` guard with no project configuration file, so package defaults apply: tokens never expire and carry no prefix. The package also contributes `GET sanctum/csrf-cookie`, which nothing in the product uses.
- **Actors & access:** mobile app users (token issuance at login, TW-MOB); the cookie route is public.
- **UX & screens:** none.
- **Endpoints:**

| Endpoint                | Route name          | Handler                                                    | Middleware | Request | Response                                   |
| ----------------------- | ------------------- | ---------------------------------------------------------- | ---------- | ------- | ------------------------------------------ |
| GET sanctum/csrf-cookie | sanctum.csrf-cookie | Laravel\Sanctum\Http\Controllers\CsrfCookieController@show | web        | -       | 204 and the XSRF cookie (starts a session) |

- **Data:** `personal_access_tokens` (hashed token, name `mobile-app`, abilities, last used). Abilities: admin role -> `["admin"]`, everyone else `["*"]` for the main login paths; some other issuing paths pass no ability list.
- **Rules & edge cases:**
  1. No `config/sanctum.php` in the project: `expiration` is null (tokens live until deleted), stateful domains default to localhost-style values, the guard list is `web`, token prefix empty. A `sanctum:prune-expired` console command is present in the project's command list but prunes nothing while expiration is null.
  2. Logout deletes only the current access token (mobile auth domain owns the rest of the token lifecycle).
  3. Abilities are issued but the routes never check them (`tokenCan` is not used), so the admin ability is cosmetic.
  4. The statically-applied `api` group does not enable stateful SPA mode, so cookie sessions are not accepted on `/api/app/*`.
  5. QUIRK: `GET sanctum/csrf-cookie` is a leftover SPA bootstrap route: it opens a session and writes a `sessions` row per call and is covered by the default CORS paths (TW-INFRA-014).
  6. Marked `partial`: token lifetime, ability checks and device listing/revocation (beyond logout) are missing.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** env `SANCTUM_TOKEN_PREFIX`, `SANCTUM_STATEFUL_DOMAINS` (package defaults).
- **Acceptance criteria:**
  - Given a valid mobile token issued months ago, When used today, Then it still authenticates (no expiry).
  - Given a call to `/api/app/user` without a token, Then 401 JSON `Unauthenticated.` when the client sends an Accept JSON header.
  - Given logout with a token, Then that token row is deleted and the token is rejected afterwards.
- **Source refs:** `composer.json` (laravel/sanctum), `routes/app.php`, `app/Http/Controllers/Api/App/AuthController.php`, `app/Http/Controllers/Api/App/TwoFactorController.php`, `bootstrap/app.php`, framework package defaults (vendor).
- **Port notes:** equivalent is `apps/api/src/modules/auth` (JWT access tokens via `TokenService`, `JwtAuthGuard`); do not copy non-expiring tokens: use short-lived access plus rotating refresh tokens with a listable, revocable device/session table. Mobile specifics (device token, FCM) are domain `mobile-app-api`. Not kernel unless the actor/claims shape changes (`ActorType`, token claims are kernel, decision D5 in the conflict map).

### TW-INFRA-020 — Global request-body middleware: path validation, input trimming, empty-to-null and POST size

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-INFRA-001
- **Summary:** The framework's default global middleware silently normalises every request: a malformed URL encoding is rejected, all string inputs are trimmed, empty strings become null, and bodies larger than the PHP post limit are refused. The app relies on these without declaring them, and they change validation outcomes everywhere.
- **Actors & access:** every request.
- **UX & screens:** none; oversize uploads show as a server error page (no 413 view).
- **Endpoints:** none.
- **Data:** none.
- **Rules & edge cases:**
  1. Path validation: a request path that is not valid UTF-8 after URL-decoding is rejected as a malformed URL (client error) before routing.
  2. Trimming: leading/trailing whitespace is stripped from every string in query and body, except `current_password`, `password` and `password_confirmation`. The app adds no extra exceptions, so any field where whitespace matters (message bodies, template text, WhatsApp message content, CSV cells) is trimmed on input.
  3. Empty strings become null for all inputs, so "optional" validation rules see null rather than `""`, and a client cannot store an empty string through form posts. Together with trimming, a whitespace-only text message arrives as null.
  4. Post size: if the declared content length exceeds PHP's `post_max_size`, a "POST data is too large" error (413) is raised before the route runs, regardless of any per-field `max` rule. Limit is host configuration; Reference sets none in code or `.htaccess`.
  5. QUIRK: JSON bodies are normalised too (strings inside JSON are trimmed and emptied), so API v1 clients cannot send an intentionally empty string.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** PHP `post_max_size`, `upload_max_filesize`, `memory_limit` (server requirements doc); no app setting.
- **Acceptance criteria:**
  - Given a form field `name` of `"  Asha  "`, When submitted, Then validation and storage see `"Asha"`.
  - Given a JSON field `note: ""`, Then the handler sees null.
  - Given a password of `" abc "`, Then it is not trimmed.
  - Given a request whose content length exceeds `post_max_size`, Then 413 before validation.
  - Given `GET /%ff`, Then a client error and no routing.
- **Source refs:** framework default global middleware (`vendor/laravel/framework/src/Illuminate/Foundation/Configuration/Middleware.php` and the trim / empty-to-null / post-size / path-encoding classes), `bootstrap/app.php` (confirms no overrides), `Documentation/pages/installation/server-requirements.html`.
- **Port notes:** Express/Nest does none of this by default. Reproduce deliberately: Zod schemas (`ZodValidationPipe` in `common/pipes`) should `trim()` selected string fields and treat empty strings per field (do NOT blanket-trim message bodies or passwords), and set the body-size limits explicitly in `main.ts` (`rawBody: true` is already on; Express JSON default is 100 kb, which is far below Reference's 16-300 MB upload paths, so uploads must go direct-to-storage, TW-INFRA-017). `main.ts` and `common/pipes` are KERNEL-owned: kernel-protocol PR for body limits; trimming rules go in each domain's contracts.

### TW-INFRA-021 — Environment variable catalogue (.env.example, config env keys, direct env() reads)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** TW-INFRA-022, TW-INFRA-024, TW-INFRA-025, TW-INFRA-027, TW-INFRA-028, TW-INFRA-029
- **Summary:** Reference reads about 150 environment keys: the stock Laravel set in `config/*.php`, a few product-specific keys, and a long tail of keys that application code reads directly with `env()` instead of through config. The shipped `.env.example` is the unmodified Laravel skeleton (68 lines) and documents none of the product keys; the web installer later writes a production `.env` (TW-INST-011) and a separate `node/.env` for the bridge. This entry is the single catalogue of every key, its default, who reads it and whether the Node bridge also reads it.
- **Actors & access:** operator / installer with filesystem access to `.env`. No UI. Admin-panel settings (system settings table, TW-SET-001) override a subset of these at runtime; the override relationship is stated per key group below.
- **UX & screens:** none. Operational notes: after editing `.env` the config cache must be cleared (docs: `config:clear`, then `config:cache` in production); the web installer is the normal way a first `.env` is produced.
- **Endpoints:** none.
- **Data:** none. The installer rewrites `.env` in place by key (replace an existing `KEY=` line or append), see TW-INST-011.
- **Rules & edge cases:**
  1. QUIRK: `.env.example` and code defaults disagree, and the code default is what a fresh install without a key runs on. `APP_DEBUG` example `true`, code `false`; `APP_ENV` example `local`, code `production`; `DB_CONNECTION` example `mysql`, code `sqlite`; `SESSION_LIFETIME` example `120`, code `10080` (7 days); `CACHE_STORE`/`SESSION_DRIVER`/`QUEUE_CONNECTION` example `database`, code `database`. The installer writes its own explicit values (APP_ENV production, APP_DEBUG false, DB mysql, SESSION_DRIVER/CACHE_STORE/QUEUE_CONNECTION database, MAIL_MAILER log, META_GRAPH_VERSION v23.0, SERVER_URL, NODE_WEBHOOK_TOKEN, APP_KEY, APP_TIMEZONE, APP_LOCALE, APP_FALLBACK_LOCALE, DB_*, DB_SOCKET when a unix socket was the working transport).
  2. QUIRK: the installer writes `BROADCAST_DRIVER=log`, but the framework version in use reads `BROADCAST_CONNECTION`, so that line has no effect (the config default is also `log`, so behaviour is unchanged).
  3. QUIRK: the `.env.example` comment says an unset `LOG_LEVEL` auto-picks debug on local and warning on production. `config/logging.php` defaults to `debug` regardless of environment, so a production install with no `LOG_LEVEL` logs everything (see TW-INFRA-028).
  4. QUIRK: `config/app.php` `APP_VERSION` defaults to `1.4.0` (stale; the real version lives in `config/version.php`, 1.7.0). Some public marketing components print `config('app.version')`, so they show 1.4.0 (see TW-INFRA-022).
  5. Many integration keys are read with `env()` straight from controllers and services, bypassing config. That works only while `.env` is not config-cached, because `env()` returns null for keys outside config files once `config:cache` has been run. The docs tell operators to run `config:cache`; the keys that break are marked "direct env()" below and each has a DB-setting or default fallback in most call sites (`SERVER_URL`, `META_APP_SECRET`, `TWILIO_*`), but `META_GRAPH_VERSION` falls back to `v21.0` in code while the installer writes `v23.0`.
  6. Secrets in env: `APP_KEY` (encrypts 144 model columns, TW-INFRA-023), `NODE_WEBHOOK_TOKEN` (shared with the bridge, TW-INFRA-044), DB and mail passwords, AWS keys, `WD_SYNC_KEY`, Pusher secrets, AI provider fallback keys, Twilio token. The Envato token is deliberately kept out of env and config (TW-INST-017).
  7. Keys that exist only in dead config blocks (Beanstalkd, SQS, DynamoDB, Memcached, Reverb, Papertrail, Redis, Postmark, Resend, SES, Slack notifications) have no consumer; see TW-INFRA-030.
- **Async & events:** none.
- **External systems:** none directly; keys configure Meta, Twilio, Pusher, S3, SMTP, AI providers (owner domains).
- **Settings:** the catalogue. Format: `KEY` (code default; notes). "bridge" marks keys the Node bridge also reads.
  - **App / runtime (config/app.php):** `APP_NAME` (`Laravel`; installer writes the chosen product name; also seeds cookie names and cache/redis key prefixes via slug), `APP_ENV` (`production`), `APP_DEBUG` (`false`), `APP_URL` (`http://localhost`; must be the real HTTPS origin, used for media URLs, Twilio callbacks, Meta-fetchable links; bridge also reads it as `APP_URL` fallback for channel flow callbacks), `APP_TIMEZONE` (`UTC`), `APP_LOCALE` (`en`), `APP_FALLBACK_LOCALE` (`en`), `APP_FAKER_LOCALE` (`en_US`), `APP_KEY` (none; required), `APP_PREVIOUS_KEYS` (empty; comma list of retired keys the framework tries when decrypting), `APP_MAINTENANCE_DRIVER` (`file`), `APP_MAINTENANCE_STORE` (`database`), `APP_VERSION` (`1.4.0`, stale), `DEMO_MODE` (`false`; read-only live demo guard, TW-INST-029), `TRUSTED_PROXIES` (empty means trust everything `*`; comma list of IPs/CIDRs otherwise; read in `bootstrap/app.php`, see TW-INFRA-001), `BCRYPT_ROUNDS` (example `12`; framework hashing), `PHP_CLI_SERVER_WORKERS` (example only, commented), `VITE_APP_NAME` (example only, front-end build).
  - **Logging (config/logging.php):** `LOG_CHANNEL` (`stack`), `LOG_STACK` (`single`), `LOG_LEVEL` (`debug`; any of `off|none|false|0|disabled` switches logging fully off), `LOG_DEPRECATIONS_CHANNEL` (`null`), `LOG_DEPRECATIONS_TRACE` (`false`), `LOG_DAILY_DAYS` (`14`), `LOG_SLACK_WEBHOOK_URL`, `LOG_SLACK_USERNAME` (APP_NAME), `LOG_SLACK_EMOJI` (`:boom:`), `LOG_PAPERTRAIL_HANDLER`, `PAPERTRAIL_URL`, `PAPERTRAIL_PORT`, `LOG_STDERR_FORMATTER`, `LOG_SYSLOG_FACILITY` (`LOG_USER`).
  - **Database (config/database.php):** `DB_CONNECTION` (`sqlite`; installer writes `mysql`), `DB_URL`, `DB_HOST` (`127.0.0.1`), `DB_PORT` (`3306`; pgsql `5432`), `DB_DATABASE` (`laravel`), `DB_USERNAME` (`root`), `DB_PASSWORD` (empty), `DB_SOCKET` (empty; installer sets it when only a unix socket connects), `DB_CHARSET` (`utf8mb4`), `DB_COLLATION` (`utf8mb4_unicode_ci`), `MYSQL_ATTR_SSL_CA`, `DB_FOREIGN_KEYS` (`true`, sqlite), `DB_SSLMODE` (`prefer`, pgsql).
  - **Redis (config/database.php, unused at runtime):** `REDIS_CLIENT` (`phpredis`), `REDIS_URL`, `REDIS_HOST` (`127.0.0.1`), `REDIS_USERNAME`, `REDIS_PASSWORD`, `REDIS_PORT` (`6379`), `REDIS_DB` (`0`), `REDIS_CACHE_DB` (`1`), `REDIS_PREFIX` (slug of APP_NAME + `-database-`), `REDIS_PERSISTENT` (`false`), `REDIS_CLUSTER` (`redis`), `REDIS_MAX_RETRIES` (`3`), `REDIS_BACKOFF_ALGORITHM` (`decorrelated_jitter`), `REDIS_BACKOFF_BASE` (`100`), `REDIS_BACKOFF_CAP` (`1000`).
  - **Cache (config/cache.php):** `CACHE_STORE` (`database`), `CACHE_PREFIX` (slug of APP_NAME + `-cache-`), `DB_CACHE_CONNECTION`, `DB_CACHE_TABLE` (`cache`), `DB_CACHE_LOCK_CONNECTION`, `DB_CACHE_LOCK_TABLE`, `REDIS_CACHE_CONNECTION` (`cache`), `REDIS_CACHE_LOCK_CONNECTION` (`default`), `MEMCACHED_HOST` (`127.0.0.1`), `MEMCACHED_PORT` (`11211`), `MEMCACHED_PERSISTENT_ID`, `MEMCACHED_USERNAME`, `MEMCACHED_PASSWORD`, `DYNAMODB_CACHE_TABLE` (`cache`), `DYNAMODB_ENDPOINT`.
  - **Queue (config/queue.php):** `QUEUE_CONNECTION` (`database`; installer writes `database`; tests use `sync`), `DB_QUEUE_CONNECTION`, `DB_QUEUE_TABLE` (`jobs`), `DB_QUEUE` (`default`), `DB_QUEUE_RETRY_AFTER` (`90`), `REDIS_QUEUE_CONNECTION` (`default`), `REDIS_QUEUE` (`default`), `REDIS_QUEUE_RETRY_AFTER` (`90`), `BEANSTALKD_QUEUE_HOST` (`localhost`), `BEANSTALKD_QUEUE` (`default`), `BEANSTALKD_QUEUE_RETRY_AFTER` (`90`), `SQS_PREFIX`, `SQS_QUEUE` (`default`), `SQS_SUFFIX`, `QUEUE_FAILED_DRIVER` (`database-uuids`).
  - **Session (config/session.php, claimed by AUTH):** `SESSION_DRIVER` (`database`), `SESSION_LIFETIME` (`10080` minutes; example `120`), `SESSION_EXPIRE_ON_CLOSE` (`false`), `SESSION_ENCRYPT` (`false`), `SESSION_CONNECTION`, `SESSION_TABLE` (`sessions`), `SESSION_STORE`, `SESSION_COOKIE` (slug of APP_NAME + `-session`), `SESSION_PATH` (`/`), `SESSION_DOMAIN` (null), `SESSION_SECURE_COOKIE` (true when APP_ENV is production, otherwise unset), `SESSION_HTTP_ONLY` (`true`), `SESSION_SAME_SITE` (`lax`), `SESSION_PARTITIONED_COOKIE` (`false`).
  - **Auth (config/auth.php, claimed by AUTH):** `AUTH_GUARD` (`web`), `AUTH_PASSWORD_BROKER` (`users`), `AUTH_MODEL` (the User model), `AUTH_PASSWORD_RESET_TOKEN_TABLE` (`password_reset_tokens`), `AUTH_PASSWORD_TIMEOUT` (`10800` seconds). Reset-token expiry (60 min) and throttle (60 s) are hard-coded.
  - **Broadcasting (config/broadcasting.php):** `BROADCAST_CONNECTION` (`log`; flipped to `pusher` at runtime when admin saves Pusher keys, TW-SET-042), `PUSHER_APP_KEY`, `PUSHER_APP_SECRET`, `PUSHER_APP_ID`, `PUSHER_APP_CLUSTER` (`mt1`), `PUSHER_HOST` (`api-<cluster>.pusher.com`), `PUSHER_PORT` (`443`), `PUSHER_SCHEME` (`https`), `REVERB_APP_KEY`, `REVERB_APP_SECRET`, `REVERB_APP_ID`, `REVERB_HOST`, `REVERB_PORT` (`443`), `REVERB_SCHEME` (`https`) (Reverb unused).
  - **Filesystems (config/filesystems.php, claimed by SET):** `FILESYSTEM_DISK` (`local`), `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION` (example `us-east-1`), `AWS_BUCKET`, `AWS_URL`, `AWS_ENDPOINT`, `AWS_USE_PATH_STYLE_ENDPOINT` (`false`). Client media does not use these: the admin cloud-storage settings drive `media_disk()` (TW-SET-040).
  - **Mail (config/mail.php):** `MAIL_MAILER` (`log`), `MAIL_SCHEME`, `MAIL_URL`, `MAIL_HOST` (`127.0.0.1`; also read directly by the admin users screen), `MAIL_PORT` (`2525`), `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_EHLO_DOMAIN` (host of APP_URL), `MAIL_SENDMAIL_PATH` (`/usr/sbin/sendmail -bs -i`), `MAIL_LOG_CHANNEL`, `MAIL_FROM_ADDRESS` (`hello@example.com`), `MAIL_FROM_NAME` (APP_NAME). Overridden at runtime by admin mail settings (TW-SET-024).
  - **Third-party services (config/services.php, all unused):** `POSTMARK_API_KEY`, `RESEND_API_KEY`, `SLACK_BOT_USER_OAUTH_TOKEN`, `SLACK_BOT_USER_DEFAULT_CHANNEL`.
  - **Product-specific config keys:** `FATAL_TRACE` (`true`, TW-INFRA-018), `WD_SYNC_KEY` (empty = deploy endpoint off, TW-NODE-053), `STOREFRONT_HOST` (host of APP_URL, else `localhost`) and `STOREFRONT_CNAME_TARGET` (same default) (TW-INFRA-033), `API_VERSION` (`v1`, OpenAPI info version, TW-INFRA-031).
  - **Direct env() reads in application code:** `SERVER_URL` (Node bridge base URL; fallback for admin setting `baileys_server_url`; read in about 35 files; default empty, but `http://localhost:8888` in the catalog service), `NODE_WEBHOOK_TOKEN` (bridge shared secret; fallback for admin setting; bridge reads it too), `META_GRAPH_VERSION` (code fallback `v21.0`, installer writes `v23.0`; bridge reads `FACEBOOK_API_VERSION`, fallback `v23.0`), `META_APP_SECRET` (fallback for admin `waba_app_secret`), `FACEBOOK_API_TOKEN` (legacy single-tenant WABA token), `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER` (fallbacks for admin Twilio settings), `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `MISTRAL_API_KEY` (last-resort AI provider keys), `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` (Telegram user-account bridge; bridge reads the same names), `OPENSSL_CONF` (web-push key generation helper).
  - **Seeder-only keys (database/seeders):** `DEMO_SEED_EMAIL` (default `user@mediacity.co.in`), `DEMO_SEED_WS`, `FB_SEED_WS`, `FLOW_SEED_EMAIL`, `FLOW_SEED_WS_ID`, `JESSICA_DEMO_CURRENCY` (`MYR`), `JESSICA_DEMO_WS`, `SMS_SEED_WS`, `SEED_WORKSPACE_ID`, `TG_SEED_WS`, `TT_SEED_WS`. Demo-data tooling only.
  - **Test-only (phpunit.xml):** `APP_ENV=testing`, `CACHE_STORE=array`, `DB_CONNECTION=sqlite` with `:memory:`, `MAIL_MAILER=array`, `QUEUE_CONNECTION=sync`, `SESSION_DRIVER=array`, `BROADCAST_CONNECTION=null`, `BCRYPT_ROUNDS=4`, `APP_MAINTENANCE_DRIVER=file`; `PULSE_ENABLED`, `TELESCOPE_ENABLED`, `NIGHTWATCH_ENABLED` set false for packages that are not installed.
  - **Keys the Node bridge reads (node/.env, process env):** `PORT`, `DOMAIN_NAME`, `APP_DOMAIN_NAME` (Laravel base URL for callbacks), `NODE_WEBHOOK_TOKEN`, `NODE_API_AUTH` (`loopback` | `token` | `off`), `ALLOWED_ORIGINS`, `MEDIA_READ_BASES`, `APP_URL`, `FACEBOOK_API_VERSION`, `BAILEYS_LOG_LEVEL` (`warn`), `THREADWISE_LOGS`, `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `WABA_CALL_TURN_URL`, `WABA_CALL_TURN_USER`, `WABA_CALL_TURN_PASS`, `WABA_CALL_MAX_MIN`, `WABA_CALL_REC_MAX_MIN`, `WABA_CALL_REC_STALE_HOURS`, `AXIOS_MOCK` (test scripts). Detail in TW-NODE-001. The installer writes only `PORT`, `DOMAIN_NAME`, `APP_DOMAIN_NAME`, `NODE_WEBHOOK_TOKEN` there.
- **Acceptance criteria:**
  - Given a deployment with no `.env` entry for `DB_CONNECTION`, when the API boots, then it must refuse to start with a readable list of missing variables rather than defaulting to another engine (the improvement over Reference's silent `sqlite` default).
  - Given an operator sets `LOG_LEVEL=off` (or the pino equivalent `silent`), when the app runs, then no application log lines are emitted.
  - Given `NODE_WEBHOOK_TOKEN` differs between the app and the bridge, when the bridge sends its heartbeat, then it is rejected and scheduled work does not run (see TW-INFRA-040); the port must expose this as a visible health failure.
  - Given every key in this catalogue, when the port's env schema is reviewed, then each key is either mapped to a target variable, replaced by an admin setting, or explicitly dropped in the Port notes.
- **Source refs:** `.env.example`, `config/app.php`, `config/auth.php`, `config/broadcasting.php`, `config/cache.php`, `config/database.php`, `config/diagnostics.php`, `config/filesystems.php`, `config/logging.php`, `config/mail.php`, `config/queue.php`, `config/scramble.php`, `config/services.php`, `config/session.php`, `config/storefront.php`, `config/wdsync.php`, `bootstrap/app.php` (TRUSTED_PROXIES), `app/Http/Controllers/InstallController.php` (env writer), `phpunit.xml`, `node/config/config.js`, `node/routes/index.js`, `app/Services/AiAgentService.php`, `app/Services/WhatsAppDispatcher.php`, `app/Http/Controllers/WaWebhookController.php`, `Documentation/pages/developer-guide/customization.html`.
- **Port notes:** target file `apps/api/src/config/env.schema.ts` is KERNEL-owned (and `config.module.ts`), so new keys needed by this domain go in `apps/api/src/config/domains/platform-infrastructure.env.ts` with the `INFRA_` prefix, optional or defaulted (conflict-map S7c; required vars would force edits to `.env.example` and the CI env block). The repo already validates a zod schema at boot and refuses to start on bad values (better than Reference), and has `DATABASE_URL`, `DATABASE_REPLICA_URL`, `REDIS_URL`, `LOG_LEVEL`, `CORS_ORIGINS`, `S3_*`, `SMTP_*`, `META_GRAPH_VERSION`, `WHATSAPP_*`, `SENTRY_*`, `WORKER_MODE`. Mapping: `APP_URL`/`APP_NAME`/`APP_TIMEZONE`/`APP_LOCALE` stay (APP_URL exists; name, timezone and locale become platform settings in the DB, TW-SET-006), `APP_KEY` becomes `CREDENTIALS_ENCRYPTION_KEY` (TW-INFRA-023), `DB_*` becomes `DATABASE_URL`, `SESSION_*`/`AUTH_*` are dropped (JWT/Clerk), `CACHE_*`/`QUEUE_*`/`REDIS_*` collapse into `REDIS_URL`, `MAIL_*` becomes `SMTP_*` plus a provider adapter, `AWS_*` becomes `S3_*`, `PUSHER_*`/`REVERB_*` are dropped (socket.io, `REDIS_URL` adapter), `SERVER_URL`/`NODE_WEBHOOK_TOKEN` are dropped (the bridge becomes a worker, TW-NODE-001), `WD_SYNC_KEY`, `FATAL_TRACE`, `DEMO_MODE`, `BROADCAST_DRIVER`, seeder keys and test keys are dropped. Domain-owned keys (`TWILIO_*`, `META_APP_SECRET`, AI keys, `TELEGRAM_*`) belong in the owning domain's env fragment, preferably as encrypted per-org settings, not env. Env-only reads via `env()` must not be ported: every read goes through the typed `ConfigService`. Add the production guard-rail pattern already in `validateEnv` for any new secret.

### TW-INFRA-022 — Application identity and runtime config (config/app.php)

- **Status:** partial
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-INFRA-021
- **Summary:** `config/app.php` is the stock Laravel file plus two additions: a live-demo flag and an `APP_VERSION` constant. It fixes the app name, environment, debug flag, URL, default timezone, locale and fallback locale, the cipher/key pair, the list of previous keys and the maintenance-mode driver.
- **Actors & access:** operator via `.env`; code reads via `config('app.*')`.
- **UX & screens:** none directly. Indirect effects: `APP_NAME` is the default product name and seeds cookie and cache key prefixes; `APP_URL` appears in generated links, webhooks URLs shown in admin screens and Twilio/Meta callback URLs; `APP_DEBUG=true` shows full exception pages.
- **Endpoints:** none.
- **Data:** none.
- **Rules & edge cases:**
  1. The product name shown in the UI comes from the admin `app_name` system setting; `APP_NAME` is only the fallback (TW-SET-011). `APP_TIMEZONE` is the storage timezone (default UTC); display timezone is resolved per viewer by `wa_tz()` (TW-SET-046).
  2. QUIRK: `config('app.version')` defaults to `1.4.0` while the real build is `config/version.php` 1.7.0 (`build` 8). The user layout reads `config('version.version')` first, but the public marketing nav, hero and manifesto components read `config('app.version')` with their own fallback strings (`v 4.2`), so the public site shows "updated 1.4.0" unless `APP_VERSION` is set. The installer never writes `APP_VERSION`.
  3. `DEMO_MODE` (default off) is read only by the demo guard middleware (TW-INST-029).
  4. `APP_KEY` + cipher `AES-256-CBC` drive all encrypted columns (TW-INFRA-023). `APP_PREVIOUS_KEYS` is parsed as a comma list with empties removed.
  5. Maintenance mode: the framework `down` driver is `file` and store `database` (only used if the driver is switched to `cache`). The product's own maintenance toggle is a system setting enforced by middleware (TW-SET-008); the framework `artisan down` file is never used by the product.
  6. `APP_URL` can carry a sub-folder; request-time URL forcing makes links work at a domain root or under `/public` (TW-INFRA-004).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `APP_NAME`, `APP_ENV`, `APP_DEBUG`, `APP_URL`, `APP_TIMEZONE`, `APP_LOCALE`, `APP_FALLBACK_LOCALE`, `APP_FAKER_LOCALE`, `APP_KEY`, `APP_PREVIOUS_KEYS`, `APP_MAINTENANCE_DRIVER`, `APP_MAINTENANCE_STORE`, `APP_VERSION`, `DEMO_MODE` (defaults in TW-INFRA-021).
- **Acceptance criteria:**
  - Given `APP_VERSION` is unset, when the public site renders, then no stale version string is shown (the port must source the version from one build constant).
  - Given `APP_DEBUG` is false in production, when an unhandled error occurs, then the response is a generic problem document with a request id and no stack trace.
  - Given an admin changes the product name in platform settings, when any page or email renders, then the new name is used and `APP_NAME` is ignored.
- **Source refs:** `config/app.php`, `config/version.php`, `resources/views/components/frontend/nav.blade.php`, `resources/views/components/frontend/manifesto.blade.php`, `resources/views/components/frontend/hero-features.blade.php`, `resources/views/components/layouts/user.blade.php`, `app/Http/Middleware/DemoMode.php`.
- **Port notes:** already covered by the repo: `NODE_ENV`, `APP_URL`, `PORT` in `apps/api/src/config/env.schema.ts` (KERNEL; changes need a kernel-protocol PR). Name/timezone/locale are tenant or platform settings, not env. Version: read `process.env.npm_package_version` as the health controller does (apps/api/src/health, KERNEL) or inject a build-time constant; do not port `APP_VERSION`. Drop `APP_FAKER_LOCALE`, maintenance driver keys and `DEMO_MODE`.

### TW-INFRA-023 — Encryption at rest: APP_KEY, encrypted casts, SafeEncrypted and the re-encrypt backfill

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** L (<=2 weeks)
- **Depends on:** TW-INFRA-021
- **Summary:** Sensitive columns are encrypted with the application key before they hit MySQL: 110 columns use the stock `encrypted` cast, 25 use `encrypted:array` (JSON), and 9 use a custom forgiving cast that returns the raw stored value instead of throwing when it cannot decrypt. A one-shot command re-encrypts legacy plaintext rows. Names, message bodies, phone numbers and all provider credentials are in scope, which is why filtering and search in SQL are impossible on those columns.
- **Actors & access:** none at runtime (transparent in the model layer); operator runs the backfill command.
- **UX & screens:** none. Symptom surface: before the forgiving cast existed, a row written under another key made list endpoints 500 with a "payload is invalid" decrypt error.
- **Endpoints:** none.
- **Data:** 63 models carry encrypted casts (144 cast declarations). Stock cast and forgiving cast share the same ciphertext format (framework string encryption), so values are interchangeable. Columns on `conversations` (`title`, `preview`), `inbox_messages` (`to_number`, `from_number`, `body`, `translated_body`) and `wp_campaign_contacts.error_message` use the forgiving cast. `messages` columns `body`, `to_number`, `from_number`, `failure_reason` and `conversations.title|preview` are the targets of the backfill.
- **Rules & edge cases:**
  1. Cipher is AES-256-CBC with an HMAC (framework default) keyed by `APP_KEY`; `APP_PREVIOUS_KEYS` lets decrypt succeed for values written under retired keys, but nothing re-encrypts them to the new key.
  2. The forgiving cast: on read, empty/null passes through; a decrypt failure returns the raw column value (plaintext leftovers or ciphertext from a copied database); on write, null stays null and anything else is encrypted as a string. QUIRK: a wrong-key ciphertext is therefore shown to users as base64 gibberish instead of failing.
  3. Backfill command `wasnap:backfill-encrypted` (TW-INFRA-041): dry-run unless `--apply`; `--chunk` clamped to 50..2000, default 200; scans `conversations` and `messages` by id in chunks, detects plaintext by trying to decrypt the raw value, and re-saves only the bad columns through the model with events muted (`saveQuietly`) so the cast encrypts them. It never touches `inbox_messages`.
  4. Some secrets use accessor-based encryption instead of casts (AI key tables return null when stale; mail password uses string encryption and falls back to the raw value on failure; Pusher secret likewise). A key change silently degrades these to "not configured".
  5. Because names, bodies and numbers are encrypted, server-side search is impossible: lists hydrate rows and filter in PHP/JS (TW-SCHED-001 and many others) and device lookup by phone scans every device row (TW-NODE-014).
  6. QUIRK: rotating `APP_KEY` without `APP_PREVIOUS_KEYS` bricks every encrypted column at once; the installer generates the key only when missing.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `APP_KEY`, `APP_PREVIOUS_KEYS`.
- **Acceptance criteria:**
  - Given a stored secret, when it is read after a process restart, then the original value is returned; given a tampered ciphertext, then decryption fails closed.
  - Given a legacy plaintext row, when the backfill runs in dry-run mode, then it reports the row and changes nothing; with apply mode it is stored encrypted and reads back identically.
  - Given a list endpoint touching a row encrypted under a different key, when the list loads, then the request still succeeds (the port should return an explicit "unreadable" marker, not the raw value).
- **Source refs:** `config/app.php`, `app/Casts/SafeEncrypted.php`, `app/Console/Commands/BackfillEncryptedPlaintext.php`, `app/Models/Conversation.php`, `app/Models/InboxMessage.php`, `app/Models/WpCampaignContact.php`, `app/Models/AiProviderKey.php`, `app/Models/AdminAiKey.php`, `app/Models/WaProviderConfig.php`, `app/Support/MailConfig.php`, `app/Support/Licence.php`.
- **Port notes:** the repo already has `CryptoService` (`apps/api/src/common/crypto/crypto.service.ts`, AES-256-GCM, `v1:` versioned format, key `CREDENTIALS_ENCRYPTION_KEY`, production guard against the dev placeholder). Use it for reversible secrets only (channel tokens, gateway credentials). Do not encrypt message bodies and contact fields by default: the RLS tenancy design relies on Postgres RLS for tenant isolation and the port wants SQL search; decide per column and record it (open question). Add key rotation: version prefix per key id (`v2:`) with a re-encrypt job on the worker; never silently return ciphertext. Drop `SafeEncrypted`, the backfill command and `APP_PREVIOUS_KEYS`. Target files `crypto.service.ts` and `env.schema.ts` are KERNEL (common/ and config/); rotation support needs a kernel-protocol PR.

### TW-INFRA-024 — Database connection configuration and the migrations table (config/database.php)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** TW-INFRA-021
- **Summary:** Reference talks to a single MySQL 8 / MariaDB 10.6 database through one connection (utf8mb4, strict mode, no table prefix). The config file also defines unused sqlite, pgsql, sqlsrv and Redis connections and the name of the framework migrations table. There is no read replica, no per-tenant connection and no row-level security: tenancy is a `workspace_id` column enforced in application code.
- **Actors & access:** operator via `.env`; the installer tests and writes the connection (TW-INST-005, TW-INST-006).
- **UX & screens:** none beyond the installer database step.
- **Endpoints:** none.
- **Data:** `migrations` table (framework): id, migration (string), batch (int). 350 migration files exist under `database/migrations` (the first three are the stock `users`, `cache`, `jobs` migrations). Update packages ship their own migrations and a resilient runner (TW-INST-024). A single full-schema dump `Database/1.1.sql` exists for manual imports (TW-INST-027).
- **Rules & edge cases:**
  1. Default connection code value is `sqlite` (matching the skeleton) but the installer always writes `mysql`; `phpunit.xml` uses in-memory sqlite, so tests run on a different SQL dialect than production.
  2. MySQL options: `strict` true, `charset` utf8mb4, `collation` utf8mb4_unicode_ci, `prefix_indexes` true, `engine` default, optional `MYSQL_ATTR_SSL_CA`, optional `DB_SOCKET`, optional `DB_URL` single-string form.
  3. `migrations.update_date_on_publish` true (stock). The Redis connections `default` (db 0) and `cache` (db 1) with retry/backoff settings exist but nothing in the app uses Redis (TW-INFRA-030).
  4. The sessions, cache, queue, failed-jobs and job-batches tables live in the same database as business data (TW-INFRA-045).
  5. No application code opens a second connection; heavy polling endpoints (team inbox queue, heartbeat) all hit the primary.
- **Async & events:** none.
- **External systems:** MySQL/MariaDB.
- **Settings:** `DB_*` keys, `MYSQL_ATTR_SSL_CA`, `DB_SOCKET` (TW-INFRA-021).
- **Acceptance criteria:**
  - Given a valid connection string, when the API boots, then it connects and exposes a readiness probe; given an invalid one, then it refuses to start.
  - Given migrations are applied twice, then the second run is a no-op (the repo's `_migrations` ledger).
  - Given a tenant-scoped query issued without a tenant context, then it returns nothing (RLS), which has no Reference equivalent.
- **Source refs:** `config/database.php`, `database/migrations/0001_01_01_000000_create_users_table.php`, `database/migrations/0001_01_01_000001_create_cache_table.php`, `database/migrations/0001_01_01_000002_create_jobs_table.php`, `Database/1.1.sql`, `phpunit.xml`, `Documentation/pages/installation/server-requirements.html`.
- **Port notes:** replaced wholesale by `packages/db` (Drizzle, hand-written SQL migrations with a `_migrations` ledger, the hand-written SQL migrations rule) and `apps/api/src/infra/db/` (`database.service.ts`; primary + replica, non-superuser app role so RLS applies; all KERNEL). Env: `DATABASE_URL`, `DATABASE_REPLICA_URL`, `MIGRATION_DATABASE_URL`, `DB_POOL_MAX`, `DB_STATEMENT_TIMEOUT_MS` already in `env.schema.ts`. Do not port the Redis blocks, the sqlite test dialect (integration tests should use the real Postgres service from `docker-compose.yml`), the 350-file migration history (schema baseline is translated separately, see the data-model skill) or the single-DB co-location of cache/queue/session data.

### TW-INFRA-025 — Cache store and cache-backed coordination (locks, throttles, rate limits, ephemeral state)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** L (<=2 weeks)
- **Depends on:** TW-INFRA-021, TW-INFRA-045
- **Summary:** The default cache store is the database (`cache` and `cache_locks` tables). It is not just a speed-up: Reference has no queue worker, no scheduler and no Redis, so the cache is also its distributed lock service, its job throttle, its rate limiter, its presence store and its circuit breaker. About 200 call sites use it. Anything the port replaces with Redis must keep these four roles, not just "cache".
- **Actors & access:** none (internal). Admin can only observe it through the health page cache probe (TW-DASH-048).
- **UX & screens:** none. The health page does a write/read round trip with a 10-second key and reports the configured store.
- **Endpoints:** none.
- **Data:** tables `cache` (key, value, expiration) and `cache_locks` (key, owner, expiration) in the main database; keys prefixed with a slug of `APP_NAME` + `-cache-` (changing `APP_NAME` after install silently empties the cache and releases all locks).
- **Rules & edge cases:**
  1. **Settings and registries (read-through, busted on write):** each system setting under its own key for 30 minutes; active-language list 10 minutes; currency by code 60 s, currency rate map 60 s, currency symbol map 5 minutes; message-rate maps 5 minutes; per-extension enabled flag 5 minutes and extension manifest list 5 minutes; marketing-site content table forever (busted on every edit); announcements bundle (busted on admin change); per-workspace send-attribute samples and custom attributes 5 minutes; per-workspace inbox engine scope 5 seconds; team-inbox queue payload 5 seconds; permission cache from the roles package (24 hours, key `spatie.permission.cache`, flushed on role change).
  2. **Distributed locks (`Cache::lock`, owner token, auto-expiry):** campaign schedule sweep (25 s), broadcast retry sweep (25 s), scheduled-message retry sweep (25 s), appointment lifecycle sweep (25 s), per-bot WeChat token refresh (15 s), booking slot reservation keyed by booking type + start timestamp (10 s), WhatsApp Pay webhook per reference (10 s), email campaign runner per campaign (180 s), invoice send per invoice (30 s), Google Calendar sync (10 s). Lock failure means "someone else is doing it": the caller skips.
  3. **Run-at-most-every-N gates (`Cache::add` or has+put, then work deferred):** the inline sweeps of TW-INFRA-040 (inbox escalation 30 s per workspace, Instagram pull 12 s, SLA sweep 60 s global, snooze wake 30 s, deal reminders 60 s, task reminders 60 s, campaign sweep 20 s global); heartbeat gates (device idle logout 1 hour, scheduled sweep 120 s, broadcast sweep 120 s, daily data-retention wipe 24 hours, deal reminder 120 s, stock-hold release 60 s); audit prune 24 hours; invoice sweep 5 minutes; WABA template relink 15 s and import 1 hour; WhatsApp Pay reconcile 60 s; TikTok token refresh 15 minutes per workspace (the Facebook refresh gate, 1 hour, is never invoked); subscription reconciler throttle in hours; Meta block reconcile 10 minutes; campaign page-load sweep 20 s.
  4. **Idempotency and de-duplication windows:** link-click unique IP 1 hour, Trello action id 10 minutes, new-login alert per user+device fingerprint 10 minutes, catalog concierge reply 30 s, notification dispatcher 30 s, web-push burst 3 s, wallet low-balance alert 6 hours, invoice-pending marker 2 days per order.
  5. **Rate limiters (framework `RateLimiter`, stored in the cache):** web login and the auth-pages login use admin-configured max failures and window minutes (hit on failure, cleared on success); mobile login, social login, password OTP send/verify and 2FA verify use fixed constants (examples: 5 attempts per 60 s for 2FA, 20 per 600 s for social); admin-triggered password-reset email (5 per admin per hour); REST API v1 per-plan requests-per-minute bucket with a 60-second window and `X-RateLimit-Remaining` header (TW-API).
  6. **Ephemeral presence and short-lived conversational state:** team-chat typing (8 s) and online (45 s) flags, conversation viewing presence (30 s plus 5), AI-CRM pending confirmation per workspace/user/channel (10 minutes), WooCommerce concierge pending edit (15 minutes), agent activity ping (30 s), campaign-drain-loop-alive marker (90 s, see below).
  7. **External-call caches:** Meta ad interest/geo/locale lookups (6 hours, 7 days, 12 hours), WABA phone ownership check (1 hour), WhatsApp group eligibility (1 hour), Facebook sender profiles (6 hours), lead-finder geocoding (1 day), Instagram flow list (120 s), commerce product search (60 s), SMS number lookup (90 days), translation results (24 hours), WABA template send id (20 days).
  8. **Circuit breaker:** the free MyMemory translator opens for 1 hour after a failure (key `translate:mymemory:breaker`).
  9. **Cross-process flag:** `campaign-drain-loop-alive` is set for 90 s by every call to the bridge's campaign drain endpoint; the heartbeat checks it to decide whether to run the campaign sweep itself (so exactly one of them drives campaigns).
  10. QUIRK: with the database store every gate/lock/limiter is a SQL write on the same MySQL as business data, hit by 5-second inbox polls from every open tab; the docs offer Redis as an optional switch but the code assumes the cache is shared by all PHP workers and the bridge-triggered requests (it would break on a per-process `array` store).
  11. QUIRK: `cache:clear` (run by the updater, TW-INST-025) also drops every lock, every rate-limit counter and every throttle gate at once.
  12. Memcached, DynamoDB, file, array, Octane and failover (database then array) stores are configured but only `database` and `array` (tests) are used.
- **Async & events:** none; this is the substrate for the cron-less scheduler of TW-INFRA-040.
- **External systems:** none for the default store.
- **Settings:** `CACHE_STORE`, `CACHE_PREFIX`, `DB_CACHE_*`, `REDIS_CACHE_*`, `MEMCACHED_*`, `DYNAMODB_*` (TW-INFRA-021); roles package `config/permission.php` cache block (24 h, default store).
- **Acceptance criteria:**
  - Given two workers fire the same sweep at the same instant, when both try to take the sweep lock, then exactly one runs it and the other skips without error.
  - Given a user fails login more times than the admin-configured limit inside the window, when they try again, then the response says how many minutes remain and no password check is made; a successful login clears the counter.
  - Given a gate key set with a 30 s TTL, when a second poll arrives inside 30 s, then the sweep is not scheduled twice; after expiry the next poll schedules it again.
  - Given the settings cache holds a value, when an admin saves that setting, then the next read returns the new value.
- **Source refs:** `config/cache.php`, `config/permission.php`, `app/Models/SystemSetting.php`, `app/Support/LocaleSettings.php`, `app/Support/FormatSettings.php`, `app/Services/CampaignScheduleSweeper.php`, `app/Services/BroadcastSweeper.php`, `app/Services/ScheduledMessageSweeper.php`, `app/Services/Appointments/AppointmentLifecycleSweeper.php`, `app/Http/Controllers/TeamInboxController.php`, `app/Http/Controllers/WaConnectController.php`, `app/Http/Controllers/WaCampaignsController.php`, `app/Http/Controllers/AuthController.php`, `app/Http/Controllers/Api/App/AuthController.php`, `app/Http/Controllers/Api/App/TwoFactorController.php`, `app/Http/Middleware/ApiPlanRateLimit.php`, `app/Services/Inbox/PresenceService.php`, `app/Services/Translation/Drivers/MyMemoryDriver.php`, `app/Services/MetaGraphClient.php`, `app/Listeners/NewLoginAlertListener.php`, `database/migrations/0001_01_01_000001_create_cache_table.php`.
- **Port notes:** the repo already exposes a shared ioredis client (`REDIS_CLIENT` from `apps/api/src/infra/redis/redis.module.ts`, KERNEL, currently used for RBAC grants, idempotency keys and rate-limit counters). Do not recreate `Cache::lock`/`Cache::add` ad hoc in every domain: ask the infra steward (K2) for a kernel-owned `RedisLockService` (SET NX PX with owner token and safe release), a `ThrottleGate`, and a sliding-window rate limiter, all keyed `{env}:{orgId}:...` (kernel-protocol PR to `infra/redis/`). Distributed locks over sweeps largely disappear once the sweeps become BullMQ repeatable jobs (TW-INFRA-040). Settings caches become a small in-process LRU + Redis invalidation pub/sub (or just short TTL). Presence and typing become socket.io room state. External-call caches belong to the owning provider adapter. Tenant-prefix every key; Reference keys that include only a workspace id must keep `orgId` in the target. The 24-hour permission cache is the repo's RBAC grant cache (kernel).

### TW-INFRA-026 — Session storage, session table usage and cookie settings (config/session.php)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** TW-INFRA-021, TW-INFRA-024
- **Summary:** Browser sessions are stored in the `sessions` table by default (file driver only during install). Besides authentication they are queried directly for the "active sessions" list, concurrent-session limits and forced logout. Cookie flags are config-driven; secure cookies switch on automatically in production.
- **Actors & access:** every logged-in browser user; admins and the security settings read the table.
- **UX & screens:** "Active sessions" panels on the account and admin user screens list rows from `sessions` (owned by AUTH/ASHELL); the concurrent session limiter prunes oldest rows when the limit is exceeded.
- **Endpoints:** none of its own (session-bound features: `DELETE settings/sessions/{id}`, admin force-logout, owned by AUTH).
- **Data:** table `sessions` (id, user_id nullable indexed, ip_address, user_agent, payload, last_activity indexed). `password_reset_tokens` (email, token, created_at) is created by the same first migration.
- **Rules & edge cases:**
  1. Driver default `database`; lifetime default 10080 minutes (7 days) unless `SESSION_LIFETIME` is set (the example file says 120, the installer does not write it). An admin-configured idle timeout is enforced separately by middleware (TW-AUTH-037).
  2. Cookie name = slug of `APP_NAME` + `-session`; so renaming the app at install time changes the cookie name; a separate fixed-name file session is used by the install wizard so it survives that rename (TW-INST-001).
  3. `secure` defaults to true when `APP_ENV=production`, otherwise unset (so an HTTP-only production install loses its session unless `SESSION_SECURE_COOKIE=false`); `http_only` true; `same_site` lax; `partitioned` false; `expire_on_close` false; `encrypt` false; cleanup lottery 2 in 100 requests.
  4. Shopify embedded login flips the cookie to SameSite=None; Secure for the iframe case (middleware, owned by Part A/ASHELL).
  5. Several features rely on the session table existing and on `SESSION_DRIVER=database`; `LimitConcurrentSessions` documents that requirement. Truncating `sessions` is the "log everyone out" button in the security center.
  6. The chat/inbox AJAX namespaces are CSRF-exempt because long-open tabs outlive session token rotation (TW-INFRA-001).
- **Async & events:** session garbage collection by lottery; audit events for login/logout (TW-INFRA-035).
- **External systems:** none.
- **Settings:** `SESSION_*` keys (TW-INFRA-021).
- **Acceptance criteria:**
  - Given a user with 3 active sessions and a concurrent-session limit of 2, when a third login succeeds, then the oldest session stops working.
  - Given an admin clicks force-logout on a user, when the user's next request arrives, then it is redirected to login.
  - Given an HTTPS production install, when a session cookie is issued, then it carries Secure, HttpOnly and SameSite=Lax.
- **Source refs:** `config/session.php`, `database/migrations/0001_01_01_000000_create_users_table.php`, `app/Http/Controllers/UserPagesController.php`, `app/Http/Controllers/SettingsTabsController.php`, `app/Http/Controllers/Admin/SecurityController.php`, `app/Http/Controllers/Admin/UsersController.php`, `app/Http/Middleware/LimitConcurrentSessions.php`, `app/Http/Middleware/UseFileSession.php`, `app/Http/Middleware/EnsureInstalled.php`.
- **Port notes:** no server-side session in the target: auth is Clerk-verified credentials exchanged for the repo's own JWT access/refresh pair (`apps/api/src/modules/auth/token.service.ts`, `JWT_ACCESS_TTL` 15m, `JWT_REFRESH_TTL` 30d). The session-management features map to a refresh-token/device-session table owned by the auth domain (TW-AUTH, lakshya): list sessions = list refresh tokens, force logout = revoke, concurrent limit = cap active refresh tokens. Drop the `sessions` table, the cookie flags and the lottery. `SESSION_*` and `AUTH_*` env keys are not ported.

### TW-INFRA-027 — Queue configuration and the actual absence of queue workers

- **Status:** partial
- **Priority:** P0 (product unusable without)
- **Effort:** XL (>2 weeks)
- **Depends on:** TW-INFRA-025, TW-INFRA-040
- **Summary:** `config/queue.php` defaults to the database queue and the installer writes `QUEUE_CONNECTION=database`, but Reference contains no job classes at all and the platform's own code says it is "deliberately queue-less". Asynchronous work happens in three other ways: the Node bridge, deferral to after the HTTP response, and synchronous broadcasting. This entry records what truly runs where so the port can replace each mechanism with BullMQ queues.
- **Actors & access:** none (internal); admin sees pending/failed job counts and a "clear" button on the health page (TW-DASH-051).
- **UX & screens:** health page queue card: driver name, pending rows in `jobs`, failed rows in `failed_jobs`.
- **Endpoints:** none of its own (`POST admin/health/clear-queue` is TW-DASH-051).
- **Data:** tables `jobs` (queue, payload, attempts, reserved_at, available_at, created_at), `job_batches`, `failed_jobs` (uuid unique, connection, queue, payload, exception, failed_at). `app/Jobs/` is an empty directory. See TW-INFRA-045.
- **Rules & edge cases:**
  1. No class implements the queue contract. Mailables (team invite, email verification, admin welcome, support reply) use the queueable trait but not the queue interface, and are sent with `Mail::to()->send()`, i.e. synchronously inside the request. Notification classes do not exist. All broadcast events implement the "broadcast now" interface (synchronous call to Pusher), so nothing is queued.
  2. Deferred execution: (a) `app()->terminating(...)` callbacks run after the response is flushed (inbox polling sweeps, order invoicing/sync/notify hooks in the order model, inbox message post-processing, booking follow-ups); (b) `dispatch(closure)->afterResponse()` runs a closure after the response (campaign start in the campaigns controller, Facebook connect backfill) and, when the PHP runtime lacks `fastcgi_finish_request`, the campaign path runs inline and logs a warning; (c) `WebhookService::emit(event, payload)` registers a terminating callback that calls the static `dispatch()` which POSTs to customer webhook URLs, and falls back to inline when no application lifecycle exists (it is not a Laravel job; see INTG).
  3. Real background execution is the Node bridge: schedules, broadcasts, campaigns, flows and bulk pacing live there and call back into Laravel (TW-NODE-030..040).
  4. Documentation contradicts itself: the Architecture and Installation FAQ pages say a `queue:work` worker is required; the Post-Install page says Reference does not require one; the update guide tells operators to run `queue:restart`; the composer `dev` script starts `queue:listen --tries=1 --timeout=0`. In practice nothing consumes the table. QUIRK: an operator who starts a worker gains nothing; an operator who skips it loses nothing.
  5. Queue config also carries `sync`, `deferred`, `background`, `failover` (database, then deferred), Redis, SQS and Beanstalkd connections (unused), `retry_after` 90 s, `after_commit` false, batching table `job_batches` and failed-job driver `database-uuids`.
  6. Consequence: no retries, no backoff, no dead-letter. Retry logic is bespoke per feature (per-feature `RetryPolicy` in TW-SCHED-027, sweepers re-firing failed rows) and lost work after a PHP crash is simply lost.
- **Async & events:** see rule 2 for the real mechanisms.
- **External systems:** none for the queue itself.
- **Settings:** `QUEUE_CONNECTION`, `DB_QUEUE*`, `REDIS_QUEUE*`, `BEANSTALKD_*`, `SQS_*`, `QUEUE_FAILED_DRIVER` (TW-INFRA-021).
- **Acceptance criteria:**
  - Given an event that Reference would deliver with "broadcast now" semantics, when it is raised inside a request, then the port publishes it through the outbox (transactional) and a worker pushes it to sockets, with retries.
  - Given a campaign is started from the UI, when the HTTP response returns, then the sending continues on a worker (BullMQ `campaign` queue) and survives an API pod restart.
  - Given a job fails five times, then it is kept in a failed set visible to operators and replayable.
- **Source refs:** `config/queue.php`, `app/Jobs/` (empty), `app/Mail/VerifyEmailMail.php`, `app/Mail/TeamInviteMail.php`, `app/Mail/AdminWelcomeMail.php`, `app/Events/Inbox/MessageReceived.php`, `app/Http/Controllers/WaCampaignsController.php`, `app/Http/Controllers/FacebookConnectController.php`, `app/Models/WaOrder.php`, `app/Models/InboxMessage.php`, `app/Http/Controllers/Admin/HealthController.php`, `app/Http/Controllers/InstallController.php`, `composer.json`, `Documentation/pages/developer-guide/architecture.html`, `Documentation/pages/installation/post-install.html`, `Documentation/pages/faqs/installation.html`, `Documentation/pages/update-details/update-process.html`.
- **Port notes:** the target already has the right shape: `apps/api/src/infra/queue/queue.module.ts` + `queues.ts` (BullMQ, defaults `attempts: 5`, exponential backoff 2 s, bounded `removeOnComplete`/`removeOnFail`; KERNEL) and a worker process (`apps/api/src/worker.ts`, `workers/`, the BullMQ worker design; KERNEL) started with `WORKER_MODE`. `queues.ts` now lists about two dozen queues (core ones such as `outbox`, `campaign`, `message-dispatch`, `webhook-ingest`, `billing-posting`, `sla-sweep`, `partition-maintenance`, `bulk-jobs`, plus domain queues like `waba-ingest`, `tg-broadcast`, `ecom-import`, `sched-run`, `media-fetch`) and about ten `*.processor.ts` classes exist in domain modules. The registry grows by hand, so the INFRA deliverable is a startup check that every queue name is unique, prefixed and processed by some worker. Domains register their own queues named `<code>-<purpose>` in their own modules (conflict-map S7d) and put `@Processor` classes in their worker module (S1). Mapping from Reference mechanisms: `terminating`/`afterResponse` closures become outbox events (transactional, the transactional outbox design) consumed by a worker; synchronous broadcast events become outbox events fanned to socket.io via the realtime gateway; synchronous Mail sends become an `email` job (SMTP adapter); bridge-driven sends become `message-dispatch`/`campaign` jobs. Do not port `queue.php`, the `jobs`/`failed_jobs`/`job_batches` tables, `queue:*` operations, or the "clear queue" button as-is (BullMQ dashboard/CLI replaces it; see the data-model note in `partB.notes.md`).

### TW-INFRA-028 — Logging configuration and log conventions

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-INFRA-021
- **Summary:** One config file decides where logs go and how verbose they are. A single `LOG_LEVEL` value is also the master off switch. Application code logs liberally with bracketed tags (`[HEARTBEAT]`, `[CATALOG-SYNC]`, `[WABA-status-change]`, `[RT-TRACE]`...), and two diagnostic traces were left enabled in v1.7.0.
- **Actors & access:** operator reads `storage/logs/laravel.log` (and the Node process manager log).
- **UX & screens:** none. The admin audit log is a separate DB feature (TW-NOTIF-026).
- **Endpoints:** none.
- **Data:** file `storage/logs/laravel.log` (single channel; no rotation by default).
- **Rules & edge cases:**
  1. Level resolution: `LOG_LEVEL` lower-cased and trimmed, default `debug`. Values `off`, `none`, `false`, `0`, `disabled` set the default channel to the null handler and the level to emergency (everything silenced). A comment in the service provider records that an older hidden kill switch was removed so this is the only control.
  2. Default channel `stack` over `LOG_STACK` (default `single`, a comma list allows several). Other defined channels: `daily` (14 days, `LOG_DAILY_DAYS`), `slack` (webhook, level from raw `LOG_LEVEL` defaulting to critical), `papertrail`, `stderr`, `syslog`, `errorlog`, `null`, `emergency`. Deprecations go to `null` unless configured.
  3. QUIRK: the example file's promise of environment-dependent defaults is false (see TW-INFRA-021 rule 3); on production a default install writes debug logs to one ever-growing file.
  4. QUIRK: two diagnostics were left on in this build: a per-request log line in the realtime channel authorizer (`[RT-TRACE]`, TW-INFRA-039) and a "TEMP DIAGNOSTIC" model hook that logs every WABA connection status flip with the calling code locations (TW-INFRA-036). The Node bridge's own console log gate is commented out so all `console.log` output is on (TW-NODE-001). The login listener logs an info line with user id and email on every sign-in (`[invite-accept]`), which is PII in logs.
  5. Cross-cutting loggers: the audit trail is a DB table, not the log. Fatal-error forensics are a separate opt-in (TW-INFRA-018). Many catch blocks use PHP `error_log()` instead of the logger, so those lines go to the web server error log, not `laravel.log`.
  6. Authentication failures log only the identifier, never credentials.
- **Async & events:** none.
- **External systems:** optional Slack webhook, Papertrail, syslog.
- **Settings:** `LOG_CHANNEL`, `LOG_STACK`, `LOG_LEVEL`, `LOG_DEPRECATIONS_CHANNEL`, `LOG_DEPRECATIONS_TRACE`, `LOG_DAILY_DAYS`, `LOG_SLACK_*`, `LOG_PAPERTRAIL_HANDLER`, `PAPERTRAIL_*`, `LOG_STDERR_FORMATTER`, `LOG_SYSLOG_FACILITY`.
- **Acceptance criteria:**
  - Given `LOG_LEVEL=off`, when the app handles requests and errors, then no log output is produced.
  - Given production with no explicit level, when the service starts, then it logs at info or above only (a deliberate fix to Reference's debug default).
  - Given a request, when it logs, then each line carries request id, org id and actor id.
- **Source refs:** `config/logging.php`, `.env.example`, `app/Providers/AppServiceProvider.php`, `routes/channels.php`, `app/Console/Commands/*.php`, `node/log-gate.js`.
- **Port notes:** the repo already has structured pino logging (`nestjs-pino` in `app.module.ts` and `worker.ts`, KERNEL) with request-id propagation, org/actor enrichment and header/body redaction. `LOG_LEVEL` exists in `env.schema.ts` with a pino level enum (no `off` value; add `silent` if needed via a kernel PR). Do not port channels/stack/Papertrail/Slack (use stdout JSON, shipped by the host; Sentry exists via `SENTRY_DSN`). Do not carry over PII-bearing info lines or the temporary traces.

### TW-INFRA-029 — Mail transport configuration and fallback chain (config/mail.php)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** TW-INFRA-021, TW-SET-024
- **Summary:** Transactional email (team invites, email verification, password reset, admin welcome, support replies) goes through the framework mailer. The default transport is `log`, which writes the message to the log instead of sending, so a fresh install sends no real email until an admin saves SMTP settings. Those admin settings override the file/env values at every request.
- **Actors & access:** operator (`.env`), platform admin (mail settings page, TW-SET-024/025).
- **UX & screens:** callers that depend on mail detect the `log`/`array` mailers and tell the user honestly that no email was sent (team invite, email verification, admin-created accounts show the reset/verify link instead).
- **Endpoints:** none of its own.
- **Data:** none (settings are system-setting rows `mail_mailer`, `mail_host`, `mail_port`, `mail_username`, `mail_password` (encrypted), `mail_encryption`, `mail_from_name`, `mail_from_address`).
- **Rules & edge cases:**
  1. Configured mailers: `smtp` (host `127.0.0.1`, port `2525`, scheme/url/username/password optional, EHLO domain defaults to the host of `APP_URL`), `ses`, `postmark`, `resend`, `sendmail`, `log`, `array`, `failover` (smtp then log, retry after 60 s), `roundrobin` (ses, postmark). Only smtp/log/array/sendmail are reachable from the admin form in practice; its validation list also accepts `mailgun`, `ses`, `postmark`, `resend`, but no mailgun mailer is defined and the SES/Postmark/Resend mailers would need the unused `services.*` credentials (TW-INFRA-030), so choosing them fails at send time.
  2. From address default `hello@example.com`, name default `APP_NAME`.
  3. At boot `MailConfig::apply()` copies non-empty admin settings over the mail config (default mailer, smtp host/port/username/password/encryption, from address/name) and rebuilds the mail manager. Blank settings never overwrite a working `.env`. Password decrypt failure falls back to the stored raw value. Failure to read settings is swallowed (logged with `error_log`).
  4. QUIRK: `encryption` is written to `mail.mailers.smtp.encryption`, a key the current mailer ignores (it uses `scheme`: `smtps` for implicit TLS), so choosing "ssl" in the form may not take effect; port 465 vs 587 behaviour depends on the transport defaults.
  5. QUIRK: `MAIL_HOST` is also read by an admin screen directly with `env()`.
  6. All sends are synchronous in the request; a slow SMTP server slows the page (TW-INFRA-027).
- **Async & events:** none.
- **External systems:** SMTP server or provider chosen by the admin.
- **Settings:** `MAIL_*` env keys; admin mail settings override them (TW-INFRA-021).
- **Acceptance criteria:**
  - Given the default `log` mailer, when an admin invites a team member, then no email is sent and the UI says so while still showing the invite link.
  - Given valid SMTP admin settings, when a verification mail is requested, then it is delivered using those settings without an app restart.
  - Given SMTP is down, when the app sends mail, then the failure is surfaced to the caller (or retried by a worker in the port) rather than lost silently.
- **Source refs:** `config/mail.php`, `app/Support/MailConfig.php`, `app/Providers/AppServiceProvider.php`, `app/Http/Controllers/WorkspaceMembersController.php`, `app/Http/Controllers/EmailVerificationController.php`, `app/Http/Controllers/Admin/UsersController.php`, `app/Http/Controllers/AdminPagesController.php`, `app/Mail/*.php`.
- **Port notes:** repo has `SMTP_HOST`/`SMTP_PORT`/`SMTP_FROM` in `env.schema.ts` (KERNEL) and Mailpit in `docker-compose.yml`. Build an `email` provider port under `apps/api/src/infra/providers/platform-infrastructure/` (domain zone) with an SMTP adapter first (provider-adapter skill), a worker job for delivery with retries, and per-platform settings from TW-SET-024 stored encrypted in the DB (read through the settings service, not env). Drop `failover/roundrobin`, Mailgun and the unused provider transports, and the "log mailer" mode (use Mailpit or an explicit `NullEmailAdapter` in dev).

### TW-INFRA-030 — Unused and dead configuration blocks (services.php and driver stubs)

- **Status:** dead-code
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days)
- **Depends on:** —
- **Summary:** Several configuration blocks ship with the Laravel skeleton and have no consumer in Reference, or reference config keys that do not exist. They matter only because they appear in `.env` catalogues and docs; the port should not recreate them.
- **Actors & access:** none.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** none.
- **Rules & edge cases:**
  1. `config/services.php` defines only Postmark key, Resend key, SES key/secret/region (reusing the AWS keys) and Slack bot token/channel for notifications. No code reads `services.*` except one call that reads `services.sheets_addon.marketplace_url`, a key that is not defined (the call site supplies its own fallback URL for the Sheets add-on marketplace link, EXT).
  2. Redis (`REDIS_*`) client, cache and default connections exist but no code uses Redis. The docs and `.env.example` mention Redis as an optional upgrade.
  3. Queue drivers other than `sync`/`database`/`deferred`, cache stores other than `database`/`array`, and the Reverb broadcaster, `sqlsrv`/`pgsql`/`mariadb` connections are stock leftovers.
  4. `config/meta_targeting.php` reads of `meta_targeting.locales` return an empty list because the file does not define `locales` (TW-INFRA-032).
  5. `PULSE_ENABLED`, `TELESCOPE_ENABLED`, `NIGHTWATCH_ENABLED` in `phpunit.xml` refer to packages that are not installed.
  6. QUIRK: `.env.example` still ships `AWS_*`, `REDIS_*`, `MEMCACHED_HOST`, `VITE_APP_NAME`, `BCRYPT_ROUNDS`, which suggests features the product does not use.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `POSTMARK_API_KEY`, `RESEND_API_KEY`, `SLACK_BOT_USER_OAUTH_TOKEN`, `SLACK_BOT_USER_DEFAULT_CHANNEL`, `REDIS_*`, `REVERB_*`, `MEMCACHED_*`, `SQS_*`, `BEANSTALKD_*`, `DYNAMODB_*`.
- **Acceptance criteria:**
  - Given the port's env schema, when it is reviewed against TW-INFRA-021, then none of the keys in this entry exist in it.
  - Given the Sheets add-on marketplace link is needed, then its URL is a domain setting, not a services config key.
  - Given a reader greps the port for `Redis` configuration blocks, then only `REDIS_URL` appears.
- **Source refs:** `config/services.php`, `config/database.php`, `config/queue.php`, `config/cache.php`, `config/broadcasting.php`, `app/Http/Controllers/AccountController.php`, `phpunit.xml`, `.env.example`.
- **Port notes:** nothing to build. Record in the env mapping (`partB.notes.md`) that these keys are intentionally dropped. Third-party credentials are per-domain provider settings (encrypted, per org or per platform), never a global `services` file.

### TW-INFRA-031 — OpenAPI document generation and developer docs wiring (Scramble)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** TW-INFRA-021
- **Summary:** The public REST API (`/api/v1`) is documented automatically: a library reads controllers and form requests and produces an OpenAPI document served at `/docs/api.json`. The product hides the library's own UI and renders its own white-labelled reference page (`/developers/docs`). A boot hook rewrites the product name inside the document to the admin-configured brand and injects a short description for each resource group.
- **Actors & access:** `/docs/api.json` is public in the web group (no auth middleware); `/developers/docs` is a plain view; `/docs` and `/docs/api` redirect to `/developers/docs`. API keys are managed at `/developers` (owned by API).
- **UX & screens:** the developer docs view fetches the JSON and renders each tag with the injected overview text (tags: Message, Template, Media, Contact, ContactGroup, Broadcast, Campaign, Scheduled, AutoReply, Flow, Device, Webhook, Deal, Conversation, Account).
- **Endpoints:**

| Endpoint               | Route name      | Handler                                        | Middleware | Request | Response                       |
| ---------------------- | --------------- | ---------------------------------------------- | ---------- | ------- | ------------------------------ |
| GET docs/api.json      | -               | library closure registered in the app provider | web        | none    | OpenAPI JSON                   |
| GET developers/docs    | developers.docs | view route                                     | none       | none    | HTML                           |
| GET docs, GET docs/api | -               | redirect routes                                | none       | none    | redirect to `/developers/docs` |

- **Data:** none. The generated document is cached by the library in the file cache store under key `scramble.openapi`.
- **Rules & edge cases:**
  1. Scope: paths under `api/v1`, excluding `api/v1/sheets-addon`; export file name `api.json`; documents bearer-token security for routes using the API-key, auth, or `auth:*` middleware; API version string from `API_VERSION` (default `v1`); middleware group `web`; renderer `elements` (theme light, try-it enabled, credentials included) with `scalar` configured as an alternative; servers null.
  2. The default library UI route is suppressed in `register()`, and only the JSON route is re-registered in `boot()`.
  3. After generation, title is "<brand> API", description tells callers to send the workspace key as a bearer token, and the tag list is replaced by the fixed overviews above. If the brand differs from the string "Reference", the whole document (paths and components) is walked and every occurrence of "Reference" in strings is replaced by the brand name.
  4. QUIRK: the static config title and description say "Reference" and are only corrected by the runtime hook; the JSON is public, so API shape is public by design.
  5. The generated shape depends on PHP docblocks in 16 controllers, 13 form requests and 11 resources; those docblocks are the source of truth for descriptions.
- **Async & events:** none.
- **External systems:** Scalar renderer CDN if the alternative renderer is used (not default).
- **Settings:** `API_VERSION`; admin brand name setting (`app_name`).
- **Acceptance criteria:**
  - Given the brand is changed to "Acme", when `/docs/api.json` is fetched, then title reads "Acme API" and no string contains the original brand.
  - Given a route under `api/v1/sheets-addon`, then it does not appear in the document.
  - Given a request to `/docs`, then it redirects to `/developers/docs`.
- **Source refs:** `config/scramble.php`, `app/Providers/AppServiceProvider.php`, `routes/web.php` (docs and developers routes), `routes/api_v1.php`, `app/Http/Controllers/DeveloperApiController.php`.
- **Port notes:** the repo already has `@nestjs/swagger` in `apps/api/src/main.ts` (dev only, `/docs`) and `apps/api/src/tools/emit-openapi.ts` (all KERNEL). The public contract is `/public/v1` (public-api module, the public-API design, the REST/OpenAPI design). Emit a static OpenAPI file for the public surface at build time and publish it; do the brand substitution when rendering (or serve a per-platform copy). The developer reference page and key management belong to the developer-rest-api-v1 domain; this entry's only port work is exposing the spec in production (currently disabled outside development).

### TW-INFRA-032 — Meta ad targeting catalogue (config/meta_targeting.php)

- **Status:** partial
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days)
- **Depends on:** —
- **Summary:** A static list of 51 interest names in 8 themes and 72 countries used by the Meta Ads campaign form pickers. Names (not ids) are stored in config; at ad-sync time each picked name is resolved through Meta's targeting search and cached.
- **Actors & access:** workspaces with Meta Ads connected (create and edit campaign pages, plan gate `access_ctwa`).
- **UX & screens:** multi-select interest picker grouped by theme and a country picker on `user/campaigns/create` and the analytics/edit variants.
- **Endpoints:** none of its own (read by the two Meta Ads campaign form actions).
- **Data:** none. Interest groups: Shopping & Lifestyle (8), Health & Fitness (7), Food & Drink (6), Family & Parenting (5), Business & Finance (7), Technology (6), Entertainment (7), Education (5). Countries are ISO 3166-1 alpha-2 codes to English names, starting India, UAE, Saudi Arabia, US, UK, Canada, Australia, and including Gulf, South/Southeast Asia, Africa, Europe and Latin America entries.
- **Rules & edge cases:**
  1. Interest wording is deliberately close to Meta's own taxonomy so the first search hit is confident; each name resolved with an interest search call cached for 7 days (per API version and lower-cased name). Geo search results are cached 6 hours.
  2. QUIRK: the form passes `locales` from this config but the file defines no `locales`, so the locale picker data is always empty; the controller still validates an optional integer array of locale ids.
  3. Adding a country or interest is a code edit; there is no admin screen.
- **Async & events:** resolution happens when a campaign is synced to Meta.
- **External systems:** Meta Marketing API targeting search (`adinterest`, `adgeolocation`).
- **Settings:** none.
- **Acceptance criteria:**
  - Given the campaign form, when it loads, then 8 interest groups and the country list are offered.
  - Given a picked interest name, when the campaign is synced, then the resolved `{id,name}` pair is sent and cached for 7 days.
  - Given no locales are configured, then the form shows no locale options and still saves.
- **Source refs:** `config/meta_targeting.php`, `app/Http/Controllers/MetaAdsController.php`, `app/Services/MetaGraphClient.php`.
- **Port notes:** belongs to the meta-ads domain; keep it as seed data (`packages/db/src/seeds/<domain>.ts`) or a constants file in the domain module rather than config, and offer live search via the Marketing API through a provider adapter. Not kernel.

### TW-INFRA-033 — Storefront host and CNAME target config (config/storefront.php)

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-INFRA-021
- **Summary:** Two values control public shop addresses: the parent host under which each workspace gets `<slug>.<host>`, and the hostname customers must point their own custom-domain CNAME at. Both default to the host of `APP_URL`.
- **Actors & access:** operator sets env; workspace admins see the resulting hostnames; platform admin sees the CNAME target on workspace detail.
- **UX & screens:** storefront settings shows `<slug>.<subdomain host>` and the DNS instruction with the CNAME target; admin workspace detail repeats the target.
- **Endpoints:** none.
- **Data:** none.
- **Rules & edge cases:**
  1. `STOREFRONT_HOST` default: host of `APP_URL`, else `localhost`; `STOREFRONT_CNAME_TARGET` same default.
  2. The DNS verifier compares the customer's CNAME record against the target; the storefront model also uses the subdomain host to decide whether a request host is a shop host.
  3. Neither is in `.env.example` or written by the installer, so a stock install uses the app's own host for both and subdomain shops only work if wildcard DNS is configured by hand.
- **Async & events:** none.
- **External systems:** DNS.
- **Settings:** `STOREFRONT_HOST`, `STOREFRONT_CNAME_TARGET`.
- **Acceptance criteria:**
  - Given `STOREFRONT_HOST=shops.example.com`, when a workspace slug is `acme`, then its shop address is `acme.shops.example.com`.
  - Given a custom domain whose CNAME resolves to the target, when verification runs, then it passes.
  - Given neither variable is set, then both values equal the app host.
- **Source refs:** `config/storefront.php`, `app/Models/WaStorefront.php`, `app/Http/Controllers/WaStorefrontController.php`, `app/Http/Controllers/Admin/WorkspacesController.php`, `resources/views/user/store/storefront/edit.blade.php`.
- **Port notes:** belongs to the storefront/commerce domain; add `STOREFRONT_HOST` and `STOREFRONT_CNAME_TARGET` to that domain's env fragment (`config/domains/<domain>.env.ts`, prefix `<CODE>_`), optional with the `APP_URL` host default. Needs wildcard TLS at the Caddy layer (`docker-compose.prod.yml`, KERNEL).

### TW-INFRA-034 — Automatic Node-bridge token on outbound HTTP calls

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-INFRA-043, TW-NODE-002
- **Summary:** At boot Laravel registers one global HTTP-client middleware that adds the shared secret header to every outbound request whose host and port match the Node bridge URL. Every call site (pairing, sends, schedules, broadcasts, flows) therefore authenticates without remembering to attach a token, and the token is never sent to Meta, Twilio or any other host.
- **Actors & access:** system only.
- **UX & screens:** none.
- **Endpoints:** none (outbound).
- **Data:** none.
- **Rules & edge cases:**
  1. The bridge host/port is resolved lazily once per process from the bridge URL helper (admin setting first, env `SERVER_URL` second) and cached in a static; if no URL is configured the middleware is a no-op.
  2. A request is tagged only if its host equals the bridge host (case-insensitive) and, when both sides specify a port, the ports match; the token comes from the token helper (admin setting, legacy setting, env fallback). An existing `X-Node-Token` header is never overwritten. Empty token means no header.
  3. Every failure inside the middleware is swallowed so auth-header injection can never break a call.
  4. Why it exists: on one machine the bridge trusts loopback; on a client server the bridge URL is a public host and without the header every call would be rejected as unauthorized.
  5. QUIRK: the static cache means a changed bridge URL in admin settings applies only after the PHP worker is recycled; the same process-level cache applies to long-lived runtimes.
  6. Some bridge calls also put the token in the request body (`node_token`) for proxies that strip headers (bridge accepts both).
- **Async & events:** none.
- **External systems:** Node bridge.
- **Settings:** admin `baileys_server_url`, `node_webhook_token` (legacy `baileys_callback_token`); env `SERVER_URL`, `NODE_WEBHOOK_TOKEN`.
- **Acceptance criteria:**
  - Given a bridge URL of `https://node.example.com:8888`, when Laravel calls it, then the request carries the token header.
  - Given a call to the Meta Graph host, then no token header is present.
  - Given the caller already set the header, then the value is unchanged.
- **Source refs:** `app/Providers/AppServiceProvider.php` (boot), `app/Support/fc_helpers.php` (`node_token`, `tw_node_url`), `node/routes/index.js`.
- **Port notes:** the bridge becomes a worker (TW-NODE-001) so this disappears. If any HTTP service boundary remains, make it an explicit signed internal client (one `NodeBridgeClient`-style provider under `infra/providers/`, HMAC or mTLS), not a global interceptor. No kernel change needed.

### TW-INFRA-035 — Boot-time domain wiring: auth events, audit observers, policies, Blade directive

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** TW-NOTIF-026, TW-AUTH-017, TW-RBAC
- **Summary:** The application service provider hooks cross-cutting behaviour into the framework at boot: login, logout, failed-login and password-reset events write audit rows; a successful login accepts pending team invitations, sends the new-device alert and provisions the admin workspace; eight platform models are audited automatically on create/update/delete; three authorization policies are registered; and a template directive checks workspace permissions.
- **Actors & access:** system, triggered by any authentication.
- **UX & screens:** none directly.
- **Endpoints:** none.
- **Data:** writes `audit_logs` via the inbox audit writer (event names `auth.login`, `auth.logout`, `auth.failed`, `auth.password_reset`), flips `workspace_user.joined_at`, writes `workspaces` for admin provisioning.
- **Rules & edge cases:**
  1. Login event: (a) set `joined_at = now` on all of the user's pivot rows where it is null (idempotent; signing in is the accept step for email invitations) and log an info line with user id, email and rows updated; (b) audit `auth.login` with guard and remember flag against the user's current workspace; (c) call the new-login alert listener; (d) ensure a private workspace for platform admins. Each step is wrapped so a failure never blocks login (errors go to `error_log`).
  2. Failed event: audit `auth.failed` with result `failure`, storing only an identifier (email or username) cut to 191 characters and never the credentials. Logout and password-reset events audit with user and workspace.
  3. QUIRK: the new-login listener class has a typed `handle(Login)` method inside the listeners directory, so framework event auto-discovery very likely registers it as well; the provider also calls it explicitly. The listener's 10-minute per-device dedupe key (TW-INFRA-025) absorbs the double invocation. The commerce receipt listener is registered only by discovery, and a comment warns not to register it manually or receipts double-send.
  4. Observers: workspaces, users, packages, coupons, credit packages, announcements, orders and devices get the shared auditing observer (resource label and changed fields in the payload, TW-NOTIF-028).
  5. Policies: conversation, team and workspace policies are registered with the gate (TW-RBAC, TW-TIB1).
  6. Template directive `@canWorkspace('perm', workspaceId?)` evaluates the user's permission in the current (or given) workspace.
  7. Singletons/helper loading in `register()`: the marketing content store is a singleton; the global helper files (`fc_helpers.php`, `security_helpers.php`) are loaded with a plain include instead of composer autoload "files" so no `dump-autoload` is needed at install.
- **Async & events:** synchronous audit writes; new-device email via mail (TW-INFRA-029).
- **External systems:** none.
- **Settings:** none here (security policy toggles live in system settings, TW-AUTH-037).
- **Acceptance criteria:**
  - Given a user invited by email, when they sign in for the first time, then their pending membership becomes active and an audit row exists.
  - Given three wrong passwords, when each attempt fails, then three `auth.failed` rows exist with the identifier and no password.
  - Given a platform admin logs in for the first time, then a private workspace exists afterwards and a second login does not create another.
  - Given a coupon is edited in admin, then an audit row lists the changed fields.
- **Source refs:** `app/Providers/AppServiceProvider.php`, `app/Observers/AuditableObserver.php`, `app/Listeners/NewLoginAlertListener.php`, `app/Support/AdminWorkspaceProvisioner.php`, `app/Policies/ConversationPolicy.php`, `app/Policies/TeamPolicy.php`, `app/Policies/WorkspacePolicy.php`, `app/Services/Inbox/AuditLogger.php`.
- **Port notes:** the target's kernel provides the audit writer and transactional outbox (`apps/api/src/kernel/audit`, `kernel/outbox`, KERNEL); emit `auth.*` events from the auth module's service (`modules/auth`, auth domain) inside the same transaction, and let observers be explicit `audit.record()` calls in domain services (the hard-delete-with-audit rule). Invite acceptance belongs to the invitation flow, not to a generic login hook. RBAC replaces policies and the Blade directive (`@RequirePermission`, the RBAC-at-middleware design). The admin-workspace provisioner is an operator-layer concern (F2 in the ownership foundation list).

### TW-INFRA-036 — Model hooks on WABA connection saves (status-flip trace, BSP auto-attach)

- **Status:** partial
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-BSP-008, TW-WABA
- **Summary:** Two listeners on the WhatsApp provider-config model are registered in the global provider: a temporary diagnostic that logs a warning every time a connection's status changes (with the first four non-vendor code locations that changed it), and a post-save hook that hands a newly saved WABA connection to the reseller-billing add-on for credit-line auto-attach.
- **Actors & access:** system.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** reads/writes via the credit allocation service (BSP-owned tables).
- **Rules & edge cases:**
  1. Status trace: fires on the model's `updating` event only when `status` is dirty; logs `[WABA-status-change]` at warning with a build marker, row id, from/to, caller list, request URL (or "(console/queue)") and client IP. Labelled TEMP DIAGNOSTIC in the source, left on in v1.7.0 because a number flipped from connected to disconnected seconds after connecting; it produces noise and logs IPs.
  2. Auto-attach: on every `saved` event, only for provider `waba`, only if the add-on class exists; the service attempts once per WABA and never throws; errors go to `error_log`. Admin-controlled switches live in the BSP domain.
  3. Because the hook sits in the global provider, any save path (webhook, admin, embedded signup, sync) triggers it.
- **Async & events:** synchronous inside the save.
- **External systems:** Meta credit-line sharing (BSP).
- **Settings:** BSP auto-attach admin toggle (BSP domain).
- **Acceptance criteria:**
  - Given a WABA connection's status changes, when saved, then one warning with the caller trace is logged (Reference) / one structured audit event is recorded (port).
  - Given the reseller add-on is absent, when a connection is saved, then nothing else happens and the save succeeds.
  - Given auto-attach throws, then the connect flow still succeeds.
- **Source refs:** `app/Providers/AppServiceProvider.php`, `app/Models/WaProviderConfig.php`, `app/Bsp/Services/CreditAllocationService.php`.
- **Port notes:** drop the trace; model status transitions as explicit domain events through the outbox (`channel.status_changed`), which gives the diagnosis for free. Auto-attach becomes an outbox subscriber in the BSP domain (`@OutboxSubscriber`, conflict-map S7a), never a model hook.

### TW-INFRA-037 — Runtime configuration overrides from the database at boot (mail, real-time, Pusher driver)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** TW-SET-001, TW-SET-024, TW-SET-042
- **Summary:** Credentials saved in the admin panel win over `.env` without an app restart or config rebuild: on every request the provider reads mail and real-time settings from the database and writes them into live configuration. It also registers a home-made Pusher driver so no vendor package is needed.
- **Actors & access:** platform admin saves; system applies.
- **UX & screens:** admin mail settings and real-time settings pages (owned by SET).
- **Endpoints:** none.
- **Data:** `system_settings` keys `mail_*`, `realtime_enabled`, `pusher_app_id`, `pusher_app_key`, `pusher_cluster`, `pusher_app_secret` (encrypted).
- **Rules & edge cases:**
  1. Order in boot: node-token HTTP middleware, model hooks, base URL, OpenAPI hooks, public storage, mail override, Pusher driver registration, real-time override, add-on reconcile (TW-INFRA-038), policies.
  2. Mail override only sets non-empty values (TW-INFRA-029). Real-time override applies only when the toggle is on and both key and cluster are non-empty; it switches the default broadcaster to `pusher` and sets id, key, secret, cluster, host `api-<cluster>.pusher.com`, TLS and encryption.
  3. Each override is wrapped in try/catch; an unreachable database at boot (for example before install) logs and continues.
  4. QUIRK: two database reads per request on every page, outside the 30-minute settings cache for the first uncached key; ordering relative to the install gate matters (settings table does not exist pre-install).
  5. The custom broadcaster `pusher-http` talks to Pusher over signed HTTP so self-hosted installs never hit "class not found" for the vendor SDK.
- **Async & events:** none.
- **External systems:** Pusher.
- **Settings:** admin settings above; `PUSHER_*` env as base.
- **Acceptance criteria:**
  - Given an admin saves valid SMTP settings, when the next request sends mail, then it uses them.
  - Given real-time is enabled with valid keys, when an inbox event fires, then it is published to Pusher without a restart.
  - Given the database is unreachable at boot, then the app still starts and logs the failure.
- **Source refs:** `app/Providers/AppServiceProvider.php`, `app/Support/MailConfig.php`, `app/Support/RealtimeSettings.php`, `app/Broadcasting/PusherHttpBroadcaster.php`, `config/broadcasting.php`.
- **Port notes:** in the target, runtime-changeable credentials are per-platform settings read through a settings service with Redis invalidation (domain `platform-settings-branding-storage`), consumed lazily by the SMTP adapter and the realtime gateway; there is no per-request config mutation. Real-time itself is socket.io with the Redis adapter (`apps/api/src/realtime/`, KERNEL), so Pusher settings are dropped.

### TW-INFRA-038 — Add-on boot reconciliation and ModuleServiceProvider

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** M (<=1 week)
- **Depends on:** TW-ADD-009, TW-ADD-011, TW-ADD-022
- **Summary:** The second provider registers in-place add-on modules: their migration folders and view folders are added to the framework, while class autoloading and routes are registered even earlier in the application bootstrap. A boot-time reconciliation also switches the Instagram feature off when its add-on folder has disappeared.
- **Actors & access:** system.
- **UX & screens:** Instagram surfaces (dashboard card, more page, flows, inbox) disappear when the native add-on folder is removed.
- **Endpoints:** none (add-on routes are loaded in bootstrap, TW-INFRA-001).
- **Data:** `system_settings` `instagram_enabled`, `instaflow_url`, `instaflow_connected`; table `workspace_ig_accounts` (mirror rows deleted); the real token table is untouched.
- **Rules & edge cases:**
  1. Module provider boot: for each module migration directory, register it with the migrator; for each view directory, add a view location.
  2. Reconcile runs only on web requests (not CLI) when the native flag is on and the add-on directory is absent. It clears the flag; if the instaflow URL is empty, equals the app host or is loopback it also clears `instaflow_connected` and deletes the mirror rows (native self-wire teardown). A different external host means a remote engine: only the native flag is cleared and the remote connection is left alone.
  3. Errors are swallowed to `error_log`. The check is a directory test on each request.
- **Async & events:** log line `[IG-ADDON]`.
- **External systems:** none.
- **Settings:** the three system settings above.
- **Acceptance criteria:**
  - Given the native add-on folder is deleted, when any web request arrives, then Instagram UI hides and mirror rows are removed.
  - Given a remote Instaflow URL is configured, when the folder is absent, then the remote connection stays connected.
  - Given an add-on with migrations, when migrations run, then its folder is included.
- **Source refs:** `app/Providers/ModuleServiceProvider.php`, `app/Providers/AppServiceProvider.php`, `bootstrap/providers.php`, `bootstrap/app.php`, `app/Services/ModuleLoader.php`.
- **Port notes:** the port has no folder-based add-ons; modules are compile-time, with plan/feature flags deciding availability (see addons-extension-registry). Drop the provider and the reconcile; model "instagram engine on/off" as a channel row state in the channels domain.

### TW-INFRA-039 — Real-time channel authorization and event catalogue (routes/channels.php)

- **Status:** partial
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** TW-INFRA-037, TW-TIB1-015
- **Summary:** Browsers (and the mobile app) subscribe to private Pusher channels; the server's channel file decides who may. Only two channel patterns have an authorization rule. Seven event types are broadcast, and three of the channels they target have no rule, so those can never be subscribed to by a browser.
- **Actors & access:** signed-in users of a workspace; platform admins may listen to any workspace inbox.
- **UX & screens:** live inbox updates, conversation thread appends (team inbox); none visible for the unauthorized channels.
- **Endpoints:**

| Endpoint                        | Route name | Handler                                   | Middleware                             | Request                            | Response                   |
| ------------------------------- | ---------- | ----------------------------------------- | -------------------------------------- | ---------------------------------- | -------------------------- |
| GET\|POST /broadcasting/auth    | -          | framework broadcast controller            | web, auth                              | Pusher `channel_name`, `socket_id` | signed auth payload or 403 |
| POST /api/app/broadcasting/auth | `app.`     | closure calling the same broadcaster auth | api, sanctum token, workspace resolver | same                               | same                       |

- **Data:** reads `workspaces`, `workspace_user`, `conversations`.
- **Rules & edge cases:**
  1. Channel `workspace.{workspaceId}.inbox`: allowed when the workspace exists and the user is its owner, a platform admin, or a pivot member. Channel `conversation.{conversationId}`: allowed when the conversation exists and the user is a member of its workspace by the same test (so any workspace member, regardless of team or assignment, can listen to any conversation).
  2. Each authorization logs an info line `[RT-TRACE]` with user, ids and verdict (diagnostic left on, TW-INFRA-028).
  3. Events (all broadcast synchronously, name on the wire / channels): `message.received` (workspace inbox + conversation; payload message id, conversation id, direction, user id); `conversation.assigned` (both; previous/new user, team, actor); `conversation.<type>` such as `conversation.unsnoozed` (both; type, changes); `note.added` (conversation; note id, author, mentions); `sla.breached` (workspace inbox; kind, due time); `mention.received` (`user.{id}.notifications`; excerpt, author); `device.status` (`workspace.{id}.devices`; phone, status, raw status, time); `team-chat.posted` (`workspace.{id}.team-chat`; message id, user, reply id, mentions, time).
  4. QUIRK: `user.{id}.notifications`, `workspace.{id}.devices` and `workspace.{id}.team-chat` have no callbacks, so channel auth for them is refused; mention, device-status and team-chat events are published but never received by browsers (team chat polls instead, TW-TCHAT).
  5. The channel names and callbacks are the same contract for web (session) and mobile (token), which is why the mobile endpoint calls the broadcaster directly.
  6. Real-time is off (log driver) until an admin enables Pusher; the UI falls back to polling.
- **Async & events:** listed above; no queueing.
- **External systems:** Pusher.
- **Settings:** real-time settings (TW-SET-041/042).
- **Acceptance criteria:**
  - Given a member of workspace A, when they authorize `workspace.A.inbox`, then access is granted; for workspace B, 403.
  - Given an agent not assigned to a conversation but in the workspace, when they authorize it, then access is granted (Reference behavior; the port should tighten this per inbox visibility rules).
  - Given a platform admin, when authorizing any workspace inbox, then access is granted.
  - Given `mention.received` is published, then a subscriber on `user.{id}.notifications` can actually be authorized (port fix).
- **Source refs:** `routes/channels.php`, `routes/app.php`, `bootstrap/app.php` (broadcast registration), `app/Events/Inbox/*.php`, `app/Events/DeviceStatusChanged.php`, `app/Events/TeamChat/MessagePosted.php`, `config/broadcasting.php`.
- **Port notes:** target is socket.io: `apps/api/src/realtime/realtime.gateway.ts` (KERNEL) joins `org:{orgId}` and `user:{orgId}:{userId}` rooms on connect from the JWT and requires explicit checked joins for `conv:{orgId}:{convId}`. Replace channel callbacks with a room registry (`room:join` handler per prefix, conflict-map S7b, K2 steward) and have the inbox domain implement the visibility check with RBAC (team/assignment aware). Emit through outbox events consumed by workers using the socket.io Redis emitter (decision D3). Namespace rooms by domain code. Fix the three never-authorized channels by design (user room already exists; add device and team-chat rooms).

### TW-INFRA-040 — Scheduler policy and the cron-less periodic work catalogue (routes/console.php)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** XL (>2 weeks)
- **Depends on:** TW-INFRA-025, TW-INFRA-027, TW-NODE-014
- **Summary:** Reference deliberately has no `schedule:run` cron, no queue worker and no scheduled artisan commands. `routes/console.php` contains only a sample command and a comment stating the policy. Every periodic task is instead triggered as a side effect of something that is already happening: the Node bridge's 30-second heartbeat, a dedicated campaign-drain loop, the team inbox's 5-second poll, or an admin/user opening a page. Each trigger is guarded by a cache gate or lock so it runs at most once per interval. This catalogue is the real schedule the port must reproduce.
- **Actors & access:** none (system). Operators may add cron for the optional commands (TW-INFRA-041).
- **UX & screens:** none; user-visible consequence: SLA breaches, snooze wake-ups and reminders happen only while somebody has the inbox open or a Baileys device is connected.
- **Endpoints:** triggers are existing endpoints: `POST api/node-heartbeat` (bridge, token authed), `POST api/campaigns/drain` (bridge), `GET team-inbox/api/queue` (operators), campaigns page, templates refresh, admin pages (owned by NODE, TIB1, BCA, TPL).
- **Data:** state in cache keys (TW-INFRA-025) and per-feature columns such as `reminded_at`, `escalation_due_at`, `snoozed_until`.
- **Rules & edge cases:**
  1. **Heartbeat tick (Node, every 30 s, only sent when at least one Baileys client is registered and ready; 90 s timeout):** touches `last_seen_at` for live devices; marks devices disconnected when connected but unseen for 90 s (per-row saves so the device-status webhook fires); security-policy idle device logout (days, hourly gate); campaign schedule sweep unless the drain loop marker is alive; scheduled-message failed retry (120 s gate); broadcast failed retry (120 s gate); appointment lifecycle sweep (lock 25 s: expire slot holds, flag past bookings, auto-complete checked-in); invoice delivery sweep (5-minute gate); daily expired-workspace data wipe (24 h gate, runs the wipe command with force); deal task reminders (120 s gate, all workspaces, limit 500); expired stock-hold release (60 s gate, up to 1000). Response reports counts and whether campaigns are active.
  2. **Campaign drain loop (Node, 30 s calm / 4 s fast / 90 s timeout; runs regardless of devices):** runs only the campaign sweep and sets the "alive" marker (90 s), so WABA-only workspaces still send campaigns.
  3. **Team-inbox queue poll (about every 5 s per operator tab):** schedules deferred (after the JSON is flushed) sweeps per workspace unless gated: escalations (30 s, limit 200), Instagram inbound pull (12 s), SLA breach sweep (60 s, global), snooze wake (30 s, limit 50, notifies), deal task reminders (60 s, limit 100), CRM task reminders (60 s, limit 100), campaign schedule sweep (20 s, global).
  4. **Page-load triggers:** campaigns list (20 s gate sweep), templates page and AJAX poll refresh WABA template statuses, WhatsApp Pay page reconcile (60 s), TikTok token refresh on its accounts, posts and insights pages (15 min per workspace; a Facebook token refresh sweeper with a 1-hour gate exists but nothing calls it), audit log page prunes by retention at most daily, and a response-terminating middleware reconciles near-expiry subscriptions.
  5. **Node in-memory scheduler:** one-off and recurring schedules and appointment reminders fire inside the bridge (TW-NODE-030..036); restored from Laravel at boot (`scheduled/active`). Appointment reminders are lost on restart.
  6. QUIRK: with no operator in the inbox and no connected Baileys device, the platform runs none of: SLA breach, escalation, snooze wake, deal/task reminders, scheduled retries, broadcast retries, stock-hold release, invoice sweep, retention wipe. Workspaces on Cloud API or Twilio only depend on the drain loop and on someone polling.
  7. QUIRK: the docs advertise "no cron needed" and optionally suggest cron for `inbox:escalate` and `inbox:wake-snoozed`; but `support:sla-scan`, `inbox:wake-snoozed`, `inbox:escalate` are not wired anywhere with `Schedule::command`.
  8. All gates are fail-open try/catch blocks logging a warning; one failing sweep never blocks the others.
- **Async & events:** `ConversationUpdated` broadcast on snooze wake; notifications; webhooks `device_status_updated`.
- **External systems:** Node bridge; Meta/Graph for template and token refresh.
- **Settings:** security policy `device_logout_on_inactive_days` (0 off), plan `data_retention_days` (0 never), reminder/escalation/SLA settings in their domains.
- **Acceptance criteria:**
  - Given a snoozed conversation whose time has passed and an operator with the inbox open, when the queue poll runs, then within about 30 s the conversation is open again and the owner is notified once.
  - Given two operators polling, when both trigger the same gated sweep within its interval, then it runs once.
  - Given the port with no browser open and no Baileys device, when a task's due time passes, then the owner is reminded within one minute (improvement: real scheduler).
  - Given a connected device stops heartbeating for 90 s, then it is marked disconnected and the status webhook fires.
- **Source refs:** `routes/console.php`, `app/Http/Controllers/WaConnectController.php` (`nodeHeartbeat`), `app/Http/Controllers/WaCampaignsController.php`, `app/Http/Controllers/TeamInboxController.php` (`queue`), `app/Http/Controllers/TemplatesController.php`, `app/Http/Controllers/WhatsAppPayController.php`, `app/Http/Controllers/Admin/AuditLogController.php`, `app/Services/CampaignScheduleSweeper.php`, `app/Services/ScheduledMessageSweeper.php`, `app/Services/BroadcastSweeper.php`, `app/Services/Appointments/AppointmentLifecycleSweeper.php`, `app/Services/Invoice/InvoiceSweeper.php`, `app/Services/Deals/DealReminderService.php`, `app/Services/Crm/TaskReminderService.php`, `node/index.js` (heartbeat and drain loops), `Documentation/pages/developer-guide/architecture.html`, `Documentation/pages/installation/post-install.html`.
- **Port notes:** replace all of it with real scheduled jobs on the existing worker: `@nestjs/schedule` is already installed and `PartitionMaintenanceService` (`apps/api/src/workers/`, KERNEL) shows the pattern; for anything per-tenant or retryable use BullMQ repeatable jobs on queues the repo already names (`sla-sweep`, `campaign`, `bulk-jobs`, `billing-posting`). Each domain owns its sweeper in its own worker module (conflict-map S1, not `workers.module.ts`). Use idempotent row flags (`reminded_at`) as Reference does, but drive by `SELECT ... FOR UPDATE SKIP LOCKED` batches rather than cache gates; one repeatable job per concern, not a poll side effect. Device liveness becomes the channel-connection health check in the bridge worker. Drop the heartbeat endpoint and cache-gate keys. Run-all-workspaces sweeps must set tenant context per org (RLS).

### TW-INFRA-041 — Operator artisan commands not owned by other domains

- **Status:** partial
- **Priority:** P2 (nice to have)
- **Effort:** M (<=1 week)
- **Depends on:** TW-INFRA-040, TW-INFRA-023
- **Summary:** Five project commands exist for support and cron use but are not scheduled anywhere: a Meta catalog re-sync, two overdue-task reminder sweeps, a demo-deals seeder and the encrypted-column backfill. The scheduled-by-cron variants only matter for hosts that choose to run cron; the same logic already runs inline (TW-INFRA-040).
- **Actors & access:** operator with shell access.
- **UX & screens:** console output only.
- **Endpoints:** none.
- **Data:** see per command.
- **Rules & edge cases:**
  1. `catalog:resync [--workspace=ID] [--poll-only]`: for every workspace with a connected Meta commerce catalog (optionally one), push active products that were never synced or failed (up to 1000 per batch, marking them pending with the batch handle and a retailer id of sku or `wsn-<id>`; on provider error mark them failed with the first 500 characters of the message), then poll Meta batch status to settle pending rows to synced or failed. With `--poll-only` it skips the push. Prints a one-line summary; "No connected catalogs to sync." when none. A comment suggests hourly scheduling; nothing schedules it. Live per-product auto-sync is the primary path (CAT/STORE).
  2. `crm:remind-tasks [--limit=500]`: finds open CRM tasks that are due, not done and never reminded, notifies the assignee once (in-app and web push), stamps `reminded_at` regardless of notify success so a glitch never repeats. Same sweep runs inline for the current workspace on the inbox poll (limit 100).
  3. `deals:remind-tasks [--limit=500]`: same pattern for deal-activity tasks (`type=task`); orphan tasks with a missing deal are stamped as well and skipped; prints count.
  4. `deals:demo {workspace} [--fresh]`: creates 17 demo deals across the six stages of the workspace default pipeline with back-dated created/won/lost times and `meta.demo=true`; idempotent (skips if demo deals exist unless `--fresh`, which deletes demo deals and activities first); fails if the workspace is missing or the pipeline does not have six stages. Amounts are in Indian rupees (major units times 100).
  5. `wasnap:backfill-encrypted [--apply] [--chunk=200]`: see TW-INFRA-023.
  6. Other commands exist and are owned elsewhere: `inbox:escalate`, `inbox:wake-snoozed`, `support:sla-scan`, `audit:prune`, `auth:clear-resets`, `auto-reply:translate-existing`, `waba:sync-template-clicks`, `workspaces:wipe-expired`, `translatable:export`, `translatable:inspect-translations`.
- **Async & events:** notifications and web push for reminders.
- **External systems:** Meta commerce catalog API for `catalog:resync`.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a due open task never reminded, when `crm:remind-tasks` runs twice, then exactly one reminder is sent.
  - Given products pending in Meta, when `catalog:resync --poll-only` runs and Meta reports finished, then rows become synced and the handle is cleared.
  - Given a workspace with demo deals, when `deals:demo` runs without `--fresh`, then it changes nothing.
- **Source refs:** `app/Console/Commands/CatalogResyncCommand.php`, `app/Console/Commands/CrmRemindTasksCommand.php`, `app/Console/Commands/DealsRemindTasksCommand.php`, `app/Console/Commands/SeedDemoDeals.php`, `app/Console/Commands/BackfillEncryptedPlaintext.php`, `app/Services/WhatsAppCatalog/CatalogSyncService.php`, `app/Services/Crm/TaskReminderService.php`, `app/Services/Deals/DealReminderService.php`.
- **Port notes:** reminders become worker sweeps in the CRM/deals domains (TW-INFRA-040); catalog resync becomes a repeatable job in the commerce domain; demo seed becomes `packages/db/src/seeds/<domain>.ts` (seed CLI, KERNEL cli dir `packages/db/src/cli/`); backfill is not needed in a new schema. No CLI commands are required in the API.

### TW-INFRA-042 — Framework and package artisan commands (docs, reload, schema:dump, sanctum:prune-expired)

- **Status:** docs-only
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days)
- **Depends on:** —
- **Summary:** Four entries in Reference's command list are not project code: they come from the framework or a package. They are listed so the inventory is complete and so nobody searches for source.
- **Actors & access:** operator.
- **UX & screens:** console.
- **Endpoints:** none.
- **Data:** `sanctum:prune-expired` deletes expired rows from `personal_access_tokens`; `schema:dump` writes a schema snapshot file for faster test migration.
- **Rules & edge cases:**
  1. `docs` opens the framework documentation; `reload` reloads running application servers (Octane/Sail style); both are irrelevant to the product.
  2. `schema:dump` is a stock framework command; no schema dump file ships (migrations are replayed from the 350 files, or the manual `Database/1.1.sql` import).
  3. `sanctum:prune-expired`: the Sanctum config file is not published, so token expiration is null (tokens never expire) and the command has nothing to prune. Mobile app tokens (name `mobile-app`, abilities optional) live until the user logs out. QUIRK: personal access tokens are long-lived bearer credentials with no expiry or rotation.
  4. Also installed: tinker (runtime) and pail, pint, sail, collision (dev only).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the port's API, when reviewing mobile/long-lived tokens, then refresh tokens have an expiry (`JWT_REFRESH_TTL`) and rotate.
  - Given the inventory coverage report, then these four commands are accounted for by this entry.
  - Given a developer looks for source of `reload`, then they find it is vendor code.
- **Source refs:** `vendor/laravel/framework/src/Illuminate/Foundation/Console/DocsCommand.php`, `vendor/laravel/framework/src/Illuminate/Foundation/Console/ReloadCommand.php`, `app/Models/User.php`, `app/Http/Controllers/Api/App/AuthController.php`, `composer.json`.
- **Port notes:** nothing to build. Mobile/API auth tokens map to the repo's JWT pair and API keys (`modules/auth`, `modules/public-api/api-key.guard.ts`).

### TW-INFRA-043 — Global helper functions (infrastructure subset)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** TW-SET-001
- **Summary:** Three plain PHP files loaded at provider registration define about 35 global functions used across Blade and PHP. Brand, theme and CMS helpers are covered by SET and MKT; this entry covers the infrastructure ones: bridge address and token, install base path, timezone resolution, media URLs and disks, default country, setup hints, template languages, and the HTML sanitizer.
- **Actors & access:** all code.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** reads `system_settings`.
- **Rules & edge cases:**
  1. `node_token()`: admin setting `node_webhook_token`, else legacy `baileys_callback_token`, else env `NODE_WEBHOOK_TOKEN`; DB failure means env. `tw_node_url()`: admin `baileys_server_url`, else env `SERVER_URL`, trailing slash trimmed. The admin value is authoritative and must also be set in the bridge's own env.
  2. `tw_base()`: sub-folder of the install derived from the document root and script path with the live-URI guard (TW-INFRA-004); static per request.
  3. Timezone: `wa_tz()` resolves explicit value, then the object's timezone, then the user's workspace, the user, the admin default timezone, then app timezone, skipping invalid names, finally UTC; `wa_local()` converts stored (app-tz) timestamps to it; `safe_timezone()` canonicalises legacy aliases (Asia/Calcutta to Asia/Kolkata, Europe/Kiev to Europe/Kyiv, about 19 mappings) and falls back when Carbon would reject the name, preventing dashboard 500s (TW-SET-046).
  4. Media: `media_disk()` and `media_storage()` return the cloud disk when configured and enabled, otherwise local public disk, never throwing; `media_url()` returns the public URL of a stored path (tolerating a `storage/` prefix) and falls back to the `/storage/...` asset URL.
  5. `app_default_country()` returns dial code and ISO from admin settings (defaults `+91`, `in`, validated: code gets a plus, ISO must be two letters); `app_default_country_name()` looks it up in the country list config (`config/countries.php`), defaulting to India. `setup_hint()` returns the admin-facing "configure it here" text to admins and a neutral "contact support" line to everyone else (never leaking admin paths). `wa_template_languages()` returns the 71 template language codes Meta accepts (codes exactly as Meta expects, for example `id` not `id_ID`).
  6. `mask_phone()`: a no-op in v1.7.0 (masking was disabled product-wide; the original masking code after the early return is dead); about 40 call sites remain. `threadwise_sanitize_html()`: allow-list DOM sanitizer for rich text rendered raw on public pages: removes script, iframe, object, embed, style, form, link, meta, base, frame(set), applet, noscript, template, svg, math, audio, video and source elements with contents; strips all `on*` attributes and inline `style`; removes `javascript:`, `vbscript:`, `data:`, `about:` URLs from href/src/action/formaction/background/poster/cite/xlink:href; unparseable input is returned escaped.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `node_webhook_token`, `baileys_server_url`, `default_timezone`, `default_country_code`, `default_country_iso`.
- **Acceptance criteria:**
  - Given a workspace saved with timezone `Asia/Calcutta`, when the dashboard renders, then times display in Asia/Kolkata and no error occurs.
  - Given rich text containing `<img src=x onerror=...>` and a `javascript:` link, when sanitized, then both attributes are removed and the text remains.
  - Given a non-admin user and a missing integration setting, when `setup_hint` is called, then no admin URL is revealed.
- **Source refs:** `app/Support/fc_helpers.php`, `app/Support/security_helpers.php`, `app/Support/html_sanitize.php`, `app/Helpers/NotificationHelper.php`, `config/countries.php`.
- **Port notes:** no global functions. Put timezone helpers in `packages` shared code (date-fns-tz or Intl) with canonical IANA names validated by `Intl.supportedValuesOf('timeZone')`; media URL resolution in a storage service over the `S3_*` buckets (`media`, `documents`, `exports`); HTML sanitization via a maintained library (DOMPurify or sanitize-html) applied at write or render, in `apps/web` and API (shared `packages/contracts/src/common`, KERNEL). `mask_phone` and `node_token` are dropped; template languages move to the message-templates domain.

### TW-INFRA-044 — Node bridge pairing contract from the Laravel side (shared secret, address, health)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-INFRA-021, TW-INFRA-034, TW-NODE-002
- **Summary:** Laravel and the bridge are configured by four values that must match on both sides, and liveness is judged by one heartbeat. This entry restates the pairing contract as an infrastructure checklist; behavior of the bridge is in node-bridge-runtime.
- **Actors & access:** installer, operator, platform admin (bridge settings page TW-NODE-052).
- **UX & screens:** health page bridge card; installer bridge step.
- **Endpoints:** Laravel to bridge: `{bridge}/api/*` with token; bridge to Laravel: heartbeat, status, inbound, settings, schedule and broadcast callbacks (see NODE).
- **Data:** `devices.last_seen_at`, `devices.status`.
- **Rules & edge cases:**
  1. Four values: bridge URL (Laravel: admin `baileys_server_url` or `SERVER_URL`), shared token (admin setting or `NODE_WEBHOOK_TOKEN`; bridge: `NODE_WEBHOOK_TOKEN`), Laravel base URL for callbacks (bridge: `APP_DOMAIN_NAME`, plus `APP_URL` for channel flows), bridge port (`PORT`, default 8888 by installer, 3000 in code).
  2. Bridge auth mode `NODE_API_AUTH`: `loopback` (default; token or loopback peer), `token` (always required), `off`. Constant-time compare; token accepted from header or body. A different host without matching token gets 401.
  3. Heartbeat from bridge every 30 s with live device ids; skipped silently when no live client; a 401/403 response is logged by the bridge with the mismatch hint and scheduled campaigns stop firing until fixed.
  4. QUIRK: the token is stored in two places (admin setting wins over env on the Laravel side; only env on the bridge), so editing one without the other silently breaks every call. The admin save is supposed to write the bridge env file (TW-INST-016).
- **Async & events:** heartbeat every 30 s; drain loop every 30 s or 4 s.
- **External systems:** Node bridge.
- **Settings:** see rule 1.
- **Acceptance criteria:**
  - Given matching tokens, when the bridge starts with a connected device, then within 30 s the device shows `last_seen_at` fresh.
  - Given mismatched tokens, then the health page reports the bridge unauthorized and the port surfaces it as an alert.
  - Given the bridge is on another host and `NODE_API_AUTH=token`, then calls without the token fail.
- **Source refs:** `app/Support/fc_helpers.php`, `app/Support/EnvWriter.php`, `app/Providers/AppServiceProvider.php`, `app/Http/Controllers/WaConnectController.php`, `node/index.js`, `node/routes/index.js`, `node/config/config.js`, `Documentation/pages/installation/post-install.html`.
- **Port notes:** the WhatsApp bridge becomes a worker app (see TW-NODE-001 port notes), so the contract becomes internal: Redis/BullMQ plus DB, no shared secret between processes. Liveness is a heartbeat key in Redis per channel connection surfaced in `/ready` (`apps/api/src/health`, KERNEL, via a kernel PR if a new probe is added).

### TW-INFRA-045 — Framework plumbing tables and what replaces them

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-INFRA-025, TW-INFRA-026, TW-INFRA-027
- **Summary:** Six tables exist only because of the framework: `cache`, `cache_locks`, `jobs`, `job_batches`, `failed_jobs` and `migrations`. Three more are adjacent plumbing (`sessions`, `password_reset_tokens`, `personal_access_tokens`). The port drops all of them: cache and locks, rate limits and queues move to Redis/BullMQ, schema history is the repo's `_migrations` ledger.
- **Actors & access:** none (internal).
- **UX & screens:** health page queue card reads `jobs`/`failed_jobs`; session lists read `sessions`.
- **Endpoints:** none.
- **Data:**
  - `cache`: key (string, primary), value (medium text), expiration (int, indexed). Hot table: gates, locks, rate limits.
  - `cache_locks`: key (primary), owner (string), expiration (int, indexed).
  - `jobs`: id, queue (indexed), payload (long text), attempts (tiny int), reserved_at (nullable), available_at, created_at. Always empty in practice.
  - `job_batches`: id (string pk), name, total_jobs, pending_jobs, failed_jobs, failed_job_ids, options, cancelled_at, created_at, finished_at. Unused.
  - `failed_jobs`: id, uuid (unique), connection, queue, payload, exception, failed_at (default now). Unused.
  - `migrations`: id, migration, batch. Rows for 350 migrations.
  - Adjacent: `sessions` (TW-INFRA-026), `password_reset_tokens` (email key, token, created_at; the mobile OTP flow reuses it, TW-AUTH), `personal_access_tokens` (Sanctum, mobile app tokens, never expire).
- **Rules & edge cases:**
  1. The updater treats `sessions` (and caches) as tables to preserve or clear during updates (TW-INST-021/025); clear-queue deletes all rows in `jobs` and `failed_jobs` if they exist.
  2. QUIRK: running migrations on a database that lacks these tables (a copied schema) breaks cache, session and health pages at once because all default to the database driver.
  3. Cache/lock rows are never garbage-collected by a scheduler; expiry is checked on read and lock acquire.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `DB_CACHE_*`, `DB_QUEUE_*`, `SESSION_TABLE`, `AUTH_PASSWORD_RESET_TOKEN_TABLE`.
- **Acceptance criteria:**
  - Given the port schema, when listing tables, then none of these six exist.
  - Given a gate or lock use case, then Redis `SET NX PX` provides it with TTL expiry.
  - Given migrations, then the `_migrations` ledger (packages/db migrator) records applied files exactly once.
- **Source refs:** `database/migrations/0001_01_01_000000_create_users_table.php`, `database/migrations/0001_01_01_000001_create_cache_table.php`, `database/migrations/0001_01_01_000002_create_jobs_table.php`, `database/migrations/2026_06_10_063140_create_personal_access_tokens_table.php`, `app/Http/Controllers/Admin/HealthController.php`, `app/Services/UpdaterService.php`, `config/cache.php`, `config/queue.php`, `config/database.php`.
- **Port notes:** no migration. Replacement mapping: `cache`/`cache_locks` to Redis (`REDIS_CLIENT`, KERNEL); `jobs`/`job_batches`/`failed_jobs` to BullMQ (completed/failed retention in `DEFAULT_JOB_OPTIONS`, KERNEL); `migrations` to `_migrations` (packages/db migrator, KERNEL); `sessions`/`personal_access_tokens`/`password_reset_tokens` to auth-domain tables (refresh tokens, OTP).

### TW-INFRA-046 — Developer and test runtime profile (phpunit env, composer scripts, test suite)

- **Status:** partial
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-INFRA-021
- **Summary:** The reference app ships a small test suite and a developer launcher. Tests run on in-memory SQLite with array cache/session, sync queue and array mailer; composer scripts set up a project and launch the server, a queue listener, a log tail and the asset watcher together.
- **Actors & access:** developers.
- **UX & screens:** console.
- **Endpoints:** none.
- **Data:** none.
- **Rules & edge cases:**
  1. Test env: testing app env, array cache/session/mailer, sync queue, null broadcaster, in-memory SQLite, bcrypt rounds 4. Twelve feature tests and three unit tests exist (inbox routing, campaign mirror routing, schedule preview sender, subscription reconciler, webhook signature, attribute placeholders and others); coverage is thin relative to 1,600 routes.
  2. Composer scripts: `setup` (install, copy env, generate key, migrate, npm install, build), `dev` (serve, queue listener, log tail, vite via concurrently), `test` (config clear then tests), post-update asset publish. The queue listener in `dev` starts a worker that nothing needs (TW-INFRA-027).
  3. Two root-level SQL files (`grant-features-by-email.sql`, `hotfix_chatkar_2026_07_06.sql`) in `database/` are manual operator scripts; not part of any flow.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** test env values above.
- **Acceptance criteria:**
  - Given the port repo, when CI runs, then unit, integration (real Postgres, RLS) and e2e suites run with the env block in `.github/workflows/ci.yml`.
  - Given every TW acceptance criterion, then a named test exists (threadwise-e2e-tests skill).
  - Given a new developer, when they run the setup skill, then the API boots with Docker infra.
- **Source refs:** `phpunit.xml`, `composer.json`, `tests/Feature/*.php`, `tests/Unit/*.php`, `database/grant-features-by-email.sql`.
- **Port notes:** exists in the repo already (`apps/api/test/`, vitest, `setup` skill, `docker-compose.yml`); required CI env additions are a kernel concern (`.github/` KERNEL). Nothing to port from Reference's tests; they only inform edge cases.

### TW-INFRA-047 — PHP dependency set (composer.json): groups, owners and target equivalents

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** —
- **Summary:** The Laravel app ships a deliberately small Composer manifest: the framework plus eight runtime libraries, each existing for exactly one product capability, and a dev-tool group. This entry is the register that maps every package to the feature that needs it and to the library or decision the port must make instead, so no capability silently loses its supporting library.
- **Actors & access:** Developers and the operator who installs/updates the app. No end-user surface.
- **UX & screens:** None. The only user-visible trace is the credits page (see TW-INFRA-062), which lists just four of these packages.
- **Endpoints:** none of its own. Two packages add routes that are claimed elsewhere: Sanctum adds `GET sanctum/csrf-cookie` (claimed here, TW-INFRA-047) and Scramble adds the OpenAPI JSON route (API domain).
- **Data:** Sanctum creates `personal_access_tokens`; spatie/laravel-permission creates the role/permission tables (ROLES domain); the framework creates `cache`, `cache_locks`, `jobs`, `failed_jobs`, `sessions`, `migrations` (see TW-INFRA-027). Nothing else is created by dependencies.
- **Rules & edge cases:**
  1. Platform floor: PHP `^8.2` and `laravel/framework ^12`. Everything routed, queued, cached, mailed, validated and HTTP-called goes through the framework; there is **no vendor SDK** for any external service (no Stripe/Razorpay/PayPal SDKs for the ~30 payment drivers, no Twilio, Meta, Google, Slack, Trello, Shopify or FCM SDKs). All outbound calls use the framework HTTP client (Guzzle arrives transitively). The port must therefore model each provider behind a port interface, not look for an SDK equivalent.
  2. Tokens and roles: `laravel/sanctum ^4.3` powers mobile-app bearer tokens (`createToken('mobile-app')` in the mobile AuthController, `HasApiTokens` on the user model). No `config/sanctum.php` is published, so package defaults apply: **tokens never expire** (`expiration` null) and the `sanctum:prune-expired` command exists but is never scheduled. The package's `sanctum/csrf-cookie` route is registered but nothing in the app or frontend calls it. `spatie/laravel-permission ^6.25` backs workspace and platform permission checks (config in `config/permission.php`, ROLES domain).
  3. Documents and files: `barryvdh/laravel-dompdf ^3.1` renders HTML to A4 PDF in three places (invoice PDFs, CRM sales documents/estimates, client briefs); `smalot/pdfparser ^2.0` extracts text from PDF uploads for AI training sources and is guarded by `class_exists` (feature degrades with an error if the package is missing); `league/flysystem-aws-s3-v3 ^3.0` is the adapter behind the admin "cloud storage" switch (S3, Wasabi, DigitalOcean Spaces, Cloudflare R2, MinIO; Bunny is handled separately), see TW-SET-039/040.
  4. Realtime and push: `pusher/pusher-php-server ^7.2` is declared but the broadcaster actually used is a hand-written HTTP Pusher driver (`app/Broadcasting/PusherHttpBroadcaster.php`) built so a missing SDK can never 500 the site; the SDK class is only touched, behind `class_exists`, by the admin "test connection" action. `minishlink/web-push ^11.0` powers Team Inbox PWA push (VAPID key generation and delivery) and every call is guarded by `class_exists`, so push silently no-ops when the package is absent.
  5. API documentation: `dedoc/scramble ^0.13.27` generates the OpenAPI document for `/api/v1` (included path `api/v1`, excluding the Sheets add-on); the default Stoplight UI route is deliberately suppressed and the JSON route re-registered so a custom reference page can fetch it (API domain owns the behaviour, branding rewrite included).
  6. Schema tooling: `doctrine/dbal ^4.4` is declared but nothing in `app/` uses it; several migrations carry comments saying they were rewritten as raw `ALTER` statements so they run without it. The credits page still describes it as used for schema introspection (docs/code mismatch). Laravel 12 no longer requires it for column changes.
  7. Console: `laravel/tinker` sits in `require` (not `require-dev`), so it ships to production installs.
  8. Dev group: `fakerphp/faker` (only `UserFactory`), `kkomelin/laravel-translatable-string-exporter` (the `translatable:export` / `translatable:inspect-translations` commands, LOCALIZATION domain; because it is dev-only these commands vanish after `composer install --no-dev`), `laravel/pail` (log tail), `laravel/pint` (formatter, no config file shipped), `laravel/sail` (no Docker files are shipped, see TW-INFRA-057), `mockery/mockery`, `nunomaduro/collision`, `phpunit/phpunit ^11.5.50`.
  9. Composer config: `optimize-autoloader`, `sort-packages`, `preferred-install dist`; `allow-plugins` whitelists `pestphp/pest-plugin` and `php-http/discovery` although neither is required (template leftovers). PSR-4 maps `App\`, `Database\Factories\`, `Database\Seeders\`, `Tests\`. Add-on modules are autoloaded at runtime by a custom loader registered at the very top of `bootstrap/app.php`, not through Composer (ADDONS domain).
  10. Scripts: `setup` (install, copy `.env.example`, `key:generate`, `migrate --force`, `npm install`, `npm run build`), `dev` (runs four processes together: `artisan serve`, `queue:listen --tries=1 --timeout=0`, `pail`, `vite`), `test` (`config:clear` then `artisan test`), `post-autoload-dump` (`package:discover`), `post-update-cmd` (`vendor:publish --tag=laravel-assets --force`), plus the default root/create-project hooks (create-project would touch `database/database.sqlite` and migrate with `--graceful`).
  11. Notable transitive libraries the code relies on directly: Carbon (imported in about 30 files and referenced inline in about 45 more), Monolog (logging config), Symfony components, `dompdf/dompdf` and its font/svg/css-parser helpers.
- **Async & events:** none at runtime. At install/update time `composer install` runs `package:discover`; the shipped package already contains a populated `vendor/` directory.
- **External systems:** Packagist (build time only). Runtime providers reached through the HTTP client are catalogued in their own domains.
- **Settings:** none. Composer-level behaviour is controlled only by the manifest.
- **Acceptance criteria:**
  - Given the port's dependency register, when each of the eleven rules above is checked, then every Reference package has a named target library, a decision reference, or an explicit "not needed" line (PDF rendering, OpenAPI generation, web push, S3 storage, PDF text extraction, token auth, RBAC, realtime, schema tooling, REPL, translation export).
  - Given the target API image, when the web-push library is absent, then push delivery degrades to a logged no-op rather than a boot failure (Reference behaviour), and the missing capability is visible on the health readiness check.
  - Given an AI-training PDF upload on the target, when the PDF text extractor is not installed, then the user sees a clear "cannot read PDF" error and no partial source row is stored (Reference behaviour is a guarded error).
  - Given a mobile API token on the target, when the token reaches its configured expiry, then it is rejected (deliberate improvement: Reference tokens never expire and prune is unscheduled).
- **Source refs:** composer.json, composer.lock, app/Providers/AppServiceProvider.php, app/Services/Invoice/InvoicePdfRenderer.php, app/Http/Controllers/CrmController.php, app/Http/Controllers/BriefsController.php, app/Http/Controllers/AiTrainingController.php, app/Services/CloudStorageManager.php, app/Broadcasting/PusherHttpBroadcaster.php, app/Services/Push/WebPushService.php, app/Http/Controllers/Api/App/AuthController.php, config/scramble.php, Documentation/pages/conclusion/source-credits.html
- **Port notes:** Target equivalents (decide each in `apps/api/package.json` via a dependency-only `chore(deps)` PR, reviewer per the package.json seam): Laravel Http client -> `fetch`/undici inside provider adapters under `apps/api/src/infra/providers/*` (skill `provider-adapter`); Sanctum -> JWT access/refresh pair plus HMAC API keys already in `apps/api/src/modules/auth` and `modules/public-api` (no new package); spatie permissions -> kernel RBAC (the RBAC-at-middleware design, skill `rbac-permission`); Scramble -> `@nestjs/swagger` + zod contracts (the REST/OpenAPI design, `apps/api/src/tools/emit-openapi.ts`); Pusher -> socket.io + Redis adapter (`apps/api/src/realtime`, already present); dompdf -> needs a recorded decision (candidate: a Node PDF library or headless-browser render; not present today); flysystem S3 -> `@aws-sdk/client-s3` (not in `apps/api/package.json` yet, MinIO already in `docker-compose.yml`); web-push -> the `web-push` npm package; pdfparser -> a Node PDF text extractor; tinker -> the CLIs in `packages/db/src/cli` and `apps/api/src/tools`. KERNEL-owned: `package.json`, `pnpm-workspace.yaml`, `apps/web/package.json`, `apps/api/Dockerfile` need a kernel-protocol PR; per-domain deps belong in `apps/api/package.json` under the dependency-only seam. Do not port doctrine/dbal, tinker-in-prod or the unscheduled prune command.

### TW-INFRA-048 — Runtime requirements as the code actually uses them (PHP extensions, OS binaries, ini limits)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-INFRA-047
- **Summary:** The documentation publishes a requirements table (PHP 8.2+, MySQL 8/MariaDB 10.6, Node 18+, a list of PHP extensions, two writable folders). Reading the code shows which of those are truly exercised, which are listed but unused, and one undocumented operating-system dependency (ffmpeg) that several voice and call features degrade without. The port needs the real list to size container images and to decide which features need extra binaries.
- **Actors & access:** Operator and developers. The install wizard performs the documented checks (INSTALL domain, TW-INST-004); this entry is the ground truth behind them.
- **UX & screens:** None here. The wizard's requirements step is TW-INST-004; the admin System Health page that probes Node reachability and media-storage read/write is the DASH domain.
- **Endpoints:** none.
- **Data:** none. One optional system setting, `ffmpeg_path`, can pin the binary location.
- **Rules & edge cases:**
  1. Language/database: PHP 8.2 minimum (8.3/8.4 advised); `config/database.php` already references the PHP 8.5 MySQL constant class, so the stack is forward-compatible. Database drivers configured: sqlite, mysql, mariadb, pgsql, sqlsrv; production is MySQL 8.0+/MariaDB 10.6+ with charset `utf8mb4`, collation `utf8mb4_unicode_ci`, strict mode on. About 11 of 350 migrations use raw MySQL `ALTER`/`DB::statement`, so the migration set is not portable to another engine without rewriting. The connection sets no explicit timezone, so stored timestamps are whatever PHP writes (app timezone, UTC by default, see TW-INFRA-059).
  2. Extensions the docs call mandatory vs what the code uses: `curl` (HTTP client, plus a direct `curl_exec` in the Braintree driver), `mbstring` (multibyte functions in about 190 app files), `openssl` (Laravel encryption, 2FA, VAPID EC key generation with a fallback openssl config written to `storage/app/openssl-vapid.cnf` when no system config is found), `zip` (`ZipArchive` in the updater, the extension installer, the WooCommerce plugin download and DOCX text extraction for AI training), `fileinfo` (upload MIME detection), `pdo_mysql`, `json`, `ctype`, `tokenizer`, `xml`/`dom`. **`bcmath` is listed as required "for money maths" but no `bc*` function is called anywhere in `app/`.** **`gd` is optional**: the only use is flattening/re-encoding a template header image to JPEG, guarded by `function_exists('imagecreatefromstring')`; `getimagesize` (core) is used for rich-menu dimension checks.
  3. Undocumented OS dependency: **`ffmpeg`** on the PATH (or at `/usr/bin`, `/usr/local/bin`, `/opt/homebrew/bin`, or the admin-set `ffmpeg_path`) plus PHP `exec()` enabled. It transcodes recorded browser voice notes (WebM/Opus) to OGG/Opus for WhatsApp Cloud sends and builds MP3 playback files from raw call-recording PCM. When `exec()` is disabled or the binary is missing, the helpers return null and the dependent step is skipped or the raw file is served; nothing crashes. The FAQ's `proc_open` advice has no matching call in `app/` (it concerns hosting-panel tooling).
  4. ini/server limits asserted by docs (see TW-INST-018 for the full list): `memory_limit` 256M, `max_execution_time` 300, uploads 64M, nginx body size 64M. Individual code paths call `set_time_limit(0)` and `ignore_user_abort(true)` (paced campaign send, WA calling webhook, booking confirmations, updater) because they run long loops after the response (TW-INFRA-027).
  5. Node: bridge needs Node 18 LTS minimum (20 LTS advised), npm 9, git (two dependencies are fetched from GitHub), and `@roamhq/wrtc` ships prebuilt native binaries for calling. 1 GB RAM minimum (2 GB+ advised), 2 GB free disk (10 GB+ advised).
  6. Network: public HTTPS is required for inbound webhooks (Meta, Twilio, every other channel). Browsers also fetch scripts/styles from third-party hosts at runtime (Google Fonts, the Tailwind play CDN on public pages, unpkg Leaflet on one screen, jsDelivr Alpine on the installer, Razorpay checkout, GTM/Facebook pixel when configured). An air-gapped or CSP-locked deployment would break styling on those pages.
  7. Writable paths: `storage/` (all subtrees), `bootstrap/cache/`, project-root `.env` (the installer writes it), and `public/` for the no-symlink fallback (TW-INFRA-054).
- **Async & events:** none.
- **External systems:** none beyond those listed in rule 6.
- **Settings:** `ffmpeg_path` (system setting, default empty meaning probe), php.ini values above.
- **Acceptance criteria:**
  - Given a container image for the API, when voice-note and call-recording features are enabled, then the image contains an ffmpeg build with libopus and mp3 support, or the feature reports itself unavailable instead of sending raw WebM to WhatsApp.
  - Given a host without ffmpeg, when an agent records a voice note on a WhatsApp Cloud conversation, then the failure is reported to the agent rather than silently dropped (Reference logs a warning and skips transcode).
  - Given the requirements checklist in the port's runbook, when it is compared with this entry, then bcmath is not listed as required and gd/ffmpeg are listed as optional with the features they unlock.
  - Given no outbound access to Google Fonts, when the web app loads, then fonts fall back to bundled/self-hosted files and no layout request blocks rendering (deliberate improvement over Reference).
- **Source refs:** Documentation/pages/installation/server-requirements.html, Documentation/pages/faqs/general.html, app/Services/InboxDispatcher.php, app/Http/Controllers/CallRecordingController.php, app/Support/Audio/WebmOpusToOgg.php, app/Services/Waba/TemplateSender.php, app/Services/Push/WebPushService.php, app/Services/UpdaterService.php, app/Services/ExtensionService.php, config/database.php, composer.json
- **Port notes:** Encode the real list in `apps/api/Dockerfile` (KERNEL, kernel-protocol PR): add `ffmpeg` to the runtime stage only if the media domain (voice notes, calling) is in scope, otherwise gate the feature. No PHP extensions apply. Self-host fonts and drop the CDN scripts in `apps/web` (WEB shell is KERNEL-owned). Document the list in `docs/runbooks/` (KERNEL path). Do not port the `bcmath` requirement.

### TW-INFRA-049 — Node bridge dependency set (node/package.json) and the two-install model

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-NODE-001
- **Summary:** The bundled WhatsApp bridge has its own `package.json`, lockfile and `node_modules`, completely separate from the root front-end build. Its twenty declared packages fall into transport, HTTP service, scheduling/time, media, proxy, calling and telegram groups; four are declared but never imported. Operators must run two independent installs.
- **Actors & access:** Operator (runs `npm install` inside `node/`), developers. No user surface.
- **UX & screens:** None. The install wizard's Node step (TW-INST-009) only writes `node/.env`.
- **Endpoints:** none (bridge routes are in NODE domain).
- **Data:** none. On-disk bridge state lives under `node/baileys_auth` (NODE domain).
- **Rules & edge cases:**
  1. Package facts: name `whatsapp-bot` 1.0.0, ES modules (`"type": "module"`), **no `scripts` at all** (start is `node index.js`), no `engines` field, an `overrides` pin of `p-queue` to 6.6.2, and a committed `package-lock.json`.
  2. WhatsApp transport: `@itsukichan/baileys` (a fork fetched from GitHub; the only Baileys package the code imports: connection manager, message controller, flow service) and `baileys` (the upstream project, also a GitHub dependency, **never imported directly**, so it is dead weight or present only to satisfy the lockfile). Both come from GitHub rather than the npm registry, so installs need git and outbound GitHub access and are not reproducible if the repositories move.
  3. HTTP service: `express ^5.1` (all routes), `cors` (dynamic allow-list, see TW-NODE-003), `dotenv` (reads `PORT`, `DOMAIN_NAME`, `APP_DOMAIN_NAME` from `node/.env`), `axios` (callbacks to Laravel and media fetches), `ws` (WebSocket clients for the speech-to-text and text-to-speech providers inside the calling bridge).
  4. Scheduling/time: `node-cron ^4.2` (in-memory cron jobs for scheduled messages, campaigns, broadcasts) and `moment-timezone` (timezone arithmetic for per-recipient local sends). Because schedules live only in memory, correctness after restart depends on Laravel re-sending active schedules (TW-NODE-036).
  5. Logging and QR: `pino ^8` is used only as the Baileys logger (level from `BAILEYS_LOG_LEVEL`); everything else logs through `console`. `qrcode-terminal` prints pairing QR codes in the process log.
  6. Per-number network isolation: `https-proxy-agent` and `socks-proxy-agent` (proxy/IP isolation, TW-NODE-013).
  7. Filesystem: `fs-extra` (session folders, cleanup).
  8. Calling: `@roamhq/wrtc` (WebRTC peer connection for the AI voice-call bridge; native binary) plus `ws` for the speech provider sockets.
  9. Telegram user-account mode: `teleproto` (MTProto client for QR/phone login and BotFather automation, TW-NODE-051).
  10. Declared but not imported anywhere in `node/` source: `baileys`, `@distube/ytdl-core`, `form-data`, `sharp`, `unfurl.js`. `sharp` and `unfurl.js` are the optional image-thumbnail and link-preview helpers Baileys can use, so they may be intentional peer extras; `@distube/ytdl-core` has no visible use. `@hapi/boom` is imported by a stale backup file but is not declared (transitive).
  11. Two independent installs: root `composer install` + `npm install` (front-end build only) and `cd node && npm install` (bridge). Docs repeat that they are separate. The front-end `node_modules` is not needed at runtime once `public/build` exists.
  12. Entrypoint shims (`app.cjs`, `server.cjs`) exist only because some shared-hosting Node launchers `require()` the start file (NODE domain).
- **Async & events:** none.
- **External systems:** GitHub (two dependencies), npm registry.
- **Settings:** none in the manifest. Runtime env keys are catalogued in TW-NODE-001.
- **Acceptance criteria:**
  - Given a clean checkout of the target bridge/worker, when dependencies are installed with a frozen lockfile and no GitHub access, then installation succeeds (registry-only or vendored forks), unlike Reference.
  - Given the target worker image, when its dependency list is compared with this entry, then no unused package from rule 10 is carried over without a stated reason.
  - Given a scheduled message registered before a worker restart, when the worker comes back, then the schedule fires on time without relying on Laravel to re-register it (Reference relies on re-registration; TW-NODE-036).
- **Source refs:** node/package.json, node/package-lock.json, node/index.js, node/classes/BaileysClientManager.js, node/services/wabaCallBridge.js, node/services/telegramAccountService.js, node/config/config.js, Documentation/pages/conclusion/source-credits.html, Documentation/pages/installation/server-requirements.html
- **Port notes:** Do not port the Express package set. Target: a NestJS worker/bridge app inside this monorepo (`apps/api/src/worker.ts` is the existing worker entry; the WhatsApp socket runner is a new app or module decided in the NODE domain). Schedulers become BullMQ delayed/repeatable jobs on Redis (`apps/api/src/infra/queue/queues.ts`, the BullMQ worker design), pino is already the API logger. Baileys fork: vendor or publish it to a registry the CI can reach. Any new dependency goes through a dependency-only PR; `pnpm-lock.yaml` conflicts are never hand-merged (seam rule).

### TW-INFRA-050 — Front-end dependency set (root package.json): build tools vs bundled runtime libraries

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** —
- **Summary:** The root `package.json` serves one job: compile the Blade-era front end with Vite. Its dev group is the build toolchain; its runtime group is a short list of browser libraries bundled into per-page chunks. The documentation advertises Alpine.js as the UI framework, but the shipped app does not use it.
- **Actors & access:** Developers/resellers who rebuild assets. End users only receive the compiled files in `public/build`.
- **UX & screens:** None directly; the libraries power date/phone inputs, selects, charts, emoji picker, QR rendering, toast messages, the guided tour and the flow builder UI.
- **Endpoints:** none.
- **Data:** none.
- **Rules & edge cases:**
  1. Manifest facts: private, ES modules, scripts `dev` (`vite`) and `build` (`vite build`). No lint, test or typecheck scripts.
  2. Build group (devDependencies): `vite ^7`, `laravel-vite-plugin ^2`, `@tailwindcss/vite ^4`, `tailwindcss ^4`, `postcss-rtlcss ^6` (right-to-left CSS generation, TW-INFRA-051), `concurrently` (only for the `composer dev` script), and `axios ^1.11` (declared as a dev dependency yet bundled into the runtime bundle and used as `window.axios`).
  3. Runtime group (dependencies, bundled by Vite): `apexcharts` (37 page modules: every analytics/overview chart), `intl-tel-input` (7: international phone fields), `tom-select` (10: searchable selects/tag inputs), `country-state-city` (3: admin user/workspace/wallet forms), `emoji-picker-element` (3: composer and chat), `qrcode` (2: device pairing and store connect), `driver.js` (1: first-run guided tour), `toastify-js` (global toasts), `laravel-echo` + `pusher-js` (realtime client, initialised only when the admin has configured Pusher), `react` + `react-dom ^18.3` and `htm` (used by **one** screen: the flow builder canvas, written with `htm/react` templates instead of JSX).
  4. Declared but unused: `@giphy/js-components` and `@giphy/js-fetch-api` have no import anywhere in `resources/` (only a GIPHY key setting exists for the Instagram inbox).
  5. **Docs vs code:** docs and the credits page say the UI is "Blade + Alpine.js + Tailwind". Alpine is not in `package.json`; the only Alpine use is a jsDelivr CDN script plus `x-data` attributes inside the install wizard views. The dashboard is vanilla JavaScript modules plus Tailwind. Font Awesome and Inter, also named on the credits page, are used by the documentation site, not by the app (the app loads Plus Jakarta Sans, Fraunces, Bricolage Grotesque, Caveat from Google Fonts).
  6. Styling is Tailwind 4 configured inside CSS (no `tailwind.config.js` ships); there is also no `.eslintrc`, `.prettierrc` or `jsconfig` for the root.
  7. Lock/reproducibility: `package-lock.json` is committed; `node_modules` is present in the reference tree but not required on a customer server because `public/build` ships prebuilt.
- **Async & events:** none.
- **External systems:** npm registry at build time.
- **Settings:** `VITE_APP_NAME` in `.env.example` (unused by the code read).
- **Acceptance criteria:**
  - Given the port's web app dependency list, when each Reference screen type is mapped (charts, phone input, searchable select, emoji picker, QR, toast, product tour, flow canvas), then every type has a chosen component or library recorded before the screen is built.
  - Given the target web bundle, when it is analysed, then no unused library from rule 4 is included.
  - Given a documentation claim about the front-end stack in the port's developer docs, when it is reviewed, then it names the real framework (Next.js) and does not repeat the Alpine claim.
- **Source refs:** package.json, package-lock.json, resources/js/app.js, resources/js/echo.js, resources/js/charts/user-flows-builder.js, resources/js/tour/guided-tour.js, resources/js/lib/tz-picker.js, Documentation/pages/conclusion/source-credits.html, Documentation/pages/developer-guide/architecture.html
- **Port notes:** The staff app is Next.js 16 / React 19 / Tailwind 4 / next-intl / TanStack Query (`apps/web`, already built with several route groups; `apps/web/package.json` and `apps/web/postcss.config.mjs` are KERNEL-owned). Chart, phone, select and emoji needs map to the shared UI kit (`@crm/ui`, KERNEL web foundation F1); the flow builder canvas belongs to the flow-builder domain and should evaluate a graph library rather than hand-rolled React-in-Blade. Realtime client = socket.io-client against `apps/api/src/realtime`. Do not port laravel-echo or pusher-js.

### TW-INFRA-051 — Front-end build pipeline (Vite 7, Tailwind 4, RTL post-processing, per-page modules)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-INFRA-050
- **Summary:** One Vite build produces every stylesheet and script the Blade pages use. Four entry points are compiled, 160-odd page modules are split into lazy chunks selected by a `data-page` attribute on `<body>`, Tailwind is configured in CSS, and a PostCSS plugin emits left-to-right and right-to-left variants of every directional rule into the same stylesheet. The output ships prebuilt in `public/build` so customers never run a front-end build.
- **Actors & access:** Developers/resellers who rebuild; all end users consume the output.
- **UX & screens:** Visible effects only: themes (`paper` default, `bright`, `dark`, `doodle`, chosen by `html[data-theme]`, remembered in a `wa-theme` cookie and mirrored from the admin-set theme on `<body data-theme>`), right-to-left layout for Arabic/Hebrew/Urdu, and admin-controlled recolouring (runtime CSS variable overrides at `:root`, TW-SET-013).
- **Endpoints:** none (static files under `/build/*`).
- **Data:** `public/build/manifest.json` (about 174 entries, 175 files, roughly 12 MB) maps source files to hashed outputs; `@vite()` in layouts resolves through it.
- **Rules & edge cases:**
  1. Entry points in `vite.config.js` (four, not the three the developer docs list): `resources/css/app.css` (dashboard/admin/user shell), `resources/css/frontend.css` (public marketing pages, independent), `resources/js/app.js`, and `resources/js/locale-switcher.js` (standalone so the public site, which does not load `app.js`, can still run the language dropdown). Layout usage: user, admin and guest layouts load `app.css` (+ `app.js` where scripted); the public layout loads `frontend.css` + `locale-switcher.js`.
  2. Dev server: `refresh: true` (full reload on Blade changes) and the watcher ignores compiled views under `storage/framework/views`. `experimental.renderBuiltUrl` returns **relative** URLs, so the built bundle keeps working when the app is served from a sub-folder (see TW-INFRA-053).
  3. Tailwind 4 is configured inside `app.css`: a `@theme` block defines the colour tokens (paper, ink, wa-deep/teal/green/mint/chat/bubble, accent coral/amber/sand/plum/sky, Instagram brand colours), fonts (Plus Jakarta Sans sans, Fraunces serif, JetBrains Mono) and two shadows; `@source` directives make the scanner read Laravel pagination views, compiled views, every `resources/**/*.blade.php` and `*.js`, and **`addon/**/*.blade.php`**, so classes used only by add-on views require a rebuild after installing an add-on.
  4. `app.css` imports `threadwise.css` (about 3,200 lines: shared components such as toggles, cards, hairlines, theme overrides, derived brand shades using `oklch(from ...)`). Fonts are pulled with `@import url(...)` from Google Fonts at runtime (not self-hosted). The public layout additionally loads the **Tailwind play CDN script** and other Google fonts, so the marketing pages style themselves from a third-party CDN at request time as well as from the compiled file.
  5. `postcss.config.js` loads `postcss-rtlcss` in `combined` mode: every directional rule (left/right, margin/padding sides, text-align, float, positioning) is emitted twice inside one stylesheet, scoped to `[dir=ltr]` and `[dir=rtl]` (about 350 rules each). **Consequence: every layout, including the installer and guest pages, must stamp a `dir` attribute on `<html>`**; with none, neither set matches and the page is partly unstyled. The comment in the config claims LTR is the unscoped default, which is not how `combined` output behaves. Direction comes from the locale registry (`LocaleSettings::directionFor`, TW-SET-045). Use `/* rtl:ignore */` comments or `dir="ltr"` to exempt phone numbers, code, brand marks.
  6. Page-script registry: `app.js` holds a map of about 167 page keys to dynamic `import()` calls of modules in `resources/js/charts/` (161 files, misleadingly named: they are per-page scripts, not only charts). On load it reads `document.body.dataset.page` and runs the matching initializer once. A page key missing from the map silently runs no page script. Modules are therefore split into on-demand chunks.
  7. `app.js` import order is significant: base-path patch first, then CSRF refresh guard, axios bootstrap, Echo, shared UI helpers, cookie consent, locale switcher, guided tour (TW-INFRA-052). It also defines the global confirm/alert/prompt dialogs that forms trigger through `data-confirm*` attributes.
  8. Rebuild rules: any change to CSS/JS or new Tailwind classes needs `npm run build`; `.env` changes need `php artisan config:clear` (docs). `public/build` is git-ignored, so a deployment must include a fresh build.
  9. Docs vs code mismatches: docs list three Vite inputs (code has four), name Inter as the primary typeface (the app uses Plus Jakarta Sans/Fraunces), and describe Alpine.js (see TW-INFRA-050).
- **Async & events:** none at runtime.
- **External systems:** Google Fonts, Tailwind play CDN (public pages), and the third-party scripts listed in TW-INFRA-048 rule 6.
- **Settings:** admin appearance settings override `--color-*` tokens at runtime (SETTINGS domain); `VITE_APP_NAME` is defined in `.env.example` but unused.
- **Acceptance criteria:**
  - Given the port's web build, when a locale with right-to-left direction is selected, then every screen (including login and error pages) mirrors correctly without a per-page stylesheet.
  - Given a rebuilt production bundle, when the app is served from a path prefix, then all assets resolve (relative URLs) or the port documents that sub-folder hosting is unsupported.
  - Given an unknown page key in the target's route-to-script map, when a page loads, then the failure is logged in development and does not break shared behaviour.
  - Given a theme switch to dark or doodle, when the page is reloaded, then the first paint already uses that theme (no flash), because the choice is applied before render from a cookie.
- **Source refs:** vite.config.js, postcss.config.js, package.json, resources/css/app.css, resources/css/threadwise.css, resources/css/frontend.css, resources/js/app.js, resources/js/locale-switcher.js, resources/js/threadwise.js, resources/views/components/layouts/user.blade.php, resources/views/components/layouts/admin.blade.php, resources/views/components/layouts/guest.blade.php, resources/views/components/layouts/frontend.blade.php, resources/views/install/layout.blade.php, public/build/manifest.json, Documentation/pages/developer-guide/customization.html
- **Port notes:** Replaced wholesale by Next.js: use `apps/web` with Tailwind 4 and the logical-property utilities (`ms-*`, `ps-*`, `text-start`) instead of a post-processor; `apps/web/postcss.config.mjs` is KERNEL-owned (kernel-protocol PR). Theme tokens move to CSS variables in the shared UI package (F1). Self-host fonts through `next/font`. Per-page script registry maps to route segments; do not port the `data-page` mechanism. Right-to-left and i18n are a web-foundation (F1) deliverable, not a per-domain one.

### TW-INFRA-052 — Browser bootstrap layer: axios defaults, sub-folder URL patching, password reveal

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-INFRA-051
- **Summary:** A few tiny scripts run on every authenticated or guest page before feature code: one marks AJAX requests, one rewrites root-relative URLs so the app works under a sub-folder install, and one adds a show/hide eye button to every password input. They are infrastructure rather than features, but other screens assume they ran.
- **Actors & access:** Every browser user; no permissions.
- **UX & screens:** The only visible element is the eye icon inside each password field (login, register, change password, admin gateway secret fields, API key inputs). Labels are hard-coded English ("Show password"/"Hide password") and not translated; the button has tab index -1, so keyboard users cannot reach it.
- **Endpoints:** none.
- **Data:** reads `<meta name="app-base">` (printed by the user, admin and guest layouts from the server helper `tw_base()`).
- **Rules & edge cases:**
  1. `bootstrap.js`: exposes `window.axios` and sets the `X-Requested-With: XMLHttpRequest` header on all axios calls. The server treats this header (and JSON `Accept`) as "expects JSON" for redirects and error rendering (for example the graceful session-expired handling). It does not set a CSRF header; axios picks up the `XSRF-TOKEN` cookie automatically, and a separate CSRF refresh guard (AUTH domain) rewrites stale form tokens.
  2. `lib/base-url.js` (imported first): reads the base path from the meta tag, strips trailing slashes, and publishes `window.appBase` and `window.appUrl(path)`. When the base is empty (app at domain root) it does nothing else. Otherwise it prefixes root-relative paths (starting with a single `/`, not `//`, not already prefixed) for: `fetch` (string or Request input), `XMLHttpRequest.open` (which covers axios), `history.pushState/replaceState`, `navigator.sendBeacon`, native form submits (capture-phase rewrite of `action` on every submit, idempotent), and anchors (capture-phase on pointerdown, focusin and touchstart rewrites the `href` attribute once, tagged on the node so it is never doubled, which keeps middle-click and open-in-new-tab working).
  3. Not covered by the patch: `window.open`, assignments to `location.href`, `EventSource`, `WebSocket`, dynamically inserted `<img>/<script>` URLs and CSS `url()`. Code that uses those must call `window.appUrl()` itself.
  4. `lib/password-reveal.js`: on DOM ready and through a `MutationObserver` it attaches a toggle to every `input[type=password]` and every element carrying `data-reveal`; elements with `data-no-reveal` are skipped. It wraps the input in a relatively positioned block (or reuses a single-child relative parent), adds 36 px right padding, colours the icon from the runtime theme tokens (so it follows admin recolouring), and swaps the icon and aria-label on click. Idempotent via a window flag; manual rescan hook `window.WaPwReveal.scan()`.
  5. The server-side twin of the base-path patch is the URL forcing in the application service provider (TW-INFRA-053); the two must agree on the same base path or links break.
- **Async & events:** a `MutationObserver` on the document root for dynamic password inputs.
- **External systems:** none.
- **Settings:** none (base path derived from the live request, not a setting).
- **Acceptance criteria:**
  - Given the app served under a path prefix, when a page issues `fetch('/devices')`, then the request goes to `<prefix>/devices` and a link built in JavaScript with `href="/team-inbox"` navigates under the prefix.
  - Given a modal that injects a password input after page load, when it appears, then it receives a working reveal button without page-specific code.
  - Given an input marked `data-no-reveal`, when the page loads, then no reveal button is added.
  - Given an axios POST that fails validation, when the server inspects the request, then it is recognised as an AJAX/JSON caller and returns JSON errors rather than a redirect.
- **Source refs:** resources/js/bootstrap.js, resources/js/lib/base-url.js, resources/js/lib/password-reveal.js, resources/js/app.js, resources/js/theme-colors.js, resources/views/components/layouts/guest.blade.php, resources/views/components/layouts/user.blade.php, resources/views/components/layouts/admin.blade.php
- **Port notes:** In Next.js use the framework's `basePath` and a single typed API client (skill `frontend-api-call`) instead of monkey-patching globals; drop the patch entirely unless sub-folder hosting is a requirement (it should not be). Password reveal becomes a shared `PasswordInput` component in the UI kit (F1, KERNEL web foundation) with translated, keyboard-reachable labels.

### TW-INFRA-053 — Public web root, entry points and sub-folder installs

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-INFRA-051
- **Summary:** The only directory a web server should expose is `public/`. It holds the PHP front controller, the rewrite rules, compiled assets, a push-only service worker, a few helper scripts, and several writable upload folders. The app also supports being served from a sub-folder such as `/public` on shared hosting by deriving a base path from the server environment and forcing every generated URL to carry it.
- **Actors & access:** Operator (document root configuration), every visitor (static files).
- **UX & screens:** None. Visible only as correct or broken asset/link URLs.
- **Endpoints:** none own. Static files served before PHP: `/build/*`, `/css/api-docs.css`, `/js/*.js`, `/images/*`, `/uploads/*`, `/storage/*` (see TW-INFRA-054), `/team-inbox-sw.js`, `/robots.txt`, `/favicon.ico`.
- **Data:** none.
- **Rules & edge cases:**
  1. Front controller `public/index.php` is the stock Laravel file: loads `storage/framework/maintenance.php` if present (file-driver maintenance), the Composer autoloader, then `bootstrap/app.php`. All dynamic routing then flows through the middleware groups described in the bootstrap file (owned by the CORE-A entries).
  2. `.htaccess` (Apache): disables MultiViews and directory listings; forwards the `Authorization` and `X-XSRF-Token` headers into the environment (needed on FastCGI hosts that strip them); issues a **301 redirect removing a trailing slash** from non-directory URLs; sends every non-file, non-directory request to `index.php`. Nginx needs the equivalent `try_files $uri $uri/ /index.php?$query_string` plus the same header pass-through. There is no root-level `.htaccess` in the package; docs say to point the document root at `public/`, never the project root.
  3. Files in `public/`: `build/` (compiled assets, git-ignored), `css/api-docs.css` and `js/api-docs.js` (custom API reference page, API domain), `js/admin-updater.js` (INSTALL), `js/auth-editor-bridge.js`, `js/frontend-editor.js`, `js/frontend-editor-bridge.js` (CMS live editors), `images/brand-mark.png`, `images/users/` (mobile-app avatar uploads), `team-inbox-sw.js` (see below), `robots.txt`, a **zero-byte** `favicon.ico`, `uploads/` and `storage/`.
  4. `team-inbox-sw.js` is deliberately push-only: it skips waiting, claims clients, shows web-push notifications and handles notification clicks, and caches nothing, so users never receive stale JS/CSS. It sits at a stable URL (not hashed) because a service worker registration path cannot change; it is registered with scope `/team-inbox` from the inbox page script (PWA settings are TW-SET-035..038).
  5. Writable web-served folders under `public/uploads/` are listed in TW-INFRA-055; they are directly fetchable by URL with no authorisation, which is why the product has been moving sensitive files (flow definitions, call recordings) into non-public `storage/app` (see the migrations of behaviour noted there).
  6. Sub-folder support: the helper `tw_base()` derives the base path from the filesystem (script directory relative to the document root, falling back to the URL's script directory), normalises it to empty or `/sub`, and discards it when the live request URI does not actually start with it (guards against a root rewrite that maps `/x` to `/public/x` internally). The service provider's URL-forcing routine then sets the forced root URL to scheme + live request host + base path, forces the scheme to https when the request is secure, APP_URL starts with https, `X-Forwarded-Proto` is https or the port is 443, and overwrites the `public` disk URL to `<root>/storage`. In console/queue contexts there is no request, so nothing is forced and APP_URL applies.
  7. **Quirk with security impact:** the forced root takes its **host from the live request** (`getHttpHost`), not from APP_URL, and trusted-proxy handling defaults to trusting every proxy including `X-Forwarded-Host`. A spoofed Host header can therefore change absolute URLs generated in that request (email verification links, payment return URLs). Docs claim APP_URL "must be" the real domain because it builds media and callback URLs; for web requests that is not what the code does.
  8. The `.gitignore` excludes `/public/build`, `/public/hot`, `/public/storage`, `.env`, `node/.env` and `*.zip`, which is why a source checkout has no assets until a build runs.
- **Async & events:** none.
- **External systems:** Apache/Nginx/LiteSpeed; TLS-terminating proxies or tunnels (ngrok, Cloudflare Tunnel, ALB) set forwarded headers.
- **Settings:** `APP_URL` (scheme fallback, console contexts, documented as required), `TRUSTED_PROXIES` (default trust-all), `SESSION_SECURE_COOKIE` (defaults on in production).
- **Acceptance criteria:**
  - Given the target deployment behind a reverse proxy, when a request arrives with a forged `Host` or `X-Forwarded-Host`, then generated absolute URLs still use the configured public origin.
  - Given a request for `/favicon.ico` or `/robots.txt`, when the web app is served, then the response comes from the configured brand/SEO setting and not from an empty placeholder file.
  - Given a URL with a trailing slash such as `/dashboard/`, when requested, then it redirects (301) to the slash-less URL, matching Reference, or the port documents a deliberate change.
  - Given a service worker for push, when a new web build is deployed, then clients load fresh assets (the worker caches no application files).
- **Source refs:** public/index.php, public/.htaccess, public/robots.txt, public/favicon.ico, public/team-inbox-sw.js, public/js/, public/css/api-docs.css, public/images/, .gitignore, app/Support/fc_helpers.php (tw_base), app/Providers/AppServiceProvider.php (base-URL forcing), bootstrap/app.php (trusted proxies), Documentation/pages/installation/server-requirements.html
- **Port notes:** Next.js serves its own static assets; the API already sets `trust proxy` (`TRUST_PROXY`) and still needs an `APP_URL`-derived public origin for absolute URLs in mail and signed links (KERNEL file, kernel-protocol PR if a helper is added). Reverse proxy = Caddy per the single-VM deploy design, but `docker-compose.prod.yml` (KERNEL) has no Caddy service yet. Push service worker moves to `apps/web/public`. Do not port sub-folder hosting or the `/public` fallback. Robots/favicon shadowing is tracked in the CMS domain (TW-CMS-015).

### TW-INFRA-054 — Storage layout, filesystem disks and the public-storage link

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-INFRA-053
- **Summary:** All runtime state that is not in the database lives in a fixed tree under `storage/` plus a few web-served folders. Three filesystem disks exist (private `local`, web-visible `public`, optional `s3`) and a fourth dynamic `client_media` disk replaces the public one when an admin enables cloud storage. A boot-time routine makes uploaded files reachable even on hosts that cannot create symlinks.
- **Actors & access:** System. Admin controls the cloud switch (TW-SET-039/040). Operators must keep paths writable.
- **UX & screens:** None. The admin System Health page writes, reads and deletes a probe file under `health/` on the active media disk to show "Media storage" status (DASH domain).
- **Endpoints:**

| Endpoint           | Route name           | Handler                           | Middleware | Request                         | Response                                                                                                                                                                 |
| ------------------ | -------------------- | --------------------------------- | ---------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET storage/{path} | storage.local        | framework closure (`ServeFile`)   | none       | relative-signed URL             | streams a file from the **private** `local` disk with no-store caching and a locked-down CSP; 404 in production (403 otherwise) when the signature is missing or invalid |
| PUT storage/{path} | storage.local.upload | framework closure (`ReceiveFile`) | none       | signed URL with the upload flag | writes a file to the private disk                                                                                                                                        |

Both routes exist only because the `local` disk is configured with `serve => true`; with a working `public/storage` link the web server answers `/storage/*` before PHP, so these closures matter only when the link is absent. The app never generates temporary URLs, so both are effectively inert but are an extra route surface under a public prefix.

- **Data:** Disk config (`config/filesystems.php`): default disk `local` (env `FILESYSTEM_DISK`), `local` root `storage/app/private`, `public` root `storage/app/public` with URL `APP_URL/storage` and public visibility, `s3` from `AWS_*` env, and the link map `public/storage -> storage/app/public`.
- **Rules & edge cases:**
  1. Tree: `storage/app/public/` (public disk; subfolders per feature in TW-INFRA-055; `health/` probe); `storage/app/private/` (private disk: AI-training source files under `training/<workspace>/`); `storage/app/flows/` (flow JSON mirror written for the bridge, non-public on purpose after a cross-tenant enumeration risk was found at `/uploads/flows/`); `storage/app/call-recordings/` (private copy of voice-call media, migrated out of the web root on first authorised playback); `storage/app/backups/` and `storage/app/temp/updater/` (updater, INSTALL); `storage/app/extensions/` (extension ZIP staging, ADDONS); `storage/app/openssl-vapid.cnf` (minimal OpenSSL config generated on demand for push key generation); `storage/framework/{cache/data,sessions,views,testing}`; `storage/logs/laravel.log`; and the zero-byte-or-JSON file `storage/installed` that gates the whole app (TW-INST-001).
  2. `ensurePublicStorage` runs on **every request** at provider boot: ensure `storage/app/public` exists; remove a broken symlink; if a healthy symlink exists, stop; otherwise try `artisan storage:link` programmatically; if the link still cannot exist, create a real `public/storage` directory and, **when it is writable**, repoint the `public` disk root at it and copy any existing files from `storage/app/public` into it (skip files already present). Failures are swallowed. The reference tree is in this fallback mode (`public/storage` is a real directory with its own `.gitignore`).
  3. Because of the fallback, "where is a public file physically?" depends on the host: `storage/app/public/...` (symlink mode) or `public/storage/...` (directory mode). Any code that reads files by absolute path must try both (voice-reply and chat media code do).
  4. `media_disk()` / `media_storage()` / `media_url()` return the cloud disk when enabled and complete, else the local `public` disk, never throwing; features that call `media_disk()` follow the admin switch, features that hard-code `'public'` do not (see TW-INFRA-055). Switching providers does not migrate existing files.
  5. Wiring the `public` disk to a cloud bucket is done with the dynamic `client_media` disk registered at runtime from saved settings (encrypted secrets, TW-SET-039).
  6. Installer check: `storage`, `storage/app`, `storage/framework` and `bootstrap/cache` must be writable, `public/uploads/call-recordings` is created at install, then `storage:link` is run (TW-INST-015).
  7. Sessions during install use files in `storage/framework/sessions`; afterwards sessions, cache and queue use database tables (TW-INFRA-027).
  8. Docs vs code: docs name only `storage/` and `bootstrap/cache/` as writable; the code also needs `public/uploads/*`, `public/images/users` and (fallback mode) `public/storage` to be writable.
- **Async & events:** none (boot-time routine only; copying existing files runs on a request that switches modes).
- **External systems:** S3-compatible object storage when enabled.
- **Settings:** `FILESYSTEM_DISK`, `AWS_*`, `APP_URL`, cloud storage admin settings (SETTINGS).
- **Acceptance criteria:**
  - Given a fresh deployment, when the API starts, then all required buckets/paths exist or startup fails with a clear message, and the health readiness check reports storage read/write status.
  - Given a private file (AI training source), when a request without a valid signature asks for it by URL, then it is not served.
  - Given the cloud storage switch on, when a new media upload occurs, then the object lands in the bucket and the stored key resolves through one URL helper.
  - Given a deployment where the public path is unavailable, when an upload completes, then the upload fails loudly instead of silently returning false (Reference once lost voice notes because the store call returned false).
- **Source refs:** config/filesystems.php, app/Providers/AppServiceProvider.php, app/Services/CloudStorageManager.php, app/Support/fc_helpers.php (media_disk, media_storage, media_url), vendor/laravel/framework/src/Illuminate/Filesystem/FilesystemServiceProvider.php, vendor/laravel/framework/src/Illuminate/Filesystem/ServeFile.php, app/Models/Flow.php, app/Http/Controllers/CallRecordingController.php, app/Http/Controllers/AiTrainingController.php, app/Http/Controllers/Admin/HealthController.php, app/Http/Controllers/InstallController.php, storage/
- **Port notes:** Target is object storage: MinIO buckets `crm-media`, `crm-documents`, `crm-exports` exist in `docker-compose.yml` (KERNEL) and `S3_*` in `apps/api/src/config/env.schema.ts` (KERNEL). Today the chat domain has its own `LocalDiskMediaStore` behind a `ChatMediaStore` port (`infra/providers/chat-conversations/media/`), the settings domain has a hand-signed SigV4 probe, and `contact_files` stores only metadata: there is **no shared S3 client or upload path in the API**. A storage module (decision needed, listed in the target map) must provide: signed upload/download URLs, per-org key prefix, private-by-default, content-type allow-list, and one port that the chat store, contact files and later domains implement. Do not port the symlink/fallback dance, the `local` serve routes, or filesystem-path media. Flow JSON is database data in the target, not a file.

### TW-INFRA-055 — Upload locations per feature (catalogue)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-INFRA-054
- **Summary:** Every feature that accepts a file writes it to a feature-specific folder. Some go through the switchable media disk (cloud-capable), some are hard-wired to the local public disk, one is private, and a legacy group is written straight into `public/uploads` with no disk abstraction at all. The port needs this map to define buckets, key prefixes and access rules per feature.
- **Actors & access:** Each feature's own actors and permissions (see owning domains). No file endpoint is shared.
- **UX & screens:** Upload controls in each feature's screens; limits quoted in the UI sometimes disagree with the server (the scheduled-message composer says 5 MB while the server allows 50 MB, SCHED domain).
- **Endpoints:** none shared; the upload endpoints are in the owning domains. The public REST API media upload accepts a single multipart `file` up to 16 MB and returns a hosted URL (API domain).
- **Data:** Paths are stored as relative keys in feature columns (for example attachment, image, avatar, media path) and turned into URLs by `media_url()`.
- **Rules & edge cases:**
  1. **Via the switchable media disk** (`media_disk()`; local public or cloud): `avatars/` (user and admin-uploaded avatars), `contacts/` (contact photos), `chat-media/` (inbox/chat attachments, REST API media, browser-extension uploads; names get a random prefix plus the safe original name), `campaign-media/` (mobile campaign image/video/document), `wa-queue/` (mobile message queue media), `wa-templates/` and `wa-templates/carousel/` (template attachments), `auto-reply/` (auto-reply media), `flows/<type>s/` (flow node media), `store-products/`, `blog/` (featured and OG images), `team-chat/<workspace>/`, `payment-proofs/` (manual payment proof), `viber-broadcasts/`, `telegram-broadcasts/`, `line-broadcasts/`, `line-rich-menus/`, `invoices/branding/<workspace>/` (logo, signature, random names), `social/scheduled/<workspace>/` (social posts, random names).
  2. **Hard-wired to the local `public` disk** (ignores the cloud switch): `brand/` (platform favicon and logos), `branding/<workspace>/` (workspace logo and favicon), `billing/` (company logo for invoices), `meta-campaigns/` (ad creatives; also read back by absolute path), `pwa/` (PWA icons), `tiktok/<workspace>/`, `facebook/<workspace>/` (post media; also AI-generated composer images), `call-recordings/call-<id>.webm` (calling).
  3. **Private `local` disk:** `training/<workspace>/` (AI training files, deleted with the source).
  4. **Non-disk files under the web root (legacy, direct `move()`):** `public/uploads/scheduled/` (scheduled-message media; deleted with the schedule), `public/uploads/autoreply/<type>/` (mobile auto-reply media), `public/uploads/auth/` (auth-page side media, path stored in a setting), `public/uploads/frontend/` (marketing editor images), `public/images/users/` (mobile avatars), `public/uploads/call-recordings/` (raw PCM written **by the Node bridge** straight into this folder through a relative path to the Laravel tree, then relocated by Laravel on first playback), `public/uploads/flows/` (legacy flow JSON and images, purged on re-save).
  5. **Non-user files:** `storage/app/flows/flow_<id>.json` (bridge mirror), `storage/app/call-recordings/` (relocated recordings, WAV/MP3 built per side `user|agent|mixed`; raw PCM dropped after first playback; mixed output capped at 30 minutes), temp files in the system temp dir for transcodes.
  6. Naming: most uploads use framework-generated random names under the folder; some keep a sanitised original name (`SecureUpload::safeName`, SETTINGS/AUTH domain). Per-tenant prefixes (`<workspace>`) exist only on some folders; `chat-media`, `contacts`, `campaign-media`, `wa-templates`, `store-products` are flat and shared by all workspaces, so isolation relies on unguessable names plus database scoping.
  7. **Cross-process coupling:** the Node bridge writes into Laravel's `public/uploads/call-recordings` using a path relative to its own location (`node/` inside the Laravel tree). The architecture doc says media travels inline over HTTP with no shared file storage; that is false for call recordings. A bridge running on another host or container would lose recordings. The bridge also builds carousel image URLs under `/uploads/templates/carousel/`, a folder that no longer exists in the tree.
  8. Public unauthenticated access: anything under `public/uploads` and (in either storage mode) `/storage/**` is world-readable by URL; authorisation is by obscurity of the file name only.
- **Async & events:** none.
- **External systems:** cloud object storage when `media_disk()` is cloud (but only for group 1).
- **Settings:** cloud storage settings (TW-SET-039); PHP upload limits (TW-INFRA-048).
- **Acceptance criteria:**
  - Given each feature in rules 1-4, when the port's storage module is specified, then every feature has a bucket, key prefix `org/<id>/...`, retention rule and access mode (private signed URL vs public) recorded.
  - Given a call recording produced by the worker, when it is stored, then it goes to object storage through the storage module and not through a path shared between processes.
  - Given two organisations uploading a file with the same original name, when both complete, then the keys are distinct and one org cannot fetch the other's object by guessing.
  - Given an upload larger than the configured limit, when submitted, then the API returns a validation problem with the limit, not a server error.
- **Source refs:** app/Http/Controllers/AccountController.php, app/Http/Controllers/Admin/UsersController.php, app/Http/Controllers/ContactsController.php, app/Http/Controllers/Api/App/ChatController.php, app/Http/Controllers/Api/App/CampaignController.php, app/Http/Controllers/Api/App/QueueController.php, app/Http/Controllers/Api/V1/MediaController.php, app/Http/Controllers/Api/ExtensionApiController.php, app/Http/Controllers/TemplatesController.php, app/Http/Controllers/AutoReplyController.php, app/Http/Controllers/Api/App/AutoreplyController.php, app/Http/Controllers/FlowsController.php, app/Http/Controllers/WaProductController.php, app/Http/Controllers/Admin/BlogController.php, app/Http/Controllers/TeamChatController.php, app/Http/Controllers/CheckoutController.php, app/Http/Controllers/Viber/ViberBroadcastController.php, app/Http/Controllers/Telegram/TelegramBroadcastController.php, app/Http/Controllers/Line/LineBroadcastController.php, app/Http/Controllers/Line/LineRichMenuController.php, app/Http/Controllers/InvoiceSettingsController.php, app/Http/Controllers/SocialPostsController.php, app/Http/Controllers/AdminPagesController.php, app/Http/Controllers/SettingsTabsController.php, app/Http/Controllers/Admin/CheckoutSettingsController.php, app/Http/Controllers/MetaAdsController.php, app/Http/Controllers/Tiktok/TiktokPostController.php, app/Http/Controllers/Facebook/FacebookPostController.php, app/Http/Controllers/WaCallingController.php, app/Http/Controllers/CallRecordingController.php, app/Http/Controllers/ScheduledController.php, app/Http/Controllers/AiTrainingController.php, app/Http/Controllers/Admin/FrontendEditorController.php, app/Http/Controllers/Api/App/ProfileController.php, app/Models/Flow.php, node/services/wabaCallBridge.js
- **Port notes:** Feed the storage module design (see TW-INFRA-054 port notes). Each owning domain keeps its own upload endpoint but must call the shared storage service (no controller touches the filesystem). Folder names become key prefixes `org/<orgId>/<feature>/...`; every feature gets an explicit access mode. Call recording storage must not depend on a shared filesystem with the worker.

### TW-INFRA-056 — Retention and cleanup of files, logs, sessions and framework tables

- **Status:** partial
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-INFRA-054, TW-INFRA-055
- **Summary:** Reference has no general retention machinery. Files are deleted only when their owning record is deleted (and not for every feature), logs grow in one file unless the operator changes the channel, and several maintenance commands exist but are never scheduled. The workspace data-wipe command deletes database rows only and leaves files behind. The port must define explicit lifecycles.
- **Actors & access:** Operator (runs commands), system. Plans carry a data-retention window used by the wipe command (PLANS domain).
- **UX & screens:** None specific. Audit-log retention days is an admin security setting (NOTIFICATIONS/AUDIT domain).
- **Endpoints:** none.
- **Data:** `packages.data_retention_days`, `workspaces.plan_ends_at`, `workspaces.data_wiped_at`, `system_settings` key `security.audit_log_retention_days` (default 365), `sessions`, `cache`, `personal_access_tokens`.
- **Rules & edge cases:**
  1. **File deletes found:** user avatar replacement/removal, mobile avatar, template attachments and carousel images, blog images, meta-ads creative, AI-training source files, scheduled-message media, auto-reply files, LINE rich-menu image, flow JSON file on flow delete (plus any legacy public copy), extension and updater temp folders, temporary transcode files. **No delete call was found** for `chat-media`, `campaign-media`, `wa-queue`, `contacts`, `store-products`, `team-chat`, `payment-proofs`, broadcast media or `social/scheduled`, so those files outlive their rows. No sweeper removes orphans.
  2. `workspaces:wipe-expired [--force]`: for plans with `data_retention_days > 0`, workspaces whose `plan_ends_at` is older than that window and not yet wiped have rows deleted from a fixed table list (contacts, conversations, campaigns, broadcasts, flows, schedules, templates, keyword replies, deals, orders, AI assistants/sources, appointments, saved replies, attributes, widgets, incoming webhooks, devices, provider configs and more). Dry-run by default; real run needs `--force`. It never touches stored files or Node auth folders. It is not scheduled, so retention is enforced only when an operator runs it.
  3. `audit:prune [--days=] [--dry-run]` removes audit rows older than the configured days (zero means keep forever); `auth:clear-resets` clears expired password-reset tokens; `sanctum:prune-expired` is available but tokens never expire (TW-INFRA-047). None is scheduled (there is no scheduler by policy, TW-INFRA-027).
  4. Logs: default channel is `stack` of `single` -> one unbounded `storage/logs/laravel.log`; the `daily` channel (default 14 days via `LOG_DAILY_DAYS`), `stderr`, `syslog`, `slack`, `papertrail` and `errorlog` channels exist. `LOG_LEVEL` defaults to `debug` in code even though `.env.example` says production auto-picks `warning`; setting it to `off`, `none`, `false`, `0` or `disabled` routes everything to a null handler. The Node bridge currently prints all `console.log` output (the silencer is commented out) and has no rotation of its own.
  5. Sessions: database driver, default lifetime in code 10,080 minutes (7 days) while `.env.example` says 120; garbage-collection lottery 2 in 100; session cookie secure by default in production, `lax`, http-only. Expired cache rows are removed lazily when read; there is no pruning job for `cache`, `cache_locks`, `jobs`, `failed_jobs`.
  6. Node on-disk state (`node/baileys_auth/session_<digits>/`) is cleaned by the bridge's own cleanup routine when a device is terminated (NODE domain); there is no age-based sweep.
  7. Backups before updates are owned by INSTALL (TW-INST-021); the disclaimer states Reference provides no off-site backups.
- **Async & events:** console commands only; manual or externally scheduled.
- **External systems:** none.
- **Settings:** `LOG_CHANNEL`, `LOG_STACK`, `LOG_LEVEL`, `LOG_DAILY_DAYS`, `SESSION_LIFETIME`, `SESSION_*`, audit retention days, plan data-retention days.
- **Acceptance criteria:**
  - Given a deleted contact or conversation with attached media, when deletion completes, then its object-storage keys are removed or queued for removal within a documented delay.
  - Given a workspace past its plan's retention window, when the scheduled retention job runs, then database rows and storage objects for that org are removed in one auditable run, and the run is idempotent.
  - Given a production API, when logs are inspected, then they are structured JSON on stdout with a documented level default of `info`, with no file growth on the host.
  - Given the audit-log retention setting, when the nightly job runs, then rows older than the window are removed (Reference requires a manual command).
- **Source refs:** app/Console/Commands/WipeExpiredWorkspaces.php, app/Console/Commands/AuditLogPruneCommand.php, config/logging.php, config/session.php, config/cache.php, config/queue.php, app/Http/Controllers/AccountController.php, app/Http/Controllers/TemplatesController.php, app/Http/Controllers/AutoReplyController.php, app/Http/Controllers/AiTrainingController.php, app/Http/Controllers/ScheduledController.php, app/Models/Flow.php, node/utils/cleanup.js, routes/console.php, .env.example
- **Port notes:** Implement as BullMQ repeatable jobs in `apps/api/src/workers/` (KERNEL path; `partition-maintenance.service.ts` is the existing precedent) plus an object-storage orphan sweeper (the hard-delete-with-audit rule hard-delete-with-audit; the target map notes "no S3 orphan sweeper exists"). Logging: `nestjs-pino` already writes JSON to stdout and redacts secrets; ship logs off-box (README "Before production"). Do not port per-file logs, session GC lotteries or the dry-run-by-default wipe command; keep the dry-run option for the new retention job.

### TW-INFRA-057 — Deployment and process model (what runs where)

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-INFRA-048, TW-INFRA-053, TW-INFRA-054
- **Summary:** A Reference install is three cooperating pieces: a PHP application behind Apache or Nginx, a MySQL database, and the Node bridge as a separate long-running process that must always be up. There is no queue worker and no cron requirement by design. The package ships no container, process-manager, web-server or CI definitions, so every hosting detail is the operator's job.
- **Actors & access:** Operator/system administrator; developers.
- **UX & screens:** None. Operational signals: the admin Node-bridge settings page and System Health page (NODE and DASH domains) show whether the bridge answers.
- **Endpoints:** Framework health route `GET up` returns an HTML status page (200, or 500 with the exception text when a diagnosing listener throws); no dependency checks are registered. Channel-specific `*/_health` closures exist for Facebook, Telegram and TikTok. (Health endpoints are catalogued in the CORE-A/B entries; listed here for the topology only.)
- **Data:** none.
- **Rules & edge cases:**
  1. Processes: (a) web server + PHP-FPM or an Apache PHP module serving `public/`; (b) MySQL 8 / MariaDB 10.6 (the single source of truth, also session, cache and queue store); (c) the Node bridge (`node index.js`, default port 8888 per installer and docs, 3000 if unset), kept alive by PM2, systemd or Supervisor, or on shared hosting by cPanel "Setup Node.js App"/LiteSpeed using `app.cjs` or `server.cjs` (an alternate `index-cpanel.js` that strips a `/node` URL prefix is swapped in by renaming files). The docs give a PM2 recipe; no `ecosystem` file, unit file, Supervisor config, Dockerfile, compose file, nginx sample or CI pipeline ships in the package.
  2. Coupling: the app finds the bridge through the system setting `baileys_server_url` or `.env SERVER_URL`; every outbound HTTP call whose host and port match the bridge automatically carries the shared `X-Node-Token` (a global HTTP middleware in the provider). The bridge calls back to `APP_DOMAIN_NAME` with the same token; the two secrets must match (`NODE_WEBHOOK_TOKEN` in both `.env` files, or the admin-set encrypted setting plus `node/.env`). A mismatch shows up only as 401/403 lines in logs.
  3. Co-location requirement: the bridge writes call-recording audio into Laravel's `public/uploads/call-recordings` through a relative path and reads local media paths through a configurable allow-list (`MEDIA_READ_BASES`), so in practice it must run on the same machine and tree as the PHP app despite the "talk over HTTP only" description.
  4. No scheduler: there is no `schedule:run` cron. Periodic work (SLA escalation, snooze wake-ups, support SLA scan, WABA template status refresh, subscription reconciliation after the response on ordinary page requests) runs inline on requests that are already happening, usually deferred until after the response (TW-INFRA-027); Facebook and TikTok token-refresh sweeps run synchronously when the account/insights pages are opened; time-based sends are fired by the Node bridge's in-memory cron, with Laravel re-registering active schedules on bridge restart. Workspaces with no operator online get no sweeps.
  5. Reverse proxies/tunnels: trusted proxies default to "all", with forwarded-for, host, port, proto and AWS-ELB headers honoured; production should set `TRUSTED_PROXIES` to the edge address (otherwise per-IP rate limits, the admin IP allow-list and login lockout can be spoofed through `X-Forwarded-For`).
  6. Maintenance: an admin toggle (SETTINGS) and the framework file driver (`APP_MAINTENANCE_DRIVER=file`, `storage/framework/maintenance.php`) both exist.
  7. Local development: `composer dev` runs web server, `queue:listen`, log tail and Vite together; Windows/XAMPP paths are special-cased in the OpenSSL config lookup, so development on Windows is expected.
  8. Docs vs code: the architecture page says a queue worker (`queue:work`) is needed; the post-install page and routes/console say it is not; the installation FAQ lists it again (see TW-INST-018 rule 6). The code has no queued job classes, so the worker is not needed. The docs also claim "media is sent inline between app and bridge, no shared file storage needed", which is untrue for call recordings (TW-INFRA-055 rule 7).
  9. Upgrades/backups are owned by INSTALL (TW-INST-021..028) and are not repeated here.
- **Async & events:** none of its own.
- **External systems:** process managers, hosting panels, TLS proxy.
- **Settings:** `SERVER_URL`, `NODE_WEBHOOK_TOKEN`, `APP_URL`, `TRUSTED_PROXIES`, `DEMO_MODE`, `PORT`/`APP_DOMAIN_NAME`/`ALLOWED_ORIGINS` (bridge `.env`), system setting `baileys_server_url`.
- **Acceptance criteria:**
  - Given `docker compose -f docker-compose.prod.yml up -d`, when all services are healthy, then the API, worker, WhatsApp runner, Postgres and Redis each report readiness and a deployment needs no manual file renames.
  - Given the API and the WhatsApp runner configured with different shared secrets, when the stack boots, then startup or the readiness probe fails with a message naming the mismatch (Reference only logs 401).
  - Given a restart of the worker during a campaign, when it comes back, then in-flight and delayed jobs resume from Redis with no operator action.
  - Given a request that carries a forged `X-Forwarded-For`, when it reaches the API behind the documented proxy, then rate limits and audit logs use the real client address.
- **Source refs:** bootstrap/app.php, app/Providers/AppServiceProvider.php (outbound node-token middleware), app/Support/fc_helpers.php (node_token, tw_node_url), routes/console.php, composer.json (scripts), node/index.js, node/index-cpanel.js, node/server.cjs, node/app.cjs, node/services/wabaCallBridge.js, Documentation/pages/developer-guide/architecture.html, Documentation/pages/installation/post-install.html, Documentation/pages/installation/server-requirements.html, Documentation/pages/faqs/installation.html
- **Port notes:** Target topology is already decided: the single-VM deploy design single VM, `docker-compose.prod.yml` (api, worker, postgres, redis) with Caddy in front, the BullMQ worker design BullMQ worker from the same image. Gaps to add (all KERNEL, kernel-protocol PR): a WhatsApp runner service (if the Baileys socket host is separate from `worker`), Caddy, an object store or its credentials, a one-shot migrate step, per-service healthchecks, and a CI image push. `docs/runbooks/` needs a deployment runbook; the README "Before production" list (tested backup restore, monitoring, disk alerts, log shipping) is unmet today. Do not port the cPanel entrypoints, PM2 instructions or the file renaming dance.

### TW-INFRA-058 — APP_KEY-bound signed URLs and token-bearing links

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-INFRA-023, TW-INFRA-053
- **Summary:** Only one product flow uses framework signed URLs: the email verification link, valid for an hour and bound to the account's email. The framework also ships signed local-disk URLs that the app never issues. Everything else that looks like a signed or tokenised link uses bespoke secrets (per-resource tokens in the path, HMAC headers). The port must replace the framework signature with an explicit mechanism.
- **Actors & access:** New user or admin-created user clicking the link (works while logged out); authenticated user requesting a resend.
- **UX & screens:** Verification email (from the notification/mail domain), then redirect. Failure messages paraphrased: link expired or invalid; user not found; link no longer matches this account because the email changed.
- **Endpoints:**

| Endpoint                     | Route name          | Handler                            | Middleware | Request                           | Response                                                                                                      |
| ---------------------------- | ------------------- | ---------------------------------- | ---------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| GET verify-email/{id}/{hash} | verification.verify | EmailVerificationController@verify | web        | numeric id, hash, signature query | marks verified, logs the user in if guest, redirects to dashboard; otherwise redirects to login with an error |
| POST email/verify/resend     | verification.send   | EmailVerificationController@resend | web, auth  | none                              | resends the email, flash message                                                                              |

- **Data:** `users.email_verified_at`; hash is the SHA-1 of the user's email.
- **Rules & edge cases:**
  1. Link creation uses a temporary signed route with 60 minutes validity, parameters `id` and `sha1(email)`; the signature is an HMAC of the full URL with `APP_KEY`.
  2. Verification checks, in order: valid signature (so expiry and tampering), user exists, the hash equals the current email's SHA-1 (so changing email invalidates old links), then sets the verified timestamp if empty and **logs the user in** when not authenticated (a verification link is a login link).
  3. The signature covers the host and scheme used to build the URL. Because the forced root URL takes the host from the live request (TW-INFRA-053 rule 7), a link generated under one host and opened under another (reverse-proxy rewrite, sub-folder move) fails as "expired or invalid". Changing `APP_KEY` invalidates all outstanding links.
  4. Sending is refused with a specific reason when no mailer is set, the from address is empty or the example default, or SMTP host/port are missing; the resend action reports that reason.
  5. The route has no `signed` middleware; the check is inside the controller.
  6. Other link-style secrets, none of them framework-signed: incoming webhook URLs (random 40-character token in the path), chatbot widget embed tokens, storefront and payment webhooks (HMAC headers), Slack/Trello/Shopify/WooCommerce signature headers, outbound webhook HMAC (`X-<brand>-Signature` from the stored secret). The local-disk signed-URL serve routes of the framework (TW-INFRA-054) are never used.
  7. Expiry, resend throttling and token rotation for password reset are AUTH domain behaviours.
- **Async & events:** verification email queued/sent synchronously by the mail system (NOTIF domain).
- **External systems:** SMTP.
- **Settings:** mail configuration; `APP_KEY`.
- **Acceptance criteria:**
  - Given a verification link older than 60 minutes, when opened, then the user lands on login with an "expired or invalid" message and is not verified.
  - Given a user who changed email after requesting a link, when the old link is opened, then verification is refused with the "no longer matches" message.
  - Given a valid link opened in a browser with no session, when it is used, then the user becomes verified and signed in (or, deliberately, only verified and sent to login: decision recorded for the port).
  - Given the public origin differs from the origin in the link (proxy), when opened, then it still verifies because the signature is bound to the configured public origin.
- **Source refs:** app/Http/Controllers/EmailVerificationController.php, routes/web.php, app/Providers/AppServiceProvider.php, vendor/laravel/framework/src/Illuminate/Filesystem/ServeFile.php, app/Mail/VerifyEmailMail.php
- **Port notes:** Implement as a single-purpose verification token (random, hashed at rest, single use, 60 minute expiry) in the auth module (`apps/api/src/modules/auth`, AUTH domain), not as a URL signature. Decide explicitly whether the link also signs the user in. Public origin must come from `APP_URL` (`env.schema.ts`, KERNEL), never from the Host header.

### TW-INFRA-059 — Framework defaults the app silently relies on (timezone, locale, hashing, cache prefixes)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** —
- **Summary:** Several behaviours exist only because of Laravel defaults and a handful of helper functions: timestamps are stored in UTC and converted for display, the request language is picked from a fixed precedence, passwords are bcrypt, and cache and cookie names derive from the app name. The port must pin each of these on purpose.
- **Actors & access:** System; every user indirectly.
- **UX & screens:** All times in inbox, analytics and reports; language switcher; right-to-left pages.
- **Endpoints:** none.
- **Data:** `users.locale`, `users.timezone`, `workspaces.timezone`, `workspaces.default_language`, system settings `default_timezone`, default locale (SETTINGS).
- **Rules & edge cases:**
  1. Application timezone is `APP_TIMEZONE`, default **UTC**; PHP writes timestamps in that zone and the database connection sets no zone of its own. Display conversion is done by helpers: `wa_tz()` picks the first valid of explicit zone/workspace row, current workspace zone, user zone, admin `default_timezone`, app timezone, then `UTC`; `wa_local()` converts a stored timestamp (strings are interpreted in the app zone) into that zone; `safe_timezone()` maps legacy aliases (for example Asia/Calcutta to Asia/Kolkata) and falls back instead of throwing. Bad zone strings never crash a page. Scheduled sends carry their own zone per schedule or campaign and are computed by the Node bridge with moment-timezone.
  2. Locale: `APP_LOCALE` and `APP_FALLBACK_LOCALE` default `en`. Request locale, for browser (`web` group) requests only, is: signed-in user's saved locale if available; else session locale; else the current workspace's default language; else the platform default. The mobile API, Node callbacks and API-key routes do not run this middleware and use the platform default. 21 translation files (en plus 20) live in `lang/*.json`, keyed by the English source string; right-to-left set: Arabic, Hebrew, Urdu. Details in TW-SET-045 and the LOCALIZATION entries.
  3. Passwords: `hashed` cast, bcrypt, cost 12 unless `BCRYPT_ROUNDS`; there is no `config/hashing.php`, so framework defaults apply.
  4. Cache and Redis key prefixes derive from the slugified `APP_NAME` (`<app-name>-cache-`, `<app-name>-database-`), and the session cookie name is `<app-name>-session`; renaming the app therefore logs everyone out and drops cached settings. The install wizard uses a fixed file-session cookie name for this reason (TW-INST-001). Docs also warn that spaces or special characters in `APP_NAME` can blank the site.
  5. `config/app.php` still defaults its `version` to 1.4.0 (the real version lives in `config/version.php`) and `demo_mode` from `DEMO_MODE`.
  6. Number/currency/money display and the 21-locale date formats are handled by SETTINGS helpers (`MoneyFormat`, `FormatSettings`); no intl extension is used, and no bcmath call exists.
  7. Cookie and security defaults relied upon: `lax` same-site, secure cookies in production, http-only, partitioned off, session lifetime in code 10,080 minutes, CSRF protection on all `web` routes except a long exemption list in the bootstrap (about 85 patterns for machine callbacks), and a graceful 419 handler that redirects instead of showing an error page.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `APP_TIMEZONE`, `APP_LOCALE`, `APP_FALLBACK_LOCALE`, `BCRYPT_ROUNDS`, `APP_NAME`, `SESSION_*`, system settings for default timezone/language.
- **Acceptance criteria:**
  - Given a workspace with timezone Asia/Kolkata, when a message stored at 10:00 UTC is displayed, then the UI shows 15:30 and the API returns an ISO-8601 timestamp with offset.
  - Given a user with no locale, a workspace default of Arabic, and a platform default of English, when the user opens the app, then Arabic is used and the layout is right-to-left.
  - Given an invalid or legacy timezone string saved on a workspace, when pages render, then they fall back to a valid zone and never error.
  - Given the app is renamed, when users return, then sessions and caches are not invalidated (deliberate improvement: names must not derive from the brand).
- **Source refs:** config/app.php, config/session.php, config/cache.php, config/database.php, app/Support/fc_helpers.php (wa_tz, wa_local, safe_timezone), app/Http/Middleware/SetLocale.php, app/Support/LocaleSettings.php, app/Models/User.php, bootstrap/app.php, lang/en.json, Documentation/pages/developer-guide/customization.html
- **Port notes:** Store `timestamptz` in Postgres and return ISO-8601 with offset; display conversion in `apps/web` using the org/user timezone (web foundation F1). Pin `TZ=UTC` in the Dockerfile (KERNEL). Locale resolution belongs to the web/i18n foundation and the localization domain; the API should accept an explicit language, not infer it from several stores. Hashing is argon2 (`@node-rs/argon2`); plan a bcrypt-verify migration path in AUTH.

### TW-INFRA-060 — Developer toolchain and the test suite Reference ships

- **Status:** partial
- **Priority:** P2
- **Effort:** M
- **Depends on:** TW-INFRA-047
- **Summary:** Reference ships a stock Laravel PHPUnit setup with a small, targeted regression suite (12 feature and 3 unit test files, plus 6 Node smoke scripts) and no CI. It is useful as a list of behaviours the authors found worth protecting, not as coverage. The port should turn each case into an acceptance test in the owning domain.
- **Actors & access:** Developers.
- **UX & screens:** none (CLI).
- **Endpoints:** none.
- **Data:** tests run on in-memory SQLite and build the few tables they need by hand.
- **Rules & edge cases:**
  1. `phpunit.xml`: two suites (`tests/Unit`, `tests/Feature`), source coverage include `app/`, environment forced to testing with array cache and session, sync queue, null broadcast, array mailer, SQLite `:memory:`, bcrypt rounds 4, Pulse/Telescope/Nightwatch disabled (packages that are not installed).
  2. Run via `composer test` (clears config then `artisan test`). No coverage threshold, no static analysis, no CI configuration. Pint is installed without a config; no ESLint/Prettier.
  3. The full migration set contains MySQL-only statements (about 11 files), so most tests avoid migrations and create minimal tables inline. Two feature tests use `RefreshDatabase`, which would run all 350 migrations on SQLite; whether they pass was not verified (read-only review).
  4. Default scaffolding tests remain: `Feature/ExampleTest` asserts `GET /` returns 200 (a install-gate redirect to `/install` would make this fail on a fresh checkout), `Unit/ExampleTest` asserts true.
  5. Behaviours covered by real tests: attribute placeholder validation (contiguous one-based indices, whitespace tolerated, gaps and zero rejected); Instagram webhook signature creation/acceptance and rejection of missing/wrong/mismatched signatures; Instagram signed self-test storing a non-automating inbound and invalid signature rejected before any write; multi-number inbox routing (two business numbers get separate threads, each thread stays bound to its receiving number, single-number workspace still collapses to one thread); campaign sends landing in the sending number's thread; contact CSV import (re-import updates, imported contact dedups on inbound); notification workspace stamping (event stamped with the record's workspace, not the viewer's) and no cross-workspace bell leakage; read/click tracking (read cascades into delivered and sent, tokens scoped per campaign, idempotent wrapping, expired rows skipped, distinct link per recipient, bots redirect without counting); scheduled-message preview sender (own number only, junk number refused, local-only treated as failure, never throws); subscription reconciler (expired workspace restored when gateway shows a new paid period, one-time purchase reported not renewed, healthy plan not polled, throttled second poll); WABA parallel campaign send (every recipient fans out through the pool with a faked HTTP client, concurrency clamped, unapproved template refused without calling Meta); WABA embedded signup dedupe (same number reuses row, different number creates a new one); plus a bug-batch file (attribute resolver per-contact values, CSV extra columns, appointment unschedule cancelling reminders).
  6. Node: six stand-alone `.mjs` smoke scripts without a runner (TW-NODE-054).
  7. Not covered at all: tenancy isolation across workspaces in general, permissions, billing/wallet maths, payment drivers, encryption, installer/updater, most controllers, the front end.
  8. Developer scripts: `composer setup`, `composer dev`, `php artisan pail` for log tailing, `translatable:export` for new strings.
- **Async & events:** none.
- **External systems:** none (HTTP faked).
- **Settings:** the env overrides in `phpunit.xml`.
- **Acceptance criteria:**
  - Given each real test listed in rule 5, when the owning domain is ported, then an equivalent named test exists in its `apps/api/test/{unit,integration,e2e}/<domain>/` folder (skill `threadwise-e2e-tests`).
  - Given a pull request in the port, when CI runs, then format, lint, typecheck, architecture boundaries, migrations from scratch, unit and integration tests all run (already true in `.github/workflows/ci.yml`).
  - Given a new tenant-scoped table, when its migration lands, then a cross-tenant isolation test proves RLS (the coverage Reference lacks).
- **Source refs:** phpunit.xml, tests/TestCase.php, tests/Feature/_.php, tests/Unit/_.php, composer.json (scripts, require-dev), node/test/*.mjs, database/factories/UserFactory.php
- **Port notes:** Target tooling already exists and exceeds Reference's: vitest unit/integration/e2e folders under `apps/api/test`, testcontainers Postgres, dependency-cruiser, husky/lint-staged/commitlint, CI in `.github/workflows/ci.yml` (KERNEL, K3 steward). Nothing from Reference's PHPUnit setup is ported; only the scenarios.

### TW-INFRA-061 — Developer documentation set: architecture, customization, database schema, third-party integrations

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** TW-INFRA-057
- **Summary:** Four developer-guide pages explain the system to resellers and integrators. They are accurate about the big picture but contain statements that the code contradicts. The port needs its own developer documentation; this entry records what Reference promised so the new docs cover the same ground and avoid the same errors.
- **Actors & access:** Developers and resellers reading the static documentation site.
- **UX & screens:** Static HTML pages under `Documentation/pages/developer-guide/` (see TW-INFRA-062 for the site shell).
- **Endpoints:** none.
- **Data:** none.
- **Rules & edge cases:**
  1. Architecture page: describes two processes plus a database, request/send lifecycle (every send goes through one of two dispatchers, checks the emergency halt and monthly quota, routes to the bridge or sends directly for Twilio, returns a uniform result of ok/provider id/platform/local-only/error), engine resolution order (workspace engine, platform default, unofficial fallback), core concepts, queue and scheduling model, security boundaries (token-protected endpoints outside the session system, encrypted credentials, emergency halt). Errors: claims a queue worker is needed; claims Alpine.js; claims media never needs shared storage (TW-INFRA-055 rule 7, TW-INFRA-057 rule 8).
  2. Customization page: four themes, branding (per-theme logos, favicon, app name, billing identity), outbound message footer rules (platform footer unless the plan allows removing branding, then the workspace footer or none; approved templates excluded), front-end build commands, adding a language by copying `en.json` and setting `APP_LOCALE`, the environment variable table (`APP_NAME`, `APP_URL`, `APP_LOCALE`, `DB_*`, `QUEUE_CONNECTION`, `CACHE_STORE`/`SESSION_DRIVER`, `SERVER_URL`, `NODE_WEBHOOK_TOKEN`, `MAIL_*`) and the rule to clear the config cache after edits. Errors: three Vite inputs (four exist); "no emoji" convention is a style rule, not enforced.
  3. Database schema page: groups the main tables (tenancy and identity, polymorphic sender in `devices` versus `wa_provider_configs` disambiguated by provider, CRM and conversations, templates/auto-reply/flows/campaigns/broadcasts, packages/orders) and warns against writing directly because of encryption and application-side enforcement. It lists a fraction of the 219 tables (the schema port is a separate workstream).
  4. Third-party integrations page: three integration styles (outgoing/incoming webhooks, native OAuth/API-key connectors for HubSpot, Shopify, WooCommerce, Google, Slack, Trello, payments and bring-your-own AI keys, and the REST API with workspace keys) and a pointer to extend the platform via driver classes.
  5. The page sets promise a documented extension model ("driver classes, service bindings and the bridge hook in") that the pages themselves do not describe; the add-on/extension system is the real extension point (ADDONS domain).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the port's developer docs, when compared with this entry, then they cover architecture, customization, schema map and integration styles for the new stack.
  - Given any statement from rules 1-2 flagged as wrong, when the new docs are reviewed, then the corresponding claim is stated correctly for the target (queue worker required, real front-end stack, no shared filesystem).
  - Given a developer following the docs from a clean machine, when they run the documented setup, then they reach a working API, worker and database without undocumented steps (`docs/runbooks/local-development.md`).
- **Source refs:** Documentation/pages/developer-guide/architecture.html, Documentation/pages/developer-guide/customization.html, Documentation/pages/developer-guide/database-schema.html, Documentation/pages/developer-guide/third-party-integrations.html
- **Port notes:** Docs live in `docs/` (KERNEL: `docs/architecture/`, `docs/runbooks/`, `docs/README.md`). `docs/architecture/overview.md` already covers topology; add integration-style guidance to `docs/api/<domain>.md` per domain.

### TW-INFRA-062 — Product documentation site, FAQs, legal and support pages

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** —
- **Summary:** The product ships a static, self-contained documentation website (home page, sidebar navigation, per-page table of contents, title search) plus overview, FAQ, disclaimer, privacy, credits, support and conclusion pages. These carry the marketing description, the licensing and support policy, and liability language. The port needs equivalents written from scratch; the legal text is specific to the seller and must not be reused.
- **Actors & access:** Buyers, operators, evaluators; public static files (outside the app).
- **UX & screens:** `Documentation/index.html` and `Documentation/pages/**`. Sidebar built by `assets/sidebar.js` from a hard-coded list (about 128 links in 17 groups), table-of-contents scroll-spy, collapsible groups with remembered scroll position, and a search box (Ctrl/Cmd+K focuses it) that matches the typed text against **sidebar link titles only** (not page content) and shows a dropdown with category labels, built with DOM text nodes to avoid markup injection. Styling uses the Tailwind CDN, Font Awesome CDN and Google Fonts. Pages claimed here: Introduction, Key Features, General FAQs, Video Guides (single YouTube playlist link), Disclaimer, Privacy Policy (a one-paragraph pointer to the seller's website), Support, Source and Credits, Conclusion.
- **Endpoints:** none (static).
- **Data:** none.
- **Rules & edge cases:**
  1. Introduction: product positioning, the three engines and engine selection order (admin allowed list, workspace engine, platform default), the workspace model (registration creates a workspace named after the user, owner role, Starter plan with trial), feature landscape by area, technology table, three-part architecture, key advantages, documentation map.
  2. Key Features: a plan-aware feature map across connectivity, nine extra channels (Instagram, Messenger, Telegram, TikTok, SMS, LINE, WeChat, Viber, Email), inbox, bulk messaging, templates and automation, AI suite, commerce, marketing, sales pipeline, integrations (REST API with 50+ endpoints, 17 webhook events, Slack, Trello, browser extension), account/team and SaaS admin.
  3. General FAQs: engines, licence basics (Regular vs Extended licence, one licence per installation, six months support, free lifetime updates), multi-tenant SaaS and resale rules, white-label, common setup errors (mail settings, payment gateway toggles, blank page from special characters in app name, mixed content, PHP upload limits, phpinfo hygiene, `proc_open`).
  4. Disclaimer: not affiliated with WhatsApp/Meta; the unofficial engine may violate WhatsApp terms and is for testing only; as-is warranty; operator duties (lawful messaging, data protection, patching, own backups: none provided); third-party costs not included; credential security; prohibited uses; GDPR non-certification.
  5. Support: six months of item support, response target 24-48 business hours, India working hours, what is and is not covered (unofficial engine and Meta-side decisions excluded), what to include in a ticket (purchase code, engine, `storage/logs/laravel.log`, versions).
  6. Source and Credits: lists open-source libraries by group; incomplete (omits sanctum, dompdf, scramble, flysystem, web-push, pusher, pdfparser, htm, driver.js) and names Font Awesome/Inter as UI assets, which are documentation-site assets.
  7. The seller's personal support email address appears on the support and conclusion pages; do not carry it into the port.
  8. Documented claims verified false or unverifiable in code: "Alpine.js UI", "queue worker required", "bcmath required", "no shared file storage".
- **Async & events:** none.
- **External systems:** CDNs for the docs site; YouTube playlist.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the port's documentation, when an evaluator reads the overview, then it states the real stack, supported channels and plan model of the new product.
  - Given the licence and support text, when the port ships, then it contains the product owner's own terms (Reference's seller-specific language is not reused).
  - Given a documentation search, when the user types a feature name, then it matches page content, not only titles (deliberate improvement).
  - Given a published credits page, when generated, then it is built from the lockfiles so it cannot omit a dependency.
- **Source refs:** Documentation/index.html, Documentation/assets/script.js, Documentation/assets/sidebar.js, Documentation/assets/styles.css, Documentation/pages/introduction.html, Documentation/pages/key-features.html, Documentation/pages/faqs/general.html, Documentation/pages/faqs/video-guides.html, Documentation/pages/faqs/disclaimer.html, Documentation/pages/faqs/privacy-policy.html, Documentation/pages/conclusion/support.html, Documentation/pages/conclusion/source-credits.html, Documentation/pages/conclusion/conclusion.html
- **Port notes:** Product documentation is an authoring task, not code: `docs/` plus a docs app if wanted (not in `apps/*` today). Marketing and legal copy belong to the CMS/marketing domain and the product owner. Generate third-party credits from `pnpm-lock.yaml` in CI (KERNEL, `.github/`).

## Data model

The port drops all of these. Replacement is stated per table; none needs a migration in `packages/db`.

- `cache` (key pk, value mediumtext, expiration int indexed): the default cache store, used for settings caches, run-at-most-every-N gates, rate-limit counters, dedupe windows, presence and circuit breakers (about 200 call sites, TW-INFRA-025). Replaced by Redis via `REDIS_CLIENT` (`apps/api/src/infra/redis/redis.module.ts`, KERNEL) with tenant-prefixed keys and TTLs.
- `cache_locks` (key pk, owner string, expiration int indexed): backs `Cache::lock` for sweeper mutual exclusion, booking slot reservation, payment webhook idempotency, invoice sending. Replaced by Redis `SET NX PX` locks with owner token (a kernel-provided lock helper is proposed in TW-INFRA-025 Port notes).
- `jobs`, `job_batches`, `failed_jobs`: the database queue, batch bookkeeping and dead-letter table. `app/Jobs/` is empty and no class is queueable, so they are always empty (TW-INFRA-027, TW-INFRA-045); the health page can clear them. Replaced by BullMQ queues (`apps/api/src/infra/queue/`, KERNEL) with bounded completed/failed retention.
- `migrations` (id, migration, batch): framework migration ledger, 350 migration files. Replaced by the repo's `_migrations` ledger written by the `packages/db` migrator (the hand-written SQL migrations rule).
- Adjacent plumbing, owned elsewhere but mentioned for completeness: `sessions` (AUTH; replaced by refresh-token/session table), `password_reset_tokens` (AUTH; also reused by the mobile OTP flow), `personal_access_tokens` (Sanctum mobile tokens, never expire; replaced by JWT refresh tokens/API keys).
- Cache keys are workspace-scoped by string convention only; the port must prefix with `orgId`.

## Cross-domain contracts

### HTTP pipeline

- Owned elsewhere, NOT duplicated here (referenced in TW-INFRA-002): SecurityHeaders (auth-registration-security TW-AUTH-045), NoStoreResponse (TW-AUTH-020, marketing-site-cms), Maintenance (platform-settings-branding-storage TW-SET-008), DemoMode (install-update-licensing TW-INST-029), SetLocale (localization-translation TW-I18N-008), UseFileSession and EnsureInstalled (TW-AUTH-049, TW-INST-001), SessionTimeout / LimitConcurrentSessions / Force2FA / IPAllowlist (auth-registration-security TW-AUTH-033, 034, 032, 038), ApiPlanRateLimit and EnforcePlanFeature and EnsureTrialActive (plans-subscriptions-trials TW-PLAN-022, 019, 015), ChatbotWidgetCors (chatbot-widget TW-WGT-020, TW-WGT-022), ResolveTenantDomain / ImpersonationBanner / EnsureWorkspace* (workspaces-teams-tenancy), RecordAgentActivity (team-inbox-conversations TW-TIB1-046), ReconcileSubscription / PaddleReturnRedirect (platform-payment-gateways TW-PAYGW-030, 017), CaptureReferral (coupons-credits-referral-currency), EnsureUserActive (TW-AUTH-016), SecureUpload guard itself (TW-AUTH-043).
- Consumes from developer-rest-api-v1: key management screens, `{data, meta}` / `{error}` envelopes, scopes semantics (TW-INFRA-011 only owns authentication). Consumes from chrome-extension-sheets-addon: endpoint behavior behind `ExtensionApiAuth` (TW-INFRA-012). Consumes from mobile-app-api: login/token issuance, 2FA, device tokens (TW-INFRA-013, TW-INFRA-019 only own request scoping and guard defaults).
- Consumes from node-bridge-runtime: Node token header semantics and outbound token injection (TW-NODE), `tw-sync` (TW-NODE-053), Node CORS and health (TW-NODE-003, 004). Consumes from platform-settings-branding-storage: storage disk routing and public-mount repair (TW-SET-040), `csrf-token` route and JS (TW-AUTH-020).
- Exposes: the CSRF exemption classification (TW-INFRA-005) as the webhook/callback authentication checklist for every channel, payment and Node-callback domain; the shared-bucket throttle warning (TW-INFRA-010) for all domains that attach throttles; the upload matrix (TW-INFRA-017) for every domain that accepts files; the error shapes (TW-INFRA-008/TW-INFRA-009) to plans and inbox domains.

### Config and runtime services

Consumes:

- `platform-settings-branding-storage` (TW-SET-001, 024, 040, 041, 042, 046): the system settings store that overrides env at runtime (mail, Pusher, cloud storage, timezone, brand). TW-INFRA-029, TW-INFRA-037, TW-INFRA-043 depend on it.
- `install-update-licensing` (TW-INST-011, 016, 017, 024, 025, 029): writes `.env` and `node/.env`, runs migrations, clears caches, owns `DEMO_MODE` and `config/version.php`/`license.*`.
- `node-bridge-runtime` (TW-NODE-001, 002, 014, 052, 053): the bridge process, auth guard, heartbeat tick, admin bridge settings, `tw-sync` (dead code). TW-INFRA-034, TW-INFRA-040, TW-INFRA-044 describe the Laravel side only.
- `notifications-activity-audit` (TW-NOTIF-026, 027, 028): audit writer and observers used by TW-INFRA-035.
- `auth-registration-security` (TW-AUTH-017, 018, 037; config/session.php, config/auth.php): login side effects and security policy.
- `team-inbox-conversations` (TW-TIB1-015): the browser Echo client and event semantics for TW-INFRA-039.
- `bsp-billing-engine` (TW-BSP-008): consumer of the WABA save hook (TW-INFRA-036).
- `addons-extension-registry` (TW-ADD-009, 011, 022): module loader and Instagram teardown that TW-INFRA-038 hooks.
- `dashboards-analytics-charts` (TW-DASH-048, 051): health page reads cache, queue tables and the bridge.
- `roles-permissions` (TW-RBAC): policies, Blade directive, 24-hour permission cache.
- `scheduled-queue-warmer` (TW-SCHED-020..027, 042): Node scheduler and retry sweepers triggered by the heartbeat.
- `meta-ads`, `channel-*`, `commerce` domains (not yet written): own the data behind `meta_targeting.php`, `storefront.php`, `catalog:resync`, token refresh sweeps.
- `developer-rest-api-v1`: owns the REST API behavior documented by the generated OpenAPI file (TW-INFRA-031); also owns the `docs`/`docs/api` redirect routes and `/developers/docs` view.

Exposes:

- The env key catalogue (TW-INFRA-021) and the dropped-key list (TW-INFRA-030) as the checklist for `apps/api/src/config/env.schema.ts` (KERNEL) and the `config/domains/platform-infrastructure.env.ts` fragment (`INFRA_` prefix).
- The periodic-work catalogue (TW-INFRA-040) as the list of sweepers every owning domain must re-implement as worker jobs: inbox escalation, SLA breach, snooze wake, deal and CRM task reminders, campaign schedule sweep, scheduled-message retry, broadcast retry, appointment lifecycle and reminders, invoice sweep, expired-workspace wipe, stock-hold release, device liveness and idle logout, template status refresh, token refresh (TikTok), subscription reconcile, audit retention prune.
- The cache usage catalogue (TW-INFRA-025) as the contract for a kernel Redis lock/throttle/rate-limit helper.
- The real-time channel and event table (TW-INFRA-039) as the contract for room names in the socket.io registry (conflict-map S7b).
- The CSRF-exempt path catalogue (TW-INFRA-001) as the list of machine-to-machine entry points that each need an authenticated controller in the port.

Ownership notes for the port (from `_work/schema/ownership.json`, kernel list): `apps/api/src/config/env.schema.ts`, `config.module.ts`, `infra/db/`, `infra/redis/`, `infra/queue/`, `workers/`, `realtime/`, `health/`, `main.ts`, `app.module.ts`, `worker.ts`, `docker-compose*.yml` and `.github/` are KERNEL (kernel-protocol PR, steward K2 vedant for infra/queue/realtime). Not kernel: `apps/api/src/config/domains/platform-infrastructure.env.ts`, `modules/platform-infrastructure/`, `infra/providers/platform-infrastructure/` (domain owner lakshya).

### Dependencies, storage and operations

- **install-update-licensing (INST):** owns the requirements check (TW-INST-004), `storage/installed`, storage link at install (TW-INST-015), backups/updater/rollback (TW-INST-021..028) and the hosting-guidance doc entry (TW-INST-018). Part C does not repeat them. `Documentation/pages/installation/server-requirements.html` is co-claimed (INST + TW-INFRA-048/TW-INFRA-057).
- **node-bridge-runtime (NODE):** owns bridge entrypoints, env keys, token auth, schedulers, tests (TW-NODE-001/002/054). TW-INFRA-049 (bridge dependency groups), TW-INFRA-055 rule 7 and TW-INFRA-057 rules 2-3 add the co-location contract: the bridge writes `public/uploads/call-recordings` through a relative path and reads local media via `MEDIA_READ_BASES`. `developer-guide/architecture.html` is co-claimed with NODE.
- **platform-settings-branding-storage (SET):** owns `config/filesystems.php` behaviour for cloud storage (TW-SET-039/040), locale registry (045), timezone (046), PWA, Pusher. Part C co-claims `config/filesystems.php` for the on-disk layout and public-storage link (TW-INFRA-054); `AppServiceProvider` is claimed here for storage wiring and base-URL forcing, and is also expected to be claimed by the CORE provider entries (part A/B) for its listeners, policies and node-token HTTP middleware.
- **marketing-site-cms (CMS):** static `public/robots.txt` shadows the dynamic robots route (TW-CMS-015); not re-claimed.
- **dashboards-analytics-charts (DASH):** admin System Health controller (storage probe, node ping) is theirs; TW-INFRA-048/TW-INFRA-054 only reference it.
- **developer-rest-api-v1 (API):** owns `dedoc/scramble` behaviour, `config/scramble.php`, `GET docs/api.json`, `/developers/docs`, the branding rewrite in the provider, the 16 MB media upload endpoint. TW-INFRA-047 only registers the dependency.
- **auth-registration-security (AUTH):** owns `config/session.php`, `csrf-token`, mobile Sanctum login flows, password reset, password hashing migration (bcrypt to argon2). TW-INFRA-047/TW-INFRA-023/TW-INFRA-058/TW-INFRA-059 state the framework-level facts they depend on.
- **localization-translation (LOC):** owns `lang/*.json`, `translatable:*` commands and `config/laravel-translatable-string-exporter.php`; TW-INFRA-047 notes that the exporter is a dev-only dependency.
- **Every media-producing domain (chat, templates, auto-reply, broadcasts, campaigns, flows, store, blog, invoices, social, calling):** must use the shared storage service the port builds from TW-INFRA-054/TW-INFRA-055; the per-feature folder table in TW-INFRA-055 is the checklist.
- **Every domain that uses `afterResponse()` / `app()->terminating()` (campaigns, inbox, WABA inbound, bookings, Slack, orders, flows, Facebook connect):** the deferred-work list in TW-INFRA-027 rules 1-3 must be converted by the owning domain to outbox events or BullMQ jobs.
- **Every domain with encrypted columns (62 models):** TW-INFRA-023 defines the policy question per column (column encryption vs none); the owning domain decides, the data-import tool needs `APP_KEY`.

## Open questions & quirks

### HTTP pipeline

- QUIRK: unnamed `throttle:N,M` keys by user id or domain+IP only, so all numeric-throttled routes share one counter per caller (TW-INFRA-010). Verify in the parity run before deciding how loudly to flag it.
- QUIRK: `TRUSTED_PROXIES` defaults to trust-all, so X-Forwarded-For can spoof the IP used by the admin allowlist, throttles, lockout and audit (TW-INFRA-003); no trusted-host list, so base URLs follow the Host header (TW-INFRA-004).
- QUIRK: customer API key `scopes` are stored but never enforced; API-key and mobile traffic skip maintenance, demo lock, trial and suspension gates (TW-INFRA-002, TW-INFRA-011, TW-INFRA-013).
- QUIRK: `AuthenticateApiKey` overrides the owner's `current_workspace_id` in memory without syncing the original attribute (the mobile middleware does), a latent persistence bug if any API path saves the user (TW-INFRA-011).
- QUIRK: the `install.session` alias (UseFileSession) is attached to no route; `trial`, `force2fa`, `session.timeout`, `concurrent.sessions` aliases duplicate group-appended middleware (TW-INFRA-001).
- QUIRK: the 419 error view is unreachable (graceful handler redirects first); the 401/403/404/429/500 views have no 413/405 siblings (TW-INFRA-008).
- QUIRK: `/up` checks nothing; the three `*/_health` routes return static JSON and sit in the `web` group (sessions row per probe, 503 in maintenance) (TW-INFRA-015).
- QUIRK: `storage/{path}` GET/PUT routes are framework-registered for the private disk but nothing issues signed URLs (dead code, TW-INFRA-016). Public uploads are world-readable by URL; several write directly under `public/uploads` (TW-INFRA-016, TW-INFRA-017).
- QUIRK: only 5 upload surfaces use `SecureUpload`; ~35 others rely on `file|max:N` or `mimes:` rules, some with no type check at all (TW-INFRA-017).
- QUIRK: `.env.example` ships `APP_DEBUG=true`/`APP_ENV=local` and claims an auto-picked production log level that the config does not implement (defaults to debug) (TW-INFRA-008, TW-INFRA-018). `QUEUE_CONNECTION=database` is set but unused (no jobs); `CACHE_STORE=database` means every throttle hit and system-setting read touches the database.
- QUIRK: `security.webhook_replay_window_sec` is stored and shown in the Security Center but never read by any webhook handler in the reference code searched (only the admin page references it); `device_trust_required` likewise has no enforcement point found in `app/` outside the settings controller. Belongs to auth-registration-security; flagged here because it is pipeline-level.
- QUIRK: REST API relies on `Accept: application/json` to get JSON validation errors and 401s; without it clients get 302 redirects (TW-INFRA-007, TW-INFRA-008).
- QUIRK: the Shopify-embed cookie downgrade triggers on any path carrying `host` and `shop` params, and the marker name still says `chatkar` (TW-INFRA-006). Shopify frame rule in SecurityHeaders and the cookie rule disagree slightly.
- QUIRK: `PlanLimitReachedException` docs mention an `App\Exceptions\Handler` that does not exist (TW-INFRA-008, TW-INFRA-009).
- OPEN: executed middleware order for `auth`/`throttle` relative to appended web middleware (Laravel priority sort) was not confirmed by running a route listing (TW-INFRA-001 rule 10).
- OPEN (decision for the team): whether the port keeps Reference-style `Bearer wsk_...` API keys for migrated customers alongside the existing `ApiKey prefix.secret` + HMAC scheme (TW-INFRA-011); whether maintenance/trial/suspension should also gate API-key and webhook traffic (TW-INFRA-002).
- DOCS: `Documentation/pages/developer-guide/rest-api.html` and `architecture.html` are consistent with the code reviewed; no documented feature in this scope was found absent from code except that the Security Center settings noted above have no enforcement.

### Config and runtime services

- QUIRK: Reference has no queue worker, no scheduler and no Job classes. The docs contradict each other: the Architecture page and the Installation FAQ say a `queue:work` worker is required, Post-Install says it is not, the update guide says to run `queue:restart`, and the composer `dev` script starts a queue listener. The health controller's own comment states the platform is deliberately queue-less.
- QUIRK: `routes/console.php` contains only the sample `inspire` command plus a comment explaining the no-`schedule:run` policy. No command is wired with `Schedule::command`. All periodic work rides on the Node heartbeat (needs at least one live Baileys client), the Node campaign-drain loop, the 5-second team-inbox poll, and page loads.
- QUIRK: without an open inbox and without a connected Baileys device, SLA breach detection, escalation, snooze wake, deal/task reminders, scheduled and broadcast retries, stock-hold release, invoice sweep and the expired-workspace wipe do not run (TW-INFRA-040).
- QUIRK: `.env.example` is the unmodified Laravel skeleton; it documents none of `SERVER_URL`, `NODE_WEBHOOK_TOKEN`, `META_GRAPH_VERSION`, `TRUSTED_PROXIES`, `STOREFRONT_HOST`, `FATAL_TRACE`, `DEMO_MODE`, `WD_SYNC_KEY`. Its values (APP_DEBUG true, APP_ENV local, SESSION_LIFETIME 120, DB mysql) differ from the code defaults.
- QUIRK: the installer writes `BROADCAST_DRIVER`, which the framework version ignores (`BROADCAST_CONNECTION`).
- QUIRK: `APP_VERSION` default is `1.4.0` while `config/version.php` says 1.7.0 (build 8); some public pages print the stale value.
- QUIRK: `env()` is called directly in about 60 places (notably `SERVER_URL`, `META_APP_SECRET`, `TWILIO_*`); these return null under `config:cache`, which the docs recommend for production. `META_GRAPH_VERSION` falls back to `v21.0` in code while the installer writes `v23.0`.
- QUIRK: `config/services.php` is entirely unused; the one `services.sheets_addon.marketplace_url` lookup targets an undefined key. `meta_targeting.locales` is read but not defined.
- QUIRK: `NewLoginAlertListener` is called explicitly by the provider and is very likely also auto-discovered by the framework (typed `handle(Login)` in the listeners directory), so it runs twice per login; a 10-minute cache dedupe masks it. (Not verified at runtime; the reference was not executed.)
- QUIRK: broadcast channels `user.{id}.notifications`, `workspace.{id}.devices` and `workspace.{id}.team-chat` have events but no authorization rule, so browsers cannot subscribe (TW-INFRA-039).
- QUIRK: `mask_phone()` is a no-op (dead masking code after an early return); about 40 call sites remain.
- QUIRK: static per-process caches of the bridge URL and token in the HTTP middleware mean admin changes apply only after worker recycle.
- QUIRK: Sanctum has no published config, so mobile tokens never expire; `sanctum:prune-expired` has nothing to prune.
- QUIRK: `FATAL_TRACE` defaults on and only one action (Meta Ads analytics) uses it. The WABA status-flip trace and `[RT-TRACE]` channel logging are temporary diagnostics left on in v1.7.0 and log IPs and user ids.
- QUIRK: the mail settings form stores an `encryption` value in a key the current mailer ignores; it also accepts mailer names (mailgun, ses, postmark, resend) whose credentials config does not exist.
- QUIRK: 144 model columns are encrypted with the app key (110 stock, 25 array, 9 forgiving cast). Rotating the key without `APP_PREVIOUS_KEYS` bricks them; the forgiving cast returns raw ciphertext to users on failure.
- Dead/unused: `FacebookTokenRefreshSweeper` is never called (only TikTok's sweeper is invoked on page loads); Redis, Reverb, Beanstalkd, SQS, DynamoDB, Memcached configuration blocks; `PULSE_ENABLED`, `TELESCOPE_ENABLED`, `NIGHTWATCH_ENABLED` test keys; `config/license.json` is covered by install-update-licensing.
- Docs vs code: Architecture docs describe a database queue worker; the code has none. The Post-Install page says housekeeping runs while the app is in use, which is accurate only for operators with the inbox open or a live Baileys device.
- OPEN: which encrypted columns should be encrypted at the application layer in the port (names, message bodies, phone numbers) versus relying on RLS plus disk encryption; needs a recorded decision because it blocks SQL search (TW-INFRA-023).
- OPEN: ownership of a kernel Redis helper (lock, throttle gate, sliding-window rate limiter) and a `silent` log level; both are K2 kernel-protocol requests (TW-INFRA-025, TW-INFRA-028).
- OPEN: `config/countries.php`, `config/permission.php`, `config/plan_gates.php`, `config/version.php`, `config/license.php`, `config/license.json` and `config/laravel-translatable-string-exporter.php` are referenced only; they stay with their existing domains.

### Dependencies, storage and operations

- QUIRK: `QUEUE_CONNECTION=database` and docs say a queue worker is required, yet `app/Jobs` is empty and nothing implements `ShouldQueue`. Deferred work runs via `dispatch(closure)->afterResponse()` (about 12) and `app()->terminating()` (41 in 16 files) inside PHP-FPM. A paced campaign loop runs this way with unlimited execution time; if `fastcgi_finish_request` is missing it runs inline in the request.
- QUIRK: docs say "Alpine.js + Blade + Tailwind"; Alpine is only in the installer (CDN); the app is vanilla JS modules plus one React-via-htm screen (flow builder).
- QUIRK: docs list three Vite inputs; `vite.config.js` has four (`locale-switcher.js`).
- QUIRK: `postcss-rtlcss` in `combined` mode scopes directional rules to `[dir=ltr]`/`[dir=rtl]`; the config comment says LTR stays unscoped. Any layout without a `dir` attribute is partly unstyled (the installer layout hard-codes `dir="ltr"` for this reason).
- QUIRK: composer declares `doctrine/dbal` (unused), `laravel/tinker` in production `require`, `pusher/pusher-php-server` (the app ships its own HTTP Pusher driver), plus allow-plugins for pest/php-http that are not installed. `bcmath` is listed as a required extension but no `bc*` function is called.
- QUIRK: node `package.json` declares `baileys`, `@distube/ytdl-core`, `form-data`, `sharp`, `unfurl.js` that no source file imports; `@hapi/boom` is imported but undeclared; no `scripts`.
- QUIRK: `@giphy/*` front-end packages are declared with zero imports.
- QUIRK: undocumented ffmpeg/`exec()` dependency for voice-note transcode and call-recording MP3; the FAQ's `proc_open` advice matches no call in `app/`.
- QUIRK: `LOG_LEVEL` defaults to `debug` in `config/logging.php`; `.env.example` comment says it auto-picks `warning` in production. Default log channel is a single unbounded file. Node `log-gate.js` silencer is commented out, so bridge logs everything.
- QUIRK: the reference tree runs in the no-symlink fallback (`public/storage` is a real directory). `public/favicon.ico` is zero bytes. `database/database.sqlite` ships.
- QUIRK: `workspaces:wipe-expired` deletes DB rows only; media files and bridge auth folders of wiped workspaces remain. Several media folders have no delete path at all.
- QUIRK: three encryption failure behaviours differ (raw value, null, empty array, ignored); `APP_PREVIOUS_KEYS` is supported by config but never documented.
- QUIRK: the architecture doc claims no shared file storage between app and bridge; the bridge writes call PCM into Laravel's `public/uploads/call-recordings` and also references a removed `/uploads/templates/carousel/` URL path.
- QUIRK: `tests/Feature/ExampleTest` expects 200 at `/`; with the install gate and a database-backed stack it likely fails on a clean checkout (not executed, static review only). Two tests use `RefreshDatabase` against SQLite while ~11 migrations contain MySQL-only SQL (unverified).
- QUIRK: the credits page omits sanctum, dompdf, scramble, flysystem, web-push, pusher, pdfparser, htm, driver.js and mislabels Font Awesome/Inter (docs-site assets) as app assets.
- OPEN: whether signed-in behaviour after email verification (auto login) should be kept; whether Redis-backed cache/session is wanted for any product reason in the port (no).
- OPEN: PDF generation approach for invoices/estimates/briefs (needs a recorded decision); object storage module and upload path (needs a recorded decision, already listed in target-map decisions).
- OPEN: where the Baileys socket host runs (worker process vs separate service) affects TW-INFRA-057 compose changes and shared recording storage.
- Not verified (static review only): behaviour of afterResponse callbacks under php-fpm vs other SAPIs; whether the 62 encrypted-cast models cover every sensitive column; real Vite chunk sizes.

### Target gaps (production readiness in crm-platform that INFRA should close; verified against branch lakshya/auth/parity-gaps @ 86008a31, 2026-10-04)

Grounded in `apps/api/src/main.ts`, `apps/api/src/health/health.controller.ts`, `apps/api/src/config/env.schema.ts`, `apps/api/src/worker.ts`, `apps/api/src/workers/*`, `docker-compose*.yml`, `apps/api/Dockerfile`, `.github/workflows/ci.yml`, `docs/adr/0011-single-vm-deploy.md`. All paths below are KERNEL-owned, so each needs a kernel-protocol PR. Reference does not advertise these, so they are not features above.

1. **Public origin (trust proxy is done):** `main.ts` already sets `trust proxy` from `TRUST_PROXY` (default `loopback`). What is still missing is an `APP_URL`-derived public origin used for every absolute URL (mail links, signed links, payment returns); today `APP_URL` is mostly used for the Swagger log line. Also add the production note that `TRUST_PROXY` must be set behind Caddy (see TW-INFRA-053 rule 7, TW-INFRA-058).
2. **Worker health:** `apps/api/Dockerfile` `HEALTHCHECK` curls `127.0.0.1:3000/health`, but the worker (`worker.ts`, `createApplicationContext`) has no listener, and `docker-compose.prod.yml` reuses the same image for `worker`, so the worker container would be reported unhealthy. Give the worker its own probe (small internal HTTP port or a heartbeat key in Redis with an age check) and per-service `healthcheck` entries in compose; `/ready` only checks Postgres, Redis, replica, not queue depth, outbox lag or storage.
3. **Graceful shutdown:** `enableShutdownHooks()` is called in both entrypoints, and `DatabaseService`/`RedisModule` close on destroy, and BullMQ processors now exist in about ten domains (`*.processor.ts`, via `@nestjs/bullmq`), but no test proves an in-flight job finishes or is safely retried on `SIGTERM`, and there is no explicit drain deadline or compose `stop_grace_period`. Add both, plus an integration test that kills the worker mid-job. Also close the Socket.IO Redis adapter clients.
4. **Sentry is dead:** `@sentry/node` is a dependency and `SENTRY_DSN`/`SENTRY_TRACES_SAMPLE_RATE` exist in `env.schema.ts`, but nothing initialises Sentry (target-map confirms). Wire init in `main.ts` and `worker.ts` with PII scrubbing consistent with the pino redact list.
5. **Metrics:** no Prometheus/OpenTelemetry endpoint, no queue depth, outbox lag, HTTP latency histograms or DB pool gauges. The outbox runbook (`docs/runbooks/outbox-backlog.md`) depends on manual SQL; export `event_outbox` pending count/age and BullMQ queue counts.
6. **Structured logging gaps:** pino redact list covers headers and `req.body.password/credentials` only; add secret-bearing fields (tokens, webhook secrets, `Authorization` in outbound provider calls), set a request-scoped child logger in the worker (worker uses `autoLogging:false` and has no request id), and ship logs off-box (README "Before production" item is open).
7. **Secrets management:** `docker-compose.prod.yml` uses `env_file: .env` with long-lived secrets (`JWT_*`, `CREDENTIALS_ENCRYPTION_KEY`, `CLERK_SECRET_KEY`, provider salts). `CryptoService` has a `v1:` prefix but no key id or multi-key decrypt, so rotation (Reference had `APP_PREVIOUS_KEYS`) is impossible without re-encrypt downtime. Add key ring support (`CREDENTIALS_ENCRYPTION_KEYS` with ids), a rotation runbook, and Docker/host secret mounts instead of a world-readable env file.
8. **Object storage has env but no shared client; mail exists:** `nodemailer` is a dependency and `SMTP_*` is wired through the auth mailer, but there is no S3 client in `apps/api/package.json` (only a hand-signed SigV4 probe in the settings domain and a local-disk chat store), and prod compose has no S3 endpoint wiring. TW-INFRA-054 requires a storage module with one port (recorded decision); TW-INFRA-055 is limited to confirming mail retry, bounce and sandbox behavior on the existing mailer.
9. **Production compose is incomplete vs the single-VM topology and the README "Before production" list:** no Caddy service, no migration job/step (images copy `migrations/` but nothing runs `db:migrate` on deploy), no WhatsApp runner service, no restart ordering for schema changes, no resource limits, no log driver limits, no replica service, no backup container. The README "Before production" list (tested backup restore, monitoring, disk alerts, log shipping; the removed deploy record also listed pg_dump plus WAL archiving, uptime monitoring on `/ready` and a rebuild runbook, see git history) is entirely unchecked and has no tooling in `tools/` or `.github/`.
10. **CI/CD:** `ci.yml` builds the image with `push: false`; there is no registry push, no deploy workflow, no dependency/vulnerability scan (no Dependabot/Renovate, no `pnpm audit`, no Trivy on the image), no secret scan, no OpenAPI diff, no coverage gate. Add these in `.github/` (K3 steward).
11. **Security headers split across three places:** the API sets headers through `SecurityHeadersMiddleware` (`modules/auth/middleware-security-headers.ts`, TW-AUTH-045: nosniff, referrer policy, framing, CSP `default-src 'none'`, HSTS on secure requests), `apps/web/next.config.ts` sets its own frame and cache headers, and `apps/partner` is still a README. No shared policy document exists, no web CSP beyond `frame-ancestors`, and no CDN/static strategy or self-hosted fonts (TW-INFRA-048/TW-INFRA-051). Decide one policy and test it in both apps.
12. **Operational limits:** `main.ts` sets no body-size limit (Reference uploads go up to 64 MB; `rawBody:true` buffers the whole body), no request timeout, no global rate limit (only the public API has `PUBLIC_API_RATE_LIMIT_PER_MINUTE`), and `WORKER_MODE`/`@ReadReplica` are dead config (target-map #12). Decide limits per route class.
13. **Time zone and runtime pinning:** Dockerfile does not set `TZ=UTC`; `node:22-alpine` is unpinned by digest; no `.nvmrc`/engines parity check in CI beyond Node >=22.
14. **Dev-only defaults guarded in production:** `env.schema.ts` refuses the dev encryption key in production (good); extend the same guard to the JWT dev secrets, MinIO default credentials and `POSTGRES_PASSWORD` in `docker-compose.yml`.

## Coverage

```json threadwise-coverage
{
  "routes": [
    "GET broadcasting/auth",
    "GET docs/api.json",
    "GET facebook/_health",
    "GET sanctum/csrf-cookie",
    "GET storage/{path}",
    "GET telegram/_health",
    "GET tiktok/_health",
    "GET up",
    "POST api/app/broadcasting/auth",
    "POST broadcasting/auth",
    "PUT storage/{path}"
  ],
  "controllers": [],
  "services": [
    "app/Support/FatalTrace.php",
    "app/Support/MailConfig.php",
    "app/Support/RealtimeSettings.php",
    "app/Support/fc_helpers.php",
    "app/Support/html_sanitize.php",
    "app/Support/security_helpers.php"
  ],
  "middleware": [
    "app/Http/Middleware/AuthenticateApiKey.php",
    "app/Http/Middleware/EmbeddedShopifySession.php",
    "app/Http/Middleware/ExtensionApiAuth.php",
    "app/Http/Middleware/ResolveAppWorkspace.php"
  ],
  "views": [],
  "config_files": [
    "config/app.php",
    "config/auth.php",
    "config/broadcasting.php",
    "config/cache.php",
    "config/database.php",
    "config/diagnostics.php",
    "config/filesystems.php",
    "config/logging.php",
    "config/mail.php",
    "config/meta_targeting.php",
    "config/queue.php",
    "config/scramble.php",
    "config/services.php",
    "config/session.php",
    "config/storefront.php",
    "config/wdsync.php"
  ],
  "misc_files": [
    "app/Casts/SafeEncrypted.php",
    "app/Exceptions/WhatsAppCatalogException.php",
    "app/Providers/AppServiceProvider.php",
    "app/Providers/ModuleServiceProvider.php"
  ],
  "js_assets": [
    "resources/css/app.css",
    "resources/css/threadwise.css",
    "resources/js/bootstrap.js",
    "resources/js/lib/base-url.js",
    "resources/js/lib/password-reveal.js"
  ],
  "doc_pages": [
    "Documentation/pages/conclusion/conclusion.html",
    "Documentation/pages/conclusion/source-credits.html",
    "Documentation/pages/conclusion/support.html",
    "Documentation/pages/developer-guide/architecture.html",
    "Documentation/pages/developer-guide/customization.html",
    "Documentation/pages/developer-guide/database-schema.html",
    "Documentation/pages/developer-guide/third-party-integrations.html",
    "Documentation/pages/faqs/disclaimer.html",
    "Documentation/pages/faqs/general.html",
    "Documentation/pages/faqs/installation.html",
    "Documentation/pages/faqs/privacy-policy.html",
    "Documentation/pages/faqs/video-guides.html",
    "Documentation/pages/installation/post-install.html",
    "Documentation/pages/installation/server-requirements.html",
    "Documentation/pages/introduction.html",
    "Documentation/pages/key-features.html",
    "Documentation/pages/update-details/update-process.html"
  ],
  "commands": [
    "catalog:resync",
    "crm:remind-tasks",
    "deals:demo",
    "deals:remind-tasks",
    "docs",
    "reload",
    "sanctum:prune-expired",
    "schema:dump",
    "wasnap:backfill-encrypted"
  ],
  "models": [],
  "node_files": [
    "node/config/config.js",
    "node/index.js",
    "node/log-gate.js",
    "node/routes/index.js"
  ],
  "feature_map": {
    "TW-INFRA-001": ["Documentation/pages/developer-guide/architecture.html"],
    "TW-INFRA-002": [],
    "TW-INFRA-003": [],
    "TW-INFRA-004": ["app/Providers/AppServiceProvider.php", "config/filesystems.php"],
    "TW-INFRA-005": [],
    "TW-INFRA-006": [],
    "TW-INFRA-007": [],
    "TW-INFRA-008": [],
    "TW-INFRA-009": [],
    "TW-INFRA-010": [],
    "TW-INFRA-011": [],
    "TW-INFRA-012": [],
    "TW-INFRA-013": [],
    "TW-INFRA-014": [],
    "TW-INFRA-015": [
      "GET up",
      "GET facebook/_health",
      "GET telegram/_health",
      "GET tiktok/_health"
    ],
    "TW-INFRA-016": ["GET storage/{path}", "PUT storage/{path}"],
    "TW-INFRA-017": [],
    "TW-INFRA-018": ["config/diagnostics.php", "app/Support/FatalTrace.php"],
    "TW-INFRA-019": ["GET sanctum/csrf-cookie"],
    "TW-INFRA-020": [],
    "TW-INFRA-021": [
      "config/app.php",
      "config/auth.php",
      "config/broadcasting.php",
      "config/cache.php",
      "config/database.php",
      "config/filesystems.php",
      "config/logging.php",
      "config/mail.php",
      "config/queue.php",
      "config/session.php",
      "config/services.php",
      "config/wdsync.php",
      "node/config/config.js"
    ],
    "TW-INFRA-022": ["config/app.php"],
    "TW-INFRA-023": ["app/Casts/SafeEncrypted.php", "wasnap:backfill-encrypted"],
    "TW-INFRA-024": ["config/database.php", "migrations"],
    "TW-INFRA-025": ["config/cache.php", "cache", "cache_locks"],
    "TW-INFRA-026": ["config/session.php"],
    "TW-INFRA-027": ["config/queue.php", "jobs", "job_batches", "failed_jobs"],
    "TW-INFRA-028": ["config/logging.php", "node/log-gate.js"],
    "TW-INFRA-029": ["config/mail.php", "app/Support/MailConfig.php"],
    "TW-INFRA-030": ["config/services.php"],
    "TW-INFRA-031": ["config/scramble.php", "GET docs/api.json"],
    "TW-INFRA-032": ["config/meta_targeting.php"],
    "TW-INFRA-033": ["config/storefront.php"],
    "TW-INFRA-034": ["app/Providers/AppServiceProvider.php"],
    "TW-INFRA-035": ["app/Providers/AppServiceProvider.php"],
    "TW-INFRA-036": ["app/Providers/AppServiceProvider.php"],
    "TW-INFRA-037": [
      "app/Providers/AppServiceProvider.php",
      "app/Support/RealtimeSettings.php",
      "app/Support/MailConfig.php",
      "config/broadcasting.php"
    ],
    "TW-INFRA-038": ["app/Providers/ModuleServiceProvider.php"],
    "TW-INFRA-039": [
      "GET broadcasting/auth",
      "POST broadcasting/auth",
      "POST api/app/broadcasting/auth",
      "config/broadcasting.php"
    ],
    "TW-INFRA-040": [
      "Documentation/pages/developer-guide/architecture.html",
      "Documentation/pages/installation/post-install.html",
      "node/index.js"
    ],
    "TW-INFRA-041": [
      "catalog:resync",
      "crm:remind-tasks",
      "deals:remind-tasks",
      "deals:demo",
      "wasnap:backfill-encrypted"
    ],
    "TW-INFRA-042": ["docs", "reload", "schema:dump", "sanctum:prune-expired"],
    "TW-INFRA-043": [
      "app/Support/fc_helpers.php",
      "app/Support/security_helpers.php",
      "app/Support/html_sanitize.php"
    ],
    "TW-INFRA-044": [
      "node/routes/index.js",
      "node/index.js",
      "node/config/config.js",
      "Documentation/pages/installation/post-install.html"
    ],
    "TW-INFRA-045": ["cache", "cache_locks", "jobs", "job_batches", "failed_jobs", "migrations"],
    "TW-INFRA-046": [
      "Documentation/pages/developer-guide/customization.html",
      "Documentation/pages/installation/server-requirements.html",
      "Documentation/pages/faqs/installation.html",
      "Documentation/pages/update-details/update-process.html"
    ],
    "TW-INFRA-047": ["GET sanctum/csrf-cookie"],
    "TW-INFRA-054": ["GET storage/{path}", "PUT storage/{path}"],
    "TW-INFRA-056": []
  }
}
```
