# Parity notes: storefront-builder (STORE)

Evidence for the storefront builder and the public shop. Sections, in order: first web notes (superseded where a later section says
so), admin screens compared by hand, backend, the admin twin harness run, the public shop compared by hand, and the public shop
twin harness run. Differences are `same`, `intended` (reason given) or `defect-fixed`; nothing here claims a check that was not run.

## Seams and wiring added in the final pass

| Item                                       | What                                                                                                                                                                                                                                                                                                        | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Custom-domain root (WD-STORE-021)          | `apps/web/src/app/page.tsx` resolves the request host through `GET /v2/store-public/host` and renders the shop at `/`; the app's own host (`WEB_APP_URL`) never serves a shop. Checked with `curl -H 'Host: shop.dev.test' http://localhost:3109/` (shop title) and without the header (redirect to login). | The root route belongs to the auth home router (a seam file, edit kept additive). QUIRK kept: other shop pages on a custom domain are reached through the `/s/<slug>/...` path form on the same host. Intended: the subdomain rule uses `STOREFRONT_HOST` for both advertising and resolving (WaDesk resolved against the APP_URL host and advertised another one). Not done: the workspace-level custom domain of the workspaces domain is not consulted. |
| Payment webhook path (WD-STORE-018)        | `POST /webhooks/storefront-pay` in the web app forwards the raw body and `X-Razorpay-Signature` to `POST /v2/store-public/webhooks/razorpay`.                                                                                                                                                               | The settings screen shows merchants WaDesk's URL; Razorpay must reach the API with the exact bytes it signed.                                                                                                                                                                                                                                                                                                                                              |
| Default shop on connect (WD-STORE-029)     | `DefaultShopConsumer` (worker, outbox subscriber) calls `ensureDefaultShop` on `whatsapp.connection.connected`. Unit tests; the device domain adds its own event type to `DEFAULT_SHOP_EVENTS` when it lands.                                                                                               | WaDesk created the shop inside each channel's connect code; the outbox keeps the channel domains free of a storefront import. Not run end to end with a real connect (no live WhatsApp here).                                                                                                                                                                                                                                                              |
| Store rail on catalog screens (WD-CAT-036) | `(catalog-products)/store/layout.tsx` wraps products, product form and reviews with the store shell.                                                                                                                                                                                                        | Belongs to this domain per the CAT inventory; catalog screens keep working with no shop.                                                                                                                                                                                                                                                                                                                                                                   |
| Unowned files                              | `apps/web/src/app/s/**`, `apps/web/src/app/webhooks/storefront-pay/**`, `apps/web/messages/*/storefront-builder.public.json` are outside the ownership zones of `ownership.json`.                                                                                                                           | Public pages cannot live under the `(app)` group; the zone list needs these paths added (`ownership_check.py` reports them as UNOWNED).                                                                                                                                                                                                                                                                                                                    |
| Tests added                                | `test/integration/storefront-builder/store-schema.spec.ts` (RLS forced on the three tables, isolation both ways, composite FKs, unique slug and domain, one active recovery, the three SECURITY DEFINER lookups, permission keys), `test/unit/storefront-builder/default-shop.consumer.spec.ts`.            |                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## Web (admin)

Scope: WD-STORE-001, 002, 003, 004, 005, 006, 007, 008, 022, 023, 024, 029 (web side only), 030.
Code: `apps/web/src/features/storefront-builder/admin/**`, routes `/store`, `/store/storefront`, `/connect?platform=wa-store`.
Walk: `apps/web/e2e/storefront-builder/admin/walk.mjs` (48 checks on our app, all pass). Reference: only the "Connect WhatsApp
first" state renders (no device, no shop; `/store` and `/store/storefront` redirect to it; sibling pages 500 in the reference).

Legend: same / intended / defect-fixed / blocked.

