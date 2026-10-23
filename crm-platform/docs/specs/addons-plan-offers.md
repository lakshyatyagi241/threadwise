# Add-ons per plan: Included, Paid or Hidden (owner request, 2026-10-22)

Part D of [addons-marketplace-unification.md](addons-marketplace-unification.md). Parts A to C made one add-on list and one card style. This part answers
the owner's three remaining complaints:

1. "I cannot see in which plan an add-on is included and in which plan it is paid."
2. "The same add-on must behave differently per plan: included on Growth, paid on Basic, not even shown on Free."
3. "I removed the add-on from the plan, and the auto-assignment settings still show in the workspace."

## 1. Four kinds of thing, four names

| Kind                  | What it is                                                   | Examples                                       | Where the operator sets it up                    | Where the workspace sees it                                |
| --------------------- | ------------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------- |
| **Feature add-on**    | Unlocks a module of the product                              | Smart routing, Teams and permissions           | Admin > Add-ons (pack) + plan editor Add-ons tab | Plans and add-ons, Marketplace > Add-ons; the module's own screen |
| **Capacity add-on**   | Adds to a limit; no feature                                  | Extra seat, Contact boost                      | same                                             | same                                                       |
| **Mini app**          | A first-party app the workspace installs                     | Appointments, Forms                            | Admin > Marketplace (listing + price) + plan editor Mini apps tab | Marketplace > Mini apps                  |
| **Integration**       | A connection to an outside service                           | Razorpay, Google, Shopify, WooCommerce         | Marketplace listing (paid ones) + plan editor Integrations tab | Marketplace > Integrations                 |

**Feature vs capacity is the operator's choice** (Type in the add-on editor, stored in `plans.addon_kind`). A feature add-on unlocks at least one feature and may also add
capacity (Teams +10); a capacity add-on only adds to limits. It used to be derived from the grants, which read a pack whose features were cleared as a capacity add-on
(Smart routing could not be included). Rules: feature needs a feature, capacity needs a limit and no feature. A row written without a kind falls back to the derived kind.

Built-in connectors (Shopify, WooCommerce) are plan features, not packs: they stay on the Features tab. Free integrations and free mini apps have no pack, so they have no
offer; the Integrations and Mini apps tabs list the PAID ones.

Wallet top-ups are not add-ons (unchanged, Part B5).

## 2. The plan x add-on matrix (new)

Every plan says, for every add-on, mini app and integration, one of three things:

| Mode         | Workspace on this plan                                              | Price                                   |
| ------------ | ------------------------------------------------------------------- | --------------------------------------- |
| **Included** | Has it, no charge. Card: "Included in your plan"                    | none                                    |
| **Paid**     | Sees the card and can buy it                                         | the plan's own price (plain add-ons only), else its own |
| **Hidden**   | Never sees it; checkout refuses it                                   | n/a                                     |

Rules:

