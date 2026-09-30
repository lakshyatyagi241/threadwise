---
domain: platform-settings-branding-storage
code: SET
title: Platform system settings, branding, storage, realtime, mail, SEO
wadesk_version: '1.7.0'
sources_read: 95
---

# Platform system settings, branding, storage, realtime, mail, SEO

## Overview

This domain is the platform super-admin's configuration surface: everything that is global to the
installation rather than owned by one workspace. It is built on one tiny key/value table
(`system_settings`, model `SystemSetting`) that the whole product reads from at request time, so a
change made in the admin console takes effect on the next request with no rebuild and no `.env` edit.

Who uses it: only platform staff (users where `User::isAdmin()` is true: Spatie role "Super Admin" or
"Admin", or legacy `users.role` of `admin`/`A`). Every screen sits behind the `Authenticate`,
`EnsureUserIsAdmin` and `IPAllowlist` middleware. Workspace owners, agents, API clients and end
customers never write these settings; they only feel their effects (branding, footers, cookie banner,
storage destination, real-time, SEO tags, PWA install).

Main flow: admin opens Admin -> Settings (hub) -> picks a card -> edits a form -> save. The save writes
one row per key into `system_settings` (secrets encrypted, cache invalidated) and usually logs an audit
row. Runtime "consumers" (layouts, Blade partials, middleware, helpers, services) then read the value
through `SystemSetting::get(key, default)`, which is cached 30 minutes per key.

What lives here (features WD-SET-001..046):

- The key/value store and its secret encryption (001), admin access gate + audit (002), the settings
  hub with health KPIs (003) and the redacted export (004).
- General settings: identity and contact (005), platform defaults (006), signup policy (007),
  maintenance mode (008), preloader (009).
- Branding: favicon/logos (010), brand-name helpers (011), the platform outbound message footer (012),
  dashboard colour tokens (013-014), user shell layout and sidebar colours (015), top-menu layout (016),
  personal theme (017), the live auth-page editor (018-021), site info (022) and footer (023).
- Outbound mail: SMTP settings (024) and test send (025).
- SEO and public-site plumbing: SEO form (026), meta emission (027), sitemap/robots (028), privacy and
  cookie consent (029-031), analytics trackers (032-033), custom CSS/JS (034).
- Installable apps: app PWA (035-037) and the Team Inbox PWA + VAPID keys (038).
- Media storage: cloud provider settings (039) and the runtime routing of uploads (040).
- Real-time: Pusher settings (041) and the runtime broadcaster/Echo/channel-auth path (042).
- Plan analytics for the super-admin (043) and locale/currency/timezone helper services (044-046).

How plan tiers matter: they mostly do not. These are platform settings and are not plan-gated. The
only plan coupling is (a) the default signup plan and trial length (007) and the billing plan scope,
which decide how `Workspace::billingPackage()` resolves entitlements, and (b) the platform message footer
(012), which is suppressed only for workspaces whose plan has the `remove_branding` feature.

Connections to other domains (by id): AUTH (register/login pages consume signup policy, auto-verify,
auth-page content, social/captcha keys live on a sibling settings page), PLAN (default plan, Premium
dashboard reads packages/orders), WSP (workspace `branding_footer`, timezone, currency),
NOTIF (audit log, Web Push keys, FCM), TIB1/TIB2 (Team Inbox realtime feed and PWA), WABA/WADEV/NODE
(sibling settings pages under `admin/settings/*` for engines, Node bridge, pacing; footer pushed to
the Node bridge), WALLET/CPN (credits and currency pages), CMS (public site, blog posts in sitemap,
frontend editor), I18N (languages table and default language), CORE (boot-time wiring, health, Laravel
framework routes), ASHELL (admin layout and sidebar).

Important: the "Settings" landing page links to many sibling pages that are handled by the same catch-all
controller but belong to other domains (payment gateways, currencies, AI keys, audit log, languages,
Shopify/Woo/HubSpot/Google/Slack/Trello, social login and captcha, mobile push, catalog, wallet rules,
channel settings). They are NOT specified here; this file lists them under Open questions so the owners
can claim them, and the complete `system_settings` key catalogue (all 313 keys found) is in Data model.

## Feature index

| Id         | Feature                                                                                     | Status      | Priority | Effort | Depends on             |
| ---------- | ------------------------------------------------------------------------------------------- | ----------- | -------- | ------ | ---------------------- |
| WD-SET-001 | System settings key/value store (typed, cached, secrets encrypted)                          | implemented | P0       | M      | -                      |
| WD-SET-002 | Admin-only access, IP allowlist and audit trail for settings pages                          | implemented | P0       | S      | WD-SET-001             |
| WD-SET-003 | Settings hub landing page (tiles, KPI strip, header actions)                                | implemented | P1       | M      | WD-SET-001, WD-SET-002 |
| WD-SET-004 | Settings export (secret-redacted JSON download)                                             | implemented | P2       | S      | WD-SET-001             |
| WD-SET-005 | General settings: application identity and contact details                                  | implemented | P0       | M      | WD-SET-001             |
| WD-SET-006 | Platform defaults: timezone, language, currency, phone country, UI font                     | implemented | P1       | M      | WD-SET-005             |
| WD-SET-007 | Signup policy: public registration, auto-verify email, default plan, trial days, plan scope | partial     | P0       | M      | WD-SET-005             |
| WD-SET-008 | Maintenance mode toggle and enforcement middleware                                          | implemented | P1       | S      | WD-SET-005             |
| WD-SET-009 | Preloader toggle (stored, never consumed)                                                   | dead-code   | P2       | S      | WD-SET-005             |
| WD-SET-010 | Brand assets: shared favicon and per-theme logos                                            | implemented | P1       | M      | WD-SET-005             |
| WD-SET-011 | Brand identity helpers (name, token, email, webhook header prefix, partner names)           | implemented | P1       | S      | WD-SET-005, WD-SET-022 |
| WD-SET-012 | Platform outbound message footer and per-workspace resolution                               | implemented | P1       | M      | WD-SET-005             |
| WD-SET-013 | Appearance: dashboard colour tokens                                                         | implemented | P1       | M      | WD-SET-001             |
| WD-SET-014 | Appearance: interface size and opacity metrics                                              | implemented | P2       | S      | WD-SET-013             |
| WD-SET-015 | User dashboard shell layout and sidebar rail colours                                        | implemented | P2       | M      | WD-SET-013             |
| WD-SET-016 | Menu layout editor (top bar vs More page)                                                   | implemented | P2       | M      | WD-SET-015             |
| WD-SET-017 | Personal theme preference and per-theme logo selection                                      | implemented | P1       | S      | WD-SET-010             |
| WD-SET-018 | Auth pages editor: design template and live editable frame                                  | implemented | P1       | M      | WD-SET-001             |
| WD-SET-019 | Auth pages editor: inline text editing bridge                                               | implemented | P1       | M      | WD-SET-018             |
| WD-SET-020 | Auth pages editor: side media upload and removal                                            | implemented | P2       | S      | WD-SET-018             |
| WD-SET-021 | Auth pages classic form save endpoint                                                       | dead-code   | P2       | S      | WD-SET-018             |
| WD-SET-022 | Site info: shared contact and social identity                                               | implemented | P1       | S      | WD-SET-001             |
| WD-SET-023 | Public footer settings                                                                      | implemented | P1       | S      | WD-SET-022             |
| WD-SET-024 | Mail settings and runtime application to the mailer                                         | implemented | P0       | M      | WD-SET-001             |
| WD-SET-025 | Mail test send                                                                              | implemented | P1       | S      | WD-SET-024             |
| WD-SET-026 | SEO settings form with live search and social preview                                       | implemented | P1       | M      | WD-SET-001             |
| WD-SET-027 | SEO meta tag emission across layouts                                                        | implemented | P1       | S      | WD-SET-026             |
| WD-SET-028 | Sitemap, robots.txt and sitemap download                                                    | implemented | P1       | S      | WD-SET-026             |
| WD-SET-029 | Privacy and cookie-banner settings                                                          | implemented | P1       | S      | WD-SET-001             |
| WD-SET-030 | Cookie consent banner runtime and legal link resolution                                     | implemented | P1       | M      | WD-SET-029             |
| WD-SET-031 | GDPR, CCPA and ADA compliance flags (stored only)                                           | dead-code   | P2       | S      | WD-SET-029             |
| WD-SET-032 | Analytics tracker ID settings                                                               | implemented | P1       | S      | WD-SET-001             |
| WD-SET-033 | Analytics tracker injection with consent gating                                             | implemented | P1       | M      | WD-SET-032, WD-SET-030 |
| WD-SET-034 | Custom CSS and JS injection on the public site                                              | implemented | P2       | S      | WD-SET-001             |
| WD-SET-035 | PWA settings (app-wide installable manifest config)                                         | implemented | P1       | M      | WD-SET-010             |
| WD-SET-036 | PWA manifest endpoint and head meta tags                                                    | implemented | P1       | S      | WD-SET-035             |
| WD-SET-037 | PWA install prompt, offline cache and splash (stored, unused)                               | dead-code   | P2       | S      | WD-SET-035             |
| WD-SET-038 | Team Inbox PWA configuration and push key generation                                        | implemented | P1       | M      | WD-SET-035             |
| WD-SET-039 | Cloud storage settings and connection test                                                  | implemented | P1       | M      | WD-SET-001             |
| WD-SET-040 | Cloud media routing runtime (disk resolution, prefix, URLs)                                 | implemented | P1       | L      | WD-SET-039             |
| WD-SET-041 | Real-time (Pusher) settings and connection test                                             | implemented | P1       | M      | WD-SET-001             |
| WD-SET-042 | Real-time runtime: broadcaster switch, browser bootstrap, channel authorisation             | implemented | P1       | L      | WD-SET-041             |
| WD-SET-043 | Premium plans dashboard                                                                     | partial     | P2       | M      | WD-SET-005             |
| WD-SET-044 | Currency display and conversion helpers                                                     | implemented | P1       | M      | WD-SET-006             |
| WD-SET-045 | Locale registry and text direction                                                          | implemented | P1       | S      | WD-SET-006             |
| WD-SET-046 | Timezone resolution and safe timezone helpers                                               | implemented | P1       | S      | WD-SET-006             |

## Features

### WD-SET-001 — System settings key/value store (typed, cached, secrets encrypted)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** none
- **Summary:** One table of `key`, `type`, `value`, `description` rows read and written through two static methods, `get(key, default)` and `set(key, value, type, description)`. Values are cast by their declared type, cached for 30 minutes per key, and a fixed list of secret keys is transparently encrypted at rest. Every other feature in this file (and most of the product) reads its configuration through it.
- **Actors & access:** Read: any request, queue job, CLI or view (server-side only). Write: only platform-admin settings controllers, the installer (`envato_purchase_code`, `envato_verified_at`), a few integration flows that persist connection state (Instaflow/MailTrixy handshake, Instagram/Google/Shopify OAuth), seeders and migrations. No plan or permission gate at the store level.
- **UX & screens:** None of its own. It surfaces indirectly on the settings hub KPI strip (WD-SET-003) and the export (WD-SET-004).
- **Endpoints:** none.
- **Data:** table `system_settings`: `id` bigint PK, `key` varchar(96) UNIQUE, `type` varchar(16) default `'int'`, `value` text null, `description` text null, `created_at`, `updated_at`. Declared types: `int`, `float`, `bool`, `string`, `json`; code also passes `text` (treated as string). Live seeded install has 17 rows (referral/credit defaults, checkout tax/pricing defaults, `allowed_send_methods`, `default_send_method`, `active_engine_slug`, `platform_branding_footer`, `auto_verify_email`, Meta Ads defaults, a per-admin `admin.notif_seen.<userId>` marker).
- **Rules & edge cases:**
  1. `get()` casts on read: `int` -> `(int)`, `float` -> `(float)`, `bool` -> `filter_var(FILTER_VALIDATE_BOOLEAN)`, `json` -> `json_decode(assoc)`, anything else returns the raw string. A row with SQL NULL value returns null (not the default). A missing row returns the caller's default.
  2. Reads are cached in the framework cache under `system_setting:<key>` for 1800 seconds via `Cache::remember`; saving or deleting a row forgets that key (model `saved`/`deleted` events). The cached value includes defaults: a missing key caches the caller's default for 30 minutes (so a different caller default is masked until the cache is cleared). QUIRK: because the cache is keyed only by `key`, two call sites with different defaults can disagree until the first `set()`.
  3. If the database or cache store is unreachable (fresh install before `.env` DB creds, `CACHE_STORE=database` before migration) `get()` swallows the exception and returns the default, so boot-time code (locale, branding) never crashes the installer.
  4. `set()` does `firstOrNew(key)`, writes `type`, stringifies the value (`json` -> `json_encode`, `bool` -> `'1'`/`'0'`, else `(string)`), updates `description` only when a description string is passed, and saves (which busts the cache). The default `type` argument is `'int'`; a caller that omits the type for a string value stores `'int'` and a later `get()` casts it to `0` (this bit a migration once: `platform_branding_footer` seeded as text got cast to `0`, fixed by re-seeding with type `string`).
  5. Encrypted keys (`ENCRYPTED_KEYS` constant, 32 keys): `waba_app_secret`, `waba_webhook_verify_token`, `baileys_callback_token`, `node_webhook_token`, `meta_app_secret`, `twilio_auth_token`, `meta_system_user_token`, `meta_ads.token`, `shopify_client_secret`, `hubspot_client_secret`, `google_calendar_client_secret`, `social_google_client_secret`, `social_facebook_client_secret`, `recaptcha_secret`, `web_search_key`, `instagram_app_secret`, `instagram_ig_app_secret`, `instagram_webhook_verify_token`, `instagram_giphy_key`, `fb_app_secret`, `fb_webhook_verify_token`, `instaflow_secret`, `mailtrixy_secret`, `fcm_service_account_json`, `ti_vapid_private`, `bsp_meta_system_user_token`, `tiktok_client_secret`, `tiktok_business_app_secret`, `tiktok_shop_app_secret`, `telegram_api_hash`, `message_facebook_token`, `message_twilio_token`. On `set()` a non-empty value is encrypted with the framework `Crypt::encrypt` (serialising cipher); on `get()` it is decrypted and legacy plaintext is tolerated (decryption failure returns the raw string). Empty strings are stored as empty (never encrypted).
     5b. Secrets that are handled OUTSIDE that list use a second scheme and are therefore encrypted by their own controller with `Crypt::encryptString` before being stored as a plain string key: `mail_password`, `pusher_app_secret`, `catalog_meta_app_secret`, and every field inside the `cloud_storage` JSON blob (`secret`, `access_key`). These are NOT decrypted by `SystemSetting::get()`; their readers decrypt them explicitly. Do not unify blindly.
  6. A backfill migration (`2026_06_02_120000_encrypt_legacy_plaintext_secrets`) encrypts any existing plaintext row for the listed keys (idempotent) and also encrypts `outbound_webhooks.secret`.
  7. Changing `APP_KEY` makes every encrypted setting unreadable; the docs warn that all secrets must then be re-entered.
  8. The export (WD-SET-004) redacts by key-name suffix, not by the `ENCRYPTED_KEYS` list (see there).
- **Async & events:** none. Cache invalidation is synchronous on save. The Node bridge keeps its own cache of some settings; WD-SET-012 busts it through `NodeCacheBuster::bustAll()`.
- **External systems:** framework cache store (database/redis/file per `.env`), framework `Crypt` keyed by `APP_KEY`.
- **Settings:** `.env`: `APP_KEY`, `CACHE_STORE`. All other settings are values in this store.
- **Acceptance criteria:**
  - Given a missing key, when a caller reads it with default `X`, then `X` is returned and no row is created.
  - Given `set('k', true, 'bool')`, when read back, then `true` is returned and the stored text is `'1'`.
  - Given a key in the encrypted list, when saved with a non-empty value, then the database column holds ciphertext and a plain `get()` returns the original text.
  - Given a legacy plaintext row for an encrypted key, when read, then the plaintext is returned unchanged and the next save rewrites it as ciphertext.
  - Given a saved change, when the same key is read in the next request, then the new value is returned (cache invalidated).
- **Source refs:** app/Models/SystemSetting.php; database/migrations/2026_05_07_120000_create_wallet_and_referrals_tables.php; database/migrations/2026_06_02_120000_encrypt_legacy_plaintext_secrets.php; database/migrations/2026_05_24_100000_add_branding_footer_to_workspaces_and_seed_platform_default.php; Documentation/pages/admin-panel/system-settings.html.
- **Port notes:** New stack has no settings module yet. Suggested home: `apps/api/src/modules/platform-settings/` with a non-tenant table (platform-wide, NOT under RLS tenant policy; guard by a platform-admin permission instead) and a typed accessor with an in-process TTL cache invalidated through the outbox/Redis pub-sub so worker and API processes agree. Prefer a typed registry (key -> zod schema, default, secret flag) instead of free-form strings; encrypt secrets with an app-level DEK (AES-256-GCM) and never return them from list endpoints. Do not port the double-scheme encryption; migrate all secrets to one scheme. Legacy `type` defaults to `int` -> require an explicit type.

### WD-SET-002 — Admin-only access, IP allowlist and audit trail for settings pages

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-SET-001
- **Summary:** Every `admin/*` settings endpoint requires a signed-in platform admin and an allowed IP; mutating actions write an audit row. Access is a coarse "is admin" check, not per-page permissions.
- **Actors & access:** Platform admin only. Middleware stack on all routes in this file (except the public ones named below): `Authenticate`, `EnsureUserIsAdmin` (403 "Admins only." unless `User::isAdmin()`), `IPAllowlist`. The Spatie permissions `platform.system.settings` (seeded for Super Admin) and `settings.view/create/edit/delete` exist in the seeders but are never checked by these routes.
- **UX & screens:** Non-admin gets a 403 page. An IP outside the allowlist gets the `errors.ip-blocked` page (HTTP 403) that names the offending IP. Success/error banners come from the `x-admin.flash` component reading session keys `success`, `status` and `error` (different screens use different keys).
- **Endpoints:** (applies to all admin endpoints below; no separate route.)
- **Data:** Reads `security.ip_allowlist_enabled` (bool, default false) and `security.ip_allowlist_cidrs` (json list) from `system_settings` (owned by AUTH). Writes `audit_logs` rows (owned by NOTIF).
- **Rules & edge cases:**
  1. `IPAllowlist` enforces only when `security.ip_allowlist_enabled` is true. If enabled but the CIDR list is empty it FAILS OPEN (so an admin cannot lock themselves out). Bare IPs match exactly; CIDR supports IPv4 and IPv6 and rejects mixed families.
  2. A block writes audit action `admin.access.blocked_by_ip` (result failure, meta: ip, cidr count, path).
  3. Audit actions written by the features of this file: `admin.site_settings.updated`, `admin.settings.general_updated` (layer platform), `settings.mail_update`, `settings.mail_test` (success or failure with error text), `settings.seo_update`, `settings.footer_update`, `settings.custom_update` (meta: CSS/JS lengths only), `settings.pwa_update`, `settings.privacy_update`, `settings.analytics_update`, `settings.export` (meta: row count), and, via the inbox audit logger, `settings.realtime.save`. NOT audited: appearance, sidebar colours, menu layout, auth-page edits/media, storage settings, storage test.
  4. Audit metadata stores changed field names only, never values.
  5. QUIRK: `platform.system.settings` looks like the intended gate but nothing enforces it; any "Admin" role passes every page.
- **Async & events:** audit row written synchronously in the request.
- **External systems:** none.
- **Settings:** `security.ip_allowlist_enabled`, `security.ip_allowlist_cidrs` (edited on the AUTH security console).
- **Acceptance criteria:**
  - Given a signed-in workspace owner (non-admin), when they open `/admin/settings`, then a 403 is returned.
  - Given the allowlist enabled with `10.0.0.0/8` and a request from `203.0.113.5`, when an admin opens any settings page, then a 403 IP-blocked page is shown and a failure audit row is written.
  - Given the allowlist enabled with an empty list, when an admin opens settings, then access is allowed.
  - Given an admin saves mail settings, then an audit row `settings.mail_update` exists listing the submitted field names.
- **Source refs:** app/Http/Middleware/EnsureUserIsAdmin.php; app/Http/Middleware/IPAllowlist.php; app/Models/User.php (isAdmin); app/Support/PlatformPermissions.php; database/seeders/RolePermissionSeeder.php; routes/admin.php.
- **Port notes:** Map to platform RBAC in `apps/api/src/modules/admin` (roles/permissions) using a real permission such as `platform.settings.manage` registered via the rbac-permission skill; add per-page read vs write if desired. Audit through the existing outbox+audit path in the same transaction (never log values, redact secrets). IP allowlist belongs to AUTH.

### WD-SET-003 — Settings hub landing page (tiles, KPI strip, header actions)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-SET-001, WD-SET-002
- **Summary:** `Admin -> Settings` is a card grid linking to each settings area plus a five-tile KPI strip computed from the `system_settings` table, and shortcut buttons for Add-ons, Updater, Legal pages, General and Export.
- **Actors & access:** Platform admin (WD-SET-002).
- **UX & screens:** `resources/views/admin/settings/index.blade.php`. Header bar with breadcrumb and a decorative search box (placeholder "Search project settings...", CMD-K badge; no handler, non-functional). Title "Project settings". Action buttons: Add-ons (route `admin.extensions.index`), Updater (`admin.update.index`), Legal pages (`/admin/legal-pages`), Open general, Export config (WD-SET-004). KPI strip (5 tiles): Saved settings (row count), Healthy (rows with non-blank value), Needs test (list of names or "all verified"), Secret fields (count), Last updated (relative time and "by <name>" or "no edits yet"). Card grid, in order: Appearance and colours, General settings, Payment gateways, Currencies, AI / API keys, Mail settings (amber border), Audit log, Privacy GDPR and ADA, Menu order, Auth pages, Analytics integrations, SEO settings, Languages, PWA settings, Catalog settings, Shopify, WooCommerce, HubSpot CRM, Google integration, Slack, Mobile push (FCM), Trello, Footer settings, Site info, Social login and captcha. The Social login card shows chips of what is enabled (Google, Facebook, reCAPTCHA) or "not configured". There is also a large "Sending providers" section wrapped in `hidden` and neutralised (dead markup kept inert; comments say provider toggles moved to the channel-settings hub).
- **Endpoints:**

| Endpoint           | Route name           | Action                        | Middleware                                   | Response |
| ------------------ | -------------------- | ----------------------------- | -------------------------------------------- | -------- |
| GET admin/settings | admin.settings.index | AdminPagesController@settings | Authenticate, EnsureUserIsAdmin, IPAllowlist | HTML     |

- **Data:** Reads all `system_settings` rows (key, value, updated_at); `audit_logs` (actions `settings.mail_test`, `settings.catalog_test`, `shopify.oauth_completed` with outcome success; latest action LIKE `settings.%` with user name); `wa_provider_configs` count (provider `waba`, status `connected`) for the dead block.
- **Rules & edge cases:**
  1. Total = number of rows. Healthy = rows whose trimmed value is non-empty. Secret count = non-empty rows whose key ends with `_secret`, `_password`, `_token`, `_apikey`, `_api_key` (not the encrypted-keys list).
  2. Needs test: `mail` when `mail_host` is set and no successful `settings.mail_test` audit exists; `catalog` when `catalog_enabled` is truthy and no successful `settings.catalog_test`; `shopify` when `shopify_enabled` truthy and no successful `shopify.oauth_completed`. Any audit query failure is swallowed.
  3. Last updated = max `updated_at` over all rows; "by" = user of the most recent audit row whose action starts with `settings.`. QUIRK: the general and site-info saves log `admin.settings.*`/`admin.site_settings.*` so they do not update "by"; the name can be stale or missing while the time is fresh.
  4. The controller also builds a large `$settings` array (default_send_method, WABA/Twilio/Baileys creds, pacing, campaign expiry defaults, referral credits) that only the hidden dead block uses; behavior defaults captured there: `referral_signup_credits` 100, `credits_per_message` 1, `credits_per_currency_minor` 0.1, `default_send_method` `baileys`, `allowed_send_methods` [waba, baileys, twilio], `msg_gap` 3, `batches_gap` 50, `bw_msg_gap` 5, `enable_batches` false, `campaign_auto_expiry_enabled` true, `campaign_default_expiry_hours` 24, `waba_graph_api_version` `v23.0`, `waba_template_polling_min` 30, `waba_template_lint_strict` true. These belong to WADEV/WABA/NODE/CAMP/WALLET.
  5. Several tile hrefs (Payment gateways, Currencies, AI keys, Audit log, Languages) point at pages owned by other domains.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none editable here.
- **Acceptance criteria:**
  - Given an empty settings table, when the hub loads, then KPIs read 0 / 0 / "all verified" / 0 / "no edits yet".
  - Given `mail_host` saved but no successful mail test, then Needs test shows `mail`; after a successful test it disappears.
  - Given 3 rows of which 1 has an empty value, then Saved settings = 3 and Healthy = 2.
  - Given google login enabled, then the Social login card shows "Google".
- **Source refs:** app/Http/Controllers/AdminPagesController.php (settings); resources/views/admin/settings/index.blade.php; routes/admin.php; Documentation/pages/admin-panel/system-settings.html.
- **Port notes:** Rebuild as a Next.js admin page with a `GET /admin/settings/summary` endpoint returning the KPI numbers; tiles can be static config. Drop the decorative search box or make it a real filter. Do not port the dead provider block.

### WD-SET-004 — Settings export (secret-redacted JSON download)

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-SET-001
- **Summary:** One click downloads every `system_settings` row as a pretty-printed JSON file with secret values replaced by a placeholder, suitable for attaching to a support ticket.
- **Actors & access:** Platform admin.
- **UX & screens:** "Export config" button on the hub. Browser downloads `<brand-slug>-settings-<YYYYMMDD-HHMM>.json`.
- **Endpoints:**

| Endpoint                  | Route name            | Action                              | Middleware                                   | Response                 |
| ------------------------- | --------------------- | ----------------------------------- | -------------------------------------------- | ------------------------ |
| GET admin/settings/export | admin.settings.export | AdminPagesController@settingsExport | Authenticate, EnsureUserIsAdmin, IPAllowlist | streamed JSON attachment |

- **Data:** Reads all rows ordered by key: key, value, type. Payload shape: `{app, exported_at (ISO-8601), note, settings:[{key,value,type}]}`.
- **Rules & edge cases:**
  1. A row is redacted (value replaced with the literal `[REDACTED]`) when its non-empty value belongs to a key ending in `_secret`, `_password`, `_token`, `_apikey`, `_api_key`, or being exactly one of `posthog_key`, `mixpanel_token`, `mail_password`, `shopify_client_secret`, `catalog_meta_app_secret`, `twilio_auth`, `razorpay_key_secret`, `stripe_secret_key`.
  2. QUIRK / leak: redaction is by key name only. Secrets whose key does not end in one of those suffixes are exported unredacted (or as raw ciphertext): `fcm_service_account_json` (a Firebase private key, exported as ciphertext), `ti_vapid_private` (ciphertext), `web_search_key` (ciphertext), `instagram_giphy_key`, `analytics_posthog_key` (the exact-match list names `posthog_key`, which is not a real key), the whole `cloud_storage` JSON blob (encrypted secret fields but plaintext access key id, bucket, endpoint) and `mail_username`. Values that are ciphertext are exported as ciphertext, never decrypted. A port must redact from a per-key `secret` flag, not from name patterns, and strip `cloud_storage` credentials explicitly.
  3. Records an audit row `settings.export` with the row count.
  4. The filename slug uses the brand name (`app_name`).
- **Async & events:** audit row.
- **External systems:** none.
- **Settings:** `app_name` (filename).
- **Acceptance criteria:**
  - Given a saved mail password, when exporting, then the `mail_password` entry value is `[REDACTED]`.
  - Given a key ending `_api_key`, then its value is `[REDACTED]` and its `type` is still present.
  - Given the download, then the filename matches `<slug>-settings-YYYYMMDD-HHMM.json` and an audit row is written.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (settingsExport); resources/views/admin/settings/index.blade.php.
