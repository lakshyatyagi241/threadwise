# Parity evidence: shopify-woocommerce (ECOM)

WaDesk 1.7.0 vs branch `punya/punyafix`. Inventory: [inventory/shopify-woocommerce.md](../inventory/shopify-woocommerce.md). API reference:
[docs/api/shopify-woocommerce.md](../../api/shopify-woocommerce.md). Build order: [plan/punya-plan.md](../plan/punya-plan.md) (E1 to E6).

## Evidence so far

Automated only; no screen yet, so the Playwright twin run against the running WaDesk has not been done, and nothing was compared against a live Shopify
or WooCommerce store (that needs a Shopify partner app and a store, which this workspace does not have).

- `apps/api/test/unit/shopify-woocommerce/ecom-rules.spec.ts`, `mirror-rules.spec.ts` and `woo-phone.spec.ts`: 38 tests, passing (connect rules as below; every product, order, customer and stock mapping for both stores, the strike-through price, status maps, the Link-header paging, dial codes and every phone case) — the connect rules: (the store domain rules, PHP-compatible encoding, the OAuth signature in every accept and refuse case, the approval address, the sealed state's age and shape, the WooCommerce address, the webhook topics, address and secret, the saved webhook ids).
- `apps/api/test/e2e/shopify-woocommerce/ecom-connect.e2e.spec.ts` (17 scenarios: platform settings without the secret and the blank-secret rule, operator only, the start refusals and permission, the callback with an encrypted token and 12 webhooks and no secret in any answer, a bad signature or state or another store saving nothing, Shopify's own refusal, a store with no details, reconnecting with the old webhooks torn down and a new secret, isolation between workspaces, disconnect and its 404; WooCommerce test, connect with encrypted keys and 7 webhooks, refusals, reconnect, disconnect and permission). Typechecked and linted; NOT RUN (no Docker or Postgres in this environment).
- `apps/api/test/e2e/shopify-woocommerce/ecom-import.e2e.spec.ts` (10 scenarios: a Shopify import into the catalog, orders and contacts with the store stamped; importing again updating in place; a contact that already has the number only joining the group; slug collisions; the customer group kept when renamed and remade when gone; a cut-short read, a store with no credentials and isolation; a WooCommerce import with an international number from the billing country; sync now for both stores with its failure, 404 and permission cases). Typechecked and linted; NOT RUN.
- Typecheck, lint on the new files and `pnpm arch:check` (0 errors) are clean.

## Status of each feature

| Feature                                              | Status       | Notes                                                                                                                                                                                                                                       |
| ---------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WD-ECOM-001                                          | backend-done | `GET` and `PUT /v2/platform/ecom/shopify` (operators read, super admins change; audited, values never logged); the secret is an encrypted platform secret and is never returned.                                                            |
| WD-ECOM-002                                          | backend-done | `GET` and `PUT /v2/platform/ecom/woocommerce`.                                                                                                                                                                                              |
| WD-ECOM-003                                          | partial      | Permission keys `ecom.read`, `ecom.connect`, `ecom.automations.manage`, `ecom.broadcast` (`20261017090000_ecom_permissions.sql`). The plan flags are a shim (see below).                                                                    |
| WD-ECOM-004                                          | pending      | The screen is E5; `GET /shopify` and `GET /woocommerce` give it its data.                                                                                                                                                                   |
| WD-ECOM-005                                          | backend-done | `POST /shopify/connect/start`: domain normalised and checked, platform app checked, sealed state, the store's own approval address.                                                                                                         |
| WD-ECOM-006                                          | backend-done | `GET /shopify/oauth/callback` (public): signature, state, store, code, shop facts, upsert with an encrypted token and a new webhook secret, old subscriptions removed, webhooks registered. The first import is E2. See differences 1 to 3. |
| WD-ECOM-007                                          | backend-done | Twelve topics registered at `/v2/shopify/webhook/{secret}`; ids kept; teardown on reconnect and disconnect.                                                                                                                                 |
| WD-ECOM-013                                          | partial      | Disconnect done for both stores (`DELETE .../stores/:id`); sync now is E2.                                                                                                                                                                  |
| WD-ECOM-025                                          | backend-done | `POST /woocommerce/test` and `POST /woocommerce/connect`. See difference 4.                                                                                                                                                                 |
| WD-ECOM-026                                          | backend-done | Seven topics registered with the integration's secret; teardown. The receiver and its signature check are E3.                                                                                                                               |
| WD-ECOM-008 to 012, 014 to 024, 027 to 031, 033, 034 | pending      | E2 to E5.                                                                                                                                                                                                                                   |
| WD-ECOM-032, 035 to 038                              | blocked      | Plugin download and the embedded Shopify session need an owner decision; invoicing and flow links belong to other domains (E6).                                                                                                             |

## Differences from WaDesk

1. **The OAuth state is sealed, not a session value.** There is no PHP session here, so the state is an encrypted, 15 minute value naming the organization, the user and the store; the callback is a public route (Shopify redirects a bare browser) and carries the user in that state. The same login-CSRF guard, and a callback for a different store than the one asked for is refused.
2. **The callback ends on the Shopify screen**, `/shopify?shopify=connected|error&message=...`, as the Facebook one does; WaDesk redirected with a session flash.
3. **A webhook address is `/v2/shopify/webhook/{secret}`** (and `/v2/woocommerce/webhook/{secret}`): webhooks are registered at connect time, so a store connected here already has the right address; a store connected in WaDesk has to be connected again.
4. **A WooCommerce address is checked against private and loopback ranges** before any call (WaDesk would call anything the merchant typed); `ECOM_ALLOW_PRIVATE_STORE_URLS` turns it off for a store on the same network. Shopify calls only `*.myshopify.com`, validated at every call, and never follows a redirect.
5. **Reconnecting removes the old webhooks with the old key**, then saves; WaDesk did the same but swallowed every failure silently, the port logs how many webhooks registered.
6. **Disconnect is `DELETE` and answers 204**; WaDesk redirected with a flash.
7. **The Shopify secret is never shown and a save is audited** with the names of the fields that changed, not their values.

8. **Every page is read** (up to ten pages: 2,500 products, orders or customers on Shopify, 1,000 on WooCommerce); WaDesk read only the first 250 or 100 and dropped the rest without saying so. A cut-short read is recorded (`incomplete` in the sync stats).
9. **The import runs in a worker**, and "Sync now" answers at once with the store's totals and `importQueued`; WaDesk imported inside the request and returned the counts. The connect lands on the store screen without waiting.
10. **A Shopify product with no SKU gets `SHOPIFY-<id>`**; WaDesk saved an empty SKU, which anything that finds a product by SKU (reorder, the flow commerce node) cannot use. Availability is set from stock too (WaDesk left every product "in stock").
11. **An empty phone no longer hides a filled one.** WooCommerce sends `""` for a blank field; WaDesk fell through only on null, so an empty billing phone hid the shipping phone. The first filled value is used, for phone and country.
12. **Two products with one slug both import** (the second gets its id on the end); a customer is found by number as digits or with a `+`; the customer group id is kept on the store so a renamed group is still the one used.

## Shims

- `StoreMirror` (`_shims/sql-store-mirror.ts`): writes `wa_products`, `wa_orders`, `contacts` and the customer group directly until the catalog, checkout and contacts domains export their writers (a contact is created without a quota check or a `contact_identities` row, as the Facebook and Telegram channels do).
- `EcomPlanGate` (`_shims/open-gates.ts`): `integration_shopify` and `integration_woocommerce` are not in the plan catalogue; every check passes.

## Not verified

Everything against a live Shopify partner app or WooCommerce store; the e2e scenarios above (no database here); the screens (E5).
