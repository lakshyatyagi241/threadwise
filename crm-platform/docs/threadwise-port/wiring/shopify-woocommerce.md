# Wiring map: shopify-woocommerce (ECOM)

Generated from the controllers, repositories and web routes on branch `punya/punyafix`; the shim notes are hand-written. Update it in the same change as any new route, table, queue or consumer.

## API routes

| Method | Path                                     | Permission                |
| ------ | ---------------------------------------- | ------------------------- |
| GET    | `/v2/shopify/stores/:id/automations`     | `ecom.read`               |
| PUT    | `/v2/shopify/stores/:id/automations`     | `ecom.automations.manage` |
| GET    | `/v2/woocommerce/stores/:id/automations` | `ecom.read`               |
| PUT    | `/v2/woocommerce/stores/:id/automations` | `ecom.automations.manage` |
| POST   | `/v2/shopify/stores/:id/offer`           | `ecom.broadcast`          |
| POST   | `/v2/woocommerce/stores/:id/offer`       | `ecom.broadcast`          |
| POST   | `/v2/shopify/stores/:id/winback`         | `ecom.broadcast`          |
| POST   | `/v2/woocommerce/stores/:id/winback`     | `ecom.broadcast`          |
| GET    | `/v2/shopify/stores/:id/dashboard`       | `ecom.read`               |
| GET    | `/v2/woocommerce/stores/:id/dashboard`   | `ecom.read`               |
| GET    | `/v2/shopify/oauth/callback`             | public                    |
| GET    | `/v2/platform/ecom/shopify`              | -                         |
| PUT    | `/v2/platform/ecom/shopify`              | -                         |
| GET    | `/v2/platform/ecom/woocommerce`          | -                         |
| PUT    | `/v2/platform/ecom/woocommerce`          | -                         |
| GET    | `/v2/shopify`                            | `ecom.read`               |
| POST   | `/v2/shopify/connect/start`              | `ecom.connect`            |
| DELETE | `/v2/shopify/stores/:id`                 | `ecom.connect`            |
| POST   | `/v2/shopify/stores/:id/sync`            | `ecom.connect`            |
| POST   | `/v2/shopify/webhook/:secret`            | public                    |
| POST   | `/v2/shopify/compliance`                 | -                         |
| POST   | `/v2/woocommerce/webhook/:secret`        | -                         |
| GET    | `/v2/woocommerce`                        | `ecom.read`               |
| POST   | `/v2/woocommerce/test`                   | `ecom.connect`            |
| POST   | `/v2/woocommerce/connect`                | `ecom.connect`            |
| DELETE | `/v2/woocommerce/stores/:id`             | `ecom.connect`            |
| POST   | `/v2/woocommerce/stores/:id/sync`        | `ecom.connect`            |

## Web screens

- `/shopify`
- `/woocommerce`

## Tables read or written

`contact_group_members`, `contact_groups`, `contacts`, `devices`, `ecom_shop_lookup`, `ecom_store_lookup`, `shopify_integration_events`, `shopify_integration_logs`, `shopify_integrations`, `wa_coupons`, `wa_orders`, `wa_products`, `wa_provider_configs`, `wa_templates`, `woocommerce_integration_events`, `woocommerce_integration_logs`, `woocommerce_integrations`, `workspace_settings`

## Queues and workers

`ECOM_IMPORT`, `ECOM_WEBHOOK`

## Outbox events emitted

`shopify.store.connected`, `shopify.store.disconnected`, `woocommerce.store.connected`, `woocommerce.store.disconnected`

## Shims, owners and blocked consumers

- `PlanEcomGate`: real, the plan flags `shopify` and `woocommerce`.
- `EngineCommerceSender` (real, through the engine registry), `SqlEcomTemplates`, `SqlStoreMirror` (writes the catalog, checkout and contacts tables until those domains export writers).
- Blocked: plugin download, Invoices tab, flow links and resume, embedded session (E6).

## Menu location (our change, see parity/product-extensions.md item 22)

Shopify and WooCommerce are no longer entries of the sidebar's Store group (`inMenu: false` in `apps/web/src/features/shopify-woocommerce/nav.ts`, kept registered for the paywall, Help and the command palette). Each has a tile in Settings > Integrations (`settings.ts`, ids `shopify` and `woocommerce`, gates `ecom.read` plus the plan features `shopify` and `woocommerce`). Routes `/shopify` and `/woocommerce` are unchanged. The nav gates used the keys `integration_shopify` and `integration_woocommerce`, which are not plan-feature keys (the API gates on `shopify` and `woocommerce`), so both entries always rendered locked; they now use the catalogue keys. Other consumers of the routes: the flow builder's commerce node links to both (`flow-builder-editor/builder/inspector/forms-channels/commerce.tsx`); the Shopify products tab links to `/shopify?tab=offers`.

## Quiet hours on the offer and win-back broadcasts (BL-191, product extension)

Not in Reference. `BroadcastService.run` reads the template's category: a MARKETING one is asked through `SendWindowService.checkPhones` (the audience is known by phone: each number is matched to its contact for the time zone, else read on its country code). Held customers are not sent; the log row (`*_integration_logs`) stays `processed` with `{ sent, failed, held, heldUntil }` and a delayed `broadcast` job on `ecom-webhook` carries `resume` (the held customers and the counts so far). The resume run reads the hours and the opt-out list again, sends, and ends the log with the totals of both runs. A utility or authentication template is never held. The store event messages (abandoned cart, order status, COD) are not covered.
