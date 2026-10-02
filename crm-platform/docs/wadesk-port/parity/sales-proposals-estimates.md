# Parity evidence: proposals and estimates (PROP / EST)

WaDesk 1.7.0 (Docker copy, `http://127.0.0.1:8000`, workspace user created through `/register`, no plan packages configured) vs our
commit `dfcdceb` plus the working tree of this run, API `:3100`, web `:3001`. Run on 2026-10-02. Companion file for the money side:
[sales-invoices-payments.md](sales-invoices-payments.md). The deviations the owner asked for on purpose (editable drafts, guarded status
machine, eager expiry, signed public accept, revisions, per-line discount and tax) are in [product-extensions.md](product-extensions.md),
item 7; here they are recorded as `intended`.

How it was run: the generic twin harness (`.claude/skills/wadesk-playwright-parity/harness`) needs bash, python3, `setsid` and an
installed Playwright, none of which this Windows box has, so the same comparison was scripted directly on Playwright 1.60 (Chromium)
plus `fetch`: the same inputs were posted to both apps (WaDesk through its own CSRF form posts inside a logged-in page, then read back
with read-only `SELECT`s on `wadesk-ref-mysql`; ours through the API and the web screens) and the observations were compared. The
reference runs on a single-worker PHP server and answered in 10 to 300 seconds per request, so the WaDesk side is a deliberately
chosen set, not a full matrix. Nothing of WaDesk's code, markup, copy or images is reproduced here; wording is paraphrased.

**Classes.** `same`: equivalent behaviour. `intended`: differs on purpose (an owner-requested extension, a decision in the inventory's
"Port decisions", or an architecture rule), reason given. `defect (fixed)`: our bug, fixed in this run with a regression test.
`defect (open)`: our bug, not fixed, with the reason. `not verifiable`: the WaDesk side (or ours) could not be exercised here.

## Result in numbers

78 scenarios in this file (money 18, validation 10, then document 12, buyer 11, convert / delete / send 7, access and edge cases 20):

| Class | Count |
| ----- | ----- |
| same | 31 |
| intended | 36 |
| defect (fixed) | 7 (F1 to F7) |
| defect (open) | 4 (L2, L3, L4, L7; two more rows concern L1 and L6, recorded as fixed and as a decision) |
| not verifiable | 0 (the WaDesk gaps are inside the rows marked `src`, listed at the end) |

Tests that cover the fixes and passed at the end of the run: API unit `sales-docs`, `common`, `notifications` (the whole unit suite
ran before the notification rules were added: 809 passed, 1 failed on a Windows path separator in the auth module's
privileged-access test, unrelated), API end-to-end `sales-docs` and `invoicing` (147 tests with the new assertions) plus the 4 new
notification tests, API integration `sales-docs` and `invoicing` (70), web `sales-docs` and `invoicing` (512) and the whole web suite
(1520), web typecheck, ESLint on both features and on the API, API `tsc` for src and spec (the one error is in a broadcasts spec of
another stream), `pnpm arch:check`.

## Defects found on our side and fixed in this run

