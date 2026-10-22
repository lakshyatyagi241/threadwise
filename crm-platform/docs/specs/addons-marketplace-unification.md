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

## Part B: one add-ons list, one ownership state, recurring-only packs

Owner decisions (2026-10-22): one Add-ons list with one card style; every card in exactly one state; "Included" generic across paid things;
add-on packs are subscriptions; the wallet stays separate; who may see vs buy.

### B1. The shared list

`features/addons-extension-registry/components/addons-list.tsx` (`AddonsList`) is the one component. It owns its data (`GET /v2/addons`) so a mount is one
line. It is mounted on the **Plans page** (`plans-subscriptions-trials/components/addons-section.tsx` is now a heading plus `<AddonsList />`) and on `/addons`
(`WorkspaceAddonsPage`). The old Plans-page card code and the old `/addons` card code are deleted (and their message keys pruned in 21 locales). **Mounting it in the
Marketplace Add-ons tab is Part C (done below).**

It works for any workspace on an active paid plan **whether or not the plan has the `marketplace` feature**: `GET /addons` has no feature gate and the Plans page has no
feature gate on the section. A workspace NOT on an active paid plan no longer gets an empty list: the API returns the packs with every card `unavailable` plus an
`unavailableReason` (`free_plan`, `plan_expired`, `no_plan`), and the list shows a notice with that reason and a **View plans** link.

### B2. The four card states (one resolver)

`resolveOwnership({ includedByPlan, owned, purchasable })` in `@crm/contracts` is the single rule: **included beats owned beats buyable; unavailable is what is left.**

| Ownership   | Plain add-on card (`AddonCard.state`)                                | Marketplace app (`MarketCardPricing.access`) | What the card shows                                                                                                                                                       |
| ----------- | -------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| included    | `included`                                                           | `included`                                   | "Included in your plan", no price, no button; note if a held purchase is ending; "enabled by your account manager" when an override / platform-owned status is the reason |
| owned       | `active` (feature-only pack) or `buy_again` (a pack that adds a cap) | `entitled`                                   | renews on / active until, "will not renew" when stopped; buy again only for stackable limit boosts                                                                        |
| buyable     | `buy`                                                                | `subscription_required`                      | price per month / year (offer price with the list price struck through), renewal wording, buy button                                                                      |
| unavailable | `unavailable`                                                        | `not_for_sale`                               | plain add-ons: "Needs an active paid plan" and the notice with the reason + link to the plans                                                                             |

`ownershipFromAccess(access)` maps the app side onto the same four words, so the two lists cannot drift. An inactive / draft plain pack is not listed at all (the
catalogue query filters `is_active`). The existing server-side guard stays: checkout answers 422 `PAYGW_ADDON_INCLUDED` for a plain pack the plan already includes.

### B3. "Included" for paid Marketplace apps (design)

How app packs grant features today (`app-grants.ts`, `splitAppPacks`): the add-on that sells an app carries its own entitlement key (`mkt_<slug>`) plus the plan
features the app grants (`marketplace_apps.grants_plan_features`). A subscription alone grants only the `mkt_` key (which lets the workspace install the app); the
**plan features are on only while the app is installed and running**. `plan_visible_addons` decides which paid apps a plan SHOWS; visible is not usable.

The marketplace already had two operator-set inclusion rules (`included_plan_feature`, `included_min_plan`). Part B adds the generic one, **`plan_grants`**
(`MarketIncludedBy`): _the app is included when the PLAN ALONE carries every plan feature the app would grant_ (its own `mkt_` key aside; add-on packs and apps are
ignored in that check, otherwise a subscribed app would "include" itself). Computed by `PricingAccess.evaluator` (card and detail panel) and re-checked at checkout by
`assertMarketplacePack` (so a stale card cannot buy). When included: the card says "Included in your plan", there is no subscribe button, **installing stays free**
(included access goes straight to the install flow, as for a free app).

