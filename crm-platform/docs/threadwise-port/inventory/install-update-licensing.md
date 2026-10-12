---
domain: install-update-licensing
code: INST
title: Web Installer, In-App Updater, Licensing and Demo Guard
threadwise_version: '1.7.0'
sources_read: 62
---

# Web Installer, In-App Updater, Licensing and Demo Guard

## Overview

This domain is everything that gets a Reference copy onto a server, keeps it current, and proves the buyer owns it. Reference is a CodeCanyon product that a buyer uploads to their own hosting, so unlike a hosted SaaS it needs (a) a browser-driven first-run **web installer**, (b) a browser-driven **in-app updater** with backup and rollback, and (c) **licence (Envato purchase code) checks**. A small **demo-mode guard** also lives here because it is the only mechanism that makes the public live demo read-only.

There are three actors. The **buyer / platform operator** runs the installer once on a bare server (no login exists yet, so every `/install/*` route is public until the install marker exists). The **super-admin** (any user with the Spatie role `Super Admin` or `Admin`, or the legacy `users.role` value `admin`/`A`) runs the updater at `Admin -> Settings -> Updater` (`/admin/update`). **Demo visitors** are logged-in users on a server started with `DEMO_MODE=true`.

Main flow, end to end:

1. Any web request on a fresh checkout is intercepted by the `EnsureInstalled` middleware (prepended to the `web` group). While the file `storage/installed` is absent, everything except `/install*` is redirected to `/install`, the session is forced to the file driver with a fixed cookie name, and a missing `.env` / `APP_KEY` is auto-bootstrapped.
2. The wizard is a session-driven state machine: Welcome -> Licence (Envato purchase code, verified live against the Envato author API) -> Requirements (PHP >= 8.2, 13 extensions, 6 directory checks, PDO mysql) -> Database (test connection, cascade over socket/TCP transports) -> Application (name, URL, timezone, locale) -> Admin account + first workspace name -> Node bridge (Node URL, shared token, port) -> Install run.
3. The Install run screen posts six sub-steps one at a time to `POST /install/execute`: write `.env` (plus `node/.env` and the browser-extension URL), run all migrations, seed eight default-data seeders, create the super-admin + first workspace, link storage + create the call-recordings folder, finalize (persist purchase code, clear caches, write `storage/installed`). Success redirects the browser to `/login`; from then on `/install*` bounces to `/`.
4. Later, the super-admin updates the app from `/admin/update`: verify the purchase code (server-side check is currently bypassed) -> create a backup (code ZIP + gzip SQL dump + `rollback.json`) -> upload the version ZIP -> apply (overwrite only code paths) -> run migrations (with an "already applied" tolerant fallback) -> finalize (clear caches + 4-point health check). Any earlier backup can be restored with one click from the Rollback list.

Plan tiers do not affect this domain: the installer and updater are platform-level, not workspace-level, and nothing here checks package/plan flags. The only "tier" is the demo guard, which is an installation-wide switch.

Connections to other domains: SET (`system_settings` stores `envato_purchase_code` / `envato_verified_at`; `SystemSetting::get` is made resilient to a not-yet-provisioned DB precisely for the installer), RBAC (`RolePermissionSeeder` creates the 6 roles / ~101 permissions and the installer assigns `Super Admin`), WSP (installer creates the first `workspaces` row + `workspace_user` owner pivot), PLAN (`PackageSeeder` seeds Starter/Growth/Pro/Enterprise; first workspace is put on the lowest `sort_order` package), CPN (currencies + demo coupons + pricing FAQ + checkout defaults seeded here), PAYGW (32 gateway rows seeded inactive/sandbox), I18N (translation-provider seed and installer locale list), CMS (`LegalPagesSeeder`, `GuidebookArticleSeeder`), NODE (installer writes `node/.env` keys `PORT`, `DOMAIN_NAME`, `APP_DOMAIN_NAME`, `NODE_WEBHOOK_TOKEN`; the updater deliberately protects `node/.env`, `node/node_modules`, `node/baileys_auth`), ADD (`ExtensionService` reuses `UpdaterService::verifyPurchase` and reads `config('version.version')` for add-on `min_core` checks), EXT (installer bakes the app URL into `extension/content.js`), NOTIF (`Audit::log('admin.updater.*')` entries), ASHELL (the Updater link on the admin settings page), CORE (the many other middleware that early-return when `storage/installed` is absent; `DemoMode` is registered in `bootstrap/app.php`).

## Feature index

| Id          | Feature                                                                                    | Status      | Priority | Effort | Depends on               |
| ----------- | ------------------------------------------------------------------------------------------ | ----------- | -------- | ------ | ------------------------ |
| TW-INST-001 | Install gate, install marker and pre-install runtime bootstrap                             | implemented | P1       | M      | -                        |
| TW-INST-002 | Wizard shell, step state machine and no-reload navigation                                  | implemented | P2       | M      | TW-INST-001              |
| TW-INST-003 | Purchase-code (licence) verification during install                                        | implemented | P2       | S      | TW-INST-002, TW-INST-017 |
| TW-INST-004 | Server requirements check                                                                  | implemented | P1       | S      | TW-INST-002              |
| TW-INST-005 | Database step: form, session hold and forward guard                                        | implemented | P1       | S      | TW-INST-004              |
| TW-INST-006 | Database connection test with transport cascade                                            | implemented | P1       | M      | TW-INST-005              |
| TW-INST-007 | Application basics step                                                                    | implemented | P1       | S      | TW-INST-005              |
| TW-INST-008 | First super-admin account step                                                             | implemented | P0       | S      | TW-INST-007              |
| TW-INST-009 | Node bridge step                                                                           | implemented | P1       | S      | TW-INST-008              |
| TW-INST-010 | Install run screen and step dispatcher                                                     | implemented | P1       | M      | TW-INST-009              |
| TW-INST-011 | Install sub-step 1: write .env, node/.env and extension URL                                | implemented | P1       | M      | TW-INST-010              |
| TW-INST-012 | Install sub-step 2: run database migrations                                                | implemented | P0       | S      | TW-INST-011              |
| TW-INST-013 | Install sub-step 3: seed essential default data                                            | implemented | P0       | M      | TW-INST-012              |
| TW-INST-014 | Install sub-step 4: create super-admin, first workspace and owner pivot                    | implemented | P0       | S      | TW-INST-013              |
| TW-INST-015 | Install sub-steps 5-6: storage link, recordings folder, finalize and lock                  | implemented | P0       | S      | TW-INST-014              |
| TW-INST-016 | EnvWriter: keep .env in step with admin-set Node settings                                  | implemented | P2       | S      | TW-INST-011              |
| TW-INST-017 | Encrypted Envato licence material (Licence support class)                                  | implemented | P2       | S      | -                        |
| TW-INST-018 | Post-install and hosting guidance (requirements, Node service, cPanel, troubleshooting)    | docs-only   | P2       | S      | TW-INST-015              |
| TW-INST-019 | Admin Updater screen and client-side step orchestration                                    | implemented | P2       | M      | TW-INST-020              |
| TW-INST-020 | Updater step 0: purchase verification (bypassed)                                           | partial     | P2       | S      | TW-INST-017              |
| TW-INST-021 | Updater step 1: full backup (code ZIP + database dump)                                     | implemented | P2       | L      | TW-INST-019              |
| TW-INST-022 | Updater step 2: upload and validate the update ZIP                                         | implemented | P2       | M      | TW-INST-019              |
| TW-INST-023 | Updater step 3: apply update files with status polling                                     | implemented | P2       | L      | TW-INST-022              |
| TW-INST-024 | Updater step 4: run new migrations with resilient fallback                                 | implemented | P2       | M      | TW-INST-023              |
| TW-INST-025 | Updater step 5: finalize, clear caches and health check                                    | implemented | P2       | S      | TW-INST-024              |
| TW-INST-026 | Rollback to a previous backup and backup list                                              | implemented | P2       | M      | TW-INST-021              |
| TW-INST-027 | Release packaging and version registry (config/version.php, update ZIPs, Database/1.1.sql) | implemented | P1       | M      | -                        |
| TW-INST-028 | Documented update procedure: sequential updates, manual path, post-update ops              | docs-only   | P2       | S      | TW-INST-027              |
| TW-INST-029 | Live-demo guard (DEMO_MODE middleware)                                                     | implemented | P1       | S      | -                        |

## Features

### TW-INST-001 — Install gate, install marker and pre-install runtime bootstrap

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** none
- **Summary:** Every web request is checked against a filesystem marker, `storage/installed`. Until the marker exists the whole app is funnelled to `/install`; once it exists the installer is unreachable. While not installed, the middleware also makes the framework bootable without a database (file sessions, fixed cookie name, auto-created `.env` and `APP_KEY`).
- **Actors & access:** Anyone (unauthenticated). No permission keys, no plan gates. Applies to the `web` route group only (prepended, so it runs before session start); `/api/*` routes (routes/api.php) are not gated by it.
- **UX & screens:** No screen of its own. Effects the visitor sees: any URL redirects (HTTP 302) to `/install` on a fresh site; after installation `GET /install` (and every `/install/...`) redirects to `/`. If the wizard's session cookie is lost mid-flow forms fail with 419 (documented cause: `.env` or project root not writable so `APP_KEY` could not be minted).
- **Endpoints:**

  | METHOD uri       | route name | Controller@action         | middleware                                               | request fields | response/redirect                                                                                                                             |
  | ---------------- | ---------- | ------------------------- | -------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
  | (all web routes) | -          | `EnsureInstalled::handle` | prepended to `web` group (before `PaddleReturnRedirect`) | none           | not installed and path not `install`/`install/*` -> 302 `/install`; installed and path is `install`/`install/*` -> 302 `/`; else pass through |

- **Data:** Reads/writes files, not tables: `storage/installed` (JSON marker, see TW-INST-015), `.env`, `.env.example`. Path test is on `getPathInfo()` trimmed of slashes: exactly `install` or starts with `install/`.
- **Rules & edge cases:**
  1. "Installed" is purely `file_exists(storage/installed)`. Nothing checks that the database is reachable or migrated. Deleting the file re-opens the wizard (documented as the way to reinstall; also the fix for being stuck on `/install`); creating an empty file locks the wizard.
  2. When not installed: if `.env` does not exist, `.env.example` exists and the project root is writable, `.env.example` is copied to `.env`. If `.env` exists and is writable and does not contain a line matching `APP_KEY=base64:<valid base64>`, a new key (`base64:` + base64 of 32 random bytes) replaces/appends the `APP_KEY` line, and `config(['app.key'])` is set immediately so the same request can sign CSRF tokens. All of this is silent best-effort (exceptions swallowed); the Requirements step later reports the non-writable condition.
  3. When not installed, the middleware overrides config at runtime: `session.driver=file`, `session.encrypt=false`, `session.cookie=threadwise_install_session`. The cookie name is fixed because the wizard rewrites `APP_NAME` mid-flow and a name-derived cookie name would orphan the step state.
  4. Because this runs before `StartSession`, no DB access is needed pre-install. Other middleware also short-circuit while the marker is absent: `ResolveTenantDomain` (else the DB-less first request 500s), `Maintenance`, `SetLocale`, `EnsureUserActive`, `EnsureTrialActive`, `Force2FA`, `RecordAgentActivity`, `LimitConcurrentSessions`, `ImpersonationBanner`, `SessionTimeout`. Every gate uses the same `is_file(storage_path('installed'))` test (owned by CORE/AUTH; listed here as contract).
  5. QUIRK: an alias `install.session` -> `UseFileSession` is registered in `bootstrap/app.php` but no route uses it; `EnsureInstalled` does the same override inline. `UseFileSession` is dead code.
  6. QUIRK: `EnsureInstalled` does not gate `/api/*`, webhook and Node callback routes; they are not part of the `web` group in the way this middleware is registered, so pre-install API calls reach controllers (which then fail on missing DB).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `.env` `APP_KEY`; `.env.example` is the template; no admin settings.
- **Acceptance criteria:**
  - Given `storage/installed` does not exist, When a visitor requests `/` or `/login` or `/admin`, Then the response is a 302 to `/install`.
  - Given `storage/installed` exists, When a visitor requests `/install` or `/install/database`, Then the response is a 302 to `/`.
  - Given no `.env` but a writable project root with `.env.example`, When the first request hits any URL, Then `.env` exists afterwards and contains a valid `APP_KEY=base64:...` line.
  - Given the install is not finished, When the wizard sets a session value on one request, Then the next request reads it back using cookie `threadwise_install_session` and file storage even though `APP_NAME` was rewritten in between.
- **Source refs:** app/Http/Middleware/EnsureInstalled.php; app/Http/Middleware/UseFileSession.php; bootstrap/app.php (middleware->web prepend, alias install.session); routes/web.php (install group comment); Documentation/pages/installation/troubleshooting.html; Documentation/pages/faqs/installation.html.
- **Port notes:** Nothing similar exists in `crm-platform` (no installer). The NestJS stack should not copy a filesystem marker: use (a) the migration runner in `packages/db/src/migrator.ts` for schema, (b) an "is there a platform admin yet" check for first-run bootstrap (see TW-INST-008/014), (c) `apps/api/src/config/env.schema.ts` for env validation at boot instead of writing `.env`. Keep the idea of a first-run lock; make it a DB row or a signed one-time setup token so containers with read-only filesystems work. Guard the setup endpoint to be unreachable once an admin exists.

### TW-INST-002 — Wizard shell, step state machine and no-reload navigation

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** TW-INST-001
- **Summary:** The installer is a guided multi-screen wizard with a left stepper, a top progress bar and a Welcome landing page. Steps are enforced by a session counter (`install_step`) so users cannot jump forward, only back; navigation is enhanced by a small script that swaps the content panel without a full page reload.
- **Actors & access:** Anyone with browser access to the server before installation completes (no authentication exists yet). No permissions or plan gates.
- **UX & screens:** `resources/views/install/layout.blade.php` (shell: title "<step> · Reference", Alpine loaded from a CDN, Vite `app.css` + `app.js`, CSRF meta tag, body `data-page="install-wizard"`, footer "Step n/8 · <name>" with a progress bar of n/8 width, `#install-content` panel and `#install-stepper` rail). `install/partials/steps.blade.php` renders 7 rail entries: Welcome, Requirements, Database, Application, Admin account, Node bridge, Install (numbers 1-7; done = check icon, active = filled circle, upcoming = grey). `install/welcome.blade.php`: heading "Let's get Reference running", promise of "eight simple steps, about three minutes", four feature tiles (Database, Security, Translations, Admin), a "Before you start" checklist (empty MySQL 8 database + user with full privileges; PHP 8.2+ with the usual Laravel extensions; write access to `storage/` and `bootstrap/cache/`) and a "Begin installation" button that goes to the Licence step (`install.license`). The client script `resources/js/charts/install-wizard.js` intercepts same-origin `/install` links and plain POST forms, fetches the next page with `X-Requested-With: XMLHttpRequest`, and replaces only `#install-content` and `#install-stepper`, re-runs the step's inline scripts, re-inits Alpine, plays a step-completion tick, resets scroll and updates history via `pushState`.
- **Endpoints:**

  | METHOD uri  | route name      | Controller@action         | middleware            | request fields | response/redirect                              |
  | ----------- | --------------- | ------------------------- | --------------------- | -------------- | ---------------------------------------------- |
  | GET install | install.welcome | InstallController@welcome | web (EnsureInstalled) | none           | sets session `install_step=1`, renders welcome |

- **Data:** Session (file driver, cookie `threadwise_install_session`) keys: `install_step` (int, default 1), `install_purchase_ok`, `install_purchase_code`, `db`, `app`, `admin_data`, `node`, `install_complete`.
- **Rules & edge cases:**
  1. `STEPS_TOTAL` is 8 but the stepper shows 7 labelled entries; the Licence page shares "step 1" with Welcome, Requirements is "2", Database "3", Application "4", Admin "5", Node "6", Install "7". The 8th "step" (a completion page) no longer exists (route `/install/complete` was removed; the run screen redirects to `/login`). Docs still describe "eight steps" and a "final screen" with an "Open admin panel" button: docs-only.
  2. Guard: `ensureStep(required)` redirects to `install.welcome` when session `install_step < required`. Required levels: license 1 (always passes), requirements uses the purchase flag instead, database 2, application 3, admin 4, node 5, run 6. Back navigation is unrestricted.
  3. QUIRK: `GET /install` always resets `install_step` to 1, so revisiting the welcome page (or the browser Back to it) locks the user out of later steps until they re-POST the earlier steps; previously saved `db`/`app`/`admin_data`/`node` values stay in the session and are used to pre-fill forms.
  4. QUIRK: the guard applies only to the GET pages. The POST handlers (`database`, `application`, `admin`, `node`, `execute`) do not check `install_step` or the purchase flag (see TW-INST-003, TW-INST-010).
  5. Enhancement script rules: skips clicks with modifier keys, `target=_blank`, `download`, or `data-no-pjax`; skips forms with `x-data`/`@submit.prevent` (Alpine-managed; the Database form instead calls `window.installGo`) or `data-no-pjax`; does `reportValidity()` before posting; treats HTTP 422 as swap-worthy; if the final URL is outside `/install` it does a hard `location.assign`; the `/install/run` URL is always loaded with a real navigation so the auto-run fires exactly once; any error falls back to a normal navigation; browser Back/Forward triggers a full reload; a spinner ring shows on the active step for at least ~560 ms per transition.
  6. With JavaScript disabled every link and form works natively (except the Database test and Install run, which need JS).
  7. Licence page sets no `install_step` on GET; it is reachable any time after welcome.
- **Async & events:** none server-side.
- **External systems:** CDN `cdn.jsdelivr.net` (Alpine.js 3.x) is loaded by the layout; the wizard needs outbound internet for that and for the Envato check.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a new session, When the user opens `/install/database` directly, Then they are redirected to `/install` (welcome).
  - Given the user completed Database (session `install_step=3`), When they click Back to Requirements and press Continue, Then the POST sets `install_step=2`, the Database page (needs >= 2) opens with the saved values pre-filled, and Application (needs >= 3) redirects to welcome until Database is saved again.
  - Given the user revisits `/install`, When they then open `/install/admin`, Then they are redirected to welcome because the counter was reset to 1.
  - Given JS is enabled, When the user submits the Application form, Then only the content panel and stepper are replaced (URL updated), with the completed step showing a check.
- **Source refs:** app/Http/Controllers/InstallController.php (welcome, ensureStep); resources/views/install/layout.blade.php; resources/views/install/welcome.blade.php; resources/views/install/partials/steps.blade.php; resources/js/charts/install-wizard.js; routes/web.php (install group); Documentation/pages/installation/web-installer.html.
- **Port notes:** A wizard is not required for a hosted NestJS deploy; if a first-run UI is wanted, build it as a small Next.js route group (`apps/web/app/setup/*`) that talks to one setup API and keep the forward-jump guard server-side (per-step token in the session), not only on GETs. Do not use a Blade-style HTML-swap script; a normal client-side stepper suffices.

