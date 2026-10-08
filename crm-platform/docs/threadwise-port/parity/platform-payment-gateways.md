# Parity evidence: platform-payment-gateways (PAYGW)

Reference 1.7.0 vs this branch. Port map: [port-map/platform-payment-gateways.md](../port-map/platform-payment-gateways.md).

## Evidence

- `apps/api/test/e2e/platform-payment-gateways/paygw.e2e.spec.ts`: 21 scenarios over HTTP against real Postgres (gateway admin, activation guard, quote, place order, downgrade refusal, return, webhook, fulfilment, wallet top-up, buyer history, tenant isolation).
- `apps/api/test/unit/platform-payment-gateways/drivers.spec.ts` (21) and `rules.spec.ts` (25): drivers, money exponents, order pricing, fulfilment stacking, gateway rules.
- `apps/web/src/features/platform-payment-gateways/*.test.ts`: 13 tests for client logic and message keys.

## Status

| Id                                    | Status                                                                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| TW-PAYGW-001..005, 008, 014..016, 048 | done (catalogue, admin list/save/activate, credential schema, driver port, Stripe, Razorpay, PayPal)                         |
| TW-PAYGW-009, 011, 026, 027, 031, 035 | done (checkout, order, return, webhook, wallet top-up, buyer history)                                                        |
| TW-PAYGW-028                          | done: plan stacking, add-on grant (AddonFulfilmentService), wallet credit, coupon use count; referral payout waits for CPN   |
| P1 / P2 features                      | not verified in this run; see the final report of the run (only what has a passing test counts as done)                      |
| TW-PAYGW-010                          | done through a shim in this zone (`coupon.service.ts`, reads `coupons` through PaygwStore); swap to CPN's barrel when merged |

## Deliberate deviations

- Amounts use one exponent table (zero- and three-decimal currencies); Reference always multiplies by 100. Reason: correctness.
- Redirect parameters are never proof of payment; every driver confirms server to server or by HMAC. Reason: security.
- Credentials are one AES-256-GCM envelope; secrets never leave the API (`hasValue` only).

- Lifetime spend is returned per currency, not converted into one workspace currency (TW-PAYGW-035 acceptance 2): no exchange-rate service is wired into the history read. Reason: no silent rate guess.
- The webhook answers 200 {ok:true} as Reference does.

## Not verified

- Screens were not compared pixel-by-pixel against the running reference in this run.
- `pnpm test:integration` (testcontainers) not run: Docker is off limits to this worker.
- `apps/api` spec typecheck fails in upstream `test/e2e/broadcasts/broadcasts-read.e2e.spec.ts` (not this domain).

## Round 2: Billing & plans (admin)

tier P0 done: TW-PAYGW-001..005, 008, 009, 011, 014..016, 026..028, 031, 035, 048 (028 completed: coupon count in the paid transaction; add-on grant covered by an e2e test)
tier P1 (billing part) done: TW-PAYGW-007, 010, 037, 038, 041, 043, 046
tier P2 (billing part) done: TW-PAYGW-039, 040, 042, 044, 045

Tests: `admin-billing.e2e.spec.ts` (24), `paygw.e2e.spec.ts` (26 incl. 4 coupon scenarios), `admin-billing.spec.ts` unit (10), web `billing.test.ts` + messages (13 new).

Screens compared against the running Reference (order history, billing history, invoices, billing settings; the live copy has no orders, so rows were compared from the Blade source): same header (eyebrow, two-tone title, actions on the title row), KPI strip, pills, search, table columns, footer, awaiting-approval panel, settings sections and order. Menu: the four entries sit in the Billing group after Payment gateways, Reference's order.

### Deliberate deviations (intended)

