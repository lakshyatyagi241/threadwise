# Wiring map: store orders in the CRM (STORE x CHK x CRM x INV)

Hand-written 2026-10-05, the day the owner decided that store customers and orders are linked to the CRM on purpose (WaDesk keeps them
apart: `wa_orders` / `wa_customer_profiles` are keyed by a bare phone, nothing points at a contact, a sales order or an invoice).
Update it in the same change as any new order writer, consumer or link column.

## Link columns (migration `20261029090000_store_orders_contact_link.sql`)

| Table                  | Column           | Points at      | On delete | Written by                                                                 |
| ---------------------- | ---------------- | -------------- | --------- | -------------------------------------------------------------------------- |
| `wa_orders`            | `contact_id`     | `contacts`     | set null  | the four order writers below, else the consumer's catch-up                 |
| `wa_orders`            | `sales_order_id` | `sales_orders` | set null  | `StoreOrderSalesService` (stage 1 of `syncOrder`)                          |
| `wa_orders`            | `invoice_id`     | `invoices`     | set null  | `StoreOrderSalesService` (stage 2 of `syncOrder`, `createInvoiceForOrder`) |
| `wa_customer_profiles` | `contact_id`     | `contacts`     | set null  | `CustomerProfilesService.save` (the saved-address upsert)                  |

Also: `invoices.wa_order_id` (older column) is stamped on the draft, and a unique index (`org_id, wa_order_id, doc_type`) makes "one
invoice per order and type" a database fact. `wa_orders.meta_json.crm` holds the bridge's own marks (`placedLogged`, `paidLogged`,
`cancelled`).

## Order writers (all call the one contact door)

| Writer                                             | File                                                                 | Event it emits                  | Contact link                                       |
| -------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------- |
| Storefront public checkout (`source = storefront`) | `storefront-builder/_shims/sql-orders-gateway.ts` (`create`)         | `store.order_placed`            | `CONTACT_RESOLVER.findOrCreateByPhone`, same tx    |
| WhatsApp catalog cart (`source = waba`)            | `whatsapp-cloud-api-waba/waba-orders.service.ts` (`capture`)         | `whatsapp.order.received`       | same, same tx (payload now also carries `orderNo`) |
| WhatsApp AI ordering flow (`source = whatsapp_ai`) | `flow-runtime-engine/runtime/nodes/ai/ordering.service.ts` (`place`) | `store.order_placed` (new here) | same, same tx                                      |
| Shopify / WooCommerce mirror                       | `shopify-woocommerce/_shims/sql-store-mirror.ts` (`upsertOrder`)     | none (see "Not done")           | same, same tx                                      |
| Saved customer profile (Customers screen)          | `whatsapp-cloud-api-waba/customer-profiles.service.ts` (`save`)      | none                            | same, same tx                                      |

The door: `CONTACT_RESOLVER` (token, leaf file `crm/contact-resolver.port.ts`), implemented by `ContactResolverService`
(`crm/contacts/contact-resolver.service.ts`), a thin policy layer over `ContactsService.resolveOrCreateByIdentity`: one phone
canonicaliser, identity-first lookup, advisory lock per number, the plan's `contacts` cap (a cap is a `skipped` result: the order is
placed with `contact_id` null and a warning is logged), default stage and status, `contact.created` in the caller's transaction, blanks
(name, email, delivery address) filled but never overwritten, label "Store customer" (skipped at the tag cap). It runs in a savepoint and
never throws.

## Consumer and services (`modules/store-orders-sales`)

