# Smart routing packaging (operator how-to)

Design, the matrix and the client-migration mapping: [specs/packaging-teams-and-smart-routing.md](../specs/packaging-teams-and-smart-routing.md). Owner guide in the Help center:
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

## 2. Setting the tiers (Basic off, higher tiers on)

The catalogue default of both features is **false** (owner decision 2026-10-22: no paying clients yet; clients are migrated onto plans that carry what they have).
`resolveFeature` order: platform-owned workspace (on), the workspace's override, a plan slug with no catalogue row (nothing locked), then the plan row: the stored
boolean, and **when the row does not store the key, the catalogue default (false)**. So a plan includes Smart routing only if it stores `true`.

State of the real-data copy (`crm_owner`, counts only):

| Plan slug | Catalogue row           | `inbox_routing`               | `inbox_assignment_sticky` | `team_hierarchy` | `custom_roles` | Workspaces |
| --------- | ----------------------- | ----------------------------- | ------------------------- | ---------------- | -------------- | ---------- |
| `growth`  | none (`plans` is empty) | open (no row, nothing locked) | open                      | open             | open           | 2          |

Operator steps, in the operator console:

1. **Plans**, open (or create) **Basic**, **Features** tab, **Chat** line: switch **off** _Smart routing: auto-assignment and rules_ and _Smart routing: contact owner and sticky agent_. Save.
2. For each higher tier (for example Growth, Scale): same screen, switch **on** both. Save. The editor writes every key, so each plan now stores both explicitly.
3. Check that the **Teams** items under Platform (`team_hierarchy`, `custom_roles`) are set as you want for each tier.
4. Give the add-on to one workspace: **Add-ons**, **Smart routing** (set the price and tick Active first, section 1), then the workspace's add-ons panel, or let the workspace buy it from Plans.
5. Keep operator and test workspaces open: mark them **platform-owned**, or on the workspace page set the feature overrides `inbox_routing` and `inbox_assignment_sticky` to on.

Fresh installs: `seed-auth.ts` seeds Starter (both off), Growth and Scale (both on), only when the slug is missing. A plan created from the plan form starts with both off.
Creating a plan through the API without a `features` object reads the default (false).

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

## 5. When a plan starts to include an add-on a workspace already pays for

The add-on card becomes "Included in your plan" and the workspace cannot buy it again (checkout answers 422 `PAYGW_ADDON_INCLUDED`). A purchase it already holds
keeps running to the end of the paid term and then stops: the renewal is ended at the cycle end (no refund, no early removal), the workspace's billing admins get a
notice and an email, and the card reads "Included in your plan. Your add-on ends on <date> and will not renew." You do not need to do anything.

- It runs right after a plan payment and every 10 minutes. After you **edit a plan's Features tab** to add the flags, workspaces on that plan are evaluated one by one on the next pass
  (about 10 minutes); nothing is cancelled in bulk at edit time and there is no extra button.
- Switching a workspace back to a plan that does not cover the add-on does not restart a stopped renewal; the workspace buys it again if it wants it.
- A pack that adds a cap (Teams: +10 teams) is never stopped, because the plan does not give that cap.

## 6. Owner decision needed: free plans see no add-ons

Add-ons are offered only on an active PAID plan (TW-ADD-033, `eligible` in the add-ons screen and checked in checkout). A **free** Basic plan therefore sees no add-ons at all, so
Smart routing could not be bought on it. Either make Basic a small paid plan, or change this rule. It has not been changed.
