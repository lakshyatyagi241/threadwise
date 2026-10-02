# Shopify and WooCommerce API

Base path `/v2`. Inventory: [inventory/shopify-woocommerce.md](../wadesk-port/inventory/shopify-woocommerce.md). The first two tables need a user
session and the permission shown; the platform routes need an operator; the callback is public and proves itself (a signature, a sealed state).

## Shopify (WD-ECOM-004 to 007, 013)

| Method and path                 | Permission     | What                                                                                                                                                                                                                                                                                                                       |
| ------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /shopify`                  | `ecom.read`    | `{appEnabled, scopes, eventTopics, store}`: whether the platform app is on, what it asks for, the 12 webhook topics and the workspace's store (or null). Never a token.                                                                                                                                                    |
| `POST /shopify/connect/start`   | `ecom.connect` | Body `{shop}` (a handle, a `*.myshopify.com` name or a pasted address). 200 `{url}`: the store's approval page. 422 `ECOM_SHOP_INVALID`, 422 `ECOM_NOT_CONFIGURED`.                                                                                                                                                        |
| `POST /shopify/stores/:id/sync` | `ecom.connect` | Sync now: 200 `{ok, counts: {products, orders, customers}, importQueued}`. A store that does not answer is flagged `error` and answers 200 `{ok: false, message}`; a store whose app was removed asks to be connected again. 404 for another workspace's store. The import (every page, up to ten) runs in the background. |
| `DELETE /shopify/stores/:id`    | `ecom.connect` | 204. Removes the store's webhooks (errors ignored) and the row with its mapping and logs. 404 for another workspace's store.                                                                                                                                                                                               |

`ShopifyStore`: `id` (uuid), `storeUrl`, `storeName`, `status`, `connected` (credentials held), `connectedAt`, `lastVerifiedAt`, `productsSyncedAt`,
`ordersSyncedAt`, `customersSyncedAt`, `syncStats`, `webhookUrl`, `webhookIds` (topic to the store's id), `createdAt`, `rowVersion`, `shopId`, `shopEmail`,
`shopOwner`, `shopPlan`, `shopCurrency`, `shopCountry`, `scopes`.

## Shopify public route

| Method and path               | Proof                                         | What                                                                                                                                                                                                            |
| ----------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /shopify/oauth/callback` | the `hmac` over the query, the sealed `state` | Where Shopify sends the browser back. 303 to `{WEB_APP_URL}/shopify?shopify=connected\|error&message=...`. Refused with a message: a bad signature, an expired or unknown state, another store, a refused code. |

| `POST /shopify/webhook/:secret` | `X-Shopify-Hmac-SHA256` (base64 HMAC of the raw body, platform client secret) | 200 `ok`; 401 `bad hmac`; 404 `not found`; 503 `try again` (not queued, retry). Topic in `X-Shopify-Topic`, delivery in `X-Shopify-Webhook-Id`. |
| `POST /woocommerce/webhook/:secret` | `X-WC-Webhook-Signature` (the store's webhook secret) | As Shopify's with `bad signature`. Topic `X-WC-Webhook-Topic`, delivery `X-WC-Webhook-Delivery-ID`. A non-JSON ping is acknowledged and not logged. |

Give Shopify `{APP_URL}/v2/shopify/oauth/callback` as the app's redirect address (the platform setting defaults to it).

## WooCommerce (WD-ECOM-025, 026, 013)

| Method and path                     | Permission     | What                                                                                                                                                                                                  |
| ----------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /woocommerce`                  | `ecom.read`    | `{appEnabled, eventTopics, store}`: the 7 webhook topics and the workspace's store (or null). Never a key.                                                                                            |
| `POST /woocommerce/test`            | `ecom.connect` | Body `{storeUrl, consumerKey, consumerSecret}`. 200 `{ok, message}` either way ("Connection verified. Store: ..." or the reason); saves nothing.                                                      |
| `POST /woocommerce/connect`         | `ecom.connect` | Same body. 201 the store. 422 `ECOM_DISABLED`, `ECOM_STORE_INVALID`, `ECOM_STORE_UNREACHABLE` ("Could not reach WooCommerce: ..."). Registers the 7 webhooks; reconnecting keeps the row and mapping. |
| `POST /woocommerce/stores/:id/sync` | `ecom.connect` | Sync now, as Shopify's.                                                                                                                                                                               |
| `DELETE /woocommerce/stores/:id`    | `ecom.connect` | 204, as Shopify's.                                                                                                                                                                                    |

`WoocommerceStore`: the same fields as Shopify's up to `rowVersion`, then `storeCurrency`, `storeCountry`, `storeVersion`.

## Platform settings (operators; WD-ECOM-001, 002)

| Method and path                  | Role          | What                                                                                                                                                                                            |
| -------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /platform/ecom/shopify`     | any operator  | `{enabled, clientId, hasSecret, scopes, redirectUri, integrationsCount, eventsCount, logsCount}`. Never the secret.                                                                             |
| `PUT /platform/ecom/shopify`     | `super_admin` | Body, every field optional: `{enabled, clientId, clientSecret, scopes, redirectUri}`. What is left out stays; a blank secret keeps the saved one; an empty `scopes` means the default. Audited. |
| `GET /platform/ecom/woocommerce` | any operator  | `{enabled, integrationsCount, eventsCount, logsCount}`.                                                                                                                                         |
| `PUT /platform/ecom/woocommerce` | `super_admin` | Body `{enabled}`.                                                                                                                                                                               |

A WooCommerce store address on a private or loopback range is refused unless the install sets `ECOM_ALLOW_PRIVATE_STORE_URLS=true`.

## Automations (WD-ECOM-009, 033)

| Method and path                                      | Permission                | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /{shopify\|woocommerce}/stores/:id/automations` | `ecom.read`               | `{automations: [{eventType, isActive, templateUuid, templateName, varMap, sendTo, adminNumber, delaySeconds, fired}], senderKey}`: one row per event the store supports (18 Shopify, 21 WooCommerce), off when never set up. `fired` counts logged deliveries. `senderKey` is WooCommerce's "send from" or null.                                                                                                                                                                  |
| `PUT /{shopify\|woocommerce}/stores/:id/automations` | `ecom.automations.manage` | Body `{automations: [{eventType, isActive, templateUuid, varMap?, sendTo?, adminNumber?, delaySeconds?}], senderKey?}`. Saves all in one transaction (audited, outbox `*.automations.saved`) and answers the new list. Unsupported event types are ignored. 422: unknown or other-tenant template, an automation on without a template, a `senderKey` that is not a connected number. `senderKey` (`engine:uuid`) is WooCommerce only; `null` clears it, leaving it out keeps it. |

`varMap` is an ordered list of order field names (the variables in the event's context) filling `{{1}}`, `{{2}}`, ...; empty means the default `[name, order name, total]`. Only the cart steps (`cart/step2`, `cart/step3`) wait their `delaySeconds`; every other automation sends at once, as in WaDesk.
