# Spec: The menu, apps and integrations

|                   |                                                                                                                                                                                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**        | Phases 1 and 2 built (web); phase 3 and 4 wait for the owner's decisions (section 7)                                                                                                                                                                                   |
| **Owner request** | 2026-10-05                                                                                                                                                                                                                                                             |
| **Related**       | [marketplace-mini-apps-and-integrations.md](marketplace-mini-apps-and-integrations.md), [docs/api/marketplace.md](../api/marketplace.md) ("Apps that own existing plan features"), [parity/product-extensions.md](../wadesk-port/parity/product-extensions.md) item 22 |

## 1. Problem

The sidebar lists everything the product has, whether or not the workspace can use it: Appointments shows although the workspace has not bought it (and opens a "not included in your plan" message), eight "Soon" entries are drawn, Shopify and WooCommerce sit under Store as if they were store tools, the Store group repeats the sections its own sidebar already has, and Sales, Campaigns and Automation are long. A full-permission admin saw **49 entries**.

## 2. The rule

| Kind of screen                                         | In the sidebar                                                                 | Not owned or not available                                                                | Example                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ----------------------------------------- |
| Core daily work                                        | Always (subject to permission)                                                 | n/a                                                                                       | Inbox, Contacts, Campaigns                |
| **App** (a Marketplace app that grants a plan feature) | Only while the workspace has the app (`gates.app`)                             | **Removed**, route closed, Settings tiles removed, permissions hidden in the Roles editor | Appointments                              |
| Plan feature                                           | Always                                                                         | Kept, marked "Upgrade" (WaDesk's rule, unchanged)                                         | Analytics, Flows                          |
| Connection / integration                               | Not in the sidebar: a tile in **Settings > Integrations**                      | Locked tile if the plan lacks it                                                          | Shopify, WooCommerce                      |
| Set-up of a feature                                    | Not in the sidebar: a Settings tile next to what it configures                 | n/a                                                                                       | Warmer (Settings > Channels)              |
| A screen its area already links to                     | Not drawn (`inMenu: false`), but only while the link that covers it is visible | Drawn again for a role that cannot see that link                                          | Store: Orders, Products, Reviews, Coupons |
| Not built yet                                          | Not drawn (`SHOW_PLANNED_IN_MENU` is off); still listed in `planned.ts`        | n/a                                                                                       | History, Notifications                    |

"Owned" means the plan feature is in the workspace's entitlement set, which already merges a plan, an override and a purchased or comped add-on. That is the same resolver the API gates use, so the menu cannot disagree with the server. The server stays the authority: the app's routes answer `PLAN_FEATURE_LOCKED` on their own.

## 3. Permissions travel with the app

Already built and reused, not rebuilt:

- `permission_defs.plan_feature` (migration `20261027090000`) hides an app's permission keys in the Roles editor until the workspace has the app, and shows them locked with the reason in `?includeLocked=1`. Appointments' keys (`record.appointments.*`, `record.booking-types.*`) are tagged.
- `@RequirePermission` and the app's own guard (`AppointmentBookingGuard`) still decide every request.
- Installing needs `market.apps.install`; subscribing rides it; viewing the Marketplace needs `market.apps.read` and the plan feature `marketplace`.
- New in this work: an app's Settings tiles carry the same `app` gate, so no set-up screen of an app the workspace lacks is offered.

**Recipe to turn an existing feature into an app** (what Appointments did, plus the web gate this work adds):

1. Listing seed: first-party `mini_app`, paid, price unset, `grants_plan_features`, `grandfather_existing` (migration pattern `20261023090200`).
2. The granted plan feature's registry default is **off**, and every plan row gets it `false`.
3. Tag the app's permission keys: `UPDATE permission_defs SET plan_feature = '<key>' WHERE key LIKE ...`.
4. Web: `gates: { permission, app: '<key>' }` on the menu entry and on each Settings tile of the app.
5. Rollout, in this order: price the listing, **Comp existing users** (dry run first), publish. Run the comp before the default is switched off.
6. Help guides for the screens keep working: a guide is shown only while its screen is.

## 4. What was built (web only; no API or database change)

| #   | Task                                                                                                                                                                                                                                                            | Result                                                                       | Verified by                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------- |
| T1  | `NavGates.app`, removed (not locked) when the entitlement is missing; unknown entitlements remove nothing                                                                                                                                                       | `_registry/types.ts`, `resolve.ts`                                           | 5 new cases in `resolve.test.ts`                         |
| T2  | Appointments: menu entry and its three Settings tiles use `app: 'appointment_booking'`; Help coverage counts an app's feature as the screen's                                                                                                                   | `appointments/nav.ts`, `settings.ts`, `help-center/coverage.ts`              | resolve, coverage and settings tests                     |
| T3  | `AppGate`: a closed app's routes (any depth) show "{app} isn't part of your workspace" with a link to the Marketplace (only for someone who may open it), in English and Arabic; the page is never mounted                                                      | `components/shell/app-gate.tsx`, `(app)/layout.tsx`, `messages/*/shell.json` | `app-gate.render.test.tsx` (8), `routeGateFor` tests (3) |
| T4  | Not-yet-built entries are not drawn in the sidebar                                                                                                                                                                                                              | `SHOW_PLANNED_IN_MENU = false`, `MENU_PLANNED_NAV`                           | `nav-model.test.ts`                                      |
| T5a | `inMenu: false`, hidden only while something visible covers the screen                                                                                                                                                                                          | `nav-model.ts` `menuItems(items, tiles)`, `app-shell.tsx`                    | 5 cases in `nav-model.test.ts`                           |
| T5b | Store: Orders, Coupons, Products, Reviews listed by the Store sidebar, so the group keeps Store and Catalog                                                                                                                                                     | three `nav.ts` files                                                         | nav tests                                                |
| T5c | Shopify and WooCommerce: Settings > Integrations tiles, out of the Store group; **bug fixed**: they gated on `integration_shopify` and `integration_woocommerce`, which are not catalogue keys, so both always rendered locked; now `shopify` and `woocommerce` | `shopify-woocommerce/nav.ts`, `settings.ts`, messages                        | settings registry tests                                  |
| T5d | Warmer: Settings > Channels tile, out of Campaigns                                                                                                                                                                                                              | `scheduled-queue-warmer/nav.ts`, `settings.ts`                               | settings registry tests                                  |
| T6  | Help guides: tile coverage, and the sentences that said "in the Store area of the menu"                                                                                                                                                                         | four guides                                                                  | `coverage.gate.test.ts`                                  |
| T7  | Deviations recorded as `intended`                                                                                                                                                                                                                               | `parity/product-extensions.md` item 22                                       | review                                                   |

Result for a full-permission admin without Appointments, counted from the real registry: **49 entries before, 33 after**. Nothing is lost: every screen is still reachable (sidebar, its area's navigation, a Settings tile, the command palette), and every route is unchanged.

The web suite passes (5,964 tests) except `platform-payment-gateways/lib/billing.test.ts` ("`$85.0` expected `$85`"), a money-formatting check in code this work does not touch. Typecheck, lint and format are clean on the changed files.

## 5. The menu now

| Group        | Entries                                                                                               |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| Platform     | Dashboard, Analytics                                                                                  |
| Inbox & Chat | Inbox, Team chat                                                                                      |
| CRM          | Contacts, Contact groups, Segments, Deals, Tasks, Companies                                           |
| Sales        | Proposals, Estimates, Sales orders, Invoices, Recurring invoices, Credit notes, Payments              |
| Campaigns    | Campaigns, Broadcasts, Scheduled, Templates, Facebook posts, Facebook broadcasts, Instagram broadcast |
| Automation   | Flows, AI usage, Flow runtime, Facebook setup (and Appointments, only when the workspace has it)      |
| Store        | Store, Catalog                                                                                        |
| Marketplace  | Marketplace                                                                                           |
| Pinned       | Help, Settings                                                                                        |

## 6. Not verified

- Not compared with the running WaDesk reference (it was not running) and not exercised in a signed-in browser session by the author of this change; unit and render tests only. The seeded `nachiket.challawar@geta.ai` sign-in has no password here.
- The Help coverage and settings checks ran against English guides only (the guides have no Arabic text).
- No API behaviour changed, so nothing was re-tested there.

## 7. Decisions for the owner (phase 3 and 4)

Each of these changes what existing workspaces can open or pay for, so none is started without a yes.

| #   | Question                                                                                                                                                                                                                                     | Recommendation                                                                                                                                                                                         | Cost                                                                                                                                                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | **Sales documents as an app.** Proposals, Estimates, Sales orders, Invoices, Recurring invoices, Credit notes and Payments become one paid first-party app, "Sales & Invoicing" (seven fewer entries). Deals, Tasks and Companies stay core. | Yes, as **one** app, not seven. Needs a **new** plan feature (for example `sales_documents`, default off); do not reuse `sales_pipeline`, which is a base feature that also gates Deals and Companies. | Largest. The API guards for sales documents and invoicing change (money paths), so it needs its own reviewed change, a listing seed, plan rows, permission tagging and the comp-existing rollout. |
| B   | **Facebook and Instagram entries** (four) shown only while that channel is connected, the same idea as an app.                                                                                                                               | Yes. `gates.channel` exists but the layout never fills the connected channels, so it removes nothing today. Wire it from the channels list.                                                            | Medium. A small endpoint or an existing list, plus tests.                                                                                                                                         |
| C   | **Store as an app** granting `wa_storefront` (already off by default on every seeded plan, so no default to switch).                                                                                                                         | Yes, after A. The Store entry has no plan gate today; Orders, Coupons and Catalog do.                                                                                                                  | Medium. Check the Store API's guards first.                                                                                                                                                       |
| D   | **A low-entry plan** where campaigning is the offer: Inbox, Contacts, Campaigns, Broadcasts, Templates and Scheduled included; Sales, Store and Appointments as add-ons.                                                                     | Yes. It is plan rows plus `plan_visible_addons`; the mechanism exists. Price and names are yours.                                                                                                      | Small once A to C exist.                                                                                                                                                                          |
| E   | **Settings tiles for AI usage and Flow runtime** (operational, not daily work), freeing two Automation entries.                                                                                                                              | Optional; not asked for.                                                                                                                                                                               | Small.                                                                                                                                                                                            |

## 8. Review

This change edits files in other developers' zones, which is unavoidable for a menu-wide change; each owner should review before it merges: the shell and registry (K4, Lakshya), Shopify, Store and Catalog navigation (Punya), the Warmer navigation (Vedant). Nothing is committed.
