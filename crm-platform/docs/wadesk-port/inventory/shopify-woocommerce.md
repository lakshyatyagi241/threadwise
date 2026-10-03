---
domain: shopify-woocommerce
code: ECOM
title: Shopify and WooCommerce integrations (connect, webhooks, mirror, WhatsApp automations, offers, COD, cart recovery, concierge)
wadesk_version: '1.7.0'
sources_read: 34
---

# Shopify and WooCommerce

## Overview

A workspace connects one store (Shopify by OAuth, WooCommerce by REST keys). WaDesk registers webhooks on the store, mirrors its products, orders
and customers into its own tables (`wa_products`, `wa_orders`, `contacts`), and sends WhatsApp templates when store events fire. The merchant maps
each event ("order confirmation", "shipped", "abandoned cart step 1", "COD confirmation", "back in stock", ...) to an approved template, the
people it goes to (customer, an admin number, or both) and which order fields fill the template variables. On top of the automations the screen
sends one-off offers and win-back broadcasts to segments, confirms cash-on-delivery orders with a Yes/No reply, recovers abandoned carts with up
to three scheduled follow-ups, tells people when a sold-out product is back, and (WooCommerce only) answers "reorder", "points", a review rating
and "change address" on WhatsApp. Both integrations share the engine-aware sender (`CommerceEventNotifier`: WABA template, Unofficial text with
buttons, Twilio content). The data model is already in `20261001101800_ecom_wadesk_schema.sql`; `wa_products` and `wa_orders` belong to the catalog and
checkout schema and carry `shopify_*` and `woo_*` ids.