### TW-INST-003 — Purchase-code (licence) verification during install

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-INST-002, TW-INST-017
- **Summary:** Before the Requirements step the buyer must enter a CodeCanyon purchase code, which the server checks against the Envato author sale API and confirms belongs to this item. A verified code is remembered in the wizard session and, at the end of the install, persisted to the database so the admin Updater already shows as verified.
- **Actors & access:** Anyone reaching the wizard. No permissions. Requires outbound HTTPS to `api.envato.com`. No plan gates.
- **UX & screens:** `resources/views/install/license.blade.php` ("Verify your purchase"): one monospace text input `purchase_code` (placeholder in xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx shape, autofocus), helper text pointing to CodeCanyon Downloads -> "License certificate & purchase code", "Back" link to welcome, "Verify & continue" submit. States: default; validation/verification error (first error shown in a coral box); already verified (green box "Purchase already verified - you can continue" when `install_purchase_ok` is set). Success redirects to Requirements.
- **Endpoints:**

  | METHOD uri           | route name             | Controller@action               | middleware | request fields                            | response/redirect                                                                                                                                                    |
  | -------------------- | ---------------------- | ------------------------------- | ---------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | GET install/license  | install.license        | InstallController@license       | web        | none                                      | ensureStep(1) passes; renders form with `verified` flag                                                                                                              |
  | POST install/license | install.license.verify | InstallController@verifyLicense | web        | `purchase_code` required, string, max 120 | ok -> session `install_purchase_ok=true`, `install_purchase_code=<trimmed>`, 302 `install.requirements`; failure -> back with error on `purchase_code` and old input |

- **Data:** Session only until finalize (TW-INST-015 writes `system_settings.envato_purchase_code` and `envato_verified_at` as ISO-8601, type string). Item id and author token come from `Licence` (TW-INST-017); item id `63755235` is baked in `config/license.php`.
- **Rules & edge cases:**
  1. Verification happens before any database exists, so it reads no DB: it calls `GET https://api.envato.com/v3/market/author/sale?code=<code>` with headers `Authorization: Bearer <author token>` and `User-Agent: Threadwise-Installer`, 20 s timeout.
  2. Outcomes (messages paraphrased): empty code -> "enter your purchase code"; author token unavailable/tampered -> "licence check is not configured (missing Envato token)"; network exception -> "could not reach Envato, check the server's internet connection"; HTTP 404 -> "invalid purchase code - Envato has no sale for it"; any other non-2xx -> "Envato verification failed (HTTP <status>)"; 2xx but `item.id` differs from the configured item id (only compared when both are non-empty) -> "this purchase code is for a different product"; otherwise ok.
  3. Only success/failure and a stored code are used; buyer name, licence type, support expiry, and supported-until are ignored. A code is not bound to a domain and there is no "one install per code" check, so the same code can be verified on unlimited servers.
  4. QUIRK: the licence gate is enforced only by GET redirects. `POST /install/database`, `/application`, `/admin`, `/node` and `POST /install/execute` never check `install_purchase_ok`; a client that posts those forms directly with a valid session cookie can complete an install with no verified code. `GET /install/requirements` is the only page that re-checks the flag.
  5. QUIRK: docs (web-installer, server requirements) never mention the licence step at all; the video/steps describe Welcome -> Requirements directly.
  6. The failure message for a lookup that throws is generic; the raw Envato error body is never shown or logged.
  7. Session is a plain file session, so the verified code sits unencrypted in `storage/framework/sessions/*` until the wizard finishes (and remains in that file after `forget` only for keys explicitly removed; `install_purchase_*` are not forgotten by finalize).
- **Async & events:** none.
- **External systems:** Envato Market API `v3/market/author/sale`, bearer personal token of the item author (decrypted on demand, TW-INST-017). Failure handling: any failure blocks progress; there is no offline override.
- **Settings:** `config/license.php` `item_id` (63755235); `config/license.json` encrypted token; env `.env` is not used. No admin setting.
- **Acceptance criteria:**
  - Given the wizard session has no verified code, When the user opens `/install/requirements`, Then they are redirected to `/install/license`.
  - Given a purchase code that Envato reports as sold for item 63755235, When it is submitted, Then the session is marked verified and the user lands on Requirements.
  - Given Envato returns 404, When the code is submitted, Then the licence page re-renders with the "invalid purchase code" message and the entered value retained.
  - Given Envato is unreachable, When the code is submitted, Then an internet-connectivity message is shown and no session flag is set.
  - Given the code belongs to a different item id, When submitted, Then "different product" is shown.
- **Source refs:** app/Http/Controllers/InstallController.php (license, verifyLicense, envatoVerify); resources/views/install/license.blade.php; app/Support/Licence.php; config/license.php; config/license.json; config/version.php.
- **Port notes:** The port is our own product, not a CodeCanyon item; do not port Envato verification. If licensing is ever needed (white-label resale), model it as a signed licence token validated offline or by our own licensing endpoint behind a provider-adapter. Nothing exists in `crm-platform` for this. The insecure "gate only on GET" pattern must not be copied: any setup POST must re-check state server-side.

### TW-INST-004 — Server requirements check

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-INST-002
- **Summary:** A live pre-flight screen that inspects the PHP runtime, required extensions, writable directories and PDO drivers and only enables Continue when everything passes.
- **Actors & access:** Anyone at the wizard, after the licence is verified. No permissions.
- **UX & screens:** `resources/views/install/requirements.blade.php`: title "Step 2 of 8 - Server requirements". A PHP version banner (green "meets the 8.2+ requirement" or coral "Reference needs 8.2 or newer"), a two-column grid: left "PHP extensions" with an `n/total` counter and one tile per extension (tick/cross); right "Directories" (`n/total` and tiles) and "PDO drivers" (chips for every driver PDO reports, or "No PDO drivers detected", plus a coral "MySQL driver is required" when `mysql` is missing). Footer: Back to welcome; when everything passes an active Continue submit (posts the form), otherwise an amber notice ("fix the items marked in coral before continuing; Continue stays disabled") and a disabled button. The page is re-evaluated on every reload (no caching), so fixing the server and refreshing is the intended loop.
- **Endpoints:**

  | METHOD uri                | route name                 | Controller@action                   | middleware | request fields | response/redirect                                                        |
  | ------------------------- | -------------------------- | ----------------------------------- | ---------- | -------------- | ------------------------------------------------------------------------ |
  | GET install/requirements  | install.requirements       | InstallController@requirements      | web        | none           | no verified licence -> 302 `install.license`; else renders check results |
  | POST install/requirements | install.requirements.check | InstallController@checkRequirements | web        | none           | sets `install_step=2`, 302 `install.database`                            |

- **Data:** none persisted. Checks performed:
  - PHP `PHP_VERSION >= 8.2.0`.
  - Extensions loaded (13): bcmath, ctype, curl, dom, fileinfo, gd, json, mbstring, openssl, pdo, tokenizer, xml, zip.
  - Directories (6): `storage` writable, `storage/app` writable, `storage/framework` writable, `bootstrap/cache` writable, `lang` is a readable directory, `.env` writable (if `.env` exists it must be writable, otherwise the project root must be writable).
  - PDO drivers list must contain `mysql`.
- **Rules & edge cases:**
  1. `allPassed` = PHP ok AND no extension missing AND no directory failing AND mysql PDO driver present. It is only used to render the button state.
  2. QUIRK: the POST handler does not re-run the checks; it unconditionally sets `install_step=2`, so the "Continue disabled" rule is enforced in the UI only.
  3. Requirement gaps between code and docs: docs also list Composer 2, Node 18+ (recommended 20), npm 9, 1 GB RAM (2 GB+), 2 GB disk, HTTPS "recommended", MySQL 8 / MariaDB 10.6+ ; none of these are checked by the wizard (the Node presence is never probed). `gd` and `zip` are the commonly missing ones on shared hosting. No check for `pdo_mysql` version, `allow_url_fopen`, `curl` TLS, `memory_limit`, `upload_max_filesize` (which the Updater later needs) or OPcache.
  4. The "PDO drivers" tile list is informational; only `mysql` matters. SQLite/PostgreSQL are not accepted by the installer even though `UpdaterService` has SQLite branches.
  5. The Welcome page says "MySQL 8"; the wizard performs no server-version check.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given PHP 8.1, When the page loads, Then the version banner is coral, the button is disabled and `allPassed` is false.
  - Given the `zip` extension is missing, When the page loads, Then the extension counter shows 12/13, the zip tile has a cross and Continue is disabled.
  - Given `.env` does not exist and the project root is not writable, When the page loads, Then the ".env writable" directory tile fails.
  - Given all checks pass, When Continue is pressed, Then the user reaches the Database step.
- **Source refs:** app/Http/Controllers/InstallController.php (requirements, checkRequirements); resources/views/install/requirements.blade.php; Documentation/pages/installation/server-requirements.html; Documentation/pages/installation/troubleshooting.html.
- **Port notes:** Replace with an environment self-check at API boot (`apps/api/src/health/health.controller.ts`, `config/env.schema.ts`): DB reachable, Redis reachable, migrations up to date, storage writable, Node bridge reachable. There is no PHP-extension equivalent; expose the same idea as a readiness probe rather than a wizard screen.

### TW-INST-005 — Database step: form, session hold and forward guard

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-INST-004
- **Summary:** The operator enters MySQL host, port, database name, username and password. The values are held in the wizard session (not yet written to disk) and used by the later install run.
- **Actors & access:** Anyone at the wizard with `install_step >= 2`. No permissions.
- **UX & screens:** `resources/views/install/database.blade.php` (Alpine `dbForm()`): a fixed "MySQL" driver badge (only supported driver); Host (default `127.0.0.1`, spans 2 columns) and Port (default `3306`); Database name (placeholder `threadwise`); Username (placeholder `root`); Password; a "Test connection" button (TW-INST-006); Back to Requirements; Continue. Hidden mirror inputs carry the values in the real form POST; submit is intercepted (`@submit.prevent`) and routed through `window.installGo` (no-reload) with native submit as fallback. Returning to the page pre-fills from the session, including the password (rendered into the page as JSON). Validation errors: first error in a coral box.
- **Endpoints:**

  | METHOD uri            | route name            | Controller@action              | middleware | request fields                                                                                                               | response/redirect                                                                                                   |
  | --------------------- | --------------------- | ------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
  | GET install/database  | install.database      | InstallController@database     | web        | none                                                                                                                         | ensureStep(2) else welcome; renders with session `db`                                                               |
  | POST install/database | install.database.save | InstallController@saveDatabase | web        | `host` required string; `port` required numeric; `database` required string; `username` required string; `password` optional | stores `db` (host, port, database, username, password) in session, sets `install_step=3`, 302 `install.application` |

- **Data:** Session key `db` = {host, port, database, username, password}. Nothing is written to `.env` until install sub-step 1.
- **Rules & edge cases:**
  1. Password may be blank (no `required`), allowing passwordless local root.
  2. QUIRK: Continue does not require a successful test; nothing verifies the connection or that the database is empty. Errors show up later at sub-step 2.
  3. QUIRK: the password is stored in the plaintext session file and echoed back into the page HTML when the step is revisited.
  4. No max lengths, no host format validation, no charset/collation choice (migrations decide; docs recommend utf8mb4).
  5. The form is the only UI that does not use the native POST path (Alpine intercept); with the enhancement script absent it falls back to `form.submit()`.
- **Async & events:** none.
- **External systems:** none at this step.
- **Settings:** none.
- **Acceptance criteria:**
  - Given valid fields, When Continue is pressed, Then session `db` holds all five values and the user is on the Application step.
  - Given an empty `database` field, When Continue is pressed, Then the page re-renders with a validation error and the user stays on step 3.
  - Given the user returns from Application via Back, When the page loads, Then all fields including password are pre-filled.
  - Given `install_step` is 1, When `/install/database` is opened, Then a redirect to welcome occurs.
- **Source refs:** app/Http/Controllers/InstallController.php (database, saveDatabase); resources/views/install/database.blade.php; Documentation/pages/installation/web-installer.html (Creating the Database panels for cPanel, Hostinger, Plesk, aaPanel, phpMyAdmin).
- **Port notes:** Not needed on the new stack (connection comes from env via `env.schema.ts`; Postgres). If a setup UI is built, never echo secrets back to the client and never require the DB step (the DB is already up because the API is running).

### TW-INST-006 — Database connection test with transport cascade

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-INST-005
- **Summary:** An AJAX "Test connection" that opens a real PDO connection using the entered values and, if the direct attempt fails for a transport reason, automatically tries other transports (explicit Unix sockets, loopback TCP, `localhost`) so shared hosts that block one method still work. The winning transport is reused for the actual install.
- **Actors & access:** Anyone at the wizard. No permissions, no CSRF exemption (the page sends `X-CSRF-TOKEN` from the meta tag).
- **UX & screens:** Button "Test connection" (spinner and "Testing..." while pending; disabled meanwhile) under the database form. Result boxes: green `success` with message, or coral with message. Network failure shows "Network error: <detail>". The message on success is always "Connection successful." (the resolved transport is intentionally hidden from the UI).
- **Endpoints:**

  | METHOD uri                 | route name            | Controller@action              | middleware | request fields                                                                                                                           | response/redirect                                                                                                                                                                                                         |
  | -------------------------- | --------------------- | ------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | POST install/database/test | install.database.test | InstallController@testDatabase | web        | `host` required string; `port` required numeric; `database` required string; `username` required string; `password` optional (JSON body) | 200 `{success:true,message}`; 422 `{success:false,message}` for credential/database errors; 422 `{success:false,message,tried:{label:error}}` when every transport failed; 422 validation errors as standard Laravel JSON |

- **Data:** none persisted. The resolver (also used by sub-steps 1-6) builds candidates in this order: (1) exactly the entered host/port/db (label `host=<host>`; treated as TCP if the host is an IP, else "host"); (2) explicit Unix sockets from `pdo_mysql.default_socket`, `mysqli.default_socket`, `/var/run/mysqld/mysqld.sock`, `/run/mysqld/mysqld.sock`, `/var/lib/mysql/mysql.sock`, `/tmp/mysql.sock`, `/var/run/mysqld/mysqld10.sock` (deduplicated, blanks dropped); (3) `127.0.0.1:<port>`; (4) `localhost` with no port. PDO timeout 4 s, exceptions mode.
- **Rules & edge cases:**
  1. Stop rule: if a connect error message contains MySQL code 1045 (access denied), 1044 (no privileges on db), 1049 (unknown database) or 1698 (auth plugin), the cascade stops immediately and that exact server message is returned (422) because the transport works and retrying others would hide the actionable error.
  2. If every candidate fails with non-auth errors, the generic hosting hint is returned: could not reach MySQL by socket or TCP; a "[2002] Operation not permitted" is the host blocking the connection, not a bad password; use the exact host from the hosting panel (Hostinger usually `localhost`); confirm database and user exist with ALL privileges. The `tried` map (label -> raw error) is included in the JSON even though the UI only shows `message`.
  3. The successful transport (`via` = tcp / host / socket, plus resolved host/port/socket) is recomputed in every later `execute` call; sub-step 1 persists it as `DB_HOST`/`DB_PORT` or `DB_SOCKET`, and runtime config for later sub-steps is patched with it (TW-INST-011).
  4. Each connect attempt connects to the named database directly (`dbname=`), so a not-yet-created database fails with 1049 (message shown as-is, e.g. "Unknown database"). No CREATE DATABASE is attempted.
  5. Detailed messages can disclose DB host/user details to an unauthenticated visitor, but only on this pre-install page (the install run masks its own errors, TW-INST-010).
  6. MariaDB works (docs: 10.6+ supported); no server-version check is done, no `sql_mode`/collation check.
- **Async & events:** none.
- **External systems:** the operator's MySQL server via PDO.
- **Settings:** PHP ini `pdo_mysql.default_socket`, `mysqli.default_socket`.
- **Acceptance criteria:**
  - Given correct credentials for an existing empty database, When "Test connection" is clicked, Then a green "Connection successful." appears and HTTP status is 200.
  - Given a wrong password, When tested, Then a 422 with the server's "Access denied" message is shown and no other transport is attempted.
  - Given `localhost` is blocked by the host but a Unix socket works, When tested, Then the test still succeeds and the later install uses that socket for `.env`.
  - Given a missing `database` field, When tested, Then a validation error JSON (422) is returned.
  - Given every transport fails with error 2002, When tested, Then the message explains the hosting restriction.
- **Source refs:** app/Http/Controllers/InstallController.php (testDatabase, resolveConnection, applyDatabaseConfig); resources/views/install/database.blade.php (testConnection script); Documentation/pages/faqs/errors-solutions.html ("Error on DB"); Documentation/pages/installation/troubleshooting.html (Database connection fails).
- **Port notes:** Not portable as-is (PDO/MySQL specific). Equivalent on the new stack is a `pg` connection check in the migrator/health probe with clear errors for auth/unknown-db/network. Keep "surface the server's authentication message verbatim, but collapse transport failures into one hint" as UX.

### TW-INST-007 — Application basics step

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-INST-005
- **Summary:** The operator names the install, confirms its public URL and picks a default timezone and interface language; these seed `.env` and the first workspace.
- **Actors & access:** Anyone at the wizard with `install_step >= 3`. No permissions.
- **UX & screens:** `resources/views/install/application.blade.php` ("Step 4 of 8 - Application basics"): Application name (default from `brand_name()` helper, i.e. "Reference", required, autofocus); Application URL (`type=url`, default `url('/')` of the current request, placeholder `https://app.example.com`); Timezone typeahead (Alpine `appBasics()`: list = `timezone_identifiers_list()`, search box shows up to 25 matches, empty search shows first 25; click a row to select; hidden input `timezone` carries the selected value, initial selection `UTC` or the previously saved value); Default language select with 21 options (en, es, hi, ar, pt, ru, ja, de, fr, it, ko, zh-CN, tr, id, vi, th, pl, nl, ur, he, bn) shown with native labels; Back to Database; Continue. Errors: first error in coral box.
- **Endpoints:**

  | METHOD uri               | route name               | Controller@action                 | middleware | request fields                                                                                                                  | response/redirect                                                               |
  | ------------------------ | ------------------------ | --------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
  | GET install/application  | install.application      | InstallController@application     | web        | none                                                                                                                            | ensureStep(3) else welcome                                                      |
  | POST install/application | install.application.save | InstallController@saveApplication | web        | `name` required string max 100; `url` required url max 255; `timezone` required string max 100; `locale` required string max 12 | session `app`={name,url,timezone,locale}; `install_step=4`; 302 `install.admin` |

- **Data:** Session key `app`. Later written to `.env` (`APP_NAME` quoted, `APP_URL`, `APP_TIMEZONE`, `APP_LOCALE`, `APP_FALLBACK_LOCALE=en`) and to the first workspace (`timezone`, `locale`).
- **Rules & edge cases:**
  1. QUIRK: `timezone` and `locale` are only validated as strings; they are not checked against the real timezone list or the 21 supported locale codes, so a hand-crafted POST can store any value.
  2. QUIRK: typing in the timezone search box without clicking an option does not change the selection (hidden input only changes on click) - the previous/`UTC` value is submitted.
  3. The URL is saved verbatim (no trailing-slash stripping, no scheme enforcement); `/public` is legitimately part of it on hosts without the `.htaccess` rewrite (docs). It feeds `APP_URL` (used for links, webhooks, redirects) and `node/.env` `APP_DOMAIN_NAME`, and is baked into the browser extension (TW-INST-011).
  4. Docs promise the name is "shown across the app and branding"; runtime branding actually reads `APP_NAME` and admin settings (SET).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given name "Acme Desk", URL "https://app.acme.io", timezone "Asia/Kolkata", locale "hi", When Continue is pressed, Then session `app` stores those four values and the Admin step opens.
  - Given a URL without a scheme (e.g. `app.acme.io`), When submitted, Then the URL validation error shows and the step stays.
  - Given a name of 101 characters, When submitted, Then a max-length error shows.
  - Given the timezone typeahead, When the user types "kol" and clicks "Asia/Kolkata", Then the hidden field value is "Asia/Kolkata".
