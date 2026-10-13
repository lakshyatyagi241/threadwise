# Plans, subscriptions, trials and limits (PLAN)

Every plan fact is **per workspace** (organization). A plan is a platform catalogue row; which plan a workspace is on, its trial, its
period and its own overrides live in `org_plan_state` (tenant table, forced RLS; a workspace can read it, only the platform writes it).
`organizations.plan` is the one plan reference (a slug).

Base path `/v2`. Errors are problem+json with a stable `code`.

## Who may do what

| Actor                                                 | Can                                                                                                                                                                                       |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Super admin (platform operator)                       | create, edit, activate, delete plans and set their limits and flags (`/platform/plans`); attach a plan to any workspace and set that workspace's own limits (`/platform/workspace-plans`) |
| Support / auditor operator                            | read the same screens, change nothing (403 on writes)                                                                                                                                     |
| Workspace Owner or Admin (`plan.subscription.manage`) | see every active plan, switch to a free or cheaper/equal plan, downgrade, buy a dearer plan through checkout                                                                              |
| Any other workspace member                            | see the plans, the status bar and their usage; the buttons are off                                                                                                                        |

## Workspace (staff token)

### GET `/billing/plans`

Active plans for the caller's workspace. Each plan: card fields (`price`, `chips`, `highlighted`, `current`, `action`) plus `limits`,
`features` and `via`: `checkout` (a payment), `change` (immediate switch), `sales` (custom quote), `none` (current plan). `action` is one of
`current | upgrade | downgrade | choose | continue_free | contact_sales`. A lapsed paid plan reads as the free plan being current.
`validity` = `{ state, trialEndsAt, planEndsAt, daysLeft, renewalWindow }`; `canManage` says whether the buttons work.
States: `no_plan | free_trial | free_trial_expired | free | paid_active | paid_lapsed | custom_quote`.

### GET `/billing/status`

`validity` plus `planSlug`, `planName`: the trial and renewal bars.

### GET `/billing/usage`

`meters[]` `{ key, used, limit (0 = unlimited), percent (null when unlimited), window: 'month' | 'total' }`, `features[]` `{ key, enabled }`,
`cycleResetsAt` (first of next calendar month). Limits come from the resolver, so overrides and a lapsed plan's fallback are respected.

### POST `/billing/plan` (`plan.subscription.manage`)

Body `{ "planSlug": "mini" }`. Switches at once to a free plan or a paid plan that is cheaper or equal. Keeps a running paid period; clears
the trial when going to a paid plan; never restarts or extends a trial.
Response `{ planSlug, planName, direction: 'upgrade'|'downgrade'|'switch', validity, overLimit: [{ key, used, limit }] }`. `overLimit` lists
caps the new plan sets below what the workspace holds: nothing is deleted, adding more is blocked until under the cap.
Refusals (422): `PLAN_CHECKOUT_REQUIRED` (dearer paid plan; `errors[]` has `checkoutUrl`), `PLAN_CHANGE_NOT_ALLOWED` (custom quote, same plan,
inactive plan). 404 for an unknown plan, 403 without the permission. Audited (`audit_log`, module `plans`) and emits outbox `plan.changed`.

## Trial gate

A workspace on a free plan whose trial ended gets **402** `PLAN_TRIAL_EXPIRED` on feature routes (`errors[]`: `upgradeUrl=/account/plans`,
`trial=expired`) for staff users and API keys. Open: `billing`, `plans`, `payments`, `auth`, `account`, `onboarding`, `support`, `me`, `i18n`,
`shell`, `setup`, `health`, anything marked `@AllowWhenTrialExpired()`, platform operators, platform-owned workspaces. Paid plans (even
lapsed) and free plans without a trial are never gated. An internal error lets the request through.

## Entitlements

Resolution for a cap or flag: platform-owned workspace (never limited) > the workspace's override > its plan (a lapsed paid plan uses the
free plan's values) > registry default. A cap of 0 is unlimited; an override of -1 or 0 is unlimited.

## Platform (operator token)

