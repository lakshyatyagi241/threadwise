---
domain: localization-translation
code: I18N
title: Localization, Languages and Auto-Translation
wadesk_version: '1.7.0'
sources_read: 78
---

# Localization, Languages and Auto-Translation

## Overview

This domain covers two related but technically separate capabilities.

**A. UI localization (interface language).** The platform ships a fixed catalog of UI languages (the marketing copy and docs say "20-language pack"; the seeded table and the `lang/` directory in fact hold **21**: en, es, hi, ar, pt, ru, ja, de, fr, it, ko, zh-CN, tr, id, vi, th, pl, nl, ur, he, bn). Every UI string is written in English in Blade/PHP via the `__()` helper (the English sentence itself is the translation key) and each language has one flat JSON catalog `lang/<code>.json`. A `languages` table is the registry that decides which of those catalogs are _offered_ (active flag, sort order, native name, ltr/rtl direction). A super-admin manages that registry at `/admin/languages` (toggle, set platform default, delete, edit metadata via an un-surfaced PATCH endpoint; adding languages is deliberately locked). The interface locale of every web request is resolved by the `SetLocale` middleware from a five-step chain (user preference, session pick, workspace default, platform default, `app.locale`/`en`). End-users and visitors change language with a header dropdown that POSTs to `/locale`. RTL languages (ar, ur, he) flip `<html dir>`.