| Case                                                       | Result                                                                                                                                                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| plan carries `appointment_booking`, app **not installed**  | Included. Install is free and switches the app on; nothing to buy                                                                                                                                                              |
| app **subscribed AND plan includes**                       | Included wins on the card; checkout refuses a new subscription (422 `PAYGW_PLAN_NOT_PURCHASABLE`, `marketplace: included`). The existing subscription is not cancelled and its renewal is **not** auto-stopped (see leftovers) |
| plan carries only **some** of the app's features           | Not included: the app still adds something; subscribe as before                                                                                                                                                                |
| app grants **nothing but its own key**                     | Never included this way                                                                                                                                                                                                        |
| **plan downgrade** (plan no longer carries them)           | Back to subscribe (or owned if the subscription still runs); the app's plan features are withheld until it is installed and paid, as today                                                                                     |
| operator-set `included_plan_feature` / `included_min_plan` | Unchanged; they win over `plan_grants` and keep their own names                                                                                                                                                                |
| free app                                                   | Untouched                                                                                                                                                                                                                      |

Backward compatibility: `includedBy` gained a value (`plan_grants`); the web already falls back to the generic "included in your plan" note for any value it does not
name. Tests: `app-pack-included.spec.ts`.

### B4. Recurring only

- **Contracts**: `billingMode` on create is optional; when left out, a priced, non-lifetime pack becomes **`recurring`** and only the legacy lifetime / zero-price shapes
  stay `one_time` (`defaultAddonBillingMode`). A client that sends a mode is taken at its word and the old rules (no recurring lifetime / free pack) still apply. Update
  requests are unchanged (a pack keeps its stored mode).
- **Operator form**: a new pack has one **Billing period** picker (monthly or yearly subscription); the duration, unit, mode and lifetime controls are gone. A price above
  zero is required (message `amountPositive`). A **legacy pack** (one-time, lifetime, or a period that is not one month / one year; `isLegacyAddonPack`) that is on sale or still has live buyers shows a
  "Legacy pack" notice, its billing fields are read-only (an inactive draft nobody holds, such as the seeded Smart routing and Teams drafts, is not treated as legacy and can be converted to a subscription), and everything else (name, price, features, limits, on / off sale) stays editable. It is saved exactly as stored.
- **Existing packs keep selling as before** (the workspace card words a one-time / lifetime pack as a one-time purchase, with no renewal promise).
- **What "recurring" needs from the gateway** (`checkout.service.ts`, `shouldRecur`): a recurring add-on is a subscription only when the platform's recurring switch is
  on **and** the chosen gateway's driver supports subscriptions (Stripe, Razorpay, PayPal, Paddle and the other drivers that implement `supportsRecurring`). The **offline
  and bank-transfer gateways do not**: the order is then a normal one-term purchase (`ends_at` = the period), nothing renews, and the buyer pays again when it ends (the card
  then returns to Buy). The card therefore never says "auto-renews"; it says "Renews every term. Paid automatically with card payments; with bank transfer or offline payment you
  pay again when the term ends", and the owned row says "Active until <date>. It will not renew automatically" whenever there is no live subscription.

### B5. The wallet stays separate

Wallet top-ups are orders of kind `wallet_topup` with no plan row behind them. Both add-on lists (workspace and operator) select only plans with `kind = 'addon'` and no
Marketplace app, so a wallet item cannot appear in either; `wallet-separation.spec.ts` and `addon-ownership.spec.ts` assert the queries. The list ends with a small
"Need message credits? Top up wallet" link to `/billing/wallet`; it is a link, not a card.

### B6. Who may see and who may buy (control x permission x role)

