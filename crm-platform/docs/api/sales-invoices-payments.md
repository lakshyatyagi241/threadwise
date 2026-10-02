# API: invoices, payments, credit notes, recurring invoices and sales orders

Domain `inv` (WD-INV-001 .. 031, WD-PAY-001 .. 005, 009, 015, 017, plus the owner-direction extensions: credit notes, recurring
invoices, sales orders and the invoicing profile). Base path `/v2`. Errors are `application/problem+json` with a stable `code` and a
`requestId`; the codes this domain adds are `INV_*`, `TAX_RATE_*`, `PAY_*`, `CN_*`, `SO_*` and `REC_*` in `@crm/contracts`
`common/errors.ts`. Request and response shapes live in `packages/contracts/src/invoicing/`. Live docs: `/docs`. Every id on the wire
is a uuid; money is a **decimal string in major units** (`"1234.50"`), with `amountsMinor` (bigint as string) beside it where a client
wants exact arithmetic. Decisions where the port differs from WaDesk: "Port decisions" in
`docs/wadesk-port/inventory/sales-invoices-payments.md`.

This is a sales-invoicing product, not WaDesk's store receipts: invoices are made by hand, from an accepted proposal or estimate, from a
sales order or by a recurring schedule; they are numbered when **issued**; an issued invoice is frozen; money moves through an
append-only payment ledger; mistakes are corrected with credit notes, never by editing.

All authenticated routes need a staff bearer token, the plan's **sales pipeline** (`422 PLAN_FEATURE_LOCKED` otherwise, reads included)
and the capability in brackets. "scope" is the caller's record scope over the **people of the record** (owner or creator): `own`, `team`
or `all`. A record outside the scope is `404`, never `403`. `POST` routes accept an `Idempotency-Key`.

## Capabilities

| Key                                                                         | Scope      | Grants                                                            |
| --------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------- |
| `record.invoices.read`                                                      | yes        | list, counts, get, events, pdf, a contact's and a deal's invoices |
| `record.invoices.create`                                                    | no         | create a draft, duplicate                                         |
| `record.invoices.update`                                                    | yes        | edit, regenerate and revoke the public link                       |
| `record.invoices.issue`                                                     | yes        | issue, send                                                       |
| `record.invoices.void` / `.delete`                                          | yes        | void an issued invoice, delete a draft                            |
| `record.invoices.settings`                                                  | no         | the invoicing profile and the online-payment connection           |
| `record.payments.read`                                                      | yes        | ledger, summary, aging, outstanding, receipts                     |
| `record.payments.create`                                                    | yes        | record a payment                                                  |
| `record.payments.refund`                                                    | yes        | refund                                                            |
| `record.tax-rates.read` / `.create` / `.update` / `.delete`                 | no         | tax rates and country presets                                     |
| `record.credit-notes.read` / `.create` / `.issue` / `.void` / `.delete`     | yes (read) | credit notes                                                      |
| `record.recurring-invoices.read` / `.create` / `.update` / `.delete`        | yes (read) | recurring schedules                                               |
| `record.sales-orders.read` / `.create` / `.update` / `.invoice` / `.delete` | yes (read) | sales orders                                                      |

The Admin preset holds all of them. The Agent preset (sign-up) creates and reads/edits its own invoices, records payments on them,
reads tax rates, and creates sales orders; issuing, voiding, deleting, refunding, credit notes and the settings stay with the roles a
workspace widens.

## Invoices