| Piece                                                           | What                                                                                                                                                                                                                                        |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `StoreOrderSalesConsumer` (worker)                              | subscribes to `store.order_placed`, `whatsapp.order.received`, `store.order_paid`, `store.order_status_changed`; reads `payload.orderId` (uuid) or `payload.orderNo`; calls `syncOrder`; idempotent                                         |
| `StoreOrderSalesService.syncOrder(orgId, {uuid\|id})`           | stage 1: contact catch-up, confirmed sales order (once), timeline "Store order #N"; stage 2 (own tx): invoice when the trigger is met and the plan allows, payment when paid                                                                |
| `StoreOrderSalesService.createInvoiceForOrder(orgId, uuidOrNo)` | the manual "Create invoice" button: ignores the trigger, idempotent, 422 `PLAN_FEATURE_LOCKED` / `PLAN_LIMIT_REACHED`, 409 for a cancelled order, 404 for an unknown one                                                                    |
| `StoreOrderSalesService.listForContact(contactUuid, limit?)`    | a contact's store orders (contract `ContactStoreOrdersResponse`), record scope of `contacts.read` applied; served by `ContactStoreOrdersController`, `GET /v2/contacts/:contactId/store-orders?limit=` (`record.contacts.read`, staff only) |
| `ExternalOrderBillingService` (crm/invoicing)                   | the invoicing module's door for channel orders: `createSalesOrderIn`, `invoiceSalesOrderIn`, `recordPaymentIn`, `cancelSalesOrderIn`, all inside the caller's transaction; the only writer of sales documents for store orders              |

Rules ported from WaDesk's `OwnStoreInvoiceMapper`: a store order is a **receipt** unless a real tax amount was captured (then a tax
invoice); no readable lines become one "Order #N" line; amounts stored x100 are re-scaled to the currency's true minor units; trigger
`invoice_settings.trigger_own` (`on_placed`, `on_paid` default, `on_fulfilled`, plus our `manual`).

Plan gates: `invoicing` (feature; without it the contact link and timeline still happen, the sales order and invoice are skipped with a
log line), `invoices_monthly` (limit; the sales order stays, the invoice is skipped with a reason), `contacts` (limit; see above).

## Not wired yet (blocked, with owner)

- WaDesk `auto_send_own` (send the invoice over WhatsApp) is not read: delivery is the invoicing module's own follow-up (L10). The
  trigger is read; the settings screen does not expose `trigger_own` yet (needs the invoice profile contract to carry it).
- Shopify/WooCommerce orders are linked to contacts but not billed here: WaDesk's Woo/Shopify mappers (raw payload, tax lines) are a
  separate port (WD-INV-009 to 012).
- The contact detail's Store orders tab (web) and the orders screen's "Create invoice" button call the services above; the endpoint for the
  tab exists (`GET /v2/contacts/:contactId/store-orders`), the tab itself is a web follow-up.

## Demo data (dev only)

`pnpm --filter @crm/api seed:store-demo -- [--org <slug|id>] [--storefront <uuid>] [--seed <n>]` fills one workspace with tagged demo data
(12 products in 3 categories, 5 coupons, 14 customers, 30 orders over 45 days with every status, both sources, paid/unpaid/COD/refunded
payments, tax, shipping and discount lines). Orders are written through `SqlOrdersGateway` (storefront) and the catalog cart's own row
shape (`waba`), then `StoreOrderSalesService.syncOrder` runs for each, so contacts, sales orders, receipts/invoices and ledger entries are
the real consumer's output. It publishes no order events (nothing is sent to demo buyers) and configures no gateway. Re-running adds only
what is missing; `--reset` deletes exactly what it made (orders by `meta_json.demo`, coupons by their five codes, products by tag and slug,
customers whose company starts with "Demo � ", contacts it created in the +91 90000 1xxxx block, and the invoices, sales orders and ledger
rows of the demo orders: the ledger is append-only by trigger, so reset and the date back-dating run on the owner connection with only
those guards switched off inside one transaction). `--fresh` is reset then seed, `--plan` prints the plan. Code:
`storefront-builder/cli/` (`demo-plan.ts` pure and seeded, `demo-seeder.ts`, `seed-store-demo.ts`); it builds with swc into `dist-cli`
(git-ignored) so a running dev server's `dist` is never touched.

