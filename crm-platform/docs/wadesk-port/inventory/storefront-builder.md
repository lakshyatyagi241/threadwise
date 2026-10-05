---
domain: storefront-builder
code: STORE
title: Storefront builder and public shop
wadesk_version: '1.7.0'
sources_read: 52
---

# Storefront builder and public shop

## Overview

WaDesk lets a workspace run one or more **WhatsApp shops**. A shop (`wa_storefronts` row) has a name, a globally unique URL slug, one of eight
visual themes, a brand colour, hero and footer text, a currency, a shipping rule, an optional custom domain, a payment setting, abandoned-cart
settings, and a "sending number" (a connected WhatsApp device, or the workspace's official WABA/Twilio number when no device is bound). The
merchant side lives under `/store` (dashboard, storefront design page) and `/connect?platform=wa-store` (the shop wizard: list, create, edit,
delete, share). The buyer side is the public shop at `/s/{slug}` (or at the root of a verified custom domain / subdomain): a themed catalog with
search, filters, sort, a cart drawer, wishlist, compare, quick view, product pages with reviews, a server-side checkout that records a real
order **before** handing the buyer to WhatsApp, a coupon quote, an abandoned-cart beacon, a review form and a tokenised order-tracking page.

Actors: the **workspace admin/owner** (merchant; the `/store` pages are `workspace.role:admin`, the wizard is any signed-in member), the
**anonymous buyer** (no login, no CSRF, rate-limited JSON posts), the **Razorpay webhook** (HMAC-authenticated machine call) and the Node
scheduler (fires the abandoned-cart WhatsApp nudge).

Main flow: connect a WhatsApp number (channels domain, which silently creates a default shop) -> wizard (name, optional custom domain, sending
number) -> design page (theme, colours, currency, shipping, payment) -> add products in the catalog (CAT) -> share the link -> buyer browses,
adds to cart, checks out (order row `source=storefront`, status `new`, stock decremented, coupon redeemed, RTO score for COD) -> redirected to
`wa.me` with a pre-filled confirmation containing the tracking link -> merchant works the order in `/store/orders` (CHK) -> optional Razorpay
auto-payment-link and webhook flips the order to paid.

Plan tiers: there is **no plan gate on `/store`, the wizard or the public shop**. `access_wa_storefront` gates only the Catalog area (`/catalog`,
CAT) and the `storefronts_limit` package field exists in the admin package form but is **never enforced** anywhere. Sibling store pages are gated
individually (`auto_invoice` for invoices, `access_whatsapp_pay` for payments), see WD-STORE-023 and WD-STORE-024.

Connections: `checkout-orders-merchant-payments` (CHK) owns `wa_orders`, `wa_coupons`, `wa_merchant_gateways`, customers, orders screens, WhatsApp Pay, invoices
and `wa/checkout/*`; `catalog-products` (CAT) owns `wa_products`, `wa_product_reviews`, the Meta catalog sync and the share links; `whatsapp-devices-baileys` and
`whatsapp-cloud-api-waba` own the number the shop sends from (and create the default shop on connect); `workspaces-teams-tenancy` owns
`ResolveTenantDomain` and the workspace-level custom domain; `marketing-site-cms` owns the `GET /` route that delegates to this domain's host
resolver (WD-STORE-021); `scheduled-queue-warmer` owns the Node one-off scheduler used for cart recovery; `roles-permissions` owns the role gate;
`plans-subscriptions-trials` owns package flags.

A 14-item **Open questions & quirks** list at the end records behaviours that look like bugs but that the port must consciously keep or fix.

## Feature index

| Id           | Feature                                                            | Status      | Priority | Effort | Depends on         |
| ------------ | ------------------------------------------------------------------ | ----------- | -------- | ------ | ------------------ |
| WD-STORE-001 | Store dashboard overview (/store)                                  | implemented | P1       | M      | 024, 002           |
| WD-STORE-002 | Store sidebar and shop header                                      | implemented | P1       | M      | 003                |
| WD-STORE-003 | Multi-shop wizard: list, create, edit (/connect?platform=wa-store) | implemented | P0       | L      | 004, 022           |
| WD-STORE-004 | Wizard gating: a connected WhatsApp number is required             | implemented | P0       | S      | 003                |
| WD-STORE-005 | Shop delete and all-data reset                                     | implemented | P1       | S      | 003                |
| WD-STORE-006 | Storefront settings page (/store/storefront)                       | implemented | P0       | L      | 003, 011           |
| WD-STORE-007 | Custom domain and DNS CNAME verification                           | implemented | P1       | M      | 006, 021           |
| WD-STORE-008 | Razorpay API payment configuration                                 | implemented | P1       | S      | 006, 018           |
| WD-STORE-009 | Public storefront home (/s/{slug})                                 | implemented | P0       | L      | 011, 020, 021      |
| WD-STORE-010 | Public product page                                                | implemented | P0       | M      | 009                |
| WD-STORE-011 | The 8 themes and the shared theme context                          | implemented | P0       | XL     | 009, 010           |
| WD-STORE-012 | Cart and checkout form (browser behaviour)                         | implemented | P0       | L      | 009, 013           |
| WD-STORE-013 | Server-side checkout                                               | implemented | P0       | L      | 014, 019, 015      |
| WD-STORE-014 | Coupon quote endpoint                                              | implemented | P1       | S      | 013                |
| WD-STORE-015 | Abandoned-cart beacon and recovery scheduling                      | implemented | P1       | M      | 006, 013           |
| WD-STORE-016 | Review submission (pending moderation)                             | implemented | P1       | S      | 010                |
| WD-STORE-017 | Order tracking page                                                | implemented | P1       | S      | 013                |
| WD-STORE-018 | Payment-link minting and Razorpay webhook auto-confirm             | implemented | P1       | M      | 008, WD-CHK orders |
| WD-STORE-019 | RTO risk scoring                                                   | implemented | P2       | S      | 013                |
| WD-STORE-020 | Storefront daily view counter                                      | implemented | P2       | S      | 009                |
| WD-STORE-021 | Host-based storefront resolution and root-route behaviour          | implemented | P0       | M      | 007                |
| WD-STORE-022 | Public URL computation and sharing                                 | implemented | P0       | S      | 021                |
| WD-STORE-023 | Store sidebar entries for sibling domains                          | implemented | P1       | S      | 002                |
| WD-STORE-024 | Plan and role gates for the store area                             | implemented | P0       | S      | none               |
| WD-STORE-025 | Legacy "coming soon" store page                                    | dead-code   | P2       | S      | none               |
| WD-STORE-026 | Buyer wishlist, compare, quick view and share (browser only)       | implemented | P2       | M      | 011                |
| WD-STORE-027 | SEO and social metadata, JSON-LD                                   | implemented | P2       | S      | 009, 010           |
| WD-STORE-028 | Static payment handle (UPI, links, bank transfer)                  | partial     | P2       | S      | 006                |
| WD-STORE-029 | Default shop auto-created on channel connect                       | implemented | P0       | S      | 003                |
| WD-STORE-030 | Shop share modal (admin side)                                      | implemented | P2       | S      | 003                |
| WD-STORE-031 | Catalog search, filter, sort, view toggle and show-more (browser)  | implemented | P1       | M      | 009                |

## Features

### WD-STORE-001 — Store dashboard overview (/store)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-STORE-024, WD-STORE-002
- **Summary:** the landing page of the merchant store area: five 30-day KPI tiles, a revenue/orders chart, the five best-selling products and the
  eight most recent orders. Redirects to the shop wizard when the workspace owns no shop.
- **Actors & access:** workspace owner/admin (`workspace.role:admin`); platform admins bypass. Managers get a 403, agents/viewers are redirected to
  `/team-inbox` with a warning flash. No plan flag. Workspace-scoped (current workspace of the user).
- **UX & screens:** `resources/views/user/store/index.blade.php`, inside the store layout (sidebar, WD-STORE-002). Header "Store / Overview", title
  "Sales overview", subtitle "Last 30 days. Orders are merged from every channel — WABA, storefront, Twilio." and an "Add product" button
  (route `user.store.products.create`, CAT). KPI strip, five tiles: Revenue (30d), Orders (30d), Avg order, Products, Visits (30d). Money is
  formatted in the selected shop's currency, falling back to the system default currency (admin setting `default_currency`, default USD).
  Sales chart card "Sales trend / Revenue over time": ApexCharts combo, 30 daily columns for revenue plus a smooth line for order count, two
  y-axes (revenue left, orders right), height 260px, legend top-right, x labels rotated -35 degrees, at most 10 ticks, legend text
  "Revenue (<currency symbol>)". Colours are the brand deep green for revenue and the coral accent for orders. "Top products (30d) / Bestsellers"
  card: up to 5 rows of name and unit count with a horizontal bar whose width is the share of the leader (minimum 2 percent); empty copy "No sales
  yet — share your store link." "Recent orders" card with "View all" link to the orders list and a table: When (`M d, H:i`), Customer (name or
  a dash, phone underneath), Source (badge), Items ("N item(s)"), Total, Status badge, an "Open" link to the order. Empty: "No orders yet —
  Once customers order from your storefront or WhatsApp, they'll appear here."
- **Endpoints:**

| METHOD uri | route name       | Controller@action     | middleware                      | request                                         | response                                                       |
| ---------- | ---------------- | --------------------- | ------------------------------- | ----------------------------------------------- | -------------------------------------------------------------- |
| GET store  | user.store.index | StoreController@index | web, auth, workspace.role:admin | optional `shop` (shop id), `tab` (read, unused) | HTML page, or 302 to `/connect?platform=wa-store` when no shop |

