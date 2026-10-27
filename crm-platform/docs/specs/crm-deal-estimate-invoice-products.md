# Deals, estimates, invoices and products: UX fixes and the product-line analysis

Status: points 1 to 4 are built in this change; point 5 is an analysis and a proposal (**nothing for point 5 is built**, by design: the owner asked for the
analysis first). Method: Plan, Do, Check, Act (PDCA), nothing existing is removed or changed in behaviour except where a point says so.
**Nothing here was verified in a browser**: the checks are unit and component tests, `tsc` and `eslint` (section 6).

Related: [packaging-teams-and-smart-routing.md](packaging-teams-and-smart-routing.md) (how a plan feature is added),
[contact-owner-leave-and-delegation.md](contact-owner-leave-and-delegation.md).

## 0. The five points (the owner's words, summarised)

1. On a contact, "Add deal" opens the whole Deals page, so the person must pick the contact again. It should open in place, like Company and Task.
2. The deal's "Expected close date" accepts days that have gone. Is that meant?
3. Does an estimate turn into an invoice?
4. The invoice "Create" button should ask one-time or recurring, and recurring should be plan-gated (not in the basic plan).
5. Store products versus the CRM's product and service objects: are the object relationships kept, and can invoices be raised against products and services?

## 1. Plan

### 1.1 Point 1: Add deal from a contact

Finding. The contact page's Deals card had `action: { label: 'Add', href: '/deals' }` (`association-cards.tsx`). It only linked to the Deals page. The deal form
(`DealFormModal`) already existed and already had a contact picker, so nothing new had to be designed, only wired.

Decision. Open the same form where the person is, with the contact filled in and fixed, in the workspace's default pipeline (a pipeline choice appears only when
there are several). Do not duplicate the form: reuse `DealFormModal` through a small wrapper exported by the deals domain (`NewDealForContact`), because other
domains import deals only from its `index.ts`.

### 1.2 Point 2: expected close date in the past

Finding. The date input had no limit, and the server accepted any date. The board card already shows an "overdue" state (`dueState`), so a deal can legitimately be
past its date after it was created; what was wrong is only that a NEW date could be set in the past.

Rule decided (and why):

| Case                                          | Rule                                                         |
| --------------------------------------------- | ------------------------------------------------------------ |
| A deal is created by a person (screen or API) | the date is today or later                                   |
| A deal is made by a flow, an import or a sync | not asked (the source is not a person choosing a date)       |
| An open deal's date is changed                | the NEW date is today or later                               |
| An open deal keeps a date that has passed     | allowed: it stays "overdue" until moved forward, won or lost |
| A won or lost deal                            | any change allowed: the date is history                      |

The server allows one day of grace (`isPastCloseDate`), so a person ahead of UTC is not refused for choosing their own today. The form uses the browser's today
as the input's `min` and says why in a hint and an error.

### 1.3 Point 3: estimate to invoice

Finding. Yes, it exists and is safe: `POST /sales-docs/:id/convert/invoice` (permission `record.sales-docs.convert`) calls
`InvoiceConversionService.createDraftFromSalesDoc`. Facts that matter:

- Only an **accepted** document converts (`SALESDOC_INVALID_TRANSITION` otherwise); converting twice is `SALESDOC_ALREADY_CONVERTED`, and the conversion is
  idempotent per document (unique index on `invoices.quote_id`).
- It makes a **draft** invoice: invoicing keeps deciding the number, the seller block and the issue.
- The lines, the discount and the tax are carried over as fixed amounts and the result is re-priced and compared with the quote's totals; a difference refuses the
  conversion instead of writing an invoice that disagrees with what the buyer accepted.
- It runs in the caller's transaction: the invoice, the link on the document and the status commit together.
- Proposals and estimates are one engine (`kinds.ts`), so both convert.

Gap found (for point 5): the invoice lines made this way have `sku: null` because a quote line has no product reference. Nothing is lost today, but the line
cannot be tied to a product later. Not a bug; recorded in section 5.