| Method and path                             | Capability                    | Notes                                                                                                                                                                                                                                                                            |
| ------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /invoices`                             | invoices.read                 | cursor pagination (microsecond cursor), newest first (`order=asc` too). Filters: `status` (comma list of `draft, issued, partially_paid, paid, overdue, void`), `docType`, `q`, `contactId`, `companyId`, `dealId`, `ownerId`, `mine`, `currency`, `issuedFrom/To`, `dueFrom/To` |
| `GET /invoices/counts`                      | invoices.read                 | counts per derived status (same filters as the list)                                                                                                                                                                                                                             |
| `POST /invoices`                            | invoices.create               | a priced **draft**: no number, no link                                                                                                                                                                                                                                           |
| `GET /invoices/:id`                         | invoices.read                 |                                                                                                                                                                                                                                                                                  |
| `PATCH /invoices/:id`                       | invoices.update               | `rowVersion` required. A draft is edited whole; once issued only due date, notes, terms, reference, owner, links and contact details move (`409 INV_NOT_DRAFT`). Lines of an invoice made from a sales order are fixed (`409 INV_ORDER_LINKED`)                                  |
| `DELETE /invoices/:id`                      | invoices.delete               | drafts only (`409 INV_NOT_DELETABLE`); gives order quantities back                                                                                                                                                                                                               |
| `POST /invoices/:id/issue`                  | invoices.issue                | number from the locked per-series allocator, due date, public link, frozen seller block, in one transaction                                                                                                                                                                      |
| `POST /invoices/:id/send`                   | invoices.issue                | `{channel: email \| whatsapp \| link}`; raises `invoice.sent` (a delivery adapter consumes it)                                                                                                                                                                                   |
| `POST /invoices/:id/void`                   | invoices.void                 | `{reason}`; refused while payments (`INV_HAS_PAYMENTS`) or credit notes (`INV_HAS_CREDITS`) stand                                                                                                                                                                                |
| `POST /invoices/:id/duplicate`              | invoices.create               | a new draft from the stored lines                                                                                                                                                                                                                                                |
| `POST /invoices/:id/public-link/regenerate` | invoices.update               | new token, optional expiry; the old link stops                                                                                                                                                                                                                                   |
| `POST /invoices/:id/public-link/revoke`     | invoices.update               |                                                                                                                                                                                                                                                                                  |
| `GET /invoices/:id/events`                  | invoices.read                 | the activity timeline                                                                                                                                                                                                                                                            |
| `GET /invoices/:id/payments`                | payments.read                 |                                                                                                                                                                                                                                                                                  |
| `POST /invoices/:id/payments`               | payments.create               |                                                                                                                                                                                                                                                                                  |
| `GET /invoices/:id/pdf`                     | invoices.read                 | `application/pdf`, rendered from the stored document                                                                                                                                                                                                                             |
| `GET /contacts/:contactId/invoices`         | invoices.read + contacts.read | the contact detail page                                                                                                                                                                                                                                                          |
| `GET /deals/:dealId/invoices`               | invoices.read + deals.read    | the deal detail page                                                                                                                                                                                                                                                             |

**Status.** Stored: `draft`, `issued`, `void`. Payment status (kept by the database from the ledger and the credit notes): `unpaid`,
`partially_paid`, `paid`. The status clients show is derived: `void` / `paid` / `overdue` (issued, open, due date before today in the
**workspace's** calendar) / `partially_paid` / `issued`. `daysOverdue` is returned while overdue.

**Lines and pricing.** Each line: `description`, `sku`, `hsnSac`, `qty` (up to 4 decimals), `unitPrice`, `discount` (`{kind: percent |
amount, value}`), `taxRateId` (absent = the workspace default rate, `null` = no tax). `taxMode: "rates"` (default) prices with the picked
rates; `taxMode: "auto"` lets `@crm/tax` decide from the profile's country, the buyer's country/place of supply/tax id and the
`supplyType` (India CGST+SGST vs IGST, EU reverse charge, UK, US, Canada); the reasons come back in `taxExplanation`
(`reasons`, `warnings`, `documentNotes`, `taxFree`). A document discount, shipping (never discounted or taxed), reverse charge, buyer
tax id, place of supply and legal notes are fields of the invoice. **One pricing function** (`calculateDocument` of `@crm/tax`) prices
everything: per-line half-up rounding, inclusive or exclusive tax, several taxes on one line (CGST + SGST), the document discount spread
by largest remainder, the currency's own exponent (JPY 0, KWD 3). The database re-checks that the totals add up.

```json
{
  "id": "…",
  "number": "INV-2026-000012",
  "docType": "tax_invoice",
  "source": "manual",
  "status": "overdue",
  "storedStatus": "issued",
  "paymentStatus": "partially_paid",
  "overdue": true,
  "daysOverdue": 3,
  "currency": "INR",
  "currencyExponent": 2,
  "amounts": {
    "subtotal": "1000.00",
    "discount": "0.00",
    "shipping": "0.00",
    "tax": "180.00",
    "taxAdded": "180.00",
    "total": "1180.00",
    "paid": "500.00",
    "refunded": "0.00",
    "balance": "680.00",
    "credit": "0.00",
    "credited": "0.00"
  },
  "amountsMinor": { "…": "same keys, bigint strings" },
  "buyer": {
    "name": "…",
    "email": "…",
    "phone": "…",
    "address": "…",
    "taxId": "…",
    "country": "IN"
  },
  "seller": { "name": "…", "taxId": "…", "bankDetails": {} },
  "taxRegime": "gst",
  "placeOfSupply": "IN-MH",
  "reverseCharge": false,
  "legalNotes": null,
  "taxExplanation": null,
  "lines": [
    {
      "id": "…",
      "description": "…",
      "qty": "1",
      "unitPrice": "1000.00",
      "taxName": "GST 18%",
      "taxRate": "18",
      "taxComponents": [
        { "type": "CGST", "rate": "9", "amount": "90.00" },
        { "type": "SGST", "rate": "9", "amount": "90.00" }
      ],
      "amounts": {
        "gross": "…",
        "discount": "…",
        "net": "…",
        "docDiscountShare": "…",
        "tax": "…",
        "total": "…"
      }
    }
  ],
  "taxSummary": [
    { "name": "CGST 9%", "rate": "9", "base": "1000.00", "tax": "90.00", "inclusive": false }
  ],
  "publicLink": {
    "token": "…",
    "path": "/i/…",
    "expiresAt": null,
    "revokedAt": null,
    "active": true
  },
  "rowVersion": 4
}
```

The detail also names where the invoice came from, so a page can link to it: `quote: {id, number, kind: proposal | estimate}`, `salesOrder: {id, number}` and `recurring: {id, name}` (each `null` when it does not apply).

`balance` = total − paid − credited (never below 0); `credit` is the over-payment held as credit (paid + credited − total).

## Payments (the ledger)

| Method and path                 | Capability      | Notes                                                                                                                                      |
| ------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /payments`                 | payments.read   | cursor paginated. Filters: `invoiceId`, `contactId`, `companyId`, `dealId`, `kind` (payment, refund), `method`, `currency`, `from/to`, `q` |
| `POST /payments`                | payments.create | same body as `POST /invoices/:id/payments` plus `invoiceId`                                                                                |
| `GET /payments/summary`         | payments.read   | collected in the last N days, refunded, outstanding, overdue: **per currency**, never summed across currencies                             |
| `GET /payments/aging`           | payments.read   | open balances by days past the **due date** (issue date when none): current, 1-30, 31-60, 61-90, 90+, per currency                         |
| `GET /payments/outstanding`     | payments.read   | what each contact owes, biggest debt first                                                                                                 |
| `GET /payments/:id`, `/receipt` | payments.read   | the receipt carries its own `RCT-` number                                                                                                  |
| `POST /payments/:id/refund`     | payments.refund | a **negative linked** ledger entry; default amount: everything not refunded                                                                |

