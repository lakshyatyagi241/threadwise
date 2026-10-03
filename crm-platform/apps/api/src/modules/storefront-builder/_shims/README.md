# Shims

Stand-ins for services other domains own and have not exported yet. Each is an interface (the token in `tokens.ts`) plus a
default implementation that reads the tables the WaDesk schema migrations already created. When the owning domain exports the
real service, bind it to the same token in `storefront-builder.module.ts` and delete the shim.

| Shim (token)                                                  | Real owner (WD domain)                                                    | Used by                               | Tracker row               |
| ------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------- | ------------------------- |
| `OrdersGateway` (`SqlOrdersGateway`, SQL on `wa_orders`)      | checkout-orders-merchant-payments (CHK): order creation, order read model | WD-STORE-001, 005, 013, 017, 018, 019 | blocked on CHK order API  |
| `CouponDirectory` (`SqlCouponDirectory`, SQL on `wa_coupons`) | checkout-orders-merchant-payments (CHK): coupon entity and its CRUD       | WD-STORE-013, 014                     | blocked on CHK coupon API |
| `SenderDirectory` (`SqlSenderDirectory`, `devices` + configs) | whatsapp-devices-baileys / whatsapp-cloud-api-waba (`WorkspaceEngine`)    | WD-STORE-002, 003, 004, 009, 011, 015 | blocked on WADEV, WABA    |
| `RecoveryNudgeSender` (`EngineRecoveryNudgeSender`)           | the channel domains (Baileys bridge send, Meta Cloud send, Twilio send)   | WD-STORE-015                          | Twilio path blocked       |

Notes

- `OrdersGateway` also deletes orders (shop delete, store reset). `wa_orders.storefront_id` is `ON DELETE SET NULL`, so the
  delete is explicit, in the same transaction as the shop delete.
- Tables owned by CHK that this domain writes: `wa_orders` (insert at checkout, `status`/`payment_link`/`meta_json` at the
  webhook) and `wa_coupons.used_count`. Migration `20261010200300_store_recovery_unique.sql` adds a unique partial index
  `uq_wa_orders_recovery_token` next to CHK's plain index on the tracking token.
- Products and reviews are NOT shimmed: `StorefrontProductsReader` is catalog-products' own barrel export.
- The recovery nudge by WABA reads the number's `credentials_json` (encrypted with `CryptoService`, the same shape the
  broadcast sender reads). The Twilio engine has no adapter anywhere in the repo yet: the sweep logs it and moves on, as WaDesk
  logged "no sender".
