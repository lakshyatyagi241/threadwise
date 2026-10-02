# API: coupons, credit packages, referral/affiliate, currencies (CPN)

Base path `/v2`. Money in requests and responses is a decimal string, except referral and wallet amounts, which are integer
hundredths ("minor") of the platform currency. Errors are problem+json; branch on `code`. Operator routes need an operator
session: every operator role reads, only `super_admin` writes (a support operator gets 403 on writes).

## Coupons (operator) — TW-CPN-001..005

| Method and path                    | What                                                                                                                                                                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /platform/coupons`            | `?q=&status=all\|active\|disabled\|expired&limit=12&cursor=`. Newest first. Returns `data`, `page`, `total` (matching), `stats` (total, active, expired, redeemed: global) and `counts` (pill counts: global). |
| `GET /platform/coupons/options`    | `{ plans: [{slug,name,kind}], currencies: [{code,symbol}] }` for the form (static INR/USD/EUR/GBP/AED when the catalog is empty).                                                                              |
| `GET /platform/coupons/:id`        | One coupon.                                                                                                                                                                                                    |
| `POST /platform/coupons`           | Create. The code is trimmed and upper-cased and unique ignoring case.                                                                                                                                          |
| `PATCH /platform/coupons/:id`      | Edit. Needs `rowVersion`. Only sent fields change; `null` clears an optional field; `applicablePlanSlugs: []` means any plan. A call that changes nothing writes nothing.                                      |
| `PUT /platform/coupons/:id/active` | `{ "value": true }`. Idempotent.                                                                                                                                                                               |
| `DELETE /platform/coupons/:id`     | 204. Past orders keep their discount and code.                                                                                                                                                                 |

```json
// POST /v2/platform/coupons
{ "code": "welcome10", "type": "percent", "amount": "10", "description": "10% off your first plan purchase",
  "maxDiscountAmount": "50", "currencyCode": "USD", "minOrderAmount": "20", "maxUses": 100, "perUserLimit": 1,
  "applicablePlanSlugs": ["growth"], "startsAt": "2026-10-01T00:00:00Z", "expiresAt": "2026-12-31T23:59:59Z",
  "isActive": true, "firstPurchaseOnly": false, "stackableWithOther": false }
// 201
{ "id": "…uuid", "code": "WELCOME10", "usesCount": 0, "isExpired": false, "rowVersion": 1, "…": "…" }
```

Errors: `CPN_COUPON_CODE_TAKEN` 409, `CPN_COUPON_PLAN_UNKNOWN` 422, `ROW_VERSION_CONFLICT` 409, `VALIDATION_FAILED` 422 (expiry before start,
`maxUses`/`perUserLimit` < 1, bad type, negative or non-numeric amount, over-long text).

## Coupons at checkout — TW-CPN-006..008

`POST /billing/checkout/plans/:planSlug/coupon` (permission `paygw.checkout.create`, 20 checks a minute per member):

```json
// request: the server prices the plan itself, nothing the browser sends about money is read
{ "code": " welcome10 ", "currency": "USD", "period": "monthly" }
// 201
{ "ok": true, "message": "Coupon applied.", "discount": "10.00", "code": "WELCOME10",
  "currency": "USD", "subtotal": "100.00", "tax": "16.20", "total": "106.20" }