- Order type is real (new, renewal, upgrade, downgrade by converted plan price, add-on, wallet top-up, manual), derived from the workspace's previous paid plan order; Reference's pills and badges used two vocabularies. KPI "Upgrades" = paid new + upgrade orders; "Downgrades" is real, not a constant 0; "Add-on bundles" = paid add-on and wallet top-up orders.
- KPI money is converted into one reporting currency (platform default) with the currency table's rates; Reference added unconverted amounts.
- Search also matches the plan name (the placeholder promised it); admin cancel and invoice void use the distinct `cancelled` status; the Failed bucket of billing history includes cancelled to keep Reference's numbers.
- Reject and delete refuse paid orders (409); approve refuses refunded; invoice mark-paid for plan/add-on/wallet orders also applies fulfilment (the UI sends `applyFulfilment`), manual invoices only record payment. All actions write a security event (Reference wrote none for invoices).
- Due date is issue date + 15 days and "days late" counts from it; a manual invoice prints its description and is its own order kind.
- Order analytics: funnel keeps only real stages (sign-ups, converted); countries come from the billing country entered at checkout; cohorts use organization status/updated_at as the end date proxy.
- Pagination is page-numbered (12 per page) as in Reference, not cursor-based. CSV export works (Reference's buttons were dead), capped at 5000 rows, formulas neutralised.
- Billing settings default tax is off (round 1's single source of defaults; Reference's form showed 18% GST). Logo is stored in platform settings (no file module), served with a sandbox CSP.
- Coupon: preview is priced server-side (no client amount), preview and placement share one currency; numeric legacy package ids in `applicable_package_ids` never match (fail closed, slugs do).

### Not ported on purpose

- Dead selection checkboxes and hidden mock menu items of the invoices list; Reference's advertised PDF generation, email and reminders (docs-only); the unused mock chart scripts; TW-PAYGW-032 (dead code).

### Not built yet

- TW-PAYGW-006 whitelist is built in round 1; remaining: 012, 013 (offline gateways and proof upload; the approval queue reads `proof_*` columns), 017..025 drivers, 029, 030, 033, 034, 036, 047 (docs-only).

## Round 2: payment gateway side (charging workspaces)

tier P0 done: unchanged from round 1 (see above); the checkout now also handles every `next` step the new drivers return.
tier P1 done: TW-PAYGW-006, 012, 013, 017, 020, 022, 029, 030, 034, 036

Tests: `paygw-offline-subscriptions.e2e.spec.ts` (15: bank-transfer and offline instructions, proof upload with type sniffing, re-upload, RLS, approval, buyer invoice 403/404, in-app confirm, auto-renew checkout, first charge before activation, renewal idempotency, past due, cancel keeps the paid window, reconciler throttle and cancellation), `drivers-p1.spec.ts` (37, recorded fixtures: Paddle, Paystack, Flutterwave, Paytm, PhonePe, Cashfree, PayU, Instamojo, recurring on Stripe/Razorpay/PayPal), web `lib.test.ts` (next-step mapping).

Deliberate deviations (P1):

- Offline instructions are plain rows the browser renders (Reference returned a rendered page); proof bytes live in `order_proof_blobs` behind RLS and are served only to the buyer's order or an operator (Reference used a public disk). A re-upload replaces the file.
- A paid provider return is never taken from the redirect parameters: every driver confirms server to server or by HMAC; an in-app client may only confirm its own order and gets the same check.
- The first subscription charge finalises the order before activating the subscription, so a workspace gets one cycle, not two (Reference's documented 51/58-day bug is fixed on purpose).
- The reconciler is a worker sweep (every 10 minutes, claimed with one atomic update, 6 h per subscription) instead of piggy-backing on the buyer's web traffic; only drivers with `fetchSubscription` (Razorpay) are polled, as in Reference.
- Auto-renew is offered per gateway in the quote (`autoRenew`), never for yearly, free, lifetime or custom-quote plans; a replayed activation is a no-op that emits no second event.

tier P2 done: TW-PAYGW-018, 019, 021, 023, 024, 025 (drivers) and 033 (negative requirement: no endpoint credits a wallet or activates a plan without a confirmed payment, tested)
Every catalogue gateway now has a driver (33 of 33), so no card shows "driver not available yet". Not ported on purpose: TW-PAYGW-032 (dead code), TW-PAYGW-033's mock pages and self-confirm endpoint (replaced by the real order result on Order history), TW-PAYGW-047 (docs-only: refunds and chargebacks).

Tests: `drivers-p2.spec.ts` (57, recorded fixtures for all 20 drivers: request bodies and amounts, return confirmation, signature checks, forged-input cases), `paygw-p2.e2e.spec.ts` (6: Coinbase end to end, PayTR plain `OK` ack, Skrill form post, HyperPay widget, LigdiCash currency refusal, the 033 regression).

Deliberate deviations (P2), all fixes of Reference bugs recorded in the inventory:

- A redirect or an unsigned body is never proof of payment. Mercado Pago (trusted `status=approved` in the URL), Authorize.Net (fell back to the query string when the lookup failed), Braintree (nonce posted with an order number typed by the buyer, a `disbursement` counted as a payment), Square, Tap, Mollie, CinetPay, LigdiCash and Xendit now re-read the payment from the provider and compare our order reference and amount. Notifications without a signature (Tap, Mollie, CinetPay, LigdiCash, Mercado Pago, Authorize.Net) are accepted only when the provider itself returns that payment; the body is used for the id only.
- Lemon Squeezy, Coinbase, Skrill, PayTR, Mollie one-time: a buyer's return leaves the order pending (Reference marked it failed) and the signed notification finalises it, matched by the order number we put in the checkout metadata (not an internal id).
- Lemon Squeezy now verifies `X-Signature` (Reference never forwarded the header, so no webhook was ever accepted). PayTR is answered with the plain body `OK`. Skrill compares the signed `mb_amount`; a notification in another currency than the order is left for an operator.
- LigdiCash refuses non-XOF orders instead of relabelling them. CinetPay amounts keep Reference's multiple-of-5 rounding for XOF, XAF, CDF and GNF.
- Mollie's first recurring payment is completed on the buyer's return (which also creates the subscription), not by the notification, so a plan never ends up paid but never renewing.
- iyzico and PayTR send `127.0.0.1` as the buyer IP and the placeholders Reference used for address and phone; PayTR gets `TL` for Turkish lira (Reference sent `TRY`).
- Midtrans, Duitku, iyzico, PayTR and Skrill checkout pages open as redirects; Reference's inline `snap.pay` script and PayTR iframe are not needed. HyperPay and Braintree render their own widgets in the browser from plain parameters.
- Square auto-renew leaves the buyer on the order history to wait for the first invoice (Reference showed a static page).
- Bank transfer and offline checkout pages follow Reference's copy and order (eyebrow, "Wire the payment", reference callout, proof form, "submit proof later" link).

### Not built

- TW-PAYGW-025 rule 1, the DNS-over-HTTPS fallback of CinetPay (pinning the API host to an address resolved through Cloudflare or Google when local DNS fails). It needs an HTTP client that connects to a fixed IP with the real host name for TLS; the change to the shared HTTP helper was refused by the permission system in this run, so the user must decide. Every other CinetPay rule is built.

## Billing hardening twin run (TW-PAYGW-007, TW-ADD-028 form, grace and recurring add-on screens)

Twin spec `apps/web/e2e/platform-payment-gateways/parity/TW-PAYGW-007.twin.mjs`, full depth, Reference 1.7.0 against this working tree (our API on a scratch copy of the dev database,
our web app in `next dev`). Reads only; nothing was created or changed on either side. The console was driven as a read-only support operator, because a super admin must enrol
two-factor first, so our form controls were disabled during the run.

| Item                                                                                                                                                                                  | Reference                     | Ours                | Result          | Note                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------- | --------------- | ---------------------------------------------------------------------------------- |
| Billing settings keeps every Reference field (rate, label, company identity, tax number, address, registration number, email, phone, refund window, yearly discount, auto-renew section) | present                    | present             | same            | the grace-period field is new, recorded as info only                               |
| Add-on form keeps every Reference field (name, subtitle, price, offer, currency, duration, unit, sort, active, lifetime)                                                                 | present                    | present             | same            | the billing-mode select is new, recorded as info only                              |
| Duration units on the add-on form                                                                                                                                                     | days, weeks, months, years | same                | same            |                                                                                    |
| Access without a session (settings, add-on form, add-ons list)                                                                                                                        | redirected                 | redirected          | same            |                                                                                    |
| Axe checks (settings, add-on form, add-ons list)                                                                                                                                      | no new violations          | no new violations   | same            |                                                                                    |
| Keyboard: skip-to-content link                                                                                                                                                        | none                       | present             | intended        | deliberate improvement                                                             |
| Keyboard: share of controls reachable on the add-on form                                                                                                                              | 0.59                       | 0.44                | intended        | read-only operator, disabled controls are skipped by Tab                           |
| First paint (LCP)                                                                                                                                                                     | fast                       | slower              | intended        | dev-server compile; same ratio on pages this change did not touch                  |
| Keyboard: focus ring on every stop (0.97 and 0.98 against 1)                                                                                                                          | 1                          | 0.97 / 0.98         | open            | console shell, also on untouched admin pages                                       |
| Responsive: one clipped text and one or two extra small tap targets per page                                                                                                          | 0                          | 1                   | open            | console shell, also on untouched admin pages                                       |
| Page structure counts (nav landmarks, buttons)                                                                                                                                        | 1 nav                      | 2 nav, grouped rail | review, ignored | our rail is the grouped navigation of TW-ASHELL-004; side-by-side screenshots read |

The open rows were reproduced on `/admin/coupons` and `/admin/currencies`, which this change does not touch, with the same signature, so they belong to the admin console shell and not to
this work. The grace-period banner and bar, the recurring add-on checkout without the auto-renew tick and the owned add-on cancel button have no Reference counterpart; they are covered by
`apps/api/test/e2e/platform-payment-gateways/paygw-razorpay-addons-grace.e2e.spec.ts`, unit tests and the web unit tests, not by this comparison.

## Round 2 close-out (conformance pass and the last open feature)

tier P2 done: TW-PAYGW-025 rule 1 (DNS-over-HTTPS fallback). `withDnsFallback` in the shared driver helper wraps one call: two attempts; on a name-resolution error (ENOTFOUND, EAI_AGAIN, ENODATA on the error or its cause) the host is resolved through Cloudflare then Google DoH and the call is made against that IP with the real TLS name and Host header (`defaultPinnedHttp`). A resolver answer that is not a public IPv4 address is ignored (same address rule as every outbound guard); a resolver `Status 3` ends in "<host> DNS is missing (NXDOMAIN)". Only CinetPay uses it. Tested with fixtures and no network (`drivers-p2.spec.ts`: 4 new tests). A DNS failure is the only case that reaches DoH.

Screens compared with the running Reference this run (admin console read as a support operator; workspace checkout read from Blade because the live copy has no plans to buy):

| Screen                                                       | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin payment gateways list                                  | Fixed: eyebrow and two-tone title, Reference description and KPI sub-labels ("Total / drivers available", "India region", ...), tab names (US / CA, LATAM) and order, region buckets exactly as Reference's category map (Europe 6, Africa 3, Skrill and LigdiCash under "Other"), gateway names and blurbs from the seeder (new migration `20261111090000_paygw_gateway_copy.sql` updates rows made earlier), `slug:` line, Activate beside a trailing chevron, "Filter by name or slug…". |
| Gateway edit (expanded card)                                 | Fixed: placeholder for saved secrets, "(none = all)", "N selected", toggle hint, "Save <name>", the no-credentials notice for offline gateways. Kept and new: webhook URL field (needed to configure a provider).                                                                                                                                                                                                                                                                     |
| Order analytics, Billing analytics                           | Same sections, copy and numbers; net new MRR and lost MRR now carry Reference's + and - sign. The funnel keeps only stages we can count (recorded earlier).                                                                                                                                                                                                                                                                                                                              |
| Plan and wallet checkout                                     | Fixed from `checkout/show.blade.php`: step trail, two-tone title, refund line, "Step 1/2/3" labels, field order (company, address, city, postal, country, tax id) and placeholders, "Pay in your currency" block, coupon placeholder, live or sandbox chip on each gateway, TLS note, "Change" link, terms and privacy line, refund box, auto-renew wording. Kept and new: a billing period select (Reference chose yearly on the pricing page).                                         |
| Invoice detail (admin and buyer), offline gateway proof flow | Checked against `admin/invoices/view.blade.php` and the bank-transfer and offline views: same sections and copy already; no change needed.                                                                                                                                                                                                                                                                                                                                            |

Help guides: `plan-checkout.md` added next to `order-history.md` and `wallet-top-up.md` (the operator console has no help center audience yet, so admin screens have none).

Gates this run: API unit 162, API e2e for this domain 81 (the offline-subscriptions file needs a quiet machine: run in parallel with four other suites its 240 s start-up hook timed out once, alone it passes in 65 s), web 27, arch:check clean for this domain.
