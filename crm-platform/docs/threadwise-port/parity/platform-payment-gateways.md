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
| TW-PAYGW-028                          | partial: plan stacking and wallet credit done; add-on grant, coupon use count and referral payout wait for their domains |
| P1 / P2 features                      | not verified in this run; see the final report of the run (only what has a passing test counts as done)                  |
| TW-PAYGW-010                          | blocked on the coupons domain (CPN); coupon codes are refused with a validation error                                    |

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