| Control                               | Needs                       | Owner / Admin (hold it) | Manager / Agent / Viewer                                        | Operator console                    |
| ------------------------------------- | --------------------------- | ----------------------- | --------------------------------------------------------------- | ----------------------------------- |
| See the list (`GET /addons`)          | any signed-in member        | yes                     | yes                                                             | n/a                                 |
| Buy (checkout link)                   | `paygw.checkout.create`     | enabled link            | card visible, **button disabled** with "Ask your account owner" | n/a                                 |
| Cancel a renewal (owned row)          | `plan.subscription.manage`  | works                   | the API answers 403, the dialog says so                         | n/a                                 |
| Create / edit add-ons (operator form) | operator role `super_admin` | n/a                     | n/a                                                             | super_admin edits; other roles read |

`canBuy` is computed server-side from `paygw.checkout.create` (the key the checkout routes enforce), not from the plan-switch key the Plans page uses for its other buttons.
The server stays the authority: a crafted checkout request by a member without the key is refused by the route guard.

### B7. Impact analysis

- **API contract** (additive): `AddonCard.state` gained `unavailable`; new `AddonCard.includedVia`, `WorkspaceAddonsResponse.unavailableReason` and `canBuy` (all defaulted so
  an older client's parser still accepts the response). For a free / lapsed workspace `catalog` is now filled (it used to be empty) with `eligible: false`; a client that only reads
  `eligible` behaves as before. The mobile app does not use `/addons`.
- **Behaviour changes for existing data**: none stored. New packs default to recurring; existing packs untouched. A workspace that lacked the `marketplace` feature could not reach the
  Marketplace Add-ons tab; it now sees and can buy plain add-ons on the Plans page. A free-plan workspace sees a message instead of nothing.
- **Marketplace**: apps whose plan already carries all their features now read "Included" and cannot be subscribed to (new subscriptions only; existing subscriptions run on).
- **Caches**: the list is fetched on mount (`staleTime` default) and invalidated by the cancel-renewal action; no server cache.
- **Entitlement semantics are unchanged** for plain packs; only the labels and the unavailable state are new.

### B8. Edge cases

| Case                                                                                                                                                                           | Status                                                     | Where                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| free plan: packs listed, all `unavailable`, reason `free_plan`, link to plans, no checkout link                                                                                | PASS                                                       | `addon-ownership.spec.ts`, `addons-list.render.test.tsx`                                                                                     |
| paid plan expired / lapsed (falls back to free): `plan_expired`                                                                                                                | PASS                                                       | same                                                                                                                                         |
| trial on a paid plan: eligible (unchanged rule, same as checkout)                                                                                                              | PASS (rule)                                                | `unavailableReason` test                                                                                                                     |
| platform-owned workspace: every flag on, so feature-only packs read Included ("enabled by your account manager")                                                               | PASS (via `includedVia`)                                   | `addon-ownership.spec.ts`                                                                                                                    |
| workspace override ON for the pack's features: Included + support note                                                                                                         | PASS                                                       | same                                                                                                                                         |
| plan includes only some features: Buy, only the missing ones listed                                                                                                            | PASS                                                       | same                                                                                                                                         |
| pack with limits only / pack that adds a cap: never Included, Buy                                                                                                              | PASS                                                       | same                                                                                                                                         |
| stackable boost bought twice: `buy_again`, owned count                                                                                                                         | PASS                                                       | same                                                                                                                                         |
| add-on expires mid-queue (a second purchase starts later): the owned query keeps only live rows; latest end shown                                                              | PASS (query: `addonLiveSql`)                               | existing; covered by owned-row mapping                                                                                                       |
| renewal stopped by the redundancy job: Included + "ends on <date> and will not renew"                                                                                          | PASS                                                       | `addon-ownership.spec.ts`                                                                                                                    |
| plan switched from includes to not includes: Buy again with its price (offer price shown)                                                                                      | PASS                                                       | same                                                                                                                                         |
| pack inactive / draft: not listed                                                                                                                                              | PASS (query)                                               | same                                                                                                                                         |
| currency / offer price display                                                                                                                                                 | PASS (SSR)                                                 | `addons-list.render.test.tsx`                                                                                                                |
| gateway offline: wording does not promise auto-renew                                                                                                                           | PASS (wording), NOT TESTED against a live offline checkout | render test; `shouldRecur` unchanged                                                                                                         |
| race: buy clicked while the plan just started including it                                                                                                                     | PASS (server)                                              | checkout `PAYGW_ADDON_INCLUDED` (existing) and app `included` verdict (new); the UI shows Included on the next load. NOT TESTED in a browser |
| viewer / agent: disabled buy with the reason                                                                                                                                   | PASS (SSR)                                                 | `addons-list.render.test.tsx`                                                                                                                |
| legacy pack: notice, read-only billing, saved as stored                                                                                                                        | PASS (draft logic); NOT render-tested                      | `pack-draft.test.ts`                                                                                                                         |
| new pack default recurring, zero price refused, lifetime / one-time only for old clients                                                                                       | PASS                                                       | `addon-billing-mode.spec.ts`, `addon-ownership.spec.ts`, `pack-draft.test.ts`                                                                |
| wallet cannot appear in either list                                                                                                                                            | PASS                                                       | `wallet-separation.spec.ts`                                                                                                                  |
| 21 locales (en + 20), RTL render (ar)                                                                                                                                          | PASS                                                       | `i18n-tool check`, `check.sh`, render tests                                                                                                  |
| keyboard / a11y: cards are `article`s labelled by their title, the list is a labelled `ul`, buy is a link or a disabled button described by its reason, the notice is an alert | PASS (markup); NOT TESTED with a screen reader             | render tests                                                                                                                                 |
| phone width (single column, `min-w-0`, wrapped text)                                                                                                                           | NOT TESTED                                                 | no browser on this machine                                                                                                                   |

### B9. Left for later

- The renewal-stop job (`AddonRedundancyService`) only covers plain packs. A workspace that subscribed to an app and whose plan later carries the app's features keeps paying until it
  cancels (the card says Included and checkout refuses a new subscription). Extending the job to app subscriptions is a follow-up.
- The app detail page and cards already render `access: included` with the generic note; a dedicated sentence for `plan_grants` ("your plan already includes this app's features") is not added.
- ~~The Marketplace Add-ons tab mount (Part C).~~ Done in Part C.
- Rendering tests for the operator pack form (legacy notice, period picker) need an operator-context harness and were not added; the logic is covered at the draft level.

## Part C: Marketplace tabs cleanup (owner request, 2026-10-22)

Problem: the Marketplace mixed kinds of things. The tab called **Add-ons** did not list purchasable add-ons at all (it showed developer / Settings tiles), the **Integrations**
tab drew the built-in connectors as "tool" cards in another style above the Featured / Popular shelves, and the tabs did not look or sort alike. Wallet top-ups are not add-ons and stay out.

### C1. The new shape

| Tab (route)                                | What it holds                                                                                                                                                                  | Made of                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| Mini apps (`/marketplace/apps`)            | Marketplace listings of kind `mini_app`                                                                                                                                        | `BrowsePage` + `AppCard`                       |
| Integrations (`/marketplace/integrations`) | Marketplace listings of kind `integration` **and** the built-in connectors (Shopify, WooCommerce, Google account / Sheets / Docs / Forms / Calendar, Video meetings), one grid | `BrowsePage` + `AppCard` + `ConnectorCard`     |
| Add-ons (`/marketplace/addons`)            | The workspace's add-on packs: the shared `AddonsList` of Part B (Included in your plan / Active / Buy / Unavailable) and its "Top up wallet" note                              | `AddonsPage` -> `AddonsList`                   |
| Developer (`/marketplace/developer`)       | REST API, Webhooks, Geta publishing, Translation (cards; gates, icons and copy unchanged)                                                                                      | `DeveloperPage` -> `ToolCards tab="developer"` |

Installed and Requests stay in the header's "more" links. The header is `MARKET_TABS` in `lib/browse.ts` (one list: the header, the tests and the docs read it).

**Routes and links.** `/marketplace/addons` keeps its address but changes content; `/marketplace/developer` is new. Searched the repo for every link that expected developer tools on the
old Add-ons tab: the Webhooks screen's back link (now `/marketplace/developer`, label "Developer"), the "Back to Marketplace" breadcrumb of a tool screen (`settings-hub/settings-back.tsx`,
now goes to the tab of the tile it came from), and the help guides (REST API keys, Webhooks, Geta publishing, Translation: "Developer" tab; Google Calendar of Appointments: "Integrations" tab).
No redirect was added: a bookmark of `/marketplace/addons` still opens a valid page (the add-ons list, with a one-line pointer to the Developer tab), and `/marketplace`, `/integrations` still
redirect to the Integrations tab. Nothing in the API, the mobile app or the e2e suites referred to the old tab.