- **Source refs:** app/Http/Controllers/InstallController.php (application, saveApplication); resources/views/install/application.blade.php; Documentation/pages/installation/web-installer.html (Step 4).
- **Port notes:** Locale list and timezone list belong to I18N/SET; in the new stack use the platform default locale/timezone settings (`system_settings` equivalent) and IANA validation via `Intl.supportedValuesOf('timeZone')` server-side (Reference does not validate).

### TW-INST-008 — First super-admin account step

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-INST-007
- **Summary:** The operator defines the first platform administrator (name, email, password) and the name of that admin's private first workspace.
- **Actors & access:** Anyone at the wizard with `install_step >= 4`. No permissions.
- **UX & screens:** `resources/views/install/admin.blade.php` ("Step 5 of 8 - Admin account"): Full name (required, autofocus), Email (required), Password and Confirm password (both required, `minlength=8`), Workspace name (required, `maxlength=120`, placeholder "My team"), an info note ("Min. 8 chars - bcrypt-hashed. Reference is multi-tenant - one private workspace ships pre-configured; rename it later at /admin/workspaces. Your password is never stored in plain text."), Back to Application, Continue. All validation errors are listed (bullets), not just the first. The previously saved values (including the admin password) pre-fill via session on return.
- **Endpoints:**

  | METHOD uri         | route name         | Controller@action           | middleware | request fields                                                                                                                                                                  | response/redirect                                                                               |
  | ------------------ | ------------------ | --------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
  | GET install/admin  | install.admin      | InstallController@admin     | web        | none                                                                                                                                                                            | ensureStep(4) else welcome                                                                      |
  | POST install/admin | install.admin.save | InstallController@saveAdmin | web        | `name` required string max 120; `email` required email max 191; `password` required string min 8, confirmed (`password_confirmation`); `workspace_name` required string max 120 | session `admin_data`={name,email,password,workspace_name}; `install_step=5`; 302 `install.node` |

- **Data:** Session key `admin_data` (plain password held in session until finalize removes it). Later creates the `users` row (TW-INST-014).
- **Rules & edge cases:**
  1. No uniqueness/format check beyond `email` rule (nothing to compare against yet); no password complexity beyond length 8; no breach check.
  2. QUIRK: the info note says the password is "never stored in plain text", but it lives unhashed in the file session (and is pre-filled back into the form HTML) until sub-step 6 forgets the `admin_data` key; the session file itself can remain on disk (expired sessions are only garbage-collected by PHP).
  3. Docs button label is "Create admin & install"; the actual label is "Continue".
  4. Docs warn the wizard "does not keep [the password] in the session beyond this step": incorrect.
  5. Email is the login; SMTP is not configured yet (`MAIL_MAILER=log`), so password recovery does not work until mail is set up.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given mismatched password confirmation, When submitted, Then the page lists a "password confirmation does not match" style error and stays on step 5.
  - Given a 7-character password, When submitted, Then a min-length error shows.
  - Given valid values, When submitted, Then session `admin_data` holds four keys and the Node bridge step opens.
  - Given `install_step` is below 4, When `/install/admin` is requested, Then redirect to welcome.
