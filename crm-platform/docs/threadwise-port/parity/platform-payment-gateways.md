# Parity evidence: platform-payment-gateways (PAYGW)

Reference 1.7.0 vs this branch. Port map: [port-map/platform-payment-gateways.md](../port-map/platform-payment-gateways.md).

## Evidence

- `apps/api/test/e2e/platform-payment-gateways/paygw.e2e.spec.ts`: 21 scenarios over HTTP against real Postgres (gateway admin, activation guard, quote, place order, downgrade refusal, return, webhook, fulfilment, wallet top-up, buyer history, tenant isolation).
- `apps/api/test/unit/platform-payment-gateways/drivers.spec.ts` (21) and `rules.spec.ts` (25): drivers, money exponents, order pricing, fulfilment stacking, gateway rules.
- `apps/web/src/features/platform-payment-gateways/*.test.ts`: 13 tests for client logic and message keys.

## Status

| Id                                    | Status                                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| TW-PAYGW-001..005, 008, 014..016, 048 | done (catalogue, admin list/save/activate, credential schema, driver port, Stripe, Razorpay, PayPal)                     |
| TW-PAYGW-009, 011, 026, 027, 031, 035 | done (checkout, order, return, webhook, wallet top-up, buyer history)                                                    |
| TW-PAYGW-028                          | done: plan stacking, add-on grant (AddonFulfilmentService), wallet credit, coupon use count; referral payout waits for CPN |
| P1 / P2 features                      | not verified in this run; see the final report of the run (only what has a passing test counts as done)                  |
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