- **Data:** reads `wa_storefronts` (workspace shops, most recently updated first), `wa_orders` (last 30 days: `total_minor`, `created_at`,
  `items_json`, plus the 8 newest), `wa_products` (count), `wa_storefront_views` (sum of `views` for the workspace's shops since the date 30 days ago),
  `wa_provider_configs` (primary, for the sidebar). No writes.
- **Rules & edge cases:**
  1. Shop selection: `?shop=ID` picks that shop if it belongs to the workspace, else (bad id) falls back to the most recently updated shop; with no param
     the most recently **updated** shop is used. No shop at all (and the user has a workspace) -> 302 to `/connect?platform=wa-store`.
  2. QUIRK: every number on the page is **workspace-wide**, not per shop. Orders of all sources and **all statuses (cancelled included)** count toward revenue,
     orders and AOV; `?shop` only changes the sidebar, the public URL, the currency and the link targets.
  3. Window: rolling "now minus 30 days" for revenue/orders/top products/recent; visits use the calendar date 30 days ago (inclusive).
  4. Revenue = sum of `total_minor`; Avg order = round(revenue / orders) or 0; Products = count of all workspace products (any status, soft-deleted excluded).
  5. Sales by day: 30 buckets, oldest 29 days ago to today, label `M d`; the day is the order's `created_at` calendar date in the app time zone. Revenue per
     bucket is **integer major units truncated** (total_minor / 100 cast to int), orders per bucket is a count.
  6. Top products group `items_json` lines by **product name text** (fallback "Unknown"), summing `qty` (default 1); sorted descending, top 5. Two products with the
     same name merge; a renamed product splits.
  7. If the user has no current workspace, the page still renders with zeros and empty lists but the sidebar then dereferences a null shop (see WD-STORE-002 quirk).
  8. The `tab` query parameter is read and passed to the view but nothing uses it.
- **Async & events:** none. The page is server rendered; the chart is the only JS (`resources/js/charts/user-store-index.js`).
- **External systems:** none (ApexCharts bundled).
- **Settings:** system setting `default_currency` (fallback when a shop has no currency); the shop's `currency_code`.
- **Acceptance criteria:**
  - Given an admin of a workspace with one shop and three orders in the last 30 days totalling 3,000.00 (minor 300000), When they open `/store`, Then Revenue shows
    3,000, Orders shows 3, Avg order shows 1,000 and the recent table lists the three newest orders.
  - Given a workspace with no shop, When an admin opens `/store`, Then they are redirected to `/connect?platform=wa-store`.
  - Given a manager (not admin), When they open `/store`, Then the response is 403; Given an agent, Then they are redirected to the team inbox.
  - Given orders whose item names repeat across orders, When the page renders, Then Bestsellers lists names ranked by total quantity, at most five, widest bar for the first.
  - Given storefront views of 5 and 7 on two days inside the window (two different shops of the workspace), When the page renders, Then Visits (30d) shows 12.
  - Given an order older than 30 days, When the page renders, Then it contributes to no tile, chart bucket or recent list entry.
- **Source refs:** app/Http/Controllers/StoreController.php (index, stats, salesByDay, topProducts, recentOrders), resources/views/user/store/index.blade.php,
  resources/js/charts/user-store-index.js, routes/web.php:938-940, app/Support/FormatSettings.php (formatIn, symbolFor), app/Http/Middleware/EnsureWorkspaceRole.php.
- **Port notes:** new API `GET /storefront-builder/overview?shopId=` in `apps/api/src/modules/storefront-builder/`; orders come from the CHK module (read model or query service,
  not a table copy). Decide whether to scope KPIs per shop (recommended: add `storefront_id` filter, keep workspace-wide as the default "all shops") and whether to exclude
  cancelled orders from revenue. Use SQL aggregation in the workspace time zone instead of loading every order. Page in `apps/web/src/app/(app)/(storefront-builder)/store/`.

### WD-STORE-002 — Store sidebar and shop header

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-STORE-003
- **Summary:** the left column shared by every `/store/*` page: a shop info card with a Live/Setup pill and the sending number, a shop switcher when the workspace has two or
  more shops, the public URL with Open/Copy, the section navigation with count badges, and a "provider live" footer.
- **Actors & access:** admin/owner (the pages that include it are all `workspace.role:admin`). It is a Blade partial included with `current`, `cfg` and `sf` variables, so it renders
  on the dashboard, storefront design page and every sibling page (orders, products, coupons ...).
- **UX & screens:** `resources/views/user/store/_sidebar.blade.php` (260px column, `data-keep-rail`).
  1. Info card: store icon, pill "Live" (green dot) when WhatsApp is reachable, else "Setup"; shop name (shop name, else the workspace name, else "Your store"); under it a connection label.
     Live means any of: the workspace's primary provider config is connected, the shop's bound device is still `connected`, or the current user's workspace has any connected device.
     Label priority: provider label (WABA/Twilio) when the primary config is connected; else "Unofficial API · <country code> <phone>" of the bound device; else "Device connected · /devices";
     else "Not connected".
  2. Shop switcher: shown only when the workspace has **more than one** shop. A select listing every shop (shop name or "Shop #id"), selecting navigates to `/store?shop=ID`;
     a link "Manage all shops ->" to the wizard list.
  3. Public URL box (when the shop's public URL resolves): the URL, an "Open" link (new tab) and a "Copy" button that copies to the clipboard and shows "Copied!" for 1.5 s.
  4. Navigation "Store": Overview, Orders, Products, Groups, Storefront, Coupons, Reviews, Payments, Checkout gateways, Customers, Invoices (see WD-STORE-023 for targets, badges and gates),
     then group "Settings" with "Connection" (-> `/connect?platform=wa-store`). Active item is the second URL segment (default overview).
  5. Footer "Provider live" panel (only when live): "Sending from <shop sending label>" else "Connected via <phone or label>" else "Sending from <device phone>" else
     "No device connected. Connect one, then bind it to this store from the connect wizard." (Connect-one button opens the connect-device sheet).
- **Endpoints:** none (partial). It links to routes owned by other features.
- **Data:** reads `wa_orders` count, `wa_products` count, `wa_groups` count, `wa_coupons` count, `wa_product_reviews` pending count, `workspace_payment_configs` count,
  `wa_merchant_gateways` active count (`storefront_id = 0`), `wa_customer_profiles` count, `devices` (connected), `wa_provider_configs` (primary). All scoped to the current workspace.
- **Rules & edge cases:**
  1. QUIRK (reference bug, must be handled): the info card reads the shop name straight off the shop object without a null guard. A page that includes the sidebar without
     a shop (for example `/store/products` or `/store/orders` in a workspace with no storefront row) crashes with a server error (500). `/store` and `/store/storefront` avoid this
     by redirecting to the wizard first; other pages do not. The port must render a "no shop yet" state or redirect to the wizard.
  2. The "Live" pill reflects WhatsApp connectivity, not whether the shop is enabled.
  3. The shop switcher only changes the `?shop` of the **dashboard** link; the other nav links carry no shop parameter, so the selection does not persist (see WD-STORE-006 quirk).
  4. Badge counts are workspace-wide, hidden when 0, formatted with thousands separators. Reviews counts only `pending`; Gateways counts only active workspace-default gateways.
  5. The sidebar issues about eight count queries on every store page load.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a workspace with two shops, When any store page renders, Then a switcher lists both and choosing the other navigates to `/store?shop=<id>`.
  - Given a workspace with one shop, When the page renders, Then no switcher is shown.
  - Given 3 pending reviews and 2 approved ones, When the sidebar renders, Then the Reviews badge shows 3.
  - Given no connected provider or device, When the sidebar renders, Then the pill reads "Setup" and the connection label "Not connected".
  - Given a workspace with no shop, When `/store/products` is requested, Then the port shows a no-shop state or redirects (it must not fail with a server error).
- **Source refs:** resources/views/user/store/_sidebar.blade.php, app/Models/WaStorefront.php (sending_label, public_url), app/Http/Controllers/StoreController.php (allShops, cfg).
- **Port notes:** a layout component in `apps/web/src/features/storefront-builder/` fed by one `GET /storefront-builder/sidebar` summary endpoint (shops, counts, connectivity). Counts come from CHK/CAT
  query services. Badge counts in one grouped query, cached briefly.

### WD-STORE-003 — Multi-shop wizard: list, create, edit (/connect?platform=wa-store)

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-STORE-004, WD-STORE-022
- **Summary:** the page where merchants see all their shops as cards, add a new shop or edit one. Three-step form: shop details (name, auto slug), public URL (built-in or custom domain),
  sending device. A workspace can own many shops.
- **Actors & access:** any authenticated member of the workspace (route group is `auth` only; **no admin check**, unlike `/store`). Workspace scoped. No plan gate (the package `storefronts_limit` is
  never enforced).
- **UX & screens:** `resources/views/user/connect/wa-store.blade.php` rendered by `UserPagesController@connect` when `?platform=wa-store` (any other platform value renders the generic connect index,
  owned by the channels domain). Header: back arrow (to `/integrations` in list mode, else to the list), breadcrumb "Connect / WhatsApp Store", title "Your shops" (list), "Edit <name>" (edit) or
  "Set up your store" (add), and a link "Manage all connections at /devices". Flash status and validation errors appear above the content.
  - **Mode selection:** `?shop=<id>` of an owned shop -> edit; else `?action=add` -> add; else no shops -> add; else list.
  - **List mode:** headline "<n> shop(s) in <workspace name>", sub copy "Each shop has its own public URL, theme, and sending device...", "Add shop" button. Grid of shop cards, newest first (id descending).
    Card: header strip filled with the shop's brand colour (default deep green) as a diagonal gradient, with a pill "Live" or "Disabled"; theme key plus " theme"; shop name (or "Untitled shop");
    public URL; two facts "Sending from" (device phone or official number, else "No device") and "Domain" (custom domain with a tick when verified or "· pending", else "Built-in URL");
    action row: Manage (-> `/store?shop=<id>`), Preview (public URL, new tab), Edit (-> `?shop=<id>`), Share (WD-STORE-030), Delete (WD-STORE-005). Last tile is a dashed "Add another shop"
    link (copy "Run a separate storefront with its own URL, theme, and WhatsApp number.").
  - **Add/Edit mode:** when adding while other shops exist, a "<- Back to shops · Creating shop #N" strip. Progress strip "1 Shop details -> 2 Public URL -> 3 Sending device". Form:
    1. _Shop name_ (required, max 191, placeholder suggests "<workspace> · Mumbai" when others exist; helper "Shown on the storefront header and on order confirmations") and a read-only _Storefront
       slug (auto)_ preview showing the host prefix (`https://` in subdomain mode, `/s/` otherwise) and the slug computed live in the browser from the name (lowercase, accents stripped, non
       alphanumerics removed, spaces to hyphens, runs of hyphens collapsed, cut at 64, fallback "your-shop"). In edit mode the slug is frozen ("Locked once the store is live so shared links keep working").
    2. _Public URL_: a "Built-in URL · free" card with the live preview of the final URL and an explanation (subdomain hosted at STOREFRONT_HOST, or "path-based URL because no public storefront host is
       configured"); _Custom domain (optional)_ input (max 191, placeholder `shop.yourbiz.com`, helper explaining the CNAME is added later and verified from the storefront settings page); in edit mode a
       status line "<domain> is verified" or "pending DNS verification".
    3. _Sending device_: radio list. First, when the workspace has a connected official provider config, an "Official API (Meta/WABA)" radio with value empty (stores `device_id = NULL`), preselected when the shop
       has no bound device and no Baileys device exists; then one radio per connected device of the workspace (device name or "Device #id", "<country code> <phone>", a status pill), preselected = the shop's
       device else the first connected device. Empty state: "No connected devices on this account. Pair one at /devices".
       Footer: Cancel (to the list, or to `/dashboard` when the workspace has no shop), "Delete this shop" (edit mode only, opens the confirm modal) and the submit button ("Create shop ->" or "Save changes").
       In edit mode a "This shop is live" panel under the form with View shop, Share shop and Open dashboard links.
  - Visual language: paper/ink design tokens of the app shell (serif display titles with an italic accent word, mono caps labels).
- **Endpoints:**

| METHOD uri                 | route name                 | Controller@action            | middleware | request fields                                                                            | response                                                            |
| -------------------------- | -------------------------- | ---------------------------- | ---------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| GET connect                | user.connect               | UserPagesController@connect  | web, auth  | `platform=wa-store` (this feature), `action=add`, `shop=<id>`                             | HTML (wizard view) else generic connect index (channels domain)     |
| POST connect/wa-store/save | user.connect.wa-store.save | WaStoreWizardController@save | web, auth  | `shop_id?` int, `shop_name` req max 191, `custom_domain?` max 191 regex, `device_id?` int | 302 to `/connect?platform=wa-store` with flash, or back with errors |

- **Data:** `wa_storefronts` (insert/update: `workspace_id`, `shop_name`, `slug`, `device_id`, `custom_domain`, `custom_domain_verified`, `theme_key`, `enabled`); reads `devices` (connected, workspace), `wa_provider_configs`
  (primary), `workspaces`. Cards are ordered by id descending.
- **Rules & edge cases:**
  1. Validation: `shop_name` required string max 191; `custom_domain` nullable string max 191 matching lowercase letters, digits, dots and hyphens followed by a dot and 2+ lowercase letters (no scheme, no path, no
     uppercase) with message "That doesn't look like a valid domain (e.g. shop.yourbiz.com)."; `device_id` nullable integer that must exist in `devices`; `shop_id` nullable integer.
  2. `shop_id` present: must belong to the current workspace, else back with error "Shop not found in this workspace." plus old input. Absent: create.
  3. **Slug** on create: base = slugified shop name, or `shop` if empty after slugging; if taken by **any** shop of **any** workspace, append `-2`, `-3` ... until free. On edit the slug is **never** rotated, even if the
     name changes (protects shared links). QUIRK: the server does not truncate to 64 characters; the column is 64 wide, so a long name (up to 191 chars) fails in the database (server error). The browser preview truncates
     at 64. The port must truncate before adding the suffix.
  4. `device_id` when non-empty must be a `connected` device of the current workspace, else back with "Pick one of your connected devices." An empty value (official API choice) stores NULL; nothing checks that an
     official config actually exists.
  5. Custom domain: when it differs from the stored value (including becoming empty) it is stored and `custom_domain_verified` is reset to false. QUIRK: there is no uniqueness validation; the column is unique, so a
     domain already used by another shop fails with a database error (500). The port should return a field error.
  6. `theme_key` defaults to `aurora` when empty. QUIRK: every wizard save sets `enabled = true`, so editing a shop that was disabled on the design page silently re-enables it.
  7. No workspace on the user -> back with `shop_name` error "No active workspace.".
  8. Success flash: `Shop "<name>" created.` or `Shop "<name>" updated.`; always redirects to the list (never to the dashboard).
  9. The listing shows each shop's public URL via WD-STORE-022 and the sending label (bound device phone, else the workspace's first connected WABA/Twilio number, else "No device").
  10. Plan limit: none enforced; any member can create unlimited shops.
- **Async & events:** none. (No audit-log entry is written.)
- **External systems:** none.
- **Settings:** `STOREFRONT_HOST` (subdomain parent host; default = APP_URL host) decides whether the preview says `https://<slug>.<host>` or `<origin>/s/<slug>`; see WD-STORE-022.
- **Acceptance criteria:**
  - Given a workspace with no shop and a connected device, When the user submits shop name "Media City Threads", Then a shop is created with slug `media-city-threads`, theme `aurora`, enabled, the chosen device, and the
    user lands on the list with the flash `Shop "Media City Threads" created.`.
  - Given a shop with slug `media-city-threads` exists (any workspace), When another shop named "Media City Threads" is created, Then its slug is `media-city-threads-2`.
  - Given an existing shop, When its name is edited to "Brand New Name", Then the slug is unchanged.
  - Given a custom domain "Shop.Example.com" (uppercase) or "https://shop.example.com", When submitted, Then validation fails with the domain message.
  - Given a `device_id` of a device that belongs to another workspace or is not connected, When submitted, Then the error "Pick one of your connected devices." is shown and nothing is saved.
  - Given `?shop=<id of another workspace's shop>`, When the page loads, Then it falls back to list (or add) mode and shows nothing of that shop.
  - Given three shops, When the list loads, Then cards show newest first, each with Live/Disabled, theme, public URL, sending number and domain state.
- **Source refs:** app/Http/Controllers/UserPagesController.php:952-1026 (connect), app/Http/Controllers/WaStoreWizardController.php (save), resources/views/user/connect/wa-store.blade.php,
  resources/js/charts/user-connect-wa-store.js (wireWizard), app/Models/WaStorefront.php, database/migrations/2026_05_13_020000_allow_multi_shop_per_workspace.php, routes/web.php:925-929.
- **Port notes:** table `wa_storefronts` already exists (migration 20261001101700_store_wadesk_schema.sql: global unique `slug` and `custom_domain`, device FK SET NULL). Module `apps/api/src/modules/storefront-builder/shops`;
  endpoints `GET/POST/PATCH/DELETE /storefront-builder/shops`. Tenant uniqueness for slug is global (not per org): the unique index is not RLS-scoped, so the slug-availability check must run as a privileged
  lookup. Decide on enforcing `storefronts_limit` from the plan (WaDesk does not). Require an admin permission instead of "any member" (see WD-STORE-024). The `device_id` FK needs the devices domain.

### WD-STORE-004 — Wizard gating: a connected WhatsApp number is required

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-STORE-003
- **Summary:** a shop needs a number to confirm orders from. When the workspace has neither a connected WhatsApp device nor a connected primary provider config, the wizard is replaced by a "Connect WhatsApp
  first" card. Without any shop, `/store` and `/store/storefront` send the user to that wizard.
- **Actors & access:** same as WD-STORE-003 (any member for the wizard; admins for the redirecting pages).
- **UX & screens:** in `wa-store.blade.php`: a centred card, label "Step 1 of 3", title "Connect WhatsApp first", body "Your store needs a connected WhatsApp number to send order confirmations and let customers chat.
  Head to /devices to pair one — it takes 30 seconds.", and a "Go to devices" button to `/devices`. Verified live: the reference admin account (no device, no shop) opening `/store`, `/store/storefront` or the wizard
  URL lands on exactly this card with the header title "Set up your store".
- **Endpoints:** none of its own (behaviour of GET store, GET store/storefront and GET connect).
- **Data:** reads `devices` (status `connected`, current workspace), `wa_provider_configs` primary (status connected), `wa_storefronts` count.
- **Rules & edge cases:**
  1. The gate is **view-only**: it applies in list, add and edit modes (any state with zero connected devices and no connected primary config). The save and reset endpoints do **not** re-check it, so a crafted POST can
     create a shop without any number.
  2. "Connected provider" means the workspace's **primary** provider config has status connected; a connected non-primary config does not lift the gate.
  3. `/store` and `/store/storefront` (GET) redirect (302) to `/connect?platform=wa-store` when the workspace has no shop and the user has a workspace; with no shop but a connected number the wizard shows add mode.
  4. In practice a workspace that connected any number already has a default shop (WD-STORE-029), so the wizard shows the list, not add mode, right after connecting.
  5. A user without a current workspace is not redirected on `/store` (stats are zero and the sidebar breaks, see WD-STORE-002).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given no connected device and no connected provider, When the wizard URL loads in any mode, Then the "Connect WhatsApp first" card shows and the form does not.
  - Given a workspace with no shop, When an admin opens `/store` or `/store/storefront`, Then they are redirected to `/connect?platform=wa-store`.
  - Given a connected device and no shop, When the wizard loads, Then add mode shows with the device preselected.
  - Given no connected number, When a shop-save request is posted directly, Then (WaDesk) it succeeds; the port should reject it with a 422.
- **Source refs:** resources/views/user/connect/wa-store.blade.php (top of main), app/Http/Controllers/StoreController.php:30-41, app/Http/Controllers/WaStorefrontController.php:15-27, UserPagesController.php:957-973.
- **Port notes:** put the check in the wizard API (return `connectionState`) and make the save endpoint enforce it unless an admin flag says otherwise (decision for the team; WaDesk only hides the form).

### WD-STORE-005 — Shop delete and all-data reset

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-STORE-003
- **Summary:** delete one shop with its orders from a confirmation modal, or (API-only path) wipe every order, product and shop of the workspace.
- **Actors & access:** any authenticated member (route has no role check; QUIRK: an agent can delete a shop and all its orders). Workspace scoped.
- **UX & screens:** a "Destructive" modal shared by list and edit modes: title "Delete <shop name>?", body "Permanently deletes the storefront and its orders. Products in your workspace are not affected. There's no undo.",
  buttons Cancel and "Yes, delete". The list card's trash button and the edit form's "Delete this shop" open it and fill the hidden `shop_id`. The form posts a hidden `confirm=yes`.
- **Endpoints:**

| METHOD uri                  | route name                  | Controller@action             | middleware | request fields                          | response                                          |
| --------------------------- | --------------------------- | ----------------------------- | ---------- | --------------------------------------- | ------------------------------------------------- |
| POST connect/wa-store/reset | user.connect.wa-store.reset | WaStoreWizardController@reset | web, auth  | `confirm` must be `yes`; `shop_id?` int | 302 to the list with flash; or back with an error |

- **Data:** single shop: deletes `wa_orders` where `storefront_id` = the shop (hard delete), then the `wa_storefronts` row, in one transaction. All-data: hard-deletes all workspace `wa_orders`, **force**-deletes all
  workspace `wa_products` (they are soft-delete models; this bypasses it), deletes all `wa_storefronts` of the workspace.
- **Rules & edge cases:**
  1. Missing or non-`yes` `confirm` -> back with error "Reset not confirmed." and nothing deleted.
  2. With `shop_id`: the shop must belong to the workspace; if it does not, nothing is deleted but the flash still says "Shop deleted." (silent no-op).
  3. Without `shop_id` (not reachable from the UI; the modal always fills the id): the whole workspace store data is cleared, flash "All store data cleared for this workspace.".
  4. Products are kept when a single shop is deleted. Reviews, views, cart recovery rows, coupons scoped to the shop are not deleted by this code (the MySQL schema has no cascading FKs for views,
     recoveries and reviews, so they are orphaned; coupons keep pointing at the gone shop id). In the Postgres draft, views and recoveries cascade and coupons go to NULL.
  5. Orders are hard-deleted with no soft-delete, invoices/payments referencing them are not touched by this code.
  6. No workspace -> back with no message.
- **Async & events:** none (no audit entry).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a shop with 4 orders, When delete is confirmed for that shop, Then the shop and those 4 orders are gone, products remain and the list shows "Shop deleted.".
  - Given a request without `confirm=yes`, When posted, Then nothing is deleted and the error "Reset not confirmed." is shown.
  - Given a `shop_id` from another workspace, When posted with confirm, Then nothing is deleted.
  - Given an agent role member, When they post a delete, Then (WaDesk) it succeeds; the port must require admin.
  - Given the reset is posted without `shop_id`, When confirmed, Then orders, products (permanently) and all shops of the workspace are removed.
- **Source refs:** app/Http/Controllers/WaStoreWizardController.php (reset), resources/views/user/connect/wa-store.blade.php (reset-modal), resources/js/charts/user-connect-wa-store.js (wireResetModal).
- **Port notes:** make delete a real DELETE with admin permission and an audit-log row; decide whether to keep orders (re-parent to NULL `storefront_id`) instead of hard-deleting financial records; drop the all-data path or
  make it a separate dangerous admin action. Cascade the child tables (views, recoveries) per the Postgres draft.

### WD-STORE-006 — Storefront settings page (/store/storefront)

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-STORE-003, WD-STORE-011
- **Summary:** one long form to design and configure the shop: theme picker, slug, custom domain, logo, brand colour, hero and footer text, currency, shipping, payment, abandoned-cart recovery and the live toggle.
- **Actors & access:** workspace admin/owner (`workspace.role:admin`). No plan gate.
- **UX & screens:** `resources/views/user/store/storefront/edit.blade.php` inside the store layout. Title "Storefront design", a "View live ->" link to the public URL, a flash "Storefront updated." and a validation error list.
  Sections in order:
  1. **Theme**: eight radio tiles with a gradient swatch and the theme key (aurora `#FBFAF6->#E5DFD0`, meridian `#0B1F1C->#3A5A55`, verdure `#D5E8C6->#8AAB7B`, bazaar `#F4A261->#E76F51`, noir `#0a0a0a->#262626`,
     kraft `#D4B896->#A6845A`, mercato `#C8553D->#F4D35E`, studio `#264653->#2A9D8F`) and the label (e.g. "Aurora — minimal").
  2. **Slug** (required, pattern `[a-z0-9-]+`, max 64; helper "Your store will be at <slug>.<STOREFRONT_HOST>") and **Custom domain** (see WD-STORE-007).
  3. **Brand**: Logo URL (url, max 1024), Brand colour (colour picker plus a hex text box that mirrors into the picker; **only the picker is submitted**), Hero text (max 280, placeholder "Welcome to our store"),
     Footer text (max 280).
  4. **Currency** select of 21 currencies (INR, USD, EUR, GBP, AED, KES, NGN, ZAR, BRL, MXN, CRC, PHP, IDR, SGD, MYR, THB, VND, EGP, PKR, BDT, LKR) shown as "symbol CODE · name"; helper "Default for new products + the
     symbol shown in the cart drawer."
  5. **Shipping**: Flat shipping fee (number >= 0 step 0.01; "Added to every order. Blank or 0 = free."), Free shipping above ("Carts over this amount ship free."), Shipping note (max 160, placeholder "2-5 business days · Tracked",
     "Shown in the cart and on the product page.").
  6. **Payment link**: Provider select ("None · cash on delivery", UPI, Razorpay Payment Link (paste static link), Razorpay (auto-generate links + auto-confirm), Stripe Payment Link, PayPal.me handle, Bank transfer instructions),
     Payment detail text (max 255), and the Razorpay API block (WD-STORE-008).
  7. **Abandoned-cart recovery** (WD-STORE-015): checkbox "Send a WhatsApp nudge to customers who start checkout but don't finish", Delay (minutes, 5-1440, default 30), Message (max 1024; placeholders `{name} {shop} {url} {total}`).
  8. Footer row: checkbox "Storefront live (unchecking takes it offline)" and Save.
- **Endpoints:**

| METHOD uri           | route name                   | Controller@action             | middleware                      | request fields                                                                                                                                       | response                                                        |
| -------------------- | ---------------------------- | ----------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| GET store/storefront | user.store.storefront.edit   | WaStorefrontController@edit   | web, auth, workspace.role:admin | none                                                                                                                                                 | HTML, or 302 to the wizard when the workspace has no shop       |
| PUT store/storefront | user.store.storefront.update | WaStorefrontController@update | same                            | slug, theme_key, enabled, custom_domain, logo_url, brand_color, hero_text, footer_text, cart_recovery__, currency_code, shipping__, payment__, rzp__ | 302 back to the page with flash "Storefront updated." or errors |

- **Data:** `wa_storefronts`: `slug`, `theme_key`, `enabled`, `custom_domain`, `custom_domain_verified`, `currency_code`, `shipping_json` (`{flat_minor, free_above_minor, note}`, null when empty),
  `payment_provider`, `payment_config_json` (`{handle}` or `{key_id, key_secret(enc), webhook_secret(enc)}`), `settings_json` (`{logo_url, brand_color, hero_text, footer_text, cart_recovery_enabled,
cart_recovery_delay_min, cart_recovery_message}`).
- **Rules & edge cases:**
  1. Validation: `slug` required string max 64 matching lowercase letters, digits, hyphen, unique among shops ignoring this one (global); `theme_key` required and one of the 8 keys; `enabled` boolean when present;
     `custom_domain` as in WD-STORE-003 (no uniqueness check, see quirk); `logo_url` url max 1024; `brand_color` exactly `#` plus 6 hex digits; `hero_text`/`footer_text` max 280; `cart_recovery_enabled` boolean; delay integer 5..1440;
     message max 1024; `currency_code` size 3 and in the 21-code whitelist; `shipping_flat`/`shipping_free_above` numeric 0..1,000,000; `shipping_note` max 160; `payment_provider` in {upi, razorpay_link, razorpay_api,
     stripe_link, paypal_me, bank_transfer} (empty allowed = none); `payment_handle` max 255; `rzp_*` strings max 191.
  2. Saved slug is passed through the slug helper again (case/dup hyphens normalised).
  3. `enabled` absent -> true (the form always sends the hidden 0 or the checkbox 1).
  4. Currency absent -> keep the stored currency (default INR). Changing currency does not convert prices.
  5. Shipping: amounts are converted to minor units by multiplying by 100 and rounding; a blank or zero amount is dropped; note kept if non-empty; if all three are empty `shipping_json` is NULL ("no shipping").
  6. Payment: provider `razorpay_api` -> see WD-STORE-008; any other value -> `payment_config_json` becomes `{handle}` when a handle was typed, else NULL. QUIRK: switching away from Razorpay API **discards the stored API keys**.
  7. `settings_json` is **rebuilt** from only the listed keys: blank logo/colour/hero/footer are removed, recovery keys are always written (enabled false by default, delay 30 by default, message null when blank). QUIRK: any other
     key stored in `settings_json` (the themes read `top_strip` and `hero_sub`, but no screen writes them) is erased on every save.
  8. Domain changed (compared with null for blank) -> `custom_domain_verified = false`.
  9. QUIRK (multi-shop): the page loads and the PUT updates **the first shop of the workspace** (`first()` without ordering, effectively the oldest), not the shop selected in the sidebar switcher; the Storefront nav link carries no shop id. A
     workspace with two shops can only design its oldest shop here. `update` also **creates** a default shop if none exists (unreachable via the UI because `edit` redirects first).
  10. The brand-colour hex text box has no field name, so typing in it never changes what is saved unless the picker is used.
  11. The helper under the slug uses `STOREFRONT_HOST` even when that host is not usable (local dev), so it can show a host that does not resolve.
  12. Hero/footer text are stored verbatim; see WD-STORE-011 for how they are rendered (hero is rendered as raw HTML).
- **Async & events:** none (no audit entry, no catalog re-sync; the Meta catalog uses the shop URL at push time only).
- **External systems:** none on save.
- **Settings:** `STOREFRONT_HOST`, `STOREFRONT_CNAME_TARGET` (shown to the user in the CNAME helper).
- **Acceptance criteria:**
  - Given a shop, When slug "my-shop" is saved and another shop already owns it, Then validation fails with a uniqueness error and nothing changes.
  - Given brand colour "#12ab9F", When saved, Then the shop pages use it; Given "red" or "#12ab9", Then it is rejected.
  - Given flat shipping 49.50 and free-above 999, When saved, Then `shipping_json` holds flat 4950, free-above 99900 and checkout charges 4950 below 99900 subtotal and 0 at or above.
  - Given all shipping inputs blank, When saved, Then shipping is cleared and checkout charges 0.
  - Given currency "JPY" (not in the list), When saved, Then validation fails.
  - Given the "Storefront live" box unchecked, When saved, Then `/s/<slug>` returns 404.
  - Given a changed custom domain, When saved, Then the domain is stored and shown as unverified.
  - Given hero text longer than 280 characters, When saved, Then validation fails.
  - Given a non-admin member, When they request the page, Then access is denied per WD-STORE-024.
- **Source refs:** app/Http/Controllers/WaStorefrontController.php (edit, update), resources/views/user/store/storefront/edit.blade.php, app/Models/WaStorefront.php (THEMES, DEFAULT_THEME, shippingFee),
  routes/web.php:954-957, database/migrations/2026_05_13_030000_add_shipping_payment_to_wa_storefronts.php.
- **Port notes:** `PATCH /storefront-builder/shops/:id/settings` with a Zod contract in `packages/contracts/src/storefront-builder/`; make it shop-scoped (fix quirk 9) and merge into `settings_json` instead of
  rebuilding it (fix quirk 7). Keep the 21-currency whitelist as a shared enum. Theme list as a shared enum used by the public renderer too. Store money as minor units in jsonb exactly as WaDesk (`flat_minor`,
  `free_above_minor`).

### WD-STORE-007 — Custom domain and DNS CNAME verification

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-STORE-006, WD-STORE-021
- **Summary:** a merchant types a domain for their shop, adds a CNAME at their DNS provider and presses "Verify now"; the server looks the CNAME up and marks the domain verified. Verified domains serve the shop at their root.
- **Actors & access:** workspace admin/owner. The same check exists for the workspace-level domain from the admin console (`Admin/WorkspacesController@verifyDomain`, domain `workspaces-teams-tenancy`).
- **UX & screens:** in the design page next to the Custom domain field: when a domain is set and unverified a warning "Add this CNAME at your DNS provider:" and a line "CNAME <first label> -> <cname target>", a "Verify now" button and
  an inline result span; when verified "Verified — your domain is live". The button POSTs and shows the message (green on success, red otherwise); on success the page reloads after 0.8 s.
- **Endpoints:**

| METHOD uri                          | route name                   | Controller@action                   | middleware                      | request fields           | response                                                                                              |
| ----------------------------------- | ---------------------------- | ----------------------------------- | ------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------- |
| POST store/storefront/verify-domain | user.store.storefront.verify | WaStorefrontController@verifyDomain | web, auth, workspace.role:admin | none (CSRF token header) | JSON `{ok, expected, records, message}`; 422 `{ok:false, message:"No custom domain set."}` when blank |

- **Data:** reads and writes `wa_storefronts.custom_domain_verified` of the workspace's **first** shop (same `first()` quirk as WD-STORE-006).
- **Rules & edge cases:**
  1. Expected CNAME target = `STOREFRONT_CNAME_TARGET` (default: the host of `APP_URL`, else `localhost`).
  2. The check does a live CNAME lookup (errors suppressed -> empty list) and matches when **any** returned record's target **contains** the expected host as a case-insensitive substring (so `evil-app.example.com.attacker.net`
     containing `app.example.com` would pass). Only CNAME records are consulted (an A record or ALIAS/ANAME flattening never verifies).
  3. The result (true or false) is written every time, so a verified domain whose DNS later changes becomes unverified on the next "Verify now" click. There is no scheduled re-check.
  4. Messages: success "Domain verified ✓" (with a tick), failure "CNAME not pointing to <expected>"; the JSON also returns the raw `records` list.
  5. No `firstOrFail` guard beyond a shop existing: no shop -> 404.
  6. No TLS issuance is done here; the platform's edge must already terminate TLS for arbitrary customer domains (infrastructure concern, not in WaDesk code).
- **Async & events:** none.
- **External systems:** DNS resolver (PHP `dns_get_record` for CNAME).
- **Settings:** `STOREFRONT_CNAME_TARGET` (env, config/storefront.php).
- **Acceptance criteria:**
  - Given a shop with domain `shop.acme.com` and a CNAME to the platform host, When Verify is pressed, Then `{ok:true}` is returned, the shop is marked verified and the page reloads showing "Verified".
  - Given no CNAME or a CNAME elsewhere, When Verify is pressed, Then `{ok:false, message:"CNAME not pointing to <expected>"}` and the flag stays/becomes false.
  - Given no custom domain set, When Verify is pressed, Then the response is 422 "No custom domain set.".
  - Given a verified domain and the root URL of that domain is opened, Then the shop is served (WD-STORE-021).
- **Source refs:** app/Http/Controllers/WaStorefrontController.php (verifyDomain), config/storefront.php, resources/views/user/store/storefront/edit.blade.php (verifyDomain script), app/Http/Controllers/Admin/WorkspacesController.php:466-505.
- **Port notes:** put the DNS lookup behind a port (`DnsResolverPort`) so tests inject records; compare the CNAME target exactly (normalised, trailing dot trimmed) rather than by substring; make it a worker/async job if the resolver can be slow. Verified flag
  stays on `wa_storefronts`. Add rate limiting; consider a periodic re-verification job (recommended, not in WaDesk).

### WD-STORE-008 — Razorpay API payment configuration

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-STORE-006, WD-STORE-018
- **Summary:** when the shop's payment provider is "Razorpay (auto-generate links + auto-confirm)" the merchant enters their own Razorpay Key ID, Key secret and Webhook secret. Secrets are encrypted at rest and never shown back; leaving a secret blank keeps the stored one.
- **Actors & access:** workspace admin/owner.
- **UX & screens:** a "Razorpay API (auto links)" block in the Payment section of the design page: Key ID (plain text, shown back, placeholder "rzp_live_… / rzp_test_…"), Key secret and Webhook secret (password inputs, `autocomplete=new-password`,
  placeholder "saved — leave blank to keep" when a value is stored). Help text: in the Razorpay dashboard set the webhook URL to `<app url>/webhooks/storefront-pay` for the `payment_link.paid` event.
- **Endpoints:** part of PUT store/storefront (WD-STORE-006); webhook in WD-STORE-018.
- **Data:** `wa_storefronts.payment_provider = 'razorpay_api'`, `payment_config_json = {key_id, key_secret, webhook_secret}`; the two secrets are stored as the framework's encrypted-string format (symmetric, app key); `key_id` plain.
- **Rules & edge cases:**
  1. Only applied when `payment_provider` is exactly `razorpay_api`. Each value is kept when the new input is blank: a typed Key ID replaces; blank keeps the old; a typed secret is encrypted and replaces; blank keeps the encrypted old. Empty/null results are dropped from the stored JSON.
  2. There is no way to **clear** a key via the form (blank means keep). Switching provider to anything else wipes the config (WD-STORE-006 rule 6).
  3. No validation that the keys work (no test call). Link minting is available only if provider is `razorpay_api` **and** key id and key secret are both non-empty (`supportsLinks`).
  4. Decrypting tolerates a legacy plaintext secret (a value that fails decryption is used as-is).
  5. The raw secrets are never rendered back to the browser; the Key ID is.
  6. The key secret is a master-level credential for the merchant's Razorpay account.
- **Async & events:** none.
- **External systems:** Razorpay (see WD-STORE-018). Credentials location: per-shop, in `payment_config_json`.
- **Settings:** the application encryption key (Laravel `APP_KEY`) protects the secrets; losing it makes them unreadable (decrypt falls back to the ciphertext string, which then fails at Razorpay).
- **Acceptance criteria:**
  - Given provider Razorpay API and values entered for all three fields, When saved, Then the secrets are stored encrypted (not equal to the typed text) and the Key ID plain.
  - Given secrets already stored, When the form is saved with blank secret fields and the same provider, Then the stored encrypted secrets are unchanged.
  - Given stored keys, When the page re-renders, Then the secret inputs are empty with the "saved — leave blank to keep" placeholder and the Key ID is prefilled.
  - Given the provider is changed to UPI, When saved, Then the Razorpay keys are discarded.
- **Source refs:** app/Http/Controllers/WaStorefrontController.php:70-92, app/Services/Storefront/StorefrontPaymentService.php (encryptSecret, config, supportsLinks), resources/views/user/store/storefront/edit.blade.php (Razorpay block).
- **Port notes:** encrypt with the repo's secret-encryption service (envelope/KMS per platform conventions), store ciphertext in `payment_config_json`; never return secrets from the API (return `hasKeySecret`/`hasWebhookSecret` booleans). Add an explicit "clear keys" action and a "test connection" call (improvements).

### WD-STORE-009 — Public storefront home (/s/{slug})

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-STORE-011, WD-STORE-020, WD-STORE-021
- **Summary:** the buyer-facing catalog page of a shop: themed hero, toolbar, filter sidebar, a grid of up to 48 product cards, and a "Show more" button that appends the next 48 without reloading.
- **Actors & access:** anyone (anonymous), no CSRF/session needed. Shops that are disabled or unknown return a 404 page. Not cached (renders per request, increments the view counter).
- **UX & screens:** theme view `storefront.themes.<theme_key>.index` (WD-STORE-011) including `storefront/_partials/index.blade.php` and `_partials/card.blade.php`. Page order: top strip ("Order on WhatsApp · Cash on delivery available · Free chats,
  fast replies" or the shop's custom strip text), sticky header (logo + shop name, nav Shop/Categories/About, search box, wishlist/compare/cart icon buttons with count badges), hero (`h1` hero text or "Welcome to <shop>."; sub text; three trust pills
  "Cash on delivery", "Free chat support", "Easy returns"), then either the empty state ("No products yet" / "The owner is still setting things up — please check back soon.") or the catalog section (anchor `categories`): toolbar
  (result count, sort select, grid/list toggle), filter sidebar (WD-STORE-031), the grid, a "Nothing matches those filters" state with "Clear filters", and the show-more block ("Show more products" plus "Showing X of Y products"). Footer (4 columns).
  Product card: square image (lazy, fallback package icon), badges (discount percent when on sale, "New" when created within 14 days, "Sold out" when not in stock), wishlist heart and quick-view eye buttons, category label, name (2-line clamp, links to the
  product page), price (compare-at struck through), "Add to cart" button (disabled "Sold out").
- **Endpoints:**

| METHOD uri   | route name              | Controller@action                | middleware | request fields                         | response                                                                                                 |
| ------------ | ----------------------- | -------------------------------- | ---------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| GET s/{slug} | storefront.public.index | StorefrontPublicController@index | web        | `page` int (default 1), `partial` bool | HTML page; with `partial=1` and `page>1` only card HTML plus a JSON meta script; 404 if unknown/disabled |

- **Data:** reads `wa_storefronts` (by slug, enabled), `wa_products` of the **workspace** (see rules), `wa_provider_configs`/`devices` (WhatsApp number). Writes the daily view counter (WD-STORE-020).
- **Rules & edge cases:**
  1. Lookup by `slug` only (case-sensitive column), must be `enabled`; otherwise 404 (no distinction between unknown and disabled).
  2. Products: all of the workspace's products with `in_stock = true`, ordered by `sort_order` ascending then id descending. QUIRK: the product `status` (active/draft/archived) is **not** checked, only the in-stock flag, so drafts that are flagged in stock are visible; and products are
     **workspace-scoped, not shop-scoped** (the `wa_products.storefront_id` column exists but the public page ignores it, so every shop of a workspace shows the same catalog).
  3. Pagination: 48 per page, `page` min 1; the query takes 49 rows to learn whether more exist. `total` is the count of all available products; the "Showing X of Y" line shows the current page's count versus total.
  4. Categories facet = distinct non-empty `category` values among the **current page's** products only; price min/max = the page's cheapest and dearest price converted to whole major units (rounded). So later pages can contain categories or prices missing from the sidebar.
  5. `partial=1` with `page>1`: returns the card HTML (no theme shell, no view counted) plus a `<script type="application/json" data-page-meta>` carrying `{hasMore, page}`. `partial=1` with page 1 returns the full page.
  6. WhatsApp number for the page (header-less, used in footer contact, product "Ask a question", checkout hand-off): see WD-STORE-011.
  7. View counted once per full page render (not per partial). Tracking failures never break the page.
  8. Theme fallback: unknown/missing theme key renders `aurora`.
  9. Sold-out handling: because only `in_stock = true` rows are listed, the "Sold out" badge/disabled button appears only for rows where the in-stock flag is true yet the template computes not-in-stock (practically never); stock quantity zero is enforced at the cart/checkout instead.
  10. QUIRK (reproduced, found in the public-shop parity run): the catalog section has no max-width and the grid inside it is 1280px wide with `margin: 0 auto` as a grid item, so between roughly 880 and 1570px the product grid is wider than its column and its right edge is clipped by `overflow-x: hidden` (at 1440px the fourth card column is cut off). Breakpoints: filters stack below 880px (`order: 2`), 2 card columns below 560px, 1 below 340px.
  11. QUIRK (WaDesk defect, **not** reproduced): "Show more products" never works in WaDesk. `?page=2&partial=1` makes `index()` return a `Response` from a method typed to return `View`, a TypeError (HTTP 500); the browser script then finds no meta, treats it as "no more pages" and removes the button, so buyers only ever see page 1. The port loads the next page as specified above (intended difference, listed in the parity file).
  12. QUIRK (reproduced): below 760px the header search box and the nav links are hidden (no search on phones); the closed drawers are only translated off screen, so their box-shadow bleeds onto the right edge of every page; the "In stock only" filter never hides anything (no listed card is ever disabled).
  13. `settings.top_strip` and `settings.hero_sub` are read by the page (the strip text; the hero sub copy, even when empty) although no screen writes them; the port reads them too (`topStrip`, `heroSub` on the public shop block).
  14. The 404 of an unknown or disabled shop is WaDesk's platform-wide "Page not found" screen (logo and brand name, "Lost in the workspace", a big 404, "This page took a wrong turn.", Go back / Sign in, "Need help? Talk to support"), not a shop page; the product and order 404s are the same screen.
- **Async & events:** view counter write (WD-STORE-020). No jobs.
- **External systems:** Google Fonts (CSS) on every page load (Fraunces, Plus Jakarta Sans, JetBrains Mono).
- **Settings:** shop settings (WD-STORE-006); `app.url` (subdomain match).
- **Acceptance criteria:**
  - Given an enabled shop with 100 in-stock products, When `/s/<slug>` loads, Then 48 cards render, the show-more button shows "Showing 48 of 100 products".
  - Given the same shop, When `/s/<slug>?page=2&partial=1` is requested, Then only card markup for items 49-96 plus `{"hasMore":true,"page":2}` is returned and the view counter does not change.
  - Given a disabled shop or an unknown slug, When requested, Then the response is 404.
  - Given a workspace with no products, When the page loads, Then the "No products yet" empty state shows.
  - Given a product flagged not in stock, When the page loads, Then it is not listed.
  - Given a shop with theme key `noir`, When loaded, Then the Noir theme is rendered; Given an unknown theme key, Then Aurora is rendered.
- **Source refs:** app/Http/Controllers/StorefrontPublicController.php (index, themeView, context), resources/views/storefront/_partials/index.blade.php, _partials/card.blade.php, _partials/_cards-only.blade.php, app/Models/WaProduct.php (scopeAvailable, scopeOrdered), routes/web.php:162.
- **Port notes:** public renderer in `apps/web` (Next.js server components, ISR/short cache keyed by shop and page) reading a public read API `GET /public/shops/:slug/products?page=` in the storefront module (unauthenticated, rate limited, no tenant session; resolve org from the slug and set the RLS org context
  as a privileged lookup). Decide per shop product scoping (use `storefront_id` when set, else all). Filter on `status = active` in the port (recommended; WaDesk omission is a quirk). Return facets for the whole catalog, not the page.

### WD-STORE-010 — Public product page

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-STORE-009
- **Summary:** the detail page for one product: gallery with thumbnails, price/sale/stock, quantity stepper, add to cart, wishlist/compare/share, an "Ask a question on WhatsApp" link, meta list, three tabs (Description, Shipping & returns, Reviews), eight related products and the review form.
- **Actors & access:** anonymous. 404 when the shop is unknown/disabled or the product slug is unknown or not in stock.
- **UX & screens:** theme view `storefront.themes.<key>.product` including `_partials/product.blade.php`. Two-column layout (gallery left, info right; stacks under 760px). Gallery: vertical thumbnail strip + main image; thumbnails come from the main image plus the product's gallery list (blank values removed, duplicates
  removed); clicking a thumbnail swaps the main image. Info: breadcrumb "<shop> / <category> / <name>", name, price (compare-at struck through and "Save N%"), stock pill ("In stock · ready to ship", or "Only N left" when `stock_qty` is set and <= 10, or "Sold out"), description paragraph,
  quantity stepper (min 1, no max in the UI) with Add to cart (opens the cart drawer afterwards), wishlist, compare and share icon buttons, "Ask a question on WhatsApp" (wa.me link with a prefilled "Hi! I have a question about: <name> (<product url>)", only when the shop has a WhatsApp number),
  definition list (SKU, Category, Weight in grams, a fixed "Delivery: 2-5 business days", tags). Tabs: Description (the product's rich-text body, sanitised with an allow-list; falls back to the plain description or "No description available yet — message the seller on WhatsApp to learn more."),
  Shipping & returns (fixed copy: dispatched within 1-2 business days, 2-5 days delivery, "Free shipping on orders above <amount>", returns within 7 days via WhatsApp), Reviews (average, star row, count with plural, each approved review with name, stars and body, empty "No reviews yet — be the first to review this product.",
  and the "Write a review" form). "You may also like" rail with up to 8 cards.
- **Endpoints:**

| METHOD uri                   | route name                | Controller@action                  | middleware | request fields | response                                |
| ---------------------------- | ------------------------- | ---------------------------------- | ---------- | -------------- | --------------------------------------- |
| GET s/{slug}/p/{productSlug} | storefront.public.product | StorefrontPublicController@product | web        | none           | HTML page; 404 for unknown shop/product |

- **Data:** reads `wa_storefronts`, `wa_products` (workspace, slug, in stock), `wa_product_reviews` (approved, newest first, 20), related products. Writes the view counter.
- **Rules & edge cases:**
  1. Product is looked up by (workspace of the shop, product `slug`, `in_stock = true`); slugs are unique per workspace only. Same status quirk as WD-STORE-009 (drafts visible).
  2. Related: up to 8 other in-stock products of the workspace; same category first (ordered), topped up with any other products (excluding those already chosen) until 8; if the product has no category, the first 8 others.
  3. Reviews: latest 20 with status `approved`; average = mean rating rounded to one decimal; star row uses the rounded integer. `ratingCount` is the number of **loaded** reviews (max 20), not the total approved count.
  4. The rich-text body is passed through an allow-list sanitiser (scripts, event handlers, style attributes, iframes stripped) before rendering raw. Name, description, tags and review text are escaped normally.
  5. QUIRK: the code also supports a second URL shape (`/p/{productSlug}` on a subdomain, with no shop slug in the path), but no such route is registered, so that branch is unreachable.
  6. QUIRK: the review form markup appears twice on the page (once in the Reviews tab and once in a standalone "Reviews" section appended by the base layout) with identical element ids; the submit script reads the first match. The reviews list is also rendered twice.
  7. The shipping tab and footer read a `free_threshold` key from the shipping config that nothing ever writes (the real key is `free_above_minor`), so they always say "free above 999" in the shop's currency regardless of the real rule. The port should read the real free-above value.
  8. The view counter is incremented on every product page load too (same counter as the home).
  9. `window.SF_CATALOG` is filled with the product and related items for cart, quick view and compare.
  10. JSON-LD and Open Graph tags (WD-STORE-027).
  11. QUIRK (reproduced): the page's own product enters the browser catalog (`SF_CATALOG`) without `stock_qty` (only the related cards carry it), so the quantity add on the product page and the drawer stepper do not clamp that product to its stock; a stock of 0 reads "Only 0 left" on the pill.
  12. QUIRK (reproduced, rules 6 and 7 above are kept on purpose): the page shows the Reviews list and the review form twice (once in the Reviews tab, once in the "Reviews" block every theme appends after the related rail) and the shipping tab and the footer say "Free shipping ... above <999.00 in the shop's currency>" whatever the real free-above rule is. One deliberate fix: each form posts its own fields (in WaDesk both read the first `#rv-name`, so the visible bottom form always answered "Please add your name.").
  13. The shipping tab and the filter's "Range" hint are formatted by `FormatSettings::formatIn` (symbol glued to the amount, two decimals: `₹999.00`, `₹109.00 — ₹589.00`) while cards, the drawer and the checkout use symbol, a space and whole amounts (`₹ 109`). The tracking page's Total and the WhatsApp confirmation use `WaOrder::total_display` (INR/USD/EUR/GBP symbol, any other currency its code; always two decimals).
- **Async & events:** view counter write.
- **External systems:** Google Fonts; the optional external image URLs.
- **Settings:** none beyond the shop settings.
- **Acceptance criteria:**
  - Given a product with a gallery of 3 images, When the page loads, Then 4 thumbnails show if the main image differs from the gallery entries (duplicates removed) and clicking one swaps the main image.
  - Given `stock_qty` 3, When the page loads, Then the pill says "Only 3 left"; Given `stock_qty` 25 or null, Then "In stock · ready to ship".
  - Given a compare-at price above the price, When loaded, Then the old price is struck through and "Save N%" shows with N = round((compare - price) / compare x 100).
  - Given 2 approved and 1 pending review, When loaded, Then only the 2 approved appear and the average is computed over them.
  - Given a product in a category with 3 siblings and 10 other products, When loaded, Then the related rail shows the 3 siblings first then 5 others.
  - Given an unknown product slug, When loaded, Then the response is 404.
  - Given a body containing a script tag, When rendered, Then the script is removed.
- **Source refs:** app/Http/Controllers/StorefrontPublicController.php (product), resources/views/storefront/_partials/product.blade.php, _theme-base.blade.php (reviews section), app/Support/html_sanitize.php, app/Models/WaProductReview.php, routes/web.php:163.
- **Port notes:** same renderer as WD-STORE-009. Reviews and products are read through the CAT module's query service (public projection: id, slug, name, price_minor, compare_price_minor, currency, images, stock, category, tags, sku, weight). Keep the sanitiser (use a maintained HTML sanitiser, not regex).
  The duplicated review block and the fixed "999.00" free-shipping text are kept for parity (rule 12); decided in the public-shop parity run.

### WD-STORE-011 — The 8 themes and the shared theme context

- **Status:** implemented
- **Priority:** P0
- **Effort:** XL
- **Depends on:** WD-STORE-009, WD-STORE-010
- **Summary:** eight selectable looks for the public shop, all built on one shared skeleton so every theme has the same features (search, drawers, filters, checkout) and differs only in palette, typography and a few layout/style overrides.
- **Actors & access:** merchant picks the theme in WD-STORE-006; buyers see it. A theme key that is missing falls back to Aurora.
- **UX & screens:** `resources/views/storefront/_theme-base.blade.php` (skeleton and CSS), `_shared.blade.php` (cart/wishlist/compare JS, drawers, modal, toast), `_partials/*`, `themes/<key>/{index,product}.blade.php` (token arrays and style overrides). Every theme page is a full standalone HTML
  document.
  **Shared skeleton:** body font Plus Jakarta Sans, display/brand/heading font Fraunces (serif), labels/prices/strip in JetBrains Mono (all from Google Fonts); line height 1.5; container max 1280px with 24px side padding; top utility strip (text colour = page bg, background = text colour, mono 11.5px, centred); sticky translucent blurred
  header (logo up to 34px high + shop name 23px serif semibold, nav links 13px muted, pill search box up to 520px that takes the remaining space, three round icon buttons with count badges); hero (centred, padding 72px top, `h1` serif clamp(30px, 5.2vw, <theme hero size>) line-height 1.06, max 18 characters wide, sub text 15.5px muted, trust pills in mono uppercase 11px);
  product grid `repeat(auto-fill, minmax(min(100%, 248px), 1fr))` gap 22px (2 columns under 560px, 1 under 340px); cards (surface background, 1px border, theme radius, image square cover with 1.06 zoom on hover, 4px lift and shadow on hover, mono 9.5px uppercase category, 17px serif 2-line-clamped name, mono price, full-width brand-coloured
  add button with 12.5px bold text and 10px radius); two-column product page with 64px gap; footer on surface with a 4-column grid (brand + blurb + payment chips "WhatsApp / UPI / Cash on delivery / Bank transfer", Shop links, Help links that open info modals (Shipping, Returns, How to order, Privacy), Contact with the WhatsApp number and fixed hours "Mon-Sun · 9am-9pm") and a bottom line with the footer text;
  right-hand drawers (cart 420px, full width under 760px; wishlist; compare 680px), a centred modal and a bottom toast, an empty-state illustration style for empty drawers. The header gets a soft shadow once scrolled 8px.
  **Per-theme tokens (default brand colour is used only when the merchant has not set one; the merchant brand colour replaces the theme brand in every theme, but each theme keeps its own fixed accent except Aurora whose accent follows the brand):**

| Key (label)                | Background / surface / text / muted / border    | Brand default, accent                         | Card radius, hero size | Distinguishing layout and style                                                                                                                                                                                                                                                                                                                                |
| -------------------------- | ----------------------------------------------- | --------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| aurora — minimal (default) | #FBFAF6 / #FFFFFF / #0B1F1C / #6B807C / #E5DFD0 | #075E54 (deep WhatsApp green), accent = brand | 14px, 46px             | Reference look: airy, centred hero, white cards with soft hover lift, no overrides.                                                                                                                                                                                                                                                                            |
| meridian — magazine        | #F5F2EA / #FFFFFF / #0B1F1C / #6B807C / #D9D2BD | #0B1F1C ink, accent #0B1F1C                   | 2px (cards flat), 58px | Editorial: huge serif hero with italic emphasis allowed (`em` tags), cards lose their box and keep only a bottom hairline, no radius, text-only body padding 14px 0, wide gutters (8 percent each side), column min 280px, row gap 64px / column gap 24px, single column under 600px. Product page hero 52px.                                                  |
| verdure — organic          | #F4F1E8 / #FAF8F0 / #2D3A22 / #7B8A6A / #D5DCC4 | #5C7C4D sage, accent #5C7C4D                  | 20px, 44px             | Soft and rounded: a short 60x2px accent rule centred above the hero, very round cards, tall 4:5 product images on a pale sage-to-sand gradient.                                                                                                                                                                                                                |
| bazaar — colorful grid     | #FFF6EC / #FFFFFF / #2A1810 / #7A5C40 / #F4D7B8 | #E76F51 coral, accent #E76F51                 | 10px, 42px             | Dense market grid: columns min 200px with 14px gap, compact cards (padding 10px), 15px semibold sans product names (not serif), bold 13px coral prices, small coral 6px-radius add button.                                                                                                                                                                     |
| noir — dark luxe           | #0A0A0A / #141414 / #F0F0F0 / #A0A0A0 / #2A2A2A | #D4AF37 gold, accent #D4AF37                  | 4px, 52px              | Dark mode: black header with a hairline, light-weight (300) hero with wide tracking, bordered dark cards whose border turns gold on hover, light-weight names, outlined gold buttons that fill gold with black text on hover, gold-outlined cart button with a gold count badge. Product page: black header, gold order button.                                |
| kraft — handmade           | #EDE4D3 / #F5EFE0 / #3B2C1A / #8B7556 / #C9B894 | #A6845A leather, accent #A6845A               | 8px, 42px              | Paper craft: dotted paper background (8px dot grid at 8 percent opacity), translucent blurred header, cards with a hard offset shadow (2px 2px, tan) instead of a soft one, image tiles on kraft beige #E5D8B7. Product page keeps the dotted background.                                                                                                      |
| mercato — deli / cafe      | #FFF8E7 / #FFFEF8 / #1F1408 / #7C5B3A / #F4D35E | #C8553D terracotta, accent #C8553D            | 12px, 46px             | Cafe menu: solid terracotta header with cream text and an italic serif shop name, yellow (#F4D35E) cart button, hero with vertical cream/off-white 24px stripes and a 4px dashed yellow bottom border and italic heading, cards with a 2px yellow border on cream image tiles, yellow add buttons that flip to terracotta on hover. Product page: same header. |
| studio — portfolio         | #F4F1ED / #FFFFFF / #264653 / #7B8E94 / #D8DCDD | #2A9D8F teal, accent #2A9D8F                  | 24px, 56px             | Gallery: left-aligned hero in a 900px column (96px top padding, weight 500), grid with columns min 320px capped at 1100px and centred, 32px gap, borderless cards with a large soft shadow that deepens on hover, 5:4 images, teal pill add buttons that turn navy (#264653) on hover.                                                                         |

**Theme context** (the same variables for every theme and partial): the shop, its workspace, the settings map, the shop display name (shop name, else the workspace name, else "Store"), the hero text (settings `hero_text`, empty by default), the footer text (settings `footer_text`, default "© <year> <shop name>"), the logo URL, the brand colour (settings
`brand_color`, default `#075E54`), and the WhatsApp number (below). Hero heading: the hero text is output **unescaped as HTML**; empty -> "Welcome to <shop name>.". Settings `hero_sub` (default sub copy "Hand-picked products. Order any item directly on WhatsApp — no checkout forms, no app installs.") and `top_strip` are read
but no screen writes them. The nav anchors `#categories` exist, `#about` points at nothing.

- **Endpoints:** none of its own (rendering of GET s/{slug}, GET s/{slug}/p/{productSlug}, order status page).
- **Data:** `wa_storefronts.theme_key`, `settings_json`, `payment_provider`, `payment_config_json.handle` (exposed to the browser), `shipping_json`, `currency_code`.
- **Rules & edge cases:**
  1. **WhatsApp number resolution** (the buyer-facing "sending number"): (1) the shop's bound device phone (country code + number, digits only); (2) else the workspace's first connected official WABA/Twilio config phone (ordered by id); (3) else the workspace's primary provider config phone; else none. When none, the "Ask a question",
     footer WhatsApp link and the checkout hand-off link are omitted (checkout still records the order).
  2. QUIRK: the hero text is rendered as raw HTML (stored XSS by the merchant on their own public page, and the Meridian CSS expects `em`); the port must either escape it or sanitise with the same allow-list used for product bodies.
  3. Brand colour is applied through CSS (add-to-cart buttons, link hover, search focus border, review submit button); `accent` is used for the "New" badge, trust-pill icons, hero rules and theme-specific buttons.
  4. A currency symbol table in the browser covers the 21 currencies (code shown with a space when unknown); amounts are formatted as symbol + space + value with no decimals when whole, else 2 decimals.
  5. `window.SF_SHOP` (id, name, currency, shipping rule, payment provider and handle) and `window.SF_CATALOG` (id -> name, price, compare, image, url, slug, sku, category, description, stock_qty, currency) are the hand-off to the browser logic; the catalog map holds only the products rendered in the page (and related ones), not the whole catalog.
  6. Product themes only override colours and a few rules; the product page of each theme uses the same partial.
  7. QUIRK (measured in the parity run; the table above was read from the theme files and is corrected here): (a) `.cart-btn` is not an element of the shell, so Noir's gold-outlined cart button and Mercato's yellow cart button never render; the header icons are plain round buttons and the count badge is always coral `#E87A5D` with white text; (b) a theme's `.add { ... }` has the specificity of one class and loses to the base `.card .add`, so the outlined gold button (Noir), the yellow button (Mercato) and the teal pill (Studio) never show at rest (cards keep the brand-coloured filled button with white text); only their `:hover` rules apply (Noir: accent fill with black text, Mercato: terracotta, Studio: navy); (c) Meridian's `.grid { padding: 24px 8% }` is dead because the grid has inline `padding: 0`, and below 560px Meridian shows 2 columns, not 1; (d) drawers, modal, toast, compare bar and the checkout form are always the light Aurora look (white panel, `#0B1F1C` ink), also on Noir; (e) the "Reset filters", "Clear filters" and "Show more products" buttons use the browser's default button text colour (black), unreadable on Noir's dark surface; (f) buttons, inputs and selects without a font rule use the browser default (Arial), e.g. the sort select, the search box and the product page's Add to cart.
- **Async & events:** none.
- **External systems:** Google Fonts.
- **Settings:** per shop `theme_key`; settings keys `brand_color`, `hero_text`, `footer_text`, `logo_url`, and the unwritten `hero_sub`, `top_strip`.
- **Acceptance criteria:**
  - Given each of the eight theme keys, When `/s/<slug>` renders, Then the page uses that theme's background, surface, text and border colours and its card radius and hero size from the table.
  - Given a merchant brand colour `#112233`, When any theme renders, Then add-to-cart buttons use `#112233` (Noir uses outline style with the gold accent; Mercato yellow buttons) and the Aurora accent equals it.
  - Given a shop bound to a device with phone 15551234567, When rendered, Then wa.me links use `15551234567`; Given no device and a connected WABA config, Then its number; Given neither, Then no WhatsApp link renders.
  - Given hero text containing markup, When rendered, Then (WaDesk) it is output as HTML; the port escapes or sanitises it (documented difference).
  - Given an unknown theme key in the database, When rendered, Then Aurora is used.
  - Given no logo URL, When rendered, Then the header shows only the shop name; with a logo, the image precedes the name.
- **Source refs:** resources/views/storefront/_theme-base.blade.php, _shared.blade.php, *partials/*.blade.php, themes/_/*.blade.php, app/Http/Controllers/StorefrontPublicController.php (context, resolveWaNumber, themeView), app/Models/WaStorefront.php (THEMES, getSendingLabelAttribute).
- **Port notes:** implement the shell once as React components with a theme token object (CSS variables `--sf-*`) and per-theme CSS modules; the eight themes are data (tokens + small overrides) not eight codebases. Fonts via `next/font` (self-host) instead of Google CDN. Keep the same HTML structure for the public pages only as far as the tests need.
  Escape or sanitise hero text. Add a visual regression test per theme.

### WD-STORE-012 — Cart and checkout form (browser behaviour)

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-STORE-009, WD-STORE-013
- **Summary:** a client-side cart that lives in the browser, a cart drawer with shipping hint and totals, and a checkout modal that collects name, phone, address, note, coupon and payment method, posts the order to the server and then opens WhatsApp.
- **Actors & access:** anonymous buyer. Everything is per browser per shop; no account, no server cart.
- **UX & screens:** `_shared.blade.php` (script `window.STOREFRONT`) and the drawers at its end.
  - **Storage:** browser `localStorage`, keys `sf_cart_<shopId>`, `sf_wish_<shopId>`, `sf_compare_<shopId>`, `sf_recent_<shopId>` (JSON arrays), so two shops in one browser do not mix. A cart line is `{id, name, price (minor units), image, qty}`; the price is the price when added (display only, the server re-prices).
  - **Add:** "Add to cart" adds 1 (or the stepper value on the product page). The cap is the product's `stock_qty` known to the page (no cap when stock is unlimited/unknown). Over the cap: a modal "Only N in stock" ("This product is sold out..." when 0; "There is only 1 unit / are only N units available, and you already have all of them in your cart.");
    for the product-page quantity add and for the drawer stepper, the quantity is clamped to the cap with the toast "Only N in stock". A toast "<name> · added to cart" (1.8 s). The cart count badge bumps.
  - **Cart drawer** (right, 420px, full width under 760px): header "Your cart", lines with image (fallback package emoji), name, "<price> × <qty>", a stepper (- input +; typing sets the qty, minimum 1, clamped to stock) and a remove (x); empty state "Your cart is empty / Browse the catalog and add a few favourites. / Keep browsing". Footer: Subtotal, a shipping row, Total, the shipping note (if set),
    the big button "Order on WhatsApp ->", and a caption "Pay via <UPI|Razorpay|Card|PayPal|Bank transfer> · Cash on delivery" or "Cash on delivery · Confirm in chat".
  - **Shipping row:** shown only when the shop has a flat fee > 0: "FREE ✓" in green when the subtotal reaches the free-above amount, else the fee plus "Add <remaining> more for free shipping" when a free-above amount exists. Total = subtotal + shipping; **coupon savings are not in the drawer total** (shown only in the checkout modal after Apply).
  - **Checkout modal** (opened by "Order on WhatsApp"; if the cart is empty a modal "Your cart is empty — Browse the catalog and add a product before checking out." appears instead): summary "N item(s) · <total>"; fields _Your name_ (max 120), _WhatsApp number_ (tel, max 32, placeholder "+1 555 123 4567"), _Delivery address_ (textarea, max 1000),
    _Note (optional)_ (max 1000), _Discount code_ (max 64, uppercased display) with an Apply button and a message line, _Payment_ radios "Pay online / on delivery details" (value `prepaid`, default) and "Cash on delivery" (`cod`), a status line and "Place order".
  - **Client validation on Place order:** name required -> "Please enter your name."; phone with fewer than 7 digits -> "Please enter a valid WhatsApp number."; empty cart -> "Your cart is empty.". The button shows "Placing order…" and is disabled during the request and re-enabled on failure.
  - **Submit:** POST JSON to `/s/<slug>/checkout` (relative to the app's base path, same host as the page, so it works on custom domains) with name, phone, address, note, coupon (typed value, else the last accepted code), payment_method and `items: [{id, qty}]` (ids and quantities only, no prices).
  - **Result:** success -> clear the cart storage, re-render, and if the response has a WhatsApp URL show "Order placed! Opening WhatsApp…" and navigate to it; otherwise a modal "Order placed" with the server message and a "Track order #<n> ->" link. Failure -> the server's message in the status line, else "Could not place the order. Please try again." (network failure: "Network error. Please try again.").
  - Escape closes drawers and the modal; clicking a backdrop closes it.
- **Endpoints:** POST s/{slug}/checkout (WD-STORE-013), POST s/{slug}/coupon (WD-STORE-014), POST s/{slug}/abandon (WD-STORE-015).
- **Data:** browser storage only; reads `SF_SHOP` and `SF_CATALOG`.
- **Rules & edge cases:**
  1. QUIRK (dead code): the file still contains a function that builds a long pre-filled WhatsApp order message (with product lines, links, subtotal, shipping, payment instructions, "My name / Delivery address / Phone" prompts) and a function that builds UPI/PayPal/static-link payment URLs, but **nothing calls them** since server checkout replaced
     the old regex-parsed order flow. Static payment handles therefore affect only the cart caption (WD-STORE-028).
  2. Stock caps come from the product data embedded in the page; products brought in by "Show more" are not in that map, so their stock cap is unknown in the browser (the server still clamps).
  3. Cart items whose product is later removed/unavailable remain in the cart until checkout; the server drops them and, if nothing is left, answers 422 "Those items are no longer available. Please refresh and try again.".
  4. The cart is not synchronised across tabs/devices and survives reloads; clearing site data empties it.
  5. A buyer who edits the stored cart price changes only the display: the server ignores prices.
  6. No quantity maximum in the UI beyond stock; the server rejects quantities over 999 per line and more than 100 lines.
  7. Wishlist and compare drawers are WD-STORE-026.
  8. QUIRK (reproduced): the checkout dialog opens over the cart drawer, which stays open behind it; Escape closes both. A successful order with a WhatsApp URL keeps the form up with "Order placed! Opening WhatsApp…" and clears the cart.
  9. QUIRK (WaDesk defect, **not** reproduced): the share dialog's Copy button is built with `JSON.stringify` inside an HTML attribute, so the attribute ends early and the dialog shows the stray text `this.textContent='Copy',1500)">` next to the button; the port renders a clean button.
- **Async & events:** the abandoned-cart beacon fires on phone blur (WD-STORE-015).
- **External systems:** `wa.me` hand-off (WD-STORE-013).
- **Settings:** shop currency, shipping, payment provider label, shipping note.
- **Acceptance criteria:**
  - Given a product with stock 2, When the buyer adds it a third time, Then the modal "Only 2 in stock" appears and the cart still holds 2.
  - Given a flat fee 50.00 and free above 500.00 and a cart of 520.00, When the drawer renders, Then the shipping row shows FREE and Total = 520.00; Given 300.00, Then fee 50.00, total 350.00, and the hint "Add 200 more for free shipping".
  - Given an empty cart, When "Order on WhatsApp" is pressed, Then the "Your cart is empty" modal shows and no request is sent.
  - Given the checkout form with an empty name, When Place order is pressed, Then "Please enter your name." shows and no request is sent.
  - Given a successful response with a WhatsApp URL, When it returns, Then the cart storage is cleared and the browser navigates to the URL.
  - Given a successful response without a WhatsApp URL, When it returns, Then the "Order placed" modal with a tracking link shows.
  - Given the server answers 422 with a message, When it returns, Then the message shows inline and the button is usable again.
  - Given a reload, When the page loads, Then the cart contents and badge reappear from storage.
- **Source refs:** resources/views/storefront/_shared.blade.php:8-955 (STOREFRONT object), 2051-2096 (cart drawer), _theme-base.blade.php (SF_SHOP, SF_CATALOG bootstrap).
- **Port notes:** a client store (Zustand/React context + localStorage) in the public storefront bundle; the checkout modal as a form component with the same limits as the schema. Do not port the dead message/payment-link builders. Embed stock caps for all visible products (or fetch on add).

### WD-STORE-013 — Server-side checkout

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-STORE-014, WD-STORE-019, WD-STORE-015
- **Summary:** accepts a cart and customer details from the public page, re-prices every line from the database, clamps quantities to stock, applies the coupon and shipping, stores a real order with a tracking token, decrements stock and returns a WhatsApp deep link with the order summary.
- **Actors & access:** anonymous buyer. CSRF-exempt, rate limited to 20 requests per minute (per client IP). Shop must exist and be enabled.
- **UX & screens:** driven by WD-STORE-012.
- **Endpoints:**

| METHOD uri             | route name                 | Controller@action                   | middleware         | request fields                                                                                                                                                                                            | response                                                                                                                        |
| ---------------------- | -------------------------- | ----------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| POST s/{slug}/checkout | storefront.public.checkout | StorefrontPublicController@checkout | web, throttle:20,1 | name req max 120; phone req max 32; email? email max 160; address? max 1000; note? max 1000; coupon? max 64; payment_method? `prepaid`\|`cod`; items req array 1..100 of {id int req, qty int 1..999 req} | JSON `{ok, order_no, wa_url, track_url, message}`; 404 `{ok:false, message:"This store is not available."}`; 422 messages below |

- **Data:** reads `wa_storefronts`, `wa_products`, `wa_coupons`, `wa_orders` (history for RTO); writes `wa_orders` (one row), `wa_coupons.used_count`, `wa_products.stock_qty`, `storefront_cart_recoveries` (status) via WD-STORE-015. Order row: `workspace_id`, `source='storefront'`, `customer_phone` (digits and a leading plus kept), `customer_name`, `customer_email`, `customer_address`,
  `items_json` (lines `{product_id, name, qty, price_minor, image, retailer_id}` where retailer_id = Meta retailer id or SKU), `total_minor`, `shipping_minor`, `discount_minor`, `coupon_code`, `currency_code` (shop currency, default INR), `payment_method` (`prepaid`|`cod`), `rto_score`, `rto_band`, `status='new'`,
  `storefront_id`, `recovery_token` (40 random characters, also the public tracking token), `notes`, `meta_json {placed_via:'storefront_checkout'}`.
- **Rules & edge cases:**
  1. Validation as in the table; failure -> standard 422 JSON with field errors (the page shows the first message). Extra rule: the phone must contain at least 7 digits, else 422 "Please enter a valid phone number.".
  2. Lines are merged by product id (duplicates add up; qty at least 1); lines with id <= 0 are ignored. Only products of the shop's **workspace** that are in stock are considered; unknown/other-workspace/out-of-stock products are silently dropped.
  3. For each remaining line with a tracked stock (`stock_qty` not null) the quantity is **silently clamped** to the stock (min with stock, floor 0); a line that clamps to 0 is dropped. Unlimited stock (`stock_qty` null) is never clamped. Reserved stock is not considered. If no line survives -> 422 "Those items are no longer available. Please refresh and try again." (no order).
  4. Line price = the product's current `price_minor` x qty; client prices are never read. Subtotal = sum of lines.
  5. Coupon (WD-STORE-014 rules): the code is matched case-insensitively among active coupons of the workspace that are either global (no shop) or scoped to this shop. QUIRK: an unknown/ineligible code at checkout is **silently ignored** (the order is placed without discount, no error), unlike the quote endpoint which answers 422. The discount is recorded only
     when it is > 0 or the coupon grants free shipping; then `coupon_code` stores the coupon's canonical code and `used_count` is incremented by 1 inside the transaction.
  6. Shipping = the shop's rule applied to the **pre-discount** subtotal: 0 if the free-above amount is set and the subtotal >= it, else the flat fee, else 0. A redeemable free-shipping coupon forces 0. Total = max(0, subtotal - discount) + shipping. There is no tax.
  7. Payment method: `cod` only when explicitly sent, else `prepaid` (even though no payment is taken at this point). The RTO score and band are computed only for `cod` orders (WD-STORE-019), otherwise both are null.
  8. Phone normalisation: all characters except digits and `+` are stripped for the order row; the abandoned-cart cancellation and RTO lookup compare **digits only**. QUIRK: because the order stores the `+`, history lookups by digits-only phone never match orders that were stored with a plus (see WD-STORE-019).
  9. `notes`: when an address is given: `"Delivery address: <address>"` plus a newline and the note when both exist; otherwise just the note (kept so the existing order detail screen shows it).
  10. Stock decrement runs in the same transaction, only for tracked products, floor 0, using the **requested** (merged) quantity per product, **not the clamped one** (QUIRK: a clamped request still subtracts the originally requested amount, which floors at 0 anyway). It runs with the Meta catalog auto-sync suppressed (the nightly resync settles Meta stock). The decrement is read-then-write, not atomic: two
      simultaneous checkouts can oversell.
  11. After commit (best-effort, never meant to block the order): cancel pending abandoned-cart nudges for the phone (WD-STORE-015) and, if the workspace's active WhatsApp Pay config has auto-charge enabled, send the pay request (CHK). QUIRK: the error handlers in this class refer to an unqualified `Throwable` that is never imported, so they catch nothing; an exception in either step would bubble up as a
      500 **after** the order was committed. The port must make both steps non-blocking for real.
  12. Hand-off: the WhatsApp number is resolved as in WD-STORE-011. If a number exists `wa_url = https://wa.me/<digits>?text=<encoded>` with the text "Hi <shop name>! I just placed order #<id> (<formatted total>). My name is <name or dash>." then a line "Track: <absolute tracking URL>". `track_url` is the relative `/s/<slug>/order/<token>`; `order_no` is the order id; `message` is "Order placed! Opening WhatsApp…" or
      "Order placed! We'll be in touch shortly." when there is no number.
  13. The order is created with status `new`; model observers (HubSpot sync, WhatsApp group notifications, invoice sweeper, paid/completed hooks) belong to CHK and run on this insert/updates.
  14. No idempotency key: a double submit creates two orders (the page disables the button while the request is in flight).
  15. The tracking URL is built from the request's own host, so on a custom domain it carries the custom domain.
      Parity run: the RTO band of a COD order differs from WaDesk for a returning phone. WaDesk stores the phone with its `+` but looks the history up by digits only, so the lookup never matches and every buyer scores as a first-time buyer (+30, band medium); the port compares digits on both sides, so a returning buyer is found (intended difference).
- **Async & events:** the order insert is the trigger for CHK's observers (HubSpot deal, invoice, group notifications); abandoned-cart cancellation (WD-STORE-015); optional WhatsApp Pay auto-charge request; Meta catalog stock settles later by nightly resync. No outbound webhook from this domain.
- **External systems:** WhatsApp `wa.me` deep link (client side redirect); WhatsApp Pay (CHK).
- **Settings:** shop shipping, currency; coupons; workspace WhatsApp Pay `auto_charge`.
- **Acceptance criteria:**
  - Given a cart of product A (price 100.00, stock 5) qty 2 and product B (price 50.00) qty 1 and a flat shipping fee 30 free above 1000, When checkout is posted with valid details, Then an order is stored with subtotal 25000, shipping 3000 and total 28000 (minor units), status `new`, source `storefront`, a 40-character token, A's stock is 3, and the response has `ok:true`, `order_no`, `track_url` and (with a number) a `wa.me` link.
  - Given a client that sends a lower price for a product, When posted, Then the stored price is the database price.
  - Given product stock 2 and a request for qty 5, When posted, Then the line is stored with qty 2.
  - Given all requested products are unavailable, When posted, Then 422 "Those items are no longer available. Please refresh and try again." and no order exists.
  - Given a phone "12-34", When posted, Then 422 "Please enter a valid phone number.".
  - Given an invalid coupon code, When posted, Then the order is placed at full price and `coupon_code` is empty.
  - Given a valid 10 percent coupon, When posted, Then `discount_minor` is 10 percent of the subtotal, `coupon_code` is stored and the coupon's `used_count` is 1 higher.
  - Given `payment_method=cod`, When posted, Then `rto_score` and `rto_band` are stored; Given `prepaid`, Then they are null.
  - Given a disabled shop, When posted, Then 404 with "This store is not available.".
  - Given 21 requests in one minute from one client, When the 21st is posted, Then it is throttled (429).
  - Given an active abandoned-cart nudge for the same phone and shop, When the order is placed, Then the nudge is cancelled and the recovery row becomes `recovered`.
- **Source refs:** app/Http/Controllers/StorefrontPublicController.php (checkout), app/Services/Storefront/StorefrontCheckoutService.php (placeOrder, resolveCoupon, quote, priceItems), app/Models/WaStorefront.php (shippingFee), app/Models/WaOrder.php, routes/web.php:167-168, bootstrap/app.php:349-352.
- **Port notes:** `POST /public/shops/:slug/checkout` in the storefront module calling a CHK order-creation service (the orders table belongs to CHK; this domain owns the pricing logic or calls CHK's `placeOrder`). One transaction: lock product rows (`SELECT ... FOR UPDATE`) and decrement atomically; increment coupon with a guarded update
  (`used_count < usage_limit`); write outbox events (`storefront.order.placed`) instead of calling side effects inline; accept an `Idempotency-Key` header. Apply a rate limiter keyed by IP + shop. Phone normalisation to E.164 consistently (fix the plus/digits mismatch). Return 422 `COUPON_INVALID` for a bad code (improvement) or keep silent-ignore; decide.

### WD-STORE-014 — Coupon quote endpoint

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-STORE-013
- **Summary:** lets the checkout modal validate a discount code against the live cart and show the discount, shipping and new total before the order is placed.
- **Actors & access:** anonymous buyer; CSRF-exempt, 30 requests per minute per client. Shop must be enabled.
- **UX & screens:** the "Apply" button of the checkout modal. Success line: "You save <discount> · New total <total>" (or "Free shipping applied · New total ..." when only shipping is waived), green; failure shows the server message, red ("Invalid code." fallback, "Could not check that code." on network failure). An empty code field clears the remembered code silently.
- **Endpoints:**

| METHOD uri           | route name               | Controller@action                      | middleware         | request fields                                                      | response                                                                                                                                                                               |
| -------------------- | ------------------------ | -------------------------------------- | ------------------ | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST s/{slug}/coupon | storefront.public.coupon | StorefrontPublicController@applyCoupon | web, throttle:30,1 | code req max 64; items req array 1..100 of {id int, qty int 1..999} | 200 `{ok, discount_minor, shipping_minor, total_minor, free_shipping, code}`; 422 `{ok:false, message:"That code is not valid for this cart."}`; 404 `{ok:false}` for unavailable shop |

- **Data:** reads `wa_coupons`, `wa_products`, `wa_storefronts`. No writes (the use counter increments only at checkout).
- **Rules & edge cases:**
  1. Coupon lookup: `code` compared case-insensitively, `active = true`, `workspace_id` = the shop's workspace, and `storefront_id` is NULL (all shops) or equals this shop. Codes are unique per workspace in the Postgres draft.
  2. Redeemable when: active; `starts_at` not in the future; `expires_at` not in the past; `usage_limit` is null or `used_count < usage_limit`; `min_subtotal_minor` is null or the cart subtotal reaches it. All times compared in server time.
  3. Discount: type `flat` -> `amount` minor units; type `percent` -> round(subtotal x clamp(amount, 0..100) / 100), then capped by `max_discount_minor` if set; always clamped between 0 and the subtotal. Not redeemable -> 0.
  4. Free shipping coupon (`free_shipping`): shipping becomes 0 when redeemable. A coupon can give both discount and free shipping.
  5. The quote re-prices the cart from the database with the same stock clamp as checkout; shipping uses the pre-discount subtotal; total = max(0, subtotal - discount) + shipping.
  6. A coupon that is valid but yields discount 0 and no free shipping still returns `ok:true` with `discount_minor: 0`.
  7. Unknown code, inactive, expired, used up, below the minimum, or wrong shop -> 422 with the same generic message (no reason leaked). Empty cart lines -> subtotal 0 (min-subtotal coupons fail).
  8. The browser stores the accepted code and sends the typed code again at checkout.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** coupons are managed in `/store/coupons` (CHK).
- **Acceptance criteria:**
  - Given a 20 percent coupon capped at 50.00 and a 400.00 cart, When quoted, Then the discount is 50.00 (capped) and total = 350.00 + shipping.
  - Given a flat coupon larger than the subtotal, When quoted, Then the discount equals the subtotal and total = shipping only.
  - Given a minimum subtotal of 500.00 and a 300.00 cart, When quoted, Then 422 "That code is not valid for this cart.".
  - Given an expired coupon, When quoted, Then the same 422 message.
  - Given a coupon scoped to another shop, When quoted here, Then 422.
  - Given a free-shipping coupon and a flat fee, When quoted, Then `free_shipping:true` and `shipping_minor:0`.
  - Given the code in a different letter case, When quoted, Then it matches and the response returns the coupon's canonical code.
- **Source refs:** app/Http/Controllers/StorefrontPublicController.php (applyCoupon), app/Services/Storefront/StorefrontCheckoutService.php (resolveCoupon, quote), app/Models/WaCoupon.php (redeemable, discountFor), routes/web.php:173-174.
- **Port notes:** the coupon entity and its CRUD belong to CHK (`wa_coupons` exists in 20261001104900_chk_wadesk_schema.sql); this feature is a pricing function `quote(shop, items, code)` shared by quote and checkout. Keep the generic error (avoid code enumeration) and rate-limit per IP.

### WD-STORE-015 — Abandoned-cart beacon and recovery scheduling

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-STORE-006, WD-STORE-013
- **Summary:** when a buyer types a phone number in the checkout modal but has not ordered, the browser pings the shop; if recovery is enabled the server schedules a one-off WhatsApp reminder (default 30 minutes later) which is cancelled automatically if the buyer then orders.
- **Actors & access:** anonymous buyer (beacon); merchant configures it in the design page. Beacon is CSRF-exempt, 30/min per client.
- **UX & screens:** buyer side invisible. The browser fires the beacon once per page load, on blur of the phone input when the cart is non-empty and the phone has at least 7 digits. Merchant settings are in WD-STORE-006 section 7.
- **Endpoints:**

| METHOD uri            | route name                | Controller@action                  | middleware         | request fields                                                                     | response                                                                          |
| --------------------- | ------------------------- | ---------------------------------- | ------------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| POST s/{slug}/abandon | storefront.public.abandon | StorefrontPublicController@abandon | web, throttle:30,1 | name? max 120; phone req max 32 (>= 7 digits); items req array 1..100 of {id, qty} | `{ok:true, scheduled:bool}`; 404 `{ok:false}`; 422 `{ok:false}` for a short phone |

- **Data:** `storefront_cart_recoveries` (insert: `workspace_id`, `storefront_id`, `customer_phone` digits only, `customer_name`, `items_json` (the request items as sent: id and qty), `subtotal_minor` (server re-priced), `currency_code`, `scheduled_ids` (ids of the scheduled messages), `status` `active|recovered`); `scheduled_messages` (one plain-text one-off row);
  reads shop settings, devices, provider configs.
- **Rules & edge cases:**
  1. Does nothing (`scheduled:false`, still `ok:true`) unless settings `cart_recovery_enabled` is exactly true; or the digits of the phone are < 7; or an **active** recovery already exists for this shop and phone (one active per phone and shop; no refresh/reschedule despite the code comment).
  2. Sender: engine of the workspace. Baileys -> the newest connected device (active first); no connected device -> no scheduling. WABA/Twilio -> the workspace's primary provider config of that engine; none -> no scheduling. (On WABA a plain-text proactive message only delivers inside the 24-hour window, a Meta rule.)
  3. Delay = max(5, settings delay minutes, default 30). Message: the custom text or default "Hi <first name or 'there'>! You left some items in your cart at <shop name>. Complete your order here: <shop url>"; placeholders `{name}`, `{shop}`, `{url}`, `{total}` are substituted (total formatted with the shop currency). Shop URL = `https://<custom domain>` when a verified custom domain exists, else the app URL plus `/s/<slug>`.
  4. A scheduled message row is created (type plain, one recipient, schedule name "Cart recovery · <shop name>", timezone = app time zone, status `scheduled`) and registered with the Node one-off scheduler; the returned Node schedule id is stored on the row. Failure is logged and answers `scheduled:false`.
  5. Cancellation: on a successful order (WD-STORE-013) every active recovery of that shop and phone has its scheduled message cancelled (Node cancel, row status `cancelled`) and the recovery row set to `recovered`. A nudge that already fired is not marked: the recovery row stays `active` forever after firing (no sweep exists), which blocks future recoveries for that phone and shop. QUIRK, see quirks list.
  6. Phone normalisation: digits only (leading plus removed), so cancellation matches the digits-only value.
  7. Name defaults to "there" in the message; items are not validated against the catalog.
- **Async & events:** scheduled message registered on the Node scheduler (`registerOneOff`) and later sent as a WhatsApp text from the shop's number; cancel call on conversion. Statuses of the scheduled message flow through the existing scheduled-messages pipeline (domain `scheduled-queue-warmer`).
- **External systems:** Node scheduler/bridge (internal service); WhatsApp delivery via the workspace engine.
- **Settings:** per shop `cart_recovery_enabled` (default false), `cart_recovery_delay_min` (default 30, 5-1440), `cart_recovery_message`.
- **Acceptance criteria:**
  - Given recovery enabled with delay 15 and a connected device, When a beacon with a valid phone and items arrives, Then a recovery row `active` and a scheduled message for now + 15 minutes exist and the response is `{ok:true, scheduled:true}`.
  - Given recovery disabled, When a beacon arrives, Then no rows are created and `scheduled` is false.
  - Given an active recovery for the same phone and shop, When another beacon arrives, Then nothing new is created.
  - Given an active recovery, When the buyer places an order with the same phone digits, Then the scheduled message is cancelled and the recovery becomes `recovered`.
  - Given a delay set to 3 in the data, When scheduling, Then 5 minutes is used.
  - Given a custom message "Hi {name}, {total} waits at {shop}", When the nudge is built, Then the placeholders are replaced.
- **Source refs:** app/Http/Controllers/StorefrontPublicController.php (abandon), app/Services/Storefront/StorefrontCartService.php, app/Models/StorefrontCartRecovery.php, resources/views/storefront/_shared.blade.php (fireAbandon), database/migrations/2026_06_02_180000_create_storefront_cart_recoveries_table.php.
- **Port notes:** table `storefront_cart_recoveries` exists in the draft migration. Replace the Node one-off scheduler with a BullMQ delayed job (`storefront.cart-recovery.send`) in the worker, sending through the channel provider port; cancel the job by id on order. Add a status transition to `sent` when the job fires and let a new recovery start after that (fixes the stuck-active quirk). Depends on devices/WABA and the message-sending domain.

### WD-STORE-016 — Review submission (pending moderation)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-STORE-010
- **Summary:** a buyer can post a 1-5 star review with a name and optional text from the product page; it is stored as pending and only shows after a merchant approves it in `/store/reviews` (CAT/CHK).
- **Actors & access:** anonymous; CSRF-exempt, 10 requests per minute per client. Shop must be enabled.
- **UX & screens:** the "Write a review" form on the product page: name input (max 120), rating select (5 Excellent ... 1 Bad, default 5), textarea (max 1000, optional), message line and "Submit review". Empty name -> "Please add your name." (client only). Success message from the server ("Thanks! Your review will appear once approved."), name and body cleared.
  Failure shows the server message or "Could not submit your review." / "Network error. Please try again.".
- **Endpoints:**

| METHOD uri           | route name               | Controller@action                       | middleware         | request fields                                                            | response                                                                             |
| -------------------- | ------------------------ | --------------------------------------- | ------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| POST s/{slug}/review | storefront.public.review | StorefrontPublicController@submitReview | web, throttle:10,1 | product_id int req; name req max 120; rating int 1..5 req; body? max 1000 | `{ok:true, message}`; 422 `{ok:false, message:"Unknown product."}`; 404 `{ok:false}` |

- **Data:** writes `wa_product_reviews` (`workspace_id`, `storefront_id` = this shop, `product_id`, `customer_name`, `rating`, `body`, `status='pending'`, `order_id` null). Reads `wa_products`.
- **Rules & edge cases:**
  1. The product must belong to the shop's workspace (any status or stock; soft-deleted excluded) else 422 "Unknown product.". It is not required to be one the buyer purchased (`order_id` is never set, so there is no verified-purchase badge).
  2. No duplicate protection, no profanity filter, no IP/email capture, no link to the buyer; the throttle is the only abuse control.
  3. Text is stored raw and rendered escaped.
  4. Status values: `pending | approved | rejected`; only `approved` reviews are public (WD-STORE-010).
  5. No notification to the merchant; the sidebar's Reviews badge counts pending.
- **Async & events:** none (no notification).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a valid product id, name "Asha", rating 4 and a body, When posted, Then a `pending` review row exists and the response is `ok:true` with the thanks message.
  - Given rating 6 or 0, When posted, Then 422 validation error.
  - Given a product id from another workspace, When posted, Then 422 "Unknown product.".
  - Given a pending review, When the product page loads, Then it is not shown; after approval it is.
  - Given 11 posts in a minute from one client, When the 11th arrives, Then it is throttled.
- **Source refs:** app/Http/Controllers/StorefrontPublicController.php (submitReview), app/Models/WaProductReview.php, resources/views/storefront/_shared.blade.php (submitProductReview), routes/web.php:175-176.
- **Port notes:** reviews are owned by CAT (`wa_product_reviews`); expose this public POST in the storefront module and call CAT's `submitReview`. Add a notification event for new pending reviews (improvement) and a dedupe on (product, name, body) per IP window.

### WD-STORE-017 — Order tracking page

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-STORE-013
- **Summary:** a read-only, no-login page for the buyer showing order progress, items, totals, delivery address, a "Pay now" button when a payment link exists and a button to message the shop. The 40-character token in the URL is the only access control.
- **Actors & access:** anyone holding the link (included in the WhatsApp hand-off message and the "Order placed" modal). The shop must exist and be **enabled** (a disabled shop makes the page 404). `noindex`.
- **UX & screens:** `resources/views/storefront/order-status.blade.php`, a standalone narrow page (560px column, system font stack, light grey background, white rounded cards, brand colour accents). Top bar: logo (or first letter of the shop name in a coloured square), shop name, heading "Order #<id>", a status pill (capitalised status).
  Card 1: a four-step tracker Placed, Confirmed, Paid, Shipped with filled dots up to the current step; for a cancelled order instead "This order was cancelled. Contact us if that's unexpected.". Card 2: item rows (thumbnail or icon, name, "Qty n · unit price", line total), then Subtotal, Shipping ("Free" when 0), Total (the order's stored total).
  Card 3 (only if an address exists): "Delivery to" with name and address. Buttons: "Pay now" (only when the order has a payment link and is not paid) and "Message us about this order" (wa.me with "Hi! About my order #<id>", only when the shop has a number). Footer line (shop footer text or copyright).
- **Endpoints:**

| METHOD uri                 | route name              | Controller@action                      | middleware | request fields | response                              |
| -------------------------- | ----------------------- | -------------------------------------- | ---------- | -------------- | ------------------------------------- |
| GET s/{slug}/order/{token} | storefront.public.order | StorefrontPublicController@orderStatus | web        | none           | HTML page; 404 for unknown shop/order |

- **Data:** reads `wa_storefronts` (slug, enabled), `wa_orders` (by `storefront_id` and `recovery_token`), WhatsApp number. No writes.
- **Rules & edge cases:**
  1. Lookup requires the order to belong to this shop and match the token exactly; any mismatch -> 404.
  2. Step index = position of the status in [new, confirmed, paid, shipped]; **any other status** (`pending`, `processing`, `completed`) shows the tracker at the first step, QUIRK: a completed order looks like it was just placed. `cancelled` shows the message.
  3. "Subtotal" is computed as total minus shipping, so with a coupon it shows the **discounted** subtotal and the discount itself is not displayed.
  4. Money uses the order's own currency (default INR) with the shared currency formatter; the unit price shown is each line's stored price.
  5. The payment link is whatever the merchant minted/pasted (WD-STORE-018); the page does not poll for payment: refreshing shows the new status.
  6. The pill shows the raw status word capitalised.
  7. No rate limit on this route (only the unguessable token).
  8. Parity run: the page is standalone and the same in every theme; its 404 is the platform "Page not found" screen. The footer line has WaDesk's 20px top and 13px bottom margin.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an order with status `confirmed`, When the tracking link is opened, Then steps Placed and Confirmed are marked done and Paid/Shipped are not.
  - Given a cancelled order, When opened, Then the cancelled message shows instead of the tracker.
  - Given a wrong token, When opened, Then 404.
  - Given an order of a different shop with the right token, When opened under this shop's slug, Then 404.
  - Given a payment link and a status other than paid, When opened, Then the "Pay now" button shows; Given status paid, Then it is hidden.
  - Given a disabled shop, When opened, Then 404.
- **Source refs:** app/Http/Controllers/StorefrontPublicController.php (orderStatus), resources/views/storefront/order-status.blade.php, routes/web.php:170-171.
- **Port notes:** public read endpoint `GET /public/shops/:slug/orders/:token` returning a safe projection (no phone, email or internal ids); store the token as a separate indexed column (the CHK schema keeps `recovery_token`) and compare in constant time. Map every CHK status to a tracker position (fix the quirk).

### WD-STORE-018 — Payment-link minting and Razorpay webhook auto-confirm

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-STORE-008, WD-CHK orders
- **Summary:** with the merchant's own Razorpay keys the system can create a real payment link for an order and mark the order paid automatically when Razorpay notifies the platform. Minting is invoked from the orders screens (CHK); the webhook and the service live in this domain.
- **Actors & access:** minting: workspace admin from `/store/orders/{id}/generate-payment-link` (CHK route). Webhook: Razorpay (public, CSRF-exempt, authenticated only by an HMAC signature header, excluded from maintenance mode).
- **UX & screens:** no screen here; CHK's order page shows the link; the buyer sees "Pay now" on the tracking page (WD-STORE-017). The settings page tells the merchant which webhook URL and event to configure (WD-STORE-008).
- **Endpoints:**

| METHOD uri                   | route name             | Controller@action                           | middleware | request fields                                                                 | response                                                                                                                                                                                |
| ---------------------------- | ---------------------- | ------------------------------------------- | ---------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST webhooks/storefront-pay | storefront.pay.webhook | StorefrontPaymentController@razorpayWebhook | web        | raw JSON body, header `X-Razorpay-Signature` (HMAC-SHA256 hex of the raw body) | 200 `{ok:true, order:<id\|null>}` or `{ok:true, ignored:<event>}`; 400 `{ok:false}` invalid JSON; 404 `{ok:false, error:"storefront_unknown"}`; 400 `{ok:false, error:"bad_signature"}` |

- **Data:** reads `wa_storefronts` (`payment_provider`, `payment_config_json`); reads/writes `wa_orders` (`status`, `payment_link`, `meta_json`). Mint call stores `payment_link` and `meta_json.payment_link_id` (CHK side).
- **Rules & edge cases:**
  1. **Minting** (service): only when provider is `razorpay_api` with key id and key secret present; amount must be at least 100 minor units (Razorpay minimum) else no link; request to Razorpay "payment links": amount, currency (order currency, default INR), no partial payments, reference id `WAORD-<order id>`, description "Order #<id> · <shop name>",
     customer (name, contact, email when present), Razorpay's own SMS/email notifications **off** (delivery is by WhatsApp), reminders off, `notes` with the order id, shop id and workspace id, a callback URL and GET callback method. Returns the short URL and link id; any non-2xx/exception -> null (the caller answers 502 "Could not create the payment link. Check your Razorpay keys."), timeout 20 s.
     The caller (CHK) answers 422 "Add your Razorpay API keys in Storefront settings (Payment) to auto-generate links, or paste one manually." when keys are missing, saves the link on the order and WhatsApps "Hi <name>, here's your secure payment link for _<total>_: <url>" from the shop's own number.
  2. QUIRK: the callback URL is built as `<shop base>/order/<token>`, where for a verified custom domain the base is the bare domain, producing `https://<domain>/order/<token>` which is **not a route** (the tracking page is `/s/<slug>/order/<token>`); on the default URL it is `<app url>/s/<slug>/order/<token>` and works. The port must build the correct URL.
  3. **Webhook:** (a) body must be JSON else 400. (b) The shop is found from the event's `payment_link` (else `payment`) entity `notes.storefront_id` **before** the signature is verified; unknown -> 404. (c) Signature: HMAC-SHA256 of the raw body with the shop's decrypted **webhook secret**, compared in constant time with the header; a missing secret or missing header **fails closed** (400
     `bad_signature`, a warning is logged). (d) Events `payment_link.paid`, `payment.captured`, `order.paid` apply; every other event is acknowledged `{ok:true, ignored:<event>}` so Razorpay stops retrying.
  4. Applying: the order id comes from `notes.wa_order_id`, else the digits of `reference_id`; no id -> null; order not found -> null (still 200 with `order:null`). If the order is already `paid` it is returned unchanged (idempotent). Otherwise status becomes `paid`, `payment_link` is set to the entity's short URL when present, and `meta_json` gains `paid_via='razorpay_link'`,
     the Razorpay payment id and payment-link id. The `order.paid` event carries no matching entity, so it yields `order:null` and changes nothing.
  5. QUIRK (security): the order is looked up by id alone; it is **not checked** that it belongs to the shop whose secret signed the request. A merchant with a valid secret (their own shop) could mark another workspace's order paid by forging the notes. The port must require the order's shop/org to match the verified shop.
  6. No amount or currency verification, and no status guard: a `cancelled` order is flipped to `paid` and a paid event for a partial amount still confirms in full.
  7. Triggers CHK observers on status change (invoice generation, HubSpot stage, group notification).
  8. The route runs under the `web` group but is CSRF-exempt and excluded from the maintenance middleware (`webhooks/*`).
- **Async & events:** inbound Razorpay webhook (retries on non-2xx); outbound WhatsApp message with the link (CHK); status-change observers (CHK). Process the webhook idempotently (Razorpay can deliver the same event several times).
- **External systems:** Razorpay REST `https://api.razorpay.com/v1/payment_links` (HTTP basic auth with the merchant key id/secret, per-shop credentials in `payment_config_json`); Razorpay webhooks (signature header `X-Razorpay-Signature`). No platform-level Razorpay account is used.
- **Settings:** per shop key id, key secret, webhook secret (WD-STORE-008); `app.url` for the callback.
- **Acceptance criteria:**
  - Given a body signed with the shop's webhook secret and event `payment_link.paid` whose notes reference an order, When posted, Then the order becomes `paid`, `meta_json` records the payment ids and the response is `{ok:true, order:<id>}`.
  - Given the same event delivered twice, When posted again, Then the order is unchanged and the response is still `ok:true`.
  - Given a wrong signature, When posted, Then 400 `bad_signature` and no order changes.
  - Given a shop with no webhook secret stored, When any signed body is posted, Then 400 `bad_signature` (fail closed).
  - Given a notes `storefront_id` that does not exist, When posted, Then 404 `storefront_unknown`.
  - Given event `payment.failed`, When posted with a valid signature, Then `{ok:true, ignored:"payment.failed"}` and no change.
  - Given an order whose total is 50.00 minor 5000 and a provider `razorpay_api` shop, When a link is minted, Then Razorpay receives amount 5000, the order's currency, reference `WAORD-<id>` and notes with the ids; Given total 0.50, Then no link is created.
  - Given a paid event whose order belongs to a different shop than the signing shop, When posted, Then (WaDesk) it is applied; the port rejects it.
- **Source refs:** app/Http/Controllers/StorefrontPaymentController.php, app/Services/Storefront/StorefrontPaymentService.php, app/Http/Controllers/WaOrderController.php:183-235 (CHK caller), routes/web.php:213-215, bootstrap/app.php:356-357, app/Http/Middleware/Maintenance.php:94.
- **Port notes:** use the `webhook-handler` pattern (verify signature on the raw body, persist the delivery, process in a worker, dedupe by Razorpay event/payment id) and a Razorpay adapter behind a payment-link port (`provider-adapter`); per-shop credentials from the shop row. Resolve the org through a privileged lookup by shop id, then verify the order's org/shop equals it. Verify amount and currency
  equal the order total before flipping to paid and refuse cancelled orders. Public path `POST /webhooks/storefront-pay` should stay the same so already-configured Razorpay dashboards keep working. Webhook secrets stay per shop.

### WD-STORE-019 — RTO risk scoring

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-STORE-013
- **Summary:** every cash-on-delivery storefront order gets a 0-100 "return to origin" risk score and a band so the merchant can triage risky orders before shipping.
- **Actors & access:** computed automatically at checkout; shown by the orders screens (CHK).
- **UX & screens:** none in this domain (the orders list/detail show score and band).
- **Endpoints:** none (internal service called by checkout).
- **Data:** reads `wa_orders` of the workspace (same phone, statuses, average total); writes `rto_score` (int) and `rto_band` (`low|medium|high`) on the new order. Reasons are computed but **not stored**.
- **Rules & edge cases:**
  1. Applies only when `payment_method = cod`; otherwise both fields stay null.
  2. Inputs: digits-only phone, order total (after discount, including shipping), workspace history.
  3. Points: no prior order for the phone **+30** ("First-time buyer"); else if no prior order is `shipped` or `paid` **+18** ("No previously fulfilled order"). Prior cancelled orders: **+15 each, capped at +30**; otherwise if there are two or more fulfilled (`shipped`/`paid`) prior orders **-15** (floor 0, "Repeat customer"). Order value
     above 2x the workspace average (average of all positive totals in the workspace) **+25**, above 1.5x **+12** (only when an average exists). Phone shorter than 8 digits **+15**. The final score is clamped 0..100.
  4. Bands: score >= 60 high; >= 30 medium; else low.
  5. QUIRK: the history query matches `customer_phone` equal to the **digits-only** phone, but storefront orders store the phone with its leading `+` when one was typed; those orders never match, so a returning buyer who types a plus is scored as first-time. Orders from other channels are matched when stored as digits.
  6. The average includes all channels and all statuses.
  7. Delivered is approximated by `shipped` or `paid`; statuses `completed`/`processing` are not counted as fulfilled.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none (thresholds are constants).
- **Acceptance criteria:**
  - Given a new phone and a COD order at the store average, When scored, Then the score is 30 and the band `medium`.
  - Given a phone with two `paid` prior orders and a normal total, When scored, Then 0 (floor) and `low`.
  - Given a phone with two cancelled prior orders and no fulfilled orders, When scored, Then 18 + 30 = 48, `medium`.
  - Given a total of 2.5x the average from a new phone with 7 digits, When scored, Then 30 + 25 + 15 = 70, `high`.
  - Given a prepaid order, When placed, Then `rto_score` and `rto_band` are null.
- **Source refs:** app/Services/Storefront/StorefrontRiskService.php, app/Services/Storefront/StorefrontCheckoutService.php:101-105.
- **Port notes:** pure function in the storefront module taking a history summary from CHK's order query service; normalise phones consistently (E.164) so the lookup works; consider storing reasons (improvement); thresholds as constants with unit tests. Counts "completed" as fulfilled (recommended).

### WD-STORE-020 — Storefront daily view counter

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-STORE-009
- **Summary:** one row per shop per day counts page views of the public home and product pages; the dashboard sums the last 30 days as "Visits".
- **Actors & access:** automatic on every public page render; read by the dashboard.
- **UX & screens:** only the "Visits (30d)" tile (WD-STORE-001).
- **Endpoints:** none.
- **Data:** `wa_storefront_views` (`storefront_id`, `day` date, `views` unsigned int default 0; unique on shop + day; no timestamps).
- **Rules & edge cases:**
  1. Incremented on a full render of the home page and the product page, **not** on the show-more partial, the order tracking page, API posts or bots excluded (no bot filtering, no uniqueness per visitor: every refresh counts).
  2. Implementation: try to insert (shop, today, 1); on any exception (the unique key) increment the existing row. Errors of any kind are swallowed so analytics never break the page. The day is the server's current date in the app time zone.
  3. Deleting a shop does not delete its view rows in MySQL (no FK); the Postgres draft cascades.
  4. The dashboard sums `views` for the workspace's shop ids where `day >= today - 30 days`.
- **Async & events:** none (synchronous DB write per request; consider batching).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given no row for today, When a home page is rendered, Then a row with 1 is created.
  - Given a row with 4 for today, When the product page renders, Then the row is 5.
  - Given a show-more partial request, When served, Then no counter changes.
  - Given a database failure on the counter, When a page renders, Then the page still renders.
- **Source refs:** app/Http/Controllers/StorefrontPublicController.php (trackView), app/Http/Controllers/StoreController.php (stats), database/migrations/2026_06_02_160000_storefront_growth_tables.php.
- **Port notes:** `INSERT ... ON CONFLICT (org_id, storefront_id, day) DO UPDATE SET views = views + 1` (the draft migration has the unique key); prefer buffering increments in Redis and flushing from a worker to avoid a hot row; consider bot filtering.

### WD-STORE-021 — Host-based storefront resolution and root-route behaviour

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-STORE-007
- **Summary:** pointing a domain or subdomain at the platform makes the **root** of that host serve the shop instead of the marketing homepage. The slug path `/s/{slug}` always works regardless of host.
- **Actors & access:** public. Runs on every request to the home route; also used by the public POST routes when no slug is in the URL (not used by the registered routes).
- **UX & screens:** none.
- **Endpoints:** the root route `GET /` (`frontend.home`, `FrontendController@home`, domain `marketing-site-cms`) delegates here; this domain owns the resolver `StorefrontPublicController::storefrontForHost`.
- **Data:** reads `wa_storefronts` (`custom_domain`, `custom_domain_verified`, `enabled`, `slug`), `workspaces` (`custom_domain`, `cname_verified`).
- **Rules & edge cases:**
  1. Resolution order for a request host (lower-cased) when no slug is given: **(1)** a shop whose `custom_domain` equals the host **and** is verified **and** enabled; **(2)** a workspace whose workspace-level `custom_domain` equals the host with `cname_verified`, then that workspace's **first enabled shop**
     (unordered `first()`); **(3)** if the host ends with `.<host of APP_URL>`, the left part is taken as a slug and the enabled shop with that slug is used (a multi-label left part such as `a.b` is looked up as slug `a.b` and fails); else null.
  2. QUIRK: the subdomain match is against the **APP_URL** host, not `STOREFRONT_HOST`, while the shop's advertised public URL uses `STOREFRONT_HOST` (WD-STORE-022). The two agree only when STOREFRONT_HOST is unset or equal to the app host (in which case the public URL falls back to the path form). A deployment that sets STOREFRONT_HOST to a different parent domain would advertise subdomain
     URLs that the resolver never serves.
  3. The home route calls the resolver first, **before** the marketing kill-switch, so shops keep working when the marketing site is disabled; if a shop is found it renders the shop home exactly like `/s/{slug}` (including the view counter). If none is found and the request is on a white-label tenant domain (`ResolveTenantDomain`, workspaces domain) the user is sent to `/dashboard`
     (signed in) or to login; else the normal marketing homepage logic runs. The resolver swallows exceptions and returns null (never a 500).
  4. The app host itself (`host == APP_URL host`) matches no storefront (the custom-domain and workspace lookups run but find nothing; the subdomain rule needs a leading dot).
  5. The shop's other pages on a custom domain work through the path form on the same host (`/s/<slug>/p/<product>`, `/s/<slug>/order/<token>`) because all links are built from the request host and `/s/` paths; there is no host-only `/p/<slug>` route registered (see WD-STORE-010 quirk).
  6. Tenant middleware (`ResolveTenantDomain`, global web middleware) additionally locks logged-in sessions on a verified workspace custom domain to that workspace; unrelated hosts pass through untouched.
  7. Matching is exact-string on the stored lower-case domain; the wizard/settings regex only allows lower-case domains so it is consistent.
  8. Each home request on a non-app host costs up to three queries.
- **Async & events:** none.
- **External systems:** DNS/TLS for the customer's domain is infrastructure.
- **Settings:** `APP_URL`, `STOREFRONT_HOST`, `STOREFRONT_CNAME_TARGET` (config/storefront.php).
- **Acceptance criteria:**
  - Given a shop with verified custom domain `shop.acme.com` and enabled, When `GET /` arrives with that Host, Then the shop home is rendered (not the marketing page).
  - Given the domain is set but unverified, When `GET /` arrives with that Host, Then the marketing/tenant fallback applies, not the shop.
  - Given an enabled shop with slug `acme` and `APP_URL` host `app.example.com`, When `GET /` arrives for `acme.app.example.com`, Then the shop is rendered.
  - Given a disabled shop, When its host or slug is requested, Then it is not served (404 on the slug route).
  - Given a workspace with a verified workspace-level custom domain and an enabled shop, When `GET /` arrives with that host, Then that shop is rendered.
  - Given the app host itself, When `GET /` arrives, Then the marketing homepage is shown.
- **Source refs:** app/Http/Controllers/StorefrontPublicController.php (storefrontForHost, resolveStorefront), app/Http/Controllers/FrontendController.php:23-60, app/Http/Middleware/ResolveTenantDomain.php, routes/web.php:118, config/storefront.php.
- **Port notes:** a Next.js middleware (or edge function) maps the Host header to a shop via a public lookup endpoint `GET /public/hosts/:host` (cached), rewriting `/` to the shop route; fix the STOREFRONT_HOST/APP_URL mismatch by using one configured storefront base domain for both advertising and resolving. Marketing-site domain keeps `/`. The workspace-level custom domain belongs to the workspaces domain; consume it via
  a service call.

### WD-STORE-022 — Public URL computation and sharing

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-STORE-021
- **Summary:** one function decides the link buyers get for a shop: the verified custom domain, else a subdomain of the configured storefront host, else the path form `/s/<slug>` on the current origin. The result is shown in the wizard, the sidebar, share dialogs and used by the Meta catalog sync, team-inbox "send store link" and product share links.
- **Actors & access:** internal; shown to merchants.
- **UX & screens:** list cards, wizard preview, sidebar URL box, share modals.
- **Endpoints:** none.
- **Data:** reads `custom_domain`, `custom_domain_verified`, `slug`, config `STOREFRONT_HOST`, `APP_URL`.
- **Rules & edge cases:**
  1. Custom domain set **and** verified -> `https://<domain>` (always https).
  2. Else if `STOREFRONT_HOST` is set, is not `localhost`, is not equal to the APP_URL host and is not a raw IPv4 (checked on the part before any colon) -> `https://<slug>.<STOREFRONT_HOST>`.
  3. Else path mode: the **live request's root** plus `/s/<slug>` (so a user browsing by IP or from a sub-folder deployment sees the origin they are on); in console/queue contexts the root falls back to `APP_URL`.
  4. `STOREFRONT_HOST` default = the APP_URL host (so by default a fresh install is path mode).
  5. Consumers: wizard list and edit (View shop, Preview, Share), sidebar public URL box, abandoned-cart message (separately builds `https://<verified domain>` else `<app url>/s/<slug>`, ignoring subdomain mode), Meta catalog sync (`product.url = <shop url>/p/<product slug>` using the **newest** shop of the workspace by id), the product "share links" API (the **first** shop), the team-inbox "send storefront link"
     action (newest shop, error "No storefront set up — create one at /connect?platform=wa-store first." when none), the WhatsApp-shop checkout link builder (first enabled shop; refuses when none) and the Sheets add-on shop list.
  6. QUIRK: those consumers disagree about which shop is "the" shop of a multi-shop workspace (first, newest by id, first enabled).
  7. A subdomain URL is only served if the resolver agrees (WD-STORE-021 quirk 2).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `STOREFRONT_HOST`, `APP_URL`.
- **Acceptance criteria:**
  - Given a verified domain `shop.acme.com`, When the URL is computed, Then `https://shop.acme.com`.
  - Given an unverified domain and `STOREFRONT_HOST=shops.example.com`, When computed for slug `acme`, Then `https://acme.shops.example.com`.
  - Given `STOREFRONT_HOST` unset or `localhost` or an IP, When computed, Then `<current origin>/s/acme`.
  - Given a queue job (no request), When computed in path mode, Then the origin is `APP_URL`.
- **Source refs:** app/Models/WaStorefront.php (getPublicUrlAttribute), config/storefront.php, app/Services/WhatsAppCatalog/CatalogSyncService.php:78,124, app/Http/Controllers/WaProductController.php:110,159, app/Http/Controllers/TeamInboxController.php:3620, app/Services/Commerce/WhatsappShopCheckoutLinkBuilder.php, app/Http/Controllers/Api/SheetsAddonController.php:78-110.
- **Port notes:** a `ShopUrlService.publicUrl(shop)` exported from the storefront module for CAT, the inbox and flows; one config for the storefront base domain; define which shop is the workspace default (add an `is_default` flag or "oldest enabled") and use it everywhere.

### WD-STORE-023 — Store sidebar entries for sibling domains

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-STORE-002
- **Summary:** the store navigation links to pages owned by other domains. This feature records where each link goes, its badge and which gate protects the target, so the port builds the navigation but not the pages.
- **Actors & access:** admin/owner (all `/store/*` routes are `workspace.role:admin`).
- **UX & screens:** order of entries and badge source:

| Label                 | Target route (name)                       | Badge                                      | Gate on target                     | Owning domain |
| --------------------- | ----------------------------------------- | ------------------------------------------ | ---------------------------------- | ------------- |
| Overview              | `/store` (user.store.index)               | none                                       | admin                              | STORE         |
| Orders                | `/store/orders` (user.store.orders.index) | count of all orders                        | admin                              | CHK           |
| Products              | `/store/products`                         | count of all products                      | admin                              | CAT           |
| Groups                | `/store/groups`                           | count of WhatsApp groups                   | admin                              | CHK           |
| Storefront            | `/store/storefront`                       | none                                       | admin                              | STORE         |
| Coupons               | `/store/coupons`                          | count of all coupons                       | admin                              | CHK           |
| Reviews               | `/store/reviews`                          | count of **pending** reviews               | admin                              | CAT           |
| Payments              | `/store/payments`                         | count of workspace payment configs         | admin + plan `access_whatsapp_pay` | CHK           |
| Checkout gateways     | `/store/gateways`                         | count of active workspace-default gateways | admin                              | CHK           |
| Customers             | `/store/customers`                        | count of customer profiles                 | admin                              | CHK           |
| Invoices              | `/store/invoices`                         | none                                       | admin + plan `auto_invoice`        | CHK           |
| Connection (Settings) | `/connect?platform=wa-store`              | none                                       | any member                         | STORE         |

- **Endpoints:** none owned here (the sibling routes belong to CHK/CAT and are out of scope for this inventory: orders, products, customers, groups, coupons, reviews, payments, gateways, invoices).
- **Data:** counts as listed (read only).
- **Rules & edge cases:**
  1. The sidebar shows **every** entry regardless of plan: Payments and Invoices are displayed even when the plan lacks the flag, and the click then bounces (the route's plan middleware answers). The app's header navigation (separate, `UserNav`) shows "Store" for the admin tier and "Catalog" only with `access_wa_storefront`.
  2. Orders badge counts every order (all statuses, all sources); Groups counts the workspace's WhatsApp groups; Gateways counts only active ones with no shop scope.
  3. Entry order is fixed as above; Invoices and Connection are appended after the main loop.
  4. The Reviews badge is the moderation backlog, not the review total.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 4 orders and 2 pending reviews, When the sidebar renders, Then Orders shows 4 and Reviews shows 2.
  - Given a plan without `auto_invoice`, When the sidebar renders, Then the Invoices link is still listed and the target route is refused by the plan guard.
  - Given zero products, When rendered, Then no Products badge appears.
- **Source refs:** resources/views/user/store/_sidebar.blade.php, routes/web.php:938-1000, app/Support/UserNav.php:248-258, app/Support/QuickAccess.php:29.
- **Port notes:** nav config in `apps/web/src/features/storefront-builder/nav.ts` with a feature-flag/permission filter (improvement: hide links the plan does not unlock); counts via the sidebar summary endpoint.

### WD-STORE-024 — Plan and role gates for the store area

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** none
- **Summary:** records exactly which gates guard the store area so the port reproduces them (and decides where it deliberately tightens them).
- **Actors & access:** see the table.
- **UX & screens:** agents and viewers hitting a `/store` URL are redirected to `/team-inbox` with the warning "Your role (<role>) doesn't have access to that page."; managers get a 403 page with the same sentence; platform admins pass everything.
- **Endpoints:** (surface and gate matrix)

| Surface                                           | Role gate                    | Plan gate              | Other                                                                                  |
| ------------------------------------------------- | ---------------------------- | ---------------------- | -------------------------------------------------------------------------------------- |
| `/store`, `/store/storefront`, verify-domain      | admin (owner and admin pass) | none                   | redirect to the wizard when no shop exists                                             |
| `/connect?platform=wa-store`, save, reset         | **any signed-in member**     | none                   | view requires a connected number (WD-STORE-004); `storefronts_limit` never enforced    |
| `/store/orders`, products, coupons, ... (CHK/CAT) | admin                        | none (except below)    |                                                                                        |
| `/store/invoices`                                 | admin                        | `auto_invoice`         |                                                                                        |
| `/store/payments` (+ order whatsapp-pay action)   | admin                        | `access_whatsapp_pay`  |                                                                                        |
| `/catalog/*` (CAT)                                | admin                        | `access_wa_storefront` |                                                                                        |
| `/s/*`, `/webhooks/storefront-pay`                | none (public)                | none                   | throttles: checkout 20/min, coupon 30/min, review 10/min, abandon 30/min; webhook HMAC |

- **Data:** package flags `access_wa_storefront`, `auto_invoice`, `access_whatsapp_pay`, `storefronts_limit`; workspace roles owner > admin > manager > agent > viewer.
- **Rules & edge cases:**
  1. The public shop is available regardless of plan (a downgraded workspace keeps its public shop live; only the Catalog admin area is locked).
  2. `workspace.role:admin` lets platform admins through even when they are not members of the workspace being viewed.
  3. QUIRK: wizard writes (create, edit, delete a shop and all its orders) need no elevated role; an agent can do them.
  4. A user who is not a member of the current workspace is redirected to `/team-inbox`; a user with no workspace to the registration step.
  5. The plan flag `access_wa_storefront` is labelled "WhatsApp storefront" in the plan usage and plan form; no code ties it to `/store` or `/s`.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** package form fields (admin domain `plans-subscriptions-trials`).
- **Acceptance criteria:**
  - Given an agent, When they open `/store`, Then they are redirected to the team inbox with the warning.
  - Given a manager, When they open `/store/storefront`, Then 403.
  - Given an admin on a plan without `access_wa_storefront`, When they open `/store`, Then it works (only `/catalog` is blocked).
  - Given any anonymous visitor, When they open `/s/<slug>` of an enabled shop, Then it renders regardless of the owner's plan.
  - Given a signed-in agent, When they post a wizard save, Then (WaDesk) it succeeds; the port requires an admin permission.
- **Source refs:** routes/web.php:925-940, 1099, app/Http/Middleware/EnsureWorkspaceRole.php, app/Support/UserNav.php:248-258, app/Models/Package.php:136-149, app/Services/PlanUsage.php:52.
- **Port notes:** express as RBAC keys (e.g. `storefront.manage`, `storefront.view`) via the `rbac-permission` skill and the shared plan-feature guard; decide whether to start enforcing `storefronts_limit` (recommended). Public endpoints never take a session.

### WD-STORE-025 — Legacy "coming soon" store page

- **Status:** dead-code
- **Priority:** P2
- **Effort:** S
- **Depends on:** none
- **Summary:** an old placeholder view "Your store is being set up" that lists the connected provider and the storefront slug and promises a dashboard "in the next update". Nothing renders it any more.
- **Actors & access:** none (unreachable).
- **UX & screens:** `resources/views/user/store/coming-soon.blade.php`: title "Your store is being set up", a Provider card (provider label and status, or "Not connected" with a link to `/connect`), a Public storefront card (slug and public URL, or "Storefront row will appear once you connect a provider"), and two lists "What works right now" and "Coming in the next update"
  (the full dashboard, product CRUD, theme picker, public route, orders inbox).
- **Endpoints:** none (no route or controller returns it).
- **Data:** none.
- **Rules & edge cases:** the copy is stale (all the promised features now exist). Do not port.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the whole route table, When searched for any use of this view, Then none exists (the port needs no equivalent).
  - Given a user with a workspace and no shop, When they open `/store`, Then they see the wizard, not this page.
  - Given the port's page list, When reviewed, Then no "coming soon" store page is present.
- **Source refs:** resources/views/user/store/coming-soon.blade.php (no referencing code found in app/ or routes/).
- **Port notes:** skip; listed for coverage.

### WD-STORE-026 — Buyer wishlist, compare, quick view and share (browser only)

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** WD-STORE-011
- **Summary:** small buyer conveniences held entirely in the browser: a heart wishlist, a compare list of up to four products with a side-by-side drawer, a quick-view modal, and a share dialog for a product or the shop.
- **Actors & access:** anonymous buyer; no server calls.
- **UX & screens:** header icon buttons with count badges (hidden at 0, bump animation); drawers and a sticky bottom compare bar.
  - **Wishlist:** heart on cards and product page toggles the product id in `sf_wish_<shopId>`; toasts "Added to wishlist ♡" / "Removed from wishlist"; the Wishlist drawer lists items known to the page (image, name link, price, "Add to cart", remove x); empty state "No favourites yet — Tap the heart on any product to save it for later." Wishlisted ids of products not present in the current page's catalog map are counted in the badge but not listed.
  - **Compare:** icon on the product page adds/removes (max 4; on the fifth a modal "Compare full — You can compare up to 4 products at once. Remove one from the compare bar to add a new one."); a sticky bar with chips (thumbnail, name, x) and a "Compare ->" button; drawer (680px) with a table, rows Image, Name (link), Price, SKU, Category, Description (blank = dash), a remove x per column; empty "Nothing to compare ...".
    Note the compare toggle button exists on the product page only (cards have none).
  - **Quick view:** the eye button on a card opens a modal with the image, price (compare-at struck), description and "Add to cart" plus "Full details ->".
  - **Share:** the product page share button opens a modal with the URL and Copy ("Copied ✓" for 1.5 s), WhatsApp (`wa.me/?text=`), Email (`mailto:`), Telegram (`t.me/share/url`), "More…" (the phone's native share sheet, falling back to copy + toast "Link copied"), and a "Show QR code" disclosure with a QR image.
  - Toast: bottom, 1.8 s. Escape closes overlays.
- **Endpoints:** none.
- **Data:** browser storage only (`sf_wish_`, `sf_compare_`; `sf_recent_` is written by a function nothing calls, so recently-viewed is dead).
- **Rules & edge cases:**
  1. QUIRK: the public share dialog renders the QR through a **third-party image service** (api.qrserver.com) with the page URL, leaking viewed URLs; the admin-side share modal (WD-STORE-030) renders QR locally. The port should generate it locally.
  2. Items are keyed by product id per shop; clearing site data clears them.
  3. Compare drawer shows only items present in the page's catalog map.
  4. Quick view works only for items in that map; show-more cards are not in the map, so their quick-view button does nothing (QUIRK) and their wishlist drawer entries do not resolve until the product page is opened.
- **Async & events:** none.
- **External systems:** `api.qrserver.com` (QR image), `wa.me`, `t.me`, `mailto`.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a heart click, When pressed twice, Then the product is added then removed and the badge shows 1 then 0.
  - Given four products in compare, When a fifth is added, Then the "Compare full" modal shows and the list stays at four.
  - Given a reload, When the page loads, Then the wishlist and compare badges restore from storage.
  - Given the quick-view button on a card in the first page, When pressed, Then the modal shows its image, price and add-to-cart.
  - Given the share modal, When Copy is pressed, Then the URL is on the clipboard and the label reads "Copied ✓".
- **Source refs:** resources/views/storefront/_shared.blade.php (toggleWish, toggleCompare, renderWishDrawer, renderCompareDrawer, openQuickView, share), _partials/card.blade.php, _partials/product.blade.php.
- **Port notes:** client-only components in the storefront bundle; embed the catalog data needed for all rendered cards (including later pages) so quick view and wishlist work after show-more; local QR generation.

### WD-STORE-027 — SEO and social metadata, JSON-LD

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-STORE-009, WD-STORE-010
- **Summary:** public shop pages carry a title, description, Open Graph and Twitter card tags so shared links render rich previews, and product pages add schema.org Product JSON-LD.
- **Actors & access:** crawlers and link unfurlers (public). The order tracking page is `noindex`.
- **UX & screens:** page head only.
- **Endpoints:** none (head of GET s/{slug} and GET s/{slug}/p/{productSlug}).
- **Data:** shop name, hero text, logo, product fields, ratings.
- **Rules & edge cases:**
  1. Title: shop name on the home; "<product> · <shop>" on a product page. Description = product description (else shop name) or hero text (else "<shop> on WhatsApp"), tags stripped, cut to 160 (200 for og). `og:type` website/product, `og:site_name`, `og:title`, `og:description`, `og:url` = full current URL, `og:image` = product image or the logo when present; `twitter:card` is `summary_large_image` with an image else `summary`.
  2. JSON-LD (product pages): `Product` with name, image list, description (500 chars), sku, brand (when set), an `Offer` with price as a decimal string, `priceCurrency` (product currency, else shop currency, else INR), availability InStock/OutOfStock from the product's effective availability, url, and an `AggregateRating` when at least one approved review exists. Null/empty keys removed.
  3. No canonical tag, no sitemap, no `robots` rules for the shop pages, no alternate language tags. Order tracking: `robots noindex`.
  4. The page is not server-cached; heavy crawling hits the database each time.
  5. Parity run: the shop pages carry only the tags above. The staff app's title suffix ("... - <platform>"), default `robots` and Open Graph block must not leak onto them (the metadata uses `absolute` titles and resets the inherited fields); the order page has only `noindex`. The JSON-LD is the same document, with `<` escaped as `\u003c`.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a product with an image, When its page is fetched, Then the head has og:image = that image and `twitter:card = summary_large_image`.
  - Given a product with 2 reviews averaging 4.5, When fetched, Then JSON-LD contains an AggregateRating with value 4.5 and count 2.
  - Given a product without a brand or SKU, When fetched, Then those keys are absent from JSON-LD.
  - Given the order tracking page, When fetched, Then it carries `noindex`.
- **Source refs:** resources/views/storefront/_theme-base.blade.php (head), order-status.blade.php (robots meta).
- **Port notes:** Next.js `generateMetadata` + a JSON-LD script; add canonical URLs and a per-shop sitemap (improvements).

### WD-STORE-028 — Static payment handle (UPI, links, bank transfer)

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-STORE-006
- **Summary:** the design page lets the merchant choose UPI, a pasted Razorpay link, a Stripe link, a PayPal.me handle or bank instructions and type one "payment detail". The UI promises the link is "appended to every WhatsApp order message", but since the server checkout replaced the message builder, that text is never produced.
- **Actors & access:** workspace admin.
- **UX & screens:** Payment section of the design page (WD-STORE-006): provider select and payment detail input (max 255).
- **Endpoints:** part of PUT store/storefront.
- **Data:** `payment_provider` in {upi, razorpay_link, stripe_link, paypal_me, bank_transfer}; `payment_config_json = {handle}`.
- **Rules & edge cases:**
  1. What actually uses it: the cart drawer caption "Pay via UPI/Razorpay/Card/PayPal/Bank transfer · Cash on delivery" (label by provider), and the handle plus provider are exposed to the browser object `SF_SHOP.payment`. The unused browser functions would have built a `upi://pay` deep link (VPA, shop name, amount, INR), a `paypal.me/<handle>/<amount>` link or returned the pasted URL as-is.
  2. The server checkout, the WhatsApp hand-off, the order and the tracking page never read the handle. The merchant must send the details manually in chat or paste a link via the order page (CHK).
  3. The default provider is empty ("None · cash on delivery").
  4. The provider `razorpay_api` is the only one with real behaviour (WD-STORE-008/018).
  5. The static handle is publicly readable in page source (not a secret).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** per shop provider and handle.
- **Acceptance criteria:**
  - Given provider UPI, When the shop page renders, Then the cart footer caption reads "Pay via UPI · Cash on delivery".
  - Given no provider, When rendered, Then the caption reads "Cash on delivery · Confirm in chat".
  - Given provider `bank_transfer` with a handle, When an order is placed, Then the order and hand-off message contain no payment details (WaDesk behaviour; the port may add them).
- **Source refs:** resources/views/user/store/storefront/edit.blade.php (Payment section), resources/views/storefront/_shared.blade.php (paymentLink, paymentInstructions - unused; cart drawer caption), _theme-base.blade.php (SF_SHOP).
- **Port notes:** decide whether to complete this: append the payment detail (UPI intent link, link URL, bank text) to the hand-off message and tracking page ("Pay now"), which is what the copy promises; otherwise label it clearly.

### WD-STORE-029 — Default shop auto-created on channel connect

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-STORE-003
- **Summary:** the moment a workspace connects a WhatsApp provider (Baileys device, Twilio, or WABA via the wa-store connect flow), a default shop is created for it if the workspace has none, so a public URL exists immediately.
- **Actors & access:** triggered by connecting a channel (domains `whatsapp-devices-baileys` / `whatsapp-cloud-api-waba`, routes `connect/wa-store/{baileys,twilio,waba}`).
- **UX & screens:** none; the wizard then shows the list instead of add mode.
- **Endpoints:** none owned (side effect of POST connect/wa-store/baileys, /twilio, /waba which belong to the channels domains).
- **Data:** inserts into `wa_storefronts` (`workspace_id`, `theme_key=aurora`, `enabled=true`) only when the workspace has **no** shop (`firstOrCreate` by workspace). The model's saving hook then fills the slug from the workspace name via the unique-slug helper (slug of the workspace name or "shop", suffix `-2`, `-3` until free across all shops). `shop_name` stays NULL (so labels fall back to the workspace name,
  and the list shows "Untitled shop"); `device_id` stays NULL.
- **Rules & edge cases:**
  1. Only when no shop exists; a workspace with shops is untouched.
  2. QUIRK: a default shop created this way has no bound device; the sending label then resolves to the workspace's official number or "No device" until the merchant edits the shop in the wizard.
  3. The saving hook also defaults an empty `theme_key` to aurora and an empty `slug` to a unique one for any code path that creates a shop without them (the Sheets add-on creates shops with its own slug loop).
  4. Slug uniqueness helper is global across workspaces.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a workspace named "Acme Traders" with no shop, When a WhatsApp number is connected, Then a shop with slug `acme-traders`, theme `aurora`, enabled and no name exists.
  - Given another shop already owns `acme-traders`, When the same happens, Then the slug is `acme-traders-2`.
  - Given a workspace that already has a shop, When another number is connected, Then no new shop is created.
- **Source refs:** app/Http/Controllers/WaConnectController.php:115,360,843-856, app/Http/Controllers/WaConnectWabaController.php:205, app/Models/WaStorefront.php (booted, uniqueSlug).
- **Port notes:** emit/consume an outbox event `channel.connected` in the storefront module to create the default shop (instead of the channel code calling storefront code directly); keep the slug rules.

### WD-STORE-030 — Shop share modal (admin side)

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-STORE-003
- **Summary:** the merchant shares the shop link from a modal reachable on every shop card and in the edit panel: copy, WhatsApp, Email, Telegram, the phone's share sheet and a locally generated QR code.
- **Actors & access:** any member who can open the wizard.
- **UX & screens:** `#share-modal` in `wa-store.blade.php`, logic in `resources/js/charts/user-connect-wa-store.js` (`wireShareModal`). Header "Share your shop" with the shop name and a close x; a read-only URL field with Copy ("Copied ✓" 1.5 s); four option tiles: WhatsApp (`https://wa.me/?text=Check out my shop: <name>\n<url>`), Email (subject "Check out my shop · <name>", body the same text),
  Telegram (`t.me/share/url?url=&text=`), "More…" (native share, dimmed with "Not supported on this browser" when unavailable, falls back to copy); a "Show QR code" disclosure with a 240px QR (error correction M, margin 1) generated in the browser with a bundled QR library, caption "Scan to open the shop". Escape or backdrop closes.
- **Endpoints:** none.
- **Data:** the shop's public URL and name from data attributes.
- **Rules & edge cases:** the shared URL is the shop's computed public URL (WD-STORE-022); QR generation failures leave the previous image; no server calls.
- **Async & events:** none.
- **External systems:** `wa.me`, `t.me`, `mailto`.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a shop card, When Share is pressed, Then the modal opens with the shop name and the public URL.
  - Given the modal, When Copy is pressed, Then the URL is copied and the button reads "Copied ✓" for about 1.5 seconds.
  - Given the modal, When "Show QR code" is opened, Then a QR encoding the shop URL appears.
  - Given Escape pressed, When the modal is open, Then it closes.
- **Source refs:** resources/views/user/connect/wa-store.blade.php (share-modal), resources/js/charts/user-connect-wa-store.js.
- **Port notes:** a small client component; local QR library.

### WD-STORE-031 — Catalog search, filter, sort, view toggle and show-more (browser)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-STORE-009
- **Summary:** instant client-side narrowing of the loaded product cards by text, category, price range, availability and sale flag, with sort and grid/list switching, plus lazy loading of the next page.
- **Actors & access:** anonymous buyer.
- **UX & screens:** `_partials/index.blade.php` script. Controls: header search box (matches the lower-cased product name by substring, applied live on input); Sort select (Featured = server order, Price low-high, Price high-low, Name A-Z, Name Z-A); grid/list toggle (list = single column with 220px square images); Filter sidebar (Category checkboxes from the facet, Price min/max number inputs
  with a "Range: <min> — <max>" hint, Availability "In stock only" (checked by default) and "On sale", "Reset filters"). Count text "<n> product(s)" updates; when nothing matches a "Nothing matches those filters" block with "Clear filters". Show more: button "Show more products" -> "Loading…" -> appends next cards; on error "Try again"; removed when no more pages.
- **Endpoints:** GET s/{slug}?page=N&partial=1 (WD-STORE-009).
- **Data:** card data attributes (name, category, price in minor units).
- **Rules & edge cases:**
  1. Filtering is only over the cards **already loaded** (up to 48 per page); there is no server-side search, so a product on page 3 cannot be found by search until "Show more" loads it. The count reflects only visible loaded cards.
  2. Price inputs are in major units (x100 to compare with minor prices); empty/NaN inputs are ignored; no validation of min > max.
  3. Multiple categories are OR; all other filters AND. "On sale" detects the crossed-out price element; "In stock only" detects the disabled add button (listing already only contains in-stock rows, see WD-STORE-009 rule 9).
  4. Sorting reorders loaded cards in the DOM (including hidden ones); price sorts numerically, name sorts with locale compare; Featured keeps the existing order (does not restore it after a sort: choosing another sort and back to Featured leaves the last sorted order, QUIRK).
  5. Cards appended by Show more join the filter set and get the active filters/sort applied; cart and wishlist behaviour re-render.
  6. The category facet and price range are computed from page 1 only (WD-STORE-009 rule 4), so categories that first appear on later pages are not filterable.
  7. Search input is shared with the header on every page but only has an effect on the home grid.
  8. Parity run: confirmed in the browser on the reference: "Featured" keeps the last sort order (reproduced), "In stock only" is a no-op (reproduced) and the "Range" hint reads `₹109.00 — ₹589.00`.
- **Async & events:** none besides the page fetches.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 10 loaded cards, When "shirt" is typed in search, Then only cards whose name contains it show and the count updates.
  - Given Price sort low-high, When selected, Then cards reorder ascending by price.
  - Given min 100 and max 500 (major units), When entered, Then only cards priced between 10000 and 50000 minor units show.
  - Given no card matches, When filters apply, Then the "Nothing matches those filters" block shows and "Clear filters" resets everything.
  - Given a shop with more than 48 products, When "Show more products" is pressed, Then the next cards append, the filters re-apply and the button disappears after the last page.
- **Source refs:** resources/views/storefront/_partials/index.blade.php (script and markup), _partials/_cards-only.blade.php.
- **Port notes:** consider server-side search/filter/sort with cursor pagination (the public products endpoint takes `q`, `category`, `min`, `max`, `sort`, `sale`) and return facets for the full catalog; keep client instant filtering as progressive enhancement. The Featured-keeps-last-sort quirk is kept for parity (rule 4).

## Data model

### wa_storefronts (tenant; 0 rows in the local reference DB)

Purpose: one row per shop. WaDesk columns: `id`, `workspace_id` (FK workspaces, cascade; NOT unique any more since the multi-shop migration, plain index), `device_id` (nullable, bound sending Baileys device; NULL = use the workspace's official number), `shop_name` varchar(191) null,
`slug` varchar(64) NOT NULL **globally UNIQUE**, `custom_domain` varchar(191) null **globally UNIQUE**, `custom_domain_verified` bool default false, `theme_key` varchar(32) default `aurora` (free-form key, not a DB enum; application whitelist of 8), `enabled` bool default true, `settings_json` json null,
`shipping_json` json null, `payment_provider` varchar null, `payment_config_json` json null, `currency_code` char/varchar(3) default `INR`, timestamps. Written by WD-STORE-003, 005, 006, 007, 008, 029; read by every public feature.

JSON shapes:

- `settings_json`: `{logo_url?, brand_color? (#RRGGBB), hero_text? (<=280, raw HTML in output), footer_text? (<=280), hero_sub? (unwritten), top_strip? (unwritten), cart_recovery_enabled (bool), cart_recovery_delay_min (int 5..1440), cart_recovery_message?}`.
- `shipping_json`: `{flat_minor? int, free_above_minor? int, note? <=160}`; keys with 0/blank omitted; the whole value NULL when empty. Footer/product copy wrongly reads `free_threshold`.
- `payment_config_json`: static providers `{handle}`; `razorpay_api` -> `{key_id, key_secret (encrypted), webhook_secret (encrypted)}`.

Our draft (migration 20261001101700_store_wadesk_schema.sql): same columns with `org_id` first (composite PK `(org_id, id)`), `uuid`, `row_version`, `jsonb`, `text` types, `UNIQUE (slug)` and `UNIQUE (custom_domain)` (global, not org-scoped), composite FK to `devices` (SET NULL on `device_id`), forced RLS with `tenant_isolation` policy and the `touch_row` trigger. No CHECK
on `theme_key`, `currency_code` or `payment_provider` (validate in the contracts layer). Slug is `text` with no length limit (add a 64-char check in validation). Needs: a case-insensitive unique index on `lower(custom_domain)` if mixed case is ever accepted; index on `(org_id)` exists via PK.

### wa_storefront_views (child; 0 rows)

`id`, `storefront_id`, `day` date, `views` unsigned int default 0, UNIQUE `(storefront_id, day)`, no timestamps in MySQL, no FK. Draft: with `org_id`, composite FK to `wa_storefronts` ON DELETE CASCADE, UNIQUE `(org_id, storefront_id, day)`. Written by WD-STORE-020, read by WD-STORE-001. Expected volume: shops x days (small); the write path is hot for busy shops.

### storefront_cart_recoveries (tenant; 0 rows)

`id`, `workspace_id`, `storefront_id`, `customer_phone` (digits), `customer_name` null, `items_json` (request items `[{id, qty}]`), `subtotal_minor` bigint, `currency_code`, `scheduled_ids` json (ids of the scheduled-message rows), `status` (`active` | `recovered`; nothing writes `sent` or `expired`), timestamps. Indexes on phone and shop in the draft. Written by WD-STORE-015; one active row per (shop, phone) by code
logic only (no unique index; add a partial unique index `WHERE status='active'` in the port).

### Tables owned elsewhere that this domain reads or writes

- `wa_orders` (CHK): written by checkout (columns listed in WD-STORE-013), read by the dashboard, RTO, tracking page, webhook; `storefront_id` FK NULL on delete; `recovery_token` 40 chars unique-in-practice (add a unique index).
- `wa_coupons` (CHK): read by quote and checkout; `used_count` incremented at checkout; columns `type` (percent|flat), `amount`, `min_subtotal_minor`, `max_discount_minor`, `free_shipping`, `active`, `starts_at`, `expires_at`, `usage_limit`, `used_count`, `storefront_id` (NULL = all shops).
- `wa_products` (CAT): read by the public pages and checkout (`price_minor`, `compare_price_minor`, `in_stock`, `stock_qty`, `slug`, `category`, `image_url`, `gallery_json`, `tags_json`, `sku`, `brand`, `weight_grams`, `body_html`, `description`, `currency_code`, `sort_order`, `meta_retailer_id`); `stock_qty` decremented by checkout.
- `wa_product_reviews` (CAT): inserted `pending` by the public review post; `approved` rows read on the product page.
- `scheduled_messages` (scheduled-queue-warmer): one row per recovery nudge.
- `devices`, `wa_provider_configs` (channel domains): sending number resolution; `workspaces` (custom domain, `cname_verified`).

## Cross-domain contracts

- **Consumes** `checkout-orders-merchant-payments` (CHK): an order-creation service (create order with the fields in WD-STORE-013), an order read model for the dashboard (30-day totals, items, 8 recent), an order-history summary per phone for RTO, a coupon service (`resolve`, `redeemable`, `discountFor`, increment used count), WhatsApp Pay auto-charge hook after checkout, and the payment-link caller (order page action)
  that uses this domain's mint service. CHK owns `/store/orders`, `/store/coupons`, `/store/customers`, `/store/gateways`, `/store/groups`, `/store/payments`, `/store/invoices` and `wa/checkout/return` and `wa/checkout/webhook`.
- **Consumes** `catalog-products` (CAT): public product projection (available products with pagination, by slug, related, stock), stock decrement, review submit/list (approved), the product share links, and the Meta catalog sync which needs this domain's `shopUrl(shop)`.
- **Consumes** `whatsapp-devices-baileys` / `whatsapp-cloud-api-waba`: connected-device list and the primary provider config for the wizard gate and the sending number; the engine of the workspace and the sender selection for recovery messages; they **call** this domain to create the default shop on connect (WD-STORE-029).
- **Consumes** `scheduled-queue-warmer`: delayed one-off WhatsApp text for cart recovery (WD-STORE-015).
- **Consumes** `workspaces-teams-tenancy`: workspace roles and the workspace-level custom domain (`custom_domain`, `cname_verified`) and `ResolveTenantDomain`; **consumes** `roles-permissions` for the admin gate; `plans-subscriptions-trials` for `access_wa_storefront`, `auto_invoice`, `access_whatsapp_pay`, `storefronts_limit`; `platform-settings-branding-storage` for the system `default_currency`.
- **Exposes** to `marketing-site-cms`: the host resolver `storefrontForHost(host)` and a "render shop home" function used when the root route's host matches a shop.
- **Exposes** to CAT, inbox, flows, Shopify/Woo link builders and the Sheets add-on: `ShopUrlService.publicUrl(shop)`, the shop list (id, name, slug, currency, enabled, theme, custom domain, public URL), "create or update shop" used by the Sheets add-on and the default-shop creation, and the default-shop rule.
- **Exposes** to CHK: the Razorpay payment-link mint service (`mintLink(shop, order, callbackUrl)`), the webhook-applied `paid` transition and the shop's currency/shipping rule for order totals.
- **Exposes** public (unauthenticated) HTTP: the nine `/s/{slug}...` routes and `POST /webhooks/storefront-pay`.
- Other consumers noted in the source that are out of scope but depend on shops: `StorefrontOrderParser` (inbound `wa.me` cart-message parser, CHK/auto-reply), HubSpot sync (order insert), invoice sweeper (native sources include `storefront`), `Payment` model methods/sources include `storefront`, Maintenance middleware exempting `webhooks/*`.

## Open questions & quirks

1. `/store/products` (and other sidebar pages) 500 when the workspace has no shop because the sidebar reads the shop name from a null object; only `/store` and `/store/storefront` redirect first (WD-STORE-002).
2. The storefront design page and PUT always act on the workspace's **first** shop, ignoring the shop switcher; multi-shop owners cannot design their other shops (WD-STORE-006).
3. Wizard saves force `enabled = true`; `/store` KPIs are workspace-wide (all shops, all order statuses); the dashboard `?tab` parameter is dead.
4. Public pages list **workspace** products with `in_stock = true` regardless of product `status` and ignore the shop-scoped `storefront_id` column added later; every shop in a workspace shows the same catalog and drafts can leak (WD-STORE-009).
5. The settings save rebuilds `settings_json` from only the form keys, erasing any other key (`top_strip`, `hero_sub` are read by the themes but have no editor); switching payment provider drops the Razorpay keys.
6. No uniqueness validation for `custom_domain` and no length cap on the generated slug: both surface as database errors (WD-STORE-003/006). `storefronts_limit` and `access_wa_storefront` do not gate shop creation or the public shop.
7. Subdomain resolution uses the APP_URL host but advertised subdomain URLs use `STOREFRONT_HOST`; CNAME verification uses a substring match; shop "which shop is the default" differs across consumers (first, newest, first enabled).
8. Checkout: silent coupon ignore, silent stock clamp, un-imported `Throwable` handlers that catch nothing (post-order cleanup can 500 after commit), non-atomic stock decrement, no idempotency, stored phone keeps `+` while history/cancellation matching uses digits only (RTO treats returning buyers as new; abandoned-cart recovery cancellation works because both sides use digits).
9. Webhook: the order is not checked against the verifying shop, no amount/currency check, cancelled orders can flip to paid, the Razorpay callback URL is wrong on custom domains, and the shop is resolved from unauthenticated payload notes before verification.
10. Abandoned-cart recoveries stay `active` after the nudge fires (no sent/expired transition), blocking later recoveries for that phone and shop; the message is not refreshed by later beacons despite the code comment.
11. Dead code in the buyer script: the WhatsApp order-text builder, static payment link builder and recently-viewed store are never called; the "payment link appended to every WhatsApp order message" promise in the settings UI is false (WD-STORE-028). `coming-soon.blade.php`, the host-only product route branch and the `renderable_items` fallback in the tracking page are unreachable.
12. The hero text is rendered as raw HTML; the public share dialog uses a third-party QR service; the footer and Shipping tab read a non-existent `free_threshold`; the product page shows its review form twice; the nav link `#about` has no target; the order tracking page shows "completed"/"processing"/"pending" orders as merely placed.
13. Any signed-in member (even an agent) can create, edit and delete shops and their orders through the wizard routes; delete hard-deletes orders and leaves orphan child rows in MySQL.
14. Open: should the port keep `razorpay_api` per-shop credentials (yes, same behaviour) or move merchant gateways to CHK's `wa_merchant_gateways` (32 hosted-checkout drivers)? WaDesk has both models of merchant payments side by side.

## Differences to decide

| Id   | WaDesk behavior                                               | Recommendation for the port                                                           |
| ---- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| D-01 | Wizard open to any member                                     | Require an admin permission for create/edit/delete (`storefront.manage`)              |
| D-02 | Design page edits the first shop                              | Shop-scoped endpoints and pages (`/shops/:id/settings`)                               |
| D-03 | Public catalog is workspace-wide, status ignored              | Use `storefront_id` when set (else all), and require `status = active`                |
| D-04 | Webhook order not tied to the verifying shop; no amount check | Verify shop/org match, amount and currency; refuse cancelled orders                   |
| D-05 | Hero text rendered as raw HTML                                | Escape, or sanitise with the shared allow-list                                        |
| D-06 | Silent coupon ignore at checkout                              | Keep (matches buyer expectation) or answer 422 `COUPON_INVALID`; pick one and test it |
| D-07 | Post-order cleanup not truly best-effort                      | Outbox events; failures never affect the order response                               |
| D-08 | Non-atomic stock decrement, no idempotency key                | `FOR UPDATE` plus `Idempotency-Key`                                                   |
| D-09 | `storefronts_limit` unused                                    | Enforce from the plan                                                                 |
| D-10 | Search/filter/facets over the loaded page only                | Server-side search/filter/facets plus client enhancement                              |
| D-11 | Static payment handle unused by the server                    | Append payment detail to the hand-off and tracking page, or remove the setting        |
| D-12 | Recovery rows stay `active` after sending                     | Add `sent`/`expired` states and a unique partial index                                |
| D-13 | Public QR via third-party service, fonts from Google          | Local QR and self-hosted fonts                                                        |

## Coverage

```json wadesk-coverage
{
  "routes": [
    "GET store",
    "GET store/storefront",
    "PUT store/storefront",
    "POST store/storefront/verify-domain",
    "GET connect",
    "POST connect/wa-store/save",
    "POST connect/wa-store/reset",
    "GET s/{slug}",
    "GET s/{slug}/p/{productSlug}",
    "POST s/{slug}/checkout",
    "POST s/{slug}/coupon",
    "POST s/{slug}/review",
    "POST s/{slug}/abandon",
    "GET s/{slug}/order/{token}",
    "POST webhooks/storefront-pay"
  ],
  "controllers": [
    "app/Http/Controllers/StoreController.php",
    "app/Http/Controllers/WaStorefrontController.php",
    "app/Http/Controllers/WaStoreWizardController.php",
    "app/Http/Controllers/StorefrontPublicController.php",
    "app/Http/Controllers/StorefrontPaymentController.php"
  ],
  "services": [
    "app/Services/Storefront/StorefrontCartService.php",
    "app/Services/Storefront/StorefrontCheckoutService.php",
    "app/Services/Storefront/StorefrontPaymentService.php",
    "app/Services/Storefront/StorefrontRiskService.php"
  ],
  "models": ["WaStorefront", "StorefrontCartRecovery"],
  "tables": ["wa_storefronts", "wa_storefront_views", "storefront_cart_recoveries"],
  "views": [
    "resources/views/user/store/index.blade.php",
    "resources/views/user/store/_sidebar.blade.php",
    "resources/views/user/store/coming-soon.blade.php",
    "resources/views/user/store/storefront/edit.blade.php",
    "resources/views/user/connect/wa-store.blade.php",
    "resources/views/storefront/_partials/_cards-only.blade.php",
    "resources/views/storefront/_partials/card.blade.php",
    "resources/views/storefront/_partials/index.blade.php",
    "resources/views/storefront/_partials/product.blade.php",
    "resources/views/storefront/_shared.blade.php",
    "resources/views/storefront/_theme-base.blade.php",
    "resources/views/storefront/order-status.blade.php",
    "resources/views/storefront/themes/aurora/index.blade.php",
    "resources/views/storefront/themes/aurora/product.blade.php",
    "resources/views/storefront/themes/bazaar/index.blade.php",
    "resources/views/storefront/themes/bazaar/product.blade.php",
    "resources/views/storefront/themes/kraft/index.blade.php",
    "resources/views/storefront/themes/kraft/product.blade.php",
    "resources/views/storefront/themes/mercato/index.blade.php",
    "resources/views/storefront/themes/mercato/product.blade.php",
    "resources/views/storefront/themes/meridian/index.blade.php",
    "resources/views/storefront/themes/meridian/product.blade.php",
    "resources/views/storefront/themes/noir/index.blade.php",
    "resources/views/storefront/themes/noir/product.blade.php",
    "resources/views/storefront/themes/studio/index.blade.php",
    "resources/views/storefront/themes/studio/product.blade.php",
    "resources/views/storefront/themes/verdure/index.blade.php",
    "resources/views/storefront/themes/verdure/product.blade.php"
  ],
  "commands": [],
  "permissions": [],
  "middleware": [],
  "node_files": [],
  "js_assets": [
    "resources/js/charts/user-connect-wa-store.js",
    "resources/js/charts/user-store-index.js"
  ],
  "misc_files": [],
  "config_files": ["storefront.php"],
  "doc_pages": [],
  "feature_map": {
    "WD-STORE-001": ["GET store"],
    "WD-STORE-003": ["GET connect", "POST connect/wa-store/save"],
    "WD-STORE-005": ["POST connect/wa-store/reset"],
    "WD-STORE-006": ["GET store/storefront", "PUT store/storefront"],
    "WD-STORE-007": ["POST store/storefront/verify-domain"],
    "WD-STORE-009": ["GET s/{slug}"],
    "WD-STORE-010": ["GET s/{slug}/p/{productSlug}"],
    "WD-STORE-013": ["POST s/{slug}/checkout"],
    "WD-STORE-014": ["POST s/{slug}/coupon"],
    "WD-STORE-015": ["POST s/{slug}/abandon"],
    "WD-STORE-016": ["POST s/{slug}/review"],
    "WD-STORE-017": ["GET s/{slug}/order/{token}"],
    "WD-STORE-018": ["POST webhooks/storefront-pay"]
  }
}
```