### C2. The `addons` tile and the Settings registry

The Settings registry's `integrations` section is `MARKETPLACE_TOOLS_SECTION`; its tiles are shown in the Marketplace, never on a Settings page (`useSettingsPageTiles` filters the section, covered by
`settings-context.render.test.tsx`), so a tool is never listed twice. `lib/tools.ts` says where each tile goes:

- `integrations` (connector cards): shopify, woocommerce, google-account, google-sheets, google-docs, google-forms, google-calendar, video-meetings.
- `developer` (tool cards): rest-api, webhooks, geta-publishing, i18n-translation. **Anything in the section nobody listed lands here**, so a new tile is never lost (a test pins it).
- `addons`: the tile `addons` (href `/addons`, no gates). **What it is:** the workspace's buyable Add-ons screen, the same list the Add-ons tab now mounts. It is not developer-only (every member sees it),
  so as a card it would duplicate the Add-ons tab: it has **no card** anywhere. It stays in the registry so `/addons` keeps its breadcrumb and its palette entry.
- `email` was in the old Integrations id list but its tile is in **Settings > Channels** (not the Marketplace section), so it never drew a card; it is removed from the list. The Email app is a
  Marketplace listing and appears in the Integrations grid as one.

### C3. The Integrations grid (one card style, one list)

