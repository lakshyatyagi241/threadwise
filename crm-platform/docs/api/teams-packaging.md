# Teams and edition packaging (BL-383, phase T3)

Design: [specs/teams-unification.md](../specs/teams-unification.md) section 5.6 and decisions D4, D6. Wiring map: [wiring/teams-packaging.md](../threadwise-port/wiring/teams-packaging.md).
Owner guides (in the Help center): "Editions: Chat, Sales CRM and Both" and "Teams limits and the Teams and permissions add-on".

One product fuses a conversation side and a sales side. An **edition** (Chat, Sales CRM, Both) is data: a plan, an add-on and a business type (persona). Nothing in the code
branches on a plan name. This change adds the metadata and the three packaging switches; it adds no table and no endpoint of its own.

## 1. Product line on every plan feature

`PLAN_FEATURE_DEFS` (`packages/contracts/src/plans-subscriptions-trials/catalogue.ts`) now carries `productLine: 'chat' | 'crm' | 'platform'` on every key, declared once.
Helpers: `planFeatureLine(key)`, `planFeaturesOfLine(line)`, `PLAN_PRODUCT_LINES`. A unit test (`teams-packaging.spec.ts`) fails when a key has none.

| Line                     | Keys                                                                                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `chat` (14)              | `calling`, `waba_calling`, `chatbot_widgets`, `wa_storefront`, `inbox_sla`, `inbox_routing`, `inbox_kanban`, `team_performance`, `scheduled_messages`, `whatsapp_warmer`, `team_chat`, `forms_and_links`, `extra_channels`, `waba_groups`, `sms`, `email_channel`, `personal_history_full` |
| `crm` (9)                | `sales_pipeline`, `appointment_booking`, `invoicing`, `lead_sources`, `form_builder`, `record_assignment`, `lead_scoring`, `ai_crm_copilot`                                                                    |
| `platform` (shared) (13) | `automation`, `ai_assistants`, `woocommerce`, `shopify`, `analytics`, `remove_branding`, `marketplace`, `storefront_builder`, `public_api`, `outbound_webhooks`, `help_agent`, `team_hierarchy`, `custom_roles` |

Judgement calls: `team_performance` is the inbox team report, so `chat`. `forms_and_links` is the WhatsApp Flows forms, so `chat`; `form_builder` (web forms into the CRM) is `crm`.
`wa_storefront` (the WhatsApp catalog sent in chats) is `chat`, `storefront_builder` and the Shopify and WooCommerce connectors are shared `platform`. Appointment booking is `crm`.
A key can move line later without a migration: the line is metadata, no stored value depends on it.

Where it is used: the plan editor's Features tab groups switches by line with a badge and per-line Enable all / Disable all (an edition plan is "Disable all" under the line it
does not sell); the web capability layer exposes `usePlanProductLine(line)` (`apps/web/src/lib/plan-features.tsx`), true when the workspace has at least one feature of that line.

## 2. The `teams` cap

New limit key `teams` (group workspace). It is the **one cap where 0 is a real value**: a stored `0` means **solo, no teams can be created**. Every other cap keeps "0 = unlimited".
To keep every existing plan unchanged, a plan row without the key (or with a value of 1,000,000 or more, `PLAN_UNLIMITED_FROM`) is unlimited.

| Stored / entered                    | Meaning                      |
| ----------------------------------- | ---------------------------- |
| key missing, or `>= 1_000_000`      | unlimited (editor: blank)    |
| `0`                                 | solo, no teams               |
| `N > 0`                             | at most N teams              |
| workspace override `-1`             | unlimited                    |
| workspace override `0` / `N`        | solo / N                     |