### GET `/platform/workspace-plans?search=&plan=&cursor=&limit=`

Workspaces newest first, cursor paginated. Item: `workspaceId, slug, name, status, planSlug, planName, validity, billingCycle, overrides,
planLimits, planFeatures, rowVersion`.

### GET `/platform/workspace-plans/:id`

### PUT `/platform/workspace-plans/:id` (super admin)

Body `{ planSlug, rowVersion, planEndsAt?, overrides? }`. `planEndsAt` omitted: the plan's own period when the plan changes, else unchanged;
`null`: never expires; a datetime: that date. `overrides` `{ limits: { key: int }, features: { key: bool } }` replaces the stored overrides (omit to keep).
A different plan clears the trial. 409 `ROW_VERSION_CONFLICT` on a stale `rowVersion`, 404 unknown plan or workspace, 422 unknown override key.
Audited (`security_events` for the operator and `audit_log` for the workspace) and emits outbox `plan.attached`.

### Plan catalogue `/platform/plans`

Unchanged (TW-PLAN-001..005): list, create, update, activate, delete. The limit keys and feature flags are the registry in
`@crm/contracts` (`PLAN_LIMIT_DEFS`, `PLAN_FEATURE_DEFS`).

## Added: yearly price, add-ons, FAQs, cancel auto-renew, ledger, retention

### GET `/billing/plans` additions

Each plan has `yearly: { perMonth, perYear } | null` (12 months of the effective price less `pricing.yearly_discount_pct`, rounded half up to the cent,
the same figure checkout charges; null for free, lifetime, custom-quote and plans not billed once a month). The response has
`yearlyToggle: { enabled, discountPct }` (the setting is on AND some plan has a yearly price) and `subscription: { status, renewsAt } | null`.
Checkout takes the choice as `?period=yearly`.

### Add-ons

`GET /addons` (ADD) lists them. They are bought through the same checkout as plans: `GET /billing/checkout/plans/:slug/quote` and
`POST .../orders` accept an add-on slug. Needs an active paid plan (422 `PAYGW_PLAN_NOT_PURCHASABLE` otherwise). A paid order grants the add-on
(`workspace_addons`) and leaves the plan, the trial and `plan_ends_at` untouched; replays grant it once.

### Pricing FAQs

- `GET /billing/faqs`: every active FAQ (the in-app picker).
- `GET /public/pricing-faqs?for=pricing|home`: active FAQs whose placement is that value or `both`. Public, no sign-in.
- `GET /platform/pricing-faqs` (every operator role); `POST`, `PATCH /:id` (partial, needs `rowVersion`), `DELETE /:id` (super admin).
  `question` 1..255, `answer` 1..5000 plain text, `sortOrder` 0..9999 (none = max + 1), `placement` `pricing|home|both`, `isActive`.

### POST `/billing/subscription/cancel` (`plan.subscription.manage`)

Stops the renewing subscription (latest `active` or `past_due`; a `pending` row is not renewing). The paid period keeps running. The local row is
always marked cancelled; the gateway is asked through the driver port (`cancelSubscription`: Stripe `cancel_at_period_end`, Razorpay
`cancel_at_cycle_end`, PayPal cancel). Response `{ status: 'canceled', remote: 'ok' | 'failed' | 'unsupported', planEndsAt }`; the remote outcome is
stored on the row (`meta.cancel`) and audited. 422 `PLAN_NO_SUBSCRIPTION` when there is nothing to cancel. Recurring subscriptions are created
by the payment-gateway domain's recurring checkout (not built yet); until it writes rows this endpoint answers `PLAN_NO_SUBSCRIPTION`.

### Quota ledger (`PlanQuotaService`, limit key `total_campaigns`)

Increment-only counter in `plan_usage` keyed by metric and period (`<plan slug>|<plan end yyyymmdd or 0>`). `assertAvailable(tx, org, key, metric, liveCount)`
refuses with 422 `PLAN_LIMIT_REACHED` and `reason: quota_reached`; `bump(tx, org, metric)` is atomic. First meeting adopts the live count. Deleting
never frees allowance; a new plan or end date opens a fresh one. Its call site belongs to the campaigns domain.

