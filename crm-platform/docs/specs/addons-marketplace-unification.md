# Add-ons and the Marketplace: one model (owner request, 2026-10-22)

Goal: every add-on behaves the same way. **Included in the plan = no charge, and the workspace's add-on card says "Included in your plan". Not
included = priced and buyable.** The operator decides this per plan, from the plan editor, without having to know which feature keys a pack grants.

Parts: **A** (this change) the operator can include a plain add-on in a plan from the Add-ons tab. **B** and **C** are placeholders below.

## Part A: include a plain add-on in a plan (plan editor, Add-ons tab)

### The problem

The Add-ons tab of the operator's plan editor listed only Marketplace-app packs (`plan_visible_addons`). The plain packs (Smart routing, Teams and
permissions; `plans.kind = 'addon'`, `marketplace_app_id IS NULL`) never appeared, so "include this add-on in this plan" worked only by ticking the
pack's feature keys on the Features tab, which nobody could discover.

### What changed

- **No new storage and no migration.** "Included in this plan" is **derived**: a pack is included when every feature key it grants (`readGrants`) is on in
  the plan's `features`. This is the exact rule the workspace card and checkout already use (`isIncludedInPlan`), so the switch, the Features tab, the card
  and checkout cannot disagree.
- **Two visibly different sections** on the tab (and a total on top, "N add-ons selected", which counts Marketplace apps offered plus plain add-ons fully
  included; a partly covered pack is not counted):
  1. **Add-ons included in this plan**: every plain pack (drafts and inactive ones too, marked "Not on sale") with an **Include {name} in this plan**
     switch. Text says add-ons that are not included are still sold at their own price to every workspace on an active paid plan.
  2. **Marketplace apps offered to workspaces on this plan**: the existing list, unchanged (its own intro).
- **Switch behaviour** (`lib/plan-draft.ts`, the single source): `packCoverage(pack, features)` gives `none | partial | full | noFeatures`;
  `setPackIncluded(draft, pack, on)` ticks (on) or **explicitly sets to false** (off) exactly the pack's feature keys. Off does **not** restore what a key
  was before and does not delete the key (a plan row that does not store a key falls back to the catalogue default, and the editor always stores every
  key). Limits, the Marketplace selection and every other feature are never touched. Two packs that share a feature key share its state (switching one off
  clears the key for the other); no shipped pack shares keys today.
- **Partly included**: a badge, the list of keys still off, and an **Include fully** button.
- **Packs with limit deltas** (Teams and permissions: `teams +10`): the row says the extra limit is **not** part of plan inclusion, nothing changes any limit,
  and the plan's own cap is set on the Limits tab. Consequence, by design and unchanged: `isIncludedInPlan` is false for a pack that adds a cap, so its card
  keeps selling the cap and the renewal-stop job never ends a subscription for it. The impact sentence is therefore not shown for such packs.
- **Pack with no features** (limits only): switch disabled, reason shown.
- **Keys outside `PACK_GRANTABLE_FEATURES`** (or outside the plan catalogue entirely, such as a module flag): can still be ticked on the plan (they are
  stored as module features); a note says only buying that pack as a pack works differently (the shared resolver merges only the grantable keys from a live pack).
- **Operator impact** (read-only): `GET /v2/platform/plans/:id/addon-impact` returns, per plain pack, how many workspaces **on this plan** hold it with a
  renewing subscription (`kind = 'addon'`, status `active` or `past_due`: the same set the renewal-stop job ends). Counts only, one per workspace, no names.
  The row shows "N workspaces already pay for this add-on. Their renewal will stop at the end of the current term, nothing is refunded and nothing is
  cancelled today." If the count cannot be loaded the row says the same without a number. A new plan has nobody on it, so no figure. Switching off says
  workspaces lose the feature unless they buy the add-on, which becomes buyable at its price.
- **Read-only mode**: the tab takes a `readOnly` flag (from `useCanEdit('plans')`); every switch, button and checkbox is disabled and a notice says why. (The
  editor dialog itself only opens for an operator who can edit; the flag is defence in depth for a future read-only view.)
- Pack list: the existing `GET /v2/platform/addons` (already returns `grants`, `isActive`, price). No new list endpoint.

### What changes for existing plans

**Nothing stored changes until an operator flips a switch and saves.** Opening an existing plan shows the switch in the state its stored `features` already
imply (for example a Growth plan that already stores both Smart routing keys reads "Included"). A saved plan is written exactly as before (`PATCH
/platform/plans/:id`, every key explicit). No migration, no backfill.