No change was made for point 3.

### 1.4 Point 4: the Create menu and the plan gate

Finding. Invoices had a single "+ New invoice" link. Recurring invoices lived on their own screen (`/recurring-invoices`) and were gated only by the whole
`invoicing` plan feature, so a plan that sells one-time invoices could not exclude them.

Decisions:

1. **One "Create" menu** on the Invoices page: "Create one-time invoice" and "Create recurring invoices" (the pattern the owner showed).
2. **A plan feature of its own**, `recurring_invoices` (`requires: ['invoicing']`), following the packaging doc. **Default true**: recurring invoices were part of
   `invoicing` until now, so every plan row that predates the key keeps them ("a plan that predates a key keeps the area it had", as `waba_calling` and
   `sales_pipeline`). The owner switches it OFF on the basic plan in the plan editor. This is the one place this change differs from "new feature, default off":
   it is not a new feature, it is a new gate on an existing one, and default off would have removed recurring invoices from every existing paying workspace.
3. **Server**: the write routes of `RecurringInvoicesController` (create, update, pause and the other writes) now need `recurring_invoices`. Reads stay open, as
   for the rest of invoicing, so a downgraded workspace still sees and prints what it has.
4. **Screen**: on a plan without it the "Create recurring invoices" item is shown **switched off** with "Not in your plan" and a link to the plans page, instead of
   an item that opens a screen which then refuses. A person without the `record.recurring-invoices.create` permission does not see the item. The same applies to
   "Make recurring" on an invoice and to "New" on the Recurring screen.

### 1.5 Point 5: products, services, invoices

Findings (read from the schema and the code):

| Object                        | What exists                                                                                                                                                                                                                 | Link to a product                   |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Store product                 | `wa_products` (name, sku, description, `price_minor`, currency, status, stock and reserved stock, category, brand, Shopify and Woo ids). Belongs to the WhatsApp catalog and storefront domain; permission `cat.products.*` | is the only product object          |
| CRM product or service module | **none**. There is no product, service or price-list object in the CRM (`crm/` has deals, companies, contacts, invoicing, sales-docs, no products)                                                                          | none                                |
| Deal                          | `deals`: title, value, pipeline, stage, contact, company, owner, expected close date. **No line items**: the value is a typed number                                                                                        | none                                |
| Estimate or proposal line     | `sales_doc_items`: description, qty, unit price, discount, tax                                                                                                                                                              | none (free text)                    |
| Invoice line                  | `invoice_items`: description, `sku` (text), qty, unit price, discount, tax, HSN or SAC                                                                                                                                      | `sku` text only, **no foreign key** |
| Store order line              | `wa_order_items.product_id`                                                                                                                                                                                                 | yes, to `wa_products`               |
| Store order to invoice        | `ExternalOrderBilling` builds an invoice from a store order: description and sku copied                                                                                                                                     | by `sku` text                       |

Object relationships that ARE kept: invoice, estimate and deal each reference contact and company; an invoice references its deal (`deal_id`), its estimate
(`quote_id`), its recurring schedule and its sales order; a store order references the invoice it made (`wa_order_id`). These are enforced by composite foreign
keys on `(org_id, ...)`, so tenancy holds.

Object relationships that are NOT there, and are what the owner is asking about:

1. A **line item has no link to a product or service**. Raising an invoice "against a product" means typing the description and price again.
2. There is **no service object**. A service has no stock; today a person types it as a free line.
3. The store's product (`wa_products`) is not offered in the invoice or estimate line editor, and a deal has no products at all.

### 1.6 One screen or two: invoices and recurring schedules (owner question)

A recurring schedule is **not an invoice**: it is a rule (template, rhythm, next date, pause, run history) that MAKES invoices. The invoices it makes are ordinary
invoices (`invoices.recurring_id`, source `recurring`). So there are two lists, and each has a different job:

