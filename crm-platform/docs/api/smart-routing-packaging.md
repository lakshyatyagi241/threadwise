# Smart routing packaging (operator how-to)

Design and the full matrix: [specs/packaging-teams-and-smart-routing.md](../specs/packaging-teams-and-smart-routing.md). Owner guide in the Help center:
"Smart routing add-on". Same shape as [teams-packaging.md](teams-packaging.md); read that first for how plain add-on packs are merged.

The entry plan has **no automatic assignment**. **Smart routing** adds it, as an add-on or as part of a higher plan. It is two existing plan features, no new flag:

| Plan feature              | Operator label                                | What it unlocks                                                                                                                                                                                                                                      |
| ------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inbox_routing`           | Smart routing: auto-assignment and rules      | the auto-assignment master switch, Sticky Agent, routing rules, Everyone else, Try it, team methods (round robin, least loaded) and the team default assignee, escalation timers, and (step 3) the waiting-queue timers and the offline/leave return |
| `inbox_assignment_sticky` | Smart routing: contact owner and sticky agent | owner first and keep in sync, the continuity window in days, the reassign prompt. Works together with `inbox_routing`                                                                                                                                |

Business hours of the workspace open with either `inbox_routing` or `inbox_sla`, because SLA clocks read them too.

## 1. The add-on

Migration `20270325090000_smart_routing_addon.sql` inserts one add-on plan (`plans.kind = 'addon'`, slug `smart_routing`): features `inbox_routing` and
`inbox_assignment_sticky`, no limits. It is **inactive** (nobody can buy it or be offered it) and **has no price** (the free flag is set only because a priced
add-on cannot be saved at 0; untick it when you set the price). Idempotent, expand-only, touches no existing row.

`PACK_GRANTABLE_FEATURES` (`packages/contracts/src/plans-subscriptions-trials/catalogue.ts`) now lists these two next to `team_hierarchy` and `custom_roles`, so
`PlanEntitlementService.forOrg` merges them from a live pack into the same resolver every gate asks. A pack is live while its `workspace_addons` row is
`status = 'active'` and `ends_at` is null or in the future. A workspace override still wins over everything.

### How an operator switches it on

1. Operator console, **Add-ons**: open **Smart routing** (draft, inactive).
2. Untick **Free**, enter the price and period, tick **Active**, save.
3. Give it to a workspace like any other add-on pack (the workspace's add-ons panel, or checkout once it is active). Workspaces on a paid plan see it in the add-on
   catalogue on the Plans page. Plain add-ons are not part of a plan's `visibleAddons` (that table is for Marketplace apps).
4. To include Smart routing in a higher tier instead, switch the two features on for that plan (Plans, the plan, Features, Chat line).

## 2. Making an existing plan an entry plan

The registry default of both features stays `true` and is **not flipped**: a plan row that predates the keys (or was never re-saved) stores nothing for them and
would be locked by a flip. See "Plan defaults" in the spec. To make a plan an entry plan:

1. Operator console, **Plans**, the plan (for example Basic), **Features** tab.
2. Under **Chat**, switch off **Smart routing: auto-assignment and rules** and **Smart routing: contact owner and sticky agent**.
3. Save. The editor writes every feature key, so the plan now stores both as false. Workspaces on it lose automatic assignment at that moment; stored rules and
   settings are kept and come back when the flags do, chats already Waiting or assigned stay, escalation timers stop.

A plan created from the plan form starts with both off. A plan created through the API without a `features` object reads the default (true): send them as false.

## 3. What a workspace sees without it

Each control says what unlocks it ("Included in the Smart routing add-on or a higher plan." and a link to Plans and add-ons); the API answers 422
`PLAN_FEATURE_LOCKED`. The base keeps working: inbox, manual assignment, the Waiting queue and Claim, the Human handoff step to a person or team, Return to bot,
leave and delegate, availability.

## 4. Support checklist

- "Round robin is greyed out in the team form": the workspace has no `inbox_routing`. Plans, Features, or the add-on on the workspace; check for an override.
- "Auto-assignment says Not in your plan": same, and check the add-on is `active` with `ends_at` in the future.
- "Rules stopped after we changed the plan": expected; they are kept, and work again when the flag returns.
- "SLA business hours cannot be edited": needs `inbox_sla` or `inbox_routing`.
- A workspace override (`org_plan_state.overrides.features`) beats both the plan and the add-on, in both directions.
