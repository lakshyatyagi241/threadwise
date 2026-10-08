# Wiring map: checkout-orders-merchant-payments (CHK) as the store's merchant side

The admin API behind the store sidebar entries Orders, Coupons, Customers, Groups, Payments and Checkout gateways, and the ONE
payment gateway the store checkout and Sales invoices share (owner decision 2026-10-05). Read this with
[parity/storefront-builder.md](../parity/storefront-builder.md) ("Merchant admin API"). Update it in the same change as any new route,
table, consumer or event.

## Where the code is

| What                                                                  | Where                                                                                                                                                                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shared gateway: store, resolver, link maker, webhook, settings routes | `apps/api/src/modules/checkout-orders-merchant-payments/` (a leaf module: imports nothing of store or invoicing)                                                               |
| Orders, coupons, customers, groups, payments routes and services      | `apps/api/src/modules/storefront-builder/admin/` (rules in `.../rules/`)                                                                                                       |
| Invoice side of the shared gateway                                    | `apps/api/src/modules/crm/invoicing/invoice-public.service.ts`, `invoice-gateway-settler.ts`                                                                                   |
| Driver library, fixtures, key probe                                   | `apps/api/src/infra/providers/platform-payment-gateways/` (shared with platform billing), `.../checkout-orders-merchant-payments/`                                             |
| Contracts                                                             | `packages/contracts/src/checkout-orders-merchant-payments/` (`store-orders`, `store-coupons`, `store-customers`, `store-groups`, `store-gateways`, `store-payments`, `errors`) |
| Migrations                                                            | `20261030090000_chk_permissions`, `...090100_chk_shared_gateway`, `...090200_chk_gateway_backfill_razorpay`, `...090300_chk_invoice_attempt_providers`                         |

## API routes (all `/v2`)

Orders and coupons carry `@RequirePlanFeature('wa_storefront')` (class level). Gateways, customers, groups and payments are not plan gated
(invoices read the gateway too). Every write is `@Idempotent()`.