- **Source refs:** app/Http/Controllers/InstallController.php (admin, saveAdmin); resources/views/install/admin.blade.php; Documentation/pages/installation/web-installer.html (Step 5).
- **Port notes:** Map to a one-time `platform-admin` bootstrap in `apps/api/src/modules/admin/users` (RBAC, identity pools per identity-pool design. Hash immediately (never hold the plaintext), enforce a stronger policy, require email verification or a one-time token. The "private first workspace" becomes the first `org`; creation must go through the audit+outbox path.

### TW-INST-009 — Node bridge step

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-INST-008
- **Summary:** The operator tells Reference where its Node.js WhatsApp bridge listens and confirms a shared secret; the installer later writes both the Laravel and Node env files so the two halves authenticate each other without manual copy/paste.
- **Actors & access:** Anyone at the wizard with `install_step >= 5`. No permissions.
- **UX & screens:** `resources/views/install/node.blade.php` ("Step 6 of 8 - Node bridge", Alpine `nodeBridge()`): Node server URL (`type=url`, default `http://localhost:8888`, required, autofocus; helper "Where your Node bridge listens. Laravel calls this to send messages"); Node port (`number`, min 1, max 65535, default 8888, required; helper "written to node/.env"); Node shared token (text, required, `minlength=16`, with a "Generate" button producing 64 hex chars from `crypto.getRandomValues` of 32 bytes; prefilled server-side); info panel stating that values are written to `.env` and `node/.env` and the token is shared as `NODE_WEBHOOK_TOKEN`; Back to Admin; primary button "Continue & install". Errors listed as bullets.
- **Endpoints:**

  | METHOD uri        | route name        | Controller@action          | middleware | request fields                                                                                        | response/redirect                                                                     |
  | ----------------- | ----------------- | -------------------------- | ---------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
  | GET install/node  | install.node      | InstallController@node     | web        | none                                                                                                  | ensureStep(5) else welcome; pre-fills `node_token` if session empty                   |
  | POST install/node | install.node.save | InstallController@saveNode | web        | `server_url` required url; `node_token` required string min 16; `node_port` required integer 1..65535 | session `node`={server_url,node_token,node_port}; `install_step=6`; 302 `install.run` |

- **Data:** Session key `node`. Token default when empty: the existing `NODE_WEBHOOK_TOKEN=` value found in the current `.env` (so re-runs do not rotate the secret), else a fresh `bin2hex(random_bytes(32))` (64 hex chars).
- **Rules & edge cases:**
  1. No cross-check between the URL and the port; the URL must include the port itself (e.g. `http://localhost:8888`). Port only feeds `node/.env` `PORT`.
  2. Token is visible in clear text in an input (intentional) and is stored in the session; there is no minimum entropy check beyond 16 chars.
  3. The step never contacts the Node service; reachability is not verified. Docs (step 8) say the wizard configures but does not start Node; operators must run `npm install` in `node/` and start it under PM2/systemd/Supervisor or the cPanel/Plesk Node app manager.
  4. Docs say Cloud API and Twilio sends also go through Node, so Node is required on every channel (owned by NODE/WADEV/WABA).
  5. If the user skips this step, `execute` still works (missing `node` session is tolerated): token falls back to a fresh 24-byte hex token and `SERVER_URL` becomes empty.
- **Async & events:** none.
- **External systems:** none contacted here.
- **Settings:** becomes `.env` `SERVER_URL`, `NODE_WEBHOOK_TOKEN`; `node/.env` `PORT`, `DOMAIN_NAME`, `NODE_WEBHOOK_TOKEN`.
- **Acceptance criteria:**
  - Given a fresh visit, When the page loads, Then the token field is pre-filled with a 64-char hex value (or the `.env` value if one exists).
  - Given the user clicks Generate, When it runs, Then the field is replaced by a new 64-char hex string.
  - Given port 70000, When submitted, Then a validation error shows.
  - Given a token shorter than 16 chars, When submitted, Then a validation error shows.
  - Given valid values, When "Continue & install" is pressed, Then the install run screen loads.
- **Source refs:** app/Http/Controllers/InstallController.php (node, saveNode, existingNodeToken); resources/views/install/node.blade.php; Documentation/pages/installation/web-installer.html (Step 6, Step 8); Documentation/pages/installation/post-install.html.
- **Port notes:** In the new architecture the Node bridge is a first-class service (NODE domain); its URL and shared secret become env config validated in `env.schema.ts` and rotated through admin settings, not user-typed in a wizard. Keep the "single shared secret, identical on both sides by construction" rule and a startup check that the bridge answers with the same token.

### TW-INST-010 — Install run screen and step dispatcher

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-INST-009
- **Summary:** The last wizard screen auto-runs the installation as six independently retryable server calls with live per-step progress, timing and a "Retry from failed step" button, then redirects to the login page.
- **Actors & access:** Anyone at the wizard with `install_step >= 6` for the page; the execute endpoint has no step check (see rules). No permissions.
- **UX & screens:** `resources/views/install/progress.blade.php` ("Step 7 of 8 - Installing Reference", Alpine `installer()`, auto-starts via `x-init`). A progress card with overall label, percent (`(done + 0.5*running)/6`) and a gradient bar; six rows each with pending/running/done/failed icon, label, and duration (running shows a live elapsed timer at 100 ms). Row labels (done / running text): "Environment written / Writing .env configuration...", "Database tables created / Running database migrations...", "Essential data seeded / Seeding roles, plans, currencies, gateways, guidebook...", "Admin + workspace ready / Creating admin account and private workspace...", "File permissions set / Linking storage and call-recording directories...", "Installation finalized / Clearing caches and writing install marker...". Error state: a coral "Installation paused" block with the server message and a full-width "Retry from failed step" button. Success: green "Installation complete - redirecting..." then after 1.4 s `window.location = /login`. The page is always loaded with a hard navigation (never swapped) so the auto-run fires exactly once per load. Copy claims "usually takes 20-40 seconds".
- **Endpoints:**

  | METHOD uri           | route name      | Controller@action         | middleware | request fields           | response/redirect                                                                                                                                                                                                                                                                                                                                       |
  | -------------------- | --------------- | ------------------------- | ---------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | GET install/run      | install.run     | InstallController@run     | web        | none                     | ensureStep(6) else welcome; renders progress page                                                                                                                                                                                                                                                                                                       |
  | POST install/execute | install.execute | InstallController@execute | web        | JSON `step` integer 1..6 | 200 `{success:true, step}`; 422 `{success:false,message:"Installation state lost. Restart the wizard from /install."}` when session `db`, `app` or `admin_data` is empty; 500 `{success:false, step, message:"Installation step failed. Please check your details and the server logs, then try again."}` on any Throwable (also for step outside 1..6) |

- **Data:** Reads session `db`, `app`, `admin_data`, `node` (node optional). Nothing else persisted by the dispatcher itself.
- **Rules & edge cases:**
  1. Execution limits are lifted at the start of every call: `set_time_limit(0)`, `max_execution_time=0`, `max_input_time=-1`, `ignore_user_abort(true)`, `memory_limit=512M` (a migration/seed on a slow shared host can exceed 120 s; a killed request leaves a half-migrated DB).
  2. For step >= 2 the DB connection is re-derived from the wizard values on every request (`applyDatabaseConfig`, TW-INST-006 cascade) and the `mysql` connection is purged; `database.default` is forced to `mysql`, so a DB_CONNECTION in a pre-existing `.env` is ignored during the run.
  3. Errors are logged server-side (`[INSTALL] step N failed: <message>` with exception class) and never echoed, because a PDO/SQLSTATE message can leak host/user details to an unauthenticated visitor. The operator must read `storage/logs/laravel.log`.
  4. Retry semantics: the client marks the failed row and every later row pending and restarts; rows already `done` are skipped. Steps must be safe to repeat: sub-step 1 rewrites `.env`; 2 is a no-op for applied migrations; 3 is idempotent (updateOrCreate/firstOrCreate); 4 is NOT fully idempotent (see TW-INST-014); 5 and 6 are safe.
  5. QUIRK: reloading `/install/run` (or the browser refreshing it) auto-starts from step 1 again; a second run re-executes everything, so a reload after step 4 succeeded creates a second workspace for the admin.
  6. QUIRK: the dispatcher does not verify that steps run in order; a client may call any step number with a populated session. It also never re-checks the licence flag or `install_step` (TW-INST-003 quirk).
  7. Once sub-step 6 succeeds and writes `storage/installed`, later `POST /install/execute` calls are redirected to `/` by `EnsureInstalled` (302), so a stray call cannot re-run the installer.
  8. Success path in the client ignores the `install_complete` session value (written by finalize, never read anywhere).
- **Async & events:** none queued; all synchronous within each HTTP request. No audit log or notification is written by the installer.
- **External systems:** MySQL via PDO/Artisan; filesystem.
- **Settings:** PHP `max_execution_time`, `memory_limit` (overridden), `ignore_user_abort`.
- **Acceptance criteria:**
  - Given a complete session, When the run page loads, Then six POSTs to `/install/execute` run in order, each row turns done, and the browser goes to `/login` about 1.4 s after the last.
  - Given migrations fail on step 2, When the response arrives, Then row 2 shows failed with the generic message, `laravel.log` has the "[INSTALL] step 2" line, and "Retry from failed step" resumes at row 2.
  - Given the session has expired, When any step is posted, Then HTTP 422 "Installation state lost" is returned.
  - Given the install marker exists, When `/install/execute` is posted, Then the request is redirected to `/`.
- **Source refs:** app/Http/Controllers/InstallController.php (run, execute); resources/views/install/progress.blade.php; resources/js/charts/install-wizard.js (hard navigation for /install/run); Documentation/pages/installation/web-installer.html (Step 7).
- **Port notes:** Model as an idempotent "bootstrap" job or CLI (`pnpm db:migrate` then a seed script) rather than a browser-driven six-call runner; make each phase idempotent and record phase completion in a `system_state` table so a reload cannot duplicate the org. If a UI is kept, use a job id + polling (BullMQ) so long steps survive proxy timeouts (compare TW-INST-023).

### TW-INST-011 — Install sub-step 1: write .env, node/.env and extension URL

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-INST-010
- **Summary:** Persists all wizard answers into the project's `.env`, mirrors the Node-related values into `node/.env`, and bakes the deployed app URL into the browser extension so nothing else needs hand-editing.
- **Actors & access:** Runs as the web-server user on behalf of the anonymous installer. Requires write access to project root/`.env`, `node/`, and `extension/content.js`.
- **UX & screens:** Row 1 of the run screen ("Environment written"). No other UI. Warnings about `node/.env` or the extension are flashed to the session but the run screen never renders them (see rules).
- **Endpoints:**

  | METHOD uri                    | route name      | Controller@action                         | middleware | request fields | response/redirect               |
  | ----------------------------- | --------------- | ----------------------------------------- | ---------- | -------------- | ------------------------------- |
  | POST install/execute (step=1) | install.execute | InstallController@execute -> stepWriteEnv | web        | `step=1`       | `{success:true}` or generic 500 |

- **Data:** `.env` keys written or replaced in place (existing lines replaced, missing ones appended): `APP_NAME` (double-quoted, inner quotes escaped), `APP_ENV=production`, `APP_KEY` (existing non-empty value kept, otherwise `base64:`+32 random bytes), `APP_DEBUG=false`, `APP_URL`, `APP_TIMEZONE`, `APP_LOCALE`, `APP_FALLBACK_LOCALE=en`, `DB_CONNECTION=mysql`, `DB_HOST`, `DB_PORT`, `DB_SOCKET` (empty unless the winning transport is a socket), `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD` (quoted only if it contains whitespace, `#`, quotes or backslash), `SESSION_DRIVER=database`, `CACHE_STORE=database`, `QUEUE_CONNECTION=database`, `BROADCAST_DRIVER=log`, `MAIL_MAILER=log`, `SERVER_URL` (Node URL), `NODE_WEBHOOK_TOKEN`, `META_GRAPH_VERSION=v23.0`. `node/.env` keys (read-merge-write, other keys preserved, file ends with newline): `PORT` (default 8888 if blank), `DOMAIN_NAME` (Node URL with trailing slash trimmed, or empty), `APP_DOMAIN_NAME` (app URL, default `http://localhost`), `NODE_WEBHOOK_TOKEN`. `extension/content.js`: the constant `THREADWISE_SERVER_URL` is rewritten to the app URL (trailing slash stripped, quote characters removed) with a first-match regex.
- **Rules & edge cases:**
  1. The connection actually used is the transport resolved by the TW-INST-006 cascade: `DB_SOCKET` is set only when a socket won; `DB_HOST`/`DB_PORT` are overwritten with the resolved host/port when a TCP/hostname candidate won (so an entered `localhost` may be persisted as `127.0.0.1`, or vice versa).
  2. A failure to write `.env` throws (whole step fails, generic 500). A failure writing `node/.env` or the extension is non-fatal: it is logged (`Install: node/.env write skipped`, `Install: extension/content.js not writable`) and a session flash is set (`node_env_warning`, `extension_url_warning`); QUIRK: nothing displays these flashes, so the operator learns only from the log or from a Node bridge that cannot authenticate.
  3. If `node/` does not exist it is created (mode 0775) in the app folder; the Node code is expected to live in `base_path('node')`.
  4. `APP_DEBUG=false` and `APP_ENV=production` are forced; `SESSION_DRIVER`, `CACHE_STORE`, `QUEUE_CONNECTION` are database-backed so no Redis or supervisor is required (docs: "no standard worker needed"). `BROADCAST_DRIVER` is the legacy key name; `.env.example` uses `BROADCAST_CONNECTION=log`, so both may end up present.
  5. `DB_USERNAME` is not quoted, so a username with spaces or `#` would corrupt `.env`; APP_URL/APP_TIMEZONE/APP_LOCALE are not quoted either.
  6. Not written: `MAIL_*` details, `LOG_LEVEL`, `FILESYSTEM_DISK`, `SESSION_LIFETIME` (they keep `.env.example` values). Mail stays in `log` mode, so no email is sent until the admin configures SMTP.
  7. Because the shipped extension file has a dev URL constant (`http://localhost/check-1.7/public`), the bake-in only helps if the file is present and writable; if the extension folder is absent it is skipped with an info log.
  8. Config in memory is not reloaded; subsequent sub-steps rely on `applyDatabaseConfig`. After finalize, `config:clear` ensures the next request reads the new `.env`.
- **Async & events:** none.
- **External systems:** local filesystem.
- **Settings:** the keys above; docs (post-install) list `APP_URL`, `SERVER_URL`, `NODE_WEBHOOK_TOKEN` (Laravel) and `PORT`, `APP_DOMAIN_NAME`, `NODE_WEBHOOK_TOKEN`, optional `ALLOWED_ORIGINS` (Node, not written by installer; unset = allow any origin, the token is the real guard).
- **Acceptance criteria:**
  - Given a `.env` with an existing `APP_KEY`, When step 1 runs, Then that key is preserved and all other listed keys are set to the wizard values.
  - Given a DB user with a password containing a space, When step 1 runs, Then `DB_PASSWORD` is written double-quoted with escapes.
  - Given `node/.env` already holds `ALLOWED_ORIGINS`, When step 1 runs, Then that line is preserved and `PORT`, `DOMAIN_NAME`, `APP_DOMAIN_NAME`, `NODE_WEBHOOK_TOKEN` are updated.
  - Given `node/` is read-only, When step 1 runs, Then the step still succeeds and a warning is logged.
  - Given `.env` is not writable, When step 1 runs, Then the step fails with the generic error.
- **Source refs:** app/Http/Controllers/InstallController.php (stepWriteEnv, writeNodeEnv, writeExtensionUrl, resolveAppKey, quoteForEnv); .env.example; extension/content.js (constant); Documentation/pages/installation/post-install.html; Documentation/pages/installation/web-installer.html (Step 6).
- **Port notes:** In the new stack `.env` is deploy-time (docker compose) and validated by `apps/api/src/config/env.schema.ts`; do not write it from the app. What must survive: one shared bridge secret injected identically into api and Node, and the public app URL propagated to the bridge and to the Chrome extension build (EXT). Extension URL baking becomes a build-time/config value, not a source rewrite.

### TW-INST-012 — Install sub-step 2: run database migrations

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-INST-011
- **Summary:** Creates the entire schema by running every Laravel migration against the configured database.
- **Actors & access:** Installer only.
- **UX & screens:** Row 2 ("Database tables created").
- **Endpoints:**

  | METHOD uri                    | route name      | Controller@action                              | middleware | request fields | response/redirect               |
  | ----------------------------- | --------------- | ---------------------------------------------- | ---------- | -------------- | ------------------------------- |
  | POST install/execute (step=2) | install.execute | InstallController@execute -> stepRunMigrations | web        | `step=2`       | `{success:true}` or generic 500 |

- **Data:** Runs `php artisan migrate --force` (equivalent `Artisan::call`); Laravel records each file in the `migrations` table (int id, `migration` varchar 255, `batch` int). On a fresh install all 350 v1.7.0 migration files land in a single batch (batch 1), as seen in the reference DB (350 rows, max batch 1). No `--seed`. Table list and column detail belong to the owning domains (see `_work/manifests/tables.txt`). Includes data-writing migrations (e.g. seeding admin AI-key rows, backfills).
- **Rules & edge cases:**
  1. No pre-check that the database is empty; running against a non-empty DB just applies what is missing (Laravel semantics) and fails on conflicting tables.
  2. Artisan output is discarded, so on failure the only clue is `laravel.log`. Partial failure leaves earlier migrations recorded; retry continues from the failed migration.
  3. Migrations run against the session-configured `mysql` connection, using the socket if the cascade chose one (TW-INST-010 rule 2).
  4. MySQL/MariaDB specifics (JSON columns with `json_valid` checks, `longtext` JSON, generated columns) are baked into migrations; SQLite/Postgres are unsupported.
  5. The updater, not the installer, deals with later migrations (TW-INST-024).
- **Async & events:** none.
- **External systems:** MySQL.
- **Settings:** none (DB connection from wizard session).
- **Acceptance criteria:**
  - Given an empty MySQL database and valid credentials, When step 2 runs, Then the `migrations` table contains 350 rows (v1.7.0) all with the same batch number and `sessions`, `cache`, `jobs` tables exist.
  - Given step 2 already ran, When it runs again, Then it succeeds and no new rows are added.
  - Given the DB user lacks CREATE privilege, When step 2 runs, Then the client shows the generic failure and the log names the SQL error.
- **Source refs:** app/Http/Controllers/InstallController.php (stepRunMigrations); database/migrations/* (350 files); _work/manifests/migrations.txt; Documentation/pages/faqs/installation.html (database not creating tables).
- **Port notes:** Replaced by `packages/db` hand-written SQL migrations applied by the checksum-tracked runner; run it before the API starts (deploy step / container entrypoint), not inside an HTTP request. The Reference migration history itself is not portable; each domain writer's Data model section defines the new tables.

### TW-INST-013 — Install sub-step 3: seed essential default data

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-INST-012
- **Summary:** Loads the baseline data the admin console and checkout need to function: roles/permissions, subscription plans, currencies, payment gateways, translation providers, checkout defaults, in-app guidebook articles and legal pages.
- **Actors & access:** Installer only.
- **UX & screens:** Row 3 ("Essential data seeded - Seeding roles, plans, currencies, gateways, guidebook...").
- **Endpoints:**

  | METHOD uri                    | route name      | Controller@action                         | middleware | request fields | response/redirect               |
  | ----------------------------- | --------------- | ----------------------------------------- | ---------- | -------------- | ------------------------------- |
  | POST install/execute (step=3) | install.execute | InstallController@execute -> stepSeedData | web        | `step=3`       | `{success:true}` or generic 500 |

- **Data:** Runs, in this order via `db:seed --class=<X> --force` (a missing class is skipped): `RolePermissionSeeder`, `PackageSeeder`, `CurrencySeeder`, `PaymentGatewaySeeder`, `TranslationProviderSeeder`, `CheckoutDefaultsSeeder`, `GuidebookArticleSeeder`, `LegalPagesSeeder`. What each writes (all idempotent):
  - RolePermissionSeeder (RBAC): ~101 permissions (`<area>.<view|create|edit|delete>` plus specials such as `platform.workspace.view_all`, `platform.workspace.impersonate`, `platform.audit.view`), guard `web`; 6 roles: `Super Admin` and `Admin` (all permissions), `Manager` (only actions view/edit/reply/assign/invoices/export), `User` (only `*.view`), `Platform Support` (9 platform.* keys), `Auditor` (4 read-only platform.* keys). Clears the permission cache.
  - PackageSeeder (PLAN): four `packages` rows keyed by `plan_id` with updateOrCreate: `starter` (free, sort 1, 1 device, 500 contacts, 1,000 msgs/month, 1 flow, 1 auto-reply), `growth` (19 USD list, 15 offer, monthly, sort 2, 2 devices, 5,000 contacts, 20,000 msgs, 3 seats), `pro` (49/39, highlighted, sort 3, 5 devices, 25,000 contacts, 100,000 msgs, 10 seats), `enterprise` (custom quote, sort 4, all limits 0 = unlimited, every feature flag on); `status=true`, `currency=USD`.
  - CurrencySeeder (CPN): 30 active currencies with symbol, precision (0 for JPY/IDR/VND/KRW/CLP/COP) and static USD-relative `exchange_rate` (USD = 1).
  - PaymentGatewaySeeder (PAYGW): 32 `payment_gateways` rows (Stripe, PayPal, Razorpay ... plus `bank_transfer`, `offline`), `is_active=false`, `mode=sandbox`, `supported_currencies` JSON per gateway; credentials never touched; back-fills `supported_currencies` where null.
  - TranslationProviderSeeder (I18N): five providers; `mymemory` (default, active) and `google_gtx` (active); `libretranslate`, `deepl`, `google_cloud` inactive.
  - CheckoutDefaultsSeeder (CPN/CHK): `system_settings`: `pricing.yearly_discount_pct=20` (int), `checkout.tax_rate=18` (int), `checkout.tax_label=GST`, `checkout.countries` (JSON list of 25 countries ending "Other"), `pricing.refund_days=7`; six `pricing_faqs` rows if the table is empty; two coupons if none exist: `WELCOME10` (10 percent) and `SAVE20` (20 percent), both active.
  - GuidebookArticleSeeder (CMS): 32 `guidebook_articles` keyed by slug (Getting started, Campaigns, Templates, Auto-reply, Scheduled sends, Webhooks, Flows, Contacts, Billing, Troubleshooting categories), markdown bodies.
  - LegalPagesSeeder (CMS): `legal_pages` for slugs terms, privacy, refund, cookies, acceptable-use, extracted from the frontend Blade templates; inserted only if the slug does not exist.
- **Rules & edge cases:**
  1. QUIRK: fresh production installs ship two ACTIVE demo coupons (`WELCOME10`, `SAVE20`) and the default GST 18 percent tax; operators must remove/adjust them (the docs do not say so).
  2. `DatabaseSeeder` (test user `test@example.com`/`password`, demo contacts, chats, campaigns, devices etc.) is NOT run by the installer; only these eight seeders run. `AdminAiKeySeeder` is also not run (AI-key rows come from data migrations).
  3. Seeders are chained with `Artisan::call`, so the first failure aborts the rest; retry re-runs all safely.
  4. The seed list is hard-coded, not discovered; adding a seeder to the product requires touching `InstallController`.
  5. Default plan set is what the "first workspace" is attached to (TW-INST-014); the four plans reflect a Starter/Growth/Pro/Enterprise ladder shown on the pricing page.
  6. Currency rates are static seed values; an admin "fetch rates" action updates them later (CPN).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** written to `system_settings` (above).
- **Acceptance criteria:**
  - Given a migrated empty DB, When step 3 runs, Then `roles` has 6 rows, `payment_gateways` 32, `currencies` 30, `packages` 4, `translation_providers` 5, `guidebook_articles` 32 and `legal_pages` 5.
  - Given step 3 already ran and the admin edited the `pro` plan price, When step 3 runs again, Then `packages` is updated back to seed values only for the four seeded `plan_id` rows (updateOrCreate) while gateway credentials and legal page bodies stay untouched.
  - Given `coupons` already has a row, When step 3 runs, Then no demo coupons are created.
  - Given step 3 completes, Then the `Super Admin` role has every permission listed in `permissions`.
- **Source refs:** app/Http/Controllers/InstallController.php (stepSeedData); database/seeders/RolePermissionSeeder.php, PackageSeeder.php, CurrencySeeder.php, PaymentGatewaySeeder.php, TranslationProviderSeeder.php, CheckoutDefaultsSeeder.php, GuidebookArticleSeeder.php, LegalPagesSeeder.php; database/seeders/DatabaseSeeder.php (not used by installer); Documentation/pages/installation/web-installer.html (Step 7 list).
- **Port notes:** Each seeded set is owned by another domain's inventory; here it is the "bootstrap seed" contract. On the new stack: `packages/db/migrations/0008_seed_permission_defs.sql` already seeds permission defs; add idempotent seed for plans/currencies/gateways via SQL or a seed script run at deploy. Do not port the demo coupons or the default 18 percent tax; make them explicit setup inputs. Seeding must be tenant-agnostic (platform-level rows) so it works under RLS.

### TW-INST-014 — Install sub-step 4: create super-admin, first workspace and owner pivot

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-INST-013
- **Summary:** Creates (or updates) the admin user from the wizard, grants the `Super Admin` role, provisions a private workspace owned by that admin on the first plan, links them as owner, and makes it the admin's current workspace.
- **Actors & access:** Installer only.
- **UX & screens:** Row 4 ("Admin + workspace ready").
- **Endpoints:**

  | METHOD uri                    | route name      | Controller@action                            | middleware | request fields | response/redirect               |
  | ----------------------------- | --------------- | -------------------------------------------- | ---------- | -------------- | ------------------------------- |
  | POST install/execute (step=4) | install.execute | InstallController@execute -> stepCreateAdmin | web        | `step=4`       | `{success:true}` or generic 500 |

- **Data:** `users`: `updateOrCreate` keyed by `email` with `name`, `password` (bcrypt via `Hash::make`; `BCRYPT_ROUNDS` from env), `role='admin'` (legacy column, default in schema is `user`), `email_verified_at=now()` (so no verification mail is needed); other columns keep schema defaults (e.g. `theme_preference=paper`, `wallet_currency_code=INR` default, `locale` null). Spatie: `syncRoles(['Super Admin'])` (wrapped in try/catch, silent if the role is missing). `workspaces`: `firstOrCreate` keyed by `slug = Str::slug(workspace_name) . '-' . lowercase random 4 chars` with `owner_user_id`, `name`, `plan` (id of the lowest `packages.sort_order` row, stored as the numeric id string), `timezone`, `locale`, `currency='USD'`, `status=true`, `last_active_at=now()`. `workspace_user`: insert (`role='owner'`, timestamps) if no row for the pair. Finally `users.current_workspace_id` set to the new workspace (`forceFill` + save).
- **Rules & edge cases:**
  1. QUIRK: the workspace slug embeds a random suffix and is the lookup key, so `firstOrCreate` never finds the previous workspace; a retry or a page reload of the run screen after this step creates an additional workspace for the same admin and repoints `current_workspace_id` to it (the earlier one stays owned by the user).
  2. The user upsert by email means re-running with a different password silently resets the password of an existing account with that email (no check that it is a fresh install).
  3. `users.role='admin'` and the Spatie role are both set; `isAdmin()` accepts either `Super Admin`/`Admin` role or `role in ('admin','A')`.
  4. `workspaces.plan` normally holds the string `plan_id` (e.g. `starter`); the installer stores the numeric package id instead. `Workspace::package()` tolerates it by falling back to `Package::find(id)`, so features resolve, but reports that group by `plan` string see a numeric value.
  5. If the packages table were empty the code would pass `plan => null` explicitly; the column is NOT NULL (default `starter`), so the insert would most likely error. Not reachable in practice because step 3 always seeds four packages first (unverified edge; listed in Open questions).
  6. `workspace_user` insert is wrapped in try/catch (may not exist on stale schemas); failures are swallowed.
  7. No default `workspace_id`-scoped data, no devices, no trial (`trial_ends_at` null), no onboarding email (`skip_onboarding_email` default 0 but no mail configured), no sample data (`pre_seed_sample_data` default 0).
  8. Only one admin and one workspace are created; more come from Admin -> Users / Workspaces.
- **Async & events:** none: no audit entry, no welcome email, no outbox.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given wizard data (name "Asha", email "asha@acme.io", workspace "Acme Support"), When step 4 runs, Then a user with that email exists with `role=admin`, verified email and the `Super Admin` role.
  - Given the same, Then a `workspaces` row named "Acme Support" with slug `acme-support-xxxx` exists owned by that user, plan pointing at the lowest-sort package, and a `workspace_user` row with role `owner`.
  - Given the user then logs in at `/login`, Then their `current_workspace_id` equals that workspace.
  - Given step 4 is executed twice, Then two workspaces exist (documented quirk) but the user row is unique.
- **Source refs:** app/Http/Controllers/InstallController.php (stepCreateAdmin); app/Models/User.php (isAdmin); app/Models/Workspace.php (package()); database/seeders/RolePermissionSeeder.php.
- **Port notes:** Map to bootstrapping the first platform admin + first `org` through the same service path as normal creation (audit + outbox in one transaction, RLS session GUCs set). Make it idempotent by a stable natural key (`org.slug` given, not random), and refuse if any platform admin already exists. Home: `apps/api/src/modules/admin/users` + a new bootstrap command.

### TW-INST-015 — Install sub-steps 5-6: storage link, recordings folder, finalize and lock

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-INST-014
- **Summary:** The last two sub-steps link public storage and create the call-recordings folder, then persist the verified purchase code, clear framework caches and write the `storage/installed` marker that permanently locks the wizard.
- **Actors & access:** Installer only.
- **UX & screens:** Rows 5 ("File permissions set - Linking storage and call-recording directories...") and 6 ("Installation finalized - Clearing caches and writing install marker..."). After row 6 the client redirects to `/login`.
- **Endpoints:**

  | METHOD uri                    | route name      | Controller@action                                | middleware | request fields | response/redirect                               |
  | ----------------------------- | --------------- | ------------------------------------------------ | ---------- | -------------- | ----------------------------------------------- |
  | POST install/execute (step=5) | install.execute | InstallController@execute -> stepFilePermissions | web        | `step=5`       | `{success:true}`                                |
  | POST install/execute (step=6) | install.execute | InstallController@execute -> stepFinalize        | web        | `step=6`       | `{success:true}`; sets session `install_step=7` |

- **Data:** Step 5: `Artisan storage:link` (failure swallowed: the symlink may already exist on shared hosting) and `mkdir public/uploads/call-recordings` (mode 0775, recursive, errors suppressed). Step 6: if the session holds `install_purchase_code`, writes `system_settings` `envato_purchase_code` (string) and `envato_verified_at` (ISO 8601, string) inside try/catch; runs `config:clear`, `route:clear`, `view:clear` (each in try/catch); writes `storage/installed` as pretty JSON `{installed_at, version:"1.0.0", admin_email, app_url}`; sets session `install_step=7` and `install_complete` = {email, url, workspace} (never read by any code); forgets session keys `db`, `admin_data`, `node`. Keys `app`, `install_purchase_ok`, `install_purchase_code` remain in the file session.
- **Rules & edge cases:**
  1. The marker is written last, so a failure earlier leaves the wizard re-runnable. The moment the marker exists, `EnsureInstalled` redirects every `/install*` request to `/` and the app starts using DB sessions (from the new `.env`), so the wizard session is abandoned.
  2. QUIRK: the marker's `version` is hard-coded `1.0.0`, unrelated to `config('version.version')`; nothing reads the marker's content, only its existence.
  3. Persisting the purchase code is best-effort and silent; failure means the Updater shows unverified, but since updater verification is bypassed (TW-INST-020) any code is accepted later.
  4. `config:cache` / `route:cache` are never run; `config:clear` prevents a stale cached config from masking the new `.env`.
  5. `public/uploads/call-recordings` is created even when calling is unused; permissions failures are silent.
  6. The `install_complete` payload and the removed `/install/complete` page are vestiges.
  7. Redirect target `/login` is hard-coded in the run screen.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** writes `system_settings.envato_purchase_code`, `system_settings.envato_verified_at`.
- **Acceptance criteria:**
  - Given steps 1-5 succeeded, When step 6 runs, Then `storage/installed` exists containing JSON with `admin_email` and `app_url`, and `/install` now redirects to `/`.
  - Given a verified code in the session, When step 6 runs, Then `system_settings` has `envato_purchase_code` and `envato_verified_at`.
  - Given `storage:link` fails because the link exists, When step 5 runs, Then the step still reports success.
  - Given step 6 fails before the marker is written, When the user retries, Then the wizard can complete without re-entering data (session retained).
- **Source refs:** app/Http/Controllers/InstallController.php (stepFilePermissions, stepFinalize); app/Http/Middleware/EnsureInstalled.php; Documentation/pages/installation/troubleshooting.html ("Site keeps redirecting to /install").
- **Port notes:** "Finalize" becomes: write a `platform_setup_completed_at` row (or seed a `setup` singleton) inside the same transaction as the org/admin creation, and reject the setup endpoint afterwards. No caches or symlinks to manage; recordings go to object storage (MinIO in `docker-compose.yml`), not `public/uploads`.

### TW-INST-016 — EnvWriter: keep .env in step with admin-set Node settings

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-INST-011
- **Summary:** A small helper that upserts a single `KEY=value` line in the project `.env`, used after install so admin-edited Node settings stay mirrored to the file that the Node process and CLI also read; the database value stays authoritative.
- **Actors & access:** Called from admin settings saves (super-admin via `AdminPagesController`, owned by SET/NODE). No permission keys of its own.
- **UX & screens:** none (silent). The admin "Providers"/System message settings pages that call it are documented in SET/NODE.
- **Endpoints:** none of its own. Callers (for reference): `AdminPagesController` lines around the providers save and the system-message-settings save call `EnvWriter::set('SERVER_URL', ...)` and `EnvWriter::set('NODE_WEBHOOK_TOKEN', ...)`.
- **Data:** File `.env`. `set(key, value)` returns bool: false (never throws) when `.env` is missing/not writable/unreadable or on any exception. Existing `^KEY=.*` line replaced (via callback so `$`/`\` in values are literal), otherwise appended after trimming trailing newlines with a final newline. Values are quoted only when they contain whitespace, `#`, quotes or backslash (backslash and quote escaped).
- **Rules & edge cases:**
  1. Database is source of truth (`node_token()` / `tw_node_url()` read the DB setting first, `.env` as fallback) so a failed write does not break the app.
  2. env values already loaded in the current request are not refreshed; the file change is picked up on the next request or by external processes.
  3. Empty value writes `KEY=` (clears).
  4. No locking: concurrent admin saves can interleave and lose a write.
  5. Same quoting rule as the installer's `quoteForEnv` (duplicated code).
- **Async & events:** none.
- **External systems:** local filesystem.
- **Settings:** `.env` `SERVER_URL`, `NODE_WEBHOOK_TOKEN`.
- **Acceptance criteria:**
  - Given `.env` has `SERVER_URL=http://a`, When `EnvWriter::set('SERVER_URL','http://b')` runs, Then exactly that line is replaced and other lines are unchanged.
  - Given the key is absent, When set, Then the line is appended once with a trailing newline.
  - Given `.env` is read-only, When set, Then it returns false without exception and the DB value still applies.
  - Given a value with a space, When set, Then it is written double-quoted.
- **Source refs:** app/Support/EnvWriter.php; app/Http/Controllers/AdminPagesController.php (callers); app/Support/fc_helpers.php (node URL/token resolution).
- **Port notes:** Not needed; secrets rotate through an admin settings table/secret store, and the API and Node bridge read the same source. If the bridge must receive changed secrets, push them via an authenticated admin call or restart hook (NODE domain), not by editing files.

### TW-INST-017 — Encrypted Envato licence material (Licence support class)

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** none
- **Summary:** The Envato author token used to verify purchase codes ships inside the product, encrypted and MAC-protected in `config/license.json`, and is decrypted only at the moment of verification so a cached config never holds it in plaintext.
- **Actors & access:** Internal (installer and Updater code). No user-facing access.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** `config/license.json` keys: `item_id` (63755235), `alg` (aes-256-cbc), `data` (base64: 16-byte IV followed by ciphertext), `mac` (base64 HMAC-SHA256). `config/license.php` returns only `item_id`. `config/version.php` exposes `version.envato.item_id` (from license.php); the token is deliberately NOT in config.
- **Rules & edge cases:**
  1. Key = SHA-256 of a fixed passphrase constant in `Licence` (shipped in source). MAC = HMAC-SHA256 over `iv || ciphertext || item_id` with the same key; verified with `hash_equals` BEFORE decryption; a blob copied onto another item id fails closed (empty token).
  2. Missing/invalid/tampered file or a payload of <= 16 bytes returns an empty token; `configured()` is false and the installer shows "missing Envato token". Item id falls back to constant 63755235 when the file is unreadable.
  3. Result is memoised per PHP process only (static), never written to cache or disk.
  4. Rationale documented in code: `config:cache` var_exports resolved config, so a decrypted token in config would be written to `bootstrap/cache/config.php` in plaintext.
  5. QUIRK (acknowledged in the source): because the decrypt key ships with the ciphertext this is obfuscation, not secrecy; any buyer can recover the author token. The comment recommends verifying through a hosted licence endpoint instead.
  6. `ExtensionService` protects `config/license.php`, `config/license.json` and `config/version.php` from being overwritten by add-on ZIPs.
- **Async & events:** none.
- **External systems:** none directly (feeds Envato calls in TW-INST-003).
- **Settings:** none.
- **Acceptance criteria:**
  - Given an intact `license.json`, When `Licence::token()` is called, Then a non-empty token is returned and `Licence::itemId()` is `63755235`.
  - Given a single flipped bit in `data` or `mac`, When called, Then the token is an empty string and `configured()` is false.
  - Given `config:cache` has run, When `bootstrap/cache/config.php` is inspected, Then it contains the item id but no token.
- **Source refs:** app/Support/Licence.php; config/license.php; config/license.json; config/version.php; app/Services/ExtensionService.php (protected paths).
- **Port notes:** Do not port. If any online licence is later required, host verification in our own service so no secret ships to customers (per the source's own recommendation).

### TW-INST-018 — Post-install and hosting guidance (requirements, Node service, cPanel, troubleshooting)

- **Status:** docs-only
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-INST-015
- **Summary:** The documentation set tells the operator what a host must provide and what to do after the wizard: raise limits, run the Node bridge under a process manager, configure AI keys, payment gateways, branding, SMTP and connect the first channel. None of this is enforced by code; it is the operational contract the software assumes.
- **Actors & access:** Operator / super-admin. No code path.
- **UX & screens:** Documentation pages only (`installation/web-installer`, `server-requirements`, `post-install`, `troubleshooting`; `faqs/installation`, `faqs/errors-solutions`).
- **Endpoints:** none.
- **Data:** none.
- **Rules & edge cases:** Facts worth carrying into the new stack's ops docs:
  1. Deployment shape: upload the `Threadwise/` folder contents to the web root; serve from `public/` (or add a root `.htaccess` rewrite); a fresh upload loads at `/public` and `APP_URL` must match the real address; Cloudflare SSL should be Full/Full(Strict). The download package has four folders: `Reference` (app), `Database` (only the 1.0 -> 1.1 upgrade SQL), `Documentation`, `Update` (per-release update ZIPs).
  2. Hosting minimums: PHP 8.2+ (8.3/8.4 recommended), MySQL 8.0+ or MariaDB 10.6+, Composer 2, Node 18+ (20 recommended), npm 9+, 1 GB RAM (2 GB+ recommended), 2 GB free disk, HTTPS required for production (Meta and Twilio only call HTTPS webhooks). Recommended php.ini: `memory_limit=256M`, `max_execution_time=300`, `max_input_time=300`, `upload_max_filesize=64M`, `post_max_size=64M`; nginx `client_max_body_size 64M`.
  3. Runtime model: database-backed session, cache and queue (no Redis, no mandatory `queue:work`, no mandatory cron); the Node bridge carries sending and its own scheduler for broadcasts/campaigns/scheduled sends on every engine, so it must always run (PM2 / systemd / Supervisor, or cPanel/Plesk "Setup Node.js App" with `app.cjs` as startup file after renaming `index.js` -> `index-old.js` and `index-cpanel.js` -> `index.js`; Hostinger uses `server.cjs`). Housekeeping (SLA escalation, snooze wake-ups, template status refresh) runs opportunistically while an operator has the Team Inbox open; optional cron for `inbox:escalate`, `inbox:wake-snoozed`.
  4. Post-install to-do: log in at `/login` as the admin, enable 2FA, set the Node server URL under Admin -> Settings -> Providers if blank, add AI keys (Admin -> API Keys), enable payment gateways (Admin -> Payment Gateways) and plans, set branding (Admin -> Settings -> General), configure SMTP, connect a channel on Devices (QR pairing needs the Node URL and a running bridge).
  5. Troubleshooting map: 419 on install = `.env`/root not writable so no `APP_KEY`; "No application encryption key" = missing/blank `APP_KEY`; "Could not find driver" = `pdo_mysql` disabled; "Class ZipArchive not found" / "curl_init" = extensions `zip` / `curl` disabled; stuck redirect to `/install` = missing `storage/installed`; blank 500 = stale config or permissions (run `php artisan optimize:clear`); missing styles = `public/build` not deployed; QR fails = Node URL unset or bridge down; Cloud API/Twilio inbound = HTTPS + verify token at `/webhooks/whatsapp/inbound`.
  6. Docs vs code: docs claim the wizard "locks itself"; true only via the marker file. Docs state a queue worker is not required yet the installation FAQ lists a queue worker as a requirement (contradiction). Docs say the whole wizard needs no CLI, but the Node bridge (`npm install`, start) always does.
  7. Demo limitations page (see TW-INST-029) is also part of this documentation set.
- **Async & events:** none.
- **External systems:** hosting control panels; PM2/systemd.
- **Settings:** php.ini/nginx values above; `APP_URL`, `SERVER_URL`, `NODE_WEBHOOK_TOKEN`.
- **Acceptance criteria:**
  - Given a docker-compose deployment of the new stack, When an operator follows the ported ops guide, Then the API, worker, Postgres, Redis and Node bridge all report healthy on the health endpoint without editing files by hand.
  - Given the bridge secret differs between api and bridge, When the stack boots, Then a clear startup error or health failure names the mismatch (Reference only logs 401/403 in the bridge heartbeat).
  - Given a missing required env var, When the API boots, Then it exits with an actionable validation error (Reference silently produced 500s).
- **Source refs:** Documentation/pages/installation/web-installer.html; Documentation/pages/installation/server-requirements.html; Documentation/pages/installation/post-install.html; Documentation/pages/installation/troubleshooting.html; Documentation/pages/faqs/installation.html; Documentation/pages/faqs/errors-solutions.html.
- **Port notes:** Feed into the deployment runbook for single-VM deploy plan (single VM, docker compose): health/readiness endpoint, env validation, secret sharing with the Node bridge, background scheduler ownership. Nothing to build as a product feature.

### TW-INST-019 — Admin Updater screen and client-side step orchestration

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** TW-INST-020
- **Summary:** One admin page walks the platform operator through licence verification, backup, package upload, apply, migrate and finalize, and lists earlier backups with a rollback button. A vanilla-JS controller drives the sequence and gates each button on the previous step.
- **Actors & access:** Platform admins only. Route group `/admin/*` uses middleware `Authenticate`, `EnsureUserIsAdmin` (403 "Admins only." unless the user has Spatie role `Super Admin` or `Admin`, or legacy `users.role` in `admin`/`A`) and `IPAllowlist` (403 for IPs outside `security.ip_allowlist_cidrs` when `security.ip_allowlist_enabled` is on; an enabled-but-empty list fails open). QUIRK: docs and the controller comment say only the Super Admin can update, but no extra Super Admin check exists. No plan gates. Reachable from a button "Updater" on the Admin -> Settings page header (next to "Add-ons", "Legal pages", "General").
- **UX & screens:** `resources/views/admin/update/index.blade.php` (layout `x-layouts.admin`, page key `settings-updater`): breadcrumb Admin > Settings > Updater; hero "Application updater" with copy ("Verify your purchase, take a full backup, upload a new version ZIP and run migrations - your .env, database, storage and uploaded images are never touched"); chips `v<version> - build <n>` and "All settings" link; flash component; a hidden result banner (green/red, used for finalize/rollback outcomes). Card "step 1 - licence / Verify your purchase" with a text input (prefilled with a masked placeholder value of bullets when a code is already stored) and a Verify button. Card "update process / Run each step in order" (locked when unverified) with five step cards, each with a numbered badge (2..6), title, description, button and a hidden message line: (1) "Backup files & database - Full backup of code + database before any change" [Start backup]; (2) "Upload update ZIP - Choose the update package (.zip). Its version is verified automatically" [Choose ZIP, hidden file input `accept=.zip`]; (3) "Apply update - Extracts and overwrites code only" [Apply]; (4) "Run migrations - Adds any new tables/columns. Never removes your data" [Migrate]; (5) "Finalize & health check - Clears caches and verifies everything is healthy" [Finalize, primary style] with a hidden 2-column health grid ("OK - database", "FAIL - env file", ...). Card "safety net / Rollback" only when at least one backup exists: rows show `v<version>` and `d M Y, H:i` with a red Rollback button. Client script `public/js/admin-updater.js` (cache-busted with `?v=<build>`) reads `window.WD_UPDATER` (csrf token, verified flag, 8 route URLs).
- **Endpoints:**

  | METHOD uri       | route name         | Controller@action            | middleware                                   | request fields | response/redirect                                                                                                                                                  |
  | ---------------- | ------------------ | ---------------------------- | -------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | GET admin/update | admin.update.index | Admin\UpdateController@index | Authenticate, EnsureUserIsAdmin, IPAllowlist | none           | view with `currentVersion` (config `version.version`, default `1.0.0`), `currentBuild` (int), `backups` (list), `verified` (bool of stored `envato_purchase_code`) |

  (The other seven routes are detailed in TW-INST-020..026.)

- **Data:** Reads `system_settings.envato_purchase_code`, `config/version.php`, backup folders (TW-INST-026). Client state: `{verified, done, busy}`.
- **Rules & edge cases:**
  1. Gating is client-side only. A step button is enabled when `verified && done >= n-1 && !busy`; disabled buttons get 40 percent opacity and `pointer-events: none`. Only one step may run at a time (`busy`). `done` is the highest completed step index (step 0 = verify, 2 = upload...).
  2. QUIRK: state is not persisted; after any page reload `done` is 0 (step 0 is shown done if a code is stored), so after a reload Migrate/Finalize stay locked until Backup, Upload and Apply are repeated in the browser even if the server-side apply already succeeded (the operator must call the endpoints another way or redo the steps). The apply-poll message tells users to "reload this page" on timeout, which triggers this.
  3. Server does not enforce ordering: backup, upload, migrate, finalize can be called in any order (apply requires the uploaded ZIP to exist).
  4. QUIRK: the masked value is a real input value (bullet characters), not a placeholder; clicking Verify while it starts with a bullet shows "Enter your purchase code" client-side.
  5. Errors are shown in the step's own message line (green success / red failure). Fallback messages: "Step failed.", "Network error - try again.", "Verification failed.", "Done." / "Uploaded." / "Rolled back.".
  6. Health results render as "OK - <key with underscores as spaces>" (green) or "FAIL - ..." (red); the finalize banner shows the response message.
  7. Rollback is armed by the first click (button turns red "Confirm rollback?" for 4 s) and executed by a second click within that window; after success the page reloads after about 1.3 s.
  8. Documentation surrounding this page: raise `upload_max_filesize`/`post_max_size` to >= 64M, restart PHP-FPM; restart Node after every update (the updater never restarts Node); clear view cache; redo cPanel `index.js` rename (TW-INST-028).
- **Async & events:** the Apply step polls a status endpoint (TW-INST-023). No websockets.
- **External systems:** none.
- **Settings:** none on this page besides the IP allowlist and admin role.
- **Acceptance criteria:**
  - Given a logged-in Super Admin, When `/admin/update` loads with a stored purchase code, Then the version chip, the five step cards (enabled from step 1), and the masked code field are shown.
  - Given no stored code, When the page loads, Then the step section is locked and only Verify is active.
  - Given a non-admin user, When `/admin/update` is requested, Then the response is HTTP 403.
  - Given an IP outside the allowlist, When an admin requests the page, Then a 403 "ip-blocked" view names the IP and an audit row `admin.access.blocked_by_ip` is written.
  - Given two backups exist, When the page loads, Then the Rollback section lists both newest first.
- **Source refs:** app/Http/Controllers/Admin/UpdateController.php (index); resources/views/admin/update/index.blade.php; public/js/admin-updater.js; routes/admin.php (update group); app/Http/Middleware/EnsureUserIsAdmin.php; app/Http/Middleware/IPAllowlist.php; resources/views/admin/settings/index.blade.php (link); Documentation/pages/update-details/update-process.html.
- **Port notes:** A UI updater has no meaning for containerized deploys (updates = new image + migrator). If operators still want a "System" page, build a read-only `admin` page showing version/build, migration status (`pnpm db:status` equivalent) and health, in `apps/web/app/(admin)/system`. Any mutating ops must be RBAC-gated by a specific permission key (Reference has none: register e.g. `platform.system.manage` via the rbac-permission skill), not a role-name check.

### TW-INST-020 — Updater step 0: purchase verification (bypassed)

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-INST-017
- **Summary:** The first Updater step asks for the CodeCanyon purchase code and stores it as verified. In this build the Envato round-trip has been removed: any non-empty code is accepted and saved.
- **Actors & access:** Platform admins (same middleware as TW-INST-019). Also reused by the add-on installer (`ExtensionController` verify/upload calls the same method through `ExtensionService`).
- **UX & screens:** Step-0 card (see TW-INST-019). Progress text "Verifying with Envato..." shown while the request runs; success text "Purchase verified - you can proceed." (green) and the badge turns to a check; on failure "Verification failed." (red).
- **Endpoints:**

  | METHOD uri               | route name          | Controller@action             | middleware                                                             | request fields                                 | response/redirect                                                                     |
  | ------------------------ | ------------------- | ----------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------- |
  | POST admin/update/verify | admin.update.verify | Admin\UpdateController@verify | Authenticate, EnsureUserIsAdmin, IPAllowlist (+ CSRF via X-CSRF-TOKEN) | JSON `purchase_code` required, string, max 120 | JSON `{success, message, buyer}`; HTTP 200 on ok, 422 when not ok (never happens now) |

- **Data:** `system_settings` upsert: `envato_purchase_code` = trimmed code (type string, stored in plaintext; the key is not in `SystemSetting::ENCRYPTED_KEYS`), `envato_verified_at` = ISO-8601 now (string). Response `buyer` is always empty; `item` (Envato item id from config, `63755235`) is only put in the audit meta. Audit: `Audit::log('admin.updater.verify', result success|failure, meta {item})` (via `AuditLogger`, owned by NOTIF).
- **Rules & edge cases:**
  1. QUIRK: `UpdaterService::verifyPurchase` states in a comment that licence verification is intentionally bypassed "by vendor decision": it always succeeds (even for a blank code at service level; the controller still requires a non-empty string), performs no HTTP call, and always overwrites the stored code and timestamp.
  2. The installer, in contrast, really verifies against Envato (TW-INST-003). Docs claim the Updater "validates it with Envato before allowing an update": docs-only.
  3. `verified` on the page = stored code is truthy; there is no expiry, re-verification schedule or binding to domain.
  4. Because ordering is client-side only, the server does not require a prior verification for backup/upload/apply/migrate/finalize/rollback.
  5. `ExtensionController::upload` re-checks with the same method, so add-on installs are equally unprotected.
- **Async & events:** audit log entry `admin.updater.verify`.
- **External systems:** none now. (Original behavior called Envato's author sale API, same as TW-INST-003.)
- **Settings:** `system_settings.envato_purchase_code`, `envato_verified_at`; `config('version.envato.item_id')`.
- **Acceptance criteria:**
  - Given any non-empty string up to 120 chars, When posted, Then HTTP 200 with `success=true` and message "Purchase verified - you can proceed." is returned and both settings rows are written.
  - Given an empty `purchase_code`, When posted, Then a 422 validation error is returned.
  - Given a code longer than 120 chars, When posted, Then a 422 validation error is returned.
  - Given success, Then an audit row `admin.updater.verify` with result success exists.
- **Source refs:** app/Http/Controllers/Admin/UpdateController.php (verify); app/Services/UpdaterService.php (verifyPurchase); app/Models/SystemSetting.php; app/Http/Controllers/Admin/ExtensionController.php; app/Services/ExtensionService.php.
- **Port notes:** Do not port as a licence check. If a licence concept returns, implement it once behind an adapter and store the token encrypted (Reference keeps it in plaintext).

### TW-INST-021 — Updater step 1: full backup (code ZIP + database dump)

- **Status:** implemented
- **Priority:** P2
- **Effort:** L
- **Depends on:** TW-INST-019
- **Summary:** Creates a timestamped restore point containing a ZIP of the updatable code tree, a gzip-compressed SQL dump of the whole database, and a `rollback.json` descriptor, designed to work on memory-limited shared hosts.
- **Actors & access:** Platform admins (TW-INST-019 middleware). Needs write access to `storage/app/backups`.
- **UX & screens:** Step-1 card button "Start backup" (label becomes "..." then "Done"); message "Backup created successfully." (green) or "Backup failed: <reason>" (red).
- **Endpoints:**

  | METHOD uri               | route name          | Controller@action             | middleware                                   | request fields | response/redirect                                                                                                    |
  | ------------------------ | ------------------- | ----------------------------- | -------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------- |
  | POST admin/update/backup | admin.update.backup | Admin\UpdateController@backup | Authenticate, EnsureUserIsAdmin, IPAllowlist | none           | 200 `{success:true, message, backup:{code, database, dir}}`; 500 `{success:false, message:"Backup failed: <error>"}` |

- **Data:** Directory `storage/app/backups/v<currentVersion>_<Y-m-d_His>/` containing `code_backup.zip`, `database_backup.sql.gz` (MySQL; for SQLite a raw copy `database_backup.sql`; other drivers get a one-line "not supported" comment file) and `rollback.json` {version, created_at ISO-8601, code_backup path, db_backup path}. Audit: `admin.updater.backup` with meta `dir`.
- **Rules & edge cases:**
  1. Limits lifted for the request: `set_time_limit(0)`, `max_execution_time=0`, `memory_limit=1024M` (best effort). Breadcrumb logs `[UPDATER-BACKUP] ...` before each stage; a shutdown handler logs PHP fatals (memory/time) because they bypass the controller's catch. Failures caught by the controller are logged with error, file:line and peak memory.
  2. Code ZIP scope = the updatable paths only: `app`, `config`, `database/migrations`, `public/css`, `public/js`, `public/build`, `resources`, `routes`, `node`, plus files `bootstrap/app.php`, `bootstrap/providers.php`. NOT backed up: `.env`, `storage`, `vendor`, `lang`, `database/seeders`, `extension`, `public/uploads`, `addon/`.
  3. Skips (matched at any depth): `node_modules`, `vendor`, `.git`, `.github`, `tests`, `storage/framework/{cache,sessions,views}`, `storage/logs`, `storage/app/backups`, `storage/app/temp`; and any file named `.env`, `.env.*` or `.npmrc` (secrets). Hidden files are included on purpose (`public/build/.vite/manifest.json` must be captured or a rollback breaks the front end). QUIRK: `node/baileys_auth` (live WhatsApp login sessions) is NOT in the backup skip list even though the applier protects it, so a backup can contain WhatsApp session credentials and can be very large; a later rollback would extract those old session files over the current ones.
  4. ZIP is flushed and reopened every 400 files to keep open file descriptors bounded (ZipArchive holds one per added file; shared hosts kill PHP at the open-file limit).
  5. MySQL dump is pure PHP (mysqldump deliberately avoided): `SHOW TABLES`, per table `DROP TABLE IF EXISTS` + `SHOW CREATE TABLE`, then rows in `INSERT ... VALUES` batches of 200 rows, streamed to a gzip file (level 6); header `SET FOREIGN_KEY_CHECKS=0` and footer `=1`. Rows are read 1000 at a time by keyset pagination on the single-column primary key, or offset paging when a table has no single-column PK. Query log disabled to avoid memory growth. Values: NULL as `NULL`, everything else as a quoted string with backslash, NUL, newline, CR, quote and Ctrl-Z escaped so each statement stays on one physical line (required by the streaming restore).
  6. Tables dumped schema-only (rows skipped): `notifications`, `jobs`, `job_batches`, `failed_jobs`, `cache`, `cache_locks`, `sessions` (ephemeral or unbounded; one live install had 194,298 `notifications` rows that OOM'd a 512 MB host).
  7. Not captured: views, triggers, stored routines, user grants. Binary/bit columns are stringified.
  8. Backups are never pruned or downloadable from the UI; each run adds a folder (code ZIP can be tens of MB).
  9. Two operators running backup simultaneously create two folders (timestamp to the second); no lock.
- **Async & events:** synchronous request; audit `admin.updater.backup`.
- **External systems:** filesystem, database.
- **Settings:** PHP `memory_limit`, `max_execution_time`; hosts must allow ZipArchive and gzip (`zlib`).
- **Acceptance criteria:**
  - Given a healthy install, When "Start backup" runs, Then `storage/app/backups/v1.7.0_<timestamp>/` contains a code ZIP, a `.sql.gz` and `rollback.json`, and the response has `success=true`.
  - Given the code ZIP is listed, Then it contains `config/version.php` and `public/build/.vite/manifest.json` and contains no `.env`, `vendor/` or `node_modules/` entries.
  - Given the database has 200k `notifications` rows, When backup runs, Then the dump has the `CREATE TABLE` for `notifications` but zero inserted rows for it.
  - Given a text value containing a newline and a quote, When dumped and restored (TW-INST-026), Then it round-trips unchanged.
  - Given `storage/app/backups` is not writable, When backup runs, Then a 500 with a "Backup failed" message returns and the log shows `[UPDATER-BACKUP]`.
- **Source refs:** app/Http/Controllers/Admin/UpdateController.php (backup); app/Services/UpdaterService.php (createBackup, zipCodeFiles, dumpDatabase, dumpDatabasePhp, writeTableRows, primaryKeyColumn, logFatalsForUpdater, BACKUP_SKIP_DIRS, BACKUP_SKIP_ROWS); Documentation/pages/update-details/update-process.html.
- **Port notes:** Replace with Postgres tooling (`pg_dump` on the VM, WAL/replica per single-VM deploy plan and replica and public-API design and object-storage backups; no PHP-level dump. Reuse the concept "schema always, rows skipped for ephemeral tables" for outbox/jobs tables. Never include secrets in code snapshots.

### TW-INST-022 — Updater step 2: upload and validate the update ZIP

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** TW-INST-019
- **Summary:** The admin uploads the release ZIP; the server stores it at a fixed temp path, reads the version from `config/version.php` inside it, and accepts it only if that version is newer than the installed one. It also produces precise diagnostics when server upload limits swallow the file.
- **Actors & access:** Platform admins (TW-INST-019 middleware).
- **UX & screens:** Step-2 card with a label-button "Choose ZIP" (`accept=.zip`); text becomes "Uploading...", then "Uploaded" and message "Update package v<ver> ready to install." On failure the button resets to "Choose ZIP" and a specific message shows (see rules 3-4). The file input is cleared after each attempt.
- **Endpoints:**

  | METHOD uri               | route name          | Controller@action             | middleware                                   | request fields                                                      | response/redirect                                                                                                                                                                                      |
  | ------------------------ | ------------------- | ----------------------------- | -------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | POST admin/update/upload | admin.update.upload | Admin\UpdateController@upload | Authenticate, EnsureUserIsAdmin, IPAllowlist | multipart `file` required, file, mimes zip, max 512000 KB (~500 MB) | 200 `{success:true, message, zip_version}`; 413 body-dropped-by-PHP message; 422 invalid-upload / no version / not newer / Laravel validation; 500 `{success:false, message:"Upload failed: <error>"}` |

- **Data:** File `storage/app/temp/updater/update.zip` (directory created 0755; a previous ZIP is overwritten). No DB writes and no audit entry for upload (QUIRK: apply/verify/backup/migrate/finalize/rollback are audited, upload is not).
- **Rules & edge cases:**
  1. Every request logs `[UPDATER-UPLOAD] received` with ip, user id, CONTENT_LENGTH, client name/size/mime, `$_FILES` keys, and PHP limits (`post_max_size`, `upload_max_filesize`, `max_file_uploads`).
  2. Version extraction (`getZipVersion`): open the ZIP; candidates are `config/version.php` at the root, or (if within the first 50 entries a path `<wrapper>/config/version.php` appears) that wrapper path; first candidate that exists is read and the first `'version' => '<x>'` match is the version. Null -> 422 "Invalid update package - no version info found (config/version.php missing in ZIP)" and the temp dir is deleted.
  3. Body-dropped case: if CONTENT_LENGTH > 0 but `$_FILES` is empty and no file object arrived, PHP discarded the body because it exceeded `post_max_size`; the server returns 413 with the real numbers and the fix (raise `post_max_size` and `upload_max_filesize` to 64M, nginx `client_max_body_size 64M`, restart php-fpm, reload nginx). A file present but invalid returns 422 "Upload did not complete: <PHP error> Check PHP upload_max_filesize / post_max_size (raise to 64M)".
  4. Client-side message mapping: HTTP 413 (nginx rejected), 419 (session expired, refresh), 500 (check `laravel.log`), status 0 or network cut ("the server closed the connection, almost always the upload size limit"), and body messages matching "file field is required / larger than / upload_max / post_max / exceeds" get an extra "raise limits to 64M" sentence.
  5. Version rule: `version_compare(zip, current, '<=')` -> reject with "ZIP contains v<zip> but you already have v<current>. Upload a newer version." and delete the temp dir. Only the `version` string matters: `build` is ignored (and is not monotonic across releases, TW-INST-027). Any newer version is accepted, including skipping releases; docs claim updates are strictly sequential.
  6. Validation `mimes:zip` (extension/mime sniff) and 500 MB cap; real release ZIPs are 7.7-9.8 MB (docs advise >= 64 MB limits and note the ZIP is larger than default PHP limits).
  7. The upload does not check that the ZIP is a Reference package beyond `config/version.php` (no signature, checksum, or licence binding): any ZIP with that file and a higher version passes.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** PHP `post_max_size`, `upload_max_filesize`, `max_file_uploads`; web server body limit.
- **Acceptance criteria:**
  - Given a valid `update_1.7.zip` and an installed 1.6.0, When uploaded, Then 200 with `zip_version=1.7.0` and the file exists at `storage/app/temp/updater/update.zip`.
  - Given the same ZIP while 1.7.0 is installed, When uploaded, Then 422 "already have v1.7.0" and the temp dir is removed.
  - Given a non-ZIP file, When uploaded, Then a Laravel validation 422 is returned.
  - Given a ZIP larger than `post_max_size`, When uploaded, Then HTTP 413 with the concrete limits is returned.
  - Given a ZIP without `config/version.php`, When uploaded, Then 422 "no version info found".
- **Source refs:** app/Http/Controllers/Admin/UpdateController.php (upload); app/Services/UpdaterService.php (saveUploadedZip, getZipVersion, cleanup); public/js/admin-updater.js (uploadErrorMessage); Documentation/pages/update-details/update-process.html (upload limits red box).
- **Port notes:** Not needed on the new stack. If ever needed, do a direct-to-storage presigned upload to avoid PHP-style body limits and checksum-verify the artifact.

### TW-INST-023 — Updater step 3: apply update files with status polling

- **Status:** implemented
- **Priority:** P2
- **Effort:** L
- **Depends on:** TW-INST-022
- **Summary:** Extracts the uploaded ZIP to a staging folder and overwrites only code paths of the live install, never touching `.env`, storage, vendor, node modules, WhatsApp sessions or user uploads. Because copying ~1,700-2,300 files can outlast proxy timeouts, the work continues after the browser disconnects and the UI polls a status file for the true result.
- **Actors & access:** Platform admins (TW-INST-019 middleware).
- **UX & screens:** Step-3 card "Apply". While polling the label reads "Finishing..." and the message "Applying on the server - this can take a minute on shared hosting. Waiting for it to finish...". Success message "Files updated successfully." Timeout messages: "Apply is taking unusually long. Check storage/logs/laravel.log for [UPDATER-APPLY] complete, then reload this page." or "Could not confirm apply status. Reload the page and check the version."
- **Endpoints:**

  | METHOD uri                    | route name                | Controller@action                  | middleware                                   | request fields | response/redirect                                                                                                                                                                                                |
  | ----------------------------- | ------------------------- | ---------------------------------- | -------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | POST admin/update/apply       | admin.update.apply        | Admin\UpdateController@apply       | Authenticate, EnsureUserIsAdmin, IPAllowlist | none           | 200 `{success:true, message:"Files updated successfully.", updated:[paths]}`; 400 `{success:false, message:"No update ZIP found. Please upload first."}`; 500 `{success:false, message:"Apply failed: <error>"}` |
  | GET admin/update/apply-status | admin.update.apply-status | Admin\UpdateController@applyStatus | same                                         | none           | 200 `{success:true, status: null                                                                                                                                                                                 | {phase:'running' | 'done', started_at | finished_at, updated_count, files_skipped, version}, done: bool}` |

- **Data:** Reads `storage/app/temp/updater/update.zip`; writes staging `storage/app/temp/updater/staging/`, marker `storage/app/temp/updater/.staging_extracted_from` (`<filesize>-<mtime>`), status file `apply.status.json`; overwrites live code. Audit `admin.updater.apply` with meta `paths` (the list of updated top-level paths).
- **Rules & edge cases:**
  1. Request limits lifted (`set_time_limit(0)`, `memory_limit=1024M`, `ignore_user_abort(true)`) so the copy finishes even if the browser/proxy drops. Fatal errors are logged by a shutdown handler `[UPDATER-APPLY] FATAL`.
  2. Extraction reuse: if the staging folder exists and the marker equals the current ZIP's size-mtime stamp, extraction is skipped (a retry of a ~37 s extract on shared hosting would otherwise recur on every click). Else staging is deleted and the ZIP extracted; failures throw "Cannot open update ZIP (error <code>)" or "Failed to extract ... (disk space / permissions?)".
  3. If staging contains exactly one directory and no files (wrapper folder), that directory becomes the source root.
  4. Updatable paths (whole trees copied file by file, overwriting): `app`, `config`, `database/migrations`, `public/css`, `public/js`, `public/build`, `resources`, `routes`, `node`, and the individual files `bootstrap/app.php`, `bootstrap/providers.php`. Additionally `composer.json`, `composer.lock`, `.env.example` are copied when present, and `config/version.php` is copied last so the version flips at the end. A listed path that does not exist in the ZIP is skipped and counted.
  5. `database/migrations` uses merge semantics: only files that do not already exist locally are added; existing migration files are never overwritten (and none is ever deleted).
  6. Protected paths (never overwritten): `.env`, `storage`, `database/database.sqlite`, `vendor`, `node_modules`, `node/.env`, `node/node_modules`, `node/baileys_auth` (prefix match). Regenerable trees (`node_modules`, `vendor`, `.git`, `.github`, `tests`, `storage/framework/*`, `storage/logs`, `storage/app/backups`, `storage/app/temp`) are skipped at any depth. Dotfiles inside copied trees ARE copied (Vite `.vite/manifest.json`). A protected-extension rule exists for `public/` files outside css/js/build (images, documents, media, archives, fonts) but is effectively unused because only css/js/build are copied from `public/`.
  7. Resilience: a source file that is unreadable, a broken symlink, or whose `copy()` fails is skipped, logged as `copy SKIP` and reported in the `[UPDATER-APPLY] complete` log (first 50 listed) instead of aborting; only an exception at directory level aborts with "Update failed while copying <path>: <reason>" (leaving a half-applied tree).
  8. QUIRK: nothing is ever deleted. Files removed in a new release (e.g. the 1.4 release dropped the built-in Instagram migrations/files that moved to an add-on) remain on disk; stale controllers/views/route files can linger; a leftover file inside a directory that the app auto-loads (`routes/api/v1/*.php` is auto-loaded by `routes/api_v1.php`) would keep registering its routes.
  9. QUIRK: `lang/` (translation catalogs), `database/seeders`, `extension/` (browser extension), `google-sheets-addon/`, `addon/` and root files `package.json`, `artisan`, `vite.config.js` are not in the updatable list, so new translation strings and new seeder data in a release do not reach existing installs through the Updater (docs' manual path replaces `lang/`).
  10. QUIRK: `config/*` is overwritten wholesale (including `config/app.php`, `session.php`, `services.php`, `database.php`); local edits to config files are lost.
  11. QUIRK: `composer.json/lock` are replaced but `vendor/` is never updated and composer is never run. Releases 1.3, 1.5 and 1.6 add PHP packages (`league/flysystem-aws-s3-v3`; `minishlink/web-push`, `pusher/pusher-php-server`; `barryvdh/laravel-dompdf`) while the ZIPs contain no `vendor/` tree; docs say all PHP dependencies are pre-built and only rebuild "if the changelog says so".
  12. The status file is written `running` at start and `done` at the end; there is no `failed` phase, so a crash leaves `running` forever.
  13. Client behavior: any non-success response or network error for step 3 falls into polling (every 4 s, up to 45 tries = 3 minutes). QUIRK: because polling starts on every failure, an explicit server error message (for example "Apply failed: ...") is swallowed; the user sees the generic timeout text after 3 minutes unless the file says `done`.
  14. Node is never restarted; PHP OPcache is reset only at finalize.
- **Async & events:** long-running synchronous request that continues after client abort; status file polled by GET; audit `admin.updater.apply`.
- **External systems:** filesystem; ZipArchive.
- **Settings:** none (paths hard-coded in `UpdaterService` constants).
- **Acceptance criteria:**
  - Given an accepted `update_1.7.zip`, When Apply runs, Then `config/version.php` afterwards reads 1.7.0 and `.env`, `storage/`, `node/.env` and `node/baileys_auth/` are byte-identical to before.
  - Given the browser drops the connection mid-copy, When the poll endpoint is called after completion, Then `done=true` and `status.phase='done'` with `updated_count`.
  - Given no ZIP has been uploaded, When Apply is posted, Then HTTP 400 with the "upload first" message.
  - Given an existing migration file with local edits, When Apply runs, Then that file is unchanged and only new migration files are added.
  - Given a file present in the old install but absent in the ZIP, When Apply runs, Then the file is still present afterwards.
- **Source refs:** app/Http/Controllers/Admin/UpdateController.php (apply, applyStatus); app/Services/UpdaterService.php (applyUpdate, safeCopyDirectory, mergeMigrations, isProtected, isRegenerablePath, writeApplyStatus, readApplyStatus, UPDATABLE_PATHS, PROTECTED_PATHS, PROTECTED_PUBLIC_EXTENSIONS); public/js/admin-updater.js (pollApplyStatus); Update/update_1.2.zip ... update_1.7.zip (contents).
- **Port notes:** Not portable. If a deploy pipeline is later built, ship immutable images, run migrations, restart workers, and restart the Node bridge (Reference never does). The protected-paths idea maps to "never bake tenant data or secrets into images".

### TW-INST-024 — Updater step 4: run new migrations with resilient fallback

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** TW-INST-023
- **Summary:** Applies database changes shipped with the update. A fast path runs the normal migrate command; if it fails, a slower path applies pending migration files one by one and treats "already exists" style failures as already applied so a partially updated database can still be completed.
- **Actors & access:** Platform admins (TW-INST-019 middleware).
- **UX & screens:** Step-4 card "Migrate"; message "Migrations completed." on success, "Migration failed: <error>" on failure. The console output is returned to the client but not displayed.
- **Endpoints:**

  | METHOD uri                | route name           | Controller@action              | middleware                                   | request fields | response/redirect                                                                                                                        |
  | ------------------------- | -------------------- | ------------------------------ | -------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
  | POST admin/update/migrate | admin.update.migrate | Admin\UpdateController@migrate | Authenticate, EnsureUserIsAdmin, IPAllowlist | none           | 200 `{success:true, message:"Migrations completed.", output:<artisan text>}`; 500 `{success:false, message:"Migration failed: <error>"}` |

- **Data:** `migrations` table (Laravel's ledger). Audit `admin.updater.migrate` (success path only).
- **Rules & edge cases:**
  1. Fast path: `migrate --force`; on success returns the Artisan output.
  2. Fallback on any Throwable: log a warning, ensure the migrations repository table exists, read the list of already-run names and a single next batch number, then iterate `database/migrations/*.php` in glob (alphabetical = chronological) order; for each not yet recorded run `migrate --path=database/migrations/<file> --force`. If that throws an error whose message contains one of: "already exists", "duplicate column", "duplicate key name", "duplicate table", MySQL codes 1050, 1060, 1061 (case-insensitive), the migration is recorded in the ledger under the fixed batch and skipped ("skipped (already applied)"); any other error aborts with "Migration <name> failed: <message>". The returned text is a log of migrated/skipped names.
  3. Rationale in code: a brand-new migration whose schema change already exists (from a prior partial update, manual hotfix, or re-uploaded package) would otherwise abort the whole update.
  4. Time limit lifted (`set_time_limit(0)`). Migrations only ever move forward; there is no rollback command. Down-migrations are not used.
  5. The new migration files come from TW-INST-023 (merge, never overwrite), so migrations edited upstream after release are not re-applied.
  6. A dropped column/table in a migration is destructive by design; the docs promise "Never removes your data" but that is only true when migrations do not drop (for example 1.6 includes `drop_bsp_duplicate_wallet_tables`).
- **Async & events:** audit `admin.updater.migrate`.
- **External systems:** database.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 19 new migrations from a 1.6 -> 1.7 update, When Migrate runs, Then all 19 are recorded in `migrations` and the response is 200.
  - Given a new migration whose table already exists, When Migrate runs, Then the fast path fails, the fallback marks it applied and the rest run, and the overall response is 200.
  - Given a migration with a genuine SQL syntax error, When Migrate runs, Then a 500 with the migration name and error is returned and later migrations are not run.
  - Given nothing pending, When Migrate runs, Then it returns success quickly with "Nothing to migrate".
- **Source refs:** app/Http/Controllers/Admin/UpdateController.php (migrate); app/Services/UpdaterService.php (runMigrations, migrationAlreadyApplied); database/migrations (per-release deltas in TW-INST-027).
- **Port notes:** Covered by the checksum-tracked runner: never mark a failed file as applied; if idempotent re-runs are needed, write migrations with `IF NOT EXISTS`. Do not copy the "swallow already-exists" behaviour: it hides drift.

### TW-INST-025 — Updater step 5: finalize, clear caches and health check

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-INST-024
- **Summary:** Clears framework caches, runs a four-point health check, removes the temporary upload/staging files and reports whether the update ended healthy.
- **Actors & access:** Platform admins (TW-INST-019 middleware).
- **UX & screens:** Step-5 card "Finalize"; on completion a health grid (green "OK - database", "OK - env file", "OK - storage writable", "OK - uploads exist" or red FAIL rows) and the top banner shows the message ("Update completed successfully." or "Update done, but the health check raised warnings.").
- **Endpoints:**

  | METHOD uri                 | route name            | Controller@action               | middleware                                   | request fields | response/redirect                                                                                                                                                         |
  | -------------------------- | --------------------- | ------------------------------- | -------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | POST admin/update/finalize | admin.update.finalize | Admin\UpdateController@finalize | Authenticate, EnsureUserIsAdmin, IPAllowlist | none           | 200 `{success:<all healthy>, message, health:{database,env_file,storage_writable,uploads_exist}, new_version}`; 500 `{success:false, message:"Finalize failed: <error>"}` |

- **Data:** Health keys: `database` (PDO connection obtainable), `env_file` (`.env` exists), `storage_writable` (`storage/` writable), `uploads_exist` (`storage/app/public` is a directory). `new_version` = `config('version.version')`. Deletes `storage/app/temp/updater` (staging, ZIP, status file). Audit `admin.updater.finalize` with meta `health`.
- **Rules & edge cases:**
  1. Cache clearing: `config:clear`, `route:clear`, `view:clear`, plus `opcache_reset()` if available. Docs additionally tell operators to run `php artisan view:clear` for releases 1.4, 1.6 and 1.7, which the code already does (redundant instruction).
  2. `success` is false whenever any health check fails, yet the HTTP status stays 200; the UI treats `res.ok && body.success` as success, so a failed health check shows the step as failed with the "raised warnings" message while the update is in fact applied.
  3. QUIRK: `new_version` is read after `config:clear` in the same request; if the site had a cached config (docs recommend `config:cache`) that request still holds the old value, so the response can report the pre-update version even though `config/version.php` is new. The next request is correct.
  4. The health check does not verify the Node bridge, queues, migrations completeness or that the new version file matches the ZIP.
  5. Not done: `storage:link`, `queue:restart`, `config:cache`, Node restart (docs require operators to restart Node on every update, and to redo the cPanel `index.js` / `index-cpanel.js` rename).
  6. Finalize is also the only step that deletes temp files; abandoning an update after upload leaves the ZIP and staging (~30 MB + extracted tree) on disk until the next finalize or failed upload.
- **Async & events:** audit `admin.updater.finalize`.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a healthy install after Apply and Migrate, When Finalize runs, Then the response has `success=true` and all four health keys true, and `storage/app/temp/updater` no longer exists.
  - Given `.env` was removed, When Finalize runs, Then `health.env_file=false`, `success=false`, HTTP still 200, and the message mentions warnings.
  - Given the update changed `config/version.php` to 1.7.0, When the admin reloads `/admin/update` after Finalize, Then the chip shows v1.7.0.
- **Source refs:** app/Http/Controllers/Admin/UpdateController.php (finalize); app/Services/UpdaterService.php (clearCaches, healthCheck, cleanup); Documentation/pages/update-details/update-process.html.
- **Port notes:** Map to a `/health` + `/ready` endpoint (already present in `apps/api/src/health`) and a post-deploy smoke script. Add checks Reference lacks: bridge reachable and token-matched, worker heartbeat, pending migrations = 0.

### TW-INST-026 — Rollback to a previous backup and backup list

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** TW-INST-021
- **Summary:** Lists earlier backups (newest first) and restores code and database from any of them with a confirm-by-second-click.
- **Actors & access:** Platform admins (TW-INST-019 middleware).
- **UX & screens:** "Rollback" section of the Updater page (hidden when no backups). Button flow: click -> red "Confirm rollback?" (4 s) -> click -> "..." -> banner "Rollback completed. Version restored." and page reload after 1.3 s; on error the button resets and the banner shows the failure message.
- **Endpoints:**

  | METHOD uri                 | route name            | Controller@action               | middleware                                   | request fields                                                      | response/redirect                                                                                                                                                                       |
  | -------------------------- | --------------------- | ------------------------------- | -------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | POST admin/update/rollback | admin.update.rollback | Admin\UpdateController@rollback | Authenticate, EnsureUserIsAdmin, IPAllowlist | JSON `backup_dir` required string (absolute path shown in the list) | 200 `{success:true, message:"Rollback completed. Version restored."}`; 403 `{success:false, message:"Invalid backup path."}`; 500 `{success:false, message:"Rollback failed: <error>"}` |

- **Data:** Backup listing scans `storage/app/backups/*` directories that contain `rollback.json`, decodes it, adds `path`, sorts by `created_at` descending (string compare). Audit `admin.updater.rollback` with meta `dir`.
- **Rules & edge cases:**
  1. Path guard: `realpath(backup_dir)` must exist and start with `realpath(storage/app/backups)` (plain string prefix, so a sibling folder such as `backups-old` would also match); otherwise 403.
  2. Code restore: opens `code_backup` from `rollback.json` and extracts over the app root. Files created by the update are NOT removed; `vendor`, `.env`, `storage` are untouched (never in the ZIP). A ZIP that cannot be opened is silently skipped (still reports success).
  3. Database restore: streams the `.sql.gz` (or `.sql`) line by line and executes each one-line statement with `DB::unprepared`, skipping blank/comment lines only between statements; on error logs `[UPDATER-RESTORE]` with the first 160 chars of the statement and rethrows (partial restore possible; there is no transaction, and DDL auto-commits anyway). SQLite restores by copying the file; other drivers do nothing.
  4. QUIRK: tables whose rows were skipped at backup time (`notifications`, `jobs`, `job_batches`, `failed_jobs`, `cache`, `cache_locks`, `sessions`) are dropped and recreated EMPTY, so a rollback logs out every user including the admin (empty `sessions`), empties the notification feed and loses queued/failed jobs.
  5. QUIRK: tables created by the update's migrations are not in the backup, so they are not dropped; but the `migrations` table is restored to its pre-update rows, so re-running Migrate later hits "already exists" and relies on the TW-INST-024 fallback.
  6. Cache clear runs at the end (`config:clear`, `route:clear`, `view:clear`, opcache reset). The Node bridge is not restarted and its code was part of the restored ZIP, so a restart is needed.
  7. Nothing lists backup size, offers download, delete or pruning; disk use grows with each update.
  8. Restore sequence is not atomic and there is no maintenance mode during it.
- **Async & events:** audit `admin.updater.rollback`.
- **External systems:** filesystem, database.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a backup taken at v1.6.0 and an install now at v1.7.0, When Rollback is confirmed, Then `config/version.php` reads 1.6.0, data rows in ordinary tables match the backup, and the response is 200.
  - Given a `backup_dir` outside `storage/app/backups` (e.g. `/etc`), When posted, Then HTTP 403 "Invalid backup path."
  - Given a backup folder without `rollback.json`, When the page loads, Then it is not listed.
  - Given a completed rollback, When the admin's next request arrives, Then the session is invalid and login is required (sessions table emptied).
- **Source refs:** app/Http/Controllers/Admin/UpdateController.php (rollback); app/Services/UpdaterService.php (listBackups, rollback, restoreDatabase, gunzipTo); resources/views/admin/update/index.blade.php (rollback section); public/js/admin-updater.js (rollback handler).
- **Port notes:** Use Postgres PITR/`pg_restore` plus image rollback; never restore into a live multi-tenant DB without maintenance mode. If a UI exists, require an RBAC permission and a typed confirmation.

### TW-INST-027 — Release packaging and version registry (config/version.php, update ZIPs, Database/1.1.sql)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** none
- **Summary:** Reference's version identity lives in `config/version.php` and every release ships as a cumulative update ZIP containing the updatable code tree, plus one legacy SQL file for the 1.0 -> 1.1 jump. The Updater reads the version from the ZIP to decide if it is newer, and other features read the installed version.
- **Actors & access:** Product maintainers (build), super-admin (consumption). No routes.
- **UX & screens:** Version appears in the Updater chip (`v<version> - build <build>`), the user menu footer (Alpine `version` in `components/layouts/user.blade.php`, from `config('version.version')` falling back to `app.version`, default `1.0.0`), and add-on compatibility checks (`ExtensionService` compares `min_core` with `version.version`; `ExtensionController` passes `coreVersion` to its screen).
- **Endpoints:** none.
- **Data:** `config/version.php` returns `version` (string, `1.7.0`), `build` (int, `8`), and `envato.item_id` (from `config/license.php`). Release artifacts in the download package: `Threadwise/` (app), `Database/1.1.sql`, `Documentation/`, `Update/update_1.2.zip` ... `update_1.7.zip`.
- **Rules & edge cases:**
  1. Update ZIPs are full snapshots of the updatable trees for that release (not diffs): 1.2 (1,906 files, 7.7 MB), 1.3 (1,661; 7.9 MB), 1.4 (1,660; 8.1 MB), 1.5 (1,702; 8.4 MB), 1.6 (2,336; 9.7 MB), 1.7 (2,157; 9.8 MB). Top-level contents: `app`, `resources`, `database/migrations`, `public/{build,css,js}`, `node` (subset: controllers, services, utils, config, routes, `index.js`, `index-cpanel.js`, `app.cjs`, `server.cjs`, `package*.json`), `routes`, `config`, `composer.json`, `composer.lock`, `.env.example`, and (from 1.5) `bootstrap/app.php`, `bootstrap/providers.php`. No `vendor`, `lang`, `database/seeders`, `storage`.
  2. Versions inside the ZIPs (`config/version.php`): 1.2.0 build 3; 1.3.0 build 1; 1.4.0 build 4; 1.5.2 build 5 (the docs call it 1.5.0); 1.6.0 build 6; 1.7.0 build 8. QUIRK: `build` is not monotonic (1.3 has build 1 after 1.2's 3) and is only used for the asset cache-buster; comparison uses only `version` via `version_compare`.
  3. Migration files per release (cumulative counts in the ZIP): 1.2 = 241, 1.3 = 261 (+20), 1.4 = 267 (+17, -11), 1.5 = 277 (+10), 1.6 = 331 (+54), 1.7 = 350 (+19). Deltas: 1.3 adds Instagram tables (accounts, automations, messages, flow sessions, broadcasts, scheduled posts, reposter, recipients), `proxy_isolation` flag on packages, `contacts.mobile_hash`, `contact_tag` pivot, conversation pin/mute, extension API token expiry, flow templates; 1.4 removes the Instagram migrations from core (moved to an add-on) and adds billing period on orders, widget message backfill, Meta Ads advanced targeting, template header sample URL, WA group member unique scope, per-send template overrides, `wa_calls.recording_started_at`, `contacts.unsubscribed_at`, conversation contact digits, keyword catch-all, `extensions` table, auto-renew, `plan_usage`; 1.5 adds `workspace_ig_accounts`, insta-flow link on flows, `push_subscriptions`, campaign expiry, template code expiration, keyword welcome/away/out-of-hours, `packages.grants_json`, call-assistant device ids, IG keyword trigger; 1.6 (54 migrations) adds the BSP module tables and message charges, device tokens, merchant gateways, leads, Facebook, TikTok, Telegram, SMS plan columns, booking/appointment tables, invoices + tax + number sequences + settings, AI CRM actions, companies, payments, tasks, CRM briefs, projects, sales docs; 1.7 (19 migrations) adds LINE, WeChat, Viber, Email (workspace_email_accounts), flow retry logs, WABA groups, plan flags for those channels, campaign-contacts status index, knowledge assistant on AI agents.
  4. Release headlines (docs changelog): 1.0.0 (2026-05-29) initial release; 1.1.0 (06-19) sales pipeline/deals, coexistence onboarding, multi-engine, REST API + webhooks, Slack/Trello, add-on packages, data-retention wipe, in-app updater; 1.2.0 (06-30) theme colours + auth page editor, warmer, per-number proxy, cloud storage (S3 and compatibles), blog + SEO, WhatsApp Pay + Lemon Squeezy, AI usage dashboard, system health, quick access; 1.3.0 (07-09) WhatsApp usernames, AI calling upgrades, Meta Ads (CTWA), inbox list controls, WooCommerce order webhooks; 1.4.0 (07-20) template variable overrides, campaign analytics, yearly billing fix; 1.5.0 (08-07) redesigned inbox + PWA push, auto-responder methods, faster campaigns; 1.6.0 (08-19) Instagram, Facebook, Telegram, TikTok, SMS, AI CRM copilot, CRM suite, auto-invoicing, native checkout, BSP billing; 1.7.0 (09-02) Email (MailTrixy), LINE, WeChat, Viber. Note code composer changes: 1.3 +flysystem-aws-s3, 1.5 +web-push +pusher, 1.6 +dompdf.
  5. `Database/1.1.sql` is not a base schema: it is the DDL for the 29 migrations added between 1.0.0 and 1.1.0 (captured with `migrate --pretend`), meant to be run once on a 1.0 DB by hosts that cannot run `artisan migrate`. Content: `users.passcode`, `user_otps`, `personal_access_tokens`, Slack and Trello integration tables, plan flags, pinned/content on broadcasts, header location on templates, `api_keys`, pipelines/stages/deals/deal_activities, deal automation on workspaces, multi-engine workspace columns, channel on templates, throttle/retry/A-B columns on campaigns, incoming webhooks, addon packages and retention, `workspaces.data_wiped_at`, retry columns on scheduled messages and broadcasts, AI admin-key model default refresh (Anthropic default moved to claude-opus-4-8, Gemini to gemini-3.5-flash, OpenAI to gpt-5.4-mini, ElevenLabs to eleven_v3 for inactive rows), and finally inserts all 29 names into `migrations` under one new batch so a later `migrate` is a no-op. It disables and re-enables `FOREIGN_KEY_CHECKS`. There is no full base schema file; a fresh install always uses migrations.
  6. The reference DB holds all 350 migrations in batch 1 (installed via a fresh migrate); `PackageSeeder` etc. are not included in update ZIPs.
  7. Stale settings: `config/app.php` `version` (env `APP_VERSION`) still defaults to `1.4.0`; the UI prefers `config('version.version')`.
- **Async & events:** none.
- **External systems:** CodeCanyon delivery (buyer downloads package ZIP).
- **Settings:** `config/version.php` values; env `APP_VERSION` (legacy fallback).
- **Acceptance criteria:**
  - Given the running app, When the Updater page renders, Then the chip shows version 1.7.0 and build 8 taken from `config/version.php`.
  - Given a ZIP whose `config/version.php` says 1.5.2, When compared with an installed 1.5.0, Then the version is judged newer.
  - Given the new platform, When an operator queries the version endpoint or admin system page, Then it returns semantic version, git/build id and applied-migration count.
  - Given an add-on with `min_core` 1.4.0, When core is 1.3.0, Then installation is refused (ADD domain, uses this version).
- **Source refs:** config/version.php; config/license.php; config/app.php (version); Update/update_1.2.zip ... update_1.7.zip (unzip -l, config/version.php, composer.json per release); Database/1.1.sql; app/Services/UpdaterService.php (currentVersion, currentBuild, getZipVersion); app/Services/ExtensionService.php; resources/views/components/layouts/user.blade.php; Documentation/pages/update-details/changelog.html.
- **Port notes:** Map to `package.json` version + git SHA injected at build (expose on health endpoint and admin System page). Reference's migration history is not ported; the per-release deltas above are a useful checklist of _when_ each capability was added and inform which domain inventories must exist (channels 1.6/1.7, BSP, invoicing, CRM).

### TW-INST-028 — Documented update procedure: sequential updates, manual path, post-update ops

- **Status:** docs-only
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-INST-027
- **Summary:** The docs define how to move between releases, including a manual file-replacement path for 1.0.0 -> 1.1.0 and required post-update chores. Several claims are not enforced by the software.
- **Actors & access:** Operator / super-admin. No code path.
- **UX & screens:** Documentation pages `update-details/update-process`, `update-details/changelog`.
- **Endpoints:** none.
- **Data:** none.
- **Rules & edge cases:**
  1. Claim: updates are sequential and "compulsory" (1.6 before 1.7, etc.). Code: only requires the ZIP version to be greater than the installed one; skipping releases is accepted. Because each ZIP is a full snapshot and migrations merge additively, skipping usually works, but 1.4's removal of built-in Instagram files and composer changes make it risky (TW-INST-023 rules 8 and 11).
  2. Claim: only Super Admin can run the updater and the license is validated with Envato. Code: any admin role, and no Envato validation (TW-INST-019, -020).
  3. Claim: "All PHP dependencies and frontend assets are pre-built in the update package". Code/ZIP: `public/build` is pre-built; `vendor/` is not shipped and never installed.
  4. Manual path (only way from 1.0.0 -> 1.1.0): back up DB and files; replace `app/`, `bootstrap/` (not `bootstrap/cache`), `config/`, `database/`, `lang/`, `resources/`, `routes/`, `public/build/`, `node/` source and root files (`composer.json`, `composer.lock`, `package.json`, `artisan`, `config/version.php`); never overwrite `.env`, `storage/`, `public/` uploads, `vendor/`, `node/node_modules/`; then run `php artisan migrate --force` (or import `Database/1.1.sql` when no CLI), `php artisan optimize:clear`, restart Node and `queue:restart`. Rollback manually: restore SQL dump and files, clear caches, restart Node and queue.
  5. Post-update chores (per docs): raise PHP/nginx upload limits to >= 64M and `max_execution_time=300`, `memory_limit=256M`; restart the Node bridge after EVERY update (never auto-restarted on any host; VPS `pm2 restart`, cPanel/Hostinger via the Node app manager, Hostinger startup file `server.cjs`, cPanel startup `app.cjs`); on cPanel redo the `index.js` <-> `index-cpanel.js` rename because each update ships a fresh `index.js`; clear view cache for 1.4, 1.6, 1.7; on 1.3 make sure `NODE_WEBHOOK_TOKEN` matches in `.env` and `node/.env` (or point the Node URL at loopback `127.0.0.1:<port>` which is trusted); on 1.4 verify yearly plan pricing under Admin -> Packages and the yearly toggle setting; on 1.7 enable the Email flag per plan under Admin -> Packages (off by default) and fill each new channel's credentials in Admin -> Settings (LINE token+secret, WeChat AppID/AppSecret/Token/EncodingAESKey, Viber bot token, Email/MailTrixy URL + shared secret).
  6. "Updates are free for the lifetime of the item; backups are the operator's responsibility; Reference provides no off-site backups."
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the new platform's release notes, When an operator upgrades, Then every required manual chore (secret rotation, per-plan flags) is either automated by a migration or listed in a "Required actions" section shown in the admin UI.
  - Given a release that adds a plan-gated channel, When migrations run, Then plan flags are seeded and documented (Reference defaulted Email off with no in-app reminder).
  - Given an upgrade that skips a version, When the migrator runs, Then it applies all missing migrations in order (this is the behavior Reference's docs deny but its code allows).
- **Source refs:** Documentation/pages/update-details/update-process.html; Documentation/pages/update-details/changelog.html; Documentation/pages/faqs/installation.html (Updates and Maintenance).
- **Port notes:** Adopt the intent "additive, forward-only migrations + explicit release notes with required actions"; migration rules already forbids down migrations and edited applied files.

### TW-INST-029 — Live-demo guard (DEMO_MODE middleware)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** none
- **Summary:** When `DEMO_MODE=true` a global middleware makes the app browsable and mostly usable for logged-in demo users while blocking anything destructive, global or security-related, so a public demo cannot be broken or reconfigured.
- **Actors & access:** Applies to every authenticated user on the `web` middleware group when `config('app.demo_mode')` is true (`.env` `DEMO_MODE`, default false). Guests are never blocked. Appended to the `web` group after `SessionTimeout`, `Force2FA`, `LimitConcurrentSessions`; `/api/*` and Sanctum mobile-API routes are not covered.
- **UX & screens:** No screen. A blocked HTML request is redirected back with old input, flash `error` and `demo=true`; a JSON/AJAX request gets HTTP 422 `{ok:false, demo:true, status:"error", message, error}` (message duplicated under `message` and `error` so different front-end handlers show the friendly text). Messages: deletes -> "Deleting is disabled in this live demo."; others -> "This is a live demo - changing platform settings, branding, billing, users and passwords is disabled."
- **Endpoints:**

  | METHOD uri                                  | route name | Controller@action  | middleware           | request fields | response/redirect                                                  |
  | ------------------------------------------- | ---------- | ------------------ | -------------------- | -------------- | ------------------------------------------------------------------ |
  | (all web routes with POST/PUT/PATCH/DELETE) | -          | `DemoMode::handle` | web group (appended) | none           | blocked -> 302 back with error or 422 JSON; otherwise pass through |

- **Data:** none.
- **Rules & edge cases:**
  1. Off unless enabled. Order of checks when on: method not in POST/PUT/PATCH/DELETE -> allow; no authenticated user -> allow; path matches an allow list -> allow; DELETE -> block; path matches block list -> block; else allow.
  2. Allow list (`$request->is`): `logout`, `locale*`, `lang*`, `set-locale*`, `language*`, `theme*`.
  3. Block list (non-GET only, patterns): `admin/settings*`, `admin/site-settings*`, `admin/security*`, `admin/payment-gateways*`, `admin/currencies*`, `admin/languages*`, `admin/translation-providers*`, `admin/api-keys*`, `admin/wallet-rules*`, `admin/frontend*`, `admin/packages*`, `admin/credit-packages*`, `admin/coupons*`, `admin/users*`, `admin/workspaces*`, and anything containing `password`, `passcode`, `two-factor`, `2fa`, or starting `account/security`.
  4. QUIRK: `admin/update*` (the Updater), `admin/extensions*`, `admin/roles*`, `admin/permissions*`, `admin/devices*` are not in the block list, so a demo admin could still upload/apply updates or install add-ons; only DELETE is blocked universally.
  5. Demo users may create and edit their own workspace content (campaigns, contacts, templates), which is intended.
  6. QUIRK: the demo docs promise more than the middleware does: no real WhatsApp sends, simulated outbound, no channel pairing, sandbox payment gateways, no outbound emails, capped AI, periodic data resets, tighter rate limits. None of that is enforced by `DemoMode`; it is achieved by deployment (no credentials configured, mail driver `log`, reset job outside this codebase). Some controllers return a "demo" response when the Node `SERVER_URL` is empty (device pairing route comment); those belong to other domains.
  7. The middleware also does not block GET-based side effects.
  8. `DEMO_MODE` is a config value (`config/app.php` `demo_mode`), so `config:cache` freezes it.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `.env` `DEMO_MODE` (bool, default false).
- **Acceptance criteria:**
  - Given `DEMO_MODE=true` and a logged-in user, When they send any DELETE request, Then it is refused with the delete message (302 back or 422 JSON).
  - Given `DEMO_MODE=true`, When a logged-in admin POSTs `admin/settings/general`, Then the request is refused and no setting changes.
  - Given `DEMO_MODE=true`, When a logged-in user POSTs to create a campaign, Then it succeeds.
  - Given `DEMO_MODE=true`, When a guest POSTs login, Then it is not blocked.
  - Given `DEMO_MODE` unset, Then no request is ever blocked by this middleware.
- **Source refs:** app/Http/Middleware/DemoMode.php; config/app.php (demo_mode); bootstrap/app.php (middleware registration); Documentation/pages/faqs/demo-limitations.html.
- **Port notes:** New stack has no equivalent (`grep demo` in `apps/api` is empty). Implement as an env-gated Nest guard registered globally, driven by an explicit route/permission allow-list rather than URL globs, and cover the public/mobile API too. Coordinate with CORE (other inventories reference `DemoMode` there); this file owns the behavior definition.

## Data model

This domain owns **no application tables**. All of its persistent state is filesystem artefacts plus a handful of rows in tables that other domains own. Behavior-relevant items:

### Filesystem state (authoritative for install/update)

| Artefact                                                             | Written by                                        | Purpose / shape                                                                                                                                                                                          |
| -------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage/installed`                                                  | TW-INST-015                                       | Existence = installed (the only thing read). JSON `{installed_at ISO-8601, version "1.0.0" (hard-coded), admin_email, app_url}`.                                                                         |
| `.env`                                                               | TW-INST-001 (bootstrap), TW-INST-011, TW-INST-016 | Runtime configuration; keys listed in TW-INST-011. `APP_KEY` auto-minted pre-install.                                                                                                                    |
| `node/.env`                                                          | TW-INST-011                                       | `PORT`, `DOMAIN_NAME`, `APP_DOMAIN_NAME`, `NODE_WEBHOOK_TOKEN` (other keys such as `ALLOWED_ORIGINS` preserved).                                                                                         |
| `extension/content.js`                                               | TW-INST-011                                       | Constant `THREADWISE_SERVER_URL` rewritten to the app URL.                                                                                                                                               |
| `storage/framework/sessions/*` (cookie `threadwise_install_session`) | TW-INST-001/002                                   | Wizard state: `install_step`, `install_purchase_ok`, `install_purchase_code`, `db`, `app`, `admin_data`, `node`, `install_complete`. Contains plaintext DB and admin passwords until finalize.           |
| `config/version.php`, `config/license.php`, `config/license.json`    | release build                                     | Version/build, Envato item id, encrypted author token (TW-INST-017, -027).                                                                                                                               |
| `storage/app/backups/v<ver>_<Y-m-d_His>/`                            | TW-INST-021                                       | `code_backup.zip`, `database_backup.sql.gz` (or `.sql`), `rollback.json` {version, created_at, code_backup, db_backup}. No retention.                                                                    |
| `storage/app/temp/updater/`                                          | TW-INST-022/023/025                               | `update.zip`, `staging/`, `.staging_extracted_from` (`<size>-<mtime>`), `apply.status.json` ({phase running/done, started_at, finished_at, updated_count, files_skipped, version}). Deleted by finalize. |
| `public/uploads/call-recordings/`                                    | TW-INST-015                                       | Created empty at install.                                                                                                                                                                                |

### Rows written in tables owned by other domains

| Table (owner)                                                                                                                                                   | Rows / columns written here                                                                                                                                                                                                                                                                                     | Feature                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `migrations` (Laravel framework; excluded from coverage)                                                                                                        | `id` int PK, `migration` varchar(255), `batch` int. 350 rows in batch 1 after a fresh v1.7.0 install; updater fallback appends "already applied" names under one new batch.                                                                                                                                     | TW-INST-012, -024       |
| `system_settings` (SET)                                                                                                                                         | `key` varchar(96) unique, `type` varchar(16) default `int`, `value` text. Keys: `envato_purchase_code` (string, plaintext), `envato_verified_at` (string ISO-8601); seeded checkout keys `pricing.yearly_discount_pct`, `checkout.tax_rate`, `checkout.tax_label`, `checkout.countries`, `pricing.refund_days`. | TW-INST-013, -015, -020 |
| `users` (AUTH)                                                                                                                                                  | one row: `name`, `email` (unique), `password` bcrypt, `role='admin'`, `email_verified_at`, `current_workspace_id`.                                                                                                                                                                                              | TW-INST-014             |
| model_has_roles / roles / permissions (RBAC)                                                                                                                    | 6 roles, ~101 permissions; the admin gets `Super Admin`.                                                                                                                                                                                                                                                        | TW-INST-013, -014       |
| `workspaces` (WSP)                                                                                                                                              | one row: `owner_user_id`, `name`, `slug` (name slug + 4 random chars), `plan` (numeric package id as string), `timezone`, `locale`, `currency='USD'`, `status=1`, `last_active_at`.                                                                                                                             | TW-INST-014             |
| `workspace_user` (WSP)                                                                                                                                          | `role='owner'`; unique `(workspace_id, user_id)`.                                                                                                                                                                                                                                                               | TW-INST-014             |
| `packages`, `currencies`, `payment_gateways`, `translation_providers`, `pricing_faqs`, `coupons`, `guidebook_articles`, `legal_pages` (PLAN/CPN/PAYGW/I18N/CMS) | seed rows as listed in TW-INST-013.                                                                                                                                                                                                                                                                             | TW-INST-013             |
| `notifications`, `jobs`, `job_batches`, `failed_jobs`, `cache`, `cache_locks`, `sessions`                                                                       | dumped schema-only by backups and recreated empty on rollback.                                                                                                                                                                                                                                                  | TW-INST-021, -026       |

Audit rows: `Audit::log('admin.updater.verify|backup|apply|migrate|finalize|rollback')` are written by the controller into the audit table owned by NOTIF (the upload step writes none).

Row-volume expectations: `migrations` ~350 rows; backups grow one folder per update; wizard session files a few KB.

## Cross-domain contracts

**Consumes**

- SET: `SystemSetting::get/set` (30-minute cached, tolerant of an unreachable DB), the Admin Settings page that links to the Updater; `AdminPagesController` calls `EnvWriter::set` for `SERVER_URL` and `NODE_WEBHOOK_TOKEN` (also NODE).
- RBAC: Spatie tables and the `Super Admin`/`Admin` role names (`User::isAdmin()`), `RolePermissionSeeder`.
- WSP / PLAN / CPN / PAYGW / I18N / CMS: the eight seeders' tables (TW-INST-013) and `Workspace`, `Package` models for the first workspace.
- NOTIF: `Audit::log` facade for updater events; `IPAllowlist` middleware writes `admin.access.blocked_by_ip`.
- NODE: the bridge reads `node/.env` values the installer writes; the bridge heartbeat and `X-Node-Token` check consume `NODE_WEBHOOK_TOKEN`.
- ADD: `ExtensionService` depends on `UpdaterService::verifyPurchase` and `config('version.version')`.

**Exposes**

- To every domain: the `storage/installed` early-return pattern (`ResolveTenantDomain`, `Maintenance`, `SetLocale`, `EnsureUserActive`, `EnsureTrialActive`, `Force2FA`, `RecordAgentActivity`, `LimitConcurrentSessions`, `ImpersonationBanner`, `SessionTimeout`).
- To ADD/EXT: `UpdaterService::verifyPurchase(code)`, `currentVersion()`, `currentBuild()`; `config('version.version')` / `version.build`; `Licence::token()/itemId()`.
- To SET/NODE: `EnvWriter::set(key, value): bool`.
- To CORE: middleware `EnsureInstalled` (web prepend), `UseFileSession` (alias `install.session`, unused), `DemoMode` (web append; other inventories refer to it as CORE, this file defines its behavior).
- Documentation set for hosting/operations (installation, update-details, faqs/installation, faqs/errors-solutions, faqs/demo-limitations).

## Open questions & quirks

1. **Licence is verified twice differently.** The installer performs a real Envato author-sale check (item 63755235) but the Updater/Add-on verification is a no-op that stores any string (comment says "bypassed by vendor decision"). Decision needed: none of this ports, but confirm no licence enforcement is expected in the new product.
2. **Installer POST endpoints are not step-guarded.** `install.database.save`, `application.save`, `admin.save`, `node.save`, `execute` only depend on session data; licence and requirements are enforceable only by skipping the UI. Also `/install` is publicly writable on a fresh server (whoever reaches it first owns the install).
3. **Plaintext secrets in the file session** (DB password and the admin password) until finalize, and the DB password is echoed back into the page when revisiting step 3; the docs say the password is not kept in the session.
4. **Step 4 is not idempotent** (random workspace slug); reloading the run page after step 4 creates a second workspace. Not fixed by the retry design.
5. **Installed marker `version` is hard-coded 1.0.0**, `install_complete` session value is dead, `UseFileSession`/`install.session` alias is dead code, `/install/complete` route was removed but docs still describe an eighth "final screen" and an "Open admin panel" button.
6. **Requirements step has no server-side enforcement** and does not probe Node, Composer, disk, RAM, upload limits or DB version even though docs list them.
7. **Warnings are invisible:** failures writing `node/.env` or the extension URL are flashed to the session (`node_env_warning`, `extension_url_warning`) but no screen renders them.
8. **Default demo coupons and 18 percent GST are seeded on production installs** (`WELCOME10`, `SAVE20`); `workspaces.plan` gets the numeric package id instead of the `plan_id` string used elsewhere (tolerated by `Workspace::package()`).
9. **Updater docs vs code:** docs say Super Admin only and Envato validation and strictly sequential updates; code allows any admin role, no Envato validation, and any newer version. Docs also say dependencies are pre-built; the ZIPs carry no `vendor/` yet releases 1.3, 1.5 and 1.6 add composer packages. Unknown how real customers got `vendor/` updated (assumed manual `composer install`); confirm with the product owner.
10. **Updates never delete files, never update `lang/` or `database/seeders`, never restart Node, and overwrite `config/*` wholesale.** Apply failure leaves a half-applied tree; the status file has no `failed` phase, and the UI swallows explicit apply errors behind a 3-minute poll.
11. **UI state is not persisted:** after a reload Migrate/Finalize are locked until earlier steps are redone.
12. **Backup/rollback gaps:** `node/baileys_auth` (WhatsApp sessions) is included in backups (and restored by rollback) although apply protects it; ephemeral tables restore empty (logs everyone out); backups are never pruned or downloadable; only MySQL/SQLite are handled; string-typed dump of all values (binary/bit columns untested).
13. **Finalize** returns HTTP 200 with `success=false` on health warnings and can report the old version when config is cached.
14. **`build` numbers are non-monotonic** (1.2=3, 1.3=1, 1.4=4, 1.5=5, 1.6=6, 1.7=8; 1.5 ships as 1.5.2). `config/app.php` still defaults `version` to 1.4.0.
15. **Demo docs promise more than the code enforces** (no real sends, sandbox gateways, disabled email, capped AI, periodic resets). `DemoMode` only blocks DELETEs, a fixed URL block list, and password/2FA paths on web routes; `admin/update*`, `admin/extensions*`, `admin/roles*`, `admin/devices*` are not blocked. No data-reset job exists in this codebase (`commands.txt`); unknown whether the live demo uses an external one.
16. **Docs contradictions:** installation FAQ lists a queue worker as required while the post-install page says none is needed; docs say the wizard button is "Create admin & install" (actual "Continue"); docs step count (8) vs stepper (7).
17. **Unverified edge:** if `packages` were empty at step 4, `workspaces.plan` would be written as NULL against a NOT NULL column; unreachable in normal flow.
18. **Not owned here but noticed:** `public/js/admin-updater.js` is a shipped public asset not present in `resources_nonview.txt` (so not coverable in the manifest); `node/app.cjs`, `node/server.cjs`, `node/index-cpanel.js` (cPanel/Hostinger entry points that installation docs depend on) belong to NODE; `config/app.php` `demo_mode` belongs to CORE; `routes/console.php` schedules are not touched by the installer; there is no cron entry created by the installer.
19. **Routes deliberately left to other domains** (matched by the name filter `update` in `routes.py` but not mine): `POST api/app/update-queue-name` (MOB), `POST api/campaigns/update-*` (CAMP), `POST api/update-broadcast-status`, `api/update-message-status` (BCAST), `POST api/update-schedule-status`, `api/update-scheduled-contact-status` (SCHED), `POST api/update-status` (WADEV/NODE).

## Coverage

```json threadwise-coverage
{
  "routes": [
    "GET install",
    "GET install/license",
    "POST install/license",
    "GET install/requirements",
    "POST install/requirements",
    "GET install/database",
    "POST install/database",
    "POST install/database/test",
    "GET install/application",
    "POST install/application",
    "GET install/admin",
    "POST install/admin",
    "GET install/node",
    "POST install/node",
    "GET install/run",
    "POST install/execute",
    "GET admin/update",
    "POST admin/update/verify",
    "POST admin/update/backup",
    "POST admin/update/upload",
    "POST admin/update/apply",
    "GET admin/update/apply-status",
    "POST admin/update/migrate",
    "POST admin/update/finalize",
    "POST admin/update/rollback"
  ],
  "controllers": [
    "app/Http/Controllers/InstallController.php",
    "app/Http/Controllers/Admin/UpdateController.php"
  ],
  "services": [
    "app/Services/UpdaterService.php",
    "app/Support/Licence.php",
    "app/Support/EnvWriter.php"
  ],
  "models": [],
  "tables": [],
  "views": [
    "resources/views/install/layout.blade.php",
    "resources/views/install/welcome.blade.php",
    "resources/views/install/license.blade.php",
    "resources/views/install/requirements.blade.php",
    "resources/views/install/database.blade.php",
    "resources/views/install/application.blade.php",
    "resources/views/install/admin.blade.php",
    "resources/views/install/node.blade.php",
    "resources/views/install/progress.blade.php",
    "resources/views/install/partials/steps.blade.php",
    "resources/views/admin/update/index.blade.php"
  ],
  "commands": [],
  "permissions": [],
  "middleware": [
    "app/Http/Middleware/EnsureInstalled.php",
    "app/Http/Middleware/UseFileSession.php",
    "app/Http/Middleware/DemoMode.php"
  ],
  "node_files": [],
  "js_assets": ["resources/js/charts/install-wizard.js"],
  "misc_files": [],
  "config_files": ["config/version.php", "config/license.php", "config/license.json"],
  "doc_pages": [
    "Documentation/pages/installation/web-installer.html",
    "Documentation/pages/installation/server-requirements.html",
    "Documentation/pages/installation/post-install.html",
    "Documentation/pages/installation/troubleshooting.html",
    "Documentation/pages/update-details/update-process.html",
    "Documentation/pages/update-details/changelog.html",
    "Documentation/pages/faqs/installation.html",
    "Documentation/pages/faqs/errors-solutions.html",
    "Documentation/pages/faqs/demo-limitations.html"
  ],
  "feature_map": {
    "TW-INST-001": [],
    "TW-INST-002": ["GET install"],
    "TW-INST-003": ["GET install/license", "POST install/license"],
    "TW-INST-004": ["GET install/requirements", "POST install/requirements"],
    "TW-INST-005": ["GET install/database", "POST install/database"],
    "TW-INST-006": ["POST install/database/test"],
    "TW-INST-007": ["GET install/application", "POST install/application"],
    "TW-INST-008": ["GET install/admin", "POST install/admin"],
    "TW-INST-009": ["GET install/node", "POST install/node"],
    "TW-INST-010": ["GET install/run", "POST install/execute"],
    "TW-INST-011": [],
    "TW-INST-012": [],
    "TW-INST-013": [],
    "TW-INST-014": [],
    "TW-INST-015": [],
    "TW-INST-016": [],
    "TW-INST-017": [],
    "TW-INST-018": [],
    "TW-INST-019": ["GET admin/update"],
    "TW-INST-020": ["POST admin/update/verify"],
    "TW-INST-021": ["POST admin/update/backup"],
    "TW-INST-022": ["POST admin/update/upload"],
    "TW-INST-023": ["POST admin/update/apply", "GET admin/update/apply-status"],
    "TW-INST-024": ["POST admin/update/migrate"],
    "TW-INST-025": ["POST admin/update/finalize"],
    "TW-INST-026": ["POST admin/update/rollback"],
    "TW-INST-027": [],
    "TW-INST-028": [],
    "TW-INST-029": []
  }
}
```