// rejected: still 201, ok:false, the reason a buyer reads, summary unchanged
{ "ok": false, "message": "This coupon has expired.", "discount": "0.00", "code": null, "…": "…" }
```

`POST /billing/checkout/plans/:planSlug/orders` takes the same `coupon` string. A refused code is `422 CPN_COUPON_REJECTED` with the
reason in `detail`, and no order is created. The order stores `discount_amount`, `coupon_id` and the `coupon_code` snapshot; the
redemption is counted once, in the transaction that marks the order paid. A coupon that takes the whole price off needs no gateway:
the order is fulfilled at once and the response is `next: { type: "paid" }`. Resolver messages, in evaluation order: `Enter a coupon
code.`, `Coupon "X" not recognised.`, `This coupon is disabled.`, `This coupon is not active yet.`, `This coupon has expired.`, `This
coupon is fully used.`, `This coupon is only valid for payments in XXX.`, `This coupon cannot be combined with another coupon.`, `This
coupon is valid on your first purchase only.`, `You have already used this coupon the maximum number of times.`, `Order is below the
coupon minimum.`, `This coupon does not apply to this plan.`, `Coupon yielded no discount.`. `429 CPN_COUPON_THROTTLED` when over the limit.

## Credit packages — TW-CPN-009..013

The catalogue is the wallet domain's (TW-WALLET-019): `GET|POST /platform/wallet/packages`, `PUT|DELETE /platform/wallet/packages/:id`,
`POST /platform/wallet/packages/:id/toggle`; web `/admin/wallet/packages`. See `docs/api/wallet-message-billing.md`. The bundle checkout
and the legacy self-confirm route are not ported (see the parity file).

## Currencies (operator) — TW-CPN-018..024

| Method and path                         | What                                                                                                                          |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `GET /platform/currencies`              | `?q=&limit=12&cursor=`. By code. `stats` {total, active, inactive, defaultCode}, `activeOptions`.                             |
| `POST /platform/currencies`             | `{ name, code, symbol?, precision 0..6 (2), exchangeRate ("1"), isActive (true) }`                                            |
| `PATCH /platform/currencies/:id`        | name, symbol, precision, exchangeRate, isActive + `rowVersion`. The code never changes.                                       |
| `PUT /platform/currencies/:id/active`   | `{ "value": false }`; refused for the default.                                                                                |
| `DELETE /platform/currencies/:id`       | 204; refused for the default and for a currency still used by a workspace, plan, gateway, coupon, package or deal.            |
| `PUT /platform/currencies/default`      | `{ "code": "INR" }` → `{ "defaultCode": "INR" }`. Must be an active catalog currency; stored as text in the General settings. |
| `POST /platform/currencies/fetch-rates` | `{ updated, provider }`. Every catalog currency the provider knows is updated; the rest are untouched.                        |

`exchangeRate` is units of the currency per one US dollar. Errors: `CPN_CURRENCY_CODE_TAKEN` 409, `CPN_CURRENCY_IS_DEFAULT` 409,
`CPN_CURRENCY_IN_USE` 409 (details name what uses it), `CPN_CURRENCY_NOT_ACTIVE` 422, `CPN_RATES_FETCH_FAILED` 502 (`detail` is the
reason: `Rate provider returned HTTP 500`, `Rate provider returned no rates.`, `Fetch failed: …`; rates are unchanged).

## Workspace currency — TW-CPN-027

`GET /workspace/currency` → `{ currency|null, effective, platformDefault, options[] }` (any member).
`PUT /workspace/currency` `{ "currency": "EUR" | null }` (permission `org.owner_settings.manage`): `422 CPN_WORKSPACE_CURRENCY_INVALID`
for a code outside the active catalog. `null` follows the platform default.

## Affiliate (the signed-in person) — TW-CPN-035..037

No permission key; the data is the caller's own referrals.

| Method and path          | What                                                                                                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /affiliate/me`      | `{ code, link, rewardMinor, currency, creditsPerMessage, payPerMessage }`; the code is created on first ask.                                                                                                                                            |
| `GET /affiliate/summary` | Account tab: `me`, true lifetime `signupsLifetime`, `signups30d`, `earnedMinor`, 50 `recent`.                                                                                                                                                           |
| `GET /affiliate/history` | `?range=7d\|30d\|90d\|all&bucket=daily\|weekly\|monthly&q=&limit=20&cursor=`: `data`, `page`, `total`, `stats`, `volume`, `topCodes`, `payouts` (last 8, sources `referral.paid` and legacy `referral.signup`), `range`. Search never changes the KPIs. |
| `GET /affiliate/export`  | `?range=` CSV (UTF-8 BOM): `id,created_at,referee_name,referee_email,code_used,credits_awarded,wallet_tx_id`, newest first, formula-safe.                                                                                                               |

Attribution and the bonus are not endpoints: the sign-up emits `referral.attributed`, the worker records the referral, and
`paygw.order.paid` pays the referrer's wallet (`earn`, source `referral.paid`, key `referral:<referral uuid>`) once, on the referee's
first paid order of any kind. The bonus is the wallet economics setting `referralSignupMinor` (default 100).

## Seeds

The installer's "defaults" step (and `pnpm db:seed`) writes the 30 starter currencies, the demo coupons WELCOME10 and SAVE20 (only into an
empty coupon table) and the Starter / Growth / Scale credit packages, `ON CONFLICT DO NOTHING`.