| Area                                                                                                                                   | Result          | Note                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wizard gate "Step 1 of 3 / Connect WhatsApp first / Go to devices"                                                                     | same            | Verified side by side with the reference; link goes to `/channels` (our devices screen).                                                                                  |
| `/store` and `/store/storefront` with no shop                                                                                          | same            | Redirect to the wizard (our `STORE_NO_SHOP` 404 triggers it).                                                                                                             |
| Sidebar on a page without a shop (reference: 500)                                                                                      | defect-fixed    | Shows a "No shop yet / Set up your store" card.                                                                                                                           |
| Dashboard: 5 KPI tiles, chart card, bestsellers, recent orders, empty copy                                                             | same            | Chart drawn in SVG: columns + smooth orders line, 2 axes, <= 10 rotated x labels; hover readout and a hidden data table for screen readers (additions for accessibility). |
| Dashboard `?shop=` switcher                                                                                                            | same            | Numbers are workspace-wide as in WaDesk (server decides).                                                                                                                 |
| Recent orders "Items" column                                                                                                           | blocked         | `storeRecentOrderSchema` has no line count; shows a dash. Needs `itemsCount` in the contract.                                                                             |
| Recent orders "View all" / "Open" and sidebar Orders, Groups, Coupons, Payments, Gateways, Customers, Invoices                         | blocked         | Belong to checkout-orders-merchant-payments; shown disabled with "Coming soon". Products and Reviews are real links (catalog-products).                                   |
| Sidebar count badges                                                                                                                   | defect-fixed    | `counts` now travels in `GET /store/overview` (orders, products, groups, coupons, pending reviews, payment configs, gateways, customers); badges show above zero.         |
| Sidebar: Live/Setup pill, switcher with 2+ shops, public URL Open/Copy ("Copied!" 1.5 s), provider-live panel                          | same            | Storefront link and Overview link carry `?shop=` (D-02).                                                                                                                  |
| Wizard list, card, add tile, add/edit form, 3 steps, slug readout, device radios, live panel                                           | same            | Card header uses the theme brand token: `wizardShopSchema` has no brand colour (gap).                                                                                     |
| Wizard save always re-enables the shop                                                                                                 | same            | Kept by the backend (documented there).                                                                                                                                   |
| Wizard unnamed shop prefill                                                                                                            | same            | Workspace name, as WaDesk.                                                                                                                                                |
| Wizard edit of a shop on the official number                                                                                           | defect-fixed    | WaDesk preselected the first device; we keep "Official API". Official option is inferred (no flag in the contract).                                                       |
| Delete shop                                                                                                                            | same + intended | Same modal and copy. Needs `store.shops.manage` (D-01). Toast "Shop deleted."                                                                                             |
| Reset all store data                                                                                                                   | intended        | Not reachable from the WaDesk UI; offered as a small danger link in the list view with its own confirm (asked for in the brief).                                          |
| Share modal: copy, WhatsApp, Email, Telegram, More…, QR                                                                                | same            | QR via `qrcode.react` (local, D-13).                                                                                                                                      |
| Settings form: theme tiles, slug, domain + Verify now, brand, currency, shipping, payment, Razorpay, abandoned cart, live toggle, Save | same            | Toast "Storefront updated."; `rowVersion` conflict gives a reload prompt.                                                                                                 |
| Brand colour hex text box                                                                                                              | defect-fixed    | WaDesk's text box was not submitted; ours is the field (picker mirrors it).                                                                                               |
| Razorpay secrets                                                                                                                       | same            | Write-only, "saved — leave blank to keep"; blank omitted from the request.                                                                                                |
| Settings page edits the first shop only (WaDesk quirk)                                                                                 | defect-fixed    | Shop-scoped through `?shop=` (D-02).                                                                                                                                      |
| Expected CNAME target before the first Verify                                                                                          | intended        | Contract does not carry it; we show this site's host until Verify returns `expected`. Needs `cnameTarget` in the response for exactness.                                  |
| Payment intro copy ("append the payment link to every WhatsApp order message")                                                         | same            | Kept verbatim although WaDesk's behaviour is dead code (inventory D-11 open).                                                                                             |
| Permission gating                                                                                                                      | intended        | Menu `store.dashboard.read`; controls hidden without `store.shops.manage`, `store.storefront.read`, `store.storefront.manage`.                                            |
| RTL, keyboard, loading/empty/error states                                                                                              | intended        | Logical classes; native radios/checkboxes; skeletons and error panels by problem `code`. Arabic strings need native review.                                               |

Not verified: dark mode and Arabic visually (strings and key parity tested only); verified-domain success path (needs real DNS);
dashboard with orders (needs the orders domain). Data note: the walk's device row stores `country_code '+91'` and the sending
label renders "++91 ..." (backend label builder adds a second plus; fixture artifact or backend defect to check).

---

## Admin screens (visual and behavioural parity)

Second pass (this section supersedes the "Web (admin)" table where they differ). Method: seeded the same figures on both sides and
captured every admin screen in the running WaDesk and in our app with Playwright (timezone pinned to UTC in the harness), then fixed
the differences.
Seed (tagged, deleted afterwards on the reference): one shop `sta-demo-store` (workspace 1, a bound device row), six `sta ...`
products (one out of stock), 14 orders over 30 days (storefront and waba, statuses new, pending, confirmed, paid, processing,
completed, shipped, cancelled; a nameless customer; 1 to 2 lines), 30 days of storefront views, one pending review. Our dev tenant got
the same orders, views and review by SQL. Totals on both: revenue 28,126.00, 14 orders, average 2,009.00, 8 products. (Views read 691
vs 680 only because the reference counted 11 real visits of a public-shop agent.)
Screenshots: `admin-<screen>-<viewport>-{ref,ours}.png` in the session scratchpad `shots/`.

