# API: proposals and estimates

Domain `salesdoc` (TW-PROP-001 .. 030, TW-EST-001 .. 009). Base path `/v2`. Errors are `application/problem+json` with a stable `code`
and a `requestId`; the codes this domain adds are the `SALESDOC_*` ones in `@crm/contracts` `common/errors.ts` (listed below). Request
and response shapes live in `packages/contracts/src/sales-docs/`. Live docs: `/docs`. Every id on the wire is a uuid. Decisions where the
port differs from Reference: "Port decisions" in `docs/threadwise-port/inventory/sales-proposals-estimates.md`.

A proposal and an estimate are **one engine**: the same table, routes and rules, told apart by `kind` (`proposal` | `estimate`). The kind
is a field of the body and a filter of the list, never part of a path, so an id can never be applied to the wrong kind (Reference's `{id}`
routes ignored the type).

All authenticated routes need a staff bearer token, the plan's **sales pipeline** (`422 PLAN_FEATURE_LOCKED` otherwise, reads included) and
the capability in brackets. "scope" means the caller's record scope over **who owns or created the document**: `own` is "owned by me or
created by me", `team` adds people who share a team with me, `all` is the workspace. A document outside the scope is `404`, never `403`.
`POST` routes accept an `Idempotency-Key` (replays the first answer); `send` and the two conversions should always carry one.

## Capabilities

| Key                          | Scope | Grants                                                                                                           |
| ---------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------- |
| `record.sales-docs.read`     | yes   | list, counts, get, timeline, revisions, print, templates and settings (read), a contact's and a deal's documents |
| `record.sales-docs.create`   | no    | create, duplicate                                                                                                |
| `record.sales-docs.update`   | yes   | edit a draft, record a staff accept or decline, revise, extend                                                   |
| `record.sales-docs.send`     | yes   | send (email / WhatsApp / link), read, regenerate and revoke the share link                                       |
| `record.sales-docs.convert`  | yes   | convert to a deal and to an invoice                                                                              |
| `record.sales-docs.delete`   | yes   | delete                                                                                                           |
| `record.sales-docs.settings` | no    | numbering and defaults, templates (create, edit, delete)                                                         |

The Admin preset holds all seven. The editable front-line preset (`Agent` from sign-up, `Counsellor` from the dev seed) gets read, update
and send on its own documents and create; converting, deleting and the settings stay with the roles a workspace widens. A contact's
list also needs `record.contacts.read` on the contact, and a deal's `record.deals.read` on the deal (each with its own scope: a record
the caller cannot see is `404`, no permission at all is `403`).

## The document

```json
{
  "id": "8d0c…",
  "kind": "proposal",
  "number": "PRO-0007",
  "status": "sent",
  "title": "Website redesign",
  "buyerName": "Priya Nair",
  "buyer": { "name": "Priya Nair", "email": "priya@acme.test", "phone": "+919876543210" },
  "contact": { "id": "…", "name": "Priya Nair" },
  "company": { "id": "…", "name": "Acme" },
  "deal": { "id": "…", "title": "Acme redesign" },
  "owner": { "id": "…", "name": "Ben" },
  "createdBy": { "id": "…", "name": "Ben" },
  "currency": "USD",
  "exponent": 2,
  "taxRate": "10",
  "discount": { "kind": "percent", "value": "10" },
  "lines": [
    {
      "position": 0,
      "description": "Design",
      "qty": "2",
      "unitPrice": "15.50",
      "unitPriceMinor": "1550",
      "discount": null,
      "taxRate": null,
      "effectiveTaxRate": "10",
      "grossMinor": "3100",
      "discountMinor": "0",
      "netMinor": "3100",
      "taxMinor": "279"
    }
  ],
  "totals": {
    "subtotalMinor": "4099",
    "discountMinor": "410",
    "taxMinor": "369",
    "totalMinor": "4058",
    "subtotal": "40.99",
    "discount": "4.10",
    "tax": "3.69",
    "total": "40.58"
  },
  "notes": "…",
  "terms": "Net 30",
  "validUntil": "2026-11-01",
  "overdue": false,
  "sentAt": "…",
  "firstViewedAt": null,
  "decidedAt": null,
  "revision": 1,
  "acceptedRevision": null,
  "duplicatedFromId": null,
  "invoice": null,
  "link": {
    "active": true,
    "expiresAt": null,
    "revokedAt": null,
    "viewCount": 0,
    "lastViewedAt": null
  },
  "actions": {
    "edit": false,
    "send": true,
    "decide": true,
    "revise": true,
    "extend": true,
    "convertInvoice": false,
    "convertDeal": true,
    "delete": true
  },
  "source": "manual",
  "rowVersion": 3,
  "createdAt": "…",
  "updatedAt": "…"
}
```

