# Coupons, currencies and the referral programme (CPN)

Ids on the wire are uuids. Validation failures are `422 VALIDATION_FAILED`; a malformed cursor is `400`. Errors are problem+json with a stable `code`. Shapes: `packages/contracts/src/coupons-credits-referral-currency`.

Credit packages (TW-CPN-009..017) moved to the wallet domain: see `docs/api/wallet-message-billing.md` (`/v2/platform/wallet/packages`).

## Operator console, coupons and currencies: `/v2/platform`

Every operator role reads; writes need `super_admin` and are recorded in `security_events`. Page size is 12; money is a decimal string.

| Route                                                                                                             | What                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `GET /coupons?q&status=all\|active\|disabled\|expired&page`                                                       | coupons newest first, the four KPI cards and the pill counts (global, never narrowed by search)               |
| `GET /billing-options`                                                                                            | plans and active currencies the forms offer                                                                   |
| `GET /coupons/:id` · `POST /coupons` · `PATCH /coupons/:id` · `PATCH /coupons/:id/active` · `DELETE /coupons/:id` | one coupon; create (code upper-cased, unique); partial update with `rowVersion` (stale = 409); toggle; delete |
| `GET /currencies?q&page`                                                                                          | the catalogue by code, KPI strip, default selector                                                            |
| `POST /currencies` · `PATCH /currencies/:id` · `PATCH /currencies/:id/active` · `DELETE /currencies/:id`          | add; edit (the code never changes); toggle; delete (refused for the default or one in use)                    |
| `POST /currencies/default` · `POST /currencies/fetch-rates`                                                       | choose the platform default; replace the rates with the live ones                                             |

Sample (`GET /v2/platform/coupons?status=active`):

```json
{
  "data": [
    {
      "id": "6f1c3a52-0b0e-4f55-9c1e-1d6b5d2f7a10",
      "code": "WELCOME10",
      "description": "Ten percent off a first plan",
      "adminNote": null,
      "type": "percent",
      "amount": "10",
      "maxDiscountAmount": "50",
      "currencyCode": null,
      "minOrderAmount": null,
      "maxUses": 100,
      "perUserLimit": 1,
      "usesCount": 3,
      "applicablePlans": [],
      "startsAt": null,
      "expiresAt": "2026-12-31T23:59:59.000Z",
      "isActive": true,
      "firstPurchaseOnly": true,
      "stackableWithOther": false,
      "isExpired": false,
      "createdAt": "2026-10-01T09:00:00.000Z",
      "updatedAt": "2026-10-01T09:00:00.000Z",
      "rowVersion": 1
    }
  ],
  "summary": { "total": 1, "active": 1, "expired": 0, "redeemed": 3 },
  "counts": { "all": 1, "active": 1, "disabled": 0, "expired": 0 },
  "page": 1,
  "pageSize": 12,
  "defaultCurrency": "USD",
  "total": 1,
  "pageCount": 1,
  "from": 1,
  "to": 1
}
```

Sample (`POST /v2/platform/currencies` with `{"name":"Euro","code":"eur","symbol":"€","precision":2,"exchangeRate":"0.92"}`): `201` with the created item

```json
{
  "id": "b2d7c0aa-2f3f-4c6b-8a54-0b8fd3a8c9e1",
  "code": "EUR",
  "name": "Euro",
  "symbol": "€",
  "precision": 2,
  "exchangeRate": "0.920000",
  "isActive": true,
  "isDefault": false,
  "createdAt": "2026-10-06T10:00:00.000Z",
  "updatedAt": "2026-10-06T10:00:00.000Z",
  "rowVersion": 1
}
```

Errors: `CPN_COUPON_CODE_TAKEN`, `CPN_COUPON_PLAN_UNKNOWN`, `CPN_CURRENCY_UNKNOWN`, `CPN_CURRENCY_CODE_TAKEN`, `CPN_CURRENCY_DEFAULT_PROTECTED`, `CPN_CURRENCY_IN_USE`, `CPN_RATES_FETCH_FAILED`.

The checkout calls `CouponCheckoutService.quote` (preview and the binding re-check) and `redeemForOrder` (inside the paid transition) through the module barrel; there is no HTTP route for them in this domain.

## The referral programme: `/v2/me` (the signed-in user's own data)

Authenticated **users** only (`@ActorKinds('user')`), no permission key: it is the caller's own data, like `/me/locale`. Every statement is scoped in SQL to the caller's workspace **and** user, taken from the session, so a colleague in the same workspace sees none of it.

**One unit convention for every number:** money is an integer count of **hundredths** of the platform currency (`...Minor`, same as the wallet), next to a `currency` code. `250` with `USD` is 2.50 USD. Dates are ISO 8601 UTC; chart buckets are UTC days, Monday-based weeks and calendar months.

