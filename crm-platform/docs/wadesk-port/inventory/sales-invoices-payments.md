---
domain: sales-invoices-payments
code: INV
secondary_code: PAY
title: Sales invoices and customer payments
wadesk_version: '1.7.0'
sources_read: 78
---

# Sales invoices and customer payments

## Overview

This domain is the **workspace-to-customer money layer** of WaDesk: the invoices a workspace issues to its
own buyers and the payments it collects from them. It is **not** the platform's own subscription billing
(plans, wallet top-ups, admin invoices, `payment/webhook/{gateway}`); that is documented only as a contrast
in WD-PAY-016 and belongs to the platform billing domains.

**What WaDesk actually built is narrower than the owner's reference menu.** Read this before planning:

| Reference-menu item | In WaDesk 1.7.0? | Evidence / note |
| --- | --- | --- |
| Invoices | Yes, but it is an **auto-invoice (store receipt)** engine, not a classic AR invoice | `InvoicesController`, `InvoiceService`. Issued documents are frozen, numbered, PDF'd and sent over **WhatsApp only**. No draft stage, no edit, no void, no due-date behaviour. |
| Payments | Yes, as a **manual/auto payment ledger**, plus a separate **customer-order gateway checkout** | `PaymentsController`, `PaymentLedger`, `CustomerPaymentService`. A customer cannot pay an *invoice* online; gateways pay *WaOrders* (store orders). |
| Recurring invoices | **No** | No model, table, route, command or schedule. (Recurring exists only for platform subscriptions: `SubscriptionService`.) |
| Credit notes | **No** (name only) | `doc_type=credit_note` and `status=credited` exist as strings in comments/PDF title match; no code path creates, reads or issues one. |
| Tax rates (tax-rate table) | **No** | Only free-form per-line `tax_rate` on a manual invoice, one `default_tax_rate` + `tax_label` in `invoice_settings` (display only), and tax lines copied from Woo/Shopify payloads. No tax-rate CRUD screen or table. |
| Sales Orders | **No separate object** | The closest thing is `wa_orders` (store orders, owned by the checkout/orders domain). Proposals and Estimates exist (`sales_docs`, owned by the sales-docs domain) and convert into invoices. |
| Estimates / proposals | Yes (other domain) | `SalesDocsController::convert` calls the invoice engine; contract in WD-INV-027. |
| Reminders / overdue sweep | **No** | `due_at`/`due_days` are stored or accepted but never set, read for status, or reminded on. |
| Email invoices | **No** | `buyer_email` is stored; there is no invoice mail class. Delivery is WhatsApp only. |

Actors: workspace **admin** (role `workspace.role:admin`, owners and platform admins pass); the buyer (token-only
public pages); gateways and Meta (webhooks); the platform plan system (`auto_invoice` feature).

Main flows end to end:

1. **Auto path.** A store order (own store / WhatsApp Pay / Woo / Shopify) becomes paid or completed. A listener,
   a heartbeat sweeper or a webhook handler calls `InvoiceService::issue()`, which allocates a number from a
   per-workspace per-series counter, snapshots the seller, and writes a frozen `invoices` row plus items and a
   tax summary. The sweeper (or the generate button) later renders a PDF, stores it, and sends it on WhatsApp
   (WABA template with a button to `/i/{token}`, or Baileys document). The buyer opens `/i/{token}`, a read-only page with a
   PDF link.
2. **Manual path.** An admin builds a free-form invoice (items, qty, price, per-line tax %, discount, shipping,
   optional CRM links). Same engine, `source=manual`.
3. **Money-in path.** A `payments` row is created either manually (Record payment) or automatically when a
   customer pays a store order through a merchant gateway (`WaOrderPaid` event). When summed payments reach the
   invoice total the invoice flips `issued -> paid`.
4. **Customer gateway path.** The merchant stores per-workspace gateway keys (32 drivers); the admin sends the
   customer a hosted checkout link for an order; the gateway calls a per-gateway webhook and/or redirects the
   customer to a return page; either confirms server-side and marks the order paid.

Plan tiers: everything under `/invoices` and `/payments` is gated by plan feature `auto_invoice`
(plus an unenforced `auto_invoice_max_monthly`). The gateway settings page, send-checkout and payment-link
actions are **not** plan-gated (admin role only).

Connections: **checkout-orders-merchant-payments** (`wa_orders`, `wa_merchant_gateways`, order status),
**sales-docs-proposals** (convert), **crm / deals / companies / contacts** (links and revenue rollups),
**shopify-woocommerce** (webhook sources), **whatsapp-cloud-api-waba** + **whatsapp-devices-baileys** (delivery),
**message-templates** (invoice template), **plans-subscriptions-trials** (`auto_invoice` gate), **ai-copilot-lead-finder**
(`create_invoice`, `record_payment` tools), **platform-payment-gateways** (driver classes are shared with platform billing).

## Feature index

| Id | Feature | Status | Priority | Effort | Depends on |
| --- | --- | --- | --- | --- | --- |
| WD-INV-001 | Invoice list screen | implemented | P0 | M | WD-INV-007 |
| WD-INV-002 | Invoices tab inside the store dashboard | implemented | P2 | S | WD-INV-001 |
| WD-INV-003 | Invoice detail screen | implemented | P0 | S | WD-INV-007 |
| WD-INV-004 | Generate invoice from a store order | implemented | P0 | S | WD-INV-007, WD-INV-009 |
| WD-INV-005 | Manual invoice builder form | implemented | P0 | M | WD-INV-006 |
| WD-INV-006 | Create manual invoice | implemented | P0 | M | WD-INV-007, WD-INV-013 |
| WD-INV-007 | Invoice issue engine (gate, idempotency, persist) | implemented | P0 | M | WD-INV-008, WD-INV-024 |
| WD-INV-008 | Invoice numbering and series | implemented | P0 | S | - |
| WD-INV-009 | Own-store order to invoice mapping | implemented | P0 | M | WD-INV-013 |
| WD-INV-010 | WooCommerce order to invoice mapping | implemented | P1 | M | WD-INV-013 |
| WD-INV-011 | Shopify order to invoice mapping | implemented | P1 | M | WD-INV-013 |
| WD-INV-012 | Auto-issue triggers on paid orders | implemented | P0 | M | WD-INV-007, WD-PAY-011 |
| WD-INV-013 | Money model: minor units, exponent, display | implemented | P0 | M | - |
| WD-INV-014 | PDF rendering, freezing and storage | implemented | P0 | M | WD-INV-007 |
| WD-INV-015 | Merchant PDF download | implemented | P0 | S | WD-INV-014 |
| WD-INV-016 | Public invoice page | implemented | P0 | S | WD-INV-007 |
| WD-INV-017 | Public invoice PDF | implemented | P0 | S | WD-INV-014 |
| WD-INV-018 | WhatsApp delivery of an invoice | implemented | P0 | L | WD-INV-014, WD-INV-023 |
| WD-INV-019 | Resend invoice | implemented | P1 | S | WD-INV-018 |
| WD-INV-020 | Delivery sweeper and retries | implemented | P1 | M | WD-INV-018 |
| WD-INV-021 | Invoice settings screen | implemented | P0 | M | WD-INV-022 |
| WD-INV-022 | Save invoice settings | implemented | P0 | M | - |
| WD-INV-023 | WhatsApp invoice template provisioning | partial | P1 | M | WD-INV-022 |
| WD-INV-024 | Plan gate, role gate, quota, trial interplay | partial | P0 | S | - |
| WD-INV-025 | Invoice status model and transitions | partial | P0 | S | WD-PAY-003 |
| WD-INV-026 | Document types (tax invoice, receipt, proforma, credit note) | partial | P1 | S | WD-INV-007 |
| WD-INV-027 | Convert proposal or estimate to invoice | implemented | P1 | S | WD-INV-007 |
| WD-INV-028 | CRM links and revenue read side | partial | P1 | M | WD-INV-006 |
| WD-INV-029 | AI copilot invoice and payment tools | implemented | P2 | S | WD-INV-007, WD-PAY-003 |
| WD-INV-030 | Due date, overdue and payment terms | dead-code | P1 | M | WD-INV-007 |
| WD-INV-031 | Void, credit note, activity log, viewed tracking | dead-code | P1 | M | WD-INV-007 |
| WD-PAY-001 | Payments ledger screen | implemented | P0 | M | WD-PAY-003 |
| WD-PAY-002 | Record payment | implemented | P0 | S | WD-PAY-003 |
| WD-PAY-003 | Payment ledger engine | implemented | P0 | M | WD-INV-007 |
| WD-PAY-004 | Outstanding balance and aging report | implemented | P1 | S | WD-PAY-003 |
| WD-PAY-005 | Auto-record payment on order paid | implemented | P0 | S | WD-PAY-003, WD-PAY-011 |
| WD-PAY-006 | Merchant gateway keys | implemented | P0 | M | WD-PAY-007 |
| WD-PAY-007 | Gateway driver catalog and contract | implemented | P0 | XL | - |
| WD-PAY-008 | Send hosted checkout link for an order | implemented | P0 | M | WD-PAY-006, WD-PAY-007 |
| WD-PAY-009 | Customer payment webhook | implemented | P0 | M | WD-PAY-008 |
| WD-PAY-010 | Customer return-page confirmation | implemented | P0 | S | WD-PAY-008 |
| WD-PAY-011 | Mark order paid, WaOrderPaid consumers, receipt | implemented | P0 | S | - |
| WD-PAY-012 | Manual payment link on an order | implemented | P2 | S | - |
| WD-PAY-013 | Razorpay payment-link minting and storefront webhook | implemented | P2 | M | WD-PAY-011 |
| WD-PAY-014 | WhatsApp Pay settle path | implemented | P2 | M | WD-PAY-011 |
| WD-PAY-015 | Online invoice payment, refunds, receipts | docs-only | P1 | L | WD-PAY-003 |
| WD-PAY-016 | Platform subscription gateway callbacks (contrast) | implemented | P2 | S | WD-PAY-007 |
| WD-PAY-017 | Ledger CSV and revenue report reads | implemented | P2 | S | WD-PAY-003 |

## Features

### WD-INV-001 — Invoice list screen

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-INV-007
- **Summary:** The admin sees the latest 100 invoices of the workspace, a "paid orders without an invoice" strip with one-click generate buttons, and a setup checklist that lists what is still missing for auto-send.
- **Actors & access:** workspace admin or owner (platform admins bypass). Plan feature `auto_invoice`. Scope is the user's `current_workspace_id`.
- **UX & screens:** `resources/views/user/invoices/index.blade.php`. Header: source label ("WhatsApp Store", "WooCommerce", "Shopify" or "All stores"), title "Auto invoices", buttons "+ New invoice" (to create) and "Settings". Flash banners for `success` and `error`. Checklist card (shown only when any item fails) with five rows: Invoices enabled, Company name and tax number set (really: `seller_name` filled), WhatsApp sender connected (`send_sender` filled), Meta template approved (WABA) or Delivery ready (Baileys), Auto-send on for this store; each failing row shows a hint and the card has "Open settings". Strip "Paid orders without an invoice" with one POST button per order ("Generate for #id · total"). Table columns: Number (link to detail), Customer (or dash), Type (doc_type with underscores spaced), Total (formatted), Delivery (send_status pill with `send_reason` as tooltip), PDF link (new tab). Empty state: "No invoices yet. Generate one from a paid order above, or turn on auto-send in Settings." Right column "How it works" 4 steps and a "Good to know" box. No search, no pagination, no status filter, no date filter, no payment-status column.
- **Endpoints:**

  | Method uri | Route name | Action | Middleware | Request | Response |
  | --- | --- | --- | --- | --- | --- |
  | GET `invoices` | `user.invoices.index` | `InvoicesController@index` | web, auth, workspace.role:admin, plan:auto_invoice | optional `source` in `own`, `woocommerce`, `shopify` (anything else ignored) | HTML view |

- **Data:** reads `invoices` (latest 100 by id desc), `wa_orders` (status in paid/completed with no linked invoice, optional source narrowing, max 25 by id desc), `invoice_settings` (created on first read).
- **Rules & edge cases:**
  1. `source=own` shows invoices whose `source` is `own` or `manual`; `woocommerce`/`shopify` filter by exact source; no `source` shows all.
  2. For the orders strip, `source=own` narrows orders to order sources `own, storefront, waba, twilio, whatsapp_ai, manual`; Woo/Shopify narrow to that source; none = all. (Order `source` values come from `wa_orders.source`; note `own` is not an order source, so for own-store the effective set is the other five.)
  3. The orders strip hides orders that already have any invoice (`hasOne latestOfMany`), so a proforma already issued hides the order even if no tax invoice exists.
  4. The "Auto-send is on for this store" check reads `auto_send_own` unless a source tab is chosen (`auto_send_<source>`).
  5. QUIRK: the `plan:auto_invoice` gate does not block this GET. On a plan without the feature the page renders normally with a paywall overlay; only non-GET calls are blocked (see WD-INV-024).
  6. QUIRK: "Invoices enabled" is only a checklist row. `invoice_settings.enabled` is read nowhere else (WD-INV-022).
- **Async & events:** none (read-only). The page does not trigger the sweeper.
- **External systems:** none.
- **Settings:** `invoice_settings` row (WD-INV-021).
- **Acceptance criteria:**
  - Given a workspace with 120 invoices, When the admin opens `/invoices`, Then exactly the 100 newest are listed, newest first.
  - Given `?source=woocommerce`, When the page loads, Then only Woo-sourced invoices appear and the checklist's auto-send row reflects `auto_send_woocommerce`.
  - Given a paid own-store order with no invoice, When the page loads, Then a "Generate for #id" button appears; Given the order has an invoice, Then no button appears.
  - Given `settings.enabled=false` and no sender, When the page loads, Then the checklist card is visible listing the failing rows with hints.
  - Given a user with agent role, When opening `/invoices`, Then they are redirected to `/team-inbox` with a warning (role gate).
- **Source refs:** `app/Http/Controllers/InvoicesController.php` (index), `resources/views/user/invoices/index.blade.php`, `routes/web.php` (invoices group near `plan:auto_invoice`), `app/Http/Middleware/EnforcePlanFeature.php`, `app/Http/Middleware/EnsureWorkspaceRole.php`.
- **Port notes:** target already has `packages/db/src/schema/invoicing`. Build list as a cursor-paginated API (`GET /invoices`) with status, payment-status, date and search filters; WaDesk's 100-row cap is a limitation, not a contract. Keep the setup checklist as a computed `GET /invoices/setup-status`.

### WD-INV-002 — Invoices tab inside the store dashboard

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-INV-001
- **Summary:** The same list, detail and settings experience embedded in the store dashboard (`/store/invoices`) so the merchant never leaves the store sidebar.
- **Actors & access:** workspace admin; `workspace.role:admin` (store prefix) plus `plan:auto_invoice`.
- **UX & screens:** `resources/views/user/store/invoices.blade.php` wraps `resources/views/user/invoices/_panel.blade.php` with `panelSource = own`. The panel switches sub-views on the query string `iv`: `iv=settings` renders the settings form, `iv=<numeric id>` renders the invoice detail partial (only if the invoice belongs to the workspace, otherwise falls back to the list), absent `iv` renders a list capped at 50 and an orders strip capped at 20 plus a 5-row checklist (without hints) and a "How it works" note. Links keep the current URL via query merge. The panel's list uses `source in (own, manual)`.
- **Endpoints:**

  | Method uri | Route name | Action | Middleware | Request | Response |
  | --- | --- | --- | --- | --- | --- |
  | GET `store/invoices` | `user.store.invoices` | closure to view `user.store.invoices` | web, auth, workspace.role:admin, plan:auto_invoice | optional `iv` | HTML |

- **Data:** same as WD-INV-001; the panel runs its own queries inside the Blade partial (no controller).
- **Rules & edge cases:** 1. Panel list limit 50, orders 20 (list page: 100 / 25). 2. The "Open settings" link in the checklist goes to the standalone settings page, not `iv=settings`. 3. Generate buttons POST to `invoices` (WD-INV-004) and return to the same URL via `back()`.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given `/store/invoices?iv=17` and invoice 17 belongs to another workspace, When loaded, Then the panel shows the list (not the foreign invoice).
  - Given `/store/invoices?iv=settings`, When loaded, Then the settings form is rendered inline with a "Back to invoices" link.
  - Given generating from the panel, When it succeeds, Then the admin stays on `/store/invoices` with a success flash.
- **Source refs:** `routes/web.php` (store prefix, `invoices` closure), `resources/views/user/store/invoices.blade.php`, `resources/views/user/invoices/_panel.blade.php`, `_detail.blade.php`, `_settings_form.blade.php`.
- **Port notes:** do not port the Blade-embedded query pattern; in Next.js make it a tab route that reuses the same list/detail/settings components. Fold into WD-INV-001 if the store sidebar is not ported.

### WD-INV-003 — Invoice detail screen

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-INV-007
- **Summary:** Shows one invoice with customer, an items table, the total and three actions: download PDF, open the public link, send on WhatsApp.
- **Actors & access:** workspace admin; plan gate as WD-INV-001; invoice must belong to the current workspace (else 404).
- **UX & screens:** `resources/views/user/invoices/show.blade.php` plus `_detail.blade.php`. Header: doc type label and number; right: total. Card: customer name, phone and email, send-status pill (tooltip `send_reason`), items table (Item, Qty, Amount = line subtotal, ex-tax), buttons "Download PDF" (new tab), "Public link", "Send on WhatsApp" (POST resend). If `send_status=send_failed` and a reason exists, a red line "Delivery issue: <reason with underscores spaced>". It does **not** show subtotal, discount, shipping, tax, status (issued/paid), paid amount, balance, payments, due date, seller, notes or meta. Flash banners for success/error.
- **Endpoints:**

  | Method uri | Route name | Action | Middleware | Request | Response |
  | --- | --- | --- | --- | --- | --- |
  | GET `invoices/{id}` | `user.invoices.show` | `InvoicesController@show` | web, auth, admin role, plan:auto_invoice; `id` numeric | none | HTML; 404 if missing/foreign |

- **Data:** `invoices` with `items`, `taxSummary`, `order` eager loaded; `Invoice::forWorkspace`.
- **Rules & edge cases:** 1. Quantity is shown trimmed (`2.000` becomes `2`). 2. The detail has no payment history or "Record payment" button; the ledger lives on `/payments`. 3. QUIRK: money in the detail is rendered through the /100 display helper (WD-INV-013).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given invoice 5 in workspace A, When an admin of workspace B opens `/invoices/5`, Then 404.
  - Given a failed send with reason `no_recipient_phone`, When opened, Then "Delivery issue: no recipient phone" is shown.
  - Given an invoice with three items, When opened, Then items appear in `sort` order.
- **Source refs:** `InvoicesController@show`, `resources/views/user/invoices/show.blade.php`, `_detail.blade.php`, `app/Models/Invoice.php`.
- **Port notes:** the new detail should add totals breakdown, status badge, payments list, balance, activity timeline and a Record payment dialog; those are gaps, not WaDesk behaviour.

### WD-INV-004 — Generate invoice from a store order

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-INV-007, WD-INV-009
- **Summary:** One click turns a store order into a numbered invoice, renders the PDF immediately, and (if a WhatsApp sender is configured) sends it.
- **Actors & access:** workspace admin; plan gate.
- **UX & screens:** buttons in the orders strip of WD-INV-001/002. Result is `back()` with flash "Invoice INV-... generated." or error "Auto-invoice is not enabled on your plan." (when the engine soft-skips).
- **Endpoints:**

  | Method uri | Route name | Action | Middleware | Request | Response |
  | --- | --- | --- | --- | --- | --- |
  | POST `invoices` | `user.invoices.store` | `InvoicesController@store` | web, auth, admin role, plan:auto_invoice (non-GET: blocked with warning flash when the plan lacks the feature) | `wa_order_id` required integer | redirect back with flash; 404 if the order is not in the workspace; 302 with validation error if missing |

- **Data:** reads `wa_orders` scoped to workspace; writes via WD-INV-007 (`invoices`, `invoice_items`, `invoice_tax_summary`, `invoice_number_sequences`); then WD-INV-014/018.
- **Rules & edge cases:**
  1. Draft is built with trigger `manual` from the order (WD-INV-009).
  2. QUIRK: no check that the order is paid or that it already has an invoice. The UI only offers paid/completed orders without an invoice, but the POST accepts any order id of the workspace. Because own-store drafts have no `external_order_id`, the idempotency key does not apply and a second POST (double click, replay) creates a **second invoice with a new number** for the same order.
  3. QUIRK: for any order, own-store drafts set `paidAt = order.updated_at`, so the invoice is created already `paid` even if the order is `new` or `cancelled`.
  4. Rendering and WhatsApp send run synchronously inside the request. A render or send failure does not fail the request; the flash still says generated, and the failure shows only in the Delivery column.
  5. If the workspace id is 0 (no workspace) the controller dereferences a null workspace (500).
- **Async & events:** none queued; PDF and send are inline (WD-INV-014, WD-INV-018).
- **External systems:** WhatsApp (WD-INV-018).
- **Settings:** `invoice_settings` (series prefix, sender).
- **Acceptance criteria:**
  - Given a paid own-store order and plan `auto_invoice`, When the admin clicks Generate, Then an invoice with the next series number exists with status `paid`, a PDF is stored, and the order disappears from the strip.
  - Given the plan lacks `auto_invoice`, When POSTing, Then no invoice is created and a warning flash explains the plan.
  - Given a double POST for the same order within a second, Then (WaDesk) two invoices exist; the port should return the existing one (WD differences D-05).
  - Given `wa_order_id` of another workspace, Then 404.
