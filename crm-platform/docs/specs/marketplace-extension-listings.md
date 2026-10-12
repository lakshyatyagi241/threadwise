# Design note: Chrome extension and Sheets add-on on the Marketplace, and plugin rules

|             |                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**  | Draft for review. No code yet.                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Related** | [marketplace-mini-apps-and-integrations.md](marketplace-mini-apps-and-integrations.md) (the Marketplace spec), [docs/api/marketplace.md](../api/marketplace.md) (permissions, scopes, endpoints), [docs/threadwise-port/wiring/marketplace.md](../threadwise-port/wiring/marketplace.md), `docs/threadwise-port/inventory/addons-extension-registry.md` and `docs/threadwise-port/inventory/integrations-*` (Reference EXT and integrations) |

---

## 0. Business model (confirmed by the owner)

- **Cloud SaaS only.** No ZIP upload, no self-hosted extension loader, no third-party developers, no developer portal. The WordPress model is out.
- **Fixed-price plans** (Plan 1, Plan 2, Plan 3) with a low base price (for example $4.99) so that a new workspace can start cheaply.
- **Add-ons are paid on top of the plan**, self-serve, when a workspace needs them. A niche module such as **Appointments** or **Tickets** is sold as an add-on, not bundled into every plan, so the base price stays low.
- **Mini apps** are first-party modules we build, host and sell as add-ons. Some may be free.
- **Integrations** are connectors to outside services (lead portals, Shopify, the Chrome extension, the Sheets add-on). Plans include a set of integrations, and others can be bought as add-ons.
- **Plan gating** decides what a workspace can see and use: each listing names the plan feature it needs, and billing add-ons unlock features that the plan does not include.

**How this maps to what exists:** the Marketplace already sells priced listings through checkout with monthly subscriptions, uses plan features and `installed_apps` limits, and treats billing add-ons as entitlements. So the model needs no new billing system. What is left is the decisions below.

**Decisions this model settles:**

1. Integrations included in a plan are set by the plan's feature list, so Plan 2 can include a chosen subset of integrations.
2. The base plan price lives in the plans domain. Its value is set by the owner and is not part of this note.
3. Tickets is a new first-party mini app (customer support tickets as an add-on). It is separate from the operator helpdesk, which already exists (`platform-support-desk`).

## 1. What we are deciding

1. The Reference **Chrome extension** and **Google Sheets add-on** (feature domain `EXT`, `chrome-extension-sheets-addon`) are listed on the Marketplace as **integrations**, free of charge.
2. **Mini apps** are **plugins**, in the WordPress sense, but **built, hosted and sold only by us**. No third-party developers and no developer portal. A workspace installs them from the Marketplace. Each is free or paid, and the operator sets the price per listing.
3. Installs are **per workspace**. Each member still connects with their own account.
4. **Roles and permissions** control installing, managing and using every mini app and integration, wherever it matters.

## 2. Mini apps (plugins)

- **Who builds and hosts them:** our team only. Plugin code runs in our infrastructure, as modules behind the existing module registry and plan gate, the same pattern as the `addons-extension-registry` module gate. No new runtime, and no code from outside the company runs on our servers.
- **Pricing:** the operator prices any listing. Free listings install without a charge. Paid listings go through the existing checkout and subscriptions ledger (already built in `08932933` and `277ac6cf`).
- **Surfaces:** each plugin declares where it appears (contact panel, inbox side pane, settings page, automation block, and so on). Each surface is opt-in in the manifest.
- **Not in scope:** a developer portal, third-party plugins, and the sandbox that third-party code would need. The Marketplace spec's sections on those stay as a later phase.

## 3. Chrome extension and Sheets add-on as integrations

| Item             | Decision                                                                                                                                                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Listing          | One **integration** listing for the Chrome extension and one for the Sheets add-on. Category: Productivity.                                                                                                                                                                                                         |
| Price            | **Free.** The plan gate limits who can install them.                                                                                                                                                                                                                                                                |
| Install level    | **Workspace.** An admin installs it once and consents to its scopes. The workspace's plan limits apply.                                                                                                                                                                                                             |
| Connection       | **Per member.** Each member signs in with their own account. This matches Reference: `POST api/login` on `ExtensionApiController` uses the `users` credentials, and Sheets keys are created per account on `AccountController`. Actions stay attributed to the right person and checked against that person's role. |
| Store link       | The listing links to the Chrome Web Store and the Google Workspace Marketplace. Publishing there is outside our control and needs Google's review.                                                                                                                                                                  |
| Connector        | **New `client` connector type.** It issues nothing at install time. Install records the listing and consent, then shows the member how to connect. The five existing types all assume the install creates a credential or a webhook, which this does not, so a recipe variant would be a workaround.                |
| Reference parity | Behaviour stays as in the Reference inventory: the extension login, the token, the Sheets key routes and the Extensions admin page. The Marketplace listing is a new front door, not a replacement.                                                                                                                 |

## 4. Permissions and roles (the rule for everything)

Every mini app and integration is checked at three points, with the same role model at each.

| Stage                                                                   | Who                     | Permission                                                        | Notes                                                                                                            |
| ----------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Browse**                                                              | any workspace user      | `market.apps.read`                                                | Already built.                                                                                                   |
| **Install and consent**                                                 | admin or delegated user | `market.apps.install`, plus every key behind the requested scopes | Already built: the installer must hold every scope's keys, or the call fails with `MKT_SCOPE_EXCEEDS_INSTALLER`. |
| **Manage** (configure, enable, disable, uninstall)                      | admin or delegated user | `market.apps.manage`                                              | Already built.                                                                                                   |
| **Use** (open a plugin screen, run an action, connect a member account) | each member             | the member's own role must hold the keys the app's scopes need    | **To build.** Today the scope check runs at install, not each time someone uses the app.                         |

