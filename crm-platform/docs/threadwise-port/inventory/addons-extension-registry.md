---
domain: addons-extension-registry
code: ADD
title: Add-ons, Extensions and Module Registry
threadwise_version: '1.7.0'
sources_read: 62
---

# Add-ons, Extensions and Module Registry

## Overview

"Add-on" means two unrelated things in Reference, and the admin UI goes out of its way to keep them
apart (each page has a banner pointing at the other). This domain owns both, plus the plumbing that
lets shipped code plug into the core.

1. **Code add-ons ("Extensions" / in-place modules)** at `/admin/extensions` (reached from the Settings
   hub tile "Add-ons", not from the sidebar). A super-admin verifies the CodeCanyon purchase code,
   uploads a ZIP, and the package is unpacked into `addon/<slug>/` under the install root. The folder is
   discovered by the `ModuleLoader`, which autoloads its `App\` classes, requires its route files, adds its
   migrations and Blade views, and the `ExtensionRegistry` merges its manifest (`extension.json`) into core:
   admin sidebar entries, plan feature flags and plan limits. Modules can also be dropped into `addon/` by
   hand (no ZIP, no DB row) and are shown as "in-place modules". The same page hosts two "connect by URL +
   shared secret" cards for standalone sibling products: the remote Instagram engine (Instaflow / InstaMagic)
   and the email engine (MailTrixy). Only Instagram was ever shipped as a ZIP add-on and that ZIP is not in
   the reference tree, so the loader contract is derived from the code alone.
2. **Billing add-ons** at `/admin/addons` (sidebar: Billing and plans > Add-ons). A billing add-on is a row in
   `packages` with `type='addon'`: an a-la-carte feature/limit pack a workspace buys on top of its plan. What
   it grants is stored in `packages.grants_json` (`{features:[...], limits:{key:delta}}`), the admin CRUD lives
   here, purchases create `workspace_addons` rows, and `Workspace::effectiveLimit()` merges the grants onto the
   base plan (booleans OR, limits stack, -1 wins).

Actors: platform super-admin (all routes here, behind `Authenticate`, `EnsureUserIsAdmin`, `IPAllowlist`;
no finer permission keys), workspace owner (buys billing add-ons from Account > Add-ons and the Pricing page
via checkout, owned by PLAN/CHK), workspace members (indirectly, through effective limits), the browser
extension (a separate meaning of "extension", see TW-ADD-034).

Plan tiers: billing add-ons exist precisely to bypass plan tiers per feature. Code extensions are per
install (binary), while plan flags decide per tenant whether the code may be used ("extension = does the code
exist here, plan = may this tenant use it").

Connections: PLAN (packages table, plan form consuming extension-contributed flags, checkout fulfilment of
add-on purchases, pricing page), CHK (order fulfilment), INST (updater/purchase code and `config/version.php`),
IG (channel-instagram: native add-on and Instaflow engine), MAIL (channel-email: MailTrixy bridge), NOTIF
(`Audit::log` rows), SET (`system_settings`, encrypted keys), ASHELL (sidebar, settings hub), EXT (browser
extension tokens and endpoints), CORE (route/middleware registration).

## Feature index

| Id         | Feature                                                               | Status      | Priority | Effort | Depends on             |
| ---------- | --------------------------------------------------------------------- | ----------- | -------- | ------ | ---------------------- |
| TW-ADD-001 | Admin Extensions page (installed list, layout, states)                | implemented | P1       | M      | TW-ADD-005, TW-ADD-009 |
| TW-ADD-002 | Purchase-code verification step                                       | partial     | P1       | S      | TW-INST-*              |
| TW-ADD-003 | Upload endpoint and pre-install gates                                 | implemented | P1       | M      | TW-ADD-002, TW-ADD-004 |
| TW-ADD-004 | Package inspection and extension.json manifest contract               | implemented | P0       | M      | -                      |
| TW-ADD-005 | Install: safe extraction into addon/slug and registry row upsert      | implemented | P0       | L      | TW-ADD-004             |
| TW-ADD-006 | Post-install migrations and cache clearing                            | implemented | P1       | M      | TW-ADD-005             |
| TW-ADD-007 | Enable / disable an uploaded extension                                | partial     | P1       | S      | TW-ADD-005, TW-ADD-014 |
| TW-ADD-008 | Uninstall (remove) an uploaded extension                              | implemented | P1       | M      | TW-ADD-005             |
| TW-ADD-009 | In-place module discovery from addon/                                 | implemented | P0       | M      | -                      |
| TW-ADD-010 | Deactivate / re-activate an in-place module                           | implemented | P1       | S      | TW-ADD-009             |
| TW-ADD-011 | Module runtime wiring (autoload, routes, migrations, views)           | implemented | P0       | L      | TW-ADD-009             |
| TW-ADD-012 | Manifest contribution: admin sidebar navigation                       | partial     | P1       | S      | TW-ADD-004, TW-ADD-014 |
| TW-ADD-013 | Manifest contribution: plan feature flags and limits                  | implemented | P0       | M      | TW-ADD-004, TW-PLAN-*  |
| TW-ADD-014 | Registry caching and invalidation                                     | implemented | P1       | S      | TW-ADD-005             |
| TW-ADD-015 | Dormant plan-feature detection (unused)                               | dead-code   | P2       | S      | TW-ADD-013             |
| TW-ADD-016 | Stale route-cache self-heal on the Extensions page                    | implemented | P2       | S      | TW-ADD-011             |
| TW-ADD-017 | Connect remote Instagram engine (Instaflow / InstaMagic)              | implemented | P1       | M      | TW-IG-*                |
| TW-ADD-018 | Disconnect remote Instagram engine                                    | implemented | P1       | S      | TW-ADD-017             |
| TW-ADD-019 | Connect email engine (MailTrixy)                                      | implemented | P1       | M      | TW-MAIL-*              |
| TW-ADD-020 | Disconnect email engine                                               | implemented | P1       | S      | TW-ADD-019             |
| TW-ADD-021 | One Instagram engine at a time (native vs remote guards)              | implemented | P1       | S      | TW-ADD-005, TW-ADD-017 |
| TW-ADD-022 | Boot-time teardown when the native Instagram folder disappears        | implemented | P2       | S      | TW-ADD-021             |
| TW-ADD-023 | Audit trail for extension admin actions                               | implemented | P1       | S      | TW-NOTIF-*             |
| TW-ADD-024 | Discoverability: settings hub tile, cross-link banners, sidebar entry | implemented | P2       | S      | TW-ASHELL-*            |
| TW-ADD-025 | Billing add-on catalog list (admin)                                   | implemented | P0       | S      | TW-ADD-028             |
| TW-ADD-026 | Billing add-on create form                                            | implemented | P0       | M      | TW-ADD-013             |
| TW-ADD-027 | Billing add-on edit form                                              | implemented | P0       | S      | TW-ADD-026             |
| TW-ADD-028 | Save billing add-on (create and update) with grants normalisation     | implemented | P0       | M      | TW-ADD-026             |
| TW-ADD-029 | Enable / disable a billing add-on                                     | implemented | P1       | S      | TW-ADD-025             |
| TW-ADD-030 | Delete a billing add-on                                               | implemented | P1       | S      | TW-ADD-025             |
| TW-ADD-031 | Add-on entitlement merge into workspace limits                        | implemented | P0       | M      | TW-ADD-032             |
| TW-ADD-032 | Add-on purchase fulfilment (workspace_addons row)                     | implemented | P0       | M      | TW-CHK-_, TW-PLAN-_    |
| TW-ADD-033 | Customer-facing add-on catalog and owned state                        | implemented | P1       | M      | TW-ADD-031, TW-ADD-032 |
| TW-ADD-034 | Browser-extension API token store (data model only)                   | implemented | P1       | S      | TW-EXT-*               |
| TW-ADD-035 | Add-on data-retention setting                                         | docs-only   | P2       | S      | TW-PLAN-*              |

## Features

### TW-ADD-001 — Admin Extensions page (installed list, layout, states)

- **Status:** implemented
- **Priority:** P1 (the only way to see and manage installed code add-ons)
- **Effort:** M
- **Depends on:** TW-ADD-005, TW-ADD-009, TW-ADD-016
- **Summary:** One admin page shows the running core version, the two connect cards (remote Instagram engine, email engine), the two-step licence-and-upload installer, and the merged "Installed add-ons" list of uploaded extensions plus hand-dropped in-place modules. All row actions are AJAX and reload the page on success.
- **Actors & access:** platform admin only (`Authenticate`, `EnsureUserIsAdmin`, `IPAllowlist` on the whole `/admin` group; IP allowlist fails open when enabled but empty). No permission keys, no plan gates. Platform scope (per install, not per workspace).
- **UX & screens:** `resources/views/admin/extensions/index.blade.php`, layout `x-layouts.admin`, page key `settings-extensions`, sidebar highlight "settings". Breadcrumb Admin > Settings > Add-ons; page title "Add-ons" (the UI word is "add-on" even though routes and model say "extension"). Header block: headline "Install an add-on", blurb, core version chip `v{config version.version}` (default 0.0.0). A tinted banner links to the billing add-ons page ("Those are plan add-ons (billing). This page installs code."). Order of blocks: Instagram connect card + modal, Email connect card + modal, Step 1 verify, Step 2 upload, Installed add-ons, footnote (removing deletes only tracked files; data stays in DB). Installed list: count chip = uploaded rows + in-place-only modules. Uploaded row card: name, `v<version>` chip, Active or Disabled pill, mono line `slug · addon/<slug>/ · N files · installed <relative time>`; buttons Disable/Enable and Remove. In-place-only module card (a module whose slug has no DB row; a ZIP-installed add-on is de-duplicated so only the DB card shows): name, version (default 1.0.0), Active or Inactive pill, "In-place module" tag, mono line `slug · addon/<slug>/ · files kept on disk`, one button that reads Remove when active and Re-activate when inactive (inactive cards are greyed). Empty state (no rows and no modules): dashed box "No add-ons installed yet. Verify your purchase code above, then upload a package." Confirmations use the app's confirm modal (title "Remove <name>?", body explains files deleted / data kept; for modules the body explains the files are kept and it can be re-activated). Flash messages: `status`/`error` render inside the Instagram card, `mailtrixy_status`/`mailtrixy_error` inside the email card (separate keys so one card's outcome never opens the other's modal). Both connect modals auto-open on the next page load when the previous submit produced an error or validation failure.
- **Endpoints:**

| Method + URI         | Route name             | Action                          | Middleware                                   | Request              | Response                                                                                          |
| -------------------- | ---------------------- | ------------------------------- | -------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------- |
| GET admin/extensions | admin.extensions.index | Admin\ExtensionController@index | Authenticate, EnsureUserIsAdmin, IPAllowlist | optional `_healed=1` | HTML view; or 302 to same URL with `_healed=1` when the route cache was just cleared (TW-ADD-016) |

- **Data:** reads all `extensions` rows ordered by `name` ascending (no pagination), `ModuleLoader::allManifests()` (disk), `config('version.version')`, settings `instaflow_url`, `instaflow_connected`, `instaflow_last_check`, `instaflow_secret` (only whether non-blank), `instaflow_brand` (default IgDesk), and the same five keys with prefix `mailtrixy_` (brand default MailTrixy).
- **Rules & edge cases:**
  1. The list merges two sources; a slug present in `extensions` hides the in-place twin from the module list.
  2. Secrets are never rendered; the field placeholder says a secret is saved and blank keeps it.
  3. The Instagram card shows "Blocked - native add-on active" and a disabled Manage button whenever `addon/instagram/` exists on disk, even if that module is deactivated (see TW-ADD-021 QUIRK).
  4. Step 2 is visually locked (50% opacity, no pointer events) until Step 1 succeeds; this is courtesy only, the server re-verifies (TW-ADD-003).
  5. After any successful row action, install, or removal the page hard-reloads so sidebar and plan fields re-render.
- **Async & events:** none server-side; client fetches JSON endpoints in TW-ADD-002/003/007/008/010.
- **External systems:** none.
- **Settings:** none beyond those listed in Data.
- **Acceptance criteria:**
  - Given no extensions and no `addon/` folder, when an admin opens `/admin/extensions`, then the empty-state card shows, both connect cards show "Connect", and the count chip reads 0.
  - Given an uploaded extension row and a folder with the same slug, when the page renders, then it appears once (the DB card with Remove), not twice.
  - Given a hand-dropped module folder with an `extension.json`, when the page renders, then it appears as an in-place module with Active pill.
  - Given a non-admin or a request from a non-allow-listed IP (allowlist enabled and non-empty), when they request the page, then access is denied before the controller runs.
- **Source refs:** app/Http/Controllers/Admin/ExtensionController.php, resources/views/admin/extensions/index.blade.php, resources/js/charts/admin-extensions-index.js, routes/admin.php (extensions group), Documentation/pages/admin-panel/extensions.html.
- **Port notes:** new Next.js admin route under the admin console (`apps/web`), backed by a NestJS `extensions` module (suggest `apps/api/src/modules/extensions`). Extension rows are platform-level (not tenant scoped), so they sit outside RLS; keep the admin guard and IP allowlist as in ADMIN/ASHELL. The UI copy must be original, not Reference's copy-deck.

### TW-ADD-002 — Purchase-code verification step

- **Status:** partial (the vendor licence round trip was removed in this build; the step always succeeds)
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-INST-* (UpdaterService and Licence live in install-update-licensing)
- **Summary:** Step 1 of the installer. The admin pastes a purchase code and presses Verify; the server delegates to the same licence check the Updater uses and returns a message. In this build the check is stubbed to always pass.
- **Actors & access:** platform admin. JSON endpoint.
- **UX & screens:** Step 1 card of the extensions page: text input (mono, autocomplete off, spellcheck off, placeholder like a UUID), Verify button, hidden result banner. Client rules: empty input shows "Enter your purchase code first." without calling the server; button shows "Verifying..." while in flight; on 2xx with `ok` the banner is green and Step 2 unlocks; on failure the banner is red and Step 2 re-locks; editing the code afterwards re-locks Step 2 and disables Install, so a verified state never carries a different code forward.
- **Endpoints:**

| Method + URI                 | Route name              | Action                           | Middleware  | Request                                                                                       | Response                                                     |
| ---------------------------- | ----------------------- | -------------------------------- | ----------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| POST admin/extensions/verify | admin.extensions.verify | Admin\ExtensionController@verify | admin group | JSON/form `purchase_code` (string, trimmed, no validation rules; blank tolerated server-side) | JSON `{ok, message, buyer, item}`; HTTP 200 when ok else 422 |

- **Data:** `UpdaterService::verifyPurchase` writes `system_settings` keys `envato_purchase_code` (the raw code, plain text, type string) and `envato_verified_at` (ISO-8601 now) and returns `ok=true`, message "Purchase verified - you can proceed.", `buyer=""`, `item=config('version.envato.item_id')`.
- **Rules & edge cases:**
  1. QUIRK: the original Envato author/sale API call was deliberately removed by the vendor; every code, including an empty one, verifies successfully server-side. The port must decide its own licence model (see Open questions); do not port the bypass as a feature.
  2. The failure branch (HTTP 422 with `message`) exists but is unreachable today.
  3. The code is stored unencrypted in `system_settings` (not in the encrypted-keys list) and is also later stored encrypted on the extension row (TW-ADD-005).
  4. The audit row never contains the code, only `outcome: valid|invalid`.
- **Async & events:** audit log `admin.extension.verify` (result success/failure, subject_type `extension`).
- **External systems:** none in this build (formerly Envato author API with an author token resolved on demand by `App\Support\Licence`, item id from `config/license.php`).
- **Settings:** `envato_purchase_code`, `envato_verified_at`, `config/version.php` envato.item_id.
- **Acceptance criteria:**
  - Given a non-empty code, when the admin presses Verify, then the response is 200 with `ok:true` and Step 2 unlocks.
  - Given the admin edits the code after verification, when the input changes, then Step 2 locks and Install is disabled.
  - Given any verification call, when it completes, then an `admin.extension.verify` audit row exists and contains no key material.
- **Source refs:** app/Http/Controllers/Admin/ExtensionController.php (verify), app/Services/ExtensionService.php (verifyPurchase), app/Services/UpdaterService.php (verifyPurchase), app/Support/Licence.php, resources/js/charts/admin-extensions-index.js.
- **Port notes:** keep the two-step UX and the server-side re-check on upload, but back it with our own licence/entitlement service (INST). Store any licence key encrypted, unlike the source.

### TW-ADD-003 — Upload endpoint and pre-install gates

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-ADD-002, TW-ADD-004, TW-ADD-021
- **Summary:** Step 2 accepts the ZIP and runs every refusal check before a single file is written to the install: file validity, licence, readable archive, manifest and core-version compatibility, and the Instagram engine conflict. Then it hands over to install.
- **Actors & access:** platform admin.
- **UX & screens:** Step 2 card: dashed drop-zone label ("Choose an add-on .zip", "Max 100 MB"), hidden `.zip` file input; choosing a file enables Install and shows the filename; pressing Install sets the button to "Installing...", shows "Uploading and merging - do not close this tab." and after success shows the server message, a toast, and reloads after 1.2 s; on failure shows the message inline and re-enables Install.
- **Endpoints:**

| Method + URI                 | Route name              | Action                           | Middleware  | Request                                                                                                              | Response                                                                             |
| ---------------------------- | ----------------------- | -------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| POST admin/extensions/upload | admin.extensions.upload | Admin\ExtensionController@upload | admin group | multipart `extension` (required, file, mimes zip, max 102400 KB = 100 MB), `purchase_code` (nullable string max 191) | JSON `{ok, message, extension?}`; 422 on any refusal, 500 on save/install exceptions |

- **Data:** temp file `storage/app/extensions/extension.zip` (single fixed name; any previous file is deleted first, so concurrent uploads collide; the temp file is never cleaned up after install).
- **Rules & edge cases:**
  1. Order of checks: request validation, licence re-verification (server side; the front-end check is advisory), save ZIP, inspect (TW-ADD-004), native-Instagram conflict, install.
  2. Instagram conflict: only when the manifest slug is exactly `instagram`. A remote engine counts as connected when `instaflow_connected` is true AND the `instaflow_url` host is non-empty, differs from the host of `app.url`, and is not `127.0.0.1` or `localhost`. Then refuse with "Instagram runs one engine at a time. Disconnect <brand> first, then import the Instagram add-on." (brand from `instaflow_brand`, fallback InstaMagic). A self-pointing URL (native self-wire) never blocks a re-install.
  3. Any exception while saving returns 500 "Could not save the upload: ...". Any exception in install returns 500 "Install failed: ..." and logs `[EXTENSION] install threw`.
  4. Validation failures (wrong mime, over 100 MB) come back as a JSON 422 from the framework validator.
  5. Success message format: "<name> <version> installed - N file(s) merged." plus " M protected path(s) skipped." when M>0 plus " Database updated." or " WARNING: database migration failed - <error>." (a migration failure still returns ok=true).
- **Async & events:** audit `admin.extension.installed` with meta slug, version, files (see TW-ADD-023); log lines `[EXTENSION] ...`.
- **External systems:** none.
- **Settings:** `instaflow_url`, `instaflow_connected`, `instaflow_brand`, `app.url`.
- **Acceptance criteria:**
  - Given a valid ZIP and code, when uploaded, then response is ok with the installed message and a row exists in `extensions`.
  - Given a ZIP over 100 MB or not a zip, when uploaded, then the response is 422 and nothing is written to `addon/`.
  - Given a ZIP whose manifest slug is `instagram` while a remote Instagram engine on an external host is connected, when uploaded, then the response is 422 with the one-engine message and no files are written.
  - Given a POST straight to the upload URL without going through Verify, when the licence check is real, then the upload is refused (the server re-verifies).
- **Source refs:** app/Http/Controllers/Admin/ExtensionController.php (upload), app/Services/ExtensionService.php (saveUploadedZip, verifyPurchase), resources/js/charts/admin-extensions-index.js.
- **Port notes:** run archive handling in a worker or streaming handler, unique temp path per request (fixes the shared-filename race), enforce size at the edge. Never execute uploaded server code without the isolation decisions in Open questions.

### TW-ADD-004 — Package inspection and extension.json manifest contract

- **Status:** implemented
- **Priority:** P0 (defines the plugin contract)
- **Effort:** M
- **Depends on:** none
- **Summary:** Before extraction the package is opened read-only and its `extension.json` is parsed and validated. This is the manifest format every module, uploaded or in-place, follows.
- **Actors & access:** internal to the installer; the same manifest is read from disk by the loader (TW-ADD-009).
- **UX & screens:** errors surface as the upload banner text.
- **Endpoints:** none of its own (part of POST admin/extensions/upload).
- **Data:** manifest shape (all keys optional except `slug`):
  - `slug` (string, required, non-empty): machine key and the folder name `addon/<slug>`; unique per install.
  - `name` (string, default = slug), `version` (string, default "1.0.0"), `min_core` (string, default "").
  - `nav`: object with optional `admin` and `user` arrays of items `{key, href, label, icon, sw, after}` (TW-ADD-012).
  - `plan_features`: list of flag keys OR map `key => {label, group}` (TW-ADD-013).
  - `plan_limits`: list of keys OR map `key => {label, group, default, hint}` (TW-ADD-013).
  - `routes`: list of route file paths relative to the module folder (TW-ADD-011).
  - `migrate`: boolean, default true.
    Only these keys are copied into the `extensions.manifest` JSON column; any other key stays only in the on-disk `extension.json`.
- **Rules & edge cases:**
  1. Accepts a ZIP whose `extension.json` is at the root, or inside exactly one wrapper folder (the first entry matching `<folder>/extension.json` defines the root prefix, which is stripped on extraction).
  2. Refusals, all HTTP 422 with `ok:false`: unreadable archive ("not a readable ZIP archive"); no `extension.json` ("not a Reference extension package"); JSON invalid or `slug` empty ("malformed - needs at least a slug"); `min_core` set and `version_compare(core, min_core, '<')` true ("needs Reference X or newer - this install is Y. Update first, then add it."). Core version comes from `config('version.version')`, default "0.0.0".
  3. QUIRK: the slug is not validated for characters or length at install time (only the module toggle validates `[a-z0-9_-]`). A slug containing path segments would steer extraction outside `addon/`; the per-entry `..` guard does not cover the slug itself. The port must validate slug against `^[a-z0-9_-]{1,64}$` (DB column is varchar(64)).
  4. No signature, checksum, or author allowlist is checked; the licence is the only gate.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `config/version.php` version.
- **Acceptance criteria:**
  - Given a ZIP with a top-level wrapper folder holding `extension.json`, when inspected, then it is accepted and the wrapper is stripped on install.
  - Given `min_core` greater than the running version, when inspected, then the upload is refused with the update-first message and nothing is written.
  - Given a manifest without `slug`, when inspected, then it is refused as malformed.
- **Source refs:** app/Services/ExtensionService.php (inspect, class docblock), app/Services/ExtensionRegistry.php, database/migrations/2026_07_20_180000_add_manifest_to_extensions_table.php.
- **Port notes:** define the manifest as a versioned JSON schema (zod) in a shared package; declare contributions as data, never as code executed at boot (the migration comments state this is the security rationale). Add an explicit `schema_version`.

### TW-ADD-005 — Install: safe extraction into addon/slug and registry row upsert

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-ADD-004
- **Summary:** The package is extracted entirely under `addon/<slug>/`, never spread into the core tree, and the list of files written is recorded on a DB row so uninstall can remove exactly those files.
- **Actors & access:** platform admin (invoked from the upload endpoint; also records the acting user).
- **UX & screens:** result message per TW-ADD-003; card appears in the Installed list after reload.
- **Endpoints:** none of its own.
- **Data:** writes/updates `extensions` (`slug` unique, `name`, `version`, `status='active'`, `files` JSON array of paths relative to the install root, `manifest` JSON, `installed_at=now`, `installed_by=user id`, `purchase_code` encrypted at rest only when a code was supplied).
- **Rules & edge cases:**
  1. Root prefix (from inspection) is stripped from each entry; directory entries are skipped.
  2. Zip-slip guard: any entry containing `..` is skipped and counted as skipped.
  3. Protected paths are skipped (counted, reported in the message) for every entry except `extension.json`: `.env`, `composer.json`, `composer.lock`, `config/license.php`, `config/license.json`, `config/version.php`, `storage`, `vendor`, `node_modules` (exact match or under that directory). Because everything lands under `addon/<slug>/`, this mostly guards odd package layouts.
  4. `extension.json` is written like any other file because the loader discovers modules by it.
  5. If no file was written the install fails with "The ZIP contained no installable files."
  6. Re-installing the same slug is an upgrade: the row is fetched or created by slug, updated in place, files list replaced by the newest install, `purchase_code` only overwritten when a new one is provided. Old files that the new package no longer ships are NOT deleted (only overwritten files change), and stale paths drop out of the tracked list.
  7. The row is saved before migrations run, so a failing migration leaves a visible installed-but-broken extension that can be removed.
  8. The per-slug enabled cache and the manifest cache are invalidated (TW-ADD-014).
  9. Reinstall re-activates a previously disabled extension (status forced to active).
- **Async & events:** audit `admin.extension.installed`; log `[EXTENSION] installed` with counts.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a valid package with slug `foo`, when installed, then its files exist under `addon/foo/`, an active `extensions` row exists with the file list and manifest, and no file outside `addon/foo/` changed.
  - Given a package entry named `../../.env`, when installed, then that entry is skipped and counted, and the message reports the skipped count.
  - Given `foo` is installed and disabled, when the same package is installed again, then the row is active again and the version is updated.
- **Source refs:** app/Services/ExtensionService.php (install), app/Models/Extension.php, database/migrations/2026_07_20_160000_create_extensions_table.php.
- **Port notes:** unlike the source, the port cannot hot-load arbitrary code into a running NestJS process. Decide between (a) first-party modules compiled into the image and toggled by DB row/manifest, or (b) sandboxed out-of-process plugins. The registry, manifest, and file-tracking model can be kept either way.

### TW-ADD-006 — Post-install migrations and cache clearing

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-ADD-005
- **Summary:** After files and the row are saved, an add-on that ships tables gets them created, and framework caches are cleared so routes, views and config pick up the new module immediately.
- **Actors & access:** runs inside the upload request (platform admin).
- **UX & screens:** message suffix " Database updated." on success or " WARNING: database migration failed - <error>." on failure.
- **Endpoints:** none of its own.
- **Data:** if the manifest `migrate` is true (default), runs `migrate --force` limited to `addon/<slug>/database/migrations` when that folder exists (otherwise a plain `migrate --force` over the default paths); the Laravel migration ledger makes re-runs idempotent.
- **Rules & edge cases:**
  1. A migration failure never throws: it is logged (`[EXTENSION] migration failed`) and returned as `migration_error`; the install still reports ok.
  2. Caches `config:clear`, `route:clear`, `view:clear` are called best-effort after the row is saved and before migrations; failures ignored.
  3. On a normal boot the same migration folders are registered for `php artisan migrate` by the module service provider (TW-ADD-011), so hand-dropped modules migrate through the ordinary deploy step.
  4. Migrations may add columns to core tables (the Instagram add-on added plan flag columns to `packages`); there is no rollback on uninstall (data stays).
- **Async & events:** log lines only; no queue.
- **External systems:** none.
- **Settings:** `migrate` manifest flag.
- **Acceptance criteria:**
  - Given a module with a migration, when installed, then the tables exist and the message includes "Database updated."
  - Given a broken migration, when installed, then the response is still ok, the row exists, and the message carries a WARNING with the error.
  - Given the same package installed twice, when the second install runs, then no migration is applied twice.
- **Source refs:** app/Services/ExtensionService.php (runMigrations, clearCaches), app/Providers/ModuleServiceProvider.php.
- **Port notes:** run schema changes for modules through the normal migration pipeline (Drizzle migrations shipped with the module, applied under a migration lock); never from a web request. RLS must be enabled on any tenant table a module adds.

### TW-ADD-007 — Enable / disable an uploaded extension

- **Status:** partial (disabling only flips a flag; see QUIRK)
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-ADD-005, TW-ADD-014
- **Summary:** Lets an admin switch an uploaded extension off and on without deleting files. It flips `extensions.status` between `active` and `disabled`.
- **Actors & access:** platform admin.
- **UX & screens:** Disable/Enable button on the uploaded-extension card; disabled while the request runs; success reloads the page; failure toast "Could not change status: ...".
- **Endpoints:**

| Method + URI                      | Route name              | Action                           | Middleware  | Request                                                         | Response                 |
| --------------------------------- | ----------------------- | -------------------------------- | ----------- | --------------------------------------------------------------- | ------------------------ |
| POST admin/extensions/{id}/toggle | admin.extensions.toggle | Admin\ExtensionController@toggle | admin group | path `id` (no numeric constraint; `findOrFail`, 404 if missing) | JSON `{ok:true, status}` |

- **Data:** updates `extensions.status` (`active` | `disabled`); clears the per-slug enabled cache and the manifest cache.
- **Rules & edge cases:**
  1. QUIRK: the effective disable is weak. Install writes files to `addon/<slug>/`, and `ModuleLoader` loads every folder that has `extension.json` and no `.disabled` marker, independently of the DB row. The registry merges the disk manifests over the DB ones, so a "disabled" uploaded extension still contributes nav, plan fields, routes, migrations and views. Only code that asks `Extension::enabled(slug)` sees it as off. The docs and code comments claim disable takes URLs away; it does not. The port must make one source of truth for enablement.
  2. No confirmation dialog for the toggle (unlike Remove).
  3. The state is cached for 5 minutes per slug until forgotten; the toggle forgets it immediately.
- **Async & events:** audit `admin.extension.enabled` / `admin.extension.disabled` with subject id and meta slug.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an active extension, when Disable is pressed, then status is `disabled`, the card shows a Disabled pill and the button reads Enable.
  - Given a disabled extension, when Enable is pressed, then status is `active` and the manifest cache no longer excludes it.
  - Given an unknown id, when toggled, then the response is 404.
  - Port target: given a disabled extension, then its routes return 404, its nav entry and plan fields disappear (fixing the QUIRK).
- **Source refs:** app/Http/Controllers/Admin/ExtensionController.php (toggle), app/Models/Extension.php, resources/js/charts/admin-extensions-index.js.
- **Port notes:** implement enablement as a single flag consulted by route registration guard, nav provider and plan-feature provider.

### TW-ADD-008 — Uninstall (remove) an uploaded extension

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-ADD-005
- **Summary:** Deletes exactly the files recorded at install time, prunes directories left empty, and deletes the DB row. Database tables the add-on created stay.
- **Actors & access:** platform admin.
- **UX & screens:** Remove button on the uploaded card; confirm modal "Remove <name>? This deletes the files it installed. Its data stays in the database." (danger style); toast with the server message; page reload.
- **Endpoints:**

| Method + URI                 | Route name               | Action                            | Middleware  | Request   | Response                                                                                  |
| ---------------------------- | ------------------------ | --------------------------------- | ----------- | --------- | ----------------------------------------------------------------------------------------- |
| DELETE admin/extensions/{id} | admin.extensions.destroy | Admin\ExtensionController@destroy | admin group | path `id` | JSON `{ok, message}` "Removed <slug> - N file(s) deleted." or 500 "Uninstall failed: ..." |

- **Data:** deletes the row from `extensions`; removes tracked files under `addon/<slug>/`; forgets caches; clears config/route/view caches.
- **Rules & edge cases:**
  1. Only paths in the stored `files` array are deleted; entries containing `..` or matching the protected list are ignored. No directory sweep, so hand-added files in the folder survive (and keep the folder).
  2. After deletion, directories that became empty are removed upward, stopping at the first non-empty directory and never at or above the install root.
  3. `extension.json` is one of the tracked files, so after uninstall a leftover folder (kept because it still holds an untracked file) is no longer discovered as a module.
  4. Migrated tables and added columns remain (documented as "data stays in the database").
  5. Native Instagram: removing the `instagram` extension makes the boot reconcile tear down the native wiring (TW-ADD-022).
- **Async & events:** audit `admin.extension.uninstalled` (meta slug, removed count); log `[EXTENSION] uninstalled`.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an installed extension, when Remove is confirmed, then its tracked files and empty folders are gone, the row is deleted, and the count of removed files is reported.
  - Given a file not in the tracked list inside the folder, when Remove runs, then that file remains.
  - Given a tracked entry that resolves to a protected path, when Remove runs, then it is not deleted.
- **Source refs:** app/Services/ExtensionService.php (uninstall, pruneEmptyDirs, isProtected), app/Http/Controllers/Admin/ExtensionController.php (destroy).
- **Port notes:** for first-party modules "remove" should mean "disable and hide", with data left intact; if artifacts are ever downloaded, track them in a manifest table as Reference does.

### TW-ADD-009 — In-place module discovery from addon/

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** none
- **Summary:** Any `addon/<name>/` directory containing an `extension.json` is a module. The loader exposes two views: the live set (no `.disabled` marker) used by all runtime paths, and the full set (including deactivated) used only by the admin list.
- **Actors & access:** framework-level; admin UI reads the full set.
- **UX & screens:** appears as in-place module cards (TW-ADD-001).
- **Endpoints:** none.
- **Data:** filesystem only: `addon/<dir>/extension.json`, optional `addon/<dir>/.disabled` marker (content is a timestamp line). `allManifests()` adds `_dir` and `_disabled` to each manifest; `manifests()` adds `_dir`.
- **Rules & edge cases:**
  1. A manifest is accepted only when the JSON parses to an array with a non-empty `slug`; otherwise the folder is silently ignored.
  2. The key of the returned map is the manifest `slug`, but `dirForSlug` and the toggle route match on the DIRECTORY name; slug and folder name are expected to be equal (QUIRK: nothing enforces it).
  3. Results are memoised per process and busted on enable/disable.
  4. `glob` order (alphabetical) determines load order of autoload paths and routes; there is no dependency ordering between modules.
  5. Manifest merge precedence: for the same slug the on-disk manifest overrides the DB manifest in the registry.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given `addon/foo/extension.json` with slug foo, when the app boots, then foo is in the live set and in the full set.
  - Given `addon/foo/.disabled`, when the app boots, then foo is absent from the live set but present in the full set with `_disabled=true`.
  - Given an `extension.json` without slug, when scanned, then it is ignored without error.
- **Source refs:** app/Services/ModuleLoader.php (dirs, allDirs, allManifests, manifests, dirForSlug, isDisabled).
- **Port notes:** replace filesystem scanning with a module registry (static import list generated at build time, plus a DB table for enabled state). Keep slug equal to the module id.

### TW-ADD-010 — Deactivate / re-activate an in-place module

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-ADD-009
- **Summary:** For a module folder, "Remove" does not delete anything: it writes a hidden `.disabled` marker so the module stops loading (routes, migrations, views, classes, nav, plan fields drop out), and "Re-activate" removes the marker. Files and data stay.
- **Actors & access:** platform admin.
- **UX & screens:** button on the in-place card: Remove (when active) or Re-activate (when inactive) with confirm modals. Remove modal body: deactivates the add-on, its pages and automations stop, files kept, data stays. Re-activate modal: turns the add-on back on immediately. After success a toast and page reload.
- **Endpoints:**

| Method + URI                               | Route name                     | Action                                 | Middleware  | Request     | Response                                                                                                                       |
| ------------------------------------------ | ------------------------------ | -------------------------------------- | ----------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| POST admin/extensions/module/{slug}/toggle | admin.extensions.module.toggle | Admin\ExtensionController@moduleToggle | admin group | path `slug` | JSON `{ok, disabled, message}`; 404 "Unknown module."; 500 "Could not update the module. Check the addon/ folder is writable." |

- **Data:** creates or deletes `addon/<slug>/.disabled`; no DB write.
- **Rules & edge cases:**
  1. The slug must match `^[a-z0-9_-]+$` (case-insensitive) AND correspond to an existing module directory, so an arbitrary path can never be touched.
  2. The endpoint is a toggle: it reads the current marker state and flips it, so a double click flips twice.
  3. After the flip it runs `route:clear`, `view:clear`, `config:clear` and resets opcache when available, all best-effort.
  4. QUIRK: the same toggle also works on the `.disabled` state of a ZIP-installed extension folder (that folder is also an in-place module) but the UI only offers the button for in-place-only cards; the DB row status is unaffected.
  5. Deactivating `instagram` frees the engine for a remote connection (TW-ADD-021).
- **Async & events:** audit `admin.module.disabled` / `admin.module.enabled` with meta slug.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an active module, when Remove is confirmed, then `.disabled` exists, its routes 404 on the next request, and the card shows Inactive with a Re-activate button.
  - Given an inactive module, when Re-activate is confirmed, then the marker is removed and its routes work again without any upload.
  - Given an unknown or malformed slug, when posted, then the response is 404 "Unknown module."
- **Source refs:** app/Http/Controllers/Admin/ExtensionController.php (moduleToggle), app/Services/ModuleLoader.php (disable, enable, isDisabled).
- **Port notes:** a boolean `enabled` on the module registry row, with a domain event that invalidates route, nav and plan-field caches on every API node.

### TW-ADD-011 — Module runtime wiring (autoload, routes, migrations, views)

- **Status:** implemented
- **Priority:** P0 (this is what makes a module actually run)
- **Effort:** L
- **Depends on:** TW-ADD-009
- **Summary:** Every live module is plugged into the framework at boot: its `app/` tree is appended (prepended, so it wins) to the `App\` autoload map before anything else, its route files are required in the routing bootstrap, its migrations are registered with the migrator, and its `resources/views` directory is added to the view finder.
- **Actors & access:** framework-level.
- **UX & screens:** none.
- **Endpoints:** whatever routes the module declares; they are loaded raw (no forced middleware group), so a module declares its own groups (session pages, admin pages, public webhooks, node callbacks) and its own auth middleware.
- **Data:** module layout convention: `addon/<slug>/{extension.json, app/**, routes/*.php, database/migrations, resources/views}`.
- **Rules & edge cases:**
  1. Autoload registration runs at the very top of the bootstrap file, before the app container exists, using the project root passed in.
  2. Class map override: every PHP file in the module `app/` tree is force-mapped to its FQCN (`App\...`), which beats both a stale prebuilt classmap and any physical copy of the same class in core `app/`. Core files that duplicate a module class ("ghosts", leftovers from older installs) are logged to `storage/logs/module-loader.log`; deletion is no longer required for correctness.
  3. Route loading order: extension route files from the registry, then the merged core channel route files (BSP, Facebook, TikTok, Telegram, LINE, WeChat, Viber, email bridge, SMS), then in-place module route files, all BEFORE the workspace-slug catch-all which is registered dead last (otherwise a single-segment module URL like `/instagram` would be swallowed and 404).
  4. QUIRK: `ExtensionRegistry::routeFiles()` resolves manifest route paths against the project root (`base_path`) and skips missing files, while `ModuleLoader::routeFiles()` resolves them against the module folder. Because the registry's list merges disk manifests, a module route path such as `routes/x.php` normally resolves only in the module folder (loaded once by the loader); a path that also exists in core would be required twice. Paths containing `..` or empty are dropped in both.
  5. Nonexistent route files are silently skipped, so a stale row never fatals the app.
  6. If a module's route file is cached by `route:cache`, module routes are frozen at cache time (see TW-ADD-016).
  7. The provider registers module migration directories for the migrator and appends module view directories as extra view locations (lowest precedence: core views win on name clashes).
- **Async & events:** log file `storage/logs/module-loader.log` for ghost duplicates and classmap failures.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a live module with a controller under `addon/foo/app/Http/Controllers`, when a request routes to it, then the class resolves from the module folder.
  - Given a module declaring `routes/foo.php`, when the app boots, then those routes exist and are matched before the workspace-slug catch-all.
  - Given the module is deactivated, when the app boots, then none of its routes, migrations, views, or classes are registered.
- **Source refs:** app/Services/ModuleLoader.php, app/Providers/ModuleServiceProvider.php, bootstrap/app.php, bootstrap/providers.php, app/Services/ExtensionRegistry.php (routeFiles).
- **Port notes:** NestJS uses static DI; model modules as Nest dynamic modules registered from a build-time manifest list. Route prefix collisions with tenant slug routes must be prevented by reserved-slug rules (WSP) instead of registration order.

### TW-ADD-012 — Manifest contribution: admin sidebar navigation

- **Status:** partial (the `user` surface and the `after` ordering key are read but unused)
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-ADD-004, TW-ADD-014
- **Summary:** Core asks the registry what navigation active modules add and merges those entries into the admin sidebar's "System" rail without hard-coding any module.
- **Actors & access:** platform admin (sidebar).
- **UX & screens:** `resources/views/components/admin/sidebar.blade.php` iterates `nav('admin')` and appends each entry to the System group at the end; the entry with key `instagram` is deliberately skipped there because Instagram now appears as a card on the Channel Settings hub (`resources/views/admin/settings/channel-setting.blade.php` looks up the `instagram` admin nav item and renders a card linking to its href with an "Add-on" label; when the nav item is absent the card is hidden).
- **Endpoints:** none.
- **Data:** each manifest nav item: `key` (required), `href` (required, app-relative), `label` (translated with the app translator, default = key), `icon` (raw SVG path markup string), `sw` (stroke width, default 1.5), `after` (string, default ""). Items missing key or href are dropped silently.
- **Rules & edge cases:**
  1. `href` is forced app-relative: the leading slash is trimmed and the app URL prefixed, so an absolute URL in a manifest cannot point the nav off-site (it becomes a local path).
  2. Only surfaces `admin` and `user` are addressed by the API; only `admin` is consumed anywhere. `after` is emitted but ignored (entries append in manifest order, modules in load order).
  3. Only active extensions contribute; in practice modules on disk also contribute (TW-ADD-007 QUIRK).
  4. Result is derived from cached manifests (5 min), invalidated on install/uninstall/toggle.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an active module declaring `nav.admin` with key and href, when an admin loads any admin page, then the entry appears at the end of the System rail (except key `instagram`).
  - Given the module is deactivated or removed, when the page reloads, then the entry is gone.
  - Given an item without href, when built, then it is not rendered and no error occurs.
- **Source refs:** app/Services/ExtensionRegistry.php (nav), resources/views/components/admin/sidebar.blade.php, resources/views/admin/settings/channel-setting.blade.php.
- **Port notes:** expose a `NavContribution[]` provider per surface in the shared admin shell; implement the `after` ordering properly if needed, and add a user-surface consumer only if a real module needs it.

### TW-ADD-013 — Manifest contribution: plan feature flags and limits

- **Status:** implemented
- **Priority:** P0 (how a module becomes sellable per plan)
- **Effort:** M
- **Depends on:** TW-ADD-004, TW-PLAN-* (packages form and plan gates)
- **Summary:** Modules declare boolean plan flags and numeric plan limits as data. Core merges them into the plan (package) admin form, the validation whitelist, the mass-assignment list and the billing add-on grant form, so a new module needs no core edit to be gated per plan.
- **Actors & access:** platform admin (package and add-on forms); runtime checks by workspace members through plan gates.
- **UX & screens:** on the package create/edit form (`resources/views/admin/packages/create.blade.php`) each contributed flag becomes a checkbox labelled with the manifest label and placed in a group named by the manifest `group` (default: the module name, else slug); each limit becomes a number input likewise. The group named exactly "Instagram" is pulled out of the generic groups into its own wizard step, shown only when at least one Instagram-group field exists. The billing add-on form (TW-ADD-026) also lists contributed flags and limits.
- **Endpoints:** none of its own (consumed by the package and add-on save endpoints).
- **Data:** `planFeatures()` returns `key => {label (translated), group, extension}`. `planLimits()` returns `key => {label, group, default, hint, extension}` where `default` is an integer or null (null means unlimited, distinct from 0). Manifest input accepts a plain list of keys or a map; empty keys are skipped. Consumers found: label and group only; `default` and `hint` have no consumer in the reviewed views (unused).
- **Rules & edge cases:**
  1. `AdminPagesController::planFeatureToggles()` and `planLimitColumns()` = core constant lists plus contributed keys (deduplicated). Everything downstream reads through these: validation rules, boolean cast, the default-false pass for unsubmitted flags, the checkboxes and the add-on grant whitelist.
  2. `Package::getFillable()` merges contributed keys at runtime so mass assignment does not silently drop them.
  3. The keys must exist as real columns on `packages`. Reference relies on the module's own migration to add them; a contributed key with no column would fail at save time.
  4. Core also hard-codes `access_instagram` in the core toggle list, so Instagram is only half decoupled.
  5. The form double-gate is documented in the code: a key must appear in the group/label arrays AND the column list or it is silently never rendered; the registry merge closes that gap.
  6. Removing/deactivating a module removes its fields from the forms, but plan rows keep their stored values.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an active module declaring a plan flag `access_x`, when an admin opens the package form, then a checkbox for it appears under the declared group and saving persists it.
  - Given the module is deactivated, when the form is opened, then the flag is not rendered and not accepted.
  - Given a module declaring a limit with `default: null`, when read from the registry, then default is null (unlimited) and not 0.
- **Source refs:** app/Services/ExtensionRegistry.php (planFeatures, planLimits), app/Http/Controllers/AdminPagesController.php (planFeatureToggles, planLimitColumns), app/Models/Package.php (getFillable), resources/views/admin/packages/create.blade.php.
- **Port notes:** treat plan flags as a feature registry table or config (`feature_key`, `type`, `label`, `group`, `module`) fed by module manifests; entitlements should read that registry rather than hard-coded columns (PLAN owns the entitlement model).

### TW-ADD-014 — Registry caching and invalidation

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-ADD-005
- **Summary:** The registry is asked on almost every request (sidebar, route registration, plan forms), so its answers are cached and explicitly invalidated when an extension changes. It must also never break boot.
- **Actors & access:** framework-level.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** cache key `extensions.manifests` (active DB manifests keyed by slug, TTL 300 s) and `extension.enabled.<slug>` (boolean, TTL 300 s). Disk manifests are not cached across requests; they are re-scanned (memoised per process only).
- **Rules & edge cases:**
  1. Fail-open on infrastructure problems: if the `extensions` table or its `manifest` column does not exist (fresh install, mid-upgrade) or the cache store itself throws (database cache store before the DB is configured), the registry returns "no contributions" and `Extension::enabled()` returns false. The try/catch wraps the cache call itself, not just the closure.
  2. `Extension::forget(slug)` clears the slug flag and also the manifest cache; `forget()` without a slug clears every slug's flag. It is called after install, uninstall and toggle.
  3. `ExtensionRegistry::manifests()` = DB manifests of ACTIVE rows merged with live disk manifests (disk wins per slug).
  4. `Extension::enabled(slug)` is used by route guards in principle; the only in-tree usage left is a comment in the flow builder view, so it has no real callers (see TW-ADD-015).
- **Async & events:** none.
- **External systems:** cache store (`config/cache.php`, database store by default).
- **Settings:** `CACHE_STORE` in `.env`.
- **Acceptance criteria:**
  - Given a cold app with no database, when any request boots, then the registry returns empty lists and no 500 occurs.
  - Given an extension toggled to disabled, when the next request runs, then its manifest is no longer served from cache.
  - Given an extension installed, when the sidebar renders in the same second, then the new nav entry is already present.
- **Source refs:** app/Services/ExtensionRegistry.php (dbManifests, forget), app/Models/Extension.php (enabled, forget).
- **Port notes:** use Redis with pub/sub invalidation so every API replica drops caches; tenant-independent keys.

### TW-ADD-015 — Dormant plan-feature detection (unused)

- **Status:** dead-code
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-ADD-013
- **Summary:** `isDormantFeature(flag)` was written to fail closed: a plan flag that belongs to a module that is not active should not grant access even if the stored value is true. Nothing calls it.
- **Actors & access:** none (no caller).
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** a flag is dormant when it is neither a core flag nor contributed by an active extension.
- **Rules & edge cases:**
  1. QUIRK: `PlanLimitGuard::hasFeature` and `EnforcePlanFeature` never consult it, so a stale `true` on a plan keeps granting a removed module's flag, contrary to the docblock. The port should apply this rule inside the entitlement check.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a flag contributed only by a deactivated module, when a gate asks about it, then the port's gate answers false regardless of the stored plan value.
  - Given a core flag, when asked, then it is never treated as dormant.
- **Source refs:** app/Services/ExtensionRegistry.php (isDormantFeature), app/Services/PlanLimitGuard.php, app/Http/Middleware/EnforcePlanFeature.php.
- **Port notes:** implement in the entitlement resolver (PLAN) as "module must be enabled".

### TW-ADD-016 — Stale route-cache self-heal on the Extensions page

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-ADD-011
- **Summary:** When production runs with a compiled route cache, an add-on installed afterwards would 404 because the cached table predates its routes. Visiting the Extensions page detects this and clears the route cache once.
- **Actors & access:** platform admin (side effect of opening the page).
- **UX & screens:** invisible; the page redirects to itself with `_healed=1` once, then renders.
- **Endpoints:** GET admin/extensions (see TW-ADD-001).
- **Data:** none.
- **Rules & edge cases:**
  1. Bails immediately when routes are not cached, or no live module exists, or `_healed=1` is present (never loops).
  2. For every live disk module that declares `routes`, it takes each static nav href (query removed; skipped if it is "/" or contains "{"), checks whether that URI is in the compiled route table, and on the first miss runs `route:clear`, logs `[EXTENSION] stale route cache cleared for active module`, and returns true so the controller redirects.
  3. Only disk (`ModuleLoader`) manifests are checked, and only their nav hrefs are used as canaries; a module with routes but no nav is never healed.
- **Async & events:** log line only.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a cached route table missing an active module's nav URL, when the admin opens the page, then the cache is cleared and the page reloads once with `_healed=1`.
  - Given uncached routes, when the page opens, then no redirect occurs.
- **Source refs:** app/Services/ExtensionService.php (healModuleRoutes), app/Http/Controllers/Admin/ExtensionController.php (index).
- **Port notes:** not needed in NestJS (no compiled route cache); note only as a reason to make module enablement dynamic.

### TW-ADD-017 — Connect remote Instagram engine (Instaflow / InstaMagic)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-IG-* (consumes the connection)
- **Summary:** Instagram can run as a separate deployment. The admin saves its base URL, optional display name and a shared secret; the server immediately performs a handshake and records connected / not connected with a reason. No code is uploaded.
- **Actors & access:** platform admin.
- **UX & screens:** Instagram card (gradient icon, title, Connected / Not connected pill, the saved URL in mono, helper text using the configured brand name) with a Connect button (Manage once a URL is saved); when a native add-on folder exists the button is disabled and reads Manage with an explanatory note. Modal fields: deployment URL (type url, required, placeholder like `https://insta.yourdomain.com`), Display name (max 40, default "IgDesk", "shown on every Sync from / Manage on / URL label across the app"), Shared secret (password field; placeholder says one is saved and blank keeps it). Footer: last-checked timestamp, Disconnect (only when a URL exists; skips required-field validation), Cancel, "Save & connect". ESC closes. After a failed submit the modal reopens showing the reason.
- **Endpoints:**

| Method + URI                            | Route name                         | Action                                     | Middleware  | Request                                                                                                                      | Response                                                                                                                                  |
| --------------------------------------- | ---------------------------------- | ------------------------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| POST admin/extensions/instaflow/connect | admin.extensions.instaflow.connect | Admin\ExtensionController@connectInstaflow | admin group | `instaflow_url` required, url, max 255; `instaflow_secret` nullable string max 255; `instaflow_brand` nullable string max 40 | redirect back with flash `status` "<brand> connected." or `error` "<brand> not connected - <reason>." or validation/`instaflow` error bag |

- **Data:** system settings `instaflow_url` (trailing slash trimmed, saved BEFORE the handshake), `instaflow_brand` (blank becomes IgDesk), `instaflow_secret` (encrypted at rest; blank input keeps the previous secret), `instaflow_connected` ('1'/'0', bool), `instaflow_last_check` (server-local datetime string).
- **Rules & edge cases:**
  1. Refused first if the native Instagram add-on folder exists and is not deactivated: error bag key `instaflow` with the "one engine at a time" text (TW-ADD-021).
  2. Handshake: GET `<url>/api/threadwise/handshake` with header `X-Instaflow-Secret`, JSON accept, 12 s timeout. 401/403 gives reason "Secret rejected by <brand> (HTTP n)."; other non-2xx "<brand> returned HTTP n."; 2xx counts as connected only when the JSON has `ok === true` or `service === 'instaflow'`, else "Reached the URL but it did not respond as an <brand> deployment."; any transport exception "Could not reach <brand> at that URL (<message>)." The brand used in messages is the value just saved.
  3. A failed handshake still leaves the URL, brand and any new secret saved and the connected flag off (the card then shows "Not connected"), so the admin can retry with no retyping.
  4. Re-submitting with a blank secret re-tests using the stored secret.
  5. The remote deployment can also flip `instaflow_connected` to 1 by pushing an authenticated inbound event (IG owns that endpoint).
  6. The URL is fetched server-side with no host allowlist (admin-only SSRF surface); http URLs are accepted.
  7. The display name feeds `ig_brand_name()` used in labels across the app (never the literal "Instaflow").
- **Async & events:** audit `admin.instaflow.connect` (subject_type instaflow, result success/failure, meta url and reason).
- **External systems:** the remote Instaflow deployment; contract: GET `/api/threadwise/handshake` returns 200 `{"ok":true,"service":"instaflow",...}` when the header secret matches. Credentials: shared secret in admin settings (encrypted).
- **Settings:** the keys above; `app.url` not used here.
- **Acceptance criteria:**
  - Given a reachable deployment and correct secret, when Save & connect is pressed, then `instaflow_connected` is true, the card shows Connected and a success flash appears.
  - Given a 401 from the remote, when saved, then the card shows Not connected with the "Secret rejected" reason and the URL stays saved.
  - Given a blank secret field and a stored secret, when saved, then the stored secret is reused for the handshake.
  - Given the native Instagram add-on active, when submitted, then no settings are changed and the one-engine error shows.
- **Source refs:** app/Http/Controllers/Admin/ExtensionController.php (connectInstaflow), app/Support/fc_helpers.php (ig_brand_name), app/Models/SystemSetting.php (ENCRYPTED_KEYS), app/Services/Instaflow/InstaflowClient.php, resources/views/admin/extensions/index.blade.php, Documentation/pages/admin-panel/instagram-engine.html.
- **Port notes:** store the URL/secret as platform-level integration settings with the secret in the encrypted secrets store; wrap the handshake in a provider adapter with an SSRF guard (deny private ranges unless explicitly allowed).

### TW-ADD-018 — Disconnect remote Instagram engine

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-ADD-017
- **Summary:** Wipes the saved URL and secret and marks the engine disconnected, which removes Instagram surfaces for every workspace until reconnected.
- **Actors & access:** platform admin.
- **UX & screens:** Disconnect button in the modal (danger style) with a confirm dialog "Disconnect Instagram?" explaining Instagram disappears from dashboard, analytics, inbox, flows, templates and auto-replies for every workspace; confirm label "Yes, disconnect". It posts via the same form using a form-action override and skips required validation.
- **Endpoints:**

| Method + URI                               | Route name                            | Action                                        | Middleware  | Request | Response                                              |
| ------------------------------------------ | ------------------------------------- | --------------------------------------------- | ----------- | ------- | ----------------------------------------------------- |
| POST admin/extensions/instaflow/disconnect | admin.extensions.instaflow.disconnect | Admin\ExtensionController@disconnectInstaflow | admin group | none    | redirect back, flash `status` "<brand> disconnected." |

- **Data:** sets `instaflow_url` = '', `instaflow_secret` = '', `instaflow_connected` = '0', `instaflow_last_check` = now. The brand setting is kept. The flash brand is read raw from the setting (default IgDesk).
- **Rules & edge cases:**
  1. No remote call is made to the deployment.
  2. Per-workspace account mirror rows are not deleted here; they stop counting because the platform link check fails (`WorkspaceIgAccount::hasConnected` requires the platform connection and a connected mirror row).
  3. Idempotent; works even when nothing was connected.
- **Async & events:** audit `admin.instaflow.disconnect`.
- **External systems:** none.
- **Settings:** the keys above.
- **Acceptance criteria:**
  - Given a connected engine, when Disconnect is confirmed, then URL and secret are empty, the flag is off and the card shows Connect.
  - Given the engine disconnected, when a workspace loads its dashboard, then Instagram surfaces are hidden.
  - Given the operation, when it completes, then an audit row exists.
- **Source refs:** app/Http/Controllers/Admin/ExtensionController.php (disconnectInstaflow), app/Models/WorkspaceIgAccount.php.
- **Port notes:** emit a domain event so channel modules (IG) hide surfaces reactively.

### TW-ADD-019 — Connect email engine (MailTrixy)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-MAIL-* (consumes the connection)
- **Summary:** Same shape as the Instagram connect but for the standalone email platform whose mailboxes land in the team inbox: save URL, display name and secret, then handshake through the bridge client.
- **Actors & access:** platform admin.
- **UX & screens:** "Email" card (blue-violet icon), Connected / Not connected pill, URL, helper text; Connect / Manage button; modal with URL (placeholder like `https://mail.yourdomain.com`), Display name (max 40, default MailTrixy, "shown on every email label across the app"), Shared secret, Disconnect, Cancel, "Save & connect". Always enabled (no native email add-on, so no engine guard). Flash uses namespaced keys `mailtrixy_status` and `mailtrixy_error`.
- **Endpoints:**

| Method + URI                            | Route name                         | Action                                     | Middleware  | Request                                                                                                                    | Response                                                                                                                                                                                       |
| --------------------------------------- | ---------------------------------- | ------------------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST admin/extensions/mailtrixy/connect | admin.extensions.mailtrixy.connect | Admin\ExtensionController@connectMailtrixy | admin group | `mailtrixy_url` required url max 255; `mailtrixy_secret` nullable string max 255; `mailtrixy_brand` nullable string max 40 | redirect back with `mailtrixy_status` "<brand> connected." or `mailtrixy_error` "<brand> not connected - Could not verify a <brand> deployment at that URL - check the URL and shared secret." |

- **Data:** settings `mailtrixy_url` (slash trimmed, saved before the handshake), `mailtrixy_brand` (blank becomes MailTrixy), `mailtrixy_secret` (encrypted; blank keeps stored), `mailtrixy_connected`, `mailtrixy_last_check`.
- **Rules & edge cases:**
  1. Handshake goes through `MailtrixyClient`: GET `<url>/api/threadwise/handshake` with `X-Mailtrixy-Secret`, JSON, 15 s timeout; success requires a 2xx and `ok === true` or `service === 'mailtrixy'`. If either URL or secret is empty the client reports false without any request, so a first-time connect with a blank secret always fails.
  2. The failure reason is one generic sentence (the client swallows exceptions), unlike Instagram's specific reasons.
  3. The same client and header authenticate every later call, so "connected" means the real calls work. The reverse channel is an authenticated inbound endpoint on Reference (MAIL owns it) that also sets the connected flag.
  4. Display name feeds `mailtrixy_brand_name()`.
- **Async & events:** audit `admin.mailtrixy.connect` (result, meta url, reason).
- **External systems:** MailTrixy deployment contract: `/api/threadwise/handshake`, `/api/threadwise/accounts`, `/api/threadwise/reply`, `/api/threadwise/send` (only handshake is used by this feature; the rest belong to MAIL).
- **Settings:** the keys above.
- **Acceptance criteria:**
  - Given a reachable MailTrixy and matching secret, when saved, then the card shows Connected and the success flash shows on the email card only.
  - Given a wrong secret, when saved, then the error flash shows on the email card, the Instagram card is unaffected, and the modal reopens.
  - Given a blank secret and none stored, when saved, then the connect fails without any outbound request.
- **Source refs:** app/Http/Controllers/Admin/ExtensionController.php (connectMailtrixy), app/Services/Mailtrixy/MailtrixyClient.php, app/Support/fc_helpers.php (mailtrixy_brand_name), resources/views/admin/extensions/index.blade.php.
- **Port notes:** implement as a `provider-adapter` for the email engine with a `handshake()` on the port; store credentials in the platform secrets store.

### TW-ADD-020 — Disconnect email engine

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-ADD-019
- **Summary:** Clears the saved email engine connection so mail stops landing in the team inbox for every workspace.
- **Actors & access:** platform admin.
- **UX & screens:** Disconnect button in the modal with confirm "Disconnect email?" (mail stops landing in the team inbox for every workspace until reconnect).
- **Endpoints:**

| Method + URI                               | Route name                            | Action                                        | Middleware  | Request | Response                                                        |
| ------------------------------------------ | ------------------------------------- | --------------------------------------------- | ----------- | ------- | --------------------------------------------------------------- |
| POST admin/extensions/mailtrixy/disconnect | admin.extensions.mailtrixy.disconnect | Admin\ExtensionController@disconnectMailtrixy | admin group | none    | redirect back, flash `mailtrixy_status` "<brand> disconnected." |

- **Data:** sets `mailtrixy_url` '', `mailtrixy_secret` '', `mailtrixy_connected` '0', `mailtrixy_last_check` now; brand retained.
- **Rules & edge cases:** no remote call; idempotent; workspace mailbox links are untouched here (their availability follows the platform flag).
- **Async & events:** audit `admin.mailtrixy.disconnect`.
- **External systems:** none.
- **Settings:** keys above.
- **Acceptance criteria:**
  - Given a connected engine, when Disconnect is confirmed, then settings are cleared and the card shows Connect.
  - Given the disconnect, when a workspace opens the email surfaces, then they are unavailable (`WorkspaceEmailAccount` checks the platform flag).
  - Given the action, then an audit row exists.
- **Source refs:** app/Http/Controllers/Admin/ExtensionController.php (disconnectMailtrixy), app/Models/WorkspaceEmailAccount.php.
- **Port notes:** as TW-ADD-018.

### TW-ADD-021 — One Instagram engine at a time (native vs remote guards)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-ADD-005, TW-ADD-017
- **Summary:** Two Instagram engines (the native `instagram` add-on and the remote Instaflow) must never both own the webhook and UI, so each side of the connect/install flow refuses while the other is active.
- **Actors & access:** platform admin.
- **UX & screens:** Instagram card shows "Blocked - native add-on active" and a disabled Manage button with a note; upload returns the refusal message; connect returns the error bag `instaflow`.
- **Endpoints:** enforced inside POST admin/extensions/upload (TW-ADD-003) and POST admin/extensions/instaflow/connect (TW-ADD-017).
- **Data:** disk (`addon/instagram/`, `.disabled` marker) and settings `instaflow_url`, `instaflow_connected`, `instaflow_brand`, `app.url`.
- **Rules & edge cases:**
  1. Connect refused when `addon/instagram/` exists and the module is not deactivated.
  2. Install refused when the package slug is `instagram` and a REMOTE engine is connected (rules in TW-ADD-003 rule 2); the native add-on's own self-wired URL (host equal to the app host, localhost or 127.0.0.1) never blocks.
  3. A deactivated native add-on no longer owns the engine, so the remote can be connected without deleting files.
  4. QUIRK: the view's "blocked" state and disabled button test only that the `addon/instagram` folder exists, ignoring the `.disabled` marker, while the controller correctly ignores a deactivated module. A deactivated native add-on therefore still shows the card as blocked although the server would accept the connect. The port should use one shared predicate.
  5. The slug `instagram` is special-cased in core (identifier coupling that the registry otherwise avoids).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** as listed.
- **Acceptance criteria:**
  - Given native Instagram active, when connecting a remote engine, then it is refused and nothing is saved.
  - Given a remote engine on an external host connected, when installing the Instagram package, then it is refused with the disconnect-first message.
  - Given the native add-on deactivated, when connecting a remote engine, then the server accepts it.
- **Source refs:** app/Http/Controllers/Admin/ExtensionController.php (connectInstaflow, upload), resources/views/admin/extensions/index.blade.php, Documentation/pages/admin-panel/instagram-engine.html.
- **Port notes:** represent "active Instagram engine" as a single platform setting with values none, native, remote and enforce transitions in one service.

### TW-ADD-022 — Boot-time teardown when the native Instagram folder disappears

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-ADD-021
- **Summary:** The native Instagram add-on is "a plug": folder present means the feature is on. When the folder is gone (deleted by hand, or ZIP uninstall) while the platform still believes native mode is on, the app tears the wiring down on the next web request so the UI does not show dead Instagram surfaces.
- **Actors & access:** framework-level (runs in the application service provider on non-console requests).
- **UX & screens:** Instagram surfaces vanish from dashboard, inbox, flows, templates.
- **Endpoints:** none.
- **Data:** setting `instagram_enabled` (native flag), `instaflow_url`, `instaflow_connected`, table of workspace Instagram account mirror rows (`WorkspaceIgAccount`); the real token store (`instagram_accounts`) is left intact.
- **Rules & edge cases:**
  1. Trigger: not running in console AND `instagram_enabled` truthy AND `addon/instagram` directory missing.
  2. Always clears `instagram_enabled` to 0.
  3. Native self-wire detection: teardown of the connection flag and mirror rows happens only if `instaflow_url` is empty, or its host is empty, equals the app host, `127.0.0.1` or `localhost`. A genuinely remote URL is preserved so a remote engine keeps working.
  4. Errors are swallowed to the PHP error log; dropping the folder back in rebuilds the mirrors on the next settings visit.
  5. Self-limiting: the block clears `instagram_enabled` itself, so the condition stops holding after the first request; there is no lock, so two simultaneous first requests may both run the teardown (harmless, idempotent).
- **Async & events:** log `[IG-ADDON]` lines.
- **External systems:** none.
- **Settings:** `instagram_enabled`, `instaflow_*`.
- **Acceptance criteria:**
  - Given native mode on and the folder deleted, when the next web request runs, then `instagram_enabled` is 0 and the self-wired connection flag and mirror rows are cleared.
  - Given a remote connection on an external host, when the folder is missing, then only the native flag is cleared.
  - Given console execution, when the provider boots, then nothing changes.
- **Source refs:** app/Providers/AppServiceProvider.php (Instagram reconcile block), app/Models/WorkspaceIgAccount.php.
- **Port notes:** replace with an explicit module-disabled event handler owned by IG rather than boot-time reconciliation.

### TW-ADD-023 — Audit trail for extension admin actions

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-NOTIF-*
- **Summary:** Every state-changing admin action in this domain writes a platform-layer audit row; secrets are never included.
- **Actors & access:** written by the controller; read by the audit log page (NOTIF).
- **UX & screens:** rows appear in the admin audit log.
- **Endpoints:** all mutating endpoints of TW-ADD-002, 003, 007, 008, 010, 017, 018, 019, 020.
- **Data:** action names (prefix `admin.` puts the row on the platform layer): `admin.extension.verify` (result, meta outcome), `admin.extension.installed` (meta slug, version, files), `admin.extension.enabled`, `admin.extension.disabled` (subject id, meta slug), `admin.extension.uninstalled` (meta slug, removed), `admin.module.enabled`, `admin.module.disabled` (meta slug), `admin.instaflow.connect` / `.disconnect`, `admin.mailtrixy.connect` / `.disconnect` (subject_type as product, result, meta url and reason on connect).
- **Rules & edge cases:**
  1. `Audit::log(action, opts)` takes subject, result and meta INSIDE the options array (a code comment records that positional extras cause a TypeError).
  2. The audit helper scrubs secret-looking meta keys as defence in depth.
  3. Billing add-on CRUD (TW-ADD-025 to 030) writes NO audit row of its own; only the model's generic created/updated/deleted notification hook fires on `Package`.
- **Async & events:** audit writes are synchronous.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an install, when it succeeds, then one `admin.extension.installed` row exists with slug, version and file count.
  - Given a failed connect, when it completes, then the row has result failure and the reason in meta but no secret.
  - Given billing add-on edits, when saved, then no admin audit row is expected (parity), though the port may add one.
- **Source refs:** app/Http/Controllers/Admin/ExtensionController.php, app/Support/Audit.php.
- **Port notes:** use the platform audit+outbox pattern in the same transaction; adding audit rows for add-on CRUD would be a deliberate improvement.

### TW-ADD-024 — Discoverability: settings hub tile, cross-link banners, sidebar entry

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-ASHELL-*
- **Summary:** The two "add-on" pages are reached differently and link to each other so operators do not confuse code add-ons with billing add-ons.
- **Actors & access:** platform admin.
- **UX & screens:** Settings hub header button "Add-ons" (before "Updater") links to the extensions page (`resources/views/admin/settings/index.blade.php`); a banner on the extensions page links to billing add-ons; the billing add-ons sidebar item (key `addons`, "Add-ons", with a count badge equal to the number of add-on packages, hidden when zero) lives in the Billing and plans group after Packages and before Coupons; the code-extensions page has no sidebar item.
- **Endpoints:** none.
- **Data:** count of `packages` with `type='addon'`.
- **Rules & edge cases:** Both pages carry the title "Add-ons"; the code-installer breadcrumb is under Settings, the billing one under Admin > Billing & plans.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the sidebar, when there are 3 add-on packages, then the item shows badge 3.
  - Given the settings hub, when an admin clicks Add-ons, then they land on `/admin/extensions`.
  - Given either page, then a link to the other page exists.
- **Source refs:** resources/views/components/admin/sidebar.blade.php, resources/views/admin/settings/index.blade.php, resources/views/admin/extensions/index.blade.php, resources/views/admin/addons/index.blade.php.
- **Port notes:** name them distinctly in the port (Modules vs Add-on packs) to avoid the Reference ambiguity.

### TW-ADD-025 — Billing add-on catalog list (admin)

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-ADD-028
- **Summary:** Admin table of every billing add-on pack with price, period, a summary of what it grants, status and row actions.
- **Actors & access:** platform admin (admin group middleware; no permission key, no plan gate).
- **UX & screens:** `resources/views/admin/addons/index.blade.php` (layout `x-layouts.admin`, admin-key `addons`, page `addons-index`). Header breadcrumb Admin > Add-ons; eyebrow "Admin - Billing and plans - Add-ons"; headline "Add-ons"; blurb explaining a-la-carte packs merged onto the customer's plan and shown on the customer Account page once they are on an active plan; "New add-on" button; shared flash banner (accepts `status` or `success`). Table columns: Name (bold pname, subtitle underneath), Price (right aligned, mono; the offer price when a valid offer exists, else the price; formatted with the currency formatter using the viewer's workspace or platform default currency symbol, WITHOUT converting from the add-on's own currency, so an add-on priced in INR shows the raw number with the admin's currency symbol), Period ("one-time" when lifetime, else `<duration> <unit>` with defaults 1 and "month"), Grants, Status pill (Active / Off), Actions (Edit, Enable/Disable, Delete). Grants column: up to 4 chips then "+N"; empty shows "nothing set". Empty table: "No add-ons yet." with link "Create your first add-on".
- **Endpoints:**

| Method + URI     | Route name         | Action                       | Middleware                                   | Request | Response |
| ---------------- | ------------------ | ---------------------------- | -------------------------------------------- | ------- | -------- |
| GET admin/addons | admin.addons.index | Admin\AddonsController@index | Authenticate, EnsureUserIsAdmin, IPAllowlist | none    | HTML     |

- **Data:** `packages` where `type='addon'`, ordered by `sort_order` asc then `plan_amount` asc; no pagination or search; featureCatalog labels from `Package::featureCatalog()`.
- **Rules & edge cases:**
  1. QUIRK: the Grants chips are computed from the RAW package columns, not from `grants_json`. Features show only if their mirrored boolean column is true AND the flag is in the feature catalog's capability list; limits show only when the raw limit column is non-zero. Because the add-on form leaves limit columns at 0 and stores boosts only in `grants_json`, limit boosts never appear in this column (customer-facing lists read `grants_json` correctly). Flags outside the catalog list (for example channel flags for LINE, WeChat or Viber, or a module's own flags) also never show, so a valid add-on can read "nothing set".
  2. The price cell honours the offer price via `chargeableAmount()` (0 when the package is flagged free or priced 0).
  3. The route comment in `routes/admin.php` says create/edit reuse the plan form; that is stale, add-ons have their own form.
  4. Sidebar badge counts add-on packages (TW-ADD-024).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** platform currency formatting settings (SET) via the formatter.
- **Acceptance criteria:**
  - Given three add-ons, when the admin opens the page, then they are ordered by sort order then price and each shows its status pill.
  - Given no add-ons, when the page opens, then the empty state and create link show.
  - Given an add-on granting only limit boosts, when listed, then (parity) the Grants column shows "nothing set"; the port may correct this by reading `grants_json`.
- **Source refs:** app/Http/Controllers/Admin/AddonsController.php (index), resources/views/admin/addons/index.blade.php, app/Models/Package.php (scopeAddons, chargeableAmount, featureCatalog), routes/admin.php (addons group), Documentation/pages/admin-panel/addons.html.
- **Port notes:** the add-on pack is a `plan`-like catalog entity in billing (`apps/api/src/modules/billing`); prefer a dedicated `addon_packs` table (grants JSONB, price, cycle) over the `packages.type` discriminator, but keep an id stable for orders. Fix the Grants summary to read grants.

### TW-ADD-026 — Billing add-on create form

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-ADD-013
- **Summary:** A dedicated form (separate from the plan form) where the admin names and prices an add-on and ticks exactly what it grants. Anything left blank grants nothing, which fixes the earlier bug where a shared plan form coerced blank limits to 0 (unlimited).
- **Actors & access:** platform admin.
- **UX & screens:** `resources/views/admin/addons/form.blade.php` (page `addons-form`). Header: breadcrumb Admin > Add-ons > New, Cancel and "Create add-on" buttons (the header button submits the form by id). Error box "Please fix the following:" with a bullet list. Section 01 "Add-on basics" (required): Name (required, placeholder "Campaigns add-on"), Subtitle, Price (required number, step 0.01, min 0), Offer price (optional, step 0.01, min 0), Currency select (all ACTIVE currencies ordered by code, "CODE - Name"), Duration (required integer, min 1, default 1), Unit (Days / Weeks / Months / Years, default Months), Sort order (min 0, default 0), checkboxes Active (default ON) and Lifetime (one-time). Section 02 "Features this add-on unlocks": a 3-column grid of checkboxes, one per plan feature toggle (core list plus module-contributed flags), each labelled with a prettified key (strip a leading `access_` or `integration_`, drop `_limit`, turn `_monthly` into " / month", underscores to spaces, title case). Section 03 "Limit boosts" (optional): one number input per limit column, min -1, placeholder dash; helper text: blank means untouched, a number ADDS on top of the plan (for example +2 devices), -1 means unlimited. Footer repeats Cancel and Create add-on.
- **Endpoints:**

| Method + URI            | Route name          | Action                        | Middleware  | Request | Response          |
| ----------------------- | ------------------- | ----------------------------- | ----------- | ------- | ----------------- |
| GET admin/addons/create | admin.addons.create | Admin\AddonsController@create | admin group | none    | HTML form (empty) |

- **Data:** reads active `currencies` (`code`, `name`, `symbol`, `is_active`), `AdminPagesController::planFeatureToggles()` and `planLimitColumns()`.
- **Rules & edge cases:**
  1. No `detail` (long description) input is rendered even though the save path validates one (see TW-ADD-028 QUIRK), and no CTA label input exists.
  2. Old input is re-populated after a validation failure.
  3. Currency has no blank option, so the first active currency is selected by default; if there are no active currencies the select is empty and saving fails validation.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** currency list is admin-managed (CPN).
- **Acceptance criteria:**
  - Given the create form, when opened, then Active is ticked, duration is 1, unit is Months and every feature and limit is blank.
  - Given a module that contributes a flag, when the form is opened, then the flag appears in section 02.
  - Given a validation error on submit, when the page reloads, then the entered values are preserved and errors listed.
- **Source refs:** app/Http/Controllers/Admin/AddonsController.php (create, form, labels), resources/views/admin/addons/form.blade.php.
- **Port notes:** Next.js form with the shared zod schema from `@crm/contracts`; fetch the feature registry and limit registry from the API instead of hard-coded arrays.

### TW-ADD-027 — Billing add-on edit form

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-ADD-026
- **Summary:** Same form pre-filled with the add-on's stored values and its current grants ticked.
- **Actors & access:** platform admin.
- **UX & screens:** as TW-ADD-026 with title "Edit add-on", buttons "Save changes"; grants pre-selected from `grants_json.features` and `grants_json.limits`; the form posts as PUT.
- **Endpoints:**

| Method + URI               | Route name        | Action                      | Middleware  | Request                  | Response                                                        |
| -------------------------- | ----------------- | --------------------------- | ----------- | ------------------------ | --------------------------------------------------------------- |
| GET admin/addons/{id}/edit | admin.addons.edit | Admin\AddonsController@edit | admin group | path `id` (numeric only) | HTML form; 404 if the id is not an add-on (a plan id also 404s) |

- **Data:** the `packages` row (`type='addon'`); `grants_json` shape `{features: string[], limits: {key: int}}`; non-array values are treated as empty.
- **Rules & edge cases:**
  1. Legacy add-on rows with no `grants_json` show every grant unticked/blank even though runtime falls back to the raw columns (TW-ADD-031), so saving such a row without re-ticking silently converts it to an empty add-on.
  2. `plan_id` is immutable on edit.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an add-on granting two features and +2 devices, when edited, then those checkboxes are ticked and the device limit shows 2.
  - Given the id of a normal plan, when requested, then 404.
  - Given the edit form, when saved unchanged, then grants are unchanged.
- **Source refs:** app/Http/Controllers/Admin/AddonsController.php (edit), resources/views/admin/addons/form.blade.php.
- **Port notes:** migrate legacy raw-column grants into the new grants structure once, at import time, to avoid the blank-edit pitfall.

### TW-ADD-028 — Save billing add-on (create and update) with grants normalisation

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-ADD-026
- **Summary:** One handler creates (POST) or updates (PUT) an add-on, validates it, whitelists the submitted grants against the real feature and limit key lists, stores them as `grants_json`, and mirrors granted feature flags onto their raw boolean columns.
- **Actors & access:** platform admin.
- **UX & screens:** redirects to the list with flash "Add-on created." or "Add-on updated."; validation errors return to the form.
- **Endpoints:**

| Method + URI          | Route name          | Action                       | Middleware  | Request                 | Response                                 |
| --------------------- | ------------------- | ---------------------------- | ----------- | ----------------------- | ---------------------------------------- |
| POST admin/addons     | admin.addons.store  | Admin\AddonsController@store | admin group | see rules               | 302 to admin.addons.index with `success` |
| PUT admin/addons/{id} | admin.addons.update | Admin\AddonsController@store | admin group | same, path `id` numeric | same; 404 if not an add-on               |

- **Data:** writes `packages`: `type='addon'`, `plan_id`, `pname`, `subtitle`, `detail`, `plan_amount`, `offer_price`, `currency`, `plan_unit`, `plan_duration`, `lifetime`, `status`, `sort_order`, `grants_json`, plus every feature-toggle column set true/false. Limit columns are not touched (0 on create).
- **Rules & edge cases:**
  1. Validation: `pname` required string max 120; `subtitle` nullable max 191; `detail` nullable max 2000; `plan_amount` required numeric min 0; `offer_price` nullable numeric min 0 and strictly less than `plan_amount` (message "The offer price must be lower than the price."); `currency` required string max 8 (NOT checked against active currencies); `plan_unit` required in days, weeks, months, years; `plan_duration` required integer min 1; `lifetime` and `status` nullable boolean; `sort_order` nullable integer min 0; `features` nullable array of strings; `limits` nullable array whose values are nullable integers min -1.
  2. Feature whitelist: submitted feature keys are intersected with the current feature-toggle list (core plus module flags); unknown keys are dropped silently (forged keys cannot smuggle in bogus features).
  3. Limit rules: only whitelisted limit keys; blank or null skipped; `0` skipped ("0 is treated as blank so it never leaks"); -1 = grant unlimited for that key; any positive integer = add N. `-1` is the only negative allowed by validation.
  4. `status` and `lifetime` are read as booleans from the request, so an unchecked box means false (an add-on is inactive unless Active is ticked). Lifetime keeps duration fields required (validated but ignored at purchase).
  5. `plan_id` on create: slug of the name with underscores (fallback "addon"), made unique by appending `_2`, `_3`, ... against ALL packages (plans included); the check is not atomic, a race hits the unique index and 500s. On update the stored `plan_id` is kept.
  6. QUIRK: `detail` is validated and written (`null` when absent), but the form has no `detail` input, so every save through the UI clears an existing detail text.
  7. Free-of-charge handling: there is no free flag on the form; a price of 0 behaves as free through `chargeableAmount()` and the customer views.
  8. Feature flag columns are mirrored so legacy readers of the raw column still see grants; limit columns are not, and `grants_json` is authoritative for both.
  9. Package model events fire the generic created/updated notification hook (NOTIF); no admin audit row.
- **Async & events:** notification hook on model create/update; no queue.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given name "Campaigns add-on", price 10, offer 12, when saved, then it is rejected with the offer-price message.
  - Given features `[autoflow, bogus_key]` and limits `{device_limit: 2, tags_limit: 0, chat: 5}`, when saved, then `grants_json` is `{features:[autoflow], limits:{device_limit:2}}`.
  - Given two add-ons named "Extra number", when the second is created, then its `plan_id` is `extra_number_2`.
  - Given an existing add-on, when updated, then `plan_id` and `type` are unchanged and the redirect shows "Add-on updated."
- **Source refs:** app/Http/Controllers/Admin/AddonsController.php (store), app/Models/Package.php (fillable, casts, LogsNotifications), app/Models/Concerns/LogsNotifications.php.
- **Port notes:** validate with a shared zod schema; enforce the offer<price rule and the grants whitelist server-side; make slug generation transactional or use a surrogate key; keep the "blank means not granted, -1 unlimited" semantics.

### TW-ADD-029 — Enable / disable a billing add-on

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-ADD-025
- **Summary:** Flips the add-on's `status`; a disabled add-on can no longer be bought and disappears from customer catalogs, but workspaces that already own it keep it.
- **Actors & access:** platform admin.
- **UX & screens:** Enable/Disable button per row (plain POST form with CSRF, no confirm); flash "Add-on enabled." or "Add-on disabled." and back to the referrer.
- **Endpoints:**

| Method + URI                  | Route name          | Action                        | Middleware  | Request           | Response      |
| ----------------------------- | ------------------- | ----------------------------- | ----------- | ----------------- | ------------- |
| POST admin/addons/{id}/toggle | admin.addons.toggle | Admin\AddonsController@toggle | admin group | path `id` numeric | redirect back |

- **Data:** `packages.status` (tinyint, default 1).
- **Rules & edge cases:**
  1. Customer account tab, pricing page and checkout `show` only consider `status = 1`; a disabled add-on's checkout URL returns 404 (`findOrFail` with the status filter).
  2. `Workspace::activeAddonPackages()` does not check the package status, so existing purchases keep granting after the admin disables the add-on.
  3. Not found or not an add-on gives 404.
- **Async & events:** model update notification hook.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an active add-on, when disabled, then it vanishes from Account > Add-ons and Pricing but remains in the admin list as Off.
  - Given a workspace that owns it, when the admin disables it, then the workspace's entitlements are unchanged.
  - Given a disabled add-on, when a customer opens its checkout URL, then 404.
- **Source refs:** app/Http/Controllers/Admin/AddonsController.php (toggle), app/Http/Controllers/CheckoutController.php (show), app/Models/Workspace.php (activeAddonPackages).
- **Port notes:** keep "can be sold" separate from "still entitled".

### TW-ADD-030 — Delete a billing add-on

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-ADD-025
- **Summary:** Permanently deletes the add-on package row.
- **Actors & access:** platform admin.
- **UX & screens:** Delete button per row with a confirm dialog ("Delete this add-on? Workspaces that bought it keep it until it expires."); flash "Add-on deleted." and redirect to the list.
- **Endpoints:**

| Method + URI             | Route name           | Action                         | Middleware  | Request           | Response    |
| ------------------------ | -------------------- | ------------------------------ | ----------- | ----------------- | ----------- |
| DELETE admin/addons/{id} | admin.addons.destroy | Admin\AddonsController@destroy | admin group | path `id` numeric | 302 to list |

- **Data:** hard delete from `packages` (the model has no soft deletes); `workspace_addons` rows are NOT removed and there is no foreign key.
- **Rules & edge cases:**
  1. QUIRK: the confirm text is wrong. `Workspace::activeAddonPackages()` loads each active `workspace_addons` row with its package and drops rows whose package is null, so deleting a purchased add-on immediately removes its grants from every workspace that bought it, while the orphan rows stay. Historical orders still reference the id.
  2. No guard against deleting an add-on that has active purchases.
  3. 404 when the id is not an add-on.
- **Async & events:** model deleted notification hook.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an add-on with no purchases, when deleted, then it is removed from the list and the flash appears.
  - Given an add-on owned by a workspace, when deleted, then (parity) the workspace loses the grants at once; the port should instead block deletion or soft-delete and honour existing purchases as the UI text promises.
  - Given an id that is a plan, when DELETE is sent to this route, then 404.
- **Source refs:** app/Http/Controllers/Admin/AddonsController.php (destroy), app/Models/Workspace.php, app/Models/WorkspaceAddon.php.
- **Port notes:** use soft delete/archive so entitlements survive; that resolves the confirm-text contradiction.

### TW-ADD-031 — Add-on entitlement merge into workspace limits

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-ADD-032
- **Summary:** Every plan gate resolves a workspace's effective value for a feature flag or numeric limit through `Workspace::effectiveLimit`. Active add-ons are merged onto the base plan: any granting add-on turns a boolean feature on, and granted numeric deltas add to the plan value, with -1 meaning unlimited.
- **Actors & access:** every plan-gated action by workspace members (`PlanLimitGuard`, `EnforcePlanFeature`, sidebar gating).
- **UX & screens:** none directly; surfaces as unlocked features and higher caps.
- **Endpoints:** none.
- **Data:** reads `workspace_addons` (active, unexpired) joined to `packages` (`grants_json`, legacy raw columns).
- **Rules & edge cases:**
  1. Resolution order: per-workspace `plan_overrides[key]` wins outright (over plan and add-ons); then workspaces owned by a platform admin get every boolean true and every numeric cap -1 (add-ons irrelevant); then base value from the billing package (or fallback); then add-ons.
  2. Boolean base: any active add-on whose grants list the key returns true. Unlisted keys grant nothing.
  3. Integer base: collect the base plus every active add-on's declared delta for that key (a key the add-on does not declare returns null and is ignored); if any value is -1 the result is -1; otherwise if at least one delta exists the result is the SUM; otherwise the base.
  4. QUIRK: consumers treat 0, null and negative limits as unlimited (`PlanLimitGuard::check` returns early for `<= 0`), and plans use 0 for unlimited. With a base of 0 and an add-on delta of +2 the sum is 2, so buying a boost on an unlimited plan LOWERS the effective limit to 2. Base null (unlimited) ignores add-ons. The port should treat unlimited as absorbing.
  5. `grantsFeature` and `grantLimit` read `grants_json` when it exists. For legacy add-on rows with no `grants_json` they fall back to the raw column: feature true if the column is truthy, limit only when the raw value is greater than 0 (0 was "blank", not a grant).
  6. "Active" means status `active` and (`ends_at` null or in the future) evaluated at read time; there is no sweeper that flips rows to `expired`.
  7. Results are cached per request per workspace in a static array (stale within a long-running worker process; the port must not cache across requests without invalidation).
  8. Per-workspace limits usage (quota ledger) is unaffected by add-ons except through the higher cap.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a plan with `access_campaigns` false and an active add-on granting it, when the gate is checked, then it passes.
  - Given plan device_limit 3 and two active add-ons granting +1 and +2, when resolved, then the limit is 6.
  - Given any active add-on granting -1 for a key, when resolved, then the result is -1 (unlimited).
  - Given an add-on whose `ends_at` passed, when resolved, then it contributes nothing.
  - Given `plan_overrides` with the key, when resolved, then the override is returned regardless of add-ons.
- **Source refs:** app/Models/Workspace.php (effectiveLimit, activeAddonPackages, ownedByPlatformAdmin), app/Models/Package.php (grantsFeature, grantLimit, isStackable), app/Services/PlanLimitGuard.php, app/Http/Middleware/EnforcePlanFeature.php.
- **Port notes:** implement in the entitlement resolver in billing (PLAN owns limits); add contract tests for the merge matrix; decide unlimited semantics explicitly (use null or -1 consistently).

### TW-ADD-032 — Add-on purchase fulfilment (workspace_addons row)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-CHK-_, TW-PLAN-_, TW-PAYGW-*
- **Summary:** When an order for an add-on package is confirmed paid, a `workspace_addons` row is created for the buying workspace, granting the add-on on top of the current plan without changing the plan or the trial.
- **Actors & access:** workspace owner buying through checkout; gateway confirmation paths call the shared `finalizeOrder` (CHK owns the flow).
- **UX & screens:** add-on checkout reuses the plan checkout page `user.checkout.show` (routes owned by CHK): add-ons are never billed yearly (billing period is forced to monthly for add-ons), the downgrade guard does not apply to them, and the price is the offer price when present, converted from the add-on currency to the checkout currency.
- **Endpoints:** none owned here (checkout routes belong to CHK/PLAN).
- **Data:** creates `workspace_addons`: `workspace_id`, `package_id` (the add-on package id, not the slug), `order_id`, `status='active'`, `starts_at=now`, `ends_at`. The end date is null when the package is free, lifetime or custom quote; otherwise `now + max(1, plan_duration)` in `plan_unit` (`days`, `weeks`, `years`; anything else counts as months).
- **Rules & edge cases:**
  1. Runs inside the order-finalisation transaction and is idempotent because `finalizeOrder` returns early when the order is already `paid`.
  2. The package is resolved by `plan_id` slug first, then numeric id.
  3. An add-on purchase does not touch the workspace's plan, trial state or plan end date.
  4. Each purchase adds a NEW row; buying the same add-on twice stacks (limits add up), and a feature-only add-on bought twice simply has two rows. The one-time rule for feature packs is enforced only in the UI (TW-ADD-033), not on the server.
  5. QUIRK: the "must be on an active paid plan" gate exists only in the account view (`hasActivePlan`); the checkout page and the fulfilment do not enforce it, so a direct checkout URL works for a free/expired workspace.
  6. The `cancelled` and `expired` status values mentioned in the migration are never written; there is no cancel, refund or expiry job for add-on rows (expiry is evaluated at read time).
  7. Admin order approval for offline payments (OrderHistory approve) also ends in `finalizeOrder` (CHK).
- **Async & events:** none specific; order paid events belong to CHK.
- **External systems:** payment gateways (PAYGW).
- **Settings:** none specific (pricing yearly toggles do not apply).
- **Acceptance criteria:**
  - Given a paid order for a 1-month add-on, when finalised, then one active `workspace_addons` row exists ending one month from now and the workspace plan is unchanged.
  - Given a lifetime add-on, when finalised, then `ends_at` is null.
  - Given the finalise step runs twice for the same order, when re-run, then no second row is created.
- **Source refs:** app/Http/Controllers/CheckoutController.php (finalizeOrder add-on branch, billingPeriodFor, show), app/Models/WorkspaceAddon.php, database/migrations/2026_06_18_000200_create_addon_packages_and_retention.php.
- **Port notes:** implement as a handler on the `order.paid` event in billing; store starts/ends and the source order; add server-side guards (active plan, one-time packs) that Reference only has in the UI, if product wants them.

### TW-ADD-033 — Customer-facing add-on catalog and owned state

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-ADD-031, TW-ADD-032
- **Summary:** Workspace owners see active add-ons on the Account "Add-ons" tab and, publicly, in an add-ons section on the Pricing page, with what each grants and whether they already own it.
- **Actors & access:** workspace owner on Account tab (requires login); anyone on the pricing page. Routes and controllers belong to PLAN (`AccountController`, `PricingController`, `CheckoutController`); this entry records the add-on specific behavior.
- **UX & screens:** `resources/views/user/account/index.blade.php` "addons" pane: when the workspace has no active paid plan the pane shows "Add-ons need an active plan" (active means a billing package that is not free AND the plan not expired); otherwise a "Your add-ons" list (active unexpired purchases newest first with "Ends <date>" or "Lifetime" and an Active pill) and a grid of buyable add-ons: name, subtitle, price (Free when free or 0, else the offer-aware price) and period ("one-time" or "/ <unit>"), up to 5 grant bullets, and a button. Button rules: a feature-only add-on already owned shows a green "Active" state instead of a button; a stackable add-on (its grants include any limit) shows "Buy again" plus "Owned x N - buying again adds more"; otherwise the button label is the add-on's `cta_label` (never set by the admin form) or "Add to plan". Buttons link to `user.checkout.show/<package id>`. Pricing page (`resources/views/pricing/index.blade.php`) lists add-ons in a separate section with the same grant summary ("Unlimited <limit>" for -1, "+N <limit>" for positives) and no owned state.
- **Endpoints:** none owned here (`GET account` tab, pricing page, checkout are PLAN/CHK).
- **Data:** active add-on packages (`status = 1`, ordered by `sort_order`, `plan_amount`); the workspace's active `workspace_addons` with packages; owned counts grouped by package id.
- **Rules & edge cases:**
  1. Grant bullets come from `grantsFeature` / `grantLimit` filtered through the feature catalog (`Package::featureCatalog()` capability and limit label lists), so keys outside the catalog never display.
  2. Stackable = `grants_json.limits` non-empty (legacy fallback: any raw limit column above 0).
  3. Account list is capped implicitly by the number of add-on packages; no pagination.
  4. Currency shown is formatted by the platform formatter (see TW-ADD-025 quirk about conversion).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** pricing page toggles (yearly, refund) do not apply to add-ons.
- **Acceptance criteria:**
  - Given a workspace on a free plan, when it opens Account > Add-ons, then only the "need an active plan" message shows.
  - Given a paid workspace that owns a feature-only add-on, when the tab renders, then that card shows Active with no buy button.
  - Given a stackable add-on already owned twice, when rendered, then the card shows "Buy again" and "Owned x2".
- **Source refs:** app/Http/Controllers/AccountController.php, app/Http/Controllers/PricingController.php, resources/views/user/account/index.blade.php, resources/views/pricing/index.blade.php, app/Models/Package.php (featureCatalog, isStackable).
- **Port notes:** build under the customer billing UI (`apps/web`) and public pricing; gate visibility by plan state on the server, not just in the view.

### TW-ADD-034 — Browser-extension API token store (data model only)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-EXT-*
- **Summary:** The Reference Chrome extension (a third meaning of "extension") logs in with email and password and receives a bearer token. This domain owns the token model and table because they carry the name; the login, logout and data endpoints belong to the chrome-extension domain (EXT).
- **Actors & access:** browser-extension users; middleware `ExtensionApiAuth` resolves the bearer token (EXT).
- **UX & screens:** none in this domain.
- **Endpoints:** none owned (`ext.*` routes under `api/` go to EXT: login, logout, app-config, attributes, credits, contacts CSV, devices, templates, message history, quick send).
- **Data:** `extension_api_tokens`: `user_id` (FK users, cascade delete), `token_hash` (sha256 hex, unique), `label` (login uses "browser-extension"), `last_used_at`, `expires_at` (nullable), timestamps.
- **Rules & edge cases:**
  1. The plaintext token is 60 random characters, returned once at login and never stored; only its sha256 is stored, so a DB leak cannot be replayed and one user can hold several concurrent sessions.
  2. Resolving a token touches `last_used_at` without model events. A non-null `expires_at` in the past rejects the token; a null `expires_at` never expires.
  3. QUIRK: the login endpoint issues tokens without a TTL, so in practice extension tokens never expire even though the column and TTL support exist.
  4. Logout deletes the row matching the presented token's hash.
  5. No cleanup job for expired tokens exists.
- **Async & events:** none.
- **External systems:** the browser extension client (`extension/` folder and the Google Sheets add-on are EXT).
- **Settings:** none.
- **Acceptance criteria:**
  - Given a valid login, when a token is issued, then only its sha256 is stored and it resolves to the user on the next request with `last_used_at` updated.
  - Given a token whose `expires_at` is in the past, when used, then it is rejected as unauthenticated.
  - Given a user deleted, when the delete runs, then their tokens are removed.
- **Source refs:** app/Models/ExtensionApiToken.php, app/Http/Middleware/ExtensionApiAuth.php, app/Http/Controllers/Api/ExtensionApiController.php, database/migrations/2026_05_28_120000_create_extension_api_tokens_table.php, database/migrations/2026_07_07_000101_j_add_expires_at_to_extension_api_tokens.php.
- **Port notes:** implement as hashed personal access tokens in the auth module with mandatory TTL and a purge job; RLS is not applicable if tokens are user-scoped platform data, but scope by org when the user belongs to one.

### TW-ADD-035 — Add-on data-retention setting

- **Status:** docs-only
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-PLAN-*
- **Summary:** The docs and the 1.1.0 changelog say an add-on can carry a data-retention window (days after plan expiry before the workspace's data is wiped). In code the column exists on every package, but the add-on form never sets it and the wipe job never considers add-ons.
- **Actors & access:** none (no working path).
- **UX & screens:** the add-on form has no retention field; only the plan form exposes `data_retention_days` (0 to 3650).
- **Endpoints:** none.
- **Data:** `packages.data_retention_days` (unsigned int, default 0); on add-ons it stays 0.
- **Rules & edge cases:**
  1. The scheduled command `workspaces:wipe-expired` (owned by the plan/core domain; dry-run unless forced) matches workspaces by their PLAN (`workspaces.plan` equals a package's slug or id), so an add-on's retention value would never match any workspace even if set.
  2. Do not port as a feature unless product decides to; note for the PLAN owner.
- **Async & events:** none for add-ons.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the add-on form, when opened, then (parity) there is no retention field.
  - Given an add-on with retention set directly in the database, when the wipe command runs, then it is not applied to any workspace.
- **Source refs:** Documentation/pages/admin-panel/addons.html, app/Console/Commands/WipeExpiredWorkspaces.php, database/migrations/2026_06_18_000200_create_addon_packages_and_retention.php.
- **Port notes:** decide with PLAN whether retention lives on the plan only; if kept for add-ons, define precedence.

## Data model

### `extensions` (owned; platform-level, no tenant column)

Purpose: one row per ZIP-installed code add-on. Written by install/toggle/uninstall (TW-ADD-005/007/008), read by the Extensions page and the registry (TW-ADD-001/012/013/014). Volume: a handful of rows.

- `id` bigint PK.
- `slug` varchar(64) NOT NULL, UNIQUE (`extensions_slug_unique`): module key; re-install upserts by slug.
- `name` varchar(128) NOT NULL; `version` varchar(32) NOT NULL default '1.0.0'.
- `purchase_code` text NULL: the licence key that unlocked it, encrypted at rest by the model cast; only set when a code is supplied.
- `status` varchar(16) NOT NULL default 'active'; values `active` | `disabled`.
- `files` longtext NULL: JSON array of paths relative to the install root (all under `addon/<slug>/`); source of truth for uninstall.
- `manifest` longtext (JSON, validated by CHECK) NULL: the trimmed manifest (slug, name, version, min_core, nav, plan_features, plan_limits, routes, migrate). Added later by migration 2026_07_20_180000; code guards for its absence.
- `installed_at` timestamp NULL; `installed_by` bigint unsigned NULL FK `users.id` ON DELETE SET NULL.
- `created_at`, `updated_at`.
- Indexes: unique slug, `ext_slug_status_idx (slug, status)`, FK index on `installed_by`.

### `workspace_addons` (owned; tenant-scoped by `workspace_id`)

Purpose: a billing add-on purchased by a workspace (TW-ADD-031/032/033).

- `id` bigint PK; `workspace_id` bigint unsigned NOT NULL (no FK constraint); `package_id` bigint unsigned NOT NULL (no FK; points to `packages.id` of an add-on); `order_id` bigint unsigned NULL (no FK; the purchase order).
- `status` varchar(16) NOT NULL default 'active'; only `active` is ever written (`cancelled`/`expired` are documented in a migration comment only).
- `starts_at` timestamp NULL; `ends_at` timestamp NULL (null = lifetime).
- `created_at`, `updated_at`.
- Indexes: `(workspace_id, status)`, `workspace_id`, `package_id`.
- "Active" scope: status active AND (`ends_at` null OR `ends_at` > now). No row limit per workspace; rows accumulate per purchase.
- Port note: needs `org_id` composite key and RLS forced with the tenant policy; add FKs (the source has none, which allowed the orphan-after-delete behavior).

### `extension_api_tokens` (owned by name; used by EXT)

Purpose: hashed bearer tokens for the browser extension (TW-ADD-034). Columns: `id`, `user_id` FK users cascade, `token_hash` varchar(64) UNIQUE, `label` varchar(64) NULL, `last_used_at`, `expires_at`, timestamps. Volume: one row per extension login session.

### Shared table `packages` (owned by PLAN; add-on relevant columns)

`type` varchar(16) default 'plan' (index; `addon` for packs), `grants_json` JSON NULL (add-on grants: `{"features":["access_x",...],"limits":{"device_limit":2,"tags_limit":-1}}`; `limits` values are ints, -1 unlimited), `plan_id` varchar(255) UNIQUE slug, `pname`, `subtitle`, `detail`, `plan_amount` decimal(12,2), `offer_price` decimal(12,2) NULL, `currency` varchar(8) default 'INR', `plan_unit`, `plan_duration`, `lifetime`, `free`, `is_custom_quote`, `status` tinyint default 1 (index with `sort_order`), `sort_order`, `cta_label`, `data_retention_days` (unused for add-ons), plus all feature boolean and limit int columns. Add-on rows use the feature booleans as mirrors of `grants_json.features` and leave limit columns at 0.

### System settings keys used (table `system_settings`, owned by SET)

`instaflow_url`, `instaflow_secret` (encrypted), `instaflow_brand` (default IgDesk), `instaflow_connected` (bool), `instaflow_last_check`, `instaflow_last_inbound` (written by IG inbound), `mailtrixy_url`, `mailtrixy_secret` (encrypted), `mailtrixy_brand` (default MailTrixy), `mailtrixy_connected`, `mailtrixy_last_check`, `instagram_enabled` (native flag), `envato_purchase_code` (plain text), `envato_verified_at`.

### Filesystem state (not a table)

`addon/<slug>/extension.json` plus module tree; `addon/<slug>/.disabled` marker; `storage/app/extensions/extension.zip` temp upload; `storage/logs/module-loader.log`.

## Cross-domain contracts

Consumes:

- INST (install-update-licensing): `UpdaterService::verifyPurchase` (currently a stub that always succeeds and writes the purchase code settings), `App\Support\Licence`, `config/version.php` core version used for `min_core`.
- SET (platform-settings-branding-storage): `SystemSetting::get/set` including encrypt-on-write for `instaflow_secret` and `mailtrixy_secret`; currency formatting helpers; brand name helpers.
- NOTIF (notifications-activity-audit): `Audit::log(action, opts)` and the generic created/updated/deleted notification hook fired by the `Package` model.
- ASHELL (admin-console-shell): the admin layout, sidebar (consumes `ExtensionRegistry::nav('admin')`), settings hub tile, flash component, confirm modal, admin route group middleware.
- CPN (coupons-credits-referral-currency): active `currencies` list for the add-on form; currency conversion for checkout of add-ons.
- CHK / PAYGW: order finalisation (`finalizeOrder`) creating `workspace_addons` rows; checkout page for add-on packages.
- CORE: route bootstrap ordering (module routes before the workspace-slug catch-all), console `migrate`, caches.

Exposes:

- PLAN: `ExtensionRegistry::planFeatures()` / `planLimits()` merged into `planFeatureToggles()`, `planLimitColumns()`, `Package::getFillable()` and the package form; `Package::scopeAddons`, `grantsFeature`, `grantLimit`, `isStackable`; the `type='addon'` catalog rows.
- PLAN / all plan-gated domains: `Workspace::effectiveLimit` add-on merge through the `workspace_addons` table (`activeAddonPackages`).
- IG (channel-instagram): platform settings `instaflow_*`, `instagram_enabled`, `ig_brand_name()`, the one-engine guard, and the boot-time teardown; the inbound endpoint sets `instaflow_connected`.
- MAIL (channel-email): platform settings `mailtrixy_*`, `mailtrixy_brand_name()`, `MailtrixyClient::fromSettings()` and the handshake.
- EXT (chrome-extension-sheets-addon): `ExtensionApiToken` model and `extension_api_tokens` table; EXT owns the `ext.*` routes, `ExtensionApiAuth` and the `extension/` folder.
- Any future module: the manifest contract (TW-ADD-004), the module layout convention and the loader hooks (autoload, routes, migrations, views, nav, plan flags).

Hook points modules can use (complete list found in code): (1) `extension.json` `nav.admin[]` sidebar entries; (2) `plan_features` and `plan_limits` (package form, validation, mass assignment, add-on grants); (3) `routes[]` files required at route bootstrap; (4) `database/migrations` picked up by `migrate` and run on ZIP install; (5) `resources/views` added to the view finder; (6) `app/` classes overriding core classes of the same FQCN through the classmap; (7) the `migrate` flag. There is no event/listener registration, no permission/role registration and no scheduled-task registration hook in the loader; a module gets permissions, jobs and settings only by shipping its own migrations and route files.

Port decision: Reference's manifest has no init or event hook, so ours does not add one (porting rule 2.4). The equivalents live in code: `AddonFulfilmentHooks.register()`, `@RequiresModule`, outbox subscribers and provider ports. They are documented for operators in the Help guide `extension-hooks` (`apps/web/src/features/addons-extension-registry/help/`).

## Open questions & quirks

1. Licence gate is a stub: `verifyPurchase` always returns ok and stores the raw code in `system_settings` unencrypted; the original Envato round trip was removed by vendor decision. The port needs its own entitlement model for paid modules (INST decision).
2. The reference tree contains no `addon/` folder and no example `extension.json`; the Instagram ZIP add-on (which owns tables such as `instagram_accounts`, plan flag columns and views) is not present, so the manifest contract is derived purely from the loader code and comments. `access_instagram` is also hard-coded in core toggles. The exact shape of `nav.icon` (raw SVG path markup) is inferred from the sidebar's use.
3. Disable of a ZIP-installed extension does not actually disable it (TW-ADD-007 QUIRK): only the DB flag changes; the loader keeps loading the folder. Docs say "Disable switches an extension off".
4. `ExtensionRegistry::isDormantFeature` is defined but never called, so stale plan flags of removed modules keep granting (TW-ADD-015).
5. Slug is unvalidated at install (path traversal through the slug, TW-ADD-004) while only the toggle endpoint validates it. The shared fixed temp filename `storage/app/extensions/extension.zip` makes concurrent installs collide and is never cleaned.
6. `nav.user` and `nav.*.after` are read but unused; `plan_limits.*.default` and `hint` have no consumers found.
7. Extension route paths are resolved against the project root by the registry and against the module folder by the loader; behavior with duplicates is undefined (TW-ADD-011).
8. Billing add-on admin list computes Grants from raw columns so limit boosts and non-catalog flags do not show; the form's `detail` field is validated but absent so edits wipe it; delete text promises retention that the code does not provide; add-on purchases are not gated server-side by an active plan; `effectiveLimit` sums add-on deltas onto a 0-means-unlimited plan and thereby lowers it (TW-ADD-025, 028, 030, 031, 032).
9. The feature catalog contains flags the add-on grant whitelist cannot offer: the whitelist is `PLAN_FEATURE_TOGGLES` plus module flags, and `access_line`, `line_broadcasts`, `access_wechat`, `wechat_broadcasts`, `access_viber`, `viber_broadcasts` (and `access_instagram`-adjacent fields) appear only in the catalog. Whether the plan form has the same gap should be checked by PLAN; as written these channels cannot be sold as add-ons through the UI.
10. Customer add-on cards use `cta_label`, which no admin form sets; `workspace_addons.status` values `cancelled` and `expired` are never written; no add-on refund/cancel flow exists.
11. The Instagram card shows "blocked" when `addon/instagram/` merely exists even if deactivated, but the server allows a remote connect in that case (TW-ADD-021).
12. Instaflow/MailTrixy connect fetch admin-supplied URLs server side with no SSRF protection (admin-only); the URL is persisted before the handshake result is known.
13. Docs mismatch: docs describe add-on data-retention (docs-only, TW-ADD-035). The `extensions.html` doc says Disable "switches an extension off", which the code only partially does.
14. Out-of-domain items observed and left to owners: `ext.*` API routes, `ExtensionApiController`, `ExtensionApiAuth`, `extension/` browser extension and `google-sheets-addon/` (EXT); `Api\SheetsAddonController` and `sheets-addon` routes (EXT/INTG); `InstaflowInboundController` and `MailtrixyInboundController` inbound webhooks (IG/MAIL); `WipeExpiredWorkspaces` (PLAN/CORE); `AdminPagesController` package save (PLAN); `CheckoutController` and `AccountController` add-on parts (CHK/PLAN, described here only for add-on behavior); `Licence`, `UpdaterService`, `UpdateController` (INST); `routes/bsp.php` "module" tables (BSP, unrelated to this loader).

## Coverage

```json threadwise-coverage
{
  "routes": [
    "GET admin/addons",
    "POST admin/addons",
    "GET admin/addons/create",
    "PUT admin/addons/{id}",
    "DELETE admin/addons/{id}",
    "GET admin/addons/{id}/edit",
    "POST admin/addons/{id}/toggle",
    "GET admin/extensions",
    "POST admin/extensions/instaflow/connect",
    "POST admin/extensions/instaflow/disconnect",
    "POST admin/extensions/mailtrixy/connect",
    "POST admin/extensions/mailtrixy/disconnect",
    "POST admin/extensions/module/{slug}/toggle",
    "POST admin/extensions/upload",
    "POST admin/extensions/verify",
    "DELETE admin/extensions/{id}",
    "POST admin/extensions/{id}/toggle"
  ],
  "controllers": [
    "app/Http/Controllers/Admin/AddonsController.php",
    "app/Http/Controllers/Admin/ExtensionController.php"
  ],
  "services": [
    "app/Services/ExtensionRegistry.php",
    "app/Services/ExtensionService.php",
    "app/Services/ModuleLoader.php"
  ],
  "models": ["Extension", "ExtensionApiToken", "WorkspaceAddon"],
  "tables": ["extensions", "extension_api_tokens", "workspace_addons"],
  "views": [
    "resources/views/admin/addons/form.blade.php",
    "resources/views/admin/addons/index.blade.php",
    "resources/views/admin/extensions/index.blade.php"
  ],
  "commands": [],
  "permissions": [],
  "middleware": [],
  "node_files": [],
  "js_assets": ["resources/js/charts/admin-extensions-index.js"],
  "misc_files": ["app/Providers/ModuleServiceProvider.php"],
  "config_files": [],
  "doc_pages": [
    "Documentation/pages/admin-panel/addons.html",
    "Documentation/pages/admin-panel/extensions.html"
  ],
  "feature_map": {
    "TW-ADD-001": ["GET admin/extensions"],
    "TW-ADD-002": ["POST admin/extensions/verify"],
    "TW-ADD-003": ["POST admin/extensions/upload"],
    "TW-ADD-007": ["POST admin/extensions/{id}/toggle"],
    "TW-ADD-008": ["DELETE admin/extensions/{id}"],
    "TW-ADD-010": ["POST admin/extensions/module/{slug}/toggle"],
    "TW-ADD-016": ["GET admin/extensions"],
    "TW-ADD-017": ["POST admin/extensions/instaflow/connect"],
    "TW-ADD-018": ["POST admin/extensions/instaflow/disconnect"],
    "TW-ADD-019": ["POST admin/extensions/mailtrixy/connect"],
    "TW-ADD-020": ["POST admin/extensions/mailtrixy/disconnect"],
    "TW-ADD-025": ["GET admin/addons"],
    "TW-ADD-026": ["GET admin/addons/create"],
    "TW-ADD-027": ["GET admin/addons/{id}/edit"],
    "TW-ADD-028": ["POST admin/addons", "PUT admin/addons/{id}"],
    "TW-ADD-029": ["POST admin/addons/{id}/toggle"],
    "TW-ADD-030": ["DELETE admin/addons/{id}"]
  }
}
```
