---
domain: catalog-products
code: CAT
title: WhatsApp commerce catalog and products
wadesk_version: '1.7.0'
sources_read: 62
---

# WhatsApp commerce catalog and products

## Overview

This domain is the merchant's product list and everything that turns it into WhatsApp selling. Three surfaces:

1. **Products** (`/store/products`, owned here even though it lives under the Store menu): the workspace-wide product table that every
   commerce feature reads (`wa_products`): create, edit, delete, share links, "send this product to a number", the JSON list the inbox
   picker uses, and the moderation queue for storefront reviews (`/store/reviews`).
2. **The Catalog area** (`/catalog`, "WhatsApp Catalog", four tabs Setup / Send / Collections / Activity). Setup binds the workspace to a
   Meta Commerce Catalog (direct Meta Cloud or 360dialog), pushes products up in batches, pulls products down, toggles the cart and
   catalog-button, keeps a health score, and holds the automation switches (cart-order acknowledgement, "concierge"). Send fires a
   product card, a product list or a catalog link to up to 500 numbers. Collections are saved, ordered product groups sent as one list
   message. Activity is a log of catalog sends.
3. **Background and inbound behaviours**: an observer that re-pushes a product to Meta whenever a catalog-relevant field changes, a
   sweep command (`catalog:resync`), the stock hold / commit / release ledger used by WhatsApp natural-language ordering, the alias
   matcher, and the two inbound automations (the concierge answering free-text product questions, the order acknowledgement after a
   customer sends a cart).

Actors: workspace owner/admin (every screen here is gated to role admin or above; platform admins bypass), the end customer (receives
the messages, submits reviews on the storefront), and the platform super-admin (one settings page, `/admin/settings/catalog`).

**Two ways to send, one rule of precedence.** If the workspace has a `wa_catalogs` row (a Meta catalog is linked), every catalog send
goes through the Meta Cloud API (single product, product list, or a text link), regardless of which sender the operator picked. Only a
workspace with no linked Meta catalog sends a Baileys carousel through the Node bridge (cards with image, price and an "Order Now"
button) or a storefront text link. See WD-CAT-015.

**Plan tiers.** The `/catalog/*` routes require the plan flag `access_wa_storefront` (GET pages still render with a paywall overlay;
mutations are refused). The `/store/products` and `/store/reviews` routes carry only the role gate (no plan gate), although the
documentation claims otherwise.

**Currency model.** `price_minor` is always the major amount times 100, for every currency, including zero- and three-decimal ones.
Conversion to and from Meta's per-currency minor unit happens only at the Meta boundary (WD-CAT-026).

Connections: `team-inbox-conversations` (the in-conversation catalog picker and `catalogContent`, WD-CAT-031),
`whatsapp-cloud-api-waba` (the WABA config that `autodetect` reads; `wa_provider_configs`), `whatsapp-devices-baileys` and
`node-bridge-runtime` (carousel send, connected devices), `contacts-attributes-tags` (recipient groups and contacts on the Send tab),
`wallet-message-billing` (plan-first overflow billing per catalog message), `plans-subscriptions-trials` (the plan flag),
`roles-permissions` (role gate), `platform-settings-branding-storage` (system settings, media disk), `flow-runtime-engine` and
`flow-builder-editor` (commerce nodes read products, stock and catalogs), `auto-reply-keywords` (a keyword reply can "send catalog"),
`message-templates` (catalog templates list products; a linter warning reads the catalog), the storefront / checkout-orders /
Shopify / WooCommerce / Google-Sheets / ordering features (they read and write `wa_products`, see Cross-domain contracts).

## Feature index

| Id         | Feature                                                              | Status      | Priority | Effort | Depends on    |
| ---------- | -------------------------------------------------------------------- | ----------- | -------- | ------ | ------------- |
| WD-CAT-001 | Catalog area shell, tabs, connection badge, role and plan gate       | implemented | P0       | S      |               |
| WD-CAT-002 | Connect catalog manually (Meta Cloud or 360dialog) with verification | implemented | P1       | M      | 001, 034      |
| WD-CAT-003 | Link catalog from the connected WABA number (autodetect)             | implemented | P1       | M      | 001, 034      |
| WD-CAT-004 | Disconnect catalog                                                   | implemented | P1       | S      | 002           |
| WD-CAT-005 | Commerce settings (cart, catalog button) pushed to Meta              | implemented | P2       | S      | 002, 034      |
| WD-CAT-006 | Catalog automation settings                                          | implemented | P1       | S      | 002           |
| WD-CAT-007 | Catalog health score and products to fix                             | partial     | P2       | S      | 020           |
| WD-CAT-008 | Setup tab content and states                                         | partial     | P0       | M      | 001, 007, 009 |
| WD-CAT-009 | Sync products to Meta (chunked push)                                 | implemented | P0       | M      | 002, 033, 034 |
| WD-CAT-010 | Poll Meta batch status                                               | implemented | P0       | S      | 009           |
| WD-CAT-011 | Import products from Meta                                            | implemented | P1       | M      | 002, 026, 034 |
| WD-CAT-012 | Auto-sync on product create and update                               | implemented | P1       | M      | 009, 033      |
| WD-CAT-013 | Scheduled catalog:resync sweep                                       | partial     | P1       | S      | 009, 010      |
| WD-CAT-014 | Send tab: recipients, sender, shop, format, products, message        | implemented | P0       | L      | 001, 024      |
| WD-CAT-015 | Catalog message sending engines and inbox mirroring                  | implemented | P0       | XL     | 014, 031, 034 |
| WD-CAT-016 | Activity tab                                                         | implemented | P2       | S      | 015           |
| WD-CAT-017 | Collections (product sets): create, update, delete                   | implemented | P1       | M      | 001           |
| WD-CAT-018 | Collections tab UI and send-a-collection action                      | implemented | P1       | M      | 017, 015      |
| WD-CAT-019 | Products list                                                        | implemented | P0       | M      | 026           |
| WD-CAT-020 | Product create and edit form                                         | implemented | P0       | L      | 026, 012      |
| WD-CAT-021 | Product delete                                                       | implemented | P1       | S      | 019           |
| WD-CAT-022 | Product share-links modal                                            | implemented | P1       | S      | 019           |
| WD-CAT-023 | Send one product to a WhatsApp number                                | implemented | P1       | M      | 022           |
| WD-CAT-024 | Products JSON list for the inbox catalog picker                      | implemented | P0       | S      | 026           |
| WD-CAT-025 | Stock and reservations                                               | implemented | P1       | M      | 020           |
| WD-CAT-026 | Money and currency rules                                             | implemented | P0       | M      |               |
| WD-CAT-027 | Product reviews moderation                                           | implemented | P1       | M      | 019           |
| WD-CAT-028 | Catalog concierge (free text to product list)                        | implemented | P2       | L      | 006, 034      |
| WD-CAT-029 | Catalog order acknowledgement                                        | implemented | P1       | M      | 006           |
| WD-CAT-030 | Admin catalog settings                                               | partial     | P2       | S      |               |
| WD-CAT-031 | Catalog picker in the team-inbox conversation (contract)             | implemented | P0       | L      | 024, 015      |
| WD-CAT-032 | Product aliases and order-text matching                              | partial     | P2       | M      | 025           |
| WD-CAT-033 | Meta product payload and availability derivation                     | implemented | P0       | M      | 026           |
| WD-CAT-034 | Catalog provider abstraction (Meta Cloud, 360dialog)                 | implemented | P0       | M      |               |

## Features

### WD-CAT-001 — Catalog area shell, tabs, connection badge, role and plan gate

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** none
- **Summary:** the "WhatsApp Catalog" area is one Blade layout that renders one of four tabs (Setup, Send, Collections, Activity) under a
  header strip and a tab strip. The header shows a green "{PROVIDER} · connected" pill when the workspace has a Meta catalog row and a
  grey "Not connected" pill otherwise. Only workspace admins and owners on a plan with the storefront flag can reach it.
- **Actors & access:** workspace role owner or admin (hierarchy owner > admin > manager > agent > viewer; manager, agent and viewer are
  refused: agents and viewers are redirected to `/team-inbox` with a warning, a manager gets 403). Platform admins (Spatie Super Admin or
  Admin, or legacy `users.role = admin`) bypass the role check. Plan flag `access_wa_storefront`: on a plan without it a GET page
  still renders but a paywall overlay is shared to the view; any POST/PUT/DELETE is refused with 403 JSON
  (`error: plan_feature_disabled`, `feature`, a message saying the plan does not include the feature) for AJAX, or a back-redirect with a
  warning flash otherwise. No permission keys. A user with no `current_workspace_id` is redirected to `/dashboard` on the page routes and
  gets 403 on the POST routes.
- **UX & screens:** `resources/views/user/catalog/index.blade.php`. Breadcrumb "Integrations / WhatsApp Catalog" with a back arrow to
  `/integrations`, title "Push products into WhatsApp chats". Tab strip: Setup (`/catalog`), Send (`/catalog/send`), Collections
  (`/catalog/collections`), Activity (`/catalog/activity`); the active tab has an underline. A green status flash (`status` session key)
  and a red error list (all validation errors) render above the tab content. The nav key is "more" (the entry lives under the header's
  More menu). No realtime behaviour.
- **Endpoints:** see WD-CAT-008, 014, 016, 018 for the four GET routes; every catalog route shares the middleware
  `auth`, `workspace.role:admin`, `plan:access_wa_storefront`.
- **Data:** reads `wa_catalogs` (one row per workspace and provider; the badge uses the first row found) for the pill.
- **Rules & edge cases:**
  1. The pill label is the provider code upper-cased with underscores turned into spaces ("META CLOUD", "DIALOG 360").
  2. The workspace may hold up to two `wa_catalogs` rows (one per provider) but every page and action uses `first()`; the second row is
     ignored by the UI (see Open questions).
  3. The plan gate is checked by the shared plan middleware, not by the controller.
  4. The area is not hidden when the admin setting `catalog_enabled` is off (that setting is stored but never read, WD-CAT-030).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** plan flag `access_wa_storefront`; admin setting `catalog_enabled` (inert).
- **Acceptance criteria:**
  - Given a workspace admin on a plan with the flag, When they open `/catalog/collections`, Then the page renders with the Collections tab
    underlined and the "Not connected" pill when no catalog row exists.
  - Given an agent, When they request any `/catalog*` URL, Then they are redirected to `/team-inbox` with a role warning.
  - Given a plan without `access_wa_storefront`, When an admin POSTs `catalog/connect` via AJAX, Then the response is 403 with
    `error = plan_feature_disabled` and nothing is written.
  - Given a plan without the flag, When the admin opens a GET tab, Then the page renders and the paywall overlay is flagged.
- **Source refs:** resources/views/user/catalog/index.blade.php, routes/web.php:1095-1117, app/Http/Middleware/EnsureWorkspaceRole.php,
  app/Http/Middleware/EnforcePlanFeature.php, Documentation/pages/commerce/catalog.html.
- **Port notes:** nothing exists in the repo yet (no catalog module under `apps/api/src/modules`). Suggested home
  `apps/api/src/modules/catalog-products/` with a plan guard on feature `wa_storefront` (see `plans-subscriptions-trials` for the flag
  name used in this repo) and a permission key set (propose `catalog.manage`, `store.products.manage`, `store.reviews.moderate`, granted to
  Admin and Owner); an agent calling these must get 403 problem+json, not a redirect. Web home `apps/web` catalog segment with the four
  tabs as routes.

### WD-CAT-002 — Connect catalog manually (Meta Cloud or 360dialog) with verification

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-CAT-001, WD-CAT-034
- **Summary:** the operator pastes a Catalog ID and an access token (plus optional WABA id, phone-number id and a label), chooses the
  provider, and the app saves the binding then immediately verifies it against Meta. A failed verification deletes the row again and
  shows Meta's own error with an actionable hint.
- **Actors & access:** WD-CAT-001 gates. Plan-gated mutation.
- **UX & screens:** `_connect-form.blade.php` (form, two layouts: full or compact). Fields: Provider select (Meta Cloud API direct,
  360dialog BSP), Catalog ID (required, max 64, placeholder digits), Catalog name (label, max 191), WABA ID (max 64), Phone number ID
  (max 64), Access token / API key (password field, required, min 20, max 4096, hint "stored encrypted, verified on save"), buttons
  Cancel (back to `/integrations`, full layout only) and "Connect & verify". The form is reachable only inside the collapsed "Optional ·
  advanced" panel of the Setup tab when a device exists (and, per the view source, is not rendered at all when there is no device and no
  catalog, see WD-CAT-008). Errors appear under the access-token field in the top error list, with the submitted values kept.
- **Endpoints:**

| METHOD uri           | route name           | Controller@action         | middleware                                                 | request                                                                                                  | response                                                                 |
| -------------------- | -------------------- | ------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| POST catalog/connect | user.catalog.connect | CatalogController@connect | web, auth, workspace.role:admin, plan:access_wa_storefront | provider (meta_cloud or dialog_360), catalog_id, catalog_name?, waba_id?, phone_number_id?, access_token | redirect `/catalog` with status "Catalog connected." or back with errors |

- **Data:** upserts `wa_catalogs` keyed by (workspace_id, provider): catalog_id, catalog_name (null when blank), waba_id, phone_number_id,
  access_token_enc (encrypted cast, hidden from serialisation), `is_cart_enabled = true`, `is_catalog_visible = true`. Re-connecting the
  same provider overwrites the row (and its `meta_json` is preserved because only the listed columns are updated).
- **Rules & edge cases:**
  1. Validation: provider in {meta_cloud, dialog_360}; catalog_id required string max 64; catalog_name nullable max 191; waba_id and
     phone_number_id nullable max 64; access_token required string, 20 to 4096 chars.
  2. The row is written first, then `verifyCatalog()` runs (GET the catalog object asking for id, name, product_count, vertical,
     is_catalog_segment). On any failure the row is deleted. This includes a row that previously existed for that provider (it is
     overwritten then deleted, so a failed re-connect destroys the old working connection; see Open questions).
  3. Meta failure message is built from the error envelope: the Meta message (or "unknown error"), then ` (code N)` or `(code N/subcode)`
     when a code exists, then a hint when the code is 100 or the text mentions "unsupported get request": the token probably lacks the
     `catalog_management` permission (a messaging-only token can send catalog messages but cannot read the catalog) or the Catalog ID is
     wrong; use a System User token with catalog_management and business_management and copy the Catalog ID from Commerce Manager.
     The message is attached to the `access_token` field.
  4. Any non-Meta failure (network, unexpected) deletes the row and shows a generic "could not verify right now, check the Catalog ID and
     token and try again" on the access-token field, and logs a warning. No raw 500 leaks.
  5. The access token is encrypted at rest and never returned or logged.
  6. The phone-number id is required later for Meta-Cloud message sends and commerce settings; it is optional here (a Meta Cloud catalog
     saved without it verifies fine but cannot send, WD-CAT-034).
- **Async & events:** none (synchronous). A warning is logged on unexpected failure.
- **External systems:** Meta Graph API `GET /{version}/{catalog_id}` with `Authorization: Bearer` (Meta Cloud) or `D360-API-KEY` header
  (360dialog), 30 s timeout, two attempts (WD-CAT-034).
- **Settings:** admin `catalog_graph_api_version` (default `v23.0`).
- **Acceptance criteria:**
  - Given valid credentials, When the admin submits the form, Then a `wa_catalogs` row exists for the provider with cart and catalog
    visibility true and the browser lands on `/catalog` with "Catalog connected."
  - Given Meta answers error code 100 "Unsupported get request", When the admin submits, Then no row remains, the access-token field shows
    Meta's message, `(code 100)` and the catalog_management hint.
  - Given an access token of 10 characters, When submitted, Then validation fails (min 20) and nothing is written.
  - Given the network call throws, When submitted, Then the half-created row is removed and the generic retry message is shown.
- **Source refs:** app/Http/Controllers/CatalogController.php:526-592, resources/views/user/catalog/_connect-form.blade.php,
  app/Models/WaCatalog.php, app/Services/WhatsAppCatalog/AbstractCloudCatalogProvider.php (verifyCatalog, decode).
- **Port notes:** table `wa_catalogs` exists in `20261001105000_cat_wadesk_schema.sql` with unique `(org_id, provider)`; encrypt
  `access_token_enc` with the platform `CryptoService` (AES-GCM) and never return it from any DTO. Do verify-then-persist inside one
  transaction instead of write-then-delete, so a failed re-connect cannot destroy a working connection (decision to record). Call Meta
  through a provider adapter (skill `provider-adapter`), not inline.

### WD-CAT-003 — Link catalog from the connected WABA number (autodetect)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-CAT-001, WD-CAT-034
- **Summary:** one button, "Fetch from my WhatsApp account", wires the Commerce catalog from the credentials already stored for the
  workspace's connected WABA number, so no ids or tokens are pasted. It finds the catalog id, or creates and links a new catalog on Meta
  when none exists and a business id is known.
- **Actors & access:** WD-CAT-001 gates. The button is only rendered when the workspace's engine is `waba` and no catalog is linked yet.
- **UX & screens:** a card in the Setup tab "ready" state ("Link your Meta Commerce Catalog"): copy explaining no ids are needed and it
  unlocks the official catalog button, cart and order webhook; button "Fetch from my WhatsApp account"; an `autodetect` error slot under the
  copy; the manual-connect `<details>` panel auto-opens when an autodetect error exists.
- **Endpoints:**

| METHOD uri              | route name              | Controller@action            | middleware                                                 | request | response                                                                                                        |
| ----------------------- | ----------------------- | ---------------------------- | ---------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------- |
| POST catalog/autodetect | user.catalog.autodetect | CatalogController@autodetect | web, auth, workspace.role:admin, plan:access_wa_storefront | none    | redirect `/catalog` with status "Catalog linked from your WhatsApp account." or back with an `autodetect` error |

- **Data:** reads `wa_provider_configs` (provider `waba`, status connected, ordered by is_primary desc then connected_at desc, first):
  decrypted credentials (`access_token`, optional `waba_id`, `phone_number_id`, `business_id`, `catalog_id`) and `meta_json` of the same
  keys (meta_json wins over credentials for each key). Writes `wa_catalogs` (upsert for provider `meta_cloud`) and, when it discovered a
  catalog id, merges `catalog_id` back into the WABA config's `meta_json`.
- **Rules & edge cases:**
  1. No connected WABA config: error "No connected WhatsApp Business (WABA) number found. Connect a WABA number first, or link manually".
  2. Token or WABA id empty after decoding: error saying the number is connected but its token could not be read, reconnect or link
     manually.
  3. Catalog id resolution order: (a) `catalog_id` from meta_json then credentials; (b) `GET /{waba_id}/product_catalogs` first entry;
     (c) when that list is empty/failed and a business id exists: `POST /{business_id}/owned_product_catalogs` creating a catalog named
     "{brand} · {today as Y-m-d}" with vertical `commerce`, then `POST /{waba_id}/product_catalogs` with that catalog id to link it. Steps
     b and c run in try/catch (12 s timeout) and only log failures.
  4. Nothing found: error "No product catalog is linked to your WhatsApp account yet. Create one in Meta Commerce Manager (or add a
     Business ID to your WABA connection), then try again, or link manually".
  5. The friendly name is fetched best-effort (`fields=name`, 10 s); fallback label "WhatsApp Catalog".
  6. The Graph version used here is the system setting `waba_graph_api_version` (default v23.0), not the catalog one (QUIRK: two
     different version settings).
  7. The row is upserted for provider `meta_cloud` with the WABA token, `is_cart_enabled` and `is_catalog_visible` true. Then
     `verifyCatalog()` runs; failure deletes the row and reports "Found catalog {id} but Meta rejected the stored token: {message}";
     unexpected failure reports "could not verify right now, try again".
  8. Same destroy-on-failure behaviour as WD-CAT-002 for an existing row.