- **Port notes:** Implement redaction from the typed registry (`secret: true`) and additionally strip `cloud_storage` credentials. Stream as a file response from the API; write audit in the same transaction.

### WD-SET-005 — General settings: application identity and contact details

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-SET-001
- **Summary:** Admin edits the platform's product name, canonical URL, contact and sender details, address and map, from one form. The app name feeds every page title, email, brand string and webhook header.
- **Actors & access:** Platform admin.
- **UX & screens:** `resources/views/admin/settings/general.blade.php` (page key `admin-settings-general`). One long form, two columns (form + "Quick guide" aside) with a sticky save bar. Section "Application identity": App name (required, marked *), Platform message footer (WD-SET-012), App URL, Support email, Contact number, From email (outbound), Default timezone (searchable Tom Select over `Intl.supportedValuesOf('timeZone')`, WD-SET-006), Default language, Default currency, Default country, Font family, Address (textarea, 3 rows), Map iframe URL. Then Brand assets (WD-SET-010), Platform toggles (WD-SET-008/009/007), Signups and free trial (WD-SET-007). Save button top and bottom; Cancel returns to hub. Flash "General settings saved." (session key `status`).
- **Endpoints:**

| Endpoint                     | Route name                    | Action                                    | Middleware                                   | Request                       | Response                       |
| ---------------------------- | ----------------------------- | ----------------------------------------- | -------------------------------------------- | ----------------------------- | ------------------------------ |
| GET admin/settings/general   | admin.settings.general        | AdminPagesController@settingGeneral       | Authenticate, EnsureUserIsAdmin, IPAllowlist | -                             | HTML                           |
| PATCH admin/settings/general | admin.settings.general.update | AdminPagesController@settingGeneralUpdate | same                                         | multipart form (fields below) | redirect to general with flash |

- **Data:** Keys written: `app_name` (required, string max 80), `app_url` (nullable url max 191), `support_email` (nullable email max 160), `contact_number` (nullable string max 40), `from_email` (nullable email max 160), `address` (nullable string max 500), `map_iframe_url` (nullable string max 1000), plus the keys in WD-SET-006..010, 012. Reads defaults `app_name` <- `config('app.name','WaDesk')`, `app_url` <- `config('app.url')`.
- **Rules & edge cases:**
  1. All scalar validated fields are written on every save, including empty ones (empty becomes `''`). Type stored is derived from the validated PHP value: because validation returns raw request strings, checkbox values `'0'/'1'` and numbers are stored with type `string`, not `bool`/`int` (readers cast with `(bool)`/`(int)`, so it works). QUIRK for port: do not persist these as typed booleans without normalising readers.
  2. Every write uses description "General settings: <key>".
  3. After saving, an audit row `admin.settings.general_updated` (layer platform) lists updated field names, whether a favicon was uploaded and which logo theme slots were uploaded.
  4. If `platform_branding_footer` is among submitted fields (it always is), `NodeCacheBuster::bustAll()` is called so the Node bridge drops cached workspace settings (WD-SET-012).
  5. Consumption reality check (grep of code): `app_name` is read everywhere (via `Brand::name()`, SEO, mail subjects, PWA, exports). `app_url` is only used as the base URL in the support-ticket reply mailable; the aside claims callbacks/OAuth redirects derive from it, but they derive from `APP_URL`/request host. `support_email` is only used in the invoice view fallback; `from_email` only in the support-reply mailable; `contact_number`, `address` and `map_iframe_url` are never read by any consumer (the public contact page reads `site.*` keys from Site info, WD-SET-022). QUIRK / dead fields.
  6. The form is a PATCH with `_method`; file inputs need multipart.
- **Async & events:** audit row; Node cache bust (footer).
- **External systems:** Node bridge cache endpoint (via `NodeCacheBuster`).
- **Settings:** see Data.
- **Acceptance criteria:**
  - Given an empty App name, when saving, then a validation error is shown and nothing is persisted.
  - Given App name "Acme Chat" and save, then page titles, emails and the `X-AcmeChat-*` webhook headers show the new name on the next request.
  - Given an invalid App URL, then validation fails with a URL error.
  - Given save, then an audit row `admin.settings.general_updated` exists with the submitted field names.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (settingGeneral, settingGeneralUpdate); resources/views/admin/settings/general.blade.php; resources/js/charts/admin-settings-general.js; app/Support/Brand.php; Documentation/pages/admin-panel/system-settings.html.
- **Port notes:** API `PUT /platform/settings/general` with a zod schema; keep the unused fields only if a consumer is planned (drop `contact_number`, `address`, `map_iframe_url` in favour of Site info, or wire them to the public contact page). Next.js page with a timezone combobox. Use typed booleans/ints.

### WD-SET-006 — Platform defaults: timezone, language, currency, phone country, UI font

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-SET-005
- **Summary:** Platform-wide fallbacks used when a workspace or user has no preference: default timezone, default language, default currency, default phone country (dial code plus ISO) for every phone picker, and an optional Google-font UI family.
- **Actors & access:** Platform admin edits (general form); every user/workspace consumes.
- **UX & screens:** Part of the general form: Default timezone (Tom Select, options from the browser `Intl` list with a fallback set, current value pre-selected even if unknown), Default language (options = active `languages` rows "Name (code)", plus a "(custom)" option if the saved code is not active), Default currency (active `currencies` "CODE - Name", plus "(custom)" fallback), Default country (all 251 entries of `config/countries.php`; picking one fills hidden `default_country_code` and `default_country_iso`), Font family (Theme default plus 12 curated fonts).
- **Endpoints:** part of WD-SET-005 endpoints.
- **Data:** `default_timezone` (string max 64, default config app.timezone or `Asia/Kolkata` on the form), `default_language` (string max 12, default config app.locale/`en`), `default_currency` (string max 8, default `USD`), `default_country_code` (string max 6, default `+91`), `default_country_iso` (exactly 2 chars, default `in`), `font_family` (string max 40; blank = theme default).
- **Rules & edge cases:**
  1. Font keys come from a hard-coded catalogue: inter, roboto, open-sans, poppins, lato, montserrat, nunito, work-sans, dm-sans, rubik, manrope, plus-jakarta (each with a CSS stack and a Google Fonts family string). Server validation only checks max length 40, not membership; an unknown key resolves to "Theme default" at render.
  2. Font render: partial `app-font` loads the Google stylesheet (preconnect to fonts.googleapis.com/gstatic) and sets `--font-sans` and `body{font-family}`; emits nothing when the key is blank. Included by admin, user, guest and frontend layouts. QUIRK: privacy tension, the font is fetched from Google at page load regardless of cookie consent.
  3. `app_default_country()` returns `{code, iso}` normalised: code gets a leading `+` and digits only if missing, iso lowercased and must match `^[a-z]{2}$` else `in`; fallbacks `+91`/`in`. `app_default_country_name()` looks up the iso in `config/countries` and strips the "(+NN)" suffix, fallback "India". Used by phone pickers (profile, devices, contacts, connect, register, wa-links, widgets) and the auth-page footer.
  4. `default_language` is also written by the Languages screen "set default" (I18N) and read by the locale resolver (WD-SET-045). `default_currency` is read by pricing, checkout, deals, pipelines, invoices, packages, workspace provisioning (`AdminWorkspaceProvisioner`) and `FormatSettings` (WD-SET-044). `default_timezone` seeds new workspaces/users and the registration timezone picker (WD-SET-046).
  5. If the saved language/currency is not in the active list the select still shows it (custom) so a save does not silently change it.
- **Async & events:** none.
- **External systems:** Google Fonts CDN (client-side) for the chosen font.
- **Settings:** the six keys above; `config/countries.php`; active `languages` and `currencies` tables.
- **Acceptance criteria:**
  - Given the default country set to Indonesia, when opening the register page phone picker, then it defaults to `+62` and the `id` flag.
  - Given font `inter`, when loading any layout, then the Inter stylesheet link and `--font-sans` override are present; given blank, then neither is emitted.
  - Given a default_country_iso of three characters, then validation fails.
  - Given the saved default language is not active, then the select still lists it as "(custom)".
- **Source refs:** app/Http/Controllers/AdminPagesController.php (settingGeneral*); app/Support/fc_helpers.php (app_default_country, app_default_country_name, app_font_catalog, app_font); resources/views/partials/app-font.blade.php; resources/js/lib/tz-picker.js; config/countries.php; resources/views/admin/settings/general.blade.php.
- **Port notes:** Store as typed fields on the platform settings row; ship the country list as a package (no DB). Lists of languages and currencies come from I18N/CPN modules. Load the font via `next/font` self-hosted to avoid third-party requests.

### WD-SET-007 — Signup policy: public registration, auto-verify email, default plan, trial days, plan scope

- **Status:** partial
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-SET-005
- **Summary:** Five settings on the General page control what happens when a new account signs up and how paid plans apply across an owner's workspaces. Four are enforced; the "Public registration" switch is stored but nothing reads it (partial).
- **Actors & access:** Platform admin edits; the registration flows (web and mobile) and workspace entitlement resolver consume.
- **UX & screens:** In `general.blade.php`. Platform toggles card: "Public registration" (helper text "Anyone can sign up at /register"), "Auto-verify email on signup" (helper explains SMTP-less or invite-only use). Card "Signups and free trial": Default plan for new signups (select: "Auto - first active free plan" plus active plans from `packages` ordered by sort order then name, each suffixed "Free trial" or "Paid plan" via `isFreePlan()`), Free trial length in days (number 0-365), Plan scope (select: per workspace default, or per account). Each toggle is a hidden `0` plus a checkbox `1` so unchecked posts `0`.
- **Endpoints:** part of WD-SET-005 (`PATCH admin/settings/general`).
- **Data:** `public_registration` (bool, default true), `auto_verify_email` (bool, code default true; seeder writes `1`; the form falls back to false for display when the row is absent, QUIRK), `registration_default_plan_id` (string max 64, must `exists:packages,plan_id`; blank allowed), `registration_trial_days` (int 0-365, default 14), `billing_plan_scope` (`workspace` | `account`, default `workspace`).
- **Rules & edge cases:**
  1. Plan resolution at signup (web `AuthController`, `WorkspaceProvisioner`, mobile register): use `registration_default_plan_id` if that package is active; else the package flagged `is_default`; else the first active package that is free (`free=1` or amount 0 and not custom-quote) by sort order; else the literal slug `starter`.
  2. Trial: only when the resolved package `isFreePlan()` AND `registration_trial_days` > 0: workspace gets `trial_ends_at = now + days` and `billing_cycle = 'trial'`. Days = 0 means free plan with no expiry. Paid default plans never get a trial.
  3. Auto-verify: when true, new users get `email_verified_at = now` at creation (web and mobile). Additionally the `EnsureUserActive` middleware stamps ANY existing unverified user as verified on their next request when the flag is true, and otherwise redirects unverified users to the verify-email screen. So flipping the flag on retroactively verifies legacy users.
  4. Plan scope `account`: `Workspace::billingPackage()` returns the owner's best plan (highest-priced non-free package across all workspaces they own) instead of the workspace's own package, which drives limits, features, trial and the hard gate; scope `workspace` uses the workspace's own package. Read on every entitlement check.
  5. `public_registration` is never read by `AuthPagesController@register`, routes or middleware: turning it off does NOT block sign-up. Docs claim "Allow new accounts to sign themselves up". Treat as unbuilt; the port should enforce it (return 403 / hide the register link).
  6. Docs say Auto-verify default is Off; code default and seeder are On.
  7. Changing the default plan does not touch existing workspaces.
- **Async & events:** none (settings only). Signup itself is AUTH.
- **External systems:** none.
- **Settings:** as above.
- **Acceptance criteria:**
  - Given default plan "Free" (free) and trial days 14, when a user signs up, then their workspace is on Free with `trial_ends_at` about 14 days out and `billing_cycle` trial.
  - Given default plan set to a paid plan, when a user signs up, then no trial window is set.
  - Given `auto_verify_email` on, when a user registers, then the verify-email screen is skipped and `email_verified_at` is set.
  - Given `billing_plan_scope` = account and an owner with a paid plan on workspace A, when they open workspace B (free), then B's limits follow the paid plan.
  - Given `public_registration` off (target behavior), when visiting `/register`, then registration is refused (not WaDesk behavior; call out in the port).
- **Source refs:** app/Http/Controllers/AdminPagesController.php (settingGeneral*); app/Http/Controllers/AuthController.php; app/Http/Controllers/AuthPagesController.php; app/Services/WorkspaceProvisioner.php; app/Http/Middleware/EnsureUserActive.php; app/Models/Workspace.php (billingPackage); app/Http/Controllers/Api/App/AuthController.php; database/seeders/DatabaseSeeder.php; Documentation/pages/admin-panel/system-settings.html.
- **Port notes:** Store on the platform settings row, read by the AUTH and PLAN modules through a settings service. Enforce registration-open server side. Tenancy: `billing_plan_scope` decides which org's plan is authoritative for an owner with several workspaces (org-level vs workspace-level plan), so PLAN must expose one `resolveEntitlements(workspace)` used everywhere.

### WD-SET-008 — Maintenance mode toggle and enforcement middleware

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-SET-005
- **Summary:** A single switch takes the customer-facing app offline with a branded 503 page while platform staff keep working and machine callbacks keep flowing.
- **Actors & access:** Platform admin toggles; visitors are blocked; platform staff (Super Admin, Admin, Support, Auditor roles via `PlatformPermissions::userHasPlatformAccess`) bypass.
- **UX & screens:** Toggle "Maintenance mode" on the general page ("All user pages show be right back"). Blocked visitors see `errors.503` with `maintenance=true` and an "Admin sign in" path; JSON callers receive `{message: "The service is temporarily down for maintenance..."}` with HTTP 503 and `Retry-After: 3600`.
- **Endpoints:** none of its own; middleware `Maintenance` appended to the `web` group in `bootstrap/app.php` (before impersonation banner, activity, referral, user-active, trial gate).
- **Data:** `maintenance_mode` (bool default false).
- **Rules & edge cases:**
  1. No-op before install (`storage/installed` file missing) and when the flag is off.
  2. Bypass for any authenticated platform-role user (also covers an admin impersonating a customer).
  3. Always-open paths: `login`, `logout`, `auth/*` (social), `csrf-token`, `up`, `build/*`, `css/*`, `js/*`, `images/*`, `fonts/*`, `storage/*`, `favicon.ico`, `robots.txt`, and machine-to-machine `webhooks/*`, `hooks/in/*`, `api/*`, `shopify/webhook/*`, `woocommerce/webhook/*`, `payment/webhook/*`, `payment/callback/*`, `wd-sync`. Reason: providers retry only a few times and drop delivery receipts, inbound messages and paid-order events otherwise; senders are authenticated by their own signatures.
  4. History: the toggle used to do nothing until this middleware was added.
  5. Not covered: `sitemap.xml` and the marketing pages are 503 too (only robots.txt is exempt).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `maintenance_mode`.
- **Acceptance criteria:**
  - Given maintenance on, when an anonymous visitor opens `/pricing`, then a 503 branded page with Retry-After is returned.
  - Given maintenance on, when a signed-in Super Admin opens the dashboard, then it renders normally.
  - Given maintenance on, when Meta POSTs a webhook to `webhooks/whatsapp/inbound`, then it is processed (not 503).
  - Given maintenance on and an unauthenticated admin, when opening `/login`, then the login page is reachable.
- **Source refs:** app/Http/Middleware/Maintenance.php; bootstrap/app.php; app/Support/PlatformPermissions.php; resources/views/admin/settings/general.blade.php.
- **Port notes:** A NestJS global guard/interceptor for the web app and a Next.js middleware check; keep the machine-callback allowlist as a config list (webhooks, public API). Cache the flag in memory with pub/sub invalidation.

### WD-SET-009 — Preloader toggle (stored, never consumed)

- **Status:** dead-code
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-SET-005
- **Summary:** "Preloader - Show the loading splash on every page" is saved (default true) but no layout, partial or script reads it. Documented as a real feature; behavior is absent.
- **Actors & access:** Platform admin toggles; no consumer.
- **UX & screens:** Toggle on the general page only.
- **Endpoints:** part of WD-SET-005.
- **Data:** `preloader` (default true).
- **Rules & edge cases:** 1. A repo-wide search finds no reader outside the settings form. 2. Port decision: implement a real splash tied to the flag, or drop the setting. Do not port a dead toggle.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `preloader`.
- **Acceptance criteria:**
  - Given the toggle is saved off then on, when reloading the form, then it reflects the saved value (only persistence is testable in WaDesk).
  - Given a port that implements it, when off, then no splash renders on any page.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (settingGeneral*); resources/views/admin/settings/general.blade.php; Documentation/pages/admin-panel/system-settings.html.
- **Port notes:** Recommend not building unless product asks; if built, render in the Next.js root layout from the public settings payload.

### WD-SET-010 — Brand assets: shared favicon and per-theme logos

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-SET-005
- **Summary:** Admin uploads one favicon shared by all themes and one logo per UI theme (paper, bright, dark, doodle). Layouts, emails, invoices and the mobile app read them through `Brand`.
- **Actors & access:** Platform admin uploads; everyone sees.
- **UX & screens:** General page card "Brand assets": Favicon block (preview box, recommended 35x35 px, PNG or ICO, current file name, "uploading replaces it") and "Logo per theme" grid of four cards labelled Paper (default), Bright white, Dark (beta) ("use a light/inverted logo"), Doodle (fancy) each with preview, file input and a note. Selecting a file previews instantly with an object URL (client only).
- **Endpoints:** part of WD-SET-005 (`PATCH admin/settings/general`, multipart).
- **Data:** `brand.favicon` (string path under the public disk, e.g. `brand/<hash>.png`), `brand.logo.<theme>` for paper/bright/dark/doodle. Files stored with `store('brand','public')` (random hashed names).
- **Rules & edge cases:**
  1. Validation: `favicon` file, mimes png,ico,jpg,jpeg,svg,webp, max 512 KB. `logos` array; each file mimes png,jpg,jpeg,svg,webp, max 1024 KB.
  2. The logo slot key is taken from the array key sanitised to `[a-z0-9_-]`; any sanitised id is accepted and stored (not restricted to the four themes).
  3. Replacing an upload writes a new file and updates the key; the old file is NOT deleted (orphans accumulate).
  4. Brand assets are stored on the local `public` disk on purpose and never go to cloud storage (WD-SET-040), so the platform identity does not depend on an external bucket.
  5. Resolution: `Brand::logoUrl(theme)` returns the theme's logo, else falls back to the paper logo, else null (callers render a text wordmark). A stored value that starts with `http(s)://` is passed through; otherwise `asset('storage/<path>')`. `hasAnyLogo()` checks all four slots. `faviconUrl()` returns null when unset.
  6. Consumers: admin/user/guest/frontend layouts (favicon, header logo), auth shell, emails, invoices (invoice logo falls back to the brand logo when `billing.logo` unset), mobile config (paper and dark logos, fallback to a bundled brand mark).
  7. No removal control exists (cannot clear a logo back to none).
- **Async & events:** audit info only (general audit lists which slots changed).
- **External systems:** none.
- **Settings:** keys above.
- **Acceptance criteria:**
  - Given a dark-theme logo uploaded, when a user with `wa-theme=dark` loads the app, then that logo renders; given none uploaded for dark, then the paper logo renders.
  - Given a 600 KB favicon, then validation fails (limit 512 KB); given 900 KB SVG logo, then it is accepted.
  - Given no logos at all, then the layouts show the text wordmark.
  - Given a new favicon upload, then the previous file remains on disk but is no longer referenced.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (BRAND_THEMES, settingGeneral*); app/Support/Brand.php; resources/views/admin/settings/general.blade.php; resources/js/charts/admin-settings-general.js; Documentation/pages/admin-panel/system-settings.html.
- **Port notes:** Uploads via the file/media module into object storage (or a dedicated public bucket for brand assets), store asset ids not disk paths, delete or version the old asset. Serve with cache headers. Add a "remove logo" action. Theme ids should be a shared enum with the frontend.

### WD-SET-011 — Brand identity helpers (name, token, email, webhook header prefix, partner names)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-SET-005, WD-SET-022
- **Summary:** A set of small resolvers so the product can be re-branded from settings: the platform name, an identifier-safe token, role-based contact emails, brand-prefixed outbound-webhook header names, partner product names and the invoice billing identity.
- **Actors & access:** Server-side consumers only.
- **UX & screens:** None (values appear across the product).
- **Endpoints:** none.
- **Data:** reads `app_name`, `site.email_<role>`, `site.email_support`, `site.domain`, `instaflow_brand`, `mailtrixy_brand`, `billing.company|address|tax_id|reg_no|email|phone|logo`, `checkout.tax_enabled`, `checkout.tax_label`.
- **Rules & edge cases:**
  1. `Brand::name()` = trimmed `app_name` else the literal "WaDesk"; never falls back to `APP_NAME`.
  2. `brand_token(n)` = brand name reduced to letters, uppercased, first n chars (default 6), fallback `SENDER`; used for example sender IDs and storage path hints.
  3. `brand_email(prefix)` = `site.email_<prefix>` else `site.email_support` else `<prefix>@<domain>` where domain = `site.domain` else request host else the app URL host else `example.com`, with a leading `www.`/`app.` stripped. QUIRK: `site.domain` is not editable anywhere (Site info has no such field), so it is effectively always empty.
  4. Webhook headers: prefix `X-` + brand name stripped to alphanumerics (fallback `WaDesk`), then `-Signature`, `-Event`, `-Hook-Id`. Used by the outbound webhook dispatchers and mirrored in the API docs.
  5. `ig_brand_name()` / `mailtrixy_brand_name()` return trimmed `instaflow_brand` / `mailtrixy_brand` (set on the add-ons screen, ADD) else `IgDesk` / `MailTrixy`; display only.
  6. `Brand::billing()`: company (fallback brand name), address, tax id, registration number, email, phone, tax on/off (default true), tax label (default GST), logo. Edited on Checkout settings (CHK) but resolved here.
  7. `Brand::invoiceLogoUrl()`: `billing.logo` else the paper brand logo.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** see Data.
- **Acceptance criteria:**
  - Given app name "Acme Corp", then the signature header is `X-AcmeCorp-Signature`.
  - Given app name blank, then `Brand::name()` returns "WaDesk".
  - Given no `site.email_privacy` but `site.email_support=help@x.com`, then `brand_email('privacy')` returns `help@x.com`.
  - Given nothing set on a host `www.acme.io`, then `brand_email('billing')` returns `billing@acme.io`.
- **Source refs:** app/Support/Brand.php; app/Support/fc_helpers.php (brand_name, brand_token, brand_email, ig_brand_name, mailtrixy_brand_name); app/Services/WebhookService.php; app/Services/Inbox/OutboundWebhookDispatcher.php.
- **Port notes:** A `BrandingService` in the platform-settings module with a cached snapshot; webhook header names built from it (API domain owns header naming rules).

### WD-SET-012 — Platform outbound message footer and per-workspace resolution

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-SET-005
- **Summary:** The platform admin sets a short footer (for example "Sent via <brand>") that is appended to outbound WhatsApp plain-text and interactive messages for workspaces whose plan lacks the `remove_branding` feature. Plans that have it can set their own footer or none.
- **Actors & access:** Platform admin sets `platform_branding_footer`; workspace owners with the plan feature set `workspaces.branding_footer` in Account -> Branding (WSP/CHAT).
- **UX & screens:** General page field "Platform message footer" (max 60 chars, placeholder "Sent via <app name>", helper about templates being excluded).
- **Endpoints:** part of WD-SET-005 (`PATCH admin/settings/general`).
- **Data:** `platform_branding_footer` (string max 60, seeded "Sent via WaDesk"); `workspaces.branding_footer` varchar(60) null.
- **Rules & edge cases:**
  1. Resolution (`BrandingFooterService::resolve(workspace)`): no workspace -> platform default (trimmed, cut to 60) or null when blank. With a workspace: if `PlanLimitGuard::hasFeature(workspace, 'remove_branding')` then return the workspace's own footer (trimmed, cut to 60), null when unset or blank, and NEVER fall back to the platform default; otherwise return the platform default (or null when blank).
  2. `appendToBody(body, workspace)` appends `\n\n_<footer>_` (italic) unless the body already ends with that exact string; returns the body unchanged when no footer applies. Interactive messages (buttons, list, cta, location, poll, cards) use the footer field with the same 60-char cap. Templates are excluded (Meta-approved content cannot be mutated).
  3. Results are cached per workspace id within a request (static array); `flushCache()` after the workspace changes its footer.
  4. Saving the admin form busts the Node bridge's settings cache for all workspaces so the new default applies immediately (`NodeCacheBuster::bustAll`). The Node bridge fetches the resolved footer through `api/whatsapp-message-settings` (NODE).
  5. A migration seeded the default with the brand name at that time as a `string`-typed row (an earlier draft stored it typed `int`, which read back as 0).
- **Async & events:** Node cache bust on save.
- **External systems:** Node bridge cache endpoint.
- **Settings:** `platform_branding_footer`; plan feature `remove_branding`.
- **Acceptance criteria:**
  - Given plan without `remove_branding` and platform footer "Sent via Acme", when a plain text message is sent, then the body ends with `_Sent via Acme_` after a blank line.
  - Given plan with `remove_branding` and workspace footer unset, when sending, then no footer is appended.
  - Given plan with `remove_branding` and workspace footer "Team X", then `Team X` is used (60 chars max).
  - Given a template send, then no footer is appended by this service.
  - Given the admin saves a new footer, then the Node bridge cache is cleared.
- **Source refs:** app/Services/BrandingFooterService.php; app/Http/Controllers/AdminPagesController.php (settingGeneralUpdate); app/Services/InboxDispatcher.php; app/Http/Controllers/WaConnectController.php (nodeMessageSettings); app/Http/Controllers/AccountController.php; database/migrations/2026_05_24_100000_add_branding_footer_to_workspaces_and_seed_platform_default.php; app/Services/NodeCacheBuster.php.
- **Port notes:** Implement in the outbound message pipeline (provider adapter layer) with plan feature `remove_branding` from the PLAN module; keep the 60-char cap for interactive footers. Expose the resolved footer to the WhatsApp session worker instead of a cache-bust call.

### WD-SET-013 — Appearance: dashboard colour tokens

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-SET-001
- **Summary:** The admin recolours the entire user and admin dashboards by overriding 16 theme colour tokens; changes are injected as CSS variables and apply instantly to everyone with no rebuild. One primary colour drives related shades automatically.
- **Actors & access:** Platform admin. Docs advertise `/admin/appearance` but the real path is `/admin/settings/appearance`.
- **UX & screens:** `resources/views/admin/settings/appearance.blade.php` (page key `admin-settings-appearance`). Left: layout picker, sidebar colours, Interface sliders (WD-SET-014/015), then colour groups Brand, Surfaces, Text, Accents (each token a colour input with caption "token - #hex"). Right: live preview mock (top bar, sidebar, content cards, chart bars, buttons) where the tokens are applied as inline CSS custom properties on the preview box only, plus a quick guide and "Reset all colours" (a separate form outside the main form, confirm dialog "Reset every colour back to the shipped defaults?"). Save button top and in a sticky bar; success flash under session key `status`: "Appearance saved - the whole dashboard has been updated." Preview JS in `charts/admin-settings-appearance.js`.
- **Endpoints:**

| Endpoint                             | Route name                       | Action                            | Middleware                                   | Request                                                                  | Response              |
| ------------------------------------ | -------------------------------- | --------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------ | --------------------- |
| GET admin/settings/appearance        | admin.settings.appearance        | Admin\AppearanceController@index  | Authenticate, EnsureUserIsAdmin, IPAllowlist | -                                                                        | HTML                  |
| POST admin/settings/appearance       | admin.settings.appearance.update | Admin\AppearanceController@update | same                                         | `colors[token]`, `metrics[key]`, `user_dashboard_layout`, sidebar fields | redirect back + flash |
| POST admin/settings/appearance/reset | admin.settings.appearance.reset  | Admin\AppearanceController@reset  | same                                         | -                                                                        | redirect back + flash |