| What                                                                    | Where            | Why it stays                                                                          |
| ----------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------- |
| Invoices (every document: one-time, made by a schedule, store, Shopify) | Invoices list    | one list for money owed and paid; the invoice already names the schedule that made it |
| Recurring schedules (the rules)                                         | Recurring screen | pause, resume, next dates and run history have no place on an invoice list            |

How to tell them apart without a second entry point: the **Create** menu is the single door (it creates a document or a schedule); the Invoices list separates by
**origin** (a "Recurring" filter on `source=recurring`, with the schedule name shown on each such invoice); and the Recurring screen is reached from the Invoices page
as a tab or link ("Recurring schedules"), not as a separate menu entry. The menu entry for Recurring can then be removed from the sidebar once the owner agrees; this
change keeps it, so nothing moves without a decision. A plan without `recurring_invoices` still SEES its schedules and the invoices they made.

### 1.7 Do the relationships between the objects exist? (checked in the schema)

Yes, all of these are real foreign keys on `(org_id, id)`, so they also hold per tenant. Every one is `ON DELETE SET NULL`: deleting the parent clears the link
and keeps the child, because an invoice or an estimate is evidence and must outlive a deleted deal or contact.

| From                 | To                                                                                                  | Kept by                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Deal                 | contact, company, pipeline, stage, owner                                                            | `deals` columns                                                                                                        |
| Estimate or proposal | contact, company, deal                                                                              | `fk_sales_docs_contact_id`, `_company_id`, `_deal_id`                                                                  |
| Invoice              | contact, company, **deal**, **estimate** (`quote_id`), recurring schedule, sales order, store order | `fk_invoices_contact_id`, `_company_id`, `_deal_id`, `_quote_id`, plus `recurring_id`, `sales_order_id`, `wa_order_id` |
| Estimate to invoice  | the invoice carries `quote_id`; the estimate becomes `converted`                                    | one transaction, unique per estimate                                                                                   |
| Store order          | the invoice it made                                                                                 | `invoices.wa_order_id`                                                                                                 |

They are also shown where the person works: the deal drawer lists its invoices and its estimates, the contact page lists its deals and documents.

NOT related today: any document line to a product or service (section 1.5); a deal to its lines. Not checked in this pass: whether an invoice started from a deal
copies that deal's contact and company by itself (read the builder before relying on it).

## 2. Do (what this change builds)

| Point | Built                                                                                                                                                                       |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `NewDealForContact` (deals domain), the contact Deals card opens it, refreshes the card, shows a toast; `DealFormModal` takes `lockedContact` and an optional pipeline list |
| 2     | `isPastCloseDate` on the server (create by a person, change on an open deal) and in the form; `min` on both date inputs; messages in English and Arabic                     |
| 3     | nothing (analysis only)                                                                                                                                                     |
| 4     | `recurring_invoices` plan feature (catalogue, labels, the operator plan form), the server gate, the `CreateInvoiceMenu`, the switched-off items                             |
| 5     | nothing (analysis and proposal only)                                                                                                                                        |

## 3. Check

Automated (all pass): the close-date rule (server and form), the new-deal-for-contact component (contact fixed, pipeline choice, no pipeline, date `min`), the
Create menu (plan with and without the feature, permission), the plan-feature route table (`recurring_invoices` on the recurring writes), the entitlement key list.

Manual checks the owner should do before relying on it (not done here):

1. Open a contact, Deals card, "Add": the form appears over the contact page, the contact is filled and cannot be changed, the new deal appears in the card.
2. Try to save a new deal with yesterday as the expected close date: refused with the message. Open an old overdue deal: it opens, still overdue, other fields save.
3. Invoices, "Create": both items. In the plan editor switch `Recurring invoices` off for a plan, reload as that workspace: the recurring item is off with the reason;
   a direct call to `POST /recurring-invoices` answers 422 `PLAN_FEATURE_LOCKED`; the existing schedules still list and print.

## 4. Act (what to do next)