Code: `PLAN_LIMITS_ZERO_IS_NONE`, `limitZeroIsNone`, `isUnlimitedFor(key, value)`, `isLimitCapped(key, value)` in the catalogue; `storedLimit`, `resolveLimit` (plan entitlement
service) and `mergeLimit` (add-on registry) are key-aware; the request schema defaults a missing `teams` to the unlimited stand-in, so a client that omits it cannot make a plan solo.
The usage panel gets a `teams` meter (count of the workspace's teams).

**Enforcement.** `TeamsPlanService.assertCanCreate(tx, orgId)` (`modules/workspaces-teams-tenancy/teams-plan.service.ts`) is the only thing `TeamsService.create` calls:

| Case                      | Answer                                                                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| unlimited                 | passes with no count                                                                                                                    |
| cap 0 (solo)              | 422 `PLAN_TEAMS_NOT_INCLUDED`, `errors[]`: `limit=teams`, `reason=teams_not_included`, `limitValue=0`, `upgradeUrl=/account/plans`      |
| cap N and N teams exist   | 422 `PLAN_LIMIT_REACHED`, `errors[]`: `limit=teams`, `reason=limit_reached`, `used`, `limitValue`, `upgradeUrl`                          |

Existing teams are never removed when a cap shrinks; only new ones are refused. Web: `errorKind` maps the two answers (a `limit` detail of `teams` tells the team cap from the seat
cap) to the messages "Your plan doesn't include teams" and "You've reached your plan's limit of N teams", with the upgrade link.

## 3. `team_hierarchy` and `custom_roles`

Plan features, **default true**, so every existing plan keeps them; an operator switches them off per plan (Features tab, under Platform).

| Feature          | Enforced today                                                                                                                                                           | Web                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `custom_roles`   | `RolesService.create` and `RolesService.update` (422 `PLAN_FEATURE_LOCKED`, `feature=custom_roles`). Reading and deleting roles stay open; roles people already hold keep working. | Roles list: the Add role button becomes an upgrade link. Role page: read only, with a notice and a link. A server refusal shows the same notice. |
| `team_hierarchy` | `TeamsPlanService.assertHierarchy(orgId)` and `hierarchyEnabled(orgId)` are ready. **Nothing on `main` has a parent team, lead or manager field yet**, so nothing calls them.   | `usePlanFeature('team_hierarchy')` or `useTeamsPackaging().hierarchy`.                   |

**What Teams v2 (T1) and scope semantics (T2) must call.** In the teams create/update service, when the request sets `parentTeamId`, `leadUserId` (manager) or any member lead
flag to a non-empty value: `await this.plan.assertHierarchy(orgId)` (`TeamsPlanService` is already injected in `TeamsService` and exported from the module). Clearing these fields must stay
allowed. In the roles service, when a grant uses the `team_and_below` scope: `assertHierarchy`. On the Teams screen, draw the parent and manager pickers only when
`useTeamsPackaging().hierarchy` is true, and the "my team and sub-teams" scope option in the Roles matrix only when it is true.

## 4. The "Teams and permissions" add-on

Migration `20270220090000_teams_permissions_addon.sql` inserts one add-on plan (`plans.kind = 'addon'`, slug `teams_permissions`): features `team_hierarchy` and `custom_roles`, limit
`teams: 10` (extra teams on top of the plan; `-1` is unlimited). It is **inactive** (a draft nobody can buy or be offered) and **has no price** (free flag set only because a priced add-on cannot be
saved at 0; the operator unticks it when setting the price). Idempotent.

A plain add-on pack (one that is not a Marketplace app) is normally resolved only by the add-on registry's own resolver. So that every gate that asks the plan resolver honours this one, `PlanEntitlementService.forOrg` merges
**only** the keys in `PACK_GRANTABLE_FEATURES` (`team_hierarchy`, `custom_roles`) and `PACK_GRANTABLE_LIMITS` (`teams`) from the workspace's live plain packs (`workspace_addons` active and not ended).
Every other key of such a pack behaves exactly as before. Merge rules for `teams`: unlimited absorbs, a pack of `-1` is unlimited, otherwise the numbers add to the plan cap (solo plus 10 allows 10).
A workspace override still wins over everything. When the pack ends, nothing is deleted; the workspace is held to its plan again.

**How an operator enables it.**

1. Operator console, Add-ons: open **Teams and permissions** (draft, inactive).
2. Untick **Free**, enter the price and period, adjust the extra teams if wanted, tick **Active**, save.
3. Give it to a workspace like any other add-on pack (the workspace's add-ons panel, or checkout once it is active).
4. **Include it in a plan** (the plan then gives the two features at no charge): Plans, open the plan, **Add-ons** tab, section **Add-ons included in this plan**, switch **Teams and permissions** on, save.
   The switch ticks `team_hierarchy` and `custom_roles` on the Features tab (ticking them there by hand flips the switch too, and works exactly as before). The pack also adds a **cap** (`teams: +10`);
   the extra teams are **not** part of plan inclusion and nothing on the switch changes any limit: set the plan's own `teams` cap on the Limits tab. Because the pack still sells that cap, its add-on card
   never reads "Included in your plan" and a workspace's renewal of it is **not** stopped. The same keys can also be set as a single workspace override.
   Design and impact: [specs/addons-marketplace-unification.md](../specs/addons-marketplace-unification.md).

## 5. Edition business types (persona presets)

Migration `20270220090100_edition_personas.sql` seeds three catalog personas as published version 1 through the persona tables (no new table): `chat_team` ("Chat team"), `sales_team`
("Sales team"), `both` ("Chat and sales"). The documents are the constants in `packages/contracts/src/persona/editions.ts` (`CHAT_SIDE_MODULES`, `CRM_SIDE_MODULES`,
`EDITION_PERSONAS`); a test compares the migration with them.

| Preset       | Default | Hidden                                                                                                                                                                                                                  |
| ------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat_team`  | show    | the sales side: deals, companies, tasks, CRM dashboard, invoicing family, proposals, estimates, appointments, forms, lead scoring and their Settings tiles (pipelines, record assignment, lead sources, ...); on the contact page the tasks, deals, appointments, sales, lead source, company and meetings sections and the task, meeting, company and score actions |
| `sales_team` | show    | the conversation side: inbox and its logs and saved replies, quick chat, team chat, call logs, campaigns, scheduled, warmer, history, templates, WhatsApp forms and links, groups, devices, the chat channels and their tiles, inbox tiles (SLA, auto assignment, tags, ...); on the contact page the conversations section and the call action; the inbox, sent, read, devices and templates Home cards |
| `both`       | show    | nothing (the same as `generic`)                                                                                                                                                                                         |

Contacts (`nav:contacts`, the overview, details, notes, files, consent and history sections), Settings Team and Roles tiles and the Teams tile are never hidden by any edition.
A preset only decides what is drawn: entitlement still wins (a hidden module the plan locks stays hidden and draws no lock; a visible module the plan lacks shows its lock),
hiding is not locking, and the API and typed addresses are untouched. `generic` and workspaces without a persona are unchanged (the golden test in `apps/web/src/features/persona/golden.test.ts` holds both).

**How to attach a preset to a workspace (operator, today).** The operator console for personas (P2) and the onboarding choice are not built, so an operator with database access does it,
as the privileged role, for one workspace:

```sql
SELECT set_config('app.privileged', 'on', true);
UPDATE workspace_persona
   SET persona_key = 'sales_team', persona_version = 1
 WHERE org_id = (SELECT id FROM organizations WHERE uuid = '<workspace uuid>');
```

The workspace follows the latest published version. Its session carries the change after the persona cache window (about 30 seconds) or a new sign-in. To go back, set `persona_key = 'generic'`.
A workspace admin can still reveal everything with "Show more modules" once that switch ships (the resolver already honours it).

## 6. Not in this change (follow-ups)

- Role presets per edition (Viewer and Agent for Chat, owner and visibility wording for Sales): T1 and T2.
- Calling `assertHierarchy` from the Teams v2 fields and from the `team_and_below` scope: T1 and T2 (section 3).
- An onboarding screen or an operator screen to choose the edition; seat types (BL-386, decision D6).
- Showing the `teams` cap on the workspace plan page beyond the usage meter.