- `ConnectorCard` (in `app-card.tsx`) uses the same frame (`CARD_FRAME`), icon box (`CARD_ICON_BOX`), title link, category line, two-line description, badge row and one button as `AppCard`; the grid is
  the same `CARD_GRID` on every tab (`ui.tsx`). Header badge "Built in" (like "Built by us"). The status badge is **Connected** (success), **Not connected** (neutral), **Upgrade** (warning, the plan lacks
  the feature) or **Soon**. Button: **Manage** (connected), **Connect** (not connected, primary), **Open** (locked or unknown).
- **Status is never guessed.** `components/use-connectors.ts` reads what each feature's own screen reads (`GET /google-account`, `GET /shopify` and `/woocommerce`, `GET /conferencing/connections`), only for
  a connector whose tile is present, unlocked and not "coming soon" (a role or plan without it fires no request). A read that fails or has not come back leaves the status `unknown`: the card then
  shows no connection badge, and the **Installed** filter leaves it out. Google cards: the Account card needs the connection; Sheets / Docs / Forms / Calendar also need that capability granted.
- **Categories** (`CONNECTOR_CATEGORY`, `lib/connectors.ts`): e-commerce (Shopify, WooCommerce), productivity (Google account, Sheets, Docs, Forms), calendar-and-meetings (Google Calendar, Video meetings),
  and the catch-all `automation` for a tile nobody mapped. The category list adds the connector counts to the API's counts.