Plan gates: `integration_shopify` and `integration_woocommerce` (route group gate and checked again in the connect and offer actions). Platform
switches: `shopify_enabled` (plus the Shopify app's `shopify_client_id`, `shopify_client_secret`, `shopify_scopes`, `shopify_redirect_uri`) and
`woocommerce_enabled`, set on two admin settings pages.

Connects to: message-templates (the templates automations send), team-inbox-conversations (the inbound chokepoints for COD replies, stock opt-in
and concierge), contacts-attributes-tags (customers and the "Shopify Customers" and "WooCommerce Customers" groups), catalog-products and
checkout-orders-merchant-payments (the mirror tables), flow-runtime-engine (the commerce node's checkout links and the purchased port),
invoicing (auto-invoice on a paid order), scheduled-queue-warmer (the one-off scheduler abandoned-cart steps ride on), wallet and plan usage
(plan gates), platform-settings-branding-storage (admin settings, brand name for the plugin), dashboards-analytics-charts (integrations panel).

Consumers that already exist or belong to others are listed in the wiring section at the end. Features that need another domain are `blocked` with
the domain named; the port builds everything it can and puts the rest behind interfaces.

## Feature index

| Id          | Feature                                                                             | Status  | Priority | Effort | Depends on                 |
| ----------- | ----------------------------------------------------------------------------------- | ------- | -------- | ------ | -------------------------- |
| WD-ECOM-001 | Admin settings: Shopify app (switch, client id, secret, scopes, redirect)           | pending | P0       | S      | platform-settings          |
| WD-ECOM-002 | Admin settings: WooCommerce switch                                                  | pending | P0       | S      | platform-settings          |
| WD-ECOM-003 | Plan gates and permission keys                                                      | partial | P0       | S      | plans-subscriptions-trials |
| WD-ECOM-004 | Shopify connect screen and store dashboard shell                                    | pending | P0       | M      | WD-ECOM-005                |
| WD-ECOM-005 | Shopify OAuth start: domain check, state, authorize address                         | pending | P0       | S      | WD-ECOM-001                |
| WD-ECOM-006 | Shopify OAuth callback: signature, state, token, shop, store, webhooks, import      | pending | P0       | L      | WD-ECOM-005                |
| WD-ECOM-007 | Shopify webhooks: register the 12 topics, tear down                                 | pending | P0       | S      | WD-ECOM-006                |
| WD-ECOM-008 | Shopify webhook receiver: signature, log, event dispatch, side effects in order     | pending | P0       | L      | WD-ECOM-007, 010           |
| WD-ECOM-009 | Automations: map each event to a template, recipients, variables, delay (both)      | pending | P0       | M      | message-templates          |
| WD-ECOM-010 | Event message: variables, recipients, engine-aware send, log (both)                 | pending | P0       | L      | WD-ECOM-009                |
| WD-ECOM-011 | Import: products, orders and customers into the mirror (both)                       | pending | P0       | L      | catalog, checkout schema   |
| WD-ECOM-012 | Keep the mirror in step from webhooks; auto-invoice hand-off (both)                 | pending | P1       | M      | WD-ECOM-011                |
| WD-ECOM-013 | Sync now and disconnect (both)                                                      | pending | P0       | S      | WD-ECOM-011                |
| WD-ECOM-014 | Send offer: one template to a contact group with a product and a coupon (both)      | pending | P1       | M      | WD-ECOM-010                |
| WD-ECOM-015 | Win-back: smart segment from order history (both)                                   | pending | P1       | M      | WD-ECOM-010                |
| WD-ECOM-016 | COD double confirmation: ask, track, Yes/No reply flips the order (both)            | pending | P0       | L      | WD-ECOM-010                |
| WD-ECOM-017 | COD to prepaid nudge (both)                                                         | pending | P1       | S      | WD-ECOM-010                |
| WD-ECOM-018 | Delivered automation from the courier status (Shopify)                              | pending | P1       | S      | WD-ECOM-010                |
| WD-ECOM-019 | Abandoned-cart recovery: three steps, scheduled, cancelled on purchase (both)       | pending | P1       | L      | scheduler                  |
| WD-ECOM-020 | Back-in-stock waitlist: opt in by message, notify on restock (both)                 | pending | P1       | M      | WD-ECOM-010                |
| WD-ECOM-021 | App uninstalled cleanup (Shopify)                                                   | pending | P1       | S      | WD-ECOM-008                |
| WD-ECOM-022 | Shopify mandatory GDPR webhooks                                                     | pending | P0       | S      | WD-ECOM-001                |
| WD-ECOM-023 | Store dashboard tabs: overview, orders, products, customers, analytics, activity    | pending | P0       | XL     | WD-ECOM-011                |
| WD-ECOM-024 | Settings tab: store facts and registered webhooks                                   | pending | P2       | S      | WD-ECOM-023                |
| WD-ECOM-025 | WooCommerce connect: test credentials, save, webhooks, import                       | pending | P0       | L      | WD-ECOM-002                |
| WD-ECOM-026 | WooCommerce webhooks: register the 7 topics, signature, tear down                   | pending | P0       | S      | WD-ECOM-025                |
| WD-ECOM-027 | WooCommerce webhook receiver: status automations, mirror, COD risk, cart, flow      | pending | P0       | L      | WD-ECOM-026, 010           |
| WD-ECOM-028 | WooCommerce phone normalisation to E.164                                            | pending | P0       | S      | countries list             |
| WD-ECOM-029 | WooCommerce order context: tracking, invoice link, pay link                         | pending | P1       | M      | WD-ECOM-010                |
| WD-ECOM-030 | COD risk score on a WooCommerce order                                               | pending | P1       | S      | WD-ECOM-016                |
| WD-ECOM-031 | Concierge on WhatsApp: reorder, points, review reward, change address (WooCommerce) | pending | P1       | L      | WD-ECOM-010                |
| WD-ECOM-032 | WooCommerce companion plugin download                                               | blocked | P1       | M      | decision (see entry)       |
| WD-ECOM-033 | "Send from" sender chosen per WooCommerce integration                               | pending | P1       | S      | WD-ECOM-009                |
| WD-ECOM-034 | Inbound chokepoints: COD reply, stock opt-in, concierge, in WaDesk's order          | partial | P0       | M      | team-inbox-conversations   |
| WD-ECOM-035 | Invoices tab and auto-invoice on a paid order                                       | blocked | P1       | M      | invoicing                  |
| WD-ECOM-036 | Checkout links for the flow commerce node (Shopify cart, WooCommerce order)         | blocked | P1       | M      | flow-runtime-engine        |
| WD-ECOM-037 | Flow resume on a purchase (purchased port)                                          | blocked | P1       | S      | flow-runtime-engine        |
| WD-ECOM-038 | Shopify embedded-app session cookie                                                 | blocked | P2       | S      | decision (see entry)       |

## Features

### WD-ECOM-001 — Admin settings: Shopify app

- **Status:** pending. **Priority:** P0. **Effort:** S.
- **Summary:** `GET /admin/settings/shopify` shows the platform's Shopify app: on/off, client id, whether a secret is saved (never shown), scopes (default `read_products,read_orders,write_orders,read_customers,read_checkouts,read_inventory`), the redirect address (default `{app}/shopify/oauth/callback`), and how many integrations, events and logs exist. `POST` saves them.
- **Endpoints:** `GET`, `POST /admin/settings/shopify` (admin group). Validation: `shopify_enabled` 0 or 1, client id and secret up to 191, scopes up to 500, redirect a URL up to 255.
- **Data:** settings `shopify_enabled`, `shopify_client_id`, `shopify_client_secret`, `shopify_scopes`, `shopify_redirect_uri`.
- **Rules & edge cases:** (1) a blank secret on save keeps the saved one; (2) the secret is never echoed and the settings export redacts it; (3) a store cannot be connected unless the switch is on AND a client id exists.
- **Source refs:** `AdminPagesController::settingShopify`, `settingShopifyUpdate`, `ShopifyService` (settings reads), `routes/admin.php`.
- **Port notes:** platform settings document plus an encrypted platform secret (the add-ons engine connection already does the same); a platform-operator screen and API under the admin console.

### WD-ECOM-002 — Admin settings: WooCommerce switch

- **Status:** pending. **Priority:** P0. **Effort:** S.
- **Summary:** One switch `woocommerce_enabled` plus counts of integrations, events and logs. Customers paste their own store keys, so there is no app to configure.
- **Endpoints:** `GET`, `POST /admin/settings/woocommerce`.
- **Source refs:** `AdminPagesController::settingWoocommerce`, `settingWoocommerceUpdate`.

### WD-ECOM-003 — Plan gates and permission keys

- **Status:** partial. **Priority:** P0. **Effort:** S.
- **Summary:** The route group is gated by the plan features `integration_shopify` and `integration_woocommerce`; connect, the OAuth callback, offer and win-back check the flag again in code (a refusal in an offer answers 403 "Your plan does not include the Shopify integration." or the WooCommerce one).
- **Port notes:** permission keys `ecom.read`, `ecom.connect`, `ecom.automations.manage`, `ecom.broadcast`, `ecom.settings.manage` (platform) replace the workspace-role guard. The plan flags are a shim (`EcomPlanGate`) until the plan catalogue carries them.
- **Source refs:** `config/plan_gates.php`, `ShopifyController`, `WoocommerceController`, `Package`.

### WD-ECOM-004 — Shopify connect screen and store dashboard shell

- **Status:** pending. **Priority:** P0. **Effort:** M.
- **Summary:** `/shopify` shows, with no connected store, the setup steps (admin enables the app; enter your store domain; approve scopes; map events to templates), a "Store domain" field (the user can type just the handle), the requested scopes and a "What happens next" guide; with the app not enabled it says to contact support. With a connected store it shows a left rail (status pill, store name and URL, plan, tabs with counts) and the active tab. Tabs: Overview, Orders, Products, Send Offer, Customers, Automations, Analytics, Invoices, Activity, Settings. The page flashes `success` and `error` messages.
- **UX & screens:** `views/user/shopify/dashboard.blade.php` (1734 lines), `resources/js/charts/user-shopify-dashboard.js`.
- **Endpoints:** `GET /shopify?tab=` (the tab is read from the address).
- **Data:** the workspace's newest `shopify_integrations` row; "connected" means an access token exists.
- **Source refs:** `ShopifyController::index`, `ShopifyIntegration`.

### WD-ECOM-005 — Shopify OAuth start

- **Status:** pending. **Priority:** P0. **Effort:** S.
- **Summary:** `POST /shopify/connect` with `shop` (max 191). The domain is normalised (scheme and path stripped, lower case, a bare handle gets `.myshopify.com`) and must match `^[a-z0-9][a-z0-9-]*\.myshopify\.com$`, else "Enter a valid Shopify domain like my-store.myshopify.com."; a disabled app or empty client id says "Shopify integration is not configured. Ask your admin to enable it." A random 40 character state and the shop are kept in the session, and the browser is sent to `https://<shop>/admin/oauth/authorize?client_id&scope&redirect_uri&state`.
- **Source refs:** `ShopifyController::startOAuth`, `ShopifyService::normalizeShop`, `isValidShop`, `authorizeUrl`.
- **Port notes:** there is no PHP session: the state is a sealed short-lived value naming organization, user and shop (as Facebook's); `POST` returns `{url}` and the screen navigates.

### WD-ECOM-006 — Shopify OAuth callback

- **Status:** pending. **Priority:** P0. **Effort:** L.
- **Summary:** `GET /shopify/oauth/callback` (auth required, plan-checked). In order: the `hmac` of the query (sorted, without `hmac` and `signature`, HMAC-SHA256 with the client secret, constant-time) must hold, else "Invalid Shopify signature. Try again."; the `state` must equal the session's ("Session expired. Please reconnect."); the `shop` must equal the one stored ("Shop mismatch during callback."); the code is exchanged at `https://<shop>/admin/oauth/access_token` ("OAuth failed: ..."); the shop is read (`/shop.json`); an existing row for the same shop has its old Shopify webhooks deleted; the row is upserted on (workspace, store) with name, shop id, email, owner, plan, currency, country, access token (encrypted), scopes, status `active`, a NEW 40 character webhook secret, verified and connected times; webhooks are registered; the first import runs; then back to `/shopify?tab=overview` with "Shopify store connected.". Registration and import failures are logged and never block the connect.
- **Rules & edge cases:** (1) reconnecting the same store keeps its event mapping and logs but gets a new webhook address (so the old subscriptions are removed first); (2) no workspace gives "No workspace selected for this account.".
- **External systems:** Shopify OAuth and Admin REST `2026-04`.
- **Source refs:** `ShopifyController::oauthCallback`, `ShopifyService` (`verifyOAuthHmac`, `exchangeCode`, `getShop`).

### WD-ECOM-007 — Shopify webhooks: register and tear down

- **Status:** pending. **Priority:** P0. **Effort:** S.
- **Summary:** Registers `orders/create`, `orders/updated`, `orders/paid`, `orders/fulfilled`, `orders/cancelled`, `fulfillments/update`, `refunds/create`, `products/update`, `customers/create`, `customers/update`, `checkouts/create` and `app/uninstalled` to `{app}/shopify/webhook/{webhook_secret}` (JSON); the returned ids are kept in `metadata.webhook_ids`. Teardown deletes each id (errors ignored) and clears the list. Each call has a 15 second timeout.
- **Source refs:** `ShopifyService::registerWebhooks`, `deleteWebhooks`, `WEBHOOK_TOPICS`.

### WD-ECOM-008 — Shopify webhook receiver

- **Status:** pending. **Priority:** P0. **Effort:** L.
- **Summary:** `POST /shopify/webhook/{secret}` (public). The row is found by the secret (404 "not found"); `X-Shopify-Hmac-SHA256` (base64 HMAC-SHA256 of the raw body, keyed by the app's client secret) must hold, else 401 "bad hmac". A log row `{event_type = topic, status processed|skipped, recipient, payload}` is written first. Then, each guarded so one failure never makes Shopify retry (always 200 "ok"): (1) the mapped template is sent (WD-ECOM-010); (2) `products/update`: back-in-stock check BEFORE the mirror is changed (WD-ECOM-020); (3) mirror upsert of product or order, with auto-invoice for a paid order (WD-ECOM-012, 035); (4) `orders/create` of a COD order: COD confirm and COD to prepaid (WD-ECOM-016, 017); (5) `fulfillments/update` with `shipment_status = delivered`: Delivered (WD-ECOM-018); (6) `checkouts/create` schedules cart steps, `orders/create` and `orders/paid` cancel them (WD-ECOM-019); (7) `orders/create` and `orders/paid`: flow resume (WD-ECOM-037); (8) `app/uninstalled` (WD-ECOM-021).
- **Rules & edge cases:** (1) the topic comes only from the header; (2) the recipient is `customer.phone`, else `phone`, else the shipping then billing phone; (3) the app-level secret signs every store's deliveries, and the per-store secret in the address only selects the store.
- **Source refs:** `ShopifyController::webhook`, `resolveRecipient`, `ShopifyService::verifyWebhookSignature`.
- **Port notes:** the work after the log row runs from a queue job so the receiver answers at once; the signature check is on the raw body.

### WD-ECOM-009 — Automations: map each event to a template (both)

- **Status:** pending. **Priority:** P0. **Effort:** M.
- **Summary:** `POST /shopify/{id}/events` and `POST /woocommerce/{id}/events` save every automation in one transaction: per event `is_active`, `template_id`, `var_map` (an ordered list of order-field names, up to 40 characters each, filling `{{1}}`, `{{2}}`, ...), `send_to` (`customer`, `admin`, `both`), `admin_number` (32) and `delay_seconds` (0 to 86400; only the cart steps honour it). Unknown event types are ignored. Shopify types: `orders/create`, `orders/paid`, `orders/fulfilled`, `order/delivered`, `orders/cancelled`, `refunds/create`, `orders/updated`, `checkouts/create`, `cart/step2`, `cart/step3`, `cod/confirm`, `cod/prepaid`, `stock/back`, `customers/create`, `customers/update`, `products/update` (the `app/uninstalled` hook is not shown). WooCommerce types: `order.created`, `order.updated`, `order.deleted`, `customer.created`, `customer.updated`, `product.created`, `product.updated`, `order.processing`, `order.completed`, `order.on-hold`, `order.cancelled`, `order.refunded`, `order.failed`, `cod/confirm`, `cod/prepaid`, `stock/back`, `checkout.created`, `cart/step2`, `cart/step3`, `subscription.payment_failed`, `review/reward`. The screen groups them (Order lifecycle, Revenue recovery, Lifecycle marketing), shows the count fired and, for a template with numbered params, a "Map template variables to order fields" panel.
- **Data:** `shopify_integration_events` and `woocommerce_integration_events`, unique on (integration, event type).
- **Source refs:** `ShopifyController::saveEvents`, `WoocommerceController::saveEvents`, `automationTypes`, dashboard `events` tab.

### WD-ECOM-010 — Event message: variables, recipients, send, log

- **Status:** pending. **Priority:** P0. **Effort:** L.
- **Summary:** A fired event with an active mapping and a template loads the template (missing: log `failed` "Configured template no longer exists."), builds the variable context, applies `var_map` as the positional list, picks targets (customer by `send_to`, the admin number) and sends each through `CommerceEventNotifier`. No target: `failed` "No recipient — order has no customer phone and no admin number set.". The log row is updated to `sent` or `failed` with the response and the joined errors. Variables, Shopify: `name`, `first_name`, `last_name`, `order_number`, `order_name`, `total` (amount and currency), `total_price`, `currency`, `email`, `store_name`, `financial_status`, `fulfillment_status`, `tracking_url`, `tracking_number`, `tracking_company`, `order_url`, `checkout_url`; positional default `[name, order name, total]`. WooCommerce adds `status`, `payment_method`, `payment_method_title`, `order_pay_url`, `invoice_url`, `invoice_is_pdf` (WD-ECOM-029). The notifier routes by the workspace's engine: WABA (approval, quality and cap gates, positional params), Unofficial (the body rendered with named `{{token}}` and numbered `{{n}}`, unknown tokens stripped, plus the template's buttons, footer, header and carousel), Twilio (a content SID with positional variables, else the rendered body). An explicit sender (`engine:id`) is validated against the workspace.
- **Rules & edge cases:** the delay is not applied inline (a webhook must return fast).
- **Source refs:** `ShopifyController::dispatchEventMessage`, `orderContext`, `sendPseudoEvent`, `WoocommerceController` twins, `Services/Commerce/CommerceEventNotifier`.
- **Port notes:** the notifier is a port (`CommerceSender`) over the WhatsApp send domains; until they export a template send it is a shim that records the attempt and fails with "No sender connected", so logs and screens work end to end.

### WD-ECOM-011 — Import into the mirror (both)

- **Status:** pending. **Priority:** P0. **Effort:** L.
- **Summary:** `importAll` pulls products, orders and customers and stamps `products_synced_at`, `orders_synced_at`, `customers_synced_at` and `sync_stats`. Products become `wa_products` keyed by `shopify_product_id` or `woo_product_id` (sku, name, slug, description, body html, price and compare price in minor units, currency, image, gallery, in stock, status, category, brand, product URL, tags). Shopify takes the first variant's price and `compare_at_price`; stock is the sum of tracked inventory (untracked means in stock). WooCommerce takes `price` as selling and `regular_price` as list (a compare price only when discounted), status `publish`→active, `draft`/`pending`/`private`→draft, `trash`→archived. Orders become `wa_orders` keyed by the store order id (source, phone digits, name, email, items `{title, qty, price, sku}`, total in minor units, currency, status, meta with name, number, financial and fulfilment status). Status map: refunded, voided or cancelled mean cancelled; fulfilled means shipped; paid means paid; the rest new (Woo: cancelled, refunded, failed mean cancelled; processing paid; completed shipped). Customers with a phone become contacts (existing ones matched by phone digits within the workspace are only added to the group) in the group "Shopify Customers" (colour `#95BF47`) or "WooCommerce Customers", with `custom_attributes` store id, orders count and total spent. A bulk import suppresses the per-product WhatsApp catalog sync.
- **Rules & edge cases:** (1) QUIRK: only the first page is imported (250 Shopify, 100 Woo); (2) a row that fails to map is logged and skipped; (3) re-running updates in place.
- **Source refs:** `ShopifyImporter`, `WoocommerceImporter`.
- **Port notes:** cursor pagination (the first page cap is a defect, not a feature); the import is a queue job; writes go through the catalog and checkout writers' shims.

### WD-ECOM-012 — Keep the mirror in step; auto-invoice hand-off (both)

- **Status:** pending. **Priority:** P1. **Effort:** M.
- **Summary:** From webhooks: `products/update` (Woo `product.created`, `product.updated`) upserts the product; order topics (Shopify `orders/create|updated|paid|fulfilled|cancelled`, Woo `order.created|updated`) upsert the order. A paid order (Shopify `orders/paid` or `financial_status = paid`; Woo status `processing` or `completed` or a `date_paid`) is handed to the invoicing domain with the raw payload and the delivery id for replay protection (WD-ECOM-035).
- **Source refs:** the webhook receivers, `InvoiceService::handleWebhookOrder`.

### WD-ECOM-013 — Sync now and disconnect (both)

- **Status:** pending. **Priority:** P0. **Effort:** S.
- **Summary:** `POST /shopify/{id}/sync` and `POST /woocommerce/{id}/sync` re-verify the store (a failure sets status `error` and answers `{ok:false, message}`), refresh its facts, re-import, and answer `{ok, imported, counts, shop}` (Shopify) or `{ok, counts}` (Woo). `POST .../disconnect` removes the Shopify or WooCommerce webhooks (errors ignored) and deletes the row; Shopify then shows "Shopify disconnected.", Woo "WooCommerce disconnected.". Both are scoped to the workspace (404 otherwise). Counts come from the stores' count endpoints (Woo's `X-WP-Total` header).
- **Source refs:** `ShopifyController::sync`, `disconnect`, `WoocommerceController` twins, `getStoreCounts`.

### WD-ECOM-014 — Send offer (both)

- **Status:** pending. **Priority:** P1. **Effort:** M.
- **Summary:** `POST /{shopify|woocommerce}/{id}/offer` with `template_id`, `group_id`, optional `product_ids` (the first is used) and `coupon_code` (64). Plan-checked (403). The recipients are opted-in contacts (`is_unsubscribed` false) in the contact group. Each gets the template with name, product name, price and currency, product URL, coupon and store name (positional default `[name, product, coupon or price]`); a contact with no number counts as failed. The answer is `{ok, sent, failed, total}`; an empty segment says "That segment has no contactable (opted-in) members."; an unknown template "Template not found.". An `offer/broadcast` log row records counts. WooCommerce sends from the integration's chosen sender.
- **Source refs:** `sendOffer`, `offerContext`, the dashboard `offers` tab.
- **Port notes:** a job over the segment (chunked), not an inline loop; the count answer stays.

### WD-ECOM-015 — Win-back (both)

- **Status:** pending. **Priority:** P1. **Effort:** M.
- **Summary:** `POST /{shopify|woocommerce}/{id}/winback` with `template_id`, `days` (0 to 365, default 60, 0 means any time), `min_orders` (0 to 1000), `min_spent` and `coupon_code`. Customers are grouped by phone over the mirrored orders (Woo: only `source = woocommerce`), kept when their last order is older than the days, their order count and spend reach the minimums, and dropped when the number is an opted-out contact. Context `{name: there, coupon_code, store_name}`. Answer `{ok, sent, failed, total}`; none matching says "No customers match this segment."; log row `winback/broadcast`.
- **Rules & edge cases:** QUIRK: Shopify's segment is not limited to Shopify orders (it reads every `wa_orders` row of the workspace); the port limits it to the store's source.
- **Source refs:** `sendWinback`.

### WD-ECOM-016 — COD double confirmation (both)

- **Status:** pending. **Priority:** P0. **Effort:** L.
- **Summary:** On `orders/create` (Woo `order.created`) of a cash-on-delivery order, when the `cod/confirm` automation is active with a template, the customer is asked to confirm and a pending row `{order, phone, status pending}` is stored with a log `cod/confirm`. COD means: Shopify `payment_gateway_names` or `gateway` naming "cash on delivery" or "cod", or a `cod` tag on a pending order; Woo `payment_method` of `cod` or naming cash on delivery, or the title. The customer's later WhatsApp reply (WD-ECOM-034) is read: yes (yes, y, confirm, confirmed, ok, okay, yep, sure, haan, ha, haa, 1, a check mark, a thumbs up, or starting "yes" or "confirm") confirms; no (no, n, cancel, cancelled, cancel order, nope, nahi, nai, 2, a cross, or starting "no" or "cancel") cancels. The newest pending row for that phone flips, the mirrored order becomes `confirmed` or `cancelled` (WooCommerce also sets the real order to `processing` or `cancelled` through its REST API), a `cod/reply` log is written, and the customer gets "Thank you! Your COD order <name> is confirmed. We'll ship it shortly." or "Your COD order <name> has been cancelled. Reply if this was a mistake.". A customer who never replies stays pending.
- **Data:** `shopify_cod_confirmations`, `woocommerce_cod_confirmations`.
- **Source refs:** `ShopifyCodService`, `WoocommerceCodService`.

### WD-ECOM-017 — COD to prepaid nudge (both)

- **Status:** pending. **Priority:** P1. **Effort:** S.
- **Summary:** On the same COD order, an active `cod/prepaid` automation sends its template with `{{order_url}}` (Shopify) or `{{order_pay_url}}` (Woo: the order-pay link with the order key) so the customer can pay online; a `cod/prepaid` log row is written. Woo adds `risk_level` to the context.
- **Source refs:** the webhook receivers, `sendPseudoEvent`.

### WD-ECOM-018 — Delivered automation (Shopify)

- **Status:** pending. **Priority:** P1. **Effort:** S.
- **Summary:** `fulfillments/update` with `shipment_status = delivered` fires `order/delivered` for the customer found on the mirrored order (phone, name, order name; the destination phone as a fallback). (Woo's equivalent is its status automation `order.completed`, WD-ECOM-027.)
- **Source refs:** `ShopifyController::webhook` (fulfillments branch).

### WD-ECOM-019 — Abandoned-cart recovery (both)

- **Status:** pending. **Priority:** P1. **Effort:** L.
- **Summary:** Step 1 is the ordinary `checkouts/create` (Woo `checkout.created`) automation. On that event with a customer phone, the active `cart/step2` and `cart/step3` automations each become a scheduled message (delay at least 60 seconds, default one hour) for that phone on the workspace's engine (Unofficial: a connected device; WABA or Twilio: the primary provider config; none connected means nothing is scheduled), registered with the one-off scheduler, and one `*_cart_recoveries` row `{checkout token, phone, email, scheduled ids, status active}` ties them together. When an order arrives for the phone (`orders/create`, `orders/paid`; Woo `order.created`, `order.updated`) every pending step is cancelled and the row becomes `recovered`. WooCommerce checkouts come from the companion plugin, which captures the phone before an order exists (WD-ECOM-032).
- **Data:** `shopify_cart_recoveries`, `woocommerce_cart_recoveries`, `scheduled_messages`.
- **Source refs:** `ShopifyCartService`, `WoocommerceCartService`.
- **Port notes:** the steps are BullMQ delayed jobs (with the scheduled-message row for the schedule screen when that domain exists); cancelling removes the job.

### WD-ECOM-020 — Back-in-stock waitlist (both)

- **Status:** pending. **Priority:** P1. **Effort:** M.
- **Summary:** A customer message containing notify, stock, back in stock, available, restock or in stock, and naming (by name or sku, case-insensitively) a mirrored product that is out of stock, joins the waitlist for it and is told "Done! We'll message you the moment "<product>" is back in stock." (`shopify_stock_waitlist`, `woocommerce_stock_waitlist`, status `waiting`). On a product update that turns the stock from out to in (checked BEFORE the mirror is updated) with `stock/back` active and a template, everyone waiting is messaged (name, product name, product URL, store name) and marked `notified`; a `stock/back` log row counts them. Shopify derives stock from the variants' inventory (untracked means in stock).
- **Source refs:** `ShopifyStockService`, `WoocommerceStockService`.

### WD-ECOM-021 — App uninstalled cleanup (Shopify)

- **Status:** pending. **Priority:** P1. **Effort:** S.
- **Summary:** `app/uninstalled` clears the access token and the connected time; the row, mapping and logs stay visible, and the store reads as not connected.
- **Source refs:** `ShopifyController::webhook`, `ShopifyIntegration::isConnected`.

### WD-ECOM-022 — Shopify mandatory GDPR webhooks

- **Status:** pending. **Priority:** P0. **Effort:** S.
- **Summary:** `POST /shopify/compliance` (public, no per-store secret). The signature is checked first and a bad one is 401 before anything is read. Then by topic: `customers/data_request` is recorded and acknowledged; `customers/redact` deletes the webhook log rows of the shop's integrations (those whose recipient is the customer's phone, or all when none was given); `shop/redact` deletes the integration rows with their events and logs. Always 200 once the signature holds, whatever fails.
- **Source refs:** `ShopifyController::compliance`.

### WD-ECOM-023 — Store dashboard tabs (both)

- **Status:** pending. **Priority:** P0. **Effort:** XL.
- **Summary:** Shopify serves every tab from the mirror; WooCommerce reads orders, products, customers and the 30 day sales report live from the store (and the CRM numbers from the mirror). Overview: Revenue (recent), Orders total, Products, Customers with active automations, recent orders (5) and recent webhook activity. Orders: the last 20 (name, customer, status, total, placed). Products: search, "Special offers" (discounted, 8), "New arrivals" (8), "Popular" (8, by price) and all (120), with a "Send a catalog" link. Send Offer / Offers: product picker, template, segment, coupon, "Send offer"; the "Smart segment broadcast" (Last order, Min orders, Min spend, Template, Coupon, "Send win-back"). Customers: name, email, phone, orders, spent (50). Automations: WD-ECOM-009. Analytics: Revenue, Orders, Avg order, Messages sent, Offers sent, "COD revenue protected" (confirmed COD x average order), "COD orders confirmed", "RTO avoided" (cancelled COD x average order), "Recovery messages" (offer, winback, cart, COD, stock sends), a 14 day revenue chart and an automation performance table. Activity: the 15 newest webhook logs (event, recipient, status, when) and counts by status and event. Settings: WD-ECOM-024. Invoices: WD-ECOM-035. Orders and customers shown in the lists are the store's, so the lists differ between the two (Woo is live, Shopify is the mirror).
- **Source refs:** `ShopifyController::dashboardData`, `WoocommerceController::dashboardData`, the two dashboard views and `charts/user-{shopify,woocommerce}-dashboard.js`.
- **Port notes:** one dashboard API per store type; the Shopify KPI "from Shopify counts API" label is not true (it is the mirror count); the port labels it for what it is.

### WD-ECOM-024 — Settings tab

- **Status:** pending. **Priority:** P2. **Effort:** S.
- **Summary:** Store URL, connected at, last verified, scopes granted, the webhook address, and the registered webhooks (topic and id) of the integration.
- **Source refs:** dashboard `settings` case.

### WD-ECOM-025 — WooCommerce connect

- **Status:** pending. **Priority:** P0. **Effort:** L.
- **Summary:** `GET /woocommerce` shows the connect form (store URL, consumer key, consumer secret) or the dashboard. `POST /woocommerce/test` checks the credentials without saving: `GET {store}/wp-json/wc/v3/system_status` with Basic auth (15 s), answering "Connection verified. Store: <name>" or the failure. `POST /woocommerce/connect` (plan-checked; the three fields up to 255, 191, 191) normalises the URL (scheme added, host lower-cased, path dropped), verifies, tears down an existing row's old webhooks, upserts on (workspace, store URL) with store name (site title or host), currency, country, WooCommerce version, the keys (encrypted), status `active`, a new 40 character webhook secret, then registers the webhooks and imports; answers `{ok, redirect}` or 422 "Could not reach WooCommerce: ...".
- **Rules & edge cases:** HTTPS is expected; no OAuth1 fallback; a disabled platform switch says "WooCommerce is disabled. Ask an admin to enable it.".
- **Source refs:** `WoocommerceController::connect`, `test`, `WoocommerceService::testConnection`, `normalizeUrl`, `isValidUrl`.
- **Port notes:** the store URL is checked against private and loopback addresses before any call (WaDesk had no guard).

### WD-ECOM-026 — WooCommerce webhooks

- **Status:** pending. **Priority:** P0. **Effort:** S.
- **Summary:** Registers `order.created`, `order.updated`, `order.deleted`, `customer.created`, `customer.updated`, `product.created`, `product.updated` (named "<app name> <topic>", status active, secret = the integration's webhook secret) and keeps the ids; teardown deletes them with `force`. Deliveries to `{app}/woocommerce/webhook/{secret}` are verified by `X-WC-Webhook-Signature` (base64 HMAC-SHA256 of the raw body keyed by the integration's own secret), else 401 "bad signature".
- **Source refs:** `WoocommerceService::registerWebhooks`, `deleteWebhooks`, `verifyWebhookSignature`.

### WD-ECOM-027 — WooCommerce webhook receiver

- **Status:** pending. **Priority:** P0. **Effort:** L.
- **Summary:** `POST /woocommerce/webhook/{secret}` (public). Like WD-ECOM-008 (log first, topic from `X-WC-Webhook-Topic`, always 200 after the signature), in order: (1) the mapped template; (2) on `order.updated` the order-status automation `order.<status>` for the new status (processing is "confirmed", completed "delivered", on-hold, cancelled, refunded, failed) with its own log; (3) back-in-stock on product topics; (4) mirror upserts and the paid-order invoice hand-off; (5) a new COD order: risk score, COD confirm, COD to prepaid (with `risk_level`) and a `cod/risk` log; (6) cart recovery (`checkout.created` schedules, orders cancel); (7) flow resume.
- **Source refs:** `WoocommerceController::webhook`, `fireOrderStatusAutomation`.

### WD-ECOM-028 — WooCommerce phone normalisation

- **Status:** pending. **Priority:** P0. **Effort:** S.
- **Summary:** WooCommerce keeps a number as typed, often local ("08012345678"). The phone comes from billing, shipping or the customer, with the country from billing or shipping (ISO-2); a leading `+` or `00` marks an international number; otherwise the country's dialing code is put in front (a leading trunk zero removed). Without it a message "sends" and never arrives. The mirror stores the normalised number.
- **Source refs:** `app/Support/Woo/WooPhone.php`, `config/countries.php`.
- **Port notes:** the countries list exists in the platform settings domain; a pure function with tests.

### WD-ECOM-029 — WooCommerce order context

- **Status:** pending. **Priority:** P1. **Effort:** M.
- **Summary:** Beyond WD-ECOM-010, the context carries `order_url` (the My Account order page), `order_pay_url` (order-pay with the order key), `tracking_number`, `tracking_company`, `tracking_url` (from the Shipment Tracking plugins' order meta, else the order page) and `invoice_url`: an explicit `invoice_url` field from the companion plugin, else the PDF plugins' stored links in order meta (only `https`), else the order page, with `invoice_is_pdf` saying which.
- **Source refs:** `WoocommerceController::orderContext`, `trackingFromMeta`, `invoiceUrlFromOrder`.

### WD-ECOM-030 — COD risk score (WooCommerce)

- **Status:** pending. **Priority:** P1. **Effort:** S.
- **Summary:** A 0 to 100 score with reasons from the workspace's own mirrored WooCommerce orders: first-time buyer +30 (else no fulfilled order +18), prior cancellations +15 each up to 30, order value over twice the store average +25 (over 1.5 times +12), no email +8, no phone +15. Level: 60 and up high, 30 and up medium, else low. Written to a `cod/risk` log and passed to the prepaid nudge as `risk_level`.
- **Source refs:** `WoocommerceRiskService`.

### WD-ECOM-031 — Concierge on WhatsApp (WooCommerce)

- **Status:** pending. **Priority:** P1. **Effort:** L.
- **Summary:** For a known WooCommerce customer's message: a pending address edit takes the whole message as the new address first. Then "change address" (and similar) finds their latest still-editable order (status new or paid), asks for the full address (15 minute window), and on the next message of at least 6 characters updates the order's shipping `address_1` (up to 250) through the REST API, answering done or "Sorry, we couldn't update order ..."; "reorder" (and similar) mints a checkout link for the last order's items (by sku) and sends it; "points" or "balance" answers orders, total spent and, when a points plugin fed it, the points balance; a positive rating (5, 4, great, good, love it, excellent, awesome, amazing, perfect, a star, a thumbs up) from a buyer with a shipped order in the last 30 days, with `review/reward` active and no reward to that phone in 30 days, sends the reward template. Each writes a log (`order/edit-request`, `order/edit-apply`, `reorder`, `loyalty/query`, `review/reward`).
- **Rules & edge cases:** unknown customers get no reply from any of them; the reward is the loosest trigger and is last and gated three ways.
- **Source refs:** `WoocommerceConciergeService`.

### WD-ECOM-032 — WooCommerce companion plugin download

- **Status:** blocked (decision). **Priority:** P1. **Effort:** M.
- **Summary:** `GET /woocommerce/{id}/plugin` downloads a ZIP with a WordPress plugin generated from `resources/stubs/wadesk-woocommerce.php.stub` (209 lines of PHP), with the store's webhook address, its secret, a 30 minute cart delay and the brand name filled in; the file names use the brand slug. The plugin captures the checkout phone before an order exists (abandoned-cart steps), forwards subscription payment failures and custom statuses to the webhook, and sweeps pending carts every five minutes.
- **Decision needed:** the plugin is PHP that runs on the merchant's WordPress, not our app, but the porting rules say no PHP is pasted into `crm-platform/`. The port can ship it as a read-only asset template (a stub text file generated into a ZIP) if the owner allows a WordPress plugin in the repo; otherwise the abandoned-cart and dunning events for WooCommerce cannot work. Recorded in the parity file; nothing is built until answered.
- **Source refs:** `WoocommerceController::downloadPlugin`, `resources/stubs/wadesk-woocommerce.php.stub`.

### WD-ECOM-033 — "Send from" sender per WooCommerce integration

- **Status:** pending. **Priority:** P1. **Effort:** S.
- **Summary:** The Automations form has a "Send from" picker of the workspace's connected senders (Unofficial devices and WABA or Twilio accounts, as `engine:id`), saved with the events as `sender_key` in the integration's metadata (blank means Auto); every WooCommerce send passes it. The template picker filters to the chosen sender's engine (a WABA account lists its approved templates; Unofficial lists any non-WABA template). Shopify has no such picker (it always uses Auto).
- **Source refs:** `WoocommerceController::saveEvents`, `dashboardData`, `WorkspaceEngine::senders`.

### WD-ECOM-034 — Inbound chokepoints

- **Status:** partial. **Priority:** P0. **Effort:** M.
- **Summary:** Every customer message goes through, in this order and each guarded: Shopify COD reply, Shopify stock opt-in, WooCommerce COD reply, WooCommerce stock opt-in, WooCommerce concierge, then the catalog concierge. None stops the others (their return value is ignored in WaDesk), so one message can be taken by several. The ports of these services (WD-ECOM-016, 020, 031) are built; the call from the inbox's inbound path belongs to the team inbox and goes through a hook.
- **Port notes:** exported `EcomInboundService.handleInbound(orgId, phone, text)` for the inbox; it runs the handlers in WaDesk's order and returns which acted.
- **Source refs:** `WaInboundController` (lines 736 to 800).

### WD-ECOM-035 — Invoices tab and auto-invoice (blocked)

- **Status:** blocked (invoicing). **Priority:** P1. **Effort:** M.
- **Summary:** The Invoices tab embeds the invoicing domain's panel for the source (`shopify` or `woocommerce`). A paid order is handed to `InvoiceService::handleWebhookOrder` with the raw payload, the delivery id (`X-Shopify-Webhook-Id`, `X-WC-Webhook-Delivery-ID`) and the topic; it keeps a replay table, the per-source `auto_send_*` and `trigger_*` settings, and the Shopify and Woo mappers.
- **Port notes:** a `PaidOrderHook` shim called after the mirror upsert; the tab shows the invoicing panel when that domain exports it.

### WD-ECOM-036 — Checkout links for the flow commerce node (blocked)

- **Status:** blocked (flow-runtime-engine). **Priority:** P1. **Effort:** M.
- **Summary:** The flow builder's commerce node turns picked products (by sku) into a checkout link: Shopify resolves variant ids from the admin API and creates a Storefront cart (the flow session id goes in the cart `note` as `wadesk-flow:<id>`; a store with no Storefront token uses a draft order), WooCommerce mints an order via its Store API (tagged `_wa_flow_session`). The WooCommerce concierge reorder (WD-ECOM-031) uses the same builder.
- **Source refs:** `Services/Commerce/ShopifyCheckoutLinkBuilder`, `WoocommerceCheckoutLinkBuilder`, `FlowsCommerceController`.

### WD-ECOM-037 — Flow resume on a purchase (blocked)

- **Status:** blocked (flow-runtime-engine). **Priority:** P1. **Effort:** S.
- **Summary:** On `orders/create` and `orders/paid` (Woo `order.created`, `order.updated`) the flow session id is read back from the cart note or order meta and the paused flow is advanced through its `purchased` port.
- **Source refs:** `Services/Commerce/FlowSessionResolver`.

### WD-ECOM-038 — Shopify embedded-app session cookie

- **Status:** blocked (decision). **Priority:** P2. **Effort:** S.
- **Summary:** WaDesk is also an embedded Shopify app: the session cookie is relaxed to `SameSite=None; Secure` only on the `/shopify` pages, requests carrying Shopify's `host` and `shop`, and the login handshake while a marker cookie is present, so the login form works inside Shopify's iframe. The port authenticates through a same-origin proxy and bearer tokens, not a PHP session; whether the app is listed in Shopify's app store and loaded in the admin iframe is a product decision.
- **Decision needed:** is the embedded Shopify admin experience in scope? If yes it needs the auth domain's cookie and framing policy; if no this is dropped by the owner's word.
- **Source refs:** `app/Http/Middleware/EmbeddedShopifySession.php`, `SecurityHeaders`, `bootstrap/app.php`.

## Wiring

- **Public routes (no session):** `POST /shopify/webhook/{secret}`, `POST /shopify/compliance`, `POST /woocommerce/webhook/{secret}`. The OAuth callback needs a session in WaDesk; the port carries the user in the sealed state.
- **Inbox:** the three inbound handlers (WD-ECOM-034).
- **Invoicing:** the paid-order hand-off and the panel (WD-ECOM-035).
- **Flows:** the commerce node's links and the purchased port (WD-ECOM-036, 037); the node inspectors read the integrations.
- **Catalog and checkout:** `wa_products` and `wa_orders` are written here and read there (catalog send, orders list); the Meta catalog auto-sync is paused during a bulk import.
- **Dashboards:** the integrations panel reads whether a store is connected.
- **Contacts:** `Shopify Customers` and `WooCommerce Customers` groups and the `custom_attributes` keys.
