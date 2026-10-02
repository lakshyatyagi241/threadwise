# Plans, subscriptions, trials and limits (PLAN)

Every plan fact is **per workspace** (organization). A plan is a platform catalogue row; which plan a workspace is on, its trial, its
period and its own overrides live in `org_plan_state` (tenant table, forced RLS; a workspace can read it, only the platform writes it).
`organizations.plan` is the one plan reference (a slug).

Base path `/v2`. Errors are problem+json with a stable `code`.

## Who may do what

| Actor | Can |
| --- | --- |
| Super admin (platform operator) | create, edit, activate, delete plans and set their limits and flags (`/platform/plans`); attach a plan to any workspace and set that workspace's own limits (`/platform/workspace-plans`) |
| Support / auditor operator | read the same screens, change nothing (403 on writes) |
| Workspace Owner or Admin (`plan.subscription.manage`) | see every active plan, switch to a free or cheaper/equal plan, downgrade, buy a dearer plan through checkout |
| Any other workspace member | see the plans, the status bar and their usage; the buttons are off |

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

### POST `/billing/plan`  (`plan.subscription.manage`)
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

### PUT `/platform/workspace-plans/:id`  (super admin)
Body `{ planSlug, rowVersion, planEndsAt?, overrides? }`. `planEndsAt` omitted: the plan's own period when the plan changes, else unchanged;
`null`: never expires; a datetime: that date. `overrides` `{ limits: { key: int }, features: { key: bool } }` replaces the stored overrides (omit to keep).
A different plan clears the trial. 409 `ROW_VERSION_CONFLICT` on a stale `rowVersion`, 404 unknown plan or workspace, 422 unknown override key.
Audited (`security_events` for the operator and `audit_log` for the workspace) and emits outbox `plan.attached`.

### Plan catalogue `/platform/plans`
Unchanged (WD-PLAN-001..005): list, create, update, activate, delete. The limit keys and feature flags are the registry in
`@crm/contracts` (`PLAN_LIMIT_DEFS`, `PLAN_FEATURE_DEFS`).
