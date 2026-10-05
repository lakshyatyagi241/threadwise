# Parity notes: storefront-builder (STORE)

Evidence for the storefront builder and the public shop. Sections, in order: first web notes (superseded where a later section says
so), admin screens compared by hand, backend, the admin twin harness run, the public shop compared by hand, and the public shop
twin harness run. Differences are `same`, `intended` (reason given) or `defect-fixed`; nothing here claims a check that was not run.

## Seams and wiring added in the final pass

| Item                                       | What                                                                                                                                                                                                                                                                                                        | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Custom-domain root (TW-STORE-021)          | `apps/web/src/app/page.tsx` resolves the request host through `GET /v2/store-public/host` and renders the shop at `/`; the app's own host (`WEB_APP_URL`) never serves a shop. Checked with `curl -H 'Host: shop.dev.test' http://localhost:3109/` (shop title) and without the header (redirect to login). | The root route belongs to the auth home router (a seam file, edit kept additive). QUIRK kept: other shop pages on a custom domain are reached through the `/s/<slug>/...` path form on the same host. Intended: the subdomain rule uses `STOREFRONT_HOST` for both advertising and resolving (Reference resolved against the APP_URL host and advertised another one). Not done: the workspace-level custom domain of the workspaces domain is not consulted. |
| Payment webhook path (TW-STORE-018)        | `POST /webhooks/storefront-pay` in the web app forwards the raw body and `X-Razorpay-Signature` to `POST /v2/store-public/webhooks/razorpay`.                                                                                                                                                               | The settings screen shows merchants Reference's URL; Razorpay must reach the API with the exact bytes it signed.                                                                                                                                                                                                                                                                                                                                              |
| Default shop on connect (TW-STORE-029)     | `DefaultShopConsumer` (worker, outbox subscriber) calls `ensureDefaultShop` on `whatsapp.connection.connected`. Unit tests; the device domain adds its own event type to `DEFAULT_SHOP_EVENTS` when it lands.                                                                                               | Reference created the shop inside each channel's connect code; the outbox keeps the channel domains free of a storefront import. Not run end to end with a real connect (no live WhatsApp here).                                                                                                                                                                                                                                                              |
| Store rail on catalog screens (TW-CAT-036) | `(catalog-products)/store/layout.tsx` wraps products, product form and reviews with the store shell.                                                                                                                                                                                                        | Belongs to this domain per the CAT inventory; catalog screens keep working with no shop.                                                                                                                                                                                                                                                                                                                                                                   |
| Unowned files                              | `apps/web/src/app/s/**`, `apps/web/src/app/webhooks/storefront-pay/**`, `apps/web/messages/*/storefront-builder.public.json` are outside the ownership zones of `ownership.json`.                                                                                                                           | Public pages cannot live under the `(app)` group; the zone list needs these paths added (`ownership_check.py` reports them as UNOWNED).                                                                                                                                                                                                                                                                                                                    |
| Tests added                                | `test/integration/storefront-builder/store-schema.spec.ts` (RLS forced on the three tables, isolation both ways, composite FKs, unique slug and domain, one active recovery, the three SECURITY DEFINER lookups, permission keys), `test/unit/storefront-builder/default-shop.consumer.spec.ts`.            |                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## Web (admin)

Scope: TW-STORE-001, 002, 003, 004, 005, 006, 007, 008, 022, 023, 024, 029 (web side only), 030.
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
| Dashboard `?shop=` switcher                                                                                                            | same            | Numbers are workspace-wide as in Reference (server decides).                                                                                                                 |
| Recent orders "Items" column                                                                                                           | blocked         | `storeRecentOrderSchema` has no line count; shows a dash. Needs `itemsCount` in the contract.                                                                             |
| Recent orders "View all" / "Open" and sidebar Orders, Groups, Coupons, Payments, Gateways, Customers, Invoices                         | blocked         | Belong to checkout-orders-merchant-payments; shown disabled with "Coming soon". Products and Reviews are real links (catalog-products).                                   |
| Sidebar count badges                                                                                                                   | defect-fixed    | `counts` now travels in `GET /store/overview` (orders, products, groups, coupons, pending reviews, payment configs, gateways, customers); badges show above zero.         |
| Sidebar: Live/Setup pill, switcher with 2+ shops, public URL Open/Copy ("Copied!" 1.5 s), provider-live panel                          | same            | Storefront link and Overview link carry `?shop=` (D-02).                                                                                                                  |
| Wizard list, card, add tile, add/edit form, 3 steps, slug readout, device radios, live panel                                           | same            | Card header uses the theme brand token: `wizardShopSchema` has no brand colour (gap).                                                                                     |
| Wizard save always re-enables the shop                                                                                                 | same            | Kept by the backend (documented there).                                                                                                                                   |
| Wizard unnamed shop prefill                                                                                                            | same            | Workspace name, as Reference.                                                                                                                                                |
| Wizard edit of a shop on the official number                                                                                           | defect-fixed    | Reference preselected the first device; we keep "Official API". Official option is inferred (no flag in the contract).                                                       |
| Delete shop                                                                                                                            | same + intended | Same modal and copy. Needs `store.shops.manage` (D-01). Toast "Shop deleted."                                                                                             |
| Reset all store data                                                                                                                   | intended        | Not reachable from the Reference UI; offered as a small danger link in the list view with its own confirm (asked for in the brief).                                          |
| Share modal: copy, WhatsApp, Email, Telegram, More…, QR                                                                                | same            | QR via `qrcode.react` (local, D-13).                                                                                                                                      |
| Settings form: theme tiles, slug, domain + Verify now, brand, currency, shipping, payment, Razorpay, abandoned cart, live toggle, Save | same            | Toast "Storefront updated."; `rowVersion` conflict gives a reload prompt.                                                                                                 |
| Brand colour hex text box                                                                                                              | defect-fixed    | Reference's text box was not submitted; ours is the field (picker mirrors it).                                                                                               |
| Razorpay secrets                                                                                                                       | same            | Write-only, "saved — leave blank to keep"; blank omitted from the request.                                                                                                |
| Settings page edits the first shop only (Reference quirk)                                                                                 | defect-fixed    | Shop-scoped through `?shop=` (D-02).                                                                                                                                      |
| Expected CNAME target before the first Verify                                                                                          | intended        | Contract does not carry it; we show this site's host until Verify returns `expected`. Needs `cnameTarget` in the response for exactness.                                  |
| Payment intro copy ("append the payment link to every WhatsApp order message")                                                         | same            | Kept verbatim although Reference's behaviour is dead code (inventory D-11 open).                                                                                             |
| Permission gating                                                                                                                      | intended        | Menu `store.dashboard.read`; controls hidden without `store.shops.manage`, `store.storefront.read`, `store.storefront.manage`.                                            |
| RTL, keyboard, loading/empty/error states                                                                                              | intended        | Logical classes; native radios/checkboxes; skeletons and error panels by problem `code`. Arabic strings need native review.                                               |