- **Async & events:** none; warnings logged on list/create failures.
- **External systems:** Meta Graph (bearer token of the WABA config). Endpoints listed in rule 3.
- **Settings:** system settings `waba_graph_api_version`, brand name (used in the created catalog name).
- **Acceptance criteria:**
  - Given a connected WABA config whose meta_json already has a catalog id and a valid token, When the admin clicks the button, Then a
    `meta_cloud` catalog row is created with that id and the redirect says the catalog was linked.
  - Given no stored catalog id, a business id, and an empty product_catalogs list on Meta, When clicked, Then a catalog is created on Meta,
    linked to the WABA, saved locally and its id is merged into the WABA config.
  - Given no connected WABA number, When clicked, Then the `autodetect` error asks to connect a WABA number first and nothing is written.
  - Given the stored token is rejected by Meta, When clicked, Then the row is removed and the error names the catalog id.
- **Source refs:** app/Http/Controllers/CatalogController.php:594-722, resources/views/user/catalog/_setup.blade.php (autodetect card).
- **Port notes:** depends on the WABA connection module (`whatsapp-cloud-api-waba`) exposing decrypted token, waba id, business id and a
  place to store the catalog id; the SQL migration has `wa_catalogs` only. Use one graph-version setting for the whole catalog area.

### WD-CAT-004 — Disconnect catalog

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-CAT-002
- **Summary:** removes every catalog binding of the workspace and wipes the Meta sync state from all products; nothing is removed from
  Meta and no product is deleted.
- **Actors & access:** WD-CAT-001 gates. Only rendered on the connected Setup view.
- **UX & screens:** "Disconnect" button in the green header card; the browser asks "Disconnect the catalog? Products stay on Meta; we
  just stop syncing." before the POST.
- **Endpoints:**

| METHOD uri              | route name              | Controller@action            | middleware                                                 | request | response                                                |
| ----------------------- | ----------------------- | ---------------------------- | ---------------------------------------------------------- | ------- | ------------------------------------------------------- |
| POST catalog/disconnect | user.catalog.disconnect | CatalogController@disconnect | web, auth, workspace.role:admin, plan:access_wa_storefront | none    | redirect `/catalog` with status "Catalog disconnected." |

- **Data:** deletes all `wa_catalogs` rows of the workspace (hard delete, so the encrypted token is gone, `meta_json` automation settings
  are gone too). Updates every live (not soft-deleted) `wa_products` row of the workspace: `meta_sync_status`,
  `meta_batch_handle`, `meta_synced_at`, `meta_last_error` set to NULL. `meta_retailer_id` is kept.
- **Rules & edge cases:**
  1. Idempotent: with no catalog the call still succeeds and still nulls the product sync columns.
  2. The automation settings (WD-CAT-006) live in `meta_json` and are lost on disconnect; reconnecting starts from defaults.
  3. Keeping `meta_retailer_id` means a re-connect to the same catalog reuses the same identities (no duplicates on Meta).
  4. The product update uses a mass update, so the product observer (WD-CAT-012) does not fire.
  5. Collections, reviews, reservations are untouched.
- **Async & events:** none.
- **External systems:** none (no call to Meta).
- **Settings:** none.
- **Acceptance criteria:**
  - Given a connected catalog and 3 products with sync statuses, When the admin disconnects, Then no `wa_catalogs` row remains and every
    product has null status, handle, synced-at and error but keeps its retailer id.
  - Given no catalog, When disconnect is posted, Then it still redirects with the disconnected flash.
  - Given automation settings were saved, When the admin disconnects and reconnects, Then the automation form shows defaults.
- **Source refs:** app/Http/Controllers/CatalogController.php:724-736, resources/views/user/catalog/_setup.blade.php (header card).
- **Port notes:** run both writes in one transaction (WaDesk does not); emit an audit row; keep `meta_retailer_id`.

### WD-CAT-005 — Commerce settings (cart, catalog button) pushed to Meta

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-CAT-002, WD-CAT-034
- **Summary:** two checkboxes, "Show catalog in business profile" and "Enable cart", are pushed to Meta's WhatsApp commerce settings for
  the bound phone number and then stored locally.
- **Actors & access:** WD-CAT-001 gates. Requires a catalog row (404 via firstOrFail otherwise).
- **UX & screens:** Setup tab form "Commerce settings" with two checkboxes (hidden 0 plus checkbox 1 each), preset from the row, helper
  text for each ("Adds the Catalog button to your WhatsApp Business profile", "Buyers can add multiple products before sending the
  order") and a Save button.
- **Endpoints:**

| METHOD uri            | route name            | Controller@action                  | middleware                                                 | request                                          | response                                                                                   |
| --------------------- | --------------------- | ---------------------------------- | ---------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| POST catalog/commerce | user.catalog.commerce | CatalogController@commerceSettings | web, auth, workspace.role:admin, plan:access_wa_storefront | is_catalog_visible?, is_cart_enabled? (booleans) | back with status "Commerce settings updated." or errors key `settings` with Meta's message |

- **Data:** on success the catalog row's `is_cart_enabled` and `is_catalog_visible` are overwritten with the submitted values (a missing
  value means false).
- **Rules & edge cases:**
  1. No catalog row: 404.
  2. The catalog row must have a `phone_number_id`, otherwise the provider throws "Catalog has no phone_number_id bound, set commerce
     settings against a specific phone number" and the message is shown under `settings`.
  3. The local flags are updated only after Meta accepts; a Meta error leaves the local flags unchanged.
  4. Defaults at connect time are both true.
- **Async & events:** none.
- **External systems:** Meta Cloud `POST {messages-endpoint}/whatsapp_commerce_settings` with `is_cart_enabled` and
  `is_catalog_visible` (Meta Cloud base is `graph/{version}/{phone_number_id}`; 360dialog base is its host with no phone id).
- **Settings:** admin `catalog_graph_api_version`.
- **Acceptance criteria:**
  - Given a catalog with a phone number id, When the admin unticks "Enable cart" and saves, Then Meta receives cart false and the row
    stores `is_cart_enabled = false`.
  - Given a catalog without a phone number id, When saving, Then the error "no phone_number_id bound" shows and flags are unchanged.
  - Given Meta returns an error, When saving, Then the error text appears and the stored flags keep their old values.
- **Source refs:** app/Http/Controllers/CatalogController.php:1058-1077, app/Services/WhatsAppCatalog/AbstractCloudCatalogProvider.php
  (setCommerceSettings), resources/views/user/catalog/_setup.blade.php.
- **Port notes:** adapter method `setCommerceSettings`; return a problem+json with the Meta message rather than a flash.

### WD-CAT-006 — Catalog automation settings

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-CAT-002
- **Summary:** saves the switches that drive the order acknowledgement (WD-CAT-029) and the concierge (WD-CAT-028). They live as keys in
  the catalog row's `meta_json`; no call to Meta is made.