**Per-app key (decided):** each app gets one permission key, for example `app.sheets.use`, seeded through the `rbac-permission` skill. The admin grants it to roles like any other permission. A member can use the app only if their role holds that key and the scope keys behind it.

**Per-action key (decided):** only where an app has a dangerous action (for example, a plugin that sends messages to customers or deletes data), that action gets its own key. Everything else is covered by the per-app key. Most apps will have none.

**Scope to permission mapping:** scopes already map to existing keys in `packages/contracts/src/marketplace/scopes.ts` (for example `deals.write` means `record.deals.create` and `record.deals.update`). Use-time checks reuse that map.

**Plan gates:** each listing names a plan feature (`marketplace`) and counts against `installed_apps`. Billing add-ons count too. A plan without a listing's feature hides it or shows an upgrade prompt.

## 4a. Add-on permissions: how they appear and who gets them

**Plain words.** Installing an add-on should give the admin a new permission for it, such as "Use Appointments", in the Roles editor. The admin then decides which roles may use it. Default: the Admin role gets it. Nobody else does until the admin says so.

**"Use-time check" means:** every time a member opens an add-on screen or runs one of its actions, the server checks that the member's role holds that add-on's permission. Install-time checks only decide who may install. They do not stop a Counsellor from using an add-on that an admin installed.

**How it works (proposed):**

1. **Keys are defined in code, not by workspaces.** Each add-on declares its keys in its manifest (for example `app.appointments.use`). The keys are seeded into `permission_defs` at deploy, the same way the Marketplace keys were added by migration. A workspace cannot invent a key. This is required for safety, and it is how Reference and the existing RBAC work.
2. **Hidden until installed.** A key of an add-on that is not installed does not show in the Roles editor. Install shows it.
3. **Default grant.** On install, the key is granted to the Admin preset (the same way the Marketplace keys are granted). Any other role gets it only when an admin grants it.
4. **Roles editor.** The key appears under its add-on's name in the Roles editor, so an admin can give it to, or take it from, any role.
5. **Uninstall.** The key is hidden and its grants are removed. The change is recorded in the audit log, and the data policy from the Marketplace uninstall applies.
6. **Scopes still apply.** An add-on that reads contacts also needs the member to hold the existing contact permissions (through its scopes). The per-app key is the extra gate on top.

**What this needs from the RBAC side:** the permission catalogue is static today: new keys arrive by migration (TW-RBAC), and the RBAC steward is Lakshya. So the keys above come from a migration per add-on, and the Roles editor must show keys by install state. That is a change to the shared RBAC code and needs Lakshya's review.

## 5. What to build (in order, once approved)

1. **Use-time checks** for installed apps and integrations: one guard that every plugin surface and integration action calls. Checks the member's role against the app's scopes and per-app key. This is the gap today.
2. **Per-app permission keys** in the manifest, seeded through `rbac-permission`.
3. **`client` connector type** for the extension and the Sheets add-on, with the store link and the connect flow.
4. **Listings** for the two integrations, and the first first-party plugins (Appointments is already seeded as a draft paid app).
5. **Web UI** for the Marketplace, if not finished. The wiring map says not built; the recent `marketplace-web` commits suggest it is in progress. Check before starting.
6. **Parity run** for the extension and Sheets flows against Reference, per the port rules.

## 6. What does not change

- Reference behaviour for the extension and the Sheets add-on: nothing lost or changed.
- No store publishing or production release without the owner's approval.

## 7. Removed from this design

- **ZIP extension installer:** not on the SaaS. See the open question in section 8.

## 8. Decisions

| #   | Question                              | Decision                                                                                                                                                                                                            |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Connector type                        | New `client` type. It issues nothing at install time, so the five existing types don't fit.                                                                                                                         |
| 2   | Free or paid for the two integrations | Free. The plan gate does the limiting.                                                                                                                                                                              |
| 3   | Mini apps built by                    | Our team only. No third-party code, no developer portal, no sandbox for now.                                                                                                                                        |
| 4   | Use-time key granularity              | One key per app. Per-action keys only where an action is dangerous.                                                                                                                                                 |
| 5   | ZIP installer on the SaaS             | **Wontfix** (owner sign-off given). The ZIP upload features `TW-ADD-001` to `TW-ADD-008` are not built on the SaaS. `TW-ADD-009` (in-place module discovery from `addon/`) and later ADD features are not affected. |
| 6   | Ownership                             | **Shubham owns EXT** (`chrome-extension-sheets-addon`). The Marketplace listing is a new feature, so it does not change the domain owner.                                                                           |

**What was changed for 5 and 6:**

- `docs/threadwise-port/assignment-input.json`: added owner `shubham`, and set the EXT domain's `owner` to `shubham`. Cluster and everything else unchanged.
- `ownership.json` and `assignments.md` regenerated with `gen_ownership.py`. The `--check` passes.
- `docs/threadwise-port/tracker/shubham.md` created with `tracker.py init --owner shubham`. It has no rows yet, because the EXT inventory is still `pending`.

**Not done, needs Lakshya:** the `TW-ADD-001` to `TW-ADD-008` rows in `tracker/lakshya.md` should be set to `wontfix` with the reason "ZIP installer not on the SaaS (owner decision)". Only Lakshya edits that file, so I did not touch it.

**Policy notes:** `assignment-input.json` and `ownership.json` need all three developers' approval per the ownership guard. The change was made on your instruction, so Lakshya and Punya should confirm it, and Lakshya should make the tracker change. `tracker.py validate` already reports 309 problems in the repo (other owners' rows and a missing appointments tracker); none are from this change.