- **Data:** `theme.color.<token>` per token (string hex or empty = shipped default). Tokens (suffix -> label, default, group): wa-deep Primary #075E54; wa-teal Primary hover #128C7E; wa-green Accent/success #25D366; wa-mint Soft accent fill #DCF8C6; wa-bubble Chat bubble #E7FFDB (all Brand); paper-0 Page background #FBFAF6; paper-50 Card/muted bg #F5F3EC; paper-100 Hover background #EFEBE0; paper-200 Borders #E5DFD0 (Surfaces); ink-500 Muted text #6B807C; ink-700 Body text #1F4540; ink-900 Headings #0B1F1C (Text); accent-coral #E87A5D; accent-amber #E5A04E; accent-plum #5B3D8A; accent-sky #3E7AA1 (Accents).
- **Rules & edge cases:**
  1. Save iterates ALL 16 tokens: a value matching `^#[0-9A-Fa-f]{3,8}$` is stored, anything else (blank, malformed) is stored as an empty string. Because the color inputs always post a hex, a save stores every token, including unchanged defaults.
  2. `theme_css()` emits `<style id="wa-theme-overrides">:root{--color-<token>:<hex>...}` only for tokens that are valid hex AND differ (case-insensitive) from the shipped default, so an untouched install renders identically. The style is injected last in the `<head>` of the admin and user layouts (not the guest, auth or public layouts).
  3. Derived family: when `wa-deep` is overridden, any of wa-teal, wa-green, wa-mint, wa-bubble NOT explicitly overridden is derived from it: teal = primary with +0.08 lightness (OKLCH relative colour), green = primary at 0.72 lightness, mint = 16% primary mixed with white, bubble = 10% mixed with white. An explicit override always wins.
  4. Reset writes an empty string for all 16 tokens AND resets both metrics to defaults (WD-SET-014); it does not touch layout or sidebar colours.
  5. Charts read colours from the live CSS variables (`theme-colors.js` `themeColor/themeAlpha/chartPalette`) with hard-coded fallbacks matching the defaults.
  6. `workspace_brand_color()` treats a workspace colour equal to the shipped `#075E54` as "not chosen" and follows the live theme token; otherwise a valid hex is used.
  7. No audit row is written for appearance changes.
  8. Docs warn about contrast; no contrast validation exists.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `theme.color.*`.
- **Acceptance criteria:**
  - Given Primary set to a purple and saved, then buttons, hover, accent, selected rows and chat bubbles across the user and admin dashboards use purple-derived shades on the next load.
  - Given all tokens at default and save, then no `wa-theme-overrides` style is emitted.
  - Given a malformed hex posted by a crafted request, then that token is stored empty (default).
  - Given "Reset all colours", then every token returns to default and font scale/opacity return to 100.
- **Source refs:** app/Http/Controllers/Admin/AppearanceController.php; app/Support/fc_helpers.php (theme_palette, theme_color, theme_metrics, theme_metric, theme_css, workspace_brand_color); resources/views/admin/settings/appearance.blade.php; resources/js/charts/admin-settings-appearance.js; resources/js/theme-colors.js; resources/views/components/layouts/admin.blade.php; resources/views/components/layouts/user.blade.php; Documentation/pages/admin-panel/appearance.html.
- **Port notes:** Store a `theme` JSON on the platform settings row; expose it in a public `GET /public/theme` and inject a `:root{--color-*}` style in the Next.js root layout (server-rendered, avoids flash). Tailwind tokens must be CSS variables. Keep derived-shade logic (color-mix/oklch relative colour requires modern browsers; consider computing shades server-side).

### WD-SET-014 — Appearance: interface size and opacity metrics

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-SET-013
- **Summary:** Two sliders scale the whole interface (font size 80-130%) and its overall opacity (55-100%) platform-wide.
- **Actors & access:** Platform admin.
- **UX & screens:** "Interface" card in the appearance page: label, current value with unit, minus/plus stepper buttons (step 5), range input (step 1), help text. Live preview damps zoom to half the deviation so it fits.
- **Endpoints:** part of WD-SET-013 update/reset.
- **Data:** `theme.metric.font-scale` (default 100, min 80, max 130) and `theme.metric.ui-opacity` (default 100, min 55, max 100), stored as integer-percent strings.
- **Rules & edge cases:**
  1. Server clamps every posted value into its declared range; non-numeric or blank values are skipped (kept as-is). This prevents a crafted request from setting zoom to 0 and locking the admin out.
  2. Emission: `--wa-font-scale: n/100` with `html{zoom:var(--wa-font-scale)}` when not 100 (CSS `zoom` chosen because the codebase sizes type in px literals and fixed overlays must stay placed); `--wa-ui-opacity` with `body{opacity:...}` when not 100.
  3. Reset sets both to their defaults.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `theme.metric.*`.
- **Acceptance criteria:**
  - Given font scale 90, then `html{zoom:0.9}` is emitted on admin and user layouts.
  - Given a posted font-scale of 500, then 130 is stored.
  - Given both at 100, then no zoom/opacity CSS is emitted.
- **Source refs:** app/Http/Controllers/Admin/AppearanceController.php; app/Support/fc_helpers.php (theme_metrics, theme_metric, theme_css); resources/views/admin/settings/appearance.blade.php; resources/js/charts/admin-settings-appearance.js.
- **Port notes:** `zoom` is non-standard (works in Chromium/WebKit, and Firefox since 126). Prefer a root font-size/rem scale in the new stack and drop body opacity, or keep both behind the same clamped fields.

### WD-SET-015 — User dashboard shell layout and sidebar rail colours

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** WD-SET-013
- **Summary:** The admin chooses whether every customer sees the classic top-bar navigation (with a "More" overflow page) or an admin-style left sidebar rail with all features grouped, and can recolour the rail (background, text, accent).
- **Actors & access:** Platform admin sets; all workspace users see. Role tiers and plan features still filter sidebar items per user.
- **UX & screens:** Appearance page cards "Navigation layout" (two radio cards: Top bar "Current - menu across the top plus a More page", Sidebar "Admin-style left rail ... No top menu") and "Sidebar colour" (background colour input, then Text and Accent each with a "Custom" checkbox that enables the colour input; unchecked = auto contrast / default green).
- **Endpoints:** part of `POST admin/settings/appearance`.
- **Data:** `user_dashboard_layout` (`topbar` default | `sidebar`), `user_sidebar_color`, `user_sidebar_text_color`, `user_sidebar_accent_color` (hex or empty).
- **Rules & edge cases:**
  1. Layout is saved only if the posted value is exactly `topbar` or `sidebar`; otherwise unchanged.
  2. Colours must match `^#[0-9A-Fa-f]{6}$` else stored empty. A hidden `<key>_use` field set to `0` forces empty (the browser colour input always posts a hex). The background has no "use" checkbox, so saving always stores a background hex, initially `#06100E`. QUIRK: after the first save the rail is considered custom-coloured even if the admin never chose one.
  3. Sidebar mode uses `UserNav::groups()`: a full grouped catalogue (Overview, Inbox and Chat, Audience, ...), items filtered by workspace role tier (agent < manager < admin), plan feature flags, and channel availability toggles (`facebook_enabled`, `tiktok_enabled`, `telegram_enabled`, `sms_enabled`, `line_enabled`, `wechat_enabled`, `viber_enabled`, `email_enabled`, Instagram add-on/Instaflow, WABA connection). There is no "/more" page in this mode.
  4. Layout is exposed on `<body data-user-shell>`; the rail component reads the three colours.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** the four keys; channel-enable flags (owned by channel domains).
- **Acceptance criteria:**
  - Given Sidebar layout saved, when a workspace admin opens the dashboard, then a left rail lists the grouped catalogue and there is no top nav.
  - Given a posted layout of `weird`, then the setting is unchanged.
  - Given the Text "Custom" box unchecked, then text colour is auto-chosen for contrast on the rail background.
  - Given Instagram not available, then Instagram items are absent from the rail.
- **Source refs:** app/Http/Controllers/Admin/AppearanceController.php; app/Support/UserNav.php; resources/views/components/user/sidebar-rail.blade.php; resources/views/components/layouts/user.blade.php; resources/views/admin/settings/appearance.blade.php.
- **Port notes:** Implement the nav as data (registry with tier + feature + channel gates) evaluated in the Next.js shell; the layout preference is a platform setting delivered with the user session bootstrap. RBAC tiers map to the roles module.

### WD-SET-016 — Menu layout editor (top bar vs More page)

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** WD-SET-015
- **Summary:** For the top-bar layout the admin decides which of 25 navigation items sit in the header bar (and in what order) versus on the More page, with drag and drop and a live preview.
- **Actors & access:** Platform admin; applies to all users; per-user role/plan gates still apply.
- **UX & screens:** `resources/views/admin/settings/menu-order.blade.php` with partial `_menu_chip`. Two lists: "Top navigation bar" and "More menu", each with an item count; live preview strip; each chip shows label, description, a drag handle and a move button (down arrow to More, up arrow to Top bar). "More" is locked in the bar ("always in the bar", move button hidden). "Reset layout" moves the default set back (Dashboard, Campaigns, Flows, Templates, Meta Ads, Devices, More) and everything else to More. Save posts `bar[]` in order; flash "Menu layout saved. Users see it on their next page load." (`success`).
- **Endpoints:**

| Endpoint                       | Route name                       | Action                                      | Middleware  | Request             | Response         |
| ------------------------------ | -------------------------------- | ------------------------------------------- | ----------- | ------------------- | ---------------- |
| GET admin/settings/menu-order  | admin.settings.menu-order        | AdminPagesController@settingMenuOrder       | admin stack | -                   | HTML             |
| POST admin/settings/menu-order | admin.settings.menu-order.update | AdminPagesController@settingMenuOrderUpdate | admin stack | `bar[]` (item keys) | redirect + flash |

- **Data:** `user_nav_order` stored as type json whose value is a JSON string of `{"bar":[keys]}` (double-encoded). Item catalogue (key, label, default zone): dashboard, wa-campaigns, flows, templates, metaads, devices, more (bar); broadcasts, contacts, team-inbox, deals, chat, analytics, auto-reply, scheduled, message-history, ai-assistants, ai-training, wa-links, chatbot-widgets, webhooks, integrations, warmer, call-logs, support (more).
- **Rules & edge cases:**
  1. Save keeps only known keys, de-duplicates, and always appends `more` if absent. Items not in `bar` are implicitly the More zone (canonical order).
  2. Reading supports three formats: new `{bar:[]}` (only listed items in the header, in that order), legacy flat list (reorder only, promo items hidden), and empty (default header). `promo`-tagged items only appear in the header when explicitly placed there.
  3. No audit row and no permission beyond admin. Not used in sidebar layout (WD-SET-015).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `user_nav_order`.
- **Acceptance criteria:**
  - Given Contacts is dragged into the Top bar and saved, then the customer header shows Contacts in that position on next load.
  - Given `bar[]` posted without `more`, then `more` is appended.
  - Given "Reset layout" then Save, then the stored bar equals the default 7 keys.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (userNavItems, resolvedNavBar, settingMenuOrder*); resources/views/admin/settings/menu-order.blade.php; resources/views/admin/settings/_menu_chip.blade.php; resources/views/components/user/header.blade.php; resources/views/user/more/index.blade.php.
- **Port notes:** Store as a JSON array on the platform settings row (single encode). Nav keys must align with the new app's route registry. Drag/drop via dnd-kit in Next.js.

### WD-SET-017 — Personal theme preference and per-theme logo selection

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-SET-010
- **Summary:** Each user can pick a UI theme (paper, bright, dark and, in the client switcher, doodle). The chosen theme decides which brand logo is rendered. A cookie is the source of truth on the server render; the database column is only a fallback.
- **Actors & access:** Any signed-in user for the settings-page radio; the header theme menu works for everyone (client-side).
- **UX & screens:** User Settings -> Appearance radios (Paper, Bright, Dark) posting `theme_preference` (inside `user/settings/index.blade.php`, owned by AUTH/profile). The header theme menu (`wa-theme-btn`, `wa-theme-menu` in `wadesk.js`) switches instantly and includes Doodle.
- **Endpoints:**

| Endpoint                 | Route name               | Action                                  | Middleware   | Request                                 | Response                           |
| ------------------------ | ------------------------ | --------------------------------------- | ------------ | --------------------------------------- | ---------------------------------- |
| POST settings/appearance | user.settings.appearance | SettingsTabsController@updateAppearance | Authenticate | `theme_preference` in paper,bright,dark | back + flash "Appearance updated." |

- **Data:** `users.theme_preference` varchar(16) (paper|bright|dark; cannot store doodle); cookie `wa-theme` (1 year, SameSite Lax) and `localStorage['wa-theme']` set by `wadesk.js`.
- **Rules & edge cases:**
  1. `Brand::activeTheme()`: cookie value if it is one of paper/bright/dark/doodle, else `users.theme_preference`, else `paper`. Server-rendering the logo from the cookie avoids a logo flash on reload.
  2. DB saves only accept three themes; doodle lives only in the cookie/localStorage.
  3. A theme with no uploaded logo falls back to the paper logo (WD-SET-010).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none platform-level.
- **Acceptance criteria:**
  - Given cookie `wa-theme=dark` and a dark logo uploaded, when a page renders, then the dark logo `<img>` is server-rendered.
  - Given no cookie and `theme_preference=bright`, then bright is used.
  - Given a posted `theme_preference=doodle`, then validation fails.
- **Source refs:** app/Http/Controllers/SettingsTabsController.php (updateAppearance); app/Support/Brand.php (activeTheme); resources/js/wadesk.js; resources/views/user/settings/index.blade.php.
- **Port notes:** Store preference on the user profile (all four themes) and set the cookie in the Next.js app; resolve logos server-side from the active theme.

### WD-SET-018 — Auth pages editor: design template and live editable frame

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-SET-001
- **Summary:** The admin restyles the public Login, Register and Forgot-password pages by editing the REAL page inside an iframe. One of five design templates is chosen once and applies to all three pages; each page keeps its own wording, accent colour and side media.
- **Actors & access:** Platform admin. The preview and its editing bridge exist only for an admin who opens the page with `?fc_edit=1`; visitors never receive the bridge.
- **UX & screens:** `resources/views/admin/settings/auth-pages.blade.php`. Toolbar: page tabs (Login, Register, Forgot password; via `?page=`), Accent colour picker (saves through WD-SET-019), Reload button, "Full screen" link (opens the preview route with `?fc_edit=1` in a new tab). "Design template" picker with 5 schematic buttons: 1 Split showcase (feature panel left, form right), 2 Cinematic (full-bleed media, centred card), 3 Minimal (clean centred card, no art), 4 Brand spotlight (accent panel left, form right), 5 Aurora (animated gradient, glass card). Selecting one POSTs JSON and reloads the frame. Below: an iframe (78vh, min 560px) pointing at the preview route. Header text explains click-to-edit; Terms/Privacy footer links point to Privacy and ADA settings.
- **Endpoints:**

| Endpoint                                     | Route name                        | Action                                       | Middleware  | Request                                | Response                                                                 |
| -------------------------------------------- | --------------------------------- | -------------------------------------------- | ----------- | -------------------------------------- | ------------------------------------------------------------------------ |
| GET admin/settings/auth-pages                | admin.settings.auth-pages         | AdminPagesController@settingAuthPages        | admin stack | `page` query login/register/forgot     | HTML                                                                     |
| GET admin/settings/auth-pages/preview/{page} | admin.settings.auth-pages.preview | AdminPagesController@settingAuthPagesPreview | admin stack | page in login,register,forgot else 404 | renders `auth.login` / `auth.register` / `auth.forgot-password` directly |
| POST admin/settings/auth-pages/variant       | admin.settings.auth-pages.variant | AdminPagesController@settingAuthPagesVariant | admin stack | `variant` integer 1-5                  | JSON `{ok, variant}`                                                     |

- **Data:** `auth.variant` (string "1".."5", default "1"; values outside 1-5 read as 1). Per page `auth.<page>.eyebrow|heading|heading_accent|subheading|accent|media_url|media_type` plus showcase keys (WD-SET-019). Shipped defaults: login eyebrow "Operator console for WhatsApp", heading "One place for every" + accent "conversation", subheading "Broadcasts, flows, AI assist, shared inbox - all in one workspace your team will actually use."; register "Get started in minutes" / "Start your" + "free trial" / "Create your workspace and connect your first WhatsApp number in minutes."; forgot "Account recovery" / "Get back in," + "fast" / "Enter your email and we will send you a secure link to reset your password." Accent default `#25D366`.
- **Rules & edge cases:**
  1. Unknown `?page=` values fall back to Login.
  2. The preview route exists because the real auth routes sit behind the `guest` middleware, which would redirect a logged-in admin to the dashboard. The preview renders the same Blade views with no redirect. The Register preview shows the first step.
  3. The guest layout injects `public/js/auth-editor-bridge.js` only when `fc_editing()` (query `fc_edit` true AND user is admin), carrying the endpoint URLs and CSRF token in data attributes.
  4. Real pages read content via `auth_cfg(page, key, default)`: a missing OR empty value returns the default, so clearing a field restores the shipped copy. Variant read via `SystemSetting::get('auth.variant')`.
  5. All five layouts are produced by the `x-auth-shell` component (`resources/views/components/auth-shell.blade.php`): logo block (brand logo or wordmark), eyebrow, heading with an accented italic word coloured by `auth.<page>.accent`, subheading, media panel; `data-fc` and `data-ae-media` hooks are kept in every variant so the editor works everywhere. The Register page also has a separate showcase panel partial (`_register_showcase`) with stat pills, feature cards and chips editable through the same bridge.
  6. No audit row is written for auth-page edits; saves are instant with no draft/publish step.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `auth.variant`, `auth.<page>.*`.
- **Acceptance criteria:**
  - Given variant 3 selected, when visiting `/login`, `/register` and `/forgot-password`, then all three render the Minimal layout.
  - Given `?page=bogus`, then the Login tab is active.
  - Given a signed-in admin opens the preview route with `?fc_edit=1`, then the page renders (no redirect) with the editing hint bar; without `fc_edit`, no bridge script is included.
  - Given variant posted as 9, then validation fails and nothing changes.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (authPageDefaults, settingAuthPages, settingAuthPagesPreview, settingAuthPagesVariant); resources/views/admin/settings/auth-pages.blade.php; resources/views/components/auth-shell.blade.php; resources/views/components/layouts/guest.blade.php; resources/views/auth/login.blade.php; resources/views/auth/register.blade.php; resources/views/auth/forgot-password.blade.php; resources/views/auth/_register_showcase.blade.php; app/Support/fc_helpers.php (auth_cfg); app/Services/Frontend/FrontendContentStore.php (editing); Documentation/pages/admin-panel/auth-pages.html.
- **Port notes:** Store per-page auth content as a JSON document on the platform settings row; auth pages are Next.js routes rendering `<AuthShell variant>` from a public config endpoint. The live editor becomes an admin route that renders the real page with an edit-mode flag and postMessage bridge. Auth flows themselves stay in AUTH. Preview must bypass any "already signed in" redirect.

### WD-SET-019 — Auth pages editor: inline text editing bridge

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-SET-018
- **Summary:** Inside the editable frame, clicking any marked text edits it in place and saves instantly per field. The same endpoint saves the accent colour and the showcase texts (stat pills, feature cards, "what's also inside" chips).
- **Actors & access:** Platform admin (bridge loaded only in admin edit mode).
- **UX & screens:** Hovering an editable element shows a dashed green outline; click turns it into a plain-text editable (contenteditable plaintext-only, all text selected). Enter saves, Shift+Enter is ignored, Esc cancels, blur saves. A brief green flash confirms. Clearing the text and pressing Enter restores the shipped default (nothing is sent). Links are neutralised (clicks do not navigate) and form submits are blocked. A floating hint "Editing mode - click any text to change it..." fades after 5 seconds.
- **Endpoints:**

| Endpoint                              | Route name                       | Action                                      | Middleware  | Request                                                                           | Response                                                   |
| ------------------------------------- | -------------------------------- | ------------------------------------------- | ----------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| POST admin/settings/auth-pages/inline | admin.settings.auth-pages.inline | AdminPagesController@settingAuthPagesInline | admin stack | JSON `key` (required, max 60, form `<page>.<field>`), `value` (nullable, max 600) | JSON `{ok:true}` or 422 `{ok:false,error:"Unknown field"}` |

- **Data:** writes `auth.<page>.<field>` as string with description "Auth page (<page>) <field>".
- **Rules & edge cases:**
  1. Allowed pages: login, register, forgot. Allowed fields: eyebrow, heading, heading_accent, subheading, accent, hero_title, hero_desc, footer, plus (regex) `stat1..3_num`, `stat1..3_label`, `feat1..4_title`, `feat1..4_desc`, `inside_heading`, `chip1..6`. Anything else returns 422.
  2. The accent colour is saved through this same endpoint with key `<page>.accent`; the server does NOT validate that the value is a hex colour (only max 600 chars). It is rendered in an inline `style` attribute (escaped).
  3. An empty string can be stored (reverts to default on read), but the bridge never sends it: an empty edit is discarded client-side so a field cannot be intentionally blanked.
  4. Plain text only (no HTML), values are output-escaped by Blade.
- **Async & events:** none. No audit.
- **External systems:** none.
- **Settings:** `auth.<page>.*`.
- **Acceptance criteria:**
  - Given editing the Login heading to "Welcome back" and pressing Enter, then `auth.login.heading` is saved and the next visit to `/login` shows it.
  - Given Esc while editing, then the original text is restored and no request is sent.
  - Given a posted key `login.nonsense`, then 422 "Unknown field".
  - Given the accent picker changed on the Register tab, then `auth.register.accent` updates and the frame reloads with the new colour.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (settingAuthPagesInline); public/js/auth-editor-bridge.js; resources/views/admin/settings/auth-pages.blade.php; resources/views/auth/_register_showcase.blade.php.
- **Port notes:** Field whitelist becomes a zod enum keyed by page; add server-side hex validation for accent; allow "reset field" as an explicit action. Rate-limit and audit edits.

### WD-SET-020 — Auth pages editor: side media upload and removal

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-SET-018
- **Summary:** Hovering the large side panel in the editor lets the admin set an image, GIF or looping video for a page, or remove it to fall back to the built-in showcase.
- **Actors & access:** Platform admin.
- **UX & screens:** Hover toolbar on `[data-ae-media]` with "Set image / video / GIF" and red "Remove". Upload shows "Uploading..." then reloads the frame; on failure the hint reads "Upload failed - check the file type / size (max 20 MB)."
- **Endpoints:**

| Endpoint                                          | Route name                                   | Action                                                | Middleware  | Request                                                                                            | Response             |
| ------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------- | -------------------- |
| POST admin/settings/auth-pages/inline-media       | admin.settings.auth-pages.inline-media       | AdminPagesController@settingAuthPagesInlineMedia      | admin stack | multipart `page` (login/register/forgot), `media` file jpg,jpeg,png,gif,webp,mp4,webm max 20480 KB | JSON `{ok,url,type}` |
| POST admin/settings/auth-pages/inline-media-clear | admin.settings.auth-pages.inline-media-clear | AdminPagesController@settingAuthPagesInlineMediaClear | admin stack | JSON `page`                                                                                        | JSON `{ok:true}`     |

- **Data:** `auth.<page>.media_url` (relative path `uploads/auth/<page>_<unix-time>.<ext>`) and `auth.<page>.media_type` (`image` | `gif` | `video`; video for mp4/webm, gif for gif, else image). File is moved into `public/uploads/auth/` (web root), not the storage disk.
- **Rules & edge cases:**
  1. The file extension is the lower-cased client-supplied extension; type derives from it.
  2. Removing only blanks the two keys; the file stays on disk.
  3. Files bypass cloud storage on purpose (branding stays local).
  4. Rendering: videos autoplay, muted, loop, playsinline, covering the panel; images cover. Which panels show media depends on the template (Cinematic uses it as the full background).
  5. Naming collision: two uploads in the same second for the same page overwrite each other.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `auth.<page>.media_*`.
- **Acceptance criteria:**
  - Given an MP4 under 20 MB uploaded for Login, then `media_type` is `video` and `/login` autoplays it in the side panel.
  - Given a 25 MB file, then validation fails and the hint shows the failure message.
  - Given "Remove", then both keys are blank and the built-in showcase returns.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (settingAuthPagesInlineMedia, settingAuthPagesInlineMediaClear); public/js/auth-editor-bridge.js; resources/views/components/auth-shell.blade.php.
- **Port notes:** Upload to the media service (public bucket) with size/type validation and content sniffing; store an asset id + type; delete or version replaced assets; use unique keys.

### WD-SET-021 — Auth pages classic form save endpoint

- **Status:** dead-code
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-SET-018
- **Summary:** A full-form POST endpoint that saves variant, text fields, accent and media for one page at once. The current editor never posts to it (it uses the inline endpoints).
- **Actors & access:** Platform admin.
- **UX & screens:** None (no form in `auth-pages.blade.php` posts here).
- **Endpoints:**

| Endpoint                       | Route name                       | Action                                      | Middleware  | Request                                                                                                                                                                                                             | Response                                                    |
| ------------------------------ | -------------------------------- | ------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| POST admin/settings/auth-pages | admin.settings.auth-pages.update | AdminPagesController@settingAuthPagesUpdate | admin stack | `page` (login/register/forgot else 422), `variant` int 1-5, `eyebrow` max 120, `heading` max 120, `heading_accent` max 120, `subheading` max 400, `accent` max 9, `media` file (as WD-SET-020), `remove_media` bool | redirect to editor (`?page=`) with flash "Auth page saved." |

- **Data:** same keys as WD-SET-018/019/020.
- **Rules & edge cases:** Blank text fields are written as empty (revert to defaults). Media replace or `remove_media`. Legacy path kept from an earlier form-based editor.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** same.
- **Acceptance criteria:**
  - Given a POST with page=login and heading "Hi", then `auth.login.heading` = "Hi".
  - Given `page=other`, then HTTP 422.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (settingAuthPagesUpdate); routes/admin.php.
- **Port notes:** Do not port; the inline API (WD-SET-019/020) replaces it. Keep as a single `PATCH /platform/auth-pages/:page` if a bulk API is wanted.

### WD-SET-022 — Site info: shared contact and social identity

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-SET-001
- **Summary:** One form holds the public site's company identity (name, tagline, founded year, address), five contact emails, phone and WhatsApp number, and six social links. They repeat across the footer, contact and about pages and invoices; one edit updates all of them.
- **Actors & access:** Platform admin.
- **UX & screens:** `resources/views/admin/site-settings/index.blade.php`. Title "Site info". Groups: Company (company_name, tagline, founded_year, address, city_country), Contact emails (email_general, email_support, email_sales, email_security, email_careers), Phone and WhatsApp (phone display, whatsapp digits only), Social links (social_x, social_linkedin, social_instagram, social_youtube, social_facebook, social_github). Buttons: "Contact inbox" (with unread count badge from `contact_messages.is_read = false`), "All settings", Save. Inline validation error under each field; flash "Site settings saved.". Page text and colours are edited in the Frontend editor (CMS), not here.
- **Endpoints:**

| Endpoint                 | Route name                 | Action                              | Middleware  | Request         | Response              |
| ------------------------ | -------------------------- | ----------------------------------- | ----------- | --------------- | --------------------- |
| GET admin/site-settings  | admin.site-settings.index  | Admin\SiteSettingsController@index  | admin stack | -               | HTML                  |
| POST admin/site-settings | admin.site-settings.update | Admin\SiteSettingsController@update | admin stack | 22 fields below | redirect back + flash |

