# Wiring map: teams and edition packaging (BL-383, T3)

Scope: the plan-side switches that decide how many teams a workspace may hold, whether it has parent teams and custom roles, how a plan is split into the Chat and Sales CRM sides, and the
three edition business types. A product extension: Reference has none of it (row 28 of [product-extensions.md](../parity/product-extensions.md)).
API and operator notes: [docs/api/teams-packaging.md](../../api/teams-packaging.md). Design: [specs/teams-unification.md](../../specs/teams-unification.md) 5.6, D4, D6.

## Registry, plan, permission

| Id            | What                  | Where                                                                                                                                                                                                      |
| ------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WIRE-TPK-001  | Product line          | `PLAN_FEATURE_DEFS[].productLine` in `packages/contracts/src/plans-subscriptions-trials/catalogue.ts`; `planFeatureLine`, `planFeaturesOfLine`; test `teams-packaging.spec.ts`                              |
| WIRE-TPK-002  | `teams` cap           | `PLAN_LIMIT_DEFS` key `teams`, zero-is-none rules in the same file (`PLAN_LIMITS_ZERO_IS_NONE`, `storedLimit`, `isUnlimitedFor`, `isLimitCapped`); request schema default in `plan.ts`                       |
| WIRE-TPK-003  | Features              | `team_hierarchy`, `custom_roles` in `PLAN_FEATURE_DEFS`, default true; labels `PLAN_FEATURE_LABELS`, chip order                                                                                               |
| WIRE-TPK-004  | Resolvers             | `resolveLimit`, `withPackLimit`, `packGrants` (plan entitlement service), `mergeLimit` (add-on registry `entitlement-merge.ts`); `forOrg` SQL reads plain live add-on packs (`generic_packs`)               |
| WIRE-TPK-005  | Error code            | `PLAN_TEAMS_NOT_INCLUDED` (422) for a solo plan; `PLAN_LIMIT_REACHED` with `limit=teams` for a full cap; `PLAN_FEATURE_LOCKED` for the two features                                                          |
| WIRE-TPK-006  | Usage meter           | `teams` in `METERS` (`plan-usage.service.ts`); listed in `NOT_A_ROW_COUNT` because the Teams guard enforces it                                                                                              |

## Enforcement points

| Id            | Point                                | Where                                                                                                                                            |
| ------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| WIRE-TPK-010  | Team create (cap)                    | `TeamsService.create` calls `TeamsPlanService.assertCanCreate(tx, orgId)` first                                                                  |
| WIRE-TPK-011  | Parent team / manager (hierarchy)    | `TeamsService.create` and `update` call `TeamsPlanService.assertHierarchy(orgId)` when `parentId` or `leadId` is set; clearing stays allowed      |
| WIRE-TPK-012  | Roles create / edit                  | `RolesService.create` and `update` call `PlanEntitlementService.assertFeature(orgId, 'custom_roles')`; read and delete stay open                  |
| WIRE-TPK-013  | `team_and_below` scope               | **Open for T2**: call `TeamsPlanService.assertHierarchy` when a grant uses the scope; hide the matrix option with `useTeamsPackaging().hierarchy` |

## Web

| Id            | What                       | Where                                                                                                                                                              |
| ------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| WIRE-TPK-020  | Plan editor, Features tab  | `auth-registration-security/platform/plans/features-tab.tsx`: grouped by product line, badge per row, per-line Enable all / Disable all                             |
| WIRE-TPK-021  | Plan editor, Limits tab    | `limits-tab.tsx`, `lib/plan-draft.ts`: for `teams` blank is unlimited and 0 is solo                                                                                  |
| WIRE-TPK-022  | Capability layer           | `apps/web/src/lib/plan-features.tsx`: `usePlanFeature(key)`, `usePlanProductLine(line)`, `useTeamsPackaging()`                                                       |
| WIRE-TPK-023  | Roles screens              | `roles-permissions/workspace/roles-page.tsx` (Add role becomes an upgrade link), `role-editor.tsx` (read only plus notice), `lib/errors.ts` (`PLAN_FEATURE_LOCKED`) |
| WIRE-TPK-024  | Teams errors               | `workspaces-teams-tenancy/lib/errors.ts` (`teamsNotIncluded`, `teamsLimit`), `components/parts.tsx` (text and upgrade link)                                         |
| WIRE-TPK-025  | Workspace plan page        | `plans-subscriptions-trials/lib/limits.ts`: `teams` 0 reads as a cap, not unlimited; operator override rows `operator/override-rows.ts`                              |
| WIRE-TPK-026  | Edition business types     | `persona/golden.test.ts` (extended); catalog constants in `packages/contracts/src/persona/editions.ts`                                                              |

## Data

Migrations: `20270220090000_teams_permissions_addon.sql` (one draft add-on row in `plans`, kind `addon`, inactive, no price) and `20270220090100_edition_personas.sql` (three personas and their
version 1 in `personas` and `persona_versions`). No table, no column, no policy is added; both are insert-only and idempotent (expand-only for the deploy lint). `plans` is a platform
catalogue written under the privileged flag; the persona tables follow the persona migrations.

## Not covered here

Role presets per edition, the onboarding or operator screen that picks an edition, seat types, and calling `assertHierarchy` from the `team_and_below` scope (T2).