| Route                                           | What                                                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /me/referral`                              | code, link, reward, true lifetime and 30-day counts, earned, the 50 newest referrals (the account tab)                                |
| `GET /me/referrals?range&bucket&q&cursor&limit` | one page of the table plus stats, volume chart, top codes and recent payouts (the history dashboard)                                  |
| `GET /me/referrals/export?range`                | CSV download, UTF-8 with BOM, newest first, columns `id,created_at,referee_name,referee_email,code_used,credits_awarded,wallet_tx_id` |

`range` is `7d | 30d | 90d | all` (default `90d`). `bucket` is `daily | weekly | monthly`; **a bucket you send is always honoured**, and when absent the server picks by range (daily up to 14 days, weekly up to 90, monthly beyond). `q` searches referee name, email and code, literally (no wildcards), and changes the table only, never the stats. `limit` 1..100, default 20. Pagination is a keyset cursor (`page.nextCursor`), never an offset. The first read issues the user's code if they have none (the lazy backfill for users that predate the programme); a code is never changed afterwards.

Sample (`GET /v2/me/referral`):

```json
{
  "currency": "USD",
  "code": "K7M3QX9RTA",
  "link": "https://app.example.com/register?ref=K7M3QX9RTA",
  "rewardMinor": 250,
  "messagePriceMinor": 100,
  "payPerMessage": false,
  "lifetimeCount": 60,
  "last30dCount": 12,
  "earnedMinor": 1500,
  "recent": [
    {
      "id": "0c8e5a4e-7e19-4a8a-bd1c-52c4a7f0c3d2",
      "createdAt": "2026-10-05T08:12:44.120Z",
      "refereeName": "Priya Sharma",
      "refereeEmail": "priya@example.com",
      "codeUsed": "K7M3QX9RTA",
      "creditsAwardedMinor": 250,
      "status": "paid",
      "walletTxId": "9a1d2f0e-2c3b-4d7a-a5f1-6e0b8c4d1a77"
    }
  ]
}
```

Sample (`GET /v2/me/referrals?range=30d&bucket=daily&q=gmail`), abridged:

```json
{
  "currency": "USD",
  "code": "K7M3QX9RTA",
  "link": "https://app.example.com/register?ref=K7M3QX9RTA",
  "rewardMinor": 250,
  "messagePriceMinor": 100,
  "payPerMessage": false,
  "filters": { "range": "30d", "bucket": "daily", "q": "gmail" },
  "data": [
    {
      "id": "0c8e5a4e-7e19-4a8a-bd1c-52c4a7f0c3d2",
      "createdAt": "2026-10-05T08:12:44.120Z",
      "refereeName": "Priya Sharma",
      "refereeEmail": "priya@gmail.com",
      "codeUsed": "K7M3QX9RTA",
      "creditsAwardedMinor": 0,
      "status": "pending",
      "walletTxId": null
    }
  ],
  "page": { "nextCursor": null, "hasMore": false, "limit": 20, "total": 1 },
  "stats": {
    "signupsInRange": 12,
    "signupsPrevious": 8,
    "deltaPercent": 50,
    "signupsLifetime": 60,
    "signups30d": 12,
    "creditsEarnedMinor": 1500,
    "credits30dMinor": 500,
    "avgPerSignupMinor": 25
  },
  "volume": [
    { "start": "2026-09-07", "signups": 0, "creditsMinor": 0 },
    { "start": "2026-09-08", "signups": 2, "creditsMinor": 250 }
  ],
  "topCodes": [{ "code": "K7M3QX9RTA", "signups": 12, "creditsMinor": 500 }],
  "payouts": [
    {
      "id": "9a1d2f0e-2c3b-4d7a-a5f1-6e0b8c4d1a77",
      "amountMinor": 250,
      "createdAt": "2026-10-05T09:30:00.000Z",
      "balanceAfterMinor": 1500
    }
  ]
}
```

`stats.deltaPercent` is the rounded change against the window of the same length right before the range (+100 when the previous window had none and this one has, else 0). `payouts` are the latest 8 wallet entries with source `referral.paid`, whatever the range.

Sample (`GET /v2/me/referrals/export?range=7d`): `200 text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="affiliate-history-20261006-101500.csv"`.

```
<BOM>id,created_at,referee_name,referee_email,code_used,credits_awarded,wallet_tx_id
0c8e5a4e-7e19-4a8a-bd1c-52c4a7f0c3d2,2026-10-05T08:12:44.120Z,Priya Sharma,priya@gmail.com,K7M3QX9RTA,0,
```

`credits_awarded` is hundredths of the platform currency, the same unit as the API. Cells that could run as a spreadsheet formula are prefixed with `'`. The search text is not applied. At most 100,000 rows.

### How a referral comes to exist and pays (no HTTP)

1. `auth.signup_completed` -> `ReferralCodeConsumer` issues the new user's code (`referral_codes`, one per user, 10 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, `crypto.randomInt`).
2. Sign-up (password, OTP-verified or Google/Facebook: the web server fills `referralCode` on the social callback from the `crm_ref` cookie) resolves the code and emits `referral.attributed` -> `ReferralAttributionConsumer` inserts the `referrals` row once (unique per referee; a redelivery changes nothing; self-referral is impossible).
3. `paygw.order.paid` for the referee's workspace -> `ReferralRewardConsumer` locks the referral row, credits the **referrer's workspace wallet** through `WalletLedgerService.post` (`type earn`, `source referral.paid`, key `referral:<id>`), stamps the referral, writes the audit row and emits `referral.rewarded`, all in one transaction. A reward of 0 pays nothing and leaves the referral to be re-evaluated on a later order.

The reward amount is `referralSignupMinor` in the wallet settings (`PUT /v2/platform/wallet/settings`, field `referralSignup`, 0 to 100,000.00; every save is logged with the old and new value).