The ledger is append-only (the database refuses UPDATE and DELETE of an entry). A payment above the balance is `422 PAY_OVERPAYMENT`
unless the body sets `allowOverpayment: true` (the excess is held as credit); another currency than the invoice's is
`422 PAY_CURRENCY_MISMATCH`; a refund above what is left of the payment is `422 PAY_REFUND_EXCEEDS`; a refund cannot be refunded
(`409 PAY_NOT_REFUNDABLE`). Recording and refunding update the invoice's paid / payment status in the same transaction.

## Tax rates

`GET/POST /tax-rates`, `GET/PATCH/DELETE /tax-rates/:id`, `POST /tax-rates/:id/default`, `GET /tax-rates/presets?country=IN`,
`POST /tax-rates/presets`. A rate has an exact `rate` percent (up to 4 decimals: Quebec QST is `9.975`), `type`
(`gst, cgst, sgst, igst, vat, sales_tax, hst, pst, qst, …`), `inclusive`, an optional compound `components` list (CGST 9 + SGST 9 = 18;
the parts must add up), `country`, `defaultHsnSac`, an effective window and `isActive`. One default per workspace and it must be
active. Deleting a rate keeps the invoice lines that used it (they hold a snapshot). **Presets** (`@crm/tax` `taxPresetsForCountry`)
list the standard rates of a country (India GST slabs with CGST+SGST, EU VAT, UK, US, Canada) and `POST /tax-rates/presets` applies
the ones you pick, idempotently by name.

## Invoicing profile and online payment

