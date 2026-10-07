# Runbook: price and publish the Forms app (operators and developers)

Forms (the Form Builder, backlog BL-093) is a **paid first-party Marketplace app**. On every database the migrations leave it **unpriced and
unpublished**, so no workspace can see or buy it, and every workspace answers `PLAN_FEATURE_LOCKED` on the Forms routes. That is by design: the
price is the platform operator's decision, so nothing is hard-coded. API and rules: [../api/forms-builder.md](../api/forms-builder.md); the
marketplace side: [../api/marketplace.md](../api/marketplace.md) ("Paid and free apps", "Appointments as a paid app" is the same recipe).

**On a local development database, one command does all of this:** `pnpm --filter @crm/api build && pnpm --filter @crm/api seed:forms -- --workspace <slug>` (price 799 INR, add-on, plan visibility, publish, and a comped subscription for that workspace so the Forms menu appears). See [dev-seed-marketplace-apps.md](dev-seed-marketplace-apps.md). Below is what it does, as the console / operator API steps (the manual fallback, and what a real environment uses). Forms has no existing users, so there is **nothing to comp** except the workspaces you pick: skip "Comp existing users".

## What the migrations already did

| Migration                                 | Effect                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261031100000_forms_core`               | the tables, the lookup function and the partitions                                                                                                                                                                                                                                                                          |
| `20261031100100_forms_permissions`        | the eight `record.forms.*` and `record.form-submissions.*` keys, tagged with the plan feature `form_builder`; Manager and Agent presets of existing workspaces                                                                                                                                                              |
| `20261031100200_mkt_forms_app`            | the listing `forms` as a **draft**, `paid_monthly`, **price not set**, `grants_plan_features: [form_builder]`, `grandfather_existing: false`, category Sales tools, version `1.0.0` draft; `form_builder: false` on every plan row; the caps 10 forms, 500 submissions a month, 50 AI generations a month on every plan row |
| `20261031100300_forms_company_domain_idx` | the index the company match uses                                                                                                                                                                                                                                                                                            |

## 1. Set the price (operator console, Marketplace, the `forms` listing)

Decision D1 of the spec recommends **799 INR a month (about 9.99 USD)**; a 7-day trial only if you turn trials on for apps (the AI builder is the cost
risk; trial AI generations are capped at 10 in phase 2). Payment collection will be included in the price (phase 3).

Console: open the listing `forms` and use **Pricing**. Or the operator API (`platform.market.pricing`, an MFA-enrolled operator's bearer token):

```http
PUT /v2/platform/marketplace/apps/forms/pricing
{ "rowVersion": <the listing's>, "model": "paid_monthly", "amount": "799.00", "currency": "INR", "trialDays": 0, "purchasable": true }
```

This creates the billing add-on pack that sells the app (`mkt_forms`). The currency must be enabled on the platform. Publishing is refused with
`409 MKT_VERSION_STATE` / `price_not_set` until this is done.

## 2. Show the add-on on the plans that should offer it

A workspace sees a paid app in its Marketplace only if its plan makes the add-on visible (`plan_visible_addons`). In the console, **Plans > edit a plan >
Add-ons**, tick the Forms pack on each plan that may buy it, and save. (The Appointments seed script does the same for every active plan.)

Check the caps on the plan's **Limits** tab: `forms`, `form_submissions_monthly`, `ai_form_generations_monthly` carry the D1 defaults (10, 500, 50) on
rows that existed at migration time. A plan created later starts with **no cap (unlimited)** for them: set them. A workspace override can raise or
lower them per workspace (plan overrides; `-1` means unlimited).

## 3. Approve and publish

Review is a separate permission (`platform.market.review`):

```http
POST /v2/platform/marketplace/apps/forms/versions/<versionId>/submit     (manage)
POST /v2/platform/marketplace/apps/forms/versions/<versionId>/approve    (review)
POST /v2/platform/marketplace/apps/forms/publish                         (review)
```

The first-party manifest asks for `contacts.read`, `contacts.write`, `forms.read` and `forms.write`; the person who installs may only grant scopes whose
permission keys they hold themselves (`MKT_SCOPE_EXCEEDS_INSTALLER`).

## 4. Try it on your own workspace

- Comp your own test workspace so you do not have to pay: `POST /v2/platform/marketplace/apps/forms/subscriptions/comp`
  `{ "workspaceId": "<organization uuid>", "months": null, "note": "dev" }` (`platform.market.pricing`).
- Or, for a throwaway database only, give the workspace the feature directly: `UPDATE org_plan_state SET overrides = jsonb_set(coalesce(overrides, '{}'),
'{features,form_builder}', 'true') WHERE org_id = <id>;` (a plan override beats the add-on; this is what the end-to-end tests do). Never do this in
  production: it bypasses the subscription and the revenue.
- Then, as the workspace's Owner or Admin: `GET /v2/forms/templates` should answer 200 (it answers 422 `PLAN_FEATURE_LOCKED` without the app).

## 5. Public URLs, embeds and the web app

- The hosted page is `https://<web origin>/f/<publicKey>` (the web app); the embed loader is `https://<api origin>/form-embed/<publicKey>/embed.js`
  (the API). `WEB_APP_URL` and `APP_URL` build both in the share links, so they must be the **public** addresses in production.
- The web app's relay must forward the visitor's address (`X-Forwarded-For`): the per-address rate limits key on it, and `TRUST_PROXY` must name your
  proxies, or every visitor shares one budget.
- The web app must answer `Content-Security-Policy: frame-ancestors` per form for `/f/*` from `PublicForm.frameAncestors` (`hosted` without `?embed=1`,
  `embed` with it), and drop `X-Frame-Options` for the embed response only.
- `CORS_ORIGINS` is **not** how a customer's page is allowed to call the form: each form has its own allow-list (Share tab), answered by the form's own
  preflight. Do not add customer sites to `CORS_ORIGINS`.
- CAPTCHA: a form with `captchaMode` `inherit` or `on` is gated only when the platform's reCAPTCHA is configured and enabled (console, Settings, Social and
  captcha). With none configured there is nothing to enforce.

## 6. Retention and operations

- The worker (`pnpm dev:worker`, the `worker.ts` entrypoint) must be running: it delivers the notifications (in-app and email through the platform's
  SMTP, so SMTP must be configured) and runs the **daily retention sweep** at 03:17 (answers purged after the form's `retentionDays`, default 365;
  analytics events deleted after 90 days). A form's `retentionDays` is stamped on a submission when it is stored; changing the form later does not move
  existing submissions.
- Kill switch: the Marketplace's `POST /apps/forms/kill` stops the app; the plan feature goes with the subscription. Public forms answer 404 as soon as
  the entitlement is gone and the data is kept.
- Monitoring: a growing `needs_review` count on a form, or `form.submission_failed` events, mean submissions that did not become contacts; the form's
  Needs attention tab lists them with the reason and a retry. A non-empty `web_form_events_default` partition means partition maintenance is behind
  (the same alert as the other monthly streams).
- Backup and erase: a visitor's request to erase their data is the per-submission **Erase** plus the ordinary contact delete; export of one person's
  submissions is the CSV export filtered by contact.
