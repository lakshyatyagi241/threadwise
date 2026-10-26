# Add-ons: included means installed, disable and uninstall are safe, permissions follow (owner request, 2026-10-23)

Part E of [addons-plan-offers.md](addons-plan-offers.md). Status: **phase 1 built (section 11); phases 2 to 5 planned.** Research: three read-only code surveys (app lifecycle, permissions and roles, per-feature consequences); findings are summarised in section 2.

## 0. What the owner asked for

1. A feature that belongs to an add-on is managed **only** on the Add-ons side (Included / Paid / Hidden), never as a second switch on the plan's Features tab.
2. **Included means installed by default.** A workspace whose plan includes an add-on gets it active without doing anything. It may **disable or uninstall** it.
3. Disabling or uninstalling must be safe: **dependencies and consequences handled, errors handled**, for each and every add-on.
4. **Permissions follow the add-on**: when an add-on becomes available or active its permissions become assignable in Roles (and so to team members); when it is disabled, uninstalled or lapses they are disabled.

## 1. The model

Two separate questions, today mixed together:

| Question | Meaning | Decided by |
| --- | --- | --- |
| **Entitled** | May this workspace have it? | The plan's offer (Included), a purchase (Paid then bought), or an operator override |
| **Active** | Is it on for this workspace right now? | Entitled **and** not disabled by the workspace **and** (for an app) installed and running **and** its required features are active |

`effective(feature) = entitled ∧ active ∧ requires(feature) all effective`. One resolver, one place. Every gate in the product (API guards, workers, menu, settings tiles, Roles editor, `/me`) asks it.

### 1.1 Kinds and what "installed" means

| Kind | Examples | Install state today | Target |
| --- | --- | --- | --- |
| Mini app / integration (Marketplace app) | Appointments, Forms, Email, Lead scoring, SMS, Zoom | `workspace_app_installations` (active / disabled / killed) | Same table. **Included → installed by default.** |
| Feature add-on (plain pack) | Smart routing, Teams and permissions, Voice pack, Remove branding | none (plan feature on or off) | **New activation row**: `workspace_addon_activation (org_id, addon_id, state active / disabled, source plan / purchase / user, changed_by, changed_at)`. Default active when entitled. "Disable" = workspace opts out. |
| Capacity add-on | Extra seat, Contact boost | none | No install. Over-cap handling only (section 6). |

Operator overrides and platform-owned workspaces still win (unchanged): a platform-owned workspace is never disabled by the workspace switch.

### 1.2 Included apps: install by default

- **When:** on signup, on a plan change, when the operator sets an app Included (existing workspaces on the plan), and on a nightly reconcile. One idempotent `AddonProvisioner` reconciles "should be installed" against "is installed".
- **Which:** first-party apps only (`first_party = true`). Their scopes are product-internal, so a system install with a ledger entry `source = plan` (no consent screen) is safe. A **third-party** app that is Included is listed as "Included - install" and needs the workspace's own consent: a plan never grants a third party scopes.
- **Opt-out sticks:** a workspace that uninstalls or disables an included app is recorded (`opted_out`), so the reconcile does not install it again. Re-enabling clears it.
- **Cap:** installs made by the plan (`source = plan`) do not count toward `installed_apps`; user installs do.
- **(Phase 2, with the provisioner) Features come from the install, not from the plan row.** Today an Included app's features are written into `plans.features`, so uninstalling it changes nothing (uninstall is cosmetic) and Roles ignores the install. Target: an Included app's features are granted while its installation is active (the same rule a purchased app already follows in `app-grants.ts`) and are **not** written to `plans.features`. Backfill removes what Part D wrote for apps.
- **Backfill:** one migration job installs included first-party apps for existing workspaces once, in batches.

### 1.3 Disable vs uninstall

| Action | Effect | Keeps | Reversible |
| --- | --- | --- | --- |
| **Disable** (pause) | Feature inactive, routes 422, menu hidden, workers skip, permissions inactive | Config, credentials, data, role grants | One click, restores exactly |
| **Uninstall** | As disable, plus external tokens revoked (Google, Microsoft, Zoom, Meta webhooks), credentials deleted | Non-secret config for 30 days, all business data, role grants | Reinstall within 30 days restores config; tokens need reconnect |
| **Lapse** (subscription ended, plan stopped including it) | As disable (`paused_by_subscription`) | Same as disable | Renew or re-include restores |