- **Filters on the mixed grid** (`filterConnectors`): search looks in name + description (listings: the server), category (the mapped category), **Installed** = connected, **Available add-ons** = no connector.
- **Sort and paging** (`mergeGrid`): the listings are paged by cursor and sorted by the API; connectors are placed only where the loaded part of the list decides their place and never move afterwards.
  By **Name** they merge A-Z with the loaded cards (a connector that sorts after the last loaded card waits for the last page). Under **Most installed / Featured / Newest** the API order has nothing to compare a
  connector with, so connectors follow the listings, A-Z, once the last page is loaded. (The Integrations catalogue is a few dozen listings at most; the cost is that with more than one page of
  listings the connectors appear after "Load more" is exhausted.)
- **One default and one order:** `DEFAULT_SORT = 'popular'` (Most installed) and `SORT_OPTIONS = popular, featured, new, name` on both listing tabs. The API breaks ties by id; "then A-Z" holds for connectors.
  A shared link `?sort=featured` keeps working; a link without `sort` now sorts Most installed (it used to be Featured). Same loading, error, empty and "Load more" states: a failed listing call shows the error panel and
  keeps the connectors (they do not come from that call); the empty state shows only when there is neither a listing nor a connector.
- **Shelves** (Featured, Popular, New) are Marketplace listings only, as before; connectors appear in the main grid, never in a shelf.

### C4. Mini apps cards and the shared ownership words

`priceLine` now switches on `ownershipFromAccess(access)` (the Part B mapping), so a paid app says **Included in your plan** (included), **Subscribed** (owned), the **price** (buyable) or **Not for sale**
(unavailable), the same words as the Add-ons list; the price line carries `data-ownership`. No wording changed (the words were already these); the mapping is now one source.

### C5. The paywall on the Add-ons tab

`marketplace` is a plan feature that paywalls **every** `/marketplace/*` page through the menu entry's gate (`nav.ts`, longest-prefix match in `PlanPaywall`), so all four tabs show the upgrade sheet on a
plan without it. On `/marketplace/addons` the sheet adds a line: "Add-ons do not need the Marketplace on your plan. You can still ... buy add-ons from Plans and add-ons" with a link to `/account/plans`.
**The Plans page list stays reachable for those plans** (Part B: `GET /addons` and the Plans page section have no `marketplace` gate).

### C6. Permission matrix (tab x permission x plan feature x role x behaviour when off)

| Tab / part                        | Needs permission                                                                                                               | Needs plan feature                                                 | Role presets                                                                               | When off                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Menu entry "Marketplace"          | `market.apps.read`                                                                                                             | `marketplace`                                                      | set per role in Roles                                                                      | no key: entry hidden; no feature: entry visible and locked                                           |
| Any `/marketplace/*` page         | `market.apps.read` (the API answers 403 otherwise)                                                                             | `marketplace` (sheet on the page, and the API refuses)             | no key: the reads fail with the permission panel                                           | no feature: upgrade sheet over the page; each tab's reads show the plan-gate panel                   |
| Mini apps / Integrations listings | `market.apps.read`; install needs `market.apps.install`                                                                        | `marketplace`                                                      | install key off: cards offer "View details" only                                           | as above                                                                                             |
| Integrations: a connector card    | the tile's own gate (Shopify / WooCommerce `ecom.read`, Google `google.account.read`, Video meetings `record.contacts.update`) | the tile's own feature (`shopify`, `woocommerce`; none for others) | a persona preset can hide the tile (`tile:<id>`)                                           | no permission: **no card**; no feature: card with **Upgrade**; persona hides it: no card             |
| Add-ons tab                       | list: any member; buy: `paygw.checkout.create`                                                                                 | `marketplace` for the tab; none for the list on the Plans page     | Owner / Admin buy; others see the card with a disabled button and "Ask your account owner" | no feature: sheet on the tab, list still on Plans; free or lapsed plan: cards `unavailable` + reason |
| Developer: REST API               | `api.keys.read`                                                                                                                | `public_api`                                                       | per role                                                                                   | no permission: no card; no feature: card with Upgrade                                                |
| Developer: Webhooks               | the Webhooks tile's gate                                                                                                       | its tile's feature                                                 | per role                                                                                   | no permission: no card                                                                               |
| Developer: Geta publishing        | `flb.geta.manage`                                                                                                              | `automation`                                                       | per role                                                                                   | no permission: no card; no feature: Upgrade                                                          |
| Developer: Translation            | the Translation tile's gate                                                                                                    | its tile's feature                                                 | per role                                                                                   | same                                                                                                 |
| Installed, Requests (more links)  | `market.apps.read` (install for actions)                                                                                       | `marketplace`                                                      | unchanged                                                                                  | unchanged                                                                                            |
| Operator console Marketplace      | operator roles                                                                                                                 | n/a                                                                | **untouched** (`/admin/marketplace/*`)                                                     | n/a                                                                                                  |

