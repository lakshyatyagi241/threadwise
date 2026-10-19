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
- `EngineCommerceSender` (real, through the engine registry; every template send carries the `consent` clearance `CommerceConsentService` issues, BL-141 follow-up), `SqlEcomTemplates` (also reads the template category), `SqlStoreMirror` (writes the catalog, checkout and contacts tables until those domains export writers).
- Blocked: plugin download, Invoices tab, flow links and resume, embedded session (E6).

## Menu location (our change, see parity/product-extensions.md item 22)

Shopify and WooCommerce are no longer entries of the sidebar's Store group (`inMenu: false` in `apps/web/src/features/shopify-woocommerce/nav.ts`, kept registered for the paywall, Help and the command palette). Each has a tile in Settings > Integrations (`settings.ts`, ids `shopify` and `woocommerce`, gates `ecom.read` plus the plan features `shopify` and `woocommerce`). Routes `/shopify` and `/woocommerce` are unchanged. The nav gates used the keys `integration_shopify` and `integration_woocommerce`, which are not plan-feature keys (the API gates on `shopify` and `woocommerce`), so both entries always rendered locked; they now use the catalogue keys. Other consumers of the routes: the flow builder's commerce node links to both (`flow-builder-editor/builder/inspector/forms-channels/commerce.tsx`); the Shopify products tab links to `/shopify?tab=offers`.

## Quiet hours on the offer and win-back broadcasts (BL-191, product extension)

Not in Reference. `BroadcastService.run` reads the template's category: a MARKETING one is asked through `SendWindowService.checkPhones` (the audience is known by phone: each number is matched to its contact for the time zone, else read on its country code). Held customers are not sent; the log row (`*_integration_logs`) stays `processed` with `{ sent, failed, held, heldUntil }` and a delayed `broadcast` job on `ecom-webhook` carries `resume` (the held customers and the counts so far). The resume run reads the hours and the opt-out list again, sends, and ends the log with the totals of both runs. A utility or authentication template is never held. The store event messages (abandoned cart, order status, COD) are not covered.

## Consent on every template send (BL-141 follow-up, BL-278, product extension)

Not in Reference (it messaged an opted-out customer unless the contact flag was set). `CommerceConsentService` (`commerce-consent.service.ts`, rules in `commerce-consent.rules.ts`) is the one step every customer-facing template send takes before `CommerceSender.send`, and `send` takes the `CommerceClearance` it issues (`consent`), so a new caller cannot skip it. A MARKETING template (`wa_templates.meta_category`, else `category`) goes through `gateRecipients` on the `whatsapp` channel; a utility or authentication one is cleared without a question. Callers and what each does with a refusal:

| Caller                                                                                                     | Sends                                  | A refused customer                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BroadcastService.run` (offer, win-back)                                                                   | `offer/broadcast`, `winback/broadcast` | counted in the row's `response` (`skipped`, `skippedReasons`), one `skipped` log row per reason; asked BEFORE `SendWindowService.checkPhones`, and again on every `resume` run; the run's rows are matched to contacts by `SegmentsRepository.contactIdsByDigits` |
| `EventMessageService.send` (order, cart `checkouts/create`, `cart/step2`, `cart/step3`, status, delivered) | every automation                       | outcome `skipped` with `Not messaged: consent (<reason>)`, written on the delivery's log row by `WebhookPipelineService.automation` or `CartService.runStep`; the admin number is cleared as `staff`                                                              |
| `CodService.confirm`                                                                                       | `cod/confirm`                          | row `skipped` with the note (the pending confirmation is still opened, as on a failed send)                                                                                                                                                                       |
| `StockService.onProductUpdate`                                                                             | `stock/back`                           | one `skipped` row per reason, `payload.skipped*` on the summary row; the waiter is still marked `notified`                                                                                                                                                        |
| `ConciergeService.reward`                                                                                  | `review/reward`                        | row `skipped`; `EventsRepository.recentFor` ignores `skipped` rows so the cooldown is not used up                                                                                                                                                                 |

Not asked: `sendText` (the COD yes/no answer, the stock opt-in acknowledgement and the concierge replies are answers inside the customer's open session) and `CartService.schedule` (`canSend` only; the reminder is cleared when it comes due). The Activity tab (`logs-tab.tsx`) shows the reason with the wording of `contact-consent.gate.reasons`. Allow-list: the `engine-commerce-sender.ts` KNOWN GAP entry is gone; `COMMERCE_SENDER` is a send primitive in `consent-gate.allowlist.ts` and `cart.service.ts` is listed with its reason; the guard test proves each caller clears the customer first and that the broadcast does it before the quiet hours. Tests: `test/unit/shopify-woocommerce/commerce-consent.spec.ts`, `test/e2e/shopify-woocommerce/ecom-consent.e2e.spec.ts`.
