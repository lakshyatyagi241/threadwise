# Storefront builder API (STORE)

Version 2: every path is `/v2/...`; the web proxy exposes `/api/v2/*`. Request and response shapes are the Zod schemas in
`packages/contracts/src/storefront-builder/` (`storefront.ts`, `dashboard.ts`, `public.ts`). Errors are problem+json with a stable
`code`. Internal ids never appear: shops, products, devices and orders are addressed by uuid; the only number is the **order
number** (the order's id, which WaDesk also showed buyers as `#id`).

## Admin (signed in, `@ActorKinds('user')`)

| Method and path                       | Permission                | Body / query                             | Response                                                                                           |
| ------------------------------------- | ------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `GET /store/overview?shopId=`         | `store.dashboard.read`    | `storeOverviewQuerySchema`               | `storeOverviewSchema` (also `counts` for the sidebar badges and `connection` for the sidebar card) |
| `GET /store/shops`                    | `store.storefront.read`   | -                                        | `wizardResponseSchema`                                                                             |
| `POST /store/shops`                   | `store.shops.manage`      | `createShopSchema`                       | 201 `storefrontResponseSchema`                                                                     |
| `POST /store/shops/reset`             | `store.shops.manage`      | `{"confirm":"yes"}`                      | 200 `resetStoreResponseSchema`                                                                     |
| `GET /store/shops/:id`                | `store.storefront.read`   | -                                        | `storefrontResponseSchema`                                                                         |
| `PUT /store/shops/:id`                | `store.shops.manage`      | `editShopSchema`                         | `storefrontResponseSchema`                                                                         |
| `PUT /store/shops/:id/settings`       | `store.storefront.manage` | `updateStorefrontSchema` (+`rowVersion`) | `storefrontResponseSchema`                                                                         |
| `POST /store/shops/:id/verify-domain` | `store.storefront.manage` | -                                        | 200 `verifyDomainResponseSchema`                                                                   |
| `DELETE /store/shops/:id`             | `store.shops.manage`      | -                                        | 204                                                                                                |

Writes accept `Idempotency-Key`. Every write is audited (module `storefronts`) and emits an outbox event in the same transaction:
`storefront.created|updated|deleted|reset|settings_updated|domain_checked`.

Sample: `POST /v2/store/shops` `{"shopName":"Media City Threads","deviceId":"<device uuid>"}` ->
`{"id":"...","shopName":"Media City Threads","slug":"media-city-threads","themeKey":"aurora","enabled":true,"currencyCode":"INR",
"publicUrl":"https://app.example.com/s/media-city-threads","sendingLabel":"+91 9812345678","razorpay":{"keyId":null,"hasKeySecret":false,"hasWebhookSecret":false},"rowVersion":1,...}`.

Sample: `PUT /v2/store/shops/:id/settings` `{"slug":"media-city-threads","themeKey":"noir","enabled":true,"brandColor":"#12ab9F",
"shippingFlat":"49.50","shippingFreeAbove":"999","paymentProvider":"razorpay_api","rzpKeyId":"rzp_live_x","rzpKeySecret":"...","rzpWebhookSecret":"...","rowVersion":1}`.
Razorpay secrets are encrypted (AES-GCM) and never returned; a blank secret keeps the stored one; a provider other than
`razorpay_api` drops the keys.

Errors: `403 FORBIDDEN` (missing key), `404 NOT_FOUND` (unknown or other workspace's shop), `404 STORE_NO_SHOP` (overview with no
shop), `409 STORE_SLUG_TAKEN`, `409 ROW_VERSION_CONFLICT`, `422 VALIDATION_FAILED` (field errors, a taken custom domain is
`customDomain`), `422 STORE_NO_SENDER`, `422 STORE_DEVICE_INVALID`, `422 STORE_RESET_NOT_CONFIRMED`, `422 STORE_DOMAIN_NOT_SET`.

## Public (no token, `@Public()`, prefix `/v2/store-public`)

Per-address limits per minute (Redis): checkout 20, coupon 30, review 10, abandon 30, host and webhook 300 (`429 RATE_LIMITED`).
An unknown or disabled shop is `404 STORE_NOT_AVAILABLE` ("This store is not available.") on every route.

| Method and path                    | Body / query                                 | Response                            |
| ---------------------------------- | -------------------------------------------- | ----------------------------------- |
| `GET /host?host=`                  | `hostResolveQuerySchema`                     | `{ "slug": "..." }` or 404          |
| `GET /:slug/home?page=`            | `publicHomeQuerySchema` (48 per page)        | `publicHomeSchema`                  |
| `GET /:slug/products/:productSlug` | -                                            | `publicProductPageSchema`           |
| `GET /:slug/orders/:token`         | -                                            | `publicOrderSchema`                 |
| `POST /:slug/checkout`             | `checkoutSchema`, optional `Idempotency-Key` | 201 `checkoutResponseSchema`        |
| `POST /:slug/coupon`               | `couponQuoteSchema`                          | 200 `couponQuoteResponseSchema`     |
| `POST /:slug/review`               | `publicReviewInputSchema`                    | 201 `{ "message": "..." }`          |
| `POST /:slug/abandon`              | `abandonCartSchema`                          | 200 `{ "scheduled": bool }`         |
| `POST /webhooks/razorpay`          | raw JSON, header `X-Razorpay-Signature`      | 200 `razorpayWebhookResponseSchema` |

Checkout: only product uuids and quantities are read; prices, stock, coupon and shipping are re-derived. Errors: `422
STORE_ITEMS_UNAVAILABLE` ("Those items are no longer available. Please refresh and try again."), `422 VALIDATION_FAILED` ("Please
enter a valid phone number."), `409 CONFLICT` (same Idempotency-Key still running). An unknown coupon code is ignored; the quote
answers `422 STORE_COUPON_INVALID` ("That code is not valid for this cart.") for every reason alike. Post-order work is not in
the response path: the outbox event `store.order_placed` carries it (WhatsApp Pay auto-charge, notifications and invoices belong
to other domains and subscribe to it).

Sample checkout: `POST /v2/store-public/acme/checkout` `{"name":"Asha","phone":"+91 98765 43210","paymentMethod":"cod",
"items":[{"id":"<product uuid>","qty":2}]}` -> `{"orderNo":42,"waUrl":"https://wa.me/919812345678?text=...","trackUrl":"/s/acme/order/<40 chars>",
"message":"Order placed! Opening WhatsApp…"}`.

Webhook (400 `STORE_WEBHOOK_REJECTED` with `bad_signature` or `invalid_json`, 404 `storefront_unknown`): the shop is found from the
event notes, the HMAC-SHA256 of the raw body is verified with that shop's webhook secret before any order is read, then the event
is applied only to an order of that shop whose amount and currency match and that is not cancelled. A refused order answers 200
`{ "ok": true, "order": null, "rejected": "order_not_in_shop" | "amount_mismatch" | "order_cancelled" }`.

## Exports for other domains (barrel `modules/storefront-builder`)

`ShopsService.ensureDefaultShop(orgId, tx?)` (channel domains, on connect), `ShopUrlService.publicUrl(shop)` / `trackUrl(shop, token)`,
`StorefrontPaymentService.mintLink(shop, order, callbackUrl)` (CHK, order page "generate payment link").

## Environment

`STOREFRONT_HOST`, `STOREFRONT_CNAME_TARGET` (default: host of `WEB_APP_URL`), `STORE_PROVIDER_MODE=live|fixture`,
`BAILEYS_SERVER_URL`, `BAILEYS_NODE_TOKEN` (the cart-recovery nudge over the Node bridge). Not listed in `env.schema.ts`; read by
`config/domains/storefront-builder.env.ts`.