The API stays the authority for every row: a hidden card is a convenience, not a guard (the tool screens and APIs enforce their own permission and plan checks).

### C7. Impact analysis

- **Behaviour changes:** (1) `/marketplace/addons` shows add-on packs instead of developer tiles; (2) developer tiles moved to `/marketplace/developer`; (3) built-in connectors are no longer a block above the shelves:
  they are cards in the grid; (4) the default sort of Mini apps and Integrations is Most installed (was Featured) and the option order is Most installed, Featured, Newest, Name; (5) the connectors react to
  the search, category and Installed filters (before, they hid whenever a filter was set); (6) the Email tile id left the Integrations id list (it never rendered there).
- **API / data / migrations:** none. No contract change, no new endpoint. The only calls added are reads that already exist, fired by a connector card whose tile the person has.
- **Other features touched:** `useOverview(kind, enabled)` gained an optional `enabled` argument (default true, no change for the store screens); the paywall sheet gained one line on the Add-ons tab; the Webhooks
  screen's back link; the Settings breadcrumb.
- **Caches:** the status reads share their query keys with their own screens (Google account, store overview, video connections), so a connect or disconnect there refreshes the card status too.
- **Persona / edition presets** (`chat_team`, `sales_team`): `resolveSettings` drops a tile the preset hides (`tile:<id>`) before the Marketplace sees it; the page draws only what the tile list holds, so a hidden
  connector has no card, no count and no search hit.
- **Vocabulary layer:** card names and descriptions come from `settings.tiles.<id>.*`, read with `useTranslations()` from the same messages the persona vocabulary rewrites, so an override applies.
- **Wallet:** nothing about the wallet appears in any tab except the one existing "Top up wallet" link under the add-ons list (a link, not a card). Tests assert the Integrations and Developer tabs do not mention it.
- **Mobile app:** does not use these screens or `/addons`.

### C8. Edge cases and tests