`GET/PATCH /invoice-settings` (the profile: seller name, address, country, state, tax id and registration number, extra statutory
fields, bank details, logo, brand colour, numbering prefixes and padding, yearly reset and fiscal-year start month, default due days,
default terms and footer note, currency, tax regime, overdue reminders on/off; each save is a PATCH, absent keeps).
`GET/PUT /invoice-settings/gateway` (the online-payment connection: `mode`, `enabled`, `webhookSecret` write-only, `webhookPath`).
Numbering is a series per document type (`INV`, `PRO`, `RCT`, `CRN`, `SO` prefixes, configurable), allocated under a row lock when the
document is issued; a rollback gives the number back, so a series has no gaps.

## The buyer's page, PDF and pay-now (public, unauthenticated)

`GET /public/invoices/:token` (JSON), `/:token/print` (a printable HTML page: escaped, CSP, `noindex`, `Cache-Control: private`),
`/:token/pdf`, `POST /public/invoices/:token/pay`. A separate controller, **rate limited** per address and token (reads 120/min, pay
20/min). The token is 256 random bits; only its SHA-256 is looked up; it can expire and be revoked; an unknown, expired and revoked
token are the same `404`. Opening it records a view (first/last view, count, `invoice.viewed`). `pay` goes through the
**gateway port** (`INVOICE_PAYMENT_GATEWAYS`): `manual` (bank transfer instructions from the profile; a person records the payment when
the money arrives) and `hmac_generic` (a signed-webhook skeleton real adapters copy). Pay returns instructions or a checkout URL and
an `attemptId`; **a redirect never marks anything paid**.