The list returns the same shape without `lines`, `buyer`, `notes`, `terms`, `link`, `actions` and the other detail-only fields
(`SalesDocSummary`). Money is strings: `*Minor` fields are whole minor units of `currency`, the others decimal strings in major units;
quantities and rates are decimal strings (`qty` up to 4 decimals, `taxRate` a percent with up to 2). `buyer`, `notes` are encrypted at
rest and returned decrypted. `status` is `draft | sent | viewed | accepted | declined | expired | converted`. `overdue` is true for a
sent or viewed document whose valid-until date has passed whether or not the sweep has marked it yet. `actions` says what the status
allows next (the permission check is separate).

### The money rule (one function: `computeSalesDoc` in `@crm/contracts`)

The API prices a document with it and the web form previews with the same call, so what is shown is what is saved to the minor unit.
Everything is integer arithmetic; **every amount that comes out of a product or a ratio is rounded to a whole minor unit of the currency,
half away from zero (all amounts are non-negative, so half up), at the step where it is produced**; sums add rounded amounts.

1. line gross = round(qty x unit price)
2. line discount = percent: round(gross x p) | amount: min(a, gross); line net = gross - line discount
3. subtotal = sum of line nets
4. document discount = percent: round(subtotal x p) | amount: min(a, subtotal)
5. the document discount is spread over the lines in proportion to their nets (largest remainder, ties to the earlier line), so shares add
   back exactly and each line is taxed on what it really costs
6. line tax = round((line net - its share) x line rate); a line without a rate uses the document's `taxRate`
7. tax = sum of line taxes; total = subtotal - document discount + tax (tax is added on top: prices are tax-exclusive)

The number of decimals follows the currency (ISO 4217: 0 for JPY, 2 for USD, 3 for KWD). Amounts are capped below 10^15 minor units.
A value the math cannot hold (too many decimals for the currency, a percent above 100, an amount that does not fit) is
`422 SALESDOC_AMOUNT_INVALID` with one detail per field path (`lines.2.unitPrice`).

## Status machine

```
draft ──send──> sent ──(buyer opens)──> viewed
  │               │ ╲                     │
  │               │  ╲──accept/decline────┤ ──> accepted | declined
  │               └──(valid-until passes, sweep)──> expired
  └─ staff accept / decline (recorded as staff) ─────────────^
accepted ──convert/invoice──> converted
sent | viewed | declined | expired ──revise──> draft (revision + 1, the old content is kept)
sent | viewed | expired ──extend──> same status (an expired one reopens: viewed if it had been opened, else sent)
```

Any other move is `409 SALESDOC_INVALID_TRANSITION` (details: `from`, `action`). Only a **draft** is edited in place
(`409 SALESDOC_NOT_EDITABLE`). A draft does not expire (nobody is late to an unsent document), and a draft is not public. Accepted and
converted documents are evidence: they cannot be revised or deleted (`409 SALESDOC_NOT_DELETABLE`).

## Routes (authenticated)

Literal paths (`counts`, `settings`, `templates`) are registered before `:id`.

