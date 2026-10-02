# Parity evidence: shopify-woocommerce (ECOM)

Reference 1.7.0 vs branch `punya/punyafix`. Inventory: [inventory/shopify-woocommerce.md](../inventory/shopify-woocommerce.md). API reference:
[docs/api/shopify-woocommerce.md](../../api/shopify-woocommerce.md). Build order: [plan/punya-plan.md](../plan/punya-plan.md) (E1 to E6).

## Evidence so far

Automated only; no screen yet, so the Playwright twin run against the running Reference has not been done, and nothing was compared against a live Shopify
or WooCommerce store (that needs a Shopify partner app and a store, which this workspace does not have).

- `apps/api/test/unit/shopify-woocommerce/ecom-rules.spec.ts`: 12 tests, passing (the store domain rules, PHP-compatible encoding, the OAuth signature in every accept and refuse case, the approval address, the sealed state's age and shape, the WooCommerce address, the webhook topics, address and secret, the saved webhook ids).
- `apps/api/test/e2e/shopify-woocommerce/ecom-connect.e2e.spec.ts` (17 scenarios: platform settings without the secret and the blank-secret rule, operator only, the start refusals and permission, the callback with an encrypted token and 12 webhooks and no secret in any answer, a bad signature or state or another store saving nothing, Shopify's own refusal, a store with no details, reconnecting with the old webhooks torn down and a new secret, isolation between workspaces, disconnect and its 404; WooCommerce test, connect with encrypted keys and 7 webhooks, refusals, reconnect, disconnect and permission). Typechecked and linted; NOT RUN (no Docker or Postgres in this environment).
- Typecheck, lint on the new files and `pnpm arch:check` (0 errors) are clean.

## Status of each feature

| Feature                                              | Status       | Notes                                                                                                                                                                                                                                       |
| ---------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TW-ECOM-001                                          | backend-done | `GET` and `PUT /v2/platform/ecom/shopify` (operators read, super admins change; audited, values never logged); the secret is an encrypted platform secret and is never returned.                                                            |
| TW-ECOM-002                                          | backend-done | `GET` and `PUT /v2/platform/ecom/woocommerce`.                                                                                                                                                                                              |
| TW-ECOM-003                                          | partial      | Permission keys `ecom.read`, `ecom.connect`, `ecom.automations.manage`, `ecom.broadcast` (`20261017090000_ecom_permissions.sql`). The plan flags are a shim (see below).                                                                    |
| TW-ECOM-004                                          | pending      | The screen is E5; `GET /shopify` and `GET /woocommerce` give it its data.                                                                                                                                                                   |
| TW-ECOM-005                                          | backend-done | `POST /shopify/connect/start`: domain normalised and checked, platform app checked, sealed state, the store's own approval address.                                                                                                         |
| TW-ECOM-006                                          | backend-done | `GET /shopify/oauth/callback` (public): signature, state, store, code, shop facts, upsert with an encrypted token and a new webhook secret, old subscriptions removed, webhooks registered. The first import is E2. See differences 1 to 3. |
| TW-ECOM-007                                          | backend-done | Twelve topics registered at `/v2/shopify/webhook/{secret}`; ids kept; teardown on reconnect and disconnect.                                                                                                                                 |
| TW-ECOM-013                                          | partial      | Disconnect done for both stores (`DELETE .../stores/:id`); sync now is E2.                                                                                                                                                                  |
| TW-ECOM-025                                          | backend-done | `POST /woocommerce/test` and `POST /woocommerce/connect`. See difference 4.                                                                                                                                                                 |
| TW-ECOM-026                                          | backend-done | Seven topics registered with the integration's secret; teardown. The receiver and its signature check are E3.                                                                                                                               |
| TW-ECOM-008 to 012, 014 to 024, 027 to 031, 033, 034 | pending      | E2 to E5.                                                                                                                                                                                                                                   |
| TW-ECOM-032, 035 to 038                              | blocked      | Plugin download and the embedded Shopify session need an owner decision; invoicing and flow links belong to other domains (E6).                                                                                                             |

## Differences from Reference

1. **The OAuth state is sealed, not a session value.** There is no PHP session here, so the state is an encrypted, 15 minute value naming the organization, the user and the store; the callback is a public route (Shopify redirects a bare browser) and carries the user in that state. The same login-CSRF guard, and a callback for a different store than the one asked for is refused.
2. **The callback ends on the Shopify screen**, `/shopify?shopify=connected|error&message=...`, as the Facebook one does; Reference redirected with a session flash.
3. **A webhook address is `/v2/shopify/webhook/{secret}`** (and `/v2/woocommerce/webhook/{secret}`): webhooks are registered at connect time, so a store connected here already has the right address; a store connected in Reference has to be connected again.
4. **A WooCommerce address is checked against private and loopback ranges** before any call (Reference would call anything the merchant typed); `ECOM_ALLOW_PRIVATE_STORE_URLS` turns it off for a store on the same network. Shopify calls only `*.myshopify.com`, validated at every call, and never follows a redirect.
5. **Reconnecting removes the old webhooks with the old key**, then saves; Reference did the same but swallowed every failure silently, the port logs how many webhooks registered.
6. **Disconnect is `DELETE` and answers 204**; Reference redirected with a flash.
7. **The Shopify secret is never shown and a save is audited** with the names of the fields that changed, not their values.

## Shims

- `EcomPlanGate` (`_shims/open-gates.ts`): `integration_shopify` and `integration_woocommerce` are not in the plan catalogue; every check passes.

## Not verified

Everything against a live Shopify partner app or WooCommerce store; the e2e scenarios above (no database here); the screens (E5).