The "delete my data" choice in the uninstall dialog is **removed** until an executor exists (today it is only logged). Deleting business data stays a support action.

## 2. What the research found (the reasons for the plan)

- Gates close but **workers and public routes stay open**: appointment reminders and calendar sync, recurring invoices, queued scheduled messages, outbound webhooks, live flows, embedded chatbot widgets, the Shopify/WooCommerce order pipeline, the WhatsApp warmer, already-created SMS campaigns.
- **Public intake 404s and loses data**: website forms (`form_builder`) and lead hooks (`lead_sources`).
- **Smart routing off** deletes pending escalations and discards away and owner-sync events for good; chats that arrived while off are not routed on re-enable.
- **No dependency model**: every "needs X" is hard-coded (`appointment_confirm_buttons` and `appointment_rebook_steps` need `appointment_booking`; `inbox_assignment_sticky` and team methods need `inbox_routing`; Growth pilot needs `lead_scoring`; email and SMS campaigns need the channel; Zoom and Teams need an installation and the user's own login).
- **Permissions are not entitlement-aware**: `PermissionsGuard` checks only role grants; `permission_defs.plan_feature` and `app_slug` are used by the Roles editor for display only. Many gated permissions have **no link** (list in 5.1). The server accepts a role save that grants a locked key. A locked, dormant grant cannot be unticked.
- `calling` and `inbox_kanban` are declared but enforced nowhere. `marketplace` OFF blocks uninstall. `installed_apps` counts disabled and killed rows. Included to Paid touches no workspace and stops no renewal for apps.

## 3. Dependencies: one declared graph

Replace hard-coded checks with a declaration next to each feature in `PLAN_FEATURE_DEFS` (`requires: [...]`) and a `requires` list on app listings.

| Feature / app | Requires |
| --- | --- |
| `appointment_confirm_buttons`, `appointment_rebook_steps` | `appointment_booking` |
| `inbox_assignment_sticky`; team methods round robin / least loaded; waiting-queue timers; away return; owner sync | `inbox_routing` |
| `team_hierarchy` effects on scopes | (none; narrows `team_and_below` to `team`) |
| Growth pilot | `lead_scoring` |
| Email campaigns / SMS campaigns | `email_channel` / `sms` |
| Zoom, Microsoft Teams | an active installation and each user's own connection |
| Meet link on a booking | Google account with the calendar capability and `appointment_booking` |
| Invoice on a paid store order | `invoicing` and the store connection |
| AI mode of a chatbot widget | `ai_assistants` |
| Meta Lead Ads | `lead_sources` and `extra_channels` |

The resolver applies `requires` once. **Disable and uninstall run a preflight** (section 4) that lists the dependents that will stop, so nothing is silently off.

## 4. Disable and uninstall: the contract each add-on follows

Every add-on registers one lifecycle handler (a small class in its own module, listed in a registry the way modules already register):

```
impact(org)   -> what stops, what is kept, what is at risk (counts, names)
onDisable(org)-> wind down: pause workers' work for this workspace, cancel timers, revoke tokens
onEnable(org) -> resume: re-arm timers, reconcile what was missed
```

- **Preflight API:** `GET /v2/addons/:id/impact?action=disable|uninstall` returns the impact (dependents, scheduled items, live objects, affected roles and people). `POST` with `confirm` runs it. The web shows one dialog for every add-on: "Disabling Smart routing: 14 chats are waiting, 3 teams use round robin, 2 flows hand off to rules. These stop being routed. Settings are kept." with a typed confirmation when something customer-facing is at risk.
- **Pause, do not drop:** work that is skipped while off is **held**, not discarded, and resumes on enable (escalations paused not deleted; away and owner-sync events replayed from the outbox; queued scheduled messages held; recurring invoices skipped with a visible "paused" status; lead hooks queue for 30 days instead of 404).
- **Errors:** the preflight and the action are one transaction plus idempotent side effects (revoke tokens, cancel timers) with a retry queue. A failed side effect leaves the add-on `disabling` with a banner and a retry, never half off. Re-enable is idempotent.
- **Public surfaces:** a disabled form or booking page answers a clear "unavailable" page (never a bare 404); embeds show the unavailable state; the owner is notified once.

### 4.1 Per add-on (what wind-down does, what stays)

| Add-on | Requires | On disable: wind-down | Kept | Resume on enable |
| --- | --- | --- | --- | --- |
| **Smart routing** (`inbox_routing`, `inbox_assignment_sticky`) | none (sticky needs routing) | Pause escalation timers (do not delete), stop owner sync and away return, new chats go to the Waiting queue **with the Waiting state set** | Rules, Everyone else, switches, team methods, hours | Re-arm timers, replay away and owner-sync events from the outbox, route chats that waited without an owner |
| **Teams and permissions** (`team_hierarchy`, `custom_roles`, `teams` cap) | none | Stored `team_and_below` narrows to `team` (already); custom roles keep working for holders; **allow trimming**: role edit that only removes grants stays allowed while off | Teams, parents, roles, all grants | Wider scopes return |
| **WhatsApp calling** (`waba_calling`) | a connected Cloud API number | Turn calling **off on the Meta number** (so no unanswerable ringing), allow reject and terminate, stop readiness job | Numbers, call logs, recordings | Re-enable on Meta, readiness check |
| **Remove branding** | none | Footer and "Powered by" return instantly (also on scheduled sends: say so in the preflight) | Custom footer | Returns |
| **Appointments** | Google or Microsoft account for sync | **Gate the reminder sweep, message consumer, lifecycle sweep and calendar jobs** (today ungated); public page "unavailable"; manage-by-token still lets a customer cancel | Types, bookings, sequences, themes, tokens | Resume reminders for future bookings; do not send reminders that came due while off |
| **Forms** | none | Public embeds show "unavailable" and **queue submissions** (not 404); payment sweep gated | Forms, submissions | Flush the queue |
| **Email** | the installed app | Stop sync and push; hold queued sends (fail loud, not silently); campaigns re-checked at dispatch | Mail, conversations | Resume sync from the saved cursor |
| **Lead scoring** | none | Skip scoring (already), Growth pilot dormant | Settings, scores | New events only |
| **SMS** | none | Re-check at dispatch for broadcasts, campaigns and scheduled messages | Senders | Resume held sends |
| **Chatbot widget** | `ai_assistants` for AI mode | Public widget and responder stop (**today they keep serving**); embed shows nothing | Widgets, assistants | Returns |
| **WhatsApp catalog / storefront** | none | Public storefront closes ordering with a notice; payment webhooks still settle open orders | Catalog, orders | Returns |
| **Invoicing** | none | Gate `RecurringInvoiceSweep`; public pay page stays for sent invoices | Documents | Resume schedules, no catch-up burst |
| **Outbound webhooks / public API** | none | Gate dispatch and delivery; `public_api` off returns a clear 422 | Keys, endpoints | Resume delivery |
| **Automation (flows)** | none | Live flows pause at the next step (**today they keep running**); flows referencing a disabled app's step show a warning | Flows | Resume |
| **Shopify / WooCommerce** | `invoicing` for invoices | Gate the webhook pipeline and event messaging | Connection, mirrored data | Resume; reconcile missed orders via the existing sync |
| **SLA** | none | Pause clocks (store paused time) so a re-enable does not mass-breach | Policies | Resume clocks |
| **Scheduled messages / warmer** | none | Held, not sent; warmer throttle stops applying (and says so) | Queue | Resume |
| **Zoom, Microsoft Teams** | per-user login | Revoke per-user tokens on uninstall | Links already made | Reconnect |
| **Calling, Kanban keys** | n/a | `calling` and `inbox_kanban` are enforced nowhere: either wire them or delete the keys | n/a | n/a |
| **Capacity (seats, contacts, devices, teams, installed apps)** | n/a | See section 6 | Existing rows | n/a |

## 5. Permissions follow the add-on

**Rule: effective permission = granted by a role ∧ its feature/app is active.** Enforced in `RbacService.loadGrants` (the same place `withPlanScopes` already narrows scopes), so `PermissionsGuard`, `/me`, the menu and every route see the same answer, including the controllers that carry only `@RequirePermission` today. The cache key already includes `roles_version`; plan changes, activation changes and installs **bump it** (an event handler), so a change is visible at once.

### 5.1 Link every gated permission (data fix + a test that keeps it true)

Set `permission_defs.plan_feature` and/or `app_slug` for every permission whose feature is add-on gated. Unlinked today: `inbox.routing.manage` (shared with base handoff: split the key so the Smart routing parts have their own), `appointments.channels.manage`, `appointments.templates.manage`, `call.logs.*`, `auth.branding.update`, `aicrm.copilot.*`, `wgt.*`, `help.agent.*`, `cat.*`, `store.orders.*`, `store.coupons.*`, `waba.groups.*`, `sms.senders.*`, `api.keys.*`, `webhooks.*`, `market.apps.*`, `leads.sources.*`, `ecom.*`, `integ.apilibrary.*`, and the Email keys (no `app_slug`). A unit test walks every controller that has both `@RequirePermission` and `@RequirePlanFeature` and fails when the permission is not linked to that feature.

### 5.2 Roles editor

- A locked permission row says **why** and offers the fix ("Needs Smart routing - Add it" / "Install Appointments"), not a raw slug.
- The **server refuses** a role save that grants a locked key (422), except keys the role already holds (dormant).
- A dormant locked grant **can be unticked** (today the checkbox is disabled, so access cannot be trimmed).
- "Start from role" copies only keys that are currently assignable.

### 5.3 New permissions reach the right people

- **Presets:** the baseline for Manager, Agent and Viewer is declared per add-on (`addon_permission_presets`), applied **when the add-on becomes active** for the workspace (not only at provisioning). Fixes the drift where Forms and Email grants exist only for workspaces that existed when the migration ran.
- **Owner and Admin** already receive every key (trigger).
- **Custom roles get nothing automatically** (a custom role is a deliberate choice). After activation the owner sees one notice: "Appointments is active. New permissions: ... Add to roles" with a picker.
- **Disabling** never deletes grants: they stay dormant and come back with the add-on.

## 6. Plan transitions and caps

- **Included → Paid or Hidden** (operator): the editor shows a **per-workspace impact preview** (how many workspaces on the plan use it, active vs unused), and an option **"Keep for current workspaces until their next renewal"** (grandfather window). Without it the add-on moves to Paid at once; the workspace gets a notice 7 days before when a window is set. Apps get the renewal-stop job plain add-ons have.
- **Paid → Included:** existing paid renewal ends at the term (existing job), now also for apps.
- **Cap lowered below usage** (seats, contacts, devices, teams, installed apps): existing rows keep working, new ones are refused with a message that names the add-on to buy (today silent for inbound contact capture: it must queue and notify). Capacity packs for users, contacts and devices are not merged into the resolver the gates use (only `teams` is): fix before selling them.
- **Retention wipe** after a lapse already deletes workspace data for plans with `data_retention_days > 0`: the lapse notice names it.
- `marketplace` OFF must not block uninstall or disable of an app the workspace holds.

## 7. Operator console

- Plan editor: no change to the tabs; Included now says "installed by default for first-party apps".
- Workspace > Plan tab: add **Active / Disabled by workspace / Uninstalled** next to the source (plan, purchase, override), and a **Force re-enable** for support.
- Add-on editor: **Requires** shown (read-only, from the registry) and the disable impact summary.

## 8. Workspace UI

- Marketplace > Add-ons, Mini apps, Integrations: a card state **"Included · Active"** with **Disable** and **Uninstall** in a menu; **"Included · Disabled"** with **Enable**.
- One shared dialog for impact + confirm; errors inline with Retry.
- Settings tiles and menu entries for a disabled add-on are hidden (same rule everywhere), with one exception: the add-on's own card stays so it can be re-enabled.

## 9. Phases

| Phase | What | Risk it removes |
| --- | --- | --- |
| **1 Foundation** | Activation table, resolver `entitled ∧ active ∧ requires`, `requires` in the registry, impact and disable/enable endpoints, the shared web dialog, Included apps resolved by install (not `plans.features`) | Uninstall being cosmetic; dependents silently off |
| **2 Default install** | `AddonProvisioner` (first-party, opt-out sticks, cap exclusion), backfill, third-party "Included - install" | The "installed by default" request |
| **3 Permissions** | Link audit + test, entitlement-aware grants in `RbacService` with `roles_version` bumps, Roles editor rules, preset baseline per add-on, activation notice | Permissions drifting from the add-on |
| **4 Wind-down** | Handlers per add-on in the order of customer risk: gate the ungated workers (reminders, recurring invoices, webhooks, flows, widgets, scheduled sends), forms and lead-hook queueing, Smart routing replay, SLA clock pause | Customers still contacted after OFF; lost intake |
| **5 Operator** | Impact preview and grandfather window, renewal stop for apps, workspace tab states | Included → Paid surprises |

Each phase ships on its own (migration, API, web, 21 locales, help guides, tests) and is safe alone: phase 1 changes no customer-visible behaviour until a workspace disables something.

## 10. Decisions needed from the owner (recommended answers first)

1. **Third-party included apps** are not installed for the workspace; they show "Included - install" (consent stays the workspace's). Alternative: auto-install everything.
2. **A workspace may disable a feature add-on** it was given by the plan (Smart routing, Teams, Voice pack) with the preflight. Alternative: only apps can be disabled.
3. **Included → Paid** offers a grandfather window (default: until next renewal). Alternative: immediate.
4. **Uninstall keeps non-secret config for 30 days.** Alternative: delete immediately as today.
5. **Wind-down pauses and holds** customer-facing work (resume on enable) rather than dropping it.

## 11. Phase 1: what was built

- **Migration `20270402090000_workspace_addon_activation.sql`:** table `workspace_addon_activation` (tenant, RLS forced; state `active` / `disabled`, source, who, when; no row = active) and the permission `addons.activation.manage` (Owner and Admin). It is the one opt-out registry for plain add-ons **and** apps' add-ons (phase 2's provisioner reads it).
- **Resolver (`PlanEntitlementService`):** `Entitlements.disabledFeatures` = the features of every add-on the workspace switched off, less any a still-live add-on of its own also grants. `resolveFeature` order: platform-owned, override OFF, override ON, workspace switch, plan row, then **`requires`**. An override ON does not lift a dependency. `requires` is declared once on the feature (`PLAN_FEATURE_DEFS`: `appointment_confirm_buttons` and `appointment_rebook_steps` need `appointment_booking`; `inbox_assignment_sticky` needs `inbox_routing`); `featureRequires` and `featureDependents` read it.
- **Lifecycle (`AddonLifecycleService`):** `GET /v2/addons/:id/impact?action=` (what stops: features, dependents; what is kept; roles that hold the features' permissions; Smart routing: waiting chats, rules, teams on an automatic method; Teams: teams, custom-role holders), `POST /v2/addons/:id/disable` (needs `confirm: true`), `POST /v2/addons/:id/enable`. Only a **plain add-on the plan includes** can be switched here (422 `PAYGW_ADDON_NOT_TOGGLEABLE` otherwise: a bought one is cancelled from its renewal; an app's add-on is handled by the Marketplace). Audit event, outbox `addon.disabled` / `addon.enabled`, roles cache bumped.
- **Apps:** the Marketplace's `disable` and `uninstall` write the opt-out on the app's add-on; `enable` and `install` lift it (no row is written by an ordinary install; a pause the subscription causes is not an opt-out).
- **Cards and locks:** `AddonCard.activation` and `canToggle`; `featureAddons[].offer` can be `disabled` (the plan includes it, the workspace turned it off).
- **Web:** Included cards show Active / Turned off with Turn off / Turn on (permission `addons.activation.manage`), one impact dialog with a typed confirmation when something customer-facing is at risk, and the locked-screen card for `disabled`.
- **Deliberately not in phase 1** (so nothing regresses before the provisioner lands): an Included app's features still come from the plan row, and no app is installed by default. Both move together in phase 2.

