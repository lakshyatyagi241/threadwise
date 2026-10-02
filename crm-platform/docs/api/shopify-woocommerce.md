# Shopify and WooCommerce API

Base path `/v2`. Inventory: [inventory/shopify-woocommerce.md](../wadesk-port/inventory/shopify-woocommerce.md). The first two tables need a user
session and the permission shown; the platform routes need an operator; the callback is public and proves itself (a signature, a sealed state).

## Shopify (WD-ECOM-004 to 007, 013)

| Method and path               | Permission     | What                                                                                                                                                                    |
| ----------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /shopify`                | `ecom.read`    | `{appEnabled, scopes, eventTopics, store}`: whether the platform app is on, what it asks for, the 12 webhook topics and the workspace's store (or null). Never a token. |
| `POST /shopify/connect/start` | `ecom.connect` | Body `{shop}` (a handle, a `*.myshopify.com` name or a pasted address). 200 `{url}`: the store's approval page. 422 `ECOM_SHOP_INVALID`, 422 `ECOM_NOT_CONFIGURED`.     |
| `DELETE /shopify/stores/:id`  | `ecom.connect` | 204. Removes the store's webhooks (errors ignored) and the row with its mapping and logs. 404 for another workspace's store.                                            |

`ShopifyStore`: `id` (uuid), `storeUrl`, `storeName`, `status`, `connected` (credentials held), `connectedAt`, `lastVerifiedAt`, `productsSyncedAt`,
`ordersSyncedAt`, `customersSyncedAt`, `syncStats`, `webhookUrl`, `webhookIds` (topic to the store's id), `createdAt`, `rowVersion`, `shopId`, `shopEmail`,
`shopOwner`, `shopPlan`, `shopCurrency`, `shopCountry`, `scopes`.

## Shopify public route

| Method and path               | Proof                                         | What                                                                                                                                                                                                            |
| ----------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /shopify/oauth/callback` | the `hmac` over the query, the sealed `state` | Where Shopify sends the browser back. 303 to `{WEB_APP_URL}/shopify?shopify=connected\|error&message=...`. Refused with a message: a bad signature, an expired or unknown state, another store, a refused code. |

Give Shopify `{APP_URL}/v2/shopify/oauth/callback` as the app's redirect address (the platform setting defaults to it).

## WooCommerce (WD-ECOM-025, 026, 013)

| Method and path                  | Permission     | What                                                                                                                                                                                                  |
| -------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /woocommerce`               | `ecom.read`    | `{appEnabled, eventTopics, store}`: the 7 webhook topics and the workspace's store (or null). Never a key.                                                                                            |
| `POST /woocommerce/test`         | `ecom.connect` | Body `{storeUrl, consumerKey, consumerSecret}`. 200 `{ok, message}` either way ("Connection verified. Store: ..." or the reason); saves nothing.                                                      |
| `POST /woocommerce/connect`      | `ecom.connect` | Same body. 201 the store. 422 `ECOM_DISABLED`, `ECOM_STORE_INVALID`, `ECOM_STORE_UNREACHABLE` ("Could not reach WooCommerce: ..."). Registers the 7 webhooks; reconnecting keeps the row and mapping. |
| `DELETE /woocommerce/stores/:id` | `ecom.connect` | 204, as Shopify's.                                                                                                                                                                                    |

`WoocommerceStore`: the same fields as Shopify's up to `rowVersion`, then `storeCurrency`, `storeCountry`, `storeVersion`.

## Platform settings (operators; WD-ECOM-001, 002)

| Method and path                  | Role          | What                                                                                                                                                                                            |
| -------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /platform/ecom/shopify`     | any operator  | `{enabled, clientId, hasSecret, scopes, redirectUri, integrationsCount, eventsCount, logsCount}`. Never the secret.                                                                             |
| `PUT /platform/ecom/shopify`     | `super_admin` | Body, every field optional: `{enabled, clientId, clientSecret, scopes, redirectUri}`. What is left out stays; a blank secret keeps the saved one; an empty `scopes` means the default. Audited. |
| `GET /platform/ecom/woocommerce` | any operator  | `{enabled, integrationsCount, eventsCount, logsCount}`.                                                                                                                                         |
| `PUT /platform/ecom/woocommerce` | `super_admin` | Body `{enabled}`.                                                                                                                                                                               |

A WooCommerce store address on a private or loopback range is refused unless the install sets `ECOM_ALLOW_PRIVATE_STORE_URLS=true`.