| Screen x state (1440 and 390 unless noted)                                                                  | Result                            | Note                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wizard gate "Connect WhatsApp first" (no device)                                                            | same + intended                   | Same card and copy; "/devices" in the sentence and link reads "your channels" / `/channels` (our route).                                                                                                                                                                                                                                                                      |
| Wizard first-run form (name prefilled with the workspace name, slug readout, 3 sections)                    | same                              | Slug box now shows the whole address in front (`http://host/s/`), as WaDesk (was `/s/`). Device row shows the stored country code and number joined by a space (was `+` prepended: "++91").                                                                                                                                                                                   |
| Wizard validation: empty name, bad domain                                                                   | same + intended                   | WaDesk blocks an empty name with the browser bubble; ours shows the inline error "Enter a shop name." Bad domain: field error "That doesn't look like a valid domain".                                                                                                                                                                                                        |
| Wizard list: card (theme, URL, sending from, domain, Manage / Preview / Edit / Share / Delete), add tile    | same                              | Card header uses the theme brand token (`wizardShopSchema` has no brand colour). Extra "Clear all store data" link is ours (inventory 005).                                                                                                                                                                                                                                   |
| Wizard edit form, locked slug note, "This shop is live" panel                                               | same                              |                                                                                                                                                                                                                                                                                                                                                                               |
| Share modal (copy, WhatsApp, Email, Telegram, More, QR)                                                     | same + intended                   | "More..." shows "Not supported on this browser" and falls back to copying when `navigator.share` is missing (WaDesk keeps "Phone share menu" dimmed). QR drawn locally.                                                                                                                                                                                                       |
| Delete modal                                                                                                | same + intended                   | Same title and copy; ours has no "DESTRUCTIVE" eyebrow and uses the shared danger button colour.                                                                                                                                                                                                                                                                              |
| Dashboard with orders: KPIs, trend, bestsellers, recent orders                                              | same                              | KPI money is symbol + two decimals (WaDesk `formatIn`); the Total cell is `symbol space 2dp` with symbols for INR/USD/EUR/GBP only (`total_display`); "N item(s)" now filled. Time is shown in the viewer's time zone (WaDesk: server zone). Chart is SVG with a six-interval axis (5,998 gives 0..6,000 like ApexCharts), min width 560 px with horizontal scroll on phones. |
| Dashboard empty (no orders): zeros, "No sales yet", "No orders yet"                                         | same                              | Empty chart axis reads 0..1 (Apex: 0..2 in half steps).                                                                                                                                                                                                                                                                                                                       |
| Dashboard multi-shop: "Switch shop" select, "Manage all shops"                                              | same                              |                                                                                                                                                                                                                                                                                                                                                                               |
| Sidebar: shop card, Live/Setup pill, connection line                                                        | defect-fixed                      | Line now follows WaDesk's four cases through `overview.connection` (official provider label, "Unofficial API · +91 ...", "Device connected · /channels", "Not connected"); Live = any of the three.                                                                                                                                                                           |
| Sidebar count badges                                                                                        | defect-fixed                      | Orders, Products, Groups, Coupons, Reviews (pending only), Payments, Checkout gateways, Customers from `overview.counts`.                                                                                                                                                                                                                                                     |
| Sidebar Orders/Groups/Coupons/Payments/Checkout gateways/Customers/Invoices                                 | blocked                           | Pages belong to checkout-orders-merchant-payments (not ported): disabled with "Coming soon" and the count, "View all" / "Open" in the orders table the same.                                                                                                                                                                                                                  |
| Settings: every control, themes, slug, domain, brand, currency, shipping, payment, Razorpay, recovery, live | same                              | Key secret and Webhook secret got the show/hide eye (WaDesk has it); recovery Message is a single-line input (was a textarea). The WaDesk Aurora tile text is unreadable (light on light): not copied.                                                                                                                                                                        |
| Settings validation and toast ("Storefront updated.")                                                       | same + intended                   | WaDesk validates with native browser bubbles; ours validates in the form with inline messages. Brand hex: ours submits the text box (WaDesk's was not submitted).                                                                                                                                                                                                             |
| Settings domain states (unverified CNAME hint + Verify now)                                                 | same                              | Verified success path not reachable without real DNS.                                                                                                                                                                                                                                                                                                                         |
| Dark mode (dashboard)                                                                                       | intended                          | Ours renders with the platform dark tokens; WaDesk's themes were not captured side by side.                                                                                                                                                                                                                                                                                   |
| Store rail on /store/products, /store/products/create                                                       | edit, /store/reviews (WD-CAT-036) | defect-fixed                                                                                                                                                                                                                                                                                                                                                                  | `(catalog-products)/store/layout.tsx` wraps them in `StoreShell`; the three screens lost their own page padding. Verified in both apps; matches the reference layout. |
| Catalog pages with no shop                                                                                  | defect-fixed                      | WaDesk answers 500 ("shop_name on null"); ours shows the pages with a "No shop yet / Set up your store" card in the rail. `/store` and `/store/storefront` redirect to the wizard (WaDesk too).                                                                                                                                                                               |

Quirks reproduced: dashboard numbers workspace-wide and counting cancelled orders; recent orders have no window; "Live" is about WhatsApp
reachability not the shop toggle; wizard device label prints the stored country code as is (a stored `+91` shows "+91 +91...");
sending label of a shop shows `+` + stored code ("++91 ..."); first-shop settings quirk NOT reproduced (shop-scoped, D-02).
Tests: web `storefront-builder/admin` and `catalog-products` unit tests (new: `niceScale`, `formatOrderTotal`, `countFor`), API e2e
(`overview` asserts `counts` and `connection`; new test for pending reviews and the three connection kinds), browser walk
`apps/web/e2e/storefront-builder/admin/walk.mjs` (53 checks, rail and badge checks added).
Unverified: Arabic and RTL visually; dark mode of the reference; verified-domain success; Razorpay save with real keys; the
sidebar on a viewer without `store.storefront.read` (unit-level only); `Open` / `View all` targets (CHK).

---

## Backend (API, worker, migrations)

Scope: WD-STORE-001..008, 013..022, 024, 029 (API side) plus the public reads of 009, 010, 011, 017, 027, 028, 031 (data only; the
rendering, themes, cart, wishlist, compare and share of 011/012/026/027/030/031 are web). WD-STORE-025 is dead code and not ported.
Code: `apps/api/src/modules/storefront-builder/**`, `apps/api/src/infra/providers/storefront-builder/**`,
`apps/api/src/config/domains/storefront-builder.env.ts`; migration `20261010200300_store_recovery_unique.sql` (with the lead's
`...200000/100/200`). Tests: `apps/api/test/unit/storefront-builder` (66 tests) and `apps/api/test/e2e/storefront-builder` (43 tests).
Endpoint list: `docs/api/storefront-builder.md`.

### Evidence per feature (named tests)

| Feature                            | Status                               | Evidence                                                                                                                                                                                           |
| ---------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 001 dashboard                      | done                                 | e2e "store overview": 30-day totals, aov, products, visits, best sellers, newest orders, 30 buckets; old order excluded from totals; no-shop 404 `STORE_NO_SHOP`                                   |
| 002 sidebar                        | partial                              | data comes from `GET /store/shops` (label, public URL, devices). No counts endpoint (web notes the gap)                                                                                            |
| 003 wizard                         | done                                 | e2e "shops and the wizard": create (slug, theme, device), `-2` across workspaces, 64 cut, device rules, edit keeps slug, domain reset and uniqueness                                               |
| 004 gating                         | done (intended: enforced)            | e2e "without a connected number ... STORE_NO_SENDER"                                                                                                                                               |
| 005 delete and reset               | done                                 | e2e "delete removes the shop and its orders ... reset needs confirm=yes"                                                                                                                           |
| 006 settings                       | done                                 | e2e "storefront settings" (design, shipping 49.50 -> 4950, validation, slug 409, rowVersion 409); unit `pricing`, `copy-and-settings`                                                              |
| 007 domain                         | done, DNS unverified on real domains | e2e "verify-domain" with the fixture resolver; exact CNAME match (substring match refused)                                                                                                         |
| 008 Razorpay config                | done                                 | e2e "Razorpay secrets are stored encrypted..."; unit `payments`                                                                                                                                    |
| 009 home / 010 product / 020 views | done                                 | e2e "public shop pages"                                                                                                                                                                            |
| 013 checkout                       | done                                 | e2e "checkout" (tampered price, stock clamp and decrement, race, coupon, COD, idempotency, 429)                                                                                                    |
| 014 coupon quote                   | done                                 | e2e "coupon: the quote answers 422 ... checkout silently ignores it"; unit coupon rules                                                                                                            |
| 015 recovery                       | done, WABA/Twilio sends unverified   | e2e "abandoned-cart recovery" (once per phone, delay min 5, recovered on order, sweep sends once, sent then new cart)                                                                              |
| 016 review                         | done                                 | e2e "a review lands pending ..."                                                                                                                                                                   |
| 017 tracking                       | done                                 | e2e "order tracking"                                                                                                                                                                               |
| 018 payments                       | done, real Razorpay unverified       | e2e "razorpay webhook" (happy, replay, bad signature, no secret, wrong amount, cancelled, other shop, other events); unit recorded-fixture payload and signature                                   |
| 019 RTO                            | done                                 | unit `rto` (all five acceptance numbers) and e2e COD score stored                                                                                                                                  |
| 021 host resolution                | partial                              | `GET /store-public/host`: verified custom domain and `<slug>.<STOREFRONT_HOST>`. The workspace-level custom domain (workspaces domain) is not consulted. Root routing of the host needs a web seam |
| 022 public URL                     | done                                 | unit `slug-and-url`; exported `ShopUrlService`                                                                                                                                                     |
| 024 gates                          | done                                 | e2e permission test; no plan gate (as WaDesk)                                                                                                                                                      |
| 028 static handle                  | partial                              | stored and returned (`paymentHandle`, `payment.handle`); the server never uses it, as WaDesk (D-11 kept)                                                                                           |
| 029 default shop                   | done                                 | e2e `ensureDefaultShop` (exported `ShopsService.ensureDefaultShop(orgId, tx?)`); the channel domains must call it                                                                                  |

### Decisions D-01..D-13

| Id   | Result   | Reason                                                                                                                                                                                                                                                                             |
| ---- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-01 | intended | create, edit, delete, reset need `store.shops.manage` (WaDesk: any member)                                                                                                                                                                                                         |
| D-02 | intended | settings and domain check are `/store/shops/:id/...`; the dashboard takes `?shopId` (default most recently updated); first-shop quirk gone                                                                                                                                         |
| D-03 | intended | catalogue read through `StorefrontProductsReader`: active, in stock, this shop or shared                                                                                                                                                                                           |
| D-04 | intended | webhook: shop by `store_public_lookup_id`, signature verified before any order is read, order must belong to the shop (a foreign workspace's order is invisible under RLS), amount and currency equal the total, cancelled refused, paid replay is a no-op, no secret fails closed |
| D-05 | intended | hero and footer text sanitised (b, i, em, strong, br, a[href], span); product body sanitised on output                                                                                                                                                                             |
| D-06 | kept     | invalid coupon ignored at checkout; quote answers 422 `STORE_COUPON_INVALID`. Fix inside it: a free-shipping coupon is recorded and counted only when really redeemable (WaDesk recorded an expired one)                                                                           |
| D-07 | intended | cart recovery cancelled in the order transaction; `store.order_placed` outbox event for WhatsApp Pay auto-charge, notifications, invoices (consumers belong to other domains and are NOT wired here)                                                                               |
| D-08 | intended | stock via `takeStock` (row lock) for the quantity actually ordered (WaDesk subtracted the requested one); optional `Idempotency-Key` (Redis key per shop and key, 24 h)                                                                                                            |
| D-09 | not done | `storefronts_limit` is not a plan key in this repo; not enforced (WaDesk never enforced it either)                                                                                                                                                                                 |
| D-10 | kept     | filtering is client side (web); facets and price range are of the loaded page, as WaDesk                                                                                                                                                                                           |
| D-11 | kept     | static payment handle unused by the server                                                                                                                                                                                                                                         |
| D-12 | intended | recovery rows go `active -> sent` after the nudge (`recovered` when the buyer orders); unique partial index on active rows; unique index on `wa_orders.recovery_token` added next to CHK's plain one (touches a CHK table, allowed)                                                |
| D-13 | web      | n/a here                                                                                                                                                                                                                                                                           |

### Other intended differences

- Saving a shop needs a connected WhatsApp number (422 `STORE_NO_SENDER`); WaDesk only hid the form.
- A taken custom domain is a field error (WaDesk: database error). Slug is cut to 64 before the suffix. CNAME compared exactly (normalised), not by substring.
- `settings_json` keys the form does not own (`top_strip`, `hero_sub`) are kept on save (WaDesk erased them).
- DELETE of an unknown shop is 404 (WaDesk: "Shop deleted." and nothing happened); DELETE needs no `confirm` body (the verb is the confirmation); reset keeps the `confirm=yes` gate.
- Phones compare as digits (RTO history, recovery cancellation); the order stores digits and a leading `+` as WaDesk does. This fixes WaDesk's miss of returning buyers who typed a `+`.
- The Razorpay callback is `<shop origin>/s/<slug>/order/<token>` (WaDesk produced a route that does not exist on custom domains).
- Recovery nudge is sent by the worker sweep (claim with `FOR UPDATE SKIP LOCKED`, at most once); WaDesk used the Node one-off scheduler. The message is built at send time.
- The view counter counts page 1 of `/home` and product pages (`page >= 2` is the "show more" fetch).

### Kept WaDesk quirks (flag to owners)

- A wizard save re-enables a disabled shop. Dashboard numbers are workspace-wide and count cancelled orders. The recent-orders list has no 30-day window (the inventory says it does; the source does not).
- Order number on the wire is the order id (WaDesk shows `#id` to buyers): settle with the CHK owner.
- `ratingCount` is the number of loaded reviews (max 20). The tracking page returns the raw status; the web must map every CHK status to a tracker step.
- Sales-by-day buckets use UTC dates (WaDesk: app time zone).

### NOT verified

- Real Razorpay (link creation, webhook delivery): adapter tested against a recorded body and a local stub only. Live mode is untested against Razorpay.
- Real WhatsApp sends: the Baileys nudge is tested against a local stub of the Node bridge; the WABA nudge path reads the encrypted config and calls the shared Meta provider but was not run against Meta. The Twilio path is blocked (no Twilio sender in the repo).
- DNS CNAME check on real domains (fixture resolver in tests). Custom-domain root routing needs a web seam; TLS for customer domains is infrastructure.
- Cross-domain shims (`_shims/README.md`) read CHK, device and WABA tables directly until those domains export services.

---

## Twin harness: admin screens

Scope: WD-STORE-001..008, 022..025, 029 (web side), 030, plus the store rail on `/store/products` and `/store/reviews`.
Spec: `apps/web/e2e/storefront-builder/parity/WD-STORE-admin.twin.mjs` (329 generated + custom scenarios; `prepare-org.mjs --shop`
makes our throw-away org; the reference gets a device row and one shop `stw-demo` in workspace 1, removed after the run).
Run: `parity.sh run <spec> --depth full --workers 1` (one worker: the reference edits "the first shop" and the scenarios share it), split
into segments of under 15 minutes because the harness logs in once per run and our access token lives 15 minutes.
Final state (the segments merged into one run): same 1583, intended 138, defects 0, review 26, skipped 1, spec-issue 0; 334 scenarios
per side. First full run: 723 difference rows in 203 scenarios. Triage below.

Per-field value matrix: the generated matrix was replaced by `settings-db.*` and `wizard-db.*` scenarios that compare what was
**stored** (database readback) and whether the page told the user something. Reason: WaDesk prints its validation errors in a plain box
without alert semantics, which the harness reads as "silent", so every rejected value looked like a difference although the message is shown
(checked by hand: "The custom domain field format is invalid."). Structure, happy path, empty submit, required, Enter, double submit, slow
server, server error, offline and session-expired still come from the generated form scenarios.

### Defects found and fixed (7)

| Defect                                                                                                                                               | Fix                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Settings: a whole shipping fee showed as `999`; WaDesk prints two decimals (`999.00`)                                                                | web `settings-form.ts` `amountBox`                                           |
| Shipping amounts: `1e5` and `+12.5` were refused, `12.345` (three decimals) was accepted and stored as 12 minor units                                | web: PHP `numeric` rule, two-decimal step, sent as a plain two-place decimal |
| Recovery delay: `1e3` and `007` were accepted; the integer rule refuses both                                                                         | web: integer pattern without exponent or leading zero                        |
| Brand colour: stored as typed (`#1A2B3C`, default `#075E54`); the picker value is lower case; a blank hex was refused                                | web: sent lower case, blank means "not set"                                  |
| Shop slug: Arabic names fell back to `shop` (WaDesk folds them: `مرحبا` gives `mrhba`); a zero-width character joined words instead of breaking them | api `rules/slug.ts` and web preview `lib/slug.ts`, new unit tests            |
| Wizard edit: a double click on Save sent two PUTs (the guard ended when the save finished, before the page left)                                     | web `shop-form.tsx` guards after success too                                 |
| Settings: the slug box had no required marker (WaDesk has one)                                                                                       | web `settings-screen.tsx` `required`                                         |

### Same

Wizard: gate with no connected number, first-run form, list card (links, actions, theme, sending line, add tiles), add form (three steps, live slug
readout, device choice), edit form, slug kept on rename, a save re-enables a disabled shop (quirk kept), same name twice gives `-2`, markup in a shop name is
text on list, share, dashboard and edit screens, delete modal (cancel keeps, confirm removes shop and its orders, products kept), share modal (copy to
clipboard, WhatsApp, Email, Telegram links, QR, three ways to close), unknown shop id. Dashboard: empty and with six orders and ten days of visits
(KPI tiles, bestsellers, recent orders text), shop switcher. Sidebar: pill, public URL, Open and Copy, connection cases, count badges. Settings: every theme
tile saves, full round trip (stored and re-read form), provider fields per provider, Razorpay secrets write-only (never in the page, never stored in clear, kept
when left blank), Verify now, all matrix values stored equal. All store pages: no console or page errors, axe, three viewports, degraded and no-session
probes equal to the reference.

### Intended (reasons are in the spec `intended[]`)

| Difference                                                                                                             | Reason                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Sidebar sibling screens (orders, groups, coupons, payments, gateways, customers, invoices) disabled with "Coming soon" | blocked: owned by checkout-orders-merchant-payments, not ported                         |
| Overview and Storefront sidebar links carry `?shop=<id>`; settings of a second shop open that shop                     | decision D-02 (WaDesk edits the first shop)                                             |
| Catalog pages of a workspace without a shop answer 200 with a "set up your store" card                                 | WaDesk answers HTTP 500 (null shop)                                                     |
| Invalid values send no request (checked in the form, inline message); WaDesk sends them or uses the browser bubble     | earlier decision: validation in the form; stored result and message compared separately |
| Long shop name (up to 191) saves; WaDesk fails in the database                                                         | slug cut to 64 before the suffix                                                        |
| Taken custom domain is a field error; WaDesk database error                                                            | deliberate fix                                                                          |
| NUL byte refused; WaDesk stores it                                                                                     | platform input rule                                                                     |
| Trailing zero-width character kept in a name or hero text                                                              | platform trims whitespace only (not store specific)                                     |
| Blank brand hex means default; WaDesk saves black by accident; ftp logo URL refused; spaces-only hex trims to blank    | deliberate fixes                                                                        |
| Unowned `settings_json` keys kept on save                                                                              | deliberate fix (WaDesk erases `top_strip`, `hero_sub`)                                  |
| Two tabs: second save gets 409                                                                                         | optimistic locking rule                                                                 |
| Session expiry keeps the form with a message; WaDesk redirects                                                         | shared API client, auth domain                                                          |
| Keyboard focus on the Next dev-tools portal has no ring                                                                | exists only under `next dev` (verified: the only ring-less stops)                       |

Review items (26) were read in the gallery and ignored: button, nav-landmark and table counts differ because of the CRM shell and an
accessibility data table behind the chart; the shell's mobile nav is collapsed.

### Open, blocked-env, not verified

Open defects: none. Blocked (not store defects): sibling store screens above. Not verified: Verify now success path (needs a real CNAME),
real Razorpay and WhatsApp sends, permission-denied roles (no second role in the reference), Arabic and RTL rendering and dark mode, the all-data reset
(ours only: refuses without confirm; WaDesk has no UI entry and wipes the workspace's products), orders with a second currency, production-build timing
(run against `next dev`; one `wizard-add.load` LCP outlier of 1.6 s did not repeat).

## Public shop (visual and behavioural parity)

Scope: WD-STORE-009, 010, 011, 012, 013 (browser side), 014, 015 (beacon), 016, 017, 020, 026, 027, 031: the buyer-facing shop at
`/s/{slug}` with all eight themes. Code: `apps/web/src/features/storefront-builder/public/**`, routes `apps/web/src/app/s/**`, public API
`apps/api/src/modules/storefront-builder/public/**` (+ three small fields in the CAT product reader).

### Method

- **Same data on both sides.** `apps/web/e2e/storefront-builder/public/seed-both.mjs` seeds identical shops (`stp-<theme>`, a disabled
  `stp-off`, an empty `stp-empty`, a no-number `stp-nonumber`), 60 products (sale, new, low stock 3 / 1 / 0, gallery, rich body with a
  `<script>`, no category, no image, one draft), reviews (2 approved, 1 pending), five coupons, six tracking orders (one per status)
  and a sending number. Ours: SQL on `crm_store`, org `pubshop-e2e`. Reference: tagged rows in MariaDB (workspaces 9001-9003, product
  ids 910001+, orders 9100+, an `INR` row in `currencies` because that table is empty on a fresh install and WaDesk's `formatIn`
  needs it). `node seed-both.mjs clean ref` removes exactly those rows again (done at the end of this run).
- **Visual.** `parity-capture.mjs` takes the same page states on both sides, `parity-diff.py` counts the pixels that differ by more
  than 24/255 (text anti-aliasing included), and every pair was looked at. 302 pairs: 175 at 1440x900, 97 at 390x844, 30 at 768x1024,
  in `scratchpad/shots/pub/pub-<theme>-<page>-<viewport>-{ref,ours}.png`. Order tracking, the 404 screens and the two edge shops
  are theme independent and were captured once per status or state.
- **Behavioural.** `parity-behave.mjs` runs the same probes on both (265 compared values the same, 51 different; every difference is
  classified below). `parity-edge-shops.mjs` covers the empty and no-number shops. `shop.e2e.mjs` (129 checks on our app) is the
  regression run.
- The staff app's cookie banner exists only on ours (root layout, WD-SET-033); the captures press "Decline" first. "Cart" in the
  header carries a count in its label on ours (`Cart, 2 items`, a11y).

### Visual result

Largest share of differing pixels per theme and page group, at 1440 / 768 / 390 px (`-` = not captured). Everything under 1% is
text anti-aliasing, the fading toast of a moment earlier, or a one-pixel sub-pixel shift; the pairs are visually identical.

| Theme    | Home               | Product            | Cart drawer        | Checkout (form and errors) | Hover and focus | Search and filter | Quick view, wishlist, compare |
| -------- | ------------------ | ------------------ | ------------------ | -------------------------- | --------------- | ----------------- | ----------------------------- |
| aurora   | 0.00 / 0.01 / 0.01 | 0.02 / 0.03 / 0.07 | 0.47 / 0.00 / 2.26 | 0.05 / 0.09 / 0.00         | 0.00 / - / -    | 0.00 / - / -      | 0.10 / - / 0.01               |
| meridian | 0.00 / 0.01 / 0.01 | 0.02 / 0.03 / 0.07 | 0.00 / 0.00 / 0.00 | 0.05 / 0.09 / 0.00         | 0.00 / - / -    | -                 | -                             |
| verdure  | 0.02 / - / 0.01    | 0.04 / - / 0.14    | 0.00 / - / 0.00    | 0.05 / - / 0.00            | 0.01 / - / -    | -                 | -                             |
| bazaar   | 0.00 / - / 0.01    | 0.02 / - / 0.07    | 0.00 / - / 0.00    | 0.05 / - / 0.00            | 0.00 / - / -    | -                 | -                             |
| noir     | 0.00 / - / 0.01    | 0.02 / - / 0.07    | 0.31 / - / 0.00    | 0.05 / - / 0.00            | 0.00 / - / -    | 0.00 / - / -      | 0.75 / - / -                  |
| kraft    | 0.00 / 0.00 / 0.02 | 0.02 / 0.03 / 0.07 | 0.49 / 0.00 / 0.00 | 0.05 / 0.09 / 0.00         | 0.11 / - / -    | 0.00 / - / -      | 0.00 / - / -                  |
| mercato  | 0.00 / - / 0.01    | 0.02 / - / 0.07    | 0.00 / - / 0.00    | 0.05 / - / 0.00            | 0.00 / - / -    | -                 | -                             |
| studio   | 0.08 / - / 0.01    | 0.05 / - / 0.17    | 0.00 / - / 0.00    | 0.05 / - / 0.00            | 0.01 / - / -    | -                 | -                             |

Home covers the top, the catalog, the bottom (footer) and the list view; Product covers the top, the scrolled page, the bottom and the
full page (gallery, tabs, related, the Reviews block); Hover and focus is a card, its add button, the search box, a nav link, an
icon button and a scrolled page. Not theme dependent: tracking page for the six statuses 0.01% at 1440 and 0.05% at 390; `stp-empty`
home 0.00%; `stp-nonumber` home 0.00%, product 0.00%, "Order placed" dialog 0.02%; the 404 screens 0.37% at 1440 and 1.5% at 390 (only
the brand name differs, see below).

| Area                                                                                                                                | Result          | Note                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home, all 8 themes x 3 viewports (strip, header, hero, trust pills, toolbar, filters, grid, cards, badges, show-more block, footer) | same            | Includes WaDesk's own layout defect: the catalog grid is wider than its column between about 880 and 1570px and is clipped at the right edge (QUIRK, reproduced).                                                                                             |
| Theme cascades (which theme rule really applies)                                                                                    | same            | WaDesk's theme CSS is only partly effective (see "QUIRKs reproduced"); the port translates each theme literally, keeping the specificity relations, and scopes the home-only rules to the home page.                                                          |
| Fonts                                                                                                                               | defect-fixed    | The first port used system stacks, so nothing looked like WaDesk. Fraunces, Plus Jakarta Sans and JetBrains Mono (latin and latin-ext) are now self-hosted in `styles/fonts.css` (D-13: no CDN), plus Fraunces with its optical-size axis for the 404 screen. |
| Product page, 8 themes x 3 viewports                                                                                                | same            | Needed: weight, tags and the "New" flag from the API, the second Reviews block, WaDesk's meta grid, the empty thumbnail track when a product has no image.                                                                                                    |
| Cart drawer: rows, stepper, shipping row, FREE state, hint, note, payment caption, empty state                                      | same            | Light panel in every theme, also Noir.                                                                                                                                                                                                                        |
| Checkout dialog and validation errors                                                                                               | same            | Opens over the still open cart drawer.                                                                                                                                                                                                                        |
| Order tracking, six statuses, desktop and phone                                                                                     | same            | Subtotal is total minus shipping, no discount row, Total always with two decimals.                                                                                                                                                                            |
| Quick view, wishlist drawer (with items), compare bar and drawer, share dialog                                                      | same / intended | Share: WaDesk prints the stray text `this.textContent='Copy',1500)">` and loads the QR from a third-party service; ours is clean and local (intended).                                                                                                        |
| Unknown / disabled shop, unknown product or order                                                                                   | same / intended | WaDesk answers with its platform "Page not found" screen; ours is that screen, with the platform brand name instead of "WaDesk" (intended).                                                                                                                   |
| Empty shop, shop without a sending number                                                                                           | same            | No "Ask a question", no footer WhatsApp link, checkout ends on the dialog with the tracking link.                                                                                                                                                             |

### Behaviour result

| Area                                                                                                                                            | Result       | Note                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cart: add, badge bump, toast "<name> · added to cart", localStorage line shape, reload persistence, stepper, minimum 1, remove                  | same         | Key is `sf_cart_<slug>` (WaDesk: `sf_cart_<shop id>`; ours has no numeric public id): intended.                                                                                                               |
| Stock caps: stock 1 / 3 / 0 modals and texts, drawer typing above stock (toast "Only 3 in stock", value shown 3), typing 0 gives 1              | same         |                                                                                                                                                                                                               |
| Shipping row (fee, hint, FREE), total, note, caption                                                                                            | same         |                                                                                                                                                                                                               |
| Coupon quote texts (SAVE10, FLAT100 with minimum, SHIPFREE, inactive, expired, unknown, cleared)                                                | same         |                                                                                                                                                                                                               |
| Checkout validation texts, field limits and placeholder, payment radios, request content, cart cleared, status line, wa.me URL and message text | same         | The request and response use camelCase keys (`paymentMethod`, `waUrl`) where WaDesk used snake_case: contract convention, intended.                                                                           |
| Tracking link in the hand-off and the "Order placed" dialog without a number                                                                    | same         |                                                                                                                                                                                                               |
| Abandoned-cart beacon: fires once on a valid phone blur, not on a short one, same body                                                          | same         |                                                                                                                                                                                                               |
| Search, categories (OR), price range, on sale, "In stock only", sort, list view, reset, clear, "Nothing matches"                                | same         |                                                                                                                                                                                                               |
| Show more                                                                                                                                       | intended     | WaDesk's "Show more" is broken (HTTP 500, see QUIRKs); ours loads page 2 as the inventory specifies.                                                                                                          |
| Wishlist, compare (4 max, "Compare full"), quick view, share                                                                                    | same         |                                                                                                                                                                                                               |
| Product page: pill texts, thumbnails, Save %, meta list, tabs, ask link, related order, review block, sanitised body                            | same         | The "Ask" link now uses PHP's `urlencode` (`+` for spaces) like WaDesk.                                                                                                                                       |
| Review form: empty name message, success message, stored `pending`                                                                              | same         | Each of the two forms posts its own fields (WaDesk's duplicate ids made the bottom one unusable).                                                                                                             |
| SEO: title, description, og:*, twitter, robots, JSON-LD                                                                                         | defect-fixed | The platform's title suffix ("... - CRM Platform"), default `robots` and Open Graph block leaked onto every shop page; now absolute titles and nothing inherited. JSON-LD escapes `<` as `<` (same document). |
| View counter                                                                                                                                    | same         | One row per shop and day, +1 per full render (also the product page).                                                                                                                                         |
| Drafts and archived products                                                                                                                    | intended     | Not listed, product page 404 (D-03); WaDesk lists drafts and serves them. Counts differ by one on the seeded catalog (58 vs 59).                                                                              |
| RTO band of a COD order for a returning phone                                                                                                   | intended     | WaDesk never matches the history (`+` in the stored phone, digits in the lookup); ours does.                                                                                                                  |
| Responsive: filters stack at 880px, 2 columns at 560px, 1 at 340px, search and nav hidden below 760px, drawers 95vw                             | same         |                                                                                                                                                                                                               |
| Hover cards (lift, shadow, zoom, heart and eye buttons), focus ring of the search box, nav and icon hovers                                      | same         |                                                                                                                                                                                                               |

### Defects fixed in this run

1. Fonts were system stacks: all eight themes looked different from WaDesk. Now the real families, self-hosted.
2. The shell inherited the staff app's Tailwind preflight (inputs, buttons, headings, SVGs); WaDesk draws them with browser defaults
   (Arial controls, bold headings). Rolled back inside `.sf-root`, element rules are `:where()` so component classes win.
3. Hero trust pills had no top margin and the filter groups no bottom padding (reset specificity), toolbar, filters, view toggle,
   header and icon buttons were 2 to 4px off, the catalog had a 1280px cap WaDesk does not have.
4. Product cards: the "New" badge, weight and tags in the meta list were missing (the API did not send them); stock 0 products were
   shown as "Sold out" and hidden by "In stock only", WaDesk lists them with a working button and stops at the cart.
5. Product page: Reviews block missing, meta list a different grid, tab and quantity controls with another size and font, the
   shipping text computed a threshold WaDesk never shows, no empty thumbnail column without an image.
6. Drawers, modal, toast and compare bar followed the theme palette; WaDesk's are always light. Drawer buttons were icons,
   WaDesk uses the text glyph; the empty cart image fallback is the package emoji.
7. Checkout closed the cart drawer; success with a wa.me URL opened another dialog instead of "Order placed! Opening WhatsApp…".
8. The order tracking page: missing "Delivery to" card (the API never sent the address), a coloured link and footer margin lost to a
   reset, discount row and item-sum subtotal instead of total minus shipping, grey text darker than WaDesk's.
9. The "Nothing matches" block replaced the grid beside the filters instead of sitting below the layout.
10. The 404 was a small custom page; WaDesk shows its platform "Page not found" screen.
11. `top_strip` and `hero_sub` settings are now honoured (WaDesk reads them although no screen writes them).
12. The tracking page's `Total` and the WhatsApp confirmation always show two decimals (`WaOrder::total_display`), and the confirmation
    text is escaped like PHP's `rawurlencode`.
13. The drawer stepper kept the typed number (10) when the cart clamped to 3.
14. SEO leak of the platform title, robots and Open Graph tags (see above).

### QUIRKs reproduced on purpose

Recorded in the inventory entries (WD-STORE-009 rules 10-14, 010 rules 11-13, 011 rule 7, 012 rule 8, 031 rule 8):
clipped catalog grid between 880 and 1570px; "Featured" keeps the last sort; "In stock only" does nothing; below 760px the header
search and nav are hidden; closed drawers' shadow on the right edge; the page's own product is not clamped to its stock on its page
and the pill reads "Only 0 left"; the Reviews list and form appear twice; the free-shipping copy always says 999.00 in the shop
currency; `formatIn` formats (`₹109.00 — ₹589.00`) next to the card format (`₹ 109`); the Range hint comes from page 1 only; the
checkout dialog opens over the open cart drawer; Noir and Mercato have no gold or yellow cart button, the themes' `.add` rules lose to
the base rule (only hovers apply), the theme badge is always coral; drawers and modals are light in Noir too; "Reset filters",
"Clear filters" and "Show more" use the default (black) text colour; sort select, search box and product-page buttons use Arial.

### Differences kept on purpose (not defects)

- Drafts and archived products are not public (D-03); the seeded catalog therefore has 58 listed products where WaDesk shows 59.
- "Show more" works (WaDesk: broken, see below). The hidden toast no longer swallows taps (WaDesk's has no `pointer-events: none`, so
  on a phone it covers part of "Order on WhatsApp" even when invisible). The share dialog and QR are clean and local.
- Header and filter box stay sticky when scrolling (WaDesk's CSS says sticky but `overflow-x: hidden` on html and body stops it in every
  browser). Scrolled screenshots are compared with `UNSTICK=1`.
- On touch devices the heart and eye buttons of a card are always visible (WaDesk shows them on hover only).
- Local storage keys use the slug, request and response keys are camelCase, product ids are uuids, screen-reader labels (count in the
  cart label, "Skip to content", rating text) are additions, the 404 shows the platform brand name from the site settings.
- The staff app's cookie banner and Next's dev indicator appear on ours only.

### WaDesk defects found (not reproduced)

- "Show more products" always fails: `index()` is typed to return a `View` but returns a `Response` for `?partial=1&page>1`, a
  TypeError (HTTP 500); the script then removes the button, so only the first 48 products are ever reachable.
- The share dialog's Copy button is built with `JSON.stringify` inside an `onclick` attribute: the attribute ends early and stray text is
  printed.
- The invisible toast keeps catching taps (no `pointer-events: none`).
- The checkout RTO lookup compares digits with a stored phone that contains `+`, so no history is ever found.

### Not verified, and why

- Real WhatsApp, Razorpay and UPI flows (nothing is sent; the hand-off URL and text were compared, the navigation was stubbed). The
  Razorpay-link and webhook paths belong to WD-STORE-018 (backend tests).
- Arabic / RTL rendering of the shop, dark mode of the staff app, keyboard-only walk-through on the reference (ours: focus trap and
  Escape are covered by the e2e script).
- Custom-domain and subdomain hosts (needs DNS), production-build timing (everything ran against `next dev`).
- Quick view, wishlist and compare of products brought in by "Show more" (cannot be reached on the reference).
- Currencies other than INR (the reference has only the one `currencies` row seeded), shops with a logo other than Kraft's, brand
  colours other than the two seeded (#B8860B Noir, #7B2D8E Studio), long product names and descriptions.
- Hover and focus were compared on 8 themes for cards and on aurora, noir and kraft for the remaining states; keyboard focus rings
  other than the search box were not compared.
- Checkout through the reference left tagged orders in workspace 9001 (removed by `clean ref`).

### Tests

Web unit (vitest, `src/features/storefront-builder`): 154 pass, 4 added in `misc.test.ts` for the money variants, the head tags and the
PHP encodings, `catalog.test.ts` covers the sort quirk. API unit (`test/unit/storefront-builder`): 73 pass (new: `totalDisplay`,
`rawurlencode`). API e2e (`test/e2e/storefront-builder`, testcontainers): 45 pass (new: card fields and settings, the address on the
tracking order). `shop.e2e.mjs`: 129 checks pass against `crm_store`.
