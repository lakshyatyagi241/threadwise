# Parity: coupons, credit packages, referral/affiliate, currencies (CPN)

Evidence is automated against a real Postgres and Redis through the app harness: `apps/api/test/e2e/coupons-credits-referral-currency/`
(coupons 15, currencies 26, checkout 19, referral 22, seed 3), `apps/api/test/integration/coupons-credits-referral-currency/rls.spec.ts` (9: forced
RLS, constraints, cascades), `apps/api/test/unit/coupons-credits-referral-currency/` (33: every coupon rule and its order, money helpers, referral
rules), and the web suites under `apps/web/src/features/coupons-credits-referral-currency/` and `platform-payment-gateways/` (coupon card).

## Not verified (read this first)

- **No browser twin run.** The Reference reference needs MariaDB, PHP and `sudo` installs that this sandbox does not have (no Docker, no MySQL), so
  `threadwise-playwright-parity` could not run against the reference and no stamp exists. Behaviour was compared from the reference source (`Coupon.php`,
  `CouponController`, `CurrencyController`, `ReferralService`, `AffiliateHistoryController`, `CurrencySeeder`, the Blade views) and the inventory, not
  from a side-by-side in a browser. The web tests render to static markup: click flows (Apply on Enter, row switches, delete confirm) are covered by
  their pure logic and by the API tests, not by a browser.
- Live exchange rates were tested against a stand-in for open.er-api.com, never the real service (outbound hosts are policy-limited here).
- The checkout was tested through a faked Stripe; a real gateway was not called.
- Orders whose gateway returns zero-amount behaviour: not applicable, a fully discounted order never reaches a gateway (see deviations).

## Status

Built end to end: TW-CPN-001 to 008, 018 to 029, 031 to 033, 035 to 037. Built by other domains and checked here: 009 to 013 (WALLET catalogue), 014 (sign-up link),
030 (AUTH: `?ref` cookie and form), 034 (WALLET economics `referralSignupMinor`). Not ported on purpose: 015, 016 (bundle checkout retired), 017 (security defect), 038 (docs-only claim).

## Deviations from Reference (all intended, need owner approval)

| Where                                            | Reference                                                | Here                                                                                                                                 | Reason               |
| ------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| Coupon code uniqueness                           | case-insensitive only through the MySQL collation     | stored upper-case, unique constraint, checked in the API                                                                             | TW-CPN-002 rule 1    |
| Clearing a plan restriction                      | impossible from the edit form                         | `applicablePlanSlugs: []`                                                                                                            | TW-CPN-003 defect    |
| Plan restriction storage                         | JSON of package ids, no FK                            | `text[]` of plan and add-on slugs, validated against `plans`                                                                         | integrity            |
| Toggle                                           | flips                                                 | `PUT :id/active {value}` (idempotent)                                                                                                | port note            |
| No-change edit                                   | audit nothing, bump nothing (Laravel)                 | same, made explicit                                                                                                                  | parity               |
| Delete and re-create a code                      | per-user history resets (counted by coupon id)        | counted by the order's code snapshot, so history survives                                                                            | TW-CPN-005 loophole  |
| Preview amount                                   | trusted the browser's subtotal                        | priced by the server; the response carries subtotal, tax, total                                                                      | TW-CPN-007 rule 1    |
| Preview throttle                                 | none                                                  | 20 a minute per member                                                                                                               | TW-CPN-007 rule 3    |
| Rounding                                         | 2 decimals for every currency                         | the currency's own exponent (identical for 2-decimal currencies)                                                                     | TW-CPN-006 rule 11   |
| Fully discounted order                           | sent to the gateway, behaviour unverified             | fulfilled at once, no gateway call                                                                                                   | TW-CPN-008 rule 6    |
| Coupon list pages                                | page numbers                                          | cursor with Prev/Next and "Showing a-b of N"                                                                                         | architecture rule    |
| Default currency                                 | `SystemSetting::set` stored it as int, reading back 0 | text in General settings; must be an active catalog currency; one rule for both writers; the checkout and wallet read the same value | TW-CPN-024 defect    |
| Deactivate, delete, re-code the default currency | allowed, corrupts conversions                         | refused (`CPN_CURRENCY_IS_DEFAULT`)                                                                                                  | TW-CPN-021/022       |
| Delete a used currency                           | allowed, orphans prices                               | refused (`CPN_CURRENCY_IN_USE`) naming what uses it                                                                                  | TW-CPN-022 port note |
| Currency code                                    | editable                                              | immutable once saved; shape `^[A-Z][A-Z0-9]{1,9}$`; unique ignoring case                                                             | TW-CPN-020 rule 1    |
| Edit a currency                                  | route only, no UI, omitted flag deactivated           | inline edit UI; only sent fields change                                                                                              | TW-CPN-020           |
| Re-seeding                                       | overwrote rates, re-activated                         | `ON CONFLICT DO NOTHING`                                                                                                             | TW-CPN-025           |
| Currency symbol cache                            | up to 5 minutes stale                                 | flushed on every catalog write                                                                                                       | TW-CPN-026 rule 8    |
| `MoneyFormat::display`                           | always /100                                           | same exponent as `toMinor`                                                                                                           | TW-CPN-028           |
| Referral bonus race                              | could double-pay                                      | referral row locked, ledger key from the referral                                                                                    | TW-CPN-033           |
| Referral payout in history                       | filtered on the legacy source, never showed           | reads `referral.paid` and `referral.signup`                                                                                          | TW-CPN-035 rule 4    |
| History units                                    | raw minor integers labelled credits                   | money in the platform currency on both screens                                                                                       | TW-CPN-037           |
| Account tab totals                               | counted the 50 rows shown                             | true lifetime counts                                                                                                                 | TW-CPN-037           |
| Daily bucket                                     | server default overrode the tab                       | client always sends the bucket                                                                                                       | TW-CPN-035 rule 3    |
| CSV                                              | no BOM, formulas unguarded                            | BOM, formula-safe                                                                                                                    | port note            |
| Workspace currency                               | any catalog row accepted                              | active catalog currencies only; written to the settings document and mirrored to `workspace_settings`                                | TW-CPN-027           |
| Referral cookie name                             | `threadwise_ref`                                          | `crm_ref` (AUTH), same rules                                                                                                         | AUTH                 |
| Audit                                            | `Audit::log` / observer                               | `security_events` rows by operators, field names and old/new values                                                                  | repo rule            |

## Open follow-ups

| What                                                                                                                    | Who              |
| ----------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Mobile `coupon/available`, Shopify/Woo offer composers, booking-template coupons read `coupons`                         | MOB, STORE, APPT |
| Social sign-up carries no referral code; the OTP step may drop the cookie fallback (unconfirmed)                        | AUTH             |
| A "More" hub with the affiliate counters does not exist yet; the history page is reached from the Account Affiliate tab | shell            |
| `plans-subscriptions-trials/messages.test.ts` fails on a missing `limits.saved_replies` key (not touched by this work)  | PLAN             |
| Currency display money hook for customer screens (needs a customer-readable catalog endpoint)                           | CPN follow-up    |