- Stored in `plan_addon_offers (plan_id, addon_id, mode, amount)`.
  - **Plain add-ons**: `amount` null = the add-on's own price. No row = Paid at the add-on's price (today's behaviour, so an untouched plan is unchanged). Included writes the add-on's
    features on the plan; Paid and Hidden turn them off.
  - **Mini apps and integrations** (add-ons with a `marketplace_app_id`): an app keeps its own price, so `amount` is always null. Visibility stays in `plan_visible_addons`
    (a row = visible) and is written together with the offer: **Hidden** = no visible row; **Paid** = visible row, no offer row; **Included** = visible row plus an `included` offer row.
    No row of either = Hidden (as today). The features the app's listing grants (`grants_plan_features`, never its own `mkt_` key) are switched on when it BECOMES included and off when it
    stops being included; saving Paid or Hidden for an app that was never included never touches a feature the plan carried on its own.
  - The Marketplace reads Included as `includedBy: 'plan_offer'` (after the listing's own rules, before `plan_grants`): the card says "Included in your plan", there is no subscribe
    button, installing is free, and checkout refuses a subscription.
- **Included is only for add-ons that unlock something.** A capacity add-on cannot be included (the plan sets its own cap on the Limits tab), nor a feature add-on that has no feature yet.
- **Included writes the features.** (plain add-ons: see above.) So there is one switch, and every gate in the product follows it without change.
- **Free plan**: Paid means "shown, needs a paid plan to buy" (the existing `unavailable` card with "View plans"). Hidden hides it.
- **Already bought, then Hidden**: the workspace keeps what it paid for until the term ends; the owned row still shows. It cannot buy again.
- **Paid -> Included**: the renewal-stop job ends the paid renewal at cycle end (plain add-ons; unchanged job, Part A).
- **Included -> Paid/Hidden**: the features go off for workspaces on the plan that did not buy the add-on. Their settings are kept, not deleted, and
  come back when the add-on is bought or included again.

## 3. Operator console

**Plan editor tabs**: Details and pricing | Features | Limits | **Add-ons** | **Integrations** | **Mini apps**.

- **Add-ons**: Feature add-ons and Capacity add-ons sections. One row per add-on, a segmented control `Included | Paid | Hidden` (capacity: `Paid | Hidden`), and when Paid a price field
  (placeholder = the add-on's price; empty = use it). Row text says what it gives. A feature add-on with no feature yet cannot be Included (the row says why).
- **Integrations** and **Mini apps**: one row per paid Marketplace app of that kind, the same `Included | Paid | Hidden` control, no price field (an app keeps its price), search, and a
  "set all shown to" shortcut. Each tab has a count chip (included plus offered).
- Impact line (existing endpoint, plain add-ons): switching to Included says how many workspaces already pay for it and that their renewal stops.

**Features tab**: a key granted by any add-on is read-only with "Set by <add-on> on the Add-ons tab".

**Admin > Add-ons** (was "Add-on packs"):

- The add-on editor has a **Type** (Feature add-on / Capacity add-on) that decides which sections show and what the plan editor offers.
- List gets a **Plans** column: "Included: Growth, Enterprise · Paid: Basic (₹199) · Hidden: Free".
- Pack editor gets a **Plans** section with the same per-plan control (same storage, saved with the pack's own button via `PUT /platform/addons/:id/plans`).

**Workspace detail > Plan tab**: an **Add-ons** block lists every add-on with what this workspace has and **why**: "Included by plan", "Bought, renews
12 Nov", "Switched on by override", "Can buy (₹199)", "Hidden on this plan". An override is the only thing that beats the plan; the block says so and
the "Edit & change plan" dialog clears it.

## 4. Workspace

- **Add-ons list** (Plans and add-ons, Marketplace > Add-ons): Hidden add-ons are not listed; cards are grouped **Feature add-ons** and
  **Capacity add-ons**; the price is the plan's price.
- **Locked module screens** name the add-on from data, not from code: `GET /billing/entitlements` returns `featureAddons` (feature key -> add-on name, offer
  `buy | included | owned | hidden | unavailable`, price). One component, `FeatureAddonLock`:
  - `buy` / `unavailable`: "Add Smart routing for ₹199/month" + link to the add-ons list (buy button only for people who may buy).
  - `hidden`: the locked part is **not shown at all**, no upsell.
- **Auto-assignment page**: the base controls (claim sets owner, queue alert, waiting queue) always show. The Smart routing parts (master switch, sticky
  agent, contact owner, rules, Everyone else, timers) show only when the workspace has `inbox_routing` / `inbox_assignment_sticky`. Without them: one
  `FeatureAddonLock` card (or nothing when Hidden). Stored settings are kept and come back when the add-on is on again.

## 5. Permissions (unchanged keys)

| Action                                   | Who                                           |
| ---------------------------------------- | --------------------------------------------- |
| Edit plan offers (plan editor, pack editor) | operator `super_admin` (same as plan save) |
| Read offers (operator)                   | any operator role                             |
| See add-ons list                         | any workspace member                          |
| Buy                                      | `paygw.checkout.create` (Owner, Admin)        |
| Override a workspace's feature           | operator `super_admin`                        |

## 6. Server checks

- Checkout refuses a Hidden add-on (422 `PAYGW_ADDON_NOT_OFFERED`) and charges the plan's price when set.
- `GET /addons` drops Hidden add-ons the workspace does not own.
- Entitlement grace: a plain pack counts as live with the same rule (`addonLiveSql`, autopay grace) in both resolvers.

## 7. Migration

`plan_addon_offers` is created and backfilled with **Included** for every plan whose features already cover every feature of a feature add-on (so the
editor shows what plans already do). `20270401090000_addon_kind_and_app_offers.sql` adds `plans.addon_kind` (backfilled: the two seeded feature packs and any pack with a feature are
`feature`; a pack with limits and no feature is `capacity`; an empty pack is an unfinished `feature` add-on) and lets the offers table take an app's add-on (no price). Nothing else is
written; no plan's features, visible apps or offers change.