### Count guard for creators (`PlanUsageService.assertCanAdd(orgId, key)`)

One line before the insert for any capped thing (devices, flows, templates, auto-replies...). Uses the usage panel's own count.

### Retention

Plans carry `dataRetentionDays` (0..3650, 0 = never). `POST /platform/workspace-plans/retention/run` (super admin): body `{ dryRun?: true }` previews
(counts rows, rolls back); a real run needs `{ dryRun: false, confirm: "WIPE" }`. The worker also runs it nightly (03:17). A workspace is due when its PAID
plan ended more than N days ago and it was not wiped before. Per workspace: one transaction, rows deleted by `org_id` from the table list in
`plan-retention.service.ts`, `data_wiped_at` stamped, plan switched to the free plan, audit row and outbox `org.data_wiped`. Kept: the workspace, members,
orders, subscriptions, wallet, invoices, tags, companies, tasks, field definitions.

### Public pricing page

`/pricing` (site route) reads `GET /public/cms/pricing` (cards now carry `limits` and `features`) and the FAQ endpoint above. Yearly switch, volume and feature lists, plan call to action.

## Configuration map (super admin)

Everything below is set from the console; nothing is code-only.

| What                                                                                                                                       | Per plan (`/admin/plans`)                        | Per workspace (`/admin/workspace-plans`)               | Platform (`/admin/plan-settings`) |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------------ | --------------------------------- |
| Every cap (messages, broadcasts, total campaigns, devices, seats, contacts, tags, pipelines, appointments, templates, flows, auto-replies) | yes, 0 = unlimited                               | yes, beats the plan; empty = plan; 0 or -1 = unlimited |                                   |
| Every feature flag                                                                                                                         | yes                                              | yes: always on / always off / plan default             |                                   |
| Price, offer, period, free, lifetime, custom quote, active, default, highlighted, sort, button text                                        | yes                                              |                                                        |                                   |
| Data retention days                                                                                                                        | yes (0 = never)                                  | yes: empty = plan, 0 = never wipe this workspace       |                                   |
| Plan and plan end date                                                                                                                     |                                                  | yes                                                    |                                   |
| Free-trial end                                                                                                                             | trial length at sign-up in registration settings | yes: set a date, or end the trial now                  |                                   |
| Yearly switch and discount                                                                                                                 |                                                  |                                                        | yes (`/platform/plan-settings`)   |
| Pricing FAQs                                                                                                                               |                                                  |                                                        | `/admin/pricing-faqs`             |
| Wipe preview / run                                                                                                                         |                                                  |                                                        | `/admin/workspace-plans`          |

`PUT /platform/plan-settings` body `{ yearlyToggleEnabled, yearlyDiscountPct (0..90) }` (super admin; every role reads; audited as
`platform.plan.settings_updated`). `PUT /platform/workspace-plans/:id` also takes `trialEndsAt` (datetime, null = end now; omitted = unchanged, a
changed plan clears it unless given) and `overrides.dataRetentionDays` (0..3650 or null).

## Gates, rate limit and reports

- `@RequirePlanFeature(...keys)` (typed `PlanFeatureKey`) refuses with 422 `PLAN_FEATURE_LOCKED` (`feature`, `reason: feature_disabled`, upgrade link) on reads and writes.
- `GET /v2/billing/entitlements` returns `{ features: [...] }`; `GET /v2/billing/plans?unlocks=<feature>` returns only plans that include it.
- Public API keys are held to the plan's `api_rate_limit_per_minute` (0 = platform default; a workspace override of -1 = unlimited); responses carry `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and a 429 adds `Retry-After`.
- Super admin only: `GET /v2/platform/plan-analytics?days=30|90|365&package=`, `/plan-analytics/export` (CSV), `/financial?window=7d|30d|90d|1y`, `/premium`. Money is in the platform default currency.

## Grace period (autopay retry)