- Owner: switch `recurring_invoices` off on the basic plan (and on any plan that should not have it).
- Decide point 5 (section 5).

## 5. Proposal for point 5 (not built): products and services on documents

### 5.0 Packaging decided with the owner: an add-on, plan-gated

"Products and Services" is an object for the people who need it, so it is sold the way the existing add-ons are, not switched on for everyone:

- A first-party **mini app** (recipe of Appointments and Forms in [addons-plan-offers.md](addons-plan-offers.md) and [forms-builder-app.md](forms-builder-app.md)): app slug
  `products`, plan feature `catalog_items` (default **off**: it is new), `grants_plan_features` on the listing, the menu entry behind `gates.app`, permissions
  `record.catalog-items.*` with `permission_defs.plan_feature`.
- The plan editor then shows it as **Included**, **Paid** or **Hidden** per plan (the existing offers matrix); on Included the plan carries the feature and every gate follows.
- A workspace without it keeps today's behaviour exactly: free-text lines, no product picker, no new menu entry. With it: the catalog screen, the picker on
  invoice, estimate, recurring and deal lines, and the report.
- Turning it off later keeps the catalog and the links (settings are kept, as for other add-ons); documents already made are unchanged.

Principle: **additive and optional**, so nothing that exists changes behaviour. A line may point at a product; it never has to.

### 5.1 The model

1. One catalog object for both products and services. The existing `wa_products` is the store's and carries store concerns (stock, Meta sync, slug), so do not
   overload it: add a CRM-side `catalog_items` table (kind `product` or `service`, name, sku, description, unit, default unit price and currency, default tax rate,
   active flag, `wa_product_id` nullable link to the store product). A store product can be **imported** as a catalog item and the two kept in step by `sku`.
2. `invoice_items.catalog_item_id`, `sales_doc_items.catalog_item_id`, `recurring` template lines and later `deal_items.catalog_item_id`: all **nullable** foreign
   keys on `(org_id, catalog_item_id)`. The existing `sku` text stays as the printed value.
3. A line **copies** description, unit price and tax from the item when it is picked and is then its own (the document must not change when the price list does).
   The link is kept for reporting (sales by product) and for stock.
4. Stock: a `product` item that is linked to a store product reduces the store's `reserved_qty` through the existing reservation path; a `service` never touches stock.

### 5.2 The screens

- The line editor of the invoice, the estimate, the recurring template and the deal gets a "Pick a product or service" search above the free text. Free text stays.
- A "Products and services" list and form under Sales (permission `record.catalog-items.*`).
- A deal gets a products section whose total can fill the deal value.

### 5.3 Rollout (PDCA)

- Plan: confirm the model with the owner (one table or reuse of `wa_products`), the plan feature (`catalog_items`, default off as it is new), the permission keys.
- Do, in three small steps, each shippable alone: (1) the table, the CRUD and the permission; (2) the picker on invoice and estimate lines, copy-on-pick;
  (3) the deal products and the report.
- Check: the totals of an invoice made by picking equal one typed by hand; the conversion estimate to invoice carries the link; the store order to invoice
  keeps matching by sku; a migration test shows existing documents unchanged.
- Act: sales-by-product report, stock hooks, bulk import of the price list.

### 5.4 Risks and what keeps them from breaking anything

| Risk                                      | Control                                                                                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Price list edits rewrite old invoices     | lines copy values on pick; the link is reference only                                                                   |
| Two product objects drift (store and CRM) | one-way import by sku, the link is explicit, no automatic two-way write                                                 |
| Tax and currency                          | the item holds a default currency; a line on a document of another currency is priced by hand, never converted silently |
| A required field blocks the current flow  | every new column is nullable; free-text lines keep working                                                              |
| Plan and permission                       | its own plan feature (default off) and permission keys, added through the same packaging path as `recurring_invoices`   |

## 6. Verification record

`tsc` (api, web), `eslint` and `prettier` on the touched files, `vitest` for the deals, contacts, invoicing and plans folders. See the pull request for the run.
