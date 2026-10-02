# Port map: platform-payment-gateways (PAYGW)

Spec: `docs/threadwise-port/inventory/platform-payment-gateways.md`. Owner zone: `ownership.json` -> `domains.platform-payment-gateways`.
Hard rule: the platform owner gets paid by workspaces; everything a workspace charges ITS customers is CHK / INV / SALES / APPT and only reuses the driver library built here.

## Target modules

| Piece           | Path                                                                                                                 | What                                                                                                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Driver library  | `apps/api/src/infra/providers/platform-payment-gateways/`                                                            | `PaymentDriver` port (no reference to plans or workspaces: TW-048), catalogue (33 slugs, credential schema, whitelist), money exponents, Stripe / Razorpay / PayPal drivers, registry |
| Domain module   | `apps/api/src/modules/platform-payment-gateways/`                                                                    | gateway admin, checkout (quote + place order), return + webhook receivers, order fulfilment, buyer order history, wallet shim                                                         |
| Contracts       | `packages/contracts/src/platform-payment-gateways/`                                                                  | gateway admin, checkout, order shapes; identifiers start with `paygw`/`Paygw`                                                                                                         |
| Tables          | `payment_gateways` (platform), `orders` (tenant), `subscriptions` (tenant, P1)                                       | already created by `20261001104700_paygw_threadwise_schema.sql`; `20261005100000_paygw_core.sql` adds what the port needs on top                                                          |
| Web (operator)  | `apps/web/src/app/(admin)/(platform-payment-gateways)/admin/payment-gateways`, `features/platform-payment-gateways/` | gateway list, cards, activate, save                                                                                                                                                   |
| Web (workspace) | `apps/web/src/app/(app)/(platform-payment-gateways)/` + same feature folder                                          | checkout page, order history                                                                                                                                                          |

## Tenancy decisions

- `payment_gateways` has only an `operator_write` privileged policy. Its credentials never reach a tenant transaction: every read and write goes through ONE door, `PaygwStore` (a copy of the `PlanStore` / `PlatformStore` pattern, the only file in the module that calls `.privileged(`, unit-tested by grep). The checkout reads the active list through it and returns public fields only.
- `orders` is a tenant table (forced RLS). The buyer writes it in a normal `tx()`. The return and webhook receivers are public and cross-tenant, so they locate the order by its opaque `return_token` or by `gateway_order_id` through the same store, then act with `PaygwStore.tx`.
- Credentials: one AES-256-GCM envelope (`CryptoService`) over the credential JSON. Secrets never leave the API: the list returns `hasValue` per field, text fields return their value only for the non-secret types the schema marks `public`.
- Plan application on payment (Reference `plan_ends_at` stacking) writes `org_plan_state` and `organizations.plan`, both privileged-write; it runs inside `PaygwStore.tx` so no new door is opened.

## Endpoints

Operator (`OperatorGuard`, writes `super_admin`): `GET /v2/platform/payment-gateways`, `PATCH /v2/platform/payment-gateways/:id` (rowVersion), `POST /v2/platform/payment-gateways/:id/toggle`.
Workspace (permission keys below): `GET /v2/billing/checkout/plans/:planSlug/quote`, `POST /v2/billing/checkout/plans/:planSlug/orders`, `GET /v2/billing/checkout/wallet/quote`, `POST /v2/billing/checkout/wallet/orders`, `GET /v2/billing/orders`.
Public: `GET|POST /v2/payments/return/:slug`, `POST /v2/payments/webhook/:slug` (signature is the authentication; `@Public`).

## Permission keys

`paygw.checkout.create` (start a purchase), `paygw.orders.read` (the workspace's order history). Operators use roles, not keys (Reference checks none either). Seeded to the locked Admin preset in the same migration as the table changes.

## Events (outbox)

`paygw.order.created`, `paygw.order.paid`, `paygw.order.failed`, in the same transaction as the write; audit rows through the module's own writer (`orders` for tenant writes, `security_events` for operator writes).

## Build order and status

1. Catalogue + credential schema + admin list/save/activate (001-005) + web cards. P0
2. Driver port + Stripe, Razorpay, PayPal (008, 014-016, 048). P0
3. Checkout quote + place order (009, 011, 031). P0
4. Return (026), webhook (027), fulfilment (028), buyer history (035). P0
5. P1 as far as time allows: currency whitelist (006), tax settings (007), offline gateways (013), order history admin (037).

## Prerequisites from other domains and shims

- PLAN: `plans` catalogue and `org_plan_state` exist; no "apply plan to workspace" function yet, so `OrderFulfilmentService` implements the stacking rule itself (shim, inside this zone).
- WALLET: no `WalletService`; `_shims/wallet-credit.ts` posts to `wallets` + `wallet_transactions` with idempotency key = order id.
- CPN (coupons): not built; coupon codes are refused with a clear validation error (listed as blocked, TW-010).
- SET (settings): `checkout.tax_*` and `pricing.*` are read from `platform_settings` through `PlatformSettingsService` with single-source defaults; the admin form for them (007) is not built.

## Risks

- A single order can be confirmed by return AND webhook at once: finalisation is a conditional `UPDATE ... WHERE status <> 'paid'`; side effects run only for the winner.
- Redirect parameters are never proof of payment: every driver confirms with the provider server-to-server (or verifies an HMAC) before `paid`.
- Zero-decimal and three-decimal currencies: one exponent table (Reference multiplies by 100 always).
- Provider calls happen outside any DB transaction (create order, commit, call provider, conditional update).