## Customers list = every buyer, and the backfill (2026-10-05, second pass)

Decided with the owner after the first dev order (id 1) never showed in Customers: it predated the contact link, and a real buyer who
never saved an address was invisible.

**Customers list.** `GET /v2/store/customers` (`storefront-builder/admin/store-customers.*`) is the union of `wa_customer_profiles` and
the distinct buyers of `wa_orders`, FULL JOINed on a normalised phone (`common/sql/phone-key.ts`: `phoneKeySql` in SQL, `phoneKey` in
TypeScript, compared by `store-customers-union.e2e.spec.ts`). Rule = the one `canonicalizeLocalPhone` (contracts; the leads module's
rule moved there, leads still calls it): `+`/`00` is international; otherwise a number of 10 digits or fewer (after a trunk `0`) gets the
platform's default country code (Settings > General, "+91" until changed; read through `CONTACT_RESOLVER.defaultCountryCode()`), longer
numbers are taken to carry theirs; with no default country a bare local number stays as its digits and is never linked to a contact.
Row: `id` = profile uuid, else `phone:<digits>`; `name` = profile name, else the latest order's; `company`/`address` from the profile only;
`hasProfile`, `hasSavedAddress` (profile with a non-blank address); `orderCount` (all statuses), `lifetimeTotals` per currency without
cancelled orders; `lastOrderAt`; `contactId` = the profile's, else the latest linked order's. Sorted by last activity (latest order, else
the profile's last change) with an exact-microsecond keyset cursor. `q` searches name, company, phone in any form; `storefrontId` keeps
only buyers who ordered from that shop. Detail takes either id form; `PUT` on `phone:<digits>` creates the profile (WaDesk's
save-by-phone); `DELETE` on it is a 404 (nothing saved; orders are never deleted). `POST` (save by phone) now reaches an existing
profile of the same number in any form instead of adding a second. Cost: one aggregate over the workspace's orders per page (fine for
tens of thousands of orders; add an index on the normalised phone before going far beyond).

**Profile kept in step.** `ContactResolveInput.saveProfile` (resolver port): the four order writers above (checkout, WhatsApp catalog
cart, AI ordering flow, Shopify/WooCommerce mirror) and `syncOrder`'s catch-up pass it, so the buyer's profile (name, canonical phone
digits, delivery address, contact link) is created in the same transaction, also when the plan is out of contacts. An existing profile
only has EMPTY fields filled (and a missing contact link set); nothing is written when there is nothing to fill, so what a customer or the
merchant edited is never overwritten. The saved-customer form (`/waba/customers`) does not pass it. Demo seeder: untouched.

**Phone reading fix.** The resolver used to canonicalise a bare 10-digit number as if it carried its country ("7999834066" became
+7 999...). It now reads it in the default country (+91 7999834066), and reports `unusable_phone` when there is no default country.

**Backfill.** `pnpm --filter @crm/api backfill:store-orders -- [--org <slug|id>] [--dry-run]` (`store-orders-sales/cli/backfill-store-orders.ts`
over `StoreOrderBackfillService`; swc into `dist-cli` like `seed:store-demo`; refuses `NODE_ENV=production` without `--allow-production`).
For every `wa_orders` row with `contact_id IS NULL` (default: all workspaces): no phone or an unreadable phone is reported
(`no_phone`, `unusable_phone`, with the phone) and left alone; otherwise `syncOrder` links the contact (`findOrCreateByPhone`, source
"store"), creates the sales order and timeline entry, saves the missing profile and bills only when the workspace trigger is met (an unpaid
order under the default `on_paid` gets no invoice). A plan out of contacts is `plan_limit_reached` (the order still gets its sales order
and profile); an unexpected error is reported per order; nothing fails the batch. `--dry-run` runs the contact step in a rolled-back
transaction and predicts the rest. Repeatable: only still-unlinked orders are candidates, so a second run changes nothing.