- **Data:** keys `site.<field>` stored as type string. Validation: email fields `nullable|email|max:190`; url fields `nullable|url|max:255`; all others `nullable|string|max:255`.
- **Rules & edge cases:**
  1. Every field is written on every save (null becomes `''`); `site_info(key, default)` treats null and `''` as unset and returns the caller's default.
  2. The 4th column of the field map (a suggested default such as "Your Company Inc.") is only a form descriptor; it is NOT applied as a stored default. Consumers pass their own defaults: contact page phone default `+91 80123 45678`, whatsapp default `918012345678` (hard-coded demo numbers, QUIRK for white-label).
  3. Consumers: public footer (social icons, empty hides the icon), contact page (WhatsApp deep link `wa.me/<digits>`, phone, office card with company, address, city, email general -> support fallback, phone), contact form recipient (`site.email_support` else mail from address), invoice seller identity fallbacks (`company_name`, `address`, `company_tax_id`, `phone`, `email_support`), `brand_email()` (WD-SET-011), mobile app promo card (`site.tagline`).
  4. Extra keys read by code but with no form field: `site.domain`, `site.company_tax_id`, `site.contact_email`.
  5. Audit `admin.site_settings.updated` with field names.
  6. The footer page (WD-SET-023) writes four of the same social keys.
- **Async & events:** audit row.
- **External systems:** none.
- **Settings:** the 22 `site.*` keys listed.
- **Acceptance criteria:**
  - Given `email_support=help@acme.com`, then contact form submissions are mailed to it.
  - Given an invalid URL in social_x, then validation fails with a URL error and nothing is saved.
  - Given `social_youtube` blank, then the footer shows no YouTube icon.
  - Given a save, then an audit row lists the field names.
- **Source refs:** app/Http/Controllers/Admin/SiteSettingsController.php; resources/views/admin/site-settings/index.blade.php; app/Support/fc_helpers.php (site_info, brand_email); resources/views/components/frontend/footer.blade.php; resources/views/frontend/contact.blade.php; app/Http/Controllers/ContactController.php; app/Services/Invoice/InvoiceService.php; app/Http/Controllers/Api/App/ContentController.php.
- **Port notes:** A `site_identity` JSON on the platform settings row exposed via a public read endpoint (`/public/site`). The contact inbox (unread count) belongs to CMS.

### WD-SET-023 — Public footer settings

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-SET-022
- **Summary:** Admin sets the footer wordmark title, the copyright line, a short description and four social URLs shown on the public marketing footer.
- **Actors & access:** Platform admin.
- **UX & screens:** `resources/views/admin/settings/footer.blade.php`: "Footer content" (Footer title placeholder = brand name, Copyright text placeholder "(c) <year> <brand>. All rights reserved.", Footer description textarea 4 rows max 500) and "Social links" (Facebook, LinkedIn, Instagram, Twitter/X; empty hides the icon). Guide notes the social URLs are shared with Site info. Flash "Footer settings saved.".
- **Endpoints:**

| Endpoint                   | Route name                   | Action                                   | Middleware  | Request                                                                                                                      | Response         |
| -------------------------- | ---------------------------- | ---------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| GET admin/settings/footer  | admin.settings.footer        | AdminPagesController@settingFooter       | admin stack | -                                                                                                                            | HTML             |
| POST admin/settings/footer | admin.settings.footer.update | AdminPagesController@settingFooterUpdate | admin stack | footer_title max 120, footer_copyright max 300, footer_description max 500, social_facebook/linkedin/instagram/x url max 300 | redirect + flash |

- **Data:** `footer_title`, `footer_copyright`, `footer_description` (strings) and `site.social_facebook|linkedin|instagram|x` (shared with WD-SET-022).
- **Rules & edge cases:**
  1. Blank copyright shows "(c) <current year> <brand name>"; blank description falls back to the frontend-editor value `footer.tagline` then a built-in tagline. The description feeds `fc('footer.tagline', ...)` only as a fallback, so an editor-set tagline wins.
  2. YouTube/GitHub icons are not editable here (only in Site info).
  3. Saving this page overwrites the four social keys with whatever it posts (including blank), which can clear values set on Site info. QUIRK: two forms, one storage.
  4. Audit `settings.footer_update`.
  5. `footer_title` is rendered as the wordmark ONLY when no brand logo is uploaded (with a logo, the image replaces it); falls back to the brand name when blank.
- **Async & events:** audit row.
- **External systems:** none.
- **Settings:** above.
- **Acceptance criteria:**
  - Given copyright text saved, then the public footer shows it verbatim; given blank, then it shows the auto line with the current year.
  - Given a save with blank Facebook URL, then `site.social_facebook` becomes empty and the Facebook icon disappears.
  - Given an invalid URL, then validation fails.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (settingFooter, settingFooterUpdate); resources/views/admin/settings/footer.blade.php; resources/views/components/frontend/footer.blade.php.
- **Port notes:** Merge with Site info into one "public site identity" form in the new admin to remove the two-writers problem; keep footer text in the CMS module if the marketing site is ported there.

### WD-SET-024 — Mail settings and runtime application to the mailer

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-SET-001
- **Summary:** Admin configures outbound email (mailer, host, port, encryption, credentials, sender name and address). Values saved in the database override `.env` on every request, so all system emails (welcome, verification, reset, invoices, support replies, security alerts, invites) use them without a restart.
- **Actors & access:** Platform admin.
- **UX & screens:** `resources/views/admin/settings/mail.blade.php`. Card "SMTP credentials": Sender name * (max 120), From address * (email, max 200, hint about SPF/DKIM), Mailer * (smtp, sendmail, "log (dev)", mailgun, "ses (Amazon)", postmark, resend), Encryption (tls port 587, ssl port 465, starttls, none), Host * (max 200), Port * (1-65535, default 587), Username (max 200), Password (max 500; placeholder "(saved - leave blank to keep)" when set). Aside lists provider host presets (Mailgun, SendGrid, SES, Postmark, Resend, Gmail with app password) and the mailables that use it. Flash messages under `success`/`error`; validation summary "Please fix the highlighted fields". The `required` markers are browser-side only.
- **Endpoints:**

| Endpoint                  | Route name                 | Action                                 | Middleware  | Request                                                                                                                                                                                                                                                          | Response                                |
| ------------------------- | -------------------------- | -------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| GET admin/settings/mail   | admin.settings.mail        | AdminPagesController@settingMail       | admin stack | -                                                                                                                                                                                                                                                                | HTML                                    |
| PATCH admin/settings/mail | admin.settings.mail.update | AdminPagesController@settingMailUpdate | admin stack | mail_mailer in smtp,sendmail,log,array,mailgun,ses,postmark,resend; mail_host max 200; mail_port int 1-65535; mail_username max 200; mail_password max 500; mail_encryption in tls,ssl,starttls,(empty); mail_from_name max 120; mail_from_address email max 200 | redirect + flash "Mail settings saved." |

- **Data:** keys `mail_mailer`, `mail_host`, `mail_port`, `mail_username`, `mail_password` (encrypted with `Crypt::encryptString` by the controller, not via the ENCRYPTED_KEYS list), `mail_encryption`, `mail_from_name`, `mail_from_address`; all string, description = key with underscores spaced.
- **Rules & edge cases:**
  1. Form values default from `config('mail.*')`/`.env` so a fresh install is not blank (mailer default `log` in `.env.example`; encryption default `tls`; from name default = app name).
  2. Blank password never overwrites the saved one; all other fields are saved even when blank.
  3. `MailConfig::apply()` runs in `AppServiceProvider::boot` (every request) and right after a save: only NON-EMPTY settings override config (`mail.default`, `mail.mailers.smtp.host|port|username|password|encryption`, `mail.from.address|name`), so blank rows leave `.env` values in place. The password is decrypted with `decryptString`; if that fails the raw stored text is used. It then forgets the cached mail manager and clears resolved Mail facade instances so the new config is used in the same request.
  4. QUIRK: the code sets `mail.mailers.smtp.encryption`, a key Laravel 12's SMTP transport does not read (it uses `scheme` and infers TLS from the port), so the Encryption dropdown is effectively cosmetic. Choosing `ssl` requires port 465 (implicit TLS) to work; verify against the port stack.
  5. QUIRK: selecting mailgun/ses/postmark/resend only changes the default mailer; the page has no fields for their API keys, which must come from `.env`/`config/services.php`.
  6. QUIRK: long-running queue workers boot once, so a settings change is not seen by queued mail until the worker restarts.
  7. Audit `settings.mail_update` (field names). Saving does not send a test; the hub marks "mail" as Needs test until a successful test exists (WD-SET-025).
  8. Boot-time failures are swallowed (logged with `error_log`).
- **Async & events:** none directly; mailables may be queued elsewhere.
- **External systems:** the configured SMTP/API provider.
- **Settings:** the eight keys; `.env` `MAIL_*` as fallback.
- **Acceptance criteria:**
  - Given valid SMTP settings saved, when a password-reset email is triggered, then it is sent through that host with the configured from name and address.
  - Given the password field blank on a later save, then the stored password is unchanged.
  - Given `mail_port` 70000, then validation fails.
  - Given settings never saved and `.env` configured, then the form shows the `.env` values and sending works.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (settingMail, settingMailUpdate); app/Support/MailConfig.php; app/Providers/AppServiceProvider.php; resources/views/admin/settings/mail.blade.php; config/mail.php; Documentation/pages/admin-panel/system-settings.html.
- **Port notes:** Mail sending is a provider adapter (`provider-adapter` skill) behind an `EmailSender` port; SMTP settings stored encrypted in the platform settings; dev uses Mailpit (already in docker-compose). Support SMTP first, then an API-key-based provider with proper fields. The worker must read settings per job (or refresh on change).