| # | What was wrong | Where it was | Fix and regression test |
| - | -------------- | ------------ | ----------------------- |
| F1 | A date that has the shape `YYYY-MM-DD` but is not a day (`2026-02-31`, `2026-13-01`, `0000-00-00`) reached PostgreSQL and answered **500** on every date field and date filter of proposals, estimates and invoicing (`validUntil`, `issueDate`, `dueDate`, `validFrom/To`, `issuedFrom/To`, `dueFrom/To`, payment `from/to`, tax-rate effective dates, recurring and sales-order dates, credit-note issue date). | `packages/contracts/src/{sales-docs,invoicing}` (one `\d{4}-\d{2}-\d{2}` regex per file) | New `calendarDaySchema` / `isCalendarDay` in `sales-docs/input-guards.ts`, used by every date field above. `apps/api/test/unit/sales-docs/input-guards.spec.ts`, plus e2e assertions in `sales-docs.e2e.spec.ts` and `invoicing.e2e.spec.ts`. |
| F2 | A NUL character (`\u0000`) in any text field or search box answered **500** (PostgreSQL text cannot hold it): titles, line descriptions, notes, buyer names, references, `q=`. The same happens in other modules (tasks answered 500 too). | `apps/api/src/common/pipes/zod-validation.pipe.ts` (the one trust boundary) | The pipe now refuses a NUL anywhere in a body or query with `422 VALIDATION_FAILED` and the path. `apps/api/test/unit/common/zod-validation-pipe.spec.ts` + e2e. **Kernel file, additive; flagged for the steward.** |
| F3 | Any three letters were accepted as a document currency (`ZZZ`, `XXX`, `BTC`) and printed as money. | `sales-doc.ts`, `invoice.ts`, `sales-order.ts` contracts | New `isoCurrencySchema` (the tax engine's ISO 4217 list). Unit and e2e tests. |
| F4 | `actions.decide` was `true` for a lapsed open document (valid-until passed, sweep not yet run) while accepting it is `409 SALESDOC_EXPIRED`; a client following `actions` offered a button that could only fail. | `sales-docs.mapper.ts` | `actionsFor` clears `decide` for a lapsed document (`extend` and `revise` stay). Unit test in `sales-doc-rules.spec.ts` + e2e assertion. |
| F5 | The error panel offered **Try again** for a plan that lacks the feature, a missing permission, a missing record or an ended sign-in: answers that never change. | `features/{sales-docs,invoicing}` `ErrorLine` | `isRetryable(kind)` in both `lib/errors.ts`; the button shows only for network, server and rate-limit failures. `errors.test.ts` in both features. |
| F6 | The buyer's quote page had no level-one heading and the buyer's invoice page no `main` landmark (axe: `page-has-heading-one`, `landmark-one-main`, `region`). | `public-quote.tsx`, `public-invoice.tsx` | A screen-reader-only `h1` with the number and title; the invoice page shell is a `main`. Re-run of axe: both clean except the colour-contrast item in L4. |
| F7 | **No notification to the owner and the creator when the buyer accepts or declines** (WD-PROP-017: WaDesk wrote one in-app notification per person; live: type `sales_doc_decided`, "accepted", linking the list). Ours emitted `salesdoc.accepted` / `salesdoc.declined` and nothing consumed them, yet the buyer's confirmation says the seller "has been notified". | `apps/api/src/modules/notifications` | New `SalesDocNotificationConsumer` (worker process, next to `TaskNotificationConsumer`): a decision by the **buyer** writes one `sales_doc_decided` notification for the owner and for the creator (once if they are the same person), linking `/estimates/<id>` or `/proposals/<id>`; idempotent per event, silent for a staff decision or a document deleted before delivery. Rules: `apps/api/test/unit/notifications/salesdoc-notification-rules.spec.ts`; behaviour through the real outbox: `apps/api/test/e2e/sales-docs/sales-doc-notifications.e2e.spec.ts` (4 tests). The bell shows the server's English wording for this type until the web has a message for it (the bell's documented fallback). |

## Defects and decisions left open

| # | What | Why it is open | Recommendation |
| - | ---- | -------------- | -------------- |
| L1 | The notification of F7 shows in English in every language: the bell has messages only for the three task types. | The bell's messages and the contracts' `NOTIFICATION_TYPES` belong to the notifications zone, which another stream is editing. | Add `sales_doc_decided` to `messages/*/notifications-activity-audit.json` and to `NOTIFICATION_TYPES`, worded from `data.kind`, `data.number` and `data.status`. |
| L2 | The new-document form starts in `USD` when the session has no workspace currency, while the API resolves the default as `settings.currency`, else the default pipeline's currency, else `USD`. In the dev data the pipeline is INR, so a document made through the API is INR and one made in the form is USD. | Needs the resolved default to reach the form (`GET /sales-docs/settings` has no currency today): contract, API and web change. | Return the resolved `currency` in the settings response and start the form from it. |
| L3 | A proposal's tax percent has at most two decimals; invoice tax rates allow four (Quebec QST 9.975 can be invoiced but not quoted). WaDesk rounded a percent to basis points the same way, so this is not a regression. | The quote stores basis points; four decimals is a column and contract change in sales-docs. | Decide whether quotes need exact rates; if yes widen to `numeric(7,4)` as invoicing did. |
| L4 | Colour contrast of small text is 4.34 to 4.39 : 1 (needs 4.5) on the status-tab counts, table header labels and the status pills (axe `color-contrast`). | The colours are `@crm/ui` tokens (kernel). | Darken the muted text token and the three pill tints by one step. |
| L5 | The app shell logs a React "unique key" error ("Check the render method of `TopBar`", pointing at the `bell` element passed in `apps/web/src/app/(app)/layout.tsx` line 44), which shows the Next dev overlay "1 Issue" on every screen and covers the bottom-right corner in dev. | Shell, outside the sales and invoicing zones. | Find the list the top bar renders from its slots and key its items. |
| L6 | The buyer's page (`/q/<token>`, `/i/<token>`) is rendered in the browser, so an unknown, revoked or expired link answers HTTP 200 with an in-page message (the API itself answers 404 / 410). WaDesk answered 404. | Product choice made with the buyer pages; changing it means rendering the lookup on the server. | Decide; harmless for users (the page is `noindex`). |
| L7 | WhatsApp delivery of a quote, the calendar's valid-until events and the AI copilot's quote tools (WD-PROP-011 delivery, 019 to 022) are not built. The Send dialog's WhatsApp tab marks the document sent and emits `salesdoc.delivery_requested`; nothing consumes it. | Messaging, dashboards and AI domains. Recorded `blocked` in the inventory. | Build the consumers with those domains. |

## Money: the same inputs on both apps (WD-PROP-005, 006, 007)

Same lines, quantities, unit prices and one document tax rate, created as a draft (WaDesk in the workspace currency, USD; ours in its
workspace default, INR, which also has two decimals, so the minor-unit figures compare directly). Figures are minor units: subtotal / tax / total.
WaDesk prices tax once on the sum with the rate rounded to basis points; ours prices every line (half up) on its own taxable amount, as
decided in the inventory's Port decisions (D-03, D-10). Quantities and prices were read from the stored rows on both sides.

| # | Input | WaDesk | Ours | Result | Note |
| - | ----- | ------ | ---- | ------ | ---- |
| M01 | 2 x 15.50 + 1 x 9.99, tax 10 | 4099 / 410 / 4509 | 4099 / 410 / 4509 | same | the inventory's own example |
| M14 | 2 x 80, tax 18 | 16000 / 2880 / 18880 | 16000 / 2880 / 18880 | same | |
| M04 | qty 0.333 x 3.00 | 100 / 0 / 100 | 100 / 0 / 100 | same | fractional quantity |
| M05 | qty 1.005 x 10.00 | 1005 / 0 / 1005 | 1005 / 0 / 1005 | same | |
| M17 | qty 0.5 x 3.33 | 167 / 0 / 167 | 167 / 0 / 167 | same | half up |
| M07 | 1 x 100.00, tax 18.5 | 10000 / 1850 / 11850 | 10000 / 1850 / 11850 | same | |
| M11 | 1 x 50.00, tax 100 | 5000 / 5000 / 10000 | 5000 / 5000 / 10000 | same | upper boundary |
| M12 | 2 x 80, tax left empty | 16000 / 0 / 16000 | 16000 / 0 / 16000 | same | |
| M08 | one line, qty 0 price 0 | 0 / 0 / 0 | 0 / 0 / 0 | same | a zero-value document is valid on both |
| M02 | three lines of 0.05, tax 10 | 15 / 2 / 17 | 15 / 3 / 18 | intended | tax on the sum (1.5, rounded to 2) vs per line (0.5 rounded to 1, three times): the known, documented difference of D-10 (decision D-2 below) |
| M03 | three lines of 1.05, tax 10 | 315 / 32 / 347 | 315 / 33 / 348 | intended | same cause |
| M10 | eight lines, tax 7.25 | 279183 / 20241 / 299424 | 279183 / 20240 / 299423 | intended | same cause, one minor unit |
| M18 | twenty lines of 0.07, tax 15 | 140 / 21 / 161 | 140 / 20 / 160 | intended | same cause: twenty roundings of 1.05 down to 1 against one of 21.0 |
| M06 | tax 18.255 | 10000 / 1826 / 11826 (rate rounded to 18.26) | refused, 422 (percent has two decimals) | intended | WaDesk rounded silently; ours does not guess. See L3 for the four-decimal question |
| M16 | tax 8.875 on 3 lines of 33.33 | 9999 / 888 / 10887 (rate rounded to 8.88) | refused, 422 | intended | same as M06 |
| M13 | unit price 1.005 (a third decimal) | stored 101 (rounded) | refused, `SALESDOC_AMOUNT_INVALID` on `lines.0.unitPrice` | intended | a price with more decimals than the currency keeps is an input error, not a guess (D-10) |
| M15 | 2 x 0.005 | 2 (0.01 rounded up per unit) | refused, same code | intended | same as M13 |
| M09 | 100000 x 100000000.00 | stored 10^15 minor units | refused, amount too large | intended | ours caps an amount below 10^15 minor units so it fits a bigint column and a JS safe integer; WaDesk had no cap |

## Validation boundaries (WD-PROP-005)

| # | Input | WaDesk | Ours | Result | Note |
| - | ----- | ------ | ---- | ------ | ---- |
| V01 | no line items | rejected | 422 | same | |
| V02 | tax 101 | rejected | 422 `SALESDOC_AMOUNT_INVALID` | same | |
| V07 | tax -1 | rejected | 422 | same | |
| V03 | unit price -1 | rejected | 422 | same | |
| V04 | quantity -1 | rejected | 422 | same | |
| V08 | quantity "abc" | rejected | 422 | same | |
| V09 | unit price "abc" | rejected | 422 | same | |
| V06 | blank (spaces) description | rejected | 422 | same | |
| V05 | description of 256 characters | rejected (limit 255) | accepted (limit 500; 501 is 422) | intended | a limit widened with the contract; both limits are enforced and tested on our side (decision D-1 below) |
| V10 | `<img onerror>` as a line description | stored as text | stored as text; every screen, the print page and the public page show it escaped, nothing ran | same | checked on the staff detail, list, public page and print page on ours; WaDesk's public page shows the text literally (live, see G08) |

## Flows and edge cases

### The document: create, list, numbers, status

| # | Scenario | WaDesk observed | Ours observed | Result | Note |
| - | -------- | --------------- | ------------- | ------ | ---- |
| E01 | Create an estimate with buyer, 18 % tax and a valid-until date (WD-EST-002, WD-PROP-005) | a draft `EST-nnnn`, 16000 / 2880 / 18880, a 40-character token, the buyer fields stored | 201, a draft `EST-nnnn`, the same figures, a 43-character token (256 random bits) | same | the token length is the security decision of D-16 |
| E02 | Numbers per kind (WD-PROP-008, WD-EST-003) | `PRO-` and `EST-` count separately, four digits, per workspace | the same, with a configurable prefix, padding and start | same | |
| E03 | Delete the newest document and create another | the freed number is handed out again (live: after every estimate was deleted the next one was `EST-0001` again, the number of a document that had been invoiced) | never reused: after deleting `EST-0005` the next is `EST-0006`; 12 parallel creations got distinct, gapless numbers | intended | D-06 |
| E04 | The list and the "open value" tile (WD-PROP-003) | one table: draft first then sent, accepted, rejected, expired, invoiced, newest first; 30 a page; no search or filter; open value = sent + accepted in the workspace currency (a code prefix: `USD 188.80`) | status tabs with counts, search (number, title, buyer), owner and valid-until filters, cursor paging; open value per currency over sent + viewed + accepted; amounts in the document's own currency with its symbol | intended | D-18 |
| E05 | Row actions | Send (WhatsApp), View, Mark sent, Accept, "-> Invoice" when allowed, delete | open, send dialog, duplicate, revise, extend, record decision, convert to invoice, convert to deal, delete, in a row menu; bulk bar | intended | extension 7 |
| E06 | Mark a draft as sent (WD-PROP-010) | `sent`, `sent_at` stamped | `sent`, `sentAt` stamped, a timeline row, `salesdoc.sent`; the buyer's link opens | same | |
| E07 | Staff accepts a draft on the buyer's behalf | `accepted`, `decided_at` stamped, no notification | "record as accepted": `accepted`, recorded as staff in the timeline, no buyer notification | same | |
| E08 | A status value that does not exist | refused with a message, nothing changes (live: a `bogus` status left the document a draft) | there is no status field to set: an unknown action is 404, a move the status does not allow is `409 SALESDOC_INVALID_TRANSITION` | intended | D-15 |
| E09 | Staff moves a document from any status to any status | live: draft to accepted, accepted to rejected, rejected back to sent all worked; the sent document kept the earlier `decided_at` (a "sent" document that already carries a decision) | refused: `SALESDOC_INVALID_TRANSITION`, `SALESDOC_NOT_EDITABLE` or `SALESDOC_EXPIRED`; revise starts a new revision, history is kept in a timeline | intended | D-15 |
| E10 | The id routes of the other kind | live: `PATCH /estimates/<a proposal's id>` changed that proposal (it went from draft to sent) | one engine: the kind is a field, an id can only ever be one document | intended | D-13 |
| E11 | A document id that does not exist | 404 | 404 problem+json; an id that is not a uuid is 400 | same | |
| E12 | Edit after creation, duplicate, revise, discounts, terms, templates, valid-until default | none of them exists | editable drafts (with `rowVersion`), duplicate as the other kind, revise a sent or declined document, per-line and document discounts, per-line tax, terms, default templates | intended | extension 7 (WD-PROP-027, 028, 029) |

### The buyer's page and decision

| # | Scenario | WaDesk observed | Ours observed | Result | Note |
| - | -------- | --------------- | ------------- | ------ | ---- |
| B01 | The page for a sent estimate (WD-PROP-014) | cover with the platform name, number, status, valid-until; prepared-for card with the buyer's name and email; lines, subtotal, tax with its rate, total; Accept and Decline; no seller block, no `noindex`, `lang` fixed to `en` | the seller's name, number, status, valid-until, buyer's name (no email or phone), lines, discount and tax rows, terms, notes, the decision form; `noindex, nofollow`, `no-store`, `no-referrer`; a language switch and print button | intended | D-16 |
| B02 | A draft's link | works for anyone holding the token | 404 until the document is sent | intended | D-16 |
| B03 | A token that does not exist | 404 | API 404; the page shows "This link is not valid" | same | page status is L6 |
| B04 | The buyer accepts (WD-PROP-015) | one click: `accepted`, `decided_at`; a banner; nothing else recorded | a name (2 to 120 characters), a drawn or typed signature and a consent box; records signer, IP, user agent and revision in the timeline | intended | D-11 |
| B05 | The same acceptance again | nothing changes, no second notification (live: still one new notification) | `200` with `replay: true`, one event | same | |
| B06 | Decline after accept | the page reloads, nothing changes, no notification (live) | `409 SALESDOC_ALREADY_DECIDED` | intended | D-11: the opposite decision is final, said out loud |
| B07 | The buyer declines | `rejected` (label "Rejected" on staff screens, "declined" on the page) | `declined`, with an optional reason; staff can revise it into a new draft | intended | D-15 |
| B08 | A link past its valid-until date | the page still reads sent with an active Accept; live: a document valid until 2026-09-01 was **accepted** by the buyer; the list flips it to `expired` only when staff open it (live) | the page reads expired and offers no decision; accept and decline are `409 SALESDOC_EXPIRED` (staff too); a worker sweep marks it; "valid until today" is still valid all day; extend or revise reopens it | intended | D-05 |
| B09 | **Notification of the decision** (WD-PROP-017) | one in-app notification per recipient on a buyer decision (live: type `sales_doc_decided`, title "accepted", linking the list); none for a staff decision or a replay | none was written (no consumer existed) while the buyer's page said the seller "has been notified" | defect (fixed) | F7 |
| B10 | A revoked or regenerated link | never changes (no revoke) | revoke answers 410 until a new link; regenerate kills the old token at once; sending again revives | intended | D-16 |
| B11 | The buyer's page in Arabic and at 390 px | the staff pages mirror (`dir=rtl`) but mix English words in the Arabic text (the kind word, the statuses); the buyer's page keeps `lang=en` and the left-to-right layout whatever its language; no overflow at 390 px | the buyer's page switches language and direction (`lang=ar`, `dir=rtl`) with the statuses translated; no overflow at 390 px | intended | D-17 |

### Convert, delete, send

| # | Scenario | WaDesk observed | Ours observed | Result | Note |
| - | -------- | --------------- | ------------- | ------ | ---- |
| C01 | Convert an accepted estimate to an invoice (WD-PROP-012, WD-EST-006) | an invoice at once: `INV-2026-000001`, status `issued`, 16000 / 2880 / 18880, PDF rendered; the line carries tax 0 and one summary row "Tax 18 %" = 2880; the link back is only a JSON note | a draft invoice (no number yet) with the line's own tax rate and amount, the same figures 16000 / 2880 / 18880, the buyer, links and the quote's number as the reference; numbered when issued | intended | D-09; the totals agree to the minor unit in 30 random documents of mixed currencies, discounts and rates (all converted, none refused) |
| C02 | Convert twice | the second attempt creates nothing (live: still one invoice) and says so | `409 SALESDOC_ALREADY_CONVERTED`; 5 parallel conversions: one 200, four 409, one invoice | same | |
| C03 | Convert from a status other than accepted | the server does not check (src); the screen offers it for sent and accepted | only an accepted document converts | intended | D-09 |
| C04 | Delete a document that was converted | deleted; the invoice stays and points at a missing quote (live) | `409 SALESDOC_NOT_DELETABLE` for accepted and converted | intended | D-20 |
| C05 | Send without a buyer phone | a message about the missing phone, nothing sent, status unchanged (live: still a draft); the create form has no phone field, so this is the normal case | the send dialog has link, email and WhatsApp; no address or number is `422 SALESDOC_NO_RECIPIENT`; email goes through the mail port, WhatsApp raises `salesdoc.delivery_requested` | intended | D-01, D-08; the WhatsApp consumer is L7 |
| C06 | Two submits of the create form | two parallel posts made two documents with consecutive numbers (live) | the Save button locks (a double click made one POST); the same Idempotency-Key replays; two different keys make two documents | intended | |
| C07 | Delivering the quote over WhatsApp, the calendar's valid-until events, the AI copilot's three quote tools | WhatsApp send through a connected engine, one calendar event per valid-until date, `create_quote`, `list_quotes` and `send_quote` (src; none can be exercised on the reference: no engine, no calendar data, no AI key) | the WhatsApp tab marks the document sent and raises `salesdoc.delivery_requested`; the web app has no calendar; no copilot | defect (open) | L7: recorded `blocked` in the inventory |

### Access, gates and edge cases

| # | Scenario | WaDesk observed | Ours observed | Result | Note |
| - | -------- | --------------- | ------------- | ------ | ---- |
| G01 | Staff page without a session | redirected to the login | 401 from the API; the web redirects to the login | same | |
| G02 | A buyer's POST without the page's token | refused, nothing changes (live: a redirect, the document untouched) | not applicable: the public API is token-in-path JSON with throttling per IP and per link | intended | D-16 |
| G03 | Plan gate | a plan without the flag still renders the list under a paywall sheet; a post is refused with a warning (src; no plan packages on the reference, so not live) | `422 PLAN_FEATURE_LOCKED` on every route, reads included, with an in-page message and no retry button (F5); the buyer's page does not depend on the seller's plan | intended | D-02 |
| G04 | Who may use it | any workspace member (no role check) | `record.sales-docs.*` keys with record scope (own, team, all); an outside document is 404; verified live with the Agent preset and a second workspace | intended | D-02 |
| G05 | Empty state | "No estimates yet" with a create-your-first-one line | "No estimates yet" with a line about sending the link and a New estimate button (seen in a second workspace) | same | |
| G06 | An unusual date (`2026-02-31`) | refused: "valid until must be a valid date" (422) | was **500** on `validUntil` and every date filter; now 422 with the path | defect (fixed) | F1 |
| G07 | A NUL character in a title | accepted and stored (the title is 12 characters long) | was **500** (PostgreSQL cannot store it); now 422 on the field | defect (fixed) | F2; ours refuses what WaDesk stored |
| G08 | Hostile text in a title or a line | stored as text; the public page shows it literally, nothing runs (live) | stored as text; the staff screens, list, public page and print page show it escaped, nothing runs (live) | same | |
| G09 | 390 px | list and modal: no horizontal overflow (live); the public page: none | the estimate and proposal lists, builder and detail, the invoice screens and the buyer's pages: none, in English and in Arabic | same | |
| G10 | Right-to-left | the staff pages mirror; English words remain in the Arabic page (see B11) | `dir=rtl` and `lang=ar` across the screens, translated, nothing overflows | same | |
| G11 | The public throttle | 120 requests a minute per IP, shared with the invoice and brief pages (src) | 120 a minute per IP and 60 per link for reads, 20 and 10 for decisions (live: 429 from the 61st request on one link) | intended | D-16 |
| G12 | Print or PDF | none | a print-optimised page for staff and for the buyer; "Save as PDF" in the browser; no server PDF file | intended | D-08 |
| G13 | `actions.decide` of a lapsed document | not applicable | said `true` while accept was refused | defect (fixed) | F4 |
| G14 | A currency that is not ISO 4217 | not applicable (the workspace currency only) | `ZZZ`, `XXX`, `BTC` were accepted | defect (fixed) | F3 |
| G15 | Accessibility of the buyer's page | not run on WaDesk | no heading level one (axe) | defect (fixed) | F6 |
| G16 | A document in a currency other than the workspace's | not possible | a currency per document, defaulting to the workspace's; the form's default can differ from the API's | defect (open) | L2 (see L9 in the invoices file) |
| G17 | Colour contrast of the status tabs, table header and pills | not run on WaDesk | 4.34 to 4.39 : 1 | defect (open) | L4 |
| G18 | The quote page's invalid-link status | 404 | in-page message, HTTP 200 | intended | L6 is recorded as a decision rather than a defect: nothing is exposed and the page is `noindex` |
| G19 | A proposal's tax with more than two decimals | the rate is rounded to basis points (18.255 becomes 18.26) | refused (`taxRate` has two decimals) | defect (open) | L3: an invoice can carry 9.975 % (Quebec QST); a quote cannot |
| G20 | The error panel for a locked plan, a missing permission or a missing record | a flash or a paywall; no retry (src) | the panel offered "Try again" for answers that never change | defect (fixed) | F5 |

## Decisions for the owner

These concern both files (the invoice-only ones are marked).

| # | Decision | Default taken in this run |
| - | -------- | ------------------------- |
| D-1 | Limits widened against WaDesk: a line description of 500 characters (WaDesk 255); on invoices a price and quantity up to twelve digits (WaDesk 100,000,000 and 100,000) | kept; both ends enforced |
| D-2 | Quote tax is rounded per line, WaDesk's on the sum, so a quote can differ from WaDesk's by one minor unit per line (M02, M03, M10, M18). Invoices already round per line in WaDesk, so they agree | kept (D-10 of the port decisions); say so if a document-level rounding option is wanted for a country |
| D-3 | A plan without the sales pipeline is a hard `422` on every route, reads included; WaDesk showed a paywall over the data | kept (D-02, D-14) |
| D-4 | The NUL-character check (F2) lives in the shared validation pipe, a kernel file | added, additive; approve, or move the check into each domain's schemas |
| D-5 | One workspace currency: today the organization setting, the default pipeline and the invoicing profile can disagree (L2, L9) | open |
| D-6 | Whether a quote needs exact tax rates like 9.975 % (L3) | open |
| D-7 | How the invoice PDF gets a Unicode font (L8): embed a font, or render the print page in the worker | open |
| D-8 | The HTTP status of a bad or expired buyer link (L6) | open |
| D-9 | Staff and the buyer cannot accept a lapsed quote (WaDesk could); the inventory lists "late acceptance" as an organization setting for later | kept |
| D-10 | A manual **Receipt** document (invoice file): WaDesk's builder offers it; ours has tax invoice and proforma, and a receipt is the payment receipt of a ledger entry | kept |
| D-11 | Sign-off of items 7 to 9 of `product-extensions.md` by the domain owner and the reviewer (still pending) | open |

## What was not verified, and why

- **The plan gate on WaDesk.** No plan packages exist on the reference (the register page says an admin must add them), and the
  workspace is treated as unlimited, so a paywalled screen was never shown. WaDesk's gate is documented from its source (middleware
  and the controller); ours was exercised through the API and by intercepting the 422 in the browser.
- **WaDesk's throttle, CSRF page and tenant scoping** were read from the source and checked only in the cheap ways (a post without the
  page's token changed nothing; another workspace's id is a plain 404 by the scoped query). The 120-a-minute limit was not measured.
