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
| **Mini app**          | A first-party app the workspace installs                     | Appointments, Forms                            | Admin > Marketplace catalogue (listing + pricing) | Marketplace > Mini apps                                    |
| **Integration**       | A connection to an outside service; never sold by itself     | Razorpay, Google, Shopify, WooCommerce         | nothing per plan (a plan feature may gate it)    | Marketplace > Integrations                                 |

Feature vs capacity is **derived** from the pack: a pack that grants at least one feature is a feature add-on (it may also add capacity, like Teams
+10); a pack with limits only is a capacity add-on. No new column.

Wallet top-ups are not add-ons (unchanged, Part B5).

## 2. The plan x add-on matrix (new)

Every plan says, for every add-on (feature or capacity), one of three things:

| Mode         | Workspace on this plan                                              | Price                                   |
| ------------ | ------------------------------------------------------------------- | --------------------------------------- |
| **Included** | Has the add-on's features, no charge. Card: "Included in your plan" | none                                    |
| **Paid**     | Sees the card and can buy it                                         | the plan's own price, else the add-on's |
| **Hidden**   | Never sees it; checkout refuses it                                   | n/a                                     |

Rules:

- Stored in `plan_addon_offers (plan_id, addon_id, mode, amount)`. `amount` is null = the add-on's own price. Only for plain add-ons (no Marketplace
  app); mini apps keep their own rules (`plan_visible_addons`, "Included in plans" on the listing).
- **No row = Paid at the add-on's price**: exactly today's behaviour, so nothing changes for a plan nobody edited.
- **Included is only for feature add-ons.** A capacity add-on cannot be "included": the plan sets its own cap on the Limits tab. A feature add-on that
  also adds capacity (Teams +10) includes the **features** only; the extra capacity stays on sale.
- **Included writes the features.** On save the API sets every feature the add-on grants to `true` on the plan when the mode is Included, and to
  `false` when it is Paid or Hidden. The Features tab shows these keys locked with "Set by the Smart routing add-on (Add-ons tab)". So there is one
  switch, and every gate in the product (which reads the plan's features) follows it without change.
- **Free plan**: Paid means "shown, needs a paid plan to buy" (the existing `unavailable` card with "View plans"). Hidden hides it.
- **Already bought, then Hidden**: the workspace keeps what it paid for until the term ends; the owned row still shows. It cannot buy again.
- **Paid -> Included**: the renewal-stop job ends the paid renewal at cycle end (unchanged job, Part A).
- **Included -> Paid/Hidden**: the features go off for workspaces on the plan that did not buy the add-on. Their settings are kept, not deleted, and
  come back when the add-on is bought or included again.

## 3. Operator console

**Plan editor > Add-ons tab** (rebuilt):

- Section **Feature add-ons**: one row per add-on, a segmented control `Included | Paid | Hidden`, and when Paid a price field (placeholder = the add-on's
  price; empty = use it). Row text says what it gives ("Gives: Smart routing: auto-assignment and rules, ...").
- Section **Capacity add-ons**: same row, control `Paid | Hidden` (Included is not offered, with the reason).
- Section **Mini apps offered on this plan**: the existing Marketplace checklist, renamed.
- Impact line (existing endpoint): switching an add-on to Included says how many workspaces already pay for it and that their renewal stops.

**Features tab**: a key granted by any add-on is read-only with "Set by <add-on> on the Add-ons tab".

**Admin > Add-ons** (was "Add-on packs"):

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
editor shows what plans already do). Nothing else is written; no plan's features change.