- **Source refs:** `InvoicesController@store`, `InvoiceService::issue/manualDraftFromOrder`, `OwnStoreInvoiceMapper`.
- **Port notes:** make idempotent on `(workspace, wa_order_id, doc_type)`; require order paid or an explicit "proforma" intent.

### WD-INV-005 — Manual invoice builder form

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-INV-006
- **Summary:** A form to build an invoice with no order: buyer, document type, currency, line items with live totals, discount, shipping, an internal note and optional CRM links.
- **Actors & access:** workspace admin; plan gate.
- **UX & screens:** `resources/views/user/invoices/create.blade.php`, behaviour in `resources/js/charts/invoices-create.js`. Sections: Bill to (Customer name required max 191, Email, Phone max 40), Document type (Tax invoice default, Receipt, Proforma), Currency (3-letter input, uppercased on typing, default `$settings->currency` which does not exist so it is always "USD"), Items table (Description, Qty default 1 step 0.001, Unit price default 0, Tax % default 0 max 100, live Amount) with "+ Add item" and per-row remove (the last row is cleared, not removed), Adjustments (Discount, Shipping, Internal note), Summary (Subtotal, Tax, Discount, Shipping, Total, all shown to 2 decimals regardless of currency), Link to CRM (selects for Contact, Company, Deal, each limited to the 500 newest, "none" default), Cancel and "Create invoice". One starter row is injected on load; submit with zero rows re-adds a row. Validation errors list at the top.
- **Endpoints:**

  | Method uri | Route name | Action | Middleware | Request | Response |
  | --- | --- | --- | --- | --- | --- |
  | GET `invoices/create` | `user.invoices.create` | `InvoicesController@createManual` | web, auth, admin role, plan:auto_invoice | none | HTML |

- **Data:** reads `contacts` (id, name; newest 500), `companies` (id, name; newest 500; only if the model class exists), `deals` (id, title; newest 500), `invoice_settings`.
- **Rules & edge cases:**
  1. Client-side math: line = qty x price; tax = line x rate/100 (exclusive); total = max(0, subtotal - discount + shipping + tax). Server recomputes (WD-INV-006).
  2. QUIRK: the lists are capped at 500 with no search, so a workspace with more than 500 contacts cannot link older ones.
  3. QUIRK: there is no tax-inclusive toggle, no per-line discount, no due date, no payment terms, no buyer address and no notes shown to the customer (the "Internal note" is stored in `meta_json.note` and is not printed anywhere).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** default currency (intended: workspace/invoice setting; actual: always USD, WD-INV-013).
- **Acceptance criteria:**
  - Given the page loads, Then exactly one blank item row exists and totals read 0.00.
  - Given qty 2, price 10, tax 18, discount 5, shipping 3, Then Subtotal 20.00, Tax 3.60, Total 21.60 on screen.
  - Given the admin removes the only row, Then the row is cleared rather than deleted.
- **Source refs:** `InvoicesController@createManual`, `resources/views/user/invoices/create.blade.php`, `resources/js/charts/invoices-create.js`.
- **Port notes:** use contact/company/deal async pickers, not a 500 cap. Server must be the source of truth for totals.

### WD-INV-006 — Create manual invoice

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-INV-007, WD-INV-013
- **Summary:** Validates the builder, computes totals in minor units, issues the invoice through the same engine, renders the PDF and optionally sends it, then opens the invoice detail.
- **Actors & access:** workspace admin; plan gate.
- **UX & screens:** redirect to `user.invoices.show` with flash "Invoice INV-... created." On engine soft-skip: back with input and error "Invoicing is not enabled on your plan."
- **Endpoints:**

  | Method uri | Route name | Action | Middleware | Request | Response |
  | --- | --- | --- | --- | --- | --- |
  | POST `invoices/manual` | `user.invoices.manual` | `InvoicesController@storeManual` | web, auth, admin role, plan:auto_invoice | see rules | 302 to `invoices/{id}`; 302 back with errors on validation |

- **Data:** writes as WD-INV-007; `source=manual`, `trigger=manual`, `wa_order_id=null`, `external_order_id=null`, `status=issued`, `paid_at=null`, `due_at=null`, `meta_json` holds `note`, `contact_id`, `company_id`, `deal_id` (only those provided).
- **Rules & edge cases:**
  1. Validation: `buyer_name` required string max 191; `buyer_email` nullable email max 191; `buyer_phone` nullable string max 40; `doc_type` nullable in `tax_invoice, receipt, proforma` (default `tax_invoice`; `credit_note` is rejected); `currency` nullable string size 3; `discount` and `shipping` nullable numeric min 0; `note` nullable max 2000; `items` required array min 1 max 100; `items.*.description` required max 500; `items.*.qty` required numeric min 0.001 max 100000; `items.*.unit_price` required numeric min 0 max 100000000; `items.*.tax_rate` nullable numeric 0..100; `contact_id`, `company_id`, `deal_id` nullable integer (not checked against the workspace).
  2. Currency: uppercase of input, else `invoice_settings.currency` (non-existent column, so null) then `USD`. Exponent from a local zero-decimal list (JPY, KRW, VND, IDR, CLP, ISK, HUF, XAF, XOF, PYG, RWF, UGX, KMF) else 2 (no 3-decimal currencies).
  3. Math: unit price minor = round(price x 10^exp); line subtotal = round(unit minor x qty); line tax = round(line subtotal x rate/100); subtotal = sum of lines; tax = sum of line taxes; discount minor and shipping minor = round(value x 10^exp); total = max(0, subtotal - discount + shipping + tax). Rounding is PHP `round` (half away from zero) per line, not on the sum. Tax is always exclusive; `tax_inclusive` is false.
  4. Tax summary: one row per distinct rate > 0, labelled "Tax <rate>%" (trailing zeros trimmed), base = sum of line subtotals at that rate, amount = sum of line taxes. A rate of 0 produces no summary row.
  5. QUIRK: discount is not allocated to lines and does not reduce tax. Tax is charged on the undiscounted subtotal. A discount larger than the subtotal is clamped by total >= 0 but `discount_minor` stores the over-large figure.
  6. QUIRK: `items.*.description` allows 500 chars but the column is 255; `buyer_phone` allows 40 but the column is 32. With strict SQL mode a longer value throws after the number was allocated (a number gap, WD-INV-008) and the user sees a 500.
  7. `doc_type` is chosen by the user, independent of tax: a `tax_invoice` with all rates 0 prints no tax lines; a `receipt`/`proforma` with tax > 0 hides the tax rows on the PDF while still adding tax to the total (WD-INV-014).
  8. Sets no per-line `sku`, `hsn_sac` or `tax_code`.
  9. Rendering and optional WhatsApp send happen inline (WD-INV-014, WD-INV-018). With a configured sender but no `buyer_phone` the send fails with `no_recipient_phone` and the invoice sits at `send_failed` (retried by the sweeper up to 5 attempts within 24 hours); there is no email fallback.
- **Async & events:** none queued.
- **External systems:** WhatsApp.
- **Settings:** `invoice_settings` numbering, sender.
- **Acceptance criteria:**
  - Given one item qty 3, unit 19.99 USD, tax 10, discount 5, shipping 2.50, Then subtotal 5997, tax 600, discount 500, shipping 250, total 6347 (minor units).
  - Given currency `jpy`, price 1500, qty 1, tax 10, Then currency `JPY`, exponent 0, unit 1500, tax 150, total 1650.
  - Given 101 items, Then validation error and nothing is created.
  - Given `doc_type=credit_note`, Then validation error.
  - Given currency `KWD`, Then exponent 2 (WaDesk) although KWD has 3 decimals (D-04).
  - Given the plan lacks the feature, Then the POST is blocked with a warning flash before the controller.
- **Source refs:** `InvoicesController@storeManual`, `currencyExponent`, `InvoiceDraft`, `InvoiceService`.
- **Port notes:** share one money library with the other mappers; apply the ISO-4217 exponent table; validate field lengths against the real column sizes; verify linked contact/company/deal belong to the tenant (RLS plus FK).

### WD-INV-007 — Invoice issue engine (gate, idempotency, persist)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-INV-008, WD-INV-024
- **Summary:** The single entry point that every invoice source goes through: soft plan gate, quota flag, idempotency, number allocation, seller snapshot and a frozen insert. It never renders or sends.
- **Actors & access:** internal service; runs inside web requests, webhooks, the heartbeat sweeper and the AI copilot.
- **UX & screens:** none.
- **Endpoints:** none (service `InvoiceService::issue(InvoiceDraft, Workspace, ?userId)`).
- **Data:** writes `invoices` (all columns, see Data model), `invoice_items` (one per draft item, `sort` = index, `currency` copied), `invoice_tax_summary` (one per draft tax row); reads `invoice_settings`. The persist step is one DB transaction; number allocation is a separate earlier transaction.
- **Rules & edge cases:**
  1. Plan gate: if the workspace lacks `auto_invoice`, log and return null (never throws). Callers turn null into a flash error or ignore it (webhooks).
  2. Quota: if `auto_invoice_max_monthly` > 0 and invoices issued this calendar month >= cap, set `meta.quota_flag=true` and log a warning, **but still issue**. QUIRK: `quota_flag` is never read or surfaced; the cap is not enforced.
  3. Idempotency: when the draft has an `external_order_id`, return the existing invoice for `(source, external_order_id, doc_type)`. Own-store and manual drafts have none, so no dedup (DB unique key does not help because NULLs do not collide).
  4. Status at insert: `paid` when the draft has a `paidAt`, else `issued`. `send_status=pending`. `issued_at=now()` (UTC). `due_at` is never set.
  5. Seller snapshot (frozen JSON): name (settings or site company name or brand), address, tax id, registration number, phone, email (support email or site support email), tax label, extra statutory fields (only rows with both label and value), signature path only if `show_signature`, signature label (default "Authorised signatory"). Empty values are dropped. Logo, brand colour, footer note and live tax label are **not** snapshotted (WD-INV-014).
  6. `public_token` = 40 random alphanumeric characters, re-rolled on collision (column allows 48).
  7. Items: `description` default "Item", qty cast float, minor fields cast int; no re-computation or reconciliation of totals against items (a mapper bug can store a total that does not equal the lines).
  8. QUIRK: `invoice_settings.enabled` is ignored by the engine.
- **Async & events:** log lines `invoice.skip.no_feature`, `invoice.over_quota`. No domain events, no notifications, no outbound webhooks.
- **External systems:** none.
- **Settings:** `auto_invoice` feature, `auto_invoice_max_monthly`, `invoice_settings.*`.
- **Acceptance criteria:**
  - Given a Shopify order id 123 already invoiced, When issued again, Then the same invoice is returned and no new number is consumed.
  - Given the monthly cap is 5 and 5 invoices exist this month, When another is issued, Then it is created with `meta.quota_flag=true`.
  - Given the plan lacks the feature, Then null is returned and nothing is written.
  - Given a draft with `paidAt`, Then status is `paid` and `paid_at` equals it.