`POST /public/webhooks/invoice-payments/:endpointId` (the connection's `webhookPath`): signature header
`X-Invoice-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`, 300 s tolerance. Order of work: the endpoint resolves to a
connection and its secret (a SECURITY DEFINER function that reads nothing about invoices); **the signature is verified over the raw
body before anything else is looked up**; an unknown endpoint, a disabled connection, no secret, a bad, missing or stale signature are
the same `401 PAY_SIGNATURE_INVALID`. Then the event id is claimed (**idempotent**: a repeat is `duplicate`), the attempt is looked up
inside the verified tenant, and the **amount and currency are compared** with the attempt (a mismatch is recorded and announced, applied
to nothing). The payment goes through the same ledger code as a staff payment (`source: gateway`).

## Credit notes

| Method and path                 | Capability          | Notes                                                                                                |
| ------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------- |
| `GET /credit-notes`             | credit-notes.read   | cursor paginated; `invoiceId`, `contactId`, `status`, `q`                                            |
| `POST /credit-notes`            | credit-notes.create | a **draft** against an issued invoice                                                                |
| `GET /credit-notes/:id`, `/pdf` | credit-notes.read   |                                                                                                      |
| `PATCH /credit-notes/:id`       | credit-notes.create | draft only, `rowVersion` required                                                                    |
| `POST /credit-notes/:id/issue`  | credit-notes.issue  | takes its `CRN-` number, reduces the invoice balance, records returned cash for `settlement: refund` |
| `POST /credit-notes/:id/void`   | credit-notes.void   | only if no cash was returned (`409 CN_HAS_REFUND`)                                                   |
| `DELETE /credit-notes/:id`      | credit-notes.delete | drafts only                                                                                          |

Create: `{invoiceId, reason (return, price_adjustment, billing_error, cancellation, goodwill, other), settlement (balance | refund),
note, full: true}` or `lines: [{invoiceLineId, qty?}]` (part or all of a line: the credit takes the amount the buyer was actually
charged for it, net of its discounts, with the line's own tax; the last part of a line takes exactly what is left of it) or free-form
`{description, amount, taxRateId?}`. Credit notes of an invoice can never add up to more than the invoice (`422 CN_EXCEEDS_INVOICE`,
details name what is still creditable; the database trigger re-checks under the invoice row lock, so two people cannot both win).
`balance` only reduces what the buyer owes; `refund` also returns the cash the credit makes surplus (paid − what is owed after the
credit), newest payment first, as negative ledger entries that name the payments. An invoice whose paid + credited reach the total is
`paid`. An invoice with issued credit notes cannot be voided.

## Recurring invoices

`GET/POST /recurring-invoices`, `GET/PATCH/DELETE /recurring-invoices/:id`, `POST /:id/pause`, `/:id/resume`, `/:id/run`,
`GET /:id/runs`. A schedule is `{name, frequency (day | week | month | year), interval, startDate, endDate?, maxRuns?, mode (draft |
issue | issue_send), sendChannel, template | fromInvoiceId}`; the template is the body of an invoice without dates (everything an
invoice carries can recur) or a copy of an existing invoice. The template is validated and priced when the schedule is made. Monthly and
yearly periods keep the start day and clamp to the month end without drifting (31 Jan, 28 Feb, 31 Mar). The response carries
`nextRunDate`, the next five `upcoming` dates, `runCount`, `failureCount`, `lastRunAt` and the `amount` the template prices to.

**The worker** (`RecurringInvoiceSweepService`, every 5 minutes, worker process only) finds schedules whose next date has come in
their workspace's calendar and runs each in that workspace's context. Generation is **idempotent**: the pair (schedule, period index)
is unique in the run history and claimed first, so a retried or concurrent run cannot make two invoices for one period; the invoice,
its run row and the schedule's advance are one transaction. A missed period is caught up, one invoice per period, up to 12 per pass
(a start date more than 12 periods back is `422 REC_START_TOO_OLD`). A period that cannot be generated (a template that no longer
prices) is recorded as `failed` with the reason and skipped; the other schedules go on. Resume skips the periods that fell while
paused. Editing replaces the template for future invoices only.

## Sales orders

`GET/POST /sales-orders`, `GET /sales-orders/counts`, `GET/PATCH/DELETE /sales-orders/:id`, `POST /:id/confirm`, `/:id/invoice`,
`/:id/fulfil`, `/:id/cancel`. estimate / proposal (accepted) → sales order → one or more invoices → fulfilment.

Create with `quoteId` (an **accepted** proposal or estimate; its buyer, links, currency and lines; its document discount is folded
into the lines; `409 SO_QUOTE_NOT_ACCEPTED`, and one live order per offer, `409 SO_QUOTE_TAKEN`) or with `lines`. An order is a priced
draft with its own `SO-` number until **confirmed**; then its prices are frozen (the database enforces it) and only its progress moves.
Each line has `qty`, `qtyInvoiced`, `qtyFulfilled`, `qtyToInvoice`. `invoicingStatus` (`not_invoiced`, `partially_invoiced`,
`invoiced`) and `fulfilmentStatus` (`unfulfilled`, `partially_fulfilled`, `fulfilled`) move independently; the order is `closed` when
all is billed and delivered.

`POST /:id/invoice` `{all | lines: [{lineId, qty?}], issue?, issueDate?, dueDate?, paymentTermsDays?, includeShipping?}` returns
`{order, invoice}`: a draft invoice (issued when `issue: true`) with exactly the quantities named at the order's prices and tax
snapshots; shipping is billed once, with the first invoice. More than what is left is `422 SO_QUANTITY_EXCEEDS`; nothing left is
`422 SO_NOTHING_TO_INVOICE`. The order's lines are locked and the database caps invoiced and fulfilled at ordered, so concurrent
callers cannot bill a line twice. **Voiding or deleting** such an invoice gives its quantities (and shipping) back to the order.
`POST /:id/fulfil` records deliveries (same cap). `POST /:id/cancel` is refused while a live invoice exists (`409 SO_HAS_INVOICES`).

## Events (outbox, written in the writer's transaction with the audit row)

`invoice.created | updated | issued | sent | viewed | paid | partially_paid | overdue | voided | deleted`, `payment.recorded |
refunded | rejected`, `tax_rate.created | updated | deleted`, `invoice_settings.updated`, `invoice_gateway.updated`,
`credit_note.created | updated | issued | voided | deleted`, `recurring_invoice.created | updated | paused | resumed | generated |
failed | ended | deleted`, `sales_order.created | updated | confirmed | invoiced | fulfilled | cancelled | deleted`. Payloads carry ids
and the figures a consumer decides on; never the public token. `invoice.overdue` comes from the **overdue sweep** (every 10 minutes,
worker process): it stamps each invoice once however many workers run and carries whether the workspace wants reminders.

## Tests

`apps/api/test/unit/invoicing` (money and rounding per currency, tax pricing, numbering and the allocator format, status machine,
aging, gateways and signature, rendering, schedule dates, order progress), `apps/api/test/integration/invoicing` (forced RLS as the
application role, every constraint and trigger, ledger invariants, numbering under concurrency, the credit-note cap, one run per
period, frozen orders), `apps/api/test/e2e/invoicing` (everything above through HTTP).