### Interplay with the renewal-stop job (`AddonRedundancyService`)

Saving a plan that now covers a pack changes nothing at save time. The job (after a plan payment and every 10 minutes) evaluates each workspace with a
renewing plain add-on; when the plan covers every grant of the pack and the pack adds no cap, it ends the renewal at the cycle end (no refund, no early
removal, billing admins notified). The count in the editor is the preview of exactly that set. Switching a pack off later never restarts a stopped
renewal. Between save and the next pass (up to ~10 minutes) the workspace has the feature through the plan and still holds the pack.

### Caches

No per-plan entitlement cache exists (`PlanEntitlementService` reads the plan row; only the billing grace days are cached for 30 s), so a saved plan takes
effect on the next request. On the web the editor uses react-query: the pack list and the impact figure are fetched each time the editor opens (no focus
refetch while it is open). The workspace's add-on card refetches on its own page load.

### Permissions (control x permission x role)

| Control / call                                  | Needs                                    | super_admin | other operator roles                                               | workspace user        |
| ----------------------------------------------- | ---------------------------------------- | ----------- | ------------------------------------------------------------------ | --------------------- |
| Open the plan editor / use the switches         | plans edit (`useCanEdit`)                | yes         | no (editor not offered; if shown, controls disabled with a notice) | no                    |
| Save the plan (`PATCH /platform/plans/:id`)     | `OperatorRoles('super_admin')`           | yes         | 403                                                                | 403 (not an operator) |
| `GET /platform/addons` (pack list)              | any operator role                        | yes         | yes                                                                | 403                   |
| `GET /platform/plans/:id/addon-impact` (counts) | any operator role (like every plan read) | yes         | yes                                                                | 403                   |

The impact read runs in the plan store's privileged transaction (the module's one door for cross-tenant counts) and returns only aggregate counts.

### Edge cases

| Case                                                                                                             | Status        | Where                                                       |
| ---------------------------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------- |
| none / partial / full coverage derived from the draft                                                            | PASS          | `plan-draft.test.ts`                                        |
| Features-tab edits flip the switch both ways; "Include fully" completes a partial pack                           | PASS          | `plan-draft.test.ts`                                        |
| switching on then off writes `false` explicitly (documented, does not restore)                                   | PASS          | `plan-draft.test.ts`                                        |
| pack with limit deltas: limits untouched; note shown; no renewal-stop sentence                                   | PASS          | `plan-draft.test.ts`, `plan-editor.render.test.tsx`         |
| pack with zero features (limits only): switch disabled, state `noFeatures`, draft unchanged                      | PASS          | both                                                        |
| keys outside `PACK_GRANTABLE_FEATURES` / outside the catalogue: tickable, stored as module features              | PASS          | `plan-draft.test.ts`                                        |
| inactive / draft pack: switch works, "Not on sale" and a note                                                    | PASS (render) | `plan-editor.render.test.tsx`                               |
| editing a plan that already has the keys on while workspaces hold the add-on: reads Included, save keeps them on | PASS          | `plan-draft.test.ts`, `plan-addon-impact.spec.ts`           |
| new plan defaults (`NEW_PLAN_FEATURES_OFF`) untouched                                                            | PASS          | `plan-draft.test.ts`                                        |
| every key stored explicitly on save (on and off)                                                                 | PASS          | `plan-draft.test.ts`                                        |
| read-only operator: switches disabled                                                                            | PASS (render) | `plan-editor.render.test.tsx`                               |
| impact count: active + past_due only, once per workspace, only this plan, never a Marketplace pack               | PASS          | `plan-addon-impact.spec.ts` (real Postgres)                 |
| ar (RTL) and en render of the tab                                                                                | PASS (SSR)    | `plan-editor.render.test.tsx`                               |
| the tab in a real browser, the dialog scroll, phone width                                                        | NOT TESTED    | no browser run on this machine; verify on the deployed site |
| end-to-end save of a plan from the editor with the new switch against the running API                            | NOT TESTED    | no dev servers on this machine                              |
| the renewal-stop job after such a save                                                                           | NOT TESTED    | unchanged code; its own specs cover it                      |

## Part B: to be done

Placeholder. Not started in this change.

## Part C: to be done

Placeholder. Not started in this change.