| Method | Path                                                                         | Permission                                                |
| ------ | ---------------------------------------------------------------------------- | --------------------------------------------------------- |
| GET    | `/store/orders`                                                              | `store.orders.read`                                       |
| GET    | `/store/orders/counts`                                                       | `store.orders.read`                                       |
| GET    | `/store/orders/:id`                                                          | `store.orders.read`                                       |
| PATCH  | `/store/orders/:id/status`                                                   | `store.orders.manage`                                     |
| POST   | `/store/orders/:id/payment-link`                                             | `store.orders.manage`                                     |
| POST   | `/store/orders/:id/generate-payment-link`                                    | `store.orders.manage`                                     |
| POST   | `/store/orders/:id/create-invoice`                                           | `store.orders.manage`                                     |
| DELETE | `/store/orders/:id`                                                          | `store.orders.delete`                                     |
| GET    | `/store/coupons`, `/store/coupons/:id`, `/store/coupons/:id/usages`          | `store.coupons.read`                                      |
| POST   | `/store/coupons`                                                             | `store.coupons.manage`                                    |
| PUT    | `/store/coupons/:id`                                                         | `store.coupons.manage`                                    |
| POST   | `/store/coupons/:id/toggle`                                                  | `store.coupons.manage`                                    |
| DELETE | `/store/coupons/:id`                                                         | `store.coupons.manage`                                    |
| GET    | `/store/customers`, `/store/customers/:id`                                   | `store.customers.read`                                    |
| POST   | `/store/customers`                                                           | `store.customers.manage`                                  |
| PUT    | `/store/customers/:id`                                                       | `store.customers.manage`                                  |
| DELETE | `/store/customers/:id`                                                       | `store.customers.manage`                                  |
| GET    | `/store/groups`, `/store/groups/summary`, `/store/groups/:id`                | `store.groups.read`                                       |
| PUT    | `/store/groups/:id/code`                                                     | `store.groups.manage`                                     |
| GET    | `/store/gateways`, `/store/gateways/drivers`, `/store/gateways/resolved`     | `store.gateways.read`                                     |
| PUT    | `/store/gateways/:slug`                                                      | `store.gateways.manage`                                   |
| POST   | `/store/gateways/:slug/test`, `/toggle`, `/default`                          | `store.gateways.manage`                                   |
| DELETE | `/store/gateways/:slug`                                                      | `store.gateways.manage`                                   |
| GET    | `/store/payments`, `/store/payments/summary`, `/store/payments/whatsapp-pay` | `store.payments.view`                                     |
| PUT    | `/store/payments/whatsapp-pay`                                               | `store.payments.manage`                                   |
| DELETE | `/store/payments/whatsapp-pay/:id`                                           | `store.payments.manage`                                   |
| POST   | `/store-public/webhooks/gateway/:gatewayId`                                  | public (the gateway's own signature)                      |
| POST   | `/store-public/webhooks/razorpay`                                            | public (existing; the secret now comes from the resolver) |

## Tables read or written

`wa_orders`, `wa_order_items`, `wa_coupons` (also by the checkout: `used_count`), `wa_customer_profiles`, `wa_groups`, `devices` (the
ordering number), `wa_merchant_gateways` (workspace row = `storefront_id` 0, shop override = the shop's id; `is_default`, credentials one
AES-GCM envelope), `wa_storefronts` (shop names; the legacy `payment_provider` / `payment_config_json`), `workspace_payment_configs`
(WhatsApp Pay), `wa_provider_configs` (the WABA config a WhatsApp Pay row points at), `contacts`, `invoices`, `sales_orders` (read-only
joins for the linked ids), `invoice_payment_attempts` (written by the invoice pay page), `audit_log`, `event_outbox`.

## Which gateway wins (`WorkspaceGatewayResolver.resolve(orgId, storefrontId?, { slug?, tx? })`)

1. the shop's own override (`wa_merchant_gateways.storefront_id = shop`, active, every required field present);
2. the workspace default (`storefront_id = 0`);
3. the keys saved on the shop itself (`wa_storefronts.payment_config_json`, provider `razorpay_api`) - the storefront settings screen
   still writes them and `StoreKeysMirror` copies them into the shop's override row on every save;
4. nothing.

Inside a scope: the row flagged default, else the lowest `sort_order`, else the oldest. An invoice asks with no shop, so steps 1 and 3
never apply to it. Consumers: `StoreOrdersService.generatePaymentLink` (and the "Send checkout" picker via `available`), the storefront
Razorpay webhook (`PaymentWebhookService`), `InvoicePublicService.pay` and the `online` flag of the public invoice.

## Outbox events emitted

`store.order_status_changed` (`{orderNo, orderId, from, to, invoiceDue}`; consumed by `store-orders-sales` to keep the CRM side in
step), `store.order_payment_link_set`, `store.order_invoiced`, `store.order_deleted`, `store.order_paid` (now also from the shared
gateway webhook, `via` = the gateway slug), `store.coupon_created|updated|deleted`, `store.customer_created|updated|deleted`,
`store.group_code_changed`, `store.gateway_saved|enabled|disabled|default_set|removed`, `store.whatsapp_pay_config_saved|removed`,
`payment.rejected` (invoice side, for a verified notification that cannot be applied).

## Seams

- `GatewayPaymentRegistry`: how a domain settles the payments it issued through the shared gateway. Prefix `WAORD-` is the store
  (`OrderPaymentSettler`), `INV-` is invoicing (`InvoiceGatewaySettler`). Register in `onModuleInit`.
- `STORE_ORDER_INVOICE` (`storefront-builder/store-order-invoice.port.ts`): bound to `StoreOrderSalesService.createInvoiceForOrder`
  of `store-orders-sales` by `admin/store-order-sales-invoice.adapter.ts`.
- The old shims stay: `OrdersGateway` and `CouponDirectory` (`_shims/`) still serve the checkout and the dashboard; the admin side reads
  `wa_orders` / `wa_coupons` through its own repositories (same tables).
- Saved customers exist twice on purpose: `/waba/customers` (`waba.customers.*`, the WhatsApp ordering flow's address book, offset paging,
  no totals) stays as it is; `/store/customers` (`store.customers.*`) is the store screen's read model with order totals and the contact
  link, and lists EVERY buyer (saved profiles plus order-only buyers, see store-orders-crm.md). Both read and write `wa_customer_profiles`
  keyed by the digits of the phone (the store screen matches on the phone with the default country applied).
- The generic invoice connection (`hmac_generic`, Settings > Invoicing) is the FALLBACK of the invoice pay page and keeps its own webhook.

## Web screens

All under `apps/web/src/features/checkout-orders-merchant-payments/` (pages in `apps/web/src/app/(app)/(storefront-builder)/store/**`,
wrapped in `StoreShell`). Permissions are the keys of the routes above; a caller without the read key sees the no-access panel.

| Route                | Screen component (`components/`)                                           | Read permission                           | API calls                                                                                                                                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/store/orders`      | `orders-screen.tsx` (`OrdersScreen`)                                       | `store.orders.read`                       | `GET /store/orders`, `GET /store/orders/counts`, `PATCH /store/orders/:id/status`, `DELETE /store/orders/:id`                                                                                                                                       |
| `/store/orders/[id]` | `order-detail-screen.tsx` (`OrderDetailScreen`)                            | `store.orders.read`                       | `GET /store/orders/:id`, status, `payment-link`, `generate-payment-link`, `create-invoice` (manage), delete (delete)                                                                                                                                |
| `/store/coupons`     | `coupons-screen.tsx` (`CouponsScreen`)                                     | `store.coupons.read`                      | `GET /store/coupons`, `GET /store/coupons/:id/usages`, `POST`, `PUT /:id`, `POST /:id/toggle`, `DELETE /:id` (manage)                                                                                                                               |
| `/store/customers`   | `customers-screen.tsx` (`CustomersScreen`)                                 | `store.customers.read`                    | `GET /store/customers`, `POST`, `PUT /:id`, `DELETE /:id` (manage). Replaces the old saved-customers page at this route; the Settings tile `whatsapp-customers` is now gated `store.customers.read`                                                 |
| `/store/groups`      | `groups-screen.tsx` (`GroupsScreen`)                                       | `store.groups.read`                       | `GET /store/groups`, `GET /store/groups/summary`, `PUT /store/groups/:id/code` (manage)                                                                                                                                                             |
| `/store/gateways`    | `gateways-screen.tsx` (`GatewaysScreen`); Settings tile `payment-gateways` | `store.gateways.read`                     | `GET /store/gateways`, `/drivers`, `/resolved`, `PUT /:slug`, `POST /:slug/test`, `/toggle`, `/default`, `DELETE /:slug` (manage)                                                                                                                   |
| `/store/payments`    | `payments-screen.tsx` (`PaymentsScreen`)                                   | `store.payments.view`                     | `GET /store/payments`, `/summary`, `/whatsapp-pay`, `PUT /whatsapp-pay`, `DELETE /whatsapp-pay/:id` (manage)                                                                                                                                        |
| `/store/invoices`    | `store-invoices-screen.tsx` (`StoreInvoicesScreen`)                        | `record.invoices.read` (Sales permission) | `GET /invoices` (the existing Sales list, 50 per page, newest first). The list has no `source` filter, so rows with `source = own` (invoices made from a store order) are kept client-side: up to 6 pages are fetched automatically, then Load more |

Notes: the invoices screen is a view, not a second list; each row opens `/invoices/:id` in Sales and the buyer opens `/contacts/:id`.
A server-side `source` filter on `GET /invoices` would make it exact (a shop with few store invoices among many Sales invoices may
need Load more today). Groups show an honest empty state because `wa_groups` has no writer yet (see below).

## Not done / blocked

- Buyer messages are not translated to the buyer's language (Reference used its AI ordering translator) and go out from the workspace's
  primary sender, not the shop's own number.
- `wa_groups` has no writer yet: Reference's Node bridge mirrors the group directory (`/api/groups/sync`); that belongs to the bridge domain.
- WhatsApp Pay charging (`orders/{id}/whatsapp-pay`, the reconcile sweep) is not part of this change; only its configurations are.
- Gateways other than Razorpay and Stripe have no cheap money-free auth call, so `test` checks the required fields only and says so.
- Gateway return pages (`/wa/checkout/return/{slug}/{token}`): the buyer lands on the shop's tracking page / the public invoice; only
  the signed notification marks money received.