- **Source refs:** `app/Services/Invoice/InvoiceService.php`, `InvoiceDraft.php`, `app/Models/Invoice.php`, migration `2026_08_20_100000_create_invoices_table.php`.
- **Port notes:** put in `apps/api/src/modules/invoicing`. Allocate number and insert in **one** transaction (WaDesk's two-transaction approach leaves gaps on failure). Reject over-quota explicitly or surface the flag; decide per D-12.

### WD-INV-008 — Invoice numbering and series

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** none
- **Summary:** Each workspace has independent counters per series; numbers look like `INV-2026-000123` and never repeat within a workspace.
- **Actors & access:** internal.
- **UX & screens:** prefix and "financial-year reset" configured in WD-INV-021.
- **Endpoints:** none.
- **Data:** `invoice_number_sequences(workspace_id, series, next_seq)` unique on `(workspace_id, series)`; `invoices.series`, `invoices.seq`, `invoices.invoice_number` with unique `(workspace_id, invoice_number)` and unique `(workspace_id, series, seq)`.
- **Rules & edge cases:**
  1. Series = prefix + "-" + year. Prefix is `numbering_prefix` (default `INV`) for tax invoice, receipt and credit note, and `proforma_prefix` (default `PRO`) for proforma only. QUIRK: receipts and tax invoices share one counter, so a workspace's tax-invoice numbering has gaps wherever receipts were issued (a compliance point for GST/VAT regimes that need gap-free tax-invoice series).
  2. Year: if `fy_reset` (default true) the label is the Indian financial-year start (month >= April uses this year, else last year), otherwise the calendar year. Evaluated in the app timezone, falling back to Asia/Calcutta when the configured timezone is invalid. QUIRK: default `fy_reset=true` means a non-Indian workspace gets a year label that flips on 1 April.
  3. Number = series + "-" + sequence zero-padded to 6 digits (more digits when larger).
  4. Allocation: inside a short transaction, lock the counter row `FOR UPDATE`; if missing, create it seeded to `max(seq in this series) + 1` (so a lost counter resumes safely), then take `next_seq` and increment.
  5. Counter resets implicitly each year/FY because the series string changes. Changing the prefix starts a new series at 1 (or at max+1 if invoices already exist in that exact series).
  6. QUIRK: the allocation transaction commits before the invoice insert. If the insert fails (for example a string too long), the number is consumed and never used: a gap. Docs claim "no gaps".
  7. QUIRK: docs show `INV-0007`; the real format has the year segment and 6 digits.
  8. Prefix is uppercased on save but otherwise free text up to 16 characters (spaces and symbols allowed).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `numbering_prefix`, `proforma_prefix`, `fy_reset`.
- **Acceptance criteria:**
  - Given two concurrent issues in one workspace and series, Then numbers are consecutive and unique.
  - Given `fy_reset=true` and the date 2026-03-31, Then the series is `INV-2025`; on 2026-04-01 it is `INV-2026` and the sequence restarts at 1.
  - Given a proforma, Then the number uses `PRO-<year>-` and a separate counter.
  - Given two workspaces, Then counters are independent.
- **Source refs:** `InvoiceService::allocateNumber/seriesFor`, `InvoiceNumberSequence`, migration `..._create_invoice_number_sequences_table.php`.
- **Port notes:** use a Postgres row-locked counter table (or `SELECT ... FOR UPDATE`) in the same transaction as the insert; keep tenant RLS; consider letting the owner choose a separate receipt series (D-08).

### WD-INV-009 — Own-store order to invoice mapping

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-INV-013
- **Summary:** Converts a native store order (storefront, WABA catalogue, AI ordering, manual order) into an invoice draft, choosing Receipt or Tax Invoice by whether the order carries tax.
- **Actors & access:** internal.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** reads `wa_orders` and its line items (`wa_order_items`, falling back to `items_json`); settings for tax label/rate.
- **Rules & edge cases:**
  1. Currency = order currency uppercased (default USD); exponent from `MoneyFormat::ingestExponent` (0, 2 or 3).
  2. Order amounts are stored x100 by app convention for every currency. For exponent 2 they are used as is; otherwise re-scaled: `round(stored/100 x 10^exp)`.
  3. Items: name (default "Item"), SKU = retailer id or product id, qty (0 becomes 1), unit = re-scaled price, line subtotal = round(unit x qty). Line tax is always 0 (single order-level tax is not allocated).
  4. QUIRK: if the order has no line rows the draft has one line "Order #<id>" whose value is `total - shipping + discount` (re-scaled) but **without subtracting tax**, so the subtotal is overstated by the tax amount when the order has tax.
  5. Document type: `tax_invoice` if order tax > 0 else `receipt`. Tax summary: one row labelled with the settings tax label (default "Tax"), rate = `default_tax_rate` if set else null, base = subtotal, amount = order tax.
  6. Totals (shipping, discount, tax, total) are taken from the order, not recomputed, so `subtotal - discount + shipping + tax` may not equal `total`.
  7. `tax_inclusive` copied from the order; it only changes the footer sentence on the PDF, no math.
  8. Buyer name/email/phone from the order; billing and shipping address both = `customer_address`. `external_order_number` = order id; `external_order_id` is null (so no dedup); `wa_order_id` set; `paid_at` = order `updated_at`; `meta.native_source` = order source. Source recorded as `own` (never `storefront`, `waba`...).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `tax_label`, `default_tax_rate` (display only).
- **Acceptance criteria:**
  - Given an order with tax 0, Then doc type `receipt` and no tax summary.
  - Given tax 1800 minor, Then `tax_invoice` with one summary row of 1800.
  - Given an IDR order stored as 15,000,000 (x100), Then invoice minor = 150,000 with exponent 0.
  - Given an order without line rows, Then a single "Order #id" line is created.
- **Source refs:** `app/Services/Invoice/Mappers/OwnStoreInvoiceMapper.php`, `app/Models/WaOrder.php`.
- **Port notes:** fix the no-lines subtotal bug and add a reconcile assertion (D-06). Allocate tax per line when the order carries per-line tax.

### WD-INV-010 — WooCommerce order to invoice mapping

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-INV-013
- **Summary:** Builds a draft from the raw WooCommerce REST order so tax lines, per-line amounts and currency are exact.
- **Actors & access:** internal (called from the Woo webhook handler).
- **UX & screens:** none.
- **Endpoints:** none (webhook is in the shopify-woocommerce domain).
- **Data:** reads the raw order payload and the local order mirror.
- **Rules & edge cases:**
  1. Currency from the payload, then the mirror, then USD; exponent from the ISO table; amounts parsed from decimal strings with `toMinor` (strips non-numeric characters, rounds).
  2. Line: subtotal = line `total` (ex-tax), tax = line `total_tax`, unit = round(subtotal/qty). `hsn_sac` = first `meta_data` value of the line item (QUIRK: arbitrary meta; the column is 16 chars so a longer value makes the insert fail, the webhook swallows it and the invoice is silently lost).
  3. Tax summary from `tax_lines` (label, rate_percent, `tax_total + shipping_tax_total`); if the sum is 0 use `total_tax`. Summary base = order subtotal for every row.
  4. Doc type `tax_invoice` when tax > 0 else `receipt`. `tax_inclusive` from `prices_include_tax`. Phone normalised to digits via `WooPhone`.
  5. `external_order_id` = Woo id; `paid_at` = `date_paid` or now. Source `woocommerce`.
- **Async & events:** none.
- **External systems:** none (data arrives by webhook).
- **Settings:** none.
- **Acceptance criteria:**
  - Given a KWD order total "12.500", Then minor 12500 with exponent 3.
  - Given tax_lines of two rates, Then two summary rows.
  - Given the same Woo order delivered twice with the same delivery id, Then one invoice (WD-INV-012).
- **Source refs:** `app/Services/Invoice/Mappers/WooInvoiceMapper.php`, `app/Support/MoneyFormat.php`, `app/Http/Controllers/WoocommerceController.php`.
- **Port notes:** owned jointly with the shopify-woocommerce domain; keep mapper a pure function with unit tests.

### WD-INV-011 — Shopify order to invoice mapping

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-INV-013
- **Summary:** Builds a draft from the raw Shopify order webhook body using the presentment currency.
- **Actors & access:** internal.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** raw payload and mirror.
- **Rules & edge cases:**
  1. Currency = `presentment_currency` or `currency`; ISO exponent.
  2. Line: unit = `price`, subtotal = unit x qty, line tax = sum of the line's `tax_lines`, line discount = `total_discount`. QUIRK: `line_discount_minor` is stored but the PDF and totals ignore it; `discount_minor` comes from `total_discounts`.
  3. Order tax summary from `tax_lines` (title, rate x 100); total tax = sum, else `total_tax`.
  4. Shipping = sum of `shipping_lines.price`; total = `total_price`.
  5. Doc type tax invoice if tax > 0 else receipt; `tax_inclusive` = `taxes_included`.
  6. Phone digits from shipping/customer/billing/order phone, then the mirror. `external_order_id` = Shopify id; `paid_at` = `processed_at` or now. Source `shopify`.
  7. Billing address is built from the **shipping** address fields (QUIRK).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a JPY order "1500", Then minor 1500 exponent 0.
  - Given `taxes_included=true`, Then PDF footer reads "Prices are tax inclusive."
  - Given the same `X-Shopify-Webhook-Id` twice, Then one invoice.
- **Source refs:** `app/Services/Invoice/Mappers/ShopifyInvoiceMapper.php`, `app/Http/Controllers/ShopifyController.php`.
- **Port notes:** same as WD-INV-010.

### WD-INV-012 — Auto-issue triggers on paid orders

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-INV-007, WD-PAY-011
- **Summary:** Invoices appear automatically when a store order becomes paid, via four entry points, with replay protection for platform webhooks.
- **Actors & access:** system.
- **UX & screens:** only the per-source "Auto-send" toggles (WD-INV-021).
- **Endpoints:** none of its own; hooks inside other handlers.
- **Data:** `invoice_webhook_events(source, delivery_id unique, topic, external_order_id, received_at)`; reads `invoice_settings.auto_send_*`.
- **Rules & edge cases:**
  1. `InvoiceService::handleWebhookOrder(order, source, deliveryId, topic, rawPayload)` never throws. It first `firstOrCreate`s the delivery id in `invoice_webhook_events`; an already-seen id returns null (replay). Then requires `auto_send_<source>` (`own`, `woocommerce`, `shopify`) to be on; otherwise returns null. Then maps (raw payload for Woo/Shopify) and issues.
  2. Entry points: (a) `RecordPaymentOnOrderPaid` listener on `WaOrderPaid` (own store, only if the order has no invoice yet); (b) the sweeper's step 1 for native orders with status paid/completed updated within 24 hours that have no invoice, for workspaces with `auto_send_own`, batch 15; (c) Shopify webhook when topic is `orders/paid` or `financial_status=paid`; Woo webhook when status is `processing` or `completed` or `date_paid` is present; (d) WhatsApp Pay capture. Manual button is WD-INV-004.
  3. QUIRK: the per-source `trigger_*` setting (`on_placed`, `on_paid`, `on_fulfilled`) is stored on the invoice but **never evaluated**; invoices are only ever created on paid/completed. `on_placed` and `on_fulfilled` do nothing.
  4. QUIRK: `auto_send_*` is both "issue automatically" and "deliver automatically": turning it off stops invoice creation entirely, not just sending.
  5. QUIRK: manually changing an order's status to `paid` in the orders screen does not fire `WaOrderPaid`, so only the sweeper (within a 24-hour window) creates the invoice, and no payment ledger row is written. The model observer on `WaOrder` only sets a cache flag `invoice_pending:<ws>:<id>` that nothing reads.
  6. QUIRK: listener and sweeper can both try to issue for one own-store order; no unique key prevents a duplicate (WD-INV-007 rule 3).
  7. Woo/Shopify invoice identity is `(source, external order id, doc_type)`; an order that updates to paid twice yields one invoice.
- **Async & events:** heartbeat (WD-INV-020); event `WaOrderPaid`; Shopify/Woo webhooks (signature verification lives in the shopify-woocommerce domain).
- **External systems:** Shopify, WooCommerce webhooks.
- **Settings:** `auto_send_own|woocommerce|shopify`, `trigger_*` (inert).
- **Acceptance criteria:**
  - Given `auto_send_own=true` and a gateway payment succeeds, Then an invoice exists within the request that marked the order paid and its PDF is rendered by the next sweep.
  - Given a Woo order delivered twice with the same `X-WC-Webhook-Delivery-ID`, Then exactly one invoice.
  - Given `auto_send_shopify=false`, Then paid Shopify orders produce no invoice.
  - Given an operator sets an order to `paid` manually, Then (WaDesk) an invoice appears at the next sweep, no payment row; the port should decide D-10.
- **Source refs:** `InvoiceService::handleWebhookOrder/maybeAutoIssue`, `InvoiceSweeper`, `app/Listeners/Commerce/RecordPaymentOnOrderPaid.php`, `ShopifyController.php`, `WoocommerceController.php`, `app/Services/Waba/WhatsAppPayService.php`, `app/Models/WaOrder.php`, migration `..._create_invoice_webhook_events_table.php`.
- **Port notes:** use an outbox event `order.paid` consumed by the invoicing module (not a model observer); make issuance idempotent on `(workspace, order_id, doc_type)`; separate "auto-issue" from "auto-send" settings.

### WD-INV-013 — Money model: minor units, exponent, display

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** none
- **Summary:** All invoice and payment amounts are integers in minor units of the document's own currency, with the currency's exponent stored on the row.
- **Actors & access:** internal.
- **UX & screens:** formatting in the list, detail, PDF and public page.
- **Endpoints:** none.
- **Data:** `invoices.currency` (3 chars), `invoices.currency_exponent` (0..255, default 2), `*_minor` bigint columns, `invoice_items.currency`.
- **Rules & edge cases:**
  1. Ingest exponent (`MoneyFormat::ingestExponent`): zero-decimal BIF, CLP, DJF, GNF, IDR, ISK, JPY, KMF, KRW, MGA, PYG, RWF, UGX, VND, VUV, XAF, XOF, XPF, HUF, TWD; three-decimal BHD, IQD, JOD, KWD, LYD, OMR, TND; else 2.
  2. QUIRK: three different zero-decimal lists exist: `MoneyFormat` (above), the manual builder and the payments controller (JPY, KRW, VND, IDR, CLP, ISK, HUF, XAF, XOF, PYG, RWF, UGX, KMF, no 3-decimal, no TWD/BIF...), so the same currency can get different exponents depending on screen.
  3. QUIRK (display, high impact): `MoneyFormat::display` delegates to `WaProduct::formatCurrency`, which always divides by 100 and prints 0 or 2 decimals, ignoring `currency_exponent`. Zero-decimal invoices (JPY 1500 stored as 1500) show as "15"; three-decimal (KWD 12.500 stored 12500) show as "125". The PDF and public page use the same helper, so the frozen PDF shows wrong figures for non-2-exponent currencies. The existing `majorString` helper that is exponent-aware is unused.
  4. QUIRK: `Payment::amount_display`, the payments ledger page and the aging cards all divide by 100 regardless of currency, and the copilot divides by 100 too.
  5. Symbols come from `WaProduct::currencySymbol` (invoice detail/PDF) and `Currency::symbolFor` (ledger).
  6. Multi-currency: each invoice has one currency; there is no conversion and no workspace base currency enforcement; payments carry their own `currency` and are summed against an invoice without conversion (WD-PAY-003).
  7. No rounding mode setting; PHP `round` half away from zero everywhere.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none (a nonexistent `invoice_settings.currency` is read in four places, WD-INV-006 rule 2 and D-03).
- **Acceptance criteria:**
  - Given currency JPY and total 1500 minor, Then every surface shows 1,500 (port requirement; WaDesk shows 15).
  - Given KWD 12.500, Then stored 12500 exponent 3 and shown 12.500.
  - Given "1,234.50" input in a Woo payload, Then `toMinor` yields 123450 for exponent 2.
- **Source refs:** `app/Support/MoneyFormat.php`, `app/Models/WaProduct.php` (`formatCurrency`), `app/Models/Payment.php`, `InvoicesController::currencyExponent`, `PaymentsController::exponent`, `app/Services/AiCrm/CrmToolkit.php`.
- **Port notes:** one shared `@crm/money` helper in `packages` with an ISO-4217 table, `Intl.NumberFormat` display, and tests. This is a defect in the reference, not behaviour to copy (D-04).

### WD-INV-014 — PDF rendering, freezing and storage

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-INV-007
- **Summary:** An A4 PDF is rendered once per invoice, stored under an unguessable path, hashed, and never regenerated (the document is immutable once rendered).
- **Actors & access:** internal; triggered by generate, create, sweeper, or the first PDF request.
- **UX & screens:** `resources/views/invoices/pdf.blade.php`: seller block (logo, name, address, tax id with the live tax label or "Tax ID", registration number, extra fields, phone, email); title by doc type (Tax Invoice, Proforma Invoice, Credit Note, otherwise Receipt) with number, date (issue date in the app timezone, `d M Y`) and a status badge; Bill to (name or "Customer", phone, email, billing address if present); optional "Order: <external_order_number>"; items table (Description with SKU; HSN/SAC and Tax % columns only for tax invoices; Qty, Unit, Amount = line subtotal); totals (Subtotal, Discount if > 0, Shipping if > 0, tax summary rows only for tax invoices with label and rate, Total); signature image and label if present; footer with "Prices are tax inclusive." or "Tax exclusive." (tax invoices only), the settings footer note, "For queries: <support email or buyer email>", and the public token in small print. Brand colour from settings (default `#0B3D2E`).
- **Endpoints:** none directly.
- **Data:** writes `invoices.pdf_path` (`invoices/<workspace_id>/<public_token>.pdf` on the configured media disk), `pdf_disk` (records the default filesystem disk name; reads use the media storage helper), `pdf_sha256`, `pdf_bytes`, `send_status` through `rendering -> ready` (or `send_failed`/`render_failed`).
- **Rules & edge cases:**
  1. Renders only if `pdf_path` is empty: idempotent and frozen. No regenerate/replace route exists, so a mistake or a changed logo can never refresh an issued PDF.
  2. Logo and signature are base64-embedded from a stored media path only; any value starting with `http(s)://` is refused (SSRF guard); dompdf remote fetching stays off. Missing file means no image.
  3. QUIRK: only the seller identity and signature path are snapshotted at issue. Logo, brand colour, footer note, support email and tax label are read live at **render** time; since render can happen later (sweeper), an invoice's look can depend on when it was first rendered.
  4. QUIRK: the status badge on the PDF is whatever status the invoice had when rendered ("Issued" or "Paid"), frozen forever; a PDF rendered while `issued` never shows `paid`.
  5. QUIRK: for non-tax docs (receipt, proforma) tax rows are not printed even when `tax_minor` > 0, so the printed lines can fail to add up to the total; per-line tax amounts are never printed, only the rate column on tax invoices.
  6. Render failure: `send_attempts` + 1, `send_status=send_failed`, `send_reason=render_failed`, error text truncated to 500; the request continues.
  7. Fonts: DejaVu Sans, so non-Latin text works as far as that font covers it; no RTL handling.
- **Async & events:** log `invoice.render_failed`.
- **External systems:** dompdf (barryvdh/laravel-dompdf).
- **Settings:** `logo_path`, `brand_color`, `footer_note`, `support_email`, `tax_label`, signature settings.
- **Acceptance criteria:**
  - Given an invoice with no PDF, When any PDF route is hit, Then a PDF is generated, stored at the token path, and its SHA-256 and byte size recorded.
  - Given a logo setting that is `http://internal/x.png`, Then no image is embedded and no outbound request is made.
  - Given an already rendered invoice, When the logo setting changes, Then the stored PDF is unchanged.
  - Given a receipt with tax 100, Then the PDF total includes the tax but no tax row is printed (WaDesk; D-07).
- **Source refs:** `app/Services/Invoice/InvoicePdfRenderer.php`, `InvoiceService::renderAndSend`, `resources/views/invoices/pdf.blade.php`.
- **Port notes:** render with a Node PDF library (React-PDF or headless Chromium) in a BullMQ worker, store in object storage (MinIO/S3) with the SHA-256, keep the token path. Decide whether to allow admin-triggered re-render (versions) instead of dead-freezing.

### WD-INV-015 — Merchant PDF download

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-INV-014
- **Summary:** The admin opens the stored PDF inline in a new tab.
- **Actors & access:** admin; the plan middleware does not block GET.
- **UX & screens:** "PDF" in the list, "Download PDF" on the detail.
- **Endpoints:**

  | Method uri | Route name | Action | Middleware | Request | Response |
  | --- | --- | --- | --- | --- | --- |
  | GET `invoices/{id}/pdf` | `user.invoices.pdf` | `InvoicesController@pdf` | web, auth, admin role, plan:auto_invoice | `id` numeric | `application/pdf`, inline, filename `<number>.pdf`; 404 when missing/foreign or render fails |

- **Data:** reads the PDF from media storage; may write via WD-INV-014.
- **Rules & edge cases:** 1. If `pdf_path` is empty or the file is missing from storage, `renderAndSend` runs (and may send over WhatsApp as a side effect when a sender is configured and the invoice was never sent); then 404 if still missing. 2. No cache headers, no range support. 3. QUIRK: works on a plan without `auto_invoice` (GET only gets a paywall overlay, which a PDF response does not render).
- **Async & events:** none.
- **External systems:** media storage.
- **Settings:** none.
- **Acceptance criteria:** Given a rendered invoice, Then 200 PDF with `inline; filename="INV-2026-000001.pdf"`. Given a missing file on disk, Then it is re-rendered once. Given a foreign id, Then 404.
- **Source refs:** `InvoicesController@pdf/streamPdf`.
- **Port notes:** stream through the API with tenant check; short-lived signed URL is an acceptable alternative.

### WD-INV-016 — Public invoice page

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-INV-007
- **Summary:** The buyer opens `/i/{token}` (the target of the WhatsApp button) and sees a read-only summary with a Download PDF button. There is **no pay button** and no online payment.
- **Actors & access:** anyone with the token (no auth, no workspace check). Throttled 120 requests per minute per IP (group `throttle:120,1`, shared with the brief and quote pages).
- **UX & screens:** `resources/views/public/invoice.blade.php`, guest layout. Header band with doc title and number, seller name (snapshot or brand) and issue date; "Billed to" with name (or "Customer") and phone; a pill showing the **raw status string** (`issued` or `paid`); items table (Item, Qty, Amount); totals (Subtotal, Discount, Shipping, tax rows for tax invoices only, Total); "Download PDF" link; footer brand name. No due date, no balance, no payments, no paid stamp logic, no email address, no invoice notes, no seller address/tax id, no language switch.
- **Endpoints:**

  | Method uri | Route name | Action | Middleware | Request | Response |
  | --- | --- | --- | --- | --- | --- |
  | GET `i/{token}` | `invoice.public.show` | `InvoicesController@publicShow` | web, throttle:120,1 | token string | HTML; 404 if no match |

- **Data:** reads `invoices` by `public_token` with items and tax summary.
- **Rules & edge cases:**
  1. The token is the only capability: 40 random alphanumeric characters (about 238 bits), unique index, never rotated, never expires, cannot be revoked. The sequential invoice number is not in the URL.
  2. No view tracking (`invoice_logs` exists but is never written; WD-INV-031).
  3. A voided or credited invoice would still render (no such state is ever set).
  4. No `noindex` meta or `Cache-Control: private` is set on this page (the Razorpay-style return page does set noindex).
  5. Exposes buyer name and phone and all amounts to anyone holding the link; the link was sent to the buyer's own WhatsApp.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a valid token, Then the page renders without login and shows the invoice number, items and total.
  - Given an unknown token, Then 404.
  - Given 130 requests in a minute from one IP, Then the excess get 429.
  - Given a tax invoice, Then tax rows appear; given a receipt with tax, Then they do not (WaDesk; D-07).
- **Source refs:** `InvoicesController@publicShow`, `resources/views/public/invoice.blade.php`, `routes/web.php` (public group).
- **Port notes:** public Next.js route `/i/[token]`; add `noindex`, `Cache-Control: private, no-store`, optional token expiry/revocation, view tracking (`viewed_at`) and a pay button when WD-PAY-015 is built.

### WD-INV-017 — Public invoice PDF

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-INV-014
- **Summary:** `/i/{token}/pdf` streams the same frozen PDF to the buyer.
- **Actors & access:** anyone with the token; throttled 120/min/IP.
- **UX & screens:** "Download PDF" on the public page.
- **Endpoints:**

  | Method uri | Route name | Action | Middleware | Request | Response |
  | --- | --- | --- | --- | --- | --- |
  | GET `i/{token}/pdf` | `invoice.public.pdf` | `InvoicesController@publicPdf` | web, throttle:120,1 | token | `application/pdf` inline; 404 |

- **Data:** as WD-INV-015.
- **Rules & edge cases:** 1. QUIRK: if the PDF has not been rendered yet (for example just issued by a webhook), the first public hit renders it **and triggers `renderAndSend`**, which can send the WhatsApp message if a sender is configured and the invoice was never sent. A third party with the token therefore can cause the first send. 2. Same render-failure 404 as WD-INV-015.
- **Async & events:** possibly WD-INV-018.
- **External systems:** media storage.
- **Settings:** none.
- **Acceptance criteria:** Given a rendered invoice, Then 200 PDF without auth. Given an unrendered one, Then it renders then streams. Given a bad token, Then 404.
- **Source refs:** `InvoicesController@publicPdf/streamPdf`.
- **Port notes:** make the public PDF read-only (never trigger send).

### WD-INV-018 — WhatsApp delivery of an invoice

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-INV-014, WD-INV-023
- **Summary:** Delivers the invoice to the buyer's WhatsApp, either an approved utility template with a "View invoice" URL button (WABA) or the PDF as a document (Baileys), with persistent duplicate-send protection.
- **Actors & access:** system, or admin through Resend.
- **UX & screens:** Delivery column and pills: `sent` (green), `send_failed` (red), `ready/rendering/pending` (amber), others grey.
- **Endpoints:** none.
- **Data:** writes `send_status` (`pending`, `rendering`, `ready`, `sending`, `sent`, `send_failed`, `skipped` (declared, never set)), `send_attempts` (tiny int), `send_reason`, `send_error` (500), `sent_at`, `delivered_at`, `delivery_channel='whatsapp'`, `wa_message_id`; mirrors a document message into the buyer's inbox conversation.
- **Rules & edge cases:**
  1. Sender selection is `invoice_settings.send_sender` (`waba:<config id>` or `device:<device id>`), or an explicit channel override on resend. Delivery happens inside `renderAndSend` only if `send_sender` is non-empty; otherwise the invoice stays `ready` and downloadable (never marked failed for lacking a sender).
  2. Guard: already-sent invoices (`send_status=sent` or `sent_at` set) return `already` unless it is a resend. A 30-second cache lock `invoice_send_lock:<id>` prevents simultaneous sends (`send_in_progress`). Persistent `sent_at` is the source of truth.
  3. Recipient = digits of `buyer_phone`; empty means `no_recipient_phone` failure. Unknown sender kind or id <= 0 means `no_sender_configured`.
  4. WABA: config must be a WABA provider config of the same workspace (`waba_sender_missing`); the template referenced by `template_id_whatsapp` must exist (`no_invoice_template`) and be approved (`meta_status` or `status`, else `template_not_approved`). Variables: body {{1}} buyer name (or "there"), {{2}} invoice number, {{3}} formatted total (/100 display); button index 0 URL parameter = public token. Sent through the shared `TemplateSender`, which works outside the 24-hour window.
  5. Baileys: device must belong to the workspace (`device_missing`); PDF must exist (`pdf_not_rendered`); sent as a document with caption "Invoice <number> — <total>" and filename `<number>.pdf` through `WhatsAppDispatcher::sendRaw` (provider `baileys`).
  6. Success: `sent`, timestamps, message id, clears reason/error; then best-effort mirror into the buyer's `conversations` row (by `contact_digits`) as an outbound `document` message with meta `source=auto_invoice`, invoice id and public URL, and bumps `last_message_at`/`last_outbound_at`.
  7. Failure: `send_attempts + 1`, `send_status=send_failed`, `send_reason` (one of the codes above, `waba_send_failed`, `baileys_send_failed`, `send_failed`, `send_exception`), error text.
  8. QUIRK: total in the WABA template body and Baileys caption uses the /100 display helper (wrong for non-2-decimal currencies, WD-INV-013).
  9. QUIRK: there is no email, SMS or other channel despite `buyer_email` being collected.
- **Async & events:** none queued; inline or sweeper. No notification to the admin on failure.
- **External systems:** Meta WhatsApp Cloud API (templates), Baileys bridge via `WhatsAppDispatcher`.
- **Settings:** `send_sender`, `template_id_whatsapp`, `template_status`.
- **Acceptance criteria:**
  - Given a WABA sender with an approved template and a buyer phone, When delivered, Then the template is sent with the token in the button and the invoice is `sent` with a message id.
  - Given an already `sent` invoice, When `renderAndSend` runs, Then no second message is sent.
  - Given no phone, Then `send_failed`, reason `no_recipient_phone`, attempts 1.
  - Given a Baileys device deleted after configuration, Then reason `device_missing`.
  - Given an existing inbox conversation for the phone, Then an outbound document message appears in it.
- **Source refs:** `app/Services/Invoice/InvoiceSender.php`, `InvoiceService::renderAndSend`, `app/Services/Waba/TemplateSender.php`, `app/Services/WhatsAppDispatcher.php`.
- **Port notes:** reuse the provider adapter / outbox pattern; delivery as a BullMQ job with retry (replaces the traffic-driven sweeper); store `wa_message_id`; emit an audit entry on send and on failure.

### WD-INV-019 — Resend invoice

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-INV-018
- **Summary:** Re-delivers the same frozen PDF on demand.
- **Actors & access:** workspace admin; plan gate.
- **UX & screens:** "Send on WhatsApp" button on the detail; flash "Invoice re-sent." or "Could not send: <code>".
- **Endpoints:**

  | Method uri | Route name | Action | Middleware | Request | Response |
  | --- | --- | --- | --- | --- | --- |
  | POST `invoices/{id}/resend` | `user.invoices.resend` | `InvoicesController@resend` | web, auth, admin role, plan:auto_invoice | `id` numeric | redirect back with flash; 404 foreign |

- **Data:** as WD-INV-018.
- **Rules & edge cases:** 1. Resend bypasses the already-sent guard but keeps the 30-second lock. 2. It does not render a missing PDF first; with no PDF the Baileys path fails `pdf_not_rendered` (WABA still works because it only links the public token). 3. The service returns `sender_unavailable` if no sender class is injected (not expected in practice). 4. No limit on resend frequency. 5. QUIRK: a failed resend overwrites the invoice's `send_status` to `send_failed` (and increments attempts) even though it was previously `sent`. The sweeper still skips it because `sent_at` stays set, but the list pill turns red for an invoice the buyer already received.
- **Async & events:** none.
- **External systems:** WhatsApp.
- **Settings:** `send_sender`.
- **Acceptance criteria:** Given a sent invoice, When resend succeeds, Then a new message is sent and `sent_at` is refreshed. Given the buyer has no phone, Then "Could not send: no_recipient_phone". Given a foreign id, Then 404.
- **Source refs:** `InvoicesController@resend`, `InvoiceService::resend`, `InvoiceSender`.
- **Port notes:** keep a delivery-attempts table instead of overwriting one status column.

### WD-INV-020 — Delivery sweeper and retries

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-INV-018
- **Summary:** A traffic-driven batch job that gap-fills native paid orders, renders pending PDFs and retries failed sends.
- **Actors & access:** system.
- **UX & screens:** none.
- **Endpoints:** none (called from the Node-bridge heartbeat endpoint in `WaConnectController`, every ~30 s).
- **Data:** reads/writes `invoices`, `invoice_settings`, `wa_orders`.
- **Rules & edge cases:**
  1. Cache gate: `invoice_sweep_at` with a 300-second TTL (so at most one run per 5 minutes across the cluster); exceptions are caught and logged.
  2. Step 1: for workspaces with `auto_send_own`, up to 15 native-source orders (`storefront, waba, twilio, whatsapp_ai, manual`) with status paid/completed, `updated_at` within 24 hours, no invoice, newest first, are issued via `handleWebhookOrder(..., 'own', null, 'own_store')`.
  3. Step 2: up to 15 invoices (oldest id first) with `send_status in (pending, ready, send_failed)`, `send_attempts < 5`, `sent_at` null and `issued_at` within 24 hours get `renderAndSend`. After 5 failed attempts or 24 hours they stay `send_failed` ("needs attention") forever; there is no alert.
  4. QUIRK: no cron or queue; if no workspace has the Node bridge connected (no heartbeat) nothing ever renders or sends in the background.
  5. QUIRK: step 2 processes all workspaces including those whose plan lost `auto_invoice` (the plan check is only in `issue()`).
  6. A failing render is parked by attempts, not looped.
- **Async & events:** heartbeat tick; log `invoice.sweep_failed`, `invoice.sweep_item_failed`.
- **External systems:** WhatsApp, as WD-INV-018.
- **Settings:** constants (interval 300 s, batch 15, attempts 5, window 24 h).
- **Acceptance criteria:** Given 20 pending invoices, Then one run processes the 15 oldest. Given an invoice with 5 attempts, Then it is skipped. Given a second heartbeat within 5 minutes, Then no run.
- **Source refs:** `app/Services/Invoice/InvoiceSweeper.php`, `app/Http/Controllers/WaConnectController.php` (heartbeat).
- **Port notes:** replace with BullMQ delayed retries and a repeatable gap-fill job; keep the same limits as defaults; add an admin-visible "needs attention" count.

### WD-INV-021 — Invoice settings screen

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-INV-022
- **Summary:** One form that holds company identity, branding, tax/numbering defaults and WhatsApp delivery options for the workspace.
- **Actors & access:** workspace admin; plan gate.
- **UX & screens:** `resources/views/user/invoices/settings.blade.php` + `_settings_form.blade.php`. Cards: Company details (legal name, address, tax number, registration number, phone, support email, dynamic "Extra fields" label/value rows); Logo and signature (two file inputs with current-image preview, signature label, "Show" checkbox, brand colour text); Tax and numbering (tax label, default tax rate %, default HSN/SAC, number prefix, due in days, "Prices tax-inclusive" checkbox, footer note, plus a note that a taxless order becomes a Receipt); WhatsApp delivery ("Enable invoices", "Send from" select of WABA configs labelled `WABA · number · label` and devices labelled `Unofficial · +cc number · name`, three auto-send checkboxes for WhatsApp Store/WooCommerce/Shopify, template status pill and "Create & submit invoice template" button). One "Save settings" button. The `proforma_prefix`, `fy_reset` and the three `trigger_*` fields exist server-side but have **no UI controls** (so a save resets triggers to `on_paid`).
- **Endpoints:**

  | Method uri | Route name | Action | Middleware | Request | Response |
  | --- | --- | --- | --- | --- | --- |
  | GET `invoices/settings` | `user.invoices.settings` | `InvoiceSettingsController@edit` | web, auth, admin role, plan:auto_invoice | none | HTML |

- **Data:** `invoice_settings` via `firstOrCreate(workspace_id)` (a GET creates the row), connected `wa_provider_configs` (provider waba) and `devices` of the workspace, the referenced template.
- **Rules & edge cases:** 1. Sender dropdown lists every WABA config and device of the workspace regardless of connection state. 2. The page is a GET with a write side effect (row creation). 3. QUIRK: `fy_reset` has no checkbox, so saving the form sets it to false (`$request->boolean('fy_reset')` on an absent field) — see WD-INV-022.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** all of `invoice_settings`.
- **Acceptance criteria:** Given a workspace with one WABA and one device, Then the sender select shows both. Given an existing logo, Then a preview is shown. Given first visit, Then a settings row with defaults is created.
- **Source refs:** `InvoiceSettingsController@edit`, `resources/views/user/invoices/settings.blade.php`, `_settings_form.blade.php`, `app/Models/InvoiceSetting.php`.
- **Port notes:** expose settings as `GET/PUT /invoice-settings`; do not create rows on GET; add the missing controls (proforma prefix, FY reset, due days usage).

### WD-INV-022 — Save invoice settings

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** none
- **Summary:** Validates and stores the settings and uploads the logo and signature.
- **Actors & access:** workspace admin; plan gate.
- **UX & screens:** redirect back with flash "Invoice settings saved."; validation errors shown at the top.
- **Endpoints:**

  | Method uri | Route name | Action | Middleware | Request | Response |
  | --- | --- | --- | --- | --- | --- |
  | POST `invoices/settings` | `user.invoices.settings.save` | `InvoiceSettingsController@save` | web, auth, admin role, plan:auto_invoice | multipart form, see rules | 302 back |

- **Data:** updates `invoice_settings`; writes files `invoices/branding/<workspace_id>/logo_<random16>.<ext>` and `sig_<random16>.<ext>` to media storage.
- **Rules & edge cases:**
  1. Validation: `enabled`, `fy_reset`, `tax_inclusive_default`, `show_signature`, `auto_send_*` boolean; `numbering_prefix` and `proforma_prefix` nullable max 16; `tax_label` max 24; `default_tax_rate` numeric 0..100; `hsn_default` max 16; `due_days` integer 0..365; `brand_color` max 9 (no hex validation); `footer_note` max 2000; `support_email` email max 191; `seller_name` max 191; `seller_address` max 1000; `seller_tax_id` and `seller_reg_no` max 64; `seller_phone` max 40; `extra_label.*` max 40 and `extra_value.*` max 80 (arrays); `signature_label` max 64; `logo` and `signature` nullable image max 2048 KB; `send_sender` max 48; `trigger_*` in `on_placed, on_paid, on_fulfilled`.
  2. Booleans use "checkbox present" semantics, so an omitted field means false. Consequence: `fy_reset` (no control) is reset to false on every save; `trigger_*` default to `on_paid`.
  3. Prefixes are uppercased; empty falls back to `INV`/`PRO`.
  4. Extra fields are zipped by index; rows missing a label or value are dropped; the result is stored as JSON `[{label,value}]` or null.
  5. Images are stored by the client-supplied extension (default png) after the `image` rule; the old file is not deleted (orphans accumulate).
  6. QUIRK: `enabled`, `default_tax_rate` (label only), `tax_inclusive_default`, `hsn_default`, `due_days`, `brand_color` (PDF only), `trigger_*` have little or no runtime effect (see Data model notes).
  7. `brand_color` is interpolated into PDF CSS unvalidated.
  8. No validation that `send_sender` refers to a sender of this workspace at save time; sender resolution later re-checks the workspace.
  9. Changing prefix or FY mode affects only future invoices.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** writes them.
- **Acceptance criteria:**
  - Given prefix "inv", When saved, Then stored as `INV`.
  - Given `due_days=400`, Then validation error.
  - Given two extra rows where one has an empty value, Then only the complete row is stored.
  - Given a 3 MB logo, Then validation error and nothing is stored.
  - Given a save with `fy_reset` omitted, Then `fy_reset=false` (WaDesk; D-09).
- **Source refs:** `InvoiceSettingsController@save`, `app/Models/InvoiceSetting.php`.
- **Port notes:** use PATCH semantics (omitted means unchanged), validate hex colour, delete replaced images, resize/limit mime types.

### WD-INV-023 — WhatsApp invoice template provisioning

- **Status:** partial
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-INV-022
- **Summary:** Creates and submits the invoice message template to Meta (WABA) or marks the Baileys sender ready (no template).
- **Actors & access:** workspace admin; plan gate.
- **UX & screens:** "Create & submit invoice template" in settings; status pill `none`/`pending`/`approved`/`rejected`; flash messages: "Pick a connected WhatsApp sender first...", "Unofficial is ready...", "Invoice template submitted to Meta for approval...", "Could not submit to Meta: ...".
- **Endpoints:**

  | Method uri | Route name | Action | Middleware | Request | Response |
  | --- | --- | --- | --- | --- | --- |
  | POST `invoices/template` | `user.invoices.template.create` | `InvoiceSettingsController@createTemplate` | web, auth, admin role, plan:auto_invoice | `send_sender` string (form value) | redirect back with flash |

- **Data:** updates `invoice_settings.send_sender`, `template_id_whatsapp`, `template_status`; creates or updates a `wa_templates` row named `<brand_slug>_invoice`; calls the Meta template API.
- **Rules & edge cases:**
  1. Sender must be `device:<id>` or `waba:<id>` with id > 0, else error. The sender is saved to settings first.
  2. Device: verifies the device belongs to the workspace, sets `template_id_whatsapp=null`, `template_status=approved`.
  3. WABA: loads the workspace's WABA config; builds a UTILITY, language `en_US`, body "Hi {{1}}, your invoice {{2}} for {{3}} is ready. Tap the button below to view or download it." with examples, one URL button "View invoice" pointing to `<app url>/i/{{1}}` (example token). Template name = slugified brand name + `_invoice` (lowercase `[a-z0-9_]`). Reuses an existing template row by name else creates one `pending`. Submits through `TemplateClient`; empty Meta id means error. Stores Meta id, status and category; settings `template_status` becomes `approved` only if Meta returns approved immediately, else `pending`.
  4. QUIRK: `invoice_settings.template_status` is never updated again when Meta later approves or rejects (the template webhook updates `wa_templates` only). The list checklist keeps saying "Meta template approved: not ok" until the admin resubmits. Actual sending checks the live `wa_templates` status instead, so delivery works while the checklist is wrong.
  5. QUIRK: the save form also posts `send_sender`; this route reads it from the request, so unsaved changes in other fields are lost (the button is a `formaction` on the same form but only the sender is used).
  6. Template language is fixed `en_US`; the body text is not localised.
- **Async & events:** Meta `message_template_status_update` webhook updates the template (message-templates / WABA domain).
- **External systems:** Meta Graph API message templates.
- **Settings:** none beyond the above.
- **Acceptance criteria:**
  - Given a device sender, Then status `approved` and no template exists.
  - Given a WABA sender and Meta returns an id with status PENDING, Then settings `template_status=pending` and the template appears in the templates list as pending.
  - Given Meta rejects the call, Then an error flash with at most 160 characters and `template_status=pending` with the template id stored.
  - Given no sender selected, Then error flash.
- **Source refs:** `app/Services/Invoice/InvoiceTemplateProvisioner.php`, `InvoiceSettingsController@createTemplate`, `app/Http/Controllers/WaWebhookController.php` (template status handling).
- **Port notes:** subscribe the invoice template record to the template-status event and mirror it into settings; use the shared templates module.

### WD-INV-024 — Plan gate, role gate, quota, trial interplay

- **Status:** partial
- **Priority:** P0
- **Effort:** S
- **Depends on:** none
- **Summary:** Who may use invoicing and what limits apply.
- **Actors & access:** plan feature `auto_invoice` (boolean), `auto_invoice_max_monthly` (int, 0 = unlimited), `auto_invoice_branding` (boolean, declared and unused). Workspace role admin or above. There are no granular permission keys.
- **UX & screens:** the plan paywall overlay (shared component) on GET; warning flash on blocked mutations.
- **Endpoints:** applies to all `invoices*`, `payments`, `store/invoices` routes.
- **Data:** `packages.auto_invoice`, `packages.auto_invoice_max_monthly`, `packages.auto_invoice_branding`; workspace `plan_overrides` JSON may override per key.
- **Rules & edge cases:**
  1. `EnforcePlanFeature` for a missing feature: non-safe methods are blocked (JSON clients get 403 `plan_feature_disabled` with the feature key; others a redirect back with a warning flash "Your plan doesn't include auto invoice..."); safe methods (GET/HEAD) continue and a paywall overlay is flagged. So list, detail, settings, PDF and ledger are all readable without the feature.
  2. `PlanLimitGuard::hasFeature` returns true for platform admins, and for workspaces owned by a platform admin the engine treats every boolean as enabled and numeric caps as unlimited.
  3. QUIRK: there is no admin UI to grant `auto_invoice`: it is not in the plan form's feature toggle list or the `Package` fillable/cast list, and no seeder sets it. The packages table default is false, so on a stock install only platform-admin-owned workspaces (or a manual `plan_overrides`/database edit) can use invoicing. The port should expose it in plan configuration.
  4. The engine soft-skips (returns null) instead of throwing when the feature is missing, so webhooks do not retry; manual routes then show an error flash.
  5. Monthly cap is counted per calendar month by `issued_at` and is flag-only (WD-INV-007).
  6. The expired-free-trial hard gate (`EnsureTrialActive`) lets through any route name matching `*invoice*` or `*payment*`, so invoice and payments pages remain open after a trial expires (the pattern was meant for platform invoices). 
  7. Roles above agent: owner, admin pass; manager, agent and viewer are redirected to `/team-inbox` (agent/viewer) or get 403 (manager). 
  8. The public `/i/{token}` routes ignore plan and role.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** plan columns above.
- **Acceptance criteria:**
  - Given a workspace without the feature, When POSTing to `/invoices/manual`, Then nothing is created and the user gets a plan warning.
  - Given the same workspace, When GET `/invoices`, Then the page renders with a paywall overlay (WaDesk).
  - Given a manager, When opening `/invoices`, Then 403.
  - Given a platform-admin-owned workspace, Then everything works without a plan row.
- **Source refs:** `app/Http/Middleware/EnforcePlanFeature.php`, `EnsureWorkspaceRole.php`, `EnsureTrialActive.php`, `app/Services/PlanLimitGuard.php`, `app/Models/Workspace.php` (`effectiveLimit`), `app/Http/Controllers/AdminPagesController.php` (`PLAN_FEATURE_TOGGLES`), migration `2026_08_20_100600_add_auto_invoice_plan_columns.php`.
- **Port notes:** map to `invoices.read`, `invoices.write`, `payments.record` permission keys in the RBAC module and a plan feature `invoicing`; block reads as well as writes when the plan lacks the feature, or decide to keep the soft paywall (D-14).

### WD-INV-025 — Invoice status model and transitions

- **Status:** partial
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-PAY-003
- **Summary:** The only states that ever occur are `issued` and `paid`; `void` and `credited` are declared but unreachable.
- **Actors & access:** system.
- **UX & screens:** the status string appears only on the public page pill and the PDF badge; the admin list shows delivery status instead.
- **Endpoints:** none.
- **Data:** `invoices.status` varchar(16) default `issued` (documented values `issued|paid|void|credited`); `paid_at`.
- **Rules & edge cases:**
  1. Transition table:

     | From | To | Trigger |
     | --- | --- | --- |
     | (new) | `issued` | any draft without `paidAt` (manual builder, Copilot, sales-doc convert) |
     | (new) | `paid` | draft with `paidAt` (all Woo/Shopify/own-store drafts; they always set `paidAt`) |
     | `issued` | `paid` | `PaymentLedger::syncInvoice` when summed payments >= total (sets `paid_at` if empty) |
     | `paid` | any | never (no un-pay on refund or deleted payment) |
     | any | `void` / `credited` | never in code; only the platform admin invoice screen has a void for platform orders |

  2. `sent`, `viewed`, `partially paid`, `overdue`, `draft` do **not** exist as invoice statuses. "Sent" is the separate `send_status`. Partial payment is derivable (sum of payments > 0 and < total) but never shown on the invoice. Overdue cannot be derived because `due_at` is null.
  3. `syncInvoice` only touches `issued` invoices, so recording a payment on a `paid` invoice is allowed but changes nothing; overpayment is not detected.
  4. Tax and revenue reports use `status=paid` for "tax collected".
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:** Given an `issued` invoice of 100, When payments of 40 and 60 are recorded, Then it becomes `paid` with `paid_at` set at the second payment. Given a payment of 40 only, Then it stays `issued`.
- **Source refs:** `app/Models/Invoice.php`, `app/Services/Crm/PaymentLedger.php`, `InvoiceService::persist`.
- **Port notes:** see D-01 for the recommended status model (draft/issued/void stored; payment status derived: unpaid, partial, paid, overdue).

### WD-INV-026 — Document types (tax invoice, receipt, proforma, credit note)

- **Status:** partial
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-INV-007
- **Summary:** Each invoice has a `doc_type` that changes the title, the numbering prefix and the columns shown on the PDF.
- **Actors & access:** internal; chosen by the user only in the manual builder.
- **UX & screens:** type pill in the list; PDF/public titles.
- **Endpoints:** none.
- **Data:** `invoices.doc_type` varchar(16), default `tax_invoice`; unique `(source, external_order_id, doc_type)` lets a proforma and a tax invoice coexist for one external order.
- **Rules & edge cases:** 1. `tax_invoice`: PDF adds HSN/SAC and Tax % columns, tax summary rows and the inclusive/exclusive sentence. 2. `receipt`: default for taxless orders; plain columns. 3. `proforma`: uses the `PRO` prefix; shown as "Proforma Invoice"; nothing converts a proforma into a tax invoice. 4. `credit_note`: title text exists on PDF/public page, the draft docblock lists it, but nothing creates one and the builder rejects it. 5. Auto-mapped doc type is `tax_invoice` iff tax > 0.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** prefixes.
- **Acceptance criteria:** Given a taxed order, Then `tax_invoice`; given none, Then `receipt`; given a proforma, Then `PRO-` numbering.
- **Source refs:** `InvoiceDraft::seriesPrefix`, mappers, `resources/views/invoices/pdf.blade.php`.
- **Port notes:** implement credit notes as a new feature with its own series and a link to the original invoice (not present in WaDesk).

### WD-INV-027 — Convert proposal or estimate to invoice

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-INV-007
- **Summary:** In the sales-docs domain an accepted or sent quote converts to a real invoice through the same engine. Documented here as the cross-domain contract; the screens and routes are owned by sales-docs.
- **Actors & access:** workspace user with `access_sales_pipeline` (plan) on `proposals/{id}/convert` and `estimates/{id}/convert` (POST).
- **UX & screens:** "-> Invoice" on the sales-doc list.
- **Endpoints:** `POST proposals/{id}/convert` and `POST estimates/{id}/convert` -> `SalesDocsController@convert` (sales-docs domain).
- **Data:** builds an `InvoiceDraft` (`source=manual`, doc type `tax_invoice`, `meta.from_sales_doc`, `meta.sales_doc_number`); sets `sales_docs.invoice_id` and status `invoiced`.
- **Rules & edge cases:** 1. Refuses when the doc already has `invoice_id` ("Already converted"). 2. Any status can be converted (not only accepted). 3. Items carry no per-line tax; the whole-doc tax is one summary row labelled "Tax" with rate = basis points / 100, `tax_inclusive` false. 4. Buyer data comes from the doc's encrypted fields (decrypted by the cast). 5. Currency and exponent come from the doc (workspace currency, own zero-decimal list). 6. The engine's plan gate applies; on null the user sees "Invoicing is not available on your current plan." 7. QUIRK: the invoice does not store `company_id`, `contact_id` or `deal_id` from the doc; only `from_sales_doc` meta. 8. PDF rendering and WhatsApp send run inline; with no `send_sender` it stays `ready`.
- **Async & events:** none.
- **External systems:** WhatsApp (via delivery).
- **Settings:** as invoices.
- **Acceptance criteria:** Given a quote of 100 + 10% tax, When converted, Then an invoice total 110 exists with one tax row and the quote becomes `invoiced`. Given a second convert, Then error.
- **Source refs:** `app/Http/Controllers/SalesDocsController.php` (`convert`), `app/Models/SalesDoc.php`.
- **Port notes:** expose a service method `InvoicingService.issueFromQuote(quoteId)` consumed by the sales-docs module; store the quote link as a real FK column.

### WD-INV-028 — CRM links and revenue read side

- **Status:** partial
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-INV-006
- **Summary:** Manual invoices can carry contact/company/deal ids; the CRM dashboard and revenue report read invoices and payments for money rollups. Owned jointly with the CRM domain.
- **Actors & access:** `plan:access_sales_pipeline` for the CRM pages.
- **UX & screens:** CRM dashboard counts open/paid invoices and recent invoices/payments; revenue page and CSV/PDF export (WD-PAY-017).
- **Endpoints:** `GET crm`, `GET crm/revenue`, `GET crm/revenue.csv`, `GET crm/revenue.pdf` (crm domain).
- **Data:** `invoices.meta_json.{contact_id,company_id,deal_id,note}`; `payments.contact_id|company_id|deal_id`.
- **Rules & edge cases:** 1. QUIRK: the CRM ids live only inside `meta_json` on the invoice (not columns, not indexed, not FK) and nothing reads them back; invoices do not appear on a contact/deal/company screen. 2. The payment recorded from the ledger modal has no contact/company field, so those columns stay null unless the invoice had them (WD-PAY-002 does not copy them), meaning "From" in the ledger is blank and company revenue rollups miss manual payments. 3. Gateway payments take `contact_id` from the order only. 4. Tax collected = sum of `tax_minor` of `paid` invoices, mixing currencies. 5. Own-store invoices link to the order via `wa_order_id` only.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:** Given a manual invoice with contact 9, Then `meta_json.contact_id=9` (WaDesk); the port should expose it as a column and show invoices on the contact timeline.
- **Source refs:** `InvoicesController@storeManual`, `app/Http/Controllers/CrmController.php`, `app/Services/AiCrm/CrmToolkit.php`.
- **Port notes:** real columns `contact_id`, `company_id`, `deal_id`, `quote_id` with composite tenant FKs; emit timeline events.

### WD-INV-029 — AI copilot invoice and payment tools

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-INV-007, WD-PAY-003
- **Summary:** The AI CRM copilot can create an invoice, record a payment, list outstanding invoices and summarise money, using the same engines. Owned by the AI-CRM domain; contract only.
- **Actors & access:** copilot users with `access_ai_agents`; writes use confirm-before-act and are audit-logged by that domain.
- **UX & screens:** chat examples such as "Record a payment of 5000 for invoice INV-0007" (the example number format does not match the real format).
- **Endpoints:** `POST ai-crm/message` (ai-crm domain).
- **Data:** `create_invoice` builds a manual `tax_invoice` draft and calls `issue` then `renderAndSend`; `record_payment` looks up an invoice by exact `invoice_number` in the workspace and calls `PaymentLedger::record` with `contact_id` resolved by name; `outstanding` and `money_summary` read the ledger.
- **Rules & edge cases:** 1. Amounts are divided/multiplied by 100 in some tool paths regardless of currency. 2. Currency default reads the non-existent `invoice_settings.currency` (USD). 3. Subject type/id returned for audit (`invoice`, `payment`).
- **Async & events:** audit entries in the AI-CRM domain.
- **External systems:** LLM provider.
- **Settings:** AI settings.
- **Acceptance criteria:** Given "record 500 for INV-2026-000007", Then a payment row of 500 major is created against that invoice and the balance updates.
- **Source refs:** `app/Services/AiCrm/CrmToolkit.php`.
- **Port notes:** expose invoicing and ledger as typed services, not by re-implementing money math in tools.

### WD-INV-030 — Due date, overdue and payment terms

- **Status:** dead-code
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-INV-007
- **Summary:** Columns and a setting exist but no behaviour does: invoices never get a due date, never become overdue, and no reminders are sent.
- **Actors & access:** n/a.
- **UX & screens:** "Due in (days)" input in settings; nothing else.
- **Endpoints:** none.
- **Data:** `invoices.due_at` (nullable, never written), `invoice_settings.due_days` (0..365, stored, never read).
- **Rules & edge cases:** 1. `due_at` is null on every invoice. 2. The aging report buckets by days since **creation**, not due date. 3. No `overdue` status, no reminder command, no schedule, no notification. 4. No payment terms text. Docs do not promise reminders.
- **Async & events:** none (no command in `app/Console/Commands` or `routes/console.php` touches invoices).
- **External systems:** none.
- **Settings:** `due_days` (inert).
- **Acceptance criteria:** (port) Given `due_days=14`, When an invoice is issued on day 0, Then `due_at` = day 14; when `due_at` passes unpaid, Then derived payment status is `overdue` and a reminder is queued per workspace policy.
- **Source refs:** `InvoiceSettingsController` (validation), migrations `..._create_invoices_table.php` (`due_at`), `..._expand_invoice_settings_and_logs.php` (`due_days`).
- **Port notes:** build as new behaviour (D-02); BullMQ repeatable job for reminders on WhatsApp.

### WD-INV-031 — Void, credit note, activity log, viewed tracking

- **Status:** dead-code
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-INV-007
- **Summary:** Schema and constants exist but there is no code: no void action, no credit note, no invoice activity log writes, no viewed events.
- **Actors & access:** n/a.
- **UX & screens:** none (the platform admin invoice screen has a void for platform subscription orders; that is a different object).
- **Endpoints:** none for workspace invoices.
- **Data:** `invoice_logs(invoice_id, workspace_id, event, detail, meta_json, created_at)`, event vocabulary in the migration comment `issued|rendered|sent|send_failed|resent|viewed|voided`; table has 0 rows and no model; `Invoice::STATUS_VOID`, `STATUS_CREDITED`.
- **Rules & edge cases:** 1. Nothing writes `invoice_logs`. 2. `isImmutable()` is defined but never called; there is no edit route, so immutability is by omission. 3. Deleting an invoice is not possible from the UI or code (no destroy route).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:** (port) Given an issued invoice, When voided, Then status `void`, a log entry is written and the public page shows a void banner; payments cannot be recorded against it.
- **Source refs:** `app/Models/Invoice.php`, migration `2026_08_20_100800_expand_invoice_settings_and_logs.php`.
- **Port notes:** implement `void`, `credit_note` linked to the original invoice, and an append-only invoice event log (issued, rendered, sent, failed, viewed, paid, voided) feeding the activity feed.

### WD-PAY-001 — Payments ledger screen

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-PAY-003
- **Summary:** One page with money collected in 30 days, total outstanding, an aging strip, a recent-payments table and a list of outstanding invoices with a quick "Record" button.
- **Actors & access:** workspace admin; plan `auto_invoice` (GET not blocked on plan miss).
- **UX & screens:** `resources/views/user/payments/index.blade.php`, JS `resources/js/charts/payments-index.js`. Header "Payment ledger" and "+ Record payment". "How to" steps component. KPI cards: "Collected (30d)" and "Outstanding" (with invoice count). Aging card with four buckets (0-30, 31-60, 61-90, 90+ days since issue). Table "Recent payments": Date (`d M Y`), From (company name else contact name else dash), Method pill, Invoice number or dash, Amount (green). Empty: "No payments recorded yet." Right list "Outstanding invoices" (scroll max 420px): number, "due <amount>", and a "Record" link that opens the modal prefilled. Empty: "Nothing outstanding. Nice." Modal described in WD-PAY-002.
- **Endpoints:**

  | Method uri | Route name | Action | Middleware | Request | Response |
  | --- | --- | --- | --- | --- | --- |
  | GET `payments` | `user.payments.index` | `PaymentsController@index` | web, auth, admin role, plan:auto_invoice | none | HTML |

- **Data:** reads `payments` (latest 200 by `paid_at` desc then id desc, with invoice, contact, company), `invoices` (status `issued`, newest 200) with SUM of payments per invoice, last-30-days sum, aging (WD-PAY-004).
- **Rules & edge cases:**
  1. Outstanding list: issued invoices (newest 200) whose total exceeds applied payments.
  2. QUIRK: all amounts on this page are formatted as minor/100 with two decimals (wrong for zero- and three-decimal currencies) and prefixed with `Currency::symbolFor`.
  3. QUIRK: "Collected (30d)" sums raw minor across all currencies (no conversion), and the label currency is the non-existent setting (USD).
  4. QUIRK: the modal's currency default is the same USD fallback.
  5. No filters, search, pagination, export button (the CSV lives under CRM revenue), no per-payment detail, edit or delete.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given three payments, Then they are listed newest paid first.
  - Given an issued invoice with 40 of 100 paid, Then the outstanding list shows "due 60.00".
  - Given no data, Then both empty states are shown.
- **Source refs:** `PaymentsController@index`, `resources/views/user/payments/index.blade.php`, `resources/js/charts/payments-index.js`.
- **Port notes:** add filters, pagination, per-currency totals, CSV; expose `GET /payments` and `GET /payments/summary`.

### WD-PAY-002 — Record payment

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-PAY-003
- **Summary:** An admin records money received, in full or part, optionally against an invoice.
- **Actors & access:** workspace admin; plan gate (mutation blocked with warning).
- **UX & screens:** modal "Record payment": hidden `invoice_id`, note "For invoice <number>" (when opened from the outstanding list), Amount (number step 0.01 min 0.01, required), Currency (3 chars, uppercased, prefilled), Method select (Manual, Cash, Bank, Card, UPI), Paid on (date, default today), Reference (max 191, "Txn id / cheque no."), Note (max 2000), Cancel and Record. Closes on Escape, backdrop click, X, Cancel. From the generic "+ Record payment" button the invoice is blank and **there is no invoice picker**; the i18n hint "pick the invoice" is not backed by a control. From an outstanding row the amount is prefilled with the outstanding balance (2 decimals) and the currency with the invoice currency.
- **Endpoints:**

  | Method uri | Route name | Action | Middleware | Request | Response |
  | --- | --- | --- | --- | --- | --- |
  | POST `payments` | `user.payments.store` | `PaymentsController@store` | web, auth, admin role, plan:auto_invoice | see rules | redirect back, flash "Payment of <amount> recorded." |

- **Data:** writes `payments` and may flip the invoice (WD-PAY-003).
- **Rules & edge cases:**
  1. Validation: `amount` required numeric min 0.001 max 100,000,000; `currency` nullable size 3; `method` nullable in `manual, cash, bank, card, upi, gateway, wa_pay, storefront` (the UI offers five); `paid_at` nullable date; `reference` max 191; `note` max 2000; `invoice_id`, `deal_id`, `contact_id`, `company_id` nullable integers (not tenant-checked).
  2. Invoice lookup is workspace-scoped; an id from another workspace silently resolves to null and the payment is recorded **unlinked** with no error.
  3. Currency = input uppercased, else invoice currency, else USD. Exponent = invoice's `currency_exponent` when linked, else a local zero-decimal list. Minor = round(amount x 10^exp).
  4. QUIRK: the payment currency can differ from the invoice currency; there is no check or conversion, and the balance maths just subtracts minor units.
  5. QUIRK: overpayment is accepted; no warning. A payment can be recorded on a `paid` or any invoice regardless of status.
  6. `paid_at` is a date at midnight (may be in the future); default now.
  7. `source=manual`. `recorded_by` = current user. `wa_order_id` copied from the invoice.
  8. QUIRK: contact/company/deal are never copied from the invoice meta; the modal has no fields for them.
  9. No receipt is sent to the customer and no notification is created.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given invoice total 10000 minor and a payment of 40.00, Then ledger row 4000 and the invoice stays `issued` with balance 6000.
  - Given a second payment of 60.00, Then the invoice becomes `paid`.
  - Given `invoice_id` of another workspace, Then the payment is recorded unlinked (WaDesk) — the port should reject with 422 (D-11).
  - Given amount 0, Then validation error.
- **Source refs:** `PaymentsController@store`, `app/Models/Payment.php`.
- **Port notes:** require currency match with the invoice or explicit FX rate; return the updated invoice; support delete/void of a payment with a reversal entry (absent in WaDesk).

### WD-PAY-003 — Payment ledger engine

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-INV-007
- **Summary:** The single money-in service: records a payment, de-duplicates auto-sourced payments, and marks the invoice paid once the balance clears.
- **Actors & access:** internal; used by `PaymentsController`, `RecordPaymentOnOrderPaid` and the copilot.
- **UX & screens:** none.
- **Endpoints:** none (`PaymentLedger::record/paidMinor/outstandingMinor/syncInvoice/aging`).
- **Data:** writes `payments`; updates `invoices.status` and `paid_at`.
- **Rules & edge cases:**
  1. Idempotency: if `gateway_payment_id` is present and `source != manual`, an existing row with the same `(workspace_id, source, gateway_payment_id)` is returned unchanged (unique index backs it). Manual rows are never deduped.
  2. Stored values: `amount_minor = max(0, int)`; `currency` uppercased (default USD); `method` coerced to the allowed list else `manual`; `source` coerced else `manual`; `paid_at` default now.
  3. After insert, if `invoice_id` is set and the invoice exists in the workspace, `syncInvoice`: only an `issued` invoice flips to `paid` when `total - SUM(all payments for that invoice) <= 0`; `paid_at` is set if empty. Never un-pays or re-opens; a void/credited invoice is untouched.
  4. QUIRK: sums payments of any currency; there are no refunds, negative payments, reversals, deletion, or edits, so a wrong entry cannot be corrected except in the database.
  5. QUIRK: `PaymentLedger::record` does not verify that `invoice_id` belongs to the workspace for the payment row itself (only for the sync).
  6. No locking: two concurrent payments can each see a stale sum; the final state still converges because the check is re-evaluated on each insert, but `paid_at` may reflect either.
  7. `outstandingMinor = max(0, total - paid)`.
- **Async & events:** none (no event emitted on payment recorded or invoice paid).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the same webhook retried with one `gateway_payment_id`, Then a single payment row.
  - Given two payments summing exactly to the total, Then `paid` and `paid_at` set.
  - Given a void invoice, Then it is not re-opened.
  - Given amount_minor -5, Then stored 0.
- **Source refs:** `app/Services/Crm/PaymentLedger.php`, `app/Models/Payment.php`, migration `2026_08_22_000100_create_payments_table.php`.
- **Port notes:** wrap record + sync in one transaction with `SELECT ... FOR UPDATE` on the invoice; add `refunded_minor` or a `payment_refunds` table; emit `payment.recorded` and `invoice.paid` outbox events.

### WD-PAY-004 — Outstanding balance and aging report

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-PAY-003
- **Summary:** Buckets unpaid issued invoices by age.
- **Actors & access:** as ledger screen; also the copilot and CRM revenue report.
- **UX & screens:** four tiles (0-30, 31-60, 61-90, 90+) and KPI "Outstanding".
- **Endpoints:** none (part of `GET payments` and `GET crm/revenue`).
- **Data:** reads up to 2000 newest issued invoices and one grouped payment sum.
- **Rules & edge cases:**
  1. Outstanding per invoice = total minus applied payments, skipping zero.
  2. Age = days from `created_at` to now (not `issued_at`, not due date).
  3. QUIRK (likely bug, confirm with the live copy): `Carbon::now()->diffInDays($created_at)` is signed in Carbon 3, which Laravel 12 ships, so for a past date the value is negative and every invoice falls in the "0-30" bucket. Docs describe four working buckets.
  4. Result currency is the **first** invoice's currency; all buckets sum raw minor across currencies.
  5. Limit 2000 invoices; older unpaid ones are silently excluded.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:** Given invoices aged 5, 45 and 100 days with balances, Then they land in 0-30, 31-60, 90+ respectively (port requirement). Given none outstanding, Then all zeros.
- **Source refs:** `PaymentLedger::aging`.
- **Port notes:** compute by due date (falling back to issue date), per currency, with a SQL query not an in-memory loop.

### WD-PAY-005 — Auto-record payment on order paid

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-PAY-003, WD-PAY-011
- **Summary:** When a store order is confirmed paid through the native checkout, a ledger payment is written and the order's invoice is generated (if auto-send is on) and linked.
- **Actors & access:** system, listener for `WaOrderPaid`.
- **UX & screens:** shows up in the ledger with method `gateway`.
- **Endpoints:** none.
- **Data:** writes `payments` (`source` `wa_pay` when the order has `wa_payment_txn_id`, else `gateway`; `method` = same value).
- **Rules & edge cases:**
  1. Order is reloaded in its workspace; amount = `order.total_minor` (the order total, **not** what the gateway reported); currency from the order; `paid_at` = order `updated_at`; reference and `gateway_payment_id` from `meta_json.gateway_payment_id` else the WA txn id (may be null, in which case idempotency does not apply and a replayed event writes a second row).
  2. Before recording, if the order has no invoice it calls `handleWebhookOrder(order, 'own', null, 'own_store')` (no-op when `auto_send_own` off, plan lacks feature, or already issued). The invoice found after that (if any) is linked via `invoice_id`; an `issued` invoice is then flipped by `syncInvoice`. When auto-send is off no invoice exists yet and the payment is recorded unlinked; a later manual Generate creates an already-`paid` invoice with no linked payment (no reconciliation).
  3. `recorded_by` null (system); `contact_id` from the order; `meta_json.paid_via` = gateway slug.
  4. QUIRK: the paths that set `status=paid` without firing `WaOrderPaid` (manual status change in the orders screen, storefront Razorpay link webhook, Meta WhatsApp Pay which sets `processing`) never create a ledger row, so those revenues are invisible in `/payments`, outstanding, aging and CRM revenue.
  5. All errors are swallowed and logged (`[CRM-PAYMENT]`); the checkout flow is never broken.
  6. Runs synchronously (no queue worker in this deployment).
- **Async & events:** consumes `WaOrderPaid`.
- **External systems:** none.
- **Settings:** `auto_send_own` for the invoice step.
- **Acceptance criteria:**
  - Given a Stripe checkout paid and `auto_send_own=true`, Then a payment row of the order total exists, linked to the new invoice which is `paid`.
  - Given the same event twice with a gateway payment id, Then one payment.
  - Given a manual status change to `paid`, Then no payment row (WaDesk; D-10).
- **Source refs:** `app/Listeners/Commerce/RecordPaymentOnOrderPaid.php`, `app/Events/Commerce/WaOrderPaid.php`, `app/Providers/AppServiceProvider.php` (listener discovery).
- **Port notes:** consume an `order.paid` outbox event; record the gateway-reported amount and currency and compare with the order total; always write a ledger row on any transition to paid with a source tag.

### WD-PAY-006 — Merchant gateway keys

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-PAY-007
- **Summary:** Each workspace stores its own credentials for any of 32 payment gateways so customer payments settle into the merchant's own account. A page lists every gateway with a labelled form per driver and the webhook URL to paste into the gateway dashboard.
- **Actors & access:** workspace admin (store prefix). No plan gate.
- **UX & screens:** `resources/views/user/store/gateways.blade.php` inside the store sidebar. One card per gateway in the catalogue: name, description, status chip (`active` or `off`) and mode chip when configured; the credential inputs come from each driver's `credentialFields()` (password fields never prefilled and show "stored" placeholders; text fields prefilled); gateways with no declared fields show a "key: value" textarea; the webhook URL `<app url>/wa/checkout/webhook/<slug>`; Mode radios Live/Test; Active checkbox; Save; "Remove keys" with confirm. Flash `status` text and the first validation error.
- **Endpoints:**

  | Method uri | Route name | Action | Middleware | Request | Response |
  | --- | --- | --- | --- | --- | --- |
  | GET `store/gateways` | `user.store.gateways.index` | `MerchantGatewaysController@index` | web, auth, admin role | none | HTML |
  | POST `store/gateways/{slug}` | `user.store.gateways.save` | `@save` | same | `creds[key]` strings max 4000, `creds_raw` max 8000, `mode` in live/test, `active` bool | redirect back (or JSON `{ok,message}` for AJAX) with "<Slug> payment settings saved."; 404 unknown slug |
  | POST `store/gateways/{slug}/toggle` | `user.store.gateways.toggle` | `@toggle` | same | none | "Enabled."/"Disabled."; 404 if no row |
  | DELETE `store/gateways/{slug}` | `user.store.gateways.destroy` | `@destroy` | same | none | "Removed." |

- **Data:** `wa_merchant_gateways(workspace_id, storefront_id default 0, slug, credentials (encrypted JSON text), mode live|test, active, sort_order, meta)` unique `(workspace_id, storefront_id, slug)`. This screen writes only `storefront_id=0` (workspace-wide) rows; checkout prefers a storefront-specific row if one exists (none can be created from this UI).
- **Rules & edge cases:**
  1. Slug is stripped to `[a-z0-9_-]` and must be in the driver catalogue.
  2. Save merges: blank inputs keep the stored value; non-blank inputs overwrite or add keys; the legacy textarea parses `key: value` or `key=value` lines (quotes and commas trimmed). If the merged set is empty nothing is encrypted (the row may exist with no credentials).
  3. Credentials are encrypted with the app key (`Crypt`) as one JSON blob; the model hides the ciphertext from serialization. Decrypt failure yields an empty set.
  4. `active` defaults to true on create, otherwise keeps the current value when the checkbox is missing from a request that omits it (a form post with the checkbox unchecked sends nothing and the code keeps the old state; so the box cannot turn a gateway off through Save, only through the toggle route; note `$request->boolean('active', default)`).
  5. A gateway is usable only if active AND at least one credential value is non-empty (`isConfigured`); required fields are not enforced.
  6. Mode `test` maps to the driver's non-live behaviour; the transient gateway carries mode `test` or `live`.
  7. QUIRK: bank-transfer and offline "gateways" appear in the catalogue but cannot confirm payments for customer orders (WD-PAY-007).
  8. The docs and the admin copy talk about "Checkout Settings"; the real merchant screen is this store page.
- **Async & events:** none.
- **External systems:** none (keys are used later).
- **Settings:** none.
- **Acceptance criteria:**
  - Given a save with only `webhook_secret`, Then previously stored keys remain.
  - Given an unknown slug, Then 404.
  - Given the secret field for a stored key, Then it is never echoed back.
  - Given Toggle on a missing row, Then 404.
- **Source refs:** `app/Http/Controllers/MerchantGatewaysController.php`, `app/Models/WaMerchantGateway.php`, `resources/views/user/store/gateways.blade.php`, migration `2026_08_14_000000_create_wa_merchant_gateways_table.php`.
- **Port notes:** target already has `waMerchantGateways` in `packages/db/src/schema/checkout-orders-merchant-payments`; store secrets with envelope encryption (never return them); redact in audit logs; validate required fields per driver on save; show "last webhook received" health.

### WD-PAY-007 — Gateway driver catalog and contract

- **Status:** implemented
- **Priority:** P0
- **Effort:** XL
- **Depends on:** none
- **Summary:** A registry of 32 payment gateway drivers behind one contract; the same classes serve platform billing (admin keys) and merchant checkout (per-workspace keys through a transient gateway object).
- **Actors & access:** internal.
- **UX & screens:** credential field metadata drives the merchant form.
- **Endpoints:** none.
- **Data:** none (driver state lives in `wa_orders.meta_json` for customer orders).
- **Rules & edge cases:**
  1. Slugs: stripe, razorpay, paypal, bank_transfer, offline, mollie, paystack, flutterwave, paytm, square, braintree, twocheckout, coinbase, mercadopago, iyzico, paddle, lemonsqueezy, authorize_net, sslcommerz, instamojo, phonepe, cashfree, payu, midtrans, duitku, xendit, tap, hyperpay, paytr, fondy, skrill, cinetpay, ligdicash.
  2. Contract: `credentialFields()` (static), `initiate(Order, callbackUrl) -> PaymentResult` (redirect URL, inline HTML, or terminal), `handleCallback(payload) -> PaymentResult` (paid, pending, failed), optional `handleWebhook`, `verifyWebhookSignature(rawBody, header)`, `verify(Order)`, plus recurring/subscription hooks used only by platform billing.
  3. `PaymentResult.status` is `pending`, `paid` or `failed` with optional gateway order id, payment id and payload.
  4. Drivers never write to the database; callers persist gateway ids.
  5. Signature verification overrides exist for 16 drivers: AuthorizeNet, Braintree, Cashfree, Coinbase, Flutterwave, Instamojo, LemonSqueezy, Mercadopago, Paddle, Paystack, Razorpay, Square, Sslcommerz, Stripe, Twocheckout, Xendit. The remaining 17 use the base class that **returns true** (no check).
  6. Server-side verification (calls the gateway API) is implemented in `handleCallback` for most (Stripe checks the session, PayPal captures the order, Paystack verifies the reference, Midtrans/Tap/Hyperpay/Cinetpay/Iyzico/Ligdicash call status endpoints) or by signed payload (Razorpay HMAC of order and payment ids, PayU/PayTR/Fondy/Paytm hash checks). Skrill's callback never confirms (returns pending). Bank transfer and offline always return failed `awaiting_admin_verification`. `verify(Order)` is implemented by 10 drivers (AuthorizeNet, Braintree, Duitku, Flutterwave, Mollie, Paystack, Paytm, Phonepe, Square, Twocheckout).
  7. QUIRK (amount): Stripe and Paystack multiply the order amount by 100 unconditionally; PayPal formats with two decimals. For zero-decimal currencies this over-charges 100x (JPY, KRW, VND, CLP...). Other drivers were not audited. Docs claim zero-decimal currencies are handled.
  8. QUIRK (webhook shape): `handleWebhook` defaults to `handleCallback`, which expects the browser-return fields. For Stripe (needs `session_id`) and Razorpay (needs `razorpay_order_id`+signature) the real webhook JSON does not contain them, so those webhooks never mark an order paid; payment is confirmed only by the return page (WD-PAY-010). Paystack has a dedicated `charge.success` webhook handler.
  9. Stripe's signature check passes when no webhook secret is configured or when the header is absent; it also does not check the timestamp tolerance (replays valid for ever).
  10. HTTP timeout 45 seconds per call; no retry logic; no idempotency keys sent to gateways.
- **Async & events:** none.
- **External systems:** each gateway's REST API.
- **Settings:** per-gateway credential fields.
- **Acceptance criteria:**
  - Given a gateway slug outside the registry, Then no driver is created.
  - Given Stripe with a secret configured and a bad signature header, Then verification fails.
  - Given the port's adapter for each priority gateway, Then a conformance test passes initiate, confirm and webhook-verify with provider fixtures.
- **Source refs:** `app/Services/Payment/PaymentGatewayManager.php`, `AbstractGatewayDriver.php`, `PaymentResult.php`, `app/Services/Payment/Drivers/*.php` (read: Stripe, Razorpay, PayPal, Paystack, Bank, Offline and the `handleCallback` of Midtrans, Skrill, PayU, Fondy, Tap, PayTR, Hyperpay, Cinetpay, Iyzico, Ligdicash, Duitku, Mollie, Paytm, PhonePe; the other drivers were not read line by line).
- **Port notes:** use the provider-adapter skill: one adapter per gateway behind `PaymentProvider` (`createCheckout`, `confirm`, `verifyWebhook`, `parseWebhook`). Start with Stripe, Razorpay, PayPal, Paystack and decide the rest by market. Never default signature verification to true.

### WD-PAY-008 — Send hosted checkout link for an order

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-PAY-006, WD-PAY-007
- **Summary:** From an order, the admin picks a configured gateway; WaDesk creates a hosted checkout on the merchant's own account and WhatsApps the link to the customer.
- **Actors & access:** workspace admin (store prefix); no plan gate.
- **UX & screens:** "Send checkout" picker on the order detail (`user.store.orders.show`), listing gateways returned by `availableGateways` with display names. Toast JSON message.
- **Endpoints:**

  | Method uri | Route name | Action | Middleware | Request | Response |
  | --- | --- | --- | --- | --- | --- |
  | POST `store/orders/{id}/send-checkout` | `user.store.orders.send-checkout` | `WaOrderController@sendCheckout` | web, auth, admin role | `gateway` required string max 64 (stripped to `[a-z0-9_-]`) | JSON `{ok:true,url,message:"Checkout link sent."}`; 422 `{ok:false,message}` |

- **Data:** reads `wa_orders` (workspace scoped), `wa_merchant_gateways`; writes the order: `meta_json.gateway_slug`, `meta_json.payment_ref` (`WAO-<orderid>-<6 random upper alnum>`), `meta_json.gateway_order_id`, `meta_json.gateway_payment_id` (when the driver returns them), `payment_method=<slug>` (column is 16 chars), `payment_link=<redirect url>`, `recovery_token` (`tok_` + 20 random chars) if empty; writes an outbound `messages` row.
- **Rules & edge cases:**
  1. Merchant gateway resolution: active rows for the workspace and slug, preferring a storefront-specific row for the order's storefront, then the workspace default (`storefront_id=0`); must have at least one non-empty credential.
  2. Return URL = `/wa/checkout/return/<slug>/<recovery_token>`.
  3. The driver is built from a transient (unsaved) gateway carrying the merchant's keys and mode; an unsaved **adapter order** feeds it: id, reference (`WAO-...`), amount = `total_minor / 100` (major), currency (default USD), customer name, email (or a synthetic `wa<phone>@no-email.invalid`), billing fields from the address JSON, a payer stub user (name, email, phone), no package.
  4. Result without a redirect URL yields 422 with the driver error text; error `gateway_not_configured_for_merchant` shows "Add your <Slug> API keys under Store → Payments first."
  5. The WhatsApp text is "Hi <name>, complete your payment for <amount label> here:" plus the URL, sent from the shop's number when the order is tied to a storefront, via the workspace engine (WABA or Baileys); a failed send returns `ok:false` without the link being unusable.
  6. Each press creates a **new** gateway order/session and overwrites the stored references (an older sent link stays payable but its webhook/return will fail the stored-id cross-check).
  7. QUIRK: the order total can change after the link was created (edits, shipping), the paid amount is not compared to the order (WD-PAY-009).
  8. Amount label uses `FormatSettings::formatIn(total/100)`.
  9. The synthetic buyer email `...@no-email.invalid` is sent to gateways that require one.
- **Async & events:** none.
- **External systems:** the chosen gateway; WhatsApp.
- **Settings:** merchant gateway keys.
- **Acceptance criteria:**
  - Given Stripe keys and an order of 500.00 INR, Then a Checkout Session of 50000 is created and the customer receives the URL.
  - Given no keys, Then 422 with the add-keys message.
  - Given a second press, Then new references replace the old ones.
- **Source refs:** `WaOrderController@sendCheckout`, `app/Services/Checkout/CheckoutDelivery.php`, `app/Services/Checkout/CustomerPaymentService.php` (`createCheckout`, `orderAdapter`, `resolveMerchantGateway`, `availableGateways`).
- **Port notes:** create a `payment_attempts` table (order, gateway, external id, amount, currency, status, expires) instead of stuffing ids into order JSON; support several concurrent attempts.

### WD-PAY-009 — Customer payment webhook

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-PAY-008
- **Summary:** One public endpoint per gateway slug receives the merchant's gateway callback and marks the order paid when the driver says so.
- **Actors & access:** the payment gateway (machine). No session, CSRF exempt, **no rate limit**.
- **UX & screens:** none.
- **Endpoints:**

  | Method uri | Route name | Action | Middleware | Request | Response |
  | --- | --- | --- | --- | --- | --- |
  | POST `wa/checkout/webhook/{slug}` | `wa.checkout.webhook` | `CustomerPaymentWebhookController@handle` | web (CSRF exempt) | raw body JSON; one signature header | **Always HTTP 200** with JSON `{ok,reason|status,order_id}` |

- **Data:** reads `wa_orders`, `wa_merchant_gateways`; on success sets order `status=paid` and meta (WD-PAY-011).
- **Rules & edge cases:**
  1. The slug is stripped to `[a-z0-9_-]` and lower-cased.
  2. Order resolution **before** verification: (a) first regex match `WAO-<digits>-<alnum>` in the raw body selects order by id from **any workspace**; (b) else scan up to 200 latest unpaid orders with `payment_method = slug` and look for a stored `payment_ref` or `gateway_order_id` as a substring of the body. Unresolved returns `{ok:false,reason:order_not_resolved}`.
  3. Signature header taken from the first present of: `Stripe-Signature`, `X-Razorpay-Signature`, `Paypal-Transmission-Sig`, `x-paystack-signature`, `X-CC-Webhook-Signature`, `x-callback-token`, `x-square-hmacsha256-signature`, `verif-hash`. Other gateway headers (LemonSqueezy, Paddle, Cashfree, Mollie, Xendit variants, ...) are not passed, so those drivers receive null.
  2b. The merchant's keys for the matched order's workspace are loaded and the **driver's** `verifyWebhookSignature` runs; failure returns `{ok:false,reason:signature_mismatch}`. QUIRK: unlike platform billing, there is **no fail-closed check for a missing webhook secret**; drivers whose check returns true when no secret is set (Stripe, Razorpay) or has no check at all (17 drivers) accept unsigned bodies.
  4. The driver's `handleWebhook(payload)` decides. Only `status=paid` proceeds; other outcomes return `{ok:true,status:<pending|failed...>}`.
  5. Cross-check: if the order has a stored `gateway_order_id` and the result carries a different one, return `gateway_order_id_mismatch` (guards forged references). Skipped when either is empty.
  6. QUIRK: the amount and currency in the event are never compared with the order; a gateway order created at the old total will still mark the order paid.
  7. Success calls `markPaid` (idempotent: already paid is returned as-is, so the event fires once).
  8. Errors thrown inside apply are caught and returned as `{ok:false,reason:exception}` with HTTP 200 (so gateways do not retry; a transient failure loses the payment confirmation until the customer return page runs).
  9. No event-id dedup ledger; idempotency is the paid-state check.
  10. QUIRK: forging works only for drivers that trust payload fields; the stored-id cross-check narrows it, but a replay of a genuine old webhook (Stripe, no timestamp tolerance) for an order whose references were regenerated is blocked by the id check, while one for the same references is simply a no-op.
- **Async & events:** `WaOrderPaid` (WD-PAY-011).
- **External systems:** the gateway (verification may call back its API).
- **Settings:** merchant gateway secret per workspace.
- **Acceptance criteria:**
  - Given a valid signed Paystack `charge.success` for reference `WAO-12-ABC..._ts`, Then order 12 becomes `paid` once and a second delivery returns paid without a new event.
  - Given a bad signature for a signature-capable driver, Then `{ok:false,reason:signature_mismatch}` with HTTP 200 and no state change.
  - Given a body that references no known order, Then `order_not_resolved`.
  - Given a paid event whose gateway order id differs from the stored one, Then `gateway_order_id_mismatch`.
- **Source refs:** `app/Http/Controllers/CustomerPaymentWebhookController.php`, `CustomerPaymentService::resolveOrderFromWebhook/applyWebhook`, `bootstrap/app.php` (CSRF list), `routes/web.php`.
- **Port notes:** verify the signature **before** touching order state; resolve the order only from a signed attempt id; reject missing secrets (fail closed); persist each webhook event id in a ledger for idempotency; verify amount and currency; return 4xx on signature failure and 5xx on transient failure so gateways retry; rate-limit by IP and slug.

### WD-PAY-010 — Customer return-page confirmation

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-PAY-008
- **Summary:** After paying (or cancelling) the customer lands on a branded page that also confirms the payment server-side, so payment is recognised even when the webhook cannot reach the host.
- **Actors & access:** anyone with the order's `recovery_token`; no auth; **no rate limit**.
- **UX & screens:** `resources/views/checkout/return.blade.php`: card with state badge (paid green "Payment successful", pending amber "Payment processing", cancelled grey, not found), formatted amount, order reference `WA-<id>`, customer name, status, and the hint "Return to your WhatsApp chat for your receipt." `noindex,nofollow`.
- **Endpoints:**

  | Method uri | Route name | Action | Middleware | Request | Response |
  | --- | --- | --- | --- | --- | --- |
  | GET `wa/checkout/return/{slug}/{token}` | `wa.checkout.return` | `CustomerCheckoutReturnController@handle` | web | all gateway query parameters | HTML (200 even for not found) |

- **Data:** reads the order by `recovery_token` (the slug in the URL is ignored for lookup); may mark paid.
- **Rules & edge cases:**
  1. Unknown token returns the "not found" state.
  2. `?cancelled=1` on an unpaid order shows "cancelled" without checking the gateway (this query flag is attacker-controlled but only suppresses confirmation).
  3. Otherwise `confirmFromReturn(order, query)`: already paid returns immediately; gateway slug from `meta_json.gateway_slug` else `payment_method`; loads the merchant driver; builds the adapter with stored gateway order and payment ids; first tries `driver.handleCallback(returnQuery)` (Stripe: reads `session_id`, fetches the session from Stripe and checks `payment_status=paid`; PayPal: captures the order for the `token` query value; Paystack: verifies the `reference`; Razorpay: verifies the HMAC `razorpay_order_id|razorpay_payment_id`), then falls back to `driver.verify(order)` (10 drivers) using the stored id.
  4. **Redirect-trust:** the browser query is never trusted on its own: every successful path either calls the gateway API server-side or verifies an HMAC with the merchant secret. The protection against replaying a different successful payment is the same stored `gateway_order_id` cross-check as in the webhook. Gaps: when no `gateway_order_id` was stored, or the driver returns none, the cross-check is skipped; and the amount is never compared. Skrill and bank/offline never confirm here.
  5. Because `handleCallback` for PayPal **captures** funds, anyone who can GET this URL with a valid approved `token` triggers the capture; the capture only succeeds for an order the buyer approved.
  6. Exceptions are logged and swallowed; the state shown comes from the order status after refresh: `paid` or `pending`.
  7. QUIRK: each GET can cause one or two outbound gateway API calls with the merchant's keys and there is no throttle, so a crawler or attacker with a token can burn gateway rate limits.
  8. Idempotent via `markPaid`.
- **Async & events:** `WaOrderPaid` on first success.
- **External systems:** gateway APIs (outbound).
- **Settings:** none.
- **Acceptance criteria:**
  - Given a Stripe return with a valid `session_id` for this order, Then the order becomes paid and the page shows "Payment successful".
  - Given a `session_id` of another order's session, Then `gateway_order_id_mismatch` and the page shows "processing".
  - Given `?cancelled=1`, Then the page shows cancelled and no gateway call is made.
  - Given an unknown token, Then "Order not found".
- **Source refs:** `app/Http/Controllers/CustomerCheckoutReturnController.php`, `CustomerPaymentService::confirmFromReturn`, `resources/views/checkout/return.blade.php`, `routes/web.php`.
- **Port notes:** rate-limit per token and IP; cache the confirmation result for a few seconds; compare amount and currency from the gateway; treat the return page as display-only and rely on a verified webhook plus a background reconcile job.

### WD-PAY-011 — Mark order paid, WaOrderPaid consumers, receipt

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** none
- **Summary:** The one place a customer order becomes `paid` through the native checkout; it fires `WaOrderPaid` once, which writes the ledger row, issues the invoice, sends a WhatsApp receipt and nudges the source store.
- **Actors & access:** system.
- **UX & screens:** customer receives a WhatsApp text "Payment received — thank you, <name>! Your order WA-<id> for <amount> is confirmed."
- **Endpoints:** none.
- **Data:** order `status=paid`, `meta_json.paid_via`, `meta_json.paid_at` (ISO), `meta_json.gateway_payment_id`.
- **Rules & edge cases:**
  1. Idempotent: already paid is returned without re-firing.
  2. Listeners (synchronous; there is no queue worker): `RecordPaymentOnOrderPaid` (WD-PAY-005, invoice step included) and `SendCheckoutReceipt` (sends the receipt on the shop's number via the workspace engine; failures logged; then for WooCommerce orders pushes status `processing` to the store; for Shopify it only logs that the dashboard sync is pending).
  3. Other effects are driven by the order `updated` observer (HubSpot stage, flow resume via the flows domain).
  4. QUIRK: a listener throws no error up to the webhook; each is individually try/caught.
  5. Order statuses allowed: `new, pending, confirmed, paid, processing, completed, shipped, cancelled`; this path sets only `paid`.
- **Async & events:** `WaOrderPaid(orderId, workspaceId, gatewaySlug)`.
- **External systems:** WhatsApp; WooCommerce REST.
- **Settings:** none.
- **Acceptance criteria:** Given a first paid confirmation, Then one `WaOrderPaid`, one ledger row, one receipt message; given a second confirmation, Then none.
- **Source refs:** `CustomerPaymentService::markPaid`, `app/Events/Commerce/WaOrderPaid.php`, `app/Listeners/Commerce/SendCheckoutReceipt.php`, `app/Services/Checkout/CheckoutDelivery.php`.
- **Port notes:** outbox event `order.paid` with consumers for ledger, invoice, receipt, store sync and flow resume; receipts should link the public invoice.

### WD-PAY-012 — Manual payment link on an order

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** none
- **Summary:** The admin pastes any payment URL on an order and WhatsApps it, or sets it with a status change.
- **Actors & access:** workspace admin (store prefix).
- **UX & screens:** order detail "Payment link" field and status form.
- **Endpoints:**

  | Method uri | Route name | Action | Middleware | Request | Response |
  | --- | --- | --- | --- | --- | --- |
  | POST `store/orders/{id}/payment-link` | `user.store.orders.payment-link` | `WaOrderController@sendPaymentLink` | web, auth, admin role | `payment_link` required url max 1024 | JSON `{ok,message_id}` |
  | PUT `store/orders/{id}` | `user.store.orders.update` | `@updateStatus` | same | `status` in the order statuses, `notes` max 1000, `payment_link` nullable url | redirect |

- **Data:** order `payment_link`; outbound `messages` row.
- **Rules & edge cases:** 1. `sendPaymentLink` stores the URL, sends "Hi <name>, here's your payment link for <total>:" + URL (total shown with a limited symbol map: ₹ $ € £ else the code) from the shop number; returns `ok` based on delivery. 2. `updateStatus` also DMs the buyer on a status change and/or new link. 3. QUIRK: setting status `paid` here does not fire `WaOrderPaid` (WD-INV-012, WD-PAY-005). 4. The URL is not validated against allowed hosts (a merchant can send any link).
- **Async & events:** none.
- **External systems:** WhatsApp.
- **Settings:** none.
- **Acceptance criteria:** Given a valid URL, Then it is stored and delivered; given `notaurl`, Then validation error; given status `paid`, Then no ledger row (WaDesk).
- **Source refs:** `WaOrderController@sendPaymentLink/updateStatus`.
- **Port notes:** owned by the orders domain; ensure status transitions to `paid` always raise the paid event.

### WD-PAY-013 — Razorpay payment-link minting and storefront webhook

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** WD-PAY-011
- **Summary:** A storefront-level alternative: mint a Razorpay payment link with the merchant's own keys and flip the order to paid on the signed webhook.
- **Actors & access:** admin (generate); Razorpay (webhook, CSRF exempt, no rate limit).
- **UX & screens:** "Generate payment link" on the order; Storefront settings hold `payment_provider=razorpay_api` and encrypted `key_id`, `key_secret`, `webhook_secret`.
- **Endpoints:**

  | Method uri | Route name | Action | Middleware | Request | Response |
  | --- | --- | --- | --- | --- | --- |
  | POST `store/orders/{id}/generate-payment-link` | `user.store.orders.generate-payment-link` | `WaOrderController@generatePaymentLink` | web, auth, admin role | none | JSON `{ok,url,sent}`; 422/502 messages |
  | POST `webhooks/storefront-pay` | `storefront.pay.webhook` | `StorefrontPaymentController@razorpayWebhook` | web (CSRF exempt) | raw JSON + `X-Razorpay-Signature` | JSON `{ok}`; 400 bad json/signature; 404 `storefront_unknown` |

- **Data:** order `payment_link`, `meta_json.payment_link_id`; on paid: `status=paid`, `meta_json.paid_via=razorpay_link`, `razorpay_payment`, `razorpay_plink`.
- **Rules & edge cases:**
  1. Minting: requires the storefront provider `razorpay_api` with keys; amount = `total_minor` as is (minimum 100) in the order currency (default INR); `accept_partial=false`; reference `WAORD-<id>`; notes carry `wa_order_id`, `storefront_id`, `workspace_id`; no Razorpay notification (WhatsApp delivery instead); callback URL = the storefront order page `/order/<recovery_token>` on the custom domain or `/s/<slug>`.
  2. Webhook: locate the storefront from the **unverified** payload notes (`storefront_id`), verify HMAC-SHA256 of the raw body with **that storefront's** webhook secret, **fail-closed** if no secret or header; handles `payment_link.paid`, `payment.captured`, `order.paid`; other events acknowledged and ignored.
  3. QUIRK (cross-tenant): the order id comes from the payload (`notes.wa_order_id` or the numeric part of `reference_id`) and is loaded with a global `find`, with no check that the order belongs to the storefront or workspace that was verified. A merchant who controls any storefront and its webhook secret can sign a webhook that marks **another workspace's** order paid.
  4. The webhook sets `paid` directly (not `markPaid`), so no `WaOrderPaid`, no ledger row, no receipt, no invoice trigger (only the sweeper later); idempotent only through the paid check.
  5. No amount verification.
- **Async & events:** none.
- **External systems:** Razorpay API.
- **Settings:** storefront payment config.
- **Acceptance criteria:** Given a valid signed `payment_link.paid`, Then the order is paid; given a missing secret, Then 400; given notes referencing an order of another workspace, Then (WaDesk) it is flipped; the port must reject (order must match the verified workspace).
- **Source refs:** `app/Services/Storefront/StorefrontPaymentService.php`, `StorefrontPaymentController.php`, `WaOrderController@generatePaymentLink`.
- **Port notes:** fold into the generic payment-attempt model with a Razorpay adapter; enforce `order.workspace_id == verified workspace`.

### WD-PAY-014 — WhatsApp Pay settle path

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** WD-PAY-011
- **Summary:** Meta's native in-chat payment (India only) for orders: the admin sends an `order_details` request, Meta posts payment status to the existing WhatsApp webhook, and the order settles. Documented as an overlap; owned by the store/WABA domains.
- **Actors & access:** admin with plan `access_whatsapp_pay` (config screens and request action).
- **UX & screens:** `store/payments` screen (configs, region check, reconcile), per-order "Request payment on WhatsApp".
- **Endpoints:** `GET store/payments`, `POST store/payments`, `DELETE store/payments/{id}`, `POST store/orders/{id}/whatsapp-pay` (`WhatsAppPayController`); the inbound Meta event handled by `WhatsAppPayService::applyPaymentWebhook`.
- **Data:** `workspace_payment_configs(config_name, payment_type in razorpay|payu|billdesk|zaakpay, country IN, currency INR, meta encrypted)`, order fields `wa_payment_reference_id`, `wa_payment_status`, `wa_payment_txn_id`, `wa_payment_config_id`.
- **Rules & edge cases:** 1. The webhook value is treated as a hint and re-confirmed through Meta's lookup API when a config exists; without a config it trusts the webhook. 2. Status mapping: captured, failed, refunded, else pending; never downgrades a captured order except for refund. 3. Captured sets order status `processing` (not `paid`) and triggers auto-invoice, an `order_paid` outbound webhook to the workspace and a WhatsApp status message; it does not fire `WaOrderPaid`, so no ledger row (WD-PAY-005). 4. A cache lock on the reference id (10 s) serialises duplicates. 5. Reconcile sweep runs on page view, once per 60 s per workspace.
- **Async & events:** outbound `order_paid` workspace webhook.
- **External systems:** Meta Graph API.
- **Settings:** the config name must exist in WhatsApp Manager.
- **Acceptance criteria:** Given a captured payment, Then the order moves to `processing`, an invoice is issued if auto-send is on, and the ledger has no row (WaDesk).
- **Source refs:** `app/Http/Controllers/WhatsAppPayController.php`, `app/Services/Waba/WhatsAppPayService.php`, `app/Models/WorkspacePaymentConfig.php`.
- **Port notes:** treat as one provider adapter; write a ledger row on capture.

### WD-PAY-015 — Online invoice payment, refunds, receipts

- **Status:** docs-only
- **Priority:** P1
- **Effort:** L
- **Depends on:** WD-PAY-003
- **Summary:** The documentation advertises paying an **invoice** through a generated link, partial online payments, receipts and reconciliation; the code supports none of these for invoices.
- **Actors & access:** n/a.
- **UX & screens:** the public invoice page has no pay button; the detail page has no "payment link"; docs "Payment Links" says start from an order or an invoice.
- **Endpoints:** none exist.
- **Data:** none.
- **Rules & edge cases:** 1. What exists: gateway checkout for **orders** (WD-PAY-008..011), manual ledger entries (WD-PAY-002). 2. Documented but absent: payment link for an invoice; "invoice flips to paid on gateway success" for invoices not tied to an order; refunds (docs say to refund in the gateway dashboard and then "adjust the record", but there is no adjust or refund feature); payment receipts to the customer other than the order-paid text; partial online payments (the Razorpay link sets `accept_partial=false`). 3. Docs promise the logo and support email come from "Checkout Settings"; the code reads `invoice_settings`. 4. Docs example number `INV-0007` does not match the real format. 5. Docs promise "no gaps"; see WD-INV-008.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:** (port) Given an invoice, When the admin clicks "Create payment link", Then a gateway checkout for the outstanding balance is created; a verified webhook records a payment and updates the invoice; a refund creates a negative ledger entry and reopens the invoice per policy; the public page shows a Pay button and a paid stamp.
- **Source refs:** `Documentation/pages/commerce/auto-invoicing.html`, `Documentation/pages/commerce/payment-links.html`, `resources/views/public/invoice.blade.php`.
- **Port notes:** attach `payment_attempts` to invoices as well as orders; support partial amounts with a minimum; build refunds as ledger reversals.

### WD-PAY-016 — Platform subscription gateway callbacks (contrast)

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-PAY-007
- **Summary:** The routes literally named `payment/*` serve the **platform's own** plan and wallet purchases, not workspace invoices. They are specified by the billing domains; the differences matter for the port.
- **Actors & access:** buyers and gateways.
- **UX & screens:** none here.
- **Endpoints:**

  | Method uri | Route name | Action | Middleware | Notes |
  | --- | --- | --- | --- | --- |
  | POST `payment/webhook/{gateway}` | `payment.webhook` | `CheckoutController@webhook` | web | verified per driver |
  | GET/POST `payment/callback/{gateway}` | `payment.callback` | `CheckoutController@callback` | web | browser return |
  | GET `payment/paddle/checkout/{order}` | `payment.paddle.checkout` | `CheckoutController@paddleCheckout` | web | Paddle overlay |

- **Data:** `orders`, `payment_gateways`, `subscriptions` (platform tables, other domains).
- **Rules & edge cases:** 1. Admin-owned gateway keys (`payment_gateways`), not merchant keys. 2. Webhook **fails closed** (403) when the gateway has a signing field that is blank unless the setting `payment.require_webhook_secret` is off; the customer webhook in WD-PAY-009 does not have this guard. 3. The callback resolves the order from a query hint (`session_id`, `razorpay_order_id`, `token`, `txnid`...), PayU `udf2`, or the session, then calls the driver's `handleCallback`. 4. Subscription events run first in the webhook. 5. Tables, routes and screens are not part of this domain's coverage except as listed.
- **Async & events:** subscription renewals driven by webhooks.
- **External systems:** same gateways.
- **Settings:** `payment.require_webhook_secret`.
- **Acceptance criteria:** Given a gateway with a blank webhook secret, When a webhook arrives, Then platform billing returns 403 (this is the behaviour the merchant path should copy).
- **Source refs:** `app/Http/Controllers/CheckoutController.php` (`callback`, `webhook`, `webhookSecretMissing`), `routes/web.php`.
- **Port notes:** reuse the same provider adapters with different credential scopes (platform vs workspace).

### WD-PAY-017 — Ledger CSV and revenue report reads

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-PAY-003
- **Summary:** The CRM revenue pages export payments and compute collected, outstanding, aging and tax figures. Owned by the CRM domain; contract only.
- **Actors & access:** `plan:access_sales_pipeline`.
- **UX & screens:** `user/crm/revenue.blade.php`, `revenue_pdf.blade.php`.
- **Endpoints:** `GET crm/revenue`, `GET crm/revenue.csv`, `GET crm/revenue.pdf`.
- **Data:** reads `payments` and `invoices`.
- **Rules & edge cases:** 1. CSV columns: Date, Amount, Currency, Method, Source, Invoice, Contact, Company, Reference (default last 90 days). 2. Collected by month for the last six months groups on `paid_at`. 3. A `mixedCurrency` flag warns when more than one payment currency exists, but sums are still raw. 4. The default currency reads the nonexistent `invoice_settings.currency`.
- **Async & events:** none.
- **External systems:** dompdf for the PDF.
- **Settings:** none.
- **Acceptance criteria:** Given payments in two currencies, Then the report shows the mixed-currency warning.
- **Source refs:** `app/Http/Controllers/CrmController.php`.
- **Port notes:** report per currency; derive base-currency totals only with stored FX.

## Data model

All tables are MySQL InnoDB, utf8mb4. Amounts are `bigint` minor units. None has foreign keys (only indexes); tenant isolation is by `workspace_id` filtering in code. Row counts in the reference DB are 0 (invoices, payments, sales_docs).

### invoices (WD-INV-001..031)

| Column | Type | Null / default | Notes |
| --- | --- | --- | --- |
| id | bigint unsigned PK | | |
| workspace_id | bigint unsigned | no | index; also composite indexes with status, send_status, issued_at |
| user_id | bigint unsigned | yes | issuing user; owner for webhook-created |
| source | varchar(24) | no | `woocommerce`, `shopify`, `own`, `manual` |
| doc_type | varchar(16) | `tax_invoice` | `tax_invoice`, `receipt`, `proforma`, `credit_note` (unused) |
| wa_order_id | bigint unsigned | yes | index; link to `wa_orders`, no FK |
| external_order_id | varchar(64) | yes | Woo/Shopify id; null for own/manual |
| external_order_number | varchar(64) | yes | printed as "Order:" |
| series | varchar(48) | no | e.g. `INV-2026` |
| invoice_number | varchar(64) | no | e.g. `INV-2026-000123`; unique with workspace |
| seq | int unsigned | no | unique `(workspace_id, series, seq)` |
| status | varchar(16) | `issued` | `issued`, `paid`, `void`, `credited` (only first two used) |
| send_status | varchar(16) | `pending` | `pending, rendering, ready, sending, sent, send_failed, skipped` |
| send_attempts | tinyint unsigned | 0 | cutoff 5 |
| send_reason | varchar(191) | yes | error code |
| sent_at | timestamp | yes | duplicate-send guard |
| trigger | varchar(16) | `manual` | `on_placed, on_paid, on_fulfilled, manual` (informational) |
| issued_at | timestamp | yes | now() at issue |
| due_at | timestamp | yes | never written |
| paid_at | timestamp | yes | |
| currency | varchar(3) | `USD` | |
| currency_exponent | tinyint unsigned | 2 | |
| subtotal_minor, discount_minor, shipping_minor, tax_minor, total_minor | bigint | 0 | |
| tax_inclusive | tinyint(1) | 0 | label only |
| buyer_name | varchar(191), buyer_email varchar(191), buyer_phone varchar(32) | yes | |
| billing_json, shipping_json | json | yes | `{address}` |
| seller_snapshot_json | json | yes | frozen seller block |
| notes | text | yes | never written |
| pdf_disk varchar(32), pdf_path varchar(255), pdf_sha256 char(64), pdf_bytes int unsigned | | yes | |
| delivery_channel varchar(16), delivered_at, wa_message_id varchar(128), send_error text | | yes | |
| public_token | varchar(48) | no | unique |
| meta_json | json | yes | `note, contact_id, company_id, deal_id, native_source, from_sales_doc, sales_doc_number, quota_flag, woo_status, financial_status` |
| created_at, updated_at | timestamp | yes | |

Unique keys: `(source, external_order_id, doc_type)`, `(workspace_id, invoice_number)`, `(workspace_id, series, seq)`, `public_token`. Read by every INV feature, CRM revenue and the ledger; written by WD-INV-007/014/018/019/020 and WD-PAY-003.

### invoice_items

`id`, `invoice_id` (index), `sort` smallint (0), `description` varchar(255), `sku` varchar(64) null, `hsn_sac` varchar(16) null, `qty` decimal(12,3) default 1, `unit_price_minor`, `line_subtotal_minor`, `line_discount_minor` (stored, not printed), `tax_rate` decimal(6,3) null (percent), `tax_amount_minor`, `tax_code` varchar(24) null (CGST/SGST/IGST/VAT/GST; never populated), `currency` varchar(3), `meta_json` json null, timestamps. No FK, so deleting is not cascaded.

### invoice_tax_summary

`id`, `invoice_id` (index), `tax_label` varchar(24), `rate` decimal(6,3) null, `base_minor`, `amount_minor`, timestamps. The model sets table name explicitly (singular "summary"). Labels longer than 24 characters (Shopify titles) would overflow in strict mode.

### invoice_number_sequences

`id`, `workspace_id`, `series` varchar(48), `next_seq` int unsigned (1), timestamps; unique `(workspace_id, series)`. Row-locked during allocation.

### invoice_settings (one row per workspace, unique `workspace_id`)

Columns: `enabled` (false, cosmetic), `numbering_prefix` ('INV'), `proforma_prefix` ('PRO'), `fy_reset` (true), `tax_label` varchar(24), `default_tax_rate` decimal(6,3), `tax_inclusive_default` (unused), `hsn_default` varchar(16) (unused), `logo_path`, `brand_color` varchar(9), `footer_note` text, `support_email`, `auto_send_woocommerce|shopify|own` (false), `trigger_woocommerce|shopify|own` ('on_paid', inert), `send_sender` varchar(48) (`waba:<id>`/`device:<id>`), `template_id_whatsapp` bigint, `template_status` ('none' then `pending|approved|rejected`, never refreshed), `meta_json`, `seller_name` varchar(191), `seller_address` text, `seller_tax_id` varchar(64), `seller_reg_no` varchar(64), `seller_phone` varchar(40), `seller_extra_json` json `[{label,value}]`, `signature_path`, `signature_label` varchar(64), `show_signature` (false), `due_days` smallint unsigned (inert). **There is no `currency` column**, although four places read `->currency`.

### invoice_webhook_events

`id`, `source` varchar(24), `delivery_id` varchar(128), `topic` varchar(64) null, `external_order_id` varchar(64) null, `received_at`, timestamps; unique `(source, delivery_id)`. Never pruned.

### invoice_logs (dead)

`id`, `invoice_id` (index), `workspace_id` (index), `event` varchar(32), `detail` varchar(255), `meta_json`, `created_at`. No model, no writers.

### payments (WD-PAY-001..005, 017)

| Column | Type | Notes |
| --- | --- | --- |
| id | bigint PK | |
| workspace_id | bigint unsigned, index | |
| invoice_id, deal_id, contact_id, company_id, wa_order_id | bigint unsigned null, each indexed | all optional links, no FK |
| amount_minor | bigint | stored >= 0 |
| currency | varchar(8) | default USD |
| method | varchar(32) | `manual, cash, bank, card, upi, gateway, wa_pay, storefront` |
| source | varchar(24) | `manual, gateway, wa_pay, storefront` |
| paid_at | timestamp null, indexed | |
| reference | varchar(191) | txn id / cheque number |
| note | text | |
| gateway_payment_id | varchar(191) null | idempotency key |
| recorded_by | bigint unsigned null | user id, null = system |
| meta_json | json | `paid_via` |
| created_at, updated_at | | |

Unique `(workspace_id, source, gateway_payment_id)` (null ids never collide, so manual rows duplicate freely). No refunds, no status, no soft delete.

### wa_merchant_gateways (WD-PAY-006)

`id`, `workspace_id` (index), `storefront_id` bigint unsigned default 0, `slug` varchar(64), `credentials` text (encrypted JSON, hidden), `mode` varchar(16) default `live`, `active` (1), `sort_order` int, `meta` json, timestamps; unique `(workspace_id, storefront_id, slug)`.

### wa_orders (owned by checkout-orders; fields used here)

`total_minor` (bigint unsigned, x100 convention), `shipping_minor`, `tax_minor`, `tax_inclusive`, `tax_lines_json`, `discount_minor`, `currency_code` (3, default INR), `payment_method` varchar(16) (default `prepaid`; set to the gateway slug), `status` varchar(16) (`new` default), `payment_link` varchar(1024), `recovery_token` varchar(64) indexed, `meta_json` (`gateway_slug`, `payment_ref`, `gateway_order_id`, `gateway_payment_id`, `paid_via`, `paid_at`, `payment_link_id`), `wa_payment_reference_id/status/txn_id/config_id`, `storefront_id`, `shopify_order_id`, `woo_order_id`. Indexed by `(workspace_id, status, created_at)`.

### workspace_payment_configs and sales_docs

`workspace_payment_configs` (WhatsApp Pay config names) and `sales_docs` (proposals/estimates, `invoice_id` set on convert) are read here but owned by other domains.

### Plan columns

`packages.auto_invoice` (bool 0), `auto_invoice_max_monthly` (int 0 = unlimited), `auto_invoice_branding` (bool, unused). The `packages` table is empty on the seed DB.

## Cross-domain contracts

Consumes:
- **checkout-orders-merchant-payments**: `wa_orders` (status, totals, items, `recovery_token`, meta), `WaOrderPaid` event, order status changes, `wa_merchant_gateways`, shop sender fields for WhatsApp messages.
- **shopify-woocommerce**: webhook handlers call `InvoiceService.handleWebhookOrder(order, source, deliveryId, topic, rawPayload)` after their own signature verification; delivery-id headers `X-WC-Webhook-Delivery-ID`, `X-Shopify-Webhook-Id`.
- **whatsapp-cloud-api-waba / whatsapp-devices-baileys / message-templates**: `TemplateSender`, `TemplateClient`, `WhatsAppDispatcher.sendRaw`, `wa_templates`, template status webhook, inbox conversation mirror.
- **plans-subscriptions-trials**: `auto_invoice` feature, `auto_invoice_max_monthly`, plan overrides, the trial hard gate patterns.
- **platform-payment-gateways**: driver classes and registry shared with merchant checkout.
- **workspaces-teams-tenancy**: `current_workspace_id`, role hierarchy (owner > admin > manager > agent > viewer), media storage helper.
- **localization-translation**: i18n keys (below).

Exposes:
- **sales-docs-proposals**: `InvoiceService.issue(draft)` and `renderAndSend`; consumed by `SalesDocsController::convert` (WD-INV-027).
- **ai-copilot-lead-finder**: `create_invoice`, `record_payment`, `outstanding`, `money_summary` tools call the engines (WD-INV-029).
- **crm / deals-pipelines / companies-projects-tasks**: tables `invoices` and `payments` for dashboard counts, revenue, CSV and PDF (WD-INV-028, WD-PAY-017); `payments.deal_id|contact_id|company_id` links.
- **flow-runtime-engine**: flow variable `invoice_url` is built from `order.meta_json.invoice_url` or `order.payment_link`, **not** from the invoices table; a flow cannot currently send the new public invoice URL.
- **notifications-activity-audit**: nothing emitted (no audit entries, notifications or outbound webhooks for invoices or manual payments). The only outbound webhook in this area is `order_paid` from WhatsApp Pay.
- **admin-console**: the platform admin screens at `admin/invoices*` (mark paid, void, delete) and `account/invoices/{id}` are for **platform subscription orders** and are not this domain.

i18n keys (resources `lang/*.json`, English-key strings, about 80 relevant): UI strings in the invoice list, settings, builder, ledger and checklist (for example "Auto invoices", "Finish setup to auto-send", "Paid orders without an invoice", "No invoices yet. Generate one from a paid order above...", "Create & submit invoice template", "Payment ledger", "No payments recorded yet.", "Nothing outstanding. Nice."). Flash messages from the controllers (for example "Invoice <n> generated.", "Invoice settings saved.", "Invoice re-sent.", "Auto-invoice is not enabled on your plan.") are **hard-coded English** and not translated. The PDF and public invoice labels (Tax Invoice, Receipt, Bill to, Subtotal...) are hard-coded English; only the seller block uses `__()` for "Reg. No".

## Open questions & quirks

Resolved by reading: the reference menu names Recurring Invoices, Credit Notes, Tax Rates and Sales Orders; none of these exist (see Overview table).

Unverified or ambiguous (static analysis only; confirm with `wadesk-verify-parity` before relying on them):
- Aging bucket bug from signed `diffInDays` (WD-PAY-004).
- Whether `InvoiceService::resend` always has a sender injected (the constructor parameter is nullable; the container normally supplies the concrete class).
- Per-driver zero-decimal handling for gateways other than Stripe, Paystack and PayPal.
- Exact set of drivers whose `handleCallback` trusts payload fields without a server call (only a subset of the 33 drivers was read line by line: Stripe, Razorpay, PayPal, Paystack, Bank, Offline plus the `handleCallback` of 14 others).
- The `Currency` model and `FormatSettings` helper were not opened; display rules for the ledger and return page are inferred from call sites.
- `Woo/Shopify` webhook handlers' own signature verification belongs to another domain and was not audited here.
- Whether any admin can enable `auto_invoice` through the UI: no path found in the plan form code, `Package` model or seeders (WD-INV-024).

### Differences to decide

| # | WaDesk behaviour | Recommendation |
| --- | --- | --- |
| D-01 | Only `issued`/`paid` statuses; `sent` is a separate delivery status; no draft, viewed, partial, overdue, void | Store `status` in `draft, issued, void` (plus `credited` once credit notes exist), keep `delivery_status` separate, and **derive** payment status (`unpaid, partially_paid, paid, overdue`) from payments and `due_at`. Record `viewed_at` on the public page. |
| D-02 | `due_at` and `due_days` are dead; no overdue, no reminders | Implement: set `due_at = issue + due_days` (settings default, per-invoice override), derive overdue, and run a daily BullMQ reminder job on WhatsApp with a per-workspace on/off and cadence. |
| D-03 | Reads `invoice_settings.currency` (missing) so default currency is always USD | Add a workspace currency setting (use `workspaces.currency`) and read it everywhere; fail validation if neither is set. |
| D-04 | Display always divides by 100; three exponent tables; no 3-decimal currencies in builder | One ISO-4217 table in a shared money package; render with `Intl.NumberFormat`; never copy WaDesk's /100 display. |
| D-05 | Own-store/manual generate is not idempotent (duplicate invoices) | Unique `(workspace, wa_order_id, doc_type)` and return the existing invoice. |
| D-06 | Totals are not reconciled; no-lines fallback subtotal ignores tax | Recompute and assert `subtotal - discount + shipping + tax = total` on every issue; reject or flag mismatches. |
| D-07 | Receipt/proforma hide tax rows while including tax in the total | Always print tax rows when `tax_minor > 0`; keep the HSN/Tax% columns for tax invoices only. |
| D-08 | Receipts share the tax-invoice counter (gaps) | Separate series per doc type (configurable), because tax regimes require gap-free tax invoice numbers. |
| D-09 | Settings checkbox semantics reset `fy_reset` and triggers on every save; several settings are inert | PATCH semantics; remove inert settings or implement them (`enabled` must gate issuing; trigger values must work or be dropped). |
| D-10 | Manual `paid` status and storefront/WhatsApp-Pay paths skip the ledger and event | Any transition to paid (any source) must emit one `order.paid` event, write one ledger row and issue the invoice. |
| D-11 | Payment can reference a foreign `invoice_id`, other-currency payments and overpayments are silently accepted | Validate tenant and currency match, warn or block on overpayment, and add payment delete/void with reversal. |
| D-12 | Monthly invoice cap only flags | Enforce (reject with a clear error) or surface the flag in the UI; pick one and test it. |
| D-13 | Number gap risk from separate allocation transaction | Allocate and insert in one transaction. |
| D-14 | Plan gate does not block GET (soft paywall) and nothing grants `auto_invoice` in the admin UI | Decide: hard-block API reads when the plan lacks the feature, and expose the feature in plan configuration. |
| D-15 | Public `/i/{token}`: no pay button, no expiry, no revoke, no noindex; public PDF can trigger a send | Add Pay, expiry/revocation, noindex and private caching; make PDF read-only. |
| D-16 | PDF is frozen forever and depends on live logo/colour at first render | Snapshot branding at issue; allow admin re-render creating a new PDF version with an audit entry. |
| D-17 | No email delivery though `buyer_email` is collected | Add an email channel (provider adapter) with the same PDF and public link, or drop the field from the form. |
| D-18 | Customer payment webhook resolves orders before signature, accepts unsigned drivers when no secret is set, returns 200 on failure, no amount check, no replay ledger, no throttle | Resolve only from a signed payment attempt, require a secret per gateway (fail closed), verify amount and currency, store event ids, return 4xx/5xx appropriately, rate-limit. |
| D-19 | Stripe and Razorpay webhooks never confirm (wrong payload shape); confirmation relies on the browser return | Parse each provider's real webhook event (`checkout.session.completed`, `payment.captured`); keep the return page display-only. |
| D-20 | Storefront Razorpay webhook can flip another workspace's order | Require order workspace equals the verified storefront's workspace. |
| D-21 | Stripe/Paystack multiply by 100 regardless of currency; docs claim zero-decimal support | Use per-currency exponents in every adapter, with tests for JPY, KWD and INR. |
| D-22 | Aging by creation date and likely always bucket 0-30; mixed-currency sums | Compute by due date (fallback issue date) per currency with correct date maths. |
| D-23 | Return endpoint GET triggers gateway API calls without throttling | Throttle per token/IP and cache results. |
| D-24 | No audit, notification or outbound webhook for invoice or payment events | Emit `invoice.issued`, `invoice.sent`, `invoice.paid`, `payment.recorded`, `payment.failed` through outbox; write audit entries. |
| D-25 | CRM links stored only in `meta_json` and not shown on contacts/deals | Real columns plus timeline entries. |

## Port decisions

Recorded by the API port of invoices and payments, widened by the owner's later direction: the product targets **small businesses that
bill customers** (not WaDesk's store receipts). The default was to **fix clear bugs and keep intended behaviour**; every place the
port differs from WaDesk is listed with the "Differences to decide" row it settles. Code: `apps/api/src/modules/crm/invoicing`,
`apps/api/src/infra/providers/invoice-payments`, contracts in `packages/contracts/src/invoicing/`, migrations
`20261007100000` .. `20261008100500` (`inv_*`), endpoints in `docs/api/sales-invoices-payments.md`, tests in
`apps/api/test/{unit,integration,e2e}/invoicing`.

### Decided as recommended (fixes)

| Diff # | Decision | Where |
| ------ | -------- | ----- |
| D-01 | Stored status is `draft`, `issued`, `void`; the payment status (`unpaid`, `partially_paid`, `paid`) is kept by the database from the ledger and the credit notes (trigger `invoice_refresh_payment_state`), never written by the API; the status clients show is derived. Delivery (`sent`) is a separate field and event. | WD-INV-025 |
| D-02 | `due_date` is real: an explicit date, or terms in days from the issue date, or the workspace default. Overdue is derived on every read from the due **date** in the workspace's time zone (an invoice due today is not overdue). A worker sweep stamps `overdue_at` once per invoice and raises `invoice.overdue` (with the workspace's reminders flag); no reminder is sent here, the consumer is the delivery adapter. | WD-INV-030 |
| D-03 | The workspace's invoicing profile has a currency; an invoice's currency defaults to it and is validated as ISO 4217. | WD-INV-013 |
| D-04 | One money module (`@crm/contracts`: `currencyExponent`, `parseMajor`, `minorToMajor`) and one tax engine (`@crm/tax`); the exponent is stored on every document (JPY 0, KWD 3). Nothing divides by 100. | WD-INV-013 |
| D-05 | Idempotent creation from a source: a quote converts once (unique `quote_id`, the second call returns the first invoice); an order or a schedule period is claimed under a unique key. | WD-INV-004, 027 |
| D-06 | Totals are server-computed and the database refuses a row whose figures do not add up (`chk_invoices_totals`: total = subtotal − discount + tax added + shipping). Discounts spread by largest remainder, so the parts add up exactly. | WD-INV-007 |
| D-07 | Every document type prints its tax rows whenever tax is charged; the summary is one row per tax (CGST and SGST are two rows). | WD-INV-014 |
| D-08 | One series per document type (`INV`, `PRO`, `RCT`, `CRN`, `SO`), configurable prefix, padding and yearly reset (fiscal-year aware). | WD-INV-008 |
| D-09 | The profile is PATCH (absent keeps); every setting that exists does something or is gone. | WD-INV-022 |
| D-10 | Every payment, from any source, is a ledger row plus `payment.recorded` plus the invoice's recomputed state, in one transaction. A manual "mark paid" does not exist: record a payment. | WD-PAY-003 |
| D-11 | A payment must belong to an invoice of the same workspace and currency (`PAY_CURRENCY_MISMATCH`); an over-payment is `422 PAY_OVERPAYMENT` unless `allowOverpayment: true` (held as credit); the ledger is append-only, a correction is a refund (a negative linked entry). | WD-PAY-002, 003 |
| D-12 | No monthly cap in this product (a quota is a plan feature of the plan module, not of invoicing). | WD-INV-024 |
| D-13 | The number is allocated in the issuing transaction from a locked per-series counter (`allocate_series_seq`); a rollback gives it back; two concurrent issuers never share one. | WD-INV-008 |
| D-14 | The plan gate is the `sales_pipeline` feature, hard: every route, reads included, is `422 PLAN_FEATURE_LOCKED` without it. Permissions are `record.invoices.*`, `record.payments.*`, `record.tax-rates.*` with record scope on the people of the record; the buyer's page does not depend on the seller's plan. | WD-INV-024 |
| D-15 | The public page has pay-now, an expiry, revoke and regenerate, `noindex`, private caching, and is read-only (viewing sends nothing). Only the token's SHA-256 is stored for lookup; an AES-GCM copy lets staff copy the link. | WD-INV-016, 017 |
| D-16 | The PDF is rendered on demand from the stored document; the seller block (name, address, tax id, bank details, brand) is **snapshotted at issue**, so an issued invoice always renders the same. No file is stored. | WD-INV-014 |
| D-17 | Email is a channel of `send` (`invoice.sent` with the channel; a delivery adapter consumes it). A buyer email is required to send by email (`INV_NO_RECIPIENT`). | WD-INV-018, 019 |
| D-18 | The webhook is signature-first and fail-closed: the endpoint resolves only to a connection and its secret; the signature over the raw body is verified before anything else is read; every signature problem is the same 401; the event id is claimed once (idempotent); the attempt is looked up inside the verified tenant; amount and currency must equal the attempt's; the redirect never marks anything paid. Rate limited. | WD-PAY-009 |
| D-19, D-20, D-21 | The gateway is a port; the shipped implementations are manual transfer and a generic HMAC receiver. Real provider adapters (Stripe, Razorpay, ...) copy the HMAC skeleton and must use `currencyExponent` (no `×100`). Not built here: the platform's payment-provider work. | WD-PAY-007, 013 |
| D-22 | Aging is by due date (issue date when none), per currency, buckets current, 1-30, 31-60, 61-90, 90+; totals are never summed across currencies. | WD-PAY-004 |
| D-23 | Public reads and pay are rate limited per address and token. | WD-PAY-010 |
| D-24 | Every write emits its outbox event and an audit row in the writer's transaction (list in `docs/api/sales-invoices-payments.md`). | WD-INV-031 |
| D-25 | CRM links are real columns (contact, company, deal, owner, quote, order, recurring schedule) with composite foreign keys; `GET /contacts/:id/invoices` and `GET /deals/:id/invoices`; timeline entries on the invoice. | WD-INV-028 |

### Decisions of this port (not in the difference table)

- **Draft stage and issue.** An invoice is created as a draft (no number, no link) and issued explicitly. An issued invoice is frozen by
  the database (a trigger lists the few fields that may still move); void keeps the number. Drafts are deletable; issued ones never.
- **Rounding.** One rule shared with sales-docs: per-line half-up on the taxable amount (`calculateDocument`), the document discount
  spread by largest remainder, shipping outside discount and tax. A quote converts to an invoice with the same total to the minor unit
  (the conversion re-prices and compares, and refuses if they differ).
- **Exact percentages.** Tax percentages are `numeric(7,4)` (`rate_percent`), exact; `rate_bp` is a *generated* mirror for readers that
  want basis points. (Migration `20261008100500` restores the 0-100 range checks that dropping the old columns removed.)
- **Country-aware tax.** Totals and tax come from `@crm/tax`. `taxMode: "auto"` decides the taxes from the profile and the buyer
  (CGST+SGST vs IGST, reverse charge, ...) and stores the reasons in the invoice's meta; `taxMode: "rates"` uses the rates the lines
  name. Seller and buyer tax ids, place of supply, reverse charge, HSN/SAC per line and legal notes are stored on the invoice.
  Presets seed `tax_rates` per country.
- **Public lookups without `privileged()`.** `invoice_by_public_token` and `invoice_gateway_by_endpoint` are SECURITY DEFINER
  functions with a pinned `search_path`, executable by the application role only, returning the minimum, called with the plain
  connection. No HTTP path uses `privileged()`.
- **Credit notes.** Not a tax-invoice type: their own table, series (`CRN`), lines and PDF. Cap enforced by a trigger under the
  invoice's row lock. The cash settlement is computed **before** the note flips to issued and refunds newest payment first; once
  issued the note's `refunded_minor` is frozen. A note that returned cash cannot be voided (the refund stands in the ledger).
  `paid + credited >= total` makes an invoice `paid`. An invoice with issued credit notes cannot be voided.
- **Recurring.** Template = the priced content as the invoice body (re-priced at each run with the tax rates of that day, so a rate
  change applies to future invoices). Idempotency key = (schedule, period index). A failed period is recorded and skipped, not retried
  forever. Resume skips what fell while paused. The run uses the schedule's owner and the system actor.
- **Sales orders.** Numbered at creation (`SO-`); deleting a draft leaves a gap (an order is not a statutory document). Prices are
  frozen at confirmation. Partial invoicing carries the order's tax snapshots; an amount discount is billed proportionally with the last
  part taking the exact remainder. Shipping is billed once. A document discount of the source offer is folded into the lines (its tax
  is re-priced by the shared engine, so an order made from a discounted offer can differ from the offer by a rounding cent in tax).
  Voiding or deleting an order invoice returns its quantities in the same transaction; such an invoice's lines cannot be edited.
- **No store auto-invoicing.** WaDesk's order-to-invoice mapping (WD-INV-004, 009-012) and the WhatsApp order flows (WD-PAY-005, 008, 012,
  014) belong to the commerce port, which will call `InvoicesService.createDraftIn` / `PaymentsService.recordIn`.

### Not built here (and why)

| Item | Status |
| ---- | ------ |
| Delivery of invoices (email, WhatsApp) and overdue reminders | The events (`invoice.sent`, `invoice.overdue`) and the public link exist; a delivery adapter consumes them. |
| Real payment-provider adapters (Stripe, Razorpay, Paystack, ...) and money movement on refund | The port and the webhook skeleton exist; a refund records that cash was returned, it does not call a provider. |
| WhatsApp invoice template provisioning (WD-INV-023), AI copilot tools (WD-INV-029) | Belong to the WhatsApp and AI ports. |
| Ledger CSV export and revenue report reads (WD-PAY-017) | The list, summary, aging and outstanding endpoints exist; CSV export is a presentation job. |
| Credit notes for tax authorities' e-invoicing formats (India IRN, EU e-invoice), TDS/TCS handling | The data (tax ids, place of supply, HSN/SAC) is stored; the formats are a separate adapter. |

## Coverage

```json wadesk-coverage
{
  "routes": [
    "GET invoices",
    "POST invoices",
    "GET invoices/create",
    "POST invoices/manual",
    "GET invoices/settings",
    "POST invoices/settings",
    "POST invoices/template",
    "GET invoices/{id}",
    "GET invoices/{id}/pdf",
    "POST invoices/{id}/resend",
    "GET store/invoices",
    "GET i/{token}",
    "GET i/{token}/pdf",
    "GET payments",
    "POST payments",
    "GET store/gateways",
    "POST store/gateways/{slug}",
    "POST store/gateways/{slug}/toggle",
    "DELETE store/gateways/{slug}",
    "POST store/orders/{id}/send-checkout",
    "POST store/orders/{id}/payment-link",
    "POST store/orders/{id}/generate-payment-link",
    "POST wa/checkout/webhook/{slug}",
    "GET wa/checkout/return/{slug}/{token}",
    "POST webhooks/storefront-pay",
    "POST payment/webhook/{gateway}",
    "GET payment/callback/{gateway}",
    "POST payment/callback/{gateway}",
    "GET payment/paddle/checkout/{order}",
    "GET store/payments",
    "POST store/payments",
    "DELETE store/payments/{id}",
    "POST store/orders/{id}/whatsapp-pay"
  ],
  "controllers": [
    "app/Http/Controllers/InvoicesController.php",
    "app/Http/Controllers/InvoiceSettingsController.php",
    "app/Http/Controllers/PaymentsController.php",
    "app/Http/Controllers/MerchantGatewaysController.php",
    "app/Http/Controllers/CustomerPaymentWebhookController.php",
    "app/Http/Controllers/CustomerCheckoutReturnController.php",
    "app/Http/Controllers/StorefrontPaymentController.php",
    "app/Http/Controllers/WhatsAppPayController.php"
  ],
  "services": [
    "app/Services/Invoice/InvoiceDraft.php",
    "app/Services/Invoice/InvoicePdfRenderer.php",
    "app/Services/Invoice/InvoiceSender.php",
    "app/Services/Invoice/InvoiceService.php",
    "app/Services/Invoice/InvoiceSweeper.php",
    "app/Services/Invoice/InvoiceTemplateProvisioner.php",
    "app/Services/Invoice/Mappers/OwnStoreInvoiceMapper.php",
    "app/Services/Invoice/Mappers/ShopifyInvoiceMapper.php",
    "app/Services/Invoice/Mappers/WooInvoiceMapper.php",
    "app/Services/Crm/PaymentLedger.php",
    "app/Services/Checkout/CustomerPaymentService.php",
    "app/Services/Checkout/CheckoutDelivery.php",
    "app/Services/Storefront/StorefrontPaymentService.php",
    "app/Services/Payment/AbstractGatewayDriver.php",
    "app/Services/Payment/PaymentGatewayManager.php",
    "app/Services/Payment/PaymentResult.php",
    "app/Support/MoneyFormat.php"
  ],
  "models": [
    "Invoice",
    "InvoiceItem",
    "InvoiceNumberSequence",
    "InvoiceSetting",
    "InvoiceTaxSummary",
    "InvoiceWebhookEvent",
    "Payment",
    "WaMerchantGateway"
  ],
  "tables": [
    "invoices",
    "invoice_items",
    "invoice_logs",
    "invoice_number_sequences",
    "invoice_settings",
    "invoice_tax_summary",
    "invoice_webhook_events",
    "payments",
    "wa_merchant_gateways"
  ],
  "views": [
    "resources/views/invoices/pdf.blade.php",
    "resources/views/public/invoice.blade.php",
    "resources/views/user/invoices/_detail.blade.php",
    "resources/views/user/invoices/_panel.blade.php",
    "resources/views/user/invoices/_settings_form.blade.php",
    "resources/views/user/invoices/create.blade.php",
    "resources/views/user/invoices/index.blade.php",
    "resources/views/user/invoices/settings.blade.php",
    "resources/views/user/invoices/show.blade.php",
    "resources/views/user/payments/index.blade.php",
    "resources/views/user/store/invoices.blade.php",
    "resources/views/user/store/gateways.blade.php",
    "resources/views/checkout/return.blade.php"
  ],
  "commands": [],
  "permissions": [],
  "middleware": [
    "app/Http/Middleware/EnforcePlanFeature.php",
    "app/Http/Middleware/EnsureWorkspaceRole.php",
    "app/Http/Middleware/EnsureTrialActive.php"
  ],
  "node_files": [],
  "js_assets": [
    "resources/js/charts/invoices-create.js",
    "resources/js/charts/payments-index.js"
  ],
  "misc_files": [
    "app/Events/Commerce/WaOrderPaid.php",
    "app/Listeners/Commerce/RecordPaymentOnOrderPaid.php",
    "app/Listeners/Commerce/SendCheckoutReceipt.php"
  ],
  "config_files": [],
  "doc_pages": [
    "Documentation/pages/commerce/auto-invoicing.html",
    "Documentation/pages/commerce/payment-links.html"
  ],
  "feature_map": {
    "WD-INV-001": ["GET invoices"],
    "WD-INV-002": ["GET store/invoices"],
    "WD-INV-003": ["GET invoices/{id}"],
    "WD-INV-004": ["POST invoices"],
    "WD-INV-005": ["GET invoices/create"],
    "WD-INV-006": ["POST invoices/manual"],
    "WD-INV-015": ["GET invoices/{id}/pdf"],
    "WD-INV-016": ["GET i/{token}"],
    "WD-INV-017": ["GET i/{token}/pdf"],
    "WD-INV-019": ["POST invoices/{id}/resend"],
    "WD-INV-021": ["GET invoices/settings"],
    "WD-INV-022": ["POST invoices/settings"],
    "WD-INV-023": ["POST invoices/template"],
    "WD-PAY-001": ["GET payments"],
    "WD-PAY-002": ["POST payments"],
    "WD-PAY-006": ["GET store/gateways", "POST store/gateways/{slug}", "POST store/gateways/{slug}/toggle", "DELETE store/gateways/{slug}"],
    "WD-PAY-008": ["POST store/orders/{id}/send-checkout"],
    "WD-PAY-009": ["POST wa/checkout/webhook/{slug}"],
    "WD-PAY-010": ["GET wa/checkout/return/{slug}/{token}"],
    "WD-PAY-012": ["POST store/orders/{id}/payment-link"],
    "WD-PAY-013": ["POST store/orders/{id}/generate-payment-link", "POST webhooks/storefront-pay"],
    "WD-PAY-014": ["GET store/payments", "POST store/payments", "DELETE store/payments/{id}", "POST store/orders/{id}/whatsapp-pay"],
    "WD-PAY-016": ["POST payment/webhook/{gateway}", "GET payment/callback/{gateway}", "POST payment/callback/{gateway}", "GET payment/paddle/checkout/{order}"]
  }
}
```
