# Wiring map: plans, subscriptions, trials, limits (PLAN)

Scope of this map: the per-workspace plan lifecycle and its consumers. Catalogue CRUD (WD-PLAN-001..005) and the signup default (008) are earlier slices.

## Writers of a workspace's plan
| Writer | Where | Effect |
| --- | --- | --- |
| Sign-up | `auth/platform/tenant-directory.ts` -> `PlanEntitlementService.resolveInitialPlan/recordInitialState` | plan slug + trial |
| Paid order | `platform-payment-gateways/fulfilment.service.ts` | plan, `plan_ends_at`, clears trial |
| Workspace admin | `POST /v2/billing/plan` (`BillingService.change`) | free / cheaper / equal plan, immediate |
| Super admin | `PUT /v2/platform/workspace-plans/:id` (`WorkspacePlanAdminService.attach`) | plan, end date, overrides |

## Readers (all go through `PlanEntitlementService`, so state, overrides and the lapsed fallback apply everywhere)
`contacts` (cap), `tags` (cap), `crm/deals` (feature + pipelines cap), `appointments-booking` (feature + monthly cap), `workspaces-teams-tenancy/members`
(seat cap), `auth/security/branding-footer` (remove_branding), `auth/account/plan-feature-gate`, onboarding plan step (`GET /v2/plans`,
WaDesk rule: no online downgrade), `localization-translation` (reads the stored JSON directly, see its TODO).
New in this slice: `TrialGateGuard` (global, after JwtAuthGuard and AccountGateGuard), `PlanUsageService` (meters), the web trial bar, `/account/plans`,
`/account/usage`, `/admin/workspace-plans`.

## Meters and the enforcing count (must stay equal)
contacts, tags, pipelines, users (non-inactive), appointments (pending/confirmed/completed, this month): same predicate as the enforcing module.
monthly_messages (outbound `messages` this month), devices, flows, templates, broadcasts (not archived), autoreplies: counted for display; **no
enforcement yet** (their domains do not call `assertWithinLimit`): follow-up for each owner.

## Permission and settings
`plan.subscription.manage` (migration `20261015090000`), granted to Owner and Admin presets by the preset trigger. No new settings keys.

## Events
`plan.changed` (workspace switch), `plan.attached` (operator). Not yet emitted: `plan.trial_expired`, `plan.lapsed` (no scheduler; derived at read time).