| Case                                                                                                          | Status                                                                                                           | Where                                                               |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| four tabs in order with their addresses; one current tab; Installed / Requests links remain                   | PASS (SSR, en + ar)                                                                                              | `tabs.render.test.tsx`, `lib.test.ts` (`MARKET_TABS`)               |
| menu entry needs `market.apps.read` + `marketplace`; all four tab addresses sit under the entry               | PASS                                                                                                             | `nav.test.ts`                                                       |
| plan without `marketplace`: sheet on every tab; Add-ons tab line points to Plans; none when the plan has it   | PASS (SSR, en + ar)                                                                                              | `plan-paywall.render.test.tsx`                                      |
| Plans page add-ons list reachable without `marketplace`                                                       | PASS (Part B)                                                                                                    | Part B tests, unchanged                                             |
| role without `market.apps.read`: entry hidden; direct URL blocked                                             | PASS for the entry gate; the API refusal is existing behaviour                                                   | `nav.test.ts`; API Marketplace specs unchanged                      |
| role lacks a tile's gate: tile absent, not an empty card (tool and connector)                                 | PASS                                                                                                             | `tools.test.ts`, `tabs.render.test.tsx`                             |
| plan-locked tile: card with Upgrade badge (tool and connector); no status claimed for a locked connector      | PASS                                                                                                             | `tabs.render.test.tsx`                                              |
| persona preset hides a module: no connector card                                                              | PASS (the list follows the tile list); the preset filter is existing code                                        | `tools.test.ts`, `tabs.render.test.tsx`, `_registry/hidden.test.ts` |
| the Add-ons screen tile gets no card anywhere; an unlisted tile lands on Developer                            | PASS                                                                                                             | `tools.test.ts`                                                     |
| every Marketplace-section tile has a place; every listed id exists in the registry (a rename cannot drop one) | PASS                                                                                                             | `settings-context.render.test.tsx`                                  |
| Settings hub never shows these tiles                                                                          | PASS                                                                                                             | `settings-context.render.test.tsx`                                  |
| connectors in the same grid and frame as listings; no separate block; not in shelves; each once               | PASS (SSR, en + ar)                                                                                              | `tabs.render.test.tsx`                                              |
| search, category (+ counts), Installed, Available add-ons on the mixed grid                                   | PASS                                                                                                             | `connectors.test.ts`, `tabs.render.test.tsx`                        |
| sort merge by Name and under the API sorts; the Mini apps tab has no connector                                | PASS                                                                                                             | `connectors.test.ts`, `tabs.render.test.tsx`                        |
| same sort options, same order, same default on both tabs                                                      | PASS                                                                                                             | `lib.test.ts`, `tabs.render.test.tsx`                               |
| empty state only when neither a listing nor a connector; loading / error / Load more unchanged                | PASS (SSR)                                                                                                       | `tabs.render.test.tsx`, `browse.render.test.tsx`                    |
| connection status: unknown until read; Google capability granted; store and meetings connected                | PASS                                                                                                             | `connectors.test.ts`, `tabs.render.test.tsx`                        |
| paid-app words (Included in your plan / Subscribed / price) through `ownershipFromAccess`                     | PASS                                                                                                             | `tabs.render.test.tsx`, `pricing.test.ts`                           |
| Add-ons tab: shared list, states, wallet note, free-plan notice, no tool cards; wallet absent elsewhere       | PASS (SSR, en + ar)                                                                                              | `tabs.render.test.tsx`                                              |
| Developer tab: cards, Upgrade badge, empty state, no connector or Add-ons tile                                | PASS (SSR, en + ar)                                                                                              | `tabs.render.test.tsx`                                              |
| Arabic RTL layout                                                                                             | PASS for text and markup (logical classes only); **layout NOT seen**                                             | no browser on this machine                                          |
| keyboard focus order across tabs                                                                              | PASS for markup order (links in document order, one link and one button per card); **NOT tried with a keyboard** | `tabs.render.test.tsx`                                              |
| mobile width                                                                                                  | **NOT TESTED**; markup: tabs scroll sideways, grid is one column below `sm`                                      | team test guide                                                     |
| deep links: `/marketplace/addons` opens the add-ons list; `/marketplace` and `/integrations` redirect         | PASS (routes exist, redirect code unchanged)                                                                     | route files                                                         |
| operator console Marketplace screens                                                                          | untouched (no file under `features/marketplace/operator` or `app/(admin)` changed)                               | git diff                                                            |
| a real browser, a real checkout of an add-on, real connection badges against live Google / Shopify            | **NOT TESTED**                                                                                                   | `docs/wadesk-port/marketplace-tabs-test-guide.md`                   |

### C9. Left for later

- Connectors under the API sorts appear after the last listing page; a real mixed ranking would need the connectors in the catalogue. If the Integrations catalogue grows past a few pages, give the connectors their own
  "Built in" group above the grid.
- The Email connection status is not read: Email is a Marketplace listing here and its tile sits in Settings > Channels.
- A dedicated Arabic help guide file (`.ar.md`) is not added; the guides are English with the app's usual fallback.