- `billing.grace_days` (platform setting, 0..30, default 7; edited on the billing settings screen as `graceDays`).
- A paid plan whose `plan_ends_at` has passed stays active, with the paid plan's limits and flags, for that many days while a live autopay subscription (`status` `active` or `past_due`) exists for it. State `paid_grace`; `GET /v2/billing/status` and `/v2/billing/usage` then carry `graceEndsAt` and `daysLeft` counted to it. After the grace, or with no live subscription or 0 days, it is `paid_lapsed` as before.
- A recovered charge (`subscription.charged`) moves the period forward and the state back to `paid_active`. The setting is cached for 30 seconds per process.
- `POST /v2/billing/subscription/cancel` acts on the workspace plan subscription only. `POST /v2/billing/subscription/addons/:id/cancel` (`:id` = the workspace add-on uuid, same permission) stops one add-on from renewing; the paid term keeps running to its end date. 422 `PLAN_NO_SUBSCRIPTION` when none is live.

## Managing subscriptions through the payment provider (Razorpay)

Workspace routes, all `plan.subscription.manage`; mutations are `@Idempotent()`:

- `GET /v2/billing/subscriptions`: this workspace's plan and add-on subscriptions (`status` active/past_due/pending/canceled/expired, `amount`, `billingCycle`, `currentPeriodEnd`, `autoRenew`, `paymentFailed`, `canceledAt`).
- `GET /v2/billing/subscriptions/:id/charges`: what the provider charged, cycle by cycle (`source: 'provider'`, receipt URLs only when `https`); `source: 'orders'` (the paid orders) when the provider cannot be asked.
- `POST /v2/billing/subscriptions/:id/sync`: asks the provider and applies the answer through the reconciler (`outcome` `up_to_date`/`renewed`/`gateway_canceled`/`gateway_expired`). 404 for another workspace's id.
- `POST /v2/billing/subscriptions/:id/cancel`: tells the provider to stop at the cycle end (`cancel_at_cycle_end: 1`); the paid period keeps running. 422 when already ended.

Never double-charged: `FulfilmentService` ends every other live plan subscription of the workspace, immediately (`cancel_at_cycle_end: 0`, `meta.cancel.reason_code = 'superseded'`), once a new plan order is applied; `POST /v2/billing/plan` to a cheaper plan ends the old one at the cycle end (`downgrade`). A provider failure never undoes the change: the row is ended locally and flagged (`meta.cancel.result = 'failed'`, shown to the operator as "Provider cancel failed").

Failed renewals: `subscription.pending`/`halted` set `past_due` once (a repeat is a no-op) and emit `paygw.subscription.past_due`; the worker's `SubscriptionNotificationsConsumer` sends each workspace owner an in-app `billing_payment_failed` notification and one email. A provider-side cancel emits `paygw.subscription.canceled` (`billing_subscription_canceled`); our own cancel does not notify. `subscription.activated`/`updated` webhooks stay ignored on purpose (the first charge arrives as `subscription.charged`; counting both would double the first period).

Operator (`/v2/platform/billing`, writes `super_admin`): `GET subscriptions` (filters `status`, `kind`, `gateway`, `q`; KPIs), `POST subscriptions/:id/cancel` (`{atCycleEnd}`), `POST subscriptions/:id/sync`, `GET subscriptions/:id/charges`; refunds `POST orders/:id/refund` and `POST subscriptions/:id/refund` (`paymentId` must be a paid charge in the provider's own list for that subscription; optional `endSubscription`), `GET .../refunds`. Refunds go through the provider (`POST /payments/:id/refund`), are recorded in `order_refunds` (`pending` claim row first, counted against the paid amount, so two operators cannot over-refund), audited and emitted as `paygw.refund.created|failed`. Refused: unpaid order, wallet top-up, subscription payment on the order route, more than paid (422 `PAYGW_REFUND_REFUSED`); a provider refusal keeps the row `failed` with its reason and frees the amount (`PAYGW_REFUND_FAILED` semantics in the row).

Not built yet: refunds of wallet top-ups, pausing/resuming a subscription, changing the payment method inside the app (the provider's page does that).