| Method and path                                               | Capability                   | What                                                                                                |
| ------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------- |
| `GET /sales-docs`                                             | read (scope)                 | List, newest first, cursor paginated (`limit` 1-200, default 50, `cursor`). Filters below           |
| `GET /sales-docs/counts`                                      | read (scope)                 | `{ total, byStatus, openValue }`: counts per status and the open value per currency                 |
| `POST /sales-docs`                                            | create                       | Create a draft                                                                                      |
| `GET /sales-docs/:id`                                         | read (scope)                 | One document                                                                                        |
| `PATCH /sales-docs/:id`                                       | update (scope)               | Edit a draft whole. Needs `rowVersion` (`409 ROW_VERSION_CONFLICT`)                                 |
| `DELETE /sales-docs/:id`                                      | delete (scope)               | `204`; audited; `salesdoc.deleted`                                                                  |
| `GET /sales-docs/:id/print`                                   | read (scope)                 | Print-optimised HTML (A4, no scripts). "Save as PDF" in a browser. A server PDF is a follow-up      |
| `GET /sales-docs/:id/events`                                  | read (scope)                 | Timeline, newest first, cursor paginated                                                            |
| `GET /sales-docs/:id/events/:eventId`                         | read (scope)                 | One event with the buyer's drawn signature                                                          |
| `GET /sales-docs/:id/revisions`                               | read (scope)                 | Earlier revisions (kept when the document was revised)                                              |
| `GET /sales-docs/:id/revisions/:revision`                     | read (scope)                 | The lines and totals of one revision                                                                |
| `POST /sales-docs/:id/duplicate`                              | create (+ read on original)  | New draft with the same content, new number and link; body `{ kind? }` duplicates as the other kind |
| `POST /sales-docs/:id/send`                                   | send (scope)                 | Email, WhatsApp or copy-link, see below                                                             |
| `POST /sales-docs/:id/accept`, `/decline`                     | update (scope)               | Record the buyer's decision as staff; body `{ note?, rowVersion? }`                                 |
| `POST /sales-docs/:id/revise`                                 | update (scope)               | Back to a draft; revision + 1                                                                       |
| `POST /sales-docs/:id/extend`                                 | update (scope)               | New `validUntil` (not in the past); reopens an expired document                                     |
| `GET /sales-docs/:id/link`                                    | send (scope)                 | The share link `{ token, path, url, active, expiresAt, revokedAt }`                                 |
| `POST /sales-docs/:id/link/regenerate`                        | send (scope)                 | New token (the old one stops at once); body `{ expiresInDays? }`                                    |
| `POST /sales-docs/:id/link/revoke`                            | send (scope)                 | The buyer gets `410` until a new link is made or the document is sent again                         |
| `POST /sales-docs/:id/convert/deal`                           | convert (scope)              | Create and link a deal. Body `{ title?, pipelineId?, stageId? }`                                    |
| `POST /sales-docs/:id/convert/invoice`                        | convert (scope)              | Accepted document to an invoice draft through the invoicing port                                    |
| `GET /sales-docs/settings`                                    | read                         | Numbering and defaults, plus the counters                                                           |
| `PATCH /sales-docs/settings`                                  | settings                     | Prefixes, padding, starting numbers, default validity, link lifetime                                |
| `GET /sales-docs/templates?kind=`                             | read                         | Templates of default terms and notes                                                                |
| `POST` / `PATCH /:id` / `DELETE /:id` `/sales-docs/templates` | settings                     | Template CRUD; `PATCH` needs `rowVersion`; a name is unique per kind                                |
| `GET /contacts/:contactId/sales-docs`                         | read (scope) + contacts.read | A contact's documents (same filters as the list)                                                    |
| `GET /deals/:dealId/sales-docs`                               | read (scope) + deals.read    | A deal's documents                                                                                  |

### List filters

`kind`, `status` (comma list), `q` (number, title, linked contact or company name; the buyer's own fields are encrypted and not
searched), `contactId`, `companyId`, `dealId`, `ownerId`, `mine`, `currency`, `validFrom` / `validTo` (inclusive valid-until window; the
calendar reads this). `counts` takes the same filters without `status` and paging. The cursor is a microsecond keyset over
`(created_at, id)`; a malformed one is `400`.

### Create

```
POST /v2/sales-docs
{ "kind": "estimate", "title": "Fix", "contactId": "…", "currency": "USD", "taxRate": "10",
  "discount": { "kind": "percent", "value": "10" }, "validUntil": "2026-11-01", "terms": "Net 30",
  "lines": [ { "description": "Consulting", "qty": "2", "unitPrice": "80", "taxRate": "18", "discount": { "kind": "amount", "value": "5" } } ] }
```