- **WhatsApp delivery, the calendar and the AI copilot** (WD-PROP-011 delivery, 019 to 022): the reference has no connected engine,
  calendar data or AI key; ours does not build them (L7).
- **Email from ours** goes through the mail port; the send dialog and the 422 on a missing address were exercised, a real inbox was
  not (the dev mail catcher was not read).
- **WaDesk's staff list and modal at pixel level.** The shell and tables differ on purpose (extensions 1 and 7); the comparison is
  of fields, rules, states and responsiveness, not of colours and spacing.
- **WaDesk's own accept-on-click** was driven twice by a script whose click timed out while the post still went through (the form
  posts anyway); the database rows, not the click, are the evidence for B04 to B08.
- **The generic twin harness** was not used (it needs bash, python3 and `setsid`) and no twin spec is committed; the scripts that
  produced this file live outside the repo. The stamp is therefore `open-defects`, not `clean`.
- **Run side effects.** Everything created on ours is tagged `PAR-` and was deleted, voided or left only where the design forbids
  deleting it (accepted and converted documents, issued invoices, ledger entries, one closed sales order, issued credit notes: 37
  documents remain, and 40 invoices: 32 voided by the cleanup, 8 with ledger entries; all tagged `PAR-`, the converted ones by their
  quote's reference). On the reference, every proposal and estimate of the workspace `Parity Workspace` was deleted again; its 9
  invoices and 5 payments remain (WaDesk has no screen to delete either), as do the workspace and the user `user@wadesk.test` that this
  run registered.