- **Actors & access:** WD-CAT-001 gates. Needs a catalog row (404 otherwise).
- **UX & screens:** Setup tab "Automation" form with two bordered groups.
  Order acknowledgement: checkbox "Auto-reply when a customer sends a cart" (default checked, text "buyer instantly gets an order-received
  message instead of silence"); "Payment link base (optional)" url field (placeholder example checkout url, helper "we append the order id;
  leave blank to just confirm receipt").
  Concierge: checkbox "Catalog concierge, auto-answer product questions" (default off); "Reply header" text (max 60, placeholder "Here's
  what I found"); "Max products" number (min 1, max 30, default 10); checkbox "Reply even when nothing matches" (default off); "No-match
  reply" text (max 1024). Button "Save automation".
- **Endpoints:**

| METHOD uri              | route name              | Controller@action                | middleware                                                 | request                                                                                                                                         | response                                      |
| ----------------------- | ----------------------- | -------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| POST catalog/automation | user.catalog.automation | CatalogController@saveAutomation | web, auth, workspace.role:admin, plan:access_wa_storefront | order_ack_enabled?, order_ack_pay_url?, concierge_enabled?, concierge_header?, concierge_max?, concierge_reply_on_empty?, concierge_empty_text? | back with status "Automation settings saved." |

- **Data:** `wa_catalogs.meta_json` keys written: `order_ack_enabled` (bool, missing = false), `order_ack_pay_url` (url or null),
  `concierge_enabled` (bool), `concierge_header` (string or null), `concierge_max` (int, blank = 10), `concierge_reply_on_empty` (bool),
  `concierge_empty_text` (string or null). Other keys already in `meta_json` are kept: `concierge_footer` (read by the concierge, no UI)
  and `order_ack_template_id` (read by the acknowledgement, no UI), `catalog_id` etc.
- **Rules & edge cases:**
  1. Validation: pay url must be a URL, max 500; header max 60; max products integer 1..30; empty text max 1024; booleans nullable.
  2. Because the UI sends a hidden 0 per checkbox, an unticked box stores false (so the acknowledgement default of "on" only applies to
     a workspace that never saved this form).
  3. Blank text values store null; the consumers then fall back to their built-in defaults.
  4. The form is replaced wholesale on each save: values not in the form (footer, template id) survive only because the controller
     merges into the existing array.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** the keys above.
- **Acceptance criteria:**
  - Given a catalog, When the admin enables the concierge with max 50, Then validation fails (max 30).
  - Given a saved row with `order_ack_template_id`, When the form is saved, Then that key is still present afterwards.
  - Given nothing is ticked and fields blank, When saved, Then both booleans are false, text keys null and max products 10.
  - Given no catalog row, When the form is posted, Then the response is 404.
- **Source refs:** app/Http/Controllers/CatalogController.php:1079-1112, resources/views/user/catalog/_setup.blade.php (Automation card).
- **Port notes:** model as a typed settings object in a `jsonb` column on `wa_catalogs.meta_json` (exists); give the unknown keys
  (footer, template id) real fields and UI or document them as API-only. Contracts in `packages/contracts/src/catalog-products/`.

### WD-CAT-007 — Catalog health score and products to fix

- **Status:** partial (the "sync error" signal never fires, see rules)
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-CAT-020
- **Summary:** a 0 to 100 score on the connected Setup view: the share of products that can sell as they are, with counts per problem and
  a list of up to 8 offending products linking to their edit form.
- **Actors & access:** WD-CAT-001 gates. Rendered only when the workspace has at least one product and a catalog is connected.
- **UX & screens:** card with a circular score badge (colour: 90 or more green, 70 to 89 amber, below 70 red), title "Catalog health",
  a sentence ("N product(s) need attention before they can sell" with singular/plural, or "Every product is catalog-ready"), chips for
  "no image", "no price", "sync error" (each only when its count is above zero), a progress bar of the score, and a collapsible "Show
  products to fix" list. Each sample row shows name (or `#id`), the reasons joined with " · ", and a "Fix →" link to the edit form.
- **Endpoints:** computed inside `GET catalog` (WD-CAT-008); no separate route.
- **Data:** reads `wa_products` (live rows of the workspace).
- **Rules & edge cases:**
  1. A product is flagged when image url is null or empty, or price_minor is null or 0, or `meta_sync_status = 'error'`.
  2. Score = round((total - flagged) / total * 100) as an integer; null when there are no products (the card is then hidden).
  3. Per-signal counts are independent (a product can count in both no-image and no-price but is flagged once).
  4. Samples: flagged rows ordered by updated_at desc, limit 8, columns id, name, sku, image_url, price_minor, meta_sync_status.
  5. QUIRK: the sync status vocabulary written by the app is pending, failed, synced; the value `error` is never written, so the "sync
     error" chip and the third flag condition never trigger. Failed rows are not counted as unhealthy. Decide in the port whether
     `failed` should count (the intent clearly was "last sync errored").
  6. Draft, archived and out-of-stock products are counted like active ones.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 10 products of which 2 have no image and 1 has price 0 (different products), When the Setup tab loads, Then the score is 70 and
    the chips read 2 no image and 1 no price.
  - Given 12 flagged products, When the list opens, Then only the 8 most recently updated are shown.
  - Given no products, When the Setup tab loads, Then the health card is absent.
- **Source refs:** app/Http/Controllers/CatalogController.php:121-167, resources/views/user/catalog/_setup.blade.php.
- **Port notes:** one SQL aggregate with FILTER clauses; return `{score,total,noImage,noPrice,errored,flagged,samples[]}` from the setup
  endpoint. Fix the `error` status mismatch consciously and record the decision.

### WD-CAT-008 — Setup tab content and states

- **Status:** partial (the reference page returns HTTP 500, see QUIRK)
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-CAT-001, WD-CAT-007, WD-CAT-009
- **Summary:** the first tab. It shows one of three states: "Connect a device first" (nothing connected), "Ready to send" (a sender
  exists but no Meta catalog), or the full connected screen (sync counters, health, sync controls, commerce and automation forms, products
  table).
- **Actors & access:** WD-CAT-001 gates.
- **UX & screens:** `_setup.blade.php` plus `_connect-form.blade.php`. QUIRK: in the reference, `GET /catalog` throws "Undefined variable
  $engine" because the controller puts an undefined `$engine` into the view data, so the whole Setup tab is a 500 (confirmed in the
  running reference). The intended screen, from the view source, is:
  - Data prepared: the workspace's catalog row, shops (storefronts, newest first), the latest 50 products by updated_at desc, a status
    bucket count over all products (`meta_sync_status` null counted as "unsynced"), the health block (WD-CAT-007), collections, total
    product count, the 5 most recent catalog sends, and a merged list of connected senders: every connected Baileys device (active
    first) plus every connected WABA or Twilio config (newest first) shaped as name (display label or provider upper-case), empty
    country code, phone, status "connected". `hasBaileysDevice` is true when that merged list is non-empty (misleading name). `engine` was
    meant to be the workspace's active send engine (`WorkspaceEngine::for(workspace)`, as `sendPage` computes), used only to word the
    ready card and to decide whether the autodetect card shows (engine `waba`).
  - State NONE (no catalog, no connected sender): a card "Connect a device first" explaining catalog sending needs at least one WhatsApp
    device (an unofficial QR pair or a verified WABA number) and a "Connect a device" button (opens the global connect-device handler).
    NOTE: no connect-catalog form is rendered in this state, so a workspace with no sender cannot link a catalog from the UI.
  - State READY (no catalog but a sender): a dark card "Ready to send" titled "Official WhatsApp catalog mode" (engine waba or twilio) or
    "Unofficial API carousel mode" (otherwise), with a paragraph, an "Open Send tab" button; a card listing connected senders (name or
    `Device #id`, number or "No number", status badge); three stat tiles (Products with "Manage →" to `/store/products`, Shops with
    "Manage →" to `/connect?platform=wa-store`, Recent sends with "View →"); for engine waba the autodetect card (WD-CAT-003); and an
    "Optional · advanced" collapsible containing the compact connect form (WD-CAT-002).
  - State META (catalog row exists): header card (provider, catalog name or "Meta Commerce Catalog", `ID {catalog_id}`, "Send products →",
    Disconnect); four tiles Total, Synced, Pending, Failed (the last three from the bucket counts; "unsynced" count feeds the text "N
    waiting"); the health card; a sync bar with three buttons "Sync to Meta", "Refresh status", "Import from Meta"; a hidden progress
    panel (log lines, newest first, plus a progress bar); the Commerce settings form (WD-CAT-005); the Automation form (WD-CAT-006); and
    the Products table.
  - Products table: columns Product (thumbnail or box icon, name, category), SKU or "—", Price (display string), Availability (effective
    availability, WD-CAT-033), Meta status pill (unsynced grey, pending amber, synced mint, failed coral; the first 60 chars of
    `meta_last_error` under it with the full text as tooltip) and a per-row "Sync" link. Empty: "No products yet. Add one →".
  - Client behaviour: "Sync to Meta" posts `catalog/sync-chunk` in a loop (see WD-CAT-009), updating the Synced/Pending/Failed tiles and the
    progress bar after each chunk, logging "Pushed N · pending P · synced S · failed F" and finishing with "done · N queued"; per-row Sync
    posts `product_ids: [id]` and shows "Queued ✓" or "Failed" for 1.5 s (it shows "Queued ✓" whenever the response is ok, even when
    nothing was pushed); "Refresh status" posts `catalog/poll`, logs "Polled · synced+X · failed+Y" and reloads after 600 ms when any
    status changed; "Import from Meta" posts `catalog/import-from-meta`, logs counts and reloads after 900 ms.
- **Endpoints:**

| METHOD uri  | route name         | Controller@action       | middleware                                                 | request | response                               |
| ----------- | ------------------ | ----------------------- | ---------------------------------------------------------- | ------- | -------------------------------------- |
| GET catalog | user.catalog.index | CatalogController@index | web, auth, workspace.role:admin, plan:access_wa_storefront | none    | Blade page (HTTP 500 in the reference) |

- **Data:** `wa_catalogs`, `wa_storefronts`, `wa_products`, `wa_product_sets`, `inbox_messages` (join conversations), `devices`,
  `wa_provider_configs`.
- **Rules & edge cases:**
  1. No workspace: redirect to `/dashboard`.
  2. The status buckets treat null status as the key "unsynced"; any other string is its own bucket.
  3. The page is the only place that shows Total/Synced/Pending/Failed, and they are not live-refreshed except by the sync loop.
  4. Setup shows at most 50 products; there is no pagination or search.
  5. The device merge ignores soft-disabled configs; only status connected counts.
- **Async & events:** none.
- **External systems:** none on load.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a workspace with no connected sender and no catalog, When the Setup tab loads, Then it shows "Connect a device first" and a
    Connect-a-device button (and the build must not 500).
  - Given a connected Baileys device and no catalog, When it loads, Then the "Ready to send" card shows the device and the advanced
    panel contains the connect form.
  - Given a connected catalog and products with statuses synced 3, pending 2, failed 1, null 4, When it loads, Then the tiles read
    Total 10, Synced 3, Pending 2, Failed 1 and the sync text says 5 waiting.
  - Given a connected WABA number and no catalog, When it loads, Then the "Fetch from my WhatsApp account" card is shown; for a Baileys
    workspace it is not.
- **Source refs:** app/Http/Controllers/CatalogController.php:40-119, resources/views/user/catalog/_setup.blade.php,
  resources/views/user/catalog/_connect-form.blade.php, Documentation/pages/commerce/catalog.html.
- **Port notes:** implement the intended behaviour (compute the engine). One endpoint `GET /catalog/setup` returning
  `{catalog, shops, buckets, health, products(50), senders[], engine}`. Fix the "no sender, no connect form" dead end (the manual form
  should be reachable in every state).

### WD-CAT-009 — Sync products to Meta (chunked push)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-CAT-002, WD-CAT-033, WD-CAT-034
- **Summary:** pushes active products to the connected Meta catalog in batches of up to 1000 per request and moves their status to
  pending (or failed). The browser repeats the call until nothing is left.
- **Actors & access:** WD-CAT-001 gates. Needs a catalog row.
- **UX & screens:** buttons in WD-CAT-008. Progress panel log and bar.
- **Endpoints:**

| METHOD uri              | route name              | Controller@action           | middleware                                                 | request                      | response                                                                                                                                                    |
| ----------------------- | ----------------------- | --------------------------- | ---------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST catalog/sync-chunk | user.catalog.sync-chunk | CatalogController@syncChunk | web, auth, workspace.role:admin, plan:access_wa_storefront | product_ids? (array of ints) | `{ok, pushed, has_more, total_pending, total_synced, total_failed}`; no catalog: 422 `{ok:false,error}`; Meta failure: 502 `{ok:false,error,pushed_failed}` |

- **Data:** reads `wa_products` where workspace, `status = 'active'` and either `id IN product_ids` (explicit mode) or, in default mode,
  `meta_sync_status` is null, `failed` or `pending`; ordered by id ascending, limit 1000. Writes per product: `meta_sync_status`
  pending, `meta_batch_handle` (the handle at the same position in Meta's reply, or null), `meta_retailer_id` (kept if set, else
  sku, else `wsn-{id}`), `meta_last_error` null. On failure all chunk rows get status `failed` and the error text cut to 500 chars.
- **Rules & edge cases:**
  1. Per-click cap CHUNK = 1000 (Meta's items_batch limit).
  2. Retailer-id rule: `meta_retailer_id` if set, else `sku` if non-empty, else `wsn-` + local id. It is the permanent identity on Meta;
     SKU is not unique locally, so two products with one SKU collide on Meta (the second overwrites the first).
  3. The shop url used for each product's `link` is the public url of the workspace's newest storefront (empty string when none);
     products with their own `product_url` use that.
  4. Handles map to products by array index; Meta may return fewer handles than rows sent (rows then get a null handle and can never be
     polled to completion).
  5. Empty chunk: `{ok:true,pushed:0,has_more:false,total_pending:0,total_synced:N}` (note total_pending is returned as 0 here regardless of
     real pending rows) and a log line explaining why.
  6. The status writes happen in one DB transaction; the Meta call is before it.
  7. `has_more` = count of active products with status null or failed (pending is NOT counted).
  8. QUIRK (infinite loop): the default-mode query also selects `pending` rows. With more than 1000 unsynced products, after the first
     chunk those 1000 rows become pending and are re-selected first by `ORDER BY id` on every following call, while `has_more` stays true
     because the remaining null rows exist. The browser loop re-pushes the same 1000 rows forever and never reaches the rest. Fix in the
     port (exclude pending from the default selection or page by a cursor).
  9. Only `active` products are ever pushed; draft and archived are skipped even in explicit mode (an explicit id list with only
     non-active ids pushes nothing and replies ok with pushed 0).
  10. Each trigger is logged (workspace, catalog id, active product count, mode `explicit_ids` or `unsynced+failed`).
- **Async & events:** none in the reference: runs inside the HTTP request and blocks for as long as Meta takes (up to 30 s per attempt, two
  attempts). The client loop is the "queue".
- **External systems:** Meta `POST /{catalog_id}/items_batch` with `item_type = PRODUCT_ITEM` and one `CREATE` request per product
  (create is an upsert keyed on retailer id), `data` built per WD-CAT-033; 30 s timeout, 2 attempts.
- **Settings:** admin graph version.
- **Acceptance criteria:**
  - Given 3 active unsynced products and a connected catalog, When sync-chunk is posted with no body, Then Meta receives 3 CREATE
    requests, the products become `pending` with handles and the reply has `pushed = 3`, `has_more = false`.
  - Given Meta rejects the batch, When posted, Then the reply is HTTP 502 with the error text and all rows are `failed` with the
    truncated message.
  - Given `product_ids = [7]` and product 7 is a draft, When posted, Then `pushed = 0` and nothing is sent to Meta.
  - Given no catalog, When posted, Then 422 with an "No catalog connected" error.
  - Given 1500 never-synced products, When the port runs the loop, Then it terminates after two chunks (the reference does not).
- **Source refs:** app/Http/Controllers/CatalogController.php:886-1000, app/Services/WhatsAppCatalog/AbstractCloudCatalogProvider.php
  (upsertProductsBatch), app/Models/WaProduct.php (toMetaCatalogPayload).
- **Port notes:** move the Meta call to a BullMQ job (`catalog-sync` queue) with the status flip in the worker; the endpoint enqueues and
  returns counts; keep an explicit-ids mode. `meta_sync_status` has no CHECK constraint in the SQL migration; add one for
  null/pending/synced/failed.

### WD-CAT-010 — Poll Meta batch status

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-CAT-009
- **Summary:** "Refresh status" asks Meta for the result of every outstanding batch handle and flips pending products to synced or failed.
- **Actors & access:** WD-CAT-001 gates. Needs a catalog row.
- **UX & screens:** the "Refresh status" button (WD-CAT-008).
- **Endpoints:**

| METHOD uri        | route name        | Controller@action             | middleware                                                 | request | response                                                                                                                              |
| ----------------- | ----------------- | ----------------------------- | ---------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| POST catalog/poll | user.catalog.poll | CatalogController@pollBatches | web, auth, workspace.role:admin, plan:access_wa_storefront | none    | `{ok:true,pending:0}` when nothing pending; `{ok:true,synced,failed,pending}`; 422 no catalog; 502 `{ok:false,error}` on Meta failure |

- **Data:** reads products with a non-null `meta_batch_handle` and status `pending`; groups by distinct handle; for each product finds the
  Meta row with the same handle. Status (lower-cased) in {finished, success, completed} becomes `synced` with `meta_synced_at = now`,
  handle null, error null. Status in {error, failed} becomes `failed` with `meta_last_error` = first error message of that row (cut to 500,
  "unknown" when absent) and the handle KEPT. Anything else (or a handle Meta did not return) stays pending and is counted in `pending`.
- **Rules & edge cases:**
  1. All updates run in one transaction.
  2. A failed product keeps its handle, so later polls ignore it (status is no longer pending).
  3. Pending rows with a null handle (Meta returned fewer handles) are never selected, so they stay pending forever (needs a re-sync).
  4. Meta failure returns 502 and no rows change.
  5. The poll is never run automatically in the reference (no schedule, WD-CAT-013); products sit in `pending` until an admin clicks.
- **Async & events:** none.
- **External systems:** Meta `GET /{catalog_id}/check_batch_request_status` with `handles` = JSON array of handles; logs a status summary.
- **Settings:** graph version.
- **Acceptance criteria:**
  - Given 2 pending products with handles and Meta reporting finished and error respectively, When polled, Then one is synced (handle
    cleared) and one failed with the error text, and the reply is `ok:true, synced:1, failed:1, pending:0`.
  - Given no pending products, When polled, Then the reply is `{ok:true,pending:0}` and Meta is not called.
  - Given Meta reports in-progress, When polled, Then the product stays pending and `pending` counts it.
- **Source refs:** app/Http/Controllers/CatalogController.php:1002-1056, app/Services/WhatsAppCatalog/CatalogSyncService.php (pollWorkspace).
- **Port notes:** share one `pollWorkspace(orgId)` service method between the endpoint and the sweep (WaDesk duplicated the logic in two
  places with identical rules).

### WD-CAT-011 — Import products from Meta

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-CAT-002, WD-CAT-026, WD-CAT-034
- **Summary:** pulls the products of the connected Meta catalog down into `wa_products` (for catalogs built directly in Commerce Manager)
  and marks them synced. Existing rows are updated by retailer id, new rows are created.
- **Actors & access:** WD-CAT-001 gates. Needs a catalog row.
- **UX & screens:** "Import from Meta" button with a tooltip ("Pull products created directly in Meta Commerce Manager into {brand}");
  log line "Imported N · updated N · skipped N of N"; page reload after 900 ms.
- **Endpoints:**

| METHOD uri                    | route name                    | Controller@action                | middleware                                                 | request | response                                                                                        |
| ----------------------------- | ----------------------------- | -------------------------------- | ---------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------- |
| POST catalog/import-from-meta | user.catalog.import-from-meta | CatalogController@importFromMeta | web, auth, workspace.role:admin, plan:access_wa_storefront | none    | `{ok:true,imported,updated,skipped,total}`; 422 `{ok:false,error}` (no catalog or Meta failure) |

- **Data:** upsert into `wa_products` by (workspace, `meta_retailer_id`). Attributes set on every row: name, description (null if absent),
  image_url (null if blank), product_url (Meta `url`), currency_code, availability (lower-cased Meta string or null), `in_stock` = the
  availability text does not contain "out", `status = active`, `meta_retailer_id`, `meta_sync_status = synced`, `meta_synced_at = now`,
  `meta_last_error = null`, and `price_minor` when the price parsed. New rows also get user_id = the importing user, `sku` = retailer id,
  `price_minor = 0` when the price was unparseable, slug auto-generated from the name (WD-CAT-020). Existing rows keep their currency when
  Meta sends none, keep their price when unparseable.
- **Rules & edge cases:**
  1. Fetch: up to 2000 products, 200 per page following the cursor, at most 50 pages (fields id, retailer_id, name, description, price,
     currency, availability, image_url, url).
  2. A row with empty retailer id or empty name is skipped (counted in `skipped`).
  3. Price parsing (`price_minor` is always major x 100):
     - null or empty raw value: no price.
     - Currency decimals: zero-decimal list (BIF, CLP, DJF, GNF, IDR, ISK, JPY, KMF, KRW, MGA, PYG, RWF, UGX, VND, VUV, XAF, XOF, XPF, HUF,
       TWD) = 0; three-decimal list (BHD, IQD, JOD, KWD, LYD, OMR, TND) = 3; everything else 2.
     - A bare integer from Meta (already in the currency's own minor unit): zero-decimal gives value x 100; three-decimal gives integer
       division by 10; two-decimal is used as is.
     - A formatted string: keep only digits, dots and commas; empty result means no price. If both "." and "," appear, the rightmost one is
       the decimal separator (so "1,234.56" and "1.234,56" both work). If only one separator kind appears, it is a decimal separator only
       when the currency has decimals, the separator occurs exactly once and exactly `decimals` digits follow it; otherwise every
       separator is a thousands grouper ("Rp33.900.000" is 33,900,000). The major amount is then multiplied by 100 and rounded.
  4. `in_stock` is derived by substring: any availability containing "out" (e.g. "out of stock") is false.
  5. Imported rows are never pushed back deliberately, BUT the product observer is not suppressed here, so every created product fires an
     immediate push to Meta that flips it back to `pending` (QUIRK, see WD-CAT-012) and a changed field on an updated row does the same.
  6. A Meta availability value outside the local enum (in stock, out of stock, available for order, discontinued) or a null availability
     may violate the column rules in the database; behaviour is untested (Open questions).
  7. Meta failure at fetch time returns 422 with the Meta message (not 502).
  8. Not transactional: a mid-loop failure leaves partial imports.
- **Async & events:** synchronous request; logs a summary line.
- **External systems:** Meta `GET /{catalog_id}/products` (30 s timeout, retry 2).
- **Settings:** graph version.
- **Acceptance criteria:**
  - Given Meta lists a product "Rp33.900.000" in IDR retailer R1, When imported, Then a new product with `price_minor = 3390000000`,
    currency IDR, `meta_sync_status = synced` exists.
  - Given Meta lists "1,234.56" USD, When imported, Then `price_minor = 123456`.
  - Given a row without a name, When imported, Then it is skipped and counted.
  - Given an existing product with retailer id R1 and Meta sending no currency, When imported, Then its currency is unchanged.
  - Given no catalog, When posted, Then 422 `No catalog connected.`
- **Source refs:** app/Http/Controllers/CatalogController.php:738-884, app/Services/WhatsAppCatalog/AbstractCloudCatalogProvider.php
  (listProducts), app/Models/WaProduct.php (metaCatalogPrice inverse).
- **Port notes:** run in a worker job with progress; wrap with the suppress-auto-sync switch the importers use (do NOT replicate the
  re-push quirk); parse prices with a decimal library, not floats; unit-test the table of formats above.

### WD-CAT-012 — Auto-sync on product create and update

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-CAT-009, WD-CAT-033
- **Summary:** whenever a product is created, or one of the catalog-relevant fields changes, the product is pushed to the connected Meta
  catalog immediately, so the WhatsApp catalog never drifts from the store.
- **Actors & access:** system behaviour triggered by any writer of `wa_products` (product form, Shopify and WooCommerce imports, stock
  webhooks, Google Sheets add-on, Meta import, storefront checkout stock decrement).
- **UX & screens:** none; the effect is a `pending` status on the product row.
- **Endpoints:** none.
- **Data:** writes `meta_sync_status = pending`, `meta_batch_handle`, `meta_retailer_id`, `meta_last_error = null` on success; on failure
  `meta_sync_status = failed` and the error text (500 chars). Never throws.
- **Rules & edge cases:**
  1. Triggers: model `created`, and model `updated` only when at least one of the SYNC_FIELDS changed: name, description, price_minor,
     compare_price_minor, currency_code, image_url, availability, in_stock, stock_qty, brand, category, status. (Changes to slug, sku,
     tags, gallery, sort_order, weight, body_html, product_url, aliases or `meta_*` columns do not trigger.)
  2. No-ops when: suppressed, the workspace has no catalog row or an empty catalog id, or the product's status is not active (drafts and
     archived products are never pushed, and a product moved to draft is NOT removed from Meta).
  3. Suppression: a static flag set by `withoutAutoSync(fn)` (restored afterwards). Used by the Shopify and WooCommerce importers (one
     batched sync later), by the storefront checkout stock decrement, and by the service's own status writes (which is what prevents
     loops).
  4. Any exception (network, Meta, DB) is caught: the row is marked failed with the message and a warning is logged; the originating save
     is never broken.
  5. The push is synchronous (blocks the request up to Meta's timeout) and sends the in-memory model. For a freshly created row the
     `availability` attribute is not yet loaded so the derived availability is used; later pushes use the stored column (WD-CAT-033).
  6. When an image is uploaded in the product form the row is created first (push without image), then updated with the image (push
     again): two pushes per create-with-upload.
  7. Stock changes made by the ordering ledger (`saveQuietly`) and by the commit step never trigger a push; the storefront checkout
     decrement is suppressed. Stock drift to Meta is only fixed by the next sync or sweep.
  8. Meta's CREATE is an upsert on retailer id, so first push and later pushes are the same call with one item.
  9. Soft-delete does not fire the update hook, so deleted products stay on Meta (no delete request exists anywhere).
- **Async & events:** none (inline). Status reconciles via WD-CAT-010 or WD-CAT-013.
- **External systems:** same Meta call as WD-CAT-009 with a single item.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a connected catalog, When an active product is created, Then a Meta batch with one item is sent and the product is `pending`.
  - Given a product, When only its sort order changes, Then no Meta call is made.
  - Given a product, When its price changes, Then a push happens and the status becomes pending with a handle.
  - Given Meta is unreachable, When a product is saved, Then the save succeeds and the product shows `failed` with the error.
  - Given a bulk importer runs inside the suppress switch, When 500 products are created, Then no per-product Meta call is made.
- **Source refs:** app/Services/WhatsAppCatalog/CatalogSyncService.php, app/Models/WaProduct.php (booted), app/Services/Shopify/ShopifyImporter.php,
  app/Services/Woocommerce/WoocommerceImporter.php, app/Services/Storefront/StorefrontCheckoutService.php.
- **Port notes:** implement as an outbox event on product change consumed by a worker (the repo's outbox skill) with the same SYNC_FIELDS
  filter and a suppress context carried on the command; never call Meta in the request.

### WD-CAT-013 — Scheduled catalog:resync sweep

- **Status:** partial (command exists, nothing schedules it)
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-CAT-009, WD-CAT-010
- **Summary:** the artisan command `catalog:resync` walks every connected catalog, pushes that workspace's dirty products in one batch of up
  to 1000, then polls to settle pending rows. It is the backstop for missed auto-syncs and bulk imports.
- **Actors & access:** operator or scheduler (CLI).
- **UX & screens:** none; prints "Catalogs: N · pushed N · settled synced N / failed N." or "No connected catalogs to sync."
- **Endpoints:** none. Command: `catalog:resync {--workspace=ID} {--poll-only}`.
- **Data:** workspaces from `wa_catalogs` rows with a non-null catalog id (distinct), optionally one workspace. `flushWorkspace`: active
  products whose status is null or failed (NOT pending), ordered by id, limit 1000: same writes as WD-CAT-009; a catalog-level failure marks
  the chunk failed and returns the error (the command prints "Workspace N: push error - ..."). `pollWorkspace`: same rules as WD-CAT-010
  without the HTTP envelope; on a Meta failure logs and returns zeros.
- **Rules & edge cases:**
  1. `--poll-only` skips the push.
  2. Skips workspaces with no catalog id.
  3. QUIRK: the class comment and the checkout comment ("the nightly resync settles Meta stock") assume a schedule, but `catalog:resync`
     is not registered in any scheduler in the reference, so in a stock install nothing runs it; only the optional example
     `Schedule::command('catalog:resync')->hourly()` is documented in a comment. The product documentation also calls the sweep "optional".
  4. Only 1000 rows per workspace per run; large backlogs need repeated runs.
  5. Per-workspace Meta errors do not stop the loop.
- **Async & events:** a scheduled worker job in the port (recommend every hour, configurable).
- **External systems:** Meta (WD-CAT-009 and WD-CAT-010 calls).
- **Settings:** none.
- **Acceptance criteria:**
  - Given two workspaces with catalogs and 5 unsynced products in one, When the sweep runs, Then that workspace's 5 products become pending
    and the summary says pushed 5.
  - Given `--workspace=12`, When it runs, Then only workspace 12 is processed.
  - Given a workspace whose Meta call fails, When it runs, Then that workspace's rows are failed and the other workspaces still run.
  - Given `--poll-only`, When it runs, Then no items_batch call is made.
- **Source refs:** app/Console/Commands/CatalogResyncCommand.php, app/Services/WhatsAppCatalog/CatalogSyncService.php.
- **Port notes:** build as a worker `@Interval`/BullMQ repeatable job with the cross-tenant privileged DB role; actually schedule it
  (decision), and add the pending-with-null-handle repair (re-queue) that WaDesk lacks.

### WD-CAT-014 — Send tab: recipients, sender, shop, format, products, message

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-CAT-001, WD-CAT-024
- **Summary:** the four-step form that cold-sends a catalog message to many numbers without an existing conversation: recipients, format
  and sender, products, message text.
- **Actors & access:** WD-CAT-001 gates. When the workspace has no connected sender the whole tab is replaced by a "Connect a device
  first" card with a Connect-a-device button.
- **UX & screens:** `_send.blade.php`, `_product-grid.blade.php`. Two columns (form, side rail).
  Step 01 Recipients with a live "N recipients" counter and three tiles: Contact groups (default; checkbox cards showing the group name and
  its member count, or "No contact groups yet" with a link to Contacts), Individual contacts (search box plus a scrolling checkbox grid of
  all workspace contacts showing name or masked number; empty state links to Contacts), Manual numbers (a textarea, "one number per
  line", also comma or semicolon, country code required with or without a plus).
  Step 02 Format and sender: three radio tiles Single product (one card), Product list or carousel (up to 30), Catalog link (plain text,
  works anytime); "Send from" is the unified sender picker (composite keys `engine:id`); "From shop" select appears only when the
  workspace has storefronts (label "branding context").
  Step 03 Products: a search box (client-side filter on name and sku), a note "Showing products from {shop}", and the products grouped by
  category in collapsible groups (category or "Other"), each a compact card (image or a box glyph, name, price display) with a
  checkbox. Hidden in link mode. Changing the shop repaints from a prebuilt JS map without a request.
  Step 04 Message and send: optional textarea (max 1024), feedback line, "View recent sends →", the Send button whose label follows the
  mode ("Send product →", "Send carousel →", "Send catalog link →").
  Side rail: Summary (recipients, products, format), Catalog card (name and provider and product count, or "Unofficial API
  (carousel)" with a "Link Meta →" link), up to 5 recent sends (masked number, time ago), and a note about the 24-hour window.
- **Endpoints:**

| METHOD uri       | route name        | Controller@action          | middleware                                                 | request | response   |
| ---------------- | ----------------- | -------------------------- | ---------------------------------------------------------- | ------- | ---------- |
| GET catalog/send | user.catalog.send | CatalogController@sendPage | web, auth, workspace.role:admin, plan:access_wa_storefront | none    | Blade page |

The submit target is `POST catalog/send-to-number` (WD-CAT-015).

- **Data:** reads contacts (all of the workspace, newest first), contact groups, per-group counts (computed in PHP from each contact's
  group list), storefronts (newest first), active in-stock products (ordered by sort_order then id desc) with columns id, storefront_id,
  name, sku, image_url, price_minor, currency_code, category, meta_retailer_id, meta_sync_status; the engine-aware device list and the
  unified senders; the 10 most recent catalog sends.
- **Rules & edge cases:**
  1. Product picker is filtered to the FIRST (newest) shop: `storefront_id = that shop`; with no shops it shows products whose
     `storefront_id` is null.
  2. QUIRK (product visibility): no code path that creates a product from the Products form, the Google-Sheets add-on, the Meta import or
     the Shopify/Woo importers sets `storefront_id`; only an old migration back-filled it once. So in a workspace that has a storefront,
     products created later have a null storefront id and do NOT appear in the Send-tab picker at all (they do appear in the inbox
     picker, WD-CAT-024, which ignores shops). Decide the port behaviour (recommend: ignore the shop for filtering, or default new
     products to the workspace's primary shop).
  3. The "From shop" value is sent as `shop_id` but the server only validates it (integer) and never uses it ("branding context").
  4. Client rules: in Single mode only one product can be checked (checking another unchecks the first, switching to Single keeps only
     the first); in List mode a 31st check is refused with "Maximum 30 products per carousel."; link mode hides the product step.
  5. Client recipient counting: manual = tokens with at least 8 digits; contacts = ticked; groups = sum of the group member counts (not
     de-duplicated), so the live counter can exceed the server's de-duplicated total.
  6. Feedback line: success "Sent to N recipient(s)" plus " · N failed" when any; failure shows the server message or the joined error
     list.
  7. The header field exists in the API but not in this form (only the Collections send panel offers a header).
  8. The product grid is rendered for the first shop on the server and repainted client-side with product maps for all shops
     (retailer id = meta_retailer_id, else sku, else `wsn-{id}`).
- **Async & events:** none (the send is one blocking request per click, WD-CAT-015).
- **External systems:** none on load.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a workspace with no connected sender, When the Send tab loads, Then it shows "Connect a device first" instead of the form.
  - Given Single mode with one product checked, When the admin checks a second product, Then the first is unchecked.
  - Given List mode with 30 checked, When the admin checks a 31st, Then it is refused with the 30-product message.
  - Given two shops, When the admin changes "From shop", Then the picker shows that shop's active in-stock products grouped by category
    without a page reload.
  - Given Link mode, When selected, Then the products section is hidden and the Send button reads "Send catalog link →".
- **Source refs:** app/Http/Controllers/CatalogController.php:169-271, resources/views/user/catalog/_send.blade.php,
  resources/views/user/catalog/_product-grid.blade.php, Documentation/pages/commerce/catalog.html.
- **Port notes:** one query for products with optional `shopId`; return senders from the senders registry (composite key). Contacts list
  of thousands must be paginated or searched server-side in the port (WaDesk ships every contact to the browser).

### WD-CAT-015 — Catalog message sending engines and inbox mirroring

- **Status:** implemented
- **Priority:** P0
- **Effort:** XL
- **Depends on:** WD-CAT-014, WD-CAT-031, WD-CAT-034
- **Summary:** the server side of the Send tab. It resolves recipients, picks the sender, finds or creates one conversation per number,
  then sends a single-product, product-list or catalog-link message and records each send in the inbox. The actual per-conversation send
  is the team-inbox `catalogContent` action (WD-CAT-031), reused through an internal fake request.
- **Actors & access:** WD-CAT-001 gates; `catalogContent` additionally requires the conversation `reply` ability for the acting user.
- **UX & screens:** driven by WD-CAT-014 and WD-CAT-018.
- **Endpoints:**

| METHOD uri                  | route name                  | Controller@action              | middleware                                                 | request                                                                                                                                    | response                                                                                                        |
| --------------------------- | --------------------------- | ------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| POST catalog/send-to-number | user.catalog.send-to-number | CatalogController@sendToNumber | web, auth, workspace.role:admin, plan:access_wa_storefront | manual_numbers?, group_ids[]?, contact_ids[]?, device_id?, sender?, shop_id?, mode (spm/mpm/link), body?, header?, footer?, product_ids[]? | `{ok: sent>0, sent, failed, total, errors (first 10 strings "digits: reason")}`; 422 `{ok:false,error,message}` |

- **Data:** reads contacts and contact groups (workspace scoped), products, devices; writes conversations (find-or-create) and one outbound
  `inbox_messages` row per successful send (meta: kind `catalog`, mode, provider, wa_message_id, response/payload, products summary).
- **Rules & edge cases:**
  1. Validation: manual_numbers nullable string max 65535; group_ids and contact_ids arrays of ints; device_id nullable int; sender nullable
     string max 64; shop_id nullable int; mode required in {spm, mpm, link}; body nullable max 1024; header nullable max 60; footer nullable
     max 60; product_ids nullable array max 30 of ints.
  2. Recipient resolution merges three sources into a de-duplicated digits-only list: manual (split on whitespace, comma, semicolon;
     strip non-digits; keep when 8 or more digits), explicit contacts and group members (both workspace scoped; group membership read from
     each contact's group list in PHP because it is stored encrypted; mobile stripped to digits, 8 or more). Zero recipients: 422
     `no_recipients` ("pick at least one contact, group or paste a number"); more than 500: 422 `too_many` ("maximum 500 per send, split into
     smaller batches").
  3. Products: workspace-scoped, `status = active` (a stale or foreign id is silently dropped); modes spm and mpm with none left: 422
     `no_products` ("pick at least one product first"); link mode needs none.
  4. Sender: the composite `sender` key resolves the engine (stamps the conversation provider) and, for a Baileys device, narrows the
     device lookup. Then the device is found: the requested `device_id` if connected, else the workspace's first connected device ordered
     by `active` desc; none: 422 `no_device` ("No connected device. Pair one at /devices first."). QUIRK: this requires a Baileys-style
     `devices` row even when the picked sender is a WABA number, so a WABA-only workspace (no devices row) cannot use the Send tab at
     all although its sender picker lists the WABA number.
  5. Payload per recipient: mode, body, header, footer, product_ids, `product_retailer_ids` (meta_retailer_id, else sku, else `wsn-{id}`)
     and, for spm, `product_id` = the first product (extra products are ignored for SPM).
  6. Conversation: `ConversationResolver::findOrCreate(workspace, number, defaults)`: matches on the number's digits ignoring device and
     JID suffix (one thread per number), otherwise creates it with status open, inbox status open, priority normal, origin inbox, provider =
     picked engine or the workspace engine, last message now. Invalid number: counted failed with "invalid recipient".
  7. Each recipient is sent sequentially by calling the team-inbox `catalogContent` action with the logged-in user (WD-CAT-031 rules: engine
     precedence, plan-first billing, summaries, inbox row). A recipient counts as sent when that call returns `ok: true`; otherwise failed
     with "digits: message".
  8. The HTTP status is 200 even when every recipient failed (`ok:false`, no `message` key, just `errors`); the Send tab then shows the
     joined errors, while the Collections panel shows "HTTP 200" (QUIRK, see WD-CAT-018).
  9. No throttling or queue: up to 500 sequential Meta/Node calls inside one request. Outside Meta's 24-hour customer-service window
     product messages are rejected by Meta (error 131047, forwarded to the operator); link mode is plain text and works anytime.
  10. Message formats and caps: single product (interactive product card; optional body max 1024, footer max 60), product list (interactive
      product_list: header text max 60, body max 1024, footer max 60; sections built per product category with the title = category or
      "Featured", title max 24; at most 10 sections and 30 items, extra silently dropped), catalog link (plain text with link preview; body
      default "Check out our catalog: https://wa.me/c/{digits}" where digits are the catalog row's `phone_number_id` or, when absent, the
      RECIPIENT's number: QUIRK, neither is the business phone number a real catalog link needs). A `catalog_message` call-to-action sender
      exists in the provider but no controller uses it (dead code).
  11. Baileys path (only when the workspace has NO `wa_catalogs` row): one carousel via the Node bridge (WD-CAT-034 describes the cards);
      link mode there sends a text "Browse our shop:" (or the body) plus the newest storefront's public url, and fails with `no_shop` when
      no storefront exists. A workspace WITH a catalog row always goes through Meta, even if the operator picked a Baileys device.
  12. Billing: each send consumes one message from the plan-first allowance (calendar-month outbound count across inbox messages and
      messages) and a wallet credit only on overflow; when the plan limit refuses, that recipient fails with HTTP 402 `plan_limit` message.
  13. Inbox mirror row: direction out, user, body (or empty), from number (device number), to number, status sent, sent_at now, meta as
      above; link/spm/mpm summaries are denormalised (id, name, image, price minor, currency, price display, retailer id) so the inbox can
      draw a tile without a join. The row is created only after the provider accepted the message (a crash between send and insert loses
      the mirror).
  14. Performance: group expansion loads every contact of the workspace into memory.
- **Async & events:** none (inline, sequential). In the port, queue per-recipient sends (BullMQ) and return a job id with progress; keep
  the same result shape for the synchronous small case.
- **External systems:** Meta Cloud or 360dialog messages endpoint (WD-CAT-034), Node bridge `POST /api/send-product-catalog/{senderPhone}`
  and `POST /api/send-message/{senderPhone}` (admin setting `baileys_server_url`, else env `SERVER_URL`, default `http://localhost:8888`;
  60 s and 30 s timeouts).
- **Settings:** `baileys_server_url`, env `SERVER_URL`, plan monthly message limit, admin graph version.
- **Acceptance criteria:**
  - Given 3 pasted numbers where two are the same digits and one has only 6 digits, When mode link is sent, Then `total = 1` (the
    duplicate is merged and the short number is dropped).
  - Given 501 valid recipients, When sent, Then 422 `too_many` and nothing is sent.
  - Given mode mpm and no active product ids, When sent, Then 422 `no_products`.
  - Given a workspace with no connected device row, When sent, Then 422 `no_device` (even if a WABA number is connected, reference
    behaviour; the port decides whether to keep this).
  - Given a linked Meta catalog and 2 recipients where Meta rejects one, When sent, Then `sent = 1`, `failed = 1`, `ok = true` and
    `errors` has one entry with the number.
  - Given a number that already has a thread under another device, When sent, Then the existing conversation is reused (no duplicate).
  - Given no `wa_catalogs` row and a Baileys device, When mpm is sent, Then the Node bridge receives a multi carousel payload.
- **Source refs:** app/Http/Controllers/CatalogController.php:303-524, app/Http/Controllers/TeamInboxController.php:3380-3790,
  app/Services/WhatsAppCatalog/BaileysCatalogService.php, node/controllers/messageController.js (sendProductCatalog),
  app/Services/Inbox/ConversationResolver.php, app/Services/WorkspaceEngine.php (senders, senderForKey).
- **Port notes:** the port needs a "catalog sender" port with two adapters (Meta/360dialog; Baileys via the bridge) chosen by the
  conversation's channel, not by "does a wa_catalogs row exist" (decision to record; the reference precedence is a bug-like behaviour).
  Build the result as a job with per-recipient rows; reuse the inbox send pipeline for mirroring (`apps/api/src/modules/inbox`).

### WD-CAT-016 — Activity tab

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-CAT-015
- **Summary:** a table of the 50 most recent catalog messages sent by the workspace, with a link to each thread.
- **Actors & access:** WD-CAT-001 gates.
- **UX & screens:** `_activity.blade.php`. Title "Catalog send activity", subtitle "Every catalog message your workspace has sent (SPM · MPM ·
  link)", a "Send another →" button. Columns When ("M d, H:i"), To (masked phone), Mode (a pill SPM mint, MPM amber, other grey; value
  "UNKNOWN" if the mode is missing), Body (truncated), and "View thread →" linking to `/team-inbox?conversation={id}`. Empty: "No sends yet.
  Send your first catalog from the Send tab." (confirmed in the running reference).
- **Endpoints:**

| METHOD uri           | route name            | Controller@action              | middleware                                                 | request | response   |
| -------------------- | --------------------- | ------------------------------ | ---------------------------------------------------------- | ------- | ---------- |
| GET catalog/activity | user.catalog.activity | CatalogController@activityPage | web, auth, workspace.role:admin, plan:access_wa_storefront | none    | Blade page |

- **Data:** `inbox_messages` joined to `conversations` (the table has no workspace column) filtered on the conversation's workspace and
  the message `meta.kind = 'catalog'`, ordered by message id desc, limit 50 (Send tab side rail 5 of 10, Setup 5).
- **Rules & edge cases:**
  1. Only rows written by `catalogContent` carry `meta.kind = catalog`; the single-product share (WD-CAT-023) uses `meta.source =
product_share` and never appears here, and campaign or flow catalog sends do not either.
  2. The log has no status column (rows are only created after a successful provider call), so failed sends never appear.
  3. The number is masked by the app's `mask_phone` helper.
  4. No pagination or filters.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 60 catalog messages, When the tab opens, Then 50 rows show newest first.
  - Given no catalog sends, When the tab opens, Then the "No sends yet" empty state shows.
  - Given a catalog message of mode mpm, When listed, Then the Mode pill reads MPM and "View thread" opens that conversation.
  - Given another workspace's catalog message, When listed, Then it never appears (tenant filter).
- **Source refs:** app/Http/Controllers/CatalogController.php:273-301, resources/views/user/catalog/_activity.blade.php.
- **Port notes:** query messages by `kind = catalog` from the inbox message store with a cursor; the `meta` JSON key must be part of
  the inbox contract (WD-CAT-031).

### WD-CAT-017 — Collections (product sets): create, update, delete

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-CAT-001
- **Summary:** a collection is a named, ordered group of up to 30 products saved once and re-sent as a list message (and intended for
  broadcasts and flows). The backend validates, filters the product ids to the workspace and keeps the submitted order.
- **Actors & access:** WD-CAT-001 gates.
- **UX & screens:** see WD-CAT-018.
- **Endpoints:**

| METHOD uri               | route name                | Controller@action           | middleware                                                 | request                                       | response                                                         |
| ------------------------ | ------------------------- | --------------------------- | ---------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------- |
| POST catalog/sets        | user.catalog.sets.store   | CatalogController@storeSet  | web, auth, workspace.role:admin, plan:access_wa_storefront | name, description?, product_ids[], is_active? | back with status "Collection created."                           |
| PUT catalog/sets/{id}    | user.catalog.sets.update  | CatalogController@updateSet | same                                                       | same fields                                   | back with status "Collection updated." (404 if not in workspace) |
| DELETE catalog/sets/{id} | user.catalog.sets.destroy | CatalogController@deleteSet | same                                                       | none                                          | back with status "Collection deleted." (silent if missing)       |

- **Data:** `wa_product_sets`: workspace, user (creator), name, slug, description, `product_ids` (JSON array of local product ids, order
  preserved), `is_active` (default true), `meta_set_id` (reserved, never written). Unique (workspace, slug).
- **Rules & edge cases:**
  1. Validation: name required string max 120; description nullable max 500; product_ids required array, min 1, max 30, each integer;
     is_active nullable boolean.
  2. Ownership filter: ids are intersected with the workspace's own products, keeping the submitted order; all foreign or stale ids are
     dropped. If nothing remains, 422 (message "none of the selected products belong to this workspace"). Note a draft or deleted
     product of the workspace passes this filter if it exists (soft-deleted ones do not).
  3. Slug: from the name via the app's slug helper, fallback `set`; made unique per workspace by appending `-2`, `-3`, ... On update the
     slug is regenerated only when the name actually changed (comparing with the stored name), excluding the row itself.
  4. `is_active` has no control in the UI: create always stores true, and update resets it to true (a saved false can only come from an
     API caller and is reset by the next edit). It is not read by any consumer in the reference.
  5. Resolution at use time (`products()`): keeps ids that still exist in the workspace with status active, in stored order, capped at 30;
     `retailerIds()` maps them to retailer ids. `product_count` counts the stored ids, including stale ones.
  6. Delete is a hard delete; products are not affected. Delete of a missing id is a no-op success.
  7. No audit rows, no events.
- **Async & events:** none.
- **External systems:** none (`meta_set_id` is reserved for a future Meta product-set sync).
- **Settings:** none.
- **Acceptance criteria:**
  - Given 3 owned product ids [9,4,7], When a collection "Summer Sale" is created, Then it stores [9,4,7] in that order with slug `summer-sale`.
  - Given a second collection also named "Summer Sale", When created, Then its slug is `summer-sale-2`.
  - Given product ids of which only one belongs to the workspace, When saved, Then only that id is stored.
  - Given only foreign ids, When saved, Then the response is 422.
  - Given 31 ids, When saved, Then validation fails (max 30).
  - Given a collection renamed, When updated, Then the slug is regenerated; given only the description changes, Then the slug is kept.
- **Source refs:** app/Http/Controllers/CatalogController.php:1114-1189, app/Models/WaProductSet.php.
- **Port notes:** table `wa_product_sets` exists (unique `(org_id, slug)`, `product_ids jsonb`). Consider a join table or validate
  members on read; keep ordered array semantics; honour `is_active` consistently or drop it.

### WD-CAT-018 — Collections tab UI and send-a-collection action

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-CAT-017, WD-CAT-015
- **Summary:** the Collections tab lists the saved collections, lets the admin create or edit one with a searchable product picker, and
  sends a collection as a product-list message to a typed number from the card.
- **Actors & access:** WD-CAT-001 gates.
- **UX & screens:** `_collections.blade.php`, `_product-picker.blade.php`. Intro card ("Save a group of products once, then send it as a
  Multi-Product Message in one click"). Collapsible "New collection": Name (required, max 120, placeholder "e.g. Summer Sale"), Description
  (optional, max 500), a product picker, "Create collection". Picker: a "Filter products…" search (client filter on name and sku), a
  counter "n/30", up to 300 active products (alphabetical by name) as checkbox cards (image or glyph, 2-line name, price display); the 31st
  tick is silently undone; empty: "No active products yet. Add one →". Each collection card: up to 4 overlapping thumbnails, name,
  "{count} product(s)" (or "empty") plus a 60-char description, and buttons Send, Edit, Delete (confirm "Delete this collection? Products
  are not affected."). Send panel (toggle): Recipient number (single number, country code), Header (optional, max 60, placeholder "Check
  these out"), "Send from" sender picker with an "Auto (active)" placeholder, status line and a "Send as MPM" button; when the collection
  has no live (active, existing) products the panel says it has none to send. Edit panel: the same fields prefilled plus the picker with
  the stored selection and "Save changes". Empty list: "No collections yet. Create your first one above."
- **Endpoints:**

| METHOD uri              | route name               | Controller@action                 | middleware                                                 | request | response   |
| ----------------------- | ------------------------ | --------------------------------- | ---------------------------------------------------------- | ------- | ---------- |
| GET catalog/collections | user.catalog.collections | CatalogController@collectionsPage | web, auth, workspace.role:admin, plan:access_wa_storefront | none    | Blade page |

CRUD routes are listed in WD-CAT-017; the send action posts to `POST catalog/send-to-number` (WD-CAT-015).

- **Data:** collections newest first (id desc); picker products: status active, ordered by name, limit 300 (id, name, sku, image_url,
  price_minor, currency_code); connected Baileys devices and the unified senders; total product count.
- **Rules & edge cases:**
  1. The send panel posts `manual_numbers = the typed number`, `mode = mpm`, the collection's currently live product ids (resolved at page
     render, active only), optional `header` and `sender`. So it reuses all WD-CAT-015 rules (500 cap irrelevant, `no_device`, billing,
     etc.). The body text cannot be set here.
  2. QUIRK in the client: the success test is "HTTP ok and `ok` is not false"; the endpoint returns HTTP 200 with `ok:false` and an `errors`
     list when the send failed, no `message` key. A successful send also has no `message`, so the status shows "Sent." for success and
     "HTTP 200" for a failed send (the actual reason is hidden).
  3. Collections with more than 300 active products in the workspace cannot pick products beyond the first 300 alphabetically (cap noted in
     the controller comment; the Send tab's picker is the escape hatch).
  4. The picker cap of 30 is enforced client-side and server-side (validation max 30).
  5. Sends from a collection keep the stored order; stale members are skipped at render time.
- **Async & events:** none.
- **External systems:** via WD-CAT-015.
- **Settings:** none.
- **Acceptance criteria:**
  - Given no collections, When the tab opens, Then the "No collections yet" empty state shows and the New collection panel exists
    (confirmed in the running reference).
  - Given a collection of 3 active products and a connected sender, When "Send as MPM" is clicked with a valid number, Then
    `send-to-number` receives mode mpm with those 3 ids and the status reads "Sent.".
  - Given an empty recipient number, When Send is clicked, Then "Enter a recipient number first." shows and no request is made.
  - Given a collection whose products are all archived, When its Send panel opens, Then it says there are no live products to send.
- **Source refs:** app/Http/Controllers/CatalogController.php:1191-1214, resources/views/user/catalog/_collections.blade.php,
  resources/views/user/catalog/_product-picker.blade.php.
- **Port notes:** return the send result as problem+json on total failure so the UI can show the real reason; allow a body text field;
  server-side product search instead of a 300 cap.

### WD-CAT-019 — Products list

- **Status:** implemented (the reference page 500s for a workspace with no storefront, see rules)
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-CAT-026
- **Summary:** the Store's product table: search by name or SKU, 25 per page, with Share, Edit and Delete per row.
- **Actors & access:** workspace role admin or above; no plan gate (despite the docs); platform admins bypass. Agents and viewers are
  redirected to `/team-inbox`.
- **UX & screens:** `user/store/products/index.blade.php` inside the Store layout (left store sidebar `user/store/_sidebar.blade.php`, owned by
  the storefront domain). Header "Store / Products", title "Catalog", button "Add product". A status flash. A search form (GET `q`)
  "Search by name or SKU..." as its own small form. Table columns Image (48 px thumbnail or a placeholder glyph), Name (plus a 80-char
  description preview), SKU or "—", Price (display string), Stock (a green "In stock" pill or a grey "Out" pill driven by `in_stock`, not
  by quantity), Actions (Share, Edit, Delete with a "Delete this product?" confirm). Empty: "No products yet. Click "Add product" to create
  your first one." Pagination links (25 per page, query string kept). The Share modal is WD-CAT-022.
- **Endpoints:**

| METHOD uri         | route name                | Controller@action         | middleware                      | request   | response   |
| ------------------ | ------------------------- | ------------------------- | ------------------------------- | --------- | ---------- |
| GET store/products | user.store.products.index | WaProductController@index | web, auth, workspace.role:admin | q?, page? | Blade page |

- **Data:** `wa_products` (soft-delete aware), ordered by `sort_order` asc then id desc, 25 per page.
- **Rules & edge cases:**
  1. QUIRK (cross-tenant leak): when `q` is non-empty the controller adds `name LIKE %q% OR sku LIKE %q%` WITHOUT grouping it against the
     workspace condition, so the SQL is `workspace = X AND name LIKE ... OR sku LIKE ...`; rows of any workspace whose SKU matches are
     returned (the soft-delete scope is also applied outside the OR). A name match stays inside the workspace, a SKU match does not. The
     port must group the search and scope by org (RLS makes this safe by construction).
  2. QUIRK (500): every Store page includes the store sidebar which dereferences the workspace's storefront row; when no storefront exists
     the page throws "attempt to read property shop_name on null" (confirmed in the running reference for `/store/products` and
     `/store/reviews`). The product form pages share the same sidebar. Reaching them requires completing the storefront wizard first; the
     port should not couple the list to a storefront.
  3. The `forWorkspace` scope is a no-op when the workspace id is null, which would list every tenant's products for a user without a
     current workspace (guarded in practice by the role middleware).
  4. The Stock column ignores `stock_qty` and `reserved_qty`.
  5. Search is a plain substring match, case-insensitive per database collation; the wildcard characters `%` and `_` in `q` are not
     escaped.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 30 products, When the list opens, Then 25 are shown and a second page exists, ordered by sort order then newest first.
  - Given `q=tee`, When the list opens, Then only the workspace's products whose name or SKU contains "tee" are shown.
  - Given another workspace owns a product with SKU "TEE-1", When this workspace searches `q=TEE`, Then that product must NOT appear in
    the port (it does in the reference).
  - Given a product with `in_stock = false`, When listed, Then the Stock column shows "Out".
- **Source refs:** app/Http/Controllers/WaProductController.php:13-21, resources/views/user/store/products/index.blade.php,
  resources/views/user/store/_sidebar.blade.php:92.
- **Port notes:** cursor pagination per repo convention (page size 25 is a UI default); `GET /store/products?q=` over `wa_products` with
  `ILIKE`; add status filter and stock-quantity display (not in WaDesk, optional). Web route `apps/web` store/products.

### WD-CAT-020 — Product create and edit form

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-CAT-026, WD-CAT-012
- **Summary:** one form (create and edit) with basics, media, pricing, inventory and organisation cards, a live storefront preview and a
  profit indicator. It saves a product row, converts prices to minor units, normalises tags and gallery, uploads an image and generates
  a unique slug.
- **Actors & access:** workspace role admin or above (no plan gate). Edit and update resolve the product inside the workspace (404 otherwise).
- **UX & screens:** `user/store/products/create.blade.php`, `edit.blade.php`, `_form.blade.php`, JS `resources/js/charts/user-store-products-form.js`.
  Two columns. Left: Basics (Name required max 191; SKU optional max 96, mono; Short description max 2000, helper "shown in catalog cards
  and WhatsApp share links"; Full description max 65535, HTML allowed, helper "product page body"), Media (dropzone "Click or drop an
  image", PNG/JPG/WebP up to 4 MB with a filename label and instant preview; "Or image URL" max 1024, direct image link; a tips box about
  square 1024 px images; Gallery with an "Add image URL" button cloning URL rows (max 1024 each) with a thumbnail and remove button, empty
  text "No gallery images yet"), Pricing (Price required; Compare-at price optional "was"; Currency select; a read-only "Profit indicator"),
  Inventory and shipping (Stock qty with placeholder "Blank = unlimited"; Weight in grams "used for shipping cost calculations";
  "Available for sale" checkbox, "uncheck to mark sold-out while keeping the product visible"; Sort order "lower numbers appear first").
  Right rail: Visibility select (Active live on storefront, Draft hidden but editable, Archived hidden but kept in records), Organization
  (Category text with datalist suggestions Apparel, Accessories, Beauty, Home, Food & Drink, Electronics; Tags comma-separated), Storefront
  preview (image, name, price display, strike-through compare price when on sale). Footer bar: Cancel and "Create product" or "Save
  changes". Validation errors render in a red box on top. Success redirects to the list with "Product created." / "Product updated.".
  Client behaviour: the preview updates live (name, price with the symbol, compare shown only when greater); the profit indicator shows
  "-N% off" when compare > price (green), "Compare < price" (red) when lower, "0% - same" when equal, dash otherwise; the image URL field
  overrides the preview on change; the preview symbol map in JS only knows INR, USD, EUR, GBP (other currencies show the code).
- **Endpoints:**

| METHOD uri                   | route name                 | Controller@action          | middleware                      | request                      | response                                 |
| ---------------------------- | -------------------------- | -------------------------- | ------------------------------- | ---------------------------- | ---------------------------------------- |
| GET store/products/create    | user.store.products.create | WaProductController@create | web, auth, workspace.role:admin | none                         | Blade page                               |
| POST store/products          | user.store.products.store  | WaProductController@store  | same                            | multipart form, fields below | redirect list, status "Product created." |
| GET store/products/{id}/edit | user.store.products.edit   | WaProductController@edit   | same                            | none                         | Blade page (404 if not in workspace)     |
| PUT store/products/{id}      | user.store.products.update | WaProductController@update | same                            | same fields                  | redirect list, status "Product updated." |

- **Data:** `wa_products`. Request fields and rules: name required string max 191; sku nullable max 96; description nullable max 2000;
  body_html nullable max 65535; price_major required numeric 0..1,000,000; compare_price_major nullable numeric 0..1,000,000; currency_code
  required, exactly 3 chars and one of INR, USD, EUR, GBP, AED, KES, NGN, ZAR, BRL, MXN, CRC, PHP, IDR, SGD, MYR, THB, VND, EGP, PKR, BDT,
  LKR; in_stock sometimes boolean; stock_qty nullable integer 0..1,000,000; sort_order nullable integer 0..9999; status nullable in
  {active, draft, archived}; weight_grams nullable integer 0..1,000,000; category nullable max 96; tags nullable string max 1024; image
  nullable image file max 4096 KB; image_url nullable URL max 1024; gallery_urls nullable array max 12 of nullable URLs max 1024.
  Derived: `price_minor = round(price_major x 100)` (float math), `compare_price_minor = round(compare x 100)` or null when the compare
  field is empty or zero; `in_stock` default true; `status` default active; `tags_json` = unique trimmed non-empty comma parts, or null;
  `gallery_json` = unique trimmed non-empty URLs capped at 12, or null. NOT editable here (no form fields): `slug`, `aliases_json`,
  `availability`, `condition`, `brand`, `product_url`, `google_product_category`, `reserved_qty`, `storefront_id`, Meta columns, Shopify
  and Woo ids.
- **Rules & edge cases:**
  1. Slug: generated only when empty at save time, from the name via the slug helper (fallback `product`), unique per workspace by
     appending `-2`, `-3`, ... Renaming a product never changes its slug (the public URL stays stable). QUIRK: the uniqueness probe
     ignores soft-deleted rows while the database unique index (workspace, slug) includes them, so recreating a product named like a deleted
     one fails with a database error (HTTP 500). The port uses hard delete (the Postgres model has no `deleted_at`), which removes this case.
  2. Image upload: stored under `store-products` on the configured media disk, then `image_url` is set to its public URL (this second write
     re-triggers the auto-sync push, WD-CAT-012). When both an upload and a URL are given, the upload wins. Editing without a new upload
     keeps the old image; an emptied URL field on edit sets `image_url` to null.
  3. SKU is not unique anywhere; two products can share a SKU (and then share a retailer id on Meta).
  4. `compare_price_major = 0` is treated as "no compare price".
  5. The in-stock checkbox (hidden 0 plus 1) is independent of stock_qty: a product with stock 0 and in_stock true is still "available"
     in the list and the pickers.
  6. Create stores `user_id` = the creator. `fill()` on update never touches user_id, slug or non-form columns.
  7. A newly created active product triggers the Meta push when a catalog is connected (WD-CAT-012).
  8. No audit log row is written for create, update or delete.
  9. Currency list is a hard-coded 21 codes in the validator and the select; products imported from Meta may carry other codes and then
     fail revalidation on their next edit unless the user picks one of the 21.
  10. The form posts the whole object; tags and gallery cannot be partially edited through any API.
- **Async & events:** synchronous Meta push on save when a catalog is connected (WD-CAT-012). Image upload to the media disk.
- **External systems:** media disk (local, S3 or R2 per platform storage settings); Meta via the observer.
- **Settings:** platform media disk and URL settings; `catalog_default_currency` is NOT used here (default is INR in the select).
- **Acceptance criteria:**
  - Given price 1299.50 INR and compare 1999, When the product is saved, Then `price_minor = 129950` and `compare_price_minor = 199900`.
  - Given tags "cotton, summer, cotton, ", When saved, Then `tags_json = ["cotton","summer"]`.
  - Given 13 gallery URLs, When saved, Then validation fails (max 12); given 12 with duplicates, Then duplicates are removed.
  - Given currency "CAD", When saved, Then validation fails (not in the allowed list).
  - Given two products named "Red Tee", When both are created, Then slugs are `red-tee` and `red-tee-2`.
  - Given an image of 5 MB, When uploaded, Then validation fails (max 4 MB).
  - Given an edit that renames the product, When saved, Then the slug is unchanged.
- **Source refs:** app/Http/Controllers/WaProductController.php:23-62, 221-276, app/Models/WaProduct.php, resources/views/user/store/products/_form.blade.php,
  create.blade.php, edit.blade.php, resources/js/charts/user-store-products-form.js (+ -create.js, -edit.js entry points).
- **Port notes:** `wa_products` exists in the migration (hard delete, `uq_wa_products_slug (org_id, slug)`). Use a decimal-safe
  conversion (half-up on the decimal string, not float multiplication; WaDesk's float rounding can differ by one minor unit, e.g. 1.005).
  Upload through the repo's storage port, not inline. Expose aliases, brand, condition, availability and product URL in the API even though
  the WaDesk form does not (they feed Meta and ordering).

### WD-CAT-021 — Product delete

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-CAT-019
- **Summary:** removes a product from the workspace (soft delete in WaDesk). It disappears from lists, pickers and the storefront; it is not
  removed from Meta.
- **Actors & access:** admin or above, no plan gate. 404 when the id is not in the workspace.
- **UX & screens:** Delete button on each list row with a confirm "Delete this product?". Redirect to the list with "Product removed.".
- **Endpoints:**

| METHOD uri                 | route name                  | Controller@action           | middleware                      | request | response                                 |
| -------------------------- | --------------------------- | --------------------------- | ------------------------------- | ------- | ---------------------------------------- |
| DELETE store/products/{id} | user.store.products.destroy | WaProductController@destroy | web, auth, workspace.role:admin | none    | redirect list, status "Product removed." |

- **Data:** sets `deleted_at` (soft delete). Collections keep the stale id (filtered at use time); order items keep a product reference
  that resolves to an empty placeholder; reviews and reservations stay (reviews of a deleted product still list in moderation, showing the
  product as `#id`).
- **Rules & edge cases:**
  1. No cascade to Meta: the product stays in the Meta catalog and can still be sent by retailer id until removed in Commerce Manager.
  2. No cascade to collections; `product_count` still counts the stale id.
  3. The slug stays reserved by the soft-deleted row (see WD-CAT-020 rule 1). The Store wizard's "reset everything" force-deletes all
     products of the workspace (a hard delete) and its single-shop reset leaves products alone.
  4. No audit row.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an owned product, When delete is posted, Then it no longer appears in the list or the pickers and the flash says it was removed.
  - Given an id of another workspace, When delete is posted, Then 404 and nothing changes.
  - Given a collection containing the product, When the product is deleted, Then the collection still lists the stale id in its count but
    the send panel resolves only live members.
- **Source refs:** app/Http/Controllers/WaProductController.php:64-69, app/Models/WaProduct.php (SoftDeletes), app/Http/Controllers/WaStoreWizardController.php:140-146.
- **Port notes:** hard delete in Postgres with `ON DELETE CASCADE` for reviews and reservations and `SET NULL` for order items (already in
  the migration). Decide whether to also delete from Meta (add a DELETE batch request) and whether to prune ids from collections; record it.

### WD-CAT-022 — Product share-links modal

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-CAT-019
- **Summary:** the Share button opens a modal with the product's public storefront link and a ready-to-send `wa.me` deep link containing a
  pre-filled order message, each with a Copy button.
- **Actors & access:** admin or above. 404 for a foreign product.
- **UX & screens:** modal "Share product" with the product name; "Storefront link" read-only input + Copy; "WhatsApp deep link" read-only
  input + Copy ("Copied!" for 1.5 s); a "Send to a customer" row (WD-CAT-023); Close. When there is no storefront the link field reads
  "(set up your storefront slug first)"; when there is no WABA number the deep link reads "(connect a phone number first)".
- **Endpoints:**

| METHOD uri                          | route name                | Controller@action              | middleware                      | request | response                                                  |
| ----------------------------------- | ------------------------- | ------------------------------ | ------------------------------- | ------- | --------------------------------------------------------- |
| GET store/products/{id}/share-links | user.store.products.share | WaProductController@shareLinks | web, auth, workspace.role:admin | none    | `{ok:true, public_url, wa_link, product:{id,name,image}}` |

- **Data:** reads the product, the workspace's first storefront row and the workspace's primary provider config (its phone number).
- **Rules & edge cases:**
  1. `public_url` = storefront public URL with trailing slash trimmed + `/p/` + the product slug, or null with no storefront.
  2. `wa_link` = `https://wa.me/{digits of the primary config's phone number}?text={url-encoded message}` or null when there is no number. The
     message is: a greeting "Hi! I want to order:", a blank line, the product name in bold with its price display after a dash, the image
     URL on its own line when present, a blank line and "Qty: 1".
  3. The storefront chosen is simply the first row (not necessarily the newest), unlike the catalog sync which uses the newest.
  4. The product page URL works only if the storefront is enabled and the product is in stock (public side).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** storefront domain settings (custom domain, subdomain host) decide the public URL.
- **Acceptance criteria:**
  - Given a storefront with public URL `https://shop.example` and a product slug `red-tee`, When share-links is requested, Then
    `public_url = https://shop.example/p/red-tee`.
  - Given a primary WABA number +1 555 0100, When requested, Then `wa_link` starts with `https://wa.me/15550100?text=` and the decoded
    text contains the product name and price display.
  - Given no storefront and no number, When requested, Then both are null.
  - Given a foreign product id, When requested, Then 404.
- **Source refs:** app/Http/Controllers/WaProductController.php:105-117, resources/views/user/store/products/index.blade.php (share modal).
- **Port notes:** the storefront domain owns `public_url` computation; consume it via a service.

### WD-CAT-023 — Send one product to a WhatsApp number

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-CAT-022
- **Summary:** from the share modal, sends one product to a typed number as a normal WhatsApp message (image plus caption with name,
  price, short description and the storefront link), independent of any Meta catalog, and mirrors it into the inbox thread.
- **Actors & access:** admin or above. Foreign product: 404.
- **UX & screens:** the "Send to a customer" row: phone input (placeholder "WhatsApp number, e.g. +1 555…") and a Send button ("Sending…"
  while busy); a message line under it (green on success, red on failure); the phone field clears on success.
- **Endpoints:**

| METHOD uri                    | route name               | Controller@action                | middleware                      | request               | response                                                                                      |
| ----------------------------- | ------------------------ | -------------------------------- | ------------------------------- | --------------------- | --------------------------------------------------------------------------------------------- |
| POST store/products/{id}/send | user.store.products.send | WaProductController@sendToNumber | web, auth, workspace.role:admin | phone (string max 32) | `{ok:true,message:"Product sent to {digits}."}` or `{ok:false,message}` with HTTP 422/500/502 |

- **Data:** writes an outbound `inbox_messages` row (status pending, then sent or failed with a reason cut to 191 chars) with `meta.source =
product_share` and the product id, plus a found-or-created conversation (open, origin inbox, device = the sending device).
- **Rules & edge cases:**
  1. The phone's digits must number at least 7 (also checked client-side) else 422 "Enter a valid WhatsApp number with country code.".
  2. Sender is the first connected `devices` row (active first), same restriction as WD-CAT-015 (no device: 422 "No connected WhatsApp
     device. Pair one at /devices first."). From-number = device country code + phone.
  3. Caption: bold product name, an em dash and the price display; then, when the description is non-blank, a blank line and the first 300
     characters of the trimmed description; then, when a storefront exists, a blank line and `{public url}/p/{slug}`.
  4. The image is the product `image_url` (media type image) or none for text-only; external URLs are passed straight through.
  5. Delivery goes through the inbox dispatcher with the platform code of the Baileys engine, whatever the workspace engine (QUIRK: a
     WABA-only workspace with a device row sends through the unofficial engine); dispatcher exception: message failed, HTTP 500 "Send
     failed: ..."; dispatcher refusal: failed, HTTP 502 "Could not deliver: {error or the engine rejected the send}".
  6. On success the message is marked sent with `sent_at` and the provider message id in `meta.wa_message_id`.
  7. No billing meter is applied by this controller (the dispatcher applies plan-first billing).
  8. Conversation creation failure: 500 "Could not open a conversation for that number.".
- **Async & events:** synchronous dispatch; the inbox event pipeline then handles delivery receipts.
- **External systems:** the inbox dispatcher (Baileys/Node bridge).
- **Settings:** none.
- **Acceptance criteria:**
  - Given a connected device and a product with an image, When a valid number is posted, Then an image message with the caption is sent,
    the thread appears in the inbox and the reply says "Product sent to {digits}.".
  - Given a number with 5 digits, When posted, Then 422 with the number message and nothing is sent.
  - Given no connected device, When posted, Then 422 asking to pair a device.
  - Given the dispatcher rejects the message, When posted, Then the inbox row is `failed` with the reason and the reply is 502.
- **Source refs:** app/Http/Controllers/WaProductController.php:119-204.
- **Port notes:** send through the inbox send pipeline with the conversation's channel (not hard-coded Baileys); reuse the conversation
  find-or-create service.

### WD-CAT-024 — Products JSON list for the inbox catalog picker

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-CAT-026
- **Summary:** a lightweight JSON list of sendable products for the team-inbox "Catalog" modal: only active and in-stock products, with an
  optional search, capped at 120.
- **Actors & access:** route middleware `workspace.role:admin` (QUIRK: the main consumer is the team inbox, used by agents; for an agent
  the request is redirected to `/team-inbox` and the modal reports "Failed to load"). No workspace: `{ok:false, products:[]}`.
- **UX & screens:** consumed by `resources/js/charts/user-team-inbox-index.js` (the picker modal, WD-CAT-031).
- **Endpoints:**

| METHOD uri                  | route name                   | Controller@action           | middleware                      | request | response                                                                                                       |
| --------------------------- | ---------------------------- | --------------------------- | ------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| GET store/products/api/list | user.store.products.api.list | WaProductController@apiList | web, auth, workspace.role:admin | q?      | `{ok:true, products:[{id,name,sku,image_url,category,price_minor,price_display,currency,retailer_id,synced}]}` |

- **Data:** `wa_products` with status active and `in_stock = true`; optional `(name LIKE %q% OR sku LIKE %q%)` correctly grouped; ordered
  by sort_order then id desc; limit 120. `retailer_id` = meta_retailer_id, else sku, else `wsn-{id}`; `synced` = `meta_sync_status ===
'synced'`.
- **Rules & edge cases:**
  1. No shop filter (unlike the Send tab).
  2. Hard cap 120, no pagination: stores with more products must search.
  3. The picker shows a "synced" or "not synced" badge from `synced`; "not synced" products can still be sent on a Meta catalog but will
     fail on Meta if the item is not in the catalog.
  4. `price_display` is the formatted string (WD-CAT-026).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 3 active in-stock, 1 draft and 1 out-of-stock product, When listed, Then exactly the 3 are returned.
  - Given `q=tee`, When listed, Then only matches of name or SKU within the workspace are returned.
  - Given 200 matching products, When listed, Then 120 are returned.
  - Given a user without a workspace, When listed, Then `{ok:false,products:[]}`.
- **Source refs:** app/Http/Controllers/WaProductController.php:71-103, resources/js/charts/user-team-inbox-index.js:6753.
- **Port notes:** open this endpoint to anyone allowed to send catalog messages in a conversation (permission, not role) so agents work;
  keep the response shape.

### WD-CAT-025 — Stock and reservations

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-CAT-020
- **Summary:** `stock_qty` (null = unlimited) is the count; `reserved_qty` is the quantity held for in-flight natural-language orders; a
  ledger table `wa_stock_reservations` records each hold so it can be committed (stock decremented) on Confirm or released on cancel,
  re-order, abandonment or timeout.
- **Actors & access:** system (the ordering service, a heartbeat sweeper, webhooks and checkout). No UI in this domain; stock is edited
  in the product form (WD-CAT-020).
- **UX & screens:** none here.
- **Endpoints:** none.
- **Data:** `wa_products.stock_qty`, `reserved_qty`; `wa_stock_reservations` (workspace, product, optional order, `ref` string max 128
  grouping holds of one customer's order, qty, status `held|committed|released`, expires_at).
- **Rules & edge cases:**
  1. `availableQty()` = null when stock is null (unlimited); else max(0, stock - reserved).
  2. `hold(product, qty, ref, orderId?, ttl=1800 s)`: rejects qty <= 0 (null); in a transaction locks the product row, re-reads the
     available quantity and refuses (returns null) when available is below qty; unlimited stock is held without a ceiling but is still
     ledgered; ttl is at least 60 s; writes the reservation (status held, expires_at = now + ttl) and adds qty to `reserved_qty` quietly
     (no model events, so no Meta push).
  3. `commit(reservation, orderId?)`: only for held; locks the product; decrements `stock_qty` (floor 0, only when stock is tracked) and
     `reserved_qty` (floor 0); sets the reservation to committed with the order id.
  4. `release(reservation)`: only for held; decrements `reserved_qty` (floor 0), status released.
  5. `commitByRef` and `releaseByRef` apply the above to every held reservation of (workspace, ref) and return the count.
  6. `sweepExpired(limit 1000)`: releases held reservations with a non-null expires_at in the past, ordered by id; per-row failures are
     logged and skipped. It runs from the node heartbeat endpoint (`WaConnectController`), guarded by a 60 s cache lock, i.e. about once a
     minute, no cron.
  7. Callers: the ordering service (hold per matched line, commit on customer Confirm, release on cancel and re-order), the commit step
     passes the new order id.
  8. Other stock writers ignore reservations: the storefront checkout caps requested qty by raw `stock_qty` and decrements it directly
     (suppressing the Meta push); Shopify and WooCommerce stock webhooks update stock/in-stock; the Sheets add-on sets stock.
  9. `reserved_qty` is never recomputed from the ledger; a crash between ledger write and counter update would drift (both are in one
     transaction, so only manual edits drift).
- **Async & events:** heartbeat-driven sweep (about 60 s). In the port: a worker job.
- **External systems:** none.
- **Settings:** hold TTL is a constant (1800 s) at the call sites.
- **Acceptance criteria:**
  - Given stock 5 and reserved 3, When a hold of 3 is requested, Then it is refused; a hold of 2 succeeds and reserved becomes 5.
  - Given a held reservation of 2, When it is committed, Then stock decreases by 2, reserved decreases by 2 and status is committed.
  - Given a held reservation past its expiry, When the sweep runs, Then it is released and reserved decreases.
  - Given unlimited stock (null), When a hold of 50 is requested, Then it succeeds and stock stays null.
  - Given two concurrent holds for the last unit, When both run, Then exactly one succeeds (row lock).
- **Source refs:** app/Services/Ordering/InventoryService.php, app/Models/WaStockReservation.php, app/Models/WaProduct.php (availableQty),
  app/Http/Controllers/WaConnectController.php:818-826, app/Services/Ordering/OrderingService.php (hold/commit/release calls).
- **Port notes:** tables `wa_stock_reservations` and the product columns exist. Implement as `SELECT ... FOR UPDATE` in the repository; add
  a CHECK `reserved_qty >= 0`; consider making checkout honour `available` (decision). Sweep = BullMQ repeatable job.

### WD-CAT-026 — Money and currency rules

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** none
- **Summary:** the pricing contract of the whole commerce area: prices are stored as integer "minor" units that are always major x 100,
  displayed with a currency symbol, and converted to the currency's real minor unit only when talking to Meta.
- **Actors & access:** all features that show or send prices.
- **UX & screens:** price display strings in lists, pickers, captions and the storefront; the product form price fields.
- **Endpoints:** none.
- **Data:** `price_minor` and `compare_price_minor` (unsigned big integers; compare nullable), `currency_code` (3 chars, default INR).
- **Rules & edge cases:**
  1. Storage: `price_minor = round(major x 100)` for every currency, including zero- and three-decimal ones; reading divides by 100
     (`price_major`, `compare_price_major`).
  2. Display (`formatCurrency(minor, code)`): `{symbol} {number}` with a space, thousands separated by comma, no decimals when the major
     amount is whole, otherwise exactly two decimals ("₹ 1,299", "₹ 1,299.50"). Unknown codes use the code itself as the symbol. `null`
     currency uses the code "" (empty symbol) in the model, and the shared money helper defaults to USD.
  3. Symbol table: INR ₹, USD $, EUR €, GBP £, AED د.إ, KES KSh, NGN ₦, CRC ₡, BRL R$, ZAR R, PHP ₱, IDR Rp, MXN $, SGD S$, MYR RM, THB ฿,
     VND ₫, EGP E£, PKR ₨, BDT ৳, LKR Rs.
  4. Sale: a product is "on sale" when compare_price_minor is not null and greater than price_minor; the compare display is hidden
     otherwise.
  5. To Meta (`metaCatalogPrice(priceMinor, currency)`; null currency treated as INR): zero-decimal currencies (BIF, CLP, DJF, GNF, IDR,
     ISK, JPY, KMF, KRW, MGA, PYG, RWF, UGX, VND, VUV, XAF, XOF, XPF, HUF, TWD) send price_minor / 100 (integer division);
     three-decimal currencies (BHD, IQD, JOD, KWD, LYD, OMR, TND) send price_minor x 10; all others send price_minor unchanged. Inverse
     on import is in WD-CAT-011.
  6. Form accepts price 0..1,000,000 inclusive with two decimals via the number input step 0.01; the allowed currency codes are the 21 in
     WD-CAT-020. A price of 0 is allowed on save but flags the product in the health score and is rejected/hidden by Meta.
  7. Other money strings: the order acknowledgement formats totals as `{code} {number with 2 decimals}` (WD-CAT-029); the Baileys carousel
     sends `price_minor / 100` plus the currency code; the concierge price band compares `price_minor` against `typed number x 100`.
  8. Display never rounds below 2 decimals and ignores per-currency decimals (JPY 1234 shows "¥"-less "1,234").
- **Async & events:** none.
- **External systems:** Meta catalog price field.
- **Settings:** admin `catalog_default_currency` exists but is not read by any product code (WD-CAT-030).
- **Acceptance criteria:**
  - Given `price_minor = 129950` INR, When displayed, Then "₹ 1,299.50"; given 129900, Then "₹ 1,299".
  - Given IDR `price_minor = 3390000000`, When pushed to Meta, Then the price sent is 33,900,000.
  - Given KWD `price_minor = 12345`, When pushed to Meta, Then 123,450 is sent.
  - Given compare 199900 and price 129900, When evaluated, Then on-sale is true; given equal, then false.
  - Given an unknown currency "XYZ", When displayed, Then the symbol is "XYZ".
- **Source refs:** app/Models/WaProduct.php (formatCurrency, currencySymbol, metaCatalogPrice, accessors), app/Support/MoneyFormat.php,
  app/Http/Controllers/CatalogController.php (parseMetaPriceMinor).
- **Port notes:** put money helpers in `packages/contracts` or a shared kernel package (checkout, ordering and flows use the same
  formatter). Always integer minor units in the DB (`bigint`) and in the API.

### WD-CAT-027 — Product reviews moderation

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-CAT-019
- **Summary:** the merchant's queue for reviews that customers submit on the storefront product page. Reviews arrive pending and only
  appear publicly once approved.
- **Actors & access:** workspace admin or above (no plan gate). Reviews are created by the public storefront (storefront domain), not here.
- **UX & screens:** `user/store/reviews/index.blade.php` inside the Store layout (same sidebar dependency, so the page 500s without a
  storefront, confirmed in the running reference). Title "Product reviews", intro "Approve customer reviews to show them on the storefront
  product page". Tabs Pending / Approved / Rejected each with a count; cards with stars (rating filled, the rest greyed), customer name or
  "Anonymous", "on {product name or #id} · {time ago}", the body text, and buttons Approve (not shown on the approved tab), Reject (not
  shown on the rejected tab), Delete (confirm "Delete this review?"). Empty: "No {status} reviews.". Pagination 30 per page. Flash
  "Review {status}." after a status change and "Review deleted.".
- **Endpoints:**

| METHOD uri                | route name                 | Controller@action          | middleware                      | request                                      | response                                           |
| ------------------------- | -------------------------- | -------------------------- | ------------------------------- | -------------------------------------------- | -------------------------------------------------- |
| GET store/reviews         | user.store.reviews.index   | WaReviewController@index   | web, auth, workspace.role:admin | status? (pending, approved, rejected), page? | Blade page                                         |
| PUT store/reviews/{id}    | user.store.reviews.update  | WaReviewController@update  | same                            | status (pending, approved, rejected)         | back, status "Review {status}."                    |
| DELETE store/reviews/{id} | user.store.reviews.destroy | WaReviewController@destroy | same                            | none                                         | back, status "Review deleted." (silent if missing) |

- **Data:** `wa_product_reviews`: workspace, storefront, product, optional order (reserved verified-purchase link, never set), customer
  name (max 120), rating (1 to 5, default 5), body (storefront limits it to 1000), status (default pending), timestamps. Eager loads the
  product relation for the label.
- **Rules & edge cases:**
  1. Unknown or missing `status` query defaults to pending.
  2. Counts per status are computed over the workspace regardless of the current tab.
  3. Update validates the status value; moving back to `pending` is allowed through the API (no UI button), a missing review is 404.
  4. Delete ignores ids outside the workspace without error.
  5. Public side (consumer): only `approved` reviews (latest 20) show on the product page with an average rating rounded to one decimal;
     submissions are validated product id, name required max 120, rating integer 1..5, body max 1000, create a pending review and answer
     "thanks, it will appear once approved".
  6. No notification is sent to the merchant when a review arrives; no email or push.
  7. A deleted product's reviews remain and display `#id`.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 2 pending and 1 approved review, When the page opens without a filter, Then the Pending tab shows 2 cards and the counts read
    2, 1, 0.
  - Given a pending review, When Approve is clicked, Then its status is approved, the flash says "Review approved." and it shows on the
    storefront product page.
  - Given 40 reviews in a status, When opened, Then 30 show and a second page exists.
  - Given another workspace's review id, When update is called, Then 404.
  - Given a rating of 4 and the Approved tab, When listed, Then four filled stars and one grey star are shown and no Approve button.
- **Source refs:** app/Http/Controllers/WaReviewController.php, app/Models/WaProductReview.php, resources/views/user/store/reviews/index.blade.php,
  app/Http/Controllers/StorefrontPublicController.php:130, 315-345.
- **Port notes:** table `wa_product_reviews` exists. The public submit endpoint belongs to the storefront domain; expose a
  `ReviewsService.listApproved(productId)` to it. Consider a merchant notification (not in WaDesk).

### WD-CAT-028 — Catalog concierge (free text to product list)

- **Status:** implemented
- **Priority:** P2
- **Effort:** L
- **Depends on:** WD-CAT-006, WD-CAT-034
- **Summary:** when enabled, an inbound customer text such as "red shoes under 2000" is parsed into keywords and a price band, the best
  matching active products are searched, and a Meta product-list message of the top matches is sent back automatically.
- **Actors & access:** system, on every inbound WhatsApp text. Configured in the Setup tab (WD-CAT-006).
- **UX & screens:** the Automation card; no runtime UI (the reply appears in the thread as a provider message).
- **Endpoints:** none (called from the inbound webhook handler, `WaInboundController`, after the WooCommerce concierge and before the AI
  copilot gate, wrapped in try/catch).
- **Data:** reads `wa_catalogs.meta_json` keys `concierge_enabled` (must be exactly true), `concierge_max` (default 10, clamp 1..30),
  `concierge_header` (default "Here's what I found"), `concierge_footer` (optional, no UI), `concierge_reply_on_empty` (default false),
  `concierge_empty_text` (default "Sorry, I couldn't find a match for that. Try a different keyword or budget."), and `wa_products`.
- **Rules & edge cases:**
  1. Gate: the digits of the sender and the text (trimmed, at least 2 characters) must be non-empty; the workspace needs a `wa_catalogs`
     row with a catalog id and `concierge_enabled === true`; any exception returns false (inbound never breaks).
  2. Intent: lower-case the text. Price band: pattern "A to B", "A - B" or "A and B" (numbers may contain commas) gives min = smaller and
     max = larger; otherwise "under / below / less than / upto / up to / max / <, <=" followed by an optional currency token (rs, ₹, $,
     inr, usd) and a number sets max, and "above / over / more than / from / min / >, >=" sets min. Numbers are major units (the search
     multiplies by 100).
  3. Keywords: split on non letter/number runs, drop tokens shorter than 2 characters, pure digits and stop words (show, me, want, need,
     looking, look, for, do, you, have, has, any, the, a, an, is, are, got, get, some, please, pls, hi, hello, hey, and, or, to, with, i, my,
     we, us, price, priced, cost, budget, under, below, above, over, less, more, than, between, around, near, about, upto, rs, inr, usd,
     send, share, catalog, product, products, item, items, buy, purchase, order, available); de-duplicate. No keywords and no price band =
     not a product query, return false and let normal handling continue.
  4. Anti-flood: one auto-answer per (workspace, sender) per 30 seconds, claimed via an atomic cache add BEFORE the product search, so even
     an unanswered message (no match) starts the cooldown.
  5. Search: active products of the workspace (NOT filtered by in_stock), price within the band (price_minor vs value x 100), and when
     keywords exist, any keyword matching name, description, category or brand by LIKE (with `%` and `_` escaped). A candidate set of
     max(limit x 3, 60) rows is taken in database order BEFORE ranking, then scored in PHP: per keyword, +3 when it appears in
     name+category+brand, else +1 when only in the description; sorted by score desc, top `max`. With no keywords (price band only) the
     result is sorted by updated_at desc.
  6. No match: silent unless reply_on_empty is true, then a plain text with the empty text is sent through the generic dispatcher
     (platform code W) and the call returns true.
  7. Match: sends one product-list message via the workspace's catalog provider (`WhatsAppCatalogFactory::forWorkspace`) with header
     (config or default), body "I found N match(es) for "{query up to 60 chars}":" (singular for 1), one section titled "Top matches" with
     the retailer ids (meta_retailer_id, else sku, else `wsn-{id}`), and the optional footer. Always the Meta path, even for a workspace
     whose conversations run on Baileys.
  8. Nothing is written to the inbox or activity tab (no `meta.kind=catalog` row) for the concierge reply, and no billing meter is applied.
  9. QUIRK: any non-stop-word text is a "product query" ("thanks", "ok", "yes" all pass), so with the concierge on every short chat
     message can trigger a search and start a 30 s cooldown.
- **Async & events:** runs inline in the inbound webhook (a Meta call per qualifying message). Port: a queued job off the inbound event.
- **External systems:** Meta messages endpoint.
- **Settings:** the meta_json keys above; cache for the cooldown.
- **Acceptance criteria:**
  - Given the concierge on and products "Red Running Shoes" 1,800 and 2,500, When a customer writes "red shoes under 2000", Then a
    product-list message with only the 1,800 product is sent with the body "I found 1 match for "red shoes under 2000":".
  - Given the concierge off, When any message arrives, Then nothing is sent.
  - Given two qualifying messages within 30 seconds from one number, When processed, Then only the first is answered.
  - Given no match and reply_on_empty false, When a customer asks, Then nothing is sent; with reply_on_empty true the empty text is sent.
  - Given the text "hi", When processed, Then it is not treated as a product query.
  - Given "between 1000 and 2000 bags", When parsed, Then min 1000, max 2000 and keyword "bags".
- **Source refs:** app/Services/WhatsAppCatalog/CatalogConciergeService.php, app/Http/Controllers/WaInboundController.php:795-810.
- **Port notes:** implement as an inbound-message consumer in the inbox/automation pipeline; keep the parser pure (unit-testable table).
  Decisions: honour in_stock, rank in SQL, mirror the reply into the thread, apply billing. Mention in the AI-copilot ordering so they do not
  both answer the same message.

### WD-CAT-029 — Catalog order acknowledgement

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-CAT-006
- **Summary:** when a customer sends a WhatsApp cart (a catalog `order`) and the order row has been created, the buyer immediately gets an
  "order received" message with item count, total and an optional pay link, instead of silence.
- **Actors & access:** system, triggered by the Meta webhook order handler (owned by `checkout-orders-merchant-payments` /
  `whatsapp-cloud-api-waba`); configured in the Setup tab.
- **UX & screens:** the Automation card's order-acknowledgement group (WD-CAT-006).
- **Endpoints:** none (internal call `acknowledge(order)` from `WaWebhookController` after the order is stored, skipped when the optional
  WhatsApp Pay auto-charge already handled the order; wrapped so a send failure never makes Meta retry).
- **Data:** reads the order (customer phone and name, items, total minor, currency, id) and `wa_catalogs.meta_json`: `order_ack_enabled`
  (default TRUE when the key is absent or there is no catalog row), `order_ack_pay_url`, `order_ack_template_id` (no UI).
- **Rules & edge cases:**
  1. Skipped when the customer phone has no digits or `order_ack_enabled` is explicitly false.
  2. Item count = sum of each item's qty (default 1). Total text = `{currency code} {total_minor / 100 with 2 decimals}` trimmed (no
     symbol, always two decimals, thousands comma). Customer name defaults to "there"; order number is `#{order id}`.
  3. Pay link: when a base url is configured, it is the base without a trailing slash plus `?order={id}` (or `&order=` when the base
     already has a query).
  4. A configured approved template (same workspace, found by id) wins over the built-in text: it is sent through the commerce event
     notifier with context keys name, first_name, order_name, order_number, total, item_count, pay_url and positional values [name,
     order name, total]; a template send exception is logged and the function returns (no fallback to plain text).
  5. Built-in plain text, three lines: "Thank you, {name}! We've received your order {#id}.", "{count} item(s) · Total: {total}", and then
     either "Complete your payment securely here: {url}" or "We'll confirm your order and share payment details shortly.". Sent as a raw
     message via the generic dispatcher (platform code W).
  6. Failures are logged and swallowed.
  7. The 24-hour window is not an issue (the customer just messaged).
- **Async & events:** inline in the webhook. Port: enqueue after the order commit (outbox event `order.created` consumed here).
- **External systems:** the workspace's messaging engine through the dispatcher or template notifier.
- **Settings:** the three meta_json keys.
- **Acceptance criteria:**
  - Given a cart order of 3 items totalling 129950 minor INR and no pay url, When acknowledged, Then the buyer receives the 3-line text with
    "3 items · Total: INR 1,299.50" and the "share payment details shortly" line.
  - Given a pay base `https://pay.example.com/c` and order 77, When acknowledged, Then the text contains `https://pay.example.com/c?order=77`.
  - Given `order_ack_enabled = false`, When an order arrives, Then nothing is sent.
  - Given a configured template id that exists, When acknowledged, Then the template is sent with the context and no plain text.
  - Given no catalog row at all, When acknowledged, Then the built-in text is still sent (default on).
- **Source refs:** app/Services/WhatsAppCatalog/CatalogOrderService.php, app/Http/Controllers/WaWebhookController.php:670-700.
- **Port notes:** consume the orders domain event; store the config in typed fields; reuse the template-send port.

### WD-CAT-030 — Admin catalog settings

- **Status:** partial (only the Graph version setting changes behaviour)
- **Priority:** P2
- **Effort:** S
- **Depends on:** none
- **Summary:** the platform super-admin's "WhatsApp Catalog" settings page: feature switch, Graph API version, default currency,
  commerce toggle, optional Meta app credentials, and three usage tiles. Of these, only the Graph version is read by the catalog code.
- **Actors & access:** platform admins (middleware `EnsureUserIsAdmin` and the IP allow-list) at `/admin/settings/catalog`.
- **UX & screens:** `resources/views/admin/settings/catalog.blade.php`. Breadcrumb Admin / Settings / Catalog; buttons All settings, Open
  user catalog, Reset draft, Save changes. Tiles "Workspaces connected" (workspaces with a saved catalog id), "Products synced" and
  "Catalog messages sent". Cards: Feature gate (Enabled toggle; "Allow Commerce checkout" toggle), Cloud API (Graph API version input
  with pattern `v\d{1,2}\.\d{1,2}`, placeholder v23.0; Default currency 3-letter, shown uppercase), Optional Meta App (App ID max 60; App
  Secret password field, blank keeps the saved secret, placeholder says saved when present), a five-step merchant walkthrough (WABA and
  phone number, create a catalog in Commerce Manager and make it public, connect it to the WABA, create a System User token with
  whatsapp_business_messaging, whatsapp_business_management and catalog_management, paste credentials on /catalog), a sidebar describing
  per-merchant vs platform settings, the three payload types (SPM product, MPM product_list with max 10 sections and 30 items, catalog
  message CTA), reference links and constraints (catalog must be public etc.).
- **Endpoints:**

| METHOD uri                   | route name                    | Controller@action                         | middleware                                | request                                                                                                                                            | response                                                         |
| ---------------------------- | ----------------------------- | ----------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| GET admin/settings/catalog   | admin.settings.catalog        | AdminPagesController@settingCatalog       | web, auth, EnsureUserIsAdmin, IPAllowlist | none                                                                                                                                               | Blade page                                                       |
| PATCH admin/settings/catalog | admin.settings.catalog.update | AdminPagesController@settingCatalogUpdate | same                                      | catalog_enabled?, catalog_commerce_enabled?, catalog_graph_api_version?, catalog_meta_app_id?, catalog_meta_app_secret?, catalog_default_currency? | redirect back to the page with success "Catalog settings saved." |

- **Data:** `system_settings` keys: `catalog_enabled` (bool, default true when unset), `catalog_commerce_enabled` (bool, default false),
  `catalog_graph_api_version` (string, default `v23.0`), `catalog_meta_app_id`, `catalog_meta_app_secret` (encrypted), `catalog_default_currency`
  (string, default USD).
- **Rules & edge cases:**
  1. Validation: the two toggles `sometimes|boolean`; version nullable and must match `^v\d{1,2}\.\d{1,2}$`; app id nullable max 60; app
     secret nullable max 120; default currency nullable size 3 (not forced to upper case, not checked against ISO codes).
  2. A non-empty app secret is encrypted with the app key then stored; blank submission keeps the stored value. The settings export masks
     the key (suffix and explicit-name rule).
  3. Booleans: an unchecked toggle is saved as false (missing booleans are written false). Blank text fields are saved as empty strings.
     QUIRK: saving a blank Graph version stores an empty string, which then overrides the `v23.0` default (the setting row exists), producing
     catalog URLs without a version segment. Reads are cached 30 minutes.
  4. Audit action `settings.catalog_update` with the list of submitted field names.
  5. INERT SETTINGS (QUIRK): `catalog_enabled` (documented as hiding the menu everywhere), `catalog_commerce_enabled`, `catalog_default_currency`
     and `catalog_meta_app_id/secret` are not read by any product, catalog or UI code (only the settings-health screen reads
     `catalog_enabled`, to flag "catalog needs test" because no code ever writes the `settings.catalog_test` audit action, so the flag is
     permanently raised once the catalog is enabled).
  6. QUIRK: the usage tiles for products and sends query tables `wa_catalog_products` and `wa_catalog_send_logs` that do not exist; the errors
     are swallowed so both tiles always show 0. Only "connected" is real.
- **Async & events:** audit log row.
- **External systems:** none.
- **Settings:** the keys above; `waba_graph_api_version` is a separate setting (WABA domain) that autodetect uses.
- **Acceptance criteria:**
  - Given an admin, When they save version `v24.0`, Then `catalog_graph_api_version = v24.0` and catalog calls use it.
  - Given version `24`, When saved, Then validation fails.
  - Given an app secret typed, When saved, Then it is stored encrypted and the placeholder shows it is saved; blank on the next save keeps it.
  - Given a non-admin or an IP outside the allow-list, When the page is requested, Then access is denied.
- **Source refs:** app/Http/Controllers/AdminPagesController.php:3378-3433, 3873-3888, resources/views/admin/settings/catalog.blade.php, routes/admin.php:542-543.
- **Port notes:** home `apps/api/src/modules/admin` settings registry (`platform-settings-branding-storage`). Port only what is read:
  graph version (validated, non-empty default) and optionally the feature switch (decide whether to make it real). Drop the dead tiles or
  compute them from `wa_products`/inbox. Do not keep the 'needs test' coupling.

### WD-CAT-031 — Catalog picker in the team-inbox conversation (consumer contract)

- **Status:** implemented (owned by `team-inbox-conversations`)
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-CAT-024, WD-CAT-015
- **Summary:** inside a conversation the agent opens a "Catalog" modal, picks a format and products from the products API, and posts to the
  team-inbox endpoint which sends the catalog message to that conversation's customer. The same endpoint powers WD-CAT-015.
- **Actors & access:** any user who may reply to the conversation (policy `reply`, workspace member). Route `POST
team-inbox/api/conversations/{id}/catalog` (`user.team-inbox.api.catalog`, middleware web, auth only) is OWNED by team-inbox; this entry
  records the contract so both sides agree.
- **UX & screens:** `#catalog-modal` in the team inbox (script `user-team-inbox-index.js`): mode switch Single / List / Link, search box (250
  ms debounce) hitting WD-CAT-024, a product grid with a "synced" or "not synced" badge, an optional message textarea, summary "N selected /
  30 max", Send. Single mode keeps one pick; List caps at 30 ("Multi-product messages support up to 30 items."); Link needs no products.
  Escape and backdrop close. Success toast "Catalog sent"; errors in a warning strip (the server `message` or "Failed (HTTP n)").
- **Endpoints:**

| METHOD uri                                     | route name                  | Controller@action                  | middleware | request                                                                                                                                       | response                                                                                                      |
| ---------------------------------------------- | --------------------------- | ---------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| POST team-inbox/api/conversations/{id}/catalog | user.team-inbox.api.catalog | TeamInboxController@catalogContent | web, auth  | mode (spm/mpm/link, required), body? max 1024, header? max 60, footer? max 60, product_retailer_ids[]? max 30 each max 100 chars, product_id? | `{ok:true, mode, message_id[, provider:"baileys"]}` or `{ok:false,error,message[,code]}` with 402/422/500/502 |

- **Data:** conversation (workspace, raw JID or alt JID as the recipient digits, device), catalog row, products, inbox message.
- **Rules & edge cases:**
  1. Catalog present: recipient = digits of `raw_jid`, else `alt_jid` (none: 422 `no_recipient`). The plan-first meter runs first (one
     message; free under `monthly_messages_limit`, one wallet credit on overflow; refused: 402 `plan_limit`).
  2. Single product: needs `product_id` (workspace scoped) or the first retailer id, else the provider error "SPM requires a product id or
     retailer id". Product list: retailer ids required ("MPM requires at least one product"); products are looked up inside the workspace by
     `meta_retailer_id` or `sku`, grouped into sections by category (title = category or "Featured"); unknown retailer ids fall under
     "Featured". Link: body, default text with the catalog link (WD-CAT-015 rule 10).
  3. Provider errors: 502 `provider_error` with Meta's message and code; any other exception: 500 `server_error` (logged).
  4. Success inserts the outbound inbox row (kind catalog; provider `waba` for this path; the provider's full response; the
     denormalised product summaries looked up by id or retailer id/sku) with status sent and returns the first Meta message id.
  5. No catalog row: Baileys fallback: needs the conversation's device (422 `no_device`) and recipient; product ids/retailer ids are
     resolved against sku/retailer id/id (none: 422 `no_products`); link mode needs a storefront (422 `no_shop`); the bridge result
     (success flag, messageId) is stored; errors are 502 `baileys_error`; same plan-first metering.
  6. Meta's 24-hour rule is Meta-side: outside the window Meta errors (131047) and the message is forwarded to the operator.
  7. A product lookup by retailer id also matches the `sku` column (so SKU-based retailer ids resolve even when `meta_retailer_id` is
     unset).
- **Async & events:** inline Meta call; inbox row insert (broadcast to the inbox UI by the standard message pipeline in the port).
- **External systems:** Meta messages endpoint; Node bridge.
- **Settings:** plan message limit; billing wallet.
- **Acceptance criteria:**
  - Given a conversation with raw JID "919812345678@s.whatsapp.net" and a linked catalog, When mode spm with a product id is posted,
    Then Meta receives a product message to 919812345678 and an inbox row of kind catalog exists.
  - Given mode mpm with two retailer ids of different categories, When posted, Then the Meta payload has two sections titled by category.
  - Given the plan limit reached and no wallet, When posted, Then 402 `plan_limit` and no message is sent.
  - Given no catalog row and a connected Baileys device, When mode mpm is posted, Then the Node bridge receives a multi carousel and the
    reply contains `provider: baileys`.
  - Given mode link and no catalog and no storefront, When posted, Then 422 `no_shop`.
- **Source refs:** app/Http/Controllers/TeamInboxController.php:3380-3790, resources/js/charts/user-team-inbox-index.js:6685-6870,
  app/Http/Controllers/WaProductController.php (apiList).
- **Port notes:** implement in the inbox module (`apps/api/src/modules/inbox`) calling a `CatalogSenderPort` provided by catalog-products;
  keep the `meta.kind = catalog` message shape. Permission: reuse the inbox reply permission, not a catalog role.

### WD-CAT-032 — Product aliases and order-text matching

- **Status:** partial (aliases have no editing UI)
- **Priority:** P2
- **Effort:** M
- **Depends on:** WD-CAT-025
- **Summary:** `aliases_json` holds extra names for a product in any language so the natural-language ordering parser can map "鸡腿" or
  "ayam" to the right product; `ProductMatcher` resolves a free-text item name to a catalog product with a best-first ladder.
- **Actors & access:** system (ordering service, AI order parser). Aliases can be set only by direct data load or API: the product form
  has no field.
- **UX & screens:** none in this domain.
- **Endpoints:** none.
- **Data:** `wa_products.aliases_json` (array of strings, or objects with `alias` or `name`), `sku`, `name`, `price_minor`, `currency_code`,
  `stock_qty`, `reserved_qty`, `image_url`, active products only.
- **Rules & edge cases:**
  1. Normalisation: lower-case, trim, collapse whitespace runs.
  2. Ladder (first hit wins): (1) exact SKU, confidence 1.0, matched_on `sku`; (2) exact name, 1.0, `name`; (3) exact alias, 0.98, `alias`;
     (4) fuzzy over the name and every alias: containment either way scores 0.85 (`contains`), otherwise the `similar_text` percentage / 100;
     the best score at or above 0.62 wins, rounded to 2 decimals, matched_on `fuzzy` or `contains`. No hit: product null, matched_on `none`
     (`empty` for blank input).
  3. Only `status = active` products are candidates; out-of-stock ones are still matched (the stock check happens at hold time).
  4. Loaded once per workspace per request (in-memory cache); fine for small catalogs.
  5. `aliasStrings()` lower-cases and trims each alias and skips blanks.
  6. The first matching product in database order wins ties.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** fuzzy threshold constant 0.62.
- **Acceptance criteria:**
  - Given product SKU "ST-001", When resolving "st-001", Then matched_on is sku with confidence 1.
  - Given aliases ["ayam","鸡腿"] on "Chicken Drumstick", When resolving "AYAM", Then matched_on alias with confidence 0.98.
  - Given the text "chicken drumsticks" and product "chicken drumstick", When resolving, Then it matches by containment at 0.85.
  - Given unrelated text "laptop", When resolving, Then product is null and matched_on none.
- **Source refs:** app/Services/Ordering/ProductMatcher.php, app/Models/WaProduct.php (aliasStrings), app/Services/Ordering/OrderingService.php.
- **Port notes:** `aliases_json jsonb` exists. Add alias editing to the product form and API; implement trigram or a Dice/Levenshtein
  equivalent (PHP `similar_text` has no exact SQL equivalent; pin the threshold with tests) in the ordering module.

### WD-CAT-033 — Meta product payload and availability derivation

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-CAT-026
- **Summary:** how a local product becomes a Meta catalog item: field mapping, retailer id, availability, price conversion, links and
  empty-field pruning.
- **Actors & access:** system (sync, auto-sync, sweep).
- **UX & screens:** the Setup products table shows the effective availability and the Meta status.
- **Endpoints:** none.
- **Data:** reads the product columns listed below; writes none.
- **Rules & edge cases:**
  1. Item = `retailer_id`, `name`, `description` (the description, falling back to the name, cut to 9,999 chars), `availability`,
     `condition` (stored value else `new`), `price` (WD-CAT-026 conversion), `currency` (code else INR), `image_url`,
     `additional_image_urls` (non-empty gallery or omitted), `url`, `brand`, `category`, `google_product_category`, `inventory` (= stock_qty).
     Null and empty-string fields are removed from the payload; a numeric zero price or stock is kept (they are not null or empty string).
  2. Link `url`: the product's own `product_url` if set, else `{shop public url}/p/{slug}` when a storefront exists, else omitted (Meta
     then rejects the item; the failure shows on the row).
  3. Retailer id: `meta_retailer_id` if set else `sku` else `wsn-{id}`; never rotate it once synced (changing SKU later creates a duplicate
     item on Meta).
  4. Effective availability: if the stored `availability` value is non-empty it wins verbatim; else status not active gives
     `discontinued`; else stock quantity set and not above 0 gives `out of stock`; else `in stock`. QUIRK: the database column defaults to
     "in stock" and is never NULL, so for every product loaded from the database the stored value always wins, and `in_stock = false`, a
     stock of 0 and the status are ignored. The derived path only runs for an in-memory new model (the first auto-push right after
     create). Result: an out-of-stock product is told to Meta as "in stock" on every sync after creation unless the availability column was
     set by hand or by a Meta import. The product documentation promises the derived behaviour. The port must pick one rule and test it
     (recommended: derive unless explicitly overridden, and make the column nullable or add a mode flag).
  5. Allowed availability values: in stock, out of stock, available for order, discontinued; condition: new, refurbished, used.
  6. The payload is used for both batch sync and single auto-push; the batch wraps each item as `{method: CREATE, retailer_id, data}`.
- **Async & events:** none.
- **External systems:** Meta items_batch (WD-CAT-009).
- **Settings:** none.
- **Acceptance criteria:**
  - Given a product with SKU "ST-001", description empty, name "Tee", price_minor 129950 INR, When the payload is built, Then
    `retailer_id = ST-001`, description = "Tee", `price = 129950`, `currency = INR`.
  - Given no SKU and id 42, When built, Then retailer id is `wsn-42`.
  - Given an IDR product price_minor 3390000000, When built, Then `price = 33900000`.
  - Given a product with no gallery and no brand, When built, Then `additional_image_urls` and `brand` are absent.
  - Given a product with stored availability empty (port rule), status draft, When built, Then availability is discontinued.
- **Source refs:** app/Models/WaProduct.php (toMetaCatalogPayload, getEffectiveAvailabilityAttribute, metaCatalogPrice), database/migrations/2026_05_13_050000_extend_wa_products_for_meta_catalog.php.
- **Port notes:** a pure mapper in the Meta adapter package with table tests; the migration column `availability` is NOT NULL default
  'in stock' with a CHECK; adjust it consciously (see the quirk).

### WD-CAT-034 — Catalog provider abstraction (Meta Cloud, 360dialog)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** none
- **Summary:** one interface for catalog operations and catalog-message sends, with two implementations that share byte-identical payloads
  and differ in host and auth header.
- **Actors & access:** internal (factory chosen by the catalog row's provider).
- **UX & screens:** none.
- **Endpoints:** none (outbound calls only).
- **Data:** the `wa_catalogs` row (provider, catalog id, waba id, phone number id, token, flags).
- **Rules & edge cases:**
  1. Factory: provider `dialog_360` gives the 360dialog implementation; anything else gives Meta Cloud. `forWorkspace` throws "Workspace has
     no catalog bound" when no row exists.
  2. HTTP defaults: JSON accept, 30 s timeout, retry 2 attempts with 250 ms pause and no throw on the last failure so the error parser can
     translate it.
  3. Auth: Meta Cloud sends `Authorization: Bearer {token}`; 360dialog sends `D360-API-KEY: {token}`.
  4. Message endpoint: Meta Cloud = `graph.facebook.com/{version}/{phone_number_id}`; missing phone number id throws "Catalog has no
     phone_number_id, Meta Cloud requires it on the /messages path". 360dialog = `https://waba-v2.360dialog.io` (plain `/messages`).
  5. Catalog CRUD always goes to the Graph API (both providers) with the same token and the admin graph version (default v23.0). QUIRK: a
     360dialog API key is not a Graph token, so verify/sync/list on a 360dialog row very likely fails; the 360dialog path is effectively
     only usable for messaging (and nothing here sends via it without a verified catalog). The model's own `providerBaseUrl()` pins v22.0
     but nothing calls it (dead code).
  6. Error parsing: a failed response throws a typed exception with the Meta error message (fallback "HTTP {status}: {operation}"), the
     code (Meta code or HTTP status) and the whole error body as context; each failure is logged with operation, status and body.
  7. Interface: verify catalog, list catalogs (`{waba_id}/product_catalogs`, or `me/businesses` without a WABA id, limit 50), list
     products (WD-CAT-011), upsert products batch, check batch status, set commerce settings, send single product (SPM), send product list
     (MPM), send catalog message (dead code), send catalog link, and read the bound row. The list-catalogs method is not called anywhere.
  8. Message payloads: SPM and MPM and the catalog-message are interactive messages; the link is a text message with link preview on.
     Caps enforced here: body 1024, footer 60, header 60, section title 24, at most 10 sections and 30 products total (extras dropped,
     empty sections dropped).
  9. Baileys alternative (separate class): posts a JSON `{targetPhoneNumber, products[], type single|multi, header_text, body_text,
footer_text, section_title}` to the Node bridge `/api/send-product-catalog/{sender digits}`; header default "Our catalog", body default
     "Tap a product to learn more"; fails when no products or when the device has no phone number; link mode posts a text to
     `/api/send-message/{sender}`. Each product card carries retailer id, id, name, description, image, price (price_minor / 100), currency,
     category, effective availability and url. The bridge builds the carousel (title max 100, body price + out-of-stock note + description
     max 200, footer = given footer or the category, quick-reply "Order Now" button and, if a url exists, a "View Details" website
     button) or, when the sending number is on the official API and a catalog id is passed, native interactive product messages.
  10. Node bridge base url: admin setting `baileys_server_url`, else env `SERVER_URL`, default `http://localhost:8888`.
- **Async & events:** none; logs info for outbound batch and status calls.
- **External systems:** Meta Graph API, 360dialog, the Node bridge.
- **Settings:** `catalog_graph_api_version`, `baileys_server_url`, env `SERVER_URL`.
- **Acceptance criteria:**
  - Given a 360dialog row, When a message is sent, Then the request carries the D360-API-KEY header to the 360dialog host with no phone
    number id.
  - Given a Meta Cloud row without a phone number id, When a send is attempted, Then the "no phone_number_id" error is raised.
  - Given a product list with 12 sections of 5 products, When sent, Then at most 10 sections and 30 products total are sent.
  - Given Meta answers 400 with an error body, When any call fails, Then the thrown error carries Meta's message, code and body.
- **Source refs:** app/Services/WhatsAppCatalog/AbstractCloudCatalogProvider.php, MetaCloudCatalogProvider.php, Dialog360CatalogProvider.php,
  WhatsAppCatalogFactory.php, BaileysCatalogService.php, app/Contracts/WhatsAppCatalogProvider.php, app/Exceptions/WhatsAppCatalogException.php,
  app/Models/WaCatalog.php, node/routes/index.js, node/controllers/messageController.js.
- **Port notes:** build as a provider adapter behind a `CatalogPort` (skill `provider-adapter`); use the secret store for tokens; contract
  tests with recorded Meta responses; retry and timeout policy in the adapter. Decide whether to support 360dialog catalog operations at
  all (it needs a Graph token, which the form calls an "access token / API key").

## Data model

Postgres tables already exist in `packages/db/migrations/20261001105000_cat_wadesk_schema.sql` (Drizzle: `packages/db/src/schema/catalog-products/tables.ts`).
Every table has `org_id`, uuid, `row_version` and RLS. WaDesk's `workspace_id` becomes `org_id`; soft delete is replaced by hard delete.

### wa_catalogs

Purpose: the binding of a workspace to a Meta Commerce Catalog, one row per (org, provider). Read by WD-CAT-001..013, 015, 028, 029, 031.
Columns: `provider` (meta_cloud or dialog_360; unique with org), `catalog_id` (Meta id, max 64, indexed), `catalog_name`, `waba_id`,
`phone_number_id` (required for Meta Cloud sends and commerce settings), `access_token_enc` (encrypted token or API key, never serialised),
`is_cart_enabled` and `is_catalog_visible` (default true; mirror of Meta commerce settings), `last_synced_at` (never written in the
reference), `meta_json` (automation config: `order_ack_enabled`, `order_ack_pay_url`, `order_ack_template_id`, `concierge_enabled`,
`concierge_max`, `concierge_header`, `concierge_footer`, `concierge_reply_on_empty`, `concierge_empty_text`; possibly `business_id`,
`catalog_id`). Referenced by `keyword_replies.target_catalog_id` (SET NULL). Volume: 0 to 2 rows per org.

### wa_products

Purpose: the single product table of the workspace, shared by catalog, storefront, orders, flows, imports. Columns that affect behaviour:
`sku` (max 96, not unique), `name` (191), `slug` (unique per org, generated once), `description` (short, 2000), `body_html` (long HTML),
`price_minor`/`compare_price_minor` (major x 100), `currency_code` (3 chars, default INR), `image_url`, `gallery_json` (array of URLs, max
12 from the form), `in_stock` (boolean, default true), `stock_qty` (null = unlimited), `reserved_qty` (held by ordering, default 0),
`sort_order` (lower first), `status` (active, draft, archived), `weight_grams`, `category` (96), `tags_json` (array), `aliases_json`
(array of strings or {alias|name}), `availability` (enum in stock / out of stock / available for order / discontinued, NOT NULL default in
stock, see WD-CAT-033), `condition` (new, refurbished, used), `brand` (100 in MySQL, no length in Postgres), `product_url` (2048),
`google_product_category` (255), `meta_retailer_id` (Meta identity, 96), `meta_sync_status` (null = never synced, pending, synced, failed;
`error` is a phantom value read only by the health check), `meta_synced_at`, `meta_batch_handle` (191), `meta_last_error` (text, 500 chars
written), `storefront_id` (nullable FK, SET NULL; see WD-CAT-014 rule 2), `user_id` (creator, cascade), `shopify_product_id`,
`woo_product_id` (import identities, indexed). Indexes: storefront, user, shopify id, woo id, (org, category), (org, in_stock, sort_order),
(org, status), (org, meta_sync_status). Soft deletes in WaDesk (`deleted_at`, absent in Postgres). Written by WD-CAT-009..012, 020, 021, 025
and the external importers; read everywhere. Volume: hundreds to tens of thousands per org.

### wa_product_sets

Purpose: collections (WD-CAT-017/018). Columns: `name` (120), `slug` (unique per org), `description` (500), `product_ids` (jsonb ordered array of
product ids, max 30), `is_active` (default true, inert), `meta_set_id` (reserved), `user_id` (creator, SET NULL). No FK from members to
products (stale ids are filtered at read time).

### wa_product_reviews

Purpose: storefront reviews awaiting moderation (WD-CAT-027). Columns: `product_id` (FK cascade), `storefront_id` (SET NULL), `order_id`
(SET NULL, verified-purchase link never written), `customer_name` (120), `rating` (1..5, default 5, no CHECK in the migration), `body` (text,
1000 enforced at submit), `status` (pending, approved, rejected; no CHECK in the migration, default pending). Index on product.

### wa_stock_reservations

Purpose: the hold ledger (WD-CAT-025). Columns: `product_id` (FK cascade), `order_id` (SET NULL), `ref` (128, customer order key, indexed),
`qty`, `status` (held, committed, released; no CHECK in the migration), `expires_at` (indexed). High churn, small rows; prune old committed
or released rows (WaDesk never does).

### Settings and other storage touched

System settings (`catalog_*` keys in WD-CAT-030, `baileys_server_url`, `waba_graph_api_version`), `inbox_messages.meta` JSON for sends (keys
`kind`, `mode`, `provider`, `wa_message_id`, `catalog_payload` or `response`, `products[]`, and `source`/`product_id` for product shares),
`wa_provider_configs.meta_json.catalog_id` (written by autodetect), the media disk for product images.

## Cross-domain contracts

Consumes:

- `team-inbox-conversations` / chat: `ConversationResolver.findOrCreate` (one thread per number), the inbox message writer and dispatcher
  (WD-CAT-015, 023), and the conversation `reply` policy.
- `whatsapp-cloud-api-waba`: the connected WABA config (decrypted token, waba id, phone number id, business id, catalog id in meta_json)
  for autodetect; the primary provider config's phone number for `wa.me` links; the Meta webhook that captures cart orders and then
  calls the acknowledgement; the referred-product tagging of conversations.
- `whatsapp-devices-baileys` and `node-bridge-runtime`: connected devices; `/api/send-product-catalog/:phone` and `/api/send-message/:phone`;
  the heartbeat endpoint that triggers `sweepExpired`.
- `workspaces-teams-tenancy`: workspace role hierarchy and current workspace. `roles-permissions`: the role gate (port: permission keys).
- `plans-subscriptions-trials`: the plan flag `access_wa_storefront` and the monthly message limit. `wallet-message-billing`: overflow billing per
  catalog message.
- `contacts-attributes-tags`: contacts and groups for recipients (mobile and group membership are encrypted in WaDesk).
- `platform-settings-branding-storage`: system settings, brand name, media disk and URLs, audit log writer.
- Storefront domain: `public_url` of a storefront, storefront rows for the shop selector and links.
- `message-templates`: approved template used by the order acknowledgement (`order_ack_template_id`).

Exposes:

- `wa_products` is read and written by other domains; each must go through a products service in the port:
  - Storefront public pages: list and detail read active-or-not products with `in_stock = true` only (QUIRK: the storefront ignores
    `status`, so draft and archived in-stock products are publicly visible by slug in the reference; the docs say they are hidden),
    reviews list approved reviews, submit creates pending reviews.
  - Checkout / orders: `StorefrontCheckoutService` and `StorefrontCartService` read products (server price, stock cap) and decrement
    `stock_qty` under `withoutAutoSync`; `WaOrderItem` keeps `product_id` (SET NULL) and formats money through the shared formatter.
  - Meta webhook order handler resolves ordered retailer ids to products by `meta_retailer_id` or `sku` and tags a conversation's
    `interested_sku` / `interested_product_id` from a product referral.
  - Shopify and WooCommerce importers upsert by `shopify_product_id` / `woo_product_id` inside `CatalogSyncService::withoutAutoSync`; their
    stock webhooks and waitlists read `in_stock`, `sku`, `name`.
  - Google Sheets add-on API upserts products by SKU then by name (status active when `active`, else draft; stock optional) and the
    account page shows the 5 most recent.
  - Flows commerce (`flows/api/commerce/stores`, `.../stores/{storeId}/products`, and `api/commerce/check-inventory`, `checkout-link`,
    `waba-send-products`): list the workspace catalogs and products, check stock by retailer id or SKU, and send product messages from a flow.
    Owned by the flow domains; they use `meta_retailer_id` or `sku` as the retailer id, filter `in_stock`, and read `WaCatalog` for the
    catalog id and the cart flag.
  - Auto-reply keywords: a `send_catalog` reply type stores `target_catalog_id` (validated as a catalog of the workspace) and the
    keyword-reply API answers with the catalog handle and mode `mpm`.
  - Message templates: the catalog-template create page lists products for the thumbnail retailer id; the template linter warns when no
    catalog row has provider `waba` (QUIRK: catalog providers are meta_cloud or dialog_360, so the warning is always shown).
  - Natural-language ordering: `ProductMatcher`, `InventoryService` (WD-CAT-025, 032), `OrderingService` shows product lists.
  - Store wizard reset: force-deletes all products of the workspace when everything is cleared.
  - Admin settings health (`catalog_enabled`) and the admin catalog page connected count.
  - Store dashboard counters (`/store`, account page) count products.
- Service surface to build: `CatalogSyncService` (`pushOne`, `flushWorkspace`, `pollWorkspace`, `withoutAutoSync`), `InventoryService`,
  `ProductMatcher`, `CatalogConciergeService.handleInbound`, `CatalogOrderService.acknowledge`, `CatalogSenderPort`.
- Events to emit in the port (none exist in WaDesk): `catalog.connected`, `catalog.disconnected`, `product.created|updated|deleted`,
  `product.sync_status_changed`, `catalog.message_sent`, `review.created|moderated`.

## Open questions & quirks

- **GET /catalog returns 500 in the reference** (undefined `$engine` passed to the view). The Setup tab is the only place with sync,
  disconnect, commerce, automation and import controls, so a stock install cannot use them from the UI. Build the intended screen.
- **/store/products, create, edit and /store/reviews also return 500** whenever the workspace has no storefront (the shared sidebar
  dereferences the null storefront). Do not couple product pages to a storefront.
- **Product search leaks across workspaces by SKU** (ungrouped OR). Fix; RLS makes it impossible by construction.
- **Infinite sync loop above 1000 unsynced products** (pending rows re-selected while `has_more` counts only null and failed).
- **Status vocabulary mismatch:** the health check counts status `error`, which nothing writes; sync failures are `failed`.
- **catalog:resync is not scheduled** anywhere, yet comments and the checkout code assume a nightly sweep; products sit in `pending` until an
  admin clicks Refresh status. Pending rows with a null batch handle can never settle.
- **Availability derivation is dead for stored products** because the column is NOT NULL with a default; `in_stock`, stock 0 and status are
  ignored when pushing to Meta after the first auto-push.
- **Import from Meta fires the product observer** (no suppression): every created or changed product is immediately re-pushed and flips from
  synced to pending; also unsure how the enum column behaves for Meta availability strings outside the four allowed values or null.
- **A catalog row routes ALL sends through Meta**, ignoring the operator's chosen Baileys device; the carousel is only used when no catalog is
  linked. The Send tab also requires a Baileys-style device row even for WABA senders.
- **Catalog link mode** builds `wa.me/c/{digits}` from the catalog's phone-number id (or the recipient's number), neither of which is a valid
  catalog link target.
- **Send tab product visibility** depends on `storefront_id`, which no creator ever sets, so products added after a shop exists do not show
  in that picker.
- **sendToNumber returns HTTP 200 with ok:false** and no message when every recipient fails; the Collections panel shows "HTTP 200".
- **Failed re-connect destroys a working connection** (write, verify, delete). 360dialog catalog operations use a Graph call with a 360dialog
  key and likely fail.
- **Two Graph-version settings** (`catalog_graph_api_version` for catalog calls, `waba_graph_api_version` for autodetect). A blank admin value
  breaks catalog URLs.
- **Admin catalog page:** `catalog_enabled`, `catalog_commerce_enabled`, `catalog_default_currency` and the Meta app credentials do nothing; the
  products and sends tiles always show 0 (tables do not exist); the settings-health "needs test" flag can never clear.
- **Documentation vs code:** docs say Catalog is plan-gated for adding and editing products (product routes have no plan gate), say draft
  products are hidden (storefront shows any in-stock product), say the sweep exists (it is not scheduled), and describe the Graph version
  switch and menu hiding (inert).
- **Slug uniqueness with soft deletes:** recreating a name of a deleted product hits the database unique index (500). Not applicable in
  Postgres hard delete.
- **No aliases UI**, no `is_active` UI for collections, no UI for `concierge_footer` or `order_ack_template_id`.
- **Dead code:** the `catalog_message` sender, `listCatalogs`, `WaCatalog::providerBaseUrl()` (pinned v22.0), `WaProduct::scopeAvailable` is
  used but ignores status, `last_synced_at` and `meta_set_id` are never written, `wa_product_reviews.order_id` never set.
- **Concierge:** candidate set is cut before ranking, replies are not mirrored into the inbox and not billed, and almost any word counts as a
  product query.
- **Money rounding:** price conversion uses float multiplication and `round`; decimal strings such as 1.005 can differ from a decimal-exact
  implementation by one minor unit.
- Open: should Meta items be deleted when a product is deleted or archived? WaDesk never deletes; the catalog drifts.

## Coverage

```json wadesk-coverage
{
  "routes": [
    "GET catalog",
    "GET catalog/send",
    "GET catalog/collections",
    "GET catalog/activity",
    "POST catalog/connect",
    "POST catalog/autodetect",
    "POST catalog/disconnect",
    "POST catalog/sync-chunk",
    "POST catalog/import-from-meta",
    "POST catalog/poll",
    "POST catalog/commerce",
    "POST catalog/automation",
    "POST catalog/send-to-number",
    "POST catalog/sets",
    "PUT catalog/sets/{id}",
    "DELETE catalog/sets/{id}",
    "GET store/products",
    "POST store/products",
    "GET store/products/create",
    "GET store/products/{id}/edit",
    "PUT store/products/{id}",
    "DELETE store/products/{id}",
    "GET store/products/{id}/share-links",
    "POST store/products/{id}/send",
    "GET store/products/api/list",
    "GET store/reviews",
    "PUT store/reviews/{id}",
    "DELETE store/reviews/{id}",
    "GET admin/settings/catalog",
    "PATCH admin/settings/catalog"
  ],
  "controllers": [
    "app/Http/Controllers/CatalogController.php",
    "app/Http/Controllers/WaProductController.php",
    "app/Http/Controllers/WaReviewController.php"
  ],
  "services": [
    "app/Services/WhatsAppCatalog/AbstractCloudCatalogProvider.php",
    "app/Services/WhatsAppCatalog/BaileysCatalogService.php",
    "app/Services/WhatsAppCatalog/CatalogConciergeService.php",
    "app/Services/WhatsAppCatalog/CatalogOrderService.php",
    "app/Services/WhatsAppCatalog/CatalogSyncService.php",
    "app/Services/WhatsAppCatalog/Dialog360CatalogProvider.php",
    "app/Services/WhatsAppCatalog/MetaCloudCatalogProvider.php",
    "app/Services/WhatsAppCatalog/WhatsAppCatalogFactory.php",
    "app/Services/Ordering/InventoryService.php",
    "app/Services/Ordering/ProductMatcher.php"
  ],
  "models": ["WaCatalog", "WaProduct", "WaProductSet", "WaProductReview", "WaStockReservation"],
  "tables": [
    "wa_catalogs",
    "wa_products",
    "wa_product_reviews",
    "wa_product_sets",
    "wa_stock_reservations"
  ],
  "views": [
    "resources/views/admin/settings/catalog.blade.php",
    "resources/views/user/catalog/_activity.blade.php",
    "resources/views/user/catalog/_collections.blade.php",
    "resources/views/user/catalog/_connect-form.blade.php",
    "resources/views/user/catalog/_product-grid.blade.php",
    "resources/views/user/catalog/_product-picker.blade.php",
    "resources/views/user/catalog/_send.blade.php",
    "resources/views/user/catalog/_setup.blade.php",
    "resources/views/user/catalog/index.blade.php",
    "resources/views/user/store/products/_form.blade.php",
    "resources/views/user/store/products/create.blade.php",
    "resources/views/user/store/products/edit.blade.php",
    "resources/views/user/store/products/index.blade.php",
    "resources/views/user/store/reviews/index.blade.php"
  ],
  "commands": ["catalog:resync"],
  "permissions": [],
  "middleware": [],
  "node_files": ["node/controllers/messageController.js"],
  "js_assets": [
    "resources/js/charts/user-store-products-create.js",
    "resources/js/charts/user-store-products-edit.js",
    "resources/js/charts/user-store-products-form.js"
  ],
  "misc_files": [
    "app/Contracts/WhatsAppCatalogProvider.php",
    "app/Exceptions/WhatsAppCatalogException.php"
  ],
  "config_files": [],
  "doc_pages": ["Documentation/pages/commerce/catalog.html"],
  "feature_map": {
    "WD-CAT-002": ["POST catalog/connect"],
    "WD-CAT-003": ["POST catalog/autodetect"],
    "WD-CAT-004": ["POST catalog/disconnect"],
    "WD-CAT-005": ["POST catalog/commerce"],
    "WD-CAT-006": ["POST catalog/automation"],
    "WD-CAT-008": ["GET catalog"],
    "WD-CAT-009": ["POST catalog/sync-chunk"],
    "WD-CAT-010": ["POST catalog/poll"],
    "WD-CAT-011": ["POST catalog/import-from-meta"],
    "WD-CAT-014": ["GET catalog/send"],
    "WD-CAT-015": ["POST catalog/send-to-number"],
    "WD-CAT-016": ["GET catalog/activity"],
    "WD-CAT-017": ["POST catalog/sets", "PUT catalog/sets/{id}", "DELETE catalog/sets/{id}"],
    "WD-CAT-018": ["GET catalog/collections"],
    "WD-CAT-019": ["GET store/products"],
    "WD-CAT-020": [
      "GET store/products/create",
      "POST store/products",
      "GET store/products/{id}/edit",
      "PUT store/products/{id}"
    ],
    "WD-CAT-021": ["DELETE store/products/{id}"],
    "WD-CAT-022": ["GET store/products/{id}/share-links"],
    "WD-CAT-023": ["POST store/products/{id}/send"],
    "WD-CAT-024": ["GET store/products/api/list"],
    "WD-CAT-027": ["GET store/reviews", "PUT store/reviews/{id}", "DELETE store/reviews/{id}"],
    "WD-CAT-030": ["GET admin/settings/catalog", "PATCH admin/settings/catalog"]
  }
}
```
