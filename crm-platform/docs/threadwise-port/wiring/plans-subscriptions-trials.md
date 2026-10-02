# Wiring map: plans, subscriptions, trials, limits (PLAN)

Scope of this map: the per-workspace plan lifecycle and its consumers. Catalogue CRUD (TW-PLAN-001..005) and the signup default (008) are earlier slices.

## Writers of a workspace's plan

| Writer          | Where                                                                                                 | Effect                                 |
| --------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Sign-up         | `auth/platform/tenant-directory.ts` -> `PlanEntitlementService.resolveInitialPlan/recordInitialState` | plan slug + trial                      |
| Paid order      | `platform-payment-gateways/fulfilment.service.ts`                                                     | plan, `plan_ends_at`, clears trial     |
| Workspace admin | `POST /v2/billing/plan` (`BillingService.change`)                                                     | free / cheaper / equal plan, immediate |
| Super admin     | `PUT /v2/platform/workspace-plans/:id` (`WorkspacePlanAdminService.attach`)                           | plan, end date, overrides              |

## Readers (all go through `PlanEntitlementService`, so state, overrides and the lapsed fallback apply everywhere)

`contacts` (cap), `tags` (cap), `crm/deals` (feature + pipelines cap), `appointments-booking` (feature + monthly cap), `workspaces-teams-tenancy/members`
(seat cap), `auth/security/branding-footer` (remove_branding), `auth/account/plan-feature-gate`, onboarding plan step (`GET /v2/plans`,
Reference rule: no online downgrade), `localization-translation` (reads the stored JSON directly, see its TODO).
New in this slice: `TrialGateGuard` (global, after JwtAuthGuard and AccountGateGuard), `PlanUsageService` (meters), the web trial bar, `/account/plans`,
`/account/usage`, `/admin/workspace-plans`.

## Added consumers

- `PlanQuotaService` (ledger): no call site yet. Reference's only consumer is campaign creation (campaigns domain, CAMP). The meter `total_campaigns` already reads it.
- `PlanUsageService.assertCanAdd`: the guard every capped creator calls. Call sites to add when each domain lands: devices (WADEV/WABA), flows (FLB),
  templates (TPL), auto-replies (AR). Broadcasts already enforce through `assertWithinLimit`.
- `monthly_messages` is an allowance: past it, sends bill the wallet (WALLET), they are not blocked. Its enforcement is the wallet domain's.
- Add-on checkout: `platform-payment-gateways/checkout.service.ts` (eligibility, no downgrade guard), `fulfilment.service.ts` -> `AddonFulfilmentService`.
- Subscriptions: read and cancelled by `SubscriptionService`; written by the (unbuilt) recurring checkout of PAYGW. Driver port `cancelSubscription`.
- Retention: `PlanRetentionService` (HTTP preview/run) and `PlanRetentionSweepService` (worker cron). New columns `plans.data_retention_days`, `org_plan_state.data_wiped_at`.
- FAQs: one table (`pricing_faqs`) for the in-app picker, the public pricing page and (later) the homepage slider; CMS-037/038 are satisfied by this CRUD.

## Meters and the enforcing count (must stay equal)

contacts, tags, pipelines, users (non-inactive), appointments (pending/confirmed/completed, this month): same predicate as the enforcing module.
monthly_messages (outbound `messages` this month), devices, flows, templates, broadcasts (not archived), autoreplies: counted for display; **no
enforcement yet** (their domains do not call `assertWithinLimit`): follow-up for each owner.

## Permission and settings

`plan.subscription.manage` (migration `20261015090000`), granted to Owner and Admin presets by the preset trigger. No new settings keys.

## Events

`plan.changed` (workspace switch), `plan.attached` (operator). Not yet emitted: `plan.trial_expired`, `plan.lapsed` (no scheduler; derived at read time).