### WD-SET-025 — Mail test send

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-SET-024
- **Summary:** A "Send a test email" box sends one short message with the currently saved mail settings and reports success or the exact error, recording the result in the audit log (which also clears the hub's "needs test" flag).
- **Actors & access:** Platform admin.
- **UX & screens:** Card below the credentials form: Send to (email, prefilled with the admin's own email), "Send test" button.
- **Endpoints:**

| Endpoint                      | Route name               | Action                               | Middleware  | Request                     | Response                                                                                          |
| ----------------------------- | ------------------------ | ------------------------------------ | ----------- | --------------------------- | ------------------------------------------------------------------------------------------------- |
| POST admin/settings/mail/test | admin.settings.mail.test | AdminPagesController@settingMailTest | admin stack | `to` required email max 200 | redirect back with `success` "Test email sent to <to>." or `error` "Test email failed: <message>" |

- **Data:** audit `settings.mail_test` (meta: to, ok, error) with outcome success or failure.
- **Rules & edge cases:**
  1. Applies `MailConfig::apply()` first, then sends a plain-text mail synchronously (`Mail::raw`): subject "Mail settings test", body "This is a test email from <app name> to confirm your SMTP settings are working. Sent at <timestamp>."
  2. Uses SAVED settings only; unsaved edits in the form are ignored. Any exception is caught and shown verbatim (may leak host details to the admin, acceptable).
  3. Only a successful audit row clears "Needs test: mail" on the hub.
- **Async & events:** audit row.
- **External systems:** SMTP/mail provider.
- **Settings:** mail keys.
- **Acceptance criteria:**
  - Given valid settings, when sending a test to `me@x.com`, then the mail arrives and a success flash and audit row appear.
  - Given a wrong host, then the flash shows the transport error and a failure audit row is written.
  - Given an invalid `to`, then validation fails.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (settingMailTest); resources/views/admin/settings/mail.blade.php; resources/views/admin/settings/index.blade.php.
- **Port notes:** Implement as `POST /platform/settings/mail/test` returning `{ok, message}` JSON; run in-process (not queued) with a short timeout; record an audit event.

### WD-SET-026 — SEO settings form with live search and social preview

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-SET-001
- **Summary:** Admin sets the site-wide default meta tags: title, description, keywords, robots, canonical, author, OpenGraph card, Twitter card and search-engine verification codes, with character counters and a live Google-result and social-card preview.
- **Actors & access:** Platform admin.
- **UX & screens:** `resources/views/admin/settings/seo.blade.php` (page key `admin-settings-seo`). Sections: Meta tags (Meta title with counter target 50-60, Meta description textarea counter target 140-160, Meta keywords, Robots select, Author, Canonical URL), OpenGraph (OG image URL with 1200x630 hint, OG title, OG type, OG description, OG canonical URL), Twitter cards (card type, site handle, creator handle), Site verification (Google Search Console, Bing Webmaster), a live preview card (Google result with title/URL/description, social share card with image, host, title, description). Counters turn amber when out of range. Aside: SEO basics, validation links (opengraph.xyz, Google Rich Results, Twitter card validator), "Where this shows", and Sitemap and robots links (Download sitemap.xml, view /sitemap.xml, view /robots.txt). Buttons "Reset draft" (form reset) and Save. Flash `success` "SEO settings saved.".
- **Endpoints:**

| Endpoint                 | Route name                | Action                                | Middleware  | Request      | Response         |
| ------------------------ | ------------------------- | ------------------------------------- | ----------- | ------------ | ---------------- |
| GET admin/settings/seo   | admin.settings.seo        | AdminPagesController@settingSeo       | admin stack | -            | HTML             |
| PATCH admin/settings/seo | admin.settings.seo.update | AdminPagesController@settingSeoUpdate | admin stack | fields below | redirect + flash |

- **Data:** keys `seo_<field>` (strings): `meta_title` max 160, `meta_description` max 320, `meta_keywords` max 500, `robots` max 120 (UI options: `index, follow` default, `index, nofollow`, `noindex, follow`, `noindex, nofollow`), `canonical` url max 300, `author` max 120, `og_title` max 160, `og_description` max 320, `og_image` url max 500, `og_type` in website,article,product,profile, `og_url` url max 300, `twitter_card` in summary,summary_large_image,app,player (default summary_large_image), `twitter_site` max 60, `twitter_creator` max 60, `google_verification` max 200, `bing_verification` max 200. Blank values are stored as `''`.
- **Rules & edge cases:**
  1. The preview is client-only (mirrors inputs via `data-seo-input`/`data-seo-preview`). Counter turns amber when length is outside the target range and > 0.
  2. Audit `settings.seo_update`.
  3. `og_image` accepts any URL (no upload); recommendation 1200x630.
  4. The Robots directive applies to the layouts' `<meta name=robots>` only; it does not affect `robots.txt` (WD-SET-028).
- **Async & events:** audit row.
- **External systems:** none.
- **Settings:** the 16 `seo_*` keys.
- **Acceptance criteria:**
  - Given a meta description of 200 characters, then the counter is amber and the value saves (max 320).
  - Given `og_type` "video", then validation fails.
  - Given a non-URL `og_image`, then validation fails.
  - Given save, then an audit row `settings.seo_update` exists.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (settingSeo, settingSeoUpdate); app/Support/Seo.php; resources/views/admin/settings/seo.blade.php; resources/js/charts/admin-settings-seo.js; Documentation/pages/admin-panel/system-settings.html.
- **Port notes:** Model as `seo_defaults` JSON on platform settings with a zod schema; preview component in React. Consider per-page overrides in the CMS module.

### WD-SET-027 — SEO meta tag emission across layouts

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-SET-026
- **Summary:** Every layout (admin, user, guest/auth, public site) includes one partial that prints description, keywords, author, robots, canonical, OpenGraph, Twitter card and site-verification tags from the saved defaults, with per-page overrides.
- **Actors & access:** Public visitors, signed-in users, crawlers, link-preview bots.
- **UX & screens:** `resources/views/partials/seo-meta.blade.php` included by `layouts/admin`, `layouts/user`, `layouts/guest` (title override "<page> - <brand>") and `layouts/frontend` (overrides: title, description, keywords, og_image, og_type, canonical, robots = `noindex, nofollow` when the page is flagged noindex). Blog posts add JSON-LD in the frontend layout (CMS).
- **Endpoints:** none (HTML head).
- **Data:** reads `seo_*` keys, `app_name`.
- **Rules & edge cases:**
  1. `Seo::meta($overrides)` resolves each field as: per-page override, else saved `seo_*`, else a computed default (title <- brand; description/keywords <- empty; robots <- `index, follow`; og_title <- title; og_description <- description; og_type <- `website`; og_url and canonical <- current request URL; twitter_card <- `summary_large_image`; author <- brand).
  2. Tags are emitted only when non-empty, except `og:site_name`, `og:title`, `og:type`, `twitter:card` and `twitter:title`, which are always printed. `og:image` also prints width 1200 and height 630. `twitter:site`/`twitter:creator` get an `@` prefixed if missing. Verification: `google-site-verification` and `msvalidate.01`.
  3. QUIRK (null-coalescing chain): fallbacks use `??`, which only triggers on null, but saving the SEO form stores blanks as `''`. After the first save a blank OG title/description/canonical/og_url no longer falls back to the meta title/description/current URL: OG title is emitted empty, and no canonical link is printed. Only a never-saved install gets the fallbacks. The port should treat blank as unset.
  4. The document `<title>` is printed by each layout from its own `$title`, not by this partial; because every layout passes a title override, the saved "Meta title" is effectively only a fallback. QUIRK: the setting rarely surfaces.
  5. The `seo_robots` value is a global default; there is no per-environment automatic noindex.
- **Async & events:** none.
- **External systems:** crawlers/link previewers.
- **Settings:** `seo_*`.
- **Acceptance criteria:**
  - Given `og_image` set, then pages include `og:image`, width 1200, height 630 and `twitter:image`.
  - Given `twitter_site=brand`, then `twitter:site` is `@brand`.
  - Given robots `noindex, nofollow`, then every layout prints that meta tag except a page that overrides it.
  - Given a blog post flagged noindex, then its page prints `noindex, nofollow` regardless of the default.
- **Source refs:** app/Support/Seo.php; resources/views/partials/seo-meta.blade.php; resources/views/components/layouts/frontend.blade.php; resources/views/components/layouts/user.blade.php; resources/views/components/layouts/guest.blade.php; resources/views/components/layouts/admin.blade.php.
- **Port notes:** Next.js `generateMetadata` reading the public SEO config (cached, revalidated on change); treat empty as absent; admin pages should be `noindex`.

### WD-SET-028 — Sitemap, robots.txt and sitemap download

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-SET-026
- **Summary:** The site serves a dynamic `sitemap.xml` (marketing pages, blog categories, published blog posts) and a `robots.txt` that allows crawling except admin and API and points at the sitemap; admins can download the sitemap from the SEO page.
- **Actors & access:** `sitemap.xml` and `robots.txt` are public (no auth, cacheable, not wrapped in the no-store middleware); the download route is admin-only.
- **UX & screens:** Links in the SEO page aside. Download returns a file named `sitemap.xml`.
- **Endpoints:**

| Endpoint                                | Route name                          | Action                     | Middleware   | Response          |
| --------------------------------------- | ----------------------------------- | -------------------------- | ------------ | ----------------- |
| GET sitemap.xml                         | sitemap                             | SitemapController@index    | web (public) | `application/xml` |
| GET robots.txt                          | robots                              | SitemapController@robots   | web (public) | `text/plain`      |
| GET admin/settings/seo/sitemap/download | admin.settings.seo.sitemap.download | SitemapController@download | admin stack  | XML attachment    |

- **Data:** reads `blog_categories` (all) and `blog_posts` (published scope, `noindex = false`).
- **Rules & edge cases:**
  1. Static entries (loc, priority, changefreq): `/` 1.0 daily, `/features` 0.8 weekly, `/pricing` 0.8 weekly, `/about` 0.5 monthly, `/contact` 0.5 monthly, `/blog` 0.9 daily.
  2. Each blog category becomes `/blog?category=<slug>` priority 0.6 weekly.
  3. Published, non-noindex posts, newest published first, chunked by 200: `/blog/<slug>`, `lastmod` = updated_at (else published_at) in ISO-8601, priority 0.8 if featured else 0.7, weekly. Legal pages and storefront pages are not included.
  4. `robots.txt` body: `User-agent: *`, `Allow: /`, `Disallow: /admin`, `Disallow: /api`, `Sitemap: <url>/sitemap.xml`. It ignores the `seo_robots` setting: with a global "noindex" default, `robots.txt` still allows crawling. QUIRK.
  5. Locations are built with `url()` so a sub-folder deploy works. XML values are escaped.
  6. The docblock says the download lives in the blog admin; the actual route is under settings/seo.
  7. Maintenance mode returns 503 for `sitemap.xml` (only `robots.txt` is exempt).
- **Async & events:** none.
- **External systems:** search engines.
- **Settings:** none (blog content).
- **Acceptance criteria:**
  - Given 3 published posts (1 noindex), then the sitemap lists 2 post URLs plus 6 static and any category URLs.
  - Given a request to `/robots.txt`, then it returns the 5 lines above with the correct absolute sitemap URL.
  - Given the admin download route, then `Content-Disposition: attachment; filename="sitemap.xml"`.
- **Source refs:** app/Http/Controllers/SitemapController.php; routes/web.php; routes/admin.php; resources/views/admin/settings/seo.blade.php.
- **Port notes:** Next.js `app/sitemap.ts` and `app/robots.ts` fed by the CMS module; honour a global noindex in robots. Sitemap download is an admin convenience only.

### WD-SET-029 — Privacy and cookie-banner settings

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-SET-001
- **Summary:** Admin configures the cookie consent banner (on/off, style, message, Do-Not-Track behaviour) and the URLs of the privacy, terms and cookies policies; the same page also holds GDPR/CCPA/ADA switches (WD-SET-031).
- **Actors & access:** Platform admin.
- **UX & screens:** `resources/views/admin/settings/privacy.blade.php`. Card "Banner and policy": Banner enabled toggle, Banner style (Bottom sticky bar - recommended, Top sticky bar, Centered modal), Respect Do-Not-Track toggle ("Browser sends DNT=1 -> reject all"), Consent message textarea (max 1000), Privacy policy URL, Terms of service URL, Cookies policy URL (Learn more). Card "GDPR and CCPA" and card "ADA / WCAG" (WD-SET-031). Aside explains order of operations and links to Analytics. Buttons Reset draft, Save. Flash "Privacy, GDPR & ADA settings saved.".
- **Endpoints:**

| Endpoint                     | Route name                    | Action                                    | Middleware  | Request   | Response         |
| ---------------------------- | ----------------------------- | ----------------------------------------- | ----------- | --------- | ---------------- |
| GET admin/settings/privacy   | admin.settings.privacy        | AdminPagesController@settingPrivacy       | admin stack | -         | HTML             |
| PATCH admin/settings/privacy | admin.settings.privacy.update | AdminPagesController@settingPrivacyUpdate | admin stack | see below | redirect + flash |

- **Data:** `privacy_cookie_banner_enabled` (bool default true), `privacy_cookie_banner_style` (`bottom-bar` default | `top-bar` | `modal`), `privacy_cookie_message` (max 1000; default long text "We use cookies to enhance your browsing experience, serve personalized ads or content, and analyze our traffic. By clicking "Accept All", you consent to our use of cookies."), `privacy_policy_url`, `privacy_terms_url`, `privacy_cookies_policy_url` (each `url`, max 300, blank allowed), `privacy_dnt_respect` (bool default true), plus WD-SET-031 flags.
- **Rules & edge cases:**
  1. Booleans use the `persistSettingsGroup` helper: any bool key absent from the request is written `false` (so unchecked boxes persist as off); others are stored as strings; description = key with underscores spaced.
  2. Audit `settings.privacy_update`.
  3. The policy URLs feed `legal_url()` (WD-SET-030): a set URL wins over the built-in `/legal/*` pages everywhere Terms/Privacy/Cookies links appear (checkout, auth, footer).
  4. Docs say the Terms/Privacy links on auth pages are edited in the Frontend editor; in code they come from these settings.
- **Async & events:** audit row.
- **External systems:** none.
- **Settings:** above.
- **Acceptance criteria:**
  - Given banner style `modal`, then first-time visitors see the centred preferences modal instead of a bar.
  - Given `privacy_terms_url` set, then the register page Terms link points to it.
  - Given an unchecked DNT toggle, then `privacy_dnt_respect` is stored false.
  - Given an invalid policy URL, then validation fails.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (settingPrivacy*, persistSettingsGroup); resources/views/admin/settings/privacy.blade.php; app/Support/fc_helpers.php (legal_url).
- **Port notes:** Public config payload consumed by the Next.js layout; policy URLs also used by the legal pages CMS.

### WD-SET-030 — Cookie consent banner runtime and legal link resolution

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-SET-029
- **Summary:** Visitors see a compact banner (or modal) offering Decline, Customize and Accept All; the choice is stored in a first-party cookie for a year and decides which trackers the server emits on the next page load. Do-Not-Track can auto-reject.
- **Actors & access:** Public visitors and signed-in users on the user, guest and public layouts (not the admin layout).
- **UX & screens:** `partials/cookie-consent.blade.php` + `resources/js/cookie-consent.js`. Banner (`#wa-cookie-bar`, fixed, top or bottom centred): "We use cookies" + message + "Learn more" link (Cookie Policy label when a cookies URL exists, else Privacy Policy, hidden if neither) and buttons Decline, Customize, Accept All. Preferences modal (`#wa-cookie-consent`): Strictly Necessary (locked on), Analytics Cookies toggle, Marketing Cookies toggle; buttons Reject All, Save Preferences, Accept All. Any `[data-cookie-prefs-open]` element (footer/account links) reopens it pre-filled from the cookie.
- **Endpoints:** none (client script and a cookie).
- **Data:** cookie `wadesk_cookie_consent` = URL-encoded JSON `{necessary:true, analytics:bool, marketing:bool, ts:<unix>}`, path `/`, max-age 31536000, SameSite Lax, `Secure` on https; the cookie is excluded from Laravel cookie encryption so the server can read it. Reads `privacy_cookie_banner_enabled`, `privacy_cookie_banner_style`, `privacy_cookie_message` (partial default shorter: "We use cookies to improve your experience and analyze site traffic. By continuing, you agree to our Privacy Policy."), policy URLs, `privacy_dnt_respect`.
- **Rules & edge cases:**
  1. Nothing renders when the banner is disabled (and trackers then get full consent, WD-SET-033).
  2. First visit with no cookie: if DNT is respected and the browser sends DNT=1, an implicit reject is stored with no UI and no reload; else style `modal` opens the modal, `bottom-bar`/`top-bar` show the bar. Later visits show nothing until a reopen link is used.
  3. Accept All stores analytics+marketing true; Decline/Reject stores both false; Save stores the toggles. Every choice hides the UI and reloads the page after 180 ms so the server re-renders the tracker scripts.
  4. Exposes `window.wadeskCookieConsent.get() / has(category) / open()`.
  5. `legal_url(which)` maps `terms`, `privacy`, `cookies` to the three policy settings and falls back to `/legal/<which>`; used by the footer, auth pages and checkout; trims whitespace.
  6. QUIRK: two different default messages (form default vs partial default).
- **Async & events:** page reload after consent.
- **External systems:** none.
- **Settings:** the `privacy_*` keys.
- **Acceptance criteria:**
  - Given no cookie and default settings, when visiting the home page, then the bottom bar appears.
  - Given Accept All, then the cookie stores analytics and marketing true and the page reloads with trackers present.
  - Given DNT=1 and `privacy_dnt_respect` on, then no banner is shown and the cookie stores both false.
  - Given a reopen click, then the modal shows toggles reflecting the stored cookie.
  - Given banner disabled, then no banner or modal markup is rendered.
- **Source refs:** resources/views/partials/cookie-consent.blade.php; resources/js/cookie-consent.js; app/Support/fc_helpers.php (legal_url); bootstrap/app.php (encryptCookies except); resources/views/components/layouts/user.blade.php; resources/views/components/layouts/guest.blade.php; resources/views/components/layouts/frontend.blade.php.
- **Port notes:** Client component in the Next.js root layout; the server reads the consent cookie in RSC/middleware to gate trackers (avoid full reload by rendering scripts client-side after consent).

### WD-SET-031 — GDPR, CCPA and ADA compliance flags (stored only)

- **Status:** dead-code
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-SET-029
- **Summary:** Seven switches on the Privacy page (GDPR compliance, CCPA "do not sell", ADA skip link, high-contrast mode, large-text mode, reduced motion) are stored but no layout, script or stylesheet reads them. Only "Respect Do-Not-Track" is functional (WD-SET-030).
- **Actors & access:** Platform admin toggles; no runtime effect.
- **UX & screens:** Cards "GDPR and CCPA" (GDPR compliance: "Opt-in consent before any analytics fires"; CCPA compliance: "Show Do not sell my personal information option") and "ADA / WCAG" (Skip-to-content link, Offer high-contrast mode, Offer large-text mode, Respect prefers-reduced-motion).
- **Endpoints:** part of `PATCH admin/settings/privacy`.
- **Data:** `privacy_gdpr_compliance` (default true), `privacy_ccpa_compliance` (default true), `privacy_ada_skip_link` (default true), `privacy_ada_high_contrast` (default false), `privacy_ada_large_text` (default false), `privacy_ada_reduced_motion` (default false).
- **Rules & edge cases:** 1. A repo-wide search (PHP, Blade, JS, CSS) finds no reader besides the form and the controller. 2. The claim "Same setting ... gates every analytics integration" is only true for the banner toggle. 3. Port decision: implement (skip link, contrast/large-text toggles in the client, "do not sell" link) or drop.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** the six keys.
- **Acceptance criteria:**
  - Given a save with ADA skip link unchecked, then the stored value is false (only persistence is testable in WaDesk).
  - Given a port that implements the skip link, when enabled, then a visible-on-focus skip-to-content link is the first focusable element.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (settingPrivacy*); resources/views/admin/settings/privacy.blade.php.
- **Port notes:** Recommend implementing the ADA options in the design system (skip link, prefers-reduced-motion CSS) and a footer "Do not sell my info" link tied to consent; otherwise omit.

### WD-SET-032 — Analytics tracker ID settings

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-SET-001
- **Summary:** Admin pastes IDs for up to 12 analytics and advertising trackers once; the site emits the vendors' official snippets after consent.
- **Actors & access:** Platform admin.
- **UX & screens:** `resources/views/admin/settings/analytics.blade.php`. Card "Site analytics" (Analytics cookies bucket): Google Analytics 4 measurement ID (e.g. G-XXXXXXXXXX), Google Tag Manager container ID (GTM-XXXXXXX), Microsoft Clarity project ID, Plausible domain, PostHog API key, PostHog host (default https://app.posthog.com), Hotjar site ID (numeric), Mixpanel project token. Card "Ad pixels" (Marketing cookies bucket): Meta Pixel ID, TikTok Pixel ID, LinkedIn Insight partner ID, X (Twitter) Pixel ID. Aside: tracker -> category map, layout coverage (user dashboard and public/guest yes; admin pages intentionally off). Buttons Reset draft, Save. Flash "Analytics integrations saved.".
- **Endpoints:**

| Endpoint                       | Route name                      | Action                                      | Middleware  | Request      | Response         |
| ------------------------------ | ------------------------------- | ------------------------------------------- | ----------- | ------------ | ---------------- |
| GET admin/settings/analytics   | admin.settings.analytics        | AdminPagesController@settingAnalytics       | admin stack | -            | HTML             |
| PATCH admin/settings/analytics | admin.settings.analytics.update | AdminPagesController@settingAnalyticsUpdate | admin stack | fields below | redirect + flash |

- **Data:** keys (strings, blank = tracker off): `analytics_google_ga4` max 50, `analytics_google_gtm` max 50, `analytics_meta_pixel` max 50, `analytics_microsoft_clarity` max 50, `analytics_plausible_domain` max 120, `analytics_posthog_key` max 120, `analytics_posthog_host` url max 200, `analytics_hotjar_site_id` max 30, `analytics_tiktok_pixel` max 50, `analytics_linkedin_partner` max 50, `analytics_twitter_pixel` max 50, `analytics_mixpanel_token` max 120.
- **Rules & edge cases:** 1. No format validation of IDs (any string up to the max). 2. Saved via `persistSettingsGroup` with no bool keys; audit `settings.analytics_update`. 3. The Hotjar ID is cast to int at render; other IDs are JSON-escaped or HTML-escaped by Blade.
- **Async & events:** audit row.
- **External systems:** vendor scripts (WD-SET-033).
- **Settings:** above.
- **Acceptance criteria:**
  - Given a GA4 ID `G-ABC123` saved, then the public pages include the gtag snippet with that ID.
  - Given an invalid PostHog host, then validation fails.
  - Given all fields blank, then no tracker script is emitted.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (settingAnalytics*, persistSettingsGroup); resources/views/admin/settings/analytics.blade.php.
- **Port notes:** Store as a `trackers` JSON with per-tracker regex validation to reduce injection risk.

### WD-SET-033 — Analytics tracker injection with consent gating

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-SET-032, WD-SET-030
- **Summary:** A head partial reads the visitor's consent cookie and the tracker IDs and emits only the allowed vendor snippets; Google tags always load but with Consent Mode flags.
- **Actors & access:** Public visitors and signed-in users on user, guest and public layouts (not admin).
- **UX & screens:** `partials/site-analytics.blade.php` in the `<head>` of `layouts/user`, `layouts/guest`, `layouts/frontend`.
- **Endpoints:** none.
- **Data:** cookie `wadesk_cookie_consent`; the 12 analytics keys; `privacy_cookie_banner_enabled`.
- **Rules & edge cases:**
  1. Consent defaults to `{necessary:true, analytics:false, marketing:false}`, merged with the decoded cookie JSON. If the banner is disabled, consent is forced to all true.
  2. Google Consent Mode v2: when GA4 or GTM is configured a `gtag('consent','default',...)` block is printed on every page: `ad_storage`, `ad_user_data`, `ad_personalization` = granted only if marketing consent, `analytics_storage` = GRANTED FOR EVERYONE (a client choice noted in the source), `wait_for_update` 500 ms. QUIRK: the admin UI and docs say analytics emits only after consent, but GA4/GTM analytics storage is on by default; the port must decide and document (GDPR).
  3. GA4: `gtag.js` with `config(id, {anonymize_ip:true})`. GTM: standard head snippet with `dataLayer`.
  4. Analytics-consent bucket (only if consent.analytics): Microsoft Clarity, Plausible (`data-domain`, plausible.io script), PostHog (`init(key, {api_host})`), Hotjar (id cast to int, hjsv 6), Mixpanel (`track_pageview:true`).
  5. Marketing-consent bucket (only if consent.marketing): Meta Pixel (init + PageView, plus noscript image), TikTok Pixel, LinkedIn Insight (partner id, noscript image), X Pixel.
  6. The GTM `<noscript>` iframe is referenced (`partials/site-analytics-noscript`) but that partial does not exist in the repo (dead reference).
  7. Because output depends on the cookie, pages must not be cached publicly; the consent buttons reload the page for the same reason.
  8. Third-party requests originate from the visitor's browser; nothing is proxied.
- **Async & events:** none.
- **External systems:** Google (googletagmanager.com), Microsoft Clarity, Plausible, PostHog, Hotjar, Mixpanel, Meta, TikTok, LinkedIn, X.
- **Settings:** analytics keys, privacy banner switch.
- **Acceptance criteria:**
  - Given consent analytics=true and a Clarity ID, then the Clarity snippet is present; given analytics=false, then absent.
  - Given a Meta Pixel ID and marketing=false, then no pixel script; with marketing=true the pixel and noscript image render.
  - Given a GA4 ID and no cookie, then the Google tag and consent defaults are present with ad_* denied.
  - Given the banner disabled, then all configured trackers render for everyone.
- **Source refs:** resources/views/partials/site-analytics.blade.php; resources/views/components/layouts/user.blade.php; resources/views/components/layouts/guest.blade.php; resources/views/components/layouts/frontend.blade.php; bootstrap/app.php.
- **Port notes:** Render trackers client-side after consent (`next/script`), keep Consent Mode defaults aligned with the banner, load nothing in admin. Decide policy for `analytics_storage` explicitly.

### WD-SET-034 — Custom CSS and JS injection on the public site

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-SET-001
- **Summary:** Admin stores a block of CSS and a block of JavaScript that is injected into the public marketing pages when a master switch is on.
- **Actors & access:** Platform admin edits; visitors of the public site receive it.
- **UX & screens:** `resources/views/admin/settings/custom.blade.php`: "Inject in production" toggle, Custom CSS textarea (14 rows), Custom JS textarea (14 rows), warning about production sensitivity, guide (scope CSS, do not block, test dark mode). Flash "Custom code saved.".
- **Endpoints:**

| Endpoint                   | Route name                   | Action                                   | Middleware  | Request                                                                   | Response         |
| -------------------------- | ---------------------------- | ---------------------------------------- | ----------- | ------------------------------------------------------------------------- | ---------------- |
| GET admin/settings/custom  | admin.settings.custom        | AdminPagesController@settingCustom       | admin stack | -                                                                         | HTML             |
| POST admin/settings/custom | admin.settings.custom.update | AdminPagesController@settingCustomUpdate | admin stack | `custom_css` max 50000, `custom_js` max 50000, `custom_code_enabled` bool | redirect + flash |

- **Data:** `custom_css` (string), `custom_js` (string), `custom_code_enabled` (bool default false).
- **Rules & edge cases:**
  1. Injection happens only in `layouts/frontend` (public marketing pages): CSS as `<style id="wd-custom-css">` in the head, JS as `<script id="wd-custom-js">` before `</body>`; both unescaped (raw), only when the switch is on and the field is non-empty. It is NOT injected on auth pages, the user app or the admin app despite the "public pages" wording being ambiguous.
  2. Raw injection is a deliberate admin-only capability (stored XSS vector if an admin account is compromised); no CSP nonce or sanitising.
  3. Audit `settings.custom_update` records only lengths.
- **Async & events:** audit row.
- **External systems:** none.
- **Settings:** the three keys.
- **Acceptance criteria:**
  - Given enabled with CSS `body{background:#000}`, then the public home page includes it in `<style id="wd-custom-css">`; the user dashboard does not.
  - Given the switch off, then neither block is emitted.
  - Given 60,000 characters of CSS, then validation fails.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (settingCustom*); resources/views/admin/settings/custom.blade.php; resources/views/components/layouts/frontend.blade.php.
- **Port notes:** Restrict to super-admin, apply a CSP nonce/hash strategy, consider dropping JS injection in favour of the analytics/tracker settings.

### WD-SET-035 — PWA settings (app-wide installable manifest config)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-SET-010
- **Summary:** Admin configures the installable-app identity for the whole product: on/off, names, description, start URL and scope, display mode, orientation, theme and background colours and 192/512 icons.
- **Actors & access:** Platform admin.
- **UX & screens:** `resources/views/admin/settings/pwa.blade.php` (multipart form). Card "PWA manifest": PWA enabled toggle; App name (max 60); Short name (max 12); Description (max 300); Start URL; Scope; Display mode (standalone, fullscreen, minimal-ui, browser); Orientation (any, portrait, landscape, natural); Theme colour and Background colour (colour picker plus read-only hex); App icon 192 upload (PNG/WebP, preview); Large icon 512 upload; toggles "Show install prompt" and "Offline cache (service worker)" (WD-SET-037); live manifest URL with "View JSON". Second card "Team Inbox PWA" (WD-SET-038). Aside links to Privacy and Analytics and icon-prep tips. Flash "PWA settings saved.".
- **Endpoints:**

| Endpoint                 | Route name                | Action                                | Middleware  | Request                | Response         |
| ------------------------ | ------------------------- | ------------------------------------- | ----------- | ---------------------- | ---------------- |
| GET admin/settings/pwa   | admin.settings.pwa        | AdminPagesController@settingPwa       | admin stack | -                      | HTML             |
| PATCH admin/settings/pwa | admin.settings.pwa.update | AdminPagesController@settingPwaUpdate | admin stack | multipart fields below | redirect + flash |

- **Data:** keys: `pwa_enabled` (bool false), `pwa_install_prompt` (bool true), `pwa_offline_enabled` (bool true), `pwa_app_name` (max 60; default = brand name), `pwa_short_name` (max 12; default = brand name), `pwa_description` (max 300), `pwa_start_url` (max 200, default `/`), `pwa_scope` (max 200, default `/`), `pwa_display` (standalone default | fullscreen | minimal-ui | browser), `pwa_orientation` (portrait default; validation also allows natural, portrait-primary, landscape-primary), `pwa_theme_color` (`^#[0-9A-Fa-f]{3,8}$`, default `#075E54`), `pwa_background_color` (same regex, default `#FBFAF6`), `pwa_icon_192`, `pwa_icon_512` (public URLs of uploaded files). Upload fields `pwa_icon_192_file` (image png/webp max 1024 KB) and `pwa_icon_512_file` (image png/webp max 2048 KB) are not stored as keys.
- **Rules & edge cases:**
  1. Icons are stored on the local `public` disk under `pwa/` and the setting holds the ABSOLUTE public URL at upload time (host baked in; breaks if the domain changes). If no new file is uploaded the previous value is untouched. No square/dimension check is done.
  2. `start_url` and `scope` are normalised with `pwaPath`: a full `http(s)://` URL is kept; a value like `host.tld/login` (first segment contains a dot) loses the host and becomes `/login`; anything else gets a leading `/`; blank becomes `/`. Reason: a bare `host/login` resolves relative to the manifest URL and opens the wrong page.
  3. Booleans use `persistSettingsGroup` with bool keys pwa_enabled, pwa_install_prompt, pwa_offline_enabled, ti_pwa_enabled (absent = false). Non-posted keys (for example `pwa_splash`) are never written.
  4. Audit `settings.pwa_update`.
  5. Docs mention "splash URLs" and colour hex validation; the splash field does not exist on the form (reader `pwa_splash` exists but is never saved).
- **Async & events:** audit row.
- **External systems:** none.
- **Settings:** above.
- **Acceptance criteria:**
  - Given start URL `example.com/login`, then `/login` is stored and the manifest emits `/login`.
  - Given a theme colour `#12`, then validation fails.
  - Given a 1.5 MB 192 icon, then validation fails (limit 1 MB); a 1.5 MB 512 icon is accepted.
  - Given save with no icon files, then existing icon URLs are unchanged.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (settingPwa, settingPwaUpdate, pwaPath, persistSettingsGroup); resources/views/admin/settings/pwa.blade.php; resources/js/charts/admin-settings-general.js (image preview pattern); Documentation/pages/admin-panel/system-settings.html.
- **Port notes:** Store icons as media assets and generate the manifest dynamically from asset URLs; enforce square PNG sizes (192, 512) and add a maskable variant. Serve the manifest from the Next.js app (`app/manifest.ts`).

### WD-SET-036 — PWA manifest endpoint and head meta tags

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-SET-035
- **Summary:** `/manifest.json` returns a web app manifest built live from the saved settings, and a head partial links it and sets theme-colour and iOS home-screen tags when the PWA is enabled.
- **Actors & access:** Public (browsers, installers).
- **UX & screens:** `partials/pwa-meta.blade.php` in the user, guest and admin layouts.
- **Endpoints:**

| Endpoint          | Route name   | Action                           | Middleware   | Response                    |
| ----------------- | ------------ | -------------------------------- | ------------ | --------------------------- |
| GET manifest.json | pwa.manifest | AdminPagesController@pwaManifest | web (public) | `application/manifest+json` |

- **Data:** reads the `pwa_*` keys.
- **Rules & edge cases:**
  1. Manifest fields: `name` (setting or brand), `short_name` (setting or brand), `description`, `start_url`, `scope` (both normalised), `display`, `orientation`, `theme_color`, `background_color`, `icons` (192 and 512 entries only if configured; each declared `image/png`, purpose `any maskable`, even when the file is WebP). No `id`, `lang` or screenshots.
  2. The endpoint responds regardless of `pwa_enabled`; only the `<link rel="manifest">` and meta tags are gated on the flag.
  3. Head tags when enabled: manifest link (absolute `url('/manifest.json')`), `theme-color`, `apple-mobile-web-app-capable=yes`, `apple-mobile-web-app-status-bar-style=black-translucent`, `apple-mobile-web-app-title` (short name), `apple-touch-icon` (192 icon else the favicon).
  4. On the Team Inbox page with the Team Inbox PWA enabled, the user layout emits the Team Inbox head partial instead (WD-SET-038), because a page can carry one effective manifest.
  5. There is no app-wide service worker file in the repo (the only one, `team-inbox-sw.js`, is Team Inbox push). Install eligibility therefore relies on the manifest alone.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `pwa_*`.
- **Acceptance criteria:**
  - Given PWA enabled and names set, when fetching `/manifest.json`, then the JSON reflects the settings and content-type is `application/manifest+json`.
  - Given PWA disabled, then pages have no manifest link but `/manifest.json` still returns 200.
  - Given only a 512 icon, then `icons` has just the 512 entry.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (pwaManifest, pwaPath); resources/views/partials/pwa-meta.blade.php; resources/views/components/layouts/user.blade.php.
- **Port notes:** Next.js `app/manifest.ts` reading the public settings; gate the tag on the flag and return 404 from the manifest when disabled (improvement). Include real icon MIME types.

### WD-SET-037 — PWA install prompt, offline cache and splash (stored, unused)

- **Status:** dead-code
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-SET-035
- **Summary:** The PWA form stores "Show install prompt" (default true), "Offline cache (service worker)" (default true) and a splash image reference, but no script, layout or service worker reads them. Docs describe them as working.
- **Actors & access:** Platform admin toggles; no runtime effect.
- **UX & screens:** Two toggles in the PWA card (with helper text "Display the modal asking visitors to add the app to their home screen" and "Cache assets for offline access").
- **Endpoints:** part of `PATCH admin/settings/pwa`.
- **Data:** `pwa_install_prompt`, `pwa_offline_enabled`, `pwa_splash` (read in the form, never written).
- **Rules & edge cases:** 1. Repo search: no `beforeinstallprompt` handler exists; no app-wide service worker exists; nothing reads these keys except the form. 2. Port decision: implement an install prompt (with the browser `beforeinstallprompt` event) and a real service worker (Workbox) or drop the toggles.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** the three keys.
- **Acceptance criteria:**
  - Given the install prompt toggle off then saved, then it persists false (only persistence is testable in WaDesk).
  - Given a port that implements the prompt, when off, then no install modal is shown.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (settingPwa*); resources/views/admin/settings/pwa.blade.php; Documentation/pages/admin-panel/system-settings.html.
- **Port notes:** Recommended P2: install prompt banner in Next.js; skip offline caching except static assets.

### WD-SET-038 — Team Inbox PWA configuration and push key generation

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-SET-035
- **Summary:** A separate installable app scoped to `/team-inbox` (own name, icons, manifest) so agents can install the shared inbox on their phone and receive Web Push notifications; the admin can generate the VAPID key pair with one click.
- **Actors & access:** Platform admin configures; agents install and subscribe (subscribe/unsubscribe/key endpoints are owned by TIB/NOTIF).
- **UX & screens:** Second card in `pwa.blade.php` ("Team Inbox app"): enable toggle ("Turns on the separate manifest, install prompt and notifications on /team-inbox"), App name (max 60, default "<brand> Inbox"), Short name (max 12, default "Inbox"), two icon uploads (192 and 512; "uses the app icon if empty"), a push-status card with three states: "Push notifications: ready" (keys generated), "one server step" (composer package `minishlink/web-push` missing, shows the install command) and "one step left" with a "Generate keys" button (AJAX, no reload, button disappears when ready), plus links to the team-inbox manifest and the inbox.
- **Endpoints:**

| Endpoint                              | Route name                       | Action                                      | Middleware   | Request                                                                                                                                                      | Response                                                               |
| ------------------------------------- | -------------------------------- | ------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| PATCH admin/settings/pwa              | admin.settings.pwa.update        | (WD-SET-035)                                | admin stack  | `ti_pwa_enabled`, `ti_pwa_name` max 60, `ti_pwa_short_name` max 12, `ti_pwa_icon_192_file` (png/webp <=1024 KB), `ti_pwa_icon_512_file` (png/webp <=2048 KB) | redirect                                                               |
| POST admin/settings/pwa/generate-keys | admin.settings.pwa.generate-keys | AdminPagesController@settingPwaGenerateKeys | admin stack  | -                                                                                                                                                            | JSON `{ok, ready, message}`; HTTP 422 when the push library is missing |
| GET team-inbox-manifest.json          | team-inbox.manifest              | TeamInboxPwaController@manifest             | web (public) | -                                                                                                                                                            | `application/manifest+json`                                            |

- **Data:** `ti_pwa_enabled` (bool false), `ti_pwa_name`, `ti_pwa_short_name`, `ti_pwa_icon_192`, `ti_pwa_icon_512` (URLs), read-only-in-code keys with no UI: `ti_pwa_theme_color`, `ti_pwa_background_color`, `ti_pwa_description`, `ti_vapid_subject`; keys generated: `ti_vapid_public`, `ti_vapid_private` (encrypted), plus table `push_subscriptions` (NOTIF).
- **Rules & edge cases:**
  1. Manifest: name (setting or "<brand> Inbox"), short_name cut to 12 (setting or "Inbox"), description (`ti_pwa_description` or "Your shared team inbox - chat with customers on the go."), `start_url` and `scope` = absolute `url('/team-inbox')`, display `standalone`, orientation `portrait`, theme/background from `ti_pwa_*` else the app-wide `pwa_*` colours. Icons: Team Inbox 192/512, else app-wide 192/512, else the favicon declared `sizes:any` with a type derived from its extension; none if nothing exists.
  2. Head partial `partials/teaminbox-pwa` renders only on the Team Inbox page when the flag is on: manifest link, theme colour, iOS tags, apple-touch-icon and a CSS rule hiding the main app header in standalone display mode so the installed app is inbox-only.
  3. Key generation is idempotent: if both keys already exist it returns the existing public key. Otherwise it tries the library's VAPID generator, then a fallback that builds a P-256 keypair with an explicit OpenSSL config (for hosts whose PHP has no OpenSSL config), and stores both keys (private key encrypted through the settings store). Returns `ok:false` with a message when generation fails, and 422 when the library is absent.
  4. `isConfigured()` = library present AND both keys stored. When `ti_pwa_enabled` is false the push notifier does nothing (`TeamInboxPushNotifier`, `NotificationDispatcher`).
  5. VAPID subject defaults to the app URL.
  6. The client registers `team-inbox-sw.js` with scope `/team-inbox` and shows an "Enable notifications" pill (TIB).
  7. QUIRK: `mailto`/subject and the theme/description fields have no admin UI.
- **Async & events:** none here; push delivery is NOTIF.
- **External systems:** Web Push services (FCM/Mozilla/Apple) via the `minishlink/web-push` library; browser Push API.
- **Settings:** above; composer package requirement.
- **Acceptance criteria:**
  - Given the flag on and icons empty, when fetching `/team-inbox-manifest.json`, then icons fall back to the app icons then the favicon and `start_url` is `/team-inbox`.
  - Given no keys, when clicking Generate keys, then the response is `{ok:true, ready:true}` and the private key row is ciphertext; clicking again returns the same public key.
  - Given the push library missing, then Generate keys returns 422 with an install hint.
  - Given the flag off, then the Team Inbox page carries the app-wide manifest instead.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (settingPwa, settingPwaUpdate, settingPwaGenerateKeys); app/Http/Controllers/TeamInboxPwaController.php; app/Services/Push/WebPushService.php; resources/views/partials/teaminbox-pwa.blade.php; resources/views/admin/settings/pwa.blade.php; resources/views/components/layouts/user.blade.php; public/team-inbox-sw.js.
- **Port notes:** Web Push in the new stack uses the `web-push` npm package (VAPID keys generated once and stored encrypted); the Team Inbox is a Next.js route group with its own manifest route. Subscriptions are tenant rows (RLS) owned by NOTIF/TIB; only the VAPID/enable settings live here.

### WD-SET-039 — Cloud storage settings and connection test

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-SET-001
- **Summary:** Admin chooses an S3-compatible provider (Amazon S3, Wasabi, Bunny.net, DigitalOcean Spaces, Cloudflare R2, MinIO), enters bucket credentials, and can save and test the connection by writing and deleting a probe object. Turning it on routes new client media uploads to the bucket.
- **Actors & access:** Platform admin; platform-wide, not per workspace.
- **UX & screens:** `resources/views/admin/storage/index.blade.php`. Status card: text "Active - <provider>. New uploads go to your bucket." / "Configured but turned off. Media still on the local disk. Test, then enable." / "Local disk (no cloud provider set up yet)", plus an Enabled/Disabled pill and the master toggle. Provider select, File visibility select (Private (signed URLs) | Public). Credentials card: Access key ID *, Secret access key * (placeholder "stored, leave blank to keep"), Region (placeholder us-east-1), Bucket *, Endpoint (required for Spaces/R2/MinIO; auto for Wasabi and Bunny), Public/CDN URL (optional), checkbox "Use path-style endpoint", Bunny-only Storage zone and Storage password (access key), Base folder path (optional prefix). Buttons: "Save & test connection" (posts to the test endpoint) and "Save changes". Guide per provider. Flash via `x-admin.flash` (success/error).
- **Endpoints:**

| Endpoint                | Route name          | Action                                | Middleware  | Request                                                                                                                                               | Response                                                                                   |
| ----------------------- | ------------------- | ------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| GET admin/storage       | admin.storage.index | Admin\StorageSettingsController@index | admin stack | -                                                                                                                                                     | HTML                                                                                       |
| POST admin/storage      | admin.storage.save  | Admin\StorageSettingsController@save  | admin stack | `enabled` bool, `provider` required in s3,wasabi,bunny,spaces,r2,minio, `visibility` in public,private, `base_path` string max 191, `cfg[...]` fields | redirect + "Storage settings saved."                                                       |
| POST admin/storage/test | admin.storage.test  | Admin\StorageSettingsController@test  | admin stack | same as save                                                                                                                                          | JSON `{ok,message}` (200/422) when JSON expected, else redirect with success/error message |

- **Data:** one key `cloud_storage` (type json). Shape: `{enabled:bool, provider, visibility:'public'|'private', base_path:'wadesk', providers:{<provider>:{key, secret(enc), region, bucket, endpoint, cdn_url|url, use_path_style_endpoint, storage_zone, access_key(enc)}}}`. Secret fields `secret` and `access_key` are encrypted with `Crypt::encryptString`; the form never receives them (blank + hidden marker `__has_secret`/`__has_access_key`).
- **Rules & edge cases:**
  1. `save()` merges into the existing provider block: posted non-null fields overwrite; for the two secret fields a blank keeps the stored ciphertext, a value is re-encrypted. Because blank inputs arrive as null (empty-string conversion) and null values are filtered out, ordinary fields cannot be cleared once set (for example removing an endpoint or CDN URL). QUIRK, verify.
  2. The blob keeps one config block per provider so switching the select does not discard other providers' credentials; `enabled`, `provider`, `visibility`, `base_path` are top-level. `visibility` defaults to `private`; `base_path` is trimmed of slashes.
  3. `cfg` is not validated (only `providers` array/`provider`/`visibility`/`base_path`); required-ness of key/secret/bucket is enforced only by "config complete" logic (below), not at save.
  4. "Save & test connection" ALWAYS saves the posted config first (including the enabled flag) and then tests; a failed test leaves the config saved. Test = build the disk from the saved config, write `connection-tests/<random12>.txt` (with the base prefix) containing a fixed sentence, delete it; success message "Connection successful - the bucket is reachable and writable."; failure "Connection failed: <message>" (also logged with provider, error, file:line). Incomplete config returns "Storage configuration is incomplete - fill in every required field first."
  5. Completeness: Bunny needs `storage_zone` and `access_key`; every other provider needs `key`, `secret`, `bucket`.
  6. No audit rows for storage changes.
  7. Enabling never migrates or deletes existing files ("safe by default").
- **Async & events:** none.
- **External systems:** the provider's S3 API via the Flysystem AWS S3 adapter (composer `league/flysystem-aws-s3-v3`); Bunny via its S3 endpoint (`storage.bunnycdn.com`, region `de` or `<region>.storage.bunnycdn.com`, access key id = storage zone, secret = zone password).
- **Settings:** the `cloud_storage` blob.
- **Acceptance criteria:**
  - Given valid S3 credentials and "Save & test connection", then a probe file is written and deleted and the success message shows.
  - Given a blank secret on a later save, then the stored secret is unchanged.
  - Given provider `dropbox`, then validation fails.
  - Given the test fails (wrong keys), then the failure message includes the driver error and the config remains saved but media routing follows the enabled flag.
  - Given enabled = false, then the status card says "Configured but turned off".
- **Source refs:** app/Http/Controllers/Admin/StorageSettingsController.php; app/Services/CloudStorageManager.php; resources/views/admin/storage/index.blade.php; Documentation/pages/admin-panel/cloud-storage.html.
- **Port notes:** MinIO is already in `docker-compose.yml`; implement a `StorageProvider` port with an S3-compatible adapter (`@aws-sdk/client-s3`, custom endpoint, path-style flag) and per-provider presets (Wasabi region -> endpoint, Bunny). Secrets encrypted; never returned by GET. Keep test = put + delete under a probe key. Tenant isolation: keys must be namespaced by org id in the object key, never rely on bucket-per-tenant.

### WD-SET-040 — Cloud media routing runtime (disk resolution, prefix, URLs)

- **Status:** implemented
- **Priority:** P1
- **Effort:** L
- **Depends on:** WD-SET-039
- **Summary:** All client media (chat and inbox media, template media, campaign/broadcast media, auto-reply files, flow media, store product images, team-chat attachments, payment proofs, avatars, blog images, invoices PDFs, channel-specific media for Viber/LINE) is written through helpers that pick the cloud disk when it is enabled and complete, else the local `public` disk, and URLs are built for whichever disk holds the file.
- **Actors & access:** Server-side code paths in many domains; customers see media URLs.
- **UX & screens:** none.
- **Endpoints:** none of its own (the framework serves local disk files at `storage/{path}`, see Open questions).
- **Data:** reads `cloud_storage`; file paths are stored on domain tables as bare object keys (for example `chat-media/<rand>__<name>`, `wa-templates/..`, `auto-reply/..`, `flows/<type>s/..`, `store-products/..`, `team-chat/<ws>/..`, `payment-proofs/..`, `viber-broadcasts/..`, `line-broadcasts/..`, `line-rich-menus/..`, `connection-tests/..`).
- **Rules & edge cases:**
  1. `CloudStorageManager::isEnabled()` = `enabled` true AND provider config complete. `diskName()` returns the dynamic disk name `client_media` only if registration produced a config, else `public`, so a half-configured provider never hard-fails uploads. The disk is registered lazily (`config(['filesystems.disks.client_media' => ...])`) once per process and re-registered after a save.
  2. Disk config: driver `s3`, `throw: true`, visibility from setting, key/secret/region (default `us-east-1`)/bucket/endpoint/url (CDN URL) and `use_path_style_endpoint` (default true for every provider except plain S3). Wasabi: endpoint defaults to `https://s3.<region>.wasabisys.com` when only a region is given. Bunny: key/bucket = storage zone, secret = zone password, region `auto`, endpoint by zone region, path-style on, URL from CDN.
  3. Endpoint normalisation: a trailing `/<bucket>` on the endpoint (as pasted from Cloudflare R2's S3 API URL) is stripped to avoid `.../bucket/bucket/key` URLs that 404.
  4. Helpers: `media_disk()` (disk name; falls back to local on any error), `media_storage()` (Filesystem instance), `media_url(path)` (strips a stray `storage/` prefix; asks the active disk for `url(path)`; on error falls back to `asset('storage/<path>')`; returns `''` for empty). `applyPrefix(path)` prepends `base_path` unless already present, but is only used by the connection test; normal uploads do not add the prefix. QUIRK: `base_path` ("Prefix prepended to every uploaded object") is not applied to real uploads.
  5. Visibility `private` is labelled "signed URLs", but no code generates temporary URLs (`temporaryUrl` is unused): `url()` returns the plain object URL, which a private bucket rejects. QUIRK: private mode without a CDN URL produces broken media links; use public bucket or CDN URL.
  6. Files already stored locally keep being served from the local disk path; switching providers does not rewrite paths or move files, so `media_url()` resolves an old local key against the cloud disk (broken) unless the object also exists there. QUIRK: the "non-destructive switch" claim in docs holds only for files staying reachable.
  7. Intentionally local (never cloud): brand favicon/logos (`brand/`), PWA icons (`pwa/`), auth-page media (`public/uploads/auth`), storefront assets and anything using the `public` disk directly.
  8. Boot wiring (shared hosting): if `public/storage` symlink is missing the app tries `storage:link`, else points the `public` disk at `public/storage`, mirroring files; it also forces the URL root/scheme and `filesystems.disks.public.url` from the request host. Not needed on the new stack.
- **Async & events:** none (synchronous I/O in the request); large uploads should be moved to presigned uploads in the port.
- **External systems:** S3-compatible providers; CDNs.
- **Settings:** `cloud_storage`; `.env` `FILESYSTEM_DISK`, AWS_* (unused by the dynamic disk).
- **Acceptance criteria:**
  - Given a complete enabled provider, when a customer uploads chat media, then the object appears in the bucket at `chat-media/...` and `media_url` returns the provider/CDN URL.
  - Given the provider incomplete or disabled, then uploads land on the local public disk and URLs are `/storage/...`.
  - Given an R2 endpoint pasted with the bucket suffix, then generated URLs contain the bucket once.
  - Given the cloud disk fails to register, then `media_disk()` returns `public` and the upload succeeds locally.
- **Source refs:** app/Services/CloudStorageManager.php; app/Support/fc_helpers.php (cloud_storage, media_disk, media_storage, media_url); app/Providers/AppServiceProvider.php (ensurePublicStorage, configureBaseUrl); app/Http/Controllers/ChatController.php; app/Http/Controllers/TemplatesController.php; app/Http/Controllers/AutoReplyController.php; app/Http/Controllers/FlowsController.php; app/Http/Controllers/WaProductController.php; app/Http/Controllers/TeamChatController.php; app/Http/Controllers/CheckoutController.php; app/Http/Controllers/AccountController.php; app/Http/Controllers/InvoicesController.php; app/Http/Controllers/Api/ExtensionApiController.php; config/filesystems.php; Documentation/pages/admin-panel/cloud-storage.html.
- **Port notes:** Single `MediaStorageService` (port + S3 adapter) in `apps/api` used by every module: presigned PUT for browser uploads, `objectKey = <org_id>/<domain>/<uuid>-<name>`, signed GET URLs for private objects (real implementation of what WaDesk only labels), CDN URL rewrite from settings, background orphan sweeper (ADR 0009 mentions orphan objects). Store asset rows (`assets` table with RLS) instead of bare paths. Provide a one-off migration tool for legacy local files if legacy data is imported.

### WD-SET-041 — Real-time (Pusher) settings and connection test

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-SET-001
- **Summary:** One platform-wide Pusher app powers live updates (Team Inbox and others) for every workspace. The admin pastes App ID, Key, Secret and Cluster, flips it on, and can save-and-test by firing a real event at Pusher. Users never enter keys.
- **Actors & access:** Platform admin.
- **UX & screens:** `resources/views/admin/realtime/index.blade.php`. Card "Live delivery": Enable real-time toggle ("Flips broadcasting from log to Pusher. Off = the inbox keeps polling") with pill "live" / "polling". Card "Pusher credentials": App ID, Cluster (placeholder mt1), Key (public), Secret (password field, "stored, leave blank to keep"), link to dashboard.pusher.com. Aside: how it works, what goes live, polling fallback. Sticky bar with "Save & test connection" and "Save changes". Flash via `x-admin.flash`.
- **Endpoints:**

| Endpoint                          | Route name                    | Action                                 | Middleware  | Request                                                                                                                                        | Response                                                                           |
| --------------------------------- | ----------------------------- | -------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| GET admin/settings/realtime       | admin.settings.realtime.index | Admin\RealtimeSettingsController@index | admin stack | -                                                                                                                                              | HTML                                                                               |
| POST admin/settings/realtime      | admin.settings.realtime.save  | Admin\RealtimeSettingsController@save  | admin stack | `realtime_enabled` bool, `pusher_app_id` max 64, `pusher_app_key` max 191, `pusher_app_secret` max 191, `pusher_cluster` max 32 (all nullable) | redirect "Real-time settings saved."                                               |
| POST admin/settings/realtime/test | admin.settings.realtime.test  | Admin\RealtimeSettingsController@test  | admin stack | same                                                                                                                                           | JSON `{ok,message}` (200/422) when JSON expected, else redirect with success/error |

- **Data:** `realtime_enabled` (stored as int 1/0), `pusher_app_id`, `pusher_app_key`, `pusher_cluster` (default `mt1`; blank -> `mt1`), `pusher_app_secret` (encrypted with `Crypt::encryptString` by `RealtimeSettings::save`, only overwritten when a new value is posted).
- **Rules & edge cases:**
  1. Test = save the posted values, then require App ID, Key and Secret ("Fill in App ID, Key and Secret first."), require the Pusher PHP SDK class ("Pusher PHP SDK is not installed on the server."), then trigger a throwaway event `ping` on channel `wadesk-realtime-test` (TLS, cluster host). Success message: "Connected - Pusher accepted a test event. Real-time is live."; failure: "Pusher rejected the credentials: <error>". QUIRK: the probe needs the SDK although runtime broadcasting deliberately does not (WD-SET-042), so a working install without the composer package always fails the test.
  2. Audit (only on plain save, not on test): platform-layer action `settings.realtime.save` with `enabled` in the payload.
  3. The secret is never rendered back; the form shows only whether one is stored.
  4. Enabled requires key and cluster to be non-blank at runtime (WD-SET-042); the App ID and secret are needed for server triggers.
- **Async & events:** audit row.
- **External systems:** Pusher Channels REST API (`api-<cluster>.pusher.com`).
- **Settings:** the five keys; `.env` `BROADCAST_CONNECTION` (default `log`) and `PUSHER_*` are only fallbacks in `config/broadcasting.php`.
- **Acceptance criteria:**
  - Given valid credentials and "Save & test connection", then Pusher accepts a `ping` event and the success message shows.
  - Given a blank secret on a later save, then the stored secret is unchanged.
  - Given enabled but the key blank, then the runtime stays on the `log` broadcaster (pill still shows "live" from the flag; effective state is disabled).
  - Given wrong keys, then the test shows the Pusher error.
- **Source refs:** app/Http/Controllers/Admin/RealtimeSettingsController.php; app/Support/RealtimeSettings.php; resources/views/admin/realtime/index.blade.php; config/broadcasting.php; app/Services/Inbox/AuditLogger.php.
- **Port notes:** The new repo already has `apps/api/src/realtime` (Socket.IO gateway with a Redis adapter). Pusher is likely unnecessary: keep an "enable real-time / fallback to polling" platform flag and, if an external provider is still wanted, put it behind a `RealtimeTransport` port. If Pusher stays, implement the probe with the HTTP API (no SDK), so the test works without extra packages.

### WD-SET-042 — Real-time runtime: broadcaster switch, browser bootstrap, channel authorisation

- **Status:** implemented
- **Priority:** P1
- **Effort:** L
- **Depends on:** WD-SET-041
- **Summary:** When real-time is enabled, the server flips its broadcaster to Pusher at runtime (SDK-free HTTP driver), pages receive only the public key and cluster, the browser starts Laravel Echo, and private channels are authorised against workspace membership. When disabled, everything keeps polling.
- **Actors & access:** Signed-in workspace users (private channels), platform admins (may watch any workspace inbox).
- **UX & screens:** The user layout prints `<meta name="pusher-key">` and `<meta name="pusher-cluster">` (empty when disabled); `resources/js/echo.js` initialises Echo with `forceTLS`, CSRF header and sets `window.__realtime = {enabled, wsId}`.
- **Endpoints:**

| Endpoint                   | Route name | Action                                                   | Middleware | Response                 |
| -------------------------- | ---------- | -------------------------------------------------------- | ---------- | ------------------------ |
| GET/POST broadcasting/auth | -          | Illuminate\Broadcasting\BroadcastController@authenticate | web, auth  | signed channel auth JSON |

- **Data:** reads `realtime_enabled` and the Pusher keys; channel checks read `workspaces`, `workspace_user`, `conversations`.
- **Rules & edge cases:**
  1. `RealtimeSettings::enabled()` = flag true AND key non-empty AND cluster non-empty (exceptions swallowed -> false). `applyToConfig()` (called from `AppServiceProvider::boot` on every request) sets `broadcasting.default = pusher` and the pusher connection app_id/key/secret/cluster/host `api-<cluster>.pusher.com`/TLS. `publicConfig()` returns only `{enabled, key, cluster}`.
  2. Driver `pusher-http` (`PusherHttpBroadcaster`) needs no Pusher SDK: it signs requests itself. Trigger = POST `/apps/<id>/events` with `auth_key`, `auth_timestamp`, `auth_version=1.0`, `body_md5` and an HMAC-SHA256 signature over `POST\n<path>\n<sorted query>`; timeout 8 s; body carries event name, channels, JSON data and optional `socket_id` (to exclude the sender). Skips silently (warning log) when key/secret/app id are blank. Failures are logged and swallowed so a real-time push never breaks the underlying action.
  3. Channel auth: private channels signed as `key:HMAC(socket_id:channel)`; presence channels sign `socket_id:channel:channel_data` and return channel_data. Access denied when the channel name is empty or the user cannot access it.
  4. Registered channels (`routes/channels.php`): `workspace.{id}.inbox` (member of the workspace via owner, `workspace_user` row, or platform admin) and `conversation.{id}` (member of the conversation's workspace). QUIRK: events are also broadcast on `user.{id}.notifications`, `workspace.{id}.team-chat` and `workspace.{id}.devices`, which have NO authorisation callback, so subscriptions to them are refused.
  5. Broadcast events (all `ShouldBroadcastNow`, synchronous, no queue): Inbox `MessageReceived`, `ConversationUpdated`, `ConversationAssigned`, `NoteAdded`, `MentionReceived`, `SlaBreached`, plus `DeviceStatusChanged` and Team Chat `MessagePosted` (owners: TIB1/TIB2/TCHAT/WADEV).
  6. Verbose `[RT-TRACE]` logging of every auth and broadcast (including full payloads) is left on in the shipped code.
  7. The mobile app has its own token-authed `POST api/app/broadcasting/auth` (MOB) and reads driver/key from a config endpoint.
  8. Polling remains the fallback; no server-side dependency on the socket.
- **Async & events:** synchronous broadcast HTTP calls inside the request that triggers them (adds up to 8 s worst case).
- **External systems:** Pusher REST + websocket.
- **Settings:** realtime keys.
- **Acceptance criteria:**
  - Given real-time enabled with valid keys, when an inbound message is stored, then an event is triggered on `workspace.<id>.inbox` and the open inbox refreshes without polling.
  - Given a user from another workspace, when subscribing to `workspace.<id>.inbox`, then `/broadcasting/auth` returns 403.
  - Given real-time disabled, then the meta tags are empty and `window.__realtime.enabled` is false.
  - Given Pusher unreachable, then the triggering action still succeeds.
- **Source refs:** app/Support/RealtimeSettings.php; app/Broadcasting/PusherHttpBroadcaster.php; app/Providers/AppServiceProvider.php; routes/channels.php; bootstrap/app.php (withBroadcasting); config/broadcasting.php; resources/js/echo.js; resources/views/components/layouts/user.blade.php; app/Events/Inbox/*.php; app/Events/DeviceStatusChanged.php; app/Events/TeamChat/MessagePosted.php.
- **Port notes:** Already partly built: `apps/api/src/realtime/realtime.gateway.ts` (Socket.IO + Redis adapter). Tenancy rule: rooms named `org:<uuid>:inbox`, `conv:<uuid>`; authorise in the gateway handshake via the same RBAC + org membership, and publish from the outbox consumer (never inline in request handlers, ADR 0005). Broadcast payloads should be minimal signals (ids), matching WaDesk's "lightweight signal" design.

### WD-SET-043 — Premium plans dashboard

- **Status:** partial
- **Priority:** P2
- **Effort:** M
- **Depends on:** WD-SET-005
- **Summary:** A super-admin analytics page for plans: paid vs free workspace counts, ARPU, a "trial to paid" ratio, a plan-distribution donut, revenue per plan, daily new paid signups and a plans table. Several numbers are wrong in practice because the queries join the wrong columns.
- **Actors & access:** Platform admin (admin stack). Data belongs to PLAN/CPN/DASH.
- **UX & screens:** `resources/views/admin/premium/index.blade.php` + `resources/js/charts/admin-premium.js` (ApexCharts). Header with a decorative search box ("Search plans, workspaces...", non-functional). Window select (Last 7 days, 30 days, 90 days, Last year) auto-submitting a GET form; buttons Packages and "New plan". KPI tiles: Paid workspaces ("On a non-free plan"), Free workspaces ("Upgrade target"), ARPU ("Avg revenue / workspace"), Trial -> paid (percentage with delta vs the previous window, +/-). Charts: Plan distribution (donut, workspaces per plan), Revenue by plan (bar, window total, y-axis prefixed with `window.WA_CURRENCY` or `$`), New paid signups (smooth area, daily). "Most popular plans" list (top 5 in the last 90 days: name, orders, revenue; empty state "No paid orders in last 90 days."). "All plans" table: Plan (FREE badge), Price, Duration ("<n> <unit>"), Workspaces, MRR, Revenue (window), Status (Active/Off), Edit link; empty state "No plans defined yet.".
- **Endpoints:**

| Endpoint          | Route name    | Action                        | Middleware  | Request                                                  | Response |
| ----------------- | ------------- | ----------------------------- | ----------- | -------------------------------------------------------- | -------- |
| GET admin/premium | admin.premium | Admin\PremiumController@index | admin stack | `window` in 7d,30d,90d,1y (anything else behaves as 30d) | HTML     |

- **Data:** reads `workspaces` (plan, count), `packages` (plan_amount, offer_price, free, status, pname, plan_duration, plan_unit), `orders` (status `paid`, `paid_at`, `total_amount` else `amount`, `workspace_id`, `package_id`), `users.created_at` (signups).
- **Rules & edge cases:**
  1. Window: `to` = end of today (server timezone), `from` = start of the day `N` days earlier (N = 7, 30, 90 or 365); previous window = the N days before `from`.
  2. Paid workspaces = workspaces whose `plan` is in the ids of packages with `free = false`; Free = total workspaces minus paid. Trial -> paid % = distinct workspaces with a paid order in the window divided by users created in the window (can exceed 100%); delta vs previous window = (now - prev)/prev x 100, or 100 if prev = 0 and now > 0, else 0. ARPU = MRR / paid workspaces where MRR = sum over workspaces on active non-free packages of the package's effective price (offer price when > 0, else plan amount). MRR ignores billing duration (an annual plan counts as one month) and mixes package currencies while formatting with the platform default symbol and no conversion.
  3. BUG (verify at port time): `workspaces.plan` stores the package SLUG (`packages.plan_id`, e.g. `starter`) but the queries compare it to `packages.id` (numeric), so joins/`whereIn` match nothing: plan mix labels every workspace "Free", paid count 0, MRR 0, per-plan workspace counts 0. Orders join on `orders.package_id` and so work.
  4. Plans table: `Package::plans()` (type plan or null) ordered by `plan_amount` desc; price uses `chargeableAmount()` (0 for free); revenue = paid order totals per package in the window.
  5. Money is formatted as `FormatSettings::symbol()` + number (WD-SET-044).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `default_currency` (symbol).
- **Acceptance criteria:**
  - Given 3 paid orders in the last 30 days for distinct workspaces and 6 signups, then Trial -> paid shows 50.00%.
  - Given no paid orders in 90 days, then the popular-plans list shows the empty message.
  - Given `?window=bogus`, then the 30-day range is used.
  - Given (target behavior) workspaces on slug `pro`, then plan mix counts them under "Pro".
- **Source refs:** app/Http/Controllers/Admin/PremiumController.php; resources/views/admin/premium/index.blade.php; resources/js/charts/admin-premium.js; app/Models/Package.php; routes/admin.php.
- **Port notes:** Belongs in DASH/PLAN read models; implement as SQL aggregates over plan subscriptions with the correct key, normalised to a single reporting currency, MRR normalised per billing interval. Read replica friendly (ADR 0013).

### WD-SET-044 — Currency display and conversion helpers

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-SET-006
- **Summary:** A formatting service renders money in a workspace's currency (or the platform default) with the currency's symbol and precision, and converts between currencies using stored rates relative to USD.
- **Actors & access:** Server-side for every price shown (plans, wallet, invoices, dashboards, pipelines).
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** table `currencies` (CPN owns): `code` unique, `symbol`, `precision` (tinyint default 2), `exchange_rate` decimal(16,6) default 1 (units of that currency per 1 USD), `is_active`. Reads `default_currency`, `workspaces.currency`.
- **Rules & edge cases:**
  1. `currencyFor(workspace)`: use the given workspace, else the signed-in user's current workspace (guarded for CLI/webhook contexts); code = workspace currency (uppercased) else `default_currency` (default `USD`); returns the `currencies` row (cached 60 s per code) or null.
  2. `currency(amount, ws)`: `number_format(amount, precision, '.', ',')` prefixed with the symbol, or `"<CODE> "` when there is no symbol; with no currency row it returns a plain 2-decimal number. Separators are fixed (no locale-specific formatting).
  3. `display(amount, fromCode, ws)`: converts from `fromCode` to the target currency (skipped when null or equal) then formats. `formatIn(amount, code)` formats strictly in the given code without conversion (invoices/receipts must show the paid currency).
  4. `convert(amount, from, to)`: rates map of ACTIVE currencies cached 60 s; a missing rate defaults to 1.0; from-rate <= 0 returns the amount unchanged; result = amount / fromRate x toRate rounded to 2 decimals (ignores the target precision).
  5. `symbol(ws)` (fallback `$`) and `symbolFor(code)` (fallback the code; empty for null). `flushCache()` clears rate and per-code caches after admin currency edits.
  6. Wallet/credit math uses `credits_per_currency_minor` (WALLET).
- **Async & events:** none.
- **External systems:** none (rates fetched elsewhere by CPN).
- **Settings:** `default_currency`.
- **Acceptance criteria:**
  - Given INR with symbol and precision 2, `formatIn(1499.5,'INR')` returns the symbol plus `1,499.50`.
  - Given USD rate 1 and INR 83.5, `convert(10,'USD','INR')` = 835.00.
  - Given no matching currency row, then amounts render as plain 2-decimal numbers.
  - Given a workspace currency `EUR`, then dashboards format in EUR using cached currency row.
- **Source refs:** app/Support/FormatSettings.php; app/Support/MoneyFormat.php; app/Models/Currency.php; app/Http/Controllers/Admin/CurrencyController.php.
- **Port notes:** Use `Intl.NumberFormat` on the client; store amounts as integer minor units with an ISO code; keep a rates table with an as-of timestamp. Owned jointly with CPN.

### WD-SET-045 — Locale registry and text direction

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-SET-006
- **Summary:** A cached registry of active interface languages (code, name, native name, direction) plus the platform default locale, used by the language switcher and the request locale middleware; layouts set `lang` and `dir` from it.
- **Actors & access:** Everyone (server-side).
- **UX & screens:** Language switcher in headers (I18N); `<html lang dir>` in the public layout.
- **Endpoints:** none here (languages CRUD is `admin/languages` in I18N).
- **Data:** table `languages`: `code` unique varchar(12), `name`, `native_name`, `direction` enum ltr/rtl, `is_active`, `sort_order`. Reads `default_language` (default `config('app.locale','en')`, then `en`).
- **Rules & edge cases:**
  1. `active()` returns active languages ordered by `sort_order` then `name`, selected columns code/name/native_name/direction, cached 10 minutes under `locale:active_languages`; database or cache failure (fresh install) returns an empty list; `flush()` is called by the languages admin.
  2. `isAvailable(code)` and `directionFor(code)` (default `ltr`) scan the cached list.
  3. `defaultLocale()` never returns an empty string.
  4. The middleware resolution order (users.locale -> session -> workspace default -> platform default) is in I18N.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `default_language`.
- **Acceptance criteria:**
  - Given Arabic active with direction rtl and the request locale `ar`, then the public layout renders `dir="rtl"`.
  - Given a language toggled inactive, then it disappears from the switcher within 10 minutes or immediately after flush.
  - Given a fresh install without tables, then `active()` returns an empty array without an exception.
- **Source refs:** app/Support/LocaleSettings.php; app/Models/Language.php; resources/views/components/layouts/frontend.blade.php; resources/js/locale-switcher.js.
- **Port notes:** Owned by I18N; expose as `GET /public/locales` and a small in-memory cache with invalidation on change.

### WD-SET-046 — Timezone resolution and safe timezone helpers

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-SET-006
- **Summary:** Timestamps are stored in the application timezone and rendered in the viewer's zone using a fixed fallback chain that ends at the platform default; a normaliser stops legacy zone names from crashing pages.
- **Actors & access:** Server-side and Blade.
- **UX & screens:** none (all date rendering).
- **Endpoints:** none.
- **Data:** reads `default_timezone`, `users.timezone`, `workspaces.timezone`.
- **Rules & edge cases:**
  1. `wa_tz(ws)` picks the first valid of: an explicit tz string or an object's `timezone` (workspace/campaign), the current workspace's timezone, the signed-in user's timezone, `default_timezone`, `config('app.timezone')`, else `UTC`. Invalid strings are skipped (validated with `DateTimeZone`).
  2. `wa_local(when, tzOrWs)` converts a Carbon (or a string parsed in the app timezone) to the display zone; returns null for empty input; on error returns the original.
  3. `safe_timezone(tz, fallback='UTC')` maps legacy IANA aliases to canonical names (Asia/Calcutta -> Asia/Kolkata, Asia/Katmandu, Asia/Rangoon, Asia/Saigon, Asia/Dacca, Asia/Thimbu, Asia/Ulan_Bator, Asia/Chungking, Asia/Harbin, Asia/Ashkhabad, Asia/Ujung_Pandang, Asia/Macao, Europe/Kiev/Uzhgorod/Zaporozhye -> Europe/Kyiv, America/Buenos_Aires, America/Godthab, Pacific/Ponape, Pacific/Truk) and falls back when the value is not in PHP's canonical identifier list; blank passes through. Reason: Carbon rejects "backward" aliases while PHP accepts them, which used to 500 dashboards.
  4. New workspaces take `default_timezone` (or `Asia/Kolkata` in the provisioners); the registration timezone picker preselects it.
  5. The timezone picker on forms is the shared Tom Select control (`tz-picker.js`) built from `Intl.supportedValuesOf('timeZone')`.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `default_timezone`.
- **Acceptance criteria:**
  - Given a workspace timezone `Asia/Calcutta`, then `safe_timezone` returns `Asia/Kolkata` and pages render.
  - Given no workspace or user timezone, then times render in `default_timezone`.
  - Given an invalid explicit tz string, then the next candidate in the chain is used.
- **Source refs:** app/Support/fc_helpers.php (wa_tz, wa_local, safe_timezone); app/Support/AdminWorkspaceProvisioner.php; app/Services/WorkspaceProvisioner.php; resources/js/lib/tz-picker.js.
- **Port notes:** Store all instants as UTC `timestamptz`; format on the client with the viewer's IANA zone via `Intl`; keep the fallback chain in one helper; validate zone names with `Intl.DateTimeFormat` on write.

## Data model

### `system_settings` (the only table owned by this domain)

Purpose: platform-wide key/value configuration (no tenant column; not workspace scoped). Written only by platform admins, the installer, integration connect flows and seeders. Read on nearly every request through a 30-minute per-key cache. Volume: small (a seeded install has 17 rows; a fully configured install holds roughly 150-350 rows, mostly one per key plus dynamic `auth.*`, `theme.color.*`, `brand.logo.*`, `site.*`, `admin.notif_seen.<userId>` rows).

| Column                     | Type                               | Null | Default | Behavior                                                                                                                                                                    |
| -------------------------- | ---------------------------------- | ---- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                       | bigint unsigned PK, auto increment | no   | -       | surrogate                                                                                                                                                                   |
| `key`                      | varchar(96)                        | no   | -       | UNIQUE (`system_settings_key_unique`); dotted or snake case; max 96 chars                                                                                                   |
| `type`                     | varchar(16)                        | no   | `'int'` | one of `int`, `float`, `bool`, `string`, `json` (code also writes `text`, treated as string); drives read casting; a wrong/omitted type silently changes reads (WD-SET-001) |
| `value`                    | text                               | yes  | NULL    | canonical text: bool `'1'`/`'0'`, json string, secrets as `Crypt::encrypt` ciphertext for the 32 listed keys                                                                |
| `description`              | text                               | yes  | NULL    | free text; updated only when supplied on write                                                                                                                              |
| `created_at`, `updated_at` | timestamp                          | yes  | NULL    | `updated_at` drives the hub "Last updated" KPI                                                                                                                              |

Indexes: PK on `id`, UNIQUE on `key`. No foreign keys. No soft delete. Features: read by all; written by WD-SET-005..041.

Related non-owned columns touched by this domain: `workspaces.branding_footer` varchar(60) null (WD-SET-012), `workspaces.timezone`/`currency`/`brand_color` (WD-SET-006, 013), `users.theme_preference` varchar(16) (WD-SET-017), `currencies`, `languages`, `packages`, `orders`, `blog_posts`, `blog_categories` (read), `audit_logs` (write), `push_subscriptions` (Team Inbox push; NOTIF).

### Catalogue of system settings keys OWNED by this domain

Type = the type WaDesk stores/casts. "Str" means string. Defaults are the read-time defaults. Validation is the server rule on the admin form. Consumers name the code that reads the key.

**Identity and defaults (General page, WD-SET-005..009, 012)**

| Key                            | Type                       | Default                                       | Validation                      | Consumed by                                                          |
| ------------------------------ | -------------------------- | --------------------------------------------- | ------------------------------- | -------------------------------------------------------------------- |
| `app_name`                     | Str                        | "WaDesk" (never `APP_NAME`)                   | required, max 80                | Brand::name, SEO, mail subjects, PWA, exports, webhook header prefix |
| `app_url`                      | Str                        | config app.url                                | url, max 191                    | support-reply mailable only                                          |
| `support_email`                | Str                        | ''                                            | email, max 160                  | invoice view fallback                                                |
| `contact_number`               | Str                        | ''                                            | max 40                          | (no consumer)                                                        |
| `from_email`                   | Str                        | ''                                            | email, max 160                  | support-reply mailable                                               |
| `default_timezone`             | Str                        | app timezone (`Asia/Kolkata` in provisioners) | max 64                          | wa_tz, registration, provisioners, message history                   |
| `default_language`             | Str                        | config app.locale / `en`                      | max 12                          | LocaleSettings, SetLocale, Languages admin (also written there)      |
| `default_currency`             | Str                        | `USD`                                         | max 8                           | FormatSettings, pricing, checkout, deals, invoices, provisioners     |
| `default_country_code`         | Str                        | `+91`                                         | max 6                           | app_default_country                                                  |
| `default_country_iso`          | Str                        | `in`                                          | size 2                          | app_default_country(_name)                                           |
| `font_family`                  | Str                        | '' (theme default)                            | max 40                          | app_font partial                                                     |
| `address`                      | Str                        | ''                                            | max 500                         | (no consumer; see `site.address`)                                    |
| `map_iframe_url`               | Str                        | ''                                            | max 1000                        | (no consumer)                                                        |
| `preloader`                    | Str '0'/'1'                | true                                          | boolean                         | (no consumer)                                                        |
| `maintenance_mode`             | Str '0'/'1'                | false                                         | boolean                         | Maintenance middleware                                               |
| `public_registration`          | Str '0'/'1'                | true                                          | boolean                         | (no consumer)                                                        |
| `auto_verify_email`            | Str '0'/'1' (seeded int 1) | true                                          | boolean                         | register (web+mobile), EnsureUserActive                              |
| `registration_default_plan_id` | Str                        | ''                                            | max 64, exists packages.plan_id | signup provisioners                                                  |
| `registration_trial_days`      | Str (numeric)              | 14                                            | int 0-365                       | signup provisioners                                                  |
| `billing_plan_scope`           | Str                        | `workspace`                                   | in workspace,account            | Workspace::billingPackage                                            |
| `platform_branding_footer`     | Str                        | '' (seeded "Sent via WaDesk")                 | max 60                          | BrandingFooterService, account page                                  |

**Brand and theme (WD-SET-010, 013-017)**

| Key                                                    | Type                  | Default                       | Validation                              | Consumed by                                     |
| ------------------------------------------------------ | --------------------- | ----------------------------- | --------------------------------------- | ----------------------------------------------- |
| `brand.favicon`                                        | Str                   | ''                            | file png/ico/jpg/jpeg/svg/webp <=512 KB | Brand::faviconUrl, layouts, PWA fallback        |
| `brand.logo.<theme>` (paper, bright, dark, doodle)     | Str                   | ''                            | file png/jpg/jpeg/svg/webp <=1 MB       | Brand::logoUrl, emails, invoices, mobile config |
| `theme.color.<token>` x16                              | Str                   | '' (= shipped hex)            | `^#[0-9A-Fa-f]{3,8}$`                   | theme_css, theme_color                          |
| `theme.metric.font-scale`                              | Str int               | 100                           | clamp 80-130                            | theme_css                                       |
| `theme.metric.ui-opacity`                              | Str int               | 100                           | clamp 55-100                            | theme_css                                       |
| `user_dashboard_layout`                                | Str                   | `topbar`                      | topbar\|sidebar                         | UserNav::layout                                 |
| `user_sidebar_color` / `_text_color` / `_accent_color` | Str                   | '' (#06100E / auto / #25D366) | `^#[0-9A-Fa-f]{6}$`                     | sidebar rail                                    |
| `user_nav_order`                                       | json (double-encoded) | `[]`                          | keys from the nav catalogue             | user header, More page                          |

**Auth pages (WD-SET-018..021)**

| Key                                                                                                                        | Type | Default                       | Validation                                    | Consumed by    |
| -------------------------------------------------------------------------------------------------------------------------- | ---- | ----------------------------- | --------------------------------------------- | -------------- |
| `auth.variant`                                                                                                             | Str  | `1`                           | int 1-5                                       | x-auth-shell   |
| `auth.<page>.eyebrow` / `heading` / `heading_accent` / `subheading`                                                        | Str  | shipped copy (see WD-SET-018) | max 60-600                                    | auth_cfg       |
| `auth.<page>.accent`                                                                                                       | Str  | `#25D366`                     | none server-side (max 600 inline / 9 classic) | auth shell     |
| `auth.<page>.media_url` / `media_type`                                                                                     | Str  | ''                            | file <=20 MB                                  | auth shell     |
| `auth.<page>.hero_title/hero_desc/footer/stat1-3_num, stat1-3_label, feat1-4_title, feat1-4_desc, inside_heading, chip1-6` | Str  | shipped copy                  | max 600                                       | auth templates |
| (`<page>` is login, register or forgot.)                                                                                   |

**Site identity and footer (WD-SET-022..023)**

| Key                                                                                           | Type | Default | Validation          | Consumed by                                       |
| --------------------------------------------------------------------------------------------- | ---- | ------- | ------------------- | ------------------------------------------------- |
| `site.company_name`, `site.tagline`, `site.founded_year`, `site.address`, `site.city_country` | Str  | ''      | max 255             | contact page, invoices, mobile promo card         |
| `site.email_general/support/sales/security/careers`                                           | Str  | ''      | email max 190       | contact page, brand_email, invoices, contact form |
| `site.phone`, `site.whatsapp`                                                                 | Str  | ''      | max 255             | contact page (wa.me link), invoices               |
| `site.social_x/linkedin/instagram/youtube/facebook/github`                                    | Str  | ''      | url max 255         | public footer                                     |
| `site.domain`, `site.company_tax_id`, `site.contact_email`                                    | Str  | (none)  | no form field       | brand_email, invoices, (contact_email unused)     |
| `footer_title`, `footer_copyright`, `footer_description`                                      | Str  | ''      | max 120 / 300 / 500 | frontend footer                                   |

**Mail (WD-SET-024)**

| Key                                    | Type                       | Default             | Validation                                             | Consumed by                             |
| -------------------------------------- | -------------------------- | ------------------- | ------------------------------------------------------ | --------------------------------------- |
| `mail_mailer`                          | Str                        | config mail.default | in smtp,sendmail,log,array,mailgun,ses,postmark,resend | MailConfig                              |
| `mail_host`                            | Str                        | config              | max 200                                                | MailConfig                              |
| `mail_port`                            | Str                        | 587                 | int 1-65535                                            | MailConfig                              |
| `mail_username`                        | Str                        | config              | max 200                                                | MailConfig                              |
| `mail_password`                        | Str (Crypt::encryptString) | ''                  | max 500                                                | MailConfig                              |
| `mail_encryption`                      | Str                        | `tls`               | in tls,ssl,starttls,''                                 | MailConfig (not honoured by Laravel 12) |
| `mail_from_name` / `mail_from_address` | Str                        | app name / config   | max 120 / email max 200                                | MailConfig                              |

**SEO, privacy, analytics, custom code (WD-SET-026..034)**

| Key                                                                                                                                                                | Type | Default                          | Validation                                | Consumed by                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | -------------------------------- | ----------------------------------------- | ------------------------------ |
| `seo_meta_title/_description/_keywords`                                                                                                                            | Str  | ''                               | 160 / 320 / 500                           | Seo::meta                      |
| `seo_robots`                                                                                                                                                       | Str  | `index, follow`                  | max 120                                   | Seo::meta                      |
| `seo_canonical`, `seo_og_url`, `seo_og_image`                                                                                                                      | Str  | ''                               | url (300/300/500)                         | Seo::meta                      |
| `seo_author`                                                                                                                                                       | Str  | app name                         | 120                                       | Seo::meta                      |
| `seo_og_title`, `seo_og_description`                                                                                                                               | Str  | ''                               | 160 / 320                                 | Seo::meta                      |
| `seo_og_type`                                                                                                                                                      | Str  | `website`                        | website\|article\|product\|profile        | Seo::meta                      |
| `seo_twitter_card`                                                                                                                                                 | Str  | `summary_large_image`            | summary\|summary_large_image\|app\|player | Seo::meta                      |
| `seo_twitter_site`, `seo_twitter_creator`                                                                                                                          | Str  | ''                               | 60                                        | Seo::meta                      |
| `seo_google_verification`, `seo_bing_verification`                                                                                                                 | Str  | ''                               | 200                                       | Seo::meta                      |
| `privacy_cookie_banner_enabled`                                                                                                                                    | bool | true                             | boolean                                   | cookie-consent, site-analytics |
| `privacy_cookie_banner_style`                                                                                                                                      | Str  | `bottom-bar`                     | modal\|bottom-bar\|top-bar                | cookie-consent                 |
| `privacy_cookie_message`                                                                                                                                           | Str  | long default text                | max 1000                                  | cookie-consent                 |
| `privacy_policy_url`, `privacy_terms_url`, `privacy_cookies_policy_url`                                                                                            | Str  | ''                               | url 300                                   | legal_url, cookie-consent      |
| `privacy_dnt_respect`                                                                                                                                              | bool | true                             | boolean                                   | cookie-consent.js              |
| `privacy_gdpr_compliance`, `privacy_ccpa_compliance`, `privacy_ada_skip_link`, `privacy_ada_high_contrast`, `privacy_ada_large_text`, `privacy_ada_reduced_motion` | bool | true,true,true,false,false,false | boolean                                   | (no consumer)                  |
| `analytics_google_ga4`, `_google_gtm`, `_meta_pixel`, `_microsoft_clarity`, `_tiktok_pixel`, `_linkedin_partner`, `_twitter_pixel`                                 | Str  | ''                               | max 50                                    | site-analytics                 |
| `analytics_plausible_domain`, `_posthog_key`, `_mixpanel_token`                                                                                                    | Str  | ''                               | max 120                                   | site-analytics                 |
| `analytics_posthog_host`                                                                                                                                           | Str  | `https://app.posthog.com`        | url 200                                   | site-analytics                 |
| `analytics_hotjar_site_id`                                                                                                                                         | Str  | ''                               | max 30                                    | site-analytics                 |
| `custom_css`, `custom_js`                                                                                                                                          | Str  | ''                               | max 50000                                 | frontend layout                |
| `custom_code_enabled`                                                                                                                                              | bool | false                            | boolean                                   | frontend layout                |

**PWA (WD-SET-035..038)**

| Key                                                                     | Type      | Default                           | Validation                                                             | Consumed by                |
| ----------------------------------------------------------------------- | --------- | --------------------------------- | ---------------------------------------------------------------------- | -------------------------- |
| `pwa_enabled`                                                           | bool      | false                             | boolean                                                                | pwa-meta                   |
| `pwa_install_prompt`, `pwa_offline_enabled`                             | bool      | true, true                        | boolean                                                                | (no consumer)              |
| `pwa_app_name`, `pwa_short_name`                                        | Str       | brand name                        | 60 / 12                                                                | manifest                   |
| `pwa_description`                                                       | Str       | ''                                | 300                                                                    | manifest                   |
| `pwa_start_url`, `pwa_scope`                                            | Str       | `/`                               | 200 (normalised)                                                       | manifest                   |
| `pwa_display`                                                           | Str       | `standalone`                      | standalone\|fullscreen\|minimal-ui\|browser                            | manifest                   |
| `pwa_orientation`                                                       | Str       | `portrait`                        | any\|portrait\|landscape\|natural\|portrait-primary\|landscape-primary | manifest                   |
| `pwa_theme_color`, `pwa_background_color`                               | Str       | `#075E54`, `#FBFAF6`              | hex regex                                                              | manifest, head             |
| `pwa_icon_192`, `pwa_icon_512`                                          | Str (URL) | ''                                | png/webp <=1 MB / <=2 MB                                               | manifest, apple-touch-icon |
| `pwa_splash`                                                            | Str       | ''                                | (never written)                                                        | (no consumer)              |
| `ti_pwa_enabled`                                                        | bool      | false                             | boolean                                                                | layout, push notifier      |
| `ti_pwa_name`, `ti_pwa_short_name`                                      | Str       | "<brand> Inbox", "Inbox"          | 60 / 12                                                                | team-inbox manifest        |
| `ti_pwa_icon_192`, `ti_pwa_icon_512`                                    | Str (URL) | ''                                | png/webp <=1 MB / <=2 MB                                               | team-inbox manifest        |
| `ti_pwa_theme_color`, `ti_pwa_background_color`, `ti_pwa_description`   | Str       | fall back to pwa_* / default text | no form                                                                | team-inbox manifest        |
| `ti_vapid_public` / `ti_vapid_private` (encrypted) / `ti_vapid_subject` | Str       | '' / '' / app URL                 | generated                                                              | WebPushService             |

**Storage and realtime (WD-SET-039..042)**

| Key                                | Type                       | Default | Validation                                                     | Consumed by                       |
| ---------------------------------- | -------------------------- | ------- | -------------------------------------------------------------- | --------------------------------- |
| `cloud_storage`                    | json                       | none    | provider in 6, visibility in public,private, base_path max 191 | CloudStorageManager               |
| `realtime_enabled`                 | int 1/0                    | false   | boolean                                                        | RealtimeSettings                  |
| `pusher_app_id` / `pusher_app_key` | Str                        | ''      | 64 / 191                                                       | RealtimeSettings, Echo (key only) |
| `pusher_app_secret`                | Str (Crypt::encryptString) | ''      | 191                                                            | broadcaster                       |
| `pusher_cluster`                   | Str                        | `mt1`   | 32                                                             | RealtimeSettings, Echo            |

### Catalogue of keys owned by OTHER domains (found in code; for completeness)

Type `-` means the key is written through a helper/dynamic path or read without a literal typed write; defaults are the first read-time default found (truncated). Owners should confirm and detail these in their files.

| Key                                                                                                                                                                                            | Type                                 | Default                                  | Owner domain   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------- | -------------- |
| ai_handoff_customer_message                                                                                                                                                                    | -                                    | ''                                       | AIAG           |
| users_last_import                                                                                                                                                                              | json                                 | null                                     | ASHELL         |
| platform.emergency_send_halt                                                                                                                                                                   | bool                                 | false                                    | AUTH           |
| recaptcha_enabled                                                                                                                                                                              | -                                    | false                                    | AUTH           |
| recaptcha_secret                                                                                                                                                                               | -                                    | ''                                       | AUTH           |
| recaptcha_site_key                                                                                                                                                                             | -                                    | ''                                       | AUTH           |
| recaptcha_v3_threshold                                                                                                                                                                         | -                                    | 0.5                                      | AUTH           |
| recaptcha_version                                                                                                                                                                              | -                                    | 'v2'                                     | AUTH           |
| registration_otp_device_id                                                                                                                                                                     | -                                    | 0                                        | AUTH           |
| registration_otp_enabled                                                                                                                                                                       | bool                                 | false                                    | AUTH           |
| registration_otp_length                                                                                                                                                                        | int                                  | 6                                        | AUTH           |
| registration_otp_max_attempts                                                                                                                                                                  | int                                  | 5                                        | AUTH           |
| registration_otp_resend_cooldown_sec                                                                                                                                                           | int                                  | 60                                       | AUTH           |
| registration_otp_sender                                                                                                                                                                        | string                               | ''                                       | AUTH           |
| registration_otp_template_id                                                                                                                                                                   | int                                  | 0                                        | AUTH           |
| registration_otp_ttl_minutes                                                                                                                                                                   | int                                  | 0; 5                                     | AUTH           |
| security.alert_channel                                                                                                                                                                         | -                                    | 'email'                                  | AUTH           |
| security.alert_on_new_country                                                                                                                                                                  | -                                    | true                                     | AUTH           |
| security.alert_on_new_device                                                                                                                                                                   | -                                    | true                                     | AUTH           |
| security.api_rate_limit_per_minute                                                                                                                                                             | -                                    | (none)                                   | AUTH           |
| security.audit_log_retention_days                                                                                                                                                              | -                                    | 365                                      | AUTH           |
| security.ip_allowlist_cidrs                                                                                                                                                                    | -                                    | []                                       | AUTH           |
| security.ip_allowlist_enabled                                                                                                                                                                  | -                                    | false                                    | AUTH           |
| security.mask_customer_numbers                                                                                                                                                                 | bool                                 | (none)                                   | AUTH           |
| security.max_concurrent_sessions                                                                                                                                                               | -                                    | 5                                        | AUTH           |
| security.require_2fa_for_admins                                                                                                                                                                | -                                    | false                                    | AUTH           |
| security.require_2fa_for_all                                                                                                                                                                   | -                                    | false                                    | AUTH           |
| security.require_2fa_for_owners                                                                                                                                                                | -                                    | false                                    | AUTH           |
| security.session_timeout_minutes                                                                                                                                                               | -                                    | 60                                       | AUTH           |
| security.wa_guardrails_mode                                                                                                                                                                    | -                                    | 'off'                                    | AUTH           |
| social_google_android_client_id                                                                                                                                                                | -                                    | ''                                       | AUTH           |
| social_google_ios_client_id                                                                                                                                                                    | -                                    | ''                                       | AUTH           |
| waba_meta_block_retry_backoff_hours                                                                                                                                                            | -                                    | 2                                        | BCAST          |
| bsp_auto_attach_credit                                                                                                                                                                         | string                               | '0'                                      | BSP            |
| bsp_auto_attach_currency                                                                                                                                                                       | string                               | ''                                       | BSP            |
| bsp_base_currency                                                                                                                                                                              | -                                    | 'USD'                                    | BSP            |
| bsp_credit_source                                                                                                                                                                              | -                                    | 'meta'                                   | BSP            |
| bsp_enabled                                                                                                                                                                                    | -                                    | true                                     | BSP            |
| bsp_graph_version                                                                                                                                                                              | string                               | 'v26.0'                                  | BSP            |
| bsp_meta_business_id                                                                                                                                                                           | string                               | ''                                       | BSP            |
| bsp_meta_extended_credit_id                                                                                                                                                                    | string                               | ''                                       | BSP            |
| bsp_meta_rates_endpoint                                                                                                                                                                        | string                               | ''                                       | BSP            |
| bsp_meta_system_user_token                                                                                                                                                                     | string                               | ''                                       | BSP            |
| bsp_pay_per_message                                                                                                                                                                            | int(default)                         | '0'                                      | BSP            |
| ffmpeg_path                                                                                                                                                                                    | -                                    | ''                                       | CALL           |
| web_search_key                                                                                                                                                                                 | string                               | ''                                       | CALL/AIAG      |
| web_search_provider                                                                                                                                                                            | string                               | 'tavily'                                 | CALL/AIAG      |
| campaign_auto_expiry_enabled                                                                                                                                                                   | bool                                 | true                                     | CAMP           |
| campaign_default_expiry_hours                                                                                                                                                                  | int                                  | 24                                       | CAMP           |
| campaign_parallel_concurrency                                                                                                                                                                  | -                                    | 15                                       | CAMP           |
| campaign_parallel_send                                                                                                                                                                         | -                                    | true                                     | CAMP           |
| campaign_retry_attempts                                                                                                                                                                        | -                                    | 3                                        | CAMP           |
| campaign_retry_backoff_sec                                                                                                                                                                     | -                                    | 60                                       | CAMP           |
| catalog_commerce_enabled                                                                                                                                                                       | -                                    | false                                    | CAT            |
| catalog_default_currency                                                                                                                                                                       | -                                    | 'USD'                                    | CAT            |
| catalog_enabled                                                                                                                                                                                | -                                    | true                                     | CAT            |
| catalog_graph_api_version                                                                                                                                                                      | -                                    | 'v23.0'                                  | CAT            |
| catalog_meta_app_id                                                                                                                                                                            | -                                    | ''                                       | CAT            |
| catalog_meta_app_secret                                                                                                                                                                        | -                                    | ''                                       | CAT            |
| checkout.countries                                                                                                                                                                             | json                                 | null                                     | CHK            |
| checkout.tax_enabled                                                                                                                                                                           | bool                                 | true                                     | CHK            |
| checkout.tax_label                                                                                                                                                                             | string                               | 'GST'; 'Tax'                             | CHK            |
| checkout.tax_rate                                                                                                                                                                              | int                                  | 0; 18                                    | CHK            |
| billing.address                                                                                                                                                                                | string                               | ''                                       | CHK/INV        |
| billing.company                                                                                                                                                                                | string                               | ''                                       | CHK/INV        |
| billing.email                                                                                                                                                                                  | string                               | ''                                       | CHK/INV        |
| billing.logo                                                                                                                                                                                   | string                               | ''                                       | CHK/INV        |
| billing.phone                                                                                                                                                                                  | string                               | ''                                       | CHK/INV        |
| billing.reg_no                                                                                                                                                                                 | string                               | ''                                       | CHK/INV        |
| billing.tax_id                                                                                                                                                                                 | string                               | ''                                       | CHK/INV        |
| frontend_enabled                                                                                                                                                                               | int                                  | true                                     | CMS            |
| currency_symbol                                                                                                                                                                                | -                                    | ''                                       | CPN            |
| referral_signup_credits                                                                                                                                                                        | int                                  | 100                                      | CPN            |
| shopify_client_id                                                                                                                                                                              | string                               | ''                                       | ECOM           |
| shopify_client_secret                                                                                                                                                                          | string                               | ''                                       | ECOM           |
| shopify_enabled                                                                                                                                                                                | bool                                 | false                                    | ECOM           |
| shopify_redirect_uri                                                                                                                                                                           | string                               | (none)                                   | ECOM           |
| shopify_scopes                                                                                                                                                                                 | string                               | \App\Services\Shopify\ShopifyService::DE | ECOM           |
| woocommerce_enabled                                                                                                                                                                            | bool                                 | false                                    | ECOM           |
| woocommerce_instructions                                                                                                                                                                       | string                               | ''                                       | ECOM           |
| facebook_enabled                                                                                                                                                                               | bool                                 | false                                    | FB             |
| fb_app_id                                                                                                                                                                                      | -                                    | ''                                       | FB             |
| fb_app_secret                                                                                                                                                                                  | -                                    | ''                                       | FB             |
| fb_config_id                                                                                                                                                                                   | -                                    | ''                                       | FB             |
| fb_graph_version                                                                                                                                                                               | -                                    | ''                                       | FB             |
| fb_greeting_graph_version                                                                                                                                                                      | -                                    | 'v19.0'                                  | FB             |
| fb_webhook_verify_token                                                                                                                                                                        | -                                    | ''                                       | FB             |
| translation.official_only                                                                                                                                                                      | bool                                 | false                                    | I18N           |
| instaflow_brand                                                                                                                                                                                | string                               | ''                                       | IG             |
| instaflow_connected                                                                                                                                                                            | bool                                 | false                                    | IG             |
| instaflow_last_check                                                                                                                                                                           | string                               | ''                                       | IG             |
| instaflow_last_inbound                                                                                                                                                                         | string                               | (none)                                   | IG             |
| instaflow_secret                                                                                                                                                                               | string                               | ''                                       | IG             |
| instaflow_url                                                                                                                                                                                  | string                               | ''                                       | IG             |
| instagram_app_id                                                                                                                                                                               | -                                    | ''                                       | IG             |
| instagram_config_id                                                                                                                                                                            | -                                    | ''                                       | IG             |
| instagram_enabled                                                                                                                                                                              | int(default)                         | false                                    | IG             |
| instagram_graph_version                                                                                                                                                                        | -                                    | 'v25.0'                                  | IG             |
| instagram_login_type                                                                                                                                                                           | -                                    | 'facebook'                               | IG             |
| envato_purchase_code                                                                                                                                                                           | string                               | ''                                       | INST           |
| envato_verified_at                                                                                                                                                                             | string                               | (none)                                   | INST           |
| google_calendar_client_id                                                                                                                                                                      | string                               | ''                                       | INTG           |
| google_calendar_client_secret                                                                                                                                                                  | string                               | ''                                       | INTG           |
| google_calendar_enabled                                                                                                                                                                        | bool                                 | false                                    | INTG           |
| google_calendar_redirect_uri                                                                                                                                                                   | string                               | (none)                                   | INTG           |
| google_calendar_scopes                                                                                                                                                                         | string                               | self::DEFAULT_SCOPES                     | INTG           |
| hubspot_client_id                                                                                                                                                                              | string                               | ''                                       | INTG           |
| hubspot_client_secret                                                                                                                                                                          | string                               | ''                                       | INTG           |
| hubspot_enabled                                                                                                                                                                                | bool                                 | false                                    | INTG           |
| hubspot_redirect_uri                                                                                                                                                                           | string                               | (none)                                   | INTG           |
| hubspot_scopes                                                                                                                                                                                 | string                               | \App\Services\Hubspot\HubspotService::DE | INTG           |
| slack_enabled                                                                                                                                                                                  | bool                                 | true                                     | INTG           |
| trello_enabled                                                                                                                                                                                 | bool                                 | true                                     | INTG           |
| line_enabled                                                                                                                                                                                   | bool                                 | false                                    | LINE           |
| meta_ads.ad_account_id                                                                                                                                                                         | string                               | ''                                       | MADS           |
| meta_ads.instagram_user_id                                                                                                                                                                     | -                                    | ''                                       | MADS           |
| meta_ads.page_id                                                                                                                                                                               | string                               | ''                                       | MADS           |
| meta_ads.phone                                                                                                                                                                                 | string                               | ''                                       | MADS           |
| meta_ads.phone_number_id                                                                                                                                                                       | string                               | ''                                       | MADS           |
| meta_ads.token                                                                                                                                                                                 | string                               | ''                                       | MADS           |
| meta_ads.waba_id                                                                                                                                                                               | string                               | ''                                       | MADS           |
| meta_ads_enabled                                                                                                                                                                               | bool                                 | false                                    | MADS           |
| meta_ads_graph_api_version                                                                                                                                                                     | string                               | 'v23.0'                                  | MADS           |
| email_enabled                                                                                                                                                                                  | bool                                 | false                                    | MAIL           |
| mailtrixy_brand                                                                                                                                                                                | string                               | ''                                       | MAIL           |
| mailtrixy_connected                                                                                                                                                                            | bool                                 | false                                    | MAIL           |
| mailtrixy_last_check                                                                                                                                                                           | string                               | ''                                       | MAIL           |
| mailtrixy_last_inbound                                                                                                                                                                         | string                               | (none)                                   | MAIL           |
| mailtrixy_secret                                                                                                                                                                               | string                               | ''                                       | MAIL           |
| mailtrixy_url                                                                                                                                                                                  | string                               | ''                                       | MAIL           |
| fcm_project_id                                                                                                                                                                                 | string                               | ''                                       | MOB            |
| fcm_service_account_json                                                                                                                                                                       | text                                 | ''                                       | MOB            |
| node_webhook_token                                                                                                                                                                             | string                               | ''                                       | NODE           |
| batches_gap                                                                                                                                                                                    | int                                  | 50                                       | NODE/SCHED     |
| bw_msg_gap                                                                                                                                                                                     | int                                  | 5                                        | NODE/SCHED     |
| enable_batches                                                                                                                                                                                 | bool                                 | false                                    | NODE/SCHED     |
| msg_gap                                                                                                                                                                                        | int                                  | 3                                        | NODE/SCHED     |
| baileys_callback_token                                                                                                                                                                         | -                                    | ''                                       | NODE/WADEV     |
| baileys_server_url                                                                                                                                                                             | string                               | ''; env('SERVER_URL', ''                 | NODE/WADEV     |
| payment.require_webhook_secret                                                                                                                                                                 | -                                    | true                                     | PAYGW          |
| pricing.recurring_enabled                                                                                                                                                                      | bool                                 | true                                     | PLAN/CHK       |
| pricing.refund_days                                                                                                                                                                            | int                                  | 7                                        | PLAN/CHK       |
| pricing.refund_enabled                                                                                                                                                                         | bool                                 | true                                     | PLAN/CHK       |
| pricing.yearly_discount_pct                                                                                                                                                                    | int                                  | 20                                       | PLAN/CHK       |
| pricing.yearly_toggle_enabled                                                                                                                                                                  | bool                                 | true                                     | PLAN/CHK       |
| sms_enabled                                                                                                                                                                                    | bool                                 | false                                    | SMS            |
| telegram_api_hash                                                                                                                                                                              | string                               | ''                                       | TG             |
| telegram_api_id                                                                                                                                                                                | string                               | ''                                       | TG             |
| telegram_enabled                                                                                                                                                                               | bool                                 | false                                    | TG             |
| waba_template_daily_cap                                                                                                                                                                        | -                                    | 0                                        | TPL            |
| waba_template_lint_strict                                                                                                                                                                      | bool                                 | true                                     | TPL            |
| waba_template_polling_min                                                                                                                                                                      | int                                  | 30                                       | TPL            |
| waba_template_quality_floor                                                                                                                                                                    | -                                    | 'YELLOW'                                 | TPL            |
| waba_templates_v2_enabled                                                                                                                                                                      | bool                                 | false                                    | TPL            |
| tiktok_business_app_id                                                                                                                                                                         | string                               | ''                                       | TT             |
| tiktok_business_app_secret                                                                                                                                                                     | string                               | ''                                       | TT             |
| tiktok_client_key                                                                                                                                                                              | string                               | ''                                       | TT             |
| tiktok_client_secret                                                                                                                                                                           | string                               | ''                                       | TT             |
| tiktok_enabled                                                                                                                                                                                 | bool                                 | false                                    | TT             |
| tiktok_inbox_enabled                                                                                                                                                                           | bool                                 | false                                    | TT             |
| tiktok_redirect_uri                                                                                                                                                                            | string                               | ''                                       | TT             |
| tiktok_shop_app_key                                                                                                                                                                            | string                               | ''                                       | TT             |
| tiktok_shop_app_secret                                                                                                                                                                         | string                               | ''                                       | TT             |
| tiktok_shop_enabled                                                                                                                                                                            | bool                                 | false                                    | TT             |
| viber_enabled                                                                                                                                                                                  | bool                                 | false                                    | VIB            |
| waba_app_id                                                                                                                                                                                    | string                               | ''                                       | WABA           |
| waba_app_secret                                                                                                                                                                                | string                               | ''                                       | WABA           |
| waba_coexistence                                                                                                                                                                               | bool                                 | false                                    | WABA           |
| waba_config_id                                                                                                                                                                                 | string                               | ''                                       | WABA           |
| waba_dispatch_v2_enabled                                                                                                                                                                       | bool                                 | false                                    | WABA           |
| waba_graph_api_version                                                                                                                                                                         | string                               | ''; 'v23.0'; self::DEFAULT_VERSION       | WABA           |
| waba_graph_version                                                                                                                                                                             | -                                    | 'v23.0'                                  | WABA           |
| waba_verify_by_ownership                                                                                                                                                                       | -                                    | true                                     | WABA           |
| waba_webhook_verify_token                                                                                                                                                                      | string                               | ''                                       | WABA           |
| message_facebook_id                                                                                                                                                                            | -                                    | ''                                       | WABA/WADEV     |
| message_facebook_token                                                                                                                                                                         | -                                    | ''                                       | WABA/WADEV     |
| message_twilio_enabled                                                                                                                                                                         | bool                                 | false                                    | WABA/WADEV     |
| message_twilio_sender                                                                                                                                                                          | -                                    | ''                                       | WABA/WADEV     |
| message_twilio_sid                                                                                                                                                                             | -                                    | ''                                       | WABA/WADEV     |
| message_twilio_token                                                                                                                                                                           | -                                    | ''                                       | WABA/WADEV     |
| message_twilio_webhook                                                                                                                                                                         | -                                    | url('/webhooks/twilio'                   | WABA/WADEV     |
| message_whatsapp_api_version                                                                                                                                                                   | -                                    | 'v23.0'                                  | WABA/WADEV     |
| message_whatsapp_business_id                                                                                                                                                                   | -                                    | ''                                       | WABA/WADEV     |
| message_whatsapp_enabled                                                                                                                                                                       | bool                                 | false                                    | WABA/WADEV     |
| twilio_account_sid                                                                                                                                                                             | string                               | ''; env('TWILIO_ACCOUNT_SID', ''         | WABA/WADEV/SMS |
| twilio_auth_token                                                                                                                                                                              | string                               | ''; env('TWILIO_AUTH_TOKEN', ''          | WABA/WADEV/SMS |
| twilio_whatsapp_number                                                                                                                                                                         | string                               | ''; env('TWILIO_WHATSAPP_NUMBER', ''     | WABA/WADEV/SMS |
| active_engine_slug                                                                                                                                                                             | string                               | (none)                                   | WADEV/WABA     |
| allowed_send_methods                                                                                                                                                                           | json                                 | ['baileys', 'waba', 'twilio']; ['baileys | WADEV/WABA     |
| default_send_method                                                                                                                                                                            | string                               | ''; 'baileys'; self::ENGINE_BAILEYS      | WADEV/WABA     |
| credits_per_currency_minor                                                                                                                                                                     | float                                | 0.1                                      | WALLET         |
| credits_per_message                                                                                                                                                                            | int                                  | 1                                        | WALLET         |
| per_country_credits_enabled                                                                                                                                                                    | int(default)                         | '0'                                      | WALLET         |
| wallet_billing_on_delivery                                                                                                                                                                     | -                                    | '1'                                      | WALLET         |
| wallet_low_balance_threshold                                                                                                                                                                   | -                                    | 20                                       | WALLET         |
| wechat_enabled                                                                                                                                                                                 | bool                                 | false                                    | WECH           |
| wa_link_tracking_ttl_days                                                                                                                                                                      | -                                    | 90                                       | WFL            |
| waba_link_tracking_enabled                                                                                                                                                                     | -                                    | true                                     | WFL            |
| social_google_enabled, social_google_client_id, social_google_client_secret, social_facebook_enabled, social_facebook_client_id, social_facebook_client_secret (dynamic `social_{provider}_*`) | bool / Str / Str (secrets encrypted) | false / '' / ''                          | AUTH           |
| admin.notif_seen.<userId> (dynamic)                                                                                                                                                            | Str (ISO time)                       | -                                        | NOTIF          |

## Cross-domain contracts

Consumes:

- AUTH: `EnsureUserIsAdmin`/role checks and `User::isAdmin()`; `IPAllowlist` and the `security.*` keys; social-login and captcha settings live on a sibling settings page and are summarised on the hub card; register/login/forgot Blade views and controllers that read signup policy (WD-SET-007) and auth-page content (WD-SET-018).
- NOTIF: `Audit::log`, `AuditLogger::platform` and the `audit_logs` table for settings audit rows and the hub "Needs test"/"Last updated by" KPIs; `WebPushService`, `TeamInboxPushNotifier`, `push_subscriptions`, `fcm_*` keys.
- PLAN / CPN: `packages` (default signup plan picker, Premium dashboard), `Package::isFreePlan`, `chargeableAmount`, `PlanLimitGuard::hasFeature('remove_branding')`; `currencies` table and admin (rates cache flush); `orders`.
- WSP: `workspaces.plan`, `timezone`, `currency`, `branding_footer`, `brand_color`; `Workspace::billingPackage()` consumes `billing_plan_scope`.
- I18N: `languages` table, the Languages admin (sets `default_language`, flushes the locale cache), `SetLocale` middleware.
- CMS: blog posts/categories (sitemap), the public layouts and footer components, `FrontendContentStore::editing()` (edit mode gate), Frontend editor for page copy, Contact inbox.
- ASHELL: admin layout, sidebar, `x-admin.flash`, decorative header search; user layouts (`layouts/user`, `guest`, `frontend`) that include the partials defined here.
- CORE: `AppServiceProvider::boot` (calls `MailConfig::apply`, `RealtimeSettings::applyToConfig`, registers the `pusher-http` driver, public-storage wiring), framework routes `storage/{path}` (GET/PUT), `up`, `csrf-token`, `broadcasting/auth` conventions.

Exposes:

- Service `SystemSetting::get/set` (typed cached KV) to every domain (WD-SET-001); the list of `ENCRYPTED_KEYS` is a contract other domains extend when they add secrets.
- Helpers: `Brand::{name,logoUrl,faviconUrl,billing,invoiceLogoUrl,activeTheme,webhookHeaderPrefix}`, `brand_name()`, `brand_token()`, `brand_email()`, `site_info()`, `legal_url()`, `theme_css()`, `theme_color()`, `app_default_country()`, `app_font()`, `auth_cfg()`, `wa_tz()`, `wa_local()`, `safe_timezone()` (WD-SET-005..017, 022, 030, 046).
- `BrandingFooterService::resolve/appendToBody/flushCache` to the messaging pipeline (CHAT, TIB1, BCAST, CAMP, FLR, SCHED, WABA) and the Node bridge (NODE) (WD-SET-012).
- `CloudStorageManager` and the helpers `media_disk()`, `media_storage()`, `media_url()` to every module that stores or serves files: CHAT, TIB1, TCHAT, TPL, BCAST, CAMP, AR, FLB, WGT, CAT, CHK, INV, CMS, channel domains (WD-SET-040).
- `RealtimeSettings::{enabled,publicConfig,raw,applyToConfig}` and the `pusher-http` broadcaster to TIB1/TIB2/TCHAT/WADEV/MOB (WD-SET-042); `routes/channels.php` authorisation.
- `MailConfig::apply` to all mail-sending domains (AUTH, INV, SUPP, WSP invites, NOTIF security alerts) (WD-SET-024).
- `Seo::meta`, sitemap and `robots.txt` to CMS/public site (WD-SET-027, 028).
- `FormatSettings` (currency display/convert) and `LocaleSettings` to every price and page render (WD-SET-044, 045).
- Maintenance middleware (WD-SET-008) which all machine-to-machine webhook domains rely on staying reachable.
- Tables: `system_settings` (all domains).
- Files served locally: brand assets (`storage/brand`), PWA icons (`storage/pwa`), auth media (`public/uploads/auth`).

Shared claims (the same routes/files are also listed by other inventory files; behavior here is authoritative for the settings semantics, the other domain owns the surrounding UI or flow; reconcile to one tracker owner):

- ASHELL also lists the settings hub (`GET admin/settings`, WD-ASHELL-008), menu layout editor (WD-ASHELL-009), Appearance colours (WD-ASHELL-010), personal theme preference (`POST settings/appearance`, WD-ASHELL-046), `Brand`, `UserNav`, `fc_helpers`, the appearance view/script and the app-font partial. Suggested split: ASHELL owns the screens and routes; SET owns storage keys, `theme_css`, `Brand`, `UserNav` layout resolution.
- AUTH also lists the Auth pages editor and its inline endpoints (WD-AUTH-021/022) and `x-auth-shell`. Suggested home: AUTH for the routes and templates; SET keeps the `auth.*` settings contract.
- CMS also lists `sitemap.xml`, `robots.txt`, the sitemap download (WD-CMS-014/015/051), the SEO meta block (WD-CMS-016), `Seo` and `SitemapController`. Suggested home: CMS for public output, SET for the SEO settings form (WD-SET-026).
- NOTIF also lists Web Push and VAPID key generation (WD-NOTIF-018), the Team Inbox PWA subscribe endpoints, `team-inbox-manifest.json` and `POST admin/settings/pwa/generate-keys`. Suggested home: NOTIF for push delivery and keys; SET for the PWA settings screen (WD-SET-035/038).
- RBAC also lists the `settings.*` and `platform.system.settings` permission keys (seeded but unenforced on these routes).
- CPN (`FormatSettings`, currency admin) and I18N (`LocaleSettings`, `SetLocale`) list the helpers used by WD-SET-044/045; DASH lists `AdminPagesController` and `theme-colors.js`.

## Open questions & quirks

Sibling settings pages owned by other domains (handled by the same catch-all controller `AdminPagesController`, routed under `admin/settings/*`, NOT specified here; owners must claim them): `admin/settings/affiliate` (CPN), `admin/settings/providers`, `admin/settings/channel-setting/{section?}`, `.../pacing`, `.../node`, `.../node/test`, `.../otp-template`, `.../check-webhooks`, `.../subscribe-webhooks` (WABA/WADEV/NODE/AUTH), `admin/settings/message` (message providers), `admin/settings/wallet-rules`, `admin/settings/message-rates`, `.../message-rates/import`, `.../message-rates/sync-meta` (WALLET/BSP), `admin/settings/integration`, `.../shopify`, `.../woocommerce` (ECOM), `.../hubspot`, `.../slack`, `.../trello`, `.../google-calendar` (INTG), `admin/settings/social-login` (AUTH), `admin/settings/mobile-push` (MOB/NOTIF), `admin/settings/catalog` (CAT). Their views (`resources/views/admin/settings/{channel-setting,message,wallet-rules,integration,shopify,woocommerce,hubspot,slack,trello,google-calendar,social-login,mobile-push,catalog}.blade.php`) and scripts (`admin-settings-hubspot.js`, `admin-settings-shopify.js`, `settings-wadesk-message.js`, `user-settings-index.js`) are intentionally not in this coverage. The hub tile and the KPI logic that mention them ARE covered (WD-SET-003). The hub also links to pages of other domains (`/admin/payment-gateways`, `/admin/currencies`, `/admin/api-keys`, `/admin/audit-log`, `/admin/languages`, `/admin/legal-pages`, `/admin/checkout-settings`, add-ons and the updater). Shared-with-other-domain routes NOT claimed here: `GET|POST broadcasting/auth` is claimed (WD-SET-042); `storage/{path}` GET/PUT (framework local-disk route), `csrf-token`, `up`, `docs/api.json` and `team-inbox/api/push/*` are left to CORE/TIB/NOTIF.

Quirks and suspected bugs (each also noted in its feature):

1. Dead or unenforced settings: `public_registration` (WD-SET-007), `preloader` (009), `contact_number`, `address`, `map_iframe_url`, mostly `app_url` and `support_email` (005), GDPR/CCPA/ADA switches (031), PWA install prompt, offline toggle and splash (037).
2. Secret handling inconsistencies: two encryption schemes (`ENCRYPTED_KEYS` via `Crypt::encrypt` vs manual `Crypt::encryptString` for `mail_password`, `pusher_app_secret`, `catalog_meta_app_secret`, cloud storage); export redaction by key suffix leaks some secrets (WD-SET-001, 004).
3. Type drift: General/PWA/privacy booleans are stored as type `string` `'0'/'1'`, `realtime_enabled` as `int`, `auto_verify_email` seeded as `int` (WD-SET-001, 005). Cache keyed only by `key` (default masking).
4. SEO: `??` chains with blank-saved values suppress fallbacks (og title, canonical); the meta-title setting rarely surfaces; robots.txt ignores `seo_robots`; sitemap docs mention the wrong screen (WD-SET-027, 028).
5. Analytics: UI/docs say consent-gated but GA4/GTM analytics storage is granted for all; `site-analytics-noscript` partial referenced but missing (WD-SET-033).
6. Mail: `mail_encryption` writes a config key Laravel 12 does not read; API-key mailers have no credential fields; queue workers keep stale mail config (WD-SET-024).
7. Cloud storage: `base_path` unused for real uploads; "Private (signed URLs)" has no signing; blank non-secret fields cannot be cleared; test always persists config; no audit (WD-SET-039, 040).
8. Realtime: the Pusher probe needs the SDK while runtime does not; three broadcast channels lack authorisation callbacks; `[RT-TRACE]` logs full payloads; broadcasts are synchronous (WD-SET-041, 042).
9. Premium dashboard joins `workspaces.plan` (slug) to `packages.id` (WD-SET-043); MRR ignores intervals and currencies; label "Trial -> paid" is not a true trial conversion.
10. Docs vs code mismatches: docs place Appearance at `/admin/appearance` (real path `/admin/settings/appearance`); docs say auto-verify default Off (code On) and preloader/public-registration work; docs list "Backblaze / Bunny" (only Bunny.net exists) and "Contacts photos" in cloud media (contacts avatars are not confirmed); docs say WhatsApp engine is a single choice (code supports a multi-engine set, out of scope here); docs say Terms/Privacy links on auth pages are edited in the Frontend editor (code reads the Privacy settings); the decorative "Search project settings" and CMD-K box on the hub and Premium page do nothing.
11. Hub "Last updated by" ignores `admin.*` audit actions (WD-SET-003). The hub's hidden "Sending providers" block is inert legacy markup and should not be ported.
12. `PWA` icon URLs stored as absolute URLs with the host at upload time (WD-SET-035).
13. Settings files uploaded under `storage/brand`, `storage/pwa` and `public/uploads/auth` are never garbage-collected when replaced.
14. Unanswered: which timezone the Premium windows use (server default), whether `platform.system.settings` was meant to gate these pages, and whether the `ti_pwa_theme_color`/`ti_pwa_description` keys were meant to have UI. Whether an "ADA" toolbar or "Do not sell" link exists anywhere else could not be confirmed in code.
15. `SetLocale`, the Languages admin, currency admin, updater, extensions, checkout settings and audit-log pages are linked from the hub but out of this domain (I18N, CPN, INST, ADD, CHK, NOTIF).
16. Verify with a live run: blank-field behaviour on the storage form (null filtering), analytics output with no consent cookie, and PWA manifest when disabled (`wadesk-verify-parity`).

## Coverage

```json wadesk-coverage
{
  "routes": [
    "GET admin/settings",
    "GET admin/settings/export",
    "GET admin/settings/general",
    "PATCH admin/settings/general",
    "GET admin/settings/appearance",
    "POST admin/settings/appearance",
    "POST admin/settings/appearance/reset",
    "POST settings/appearance",
    "GET admin/settings/menu-order",
    "POST admin/settings/menu-order",
    "GET admin/settings/auth-pages",
    "POST admin/settings/auth-pages",
    "POST admin/settings/auth-pages/inline",
    "POST admin/settings/auth-pages/inline-media",
    "POST admin/settings/auth-pages/inline-media-clear",
    "GET admin/settings/auth-pages/preview/{page}",
    "POST admin/settings/auth-pages/variant",
    "GET admin/site-settings",
    "POST admin/site-settings",
    "GET admin/settings/footer",
    "POST admin/settings/footer",
    "GET admin/settings/mail",
    "PATCH admin/settings/mail",
    "POST admin/settings/mail/test",
    "GET admin/settings/seo",
    "PATCH admin/settings/seo",
    "GET admin/settings/seo/sitemap/download",
    "GET sitemap.xml",
    "GET robots.txt",
    "GET admin/settings/privacy",
    "PATCH admin/settings/privacy",
    "GET admin/settings/analytics",
    "PATCH admin/settings/analytics",
    "GET admin/settings/custom",
    "POST admin/settings/custom",
    "GET admin/settings/pwa",
    "PATCH admin/settings/pwa",
    "POST admin/settings/pwa/generate-keys",
    "GET manifest.json",
    "GET team-inbox-manifest.json",
    "GET admin/storage",
    "POST admin/storage",
    "POST admin/storage/test",
    "GET admin/settings/realtime",
    "POST admin/settings/realtime",
    "POST admin/settings/realtime/test",
    "GET broadcasting/auth",
    "POST broadcasting/auth",
    "GET admin/premium"
  ],
  "controllers": [
    "app/Http/Controllers/Admin/SiteSettingsController.php",
    "app/Http/Controllers/Admin/AppearanceController.php",
    "app/Http/Controllers/Admin/StorageSettingsController.php",
    "app/Http/Controllers/Admin/RealtimeSettingsController.php",
    "app/Http/Controllers/Admin/PremiumController.php",
    "app/Http/Controllers/SitemapController.php",
    "app/Http/Controllers/AdminPagesController.php"
  ],
  "services": [
    "app/Services/CloudStorageManager.php",
    "app/Services/BrandingFooterService.php",
    "app/Support/Brand.php",
    "app/Support/FormatSettings.php",
    "app/Support/MailConfig.php",
    "app/Support/RealtimeSettings.php",
    "app/Support/Seo.php",
    "app/Support/LocaleSettings.php",
    "app/Support/UserNav.php",
    "app/Support/fc_helpers.php"
  ],
  "models": ["SystemSetting"],
  "tables": ["system_settings"],
  "views": [
    "resources/views/admin/settings/index.blade.php",
    "resources/views/admin/settings/general.blade.php",
    "resources/views/admin/settings/mail.blade.php",
    "resources/views/admin/settings/seo.blade.php",
    "resources/views/admin/settings/privacy.blade.php",
    "resources/views/admin/settings/custom.blade.php",
    "resources/views/admin/settings/footer.blade.php",
    "resources/views/admin/settings/analytics.blade.php",
    "resources/views/admin/settings/appearance.blade.php",
    "resources/views/admin/settings/auth-pages.blade.php",
    "resources/views/admin/settings/pwa.blade.php",
    "resources/views/admin/settings/menu-order.blade.php",
    "resources/views/admin/settings/_menu_chip.blade.php",
    "resources/views/admin/site-settings/index.blade.php",
    "resources/views/admin/storage/index.blade.php",
    "resources/views/admin/realtime/index.blade.php",
    "resources/views/admin/premium/index.blade.php",
    "resources/views/partials/app-font.blade.php",
    "resources/views/partials/cookie-consent.blade.php",
    "resources/views/partials/pwa-meta.blade.php",
    "resources/views/partials/seo-meta.blade.php",
    "resources/views/partials/site-analytics.blade.php",
    "resources/views/partials/teaminbox-pwa.blade.php",
    "resources/views/components/auth-shell.blade.php"
  ],
  "commands": [],
  "permissions": [
    "platform.system.settings",
    "settings.view",
    "settings.create",
    "settings.edit",
    "settings.delete"
  ],
  "middleware": ["app/Http/Middleware/Maintenance.php"],
  "node_files": [],
  "js_assets": [
    "resources/js/charts/admin-premium.js",
    "resources/js/charts/admin-settings-appearance.js",
    "resources/js/charts/admin-settings-general.js",
    "resources/js/charts/admin-settings-seo.js",
    "resources/js/cookie-consent.js",
    "resources/js/echo.js",
    "resources/js/lib/tz-picker.js",
    "resources/js/theme-colors.js"
  ],
  "misc_files": ["app/Broadcasting/PusherHttpBroadcaster.php"],
  "config_files": [
    "config/filesystems.php",
    "config/broadcasting.php",
    "config/mail.php",
    "config/countries.php"
  ],
  "doc_pages": [
    "Documentation/pages/admin-panel/system-settings.html",
    "Documentation/pages/admin-panel/appearance.html",
    "Documentation/pages/admin-panel/cloud-storage.html",
    "Documentation/pages/admin-panel/auth-pages.html"
  ],
  "feature_map": {
    "WD-SET-001": [],
    "WD-SET-002": [],
    "WD-SET-003": ["GET admin/settings"],
    "WD-SET-004": ["GET admin/settings/export"],
    "WD-SET-005": ["GET admin/settings/general", "PATCH admin/settings/general"],
    "WD-SET-006": [],
    "WD-SET-007": [],
    "WD-SET-008": [],
    "WD-SET-009": [],
    "WD-SET-010": [],
    "WD-SET-011": [],
    "WD-SET-012": [],
    "WD-SET-013": [
      "GET admin/settings/appearance",
      "POST admin/settings/appearance",
      "POST admin/settings/appearance/reset"
    ],
    "WD-SET-014": [],
    "WD-SET-015": [],
    "WD-SET-016": ["GET admin/settings/menu-order", "POST admin/settings/menu-order"],
    "WD-SET-017": ["POST settings/appearance"],
    "WD-SET-018": [
      "GET admin/settings/auth-pages",
      "GET admin/settings/auth-pages/preview/{page}",
      "POST admin/settings/auth-pages/variant"
    ],
    "WD-SET-019": ["POST admin/settings/auth-pages/inline"],
    "WD-SET-020": [
      "POST admin/settings/auth-pages/inline-media",
      "POST admin/settings/auth-pages/inline-media-clear"
    ],
    "WD-SET-021": ["POST admin/settings/auth-pages"],
    "WD-SET-022": ["GET admin/site-settings", "POST admin/site-settings"],
    "WD-SET-023": ["GET admin/settings/footer", "POST admin/settings/footer"],
    "WD-SET-024": ["GET admin/settings/mail", "PATCH admin/settings/mail"],
    "WD-SET-025": ["POST admin/settings/mail/test"],
    "WD-SET-026": ["GET admin/settings/seo", "PATCH admin/settings/seo"],
    "WD-SET-027": [],
    "WD-SET-028": ["GET admin/settings/seo/sitemap/download", "GET sitemap.xml", "GET robots.txt"],
    "WD-SET-029": ["GET admin/settings/privacy", "PATCH admin/settings/privacy"],
    "WD-SET-030": [],
    "WD-SET-031": [],
    "WD-SET-032": ["GET admin/settings/analytics", "PATCH admin/settings/analytics"],
    "WD-SET-033": [],
    "WD-SET-034": ["GET admin/settings/custom", "POST admin/settings/custom"],
    "WD-SET-035": ["GET admin/settings/pwa", "PATCH admin/settings/pwa"],
    "WD-SET-036": ["GET manifest.json"],
    "WD-SET-037": [],
    "WD-SET-038": ["POST admin/settings/pwa/generate-keys", "GET team-inbox-manifest.json"],
    "WD-SET-039": ["GET admin/storage", "POST admin/storage", "POST admin/storage/test"],
    "WD-SET-040": [],
    "WD-SET-041": [
      "GET admin/settings/realtime",
      "POST admin/settings/realtime",
      "POST admin/settings/realtime/test"
    ],
    "WD-SET-042": ["GET broadcasting/auth", "POST broadcasting/auth"],
    "WD-SET-043": ["GET admin/premium"],
    "WD-SET-044": [],
    "WD-SET-045": [],
    "WD-SET-046": []
  }
}
```
