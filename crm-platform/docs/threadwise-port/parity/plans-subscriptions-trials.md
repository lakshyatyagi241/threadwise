# Parity: plans, subscriptions, trials (PLAN), per-workspace slice

**Twin run against the live Reference: NOT done.** The reference needs MySQL and a browser session; this container has PHP but no MySQL server,
so `threadwise-playwright-parity` could not be run and no stamp was written. Evidence below is the inventory entry, the Reference source and our
automated tests. Run the twin (`threadwise-run-reference`) before moving any of these rows to `verified`.

Automated: `apps/api/test/unit/plans-subscriptions-trials/plan-lifecycle.spec.ts` (state table, days, directions, periods, trial gate),
`apps/api/test/e2e/plans-subscriptions-trials/billing.e2e.spec.ts` (19 scenarios against real Postgres, Redis and the real app),
`apps/web/src/features/plans-subscriptions-trials/{lib/format.test.ts,messages.test.ts}`.

| Behaviour                              | Reference                                                                    | Ours                                                                                                  | Class                                                                          |
| -------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Downgrade online                       | refused on page and at checkout                                              | allowed for Owner/Admin, immediate, keeps paid period, nothing deleted, over-cap warning              | intended (owner's instruction)                                                 |
| Who may change plan                    | any user views; manager+ cancels; checkout any user                          | `plan.subscription.manage` (Owner, Admin) to change; view open to all                                 | intended (RBAC)                                                                |
| Trial gate scope                       | web only; API, mobile, bridge leak                                           | staff and API keys gated                                                                              | intended (inventory port note)                                                 |
| Trial gate allow-list                  | route-name globs                                                             | first path segment + `@AllowWhenTrialExpired`                                                         | intended (stack)                                                               |
| Gate on error                          | fails open                                                                   | fails open on internal error only                                                                     | same                                                                           |
| Lapsed paid plan                       | free package's entitlements                                                  | same, free plan = first active free plan; none in catalogue: stored plan keeps applying               | same + documented edge                                                         |
| "Renew now" link                       | always plans page (route-name bug)                                           | plans page (renew is the same picker)                                                                 | same outcome                                                                   |
| Trial bar days                         | rounded up, floor 1                                                          | same                                                                                                  | same                                                                           |
| Renewal bar                            | last 7 days                                                                  | last 7 days                                                                                           | same                                                                           |
| Usage meters                           | message month + 4 lifetime meters                                            | 11 meters, calendar-month for messages and appointments                                               | extended: matches the caps this catalogue has                                  |
| Cancel auto-renew (012)                | local row always cancelled, gateway best effort, no audit                    | same, plus the remote outcome stored on the row and audited; buttons only while a subscription exists | intended (visibility fix); rows come from PAYGW recurring checkout (not built) |
| Yearly toggle (011)                    | starts on Yearly, rewrites links                                             | same; a plan authored in years is not discounted and not shown as "/ month"                           | intended (QUIRK fixed)                                                         |
| Add-ons (011)                          | buy through checkout, view-only eligibility                                  | same, eligibility enforced server-side                                                                | intended (hardening)                                                           |
| FAQ admin (009)                        | update with a missing checkbox switches the FAQ off; hard delete, no audit   | partial update, audited                                                                               | intended                                                                       |
| FAQ readers                            | picker reads all active; public /pricing does NOT read the table (CMS copy)  | public /pricing reads the table                                                                       | intended (inventory port note)                                                 |
| Public pricing (010)                   | lists add-ons, hard-coded 14-day copy, 3 prototype tiers when empty          | plans only, no static trial copy, empty state                                                         | intended                                                                       |
| Quota ledger (018)                     | counts per package id + end date, fails open without table                   | same period rule (quirk kept), atomic bump, check inside the creating transaction                     | same + documented; no creator yet                                              |
| Retention wipe (023)                   | heartbeat-triggered, no audit, partial failure possible, `attributes` listed | worker cron, per-workspace transaction, audit + event, preview, field definitions kept                | intended                                                                       |
| Plan edit clears nothing on workspaces | n/a                                                                          | operator attach: new plan clears trial, stamps period from the plan                                   | as WSP-026                                                                     |
| Plan-gated Marketplace add-ons         | none: Reference has no plan-gated add-on visibility                          | a plan enables add-ons (`plan_visible_addons`): visible to its workspaces, usable only once bought    | intended (our addition, owner request 2026-10-05); see the section below       |

## Plan-gated Marketplace add-ons (intended difference, our addition)

Reference has no such thing: every add-on is on sale to every workspace. Ours (owner request, 2026-10-05): the super admin enables, per plan,
the Marketplace apps sold as billing add-ons (`plans` rows of kind `addon` with a `marketplace_app_id`). The rule, in one place for browse,
search, shelves, category counts, an app's page, install, subscribe and checkout (`apps/api/src/modules/marketplace/plan-visibility.ts`):

- **Visible is not usable.** A plan only makes an add-on visible (table `plan_visible_addons`, never `plans.features`: a `mkt_` key in
  `features` is read as a grant). Using it still needs the purchase, trial or comp that grants the `mkt_<slug>` key. Visible but not bought
  is `access: subscription_required`, `availability: visible`: shown with its price, can subscribe, cannot install.
- **Hidden means not found.** A paid app that is neither enabled by the plan nor already the workspace's is omitted from the lists and its
  page, install and subscribe answer 404 (`MKT_APP_NOT_FOUND`), like a draft; checkout refuses it (`PAYGW_PLAN_NOT_PURCHASABLE`).
- **A purchase is never taken back.** An app the workspace installed, subscribed to, bought, or has an override for stays visible and
  usable when its plan stops enabling it (a downgrade, an operator edit): `availability: purchased` / `access: entitled`.
- **Unaffected:** free apps, and paid apps with an `included_plan_feature` or `included_min_plan` rule (that rule sets what they cost the
  workspace, not whether it may see them). Platform-owned workspaces and workspaces on a plan with no catalogue row see everything (nothing
  is locked, as for every other entitlement); a lapsed paid plan shows what the free plan shows.
- **Existing customers lose nothing.** Migration `20261028090000_plan_visible_addons.sql` gives every existing plan every published
  Marketplace pack. A pack created later is visible to no plan until a plan enables it.
- Edited in the plan form (`visibleAddons`, ids of packs from `GET /v2/platform/plans/addon-options`), audited with the other plan fields.
  A plan save also keeps the stored `limits` and `features` keys the registry does not know (a module-contributed key survives an edit).

Tests: `apps/api/test/unit/plans-subscriptions-trials/plan-visible-addons.spec.ts`,
`apps/api/test/integration/plans-subscriptions-trials/plan-visible-addons.spec.ts` (backfill, RLS, trigger),
`apps/api/test/e2e/marketplace/marketplace-plan-visibility.e2e.spec.ts` (hidden, visible, purchased, downgrade keeps what was bought, plan
save, in-app and operator payloads).
