---
domain: chrome-extension-sheets-addon
code: EXT
title: Google Sheets add-on (personal key, add-on API, setup page, source download). The Chrome extension half of the domain is not in this file.
threadwise_version: '1.7.0'
sources_read: 9
---

# Google Sheets add-on

This file covers the **Google Sheets add-on only** (TW-EXT-001 to 099 are reserved for it). The Chrome extension (`ext.*` routes, `ExtensionApiController`, the `extension/` folder)
is the other half of the EXT domain and will be written as TW-EXT-100 and up, so ids never clash.

## Overview

Reference ships a small Google Apps Script project (`google-sheets-addon/`: a manifest, a server script, three dialogs) that a member copies into their own Google account
(or installs from the Google Workspace Marketplace once listed). The member works in a sheet of products, opens the add-on, pastes a **personal Sheets key**, and presses
Sync. The add-on reads the active sheet only (the narrowest Google scope, `spreadsheets.currentonly`), and sends the rows to Reference, which creates or updates the workspace's
**shop** and its **products**. Nothing is read from the sheet on a schedule and nothing is written back to it.

The add-on cannot use a login session. It authenticates with a bearer token of the form `wsn_live_` plus 32 hex characters that the member creates on their account page
(setup page `/sheets-addon`): the secret is shown once, Reference keeps only its sha256 and the last 8 characters, and creating a new key replaces the old one. The API is three
routes under `api/v1/sheets-addon` (health, shops, sync) that answer `{ ok: true, ... }` or `{ ok: false, error }`. The setup page walks the member through four steps (get the
add-on, create the key, paste it, sync) and shows the workspace's shops, the product count and the last five products, so the member can check that a sync landed. Until the
Marketplace listing is live the page also offers the add-on's source files for download, with the server address of this installation already written into `Code.gs`.

