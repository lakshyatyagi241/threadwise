# Products and services add-on: step 1 (built)

Part of the plan in `crm-deal-estimate-invoice-products.md` (section 5.0, add-on packaging; that file is in PR 1214). Step 1 is the list only:
nothing else reads it yet. The names below are the real ones; the spec's working names (`catalog_items`) are replaced by them.

| Thing | Name |
| --- | --- |
| Table | `sales_items` (migration `2037_products_services_app.sql`; RLS forced; `kind` product/service; unique `lower(sku)` per org; `unit_price_minor`, `currency`, `tax_rate_percent`; nullable `wa_product_id` link to the store product, ON DELETE SET NULL) |
| Permissions | `record.sales-items.{read,create,update,delete}`, category `products`; Manager role gets read/create/update |
| Plan feature | `products_services`, default **off**; every existing plan row gets it `false` |
| Marketplace app | slug `products-services` (draft, paid monthly; operator sets price and publishes); scopes `sales-items.read/write` |
| API | `/v2/products-services` (list, create idempotent, get, patch with `rowVersion`, delete); whole controller `@RequirePlanFeature('products_services')`; duplicate SKU is `409 PRD_SKU_TAKEN` |
| Screen | `/products-services` (sales group in the sidebar, shown only with the permission and the app); en and ar messages; help article |

Not in step 1, by design: the picker on estimate and invoice lines, products on a deal, a `sales_item_id` on document lines, a dev seed, and the
operator's price for the listing. Those are steps 2 onward and keep working without this add-on, because lines stay free text.