**B. Auto-translation of customer content.** A pluggable translation engine translates _message content_ (not UI) between the customer's language and the team's language. It is a layered service: offline common-phrase dictionary, then a 24h cache, then a fallback chain of provider drivers (MyMemory, Google GTX, LibreTranslate, DeepL, Google Cloud). A super-admin configures providers at `/admin/translation-providers` (encrypted credentials, default, sort order, activate/deactivate, and a compliance lockdown that removes unofficial/free providers) and watches volume and estimated cost at `/admin/translation-usage`. Consumers of the engine are: multilingual auto-reply (keyword fan-out, lazy translation, detected-language logging), the team-inbox "real-time conversation translation" (inbound translated for the agent, outbound translated for the customer), the AI agent and website chat widget (reply natively in the customer's language), and (in a separate, non-conforming way) the WhatsApp ordering flow. Workspace owners on a plan with the `access_translation` feature (Pro and Enterprise in the seed) turn conversation translation on/off and pick their team language on the Account page (`/account`, Translation tab). A per-workspace `data_residency` setting (any / eu_only / local, owned by workspaces/settings but enforced here) further restricts which providers a workspace's traffic may use.

Actors: super-admin (registry, providers, lockdown, usage), workspace owner/agent (team language, translation toggle, header language switcher), end-customer (has language detected and pinned; receives translated replies), and unauthenticated visitors (marketing site / login pages use the same switcher and session locale).

Plan tiers: only the `access_translation` package flag changes behavior (gates the Account translation tab, its POST endpoint, and the inbox/AI/widget translation config). Auto-reply keyword translation and the offline dictionary are not plan-gated in code. `access_data_residency` (Enterprise) gates the residency picker on the settings page (owned by workspaces).

Connections to other domains: SET (platform default language value lives in `system_settings.default_language` and is edited on the General settings page; admin currency page is a sibling), AR (`KeywordReply.keyword_translations`, `canonical_language`, lookup order), TIB1 (message columns, observer, dispatcher hook, payload gating), AIAG/WGT (native-language reply prompt hint), WSP (workspace columns `default_language`, `auto_translate_languages`, `data_residency`, `inbox_translate`), PLAN (plan feature flag), NOTIF (audit log entries, `Audit::log`), CHK (ordering flow uses a private Google gtx call), CMS/frontend (switcher in the marketing nav), CORE (`DemoMode` blocks these admin routes for demo installs; installer sets initial `APP_LOCALE`).

## Feature index

| Id          | Feature                                                    | Status      | Priority | Effort | Depends on               |
| ----------- | ---------------------------------------------------------- | ----------- | -------- | ------ | ------------------------ |
| WD-I18N-001 | Admin languages catalog page                               | implemented | P1       | M      | WD-I18N-007              |
| WD-I18N-002 | Edit language metadata (PATCH, no UI)                      | partial     | P2       | S      | WD-I18N-001              |
| WD-I18N-003 | Toggle language active/inactive                            | implemented | P1       | S      | WD-I18N-001              |
| WD-I18N-004 | Set platform default language                              | implemented | P0       | S      | WD-I18N-003              |
| WD-I18N-005 | Delete language                                            | implemented | P2       | S      | WD-I18N-004              |
| WD-I18N-006 | Add-language lock (POST is a stub)                         | dead-code   | P2       | S      | WD-I18N-001              |
| WD-I18N-007 | Seeded language pack and registry data                     | implemented | P0       | S      | -                        |
| WD-I18N-008 | Per-request locale resolution (SetLocale + LocaleSettings) | implemented | P0       | M      | WD-I18N-007              |
| WD-I18N-009 | Language switch endpoint (POST /locale)                    | implemented | P0       | S      | WD-I18N-008              |
| WD-I18N-010 | Header language switcher component                         | implemented | P0       | M      | WD-I18N-009              |
| WD-I18N-011 | RTL text direction                                         | implemented | P1       | S      | WD-I18N-008              |
| WD-I18N-012 | UI string catalogs (lang/*.json) and fallback chain        | implemented | P0       | L      | -                        |
| WD-I18N-013 | String extraction tooling (translatable:export / inspect)  | implemented | P2       | S      | WD-I18N-012              |
| WD-I18N-014 | Translation providers admin page and seed                  | implemented | P0       | M      | -                        |
| WD-I18N-015 | Save provider credentials and sort order                   | implemented | P0       | M      | WD-I18N-014              |
| WD-I18N-016 | Activate / deactivate provider (credential guard)          | implemented | P0       | S      | WD-I18N-015              |
| WD-I18N-017 | Make provider the default                                  | implemented | P1       | S      | WD-I18N-016              |
| WD-I18N-018 | Compliance lockdown (official providers only)              | implemented | P1       | M      | WD-I18N-016              |
| WD-I18N-019 | Provider fallback chain resolution                         | implemented | P0       | M      | WD-I18N-014              |
| WD-I18N-020 | Per-workspace data-residency provider filter               | implemented | P1       | S      | WD-I18N-019              |
| WD-I18N-021 | Translator: layered translate (dictionary, cache, chain)   | implemented | P0       | M      | WD-I18N-019, WD-I18N-023 |
| WD-I18N-022 | Translator: detect-and-translate and detect                | implemented | P0       | M      | WD-I18N-021, WD-I18N-031 |
| WD-I18N-023 | Common-phrases offline dictionary                          | implemented | P1       | S      | -                        |
| WD-I18N-024 | MyMemory driver with circuit breaker                       | implemented | P0       | M      | WD-I18N-019              |
| WD-I18N-025 | Google GTX (unofficial) driver                             | implemented | P1       | S      | WD-I18N-019              |
| WD-I18N-026 | LibreTranslate driver                                      | implemented | P1       | S      | WD-I18N-019              |
| WD-I18N-027 | DeepL driver                                               | implemented | P1       | S      | WD-I18N-019              |
| WD-I18N-028 | Google Cloud Translation driver                            | implemented | P1       | S      | WD-I18N-019              |
| WD-I18N-029 | Translation usage ledger and cost estimation               | implemented | P1       | S      | WD-I18N-021              |
| WD-I18N-030 | Admin translation usage dashboard                          | implemented | P1       | M      | WD-I18N-029              |
| WD-I18N-031 | Script-based language detector                             | implemented | P0       | S      | -                        |
| WD-I18N-032 | Keyword fan-out translation manager                        | partial     | P1       | M      | WD-I18N-021              |
| WD-I18N-033 | Backfill command auto-reply:translate-existing             | implemented | P2       | S      | WD-I18N-032              |
| WD-I18N-034 | Multilingual auto-reply matching and reply pick            | implemented | P1       | M      | WD-I18N-032, WD-I18N-022 |
| WD-I18N-035 | Workspace translation settings (Account tab)               | implemented | P0       | M      | WD-I18N-008              |
| WD-I18N-036 | Inbound message auto-translate and language pinning        | implemented | P0       | M      | WD-I18N-022, WD-I18N-035 |
| WD-I18N-037 | Outbound reply auto-translate                              | implemented | P0       | M      | WD-I18N-036              |
| WD-I18N-038 | Inbox thread translation display gating                    | implemented | P1       | S      | WD-I18N-036              |
| WD-I18N-039 | AI agent and chat widget native-language replies           | implemented | P1       | S      | WD-I18N-022, WD-I18N-035 |

## Features

### WD-I18N-001 — Admin languages catalog page

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-I18N-007
- **Summary:** Super-admin screen listing every row of the platform language registry with three headline stats (total, active, default code) and per-row controls to switch a language on/off, make it the platform default, or delete it. It is the only management UI for the registry.
- **Actors & access:** Platform admins only. Middleware chain `Authenticate`, `EnsureUserIsAdmin`, `IPAllowlist` (admin route group, `routes/admin.php`, prefix `admin`, name prefix `admin.`). No permission key and no plan gate. Platform scope (no workspace). Blocked for POST/PUT/PATCH/DELETE on demo installs by `DemoMode` (`admin/languages*` is on its block list).
- **UX & screens:** `resources/views/admin/languages/index.blade.php` in the admin layout (`admin-key=languages`). Header breadcrumb "Admin > Languages". Title "Platform languages" plus a one-paragraph explanation that active languages are what new users and workspaces can pick and that the default is the fallback for new accounts. Success and error flash banners from session (`success`, `error`). Three stat cards: Total ("configured"), Active ("visible to users"), Default (code in uppercase, "fallback for new accounts"). Main card "All languages" with a table (min width 760px, horizontally scrollable): `#` (sort_order value), Name (bold English name plus native name underneath when set), Code (mono), Dir (LTR/RTL uppercase), Active (a pill button reading On or Off that submits the toggle form), Default (either a solid "Default" badge on the current default row or a "Set" button), and a Delete link (hidden on the default row) that asks a JS confirm "Remove <name>?" via `data-confirm`. Empty state row says there are no languages and points to an "Add one on the right" form that no longer exists (stale copy, see quirks). A right-hand sticky aside has two static info cards: "Language pack: Fixed at 20 languages" (explains each language needs a shipped JSON file and that toggling, editing native name/direction and picking default remain possible) and "How this is used" (active languages appear in the user profile language switcher and in template/auto-reply pickers; default applies to brand-new accounts). There is NO edit form and NO add form on the page.
- **Endpoints:**

| Endpoint            | Route name            | Controller@action               | Middleware                                   | Request | Response                                           |
| ------------------- | --------------------- | ------------------------------- | -------------------------------------------- | ------- | -------------------------------------------------- |
| GET admin/languages | admin.languages.index | Admin\LanguagesController@index | Authenticate, EnsureUserIsAdmin, IPAllowlist | none    | HTML view with `languages`, `stats`, `defaultCode` |

- **Data:** Reads `languages` ordered by `sort_order` asc then `name` asc (no pagination, all rows). Reads `system_settings.default_language` (falls back to `config('app.locale')` then `en`). Stats: total = row count, active = rows with `is_active=1`, default = the setting string (not validated against the table).
- **Rules & edge cases:**
  1. No pagination or search; the catalog is expected to stay at about 21 rows.
  2. The "default" stat and badge compare by `code` string, so if the setting holds a code that is not in the table (or is inactive) no row shows the badge and every row shows a "Set" button and a Delete link.
  3. The default row hides Delete; all other rows show it even if active.
  4. The `admin-languages-index` page key in `resources/js/app.js` is wired to the packages-index chart module (copy-paste leftover; page needs no JS beyond the shared confirm handler).
  5. Text on the page still refers to a 20-language pack although 21 rows are seeded.
- **Async & events:** None. No websocket or queue involvement.
- **External systems:** None.
- **Settings:** `system_settings.default_language` (string, read only here); `config('app.locale')` fallback (env `APP_LOCALE`, default `en`).
- **Acceptance criteria:**
  - Given a super-admin, when they open `/admin/languages`, then the page lists all registry rows ordered by sort_order then name and the stat cards show total, active count and the default code.
  - Given the default is `en`, when the page renders, then the English row shows a "Default" badge with no Delete link and every other row shows a "Set" button and a Delete link.
  - Given a non-admin or an IP outside the allowlist, when they request the URL, then access is denied by middleware.
  - Given DemoMode is on, when an admin submits any mutating form from this page, then the request is rejected by DemoMode.
- **Source refs:** `app/Http/Controllers/Admin/LanguagesController.php`, `app/Models/Language.php`, `resources/views/admin/languages/index.blade.php`, `routes/admin.php`, `app/Http/Middleware/DemoMode.php`, `resources/js/app.js`, `Documentation/pages/admin-panel/localization.html`.
- **Port notes:** Suggested home `apps/api/src/modules/i18n/languages.controller.ts` (platform-admin guard) and `apps/web/.../admin/languages/page.tsx`. `languages` is a global (non-tenant) table, so it needs no RLS. Show the real count instead of the hard-coded "20". Add the missing edit UI (see WD-I18N-002).

### WD-I18N-002 — Edit language metadata (PATCH, no UI)

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-I18N-001
- **Summary:** An endpoint that lets an admin change a language's English name, native name, text direction, active flag and sort order. The route works but no screen in v1.7.0 renders a form for it, although the documentation says admins can edit direction on the row.
- **Actors & access:** Platform admin (same middleware as WD-I18N-001). No permission key. Audit-logged.
- **UX & screens:** No screen. Documentation (`admin-panel/localization.html`) says "edit native name, direction, sort order" is available and that RTL is set on the row; the Blade view has no inline editor, so today this is only reachable by a hand-crafted request.
- **Endpoints:**

| Endpoint                   | Route name             | Controller@action                | Middleware                                   | Request                                                                                                                                                                                  | Response                                       |
| -------------------------- | ---------------------- | -------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| PATCH admin/languages/{id} | admin.languages.update | Admin\LanguagesController@update | Authenticate, EnsureUserIsAdmin, IPAllowlist | `name` required string max 80; `native_name` nullable string max 80; `direction` required in ltr,rtl; `is_active` sometimes boolean; `sort_order` nullable integer min 0. `{id}` numeric | redirect back with `success` "<name> updated." |

- **Data:** Updates `languages` row (`name`, `native_name`, `direction`, `is_active`, `sort_order`). `code` cannot be changed. Audit action `admin.language.updated` with meta `{code, is_active}`.
- **Rules & edge cases:**
  1. `is_active` is coerced to false when the field is absent (checkbox semantics) so omitting it DEACTIVATES the language.
  2. Deactivating the current default language through this path is allowed (no guard, unlike set-default); the default setting is left pointing at an inactive code.
  3. `sort_order` nullable: when null is sent Laravel passes null into the update and the column is NOT NULL unsigned int, so a null would raise a DB error (validated as nullable but not defaulted). QUIRK.
  4. Does NOT flush the 10-minute active-languages cache (unlike toggle and set-default), so direction/name/active changes made here take up to 10 minutes to reach the switcher, `<html dir>` and SetLocale.
  5. Unknown id returns 404 (`findOrFail`).
- **Async & events:** Audit log entry `admin.language.updated` (platform layer).
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given language id 4 (ar), when PATCH sends name "Arabic", direction "rtl", is_active true, sort_order 4, then the row is updated, an audit row is written and the admin is redirected back with a success flash.
  - Given a PATCH with direction "sideways", then validation fails with no change.
  - Given a PATCH without `is_active`, then the language becomes inactive.
  - Given a successful update, when the cache is not flushed, then the switcher still shows the old data until the cache TTL (600 s) expires (parity behavior; the port may choose to flush).
- **Source refs:** `app/Http/Controllers/Admin/LanguagesController.php`, `routes/admin.php`, `Documentation/pages/admin-panel/localization.html`.
- **Port notes:** Implement the edit UI (modal or inline row editor) that the docs describe and flush/invalidate the active-languages cache on every registry write. Decide whether to keep the "omitted is_active means false" behavior; recommend explicit boolean.

### WD-I18N-003 — Toggle language active/inactive

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-I18N-001
- **Summary:** One-click switch that makes a language visible or hidden in every language switcher and pickers, without deleting it.
- **Actors & access:** Platform admin. No plan gate. Audit-logged.
- **UX & screens:** The On/Off pill in the Active column of the languages table (form POST + CSRF). After the request the page reloads with a flash "<name> activated." or "<name> disabled."
- **Endpoints:**

| Endpoint                         | Route name             | Controller@action                | Middleware                                   | Request        | Response                       |
| -------------------------------- | ---------------------- | -------------------------------- | -------------------------------------------- | -------------- | ------------------------------ |
| POST admin/languages/{id}/toggle | admin.languages.toggle | Admin\LanguagesController@toggle | Authenticate, EnsureUserIsAdmin, IPAllowlist | `{id}` numeric | redirect back, `success` flash |

- **Data:** Flips `languages.is_active`. Flushes cache key `locale:active_languages`. Audit `admin.language.activated` / `admin.language.deactivated` (resource = the language row).
- **Rules & edge cases:**
  1. There is no guard against deactivating the current platform default, or against deactivating every language. If none is active the switcher disappears (it renders only when more than one language is active) and locale resolution falls back to the platform default string / `en`.
  2. Users whose `users.locale` points to a now-inactive language are silently treated as having no preference (see WD-I18N-008).
  3. Unknown id yields 404.
- **Async & events:** Cache bust via `LocaleSettings::flush()`. Audit entry.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given an active language, when the admin clicks its On pill, then it becomes Off, the switcher no longer lists it on the next request and a "disabled" flash shows.
  - Given the header switcher was cached, when a language is toggled, then the cache is flushed immediately (no 10-minute wait).
  - Given the toggle, when it completes, then an audit row `admin.language.activated` or `admin.language.deactivated` exists.
- **Source refs:** `app/Http/Controllers/Admin/LanguagesController.php`, `app/Support/LocaleSettings.php`, `resources/views/admin/languages/index.blade.php`.
- **Port notes:** Use a shared cache (Redis) key for active languages with explicit invalidation on any registry write. Consider blocking deactivation of the default.

### WD-I18N-004 — Set platform default language

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-I18N-003
- **Summary:** Admin chooses which language is the fallback for guests and for anyone without a personal or workspace preference. Stored as a platform setting, not on the language row.
- **Actors & access:** Platform admin. Audit-logged. The same value is also editable as a free-text-validated select on Admin > Settings > General (SET domain, `AdminPagesController@settingGeneral/saveGeneral`, validation `nullable|string|max:12`, no existence check).
- **UX & screens:** "Set" button in the Default column (POST form). Success flash "<name> is now the default language." or error flash "Activate <name> first before setting it as default." when inactive.
- **Endpoints:**

| Endpoint                          | Route name              | Controller@action                    | Middleware                                   | Request        | Response                                  |
| --------------------------------- | ----------------------- | ------------------------------------ | -------------------------------------------- | -------------- | ----------------------------------------- |
| POST admin/languages/{id}/default | admin.languages.default | Admin\LanguagesController@setDefault | Authenticate, EnsureUserIsAdmin, IPAllowlist | `{id}` numeric | redirect back with success or error flash |

- **Data:** Writes `system_settings` row key `default_language` (type string, description "Default platform language for new users.") with the language `code`. Audit `admin.language.default_changed` meta `{previous, now}` (previous defaults to `en` when unset). Flushes the active-language cache.
- **Rules & edge cases:**
  1. The target must be `is_active`; otherwise the action is refused.
  2. Only the default is stored; there is no flag on `languages` (unlike currencies).
  3. QUIRK: docs and UI say the default "applies to newly created accounts", but the code does not stamp it onto new users; it is only step 4 of the live resolution chain in SetLocale (WD-I18N-008), so changing it changes the language of every user/guest that has no personal, session or workspace preference immediately.
  4. The installer also writes `APP_LOCALE` into `.env` (from the wizard field `locale`, required string max 12) which is the last-resort fallback when the setting is missing.
- **Async & events:** Audit entry; cache flush.
- **External systems:** None.
- **Settings:** `system_settings.default_language`; env `APP_LOCALE` (default `en`), `APP_FALLBACK_LOCALE` (default `en`).
- **Acceptance criteria:**
  - Given an active language "es", when the admin clicks Set, then `system_settings.default_language` equals `es`, the Default badge moves to Spanish and an audit row records previous and new codes.
  - Given an inactive language, when Set is posted, then nothing changes and the error asks to activate it first.
  - Given a guest with no session locale, when they load the marketing home after the change, then the page renders in the new default (with `<html dir>` matching its direction).
- **Source refs:** `app/Http/Controllers/Admin/LanguagesController.php`, `app/Support/LocaleSettings.php`, `app/Http/Controllers/AdminPagesController.php` (settingGeneral), `resources/views/admin/settings/general.blade.php`, `app/Http/Controllers/InstallController.php`.
- **Port notes:** Store in the platform settings table owned by SET. Validate any write path (including General settings) against the registry to avoid an unknown default code.

### WD-I18N-005 — Delete language

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-I18N-004
- **Summary:** Removes a language row from the registry (never the default). The shipped JSON catalog file stays on disk, so re-adding is impossible from the UI (adds are locked).
- **Actors & access:** Platform admin. Audit-logged. Not reversible from the UI.
- **UX & screens:** Red Delete link in the last column, hidden for the default row; a `data-confirm` dialog "Remove <name>?" then form POST with `_method=DELETE`. Flash "Language removed." or error "Can't delete the default language. Set another language as default first."
- **Endpoints:**

| Endpoint                    | Route name              | Controller@action                 | Middleware                                   | Request        | Response                 |
| --------------------------- | ----------------------- | --------------------------------- | -------------------------------------------- | -------------- | ------------------------ |
| DELETE admin/languages/{id} | admin.languages.destroy | Admin\LanguagesController@destroy | Authenticate, EnsureUserIsAdmin, IPAllowlist | `{id}` numeric | redirect back with flash |

- **Data:** Hard-deletes the `languages` row (no soft delete). Audit `admin.language.deleted` with meta `{code, name}`.
- **Rules & edge cases:**
  1. Refused when the language `code` equals the stored default (compared to `system_settings.default_language`, default `en`).
  2. Does NOT flush the active-languages cache, so a deleted language remains selectable in the switcher for up to 10 minutes (QUIRK).
  3. Does not clean `users.locale`, `workspaces.default_language` or session values that reference the code; SetLocale simply stops honoring them once the cache expires.
  4. DemoMode blocks all DELETE requests everywhere.
  5. Because the seed migration uses upsert on code, re-running that migration would bring the row back.
- **Async & events:** Audit entry only.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given a non-default language, when Delete is confirmed, then the row is gone and the flash says "Language removed."
  - Given the default language, when a DELETE request is sent, then it is refused with the "set another default first" error and the row remains.
  - Given a user whose `users.locale` was the deleted code, when they next load a page, then they receive the fallback locale, not an error.
- **Source refs:** `app/Http/Controllers/Admin/LanguagesController.php`, `resources/views/admin/languages/index.blade.php`, `database/migrations/2026_05_26_180000_seed_languages.php`.
- **Port notes:** Prefer archiving over hard delete, invalidate the cache, and consider preventing delete when workspaces or users still reference the code.

### WD-I18N-006 — Add-language lock (POST is a stub)

- **Status:** dead-code
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-I18N-001
- **Summary:** The route to add a language exists but always answers with an error stating that adding languages is disabled and the 20-language pack is fixed. The product rule is: a language may only exist if a matching `lang/<code>.json` ships with the platform.
- **Actors & access:** Platform admin route group; no effective action.
- **UX & screens:** No form on the page (removed). If posted directly, the admin is redirected back with an error flash.
- **Endpoints:**

| Endpoint             | Route name            | Controller@action               | Middleware                                   | Request       | Response                                                                                    |
| -------------------- | --------------------- | ------------------------------- | -------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------- |
| POST admin/languages | admin.languages.store | Admin\LanguagesController@store | Authenticate, EnsureUserIsAdmin, IPAllowlist | any (ignored) | redirect back with error "Adding new languages is disabled. The 20-language pack is fixed." |

- **Data:** None written.
- **Rules & edge cases:**
  1. Documentation table lists "Add a brand-new language: No (turned off until a translation for it is available)". Source comments say adding a language requires extending the seed migration, running the offline translator CLI ("fasttrans") and redeploying.
  2. The CLI/script "fasttrans_cli.py" that produced the catalogs is referenced in comments and is not part of the package (not shipped).
- **Async & events:** None.
- **External systems:** None (the fasttrans generator is external and absent).
- **Settings:** None.
- **Acceptance criteria:**
  - Given any POST to `admin/languages`, when it is handled, then no row is created and the error flash appears.
  - Given the port decides to allow additions, then it must ship (or generate) the matching UI catalog before the language can be activated.
- **Source refs:** `app/Http/Controllers/Admin/LanguagesController.php`, `resources/views/admin/languages/index.blade.php`, `Documentation/pages/admin-panel/localization.html`.
- **Port notes:** In the new stack make language addition a supported flow: registry row + uploaded/generated catalog, with an "activate only when catalog coverage >= threshold" guard (see coverage gaps in WD-I18N-012).

### WD-I18N-007 — Seeded language pack and registry data

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** none
- **Summary:** Fresh installs come with 21 language rows already present and active, ordered as a fixed list. Three are RTL. This is the seed the whole locale system depends on.
- **Actors & access:** System (migration). No UI.
- **UX & screens:** None; results show on WD-I18N-001.
- **Endpoints:** none (migration `2026_05_26_180000_seed_languages.php` and table migration `2026_05_23_125651_create_languages_table.php`).
- **Data:** `languages` seeded via idempotent upsert keyed on `code` (re-run safe; keeps `created_at`, refreshes name/native/direction/sort/`is_active=true`). Seeded order (sort_order = position): 1 en English, 2 es Espanol, 3 hi Hindi, 4 ar Arabic (rtl), 5 pt Portuguese, 6 ru Russian, 7 ja Japanese, 8 de German, 9 fr French, 10 it Italian, 11 ko Korean, 12 zh-CN Chinese (Simplified), 13 tr Turkish, 14 id Indonesian, 15 vi Vietnamese, 16 th Thai, 17 pl Polish, 18 nl Dutch, 19 ur Urdu (rtl), 20 he Hebrew (rtl), 21 bn Bengali. Native names are stored in each script (Espanol, Hindi in Devanagari, etc.). All active by default.
- **Rules & edge cases:**
  1. Marketing/UI copy says 20, data says 21 (bn was added last); the port should present the true number.
  2. Code column is `varchar(12)` unique; `zh-CN` uses BCP-47 with region, so `LocaleSettings::isAvailable('zh-CN')` is case-sensitive.
  3. Codes match the `lang/<code>.json` filename convention Laravel uses for locale files.
  4. The Hebrew catalog is entirely untranslated (see WD-I18N-012), yet Hebrew is seeded active and RTL.
- **Async & events:** Runs at migrate time only.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given a clean database after migrations, when `languages` is counted, then there are 21 rows, all active, with ar/ur/he as `rtl` and the rest `ltr`.
  - Given the seed is re-run, then no duplicates are created and admin edits to name/direction are overwritten (parity quirk).
  - Given the seeded ordering, when the switcher renders, then English is first and Bengali last.
- **Source refs:** `database/migrations/2026_05_26_180000_seed_languages.php`, `database/migrations/2026_05_23_125651_create_languages_table.php`, `Documentation/pages/admin-panel/localization.html`.
- **Port notes:** Drizzle seed script in `packages/db` (idempotent on code) but do NOT overwrite admin edits on re-seed. Keep BCP-47 codes and store casing canonically.

### WD-I18N-008 — Per-request locale resolution (SetLocale + LocaleSettings)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-I18N-007
- **Summary:** Every web request gets an interface language chosen from the user's own choice, else the session pick, else the workspace default, else the platform default, else `en`. The available-language list is cached for 10 minutes.
- **Actors & access:** Every web visitor (authenticated or guest). Middleware appended to the `web` group in `bootstrap/app.php` (runs after `SecurityHeaders`, before tenant-domain resolution).
- **UX & screens:** Invisible; determines Blade translation output and `<html dir>`.
- **Endpoints:** none (middleware `app/Http/Middleware/SetLocale.php`; helper `app/Support/LocaleSettings.php`).
- **Data:** Reads `users.locale` (varchar 12, null = follow defaults), session key `app_locale`, `workspaces.default_language` (varchar 8) via `user->currentWorkspace`, `system_settings.default_language`, `config('app.locale')`, and `languages` (active rows: code, name, native_name, direction; ordered by sort_order then name) cached under `locale:active_languages` for 600 seconds.
- **Rules & edge cases:**
  1. Skips entirely (no locale set, framework default applies) until the installer has created `storage/installed`.
  2. Order: (1) authenticated user's `locale` if non-empty AND active; else, when the request has a session, (2) session `app_locale` if active; else (3) the user's current workspace `default_language` if active; else (4)/(5) the platform default = `system_settings.default_language`, or `config('app.locale')`, or `en`.
  3. QUIRK: the workspace default (step 3) only applies to authenticated users and only when the session holds no valid locale; a guest never reaches it. Also an authenticated user with a stored but now-inactive `locale` falls through to session, then workspace, then platform.
  4. QUIRK: the platform default itself is NOT validated against the active list; if it points to an inactive/deleted code Laravel is set to that locale anyway (its catalog may simply be missing and strings fall back to English).
  5. All errors (missing table, cache store unavailable, DB down during install) are swallowed and the fallback locale is used. The cache read itself is guarded because `CACHE_STORE=database` would query a missing table during install.
  6. `isAvailable(code)` is an exact, case-sensitive match on the cached active list; `directionFor(code)` returns `ltr` when the code is unknown/inactive.
  7. Only `app()->setLocale()` is called; Carbon and number/currency formatting locales are not changed here.
  8. No JS-side i18n exists (no `__` usage in `resources/js`): only server-rendered strings are localized.
  9. Node bridge and API-key routes (`api/v1`, `api/app`) are not in the `web` group, so they do not run this middleware.
- **Async & events:** None. Cache flush hooks are in WD-I18N-003/004 (not in 002/005).
- **External systems:** None.
- **Settings:** `system_settings.default_language`, env `APP_LOCALE`, `APP_FALLBACK_LOCALE`; workspace `default_language`; user `locale`.
- **Acceptance criteria:**
  - Given a logged-in user with `locale=fr` and fr active, when any page loads, then strings render from `lang/fr.json`.
  - Given a guest with session `app_locale=de`, when a page loads, then German is used; and given no session pick, then the platform default is used.
  - Given a user without a personal or session locale whose workspace default_language is `es`, when they load a page, then Spanish is used.
  - Given the installer has not finished, when a request is made, then locale resolution is skipped without error.
  - Given the languages table is missing, when a request is made, then the page renders in `en` without a 500.
- **Source refs:** `app/Http/Middleware/SetLocale.php`, `app/Support/LocaleSettings.php`, `bootstrap/app.php`, `database/migrations/2026_05_26_180001_add_locale_to_users.php`, `database/migrations/2026_05_19_010000_multilingual_keyword_replies.php`.
- **Port notes:** In NestJS this becomes a request-scoped locale resolver (Next.js `next-intl` or middleware reading cookie/user pref + workspace default). Keep the same precedence and make the workspace default apply to guests on custom domains if desired. Cache active languages in Redis with explicit invalidation. Store user locale on the user profile; the session pick becomes a cookie.

### WD-I18N-009 — Language switch endpoint (POST /locale)

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-I18N-008
- **Summary:** The single endpoint behind every language dropdown. It validates the code against active languages, remembers it in the session, and, for logged-in users, persists it on the user profile so it survives logout.
- **Actors & access:** Guests and authenticated users (route only has `web` middleware, no `Authenticate`). CSRF protected. Allowed even in demo mode (`locale*` is on the DemoMode allow list).
- **UX & screens:** Called by the switcher JS with JSON; a plain form POST works too (redirect back).
- **Endpoints:**

| Endpoint    | Route name    | Controller@action       | Middleware | Request                                                                       | Response                                                                                                                                                                                                         |
| ----------- | ------------- | ----------------------- | ---------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST locale | locale.update | LocaleController@update | web        | `code` (string, trimmed, required non-empty, must be an active language code) | JSON `{ok:true, locale, direction}` for XHR; `{ok:false, error:"Language not available."}` with HTTP 422 for XHR; non-XHR redirects back with `success` "Language updated." or `error` "Language not available." |

- **Data:** Writes session `app_locale`; when authenticated, `users.locale` via forceFill+save (wrapped in try/catch: a missing column on a stale schema does not fail the request). Immediately calls `app()->setLocale()` for the remainder of the request.
- **Rules & edge cases:**
  1. Unknown, empty or inactive code returns 422 (JSON) or an error flash; nothing is stored.
  2. The response includes `direction` (ltr/rtl) though the current JS ignores it and reloads the page.
  3. No rate limit.
  4. Authenticated users' choice overrides workspace and platform defaults from then on (step 1 of WD-I18N-008).
  5. No audit-log entry.
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given an active code `es`, when a logged-in user POSTs it as JSON, then the response is 200 `{ok:true, locale:"es", direction:"ltr"}`, `users.locale` is `es` and the session holds `app_locale=es`.
  - Given a code not in the active list, when posted, then 422 `{ok:false}` and no state changes.
  - Given a guest, when they POST `ar`, then the session stores it, no DB write occurs and the next page renders RTL.
  - Given a form (non-XHR) POST, when it succeeds, then the user is redirected back with a success flash.
- **Source refs:** `app/Http/Controllers/LocaleController.php`, `routes/web.php`, `app/Http/Middleware/DemoMode.php`.
- **Port notes:** `POST /api/v1/me/locale` for users plus a cookie-only path for guests. Validate against the cached active list; return the same shape (`ok`, `locale`, `direction`).

### WD-I18N-010 — Header language switcher component

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-I18N-009
- **Summary:** A globe-icon dropdown that appears in the marketing nav (desktop and mobile menu), the user app header and top strip, and the admin header. Picking a language calls the switch endpoint and reloads the page.
- **Actors & access:** Everyone. Visible only when more than one language is active.
- **UX & screens:** `resources/views/components/locale-switcher.blade.php` used by `components/admin/header-right`, `components/user/header` (line ~504), `components/user/topstrip`, `components/frontend/nav` (desktop and mobile). Button shows a globe icon, the UPPERCASE code of the current locale (falls back to the first active language's code if the current locale row is not in the active list) and a chevron; tooltip "Change language". Menu is 224px wide, right-anchored, max height 400px with scroll; each item shows the native name (or English name), the English name beside it, and the code in mono; the current language is highlighted. Each item carries `data-locale-pick` and `data-locale-dir`. JS (`resources/js/locale-switcher.js`, bundled into `app.js`; the frontend layout additionally loads it through its own Vite entry): idempotent binding per switcher root; toggle opens/closes the menu and clamps it to the viewport (flips to left-anchored if it would overflow left, to right if overflowing right); a click outside closes it; picking an item does a fetch POST `/locale` with JSON `{code}`, headers `Accept: application/json`, `X-Requested-With: XMLHttpRequest`, `X-CSRF-TOKEN` from the meta tag, credentials same-origin, then `window.location.reload()`. On failure it only logs a console warning (no user-visible error).
- **Endpoints:** uses WD-I18N-009 endpoint.
- **Data:** Reads the cached active languages (code, name, native_name, direction).
- **Rules & edge cases:**
  1. Component renders nothing when 0 or 1 languages are active.
  2. Component is rendered on every page load and reads the (cached) active list each time.
  3. The JS was extracted from an inline `@push('scripts')` because the pushed script accumulated in memory on the admin layout; the port should keep the component self-contained.
  4. There is no keyboard navigation, arrow-key handling or ARIA state beyond the button (an accessibility gap to fix in the port).
- **Async & events:** One fetch on selection; full page reload afterwards.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given 21 active languages, when a visitor opens the dropdown, then all 21 are listed in sort order with native names and the current one highlighted.
  - Given the visitor picks Arabic, when the request succeeds, then the page reloads with `dir="rtl"` and Arabic strings.
  - Given only one active language, when any page renders, then the switcher is absent.
  - Given a narrow viewport where the menu would clip the left edge, when it opens, then it is re-anchored to stay visible.
  - Given the POST fails, when the user picks a language, then no reload happens.
- **Source refs:** `resources/views/components/locale-switcher.blade.php`, `resources/js/locale-switcher.js`, `resources/js/app.js`, `resources/views/components/layouts/frontend.blade.php`, `resources/views/components/frontend/nav.blade.php`, `resources/views/components/user/header.blade.php`, `resources/views/components/user/topstrip.blade.php`, `resources/views/components/admin/header-right.blade.php`.
- **Port notes:** `apps/web` shared `LocaleSwitcher` client component. Use a menu-button pattern with proper roles and focus handling, and optimistic in-place refresh (router refresh) instead of a hard reload if the i18n library allows.

### WD-I18N-011 — RTL text direction

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-I18N-008
- **Summary:** Languages flagged `rtl` (ar, ur, he) flip the document direction so the whole layout mirrors.
- **Actors & access:** Everyone.
- **UX & screens:** The `<html dir="...">` attribute is computed from `LocaleSettings::directionFor(app()->getLocale())` in the guest, frontend, user and admin layouts, the public welcome page and the workspace-suspended page. There is one explicit RTL CSS override in `resources/css/wadesk.css` (a slide-in panel `#qad-panel` translate direction); other mirroring relies on browser/Tailwind logical behavior. The switcher menu is right-anchored by default with a viewport-clamp for RTL.
- **Endpoints:** none.
- **Data:** `languages.direction` enum('ltr','rtl') default ltr, read through the cached active list.
- **Rules & edge cases:**
  1. Direction is looked up in the ACTIVE list only; an inactive/unknown locale yields `ltr` even if its catalog is RTL.
  2. Direction editing exists only through the un-surfaced PATCH (WD-I18N-002).
  3. Layout pages not using these layouts (e.g. error views, emails, PDFs) do not set `dir`.
  4. The chat widget, storefront and public forms are outside this mechanism (own layouts) and do not read the platform locale.
- **Async & events:** None.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given locale `ur`, when a page renders in the user layout, then `<html dir="rtl">` is present.
  - Given locale `en`, then `dir="ltr"`.
  - Given a locale that was deactivated, when its direction is requested, then `ltr` is returned.
- **Source refs:** `app/Support/LocaleSettings.php`, `resources/views/components/layouts/{guest,frontend,user,admin}.blade.php`, `resources/views/welcome.blade.php`, `resources/views/workspace-suspended.blade.php`, `resources/css/wadesk.css`.
- **Port notes:** Use CSS logical properties (`margin-inline-start`, etc.) throughout the new UI and set `dir` on `<html>` in the Next.js root layout. Add an RTL visual regression pass for ar/ur/he.

### WD-I18N-012 — UI string catalogs (lang/*.json) and fallback chain

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** none
- **Summary:** All interface text is externalised into one flat JSON file per language, keyed by the English source sentence. Missing keys fall back to English and then to the key itself. The catalogs are machine-translated snapshots with very uneven coverage.
- **Actors & access:** System. Translators edit files (there is no in-app translation editor).
- **UX & screens:** None (files: `lang/ar.json bn.json de.json en.json es.json fr.json he.json hi.json id.json it.json ja.json ko.json nl.json pl.json pt.json ru.json th.json tr.json ur.json vi.json zh-CN.json`, 21 files, roughly 0.4 to 1.2 MB each). No PHP array lang files, no `resources/lang`.
- **Endpoints:** none.
- **Data:** (file format) A flat JSON object `{"<English source string>": "<translation>"}`, keys sorted alphabetically (exporter `sort-keys` true), UTF-8, PHP `json_encode` style (forward slashes escaped as `\/`), 4-space indent. Placeholders use Laravel `:name` tokens which callers pass as replacement arrays (for example `__('... :app ...', ['app' => brand_name()])`). Plural/choice via `trans_choice`. `en.json` is an identity map (every value equals its key, 11,256 keys). Measured coverage against `en.json` keys: ar, de, id about 10.6k to 10.9k translated of 11,033 matched; es 11,028 of 11,250; pt has all 11,256 keys but 5,083 values are identical to the English key (about 45% untranslated); fr about 9.5k; ja about 8.5k; bn about 8.7k; it about 6.2k; hi, ko, nl, pl, ru, th, tr, ur, vi, zh-CN about 5.2k to 5.4k (about 48% of en keys); **he.json has every value identical to its key (0 translated)**. Every non-en catalog also carries roughly 1,156 to 1,180 keys that do not exist in en.json (present in the newer catalogs but missing from the identity file), and the older six-thousand-key files lack about 5,800 en keys.
- **Rules & edge cases:**
  1. Lookup (Laravel framework behavior): `lang/{locale}.json` value if present and non-identical; else `lang/{fallback}.json` (`APP_FALLBACK_LOCALE`, default `en`); else the key string as written. Because `en` is an identity map and keys are English, an untranslated string simply shows English.
  2. Strings inside JS bundles, emails built outside Blade, notification titles written in PHP, API error messages, WhatsApp template bodies and the marketing CMS content are NOT covered by these files (frontend content has its own store owned by CMS).
  3. There is no per-workspace override of UI strings.
  4. QUIRK: en.json is smaller than the others; it lacks about 1,160 strings the other catalogs contain, meaning the identity file is stale relative to the code that generated the others.
  5. QUIRK: an "identical to key" value is the exporter's marker for "untranslated" (option `put-untranslated-strings-at-the-top` is off).
  6. Admin registry rows can be active for languages whose catalog is largely English (he entirely, most of the pre-2026 catalogs half).
- **Async & events:** None at runtime; files load per request through Laravel's translator.
- **External systems:** Catalogs were generated with an offline "fasttrans" translation CLI (not in the package).
- **Settings:** env `APP_LOCALE`, `APP_FALLBACK_LOCALE`, `APP_FAKER_LOCALE` (faker unrelated).
- **Acceptance criteria:**
  - Given locale `es` and a key present in `es.json`, when `__(key)` is called, then the Spanish value is returned.
  - Given locale `he`, when a key is requested, then the (identical) English text is shown.
  - Given a key missing in every catalog, when requested, then the key string itself is returned unchanged with `:placeholders` substituted.
  - Given a locale whose catalog file is missing, when requested, then the `en` fallback is used with no error.
- **Source refs:** `lang/*.json`, `config/app.php` (locale, fallback_locale), `resources/views/**` (usage), `database/migrations/2026_05_26_180000_seed_languages.php`.
- **Port notes:** Recommended: ICU MessageFormat catalogs per language in `packages/i18n` (or `apps/web/messages/<code>.json`) with stable dotted keys instead of English-sentence keys, then import WaDesk-independent translations (do NOT copy WaDesk's catalog content; regenerate with our own translation pass). Keep the fallback chain (locale, then `en`, then key). Add a CI coverage report per language and gate activation on coverage. Server (NestJS emails, notifications) needs the same catalogs.

### WD-I18N-013 — String extraction tooling (translatable:export / inspect)

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-I18N-012
- **Summary:** Developer commands from the `kkomelin/laravel-translatable-string-exporter` package that scan the source for translatable strings and write or audit the JSON catalogs.
- **Actors & access:** Developers at the CLI. Not exposed in the UI.
- **UX & screens:** None. Commands: `translatable:export <lang>` (adds missing keys to `lang/<lang>.json`, sorted) and `translatable:inspect-translations` (reports missing/obsolete keys/duplicates).
- **Endpoints:** none (artisan commands `translatable:export`, `translatable:inspect-translations`).
- **Data:** Reads `app` and `resources` directories (`*.php`, `*.js`) and writes `lang/*.json`.
- **Rules & edge cases:**
  1. Config `config/laravel-translatable-string-exporter.php` scans `app` and `resources`, excludes nothing, patterns `*.php` and `*.js`, functions `__`, `trans_choice`, `_t`, `@lang`, newlines in keys not allowed, keys sorted, persistent strings not auto-added, Laravel PHP-file keys not excluded, untranslated strings not moved to the top.
  2. Strings built dynamically (concatenation or variable keys) are not discovered.
  3. No CI enforcement in the repo; catalogs drifted (see WD-I18N-012).
- **Async & events:** None.
- **External systems:** None.
- **Settings:** the config file above.
- **Acceptance criteria:**
  - Given a new `__('Some text')` in Blade, when the export command runs for `es`, then `lang/es.json` gains `"Some text": "Some text"` sorted into place.
  - Given an unused key, when the inspect command runs, then it is reported as obsolete.
- **Source refs:** `config/laravel-translatable-string-exporter.php`, `composer.json` (package requirement `^1.26`).
- **Port notes:** Replace with an i18n extraction step (for example `formatjs extract` or `i18next-parser`) in CI that fails when a key exists in code but not in `en`, and reports coverage per language.

### WD-I18N-014 — Translation providers admin page and seed

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** none
- **Summary:** Super-admin catalog of the five translation backends, all pre-installed on a fresh install, each shown as a card with status, default flag, credential form and controls. MyMemory and Google GTX are active out of the box so multilingual auto-reply works with zero setup.
- **Actors & access:** Platform admins (`Authenticate`, `EnsureUserIsAdmin`, `IPAllowlist`). No permission key, no plan gate. Blocked for writes in demo mode (`admin/translation-providers*`). Platform scope.
- **UX & screens:** `resources/views/admin/translation-providers/index.blade.php` (admin layout). Title "Translation providers" with intro paragraph. Shared flash banner (`x-admin.flash`: success/status green, error red, warning). A "Compliance lockdown" panel (see WD-I18N-018). Then one section per provider row in `sort_order` order: name, an Active or Disabled badge, a Default badge when default, a "Lockdown - skipped" badge (card at 60% opacity) when lockdown is on and the slug is unofficial; below it `slug: <slug> - <description>`. Buttons on the card head: "Make default" (shown only when the provider is active and not default) and Activate/Disable. Body: a form (PATCH) rendering the driver's credential schema, one input per field (label, red star when required, hint underneath; `password` type renders an empty masked input with placeholder "leave blank to keep" when a value already exists; other types render the current decrypted value in the input), or, for drivers with no fields, a dashed box "No credentials required - this provider works out of the box". Field `sort_order` (number, min 0, help "Lower = higher priority in the fallback chain"). Save button "Save <name>". Empty state (no rows) tells the admin to run the TranslationProviderSeeder artisan command.
- **Endpoints:**

| Endpoint                        | Route name                        | Controller@action                         | Middleware                                   | Request | Response                                                                                     |
| ------------------------------- | --------------------------------- | ----------------------------------------- | -------------------------------------------- | ------- | -------------------------------------------------------------------------------------------- |
| GET admin/translation-providers | admin.translation-providers.index | Admin\TranslationProviderController@index | Authenticate, EnsureUserIsAdmin, IPAllowlist | none    | HTML view with providers each decorated with `credential_fields` and `credentials_decrypted` |

- **Data:** Reads `translation_providers` ordered by `sort_order` (only; ties unordered). Seeder (`TranslationProviderSeeder`, run by the installer's curated seeder list and by `DatabaseSeeder`) does `firstOrCreate` by slug so re-seeding never overwrites admin changes. Seeded rows: mymemory (sort 1, active, DEFAULT), google_gtx (sort 2, active), libretranslate (sort 3, inactive), deepl (sort 4, inactive), google_cloud (sort 5, inactive). Names/descriptions come from `TranslationProviderManager::PROVIDER_META`: "MyMemory", "LibreTranslate", "Google (free)", "DeepL", "Google Cloud" with short marketing descriptions (free tier limits, quality notes, pricing hint). Credentials column null on seed.
- **Rules & edge cases:**
  1. The slug-to-class registry (`DRIVER_MAP`) is code; an unknown slug row shows no fields and is skipped at runtime.
  2. QUIRK: non-password credential values (LibreTranslate endpoint, MyMemory admin email) are rendered decrypted into the HTML; password-type values are never echoed.
  3. QUIRK: navigation: neither `/admin/translation-providers` nor `/admin/translation-usage` is linked from the admin sidebar or the settings hub; the providers page is reachable from the workspace Account > Translation tab (admin users only), the legal data-processing page, and by URL. The port should add proper navigation.
  4. Documentation says the seeded default set is MyMemory only; the seed also activates Google GTX as a rescue driver (comment: MyMemory's 5k/day/IP limit is quickly eaten on shared hosts).
  5. The docs page calls MyMemory "no credentials required" but the driver defines an optional admin email field (raises daily quota).
- **Async & events:** None.
- **External systems:** None on this page.
- **Settings:** `system_settings.translation.official_only` (bool) drives the lockdown badge.
- **Acceptance criteria:**
  - Given a fresh install, when the admin opens the page, then five cards appear in order MyMemory (Active, Default), Google (free) (Active), LibreTranslate (Disabled), DeepL (Disabled), Google Cloud (Disabled).
  - Given a DeepL row with a saved key, when the page renders, then the API key field is empty with the keep-blank placeholder and the key is not present in the HTML.
  - Given lockdown is ON, when the page renders, then MyMemory, LibreTranslate and Google (free) show the "Lockdown - skipped" badge and reduced opacity.
  - Given the table is empty, when the page renders, then the empty-state message with the seeder hint is shown.
- **Source refs:** `app/Http/Controllers/Admin/TranslationProviderController.php`, `app/Services/Translation/TranslationProviderManager.php`, `app/Models/TranslationProvider.php`, `database/seeders/TranslationProviderSeeder.php`, `database/migrations/2026_05_20_010000_create_translation_providers_table.php`, `resources/views/admin/translation-providers/index.blade.php`, `resources/views/components/admin/flash.blade.php`, `app/Http/Controllers/InstallController.php`, `Documentation/pages/admin-panel/translation.html`.
- **Port notes:** Table `translation_providers` is platform-global (no tenant column, no RLS; readable only by platform-admin role). Implement providers as adapters behind an interface (`TranslationProvider` port with `translate`, `detectAndTranslate`, `credentialSchema`). Store credentials with the platform's envelope encryption; never return secret values to the client, and mask non-secret ones consistently. Seed idempotently with `ON CONFLICT DO NOTHING`.

### WD-I18N-015 — Save provider credentials and sort order

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-I18N-014
- **Summary:** Admin saves a provider's credentials (encrypted) and its priority in the fallback chain. Blank secret fields keep the stored value.
- **Actors & access:** Platform admin. Audit-logged (`admin.translation_provider.updated`).
- **UX & screens:** The per-card form in WD-I18N-014; submit shows flash "<name> settings saved."
- **Endpoints:**

| Endpoint                               | Route name                         | Controller@action                          | Middleware                                   | Request                                                                                                                     | Response                     |
| -------------------------------------- | ---------------------------------- | ------------------------------------------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| PATCH admin/translation-providers/{id} | admin.translation-providers.update | Admin\TranslationProviderController@update | Authenticate, EnsureUserIsAdmin, IPAllowlist | `credentials` nullable array; `credentials.*` nullable string max 1024; `sort_order` nullable integer min 0. `{id}` numeric | redirect back with `success` |

- **Data:** Writes `translation_providers.credentials` = encrypted (Laravel `Crypt::encryptString`) JSON of the merged credential map (UTF-8 unescaped) and `sort_order` (kept when omitted). Merge rule: start from the existing decrypted map; for each field key defined in the driver schema, overwrite only when the request supplies a non-empty string. Unknown keys in the request are ignored. Audit meta lists only credential KEY NAMES that were sent with a non-empty value (never values).
- **Rules & edge cases:**
  1. There is no way to clear a stored credential (blank means keep). To remove one the admin must replace it or delete via DB.
  2. Saving does not change `is_active`; activation is a separate guarded action (WD-I18N-016).
  3. Credential values are trimmed by framework middleware only; no format validation (a bad DeepL key is only discovered at call time).
  4. `sort_order` validated to `unsignedSmallInteger` range by DB only (no explicit max).
  5. Decryption failures return an empty map (a rotated APP_KEY silently wipes credentials on next save).
  6. Because `credentials` is `hidden` on the model, it never serializes to JSON.
- **Async & events:** Audit log entry; no cache to bust (driver rows are read per call).
- **External systems:** None at save time (no key verification call).
- **Settings:** Per driver schema (see the driver features).
- **Acceptance criteria:**
  - Given a DeepL card with no key, when the admin enters a key and saves, then `credentials` decrypts to `{"api_key": "<key>"}` and an audit row lists `api_key` as a set key.
  - Given an existing key, when the form is saved with the field blank, then the stored key is unchanged.
  - Given a value longer than 1024 chars, when saved, then validation fails.
  - Given sort_order -1, when saved, then validation fails.
- **Source refs:** `app/Http/Controllers/Admin/TranslationProviderController.php`, `app/Models/TranslationProvider.php`, `app/Support/Audit.php`.
- **Port notes:** Encrypt with the platform KMS/pgcrypto wrapper; store a per-provider JSON blob. Validate credentials with a cheap "test connection" call on save (improvement) and allow explicit clearing.

### WD-I18N-016 — Activate / deactivate provider (credential guard)

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-I18N-015
- **Summary:** Switch a provider into or out of the fallback chain. Activation is refused while any required credential is missing.
- **Actors & access:** Platform admin. Audit-logged.
- **UX & screens:** Activate / Disable button on the card head. Flash "Activated." or "Deactivated."; error flash "Configure required fields first: <keys>" listing the missing credential keys.
- **Endpoints:**

| Endpoint                                     | Route name                         | Controller@action                          | Middleware                                   | Request        | Response                 |
| -------------------------------------------- | ---------------------------------- | ------------------------------------------ | -------------------------------------------- | -------------- | ------------------------ |
| POST admin/translation-providers/{id}/toggle | admin.translation-providers.toggle | Admin\TranslationProviderController@toggle | Authenticate, EnsureUserIsAdmin, IPAllowlist | `{id}` numeric | redirect back with flash |

- **Data:** Flips `translation_providers.is_active`. Required keys = driver schema fields with `required=true` (DeepL `api_key`, Google Cloud `api_key`, LibreTranslate `endpoint`; MyMemory and GTX none). Audit `admin.translation_provider.activated` / `.deactivated`; on refusal `admin.translation_provider.toggle_blocked` with result `failure` and meta `missing_keys`.
- **Rules & edge cases:**
  1. The guard applies only when ACTIVATING; deactivation is always allowed.
  2. QUIRK: deactivating the current default provider is allowed and leaves `is_default=1` on an inactive row; the chain still orders by `is_default` desc, but inactive rows are excluded, so the next active row by sort order takes over.
  3. If every provider is deactivated the runtime still works through the hard-coded MyMemory fallback (unless lockdown or residency forbids it).
  4. No check that the lockdown would leave no usable provider when deactivating an official one.
- **Async & events:** Audit entries.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given DeepL with no key, when Activate is clicked, then it stays inactive and the flash names `api_key`; an audit row `toggle_blocked` exists.
  - Given DeepL with a key, when Activate is clicked, then `is_active=1` and it enters the fallback chain.
  - Given an active provider, when Disable is clicked, then it leaves the chain immediately.
- **Source refs:** `app/Http/Controllers/Admin/TranslationProviderController.php`, `app/Services/Translation/Drivers/*Driver.php` (credentialFields).
- **Port notes:** Drive the required-field rule from the adapter's credential schema. Also block deactivating the last usable provider when lockdown is on.

### WD-I18N-017 — Make provider the default

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-I18N-016
- **Summary:** Marks exactly one active provider as the first to try; the flag is cleared on all others in the same transaction.
- **Actors & access:** Platform admin. Audit-logged.
- **UX & screens:** "Make default" button (only for active non-default cards). Flash "<name> is now the default translation provider." or error "Activate this provider before making it the default."
- **Endpoints:**

| Endpoint                                      | Route name                          | Controller@action                              | Middleware                                   | Request        | Response                 |
| --------------------------------------------- | ----------------------------------- | ---------------------------------------------- | -------------------------------------------- | -------------- | ------------------------ |
| POST admin/translation-providers/{id}/default | admin.translation-providers.default | Admin\TranslationProviderController@setDefault | Authenticate, EnsureUserIsAdmin, IPAllowlist | `{id}` numeric | redirect back with flash |

- **Data:** In a DB transaction sets `is_default=false` on every row then `true` on the chosen row. Audit `admin.translation_provider.default_changed`.
- **Rules & edge cases:**
  1. Must be `is_active`.
  2. The default is ordered first in the fallback chain regardless of `sort_order`.
  3. Under lockdown a default that is unofficial stays flagged but is skipped at runtime.
  4. No unique partial index enforces single default; the transaction does.
- **Async & events:** Audit entry.
- **External systems:** None.
- **Settings:** None.
- **Acceptance criteria:**
  - Given DeepL active, when Make default is clicked, then only DeepL has `is_default=1` and MyMemory loses its Default badge.
  - Given an inactive provider, when default is posted directly, then the request is refused with the activate-first error.
  - Given the change, then translation calls try DeepL first on the next request.
- **Source refs:** `app/Http/Controllers/Admin/TranslationProviderController.php`, `app/Services/Translation/TranslationProviderManager.php`.
- **Port notes:** Add a partial unique index `WHERE is_default` to guarantee a single default.

### WD-I18N-018 — Compliance lockdown (official providers only)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-I18N-016
- **Summary:** A platform-wide switch that removes the free/unofficial providers (MyMemory, Google GTX, LibreTranslate) from routing, including the hard-coded MyMemory last resort, so customer text is only sent to DeepL or Google Cloud. It refuses to turn on unless a usable official provider exists.
- **Actors & access:** Platform admin. Audit-logged. Platform-wide (all workspaces).
- **UX & screens:** Panel at the top of the providers page: title "Compliance lockdown", On/Off pill, explanatory text listing the unofficial slugs, and a button "Enable lockdown" / "Disable lockdown" that opens a confirm dialog (title and confirm text vary; enabling warns that free drivers will be skipped, disabling that they rejoin the chain). When ON the panel is tinted. Flash on success: "Official-providers-only mode is ON. Free drivers will be skipped." or "... OFF. Free drivers are back in the fallback chain." Refusal: "Activate and configure at least one official paid provider (DeepL or Google Cloud) before enabling lockdown."
- **Endpoints:**

| Endpoint                                  | Route name                           | Controller@action                            | Middleware                                   | Request                      | Response                 |
| ----------------------------------------- | ------------------------------------ | -------------------------------------------- | -------------------------------------------- | ---------------------------- | ------------------------ |
| POST admin/translation-providers/lockdown | admin.translation-providers.lockdown | Admin\TranslationProviderController@lockdown | Authenticate, EnsureUserIsAdmin, IPAllowlist | none (toggles current state) | redirect back with flash |

- **Data:** `system_settings` key `translation.official_only` (type bool, description about restricting auto-reply translation to official paid APIs). Turning ON is refused unless at least one row whose slug is NOT in the unofficial list (deepl, google_cloud) is `is_active` AND has a non-empty decrypted credential map. Audit `admin.translation.lockdown_enabled` / `.lockdown_disabled` with meta `{previous, now}`.
- **Rules & edge cases:**
  1. Unofficial set = google_gtx, mymemory, libretranslate (constant).
  2. The usability check is only "credentials map is non-empty", not that the required key is present or valid; a Google Cloud row with any stray key passes.
  3. After enabling, `TranslationProviderManager::fallbackChain` skips unofficial slugs and does not yield the hard-coded MyMemory fallback; if the official providers then fail, translation returns null and callers fall back to original text.
  4. The provider mechanism is used by the Translator only; the WhatsApp ordering flow's private Google gtx call (see Open questions) ignores lockdown.
  5. Turning lockdown OFF has no precondition.
- **Async & events:** Audit entries.
- **External systems:** None.
- **Settings:** `system_settings.translation.official_only` default false.
- **Acceptance criteria:**
  - Given DeepL is active with a key, when lockdown is enabled, then the setting becomes true, an audit row is written and the free cards show the skipped badge.
  - Given no official provider is active and keyed, when lockdown is enabled, then it stays OFF with the error flash.
  - Given lockdown ON, when a translation runs, then only DeepL/Google Cloud drivers are called and no request goes to MyMemory or the GTX endpoint.
  - Given lockdown ON, when it is disabled, then free drivers resume in chain order.
- **Source refs:** `app/Http/Controllers/Admin/TranslationProviderController.php`, `app/Services/Translation/TranslationProviderManager.php`, `resources/views/admin/translation-providers/index.blade.php`, `Documentation/pages/admin-panel/translation.html`.
- **Port notes:** Keep as a platform setting; enforce inside the provider router (not in the callers) and add a metric for "translation skipped: no permitted provider".

### WD-I18N-019 — Provider fallback chain resolution

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-I18N-014
- **Summary:** At translate time the manager builds an ordered list of drivers and the Translator tries them one by one until one returns a result.
- **Actors & access:** System (every translation call).
- **UX & screens:** None.
- **Endpoints:** none (service `TranslationProviderManager`).
- **Data:** Reads `translation_providers` where `is_active=1`, ordered by `is_default` desc, `sort_order` asc, `id` asc. Registry `DRIVER_MAP`: mymemory, libretranslate, google_gtx, deepl, google_cloud. Also reads `system_settings.translation.official_only` and the current authenticated user's workspace `data_residency`.
- **Rules & edge cases:**
  1. Rows whose slug is not in the registry are skipped.
  2. If lockdown is on, unofficial slugs are skipped (WD-I18N-018).
  3. If the workspace residency mode restricts providers (WD-I18N-020), rows outside the allowed slugs are skipped.
  4. After the DB rows, the manager yields a synthetic MyMemory driver (no credentials) as a last resort, but only when lockdown is off AND residency allows mymemory (or is unrestricted). This means MyMemory is used even if the admin has deactivated or never seeded it.
  5. `activeDriver()` (single driver: default row, else lowest sort order, else the hard-coded fallback) exists but the Translator only uses the chain iterator.
  6. A driver "fails" when it returns null (HTTP error, timeout of 4 seconds, empty text, or output identical to input); the Translator then moves on. There is no per-provider retry, backoff or circuit breaker except MyMemory's internal one.
  7. The chain is rebuilt from the DB on every call (no caching), so admin changes apply immediately.
- **Async & events:** None.
- **External systems:** Driver endpoints (see driver features).
- **Settings:** `translation.official_only`; workspace `data_residency`; rows' `is_active`, `is_default`, `sort_order`.
- **Acceptance criteria:**
  - Given active rows MyMemory (default, sort 1), GTX (sort 2) and DeepL (sort 0), when the chain is built, then order is MyMemory, DeepL, GTX, then the synthetic MyMemory fallback.
  - Given the first driver returns null, when a translation runs, then the second is called and its result is used.
  - Given all drivers fail, when a translation runs, then null is returned to the caller.
  - Given lockdown ON, then the chain contains only DeepL/Google Cloud and no synthetic fallback.
- **Source refs:** `app/Services/Translation/TranslationProviderManager.php`, `app/Services/Translator.php`, `app/Models/TranslationProvider.php`.
- **Port notes:** Implement as a `ProviderRouter` with an explicit health/circuit breaker per provider (generalize the MyMemory breaker), and cap total latency per message (worst case in WaDesk is 4 s x number of drivers).

### WD-I18N-020 — Per-workspace data-residency provider filter

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-I18N-019
- **Summary:** A workspace can restrict where its customer text may be sent for translation. The provider router honors that per call, so an EU-strict workspace and an unrestricted one can share one install.
- **Actors & access:** Set by workspace owners on Settings (route `POST settings/data-residency`, `SettingsTabsController@updateResidency`, owned by WSP: validation `data_residency` required in any, eu_only, local; audit `data_residency_changed`; the package flag `access_data_residency` is Enterprise-only in the seed, the controller itself does not check it). Enforced here for every translation call made while a user is authenticated.
- **UX & screens:** Settings tab (WSP) plus the platform legal page `legal/data-processing` (closure route `GET legal/data-processing`, view `resources/views/legal/data-processing.blade.php`) which lists each provider's data-handling terms and the three modes. Flash on save: translation routing respects the new setting on the next inbound.
- **Endpoints:** none owned here (see WSP for `POST settings/data-residency`).
- **Data:** `workspaces.data_residency` varchar(16) default `any`. Constant `Workspace::RESIDENCY_ALLOWED_SLUGS`: any = no restriction; eu_only = deepl, libretranslate; local = libretranslate only.
- **Rules & edge cases:**
  1. Evaluated with `auth()->user()->currentWorkspace`; for calls made without an authenticated user (queue jobs, console commands such as the backfill, webhook requests) there is no workspace so NO restriction applies (QUIRK: residency is silently bypassed for background and inbound-webhook translation, e.g. the inbox observer runs during `app()->terminating` of a webhook request where `auth()` is empty; ledger rows there get `workspace_id = NULL` as well).
  2. In eu_only/local modes the hard-coded MyMemory fallback is also blocked (never silently falling to the public endpoint).
  3. If the mode leaves no allowed active provider, translation returns null and callers fall back to untranslated text.
  4. Errors resolving the workspace return "no restriction".
- **Async & events:** none.
- **External systems:** none.
- **Settings:** workspace `data_residency`.
- **Acceptance criteria:**
  - Given a workspace with `local` and only LibreTranslate active, when an authenticated user triggers a translation, then only LibreTranslate is contacted.
  - Given `eu_only`, then DeepL and LibreTranslate are eligible, and MyMemory/GTX/Google Cloud are never called.
  - Given `any`, then no filtering.
  - Given a translation triggered inside a webhook (no auth user), then no workspace filter is applied (parity; the port should fix this by passing workspace context explicitly).
- **Source refs:** `app/Services/Translation/TranslationProviderManager.php`, `app/Models/Workspace.php`, `app/Http/Controllers/SettingsTabsController.php`, `resources/views/legal/data-processing.blade.php`, `app/Models/Package.php`.
- **Port notes:** Pass `workspaceId` explicitly into the translation service (do not rely on ambient auth). Residency in the new stack should also apply to background jobs; store mode on the tenant row.

### WD-I18N-021 — Translator: layered translate (dictionary, cache, chain)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-I18N-019, WD-I18N-023
- **Summary:** `Translator::translate(text, from, to)` is the single entry point for text translation. It answers from an offline dictionary, then a 24-hour cache, then the provider chain, and records a usage row only when a real API call was attempted.
- **Actors & access:** Internal service (auto-reply, inbox, AI, ordering helpers).
- **UX & screens:** None.
- **Endpoints:** none.
- **Data:** Cache key `translate:<from>:<to>:<md5(text)>` for 86,400 s in the default cache store (result string, or the sentinel `__null__` for a cached failure).
- **Rules & edge cases:**
  1. Trims the text; empty returns empty. Lowercases and trims language codes; `from == to` returns the trimmed text unchanged.
  2. Order: dictionary lookup (WD-I18N-023), then cache, then chain.
  3. Failures are cached too (24 h negative cache) so a repeated failing phrase does not re-hit providers for a day, even if a provider is fixed in the meantime (QUIRK).
  4. The cache key ignores which provider produced the value and ignores workspace residency/lockdown; switching lockdown does not invalidate cached translations that came from a now-forbidden provider (QUIRK).
  5. Success requires a non-null candidate; drivers return null for empty output or output equal (case-insensitively) to the input, so a phrase that legitimately does not change (a brand name) is treated as failure and cached as null.
  6. `fanOut(text, from, targets)` loops `translate` sequentially over target codes and returns only successes (the docblock claims parallel `Http::pool` batching; the implementation is sequential, so 80 targets can take a long time).
  7. Usage is recorded through WD-I18N-029 with `was_fallback = (drivers tried > 1)`.
  8. No length limit is enforced by the Translator; provider limits apply (MyMemory query length, etc.).
  9. Language codes are passed through as-is to providers; no normalization between ISO variants (`zh` vs `zh-CN`, `iw` vs `he`).
- **Async & events:** none (synchronous, blocking HTTP with 4 s per driver).
- **External systems:** Provider APIs via drivers.
- **Settings:** none directly.
- **Acceptance criteria:**
  - Given "hello" from en to es and the phrase is in the dictionary, when translated, then "hola" returns with no provider call and no usage row.
  - Given a phrase translated moments ago, when requested again, then the cached value returns with no provider call.
  - Given a provider failure on all drivers, when requested, then null is returned and the failure is cached for 24 h.
  - Given from equals to, then the input is returned unchanged.
  - Given a successful call by the second driver in the chain, then a usage row exists with `was_fallback=1` and that driver's slug.
- **Source refs:** `app/Services/Translator.php`, `app/Services/CommonPhrasesDictionary.php`, `app/Services/Translation/TranslationProviderManager.php`.
- **Port notes:** `TranslationService.translate()` in `apps/api/src/modules/i18n/translation/`. Use Redis for the cache with TTL 24h; include tenant residency and lockdown state in the cache namespace or skip cross-tenant cache when residency is not `any`. Make fan-out a BullMQ job with bounded concurrency. Treat "identical output" as success-with-no-change instead of failure.

### WD-I18N-022 — Translator: detect-and-translate and detect

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-I18N-021, WD-I18N-031
- **Summary:** One call that both identifies the language of a message and translates it into a target language; plus a detect-only convenience. This is the primary call for inbox translation, AI hints and the universal auto-reply fallback.
- **Actors & access:** Internal service.
- **UX & screens:** None.
- **Endpoints:** none.
- **Data:** Cache key `translate:auto:<target>:<md5(text)>` for 24 h storing the `{language, text}` array (only arrays are read back, so a failed result is cached too as an array of nulls).
- **Rules & edge cases:**
  1. Return shape `{language: ?string, text: ?string}`. Empty text returns both null. Target code lowercased and trimmed.
  2. No dictionary step (dictionary needs a known source language).
  3. Chain loop: a driver's result with both language and text ends the loop; partial results are merged (first language seen, first text seen) and the loop continues to the next driver. Usage is attributed to the first driver that produced a language or a full result.
  4. Base-class default (used by drivers with no native auto-detect, e.g. GTX overrides; the default is used by nobody today because all five drivers override it) would detect via the script detector then translate; when the detected language equals the target it returns the original text.
  5. `detect(text)` = `detectAndTranslate(text, 'en')['language']`, so a detect call costs a translation call (billable) and shares the cache with the en-target translation.
  6. Latin-script languages are detected only by the remote provider's own auto-detect; the offline script detector cannot distinguish them.
  7. Ledger entry: `source_lang` = detected language or the literal `auto`, `target_lang` = target. A row is written only when some driver produced a language or a full result (the served-by slug is set on partial success too, so a row can exist for a call that returned a language but no text); total failure logs nothing.
- **Async & events:** none.
- **External systems:** Provider auto-detect endpoints: MyMemory `Autodetect|<target>` langpair; Google GTX `sl=auto`; LibreTranslate `source=auto`; DeepL omits `source_lang`; Google Cloud omits `source`.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a Spanish sentence and target `en`, when `detectAndTranslate` runs with a working provider, then language `es` and the English text are returned and one usage row is written.
  - Given the first driver detects the language but returns no text, when the next driver returns text, then the merged result carries both.
  - Given all drivers fail, then `{language:null, text:null}` is returned.
  - Given `detect()` is called and then `detectAndTranslate(text,'en')` for the same text, then the second call is served from cache.
- **Source refs:** `app/Services/Translator.php`, `app/Services/Translation/AbstractTranslatorDriver.php`, `app/Services/Translation/Drivers/*`.
- **Port notes:** Model the result as a typed object; keep partial-result merging. Separate cheap detection (script heuristics + optional detector like cld3/fastText) from paid translation to avoid billing detect-only calls.

### WD-I18N-023 — Common-phrases offline dictionary

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** none
- **Summary:** A bundled file of frequent short customer words with hand-curated translations that is consulted before any cache or API, giving instant, free and consistent results for words that free engines often mistranslate.
- **Actors & access:** Internal.
- **UX & screens:** None.
- **Endpoints:** none.
- **Data:** `database/data/common-phrases.json`: 12 canonical English keys (hello, hi, thanks, yes, no, help, card, price, payment, info, ok, please), each mapping to a language-code object for 30 languages (ar bn de el en es fa fi fr he hi id it ja ko ms nl pl pt ru sv sw ta te th tr uk ur vi zh). Loaded once per process into a static array; a missing or invalid file yields an empty dictionary silently.
- **Rules & edge cases:**
  1. Lookup lowercases and trims the phrase; `from == to` returns the lowercased phrase.
  2. Reverse resolution: for a non-English source the phrase is matched against each canonical entry's value in the source language (case-insensitive equality), then the target-language value is returned (pivot through the English key). Only whole-phrase equality; no partial or multi-word matching.
  3. Returns null on any miss so the caller continues to cache/API.
  4. The returned string is the dictionary's own casing (lowercase for Latin scripts); the dictionary result is not cached and never logged in the usage ledger.
  5. Codes are the base language codes (`zh`, not `zh-CN`).
  6. Docs call it "approximately 50 phrases x 30 languages"; the shipped file has 12 phrases (docs overstate).
  7. `CommonPhrasesDictionary::flush()` clears the in-process cache (test helper).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given "hello" en to ko, when looked up, then the Korean greeting from the file is returned with no network call.
  - Given a Hindi word that matches the Hindi form of "thanks", when translated hi to es, then the Spanish form is returned via the English pivot.
  - Given a phrase not in the file, then null is returned.
  - Given the file is absent, then lookups return null without error.
- **Source refs:** `app/Services/CommonPhrasesDictionary.php`, `database/data/common-phrases.json`, `Documentation/pages/admin-panel/translation.html`.
- **Port notes:** Rebuild our own curated list (do not copy WaDesk's file) as a versioned JSON/DB table extensible by admins; keep pivot-through-English design or key by concept id.

### WD-I18N-024 — MyMemory driver with circuit breaker

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-I18N-019
- **Summary:** Free, keyless translation via the MyMemory public API (default provider). It opens a one-hour circuit breaker when the quota is exhausted so the rest of the chain is used without paying timeouts.
- **Actors & access:** Internal; configured in WD-I18N-015.
- **UX & screens:** Card credential: optional `admin_email` (text). Hint: raises daily quota from 5k to 50k requests per IP.
- **Endpoints:** none owned (outbound HTTP).
- **Data:** Cache key `translate:mymemory:breaker` (1 h TTL). Credential map `{admin_email?}`.
- **Rules & edge cases:**
  1. Outbound GET `https://api.mymemory.translated.net/get` with `q`, `langpair=<from>|<to>` and `de=<admin_email>` when set; 4 s timeout.
  2. Auto-detect uses `langpair=Autodetect|<target>` and reads the detected language from `matches[0].source` (folded to the two-letter prefix before the dash). `matches` may be a string; guarded.
  3. Breaker trips when the JSON status is 429, the HTTP status is 429, or the translated text starts with the string "MYMEMORY WARNING" (they return HTTP 200 with a warning as the text). While tripped, both methods return failure instantly. A log line is written.
  4. Success requires a non-empty translated string that differs (case-insensitive) from the input.
  5. Failure or HTTP error returns null (no exceptions).
  6. Documentation quotes 5k/day anonymous and 50k with an email; the seeded description says 50k with admin email.
  7. Sends customer text to a third party without a contract (see legal page).
- **Async & events:** none.
- **External systems:** MyMemory (translated.net). Auth: none. Rate limit: 5k or 50k chars-requests per day per IP. Credential location: `translation_providers.credentials`.
- **Settings:** `admin_email` credential.
- **Acceptance criteria:**
  - Given a normal call, when MyMemory returns a translation, then it is returned.
  - Given a quota-warning body, when received, then the breaker key is set for one hour and that call and subsequent calls return failure without HTTP.
  - Given the response text equals the input, then failure is returned.
  - Given `admin_email` is set, then the request includes the `de` parameter.
- **Source refs:** `app/Services/Translation/Drivers/MyMemoryDriver.php`, `app/Services/Translation/AbstractTranslatorDriver.php`.
- **Port notes:** Adapter with a shared Redis breaker keyed by provider; also breaker on repeated 5xx/timeouts for all adapters.

### WD-I18N-025 — Google GTX (unofficial) driver

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-I18N-019
- **Summary:** Keyless translation through the unofficial endpoint behind translate.google.com; best free quality but unsupported and may stop working. Active by default as MyMemory's rescue.
- **Actors & access:** Internal. No credentials (the card says none required).
- **UX & screens:** Card with the "No credentials required" box; description "Google (free) - best quality, free, but unofficial endpoint - may break without notice."
- **Endpoints:** none owned.
- **Data:** none.
- **Rules & edge cases:**
  1. GET `https://translate.googleapis.com/translate_a/single` with `client=gtx`, `sl`, `tl`, `dt=t`, `q`; header `User-Agent: Mozilla/5.0`; 4 s timeout.
  2. Result is the concatenation of the first element of each segment in the first array; trimmed; treated as failure when empty or equal (case-insensitive) to the input.
  3. Auto-detect uses `sl=auto` and reads the detected language from the third element of the response.
  4. Counts as UNOFFICIAL for lockdown.
  5. Query string carries the customer text (URL logging on the vendor side).
  6. Class docs claim it overrides `fanOut` for parallel calls; no such override exists.
- **Async & events:** none.
- **External systems:** Google translate_a endpoint, anonymous, no documented rate limit.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a working endpoint, when translating es to en, then the concatenated segments are returned.
  - Given `detectAndTranslate`, then the response's detected language is lowercased and returned with the text.
  - Given lockdown ON, then this driver is never called.
- **Source refs:** `app/Services/Translation/Drivers/GoogleGtxDriver.php`.
- **Port notes:** Consider not porting this driver (terms-of-service risk); if kept, default it to OFF and label it clearly.

### WD-I18N-026 — LibreTranslate driver

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-I18N-019
- **Summary:** Translate through a self-hosted (or hosted) LibreTranslate server so no customer data leaves the operator's infrastructure.
- **Actors & access:** Internal; configured by admin.
- **UX & screens:** Two fields: `endpoint` (text, required, placeholder http://localhost:5000, hint about the Docker default) and `api_key` (password, optional, for the hosted tier).
- **Endpoints:** none owned.
- **Data:** Credential map `{endpoint, api_key?}`.
- **Rules & edge cases:**
  1. POST JSON to `<endpoint>/translate` with `q`, `source`, `target`, `format=text`, and `api_key` when set; trailing slash on the endpoint trimmed; 4 s timeout.
  2. Auto-detect sends `source=auto` and reads `detectedLanguage.language` from the response.
  3. Missing/blank endpoint returns failure.
  4. Same "identical output is failure" rule.
  5. Allowed under `eu_only` and `local` residency; unofficial for lockdown.
  6. No SSRF protection: the admin-entered endpoint may point at internal hosts (admin-trusted).
- **Async & events:** none.
- **External systems:** LibreTranslate server (self-hosted or libretranslate.com), optional API key in body.
- **Settings:** endpoint, api_key.
- **Acceptance criteria:**
  - Given a reachable server, when translating, then the `translatedText` value is returned.
  - Given no endpoint saved, then activation is refused (required field) and calls fail closed.
  - Given `local` residency, then only this driver is used.
- **Source refs:** `app/Services/Translation/Drivers/LibreTranslateDriver.php`.
- **Port notes:** Validate the endpoint URL scheme and block link-local/metadata addresses in the port.

### WD-I18N-027 — DeepL driver

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-I18N-019
- **Summary:** Official DeepL API translation, premium quality for European languages. Free-tier keys (ending in `:fx`) route to the free host automatically.
- **Actors & access:** Internal; needs an API key.
- **UX & screens:** Field `api_key` (password, required) with hint on free tier (500k chars/month) and where to get a key.
- **Endpoints:** none owned.
- **Data:** Credential `{api_key}`.
- **Rules & edge cases:**
  1. POST JSON `{text:[..], source_lang:UPPER, target_lang:UPPER}` to `https://api-free.deepl.com/v2/translate` when the key ends with `:fx`, else `https://api.deepl.com/v2/translate`; header `Authorization: DeepL-Auth-Key <key>`; 4 s timeout.
  2. Auto-detect omits `source_lang` and reads `detected_source_language` from the response (lowercased).
  3. Language codes are just uppercased; DeepL-specific variants (EN-US, PT-BR, ZH) and unsupported languages (about 30 supported) are not mapped; unsupported pairs simply fail and the chain continues.
  4. Failure or identical output returns null. Missing key returns null.
  5. Official (kept under lockdown), EU-eligible (residency eu_only).
  6. Estimated cost 20 micro-USD per character in the ledger even for free-tier keys (see WD-I18N-029).
- **Async & events:** none.
- **External systems:** DeepL API v2; key in `translation_providers.credentials`.
- **Settings:** api_key.
- **Acceptance criteria:**
  - Given a key ending `:fx`, when translating, then the request goes to the free host.
  - Given a Pro key, then the request goes to the Pro host.
  - Given auto-detect, then the detected source language is returned lowercase.
  - Given no key, then the driver returns failure without HTTP.
- **Source refs:** `app/Services/Translation/Drivers/DeepLDriver.php`.
- **Port notes:** Map our ISO codes to DeepL target codes (regional variants) and cache the supported-languages list.

### WD-I18N-028 — Google Cloud Translation driver

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-I18N-019
- **Summary:** Official Google Cloud Translation v2 REST API using a plain API key; stable contract, paid at roughly USD 20 per million characters.
- **Actors & access:** Internal; requires an API key.
- **UX & screens:** Field `api_key` (password, required) with hint about enabling Cloud Translation API.
- **Endpoints:** none owned.
- **Data:** Credential `{api_key}`.
- **Rules & edge cases:**
  1. POST JSON to `https://translation.googleapis.com/language/translate/v2?key=<urlencoded key>` with `q`, `source`, `target`, `format=text`. The key travels in the query string (may appear in vendor/proxy logs).
  2. Auto-detect omits `source` and reads `detectedSourceLanguage`.
  3. Same identical-output failure rule; missing key returns failure.
  4. Official for lockdown; excluded from `eu_only` and `local` residency.
  5. Docs mention "API key / credentials"; only the API key is implemented (no service-account/OAuth v3).
- **Async & events:** none.
- **External systems:** Google Cloud Translation API v2, API key auth, 4 s timeout.
- **Settings:** api_key.
- **Acceptance criteria:**
  - Given a valid key, when translating, then the translated text is returned.
  - Given auto-detect, then `detectedSourceLanguage` is returned lowercase.
  - Given residency `eu_only`, then this driver is never called.
- **Source refs:** `app/Services/Translation/Drivers/GoogleCloudDriver.php`.
- **Port notes:** Prefer v3/service-account auth and send the key in a header. Note batch translate to reduce fan-out cost.

### WD-I18N-029 — Translation usage ledger and cost estimation

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-I18N-021
- **Summary:** Every provider call attempt made by the Translator is recorded with characters, provider, language pair, workspace and an estimated cost, so cost can be reviewed. Dictionary and cache hits are intentionally not recorded.
- **Actors & access:** System writer; read by WD-I18N-030 and the workspace Account translation tab.
- **UX & screens:** Feeds two screens: admin dashboard and the workspace "This month" card (characters in+out and message count).
- **Endpoints:** none.
- **Data:** Inserts into `translation_usage`: `workspace_id` (current authenticated user's current workspace id, else NULL), `provider_slug` (slug of the driver that served the request), `source_lang`, `target_lang` (varchar 8), `chars_in` (mb length of input), `chars_out` (mb length of result, 0 on none), `cost_micros` (rate x chars_in), `was_fallback` (true when more than one driver was tried), `called_at` now. Cost table (micro-USD per input char): deepl 20, google_cloud 20, mymemory 0, libretranslate 0, google_gtx 0 (`PROVIDER_COST_MICROS_PER_CHAR`); unknown slug 0.
- **Rules & edge cases:**
  1. Only logged when a provider slug is known: if every driver failed (`servedBy` null) NOTHING is logged, contradicting the code comment that failures still log.
  2. `was_fallback` means "more than one driver was tried"; drivers skipped by lockdown or residency are never yielded, so the flag reflects real attempts only.
  3. Failed attempts made by earlier drivers before a later success are not logged individually and their cost (if any) is not counted.
  4. Cost is estimated on input characters only; DeepL free-tier calls are still costed at the paid rate.
  5. Insert errors are swallowed.
  6. `translation_usage` has no timestamps besides `called_at`, no FK on `workspace_id`, and is append-only with no retention job; volume equals the count of provider calls (can be large under fan-out).
  7. Rows written from webhook/queue contexts have `workspace_id` NULL (see WD-I18N-020), so per-workspace usage undercounts inbound translation, which is the main consumer.
- **Async & events:** synchronous insert, no queue.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a DeepL translation of 100 characters, when it succeeds, then one row exists with chars_in 100, cost_micros 2000 and was_fallback false.
  - Given a dictionary or cache hit, then no row is written.
  - Given all providers failed, then no row is written.
  - Given MyMemory failed and GTX served, then the row has provider_slug `google_gtx` and was_fallback true.
- **Source refs:** `app/Services/Translator.php`, `app/Models/TranslationUsage.php`, `database/migrations/2026_05_20_020000_create_translation_usage_table.php`.
- **Port notes:** `translation_usage` in Postgres with `tenant_id` (nullable for platform), partition by month, index (tenant, called_at) and (provider, called_at). Log failures as separate rows with status. Pass tenant context explicitly. Store cost in micros bigint; make rates configurable rather than hard-coded.

### WD-I18N-030 — Admin translation usage dashboard

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-I18N-029
- **Summary:** Read-only report of translation volume and estimated cost for a date range: headline totals, per-provider breakdown, a 30-day bar chart and the top ten spending workspaces.
- **Actors & access:** Platform admins. No mutations. No sidebar link exists (URL only).
- **UX & screens:** `resources/views/admin/translation-usage/index.blade.php`. Title "Translation usage" and intro (wire calls only; dictionary and cache hits are not billable). Filter form (GET) with From and To date inputs and Apply. Four cards: Wire calls (count, with "~N% served from cache / dictionary" when computable), Chars translated (chars_in with "out: chars_out"), Estimated cost (formatted USD via `FormatSettings::display`, "based on published per-char rates"), Fallback hits (count where `was_fallback`). "By provider" table: provider slug, calls, chars in, cost, rate per 1M chars (rate shown as the per-char micro value formatted as USD, or "free"); empty state "No translation calls in this range..." "Last 30 days" bar chart (30-column grid; bar height proportional to daily chars_in, minimum 2px; tooltip date, chars, cost) shown only when data exists. "Top spending workspaces" table (workspace name linked to the admin workspace detail route, or "unassigned" for NULL; calls, chars, cost) with empty state "No paid-tier translations in this range."
- **Endpoints:**

| Endpoint                    | Route name              | Controller@action                      | Middleware                                   | Request                                       | Response  |
| --------------------------- | ----------------------- | -------------------------------------- | -------------------------------------------- | --------------------------------------------- | --------- |
| GET admin/translation-usage | admin.translation-usage | Admin\TranslationUsageController@index | Authenticate, EnsureUserIsAdmin, IPAllowlist | query `from`, `to` (any Carbon-parsable date) | HTML view |

- **Data:** From = start of given day, else start of the current month; To = end of given day, else now. Filters `translation_usage.called_at BETWEEN`. Totals: COUNT, SUM(chars_in), SUM(chars_out), SUM(cost_micros), SUM(was_fallback=1). Per provider: group by `provider_slug`, order by calls desc. Timeline: last 30 days from now (intersected with the range), grouped by DATE(called_at) ascending. Top workspaces: grouped by `workspace_id`, order by cost desc then chars desc, limit 10, names from `workspaces`. Cache ratio: `100 x (1 - apiCalls / repliesFired)` clamped 0..100 where repliesFired = count of `keyword_reply_logs.fired_at` in range; null (hidden) when there are no keyword-reply logs.
- **Rules & edge cases:**
  1. No validation on `from`/`to`: an unparsable date throws a 500 (Carbon parse exception); a from later than to returns empty sets.
  2. The cache-ratio is a rough inference against auto-reply fires only; inbox/AI translation calls inflate the ratio negatively (clamped to 0) and it ignores them otherwise (QUIRK).
  3. Cost is shown in USD using platform formatting, not the platform default currency.
  4. The "Top spending workspaces" section title in the empty text implies "paid-tier" but includes free providers with 0 cost when they have calls (ordering falls to chars).
  5. No export, no pagination, no per-language breakdown.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given usage rows this month, when the admin opens the page without filters, then totals cover the month-to-date range.
  - Given From/To filters, when applied, then all sections reflect only rows within [start of From, end of To].
  - Given rows from two providers, then the per-provider table lists them by calls desc with a rate of "free" for MyMemory.
  - Given no rows, then the empty states show and the timeline is hidden.
  - Given a row with NULL workspace, then it appears as "unassigned" in top workspaces.
- **Source refs:** `app/Http/Controllers/Admin/TranslationUsageController.php`, `app/Models/TranslationUsage.php`, `resources/views/admin/translation-usage/index.blade.php`, `Documentation/pages/admin-panel/translation.html`.
- **Port notes:** `GET /api/v1/admin/translation/usage?from&to` returning the aggregated payload; validate dates; add per-language and per-tenant drill-down and CSV export. Recompute the "cache saved" ratio from real lookup counters (dictionary/cache hit metrics) instead of inferring.

### WD-I18N-031 — Script-based language detector

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** none
- **Summary:** A dependency-free detector that classifies the dominant non-Latin writing system of a text by Unicode code point ranges and returns a two-letter code, with a caller-supplied fallback for Latin-script or undetermined text. It also owns the code-to-English-name map used by the UI.
- **Actors & access:** Internal service `LanguageDetector`; used by auto-reply lookup (detected language for logs and reply variant choice) and as the base-class default detector for translation drivers.
- **UX & screens:** None directly; `displayName(code)` labels translation chips.
- **Endpoints:** none.
- **Data:** Constant range table (first match wins, checked in this order): Hangul (syllables, jamo, compatibility jamo) = ko; Hiragana, Katakana = ja; Devanagari = hi; Bengali = bn; Gurmukhi = pa; Gujarati = gu; Oriya = or; Tamil = ta; Telugu = te; Kannada = kn; Malayalam = ml; Sinhala = si; Arabic and Arabic Supplement = ar; Hebrew = he; Syriac = ar; Thai = th; Lao = lo; Myanmar = my; Khmer = km; Buginese = su; Cyrillic = ru; Greek = el; Armenian = hy; Georgian = ka; Ethiopic = am; CJK Unified Ideographs and Extension A = zh. Name map `LANGUAGE_NAMES` with about 60 ISO 639-1 codes (en, es, fr, de, it, pt, nl, pl, ru, uk, tr, ar, he, fa, hi, bn, pa, gu, or, ta, te, kn, ml, si, mr, ne, ur, th, lo, my, km, vi, id, ms, tl, zh, ja, ko, el, hy, ka, am, sw, yo, ha, zu, af, cs, sk, hu, ro, bg, sr, hr, sv, no, da, fi).
- **Rules & edge cases:**
  1. `detect(text, fallback='en')`: trim; empty returns the fallback (or `en` if null). Each character below U+0100 and in U+0100 to U+024F (Latin, Latin Extended-A/B) is ignored. Other characters are tallied by the first matching range; the language with the highest tally wins (ties resolve to the first-seen). If nothing tallied, the fallback is returned.
  2. QUIRK: counts characters, so a Japanese sentence with more kanji than kana is classified `zh`; Urdu, Persian and Pashto text (Arabic script) is classified `ar`; Ukrainian/Serbian/Bulgarian are classified `ru`; Marathi/Nepali are `hi`. The 21-language UI pack includes `ur`, which this detector can never return.
  3. Latin-script languages (es, fr, de, pt, id, vi, tr, pl, nl, it) can never be detected here; callers pass the workspace default language as the fallback (auto-reply passes `workspace.default_language` or `en`).
  4. Characters outside the table (emoji, punctuation, digits, IPA, Vietnamese tone marks in the combining block) are ignored.
  5. `isLatin(text)` returns true for empty text or text made only of ASCII/Latin-1/Latin Extended-A/B and whitespace (regex over the full string).
  6. `displayName` returns the mapped English name or the uppercased code.
  7. Class header says "18 highest-volume scripts"; the table has about 30 script entries.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given Korean text, when detected, then `ko` is returned; given Devanagari text, then `hi`.
  - Given "Hola, necesito ayuda" with fallback `es`, then `es` is returned (fallback), and with no fallback then `en`.
  - Given mixed "hii 안녕", then `ko` (dominant non-Latin script).
  - Given kanji-only text, then `zh`.
  - Given an empty string, then the fallback.
- **Source refs:** `app/Services/LanguageDetector.php`, `app/Http/Controllers/AutoReplyController.php`, `app/Services/Translation/AbstractTranslatorDriver.php`.
- **Port notes:** Implement as a pure function in `packages/i18n`. Improve on the quirks (kana priority for ja, Urdu distinguishing letters, Cyrillic sub-detection) or wrap a statistical detector for Latin languages, but keep the script heuristic as the free first pass.

### WD-I18N-032 — Keyword fan-out translation manager

- **Status:** partial
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-I18N-021
- **Summary:** Service that pre-translates an auto-reply keyword and each of its text reply variants into a workspace's list of target languages and stores the results as JSON maps on the rows. In v1.7.0 it is only run by the backfill command; saving an auto-reply in the UI does not call it (the save is deliberately instant and translation is lazy at runtime).
- **Actors & access:** Internal service; invoked by WD-I18N-033 and (per its own docblock, no longer) the auto-reply controller.
- **UX & screens:** None. Workspace setting `auto_translate_languages` has no editor UI in this version (no view writes it), only the model/migration.
- **Endpoints:** none.
- **Data:** Writes `keyword_replies.keyword_translations` (JSON map `{code: keyword}`; always includes the canonical language key) and `keyword_replies.canonical_language` (varchar 8, default `en`); writes `keyword_reply_contents.content_translations` (JSON map `{code: text}`) for variants with `content_type = text` and non-empty content. Reads `workspaces.auto_translate_languages` (JSON array of codes) and `workspaces.default_language`.
- **Rules & edge cases:**
  1. Source language = row's `canonical_language`, else workspace default language, else `en`.
  2. Targets = explicit argument, else the workspace's array (unique, order preserved) when non-empty, else `DEFAULT_TARGETS` (111 codes covering Indic, Iranian, Dravidian, East/SE Asian, Semitic, Turkic, Romance, Germanic, Slavic, other European, African, Caucasus, and misc such as eo, la, haw). The list includes codes (`zh-tw`, `jw`, `ceb`, `hmn`, `haw`) that some providers do not accept.
  3. Keyword map always starts with the canonical entry; each target that translates successfully is added; failures are simply omitted (partial maps are normal).
  4. Media variants (image, video, document, template) are not translated; the same file is sent regardless of language (captions on media variants share the text variant map only when `content_type=text`; `pickContent` is also used for captions at send time).
  5. Fan-out is sequential (see WD-I18N-021), so a full 111-language run makes up to 111 x (1 keyword + N variants) provider calls; the docblock's "15-25 seconds" and "Http::pool parallel" claims do not hold.
  6. QUIRK: the AutoReplyController docblock and `KeywordTranslationManager` header say it is called on store/update; the controller explicitly does not (comment: save is instant; lazy runtime path fills in). So `keyword_translations` stays NULL for new rows until the backfill command runs.
  7. Multi-keyword rows: the `keyword` column can hold comma-separated phrases; the whole string is translated as one text.
  8. `targetsFor(null)` returns the default list.
- **Async & events:** none (synchronous).
- **External systems:** Providers via Translator.
- **Settings:** workspace `auto_translate_languages`, `default_language`.
- **Acceptance criteria:**
  - Given a keyword "hello" (canonical en) and targets [es, hi], when translated, then `keyword_translations` = {en: "hello", es: <es>, hi: <hi>} and each text variant has a content map with the canonical entry plus the successful targets.
  - Given a target for which translation fails, then that language is absent from the map and the save still succeeds.
  - Given an image variant, then `content_translations` is not written.
  - Given a workspace with `auto_translate_languages=["es"]`, then only `es` (plus canonical) is generated.
- **Source refs:** `app/Services/KeywordTranslationManager.php`, `app/Models/KeywordReply.php`, `app/Models/KeywordReplyContent.php`, `database/migrations/2026_05_19_010000_multilingual_keyword_replies.php`, `app/Http/Controllers/AutoReplyController.php`.
- **Port notes:** Implement as a BullMQ job "translate-auto-reply" enqueued after rule save (optional, off by default), with per-language rows in a child table instead of JSON blobs, and bounded concurrency. Expose the target-language list as a real workspace setting.

### WD-I18N-033 — Backfill command auto-reply:translate-existing

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-I18N-032
- **Summary:** An artisan command that translates every existing auto-reply keyword and reply text into the owning workspace's target languages.
- **Actors & access:** Operator at the CLI (not scheduled; not in `schedule.txt`).
- **UX & screens:** Console output: progress bar, per-row warnings, final "Done. N translated, M failed."
- **Endpoints:** none. Command signature: `auto-reply:translate-existing {--workspace=} {--force}`.
- **Data:** Selects `keyword_replies` (with contents and workspace) in chunks of 50 by id; without `--force` only rows where `keyword_translations IS NULL`; `--workspace=<id>` filters by workspace. Calls `KeywordTranslationManager::translateForKeyword` per row.
- **Rules & edge cases:**
  1. Nothing to do prints "Nothing to backfill" and exits 0.
  2. Exit code 1 if any row failed (exceptions per row are caught and reported; provider failures do not raise, they just leave gaps).
  3. Safe to re-run because the Translator caches for 24 h, but failures are cached for 24 h too, so a re-run within a day will not retry failed pairs.
  4. Runs with no authenticated user: no workspace residency filter and ledger rows with `workspace_id NULL` (see WD-I18N-020/029).
- **Async & events:** none.
- **External systems:** Translation providers.
- **Settings:** option flags above.
- **Acceptance criteria:**
  - Given three rules with null translations, when the command runs without flags, then all three are processed and the summary reports 3 translated.
  - Given rules already translated, when run without `--force`, then they are skipped; with `--force` they are re-translated.
  - Given `--workspace=12`, then only workspace 12 rules are processed.
- **Source refs:** `app/Console/Commands/BackfillKeywordTranslations.php`.
- **Port notes:** Expose as an admin action or CLI `nest` command that enqueues jobs; pass workspace context.

### WD-I18N-034 — Multilingual auto-reply matching and reply pick

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-I18N-032, WD-I18N-022
- **Summary:** How translation is used when an inbound WhatsApp message is matched against auto-reply rules and a reply is chosen. The matching engine itself belongs to AR; this entry records the translation-specific behavior so it is rebuilt correctly.
- **Actors & access:** Internal (called by the Node bridge's auto-reply lookup, endpoint owned by AR/NODE); end-customer is the beneficiary. No plan gate in this path.
- **UX & screens:** None here. Auto-reply analytics store `detected_language` per fire.
- **Endpoints:** none owned (lookup lives in `AutoReplyController`, owned by AR).
- **Data:** Reads `keyword_replies.keyword_translations`, `canonical_language`; `keyword_reply_contents.content_translations`; writes `keyword_reply_logs.detected_language` (varchar 8) with `matched_text`, `matched_variant`.
- **Rules & edge cases:**
  1. Stage order in the lookup: exact/contains/fuzzy SQL match on the canonical keyword; then (1.5a) walk rules with stored translations and use `matchesTranslation` (case-insensitive equality against each stored language value, or substring when the rule's method is `contains`; the first matching language code wins); then (1.5b) universal fallback: `Translator::detectAndTranslate(message, 'en')`; if a non-English language was detected and text produced, re-run the canonical SQL match with the English translation; then fuzzy matching over fuzzy rules.
  2. The language used for the log and for reply variant selection is the matched translation language if one matched; otherwise `LanguageDetector::detect(message, workspace.default_language or 'en')`.
  3. `pickContent(variant, lang)`: no lang or empty content returns the canonical text; else stored `content_translations[lang]`; else if lang equals the canonical language return the original; else lazily `Translator::translate(canonical text, canonicalLang, lang)`; if that fails return the canonical text (customer still gets a reply). Lazy results are cached 24 h so the second customer in the same language is instant.
  4. Media variants: the file is language-neutral; only captions go through `pickContent` (the caption text resolved separately so JSON is not double wrapped).
  5. Only text-type keyword matching is translated; flow-type rules trigger the flow with no translation of the flow content.
  6. QUIRK: because `keyword_translations` is null on all rules created via the UI (WD-I18N-032), the (1.5a) stage is effectively a no-op until the backfill runs and the (1.5b) live path does the work at the cost of one provider call per unmatched inbound message (cached 24 h).
  7. QUIRK: (1.5b) sends every non-matching inbound text to the translation provider, including greetings unrelated to any rule, so provider usage scales with inbound volume (and residency/lockdown filters are only applied if an authenticated user context exists, which webhook-driven lookups do not have).
  8. Persisting detected language never breaks the reply path (log insert wrapped in try/catch).
- **Async & events:** synchronous inside the lookup request (Node waits); may add up to 4 s per driver.
- **External systems:** Translation providers.
- **Settings:** workspace `default_language`; provider config.
- **Acceptance criteria:**
  - Given a rule "hello" with a stored Hindi translation, when a customer sends the Hindi word, then the rule matches, the log's `detected_language` is `hi` and the Hindi reply variant is returned.
  - Given a rule with no stored translations and a Spanish message whose English translation matches "price", when the message arrives, then the rule fires and the reply is lazily translated to Spanish (or sent in English if translation fails).
  - Given an inbound in the canonical language, then no translation call is made for the reply.
  - Given a provider outage, then the canonical-language reply is still sent.
- **Source refs:** `app/Http/Controllers/AutoReplyController.php`, `app/Models/KeywordReply.php`, `app/Models/KeywordReplyContent.php`, `app/Services/KeywordTranslationManager.php`, `Documentation/pages/messaging/auto-reply.html`.
- **Port notes:** Implemented in AR's matcher; call `TranslationService` through an injected port. Add a "translate unmatched inbound" flag per workspace to avoid unbounded provider usage.

### WD-I18N-035 — Workspace translation settings (Account tab)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-I18N-008
- **Summary:** Workspace owner/members with access to the Account page choose the team working language and turn conversation auto-translation on or off, and can see how many characters were translated this month. Locked with an upgrade prompt on plans without the translation feature.
- **Actors & access:** Authenticated user with a current workspace (route under the authenticated web group, middleware `Authenticate`). Plan gate: package feature `access_translation` (Pro and Enterprise in the seed; Starter and Growth off). The controller calls the plan guard, which throws the plan-limit exception (rendered as an upgrade response) when the feature is absent; platform Admin/Super Admin bypass the gate. No role/permission key beyond authentication.
- **UX & screens:** `resources/views/user/account/index.blade.php`, pane `translation` (tab reached from the account tabs). Sections: (a) "Real-time translation" explainer with three step cards (customer writes in any language; agent replies in team language; AI and widget too). (b) When the plan allows: an "engine" card showing the active provider name (default/lowest sort active provider, else "MyMemory (free)"), text that keys are platform-wide and users never enter keys, and for platform admins a link to `/admin/translation-providers`; a "This month" card with characters (sum of chars_in + chars_out for the workspace since the start of the month) and message count (rows). (c) Settings form: checkbox "Auto-translate conversations" (name `inbox_translate`, default on) and a select "Your team language" (`default_language`) with a fixed list of 22 languages (en, es, pt, fr, de, it, ar, hi, zh, id, ms, ru, tr, ja, ko, th, vi, nl, bn, ur, ta, tl) and a Save button. Success flash "Translation settings saved." (session `translation_status`). (d) When the plan lacks the feature: an amber upgrade banner linking to `/account/plans`. The form action falls back to the literal path when the named route is missing (defensive against stale route caches).
- **Endpoints:**

| Endpoint                 | Route name                      | Controller@action                   | Middleware   | Request                                                                       | Response                                                                                                                                                                  |
| ------------------------ | ------------------------------- | ----------------------------------- | ------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST account/translation | user.account.translation.update | AccountController@updateTranslation | Authenticate | `default_language` nullable string max 12; `inbox_translate` nullable boolean | redirect back with `translation_status` "Translation settings saved."; without a workspace: back with error on `default_language`; plan gate failure: plan-limit response |

- **Data:** Updates `workspaces.default_language` (lowercased/trimmed; blank becomes `en`) and `workspaces.inbox_translate` (boolean; an unchecked box posts nothing, so absence saves false). Reads `translation_providers` (active, default first, lowest sort) and `translation_usage` for the workspace.
- **Rules & edge cases:**
  1. The submitted language is not validated against any list or against the platform registry; any string up to 12 chars is stored (the select limits normal users).
  2. The workspace `default_language` doubles as (a) the team/agent language for translation, (b) step 3 of UI locale resolution (WD-I18N-008) and (c) the auto-reply fallback language, so changing the translation language also changes the workspace members' UI language unless they have a personal choice (QUIRK: a single field with three meanings).
  3. `inbox_translate` DB default is true (existing workspaces are opted in once the plan feature is on), but this form saves false when unchecked.
  4. The saved change applies on the next message; `ConversationTranslationService` memoizes config per request only.
  5. The page counts only usage rows with this workspace's id; background translation rows have NULL workspace and are not counted (see WD-I18N-029).
  6. The settings page of Settings > Workspace (WSP) also carries a `locale` column on `workspaces` (varchar 16, default en) that nothing here reads (see Open questions).
- **Async & events:** none; no audit entry for this change.
- **External systems:** none.
- **Settings:** `workspaces.default_language`, `workspaces.inbox_translate`; plan flag `access_translation`.
- **Acceptance criteria:**
  - Given a Pro workspace, when the owner selects Spanish and saves with the box checked, then `default_language=es`, `inbox_translate=1` and a success flash shows.
  - Given a Starter workspace, when the pane opens, then an upgrade banner shows and no form; and a direct POST is rejected by the plan gate.
  - Given the box unchecked, when saved, then `inbox_translate=0` and inbox translation stops immediately for new and displayed messages (WD-I18N-038).
  - Given a platform admin viewing the tab, then the provider configuration link is visible; a normal user does not see it.
- **Source refs:** `app/Http/Controllers/AccountController.php`, `resources/views/user/account/index.blade.php`, `app/Models/Workspace.php`, `app/Services/PlanLimitGuard.php`, `database/seeders/PackageSeeder.php`, `database/migrations/2026_06_20_000100_add_conversation_translation.php`, `Documentation/pages/messaging/team-inbox.html`.
- **Port notes:** Move to Workspace settings > Translation (`PATCH /api/v1/workspace/translation-settings`). Split the three meanings of `default_language` into separate fields (UI locale default, team language for translation, auto-reply fallback language). Validate against supported codes. Gate with the plan feature service (PLAN).

### WD-I18N-036 — Inbound message auto-translate and language pinning

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-I18N-022, WD-I18N-035
- **Summary:** For each inbound message the customer's language is detected, pinned on the conversation, and, when it differs from the team language, an agent-language translation is stored beside the original. Works for every inbound channel because it is triggered from the message model's `created` hook.
- **Actors & access:** System. Effective only when the workspace has `access_translation` AND `inbox_translate` on.
- **UX & screens:** Agent sees the translated bubble with a "translated from <lang>" badge and can toggle to the original (Team Inbox UI owned by TIB1; gated by WD-I18N-038).
- **Endpoints:** none.
- **Data:** On `inbox_messages` (direction `in`): sets `detected_language` (varchar 12), `translated_body` (text, encrypted at rest via the `SafeEncrypted` cast), `is_translated` (bool). On `conversations`: `customer_language` (varchar 12) pinned once when empty. `body` is never modified for inbound messages.
- **Rules & edge cases:**
  1. Trigger: `InboxMessage::created` with `direction='in'`. The work is deferred with `app()->terminating` so it runs after the webhook response is sent; the translation therefore lands a moment later and appears on the next thread load. An id refetch avoids stale models.
  2. Skips when body is empty, the message is already `is_translated`, the conversation is missing, or config says disabled. Config = workspace `inbox_translate` (default true) AND plan feature `access_translation`; agent language = workspace `default_language` lowercased, default `en`. Config is memoized per service instance (per request).
  3. One `detectAndTranslate(body, agentLang)` call. If a language was detected and the conversation has no `customer_language`, it is pinned (research note: detect once from the first inbound; later messages do not update it, even if the customer switches language, QUIRK).
  4. If detected language differs from the agent language and text came back: store translation, detected language and `is_translated=true`. If detected equals agent language, only `detected_language` is stored.
  5. Media-only or empty-caption messages are skipped.
  6. Detection quality for very short Latin-script messages depends on the provider; the pinned language may be wrong and then persists (no re-detect, no manual override in this domain).
  7. Errors are swallowed; never blocks ingest.
  8. Runs outside an auth context, so the ledger workspace and residency filter are absent (WD-I18N-020/029).
- **Async & events:** deferred `terminating` callback (same process, after response); no queue, no broadcast event for the translation landing.
- **External systems:** Translation providers via Translator.
- **Settings:** workspace `inbox_translate`, `default_language`; plan flag.
- **Acceptance criteria:**
  - Given translation enabled with team language `en`, when a Spanish inbound arrives, then the message row gets `detected_language=es`, an English `translated_body`, `is_translated=1` and the conversation `customer_language=es`.
  - Given an English inbound, then only `detected_language=en` is stored and `is_translated` stays false.
  - Given a conversation already pinned to `es`, when a later message arrives in French, then `customer_language` remains `es`.
  - Given the plan lacks `access_translation`, then nothing is translated or pinned.
  - Given all providers fail, then the inbound message is stored normally with no translation.
- **Source refs:** `app/Services/Inbox/ConversationTranslationService.php`, `app/Models/InboxMessage.php`, `app/Models/Conversation.php`, `database/migrations/2026_06_20_000100_add_conversation_translation.php`.
- **Port notes:** Make this a BullMQ job `inbox.translate-inbound` enqueued via the outbox after the message row commits (with tenant id explicit), then emit a realtime event so the thread updates live. Allow agents to override/re-pin `customer_language`. Encrypt `translated_body` like `body`.

### WD-I18N-037 — Outbound reply auto-translate

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-I18N-036
- **Summary:** When an agent types in the team language, the reply is translated into the customer's pinned language just before it is sent, and the agent's original text is kept for the thread view. Replies already in the customer's language (AI replies) are sent as-is.
- **Actors & access:** System hook in the send path (`InboxDispatcher`); same gate as WD-I18N-036.
- **UX & screens:** In the thread, an outbound bubble shows what was actually delivered with the agent's original available (via `translated_body` and the badge; UI in TIB1).
- **Endpoints:** none (invoked inside the inbox send pipeline before the branding footer and transport dispatch).
- **Data:** On the outbound `inbox_messages` row: `translated_body` = agent's original text, `detected_language` = delivered (target) language, `is_translated=true`; in memory `body` is replaced with the translated text so transport, footer and delivery use it. The service's own column contract says `body` holds what was delivered, but the in-memory `body` mutation is made after the quiet save and the dispatcher's own footer comment says the DB row keeps what the operator typed; whether the delivered translation is persisted into `body` by a later save of the message is not determinable statically (see Open questions).
- **Rules & edge cases:**
  1. Skips when: body empty, already `is_translated`, forwarded relay (`meta.forwarded`), any template send (`template_id` column, `meta.template_id`, `meta.template_name`, or `meta.type = template`), no conversation, no pinned `customer_language`, translation disabled by config, or the customer language equals the team language.
  2. Uses one `detectAndTranslate(typed, customerLanguage)` call; if the detected source equals the target (already in customer language, e.g. AI/keyword reply) or the output is empty, the message is sent exactly as typed and nothing is flagged.
  3. Never throws into the send path; on any error the original is sent.
  4. Templates keep their authored language (WABA templates are approved per language).
  5. Ordering: runs before `applyBrandingFooter` so the footer is appended to the translated body (footer text itself is not translated).
  6. QUIRK: the translation is synchronous and blocks the send by up to 4 s per driver tried; a wrong pinned language causes wrongly-translated outbound messages with no visible warning to the agent.
  7. Media captions are handled by the same body field only if the caller routes them through this method (send pipeline decides).
- **Async & events:** synchronous within dispatch.
- **External systems:** Translation providers.
- **Settings:** workspace toggle, team language, plan flag.
- **Acceptance criteria:**
  - Given customer language `es`, team language `en` and translation on, when an agent sends "Your order ships tomorrow", then the customer receives the Spanish text and the stored row keeps the English original in `translated_body` with `is_translated=1`.
  - Given the agent types Spanish already, then it is sent unchanged.
  - Given a template send, then nothing is translated.
  - Given translation is disabled or no customer language is pinned, then the message is sent unchanged.
  - Given all providers fail, then the original text is sent.
- **Source refs:** `app/Services/Inbox/ConversationTranslationService.php`, `app/Services/InboxDispatcher.php`.
- **Port notes:** Perform translation in the send worker before provider dispatch; show a "translated for customer" preview in the composer (improvement) and log the result. Same footer ordering.

### WD-I18N-038 — Inbox thread translation display gating

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-I18N-036
- **Summary:** The team inbox only exposes stored translations while the workspace's auto-translate is currently enabled; turning it off instantly reverts all bubbles to original text.
- **Actors & access:** Team inbox readers (agents); same gate (`access_translation` plus `inbox_translate`).
- **UX & screens:** Thread payload fields: `translated_body`, `detected_language`, `is_translated` (true only when live). The inbox JS shows a "translated from X" badge with a toggle back to the original `body` (UI in TIB1).
- **Endpoints:** none owned (message serializer in `TeamInboxController`, owned by TIB1).
- **Data:** Reads `inbox_messages.translated_body`, `detected_language`, `is_translated` and computes `xlateLive` from `ConversationTranslationService::config(workspace)['enabled']` (memoized per workspace per request).
- **Rules & edge cases:**
  1. When not live: `translated_body` null and `is_translated` false in the payload, even for messages translated earlier (stored translations are kept but hidden).
  2. `detected_language` is always returned when stored.
  3. Re-enabling shows old translations again (nothing is deleted).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** workspace toggle and plan flag.
- **Acceptance criteria:**
  - Given a translated message and translation enabled, when the thread loads, then the payload has the translation and `is_translated=true`.
  - Given the toggle is turned off, when the thread is reloaded, then the same message shows the original with `is_translated=false`.
  - Given the plan is downgraded below `access_translation`, then translations are hidden the same way.
- **Source refs:** `app/Http/Controllers/TeamInboxController.php`, `app/Services/Inbox/ConversationTranslationService.php`.
- **Port notes:** Compute the flag once per thread request; return a `translation` object `{text, detectedLanguage}` only when live.

### WD-I18N-039 — AI agent and chat widget native-language replies

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-I18N-022, WD-I18N-035
- **Summary:** When translation is enabled, the inbox AI agent and the website chat-widget bot are told to reply entirely in the customer's language instead of replying in English and translating afterward. Outbound translation then correctly no-ops.
- **Actors & access:** System (AI agent replies in team inbox; chatbot widget assistants). Same workspace gate.
- **UX & screens:** None; visible as replies in the customer's language.
- **Endpoints:** none owned (AI agent service and widget chat service belong to AIAG/WGT).
- **Data:** Reads `conversations.customer_language` (AI agent) or detects from the visitor message (widget). Appends one instruction sentence to the model system prompt naming the language code and asking for a natural full reply in it.
- **Rules & edge cases:**
  1. AI agent: only when the conversation's `customer_language` is pinned, translation is enabled and the code differs from the team language.
  2. Widget: when enabled, `Translator::detect(visitorMessage)` (a billable translate-to-en call, cached 24 h) supplies the code; the hint is added when it is non-empty and differs from the team language.
  3. Both are best-effort try/catch; failure means no hint.
  4. `ConversationTranslationService::translateFor(text, target)` (returns `{language, text}` with the original text on any failure) exists for free-string translation but has no caller in this version besides the outbound path (dead helper).
  5. The ordering flow (WhatsApp commerce ordering) does its own translation, see Open questions.
- **Async & events:** none.
- **External systems:** LLM provider (AIAG) and translation providers for detection.
- **Settings:** workspace toggle, team language; AI agent settings (AIAG).
- **Acceptance criteria:**
  - Given a conversation pinned to `hi` and team language `en`, when the AI agent generates a reply, then the system prompt includes the Hindi language instruction.
  - Given translation is disabled, then no hint is added.
  - Given the visitor writes in the team language, then no hint is added.
- **Source refs:** `app/Services/AiAgentService.php`, `app/Services/AiChat/AiChatService.php`, `app/Services/Inbox/ConversationTranslationService.php`.
- **Port notes:** Provide a shared `LanguageContextService.hintFor(conversation)` used by the AI and widget modules; avoid using a paid translate call just to detect language (use WD-I18N-031 plus a cheap classifier).

## Data model

### Owned tables

**`languages`** (platform-global registry; about 21 rows; read on every request through a 10-minute cache). Written by WD-I18N-002/003/005/007, read by WD-I18N-001/008/009/010/011.

- `id` bigint unsigned PK auto-increment.
- `name` varchar(80) NOT NULL - English display name.
- `code` varchar(12) NOT NULL, UNIQUE (`languages_code_unique`) - locale code matching `lang/<code>.json` (case-sensitive, e.g. `zh-CN`).
- `native_name` varchar(80) NULL - name in its own script; the switcher prefers it.
- `direction` enum('ltr','rtl') NOT NULL default 'ltr'.
- `is_active` tinyint(1) NOT NULL default 1 - only active rows are offered, count in locale resolution, or set direction.
- `sort_order` int unsigned NOT NULL default 0 - ordering key (then `name`).
- `created_at`, `updated_at` timestamps NULL. No soft delete.

**`translation_providers`** (platform-global catalog; 5 rows). Written by WD-I18N-014 to 018.

- `id` bigint unsigned PK.
- `slug` varchar(64) NOT NULL UNIQUE - one of mymemory, libretranslate, google_gtx, deepl, google_cloud (must exist in `TranslationProviderManager::DRIVER_MAP`).
- `name` varchar(120) NOT NULL; `description` varchar(500) NULL.
- `is_active` tinyint(1) NOT NULL default 0; `is_default` tinyint(1) NOT NULL default 0 (single default enforced in code only).
- `credentials` text NULL - `Crypt::encryptString(json)` of a flat key/value map per driver: mymemory `{admin_email}`, libretranslate `{endpoint, api_key}`, deepl `{api_key}`, google_cloud `{api_key}`, google_gtx none. Hidden from serialization.
- `extra_config` json NULL - cast to array; never read or written in this version.
- `sort_order` smallint unsigned NOT NULL default 0.
- Index `(is_active, is_default, sort_order)`; timestamps.
- Seed: see WD-I18N-014.

**`translation_usage`** (append-only ledger; no `updated_at`; volume equals number of provider calls). Written by WD-I18N-029, read by WD-I18N-030 and the Account translation tab.

- `id` bigint unsigned PK.
- `workspace_id` bigint unsigned NULL (no FK; NULL for background/webhook contexts).
- `provider_slug` varchar(32) NOT NULL; `source_lang` varchar(8), `target_lang` varchar(8) NOT NULL (source may be the literal `auto`).
- `chars_in`, `chars_out` int unsigned default 0; `cost_micros` bigint unsigned default 0 (millionths of USD); `was_fallback` tinyint(1) default 0; `called_at` timestamp default current_timestamp.
- Indexes: `(workspace_id, called_at)`, `(provider_slug, called_at)`, single-column on `workspace_id`, `provider_slug`, `called_at`. Row model has `$timestamps = false`.

### Columns owned here on tables owned by other domains

| Table.column                                                    | Type / default                                           | Purpose                                                              | Written by                    |
| --------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------- |
| `users.locale`                                                  | varchar(12) NULL                                         | personal UI language; NULL = follow defaults                         | WD-I18N-009                   |
| `workspaces.default_language`                                   | varchar(8) NULL                                          | team language for translation, UI locale step 3, auto-reply fallback | WD-I18N-035                   |
| `workspaces.inbox_translate`                                    | tinyint(1) NOT NULL default 1                            | conversation translation master toggle                               | WD-I18N-035                   |
| `workspaces.auto_translate_languages`                           | json NULL (array of codes)                               | keyword fan-out targets                                              | no UI writes it (WD-I18N-032) |
| `workspaces.data_residency`                                     | varchar(16) NOT NULL default 'any' (any, eu_only, local) | provider filter                                                      | WSP settings route            |
| `workspaces.locale`                                             | varchar(16) NOT NULL default 'en'                        | unused by this domain                                                | unknown                       |
| `conversations.customer_language`                               | varchar(12) NULL                                         | pinned customer language                                             | WD-I18N-036                   |
| `inbox_messages.detected_language`                              | varchar(12) NULL                                         | detected (inbound) or delivered (outbound) language                  | WD-I18N-036/037               |
| `inbox_messages.translated_body`                                | text NULL, encrypted cast                                | agent-language view (inbound) or agent original (outbound)           | WD-I18N-036/037               |
| `inbox_messages.is_translated`                                  | tinyint(1) NOT NULL default 0                            | badge flag                                                           | WD-I18N-036/037               |
| `keyword_replies.keyword_translations`                          | json NULL                                                | `{code: keyword}` map                                                | WD-I18N-032                   |
| `keyword_replies.canonical_language`                            | varchar(8) NOT NULL default 'en'                         | source language of the rule                                          | WD-I18N-032                   |
| `keyword_reply_contents.content_translations`                   | json NULL                                                | `{code: text}` per text variant                                      | WD-I18N-032                   |
| `keyword_reply_logs.detected_language`                          | varchar(8) NULL                                          | language detected at fire time                                       | WD-I18N-034                   |
| `wa_pending_orders.customer_lang`                               | varchar(12) NULL                                         | customer language on an ordering cart (CHK flow, own translator)     | ordering service              |
| `packages.access_translation`, `packages.access_data_residency` | tinyint(1) NOT NULL default 0                            | plan feature flags (Pro+ and Enterprise)                             | PLAN                          |

### Settings (in `system_settings`, key/value with type and description; owned by SET, written here)

- `default_language` (string) - platform default UI locale; written by WD-I18N-004 and General settings. No row exists after a fresh install (falls back to env `APP_LOCALE`, default `en`).
- `translation.official_only` (bool, default false) - lockdown; written by WD-I18N-018.

### Non-DB data

- `lang/*.json` (21 catalogs), `database/data/common-phrases.json` (12 phrases x 30 languages), cache keys `locale:active_languages` (600 s), `translate:<from>:<to>:<md5>` and `translate:auto:<to>:<md5>` (86,400 s), `translate:mymemory:breaker` (3,600 s).

## Cross-domain contracts

Consumes:

- **SET / CORE** - `SystemSetting::get/set` for `default_language` and `translation.official_only`; `FormatSettings::display` for USD formatting on the usage dashboard; `Audit::log` (NOTIF) for `admin.language.*`, `admin.translation_provider.*`, `admin.translation.lockdown_*` (platform layer; secrets scrubbed by key name); `DemoMode` (CORE) blocking writes on `admin/languages*` and `admin/translation-providers*`; installer (INST) writing `APP_LOCALE` and running `TranslationProviderSeeder`.
- **PLAN** - package feature flags `access_translation` (Pro, Enterprise) and `access_data_residency` (Enterprise), evaluated through `PlanLimitGuard::feature/hasFeature` with per-workspace `plan_overrides` and admin bypass.
- **WSP** - current workspace (`currentWorkspace`), workspace columns above, `POST settings/data-residency`.
- **AUTH / user profile** - authenticated user and `users.locale`.
- **TIB1** - `InboxMessage` observer calls `ConversationTranslationService::ingestInbound`; `InboxDispatcher` calls `translateOutbound` before the branding footer; `TeamInboxController` message serializer uses `config()` to gate translation display.
- **AR** - `KeywordReply`, `KeywordReplyContent`, `KeywordReplyLog` models and lookup flow (owner of matching); this domain supplies `KeywordTranslationManager`, `Translator`, `LanguageDetector`.

Exposes:

- `Translator::translate(text, from, to)`, `detectAndTranslate(text, target)`, `detect(text)`, `fanOut(text, from, targets)` (AR, TIB1, AIAG, WGT, CHK).
- `LanguageDetector::detect(text, fallback)`, `isLatin`, `displayName`, `LANGUAGE_NAMES`.
- `LocaleSettings::active()`, `isAvailable(code)`, `directionFor(code)`, `defaultLocale()`, `flush()` (all layouts, switcher, SetLocale).
- `ConversationTranslationService::config(wsId)` returning `{enabled, lang}`, `ingestInbound`, `translateOutbound`, `translateFor` (TIB1, AIAG, WGT).
- `KeywordTranslationManager::pickContent(variant, lang)`, `targetsFor(ws)`, `DEFAULT_TARGETS`, `translateForKeyword`.
- Tables `languages`, `translation_providers`, `translation_usage`; `TranslationUsage::PROVIDER_COST_MICROS_PER_CHAR`.
- Admin settings page (SET) links to `/admin/languages`; the General settings form lists active languages for `default_language`.

## Open questions & quirks

1. **20 vs 21 languages.** UI copy, docs and controller comments say "fixed 20-language pack"; the seed and `lang/` hold 21 (bengali added). Decide the real supported list for the port.
2. **Catalog quality gaps.** `he.json` is entirely untranslated, `pt.json` is about 45% identical to English, and ten catalogs cover only about 48% of current English keys. `en.json` has about 1,160 fewer keys than the other catalogs (stale identity file). Registry rows are all active regardless. The port must not assume catalogs are complete; add coverage-based gating.
3. **Default language does not "apply to new accounts".** It is only a live fallback in the resolution chain (WD-I18N-004/008), contrary to UI and docs copy. New users are not stamped with it.
4. **Unsurfaced edit.** `PATCH admin/languages/{id}` exists and docs describe editing direction/native name/sort order, but the Blade page has no editor. It also omits the cache flush and deactivates a language when `is_active` is absent. PATCH does not guard deactivating the default language.
5. **Cache staleness.** update and destroy do not flush `locale:active_languages`; toggle and set-default do. Up to 10 minutes of stale data.
6. **Add language.** `POST admin/languages` is a permanent error stub; the offline "fasttrans" generator referenced in comments is not shipped.
7. **Multiple meanings of `workspaces.default_language`** (team language, UI locale fallback, auto-reply fallback) and an apparently unused `workspaces.locale` column (varchar 16 default en; in the model's fillable list; no reader found in this domain).
8. **Auto-reply pre-translation is dead in the UI path.** `KeywordTranslationManager::translateForKeyword` is only called by the backfill command; `auto_translate_languages` has no editor. Runtime relies on lazy translation (WD-I18N-034). Docs and docblocks still say translation happens at save time and in parallel (`Http::pool`), which is not implemented (fan-out is sequential).
9. **Failures cached 24 h**, dictionary/cache/lockdown interplay (cached translation survives a lockdown change), identical-output treated as failure (brand names and untranslatable words cause repeated negative results and provider calls once per 24 h).
10. **Residency and lockdown can be bypassed by context.** Residency uses `auth()->user()->currentWorkspace`; webhook-driven inbound translation, the backfill command and queue jobs have no user, so residency is skipped and usage rows get NULL workspace. Lockdown is applied there (platform-wide) but ordering flow (11) ignores it.
11. **Ordering flow uses a private, non-conforming Google path.** `Services/Ordering/OrderingService.php` (`gTranslate`, `localizeTo`, intent detection) calls the unofficial Google gtx endpoint directly with a 6 s timeout, bypassing `Translator`, the provider chain, lockdown, residency, cache and the usage ledger; it has a small offline confirm/cancel word map as a safety net. `GroupNotifier::notifyCustomerInGroup` also localizes through it and `wa_pending_orders.customer_lang` stores the language. This belongs to CHK; the port should route it through the shared translation service.
12. **No admin navigation.** `/admin/translation-usage` has no inbound link at all; `/admin/translation-providers` is linked only from the Account translation tab (platform admins), the legal data-processing page and by URL. The languages page is linked from the admin settings hub and the General settings form.
13. **Legal page.** `GET legal/data-processing` (closure route, view `resources/views/legal/data-processing.blade.php`, middleware `Authenticate`) documents translation providers' data handling, the residency modes and the erasure note; it is a static disclosure page with no logic and is left to the domain owning legal pages (CMS/CORE); it names the third parties and the residency setting so the port should keep it consistent with the provider list.
14. **Language detection quirks** (kanji beats kana, Urdu/Persian folded to `ar`, Cyrillic folded to `ru`, Latin languages undetectable, `ur` never returned) and the fact that the pinned `conversations.customer_language` is never re-detected or user-editable.
15. **Outbound persistence of the translated body** is ambiguous: `translated_body` stores the agent's original, in-memory `body` is replaced after a quiet save, and the dispatcher's footer note says the DB row keeps the operator's text. Confirm at live-test time what `inbox_messages.body` contains for translated outbound messages.
16. **Translated inbound arrives late.** Deferred to `terminating`, no realtime event; the agent sees it only on the next thread load.
17. **Docs mismatches:** docs state approximately 50 dictionary phrases (12 shipped); "Google Cloud: API key / credentials" (only API key implemented); MyMemory "no credentials" (optional email field exists); Google GTX is called a fifth provider in a note and seeded active by default (docs say MyMemory is the only default).
18. **Cost model is approximate**: DeepL priced at 20 micros/char although the source comment mentions about 5/1M after free tier and free keys; only input characters are costed; failed attempts and cost are not logged.
19. **`extra_config`** on providers is an unused JSON column.
20. **`ConversationTranslationService::translateFor`** has no caller (dead helper).
21. **AbstractTranslatorDriver::detectLanguage default** (script detector) is unused because all five drivers override detect-and-translate (dead default).
22. **JS asset key** `admin-languages-index` is mapped to the packages chart module in `resources/js/app.js` (copy-paste; no behavior).
23. **Uncovered i18n surfaces:** no JS/client-side i18n exists; emails, notification titles, API messages and the storefront/widget/public pages are not driven by the platform locale. Frontend CMS content localization is owned by CMS (`FrontendContentStore` mentions language but is out of scope here).
24. **Not claimed here (left to other domains, flagged for orphan sweep):** `POST settings/data-residency` (WSP), `GET legal/data-processing` (CMS/CORE), `AdminPagesController` general-settings default_language field (SET), `AccountController` (only the `updateTranslation` action and route are claimed), currency admin page (CPN).

## Coverage

```json wadesk-coverage
{
  "routes": [
    "GET admin/languages",
    "POST admin/languages",
    "PATCH admin/languages/{id}",
    "DELETE admin/languages/{id}",
    "POST admin/languages/{id}/default",
    "POST admin/languages/{id}/toggle",
    "GET admin/translation-providers",
    "POST admin/translation-providers/lockdown",
    "PATCH admin/translation-providers/{id}",
    "POST admin/translation-providers/{id}/default",
    "POST admin/translation-providers/{id}/toggle",
    "GET admin/translation-usage",
    "POST locale",
    "POST account/translation"
  ],
  "controllers": [
    "app/Http/Controllers/Admin/LanguagesController.php",
    "app/Http/Controllers/Admin/TranslationProviderController.php",
    "app/Http/Controllers/Admin/TranslationUsageController.php",
    "app/Http/Controllers/LocaleController.php"
  ],
  "services": [
    "app/Services/CommonPhrasesDictionary.php",
    "app/Services/Inbox/ConversationTranslationService.php",
    "app/Services/KeywordTranslationManager.php",
    "app/Services/LanguageDetector.php",
    "app/Services/Translation/AbstractTranslatorDriver.php",
    "app/Services/Translation/Drivers/DeepLDriver.php",
    "app/Services/Translation/Drivers/GoogleCloudDriver.php",
    "app/Services/Translation/Drivers/GoogleGtxDriver.php",
    "app/Services/Translation/Drivers/LibreTranslateDriver.php",
    "app/Services/Translation/Drivers/MyMemoryDriver.php",
    "app/Services/Translation/TranslationProviderManager.php",
    "app/Services/Translator.php",
    "app/Support/LocaleSettings.php"
  ],
  "models": ["Language", "TranslationProvider", "TranslationUsage"],
  "tables": ["languages", "translation_providers", "translation_usage"],
  "views": [
    "resources/views/admin/languages/index.blade.php",
    "resources/views/admin/translation-providers/index.blade.php",
    "resources/views/admin/translation-usage/index.blade.php",
    "resources/views/components/locale-switcher.blade.php"
  ],
  "commands": [
    "auto-reply:translate-existing",
    "translatable:export",
    "translatable:inspect-translations"
  ],
  "permissions": [],
  "middleware": ["app/Http/Middleware/SetLocale.php"],
  "node_files": [],
  "js_assets": ["resources/js/locale-switcher.js"],
  "misc_files": [],
  "config_files": ["config/laravel-translatable-string-exporter.php"],
  "doc_pages": [
    "Documentation/pages/admin-panel/localization.html",
    "Documentation/pages/admin-panel/translation.html"
  ],
  "feature_map": {
    "WD-I18N-001": ["GET admin/languages"],
    "WD-I18N-002": ["PATCH admin/languages/{id}"],
    "WD-I18N-003": ["POST admin/languages/{id}/toggle"],
    "WD-I18N-004": ["POST admin/languages/{id}/default"],
    "WD-I18N-005": ["DELETE admin/languages/{id}"],
    "WD-I18N-006": ["POST admin/languages"],
    "WD-I18N-007": [],
    "WD-I18N-008": [],
    "WD-I18N-009": ["POST locale"],
    "WD-I18N-010": [],
    "WD-I18N-011": [],
    "WD-I18N-012": [],
    "WD-I18N-013": [],
    "WD-I18N-014": ["GET admin/translation-providers"],
    "WD-I18N-015": ["PATCH admin/translation-providers/{id}"],
    "WD-I18N-016": ["POST admin/translation-providers/{id}/toggle"],
    "WD-I18N-017": ["POST admin/translation-providers/{id}/default"],
    "WD-I18N-018": ["POST admin/translation-providers/lockdown"],
    "WD-I18N-019": [],
    "WD-I18N-020": [],
    "WD-I18N-021": [],
    "WD-I18N-022": [],
    "WD-I18N-023": [],
    "WD-I18N-024": [],
    "WD-I18N-025": [],
    "WD-I18N-026": [],
    "WD-I18N-027": [],
    "WD-I18N-028": [],
    "WD-I18N-029": [],
    "WD-I18N-030": ["GET admin/translation-usage"],
    "WD-I18N-031": [],
    "WD-I18N-032": [],
    "WD-I18N-033": [],
    "WD-I18N-034": [],
    "WD-I18N-035": ["POST account/translation"],
    "WD-I18N-036": [],
    "WD-I18N-037": [],
    "WD-I18N-038": [],
    "WD-I18N-039": []
  }
}
```