The port keeps all of that, and adds what the Marketplace design note (`docs/specs/marketplace-extension-listings.md`) and the owner asked for on top: the add-on is a
**free `client` listing** (`google-sheets`) installed **once per workspace**; each member then uses it with **their own key and under their own role**; contacts can be pulled
into and loaded from a sheet (new, Reference's add-on has no contacts); every call is audited, rate limited and tenant scoped. Sending a WhatsApp message from a sheet is not in
Reference and is not built (TW-EXT-016, blocked).

Plan gates: Reference's three add-on routes carry no plan gate (the API-key and plan middleware sit on the other 57 `api/v1` routes). The port uses the Marketplace gates instead:
the plan feature `marketplace` and the install itself (TW-EXT-013).

Connects to: `marketplace` (the listing, the install, the `app.google-sheets.use` permission key, the consented scopes), `roles-permissions` (the member's live grants decide
every action), `auth-registration-security` (the key lives in `user_settings`, the account gates apply), `catalog-products` and `storefront-builder` (the products and shop a sync writes),
`contacts-attributes-tags` (the contacts a sync reads and writes), `developer-rest-api-v1` (a separate scheme, a different key; shares only the rate-limit service),
`dashboards-analytics-charts` (its integrations panel reads `user_settings.sheets_key_hash` to show the add-on as connected), `plans-subscriptions-trials` (plan gate, product cap),
`notifications-activity-audit` (audit rows, outbox events).

## Feature index

| Id         | Feature                                                                         | Status      | Priority | Effort | Depends on               |
| ---------- | ------------------------------------------------------------------------------- | ----------- | -------- | ------ | ------------------------ |
| TW-EXT-001 | Create or replace my Sheets key (secret shown once)                             | implemented | P0       | S      | TW-EXT-013               |
| TW-EXT-002 | See my key's status (suffix, created, last used)                                | implemented | P0       | S      | TW-EXT-001               |
| TW-EXT-003 | Revoke my key                                                                   | implemented | P0       | S      | TW-EXT-001               |
| TW-EXT-004 | Bearer authentication of the add-on API, as the key's owner                     | implemented | P0       | M      | TW-EXT-001               |
| TW-EXT-005 | Download the add-on source, pre-pointed at this installation                    | implemented | P1       | S      |                          |
| TW-EXT-006 | Setup page: steps, key card, shops, product count, last products                | implemented | P1       | M      | TW-EXT-001 to 003, 008   |
| TW-EXT-007 | Limits: failed-key lockout, per-key rate limit, request size                    | docs-only   | P1       | S      | TW-EXT-004               |
| TW-EXT-008 | List the workspace's shops with the product count                               | implemented | P0       | S      | TW-EXT-004               |
| TW-EXT-009 | Create or update the shop a sync belongs to                                     | implemented | P0       | M      | TW-EXT-004               |
| TW-EXT-010 | Bulk upsert products from sheet rows, matched by SKU then name                  | implemented | P0       | M      | TW-EXT-009               |
| TW-EXT-011 | Pull contacts into a sheet                                                      | docs-only   | P1       | M      | TW-EXT-004               |
| TW-EXT-012 | Bulk upsert contacts from sheet rows with per-row results                       | docs-only   | P1       | M      | TW-EXT-004               |
| TW-EXT-013 | Install per workspace, consented scopes and the member's role gate every action | docs-only   | P0       | M      | marketplace              |
| TW-EXT-014 | Audit trail and event for every add-on write                                    | docs-only   | P1       | S      | TW-EXT-010, 012          |
| TW-EXT-015 | Health check: is the key good, who am I, what may I do                          | implemented | P0       | S      | TW-EXT-004               |
| TW-EXT-017 | Webhook trigger: send new or changed rows as contacts, Initial Setup, Send Test | docs-only   | P1       | M      | TW-EXT-004, 012          |
| TW-EXT-016 | Send a WhatsApp message or template from a sheet                                | docs-only   | P2       | L      | message-templates, inbox |

Status here is what Reference 1.7.0 does. `docs-only` marks what the port adds (or hardens) beyond Reference, or what is blocked (016); the row says "new in this port" in the entry.

## Features

### TW-EXT-001 — Create or replace my Sheets key (secret shown once)

- **Status:** implemented
- **Priority:** P0 (the add-on cannot be used without it)
- **Effort:** S
- **Depends on:** TW-EXT-013
- **Summary:** A signed-in member creates their personal Sheets key. The full secret appears once, in the answer to that action, and cannot be read again. Creating a key when one exists replaces it; the old key stops working immediately.
- **Actors & access:** any signed-in member, for themselves only (there is no member id in the request). Reference: any authenticated user of the web group, no plan gate. Port: the role must hold `app.google-sheets.use` and the workspace must have the add-on installed (TW-EXT-013) and the plan feature `marketplace`.
- **UX & screens:** the key card on the setup page (TW-EXT-006): with no key, one "Generate key" button; with a key, the masked key, "Regenerate" and "Revoke". After generating, a banner shows the full key in a read-only box with a copy button and a warning that it will not be shown again; the status flash says a new key was generated and to copy it now.
- **Endpoints:** Reference: `POST account/sheets-key/generate` (`user.account.sheets.generate`, `AccountController@generateSheetsKey`, web + auth) → redirect back with the one-time key in the session flash.
- **Data:** the member's four key columns: hash (sha256 hex of the full token), suffix (last 8 characters), created-at (set now), last-used-at (cleared to empty). Format `wsn_live_` + 32 hex characters from a cryptographic random source (16 bytes).
- **Rules & edge cases:**
  1. The secret is never stored and never logged; only the hash and the 8-character suffix. A database leak does not leak usable keys.
  2. One key per member: generating again overwrites, there is no list of keys and no history.
  3. Generating resets "last used" to never.
  4. Pressing the button twice makes two keys and the first one is lost; the one shown last is the one that works.
  5. There is no confirmation step in Reference before replacing (the button label says Regenerate).
  6. No expiry: a key lives until replaced or revoked.
- **Async & events:** none in Reference. Port: one audit row and one outbox event (`ext.sheets_key.generated`) in the same transaction as the write, naming the member and the suffix, never the secret.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a member with no key, when they generate, then the answer carries a key matching `wsn_live_[0-9a-f]{32}` and the stored value is its sha256, not the key.
  - Given a member with a key, when they generate again, then the old key is refused on its next call and the new one works.
  - Given a key was generated, when the member asks for their key status or the setup page, then the secret is not in the answer, only the suffix.
  - Given the add-on is not installed in the workspace, when a member generates, then the answer is `EXT_APP_NOT_INSTALLED` (403) and nothing is stored.
  - Given a role without `app.google-sheets.use`, when its member generates, then the answer is 403 and nothing is stored.
  - Given a generate, then the audit row and the event exist and neither contains the secret.
- **Source refs:** `routes/web.php` (account sheets-key routes), `app/Http/Controllers/AccountController.php` (`generateSheetsKey`), `database/migrations/2026_05_13_040000_add_sheets_api_key_to_users.php`, `resources/views/user/integrations/sheets-addon.blade.php`.
- **Port notes:** `SheetsKeyService.generate`. Stored in `user_settings.sheets_key_*` (already in the auth schema; the dashboard's integrations panel reads the hash column). A unique partial index on the hash (migration `20261108090000_ext_sheets_addon.sql`) lets the guard find the key before it knows the workspace. The response must send `Cache-Control: no-store`. Not `@Idempotent`: replaying a stored answer would replay a secret.

### TW-EXT-002 — See my key's status

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-EXT-001
- **Summary:** The member sees whether they have a key, its masked form, when it was made and when the add-on last used it.
- **Actors & access:** the member, for themselves. No permission needed to look (a member whose role lost the app can still see and switch off their key).
- **UX & screens:** on the setup page: a status line "active" or "inactive", the masked key `wsn_live_` + 8 bullets + suffix, "created" and "last used" as relative times ("never" before first use), and the same values in a small side panel.
- **Endpoints:** part of `GET sheets-addon` (`user.sheets-addon`, `AccountController@sheetsAddon`).
- **Data:** the four key columns, read only.
- **Rules & edge cases:**
  1. Active means a hash is stored.
  2. "Last used" is written by the add-on API, at most once a minute (Reference wrote it on every call, so a busy sheet rewrote one row each time).
  3. After a revoke or a replace, last-used is empty.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given no key, then the status is inactive with no suffix, no created and no last-used time.
  - Given a key, then the status shows the suffix equal to the last 8 characters of the secret and the creation time.
  - Given the add-on called with the key, then within a minute last-used is set, and a second call inside the minute does not change it.
- **Source refs:** `AccountController.php` (`sheetsAddon`), `resources/views/user/integrations/sheets-addon.blade.php`.
- **Port notes:** `GET /v2/extension/sheets/key`; also part of the overview (TW-EXT-006).

### TW-EXT-003 — Revoke my key

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-EXT-001
- **Summary:** The member switches their key off. The add-on stops working until they create a new one.
- **Actors & access:** the member, for themselves. Port: allowed even after the add-on is uninstalled or the role lost the app permission, so a member can always switch their own key off.
- **UX & screens:** the "Revoke" button on the key card; the status flash says the key was revoked and the add-on will stop working until a new one is created.
- **Endpoints:** Reference: `POST account/sheets-key/revoke` (`user.account.sheets.revoke`, `AccountController@revokeSheetsKey`) → redirect back with a flash.
- **Data:** the four key columns are cleared.
- **Rules & edge cases:**
  1. Revoking with no key is not an error; the result is the same inactive state.
  2. The key stops working on the next call (no cache holds it).
  3. Deleting the member deletes their settings row and so their key.
- **Async & events:** port: one audit row and one outbox event (`ext.sheets_key.revoked`) when a key was actually removed.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an active key, when the member revokes, then the next add-on call with it is 401 and all four columns are empty.
  - Given no key, when the member revokes, then the answer is success and no audit row is written.
  - Given another member in the same workspace, then their key keeps working.
- **Source refs:** `AccountController.php` (`revokeSheetsKey`), `routes/web.php`.
- **Port notes:** `DELETE /v2/extension/sheets/key`, answers 200 with the inactive status.

### TW-EXT-004 — Bearer authentication of the add-on API, as the key's owner

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-EXT-001
- **Summary:** Every add-on call carries the key as a bearer token. The server finds the member the key belongs to and the call then runs as that member: their workspace, their identity, their live permissions.
- **Actors & access:** the Apps Script client. The three Reference routes sit in the `web` middleware group only (no auth middleware, no API-key middleware, no CSRF concerns because the client sends no cookie); the controller authenticates itself.
- **UX & screens:** none (an API). Failure copy the add-on shows: "Invalid or missing API key" (401), "No active workspace" (422).
- **Endpoints:** applies to every route of TW-EXT-008 to 012 and 015.
- **Data:** looks the member up by the sha256 of the presented token; on success stamps last-used.
- **Rules & edge cases:**
  1. Only the `Authorization: Bearer` header is read. Reference required the `wsn_live_` prefix before any lookup; the port also checks the full shape (prefix + 32 hex).
  2. Unknown, malformed, revoked and replaced keys all get the same 401 answer.
  3. Reference answered 422 "No active workspace" when the member had no current workspace. In the port a member always belongs to exactly one workspace, so this case does not exist.
  4. Port: the call is refused when the member or the workspace is suspended (same codes as the app), when the member's role does not hold `app.google-sheets.use`, and when the add-on is not installed and active (TW-EXT-013). Taking the permission from a role stops that role's keys at once.
  5. Port: the request carries the member's id as the actor, so the rows the call writes (contacts, products, shops) are audited as that member and owned by that member.
  6. The customer REST API's `wsk_` keys and the staff session token are not accepted here, and the Sheets key is not accepted there.
- **Async & events:** none besides last-used.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a valid key, when the add-on calls health, then the answer names the member and the workspace of the key.
  - Given no key, a malformed key, an unknown key, a revoked key or a replaced key, then the answer is 401 and the sentence is the same for the last four.
  - Given a key of workspace A, then no call returns or changes anything of workspace B.
  - Given the member's role loses `app.google-sheets.use`, when the add-on calls, then the answer is 403.
  - Given a suspended member or workspace, when the add-on calls, then the answer is 403 with the suspension code.
  - Given the member is deleted, when the add-on calls with their old key, then the answer is 401.
- **Source refs:** `app/Http/Controllers/Api/SheetsAddonController.php` (`authenticate`), `routes/web.php` (`api/v1/sheets-addon` group).
- **Port notes:** `SheetsKeyGuard` (controller-level, route `@Public()` so the session guard stands aside). Looks up with `privileged()` (a sanctioned use: the key is the only thing sent, the tenant is found from it). Sets the request context to the member (`actorType 'user'`, live grants from `RbacService`). Errors render as `{ ok: false, error, code }` through a longer-prefix problem renderer.

### TW-EXT-005 — Download the add-on source, pre-pointed at this installation

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** none
- **Summary:** Until the Marketplace listing is live, a member copies the add-on's files into their own Apps Script project. The setup page lists the six files and each downloads with its real file name. The server script comes with its API address already set to this installation.
- **Actors & access:** a signed-in member (Reference). Port: needs `app.google-sheets.use`.
- **UX & screens:** step 1 of the setup page: a "Get the add-on" button to the Marketplace listing URL, and below it a list of the files with a one-line description, size, a preview and Download. A file that is missing on the server is shown as unavailable.
- **Endpoints:** Reference: `GET sheets-addon/file/{file}` (`user.sheets-addon.file`, `AccountController@sheetsAddonFile`); the `file` parameter is restricted to `Code.gs`, `Dialog.html`, `Settings.html`, `Help.html`, `appsscript.json`, `README.md`.
- **Data:** files on disk (the add-on folder). The listing URL is a config value, default the Google Workspace Marketplace home.
- **Rules & edge cases:**
  1. Only the six names are served; anything else is 404. A missing file is 404.
  2. `Code.gs` has one constant, the API base address, rewritten to this installation's origin on the way out, so the downloaded file works without editing.
  3. Served as an attachment with the right file name, `nosniff`, and a text MIME type so the browser never renders the HTML.
  4. The preview on the page is the first 220 characters of each file.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** the Marketplace listing URL (config key `services.sheets_addon.marketplace_url`).
- **Acceptance criteria:**
  - Given the source is on the server, when a member downloads `Code.gs`, then the base address constant equals this installation's address and the other lines are unchanged.
  - Given a name that is not one of the six (including path tricks), then the answer is 404.
  - Given a file that is not on the server yet, then the list says unavailable and the download is 404.
  - Given no session or a role without the app permission, then the answer is 401 or 403.
- **Source refs:** `AccountController.php` (`sheetsAddon`, `sheetsAddonFile`), `google-sheets-addon/README.md` (what the files are).
- **Port notes:** the add-on source is original code written for this port, not Reference's. It lives in `apps/api/assets/google-sheets-addon/` (shipped by the Dockerfile) and the constant is named `CRM_BASE`; see `SOURCE_CONTRACT.md` in that folder. **Built:** the six files exist there (menu, settings dialog, connection check, contacts pull and push, product sync) and are checked by `apps/api/test/unit/chrome-extension-sheets-addon/addon-source.spec.ts`; they have not been run inside a real Google Sheet. The web page offers each as a download.

### TW-EXT-006 — Setup page: steps, key card, shops, product count, last products

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-EXT-001 to 003, TW-EXT-008
- **Summary:** One page that takes a member from nothing to a first sync and lets them check the result.
- **Actors & access:** a signed-in member. Port: `app.google-sheets.use`; shops and products appear only when the role may read the catalog.
- **UX & screens:** `user/integrations/sheets-addon`. A header with the connected state. Step 1 get the add-on and the source files (TW-EXT-005). Step 2 the key card (TW-EXT-001 to 003). Step 3 paste the key into the add-on (a short walk-through of the add-on's menu: Extensions, the add-on, Settings). Step 4 sync: the sheet's expected columns (name, category, description, image address, price, SKU, stock, active), the shops of the workspace with their address, and the last five products created (name, price, image). A side panel: key status active or inactive, created, last used. The flash banner for the one-time key.
- **Endpoints:** Reference: `GET sheets-addon` (`user.sheets-addon`).
- **Data:** the member's key columns; the workspace's shops (newest first), the workspace-wide product count, the five newest products.
- **Rules & edge cases:**
  1. Products are not tied to one shop, so the count is workspace-wide.
  2. With no shop, step 4 says so and offers nothing to list.
  3. Port: when the add-on is not installed the page says an admin must install it, and the key card cannot create a key.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** Marketplace listing URL (TW-EXT-005).
- **Acceptance criteria:**
  - Given an installed add-on and a role that can read the catalog, then the page data lists shops, the product count and the five newest products.
  - Given a role that cannot read the catalog, then those lists are empty and the key card still works.
  - Given the add-on is not installed, then the page data says `installed: false` with the blocker `not_installed`.
- **Source refs:** `AccountController.php` (`sheetsAddon`), `resources/views/user/integrations/sheets-addon.blade.php`.
- **Port notes:** `GET /v2/extension/sheets/overview` returns everything in one call (see `docs/api/chrome-extension-sheets-addon.md`). **Built:** the page is `/google-sheets-addon` (`apps/web/src/features/chrome-extension-sheets-addon/`), reached from Settings > Integrations; it uses `@crm/ui`, not Reference's markup, and has a help guide. Not compared against the running Reference in a browser.

### TW-EXT-007 — Limits: failed-key lockout, per-key rate limit, request size

- **Status:** docs-only
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-EXT-004
- **Summary:** New in this port (Reference had none of these on the add-on routes). A client that keeps sending wrong keys is locked out for a minute, a key may not flood the server, and one call may not carry an unbounded body.
- **Actors & access:** the add-on API.
- **UX & screens:** the add-on shows the message of a 429 and waits.
- **Endpoints:** all add-on routes.
- **Data:** Redis counters only.
- **Rules & edge cases:**
  1. 30 wrong keys from one address in a minute lock that address out for the rest of the minute (429), including for its good keys; other addresses are unaffected.
  2. A key may make 120 calls a minute, and never more than the workspace's plan API ceiling (`api_rate_limit_per_minute`, a workspace override of -1 lifts it). Answers carry `X-RateLimit-Limit`, `X-RateLimit-Remaining` and, over the limit, `Retry-After`.
  3. A JSON body may be 2 MiB (500 rows with long descriptions is far past the 100 KiB default); larger is 413. A request may carry at most 500 rows or products.
  4. The per-IP default throttle is skipped on these routes so the two limits do not stack.
- **Async & events:** none.
- **External systems:** Redis.
- **Settings:** the plan's `api_rate_limit_per_minute`; the platform security policy ceiling.
- **Acceptance criteria:**
  - Given 30 failed keys from one address, when the 31st call comes, then it is 429 and a good key from the same address is also 429 until the minute ends.
  - Given a plan ceiling of 3 a minute, when a key calls 4 times, then the fourth is 429 with `Retry-After` and the earlier answers carry the remaining count.
  - Given a body over 2 MiB, then the answer is 413 in the add-on's error envelope.
  - Given 501 rows, then the answer is 422 naming `rows`.
- **Source refs:** none (Reference has no limit on these routes).
- **Port notes:** the lockout mirrors the customer API's. The body-size class is registered in `platform-infrastructure/body-limits`.

### TW-EXT-008 — List the workspace's shops with the product count

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-EXT-004
- **Summary:** The add-on asks which shops the member's workspace has, so the member can choose which one to sync into.
- **Actors & access:** the key's owner. Port: needs the consented scope `catalog.read` and a role with `cat.products.read` and `store.storefront.read`.
- **UX & screens:** a shop picker in the add-on's dialog.
- **Endpoints:** `GET api/v1/sheets-addon/shops` (`api.sheets.shops`, `SheetsAddonController@shops`) → `{ ok, shops[], workspace, product_count_total }`. Each shop: id, name, slug, currency (default INR), enabled, theme key, custom domain, public address, product count, updated-at.
- **Data:** the workspace's shops newest first, the workspace-wide product count (the same number on every shop, because products are not shop-scoped).
- **Rules & edge cases:**
  1. A workspace with no shop returns an empty list and a count.
  2. Reference used the numeric workspace id as `workspace`; the port returns the workspace uuid.
  3. Shop ids are uuids in the port (Reference: integers).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a workspace with two shops and three products, then the answer lists both shops newest first, each with `product_count` 3, and `product_count_total` 3.
  - Given another workspace's shops, then they are never listed.
  - Given a key whose role cannot read the catalog, then the answer is 403.
- **Source refs:** `SheetsAddonController.php` (`shops`).
- **Port notes:** `ShopsService.listForIntegration` (storefront-builder barrel) and `ProductsRepository.countAll`.

### TW-EXT-009 — Create or update the shop a sync belongs to

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-EXT-004
- **Summary:** The first half of a sync: the shop named in the request is created or updated, then the products go into the workspace.
- **Actors & access:** the key's owner. Port: consented scope `catalog.write`; the role needs `store.shops.manage` and at least one of `cat.products.create`, `cat.products.update`.
- **UX & screens:** the add-on's dialog asks for the shop name, optional description, currency and theme; a shop picker chooses an existing shop.
- **Endpoints:** part of `POST api/v1/sheets-addon/sync` (`api.sheets.sync`, `SheetsAddonController@sync`). Request fields: `shop_id` (optional), `shop_name` (required, at most 191), `description` (optional, at most 2000), `currency` (optional, three letters), `theme_key` (optional, one of the storefront themes), `products` (required list, 1 to 500).
- **Data:** a shop row: name, slug, currency, theme, enabled, settings (the description becomes the shop's hero text).
- **Rules & edge cases:**
  1. With `shop_id` that matches a shop of this workspace, that shop is updated: name always, currency and theme when given, hero text when a description is given. The slug never changes, so shared links keep working.
  2. QUIRK: with no `shop_id`, or one that matches no shop of this workspace (including another workspace's), a new shop is created every time. The slug comes from the name, a taken slug gets `-2`, `-3`; theme defaults to the default theme; enabled is on. Repeating a sync without the shop id therefore makes a second shop (Reference's code comment says it reuses a matching slug; the code does not).
  3. Currency defaults to the shop's stored one (new shops: INR); products always take the shop's currency.
  4. The shop part is validated as a whole: a missing name, a bad currency or theme, a bad `shop_id`, no products or more than 500 products is a 422 and nothing is written.
  5. A shop sync does not need a connected WhatsApp number (the shop wizard does; Reference's add-on did not), and never changes the shop's device, domain or enabled flag.
  6. The shop is saved before the products. If every product row fails, the shop change stays (Reference rolled back everything because it validated all rows first).
- **Async & events:** audit row and `storefront.created` or `storefront.updated` event, as for any shop change.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given no `shop_id`, when a sync runs with the name "Corner Store", then a shop with slug `corner-store`, the default theme, enabled, currency INR exists and the answer says `created: true`.
  - Given the shop's id, when a sync runs with a new name, then the name changes, the slug does not, and the answer says `created: false`.
  - Given a `shop_id` of another workspace's shop, then a new shop is made in this workspace and the other shop is unchanged.
  - Given a missing shop name, then 422 `VALIDATION_FAILED` with `details.shop_name` and no shop is written.
  - Given a role without `store.shops.manage`, then the answer is 403 and no shop is written.
- **Source refs:** `SheetsAddonController.php` (`sync`, the shop part), `WaStorefront` model (themes, default theme).
- **Port notes:** `ShopsService.upsertForIntegration` (storefront-builder). The wizard's "needs a sender" rule is deliberately not applied here.

### TW-EXT-010 — Bulk upsert products from sheet rows, matched by SKU then name

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-EXT-009
- **Summary:** The second half of a sync: each sheet row becomes a product, created or updated.
- **Actors & access:** as TW-EXT-009. Per row: creating needs `cat.products.create`, updating needs `cat.products.update`.
- **UX & screens:** the add-on shows how many were created, updated, unchanged and failed, with the failed rows' messages.
- **Endpoints:** part of `POST api/v1/sheets-addon/sync`. Each product: `name` (required, at most 191), `category` (at most 96), `description` (at most 2000), `image_url` (a full web address, at most 1024), `price` (required, number from 0 to 1,000,000), `sku` (at most 96), `stock` (whole number from 0), `active` (flag). Answer: `{ ok, shop: {...}, products: { created, updated, unchanged, failed, total, results[] } }`.
- **Data:** products with the price stored as the amount times 100 (minor units), currency of the shop, stock count (null means unlimited), status `active` or `draft`, in-stock flag.
- **Rules & edge cases:**
  1. Match: the product with the same SKU in the workspace when a SKU is given and found, else the product with the same name (case-insensitive); the oldest wins.
  2. A matched product is updated; the name always takes the sheet's spelling. A field the row leaves out keeps its stored value (description, category, image, SKU).
  3. `active` left out means active (QUIRK kept: an absent column re-activates a product that was off). `active: false` means a draft and out of stock.
  4. `stock`: a number sets the count; an empty cell or null means unlimited; leaving the field out keeps the stored count.
  5. Price is rounded to the minor unit; the shop's currency always applies.
  6. Products not in the request are untouched: the add-on is additive, never destructive.
  7. Each row is read and written on its own. A bad row (no name, bad price, bad image address, a plan product cap reached, a role that may not edit) is reported with its index, the client's `ref`, a stable code and the field; the other rows still go through. Reference refused the whole request on the first bad row; this is a deliberate improvement and is in the parity file.
  8. Writes go through the product form's own create and update, so the plan's `catalog_products` cap, audit, the `product.*` events and the push to the Meta catalog behave as for a product added by hand.
  9. The answer's `total` is created plus updated, as in Reference.
- **Async & events:** per product: audit, `product.created` or `product.updated`, `catalog.product_changed`; the push to Meta follows the commit and never fails the row.
- **External systems:** Meta catalog (through the existing catalog sync, unchanged).
- **Settings:** the plan limit `catalog_products`.
- **Acceptance criteria:**
  - Given two valid rows, then two products exist with price times 100, the shop's currency and the member as owner, and the answer counts 2 created.
  - Given the same SKU in a second sync with a new price, then the product is updated, not duplicated; an identical repeat reports `unchanged`.
  - Given a row with the same name but no SKU in another case, then it matches the existing product.
  - Given rows of which two are bad, then the good ones are saved, the bad ones are reported by index with `field`, and `failed` equals 2.
  - Given a plan cap of 2 products, when three new rows arrive, then the third fails with `PLAN_LIMIT_REACHED` and the first two are saved.
  - Given a role that may create but not edit products, then an existing product row fails with `FORBIDDEN` and a new one is created.
  - Given another workspace's product with the same SKU, then it is never matched or changed.
- **Source refs:** `SheetsAddonController.php` (`sync`, the product loop), `WaProduct` model.
- **Port notes:** `SheetsCatalogService` + `ProductsService.upsertForIntegration` (catalog-products barrel).

### TW-EXT-011 — Pull contacts into a sheet

- **Status:** docs-only
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-EXT-004
- **Summary:** New in this port (not in Reference's add-on, owner request). The add-on reads the workspace's contacts, a page at a time, to fill a sheet.
- **Actors & access:** the key's owner. Consented scope `contacts.read`; role `record.contacts.read` with its record scope (a member limited to their own contacts sees only those).
- **UX & screens:** a "Pull contacts" action in the add-on; it follows the cursor until `has_more` is false.
- **Endpoints:** `GET api/v1/sheets-addon/contacts?limit=&cursor=&q=` → `{ ok, contacts[], next_cursor, has_more }`. Limit 1 to 500, default 200. Contact: id (uuid), name, first and last name, email, phone, source, is_unsubscribed, attributes (the workspace's custom properties by key), created-at, updated-at.
- **Data:** contacts, newest first, keyset cursor.
- **Rules & edge cases:**
  1. `q` searches name, email and phone digits.
  2. A bad cursor or a limit over 500 is a 422.
  3. Archived contacts are not returned (the contact list's own rule).
  4. The shape is the same one TW-EXT-012 accepts, so a pull followed by a sync of the same rows changes nothing.
- **Async & events:** none (reads are not audited).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given five contacts and `limit=2`, then three calls return all five once, newest first, the last with `has_more: false`.
  - Given a role with `own` scope, then only contacts owned by the member are returned.
  - Given another workspace's contacts, then they are never returned.
  - Given `q`, then only matching contacts are returned.
  - Given a pull then a sync of the pulled rows, then every row is `unchanged`.
- **Source refs:** none in Reference; behaviour follows `docs/specs/marketplace-extension-listings.md` (scopes `contacts.read`, `contacts.write`).
- **Port notes:** `SheetsContactsService.pull` over `ContactsService.list`.

### TW-EXT-012 — Bulk upsert contacts from sheet rows with per-row results

- **Status:** docs-only
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-EXT-004
- **Summary:** New in this port (owner request). The add-on loads contacts from the sheet; each row is created or updated and reported on its own.
- **Actors & access:** the key's owner. Consented scope `contacts.write`; the role needs `record.contacts.create` or `record.contacts.update`, and each row is checked against the one it needs.
- **UX & screens:** the add-on shows created, updated, unchanged and failed counts and lists the failed rows with their message.
- **Endpoints:** `POST api/v1/sheets-addon/contacts/sync` → `{ ok, summary: { created, updated, unchanged, failed, total }, results[] }`. Request: `default_country_code` (optional) and `rows` (1 to 500). Row: `ref`, `name`, `first_name`, `last_name`, `email`, `phone` (text or number), `country_code`, `source`, `is_unsubscribed`, `attributes`.
- **Data:** contacts and their identities (email, phone), custom properties.
- **Rules & edge cases:**
  1. A blank cell is "not given": it never clears a stored value, and a number cell is read as its text.
  2. Email is lower-cased and checked; a phone is made international (E.164) using the row's `country_code`, else `default_country_code`; a number that does not name its country and has no default is refused for that row.
  3. A row needs an email or a phone, else it fails with `VALIDATION_FAILED`, `field: email`.
  4. Match: a contact that already holds the row's email, else the row's phone (the same identity rule as everywhere in the CRM). Match found: update only what differs; nothing differs: `unchanged`. No match: create (owner is the key's owner, source `google_sheets` unless the row gives one).
  5. A row whose email belongs to one contact and phone to another fails with `CONFLICT`; neither is changed.
  6. Rows are processed in order, one transaction each, so a later row for the same person sees the earlier one and one bad row never rolls back the rest.
  7. A role that may only create fails an update row with `FORBIDDEN`; a role that may only update fails a create row; a record scope that does not cover the contact fails the row with `NOT_FOUND`.
  8. The plan's contact cap, the workspace's required properties and the CRM's own validation apply per row; their messages come back on the row.
  9. The opt-out flag is set from the sheet (`yes`, `true`, `1`) and stamps the time, as in the app.
- **Async & events:** the contact's own audit and `contact.*` events per row, as the member; one summary audit row and one `ext.sheets.synced` event for the call (TW-EXT-014).
- **External systems:** none.
- **Settings:** the plan's contact cap.
- **Acceptance criteria:**
  - Given three valid rows, then three contacts exist, owned by the member, with E.164 phones and source `google_sheets`.
  - Given six rows of which four are bad, then two are created, four are reported with index, `ref`, code and `field`, and the answer is 200.
  - Given a blank name cell on an existing contact, then the stored name is unchanged.
  - Given the same row twice in one call, then the second reports `unchanged` (or `updated` when it adds something).
  - Given an email of contact X and a phone of contact Y, then the row fails with `CONFLICT` and X and Y are unchanged.
  - Given a create-only role and an existing contact's email, then that row fails with `FORBIDDEN`.
  - Given the same email in two workspaces, then each workspace's contact is separate and a sync never touches the other.
  - Given 501 rows or an empty list, then 422 naming `rows`.
- **Source refs:** none in Reference.
- **Port notes:** `SheetsContactsService.sync` over `ContactsService.create/update` and `ContactsRepository.findByIdentity`; phone rules from `canonicalizePhone`.

### TW-EXT-013 — Install per workspace, consented scopes and the member's role gate every action

- **Status:** docs-only
- **Priority:** P0
- **Effort:** M
- **Depends on:** marketplace
- **Summary:** New in this port (design note `docs/specs/marketplace-extension-listings.md`). The add-on is a free Marketplace listing of the `client` type (slug `google-sheets`). An admin installs it once for the workspace and consents to its scopes; each member then creates their own key and acts under their own role.
- **Actors & access:** an admin installs (`market.apps.install`, which needs every permission behind the requested scopes); members use it with `app.google-sheets.use` (granted to the Admin preset by the listing's migration, to other roles by an admin).
- **UX & screens:** the Marketplace listing and its install consent (Marketplace domain); the setup page's "not installed" state.
- **Endpoints:** none of its own; enforced on every route of TW-EXT-001, 004, 008 to 012, 015.
- **Data:** the installation row (status, consented scopes); the listing's scopes are `contacts.read`, `contacts.write`, `catalog.read`, `catalog.write`.
- **Rules & edge cases:**
  1. No active installation: creating a key and every add-on call fail with `EXT_APP_NOT_INSTALLED` (403). A disabled or killed installation counts as not installed. An uninstall deletes the row, so access ends at the next call; the keys stay stored and work again if the add-on is reinstalled.
  2. A call needs its scope to be among the consented ones (`EXT_SCOPE_NOT_GRANTED`, 403) AND the member's role to hold the permissions behind it (`FORBIDDEN`, 403). Consent is a ceiling, the role is the floor: neither alone is enough.
  3. The plan feature `marketplace` must be on.
  4. Reading what a member may do: `GET health` returns the four capabilities already intersected.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** the plan feature `marketplace`; the plan limit `installed_apps` (at install).
- **Acceptance criteria:**
  - Given the add-on is not installed, then a member cannot create a key and a call with an old key is refused with `EXT_APP_NOT_INSTALLED`.
  - Given the install consented only to `contacts.read`, then a contact sync is refused with `EXT_SCOPE_NOT_GRANTED` although the member's role could write.
  - Given a viewer role, then reads pass, writes are 403 `FORBIDDEN`, and nothing is written.
  - Given an admin removes `record.contacts.update` from the member's role, then the member's next sync cannot edit.
  - Given an admin removes `app.google-sheets.use` from the member's role, then the member's key is refused on its next call.
- **Source refs:** none in Reference (Reference has no install concept; the add-on is a manual copy).
- **Port notes:** `SheetsAppAccess` reads the `workspace_app_installations` row for the `google-sheets` listing; the scope registry gained `catalog.read` and `catalog.write` and the draft listing version asks for them (migration). `app.google-sheets.use` was seeded by `20261027090100_mkt_client_listings.sql`.

### TW-EXT-014 — Audit trail and event for every add-on write

- **Status:** docs-only
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-EXT-010, TW-EXT-012
- **Summary:** New in this port. Every contact and product written through the add-on is audited as the member by the service that owns it; each call also leaves one summary row saying it came from the Sheets add-on and how it ended.
- **Actors & access:** whoever reads the audit log.
- **UX & screens:** the activity log (notifications-activity-audit).
- **Endpoints:** none.
- **Data:** audit row `module = ext_sheets_sync`, record = the member's settings row, delta: kind (`contacts` or `products`), rows, created, updated, failed. Outbox event `ext.sheets.synced` with the counts. Key changes use module `ext_sheets_key`. Row contents (emails, names) are not copied into either.
- **Rules & edge cases:** written in the transaction of the summary itself; a call with only failed rows still leaves its summary.
- **Async & events:** `ext.sheets.synced`, `ext.sheets_key.generated`, `ext.sheets_key.revoked`.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a contact sync of 6 rows with 2 created and 4 failed, then one summary audit row records rows 6, created 2, failed 4 and one event exists.
  - Given two contacts created, then each has its own audit row with the member as the actor.
- **Source refs:** none in Reference.
- **Port notes:** `SheetsRunLog`.

### TW-EXT-015 — Health check: is the key good, who am I, what may I do

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-EXT-004
- **Summary:** The add-on's Save button calls this to prove the pasted key works and to show who it belongs to.
- **Actors & access:** the key's owner.
- **UX & screens:** the add-on's settings dialog shows the member's name and email and the workspace.
- **Endpoints:** `GET api/v1/sheets-addon/health` (`api.sheets.health`, `SheetsAddonController@health`) → Reference: `{ ok, user: { id, name, email }, workspace, server_time }`. Port adds `workspace` as `{ id, name }`, `can` (read_contacts, write_contacts, read_catalog, write_catalog), `limits` (max_rows, max_pull) and `api_version: 1`.
- **Data:** none written (last-used aside).
- **Rules & edge cases:** Reference's `workspace` was a bare id; the port's is an object (the one incompatible shape change, noted in the parity file). The add-on should treat `can` as the source of truth for which menu actions to offer.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a valid key, then the answer names the member, the workspace and the four capabilities, and `server_time` is current.
  - Given a viewer role, then the write capabilities are false.
  - Given no or a wrong key, then 401 as TW-EXT-004.
- **Source refs:** `SheetsAddonController.php` (`health`).
- **Port notes:** `SheetsAddonService.health`.

### TW-EXT-017 — Webhook trigger: send new or changed rows as contacts, Initial Setup, Send Test

- **Status:** docs-only
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-EXT-004, TW-EXT-012
- **Summary:** New in this port (owner request, modelled on Pabbly's Google Sheets webhook add-on). Instead of pressing Push, the member pastes a **Webhook URL** into the add-on's Initial Setup, chooses a sheet and a trigger column, sends a test, and submits. From then on rows are sent when edited ("Send on event") and/or in an hourly sweep ("Send on schedule"), and arrive as contacts.
- **Actors & access:** as TW-EXT-012 (consented scope `contacts.write`, role `record.contacts.create` or `update`, per row).
- **UX & screens:** setup page: the Webhook URL (full once, with the key; masked after), the steps, and "Last data received" (the columns and first row of the last test or send). In the add-on: Initial Setup dialog (Webhook URL, sheet, trigger column, Send on event, Send on schedule, Send Test, Submit, Remove connection) and a "Send a test row" menu item.
- **Endpoints:** `POST api/v1/sheets-addon/webhook` (bearer) and `POST api/v1/sheets-addon/webhook/:key` (the pasted URL). Setup data: `webhookUrl` on `POST /v2/extension/sheets/key` and the overview.
- **Data:** no table. The last capture is a Redis value per member for 24 hours. The add-on keeps what it sent in a hidden `CRM sync state` sheet of the member's spreadsheet and its settings in Google user and document properties.
- **Rules & edge cases:** 1. A `test` event writes nothing and records the columns. 2. `edit` and `schedule` run the `contacts/sync` path unchanged. 3. The key is the last path segment of the URL and is masked in logs and Sentry; a header-borne key is read first. 4. One published add-on serves every installation because the server address comes from the pasted URL. 5. The trigger column is a letter or a row-1 heading; blank means any change. 6. The hourly sweep sends only rows new or changed since last sent. 7. Products are not sent by the trigger.
- **Async & events:** the contact events and summary audit of TW-EXT-012/014 (`ext.sheets.synced`).
- **External systems:** Google Apps Script triggers (edit, hourly) in the member's own account; Google Workspace Marketplace for distribution.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a key, when the add-on posts a `test`, then no contact is written and the setup page lists the columns sent.
  - Given an `edit` call with a valid and an identity-less row, then one contact is created and the other is reported failed.
  - Given the key as the last path segment or as a bearer header, then both work; a wrong key is the same 401 either way.
  - Given 0 or 501 rows or an unknown event, then 422.
  - Given the setup page after a key was created, then only the masked URL is in the answer.
- **Source refs:** none in Reference (Reference's add-on has no trigger mode); behaviour follows the Pabbly Connect Google Sheets add-on the owner named.
- **Port notes:** `SheetsWebhookService`; guard reads `params.key` when no bearer header; `maskSecretUrl` extended. The Apps Script side is `Code.gs` (`submitSetup`, `testWebhook`, `crmOnEditSend`, `crmScheduledSend`) and `Settings.html`; not run in a real sheet yet.

### TW-EXT-016 — Send a WhatsApp message or template from a sheet

- **Status:** docs-only
- **Priority:** P2
- **Effort:** L
- **Depends on:** message-templates, team-inbox-conversations
- **Summary:** Blocked, not built. Reference's add-on has no sending (its README says it "does not write back" and its three routes are shops and products only), so there is no behaviour to port. The listing text of this port mentions messages, and the scope registry has `messages.send` (high risk), so it may be wanted later.
- **Actors & access:** would need the consented scope `messages.send` and a role with `inbox.conversation.reply`, plus its own per-action permission key (the design note asks for one for a dangerous action).
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** none.
- **Rules & edge cases:** the customer REST API already sends messages and templates under a `wsk_` key (`POST api/v1/messages`, `POST api/v1/templates/{id}/send`). A clean Sheets version should call the same sending service, with the same opt-out, window and wallet rules, never provider code of its own.
- **Async & events:** n/a.
- **External systems:** n/a.
- **Settings:** n/a.
- **Acceptance criteria:**
  - Given the feature is not built, then the add-on API has no route for it and `health.can` has no field for it.
- **Source refs:** `google-sheets-addon/README.md` (privacy text: read only), `SheetsAddonController.php` (three routes).
- **Port notes:** BLOCKED (`blocked`, id TW-EXT-016): needs an owner decision (is it wanted, which key, which per-action permission) and a design for template variables per row. Do not add it silently.

## Data model

No new table. The member's key lives in `user_settings` (auth domain, tenant table, forced RLS, one row per member):

| Column                    | Notes                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------- |
| `sheets_key_hash`         | sha256 hex of the full key; unique across the platform where not null (partial index) |
| `sheets_key_suffix`       | last 8 characters of the key, a label for the member                                  |
| `sheets_key_created_at`   | set on generate                                                                       |
| `sheets_key_last_used_at` | cleared on generate and revoke; written by the add-on API at most once a minute       |

The installation is read from `workspace_app_installations` (marketplace) for the app `google-sheets`: status `active` and `granted_scopes`.
Shops are `wa_storefronts`, products `wa_products`, contacts `contacts` and `contact_identities`; all are owned by their own domains and written only through those domains' services.

## Cross-domain contracts

- **Consumes** marketplace: the `google-sheets` listing, its install row, the permission key `app.google-sheets.use`, the scope registry (`contacts.read`, `contacts.write`, and new `catalog.read`, `catalog.write`).
- **Consumes** roles-permissions: `RbacService.grantsForUser` (the key owner's live grants, cached per workspace roles version).
- **Consumes** auth-registration-security: `AccountGateService` (member and workspace suspension), the `user_settings` table.
- **Consumes** catalog-products: `ProductsService.upsertForIntegration` and `ProductsRepository` (exported for this domain).
- **Consumes** storefront-builder: `ShopsService.listForIntegration` and `upsertForIntegration` (added for this domain).
- **Consumes** contacts-attributes-tags: `ContactsService.list/create/update`, `ContactsRepository.findByIdentity`.
- **Consumes** public-api: `ApiKeyAccessService` (plan rate ceiling, plan feature check).
- **Exposes** `SheetsAppAccess`, `SheetsKeyService` and the module from the barrel; the add-on API contract in `docs/api/chrome-extension-sheets-addon.md`.
- **Changed in other domains by this port** (additive): an error-renderer ordering rule in `common/filters` (the longest prefix wins), a body-size class `sheets-addon` in platform-infrastructure, a `COPY` of `apps/api/assets` in the API Dockerfile, a unique partial index on `user_settings.sheets_key_hash`.

## Open questions & quirks

1. QUIRK: Reference's sync without `shop_id` creates a new shop every time; its code comment claims it reuses a matching slug. Kept (TW-EXT-009).
2. QUIRK: an absent `active` re-activates an existing product (TW-EXT-010). Kept.
3. QUIRK: an unknown or foreign `shop_id` silently makes a new shop. Kept; the port never touches the foreign shop.
4. Reference validated the whole product list before writing and refused it on the first bad row; the port reports bad rows one by one. Intended difference.
5. Reference's `health.workspace` was a bare integer and shop ids were integers; the port uses uuids and an object. Intended difference; the add-on is new code, so nothing existing breaks.
6. Reference's README names a `Sidebar.html` while the served file list names `Dialog.html`, `Settings.html` and `Help.html`; the controller's list is the one that is served and is what the port keeps.
7. Keys are not revoked when the add-on is uninstalled: they stay dormant and work again after a reinstall. Decide whether an uninstall should clear them.
8. A key never expires. A rotation reminder or an optional expiry is not in Reference and not built.
9. Ownership: EXT was first assigned to Shubham; Lakshya now owns it (ownership files updated) and the Sheets part was built on his explicit request.
10. TW-EXT-016 (sending from a sheet) needs an owner decision before any work.

## Coverage

```json threadwise-coverage
{
  "routes": [
    "GET api/v1/sheets-addon/health",
    "GET api/v1/sheets-addon/shops",
    "POST api/v1/sheets-addon/sync",
    "POST account/sheets-key/generate",
    "POST account/sheets-key/revoke",
    "GET sheets-addon",
    "GET sheets-addon/file/{file}"
  ],
  "controllers": ["app/Http/Controllers/Api/SheetsAddonController.php"],
  "services": [],
  "models": [],
  "tables": [],
  "views": ["resources/views/user/integrations/sheets-addon.blade.php"],
  "commands": [],
  "permissions": [],
  "middleware": [],
  "node_files": [],
  "js_assets": [],
  "misc_files": [],
  "config_files": [],
  "doc_pages": [],
  "feature_map": {
    "TW-EXT-001": ["POST account/sheets-key/generate"],
    "TW-EXT-002": ["GET sheets-addon"],
    "TW-EXT-003": ["POST account/sheets-key/revoke"],
    "TW-EXT-005": ["GET sheets-addon/file/{file}"],
    "TW-EXT-006": ["GET sheets-addon"],
    "TW-EXT-008": ["GET api/v1/sheets-addon/shops"],
    "TW-EXT-009": ["POST api/v1/sheets-addon/sync"],
    "TW-EXT-010": ["POST api/v1/sheets-addon/sync"],
    "TW-EXT-015": ["GET api/v1/sheets-addon/health"]
  }
}
```