Not verified: dark mode and Arabic visually (strings and key parity tested only); verified-domain success path (needs real DNS);
dashboard with orders (needs the orders domain). Data note: the walk's device row stores `country_code '+91'` and the sending
label renders "++91 ..." (backend label builder adds a second plus; fixture artifact or backend defect to check).

---

## Admin screens (visual and behavioural parity)

Second pass (this section supersedes the "Web (admin)" table where they differ). Method: seeded the same figures on both sides and
captured every admin screen in the running Reference and in our app with Playwright (timezone pinned to UTC in the harness), then fixed
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
| Wizard first-run form (name prefilled with the workspace name, slug readout, 3 sections)                    | same                              | Slug box now shows the whole address in front (`http://host/s/`), as Reference (was `/s/`). Device row shows the stored country code and number joined by a space (was `+` prepended: "++91").                                                                                                                                                                                   |
| Wizard validation: empty name, bad domain                                                                   | same + intended                   | Reference blocks an empty name with the browser bubble; ours shows the inline error "Enter a shop name." Bad domain: field error "That doesn't look like a valid domain".                                                                                                                                                                                                        |
| Wizard list: card (theme, URL, sending from, domain, Manage / Preview / Edit / Share / Delete), add tile    | same                              | Card header uses the theme brand token (`wizardShopSchema` has no brand colour). Extra "Clear all store data" link is ours (inventory 005).                                                                                                                                                                                                                                   |
| Wizard edit form, locked slug note, "This shop is live" panel                                               | same                              |                                                                                                                                                                                                                                                                                                                                                                               |
| Share modal (copy, WhatsApp, Email, Telegram, More, QR)                                                     | same + intended                   | "More..." shows "Not supported on this browser" and falls back to copying when `navigator.share` is missing (Reference keeps "Phone share menu" dimmed). QR drawn locally.                                                                                                                                                                                                       |
| Delete modal                                                                                                | same + intended                   | Same title and copy; ours has no "DESTRUCTIVE" eyebrow and uses the shared danger button colour.                                                                                                                                                                                                                                                                              |
| Dashboard with orders: KPIs, trend, bestsellers, recent orders                                              | same                              | KPI money is symbol + two decimals (Reference `formatIn`); the Total cell is `symbol space 2dp` with symbols for INR/USD/EUR/GBP only (`total_display`); "N item(s)" now filled. Time is shown in the viewer's time zone (Reference: server zone). Chart is SVG with a six-interval axis (5,998 gives 0..6,000 like ApexCharts), min width 560 px with horizontal scroll on phones. |
| Dashboard empty (no orders): zeros, "No sales yet", "No orders yet"                                         | same                              | Empty chart axis reads 0..1 (Apex: 0..2 in half steps).                                                                                                                                                                                                                                                                                                                       |
| Dashboard multi-shop: "Switch shop" select, "Manage all shops"                                              | same                              |                                                                                                                                                                                                                                                                                                                                                                               |
| Sidebar: shop card, Live/Setup pill, connection line                                                        | defect-fixed                      | Line now follows Reference's four cases through `overview.connection` (official provider label, "Unofficial API · +91 ...", "Device connected · /channels", "Not connected"); Live = any of the three.                                                                                                                                                                           |
| Sidebar count badges                                                                                        | defect-fixed                      | Orders, Products, Groups, Coupons, Reviews (pending only), Payments, Checkout gateways, Customers from `overview.counts`.                                                                                                                                                                                                                                                     |
| Sidebar Orders/Groups/Coupons/Payments/Checkout gateways/Customers/Invoices                                 | blocked                           | Pages belong to checkout-orders-merchant-payments (not ported): disabled with "Coming soon" and the count, "View all" / "Open" in the orders table the same.                                                                                                                                                                                                                  |
| Settings: every control, themes, slug, domain, brand, currency, shipping, payment, Razorpay, recovery, live | same                              | Key secret and Webhook secret got the show/hide eye (Reference has it); recovery Message is a single-line input (was a textarea). The Reference Aurora tile text is unreadable (light on light): not copied.                                                                                                                                                                        |
| Settings validation and toast ("Storefront updated.")                                                       | same + intended                   | Reference validates with native browser bubbles; ours validates in the form with inline messages. Brand hex: ours submits the text box (Reference's was not submitted).                                                                                                                                                                                                             |
| Settings domain states (unverified CNAME hint + Verify now)                                                 | same                              | Verified success path not reachable without real DNS.                                                                                                                                                                                                                                                                                                                         |
| Dark mode (dashboard)                                                                                       | intended                          | Ours renders with the platform dark tokens; Reference's themes were not captured side by side.                                                                                                                                                                                                                                                                                   |
| Store rail on /store/products, /store/products/create                                                       | edit, /store/reviews (TW-CAT-036) | defect-fixed                                                                                                                                                                                                                                                                                                                                                                  | `(catalog-products)/store/layout.tsx` wraps them in `StoreShell`; the three screens lost their own page padding. Verified in both apps; matches the reference layout. |
| Catalog pages with no shop                                                                                  | defect-fixed                      | Reference answers 500 ("shop_name on null"); ours shows the pages with a "No shop yet / Set up your store" card in the rail. `/store` and `/store/storefront` redirect to the wizard (Reference too).                                                                                                                                                                               |

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

Scope: TW-STORE-001..008, 013..022, 024, 029 (API side) plus the public reads of 009, 010, 011, 017, 027, 028, 031 (data only; the
rendering, themes, cart, wishlist, compare and share of 011/012/026/027/030/031 are web). TW-STORE-025 is dead code and not ported.
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
| 024 gates                          | done                                 | e2e permission test; no plan gate (as Reference)                                                                                                                                                      |
| 028 static handle                  | partial                              | stored and returned (`paymentHandle`, `payment.handle`); the server never uses it, as Reference (D-11 kept)                                                                                           |
| 029 default shop                   | done                                 | e2e `ensureDefaultShop` (exported `ShopsService.ensureDefaultShop(orgId, tx?)`); the channel domains must call it                                                                                  |

### Decisions D-01..D-13

| Id   | Result   | Reason                                                                                                                                                                                                                                                                             |
| ---- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-01 | intended | create, edit, delete, reset need `store.shops.manage` (Reference: any member)                                                                                                                                                                                                         |
| D-02 | intended | settings and domain check are `/store/shops/:id/...`; the dashboard takes `?shopId` (default most recently updated); first-shop quirk gone                                                                                                                                         |
| D-03 | intended | catalogue read through `StorefrontProductsReader`: active, in stock, this shop or shared                                                                                                                                                                                           |
| D-04 | intended | webhook: shop by `store_public_lookup_id`, signature verified before any order is read, order must belong to the shop (a foreign workspace's order is invisible under RLS), amount and currency equal the total, cancelled refused, paid replay is a no-op, no secret fails closed |
| D-05 | intended | hero and footer text sanitised (b, i, em, strong, br, a[href], span); product body sanitised on output                                                                                                                                                                             |
| D-06 | kept     | invalid coupon ignored at checkout; quote answers 422 `STORE_COUPON_INVALID`. Fix inside it: a free-shipping coupon is recorded and counted only when really redeemable (Reference recorded an expired one)                                                                           |
| D-07 | intended | cart recovery cancelled in the order transaction; `store.order_placed` outbox event for WhatsApp Pay auto-charge, notifications, invoices (consumers belong to other domains and are NOT wired here)                                                                               |
| D-08 | intended | stock via `takeStock` (row lock) for the quantity actually ordered (Reference subtracted the requested one); optional `Idempotency-Key` (Redis key per shop and key, 24 h)                                                                                                            |
| D-09 | not done | `storefronts_limit` is not a plan key in this repo; not enforced (Reference never enforced it either)                                                                                                                                                                                 |
| D-10 | kept     | filtering is client side (web); facets and price range are of the loaded page, as Reference                                                                                                                                                                                           |
| D-11 | kept     | static payment handle unused by the server                                                                                                                                                                                                                                         |
| D-12 | intended | recovery rows go `active -> sent` after the nudge (`recovered` when the buyer orders); unique partial index on active rows; unique index on `wa_orders.recovery_token` added next to CHK's plain one (touches a CHK table, allowed)                                                |
| D-13 | web      | n/a here                                                                                                                                                                                                                                                                           |

### Other intended differences

- Saving a shop needs a connected WhatsApp number (422 `STORE_NO_SENDER`); Reference only hid the form.
- A taken custom domain is a field error (Reference: database error). Slug is cut to 64 before the suffix. CNAME compared exactly (normalised), not by substring.
- `settings_json` keys the form does not own (`top_strip`, `hero_sub`) are kept on save (Reference erased them).
- DELETE of an unknown shop is 404 (Reference: "Shop deleted." and nothing happened); DELETE needs no `confirm` body (the verb is the confirmation); reset keeps the `confirm=yes` gate.
- Phones compare as digits (RTO history, recovery cancellation); the order stores digits and a leading `+` as Reference does. This fixes Reference's miss of returning buyers who typed a `+`.
- The Razorpay callback is `<shop origin>/s/<slug>/order/<token>` (Reference produced a route that does not exist on custom domains).
- Recovery nudge is sent by the worker sweep (claim with `FOR UPDATE SKIP LOCKED`, at most once); Reference used the Node one-off scheduler. The message is built at send time.
- The view counter counts page 1 of `/home` and product pages (`page >= 2` is the "show more" fetch).

### Kept Reference quirks (flag to owners)

- A wizard save re-enables a disabled shop. Dashboard numbers are workspace-wide and count cancelled orders. The recent-orders list has no 30-day window (the inventory says it does; the source does not).
- Order number on the wire is the order id (Reference shows `#id` to buyers): settle with the CHK owner.
- `ratingCount` is the number of loaded reviews (max 20). The tracking page returns the raw status; the web must map every CHK status to a tracker step.
- Sales-by-day buckets use UTC dates (Reference: app time zone).

### NOT verified

- Real Razorpay (link creation, webhook delivery): adapter tested against a recorded body and a local stub only. Live mode is untested against Razorpay.
- Real WhatsApp sends: the Baileys nudge is tested against a local stub of the Node bridge; the WABA nudge path reads the encrypted config and calls the shared Meta provider but was not run against Meta. The Twilio path is blocked (no Twilio sender in the repo).
- DNS CNAME check on real domains (fixture resolver in tests). Custom-domain root routing needs a web seam; TLS for customer domains is infrastructure.
- Cross-domain shims (`_shims/README.md`) read CHK, device and WABA tables directly until those domains export services.

---

## Twin harness: admin screens

Scope: TW-STORE-001..008, 022..025, 029 (web side), 030, plus the store rail on `/store/products` and `/store/reviews`.
Spec: `apps/web/e2e/storefront-builder/parity/TW-STORE-admin.twin.mjs` (329 generated + custom scenarios; `prepare-org.mjs --shop`
makes our throw-away org; the reference gets a device row and one shop `stw-demo` in workspace 1, removed after the run).
Run: `parity.sh run <spec> --depth full --workers 1` (one worker: the reference edits "the first shop" and the scenarios share it), split
into segments of under 15 minutes because the harness logs in once per run and our access token lives 15 minutes.
Final state (the segments merged into one run): same 1583, intended 138, defects 0, review 26, skipped 1, spec-issue 0; 334 scenarios
per side. First full run: 723 difference rows in 203 scenarios. Triage below.

Per-field value matrix: the generated matrix was replaced by `settings-db.*` and `wizard-db.*` scenarios that compare what was
**stored** (database readback) and whether the page told the user something. Reason: Reference prints its validation errors in a plain box
without alert semantics, which the harness reads as "silent", so every rejected value looked like a difference although the message is shown
(checked by hand: "The custom domain field format is invalid."). Structure, happy path, empty submit, required, Enter, double submit, slow
server, server error, offline and session-expired still come from the generated form scenarios.

### Defects found and fixed (7)

| Defect                                                                                                                                               | Fix                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Settings: a whole shipping fee showed as `999`; Reference prints two decimals (`999.00`)                                                                | web `settings-form.ts` `amountBox`                                           |
| Shipping amounts: `1e5` and `+12.5` were refused, `12.345` (three decimals) was accepted and stored as 12 minor units                                | web: PHP `numeric` rule, two-decimal step, sent as a plain two-place decimal |
| Recovery delay: `1e3` and `007` were accepted; the integer rule refuses both                                                                         | web: integer pattern without exponent or leading zero                        |
| Brand colour: stored as typed (`#1A2B3C`, default `#075E54`); the picker value is lower case; a blank hex was refused                                | web: sent lower case, blank means "not set"                                  |
| Shop slug: Arabic names fell back to `shop` (Reference folds them: `مرحبا` gives `mrhba`); a zero-width character joined words instead of breaking them | api `rules/slug.ts` and web preview `lib/slug.ts`, new unit tests            |
| Wizard edit: a double click on Save sent two PUTs (the guard ended when the save finished, before the page left)                                     | web `shop-form.tsx` guards after success too                                 |
| Settings: the slug box had no required marker (Reference has one)                                                                                       | web `settings-screen.tsx` `required`                                         |

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
| Overview and Storefront sidebar links carry `?shop=<id>`; settings of a second shop open that shop                     | decision D-02 (Reference edits the first shop)                                             |
| Catalog pages of a workspace without a shop answer 200 with a "set up your store" card                                 | Reference answers HTTP 500 (null shop)                                                     |
| Invalid values send no request (checked in the form, inline message); Reference sends them or uses the browser bubble     | earlier decision: validation in the form; stored result and message compared separately |
| Long shop name (up to 191) saves; Reference fails in the database                                                         | slug cut to 64 before the suffix                                                        |
| Taken custom domain is a field error; Reference database error                                                            | deliberate fix                                                                          |
| NUL byte refused; Reference stores it                                                                                     | platform input rule                                                                     |
| Trailing zero-width character kept in a name or hero text                                                              | platform trims whitespace only (not store specific)                                     |
| Blank brand hex means default; Reference saves black by accident; ftp logo URL refused; spaces-only hex trims to blank    | deliberate fixes                                                                        |
| Unowned `settings_json` keys kept on save                                                                              | deliberate fix (Reference erases `top_strip`, `hero_sub`)                                  |
| Two tabs: second save gets 409                                                                                         | optimistic locking rule                                                                 |
| Session expiry keeps the form with a message; Reference redirects                                                         | shared API client, auth domain                                                          |
| Keyboard focus on the Next dev-tools portal has no ring                                                                | exists only under `next dev` (verified: the only ring-less stops)                       |

Review items (26) were read in the gallery and ignored: button, nav-landmark and table counts differ because of the CRM shell and an
accessibility data table behind the chart; the shell's mobile nav is collapsed.

### Open, blocked-env, not verified

Open defects: none. Blocked (not store defects): sibling store screens above. Not verified: Verify now success path (needs a real CNAME),
real Razorpay and WhatsApp sends, permission-denied roles (no second role in the reference), Arabic and RTL rendering and dark mode, the all-data reset
(ours only: refuses without confirm; Reference has no UI entry and wipes the workspace's products), orders with a second currency, production-build timing
(run against `next dev`; one `wizard-add.load` LCP outlier of 1.6 s did not repeat).

## Public shop (visual and behavioural parity)

Scope: TW-STORE-009, 010, 011, 012, 013 (browser side), 014, 015 (beacon), 016, 017, 020, 026, 027, 031: the buyer-facing shop at
`/s/{slug}` with all eight themes. Code: `apps/web/src/features/storefront-builder/public/**`, routes `apps/web/src/app/s/**`, public API
`apps/api/src/modules/storefront-builder/public/**` (+ three small fields in the CAT product reader).

### Method

- **Same data on both sides.** `apps/web/e2e/storefront-builder/public/seed-both.mjs` seeds identical shops (`stp-<theme>`, a disabled
  `stp-off`, an empty `stp-empty`, a no-number `stp-nonumber`), 60 products (sale, new, low stock 3 / 1 / 0, gallery, rich body with a
  `<script>`, no category, no image, one draft), reviews (2 approved, 1 pending), five coupons, six tracking orders (one per status)
  and a sending number. Ours: SQL on `crm_store`, org `pubshop-e2e`. Reference: tagged rows in MariaDB (workspaces 9001-9003, product
  ids 910001+, orders 9100+, an `INR` row in `currencies` because that table is empty on a fresh install and Reference's `formatIn`
  needs it). `node seed-both.mjs clean ref` removes exactly those rows again (done at the end of this run).
- **Visual.** `parity-capture.mjs` takes the same page states on both sides, `parity-diff.py` counts the pixels that differ by more
  than 24/255 (text anti-aliasing included), and every pair was looked at. 302 pairs: 175 at 1440x900, 97 at 390x844, 30 at 768x1024,
  in `scratchpad/shots/pub/pub-<theme>-<page>-<viewport>-{ref,ours}.png`. Order tracking, the 404 screens and the two edge shops
  are theme independent and were captured once per status or state.
- **Behavioural.** `parity-behave.mjs` runs the same probes on both (265 compared values the same, 51 different; every difference is
  classified below). `parity-edge-shops.mjs` covers the empty and no-number shops. `shop.e2e.mjs` (129 checks on our app) is the
  regression run.
- The staff app's cookie banner exists only on ours (root layout, TW-SET-033); the captures press "Decline" first. "Cart" in the
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
| Home, all 8 themes x 3 viewports (strip, header, hero, trust pills, toolbar, filters, grid, cards, badges, show-more block, footer) | same            | Includes Reference's own layout defect: the catalog grid is wider than its column between about 880 and 1570px and is clipped at the right edge (QUIRK, reproduced).                                                                                             |
| Theme cascades (which theme rule really applies)                                                                                    | same            | Reference's theme CSS is only partly effective (see "QUIRKs reproduced"); the port translates each theme literally, keeping the specificity relations, and scopes the home-only rules to the home page.                                                          |
| Fonts                                                                                                                               | defect-fixed    | The first port used system stacks, so nothing looked like Reference. Fraunces, Plus Jakarta Sans and JetBrains Mono (latin and latin-ext) are now self-hosted in `styles/fonts.css` (D-13: no CDN), plus Fraunces with its optical-size axis for the 404 screen. |
| Product page, 8 themes x 3 viewports                                                                                                | same            | Needed: weight, tags and the "New" flag from the API, the second Reviews block, Reference's meta grid, the empty thumbnail track when a product has no image.                                                                                                    |
| Cart drawer: rows, stepper, shipping row, FREE state, hint, note, payment caption, empty state                                      | same            | Light panel in every theme, also Noir.                                                                                                                                                                                                                        |
| Checkout dialog and validation errors                                                                                               | same            | Opens over the still open cart drawer.                                                                                                                                                                                                                        |
| Order tracking, six statuses, desktop and phone                                                                                     | same            | Subtotal is total minus shipping, no discount row, Total always with two decimals.                                                                                                                                                                            |
| Quick view, wishlist drawer (with items), compare bar and drawer, share dialog                                                      | same / intended | Share: Reference prints the stray text `this.textContent='Copy',1500)">` and loads the QR from a third-party service; ours is clean and local (intended).                                                                                                        |
| Unknown / disabled shop, unknown product or order                                                                                   | same / intended | Reference answers with its platform "Page not found" screen; ours is that screen, with the platform brand name instead of "Reference" (intended).                                                                                                                   |
| Empty shop, shop without a sending number                                                                                           | same            | No "Ask a question", no footer WhatsApp link, checkout ends on the dialog with the tracking link.                                                                                                                                                             |

### Behaviour result

| Area                                                                                                                                            | Result       | Note                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cart: add, badge bump, toast "<name> · added to cart", localStorage line shape, reload persistence, stepper, minimum 1, remove                  | same         | Key is `sf_cart_<slug>` (Reference: `sf_cart_<shop id>`; ours has no numeric public id): intended.                                                                                                               |
| Stock caps: stock 1 / 3 / 0 modals and texts, drawer typing above stock (toast "Only 3 in stock", value shown 3), typing 0 gives 1              | same         |                                                                                                                                                                                                               |
| Shipping row (fee, hint, FREE), total, note, caption                                                                                            | same         |                                                                                                                                                                                                               |
| Coupon quote texts (SAVE10, FLAT100 with minimum, SHIPFREE, inactive, expired, unknown, cleared)                                                | same         |                                                                                                                                                                                                               |
| Checkout validation texts, field limits and placeholder, payment radios, request content, cart cleared, status line, wa.me URL and message text | same         | The request and response use camelCase keys (`paymentMethod`, `waUrl`) where Reference used snake_case: contract convention, intended.                                                                           |
| Tracking link in the hand-off and the "Order placed" dialog without a number                                                                    | same         |                                                                                                                                                                                                               |
| Abandoned-cart beacon: fires once on a valid phone blur, not on a short one, same body                                                          | same         |                                                                                                                                                                                                               |
| Search, categories (OR), price range, on sale, "In stock only", sort, list view, reset, clear, "Nothing matches"                                | same         |                                                                                                                                                                                                               |
| Show more                                                                                                                                       | intended     | Reference's "Show more" is broken (HTTP 500, see QUIRKs); ours loads page 2 as the inventory specifies.                                                                                                          |
| Wishlist, compare (4 max, "Compare full"), quick view, share                                                                                    | same         |                                                                                                                                                                                                               |
| Product page: pill texts, thumbnails, Save %, meta list, tabs, ask link, related order, review block, sanitised body                            | same         | The "Ask" link now uses PHP's `urlencode` (`+` for spaces) like Reference.                                                                                                                                       |
| Review form: empty name message, success message, stored `pending`                                                                              | same         | Each of the two forms posts its own fields (Reference's duplicate ids made the bottom one unusable).                                                                                                             |
| SEO: title, description, og:*, twitter, robots, JSON-LD                                                                                         | defect-fixed | The platform's title suffix ("... - CRM Platform"), default `robots` and Open Graph block leaked onto every shop page; now absolute titles and nothing inherited. JSON-LD escapes `<` as `<` (same document). |
| View counter                                                                                                                                    | same         | One row per shop and day, +1 per full render (also the product page).                                                                                                                                         |
| Drafts and archived products                                                                                                                    | intended     | Not listed, product page 404 (D-03); Reference lists drafts and serves them. Counts differ by one on the seeded catalog (58 vs 59).                                                                              |
| RTO band of a COD order for a returning phone                                                                                                   | intended     | Reference never matches the history (`+` in the stored phone, digits in the lookup); ours does.                                                                                                                  |
| Responsive: filters stack at 880px, 2 columns at 560px, 1 at 340px, search and nav hidden below 760px, drawers 95vw                             | same         |                                                                                                                                                                                                               |
| Hover cards (lift, shadow, zoom, heart and eye buttons), focus ring of the search box, nav and icon hovers                                      | same         |                                                                                                                                                                                                               |

### Defects fixed in this run

1. Fonts were system stacks: all eight themes looked different from Reference. Now the real families, self-hosted.
2. The shell inherited the staff app's Tailwind preflight (inputs, buttons, headings, SVGs); Reference draws them with browser defaults
   (Arial controls, bold headings). Rolled back inside `.sf-root`, element rules are `:where()` so component classes win.
3. Hero trust pills had no top margin and the filter groups no bottom padding (reset specificity), toolbar, filters, view toggle,
   header and icon buttons were 2 to 4px off, the catalog had a 1280px cap Reference does not have.
4. Product cards: the "New" badge, weight and tags in the meta list were missing (the API did not send them); stock 0 products were
   shown as "Sold out" and hidden by "In stock only", Reference lists them with a working button and stops at the cart.
5. Product page: Reviews block missing, meta list a different grid, tab and quantity controls with another size and font, the
   shipping text computed a threshold Reference never shows, no empty thumbnail column without an image.
6. Drawers, modal, toast and compare bar followed the theme palette; Reference's are always light. Drawer buttons were icons,
   Reference uses the text glyph; the empty cart image fallback is the package emoji.
7. Checkout closed the cart drawer; success with a wa.me URL opened another dialog instead of "Order placed! Opening WhatsApp…".
8. The order tracking page: missing "Delivery to" card (the API never sent the address), a coloured link and footer margin lost to a
   reset, discount row and item-sum subtotal instead of total minus shipping, grey text darker than Reference's.
9. The "Nothing matches" block replaced the grid beside the filters instead of sitting below the layout.
10. The 404 was a small custom page; Reference shows its platform "Page not found" screen.
11. `top_strip` and `hero_sub` settings are now honoured (Reference reads them although no screen writes them).
12. The tracking page's `Total` and the WhatsApp confirmation always show two decimals (`WaOrder::total_display`), and the confirmation
    text is escaped like PHP's `rawurlencode`.
13. The drawer stepper kept the typed number (10) when the cart clamped to 3.
14. SEO leak of the platform title, robots and Open Graph tags (see above).

### QUIRKs reproduced on purpose

Recorded in the inventory entries (TW-STORE-009 rules 10-14, 010 rules 11-13, 011 rule 7, 012 rule 8, 031 rule 8):
clipped catalog grid between 880 and 1570px; "Featured" keeps the last sort; "In stock only" does nothing; below 760px the header
search and nav are hidden; closed drawers' shadow on the right edge; the page's own product is not clamped to its stock on its page
and the pill reads "Only 0 left"; the Reviews list and form appear twice; the free-shipping copy always says 999.00 in the shop
currency; `formatIn` formats (`₹109.00 — ₹589.00`) next to the card format (`₹ 109`); the Range hint comes from page 1 only; the
checkout dialog opens over the open cart drawer; Noir and Mercato have no gold or yellow cart button, the themes' `.add` rules lose to
the base rule (only hovers apply), the theme badge is always coral; drawers and modals are light in Noir too; "Reset filters",
"Clear filters" and "Show more" use the default (black) text colour; sort select, search box and product-page buttons use Arial.

### Differences kept on purpose (not defects)

- Drafts and archived products are not public (D-03); the seeded catalog therefore has 58 listed products where Reference shows 59.
- "Show more" works (Reference: broken, see below). The hidden toast no longer swallows taps (Reference's has no `pointer-events: none`, so
  on a phone it covers part of "Order on WhatsApp" even when invisible). The share dialog and QR are clean and local.
- Header and filter box stay sticky when scrolling (Reference's CSS says sticky but `overflow-x: hidden` on html and body stops it in every
  browser). Scrolled screenshots are compared with `UNSTICK=1`.
- On touch devices the heart and eye buttons of a card are always visible (Reference shows them on hover only).
- Local storage keys use the slug, request and response keys are camelCase, product ids are uuids, screen-reader labels (count in the
  cart label, "Skip to content", rating text) are additions, the 404 shows the platform brand name from the site settings.
- The staff app's cookie banner and Next's dev indicator appear on ours only.

### Reference defects found (not reproduced)

- "Show more products" always fails: `index()` is typed to return a `View` but returns a `Response` for `?partial=1&page>1`, a
  TypeError (HTTP 500); the script then removes the button, so only the first 48 products are ever reachable.
- The share dialog's Copy button is built with `JSON.stringify` inside an `onclick` attribute: the attribute ends early and stray text is
  printed.
- The invisible toast keeps catching taps (no `pointer-events: none`).
- The checkout RTO lookup compares digits with a stored phone that contains `+`, so no history is ever found.

### Not verified, and why

- Real WhatsApp, Razorpay and UPI flows (nothing is sent; the hand-off URL and text were compared, the navigation was stubbed). The
  Razorpay-link and webhook paths belong to TW-STORE-018 (backend tests).
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

Post-merge status (origin/main merged): the pages and generated form scenarios were re-run clean (same 589, intended 17, defects 0, review 26). The value matrices and custom scenarios were re-run too, but 14 scenarios failed because the harness could not log in to our app mid-run (login timeout, likely a login or realtime-ticket rate limit after many sessions) and 2 `brand_color` cases timed out filling the field; they were not re-run or triaged, so they are unverified, not passed.
Merged-run totals (segments merged): same 1531, intended 134, 14 error scenarios untriaged, review 26 (shell counts, as before). The pre-merge result above (0 open defects) stands for everything that did not error.
The run was stopped on request; the tagged reference rows were removed.

## Twin harness: public shop

Scope: TW-STORE-009..017, 020, 021, 026, 027, 031 (the buyer shop at `/s/{slug}`). Spec: `apps/web/e2e/storefront-builder/parity/TW-STORE-public.twin.mjs`
(477 scenarios per side at depth full; fixture from `public/seed-both.mjs`, cleaned afterwards, the tagged reference rows 9001-9003 are removed).
Run in segments (`--only` on the id prefix): public pages are opened without a login, so our 15-minute token is not involved. Throttled routes need
`--workers 1`; the spec clears the reference's throttle cache rows and our Redis counters (database 9) before the scenarios that post.

### What ran, and what did not (honest status)

| Segment (id prefix)                                                                                                       | Scenarios | Last result                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pages.` (all 8 themes, product, tracking, 404, empty/no-number shops; probes load, responsive, a11y, keyboard, degraded) | 93        | same 793, intended 28, 3 minor defects (a11y moderate count on the 404 screen) fixed afterwards in `app/s/not-found.tsx` (main landmark), not re-run                               |
| `struct.` `cart.` `misc.` `list.` `kbd.`                                                                                  | 177       | same 1112, intended 110 after the last triage, 1 blocker (uppercase product address) fixed in the API afterwards, not re-run                                                       |
| `fail.` `coupon.`                                                                                                         | 42        | after the fixes: same 168, intended 3, 4 minor open at the last compare (raw checkout class: throttle counter had been reset in the wrong Redis DB, fixed in the spec, not re-run) |
| `co.` (checkout matrix)                                                                                                   | 121       | only the first 30 scenarios ran cleanly (no defect after triage); the run died at `co.phone.brackets` (browser closed), the rest are **not verified**                              |
| `review.` `xss.`                                                                                                          | 47        | **not run**                                                                                                                                                                        |

Not verified: checkout matrix beyond name cases, phone/address/note matrices, payment methods, coupon-at-checkout, double submit, beacon scenarios, review form
matrix, review/checkout rate-limit scenarios on a fresh run, the all-theme interactive flows other than aurora/noir/bazaar cart and the pages probes. Production-build
behaviour (everything ran against `next dev`). Real WhatsApp/Razorpay.

### Defects found and fixed (code)

| Defect                                                                                                 | Fix                                                                                       |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `/s/STP-AURORA` and product addresses in capitals were 404 on ours (Reference matches case-insensitively) | api `public-shop.loader.ts` and `public-catalog.service.ts` lower-case the slug           |
| Rate limits counted only well-formed bodies (the 422 came first), Reference counts every call             | api `public-rate-limit.guard.ts` (`@PublicLimit`) counts before validation; new e2e cases |
| 404 screen had no `main` landmark (extra axe findings)                                                 | web `app/s/not-found.tsx`                                                                 |

### Intended (reasons in the spec `intended[]`)

Drafts not public (counts differ by one); show more works; share dialog clean; platform brand on the 404; sticky header; hidden toast lets taps through; RTO band for a returning COD phone;
NUL refused; trailing zero-width kept; line quantity capped at 999 and typed quantities normalised; storage read back is validated (Reference renders junk and negative totals);
fallback font in one stack; focus moves into drawers and dialogs, ARIA tabs, skip link, main landmark, closed panels inert, autocomplete hints, search label (accessibility additions);
same-origin-only shop routes (a cross-origin POST is 403); `notFound()` page error "negative time stamp" appears only under `next dev` (not verified on a production build).
Reference quirk not copied: its four throttled routes share one counter per address; ours counts per route.

### Open

No open store defect known; the unrun and unverified parts above are the gap. Status stamp: open-defects (unverified), not `clean`.

## Merchant admin API (orders, coupons, customers, groups, payments, shared gateway)

Scope: the sidebar entries Reference blocks here as "Coming soon" (Orders, Groups, Coupons, Payments, Checkout gateways, Customers) at API level, and the
single workspace payment gateway. Web screens are not part of this change (no `apps/web` edit): the rows above stay `blocked` for the screens
until the web port lands, but every endpoint they need now exists. Wiring map: [wiring/checkout-orders-merchant-payments.md](../wiring/checkout-orders-merchant-payments.md).
Code: `apps/api/src/modules/storefront-builder/admin/**`, `apps/api/src/modules/checkout-orders-merchant-payments/**`, contracts
`packages/contracts/src/checkout-orders-merchant-payments/**`. Reference: `WaOrderController`, `WaCouponController`, `WaCustomerProfileController`,
`WaGroupController`, `MerchantGatewaysController`, `WhatsAppPayController`, `CustomerPaymentService`, `CustomerPaymentWebhookController`.
Not run against the live reference (no admin session driven here): behaviour was matched from the controllers and models, so the rows say
`same (source)` where they are matched from code and not compared in a browser.

### Evidence

| Area                                                                       | Result          | Evidence (named tests)                                                                                                                                                                  |
| -------------------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Orders list: status, source, search by phone / name, 25 a page             | same (source)   | e2e "orders: list, filters, detail" (status, source, shop, payment status, date range, phone in any formatting, name, `#id`, cursor paging, counts)                                     |
| Order detail                                                               | same + added    | lines, totals, address, coupon, `payments`, `timeline` from the audit trail, the gateways it can be paid with (Reference's "Send checkout" picker)                                         |
| Status form (any status to any, notes, link, buyer DM)                     | same (source)   | e2e "orders: status, payment links, delete"; unit `order-status`, `order-notice` (Reference's texts)                                                                                       |
| Send / generate payment link                                               | same (source)   | e2e "send-payment-link ...", "generates a Razorpay link on the workspace gateway ...", "a shop override is used ..."                                                                    |
| Delete order                                                               | same (source)   | e2e "delete removes the order and its lines for good"                                                                                                                                   |
| Coupons CRUD, code upper case, unique ignoring case, percent clamp, toggle | same (source)   | e2e "coupons" (create, edit, switch, delete, filters), "works with the checkout"; unit `coupon-admin` and the existing `coupon-rules`; the checkout's `SqlCouponDirectory` is untouched |
| Customers: list by name then phone, search, save by phone, delete          | same (source)   | e2e "customers" (totals per currency, orders matched by phone digits, literal search, paging, edit, delete keeps orders)                                                                |
| Groups: list, subject search, ordering code set / clear / unique           | same (source)   | e2e "groups"                                                                                                                                                                            |
| Gateways: save, mask, enable, delete, per-store                            | same + intended | e2e "gateways: catalogue, save, mask, test, default, delete"; unit `gateway-rules`, `workspace-gateway-resolver`                                                                        |
| Payments: WhatsApp Pay configs                                             | same (source)   | e2e "payments overview and WhatsApp Pay"                                                                                                                                                |
| Isolation (two workspaces) and RLS                                         | proven          | every e2e group has an isolation test; integration `shared-gateway-schema` (forced RLS, `WITH CHECK`, lookup, shop delete trigger, backfill)                                            |

### Intended differences (all approved by the brief, 2026-10-05 unless noted)

| Id     | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Why                                                                                                                                                                                   |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CHK-1  | **One shared workspace gateway.** Reference keeps a gateway list for the store (`wa_merchant_gateways`, keys per workspace or shop) and another per feature (the storefront's Razorpay keys on the shop, invoices' own gateway). Here one row per (workspace or shop, gateway) is configured once in Settings and read by the store checkout AND Sales invoices.                                                                                                                          | Owner decision 2026-10-05: configure the gateway once, with an optional override per store. Reference's per-feature gateways are not ported as separate stores.                          |
| CHK-2  | Precedence is shop override > workspace default > the keys typed on the storefront settings page > none (`WorkspaceGatewayResolver`). The settings page still writes its old column and `StoreKeysMirror` copies it into the shop's override, so what a merchant types there is what the checkout uses; a later save on the gateway screen wins.                                                                                                                                       | Nothing breaks for shops configured before; the data migration `...090200` copies existing Razorpay keys (field-by-field ciphertext carried as is, never decrypted in SQL).           |
| CHK-3  | `wa_merchant_gateways.storefront_id = 0` (the workspace row) could not exist because of the foreign key to `wa_storefronts`; the key is dropped and a trigger deletes a shop's overrides with the shop. A default flag per scope (`is_default`, one per scope) is new.                                                                                                                                                                                                                 | Reference's MySQL had no such key. `RESTRICT` would have blocked deleting a shop that has an override.                                                                                   |
| CHK-4  | Credentials are one AES-GCM envelope over a JSON map (as platform billing), validated against the gateway's declared fields (an unknown key is 422; Reference accepted any key and a raw `key: value` textarea). A blank field keeps the stored value, `clear` removes one (Reference could not). Responses carry `hasValue` and a mask, never the value.                                                                                                                                    | Security hardening; the same field schema as the platform gateways (`credentialFieldsFor`).                                                                                           |
| CHK-5  | The driver catalogue is the shared library (33 gateways, `infra/providers/platform-payment-gateways`), not Reference's "32 drivers + offline". `supportsPaymentLinks` tells which can make a hosted link (Razorpay through its Payment Links API; the others when their driver answers a redirect; widget and form gateways cannot be sent as a link).                                                                                                                                    | Reuse of the existing adapters, no duplicate drivers.                                                                                                                                 |
| CHK-6  | Webhooks: one address per gateway row (`/v2/store-public/webhooks/gateway/:uuid`). The address names the workspace, the shop and the secret; the driver verifies the signature BEFORE the body is read. Reference resolved the order by scanning recent unpaid orders for the body's reference before verifying. A gateway with no signing secret is refused (403), a disabled one is 404. Amount and currency must equal the order; a shop's gateway only settles its own shop's orders. | Reference's order is a hole (decision D-04 applies the same hardening to the Razorpay webhook).                                                                                          |
| CHK-7  | Test connection: Razorpay and Stripe are verified with the provider (a money-free authenticated read); every other gateway is checked for required fields only and the answer says `level: fields`. Reference had no test.                                                                                                                                                                                                                                                                | Honest: no claim is made for gateways with no cheap auth call.                                                                                                                        |
| CHK-8  | Orders: every action has its own key (`store.orders.read                                                                                                                                                                                                                                                                                                                                                                                                                               | manage                                                                                                                                                                                | delete`), a stale status form is 409 `ROW_VERSION_CONFLICT`, the change is audited and published (`store.order_status_changed`) for CRM / invoicing instead of Reference's cache flag, `ok`of the payment-link actions means "saved" and`sent`says whether the WhatsApp message went out (Reference's`ok` was the send). | Conventions of this repo; consumers live in other domains. |
| CHK-9  | The buyer message goes out from the workspace's primary sender (the same service as cart recovery), not from the shop's own number, and is not translated to the buyer's language (Reference called its ordering translator). Sent after the commit, best effort, as Reference.                                                                                                                                                                                                              | The shop-number routing and the translator belong to the channel / ordering domains. Recorded as `blocked` for parity.                                                                |
| CHK-10 | Customers: deleting a saved customer removes the profile only. Reference also deleted every order of that phone. List adds order count, lifetime total per currency (cancelled excluded) and the linked CRM contact; edit and open one customer are new.                                                                                                                                                                                                                                  | Orders are financial history (same decision as the WhatsApp customers screen). Reads only, nothing Reference does is removed.                                                            |
| CHK-11 | Coupons: edit also refuses a code another coupon holds (Reference only checked on create and let the database refuse); a start date and a shop scope are accepted (columns the checkout already reads); a row version guards an edit; a usage list is new. Money is minor units on the wire (Reference posted major units).                                                                                                                                                                  | Contract rules of this repo; the extra fields use existing columns.                                                                                                                   |
| CHK-12 | Groups: no create or delete (Reference has none; rows are mirrored by the WhatsApp bridge). List is cursor-paged (most recently synced first, then subject).                                                                                                                                                                                                                                                                                                                              | Same as Reference; pagination is forced by the repo.                                                                                                                                     |
| CHK-13 | Invoices: the public pay page tries the shared gateway first (an attempt with provider = the gateway slug, a hosted link made outside the transaction, settled by the gateway webhook through the `INV-` reference). The old `hmac_generic` connection stays as the fallback and keeps its own webhook; with neither the page is as before. A failed link closes the attempt and still shows the bank instructions. Migration `...090300` widens the attempt's `provider` check.       | "Replace the hmac_generic lookup only if a clean adapter exists": it does not (its webhook is a different protocol), so the shared gateway is first and the old path is the fallback. |

### Merchant admin UI (web screens of the eight store routes)

Screens: `apps/web/src/features/checkout-orders-merchant-payments/` (wiring map: "Web screens"). Same screens and flows as Reference;
the differences below are intended.

| Id     | What                                                                                                                                                                                                                                    | Why                                                                                                             |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| CHK-U1 | Coupons: the per-user usage limit that Reference's form shows is absent; the contract has only the total usage limit.                                                                                                                      | The field is not in the `store-coupons` contract and is not invented here.                                      |
| CHK-U2 | Customers: no email field; the screen shows name, phone, company, address, order totals and the CRM contact link.                                                                                                                       | `wa_customer_profiles` has no email column.                                                                     |
| CHK-U3 | Invoices (`/store/invoices`): a filtered view of the Sales invoice list. The list API has no `source` filter, so the screen keeps `source = own` rows client-side, fetching up to 6 pages by itself and offering Load more beyond that. | Reuses the one invoice list instead of a second endpoint. A server-side filter would make it exact and cheaper. |
| CHK-U4 | Orders: the status select offers every status, as Reference does (no state machine); the screen only suggests the usual next step.                                                                                                         | Same as Reference (CHK-8).                                                                                         |
| CHK-U5 | Checkout gateways: one scope selector (workspace default or one shop) is shared by the whole screen. Reference repeated the shop choice per gateway form.                                                                                  | Improvement on Reference, recorded as intended (an own, better approach is allowed where Reference is wrong).         |
| CHK-U6 | Groups: an empty directory is explained truthfully (the sync writer is not built, so no time is promised) and links to Channels.                                                                                                        | `wa_groups` has no writer yet (see "Not done / blocked" in the wiring map).                                     |

### Not verified, and why

Real Razorpay / Stripe calls (fixtures only: `STORE_PROVIDER_MODE=fixture`; the signed-notification path is exercised with real HMACs),
`payment_link.paid` against a live Razorpay account, the WhatsApp message on a real device (a local bridge stub receives the call), the
browser screens (built since, see Merchant admin UI above; twin run still to do), `wa_groups` rows from a real group sync (no writer exists yet), the invoice flow with a gateway other
than Stripe and Razorpay.

## Store orders in the CRM (contact link, sales order, invoice), 2026-10-05

Owner decision of 2026-10-05: store orders are part of the single CRM and of Sales, not an island. Wiring map:
[wiring/store-orders-crm.md](../wiring/store-orders-crm.md). Migration `20261029090000_store_orders_contact_link.sql`.

### Intended differences

| Id    | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CRM-1 | **Store customers are linked to contacts on purpose.** Reference keeps `wa_customer_profiles` and the buyers of `wa_orders` separate from contacts (a phone string on each side). Here every order and saved customer carries `contact_id` (found or created by phone with the CRM's own canonicaliser, source `store` or `whatsapp_order`, label "Store customer"), so one person is one record with one timeline.                                                                                                                                                                                                                                                                                          |
| CRM-2 | A plan out of contacts never blocks an order: the order is placed with `contact_id` null and a warning is logged (Reference had no cap here). A number that cannot be read as a phone (fewer than 7 digits after the default country is applied, or a bare local number with no default country) also leaves the link empty; it is reported by the backfill, never guessed.                                                                                                                                                                                                                                                                                                                                  |
| CRM-3 | Every order becomes a confirmed **sales order** (reference "Store order #N") and a "Store order #N" entry on the contact's timeline; Reference had neither. The invoice or receipt follows the workspace trigger (`trigger_own`, default `on_paid`) instead of Reference's `auto_send_own` gate (that flag only meant "send it over WhatsApp"; sending stays a separate, unbuilt step). `manual` is a new trigger value: no automation, the "Create invoice" button only.                                                                                                                                                                                                                                       |
| CRM-4 | Receipt versus tax invoice is Reference's rule (`OwnStoreInvoiceMapper`): a receipt unless a real tax amount was captured. The tax rate comes from the order's tax line when it has one, else it is derived from the captured amount, so the document reproduces it; if the checkout's total and the priced document still differ the difference is written on the invoice's timeline. A document discount is spread over the lines, as an accepted quote's is.                                                                                                                                                                                                                                              |
| CRM-5 | An order that is paid has its invoice settled by a ledger entry (method and source `storefront`, or `wa_pay`) in the same step, idempotent on the gateway payment id (`wa_order:<id>` when none), like Reference's `RecordPaymentOnOrderPaid` listener. A cancelled order's sales order is cancelled unless an invoice made from it is still live.                                                                                                                                                                                                                                                                                                                                                           |
| CRM-6 | The AI ordering flow now publishes `store.order_placed` (Reference had no event); the WhatsApp catalog cart's `whatsapp.order.received` payload gained `orderNo`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| CRM-7 | **Our Customers list includes every buyer; Reference's lists saved addresses only.** Reference's `/store/customers` shows `wa_customer_profiles`, so a buyer who ordered but was never saved is invisible there (the WhatsApp ordering flow saves nothing at checkout either). Ours lists the saved customers plus every distinct buyer in `wa_orders`, grouped by normalised phone, marked "No saved address" until a profile with an address exists; saving or editing one is Reference's save-by-phone. Checkout and the other order writers now keep a minimal profile (name, phone, address when given; blanks only, never overwriting an edit) in step. Deleting a profile never deletes orders (as before). |
| CRM-8 | The list is sorted by last activity (latest order, else the profile's last change), not by name; the id of an order-only buyer is `phone:<digits>`. Reference sorted saved customers by name.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| CRM-9 | A bare local phone number is read in the platform's default country (like the leads module), where Reference kept the digits as typed and the first CRM pass read "7999834066" as a Russian number. Without a default country it is reported, never guessed. Orders that predate the contact link are caught up by the repeatable `backfill:store-orders` command.                                                                                                                                                                                                                                                                                                                                           |

### Evidence

Unit: `test/unit/contacts-attributes-tags/contact-resolver.service.spec.ts` (phone, existing, new, cap, error, tag cap, blanks),
`test/unit/store-orders-sales/store-order.rules.spec.ts` (receipt vs tax invoice, discount and shipping, derived rate, currency scale,
triggers, discount spread), `store-order-sales.service.spec.ts` (idempotent redelivery, `invoice_id` already set, plan gates, contact cap,
cancel, manual button, consumer). Integration: `test/integration/store-orders-sales/store-orders-link-schema.spec.ts` (composite
set-null foreign keys, forced RLS as the application role, backfill by phone inside one workspace only, backfill is not an edit).
End to end (real Postgres): `test/e2e/store-orders-sales/store-orders-sales.e2e.spec.ts` (a public checkout order has a contact, a sales
order, a timeline entry, then a paid receipt with its ledger entry; a tax order is a tax invoice; redelivery makes nothing twice; the
manual button; cancel; tenancy). Customers list and backfill (second pass): unit `test/unit/common/phone-key.spec.ts` (the one phone rule,
default country, no guess without one, SQL key), `test/unit/checkout-orders-merchant-payments/store-customers.spec.ts` (ids, flags, cursor),
resolver specs (default country, `saveProfile`, plan cap); e2e `test/e2e/store-orders-sales/store-customers-union.e2e.spec.ts` (profile-only,
order-only and both, one buyer typed three ways, search, paging, shop filter, order-only detail and edit, SQL key equals TypeScript key, two
workspaces, checkout keeps the profile and never overwrites an edit) and `store-orders-backfill.e2e.spec.ts` (unpaid order gets contact,
sales order and profile but no invoice, paid order gets a receipt, unreadable phones reported, contact cap skip, dry run writes nothing,
second run changes nothing, one workspace versus all); web render tests `customers-screen.render.test.tsx` (badge, order-only row, en and ar).

### Not verified, and why

Real WhatsApp catalog cart and AI ordering orders (no live session here; their writers are covered by the same resolver and unit tests,
and by the existing e2e suites still passing), the Shopify/WooCommerce mirror path with a real store, the invoice settings screen for
`trigger_own` (not built), the contact detail tab and the orders screen's button (web, built by the next session).