`lines` has 1 to 200 entries. The number comes from a locked per-type counter (`PRO-0001`, `EST-0001`; prefix, padding and start are in
settings). The buyer name, email and phone default to the linked contact's (a deal brings its contact and company); a body value wins and
`null` clears. The default template of the kind supplies terms, notes and validity for what the body leaves out (`templateId` picks
another; a duplicate does not apply one). A contact, company, deal or template that is not in the workspace is `404`; an owner who is not
an active member is `422 SALESDOC_OWNER_INVALID` (omitted = the caller, `null` = nobody). The currency defaults to the workspace's
(`organizations.settings.currency`, else the default pipeline's, else `USD`) and can be chosen per document; it is fixed on a draft unless
the lines are re-sent with it.

### Send

```
POST /v2/sales-docs/:id/send   { "channel": "email" | "whatsapp" | "link", "to"?, "message"?, "rowVersion"? }
-> { "document": {…}, "delivery": { "channel", "status": "sent" | "queued" | "shared", "to": "pr***@acme.test" }, "link": {…} }
```

- `email`: mails the buyer's address (or `to`) the link, the total and the validity through the mail port. The transaction is not held
  open during the send; a transport failure is `502 SALESDOC_SEND_FAILED` (detail: the reason) and the document is unchanged. No address
  is `422 SALESDOC_NO_RECIPIENT`.
- `whatsapp`: needs an E.164 number (the buyer's or `to`). The document is marked sent and **`salesdoc.delivery_requested`** is emitted for
  the messaging domain to deliver. **TODO(messaging):** that subscriber (template message outside the 24 h window, delivery result) is
  not built; until it is nothing reaches the buyer over WhatsApp.
- `link`: copy-link / mark-as-sent. The caller shares `link.url` themselves.

A draft becomes `sent` (`sentAt` is stamped once); a sent or viewed document is re-sent and keeps its status; anything else is `409`.
A revoked or expired link is replaced by a new one automatically. The workspace's `linkTtlDays` sets the link's expiry when the document
is first sent. The timeline stores the masked recipient only.

### Conversion

- **Deal.** The deal takes the document's title (`<number> <title>`), total, currency, contact, company and owner, the valid-until date as
  the expected close, in the first stage of the chosen (default) pipeline, through the same stage and ordering rules as the deals API;
  `deal.created` / `deal.stage_changed` are emitted. `409 SALESDOC_ALREADY_LINKED_DEAL` when one is linked.
- **Invoice.** Only an **accepted** document converts (`409 SALESDOC_INVALID_TRANSITION` otherwise; `409 SALESDOC_ALREADY_CONVERTED`
  twice). The work is done by the invoicing module behind `SALES_DOC_INVOICE_PORT` (`apps/api/src/modules/crm/sales-docs/sales-doc-ports.ts`,
  exported from `modules/crm`): `createDraftFromSalesDoc(tx, source)` runs **inside this transaction**, so the invoice, the link back
  (`sales_docs.invoice_id`, a composite foreign key) and the status `converted` commit together or not at all. `source` carries the frozen
  lines (per-line tax rate and amount), totals, buyer, the internal ids of the contact, company and deal, and `idempotencyKey =
salesdoc:<uuid>:invoice`. The invoicing module binds the token (`InvoiceConversionService` in `modules/crm/invoicing`); a deployment without a binding answers `501 SALESDOC_INVOICING_UNAVAILABLE`.

### Settings and templates

`PATCH /sales-docs/settings` shapes the NEXT numbers only (an issued number never changes and the counter is never lowered). Fields:
`proposalPrefix`, `estimatePrefix` (1-10 letters or digits, stored upper-case), `numberPadding` (1-10), `proposalStart`, `estimateStart`
(effective until the first document of the kind exists), `defaultValidDays`, `linkTtlDays`. `GET` returns `rowVersion: null` until the
first save (send no `rowVersion` then; afterwards every save must carry the one read).

## The buyer's side (no login)

`/v2/public/sales-docs/:token`. The 43-character token is the credential: 256 random bits, stored as a SHA-256 for lookup and encrypted
for the staff's copy-link. The web app serves the page at `/q/<token>` and calls these routes from the server. Every response carries
`Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`. An unknown, malformed or draft token is `404`;
a revoked or expired link is `410 SALESDOC_LINK_UNAVAILABLE`. Throttled per IP and per link (reads 120 / 60 a minute, decisions 20 / 10)
with `429 RATE_LIMITED`.

| Method and path        | What                                                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `GET /:token`          | The document as the buyer sees it (`PublicSalesDoc`: no buyer email or phone). The first open of a sent document marks it `viewed` |
| `GET /:token/print`    | Print page (HTML, `Content-Security-Policy: default-src 'none'`); not counted as a view                                            |
| `POST /:token/accept`  | `{ signerName (2-120), signerEmail?, signature? (PNG data URL, 60,000 characters), comment?, consent: true }`                      |
| `POST /:token/decline` | `{ signerName?, signerEmail?, reason? }`                                                                                           |

`status` on the page reads `expired` once the valid-until date has passed in the workspace's time zone, even before the sweep marks it;
`canDecide` is then false and `blockedReason` is `expired`, and accept or decline is `409 SALESDOC_EXPIRED`. A decision records the signer,
the drawn signature, the IP, the user agent, the revision and the time in the timeline (signer, signature and comment are encrypted at
rest; nothing of it is in an audit row or an outbox event). The same decision again answers the same with `replay: true` (one event); the
opposite one is `409 SALESDOC_ALREADY_DECIDED`. Staff can revise a declined document to start again.

## Expiry sweep

`SalesDocExpirySweepService` runs in the worker every 5 minutes (privileged, per organization, `FOR UPDATE SKIP LOCKED`, batches of 200).
Sent and viewed documents whose `valid_until` is before today in the workspace's time zone become `expired`, each with a timeline row,
an audit row and a `salesdoc.expired` event in one transaction. Drafts and decided documents are never touched.

## Events (outbox)

`aggregateModule` is `sales_docs`; the payload is identifiers and what a consumer decides on (`uuid, kind, number, status, currency,
totalMinor, revision, contactId, companyId, dealId, ownerId, createdById, source`) plus event extras. It never holds the buyer's details,
notes or the link.

| Event                             | When                                                  | Extras                       |
| --------------------------------- | ----------------------------------------------------- | ---------------------------- |
| `salesdoc.created`                | create, duplicate                                     | `duplicatedFrom`             |
| `salesdoc.updated`                | a draft edit                                          | `changed[]`                  |
| `salesdoc.sent`                   | send (also a re-send)                                 | `channel`, `resend`          |
| `salesdoc.delivery_requested`     | send over WhatsApp: the hook for the messaging domain | `channel`                    |
| `salesdoc.viewed`                 | first open by the buyer                               |                              |
| `salesdoc.accepted` / `.declined` | a decision                                            | `by`: `buyer` or `staff`     |
| `salesdoc.expired`                | the sweep                                             |                              |
| `salesdoc.revised`                | revise                                                | `fromRevision`               |
| `salesdoc.extended`               | extend                                                |                              |
| `salesdoc.converted`              | convert to a deal or an invoice                       | `to`, `dealId` / `invoiceId` |
| `salesdoc.deleted`                | delete                                                |                              |

The "quote decided" notification to the owner and the creator (TW-PROP-017), the web push and the webhooks are consumers of these
events and belong to the notifications and integrations domains.

## Errors this domain adds

| Code                             | Status | When                                                                       |
| -------------------------------- | ------ | -------------------------------------------------------------------------- |
| `SALESDOC_INVALID_TRANSITION`    | 409    | The move is not allowed from the status (details `from`, `action`)         |
| `SALESDOC_NOT_EDITABLE`          | 409    | Editing a document that is not a draft                                     |
| `SALESDOC_EXPIRED`               | 409    | The valid-until date has passed (public accept or decline; staff accept)   |
| `SALESDOC_ALREADY_DECIDED`       | 409    | The opposite decision was recorded                                         |
| `SALESDOC_ALREADY_CONVERTED`     | 409    | Already converted to an invoice                                            |
| `SALESDOC_ALREADY_LINKED_DEAL`   | 409    | Already linked to a deal                                                   |
| `SALESDOC_NOT_DELETABLE`         | 409    | Accepted or converted                                                      |
| `SALESDOC_LINK_UNAVAILABLE`      | 410    | The public link was revoked or has expired                                 |
| `SALESDOC_OWNER_INVALID`         | 422    | The owner is not an active member of the workspace                         |
| `SALESDOC_AMOUNT_INVALID`        | 422    | An amount, quantity or rate the math rejects (details: one path per field) |
| `SALESDOC_NO_RECIPIENT`          | 422    | No email address or E.164 number to send to                                |
| `SALESDOC_SEND_FAILED`           | 502    | The mail transport failed (detail: the reason); the document is unchanged  |
| `SALESDOC_INVOICING_UNAVAILABLE` | 501    | No invoicing module is bound to the port                                   |
| `SALESDOC_TEMPLATE_NAME_TAKEN`   | 409    | A template of this kind already has the name                               |
