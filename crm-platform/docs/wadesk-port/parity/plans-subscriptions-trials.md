# Parity: plans, subscriptions, trials (PLAN), per-workspace slice

**Twin run against the live WaDesk: NOT done.** The reference needs MySQL and a browser session; this container has PHP but no MySQL server,
so `wadesk-playwright-parity` could not be run and no stamp was written. Evidence below is the inventory entry, the WaDesk source and our
automated tests. Run the twin (`wadesk-run-reference`) before moving any of these rows to `verified`.

Automated: `apps/api/test/unit/plans-subscriptions-trials/plan-lifecycle.spec.ts` (state table, days, directions, periods, trial gate),
`apps/api/test/e2e/plans-subscriptions-trials/billing.e2e.spec.ts` (19 scenarios against real Postgres, Redis and the real app),
`apps/web/src/features/plans-subscriptions-trials/{lib/format.test.ts,messages.test.ts}`.

| Behaviour | WaDesk | Ours | Class |
| --- | --- | --- | --- |
| Downgrade online | refused on page and at checkout | allowed for Owner/Admin, immediate, keeps paid period, nothing deleted, over-cap warning | intended (owner's instruction) |
| Who may change plan | any user views; manager+ cancels; checkout any user | `plan.subscription.manage` (Owner, Admin) to change; view open to all | intended (RBAC) |
| Trial gate scope | web only; API, mobile, bridge leak | staff and API keys gated | intended (inventory port note) |
| Trial gate allow-list | route-name globs | first path segment + `@AllowWhenTrialExpired` | intended (stack) |
| Gate on error | fails open | fails open on internal error only | same |
| Lapsed paid plan | free package's entitlements | same, free plan = first active free plan; none in catalogue: stored plan keeps applying | same + documented edge |
| "Renew now" link | always plans page (route-name bug) | plans page (renew is the same picker) | same outcome |
| Trial bar days | rounded up, floor 1 | same | same |
| Renewal bar | last 7 days | last 7 days | same |
| Usage meters | message month + 4 lifetime meters | 11 meters, calendar-month for messages and appointments | extended: matches the caps this catalogue has |
| Cancel auto-renew (012) | exists | not built, no dead button | blocked on PAYGW subscriptions |
| Yearly toggle, add-ons, FAQ, public pricing (009/010) | exist | not built | todo |
| Plan edit clears nothing on workspaces | n/a | operator attach: new plan clears trial, stamps period from the plan | as WSP-026 |
